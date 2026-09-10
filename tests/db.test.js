const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { initDb, closeDb, getDb, getMenuItems, MENU_SEED } = require('../backend/db');

describe('db', () => {
  /** @type {string} */
  let dbPath;

  before(() => {
    dbPath = path.join(
      os.tmpdir(),
      `food-order-db-test-${process.pid}-${Date.now()}.db`
    );
    initDb({ dbPath, force: true });
  });

  after(() => {
    closeDb();
    for (const suffix of ['', '-wal', '-shm']) {
      const file = `${dbPath}${suffix}`;
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    }
  });

  it('creates required tables', () => {
    const database = getDb();
    const tables = database
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
         ORDER BY name`
      )
      .all()
      .map((row) => row.name);

    assert.deepEqual(tables, [
      'group_sessions',
      'menu_items',
      'order_items',
      'orders',
      'session_participants',
    ]);
  });

  it('seeds menu_items once with expected shape', () => {
    const items = getMenuItems();
    assert.equal(items.length, MENU_SEED.length);

    for (const item of items) {
      assert.equal(typeof item.id, 'string');
      assert.ok(item.id.length > 0);
      assert.equal(typeof item.name, 'string');
      assert.equal(typeof item.price_paise, 'number');
      assert.equal(typeof item.stock, 'number');
      assert.equal(typeof item.category, 'string');
      assert.ok(item.price_paise > 0);
      assert.ok(item.stock >= 0);
    }

    const categories = new Set(items.map((item) => item.category));
    assert.ok(categories.has('Mains'));
    assert.ok(categories.has('Breads'));
    assert.ok(categories.has('Starters'));
    assert.ok(categories.has('Drinks'));
    assert.ok(categories.has('Desserts'));
  });

  it('does not duplicate seed on re-init', () => {
    const beforeCount = getMenuItems().length;
    initDb({ dbPath, force: true });
    assert.equal(getMenuItems().length, beforeCount);
  });

  it('returns menu ordered by category then name', () => {
    const items = getMenuItems();
    const keys = items.map((item) => `${item.category}\0${item.name}`);
    const sorted = [...keys].sort();
    assert.deepEqual(keys, sorted);
  });

  it('enforces foreign keys', () => {
    const database = getDb();
    assert.throws(
      () => {
        database
          .prepare(
            `INSERT INTO session_participants
             (session_id, user_id, display_name, is_host, joined_at)
             VALUES (?, ?, ?, ?, ?)`
          )
          .run('missing-session', 'u1', 'Ada', 0, Date.now());
      },
      /FOREIGN KEY/i
    );
  });
});
