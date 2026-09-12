# Phase 4 — Host Transfer, TTL Sweep, Room Management, Error Codes

## Status
Implemented e2e with socket + REST tests. Backend 38 pass
(db 5 + api 6 + stock 8 + cart 10 + realtime 1 + checkout 4 + lifecycle 4);
`flutter analyze` clean on touched files.

## What was built

### Backend
| Path | Role |
|------|------|
| `backend/errors.js` | NEW: single error-code table (`SESSION_EXPIRED`, `SESSION_COMPLETED`, `NOT_IN_SESSION`, plus all Phase 2/3 codes). `emitError(socket, …)` for sockets, `restError(reply, …)` for REST (keeps legacy `error` alias). Every `error` event / 4xx is now `{ code, message, …extra }`. |
| `backend/expiry.js` | NEW: `isSessionExpired`, `expireSessionIfNeeded(db, session)` (opportunistic expiry on any REST/socket touch), `dropEphemeralState` (participants + cart + reservations), `sweepExpiredSessions({io})` (marks past-`expires_at` `active` rows `expired`, clears memory, broadcasts `session:expired` + `error SESSION_EXPIRED` per room). |
| `backend/participants.js` | Added `removeParticipant` (socket leave/disconnect), `getHostId`, `setHost`, `transferHost(sessionId, connectedIds?)` — oldest `joinedAt` among socket-connected users wins; no-op when the host is still connected. |
| `backend/checkout.js` | `performCheckout` now selects `expires_at` and returns `SESSION_EXPIRED` (with opportunistic expiry) before the host/ready/cart guards. |
| `backend/server.js` | Presence tracking `sessionConnections: sessionId → (userId → socket count)` so one user on two devices isn't marked left early. `session:join` leaves any previous room (one active session per socket), checks expiry, tracks presence, acks `hostId`, and broadcasts `participants:sync` + `checkout:available` to the room. NEW `session:leave` (explicit leave + host transfer). `disconnect` → `detachFromSession` → host transfer when the leaver was host. `broadcastHostTransfer` persists `group_sessions.host_id` + `session_participants.is_host` and emits `host:changed { hostId, previousHostId }` (+ aliases) followed by refreshed `participants:sync` / `checkout:available`. All socket handlers + `GET /:id/state` + `POST /join` answer `SESSION_EXPIRED`/`SESSION_COMPLETED` with standard codes. Periodic sweep every 60 s (`SESSION_SWEEP_INTERVAL_MS` override; `{ disableSweep: true }` / `sweepIntervalMs` for tests), cleared on `onClose`, exposed as `app.sweepExpiredSessions()` and `require('./server').sweepExpiredSessions`. |
| `backend/package.json` | `npm test` now includes `tests/session_lifecycle.test.js` (38 total). |

### Frontend
| Path | Role |
|------|------|
| `lib/data/services/session_socket.dart` | Added `onHostChanged`, `onSessionExpired`, and `leave()` (`session:leave` emit). |
| `lib/providers/session_controller.dart` | Subscribes to `checkout:available` (recompute signal), `host:changed` (flips `session.hostId` → `checkoutProvider.isHost` + host badges, surfaces `HOST_TRANSFERRED` notice), `session:expired` (surfaces `SESSION_EXPIRED`). Added `leave()` for the Leave-session menu item. |
| `lib/ui/screens/collaborative_cart_screen.dart` | Leave-session menu now calls `controller.leave()` before `go('/')` so the server transfers host immediately. |

### Tests
`tests/session_lifecycle.test.js` (4 e2e over real sockets): host disconnect → oldest guest promoted, SQLite `host_id`/`is_host` flipped, `host:changed` + badged `participants:sync` received; guest disconnect → `participants:sync` without transfer, host unchanged; explicit `session:leave` by host → transfer; TTL sweep → `expired` status, audit rows kept, REST 410 + socket ack carry `SESSION_EXPIRED`. (`tests/phase4.verify.test.js` holds the same checks from development; the lifecycle file is the permanent suite.)

## Room / event map (PRD §8.2, after Phase 4)
- One Socket.io room per `sessionId`. Join leaves any previous room.
- `cart:sync` on every applied mutation (room broadcast; joiner also gets point-to-point state).
- `participants:sync` + `checkout:available` on join / leave / disconnect / ready toggle / host transfer.
- `host:changed { hostId, previousHostId }` (+ `host_id` aliases) on host leave/disconnect transfer.
- `session:checkout { orderId }` on host checkout; `session:expired { sessionId }` + `error SESSION_EXPIRED` on sweep.
- `error { code, message, … }` codes: `INVALID_PAYLOAD`, `SESSION_NOT_FOUND`, `SESSION_EXPIRED`, `SESSION_COMPLETED`, `VERSION_CONFLICT`, `OUT_OF_STOCK`, `UNKNOWN_ITEM`, `ONLY_HOST_CAN_CHECKOUT`, `NOT_ALL_READY`, `EMPTY_CART`. `HOST_TRANSFERRED` is a client-side notice (from the `host:changed` handler), not a server error.

## How to verify
```bash
cd backend
npm test   # 38 pass
cd ../frontend
flutter analyze lib/data/services/session_socket.dart lib/providers/session_controller.dart lib/ui/screens/collaborative_cart_screen.dart
```

## Deferred / assumptions
- Expiry is deadline-based (`expires_at = created_at + 24h`, PRD §7.1), not 30-min inactivity — no per-socket activity tracking yet; adding `last_activity_at` + idle sweep is the natural follow-up.
- Single replica: presence counts and live views are in-memory (matches PRD §15 #7); Redis presence would be needed for multi-instance.
- A transferred-to host who never REST-joined has no `session_participants` row — `group_sessions.host_id` is still correct and the live view carries the badge; the `is_host` row flip affects 0 rows in that corner.
