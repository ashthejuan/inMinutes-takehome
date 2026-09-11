const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { io: clientIo } = require('../backend/node_modules/socket.io-client');
const { buildServer } = require('../backend/server');
const { closeDb } = require('../backend/db');

const TIMEOUT_MS = 5000;

function failAfter(ms, message) {
  let timer;
  const promise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  // Prevent unhandled rejection noise when the race settles first.
  promise.catch(() => {});
  return { promise, timer };
}

/** Emit with ack; rejects if the server never acknowledges. */
function emitAck(socket, event, payload) {
  const { promise, timer } = failAfter(TIMEOUT_MS, `timed out waiting for ${event} ack`);
  const acked = new Promise((resolve) => socket.emit(event, payload, resolve)).finally(() => clearTimeout(timer));
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
  const syncs = [];
  const errors = [];
  socket.on('cart:sync', (payload) => syncs.push(payload));
  socket.on('error', (payload) => errors.push(payload));
  const { promise, timer } = failAfter(TIMEOUT_MS, 'timed out connecting socket');
  const connected = new Promise((resolve, reject) => {
    socket.on('connect', resolve);
    socket.on('connect_error', reject);
  }).finally(() => clearTimeout(timer));
  return Promise.race([connected, promise]).then(() => ({ socket, syncs, errors }));
}

describe('concurrent edits over sockets', () => {
  let dbPath;
  let app;
  let url;
  /** @type {string} */
  let itemId;
  const clients = [];

  before(async () => {
    dbPath = path.join(os.tmpdir(), `food-order-realtime-test-${process.pid}-${Date.now()}.db`);
    app = await buildServer({ dbPath, logger: false });
    await app.listen({ port: 0, host: '127.0.0.1' });
    url = `http://127.0.0.1:${app.server.address().port}`;

    const menu = await app.inject({ method: 'GET', url: '/api/menu' });
    ({ id: itemId } = menu.json()[0]);
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

  it('two clients editing the same line: last writer wins, loser conflicts and retries', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/sessions', payload: {} });
    const { id: sessionId } = created.json();

    const clientA = await connectClient(url);
    const clientB = await connectClient(url);
    clients.push(clientA, clientB);

    // Both clients read the initial versioned state on join (baseVersion 0).
    const joinA = await emitAck(clientA.socket, 'session:join', { sessionId, userId: 'userA' });
    const joinB = await emitAck(clientB.socket, 'session:join', { sessionId, userId: 'userB' });
    assert.equal(joinA.ok, true);
    assert.equal(joinB.ok, true);
    assert.equal(joinA.version, 0);
    assert.equal(joinB.version, 0);

    // Simultaneous edits of the same line from the same baseVersion.
    const [resA, resB] = await Promise.all([
      emitAck(clientA.socket, 'cart:add', { sessionId, itemId, qty: 2, baseVersion: 0, addedBy: 'userA' }),
      emitAck(clientB.socket, 'cart:add', { sessionId, itemId, qty: 3, baseVersion: 0, addedBy: 'userB' }),
    ]);

    const winner = resA.ok ? { res: resA, user: 'userA', qty: 2 } : { res: resB, user: 'userB', qty: 3 };
    const loser = resA.ok
      ? { res: resB, client: clientB, user: 'userB', qty: 3 }
      : { res: resA, client: clientA, user: 'userA', qty: 2 };

    // Winner applied at version 1 with first-adder attribution.
    assert.equal(winner.res.version, 1);
    assert.deepEqual(winner.res.cart, { [itemId]: { qty: winner.qty, addedBy: winner.user, price: winner.res.cart[itemId].price } });

    // Loser got VERSION_CONFLICT carrying the current state to merge.
    assert.equal(loser.res.ok, false);
    assert.equal(loser.res.code, 'VERSION_CONFLICT');
    assert.equal(loser.res.currentVersion, 1);
    assert.deepEqual(loser.res.currentState, winner.res.cart);

    // Both clients were broadcast the winner's state (scroll-safe merge input).
    await waitFor(
      () => clientA.syncs.some((s) => s.version === 1) && clientB.syncs.some((s) => s.version === 1),
      'both clients should receive cart:sync v1'
    );

    // Loser applies currentState and retries the pending mutation.
    const retry = await emitAck(loser.client.socket, 'cart:add', {
      sessionId,
      itemId,
      qty: loser.qty,
      baseVersion: loser.res.currentVersion,
      addedBy: loser.user,
    });
    assert.equal(retry.ok, true);
    assert.equal(retry.version, 2);
    // Last writer wins on qty; attribution stays with the first adder
    // (display-only — the non-adder was never blocked from mutating).
    assert.equal(retry.cart[itemId].qty, loser.qty);
    assert.equal(retry.cart[itemId].addedBy, winner.user);

    await waitFor(
      () => clientA.syncs.some((s) => s.version === 2) && clientB.syncs.some((s) => s.version === 2),
      'both clients should receive cart:sync v2'
    );
    assert.deepEqual(clientA.syncs.at(-1).cart, retry.cart);
    assert.deepEqual(clientB.syncs.at(-1).cart, retry.cart);
  });
});
