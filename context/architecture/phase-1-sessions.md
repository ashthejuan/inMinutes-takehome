# Phase 1 — Session Management (REST only)

## Status
Implemented. REST session lifecycle works end-to-end against SQLite.
Socket.io stays attached as a Phase 0 skeleton (connect/disconnect logging only).
No room join, no `cart:sync` / `participants:sync` broadcasts in this phase —
deferred per `context/build_plan.md`.

## What was built

### `POST /api/sessions` → 201
- Validates optional `display_name` with `zod` (trimmed, 1–50 chars; accepts
  `displayName` / `host_name` aliases, defaults to `'Host'`).
- Generates `id` + `host_id` via `nanoid(12)`, 6-char uppercase join code via
  `customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6)` with DB uniqueness loop.
- Inserts `group_sessions(id, join_code, host_id, status='active',
  created_at=unix-sec, expires_at=created_at+TTL)` (sliding 30-min idle since
  the touch update — was fixed `+24h` in Phase 1; see `session-ttl-touch.md`)
  plus host
  `session_participants(session_id, user_id=host_id, is_host=1,
  joined_at=Date.now())` in one SQLite transaction.
- Returns `{ id, join_code, status, created_at, expires_at, host_id }` plus
  PRD §11 aliases `{ sessionId, joinCode, hostId }`.

### `POST /api/sessions/join` → 200
- Accepts `{ join_code, display_name }` (aliases `joinCode`, `displayName`/`name`).
- Normalizes code with `trim().toUpperCase()`; `zod` requires non-empty code.
- `404 { error: 'Invalid join code' }` when unknown.
- `410 { error: 'Session expired' }` when `status != 'active'` or
  `expires_at <= now`.
- Inserts `session_participants(..., is_host=0)` with `user_id=nanoid(12)` and
  `display_name` or `Guest-XXXX` placeholder.
- Returns `{ session_id, user_id, display_name, is_host: 0, join_code }` plus
  `{ sessionId, userId, isHost: false }`.

### `GET /api/sessions/:id/state` → 200
- Looks up by session `id` first, then by uppercased `join_code` (convenience for
  Flutter which navigates with the code).
- `404` when neither matches; `400` on empty id.
- Returns `{ session, participants (joined_at ASC), orders (created_at ASC),
  cart: {}, version: 0 }`. Cart/version are placeholders — ephemeral in-memory
  cart + optimistic locking land in Phase 2 with socket rooms.

### Validation / security
- All inputs via `zod` + explicit normalization; `400` with flattened details.
- All SQL via `better-sqlite3` prepared statements (no string interpolation).
- Join-code alphabet excludes `0/O/1/I` to avoid transcription errors.
- No auth (per PRD assumption); join code is the only capability.

## Files touched
| Path | Role |
|------|------|
| `backend/server.js` | Session routes, zod validation, join-code gen, state query |
| `tests/api.test.js` | Replaced 501 stub test with create/join/state coverage |
| `context/architecture/phase-1-sessions.md` | This file |

## How to verify
```bash
cd backend
npm test   # 11 pass (db 5 + api 6)
```

## Deferred
- Socket.io rooms, `cart:sync` / `participants:sync` etc. — landed in later
  phases; Flutter create/join entry is documented in
  `context/architecture/flutter-session-entry.md`.
- Stock reservation mutex, version-conflict retry (Phase 2).
- Ready gate, host-only checkout, order persistence (Phase 3).
- Session TTL sweep / host transfer (Phase 4).
