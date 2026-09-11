# Menu category order + collapsible sections

## Status
Implemented (frontend-only change).

## What was built
- Canonical category order in `frontend/lib/ui/screens/menu_screen.dart` via
  `_MenuList.categoryOrder = ['Starters', 'Mains', 'Breads', 'Desserts', 'Drinks']`.
  - Sections sort by this index; any unknown backend category falls through to
    alphabetical order after the known five.
  - Backend `GET /api/menu` (`backend/db.js` → `ORDER BY category ASC`) is
    untouched — ordering is a presentation concern owned by the menu UI.
- Each category slab is now collapsible:
  - `_MenuList` converted from `ConsumerWidget` to `ConsumerStatefulWidget`
    with a `_collapsed: Set<String>` (all sections start expanded).
  - Header is an `InkWell` row: category title + item count + expand_less/more
    chevron (uses `AppTheme.textSecondary`, no new colors).
  - Body toggles with `AnimatedCrossFade` (200ms, per `context/style_guide.md`
    motion budget) between the item column and `SizedBox.shrink`.

## Files touched
| Path | Role |
|------|------|
| `frontend/lib/ui/screens/menu_screen.dart` | Category sort + collapsible `_MenuListState` |
| `context/architecture/menu-order-collapse.md` | This note |

## How to verify
```bash
cd frontend
flutter analyze lib/ui/screens/menu_screen.dart
flutter run -d chrome --dart-define=API_BASE_URL=http://localhost:3000
# Menu shows Starters → Mains → Breads → Desserts → Drinks; tap any header to collapse/expand.
```
