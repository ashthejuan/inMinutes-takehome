# Accent Color — Stripe Purple

## Status
Applied.

## What changed
Primary accent updated from desaturated blue (`#4A6FA5`) to Stripe Purple (`#635BFF`). Still a single accent on the monochrome base; used for primary actions, active states, and key highlights via `AppTheme.accent` / `ColorScheme.primary`.

Menu row **Add** control uses `FilledButton` so it picks up the purple accent (was outlined/neutral).

## Files touched
| Path | Role |
|------|------|
| `frontend/lib/theme.dart` | `AppTheme.accent` → `#635BFF` |
| `frontend/lib/ui/screens/menu_screen.dart` | Qty `Add` → `FilledButton` |
| `context/style_guide.md` | Palette guidance updated |
| `context/architecture/phase-0.md` | Theme note updated |
