# Socket reconnect rejoin (Flutter)

## Status
Implemented + verified (`flutter analyze` clean; server rejoin contract proven
against a live backend — full cart replay on re-`session:join`).

## Problem
`SessionSocket.connect()` ran once and never listened for Socket.io's
`reconnect`. On phone lock, WiFi drop, or backgrounding — near-certain during
physical multi-device testing — the transport auto-reconnects as a NEW
server-side socket with no room membership, and the client never re-emitted
`session:join`. That device silently fell out of sync (no cart/participants
updates) until the user manually re-navigated.

## What changed
- `frontend/lib/data/services/session_socket.dart`
  - `join()` stores `_lastSessionId` / `_lastUserId`; `disconnect()` clears
    them (a post-leave reconnect never rejoins).
  - `connect()` attaches a persistent `on('reconnect')` → `_rejoinIfNeeded()`
    + `onReconnected` callback. Only `reconnect` is handled, not `connect`:
    the initial join goes through `join()`'s `once('connect')`, and
    `reconnect` never fires on first connect — exactly one `session:join` per
    connection epoch. (Two joins from one socket would inflate the server's
    per-user socket count and break host-transfer presence.)
  - Rejoin needs no extra sync: the server answers `session:join` with full
    `cart:sync` + `participants:sync` + `checkout:available`, and the existing
    replace-state handlers apply them. Mutations flushed from the offline
    buffer carry a stale `baseVersion` and self-heal via `VERSION_CONFLICT`
    merge + single retry.
- `frontend/lib/providers/session_controller.dart` — `onReconnected` surfaces
  `RECONNECTED: Back online — cart re-synced` through the existing SnackBar
  path (`onErrorMessage`).

## Files
| Path | Role |
|------|------|
| `frontend/lib/data/services/session_socket.dart` | Stored identity + reconnect rejoin |
| `frontend/lib/providers/session_controller.dart` | Reconnect notice |
| `context/PRD.md` | §8.4 reconnect/rejoin note |

## How to verify
```bash
cd frontend
flutter analyze lib/data/services/session_socket.dart lib/providers/session_controller.dart  # clean
```
Physical test: two devices in one group → lock one phone 30 s (or toggle
WiFi) → unlock → it shows `RECONNECTED` and current cart without navigating.
Server-side contract (throwaway script, since removed): join → transport drop
→ reconnect → re-`session:join` → ack cart contains the pre-drop lines,
`cart:sync` broadcast fires, presence count stays at one.
