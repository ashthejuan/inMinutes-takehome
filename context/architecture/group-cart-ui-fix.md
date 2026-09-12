# Group cart UI fix — button overlap + item names

## Status
Fixed.

## Problem
1. `Mark Ready` sat in the bottom-right of the subtotal row while `Place Order` was a `FloatingActionButton.extended` — the FAB covered Mark Ready (and looked like a second button stuck behind Place Order on host).
2. Cart rows rendered `line.itemId` instead of the menu item name.

## Fix
| Path | Change |
|------|--------|
| `frontend/lib/ui/screens/collaborative_cart_screen.dart` | Removed FAB. Bottom: subtotal/status + Mark Ready above a full-width `Place Order` bar. Rows look up `MenuItem.name` from `menuProvider` (`itemId` only if menu not loaded / missing). |

## Files changed
- `frontend/lib/ui/screens/collaborative_cart_screen.dart`
- `context/architecture/phase-3-checkout.md` (FAB note updated)
