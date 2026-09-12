const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { io: clientIo } = require('../backend/node_modules/socket.io-client');
const { buildServer, sweepExpiredSessions } = require('../backend/server');
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
  const events = { hostChanged: [], expired: [], participants: [], errors: [], available: [] };
  socket.on('host:changed', (p) => events.hostChanged.push(p));
  socket.on('session:expired', (p) => events.expired.push(p));
  socket.on('participants:sync', (p) => events.participants.push(p));
  socket.on('checkout:available', (p) => events.available.push(p));
  socket.on('error', (p) => events.errors.push(p));
  const { promise, timer } = failAfter(TIMEOUT_MS, 'timed out connecting socket');
  const connected = new Promise((resolve, reject) => {
    socket.on('connect', resolve);
    socket.on('connect_error', reject);
  }).finally(() => clearTimeout(timer));
  return Promise.race([connected, promise]).then(() => ({ socket, events }));
}

describe('phase 4 verification', () => {
  let dbPath, app, url;
  const clients = [];
  before(async () => {
    dbPath = path.join(os.tmpdir(), `food-order-p4-${process.pid}-${Date.now()}.db`);
    app = await buildServer({ dbPath, logger: false, disableSweep: true });
    await app.listen({ port: 0, host: '127.0.0.1' });
    url = `http://127.0.0.1:${app.server.address().port}`;
  });
  after(async () => {
    for (const { socket } of clients) socket.disconnect();
    if (app) await app.close();
    closeDb();
    for (const s of ['', '-wal', '-shm']) {
      const f = `${dbPath}${s}`;
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
  });

  it('host disconnect transfers to oldest guest; SQLite + broadcast updated', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/sessions', payload: { display_name: 'Host' } });
    const { id: sessionId, host_id: hostId, join_code: joinCode } = created.json();
    const j1 = await app.inject({ method: 'POST', url: '/api/sessions/join', payload: { join_code: joinCode, display_name: 'Priya' } });
    const { user_id: guest1 } = j1.json();
    const j2 = await app.inject({ method: 'POST', url: '/api/sessions/join', payload: { join_code: joinCode, display_name: 'Rohan' } });
    const { user_id: guest2 } = j2.json();

    const host = await connectClient(url);
    const g1 = await connectClient(url);
    const g2 = await connectClient(url);
    clients.push(host, g1, g2);
    await emitAck(host.socket, 'session:join', { sessionId, userId: hostId });
    await emitAck(g1.socket, 'session:join', { sessionId, userId: guest1 });
    await emitAck(g2.socket, 'session:join', { sessionId, userId: guest2 });

    host.socket.disconnect();
    await waitFor(() => g1.events.hostChanged.length > 0 && g2.events.hostChanged.length > 0, 'guests should get host:changed');
    assert.equal(g1.events.hostChanged.at(-1).hostId, guest1);
    const row = getDb().prepare('SELECT host_id FROM group_sessions WHERE id = ?').get(sessionId);
    assert.equal(row.host_id, guest1);
    const flags = getDb().prepare('SELECT user_id, is_host FROM session_participants WHERE session_id = ? ORDER BY joined_at ASC').all(sessionId);
    assert.equal(flags.find((r) => r.user_id === guest1).is_host, 1);
    assert.equal(flags.find((r) => r.user_id === hostId).is_host, 0);
  });

  it('expired sessions sweep + SESSION_EXPIRED on REST and sockets', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/sessions', payload: { display_name: 'H' } });
    const { id: sessionId, join_code: joinCode } = created.json();
    getDb().prepare('UPDATE group_sessions SET expires_at = ? WHERE id = ?').run(Math.floor(Date.now() / 1000) - 10, sessionId);

    const ids = sweepExpiredSessions();
    assert.ok(ids.includes(sessionId));
    const row = getDb().prepare('SELECT status FROM group_sessions WHERE id = ?').get(sessionId);
    assert.equal(row.status, 'expired');

    const join = await app.inject({ method: 'POST', url: '/api/sessions/join', payload: { join_code: joinCode } });
    assert.equal(join.statusCode, 410);
    assert.equal(join.json().code, 'SESSION_EXPIRED');

    const state = await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}/state` });
    assert.equal(state.statusCode, 410);
    assert.equal(state.json().code, 'SESSION_EXPIRED');

    const c = await connectClient(url);
    clients.push(c);
    const res = await emitAck(c.socket, 'session:join', { sessionId, userId: 'nobody' });
    assert.equal(res.ok, false);
    assert.equal(res.code, 'SESSION_EXPIRED');
  });
});
