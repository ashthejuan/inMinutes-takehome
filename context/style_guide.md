Design direction: clean, minimal, professional, functional — not decorative. This is a real product, not a portfolio piece.

Palette: monochrome grayscale/dark base with exactly one accent color — a calm, desaturated blue — used sparingly for primary actions, active states, and key data points only. No secondary colors, no gradients.

Typography: one typeface family, clear hierarchy through weight and size, not color. Generous whitespace over dense packing.

Motion: animations only where they clarify state change (transitions, loading, confirmation) — never decorative. Keep them fast and subtle (150–250ms, ease-out). If a screen works fine with zero animation, leave it static.

Hard no's — anti-slop constraints, follow strictly:
- No generic AI-template look: no default shadcn/Tailwind-starter spacing, no purple/blue gradient hero sections, no glassmorphism, no oversized rounded cards with soft drop shadows everywhere
- No decorative icons, illustrations, or emoji used as filler
- No every-element-gets-a-card syndrome — use borders/whitespace/hierarchy to separate content, not a card wrapper on everything
- No stock "SaaS landing page" component patterns bleeding into functional app screens
- Every visual choice should be justified by function — if you can't say why an element exists, cut it

Read the brief for each screen, infer what a focused, expensive-feeling utility app in this style should look like, and ship that — not a templated default.