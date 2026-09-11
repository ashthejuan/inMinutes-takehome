const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  reserveStock,
  releaseStock,
  refreshStockCache,
  setCachedStock,
  getCachedStock,
  getReserved,
  getAvailable,
  clearStockState,
  removeSession,
} = require('../backend/stock');

describe('stock reservation', () => {
  beforeEach(() => {
    clearStockState();
  });

  it('reserveStock decrements free stock and reports available', async () => {
    setCachedStock('item-a', 5);
    assert.deepEqual(await reserveStock('s1', 'item-a', 2), { ok: true, available: 3 });
    assert.equal(getReserved('s1', 'item-a'), 2);
    assert.equal(getAvailable('item-a'), 3);
  });

  it('reserveStock rejects when free < qty and reports current free', async () => {
    setCachedStock('item-a', 2);
    assert.deepEqual(await reserveStock('s1', 'item-a', 3), { ok: false, available: 2 });
    assert.equal(getReserved('s1', 'item-a'), 0);
  });

  it('releaseStock restores availability, clamped at 0', async () => {
    setCachedStock('item-a', 3);
    await reserveStock('s1', 'item-a', 2);
    await releaseStock('s1', 'item-a', 1);
    assert.equal(getAvailable('item-a'), 2);
    await releaseStock('s1', 'item-a', 99); // over-release clamps, no negative
    assert.equal(getReserved('s1', 'item-a'), 0);
    assert.equal(getAvailable('item-a'), 3);
  });

  it('rejects invalid qty without mutating', async () => {
    setCachedStock('item-a', 5);
    for (const qty of [0, -1, 1.5, NaN]) {
      assert.deepEqual(await reserveStock('s1', 'item-a', qty), { ok: false, available: 5 });
    }
    assert.equal(getReserved('s1', 'item-a'), 0);
  });

  it('serializes concurrent reserves on same item: no oversell', async () => {
    setCachedStock('item-a', 5);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => reserveStock('s1', 'item-a', 1))
    );
    assert.equal(results.filter((r) => r.ok).length, 5);
    assert.equal(results.filter((r) => !r.ok).length, 5);
    assert.equal(getReserved('s1', 'item-a'), 5);
    assert.equal(getAvailable('item-a'), 0);
  });

  it('shares global stock across sessions', async () => {
    setCachedStock('item-a', 5);
    assert.deepEqual(await reserveStock('sA', 'item-a', 3), { ok: true, available: 2 });
    // Other session sees only the remainder.
    assert.deepEqual(await reserveStock('sB', 'item-a', 3), { ok: false, available: 2 });
    assert.deepEqual(await reserveStock('sB', 'item-a', 2), { ok: true, available: 0 });
    // Release from one session frees for the other.
    await releaseStock('sA', 'item-a', 3);
    assert.equal(getAvailable('item-a'), 3);
  });

  it('removeSession frees that session reservations only', async () => {
    setCachedStock('item-a', 5);
    await reserveStock('sA', 'item-a', 2);
    await reserveStock('sB', 'item-a', 1);
    removeSession('sA');
    assert.equal(getReserved('sA', 'item-a'), 0);
    assert.equal(getReserved('sB', 'item-a'), 1);
    assert.equal(getAvailable('item-a'), 4);
  });

  it('refreshStockCache loads menu:stock:{itemId} from SQLite', async () => {
    const dbPath = path.join(os.tmpdir(), `food-order-stock-test-${process.pid}-${Date.now()}.db`);
    try {
      const { initDb, closeDb, getMenuItems } = require('../backend/db');
      initDb({ dbPath, force: true });
      const count = refreshStockCache();
      const items = getMenuItems();
      assert.equal(count, items.length);
      for (const item of items) {
        assert.equal(getCachedStock(item.id), item.stock);
      }
      closeDb();
    } finally {
      for (const suffix of ['', '-wal', '-shm']) {
        const file = `${dbPath}${suffix}`;
        if (fs.existsSync(file)) fs.unlinkSync(file);
      }
      clearStockState();
    }
  });
});
