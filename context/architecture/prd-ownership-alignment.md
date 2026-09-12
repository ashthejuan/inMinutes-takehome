# PRD ownership alignment

## Status
Done — PRD now describes per-user ownership (was: shared editable cart).

## What changed (in `context/PRD.md`)
- §2.2: cart adds/updates/removes are **own-line only**; attribution badge = ownership badge.
- §5.3.1: invariant rewritten — lines keyed `itemId:addedBy`, only owner may edit/remove, server derives `addedBy` from socket identity.
- §5.4 (new): Design Note preserving the **original request** (shared editable lines, display-only `addedBy`, cross-user LWW) + **WHY** we diverged (cheap key change, no-steal UX, fewer conflicts, spoof-proof).
- FR-04: display-only attribution → per-user ownership requirement.
- §7.2 / §8.1 / §8.2 / §10 / §13: cart Map key, `cart:sync` shape (`[lineKey] → { itemId, qty, addedBy, price }`), mutation validation (own line only), OCC scope (same-item different-user = two lines, no conflict), `ValueKey(lineKey)`, family per `lineKey`.
- §12 UI: one row per owner line — steppers on own line, static `× qty` on others'.
- §17 acceptance: split old "two users edit same line" row into same-item → two lines vs same-owner race → LWW + `VERSION_CONFLICT`.

## Why
PRD contradicted the shipped code (`backend/cart.js` lineKey, `backend/server.js` socket-identity `addedBy`, `backend/checkout.js` multi-line aggregate). Per-user lines are cheap and arguably nicer for a group cart, so PRD was aligned to code — with the original shared-cart request kept on record in §5.4.

## Files
| Path | Role |
|------|------|
| `context/PRD.md` | §§2.2, 5.3.1, 5.4, 7.2, 8.1, 8.2, 10, 12, 13, FR-04, §17 aligned to ownership |
| `context/architecture/per-user-cart-lines.md` | Existing implementation record (unchanged, linked from §5.4) |
| `backend/cart.js` | Source of truth for lineKey ownership (no code change) |
| `backend/server.js` | Source of truth for socket-identity addedBy (no code change) |

## How to verify
- Open `context/PRD.md` §§5.3–5.4 — original request + WHY deviation present, no "anyone can edit any line" remains.
- `rg "display-only|any participant may update" context/PRD.md` → no stale shared-cart rule.
