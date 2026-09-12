/**
 * Phase 3 — Live ready-gate state (PRD §5.3 #5, §8).
 *
 * SQLite `session_participants` is the audit log (who joined, who is host).
 * This module is the ephemeral live view: `userId -> { name, ready, isHost,
 * joinedAt }` per session. `ready` lives ONLY here (no DB column) and is
 * seeded `false` for every participant known from the DB.
 *
 * Note: single-replica in-memory map; external store if scaled out.
 */

/** @type {Map<string, Map<string, { name: string, ready: boolean, isHost: boolean, joinedAt: number }>>} */
const liveParticipants = new Map();

function getSessionMap(sessionId) {
  let perSession = liveParticipants.get(sessionId);
  if (!perSession) {
    perSession = new Map();
    liveParticipants.set(sessionId, perSession);
  }
  return perSession;
}

/** Seed live view from SQLite audit rows when the room is first touched. */
function seedFromDb(sessionId) {
  let perSession = liveParticipants.get(sessionId);
  if (perSession && perSession.size > 0) return perSession;
  perSession = getSessionMap(sessionId);
  try {
    const { getDb } = require('./db');
    const session = getDb()
      .prepare('SELECT host_id FROM group_sessions WHERE id = ?')
      .get(sessionId);
    if (!session) return perSession;
    const rows = getDb()
      .prepare(
        `SELECT user_id, display_name, is_host, joined_at
         FROM session_participants WHERE session_id = ? ORDER BY joined_at ASC`
      )
      .all(sessionId);
    for (const row of rows) {
      if (!perSession.has(row.user_id)) {
        perSession.set(row.user_id, {
          name: row.display_name,
          ready: false,
          isHost: row.is_host === 1 || row.user_id === session.host_id,
          joinedAt: row.joined_at,
        });
      }
    }
  } catch {
    // DB not ready or session unknown — callers fall back to ephemeral entries.
  }
  return perSession;
}

function ensureParticipant(sessionId, userId, info = {}) {
  const perSession = seedFromDb(sessionId);
  const existing = perSession.get(userId);
  if (existing) {
    if (info.name) existing.name = info.name;
    if (info.isHost !== undefined) existing.isHost = Boolean(info.isHost);
    return existing;
  }
  const entry = {
    name: info.name ?? userId,
    ready: false,
    isHost: Boolean(info.isHost),
    joinedAt: info.joinedAt ?? Date.now(),
  };
  perSession.set(userId, entry);
  return entry;
}

function setReady(sessionId, userId, ready) {
  const perSession = seedFromDb(sessionId);
  let entry = perSession.get(userId);
  if (!entry) {
    entry = ensureParticipant(sessionId, userId, {});
  }
  entry.ready = Boolean(ready);
  return entry;
}

function getParticipants(sessionId) {
  const perSession = seedFromDb(sessionId);
  return [...perSession.entries()]
    .map(([userId, p]) => ({
      userId,
      user_id: userId,
      name: p.name,
      display_name: p.name,
      ready: p.ready,
      isHost: p.isHost,
      is_host: p.isHost ? 1 : 0,
      joinedAt: p.joinedAt,
      joined_at: p.joinedAt,
    }))
    .sort((a, b) => a.joinedAt - b.joinedAt);
}

function isAllReady(sessionId) {
  const perSession = seedFromDb(sessionId);
  if (perSession.size === 0) return false;
  for (const p of perSession.values()) {
    if (!p.ready) return false;
  }
  return true;
}

function notReadyList(sessionId) {
  const perSession = seedFromDb(sessionId);
  return [...perSession.entries()]
    .filter(([, p]) => !p.ready)
    .map(([userId, p]) => ({ userId, name: p.name }));
}

/** Drop one session's live view (checkout / TTL expiry). */
function removeSession(sessionId) {
  liveParticipants.delete(sessionId);
}

/** Drop all live views (tests / server boot). */
function clearAll() {
  liveParticipants.clear();
}

/**
 * Phase 4 — remove one participant's live entry (socket leave/disconnect).
 * @returns the removed entry, or null when absent.
 */
function removeParticipant(sessionId, userId) {
  const perSession = liveParticipants.get(sessionId);
  if (!perSession) return null;
  const entry = perSession.get(userId) ?? null;
  if (entry) perSession.delete(userId);
  return entry;
}

/** Current host's userId from the live view (null when none). */
function getHostId(sessionId) {
  const perSession = liveParticipants.get(sessionId);
  if (!perSession) return null;
  for (const [userId, p] of perSession) {
    if (p.isHost) return userId;
  }
  return null;
}

/**
 * Phase 4 — set a new host in the live view (demotes the previous host).
 * @returns {{ oldHostId: string | null, hostId: string | null }}
 */
function setHost(sessionId, newHostId) {
  const perSession = seedFromDb(sessionId);
  let oldHostId = null;
  for (const [userId, p] of perSession) {
    if (p.isHost) oldHostId = userId;
    p.isHost = userId === newHostId;
  }
  const entry = perSession.get(newHostId);
  if (!entry) return { oldHostId, hostId: null };
  return { oldHostId, hostId: newHostId };
}

/**
 * Phase 4 — host transfer on disconnect (PRD §5.3 #6, FR-10).
 * Oldest (earliest `joinedAt`) remaining participant becomes host.
 * @param {string} sessionId
 * @param {Iterable<string>} [connectedIds] — when given, only these users
 *   are eligible (socket-connected set); otherwise every live participant.
 * @returns {{ transferred: boolean, hostId: string | null, previousHostId: string | null }}
 */
function transferHost(sessionId, connectedIds) {
  const perSession = seedFromDb(sessionId);
  const connected = connectedIds ? new Set(connectedIds) : null;

  let currentHostId = null;
  for (const [userId, p] of perSession) {
    if (p.isHost) {
      currentHostId = userId;
      break;
    }
  }
  // Current host still present (and still connected) — nothing to do.
  if (currentHostId && perSession.has(currentHostId) && (!connected || connected.has(currentHostId))) {
    return { transferred: false, hostId: currentHostId, previousHostId: null };
  }

  const candidates = [...perSession.entries()]
    .filter(([userId]) => userId !== currentHostId && (!connected || connected.has(userId)))
    .sort((a, b) => a[1].joinedAt - b[1].joinedAt);
  if (candidates.length === 0) {
    return { transferred: false, hostId: null, previousHostId: currentHostId };
  }
  const [newHostId] = candidates[0];
  for (const [userId, p] of perSession) {
    p.isHost = userId === newHostId;
  }
  return { transferred: true, hostId: newHostId, previousHostId: currentHostId };
}

module.exports = {
  ensureParticipant,
  setReady,
  getParticipants,
  isAllReady,
  notReadyList,
  removeSession,
  clearAll,
  removeParticipant,
  getHostId,
  setHost,
  transferHost,
};
