# Cart nav + solo-cart qty stepper

## Status
Implemented (frontend-only change).

## Problem
- `MenuScreen` (`/menu`) had no back affordance: `go_router` `go()` replaces
  the stack, so no OS/app-bar back arrow appears — user was stranded off `/`.
- `CartScreen` (`/cart`) same: title-only `AppBar`, static `× qty` trailing,
  no way back and no way to change amounts without returning to the menu
  (see screenshots: menu stepper vs cart static label).

## What was built
- `frontend/lib/ui/screens/menu_screen.dart`
  - `AppBar.leading`: back arrow → `context.go('/')`. One tap reaches home.
- `frontend/lib/ui/screens/cart_screen.dart`
  - `AppBar.leading`: back arrow → `context.go('/menu')` (logical parent —
    cart is opened from the menu badge).
  - `AppBar.actions`: home icon → `context.go('/')`, so home is still one tap
    from the cart (meets "back to home from cart" literally).
  - Empty state already linked to `/menu`; left untouched.
  - Replaced static `trailing: Text('× qty')` with `_CartQtyControls`
    (`[-] qty [+]`, compact density, matches `_QtyControls` idiom in
    `menu_screen.dart` but without duplicating its Add-button zero-state —
    cart rows never have qty 0 since `setQty(<=0)` removes the line).
    - Decrement calls `soloCartProvider.notifier.setQty(id, qty - 1)`;
      1 → 0 removes the row (tooltip flips to 'Remove').
    - Increment capped at live `MenuItem.stock`
      (`canIncrement: qty < item.stock`, button disabled at cap + guard
      inside `onIncrement`), so cart can't exceed inventory.
    - Rows keyed `ValueKey(item.id)` to preserve scroll on qty rebuilds.
    - Subtitle now `'{unit} each · {lineTotal} total'` so qty edits show
      immediate price feedback; subtotal footer unchanged.
  - No new colors/icons language: Material `arrow_back` / `home_outlined`,
    existing `AppTheme.textSecondary` only — per `context/style_guide.md`.

## Files touched
| Path | Role |
|------|------|
| `frontend/lib/ui/screens/menu_screen.dart` | Back-to-home leading |
| `frontend/lib/ui/screens/cart_screen.dart` | Back-to-menu leading, home action, qty stepper |
| `context/architecture/cart-nav-qty.md` | This note |

## How to verify
```bash
cd frontend
flutter analyze lib/ui/screens/cart_screen.dart lib/ui/screens/menu_screen.dart
flutter run -d chrome --dart-define=API_BASE_URL=http://localhost:3000
# /menu shows back arrow → / ; /cart shows back arrow → /menu + home icon → /
# /cart rows show [-] qty [+] ; - at 1 removes row ; + disabled at stock cap.
```
