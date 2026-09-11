# Phase 2 — Atomic Stock Reservation

## Status
Implemented (in-memory core). No cart/checkout wiring yet — that lands with
the socket cart mutations + optimistic locking later in Phase 2.

## What was built
- `backend/stock.js`: per-session + per-item promise-chain mutex
  (`sessionReservationQueues: sessionId → itemId → tail`), `reserveStock`
  / `releaseStock`, `menu:stock:{itemId}` cache, per-session reservation
  map, `removeSession` cleanup.
  - `reserveStock(sessionId, itemId, qty)` → `{ ok, available }`:
    `free = cachedStock - Σreservations(all sessions)`; reserves only if
    `free >= qty`. Invalid/empty ids or non-positive-int qty → `{ ok: false }`.
  - `releaseStock(sessionId, itemId, qty)` (cart remove / qty decrease):
    decrements under the same item lock, clamped at 0 (key deleted).
  - Correction vs PRD §9 sketch: Σ spans all sessions (global stock is
    shared, PRD §5.3 #2); single-replica in-memory lock (Redis + Lua is the
    documented next step for horizontal scale).
- `backend/server.js`: warms `menu:stock:{itemId}` via `refreshStockCache()`
  right after `initDb()` in `buildServer`.
- `tests/stock.test.js`: 8 tests — ok/fail paths, release clamp, invalid
  qty, 10-way concurrent reserve with no oversell, cross-session sharing,
  `removeSession` isolation, SQLite cache refresh.
- `backend/package.json`: `npm test` now includes `tests/stock.test.js`.

## Files touched
| Path | Role |
|------|------|
| `backend/stock.js` | Reservation algorithm + cache + mutex (new) |
| `backend/server.js` | Cache warm on boot |
| `backend/package.json` | Test script |
| `tests/stock.test.js` | Reservation coverage (new) |
| `context/architecture/phase-2-stock.md` | This file |

## How to verify
```bash
cd backend
npm test   # 19 pass (db 5 + api 6 + stock 8)
```

## Deferred
- Socket `cart:add/updateQty/remove` calling reserve/release + `OUT_OF_STOCK`
  errors (done — see `context/architecture/phase-2-occ.md`); checkout
  converting reservations to SQLite decrements; 30-min TTL calling
  `removeSession` (rest of Phase 2 / Phase 3).
