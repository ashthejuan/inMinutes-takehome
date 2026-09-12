# Home Screen — Purple Gradient Half-Circle Hero

## Status
Applied.

## What changed
Home screen heading + supporting line are centered over a Stripe Purple gradient semicircle that hangs down from the top edge. Buttons stay at the bottom; copy uses light text for contrast on the accent wash.

## How
- `Stack`: semicircle clipped with `ClipRRect` + `LinearGradient` (`accent` → transparent)
- Seeded `_GrainPainter` overlays light/dark 1.25px flecks for a granient (film-grain) look
- Diameter ≈ `1.35 ×` screen width, centered horizontally, height = half diameter
- Title/subtitle: `TextAlign.center`, white / near-white

## Files touched
| Path | Role |
|------|------|
| `frontend/lib/ui/screens/home_screen.dart` | Layout + grainy gradient semicircle |
