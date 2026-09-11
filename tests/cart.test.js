const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { initDb, closeDb, getMenuItems } = require('../backend/db');
const { refreshStockCache, setCachedStock, getAvailable, clearStockState } = require('../backend/stock');
const {
  getSessionVersion,
  getCartState,
  applyMutation,
  clearCartState,
} = require('../backend/cart');

describe('optimistic concurrency control', () => {
  let dbPath;
  /** @type {string} */
  let itemId;
  let itemPrice;

  before(() => {
    dbPath = path.join(os.tmpdir(), `food-order-cart-test-${process.pid}-${Date.now()}.db`);
    initDb({ dbPath, force: true });
    refreshStockCache();
    const [first] = getMenuItems();
    itemId = first.id;
    itemPrice = first.price_paise;
  });

  after(() => {
    closeDb();
    for (const suffix of ['', '-wal', '-shm']) {
      const file = `${dbPath}${suffix}`;
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
  });

  beforeEach(() => {
    clearCartState();
    clearStockState();
    setCachedStock(itemId, 10);
  });

  it('starts at version 0 with an empty cart', () => {
    assert.equal(getSessionVersion('s1'), 0);
    assert.deepEqual(getCartState('s1'), {});
  });

  it('matching baseVersion applies and increments version', async () => {
    const res = await applyMutation('s1', { itemId, qty: 2, baseVersion: 0, addedBy: 'u1' });
    assert.equal(res.ok, true);
    assert.equal(res.version, 1);
    assert.deepEqual(res.delta, { itemId, qty: 2 });
    assert.deepEqual(getCartState('s1'), { [itemId]: { qty: 2, addedBy: 'u1', price: itemPrice } });
    assert.equal(getSessionVersion('s1'), 1);
  });

  it('stale baseVersion rejects with current state; retry wins', async () => {
    await applyMutation('s1', { itemId, qty: 2, baseVersion: 0, addedBy: 'u1' });

    const loser = await applyMutation('s1', { itemId, qty: 5, baseVersion: 0, addedBy: 'u2' });
    assert.equal(loser.ok, false);
    assert.equal(loser.code, 'VERSION_CONFLICT');
    assert.equal(loser.currentVersion, 1);
    assert.deepEqual(loser.currentState, { [itemId]: { qty: 2, addedBy: 'u1', price: itemPrice } });
    // Rejected mutation leaves state untouched.
    assert.equal(getSessionVersion('s1'), 1);

    // Loser merges currentState and retries with the fresh version.
    const retry = await applyMutation('s1', { itemId, qty: 5, baseVersion: loser.currentVersion, addedBy: 'u2' });
    assert.equal(retry.ok, true);
    assert.equal(retry.version, 2);
    assert.equal(getCartState('s1')[itemId].qty, 5);
  });

  it('concurrent same-baseVersion edits: last writer wins, loser conflicts', async () => {
    const [a, b] = await Promise.all([
      applyMutation('s1', { itemId, qty: 2, baseVersion: 0, addedBy: 'u1' }),
      applyMutation('s1', { itemId, qty: 3, baseVersion: 0, addedBy: 'u2' }),
    ]);
    const okCount = [a, b].filter((r) => r.ok).length;
    const conflictCount = [a, b].filter((r) => !r.ok && r.code === 'VERSION_CONFLICT').length;
    assert.equal(okCount, 1);
    assert.equal(conflictCount, 1);
    assert.equal(getSessionVersion('s1'), 1);
    const winner = a.ok ? a : b;
    assert.equal(getCartState('s1')[itemId].qty, winner.delta.qty);
  });

  it('qty decrease and remove release stock', async () => {
    await applyMutation('s1', { itemId, qty: 4, baseVersion: 0, addedBy: 'u1' });
    assert.equal(getAvailable(itemId), 6);

    await applyMutation('s1', { itemId, qty: 1, baseVersion: 1, addedBy: 'u1' });
    assert.equal(getAvailable(itemId), 9);

    const removed = await applyMutation('s1', { itemId, qty: 0, baseVersion: 2, addedBy: 'u1' });
    assert.equal(removed.ok, true);
    assert.deepEqual(getCartState('s1'), {});
    assert.equal(getAvailable(itemId), 10);
  });

  it('insufficient stock rejects with OUT_OF_STOCK and available count', async () => {
    const res = await applyMutation('s1', { itemId, qty: 11, baseVersion: 0, addedBy: 'u1' });
    assert.equal(res.ok, false);
    assert.equal(res.code, 'OUT_OF_STOCK');
    assert.equal(res.available, 10);
    assert.equal(getSessionVersion('s1'), 0);
  });

  it('unknown item rejects without touching version', async () => {
    const res = await applyMutation('s1', { itemId: 'nope', qty: 1, baseVersion: 0 });
    assert.equal(res.ok, false);
    assert.equal(res.code, 'UNKNOWN_ITEM');
    assert.equal(getSessionVersion('s1'), 0);
  });

  it('addedBy is display-only: any participant may edit any line', async () => {
    await applyMutation('s1', { itemId, qty: 2, baseVersion: 0, addedBy: 'u1' });
    // A different user edits the line — allowed, attribution stays.
    const edited = await applyMutation('s1', { itemId, qty: 5, baseVersion: 1, addedBy: 'u2' });
    assert.equal(edited.ok, true);
    assert.equal(edited.cart[itemId].addedBy, 'u1');
    // ... including removing it entirely.
    const removed = await applyMutation('s1', { itemId, qty: 0, baseVersion: 2, addedBy: 'u2' });
    assert.equal(removed.ok, true);
    assert.deepEqual(getCartState('s1'), {});
  });

  it('addedBy changes hands when the line is re-added after removal', async () => {
    await applyMutation('s1', { itemId, qty: 2, baseVersion: 0, addedBy: 'u1' });
    await applyMutation('s1', { itemId, qty: 0, baseVersion: 1, addedBy: 'u1' });
    const readded = await applyMutation('s1', { itemId, qty: 1, baseVersion: 2, addedBy: 'u2' });
    assert.equal(readded.ok, true);
    assert.equal(readded.cart[itemId].addedBy, 'u2');
  });

  it('REST state exposes the live versioned cart for baseVersion reads', async () => {
    const { buildServer } = require('../backend/server');
    // Reuse the same sqlite file so menu ids match the cache.
    const app = await buildServer({ dbPath, logger: false });

    try {
      const created = await app.inject({ method: 'POST', url: '/api/sessions', payload: {} });
      const { id: sessionId } = created.json();

      const before = await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}/state` });
      assert.equal(before.json().version, 0);

      const applied = await applyMutation(sessionId, { itemId, qty: 2, baseVersion: 0, addedBy: 'u1' });
      assert.equal(applied.ok, true);

      const after = await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}/state` });
      assert.equal(after.json().version, 1);
      assert.deepEqual(after.json().cart, { [itemId]: { qty: 2, addedBy: 'u1', price: itemPrice } });
    } finally {
      await app.close();
      // buildServer with dbPath forced a re-init; restore this suite's db handle.
      initDb({ dbPath, force: true });
      refreshStockCache();
    }
  });
});
