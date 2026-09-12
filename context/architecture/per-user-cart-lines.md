# Per-user cart lines (ownership)

## Status
Implemented (plus Flutter-web version parse fix).

## What changed
Group cart lines are keyed by `itemId:addedBy` instead of `itemId` alone.
Each participant owns their own line for a menu item:

- Host adds burger → line `burger:host` qty 1
- User 2 increments the same menu item → new line `burger:user2` qty 1
  (host's line is untouched)
- User 2 cannot delete or change the host's line; qty steppers only appear
  on lines where `addedBy === me`

This replaces the old PRD rule that `addedBy` was display-only and anyone
could edit any line.

## Follow-up fix (menu Add no-op for user 2)
On Flutter web, Socket.io often delivers `version` as a `double`. The client
used `version is int`, so `baseVersion` never advanced after `cart:sync`.
User 2's Add then always hit `VERSION_CONFLICT` and never landed a new line.
Fixed by parsing versions with `num.toInt()`, and only retrying conflict
once. Restart the Node server after pulling cart ownership changes (in-memory
module is loaded at process start).

## Backend
- `backend/cart.js`: Map key = `` `${itemId}:${addedBy}` ``; snapshot values
  include `itemId` + `addedBy`; `addedBy` is required on every mutation.
- `backend/server.js`: mutations prefer `socket.data.userId` so clients cannot
  spoof another participant's line key.
- `backend/checkout.js`: iterates `Object.values(cart)` (multiple lines per
  menu item); aggregates stock decrements by `itemId`.

## Frontend
- `CartLine.lineKey`; `groupCartProvider` keyed by lineKey.
- Group cart: stepper only when line is mine; others show static `× qty`.
- Menu (in session): stepper mutates **my** qty only; other participants'
  contributions listed as `Added by X (quantity N)`.

## Files
| Path | Role |
|------|------|
| `backend/cart.js` | Per-user line keys + owner-scoped mutate |
| `backend/server.js` | Socket identity → addedBy |
| `backend/checkout.js` | Multi-line checkout / stock aggregate |
| `frontend/lib/providers/cart_provider.dart` | `lineKey` on `CartLine` |
| `frontend/lib/providers/session_controller.dart` | Parse keyed cart sync |
| `frontend/lib/ui/screens/collaborative_cart_screen.dart` | Owner-only steppers |
| `frontend/lib/ui/screens/menu_screen.dart` | Split attribution + my qty |
| `tests/cart.test.js` | Ownership + dual-line assertions |
| `tests/realtime.test.js` | Dual lines after conflict retry |

## How to verify
```bash
cd backend && npm test
# Two devices in one group: host adds item → guest cannot remove it.
# Guest + on same item → two cart/menu lines with separate attribution.
```
