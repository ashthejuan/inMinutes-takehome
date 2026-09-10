# Phase 0 — Project Infrastructure & Setup

## Status
Implemented end-to-end (backend skeleton + Flutter skeleton + menu fetch).

## What was built

### Backend (`backend/`)
- Fastify HTTP server on port `3000` with CORS for Flutter web/dev.
- Socket.io attached to the same HTTP server (connection logging only; rooms in Phase 1).
- SQLite via `better-sqlite3` with WAL + foreign keys.
- Schema from PRD §7.1: `menu_items`, `group_sessions`, `session_participants`, `orders`, `order_items`.
- Seeded 12 menu items across categories (Mains, Breads, Starters, Drinks, Desserts).
- Live endpoints: `GET /health`, `GET /api/menu`.
- Session routes stubbed with `501` for later phases.

**Note:** PRD lists `@fastify/socket.io`, which is not published on npm. Phase 0 uses `socket.io` bound to `fastify.server` instead (same port, same rooms model).

### Frontend (`frontend/`)
- Flutter app `food_order` with Riverpod + go_router.
- Routes: `/`, `/menu`, `/cart`, `/group/join`, `/group/:sessionId`, `/order/:orderId/success`.
- Providers scaffolded: `sessionProvider`, `cartProvider` (family), `soloCartProvider`, `participantsProvider`, `checkoutProvider`, `menuProvider`.
- Menu screen loads `GET /api/menu`, groups by category, shows price + stock, local qty controls for solo cart.
- Theme follows `context/style_guide.md` (grayscale + single desaturated blue accent).

## Files touched
| Path | Role |
|------|------|
| `backend/server.js` | Fastify + Socket.io + routes |
| `backend/db.js` | SQLite init, schema, seed |
| `backend/.env` / `.env.example` | `PORT`, `FRONTEND_URL` |
| `backend/package.json` | Scripts + deps |
| `frontend/lib/main.dart` | App entry + ProviderScope |
| `frontend/lib/router.dart` | go_router routes |
| `frontend/lib/theme.dart` | App theme |
| `frontend/lib/config.dart` | API base URL |
| `frontend/lib/data/**` | Menu model + API client |
| `frontend/lib/providers/**` | Riverpod providers |
| `frontend/lib/ui/screens/**` | All 6 screens |
| `frontend/android/.../AndroidManifest.xml` | INTERNET + cleartext for local API |

## How to run
```bash
# Backend
cd backend
cp .env.example .env   # if needed
npm start              # http://localhost:3000/health → {"ok":true}

# Frontend (web)
cd frontend
flutter run -d chrome --dart-define=API_BASE_URL=http://localhost:3000

# Frontend (Android emulator)
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000
```

## Backend tests (`tests/`)
- `tests/db.test.js` — schema, seed idempotency, FK enforcement, menu ordering
- `tests/api.test.js` — `/health`, `/api/menu`, 501 session stubs, Socket.io connect
- Run: `cd backend && npm test` (uses temp SQLite files; does not touch `database.db`)

## Deferred to later phases
- Session create/join REST + Socket.io rooms (Phase 1)
- Cart mutations, stock reservation, version conflicts (Phases 1–2)
- Ready gate + host checkout + order persistence (Phase 3)
