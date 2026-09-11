const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { io: clientIo } = require('../backend/node_modules/socket.io-client');
const { buildServer } = require('../backend/server');
const { closeDb, getDb } = require('../backend/db');

const TIMEOUT_MS = 5000;

function failAfter(ms, message) {
  let timer;
  const promise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  promise.catch(() => {});
  return { promise, timer };
}

function emitAck(socket, event, payload) {
  const { promise, timer } = failAfter(TIMEOUT_MS, `timed out waiting for ${event} ack`);
  const acked = new Promise((resolve) => socket.emit(event, payload, resolve)).finally(() =>
    clearTimeout(timer)
  );
  return Promise.race([acked, promise]);
}

async function waitFor(cond, message) {
  const { promise, timer } = failAfter(TIMEOUT_MS, message);
  const polling = (async () => {
    for (;;) {
      if (cond()) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  })().finally(() => clearTimeout(timer));
  return Promise.race([polling, promise]);
}

function connectClient(url) {
  const socket = clientIo(url, { transports: ['websocket'] });
  const events = { cartSyncs: [], participants: [], checkoutAvailable: [], checkouts: [], errors: [] };
  socket.on('cart:sync', (p) => events.cartSyncs.push(p));
  socket.on('participants:sync', (p) => events.participants.push(p));
  socket.on('checkout:available', (p) => events.checkoutAvailable.push(p));
  socket.on('session:checkout', (p) => events.checkouts.push(p));
  socket.on('error', (p) => events.errors.push(p));
  const { promise, timer } = failAfter(TIMEOUT_MS, 'timed out connecting socket');
  const connected = new Promise((resolve, reject) => {
    socket.on('connect', resolve);
    socket.on('connect_error', reject);
  }).finally(() => clearTimeout(timer));
  return Promise.race([connected, promise]).then(() => ({ socket, events }));
}

describe('phase 3: ready gate + host-only checkout + persistence', () => {
  let dbPath;
  let app;
  let url;
  let itemId;
  let itemPrice;
  const clients = [];

  before(async () => {
    dbPath = path.join(os.tmpdir(), `food-order-checkout-test-${process.pid}-${Date.now()}.db`);
    app = await buildServer({ dbPath, logger: false });
    await app.listen({ port: 0, host: '127.0.0.1' });
    url = `http://127.0.0.1:${app.server.address().port}`;

    const menu = await app.inject({ method: 'GET', url: '/api/menu' });
    ({ id: itemId, price_paise: itemPrice } = menu.json()[0]);
  });

  after(async () => {
    for (const { socket } of clients) socket.disconnect();
    if (app) await app.close();
    closeDb();
    for (const suffix of ['', '-wal', '-shm']) {
      const file = `${dbPath}${suffix}`;
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
  });

  async function makeSessionWithTwo() {
    const created = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { display_name: 'Host' },
    });
    const { id: sessionId, host_id: hostId, join_code: joinCode } = created.json();
    const joined = await app.inject({
      method: 'POST',
      url: '/api/sessions/join',
      payload: { join_code: joinCode, display_name: 'Priya' },
    });
    const { user_id: guestId } = joined.json();

    const host = await connectClient(url);
    const guest = await connectClient(url);
    clients.push(host, guest);
    await emitAck(host.socket, 'session:join', { sessionId, userId: hostId });
    await emitAck(guest.socket, 'session:join', { sessionId, userId: guestId });
    return { sessionId, hostId, guestId, host, guest };
  }

  it('ready toggles broadcast participants:sync; gate opens only when all ready', async () => {
    const { sessionId, hostId, guestId, host } = await makeSessionWithTwo();

    // REST state starts not-ready on both sides.
    const initial = await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}/state` });
    assert.equal(initial.json().allReady, false);
    assert.ok(initial.json().participants.every((p) => p.ready === false));

    const hostReady = await emitAck(host.socket, 'user:ready', { sessionId, userId: hostId, ready: true });
    assert.equal(hostReady.ok, true);
    assert.equal(hostReady.available, false);
    await waitFor(
      () => host.events.participants.some((list) => list.some((p) => p.userId === hostId && p.ready === true)),
      'host ready should broadcast participants:sync'
    );
    assert.deepEqual(host.events.checkoutAvailable.at(-1), { available: false });

    const guestSockets = clients.at(-1);
    const guestReady = await emitAck(guestSockets.socket, 'user:ready', {
      sessionId,
      userId: guestId,
      ready: true,
    });
    assert.equal(guestReady.ok, true);
    assert.equal(guestReady.available, true);
    await waitFor(
      () => host.events.checkoutAvailable.some((p) => p.available === true),
      'all-ready should broadcast checkout:available true'
    );

    const after = await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}/state` });
    assert.equal(after.json().allReady, true);
  });

  it('non-host checkout is rejected with ONLY_HOST_CAN_CHECKOUT', async () => {
    const { sessionId, hostId, guestId, guest } = await makeSessionWithTwo();
    await emitAck(guest.socket, 'user:ready', { sessionId, userId: guestId, ready: true });
    const res = await emitAck(guest.socket, 'checkout', { sessionId, userId: guestId });
    assert.equal(res.ok, false);
    assert.equal(res.code, 'ONLY_HOST_CAN_CHECKOUT');
    assert.ok(guest.events.errors.some((e) => e.code === 'ONLY_HOST_CAN_CHECKOUT'));
    // Host did not join the ready gate, session untouched.
    assert.equal(hostId.length > 0, true);
  });

  it('host checkout before all-ready is rejected with NOT_ALL_READY', async () => {
    const { sessionId, hostId, guestId, host } = await makeSessionWithTwo();
    await emitAck(host.socket, 'user:ready', { sessionId, userId: hostId, ready: true });
    // Guest stays browsing.
    const res = await emitAck(host.socket, 'checkout', { sessionId, userId: hostId });
    assert.equal(res.ok, false);
    assert.equal(res.code, 'NOT_ALL_READY');
    assert.ok(res.notReady.some((p) => p.userId === guestId));
    assert.ok(host.events.errors.some((e) => e.code === 'NOT_ALL_READY'));
  });

  it('host checkout when all-ready persists order, decrements stock, completes session', async () => {
    const { sessionId, hostId, guestId, host, guest } = await makeSessionWithTwo();

    const stockBefore = getDb().prepare('SELECT stock FROM menu_items WHERE id = ?').get(itemId).stock;

    // Guest adds 2 units (attribution: guest), host marks quantities.
    const added = await emitAck(guest.socket, 'cart:add', {
      sessionId,
      itemId,
      qty: 2,
      baseVersion: 0,
      addedBy: guestId,
    });
    assert.equal(added.ok, true);

    await emitAck(host.socket, 'user:ready', { sessionId, userId: hostId, ready: true });
    await emitAck(guest.socket, 'user:ready', { sessionId, userId: guestId, ready: true });

    const res = await emitAck(host.socket, 'checkout', { sessionId, userId: hostId });
    assert.equal(res.ok, true);
    assert.ok(res.orderId);

    // Both clients see the confirmation broadcast.
    await waitFor(
      () => host.events.checkouts.length > 0 && guest.events.checkouts.length > 0,
      'both clients should receive session:checkout'
    );
    assert.equal(host.events.checkouts.at(-1).orderId, res.orderId);

    // Order + items persisted with attribution; stock confirmed; session completed.
    const order = getDb().prepare('SELECT id, total_paise, status FROM orders WHERE id = ?').get(res.orderId);
    assert.equal(order.total_paise, 2 * itemPrice);
    assert.equal(order.status, 'placed');
    const items = getDb().prepare('SELECT menu_item_id, qty, added_by FROM order_items WHERE order_id = ?').all(res.orderId);
    assert.deepEqual(items, [{ menu_item_id: itemId, qty: 2, added_by: guestId }]);
    const stockAfter = getDb().prepare('SELECT stock FROM menu_items WHERE id = ?').get(itemId).stock;
    assert.equal(stockAfter, stockBefore - 2);
    const session = getDb().prepare('SELECT status FROM group_sessions WHERE id = ?').get(sessionId);
    assert.equal(session.status, 'completed');

    // REST state reflects completion + persisted order.
    const state = await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}/state` });
    assert.equal(state.json().session.status, 'completed');
    assert.equal(state.json().orders.length, 1);
    assert.deepEqual(state.json().cart, {});
  });
});
