/**
 * Phase 2 — Optimistic concurrency control (PRD §10) + cart state (PRD §7.2).
 *
 * Single-process in-memory state per session:
 * - `session:{id}:cart`    Map lineKey → { itemId, qty, addedBy, price }
 *   lineKey = `${itemId}:${addedBy}` — each participant owns their own line
 *   for a menu item (so user2 +1 creates a second line, not edits user1's).
 * - `session:{id}:version` monotonic counter, starts at 0
 *
 * Mutation protocol:
 * 1. Client sends `baseVersion` read with its last `cart:sync` (or REST state).
 * 2. Match    → apply (+ stock reserve/release), INCR version, caller broadcasts
 *               `cart:sync { version, cart, delta }`.
 * 3. Mismatch → reject `{ ok: false, code: 'VERSION_CONFLICT', currentVersion,
 *               currentState }`; client merges `currentState` and retries.
 *
 * Ownership: mutations always target the caller's own line (`addedBy` required).
 * A participant cannot delete or change another participant's qty.
 *
 * A per-session promise-chain mutex serializes check-apply-INCR so two
 * concurrent same-`baseVersion` mutations can't both win (last writer wins,
 * loser gets VERSION_CONFLICT). Stock moves run under stock.js's own
 * per-(session,item) lock; lock order is always session → item.
 *
 * Note: single-replica in-memory state; external store if scaled out.
 */

const { reserveStock, releaseStock } = require('./stock');

/**
 * @typedef {{ itemId: string, qty: number, addedBy: string, price: number }} CartLine
 * @typedef {{ version: number, cart: Map<string, CartLine> }} SessionCart
 */

/** @type {Map<string, SessionCart>} */
const sessionCarts = new Map();

/** @type {Map<string, Promise<void>>} sessionId -> mutex tail */
const sessionLocks = new Map();

function lineKey(itemId, addedBy) {
  return `${itemId}:${addedBy}`;
}

function getEntry(sessionId) {
  let entry = sessionCarts.get(sessionId);
  if (!entry) {
    entry = { version: 0, cart: new Map() };
    sessionCarts.set(sessionId, entry);
  }
  return entry;
}

async function withSessionLock(sessionId, fn) {
  const previous = sessionLocks.get(sessionId) ?? Promise.resolve();
  let releaseTail;
  const tail = new Promise((resolve) => {
    releaseTail = resolve;
  });
  sessionLocks.set(sessionId, tail);
  await previous.catch(() => {});
  try {
    return await fn();
  } finally {
    releaseTail();
  }
}

/** Price + existence check against SQLite (trust boundary). */
function lookupMenuItem(itemId) {
  // Lazy require to avoid a db.js <-> cart.js cycle at load time.
  const { getDb } = require('./db');
  return getDb()
    .prepare('SELECT id, price_paise FROM menu_items WHERE id = ?')
    .get(itemId);
}

/** Plain-object snapshot: `{ [lineKey]: { itemId, qty, addedBy, price } }`. */
function snapshot(cart) {
  const out = {};
  for (const [key, line] of cart) {
    out[key] = {
      itemId: line.itemId,
      qty: line.qty,
      addedBy: line.addedBy,
      price: line.price,
    };
  }
  return out;
}

function getSessionVersion(sessionId) {
  return sessionCarts.get(sessionId)?.version ?? 0;
}

function getCartState(sessionId) {
  const entry = sessionCarts.get(sessionId);
  return entry ? snapshot(entry.cart) : {};
}

/**
 * Apply a set-qty mutation (`cart:add` / `cart:updateQty` / `cart:remove`).
 * Always mutates the caller's own line for `itemId` (keyed by addedBy).
 * @param {string} sessionId
 * @param {{ itemId: string, qty: number, baseVersion: number, addedBy?: string | null }} mutation
 */
async function applyMutation(sessionId, mutation) {
  const { itemId, qty, baseVersion } = mutation ?? {};
  const addedBy = typeof mutation?.addedBy === 'string' ? mutation.addedBy.trim() : '';
  if (
    !sessionId ||
    !itemId ||
    !addedBy ||
    !Number.isInteger(qty) ||
    qty < 0 ||
    !Number.isInteger(baseVersion) ||
    baseVersion < 0
  ) {
    return {
      ok: false,
      code: 'INVALID_PAYLOAD',
      message: 'itemId, qty (≥ 0), baseVersion (≥ 0) and addedBy are required',
      currentVersion: getSessionVersion(sessionId),
      currentState: getCartState(sessionId),
    };
  }

  return withSessionLock(sessionId, async () => {
    const entry = getEntry(sessionId);

    if (baseVersion !== entry.version) {
      return {
        ok: false,
        code: 'VERSION_CONFLICT',
        message: 'Stale baseVersion — merge currentState and retry',
        currentVersion: entry.version,
        currentState: snapshot(entry.cart),
      };
    }

    const menuItem = lookupMenuItem(itemId);
    if (!menuItem) {
      return {
        ok: false,
        code: 'UNKNOWN_ITEM',
        message: 'Unknown menu item',
        currentVersion: entry.version,
        currentState: snapshot(entry.cart),
      };
    }

    const key = lineKey(itemId, addedBy);
    const oldQty = entry.cart.get(key)?.qty ?? 0;
    const delta = qty - oldQty;

    if (delta > 0) {
      const reserved = await reserveStock(sessionId, itemId, delta);
      if (!reserved.ok) {
        return {
          ok: false,
          code: 'OUT_OF_STOCK',
          message: 'Insufficient stock',
          available: reserved.available,
          currentVersion: entry.version,
          currentState: snapshot(entry.cart),
        };
      }
    }

    if (qty === 0) {
      entry.cart.delete(key);
    } else {
      entry.cart.set(key, {
        itemId,
        qty,
        addedBy,
        price: menuItem.price_paise,
      });
    }
    entry.version += 1;

    if (delta < 0) {
      await releaseStock(sessionId, itemId, -delta);
    }

    return {
      ok: true,
      version: entry.version,
      cart: snapshot(entry.cart),
      delta: { itemId, qty, addedBy, lineKey: key },
    };
  });
}

/** Drop all cart + lock state (tests only). */
function clearCartState() {
  sessionCarts.clear();
  sessionLocks.clear();
}

/** Drop one session's cart + lock (checkout / TTL expiry). */
function removeSessionCart(sessionId) {
  sessionCarts.delete(sessionId);
  sessionLocks.delete(sessionId);
}

module.exports = {
  lineKey,
  getSessionVersion,
  getCartState,
  applyMutation,
  clearCartState,
  removeSessionCart,
};
