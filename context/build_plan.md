# Build Plan: Collaborative Food Ordering App (inMinutes Assignment)

**Timeline:** 4 days (as specified in assignment)
**Goal:** Build a real-time collaborative food ordering platform with Flutter frontend and Node.js backend, supporting both normal solo orders and group order sessions with live cart synchronization.

---

## Phase 0: Project Infrastructure & Setup

### Project Initialization & Backend Skeleton
Initialize Node.js project with `npm init -y`, then install dependencies: `fastify`, `@fastify/socket.io`, `@fastify/cors`, `better-sqlite3`, `zod`, `nanoid`, `dotenv`. Initialize SQLite with WAL mode and create `database.db` using the schema from PRD §7.1 (menu_items, group_sessions, session_participants, orders, order_items). **Seed menu_items in SQLite** with realistic sample data (name, price_paise, stock, category) — this must exist before any cart mutation or stock reservation testing can happen. Set up Fastify server on port 3000 with Socket.io plugin and CORS configured for Flutter web. Create `.env` with `PORT=3000` and `FRONTEND_URL`. Verify server starts: `node server.js` returns health check.

### Frontend Skeleton
Create Flutter project with `flutter create .`, install frontend dependencies: `flutter_riverpod`, `socket_io_client`, `freezed`, `json_serializable`, `go_router`, `cached_network_image`. Set up Riverpod providers per PRD §13-14: `SessionProvider`, `CartProvider` (family per itemId), `ParticipantsProvider`, `CheckoutProvider`. Set up go_router with routes: `/`, `/menu`, `/cart`, `/group/join`, `/group/:sessionId`, `/order/:orderId/success`. Create basic widget scaffolding for all 6 screens (PRD §12). **Menu screen rendering**: Basic UI rendering items with categories and stock display, wired to `GET /api/menu`. Verify Flutter compiles on device/web: `flutter run`.

---

## Phase 1: Core Real-Time Infrastructure

### Socket.io Room Architecture
Backend: Integrate `@fastify/socket.io`, attach to HTTP server, create rooms per `sessionId`. Implement room join logic: socket joins `/sessionId` room on connect, broadcast connection count to room participants. Frontend: `socket_io_client` connects to backend, joins room after session creation/join. Exchange initial state on join: server sends current `{session, cart, participants, version}`.

### Cart Mutation Events
Implement client → server events (PRD §8.1): `cart:add`, `cart:updateQty`, `cart:remove`, `user:ready`, `checkout`. Server validates each mutation: version match, stock availability, host-only checks. On valid mutation: increment `version`, broadcast `cart:sync { version, delta }`. Frontend: `CartProvider` family rebuilds only changed items via `key: ValueKey(itemId)` (preserves scroll). Implement `error` event codes: `VERSION_CONFLICT`, `OUT_OF_STOCK`, `ONLY_HOST_CAN_CHECKOUT`, `NOT_ALL_READY`.

### Participant Tracking
Server maintains `session:{id}:participants` Map: `userId → {name, ready, joinedAt}`. Broadcast `participants:sync [{userId, name, ready}]` on join/leave/ready toggle. Frontend: `ParticipantsProvider` renders dropdown list with avatars, ready/not-ready status (PRD §318-323). Host badge visualization in participant list.

---

## Phase 2: Stock Reservation & Inventory

### Atomic Stock Reservation Algorithm
Implement per-session + per-item mutex queue (PRD §9): `sessionReservationQueues Map` serializes concurrent mutations on same `itemId`. `reserveStock(sessionId, itemId, qty)` → `{ok, available}`: checks `free = stock - reserved`, decrements if OK. `releaseStock(sessionId, itemId, qty)` on removal/decrease. Cache menu stock from SQLite: `menu:stock:{itemId}` key (PRD §187). Frontend: on `OUT_OF_STOCK` error, show available count, disable add button (PRD §414-415).

### Optimistic Concurrency Control
Client reads initial `version` with state (from `/api/sessions/:id/state` or socket join). Every mutation sends `baseVersion`. Server compares `baseVersion` vs current `version`: match → apply + INCR version + broadcast; mismatch → reject with `VERSION_CONFLICT` + `currentVersion` + `currentState`. Frontend on conflict: merge `currentState`, preserve scroll via `key: ValueKey(itemId)`, retry pending mutation (PRD §276-277).

### Concurrent-Edit Test Pass
**Test coverage:** Two clients editing the same line simultaneously, verifying conflict/retry behavior end-to-end. Confirm that the last writer wins and the loser receives `VERSION_CONFLICT`, applies `currentState`, and retries the pending mutation without interrupting scroll position.

### Item Attribution
Every cart line stores `addedBy` userId (display-only, PRD §97: "addedBy is display-only attribution, not a permission check"). Frontend: badge showing who added each item (PRD §320, §327-328). On `cart:sync`, update `addedBy` display if item changed hands. UI: `[-]` `[qty]` `[+]` controls with attribution badge left of item name (PRD §327-328).

---

## Phase 3: Collaborative Cart & Checkout

### Ready Status & All-Ready Gate
Participant toggles "Ready" button → sends `user:ready {ready: boolean}`. Server updates participant's `ready` status, broadcasts `participants:sync`. Server computes `allReady = participants.every(p => p.ready === true)`. Frontend: `CheckoutProvider` enabled only when `allReady` (PRD §347, §334). UI: AppBar dropdown shows "Ready" vs "Still Browsing" indicators (PRD §320-323). "Place Order" FAB enabled/disabled based on all-ready state (PRD §334).

### Host-Only Checkout
Server validates `checkout` event caller == `session.hostId`. On non-host checkout: broadcast `error { code: 'ONLY_HOST_CAN_CHECKOUT' }`, disable button for non-host (PRD §419, §220-221). Frontend: non-host clicking Place Order shows error, button stays disabled. Host clicking Place Order when not all ready: broadcast `error { code: 'NOT_ALL_READY' }`, show who isn't ready (PRD §418, §221-222).

### Order Persistence & Session Cleanup
Host checkout → convert in-memory reservations to confirmed stock decrement in SQLite. Create `orders` record + `order_items` with `added_by` attribution (PRD §11, §166-175). Session status → `completed`, clean up in-memory state (TTL 30 min, PRD §372-373). Broadcast `session:checkout { orderId }` to all clients. Frontend: navigate to `/order/:orderId/success`, show confirmation.

---

## Phase 4: Edge Cases & Polish

### Host Transfer on Disconnect
Server: on socket disconnect, check if disconnecting user is host. If host: find connected participant with earliest `joined_at`, promote to host. Broadcast `host:changed { hostId }` to all participants in room. Frontend: `host:changed` event updates participant list host badge, checkout eligibility. Test: host disconnects → new host takes over, all functionality continues.

### Session Expiry
30-min inactivity TTL: server cleans in-memory state after no socket activity. SQLite audit remains (orders, sessions, participants - PRD §372). Frontend: joining expired session shows error, redirects to home.

### Error Handling & UX Polish
All error codes handled UI-wise (PRD §418-421). `ListView.builder` with `key: ValueKey(itemId)` preserves scroll position on targeted updates (PRD §351). Subtotal calculation and display (PRD §334). **Menu browsing with categories and stock display removed from this section** — covered in Phase 0 frontend setup. **Backend deployed to Railway (or equivalent)** — persistent volume for SQLite file configured, env vars set, `/health` endpoint verified reachable from external network. APK connects to this pre-deployed backend.

---

## Deliverables Checklist

### Backend Repository
- [ ] Fastify + Socket.io server with SQLite persistence
- [ ] All REST API endpoints (PRD §11: `/api/sessions`, `/api/sessions/join`, `/api/menu`, `/api/sessions/:id/state`, `/health`)
- [ ] Real-time protocol implementation (PRD §8: cart:sync, participants:sync, checkout:available, host:changed, error)
- [ ] Stock reservation algorithm with atomic mutex (PRD §9)
- [ ] Optimistic concurrency control with version vectors (PRD §10)
- [ ] Error code handling (PRD §8.3)
- [ ] Order persistence with attribution (PRD §11)

### Frontend Repository
- [ ] All 6 screens implemented (PRD §12)
- [ ] Riverpod state management (SessionProvider, CartProvider family, ParticipantsProvider, CheckoutProvider)
- [ ] Socket.io client integration
- [ ] Fine-grained rebuilds preserving scroll (PRD §351)
- [ ] Item attribution badges displayed
- [ ] Ready status toggles and display
- [ ] Host-only checkout logic
- [ ] Subtotal calculation

### APK
- [ ] Debug build generated and tested
- [ ] Connects to deployed backend (Railway)
- [ ] End-to-end flow: create group → join → add items → ready → checkout → success

### README
- [ ] Setup and run instructions with specific versions
- [ ] Architecture video explanation of sync logic
- [ ] Packages used and justifications (PRD §16)
- [ ] Assumptions made during development (PRD §17)

### Assumptions Documented
- No authentication — sessions identified by join code only (PRD §369)
- Single kitchen/menu — no multi-restaurant logic (PRD §370)
- Global stock shared across all sessions; reservations prevent oversell (PRD §371)
- Session TTL — 30 min inactivity → auto-expire (PRD §372)
- No payments — checkout creates order record only (PRD §373)
- One active session per user (PRD §374)
- Single backend replica — SQLite single-writer; in-memory requires single process (PRD §375)
- Android only — APK deliverable; iOS not required (PRD §376)
- No offline support — real-time requires connectivity (PRD §377)
- Backend deployed to Railway with persistent SQLite volume (new assumption for cloud delivery)

---

## Success Criteria (from PRD §406-422)

| Scenario | Expected |
|----------|----------|
| Host creates group order | Join code generated, host enters cart screen |
| Participant joins via code | Sees empty cart, participant list with host |
| User adds item | Appears instantly on all devices with attribution badge |
| Two users edit same line's quantity concurrently | Last writer wins; loser gets VERSION_CONFLICT, retries |
| User takes last stock | Other users see "Out of Stock" immediately |
| User removes item | Stock released, others can add again |
| Participant toggles Ready | All devices update status in real time |
| Host clicks Place Order (all ready) | Order created, session cleaned up, all see confirmation |
| Host clicks Place Order (not all ready) | Error NOT_ALL_READY, button stays disabled |
| Non-host clicks Place Order | Error ONLY_HOST_CAN_CHECKOUT |
| Host disconnects | Role transfers to earliest-joined connected participant; host:changed broadcast |
| Session idle 30 min | Expires, data cleaned from memory, SQLite audit remains |

---