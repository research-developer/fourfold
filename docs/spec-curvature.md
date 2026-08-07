# Spec — curvature: flow bound to the charge, on a shared-vertex figure

**Status:** open. Written before the code, like `spec-gesture-export.md`.
Everything below cites a committed artifact; nothing here is aspiration.

## The goal, in one sentence

Cells curve according to their Galois class — `flow` as a function of the V₄
charge (rep-4) or the ℤ/3 grade (rep-9) — so the drawing *is* the automorphism
rather than an illustration of one.

## What is already proven, and where

| fact | artifact |
|---|---|
| `buildHexagon`'s six sectors ARE the FlowAngle {6, 60°} at flow 0 | `docs/warp-findings.md` |
| the apex needs no square root: `apex = mid ± (cot(θ/2)/2)·rot90(Q−P)` | same |
| 30°/90°/150° have `tan` a **unit** (reversible); 60° integral forward only; 120° escapes to (1/3)ℤ[√3]; non-multiples of 30° leave ℚ(√3) | same |
| curvature as ε̄^k has **no denominator**, grows log₂(2+√3) ≈ 1.900 bits/level, k = 28 in one machine word | `docs/warp-findings.md`, `docs/ring-lns-fit.md` |
| vertex redundancy is ~6× (limit exactly 6, boundary deficit); per-cell copies FOLD under motion (260 vs 256) | `docs/warp-findings.md` |
| the seam identity α_L + α_R = 1 survives every warp **on a shared edge** — it is an orientation fact, not a straightness fact | same, Q5 |
| at a **T-junction** the topology fails first, at any ε; stitching the coarse edge through the moved vertex restores it exactly | same |
| curvature does NOT force the exact-area tier; that tier's unique value is **detection** (only it sees a 1/1024 crack) | same |
| containment survives a warp only up to sagitta ≲ 1/3 fine cell (λ ≲ 1/s²), and fails inevitably under refinement | same, Q3 |
| the substrate for k > 28 exists: ring-LNS spine, scale in the mantissa, unit exponent for curvature; RNS norm check pays the width of the answer | `docs/ring-lns-fit.md`, RALL-611 |

## The four laws

**L1 — One resolution per edge.** A warp may not be evaluated at two different
resolutions on the same edge. Every failure Q3 and Q5 found reduces to this.
Concretely: an edge shared by cells of different scales renders the FINER
evaluation on both sides (the coarse edge stitches through the finer vertices).

**L2 — Containment is decided pre-warp, always.** The warp is a display
bijection; the partition is combinatorial. §9-style centroid tests on drawn
coordinates are forbidden — they work at low curvature and fail at λ ≳ 1/s²,
which is the worst kind of bug. `holdMask`/`seedMask`/`clipMask`, the plate,
the brush, the charge, the arms: none may ever read a warped coordinate.

**L3 — Identity at zero, exactly.** flow = 0 must produce byte-identical
output to today's figure — not near-identical. The parameterisation is the
unit ε̄ (deviation composes by multiplication; ε·ε̄ = 1 with no drift), so zero
deviation IS the lattice figure as an arithmetic identity.

**L4 — Vertices are owned once.** Curvature ships only on the shared-vertex
figure (the first increment below). A moved vertex with per-cell copies folds
the mesh; with single ownership every incident cell moves together and no
cell changes owner.

## The GradMorph disciplines (fold-re theory.md §12, adopted as requirements)

**G1 — A morph is a normalized position.** Animated curvature (flow easing
0 → k, breathing, per-charge phase) is a sparse overlay `{target, t}` with t
an exact rational and base weight 1 − Σt. Two transitions may run at once
without either owning the value. The morph lives ENTIRELY at the display
boundary — `flatten` never mixes; NO BLENDING stands.

**G2 — The easing ladder is a finite table of exact rationals** with
endpoints exactly 0 and 1. Default: the dozenal smoothstep over denominator
144 (increments 2,6,10,14,18,22 mirrored). Exported SVG keyframe stops are
exact twelfth-based rationals, stated in the file.

**G3 — Exact-zero termination is the reclamation rule.** A departing ease
drives t to EXACTLY 0 in bounded ticks and the overlay entry is DELETED.
flow returning to 0 lands on L3's identity, not near it.

## Increments, in order

1. **Shared vertex table** (this wave — LANDED, see `src/lib/vertices.ts`).
   Derived from the address algebra — the derivation is the authority, the
   table is a memo. No drawing change; byte identity on all pinned exports;
   every existing test unmodified.

   > **Corrected by building it.** "Table-vs-derivation agreement" is TWO
   > different tests and conflating them makes the increment vacuous:
   > dereference-vs-fresh-derivation is a *memo-integrity* check (trivially
   > true unless indexing is corrupt), while derivation-vs-`buildFigure` is
   > the *independent oracle*. Both ship. Also load-bearing: the census must
   > be computed from `cells`, not `vertices.length`, or the index guard-fire
   > cannot fire — a census counting stored vertices reports the same number
   > either way. And the closed forms are `(s+1)(s+2)/2` (triangle) and
   > `3s²+3s+1` (hexagon) for the distinct counts; `9s+6`/`18s+6` are the
   > *deficits*. Increment 2 inherits these distinctions by name.
2. **Static per-charge flow.** One flow value per charge class, exact ring
   apexes at the reversible angles, rendered as cubic Béziers at the display
   boundary. The seam rule L1 enforced structurally (edge owned once, curve
   emitted once, referenced by both cells — the "emit both sides from one
   job" principle).
3. **Eased flow** under G1–G3.
4. **Per-cell curvature** (ε̄^k per cell) only when a use case demands k
   variation within a class — this is what would justify adopting the
   ring-LNS substrate, recorded in `ring-lns-fit.md` as a design decision
   not yet taken.

## Out of scope, stated

- Tweens beyond the display-side morph (no position interpolation — there is
  no symbol; moving paint is a different gesture, not an interpolation).
- Independent looping of nested timelines (LCM cost stands; play-once holds).
- The exact-area tier as a RENDER mode (it ships as the crack detector).
- Any angle outside {30°, 60°, 90°, 120°, 150°} (ring escape, measured).

## Acceptance

- flow = 0: byte-identical to the pre-curvature figure on all three pinned
  export paths, plus canvas structural identity (the old code path taken,
  not a new one that agrees).
- A curved seam: α_L + α_R = 1 exact on every shared edge; the T-junction
  stitch rule tested at a scale boundary with a guard-fire.
- No warped coordinate reaches any mask, plate, or brush decision —
  enforced by module boundary (the warp module exports display types only),
  not by review.
- Ease arrival: bit-identical to the un-eased render of the target state;
  ease return: L3's identity. Overlay registry empty after the ladder's
  tick count exactly.
- The charge → flow binding visible on the plate: same-coset cells curve
  the same way, and the `data-` provenance in exports says which.
