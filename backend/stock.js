/**
 * Phase 2 — Atomic stock reservation (PRD §9).
 *
 * Single-process in-memory state:
 * - `menu:stock:{itemId}` cache loaded from SQLite (`menu_items.stock`).
 * - Per-session reservations: `session:{id}:stock:reserved:{itemId}` -> qty.
 * - Per-session + per-item mutex: serializes concurrent `reserveStock`
 *   calls on the same itemId within a session (promise-chain tail).
 *
 * Invariant (PRD §5.3 #2): `available = totalStock - Σreservations`
 * where Σ spans ALL sessions (global stock shared across sessions).
 *
 * ponytail: single-replica in-memory lock; Redis + Lua if horizontally scaled.
 */

const STOCK_CACHE_PREFIX = 'menu:stock:';
const RESERVED_PREFIX = 'session:';

/** @type {Map<string, number>} `menu:stock:{itemId}` -> total stock */
const menuStockCache = new Map();

/** @type {Map<string, number>} `session:{id}:stock:reserved:{itemId}` -> qty */
const sessionStockReserved = new Map();

/**
 * Per-session + per-item mutex tails.
 * @type {Map<string, Map<string, Promise<void>>>} sessionId -> (itemId -> tail)
 */
const sessionReservationQueues = new Map();

function stockCacheKey(itemId) {
  return `${STOCK_CACHE_PREFIX}${itemId}`;
}

function reservedKey(sessionId, itemId) {
  return `${RESERVED_PREFIX}${sessionId}:stock:reserved:${itemId}`;
}

function isValidQty(qty) {
  return Number.isInteger(qty) && qty > 0;
}

/**
 * Load/refresh the `menu:stock:{itemId}` cache from SQLite.
 * Pass rows explicitly (tests) or falls back to `getDb()` (server boot).
 * @param {{ id: string, stock: number }[]} [rows]
 */
function refreshStockCache(rows) {
  const items = Array.isArray(rows)
    ? rows
    : // Lazy require to avoid a db.js <-> stock.js cycle at load time.
      require('./db').getMenuItems();
  menuStockCache.clear();
  for (const item of items) {
    if (item && typeof item.id === 'string' && Number.isFinite(item.stock)) {
      menuStockCache.set(stockCacheKey(item.id), Math.max(0, Math.floor(item.stock)));
    }
  }
  return menuStockCache.size;
}

/** For tests / debug: seed one cache entry without touching SQLite. */
function setCachedStock(itemId, stock) {
  menuStockCache.set(stockCacheKey(itemId), Math.max(0, Math.floor(stock)));
}

function getCachedStock(itemId) {
  return menuStockCache.get(stockCacheKey(itemId)) ?? 0;
}

function getReserved(sessionId, itemId) {
  return sessionStockReserved.get(reservedKey(sessionId, itemId)) ?? 0;
}

/** Total reserved across ALL sessions for one item (global oversell guard). */
function totalReservedForItem(itemId) {
  const suffix = `:stock:reserved:${itemId}`;
  let total = 0;
  for (const [key, qty] of sessionStockReserved) {
    if (key.endsWith(suffix)) total += qty;
  }
  return total;
}

function getAvailable(itemId) {
  return Math.max(0, getCachedStock(itemId) - totalReservedForItem(itemId));
}

/**
 * Run `fn` holding the per-(sessionId, itemId) mutex.
 * Chain tails so concurrent mutations on the same itemId within a
 * session execute one at a time, in call order.
 */
async function withItemLock(sessionId, itemId, fn) {
  let perSession = sessionReservationQueues.get(sessionId);
  if (!perSession) {
    perSession = new Map();
    sessionReservationQueues.set(sessionId, perSession);
  }
  const previous = perSession.get(itemId) ?? Promise.resolve();
  let releaseTail;
  const tail = new Promise((resolve) => {
    releaseTail = resolve;
  });
  perSession.set(itemId, tail);
  // A rejected predecessor must not break the chain.
  await previous.catch(() => {});
  try {
    return await fn();
  } finally {
    releaseTail();
  }
}

/**
 * Atomically reserve `qty` units of `itemId` for `sessionId`.
 * @returns {Promise<{ ok: boolean, available: number }>}
 * `available` is the global free count AFTER this call on success,
 * or the current free count on failure.
 */
async function reserveStock(sessionId, itemId, qty) {
  if (!sessionId || !itemId || !isValidQty(qty)) {
    return { ok: false, available: getAvailable(itemId) };
  }
  return withItemLock(sessionId, itemId, () => {
    const free = getCachedStock(itemId) - totalReservedForItem(itemId);
    if (free >= qty) {
      const key = reservedKey(sessionId, itemId);
      sessionStockReserved.set(key, (sessionStockReserved.get(key) ?? 0) + qty);
      return { ok: true, available: free - qty };
    }
    return { ok: false, available: Math.max(0, free) };
  });
}

/**
 * Release a prior reservation (cart remove / qty decrease).
 * Clamped at 0; safe to call with more than reserved.
 */
async function releaseStock(sessionId, itemId, qty) {
  if (!sessionId || !itemId || !isValidQty(qty)) return;
  await withItemLock(sessionId, itemId, () => {
    const key = reservedKey(sessionId, itemId);
    const current = sessionStockReserved.get(key) ?? 0;
    const next = current - qty;
    if (next <= 0) sessionStockReserved.delete(key);
    else sessionStockReserved.set(key, next);
  });
}

/** Drop all in-memory reservation + lock state (tests / session cleanup). */
function clearStockState() {
  sessionStockReserved.clear();
  sessionReservationQueues.clear();
}

/** Drop one session's reservations + queues (checkout / TTL expiry). */
function removeSession(sessionId) {
  const prefix = `${RESERVED_PREFIX}${sessionId}:`;
  for (const key of [...sessionStockReserved.keys()]) {
    if (key.startsWith(prefix)) sessionStockReserved.delete(key);
  }
  sessionReservationQueues.delete(sessionId);
}

module.exports = {
  reserveStock,
  releaseStock,
  refreshStockCache,
  setCachedStock,
  getCachedStock,
  getReserved,
  getAvailable,
  totalReservedForItem,
  clearStockState,
  removeSession,
  // Exposed for tests only.
  __internals: { menuStockCache, sessionStockReserved, sessionReservationQueues },
};
