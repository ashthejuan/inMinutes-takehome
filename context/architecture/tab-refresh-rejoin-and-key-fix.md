# Tab Refresh Rejoin, Session Persistence & Flutter Layout Fix

## Status
Implemented and verified. `flutter test`, `flutter analyze`, and `npm test` (all 42 backend tests) passing cleanly.

## Problem Description
When opening multiple tabs in the same browser (non-incognito Chrome) for a collaborative group session and refreshing one tab:
1. **Disconnection from Group Order**:
   - The refreshed tab lost its in-memory Riverpod state (`sessionProvider`), resulting in `sessionId: null` and `userId: null`.
   - The Socket.io connection was never reconnected or instructed to rejoin `session:join` upon page reload.
   - The user saw an empty cart, no join code, and lost ownership/steppers of their items.
2. **`A RenderFlex overflowed by 99309 pixels on the right`**:
   - In `CollaborativeCartScreen`'s AppBar `actions`, the `PopupMenuButton` child contained a `Row` with default `MainAxisSize.max`.
   - In an unconstrained horizontal slot, it expanded to the maximum layout constraint (100,000 px), overflowing the screen width by exactly `99,309` pixels.
   - This caused `Cannot hit test a render box that has never been laid out` and `Assertion failed: mouse_tracker.dart:203:12` on every subsequent mouse movement.
3. **`Duplicate GlobalKeys detected in widget tree` & `Tried to build dirty widget in the wrong build scope`**:
   - `final appRouter = GoRouter(...)` was defined as a global static instance in `router.dart`.
   - GoRouter's internal `navigatorKey = GlobalKey<NavigatorState>()` was retained across Flutter Web rebuilds/reloads, resulting in duplicate GlobalKeys and mismatched build scope assertions (`framework.dart:6079:14` and `object.dart:1808:12`).

## Solution & Architecture Changes

### 1. Per-Tab Session Persistence (`sessionStorage`)
- Used HTML5 `window.sessionStorage` on Web with an in-memory stub fallback for tests / native.
- **Why `sessionStorage` instead of `localStorage`**:
  `localStorage` is shared across all tabs of the same origin. When two tabs in the same browser (no incognito) run separate participants (e.g. Host Alice in Tab 1, Guest Bob in Tab 2), `localStorage` would overwrite one user's identity with the other.
  `sessionStorage` is strictly scoped per browser tab while surviving tab reloads/refreshes.
- `SessionState`: added `toJson()` and `fromJson()` serialization.
- `SessionNotifier`:
  - Seeds initial state from `SessionStorageService.loadSession()`.
  - Automatically saves to storage on `setSession` and wipes storage on `clear()`.
  - `SessionController`: on explicit `leave()`, checkout success, or `session:expired`, clears session storage.

### 2. Auto-Rejoin and Connection Recovery on Page Refresh
- In `SessionController`:
  - When constructed with an already-active session (restored from `sessionStorage`), automatically connects the socket and issues `session:join`.
  - Added `ensureJoined(sessionId)` to guarantee the socket connects and rejoins the room when landing on `/group/:sessionId`.
  - If a user navigates to `/group/:sessionId` without an active session (e.g. brand new tab), `onNeedsJoin` fetches session info from REST (`fetchSessionState`) and prompts the user for their display name to join smoothly.
- In `MenuScreen`:
  - Added `initState` post-frame hook calling `ensureJoined` so refreshing while browsing the menu also maintains the socket connection and room membership.
- In `backend/server.js`:
  - When rejoining with `session:join`, participant lookup retains their original `joined_at` timestamp from `session_participants` so their seniority ordering in the participants list is preserved.

### 3. Layout Overflow & Mouse Tracker Fix
- In `CollaborativeCartScreen`:
  - Added `mainAxisSize: MainAxisSize.min` to the `Row` inside the AppBar `PopupMenuButton`.
  - This constrains the Row to its intrinsic width, eliminating the 99,309 px overflow and the mouse tracker assertion failures.
  - Wrapped `onErrorMessage` snackbars in `WidgetsBinding.instance.addPostFrameCallback` to avoid modifying build owner state during an active build phase.
  - Cleared `onCheckout`, `onErrorMessage`, and `onNeedsJoin` in `dispose()`.

### 4. Riverpod-Scoped GoRouter
- In `router.dart`:
  - Converted the top-level global `GoRouter` into `final routerProvider = Provider<GoRouter>((ref) { ... ref.onDispose(router.dispose); ... })`.
- In `main.dart`:
  - Made `FoodOrderApp` a `ConsumerWidget` that reads `routerProvider`.
  - Each `ProviderScope` creates a clean `GoRouter` with its own `GlobalKey<NavigatorState>`, eliminating duplicate key assertions on reload.

## Files Touched
| Path | Role |
|------|------|
| `frontend/lib/data/services/session_storage.dart` | Cross-platform session storage interface |
| `frontend/lib/data/services/session_storage_web.dart` | Browser `sessionStorage` implementation (per-tab) |
| `frontend/lib/data/services/session_storage_stub.dart` | In-memory storage stub for non-web / tests |
| `frontend/lib/data/services/session_socket.dart` | Safe `connect()` without dropping stored identity |
| `frontend/lib/data/services/api_client.dart` | Added `fetchSessionState(sessionId)` |
| `frontend/lib/providers/session_provider.dart` | JSON serialization + auto-persistence in notifier |
| `frontend/lib/providers/session_controller.dart` | Auto-reconnect on active session, `ensureJoined`, clean disposal |
| `frontend/lib/router.dart` | Riverpod-managed `routerProvider` |
| `frontend/lib/main.dart` | Consume `routerProvider` via `ConsumerWidget` |
| `frontend/lib/ui/screens/collaborative_cart_screen.dart` | Fixed AppBar Row `mainAxisSize.min`, `ensureJoined`, `_promptJoin` |
| `frontend/lib/ui/screens/menu_screen.dart` | Connection verification in `initState` |
| `frontend/test/session_storage_test.dart` | Unit tests for storage and serialization |
| `backend/server.js` | Preserve original `joined_at` on socket reconnect |
| `context/architecture/tab-refresh-rejoin-and-key-fix.md` | Architecture documentation |

## How to Verify
1. Start backend: `npm start` in `backend` (or run `npm test` -> 42/42 pass).
2. Start Flutter Web frontend: `flutter run -d chrome` in `frontend`.
3. In Tab 1: Start a Group Order as Host (e.g. "Alice"), navigate to `/group/:sessionId`.
4. In Tab 2 (normal Chrome, no incognito): Open `http://localhost:8080`, click "Join Group Order", enter code & name (e.g. "Bob").
5. Refresh Tab 2: Bob reloads, automatically rejoins the group session, and remains visible in the participants list with his items intact.
6. Refresh Tab 1: Alice reloads, automatically rejoins the group session, cart and participants re-sync seamlessly.
7. Observe no `Duplicate GlobalKeys`, `RenderFlex overflow`, or `mouse_tracker` errors in the terminal.
