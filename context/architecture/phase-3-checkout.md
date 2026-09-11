# Phase 3 — Collaborative Cart & Checkout

## Status
Implemented e2e with socket + REST tests. Backend 34 pass
(db 5 + api 6 + stock 8 + cart 10 + realtime 1 + checkout 4);
`flutter analyze` clean, widget test passes.

## What was built

### Backend
| Path | Role |
|------|------|
| `backend/participants.js` | NEW: live ready-gate view `sessionId → (userId → {name, ready, isHost, joinedAt})`. Seeded `ready:false` from SQLite audit on first touch; ephemeral fallback for socket-only users (keeps Phase-2-style tests green). `getParticipants` returns snake+camel aliases sorted by `joinedAt`; `isAllReady` false on empty. |
| `backend/checkout.js` | NEW: `performCheckout(sessionId, caller)` guards session → host (`ONLY_HOST_CAN_CHECKOUT`) → all-ready (`NOT_ALL_READY` + `notReady`) → non-empty (`EMPTY_CART`). One SQLite transaction persists `orders` + `order_items` (with `added_by` attribution), decrements `menu_items.stock`, marks session `completed`; then drops cart/reservations/live-ready and refreshes the stock cache. |
| `backend/server.js` | Seeds live view on `POST /api/sessions` + `/join`; `GET /:id/state` overlays `ready` and adds `allReady`/`checkoutAvailable` aliases; socket `session:join` registers presence and emits `participants:sync` + `checkout:available`; new `user:ready` (validates `ready:boolean`) and `checkout` handlers with `error` + ack semantics matching Phase 2. |

### Frontend
| Path | Role |
|------|------|
| `lib/data/services/session_socket.dart` | `onParticipantsSync` / `onCheckoutAvailable` / `onSessionCheckout`, `setReady()`, `checkout()`. |
| `lib/providers/session_controller.dart` | Applies `participants:sync` → `participantsProvider`; `session:checkout` → `onCheckout(orderId)`; non-conflict `error` codes → `onErrorMessage` SnackBar; `setReady()` with optimistic flip; `checkout()`. |
| `lib/ui/screens/collaborative_cart_screen.dart` | `ConsumerStatefulWidget`: wires `onCheckout` → `go /order/:id/success`, `onErrorMessage` → SnackBar; subtotal bar + `Mark Ready` toggle + `Waiting for:` list + host-only hint; FAB calls real `checkout()` and stays disabled until `isHost && allReady`. |

### Tests
`tests/checkout.test.js` (4 e2e over real sockets): ready broadcast + gate opens;
non-host → `ONLY_HOST_CAN_CHECKOUT`; host-early → `NOT_ALL_READY`;
all-ready host checkout → `session:checkout` on both clients, order/items
persisted with attribution, stock decremented, session `completed`, cart cleared.

## How to verify
```bash
cd backend
npm test   # 34 pass
cd ../frontend
flutter analyze  # clean
flutter test     # pass
```

## Deferred
- Host transfer on disconnect + session TTL sweep (Phase 4).
