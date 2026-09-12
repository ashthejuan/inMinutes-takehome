# Group cart blank screen fix

## Status
Implemented.

## Problem
After the host created a group order, `/group/:sessionId` showed only the
AppBar. Body content (join code, empty state, Mark Ready, Place Order) never
laid out. Chrome console flooded with
`Cannot hit test a render box that has never been laid out`.

## Root cause
`AppTheme` set `FilledButton` / `OutlinedButton` `minimumSize` to
`Size.fromHeight(48)` → width `∞`. The group cart puts `FilledButton.tonal`
(Mark Ready) in a `Row` with a `Spacer`. Unbounded max width + infinite min
width fails layout for the whole `Scaffold` body.

## What was fixed
1. **`theme.dart`** — `minimumSize: Size(64, 48)` so inline buttons layout;
   stretch columns (home / cart) still expand to full width.
2. **`collaborative_cart_screen.dart`** — back + browse-menu actions, Copy for
   join code, empty-state CTA → `/menu`.
3. **`menu_screen.dart`** — while `session.isInSession`, qty steppers call
   `SessionController.mutate` (group cart); bag icon returns to group cart;
   hide Start Group Order mid-session.

## Files touched
| Path | Role |
|------|------|
| `frontend/lib/theme.dart` | Finite button min width |
| `frontend/lib/ui/screens/collaborative_cart_screen.dart` | Nav + copy + empty CTA |
| `frontend/lib/ui/screens/menu_screen.dart` | In-session group mutations |
| `context/architecture/group-cart-blank-fix.md` | This note |

## How to verify
1. Hot restart the Flutter app (theme change needs restart, not just reload).
2. Start Group Order → body shows join code, Browse menu, Mark Ready, Place Order.
3. Browse menu → Add item → bag badge updates → back to group cart shows the line.
