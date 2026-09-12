const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { io: clientIo } = require('../backend/node_modules/socket.io-client');
const { buildServer } = require('../backend/server');
const { closeDb, getDb } = require('../backend/db');
const { SESSION_TTL_SECONDS } = require('../backend/expiry');

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

function expiresAt(sessionId) {
  return getDb().prepare('SELECT expires_at FROM group_sessions WHERE id = ?').get(sessionId)
    .expires_at;
}

describe('session idle TTL: activity slides the deadline (FR-13)', () => {
  let dbPath;
  let app;
  let url;
  const clients = [];

  before(async () => {
    dbPath = path.join(os.tmpdir(), `food-order-ttl-touch-test-${process.pid}-${Date.now()}.db`);
    app = await buildServer({ dbPath, logger: false, disableSweep: true });
    await app.listen({ port: 0, host: '127.0.0.1' });
    url = `http://127.0.0.1:${app.server.address().port}`;
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

  it('joins and cart mutations extend expires_at; reads do not; idle sessions still expire', async () => {
    const now = Math.floor(Date.now() / 1000);
    const created = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { display_name: 'Host' },
    });
    assert.equal(created.statusCode, 201);
    const { id: sessionId, host_id: hostId, join_code: joinCode } = created.json();

    // Fresh sessions start with a full TTL window.
    assert.ok(Math.abs(expiresAt(sessionId) - (now + SESSION_TTL_SECONDS)) <= 5);

    // Simulate ~29 min of idleness: 60 s left on the clock.
    getDb()
      .prepare('UPDATE group_sessions SET expires_at = ? WHERE id = ?')
      .run(Math.floor(Date.now() / 1000) + 60, sessionId);
    const idleDeadline = expiresAt(sessionId);

    // Read-only state fetch must NOT keep the session alive.
    const state = await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}/state` });
    assert.equal(state.statusCode, 200);
    assert.equal(expiresAt(sessionId), idleDeadline);

    // A join is activity — the deadline slides back out to now + TTL.
    const join = await app.inject({
      method: 'POST',
      url: '/api/sessions/join',
      payload: { join_code: joinCode, display_name: 'Priya' },
    });
    assert.equal(join.statusCode, 200);
    const afterJoin = expiresAt(sessionId);
    assert.ok(afterJoin - idleDeadline > 60 * 20, 'join should slide expires_at by ~TTL');

    // Simulate idleness again, then mutate over a real socket.
    getDb()
      .prepare('UPDATE group_sessions SET expires_at = ? WHERE id = ?')
      .run(Math.floor(Date.now() / 1000) + 60, sessionId);
    const idleAgain = expiresAt(sessionId);

    const menu = await app.inject({ method: 'GET', url: '/api/menu' });
    const itemId = menu.json()[0].id;

    const socket = clientIo(url, { transports: ['websocket'] });
    clients.push({ socket });
    await new Promise((resolve, reject) => {
      const { promise, timer } = failAfter(TIMEOUT_MS, 'timed out connecting socket');
      socket.on('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.on('connect_error', reject);
      promise.catch(reject);
    });
    const joined = await emitAck(socket, 'session:join', { sessionId, userId: hostId });
    assert.equal(joined.ok, true);
    const added = await emitAck(socket, 'cart:add', {
      sessionId,
      itemId,
      qty: 1,
      baseVersion: joined.version,
    });
    assert.equal(added.ok, true);

    const afterMutation = expiresAt(sessionId);
    assert.ok(
      afterMutation - idleAgain > 60 * 20,
      'cart mutation should slide expires_at by ~TTL'
    );

    // True idleness still expires: past-deadline sessions answer 410.
    getDb()
      .prepare('UPDATE group_sessions SET expires_at = ? WHERE id = ?')
      .run(Math.floor(Date.now() / 1000) - 10, sessionId);
    const gone = await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}/state` });
    assert.equal(gone.statusCode, 410);
    assert.equal(gone.json().code, 'SESSION_EXPIRED');
  });
});
