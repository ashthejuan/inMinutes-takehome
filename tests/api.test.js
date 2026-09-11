const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildServer } = require('../backend/server');
const { closeDb, MENU_SEED } = require('../backend/db');

describe('api', () => {
  /** @type {string} */
  let dbPath;
  /** @type {import('fastify').FastifyInstance} */
  let app;

  before(async () => {
    dbPath = path.join(
      os.tmpdir(),
      `food-order-api-test-${process.pid}-${Date.now()}.db`
    );
    app = await buildServer({ dbPath, logger: false });
    await app.ready();
  });

  after(async () => {
    if (app) {
      await app.close();
    }
    closeDb();
    for (const suffix of ['', '-wal', '-shm']) {
      const file = `${dbPath}${suffix}`;
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    }
  });

  it('GET /health returns ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { ok: true });
  });

  it('GET /api/menu returns seeded items', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/menu' });
    assert.equal(res.statusCode, 200);

    const body = res.json();
    assert.ok(Array.isArray(body));
    assert.equal(body.length, MENU_SEED.length);

    const sample = body[0];
    assert.ok(sample.id);
    assert.ok(sample.name);
    assert.equal(typeof sample.price_paise, 'number');
    assert.equal(typeof sample.stock, 'number');
    assert.ok(sample.category);
  });

  it('POST /api/sessions creates a session with join code', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: {},
    });
    assert.equal(res.statusCode, 201);

    const body = res.json();
    assert.ok(body.id);
    assert.ok(body.join_code);
    assert.equal(body.join_code, body.join_code.toUpperCase());
    assert.equal(body.join_code.length, 6);
    assert.equal(body.status, 'active');
    assert.equal(typeof body.created_at, 'number');
    assert.ok(body.host_id);
  });

  it('POST /api/sessions/join validates code and adds participant', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { display_name: 'Host User' },
    });
    const { join_code, id: sessionId } = created.json();

    const joined = await app.inject({
      method: 'POST',
      url: '/api/sessions/join',
      payload: { join_code, display_name: 'Priya' },
    });
    assert.equal(joined.statusCode, 200);

    const joinBody = joined.json();
    assert.equal(joinBody.session_id, sessionId);
    assert.ok(joinBody.user_id);
    assert.equal(joinBody.display_name, 'Priya');
    assert.equal(joinBody.is_host, 0);

    const badCode = await app.inject({
      method: 'POST',
      url: '/api/sessions/join',
      payload: { join_code: 'ZZZZZZ' },
    });
    assert.equal(badCode.statusCode, 404);

    const missingCode = await app.inject({
      method: 'POST',
      url: '/api/sessions/join',
      payload: {},
    });
    assert.equal(missingCode.statusCode, 400);
  });

  it('GET /api/sessions/:id/state returns session + participants', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: {},
    });
    const { id: sessionId, join_code } = created.json();

    await app.inject({
      method: 'POST',
      url: '/api/sessions/join',
      payload: { join_code, display_name: 'Rohan' },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/state`,
    });
    assert.equal(res.statusCode, 200);

    const body = res.json();
    assert.equal(body.session.id, sessionId);
    assert.equal(body.session.join_code, join_code);
    assert.ok(Array.isArray(body.participants));
    assert.equal(body.participants.length, 2);
    assert.ok(Array.isArray(body.orders));
    assert.deepEqual(body.cart, {});
    assert.equal(body.version, 0);

    const missing = await app.inject({
      method: 'GET',
      url: '/api/sessions/does-not-exist/state',
    });
    assert.equal(missing.statusCode, 404);
  });

  it('attaches socket.io to the HTTP server', () => {
    assert.ok(app.io);
    assert.equal(typeof app.io.on, 'function');
    assert.equal(app.io.engine.opts.cors.origin, true);
  });
});
