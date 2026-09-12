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

/**
 * Connect a fresh Socket.io client that records every sync/error event.
 * Returns { socket, syncs, participants, available, hostChanged, errors }.
 */
function connectClient(url) {
  const socket = clientIo(url, { transports: ['websocket'] });
  const events = { syncs: [], participants: [], available: [], hostChanged: [], errors: [] };
  socket.on('cart:sync', (p) => events.syncs.push(p));
  socket.on('participants:sync', (p) => events.participants.push(p));
  socket.on('checkout:available', (p) => events.available.push(p));
  socket.on('host:changed', (p) => events.hostChanged.push(p));
  socket.on('error', (p) => events.errors.push(p));
  const { promise, timer } = failAfter(TIMEOUT_MS, 'timed out connecting socket');
  const connected = new Promise((resolve, reject) => {
    socket.on('connect', resolve);
    socket.on('connect_error', reject);
  }).finally(() => clearTimeout(timer));
  return Promise.race([connected, promise]).then(() => ({ socket, ...events }));
}

describe('network drop / connection loss during a group session (PRD §8.4)', () => {
  let dbPath;
  let app;
  let url;
  /** @type {string} */
  let itemId;
  /** @type {string} */
  let itemId2;
  const sockets = [];
  const track = (s) => {
    sockets.push(s);
    return s;
  };

  before(async () => {
    dbPath = path.join(os.tmpdir(), `food-order-reconnect-test-${process.pid}-${Date.now()}.db`);
    app = await buildServer({ dbPath, logger: false });
    await app.listen({ port: 0, host: '127.0.0.1' });
    url = `http://127.0.0.1:${app.server.address().port}`;

    const menu = await app.inject({ method: 'GET', url: '/api/menu' });
    assert.equal(menu.statusCode, 200);
    const items = menu.json();
    assert.ok(items.length >= 2, 'need at least 2 menu items for drop tests');
    itemId = items[0].id;
    itemId2 = items[1].id;
  });

  after(async () => {
    for (const s of sockets) {
      try {
        s.disconnect();
      } catch {
        // Already gone — teardown only.
      }
    }
    if (app) await app.close();
    closeDb();
    for (const suffix of ['', '-wal', '-shm']) {
      const file = `${dbPath}${suffix}`;
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
  });

  /**
   * Boot a session with a host + guest socket, both joined, and one line in
   * the cart (v1). Returns { sessionId, hostId, guestId, host, guest }.
   */
  async function bootSessionWithLine() {
    const created = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { display_name: 'Host' },
    });
    assert.equal(created.statusCode, 201);
    const { id: sessionId, host_id: hostId, join_code: joinCode } = created.json();

    const joined = await app.inject({
      method: 'POST',
      url: '/api/sessions/join',
      payload: { join_code: joinCode, display_name: 'Priya' },
    });
    assert.equal(joined.statusCode, 200);
    const { user_id: guestId } = joined.json();

    const host = await connectClient(url);
    const guest = await connectClient(url);
    track(host.socket);
    track(guest.socket);

    const joinHost = await emitAck(host.socket, 'session:join', { sessionId, userId: hostId });
    const joinGuest = await emitAck(guest.socket, 'session:join', { sessionId, userId: guestId });
    assert.equal(joinHost.ok, true);
    assert.equal(joinGuest.ok, true);

    const added = await emitAck(host.socket, 'cart:add', {
      sessionId,
      itemId,
      qty: 2,
      baseVersion: joinHost.version,
    });
    assert.equal(added.ok, true);
    assert.equal(added.version, 1);

    await waitFor(
      () => host.syncs.some((s) => s.version === 1) && guest.syncs.some((s) => s.version === 1),
      'both clients should receive cart:sync v1 before the drop'
    );

    return { sessionId, hostId, guestId, host, guest };
  }

  it('guest transport drop: misses live updates, rejoin replays full state, presence stays single', async () => {
    const { sessionId, hostId, guestId, host, guest } = await bootSessionWithLine();
    const guestKey = `${itemId}:${hostId}`;
    assert.equal(guest.syncs.at(-1).cart[guestKey].qty, 2);

    // Simulate network loss: abrupt transport drop with NO session:leave,
    // exactly like a WiFi cut / phone lock (PRD §8.4).
    const syncsBeforeDrop = guest.syncs.length;
    guest.socket.disconnect();

    // While the guest is offline the host keeps editing — version advances
    // and the offline client (by definition) receives nothing.
    const hostAdded = await emitAck(host.socket, 'cart:add', {
      sessionId,
      itemId: itemId2,
      qty: 1,
      baseVersion: 1,
    });
    assert.equal(hostAdded.ok, true);
    assert.equal(hostAdded.version, 2);
    await waitFor(
      () => host.syncs.some((s) => s.version === 2),
      'host should receive cart:sync v2'
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(guest.syncs.length, syncsBeforeDrop, 'offline client must receive no syncs');

    // Transport auto-reconnect opens a NEW server-side socket with no room
    // membership, so the client re-emits session:join (client rejoin path).
    const rejoined = await connectClient(url);
    track(rejoined.socket);
    const rejoin = await emitAck(rejoined.socket, 'session:join', {
      sessionId,
      userId: guestId,
    });
    assert.equal(rejoin.ok, true);
    // Full state replay: pre-drop line + line added while offline.
    assert.equal(rejoin.version, 2);
    assert.equal(rejoin.cart[guestKey].qty, 2);
    assert.equal(rejoin.cart[`${itemId2}:${hostId}`].qty, 1);
    // Presence must not duplicate: exactly one row per user.
    const guestRows = rejoin.participants.filter((p) => (p.userId ?? p.user_id) === guestId);
    assert.equal(guestRows.length, 1);
    assert.equal(rejoin.participants.length, 2);

    // The replays arrive as live events too — no separate resync call needed.
    await waitFor(
      () =>
        rejoined.syncs.some((s) => s.version === 2) && rejoined.participants.length > 0,
      'rejoined client should get cart:sync + participants:sync replays'
    );
    assert.deepEqual(rejoined.syncs.at(-1).cart, rejoin.cart);
  });

  it('stale mutation after rejoin heals via VERSION_CONFLICT merge + single retry', async () => {
    const { sessionId, guestId } = await bootSessionWithLine();

    // Fresh socket, same user — but it mutates with a stale baseVersion,
    // exactly like a mutation buffered while offline (PRD §10.4).
    const client = await connectClient(url);
    track(client.socket);
    const rejoin = await emitAck(client.socket, 'session:join', {
      sessionId,
      userId: guestId,
    });
    assert.equal(rejoin.ok, true);

    const stale = await emitAck(client.socket, 'cart:add', {
      sessionId,
      itemId,
      qty: 1,
      baseVersion: 0, // stale: server is already at v1
    });
    assert.equal(stale.ok, false);
    assert.equal(stale.code, 'VERSION_CONFLICT');
    assert.equal(stale.currentVersion, 1);
    assert.ok(stale.currentState, 'conflict must carry currentState for merge');

    const retry = await emitAck(client.socket, 'cart:add', {
      sessionId,
      itemId,
      qty: 1,
      baseVersion: stale.currentVersion,
    });
    assert.equal(retry.ok, true);
    assert.equal(retry.version, 2);
    assert.equal(retry.cart[`${itemId}:${guestId}`].qty, 1);
  });

  it('host connection loss transfers host; rejoining host sees the new host in the ack', async () => {
    const { sessionId, hostId, guestId, host, guest } = await bootSessionWithLine();

    // Abrupt host drop (no leave) → oldest connected participant takes over.
    host.socket.disconnect();
    await waitFor(
      () => guest.hostChanged.length > 0,
      'guest should receive host:changed after the host drops'
    );
    assert.equal(guest.hostChanged.at(-1).hostId ?? guest.hostChanged.at(-1).host_id, guestId);

    // The old host comes back on a new transport and rejoins: full state +
    // the transferred host id, so the client can recompute checkout rights.
    const hostBack = await connectClient(url);
    track(hostBack.socket);
    const rejoin = await emitAck(hostBack.socket, 'session:join', {
      sessionId,
      userId: hostId,
    });
    assert.equal(rejoin.ok, true);
    assert.equal(rejoin.version, 1);
    assert.equal(rejoin.cart[`${itemId}:${hostId}`].qty, 2);
    assert.equal(rejoin.hostId ?? rejoin.host_id, guestId);
    const hostRows = rejoin.participants.filter((p) => p.isHost === true || p.is_host === 1);
    assert.equal(hostRows.length, 1);
    assert.equal(hostRows[0].userId ?? hostRows[0].user_id, guestId);
  });
});
