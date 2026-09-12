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
      'SELECT id, join_code, host_id, status, expires_at FROM group_sessions WHERE id = ?'
    )
    .get(sessionId);
  if (!session) {
    return { ok: false, code: 'SESSION_NOT_FOUND', message: 'Session not found' };
  }
  // Phase 4: TTL expiry beats every other guard (PRD §15 #4).
  if (session.status === 'expired' || Number(session.expires_at) <= Math.floor(Date.now() / 1000)) {
    if (session.status === 'active') {
      require('./expiry').expireSessionIfNeeded(database, session);
    }
    return { ok: false, code: 'SESSION_EXPIRED', message: 'Session expired' };
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
  const lines = Object.values(cart);
  if (lines.length === 0) {
    return { ok: false, code: 'EMPTY_CART', message: 'Cart is empty' };
  }

  let total = 0;
  for (const line of lines) {
    total += line.price * line.qty;
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
    // Aggregate stock decrements per menu item (multiple lines can share itemId).
    const stockByItem = new Map();
    for (const line of lines) {
      insertItem.run(
        nanoid(12),
        orderId,
        line.itemId,
        line.qty,
        line.price,
        line.addedBy ?? session.host_id
      );
      stockByItem.set(line.itemId, (stockByItem.get(line.itemId) ?? 0) + line.qty);
    }
    for (const [menuItemId, qty] of stockByItem) {
      decStock.run(qty, menuItemId);
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
