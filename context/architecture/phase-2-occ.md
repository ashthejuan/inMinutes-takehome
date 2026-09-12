# Phase 2 — Optimistic Concurrency Control (Version Vectors)

## Status
Implemented end-to-end (backend enforce + Flutter merge/retry).

## What was built
- `backend/cart.js` (new): per-session `{ version, cart }` with a
  per-session promise-chain mutex serializing check-apply-INCR.
  `applyMutation(sessionId, { itemId, qty, baseVersion, addedBy })`:
  - `baseVersion` match → stock reserve/release via `stock.js`, apply,
    `version++`, returns `{ ok, version, cart, delta }`.
  - mismatch → `{ ok: false, code: 'VERSION_CONFLICT', currentVersion,
    currentState }`; state untouched. Also `OUT_OF_STOCK` (+ `available`),
    `UNKNOWN_ITEM` (SQLite existence/price check), `INVALID_PAYLOAD`.
  - `addedBy` is required; each participant owns
    `` `${itemId}:${addedBy}` `` (others cannot edit/remove that line).
    Price comes from SQLite, not the client.
- `backend/server.js`:
  - `GET /api/sessions/:id/state` returns the live `cart` + `version`
    (client's `baseVersion` source; fresh sessions still `{} / 0`).
  - Socket rooms: `session:join` → join room, reply `cart:sync { version,
    cart }` (initial state + ack). `cart:add` (qty ≥ 1) / `cart:updateQty`
    (qty ≥ 0) / `cart:remove` → success broadcasts `cart:sync { version,
    cart, delta }` to the room; failures emit `error { code, message,
    currentVersion, currentState, available? }` (+ ack).
  - Shared `findSession` helper (id or join code); zod-validated payloads
    with snake_case aliases.
- Flutter: `SessionSocket` (baseVersion on every mutation) +
  `SessionController` (sync replaces cart/version; `VERSION_CONFLICT`
  merges `currentState`, refreshes version, retries pending mutation once)
  + `groupCartProvider`; cart rows keyed `ValueKey(itemId)` so merges keep
  scroll position. Attribution badge (initial avatar) sits left of the item
  name with `[-] qty [+]`; adder name resolves via `participantsProvider`,
  falling back to the raw userId.
- `tests/cart.test.js` (new, 8 tests): version 0/empty start, apply+INCR,
  stale→conflict→retry, concurrent same-baseVersion (one wins, one
  conflicts), decrease/remove releasing stock, `OUT_OF_STOCK`, unknown
  first adder keeps credit; re-add after removal changes hands). See
  `per-user-cart-lines.md` for the ownership model that replaced
  display-only `addedBy`.
- `tests/realtime.test.js` (new): two real socket.io clients join one
  session and edit the same line from `baseVersion: 0` simultaneously —
  asserts one ack wins at v1, the loser ack is `VERSION_CONFLICT` with
  mergeable `currentState`, both clients get the v1 broadcast, loser
  retries at v1 → v2 with last-writer qty, attribution unchanged.

## Files touched
| Path | Role |
|------|------|
| `backend/cart.js` | Versioned cart + OCC gate (new) |
| `backend/server.js` | Live state, rooms, cart events |
| `backend/package.json` | Test script + `socket.io-client` devDep |
| `tests/cart.test.js` | OCC coverage (new) |
| `tests/realtime.test.js` | Two-client socket conflict/retry (new) |
| `frontend/lib/data/services/session_socket.dart` | Socket wrapper (new) |
| `frontend/lib/providers/session_controller.dart` | Merge + retry (new) |
| `frontend/lib/providers/cart_provider.dart` | `groupCartProvider` |
| `frontend/lib/ui/screens/collaborative_cart_screen.dart` | ValueKey rows |
| `context/architecture/phase-2-occ.md` | This file |

## How to verify
```bash
cd backend
npm test   # 30 pass (db 5 + api 6 + stock 8 + cart 10 + realtime 1)
# Flutter: `flutter analyze` (no toolchain in this env — eyeballed only)
```

## Deferred
- Ready gate / host checkout / order persistence (Phase 3).
- Session TTL calling `removeSessionCart` + stock `removeSession`.
