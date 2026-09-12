# Flutter session create / join wiring

## Status
Implemented. Host **Start Group Order** and guest **Join session** call the
Phase 1 REST endpoints, store identity in `sessionProvider`, open the Socket.io
room, and navigate to `/group/:sessionId`.

## What was built

### `ApiClient`
- `POST /api/sessions` via `createSession({ displayName? })` → 201 map with
  `sessionId` / `joinCode` / `hostId` (snake_case aliases accepted).
- `POST /api/sessions/join` via `joinSession({ joinCode, displayName })` → 200
  map with `sessionId` / `userId` / `displayName` / `joinCode`.
- Error bodies surface `message` or `error` when present.

### `SessionController.enterSession`
- Writes `SessionState`, clears group cart, seeds a local participant row,
  then `SessionSocket.connect()` + `join(sessionId, userId)`.
- `leave()` now also disconnects and clears session / participants / cart.
- `participants:sync` updates `session.hostId` from the host row (join REST
  does not return `hostId`).

### `SessionSocket`
- Handlers are stored and re-attached on `connect()` so Riverpod init (before
  the socket exists) still receives `cart:sync` / `participants:sync` / etc.
- `join` waits for the `connect` event when the socket is not yet up.
- Reconnect rejoin: `join()` stores identity, `disconnect()` clears it, and a
  persistent `on('reconnect')` re-emits `session:join` (server replays full
  state; offline-buffered mutations self-heal via `VERSION_CONFLICT` retry).
  Only `reconnect` is handled — exactly one join per connection epoch, which
  keeps the server's per-user socket count accurate. See
  `socket-reconnect-rejoin.md`.
- Uses `disableAutoConnect` + explicit `connect()`.

### UI
- `MenuScreen`: **Start Group Order** → display-name dialog → create → enter →
  `/group/:sessionId` (loading disable on the button).
- `JoinGroupScreen`: real join API (no more placeholder navigation by code).
- Collaborative cart header shows `Code {joinCode}` when available so the host
  can share it.

## Files touched
| Path | Role |
|------|------|
| `frontend/lib/data/services/api_client.dart` | create/join REST |
| `frontend/lib/data/services/session_socket.dart` | handler rebind + deferred join |
| `frontend/lib/providers/session_controller.dart` | `enterSession` / leave cleanup |
| `frontend/lib/providers/session_provider.dart` | comment |
| `frontend/lib/ui/screens/menu_screen.dart` | Start Group Order wired |
| `frontend/lib/ui/screens/join_group_screen.dart` | Join API wired |
| `frontend/lib/ui/screens/collaborative_cart_screen.dart` | show join code |
| `context/architecture/flutter-session-entry.md` | This file |

## How to verify
1. Backend running (`npm start` in `backend`).
2. Flutter app → Normal Order → **Start Group Order** → lands on group cart
   with a 6-char code in the header.
3. Second client → Join Group Order → enter that code + name → same session.
4. `flutter analyze` on the touched files: clean.

## Deferred
- Deep-link / cold-start rejoin from a stored session id.
