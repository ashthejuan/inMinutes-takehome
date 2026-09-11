/**
 * Phase 3 — Host-only checkout with all-ready gate + order persistence
 * (PRD §5.3 #4/#5, §7.1, §11).
 *
 * Guards (in order): session exists → caller is host → all ready →
 * cart non-empty. On success a single SQLite transaction persists the
 * order + items (with `added_by` attribution), decrements menu stock,
 * and marks the session completed; then in-memory cart / reservations /
 * live-ready state are dropped and the stock cache is refreshed.
 */

const { nanoid } = require('nanoid');
const { getDb } = require('./db');
const { getCartState, removeSessionCart } = require('./cart');
const { removeSession: removeStockSession, refreshStockCache } = require('./stock');
const participants = require('./participants');

function performCheckout(sessionId, callerUserId) {
  const database = getDb();
  const session = database
    .prepare(
      'SELECT id, join_code, host_id, status FROM group_sessions WHERE id = ?'
    )
    .get(sessionId);
  if (!session) {
    return { ok: false, code: 'SESSION_NOT_FOUND', message: 'Session not found' };
  }
  if (session.status !== 'active') {
    return { ok: false, code: 'SESSION_COMPLETED', message: 'Session already checked out' };
  }
  if (!callerUserId || callerUserId !== session.host_id) {
    return {
      ok: false,
      code: 'ONLY_HOST_CAN_CHECKOUT',
      message: 'Only the host can place the order',
    };
  }

  // Seed live view from the SQLite audit so REST-joined users count.
  participants.ensureParticipant(sessionId, session.host_id, { isHost: true });
  const notReady = participants.notReadyList(sessionId);
  if (notReady.length > 0) {
    return {
      ok: false,
      code: 'NOT_ALL_READY',
      message: 'Waiting for participants to mark Ready',
      notReady,
    };
  }

  const cart = getCartState(sessionId);
  const itemIds = Object.keys(cart);
  if (itemIds.length === 0) {
    return { ok: false, code: 'EMPTY_CART', message: 'Cart is empty' };
  }

  let total = 0;
  for (const itemId of itemIds) {
    total += cart[itemId].price * cart[itemId].qty;
  }

  const orderId = nanoid(12);
  const createdAt = Date.now();
  const persist = database.transaction(() => {
    database
      .prepare(
        `INSERT INTO orders (id, session_id, total_paise, status, created_at)
         VALUES (?, ?, ?, 'placed', ?)`
      )
      .run(orderId, sessionId, total, createdAt);
    const insertItem = database.prepare(
      `INSERT INTO order_items (id, order_id, menu_item_id, qty, price_paise, added_by)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    const decStock = database.prepare(
      'UPDATE menu_items SET stock = stock - ? WHERE id = ?'
    );
    for (const itemId of itemIds) {
      const line = cart[itemId];
      insertItem.run(
        nanoid(12),
        orderId,
        itemId,
        line.qty,
        line.price,
        line.addedBy ?? session.host_id
      );
      decStock.run(line.qty, itemId);
    }
    database
      .prepare("UPDATE group_sessions SET status = 'completed' WHERE id = ?")
      .run(sessionId);
  });
  persist();

  removeSessionCart(sessionId);
  removeStockSession(sessionId);
  participants.removeSession(sessionId);
  refreshStockCache();

  return { ok: true, orderId, order_id: orderId, total_paise: total, total };
}

module.exports = { performCheckout };
