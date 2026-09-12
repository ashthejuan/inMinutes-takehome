# Session TTL: sliding 30-min idle expiry (FR-13)

## Status
Implemented — replaced the fixed `created_at + 24h` deadline. Backend 39 pass.

## Problem
PRD FR-13 (and `build_plan.md`) specified "session expiry after 30 min
inactivity", but `expiry.js` / `server.js` implemented a fixed 24-hour deadline
from creation (`SESSION_TTL_SECONDS = 24 * 60 * 60`, never bumped). A session
left idle for 30 minutes would NOT expire — failing the spec's own test.

## What changed
`expires_at` is now a sliding deadline: `last_activity + 30 min`.
- `backend/expiry.js`: canonical `SESSION_TTL_SECONDS` (default 1800,
  `SESSION_TTL_SECONDS` env-overridable) + `touchSession(db, session)` which
  sets `expires_at = now + TTL`. Called only AFTER the expiry check passes, so
  touches never resurrect dead sessions; also mutates the passed row so callers
  see the fresh deadline.
- `backend/server.js`: imports TTL from `./expiry` (single source of truth);
  touches on real activity only —
  - `POST /api/sessions/join` (join),
  - socket `session:join` (room join),
  - `cart:add` / `cart:updateQty` / `cart:remove` attempts on live sessions
    (pass or fail — the user is clearly present),
  - `user:ready` toggles.
  - Read-only `GET /api/sessions/:id/state` deliberately does NOT touch, so
    polling can't keep a dead session alive. `session:leave` / disconnect do
    not touch either (leaving shouldn't extend life).
- `backend/package.json`: test script now includes the new TTL test.
- Docs: `context/PRD.md` (FR-13, §7.1 schema comment, §15 #4),
  `context/build_plan.md` (Phase 3 note, Phase 4 section, assumptions, success
  criteria), `phase-4-host-transfer-ttl.md`, `phase-1-sessions.md` pointer.

## Why this shape
- **No migration:** reuses the existing `expires_at` column as the sliding
  deadline instead of adding `last_activity_at` — one UPDATE per activity,
  sweep + opportunistic-expiry paths untouched.
- **Reads don't count:** counting polls as activity would let an open-but-
  abandoned tab hold a session forever; only presence/mutation does.
- **Touch-after-expiry-check ordering** in every handler guarantees an expired
  session stays expired even under raced requests.

## Files
| Path | Role |
|------|------|
| `backend/expiry.js` | `SESSION_TTL_SECONDS`, `touchSession` (new) |
| `backend/server.js` | TTL import + 4 touch call-sites + read-no-touch note |
| `backend/package.json` | Test script += `session_ttl_touch.test.js` |
| `tests/session_ttl_touch.test.js` | Idle-touch e2e (new) |
| `context/PRD.md` | FR-13 / §7.1 / §15 #4 sliding-idle wording |
| `context/build_plan.md` | Expiry section + assumptions + success row |
| `context/architecture/phase-4-host-transfer-ttl.md` | Owner doc updated (39 pass) |
| `context/architecture/phase-1-sessions.md` | Supersede pointer |

## How to verify
```bash
cd backend
npm test   # 39 pass (ttl-touch: join + cart:add slide deadline, GET state doesn't, idle 410s)
```
Manual spec test: create session → idle 30 min with zero joins/mutations/ready
toggles → sweep or any touch returns `SESSION_EXPIRED`, memory cleared, SQLite
audit rows remain.
