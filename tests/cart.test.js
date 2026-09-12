const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { initDb, closeDb, getMenuItems } = require('../backend/db');
const { refreshStockCache, setCachedStock, getAvailable, clearStockState } = require('../backend/stock');
const {
  lineKey,
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

  function line(userId, qty) {
    return {
      [lineKey(itemId, userId)]: {
        itemId,
        qty,
        addedBy: userId,
        price: itemPrice,
      },
    };
  }

  it('starts at version 0 with an empty cart', () => {
    assert.equal(getSessionVersion('s1'), 0);
    assert.deepEqual(getCartState('s1'), {});
  });

  it('matching baseVersion applies and increments version', async () => {
    const res = await applyMutation('s1', { itemId, qty: 2, baseVersion: 0, addedBy: 'u1' });
    assert.equal(res.ok, true);
    assert.equal(res.version, 1);
    assert.deepEqual(res.delta, { itemId, qty: 2, addedBy: 'u1', lineKey: lineKey(itemId, 'u1') });
    assert.deepEqual(getCartState('s1'), line('u1', 2));
    assert.equal(getSessionVersion('s1'), 1);
  });

  it('stale baseVersion rejects with current state; retry wins', async () => {
    await applyMutation('s1', { itemId, qty: 2, baseVersion: 0, addedBy: 'u1' });

    const loser = await applyMutation('s1', { itemId, qty: 5, baseVersion: 0, addedBy: 'u2' });
    assert.equal(loser.ok, false);
    assert.equal(loser.code, 'VERSION_CONFLICT');
    assert.equal(loser.currentVersion, 1);
    assert.deepEqual(loser.currentState, line('u1', 2));
    assert.equal(getSessionVersion('s1'), 1);

    // Retry creates u2's own line; u1's line stays untouched.
    const retry = await applyMutation('s1', { itemId, qty: 5, baseVersion: loser.currentVersion, addedBy: 'u2' });
    assert.equal(retry.ok, true);
    assert.equal(retry.version, 2);
    assert.deepEqual(getCartState('s1'), { ...line('u1', 2), ...line('u2', 5) });
  });

  it('concurrent same-baseVersion edits: one wins, loser conflicts', async () => {
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
    const winnerUser = a.ok ? 'u1' : 'u2';
    assert.deepEqual(getCartState('s1'), line(winnerUser, winner.delta.qty));
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
    const res = await applyMutation('s1', { itemId: 'nope', qty: 1, baseVersion: 0, addedBy: 'u1' });
    assert.equal(res.ok, false);
    assert.equal(res.code, 'UNKNOWN_ITEM');
    assert.equal(getSessionVersion('s1'), 0);
  });

  it('mutations only touch the caller line; other users cannot delete it', async () => {
    await applyMutation('s1', { itemId, qty: 2, baseVersion: 0, addedBy: 'u1' });
    // u2 "adding" creates a separate line — u1's qty stays 2.
    const edited = await applyMutation('s1', { itemId, qty: 5, baseVersion: 1, addedBy: 'u2' });
    assert.equal(edited.ok, true);
    assert.deepEqual(getCartState('s1'), { ...line('u1', 2), ...line('u2', 5) });
    // u2 remove only clears u2's line.
    const removed = await applyMutation('s1', { itemId, qty: 0, baseVersion: 2, addedBy: 'u2' });
    assert.equal(removed.ok, true);
    assert.deepEqual(getCartState('s1'), line('u1', 2));
  });

  it('re-add after removal uses the new adder as line owner', async () => {
    await applyMutation('s1', { itemId, qty: 2, baseVersion: 0, addedBy: 'u1' });
    await applyMutation('s1', { itemId, qty: 0, baseVersion: 1, addedBy: 'u1' });
    const readded = await applyMutation('s1', { itemId, qty: 1, baseVersion: 2, addedBy: 'u2' });
    assert.equal(readded.ok, true);
    assert.deepEqual(getCartState('s1'), line('u2', 1));
  });

  it('REST state exposes the live versioned cart for baseVersion reads', async () => {
    const { buildServer } = require('../backend/server');
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
      assert.deepEqual(after.json().cart, line('u1', 2));
    } finally {
      await app.close();
      initDb({ dbPath, force: true });
      refreshStockCache();
    }
  });
});
