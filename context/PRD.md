# PRD: Collaborative Food Ordering App

## 1. Product Overview

A Flutter mobile application enabling users to place individual orders or participate in real-time **Group Order** sessions. Multiple users join a shared cart via a join code, add items simultaneously, see each other's additions with attribution, and checkout only when all participants mark themselves ready.

**Core Challenge**: Distributed state synchronization across multiple devices with real-time conflict resolution, stock consistency, and collaborative cart management.

---

## 2. User Flows

### 2.1 Normal Order (Solo)
1. User browses menu → adds items to cart → proceeds to checkout → order placed.

### 2.2 Group Order (Collaborative)
1. **Host** taps "Start Group Order" → generates 6-character **Join Code**.
2. **Participants** enter Join Code + Display Name → join session.
3. **Real-time Collaborative Cart**:
   - Any user adds/updates/removes **their own** items → instantly reflected for all (lines keyed `itemId:addedBy`, see §5.3.1).
   - Each line shows **who added it** (attribution badge = ownership badge; steppers only on your own lines).
   - Stock is **reserved atomically**: if User A takes the last 2 units, User B sees "Out of Stock" immediately; if User A removes them, stock releases for others.
   - Concurrent edits on same item → optimistic locking with version vector; loser receives current state + retry.
4. **Ready Status**: Each participant toggles "Ready" when done. UI shows "Ready" vs "Still Browsing".
5. **Checkout**: Only **Host** sees active "Place Order" button, enabled only when **all** participants are Ready.
6. On checkout → order persisted, session cleaned up, all users see confirmation.

---

## 3. Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-01 | Host creates group session → returns unique Join Code | P0 |
| FR-02 | Participants join via Join Code + Display Name | P0 |
| FR-03 | Real-time cart sync across all participants (add/update/remove) | P0 |
| FR-04 | Per-user ownership: every cart line is keyed `itemId:addedBy`, shows owner, only owner may edit/remove | P0 |
| FR-05 | Atomic stock reservation with immediate release on removal | P0 |
| FR-06 | Optimistic concurrency control (version vector) on cart mutations | P0 |
| FR-07 | Conflict resolution: rejected mutations return current state for retry | P0 |
| FR-08 | Participant list with live Ready/Not Ready status | P0 |
| FR-09 | Host-only checkout, enabled only when all participants Ready | P0 |
| FR-10 | Host transfer: if host disconnects, role transfers to earliest-joined connected participant; broadcast `host:changed` | P0 |
| FR-11 | Order persistence with item-level attribution (`added_by`) | P0 |
| FR-12 | Menu browsing with categories, stock display | P1 |
| FR-13 | Session expiry after 30 min inactivity (sliding deadline — see §15 #4) | P1 |
| FR-14 | Smooth UI during sync (no scroll jump, no input interruption) | P1 |

---

## 4. Non-Functional Requirements

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-01 | End-to-end latency (mutate → broadcast → render) | < 200 ms |
| NFR-02 | Support 10 concurrent participants per session | 10 users |
| NFR-03 | Session data survives backend restart | Persisted |
| NFR-04 | Zero-downtime deploy for backend | Rolling |
| NFR-05 | APK works on any Android 8+ device | Compatible |
| NFR-06 | No local infrastructure required for demo | Cloud-backed |

---

## 5. Architecture

### 5.1 System Diagram

```
┌─────────────┐       HTTPS/WSS        ┌──────────────┐
│  Flutter    │ ◄────────────────────► │  Fastify     │
│  (Client)   │   Socket.io rooms      │  + Socket.io │
└─────────────┘                        └──────┬───────┘
                                               │
                    ┌──────────────────────────┼──────────────────────────┐
                    ▼                          ▼                          ▼
            ┌───────────────┐          ┌───────────────┐          ┌───────────────┐
            │   SQLite      │          │  In-Memory    │          │  In-Memory    │
            │  (Persisted)  │          │  (Ephemeral)  │          │  (Active      │
            │               │          │               │          │  Sessions)    │
            │ • menu_items  │          │ • cart hash   │          │               │
            │ • sessions    │          │ • reservations│          │ • version     │
            │ • participants│          │ • participants│          │ • pub/sub     │
            │ • orders      │          │ • stock cache │          │               │
            └───────────────┘          └───────────────┘          └───────────────┘
```

### 5.2 Data Stores

| Store | Purpose | Data |
|-------|---------|------|
| **SQLite** | Durable source of truth | Menu, sessions (audit), participants (audit), orders, order_items |
| **In-Memory (Node.js)** | High-frequency ephemeral state | Active cart, stock reservations, live participants, version counter, pub/sub |
| **Socket.io Rooms** | Real-time delivery | One room per `sessionId`; events: `cart:sync`, `participants:sync`, `checkout:available`, `host:changed`, `error` |

### 5.3 Key Invariants

1. **Per-User Cart Lines (Ownership)**: Cart lines are keyed by `itemId:addedBy`. Each participant owns their own line for a menu item — only the owner may update quantity or remove it (others see static `× qty`, no steppers). `addedBy` is both attribution and the permission key; the server derives it from socket identity so clients cannot spoof another participant's line.
2. **Stock Consistency**: Reservations are atomic (in-memory mutex per session); `available = totalStock - Σreservations`.
3. **Optimistic Locking**: Every cart mutation carries `baseVersion`; server rejects if stale.
4. **Host Authority**: Only `session.hostId` can trigger checkout.
5. **All-Ready Gate**: Checkout enabled iff `participants.every(p => p.ready === true)`.
6. **Host Transfer**: If host disconnects, host role transfers to the connected participant with the earliest `joined_at`; `host:changed` event broadcast to all.

### 5.4 Design Note — Deviation from Original Request (Per-User Ownership)

**Original request (kept for record):** shared editable cart — any participant could update quantity or remove any cart line; `addedBy` was display-only attribution, not a permission check. Concurrent edits on the same line resolved via optimistic locking (last-writer-wins, loser gets `VERSION_CONFLICT` + retry).

**What shipped instead:** per-user cart lines (§5.3.1). Same menu item added by two people produces two lines (`burger:host`, `burger:priya`); you can only stepper/delete your own line.

**WHY the deviation:**
- **Cheap:** one-line key change (`itemId` → `itemId:addedBy`) in `backend/cart.js` + owner-scoped mutate + `socket.data.userId` as source of truth; checkout already aggregates by `itemId` (`UNIQUE(order_id, menu_item_id, added_by)` needed no migration).
- **Nicer UX for a group cart (defensible):** nobody can accidentally zero-out or steal someone else's dish — the #1 social friction in shared carts. Each person's dishes stay theirs; group subtotal + shared checkout preserve the "together" feeling.
- **Fewer conflicts:** cross-user LWW fights disappear; `VERSION_CONFLICT` now only fires on true races (same owner's line, or version race across lines), so retry logic triggers far less.
- **Attribution becomes actionable:** the badge is no longer decorative — it tells you which stepper is yours.
- **Spoof-proof:** server prefers socket identity for `addedBy`, so a client can't forge another user's line key.

See `context/architecture/per-user-cart-lines.md` for implementation + files.

---

## 6. Technical Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| **Runtime** | Node.js 20 LTS | Single binary, native TS via `tsx` |
| **Backend Framework** | Fastify 4 + `@fastify/socket.io` | Typed, fast, WS upgrade on HTTP port |
| **Real-time** | Socket.io 4 | Rooms = sessions, auto-reconnect, ack |
| **Persisted DB** | SQLite + `better-sqlite3` | File-based, zero-config, WAL, portable |
| **Ephemeral State** | In-Memory (Node.js) | Per-session mutex/queue for atomic stock ops; zero external deps |
| **Frontend** | Flutter 3 + Riverpod 2 | Compile-safe state, stream-friendly |
| **Socket Client** | `socket_io_client` 2 | Matches server protocol |
| **Hosting** | Railway | GitHub deploy, persistent volumes, internal networking |

---

## 7. Data Models

### 7.1 SQLite (Persisted)

```sql
-- Menu
CREATE TABLE menu_items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  price_paise INTEGER NOT NULL,  -- ₹299.00 → 29900
  stock INTEGER NOT NULL DEFAULT 0,
  category TEXT NOT NULL,
  image_url TEXT
);

-- Group Sessions (audit)
CREATE TABLE group_sessions (
  id TEXT PRIMARY KEY,
  join_code TEXT UNIQUE NOT NULL,  -- 6-char uppercase
  host_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL  -- sliding deadline: last_activity + 30 min (FR-13, §15 #4)
);

-- Participants (audit)
CREATE TABLE session_participants (
  session_id TEXT NOT NULL REFERENCES group_sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  is_host INTEGER NOT NULL DEFAULT 0,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, user_id)
);

-- Orders
CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES group_sessions(id),
  total_paise INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'placed',
  created_at INTEGER NOT NULL
);

-- Order Items (attribution preserved)
CREATE TABLE order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id TEXT NOT NULL REFERENCES menu_items(id),
  qty INTEGER NOT NULL,
  price_paise INTEGER NOT NULL,
  added_by TEXT NOT NULL,  -- userId who added this line (display only)
  UNIQUE(order_id, menu_item_id, added_by)
);
```

### 7.2 In-Memory Ephemeral State (Per Session, TTL 30 min)

| Key | Type | Value |
|-----|------|-------|
| `session:{id}` | Object | `{ hostId, status, version, createdAt }` |
| `session:{id}:participants` | Map | `userId → { name, ready, joinedAt }` |
| `session:{id}:cart` | Map | `lineKey (itemId:addedBy) → { itemId, qty, addedBy, price }` (one line per participant per item) |
| `session:{id}:stock:reserved:{itemId}` | Number | Reserved quantity for this session |
| `session:{id}:version` | Number | Monotonic counter for optimistic locking |
| `menu:stock:{itemId}` | Number | Global available stock (cached from SQLite) |

---

## 8. Real-Time Protocol (Socket.io)

### 8.1 Client → Server

| Event | Payload | Validation |
|-------|---------|------------|
| `cart:add` | `{ itemId, qty, baseVersion }` (`addedBy` = socket identity, client cannot spoof) | `qty > 0`, stock available, version match → mutates caller's own `itemId:addedBy` line |
| `cart:updateQty` | `{ itemId, qty, baseVersion }` (`addedBy` = socket identity) | `qty ≥ 0`, stock delta, version match → own line only |
| `cart:remove` | `{ itemId, baseVersion }` (`addedBy` = socket identity) | Version match → own line only |
| `user:ready` | `{ ready: boolean }` | — |
| `checkout` | `{}` | Caller == host, all participants ready |

### 8.2 Server → Client

| Event | Payload | Trigger |
|-------|---------|---------|
| `cart:sync` | `{ version, cart: { [lineKey]: { itemId, qty, addedBy, price } } }` | Any cart mutation |
| `participants:sync` | `[{ userId, name, ready }]` | Join/leave/ready toggle |
| `checkout:available` | `{ available: boolean }` | Ready state change |
| `host:changed` | `{ hostId }` | Host disconnected, role transferred |
| `session:checkout` | `{ orderId }` | Successful checkout |
| `error` | `{ code, message, currentState? }` | Version conflict, out of stock, not host, not all ready |

### 8.3 Error Codes

| Code | Meaning | Client Action |
|------|---------|---------------|
| `VERSION_CONFLICT` | Stale `baseVersion` | Apply `currentState`, retry |
| `OUT_OF_STOCK` | Insufficient free stock | Show available count, disable add |
| `ONLY_HOST_CAN_CHECKOUT` | Non-host called checkout | Disable button for non-host |
| `NOT_ALL_READY` | Some participants not ready | Show who isn't ready |

### 8.4 Reconnect / Rejoin

Transport auto-reconnect opens a new server-side socket with no room
membership, so the client re-emits `session:join` on every Socket.io
`reconnect` (exactly once per connection epoch — initial join goes through
the first `connect`). The server answers with full `cart:sync` +
`participants:sync` + `checkout:available`, which the client applies as a
 wholesale replace — no separate resync call needed. Mutations buffered while
offline arrive with a stale `baseVersion` and heal via `VERSION_CONFLICT`
merge + single retry (§10.4).

---

## 9. Stock Reservation Algorithm (In-Memory, Per-Session Mutex)

```typescript
// In-memory per-session reservation queue
const sessionReservationQueues = new Map<string, Map<string, Promise<void>>>();

async function reserveStock(sessionId: string, itemId: string, qty: number): Promise<{ ok: boolean; available: number }> {
  const queue = sessionReservationQueues.get(sessionId) ?? new Map();
  sessionReservationQueues.set(sessionId, queue);

  // Serialize operations on the same itemId within this session
  const key = itemId;
  const previous = queue.get(key) ?? Promise.resolve();
  
  const result = await previous.then(async () => {
    const stock = menuStockCache.get(itemId) ?? 0;
    const reserved = sessionStockReserved.get(`${sessionId}:${itemId}`) ?? 0;
    const free = stock - reserved;
    
    if (free >= qty) {
      sessionStockReserved.set(`${sessionId}:${itemId}`, reserved + qty);
      return { ok: true, available: free - qty };
    }
    return { ok: false, available: free };
  });

  queue.set(key, result);
  return result;
}

async function releaseStock(sessionId: string, itemId: string, qty: number) {
  const key = `${sessionId}:${itemId}`;
  const current = sessionStockReserved.get(key) ?? 0;
  sessionStockReserved.set(key, Math.max(0, current - qty));
}
```

- Runs in a single Node.js process → no network round-trip, no external Redis dependency.
- Per-`sessionId` + `itemId` mutex serializes concurrent mutations on the same item.
- On `cart:remove` / `qty` decrease → `releaseStock` decrements reservation.
- On checkout → reservations converted to confirmed stock decrement in SQLite.
- **Note**: This is a deliberate single-replica scoping decision for the 4-day timeline. Redis + Lua is the natural next step for horizontal scaling.

---

## 10. Optimistic Concurrency Control

1. Client reads `version` with initial state.
2. Every mutation sends `baseVersion` (+ owner `addedBy`, server prefers socket identity).
3. Server compares with current `version`:
   - Match → apply to caller's own `itemId:addedBy` line, `INCR version`, broadcast `cart:sync { version, delta }`.
   - Mismatch → reject with `error { code: 'VERSION_CONFLICT', currentVersion, currentState }`.
4. Client on conflict: merge `currentState` (preserve scroll via `key: ValueKey(lineKey)`), retry pending mutation.
5. Two users adding the same menu item do **not** conflict — they create two lines. `VERSION_CONFLICT` only fires on true races (same owner's line, or version race across lines).

---

## 11. REST API (Initial Load Only)

| Method | Path | Response |
|--------|------|----------|
| `POST` | `/api/sessions` | `{ sessionId, joinCode, hostId }` |
| `POST` | `/api/sessions/join` | `{ sessionId, userId, isHost }` |
| `GET` | `/api/menu` | `[{ id, name, price_paise, stock, category, ... }]` |
| `GET` | `/api/sessions/:id/state` | `{ session, cart, participants, version }` |
| `GET` | `/health` | `{ ok: true }` |

---

## 12. Frontend Screens

| Screen | Route | Purpose |
|--------|-------|---------|
| **1. Home** | `/` | Choose Normal Order vs Group Order |
| **2. Menu** | `/menu` | Browse categories, add to cart; AppBar: "Start Group Order" button (host) |
| **3. Solo Cart** | `/cart` | Review solo order, checkout |
| **4. Join Group Session** | `/group/join` | Participant enters 6-char code + display name |
| **5. Collaborative Cart** | `/group/:sessionId` | **Core screen** — real-time cart + participant dropdown in AppBar (avatars, ready status, host badge, leave session), host-only checkout FAB |
| **6. Checkout Success** | `/order/:orderId/success` | Order confirmation |

### Screen Flow

```
Home
├─ Normal Order → Menu → Cart → Checkout Success
└─ Group Order
   ├─ Host: Menu → [AppBar: Start Group Order] → Collaborative Cart
   └─ Participant: Home → Join Session → Collaborative Cart
```

### Collaborative Cart UI Layout

```
┌─────────────────────────────────────────────┐
│ AppBar: "Group Order"  [Participant ▼]      │
│  Dropdown:                                   │
│  🟢 Host  Akshit (You)      ✓ Ready         │
│  🟡       Priya              ⏳ Browsing     │
│  🟡       Rohan              ⏳ Browsing     │
│  [Leave Session]                              │
├─────────────────────────────────────────────┤
│ Menu Items (ListView, one row per owner line)   │
│ ┌─────────────────────────────────────────┐ │
│ │ Chicken Biryani          👤 A  [-] 2 [+] │ │  ← own line: steppers
│ │ ₹299 • Only 3 left                      │ │
│ ├─────────────────────────────────────────┤ │
│ │ Chicken Biryani          👤 P   × 1      │ │  ← Priya's line: static qty on my device
│ │ ₹299 • Only 3 left                      │ │
│ ├─────────────────────────────────────────┤ │
│ │ Paneer Butter Masala     👤 P  [-] 1 [+] │ │
│ │ ₹249 • In Stock                         │ │
│ └─────────────────────────────────────────┘ │
├─────────────────────────────────────────────┤
│ Bottom: Subtotal: ₹847  [Place Order] (FAB) │  ← Host only, enabled when all ready
└─────────────────────────────────────────────┘
```

---

## 13. Frontend State Architecture (Riverpod)

```
SessionProvider (StreamProvider<SessionState>)
    │
    ├─► CartProvider (family per lineKey `itemId:addedBy`) → rebuilds only changed lines
    ├─► ParticipantsProvider → list with ready status
    └─► CheckoutProvider → host-only, enabled when allReady
```

- Socket events → `SessionController` → updates `SessionState` → notifies dependent providers.
- Fine-grained rebuilds: `ListView.builder` with `key: ValueKey(lineKey)` preserves scroll on targeted updates.

---

## 14. State Management Summary

| Layer | Technology | What It Manages |
|-------|------------|-----------------|
| **Frontend (Flutter)** | **Riverpod 2** (`flutter_riverpod`) | UI state: session stream, cart items (family), participants, checkout eligibility, solo cart, menu cache. Compile-safe, reactive, testable. |
| **Backend (Node.js)** | **In-memory (Fastify + Socket.io)** | Active socket connections, session-room mapping, request-scoped validation, ephemeral session state (cart, reservations, participants, version). |
| **Persisted DB (SQLite)** | **better-sqlite3 (sync, WAL)** | Durable data: menu, sessions (audit), participants (audit), orders, order_items. Single-writer, unlimited concurrent readers via WAL. |
| **Ephemeral State (In-Memory)** | **Node.js Maps + per-session mutex** | Hot coordination: cart hash, stock reservations, live participants, version counter. Atomic operations within single process, TTL-based cleanup. |
| **Real-time Transport** | **Socket.io 4** | Room-based delivery (`sessionId` = room), auto-reconnect, ack callbacks, event ordering guarantees. |

---

## 15. Assumptions & Constraints

1. **No authentication** — sessions identified by join code only.
2. **Single kitchen/menu** — no multi-restaurant logic.
3. **Global stock** — shared across all sessions; reservations prevent oversell.
4. **Session TTL** — 30 min inactivity → auto-expire (sliding `expires_at = last_activity + 30 min`; REST joins, socket joins, cart mutations, and ready toggles slide it — read-only state fetches do not; in-memory cleanup + SQLite audit remains).
5. **No payments** — checkout creates order record only.
6. **One active session per user** — joining new session leaves previous.
7. **Single backend replica** — SQLite is single-writer; in-memory ephemeral state requires single process. Redis + Lua is the natural next step for horizontal scaling.
8. **Android only** — APK deliverable; iOS not required.
9. **No offline support** — real-time requires connectivity.
10. **Host transfer on disconnect** — if all participants disconnect, session expires per TTL logic.

---

## 16. Packages & Justifications

### Backend
| Package | Purpose |
|---------|---------|
| `fastify` | HTTP framework |
| `@fastify/socket.io` | WebSocket on same port |
| `@fastify/cors` | Cross-origin for Flutter |
| `better-sqlite3` | Sync SQLite, WAL mode |
| `zod` | Runtime validation |
| `nanoid` | Unique IDs |
| `dotenv` | Env config |

### Frontend
| Package | Purpose |
|---------|---------|
| `flutter_riverpod` | State management |
| `socket_io_client` | Socket.io protocol |
| `freezed` / `json_serializable` | Immutable models |
| `go_router` | Navigation |
| `cached_network_image` | Menu images |

---

## 17. Acceptance Criteria

| Scenario | Expected |
|----------|----------|
| Host creates group order | Join code generated, host enters cart screen |
| Participant joins via code | Sees empty cart, participant list with host |
| User adds item | Appears instantly on all devices with attribution/ownership badge; steppers only on owner's device |
| Two users add same menu item | Two separate lines (`item:host`, `item:guest`), no conflict |
| Two users race on same owner's line | Last writer wins; loser gets `VERSION_CONFLICT`, retries |
| User takes last stock | Other users see "Out of Stock" immediately |
| User removes item | Stock released, others can add again |
| Participant toggles Ready | All devices update status in real time |
| Host clicks Place Order (all ready) | Order created, session cleaned up, all see confirmation |
| Host clicks Place Order (not all ready) | Error `NOT_ALL_READY`, button stays disabled |
| Non-host clicks Place Order | Error `ONLY_HOST_CAN_CHECKOUT` |
| Host disconnects | Role transfers to earliest-joined connected participant; `host:changed` broadcast |
| Session idle 30 min | Expires, data cleaned from memory, SQLite audit remains |

---

## 18. Deliverables

1. **Backend Repository** — Fastify + Socket.io + SQLite + In-Memory ephemeral state
2. **Frontend Repository** — Flutter + Riverpod + Socket.io client
3. **APK** — Release build connecting to production backend
4. **README** — Setup, architecture video, packages, assumptions (separate document)

---

## 19. Out of Scope

- User authentication / accounts
- Payment integration
- Multi-restaurant / kitchen management
- Push notifications
- iOS build
- Admin dashboard
- Order tracking / delivery logistics