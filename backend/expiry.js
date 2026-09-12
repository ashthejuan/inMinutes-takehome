/**
 * Phase 4 — Session TTL sweep (PRD §5.3, §7.1, §15 #4).
 *
 * `group_sessions.expires_at = created_at + 24h` is the durable deadline.
 * This module marks past-deadline `active` sessions `expired` in SQLite and
 * drops their ephemeral state (cart + reservations + live ready-gate) so
 * memory never grows unboundedly. SQLite audit rows (sessions, participants,
 * orders) remain for history.
 *
 * ponytail: single-replica in-memory cleanup; external store if scaled out.
 */

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

/** True when the session is past its TTL or already swept. */
function isSessionExpired(session, now = nowSeconds()) {
  if (!session) return false;
  if (session.status === 'expired') return true;
  return Number(session.expires_at) <= now;
}

/**
 * Mark one loaded session row expired when past deadline (opportunistic
 * expiry on REST/socket touch, so clients get SESSION_EXPIRED immediately
 * even between sweep ticks).
 * @returns {boolean} true when the row was transitioned to `expired`.
 */
function expireSessionIfNeeded(database, session) {
  if (!session || session.status !== 'active') return false;
  if (Number(session.expires_at) > nowSeconds()) return false;
  database.prepare("UPDATE group_sessions SET status = 'expired' WHERE id = ?").run(session.id);
  dropEphemeralState(session.id);
  session.status = 'expired';
  return true;
}

/** Drop cart + reservations + live ready-gate for one session. */
function dropEphemeralState(sessionId) {
  require('./participants').removeSession(sessionId);
  require('./cart').removeSessionCart(sessionId);
  require('./stock').removeSession(sessionId);
}

/**
 * Periodic sweep: expire every past-deadline `active` session.
 * @param {{ io?: import('socket.io').Server }} [deps] — when `io` is given,
 *   each expired room gets `session:expired` + `error{SESSION_EXPIRED}`.
 * @returns {string[]} expired session ids.
 */
function sweepExpiredSessions(deps = {}) {
  const { getDb } = require('./db');
  const database = getDb();
  const now = nowSeconds();
  /** @type {{ id: string }[]} */
  const stale = database
    .prepare("SELECT id FROM group_sessions WHERE status = 'active' AND expires_at <= ?")
    .all(now);
  if (stale.length === 0) return [];

  const mark = database.prepare("UPDATE group_sessions SET status = 'expired' WHERE id = ?");
  const ids = [];
  for (const row of stale) {
    mark.run(row.id);
    dropEphemeralState(row.id);
    ids.push(row.id);
    if (deps.io) {
      deps.io.to(row.id).emit('session:expired', { sessionId: row.id, session_id: row.id });
      deps.io
        .to(row.id)
        .emit('error', { code: 'SESSION_EXPIRED', message: 'Session expired' });
    }
  }
  return ids;
}

module.exports = { nowSeconds, isSessionExpired, expireSessionIfNeeded, dropEphemeralState, sweepExpiredSessions };
