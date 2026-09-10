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

  it('session routes return 501 until later phases', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: {},
    });
    assert.equal(create.statusCode, 501);

    const join = await app.inject({
      method: 'POST',
      url: '/api/sessions/join',
      payload: {},
    });
    assert.equal(join.statusCode, 501);

    const state = await app.inject({
      method: 'GET',
      url: '/api/sessions/abc/state',
    });
    assert.equal(state.statusCode, 501);
  });

  it('attaches socket.io to the HTTP server', () => {
    assert.ok(app.io);
    assert.equal(typeof app.io.on, 'function');
    assert.equal(app.io.engine.opts.cors.origin, true);
  });
});
