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

1. **Shared vertex table** (LANDED, see `src/lib/vertices.ts`).
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
2. **Static per-charge flow** (this wave — LANDED, see `src/lib/curvature.ts`).
   One dial; the charge decides which edges bend and which way. Cubic Béziers
   at the display boundary, L1 enforced structurally.

   > **Corrected by building it — three times, and the first is the big one.**
   >
   > **(a) "flow as a function of the charge" is not drawable as stated at
   > rep-4.** A curve needs a MAGNITUDE and a SIDE. The magnitude may be any
   > symmetric function of the two adjacent charges; the SIDE may not, because
   > the six reflections relabel the charge by φ = (σ₂ σ₃) and choosing a cell
   > out of the pair {σ₂, σ₃} is choosing a fixed point of a transposition.
   > The obstruction is not theoretical: **48 edges of the depth-3 hexagon lie
   > ON a mirror line, where that reflection fixes the edge and SWAPS its two
   > cells — and 24 of those carry the pair {σ₂, σ₃}** [PROVEN]. So the
   > coboundary candidate survives only through the unique φ-stable quotient,
   > **V₄ → V₄/H**, and H is `figure.ts`'s own √6-fixing subgroup — the one the
   > game already scores on. The shipped law: *an edge curves exactly when its
   > two cells are INCOHERENT, and bows into the non-H side.* No mirror-line
   > edge is ever an H-wall, since h(x) = h(φx), so the law is never asked a
   > question it cannot answer. The guard-fire is the rejected candidate itself
   > (`V4_FULL_COBOUNDARY`), red on the six reflections and green on the six
   > rotations.
   >
   > **(b) The radices are NOT symmetric here.** At rep-9 the grade is
   > *invariant*, so φ₉ = id, nothing is unstable, and the FULL ℤ/3 coboundary
   > draws — sign included, since of two distinct grades exactly one is the
   > other's successor. **rep-4 can draw its charge only through V₄/H; rep-9
   > draws all of ℤ/3.**
   >
   > **(c) "Exact ring apexes at the REVERSIBLE angles" names the wrong angles
   > for this canvas.** `warp-findings.md` §R's unit condition is about
   > COMPOSING apexes, which a static flow does not do, and its table is stated
   > in the Cartesian ℤ[√3] frame. In the EISENSTEIN frame the figure actually
   > lives in, √3·rot90 = 2ω − 1 is the integral map, so the lattice-exact apex
   > angles are 60° and 120° and 30°/90°/150° are not. **Ring membership is a
   > statement about a frame.** At 60° — the FlowAngle the canvas already IS —
   > the apex over a cell edge is exactly the third vertex of the neighbouring
   > cell, so the apex is an INDEX into the vertex table and there is no ring
   > element, no √3 and no square root anywhere in the increment.
   >
   > Also load-bearing: the dial's ceiling is a MEASUREMENT, not a taste. At
   > `k/144` the midpoint sagitta is `(3/4)(k/144)` of a cell's height, so
   > `MAX_FLOW = 48` (= 1/3) is exactly Q3's measured-safe sagitta of ¼ of a
   > cell, and twice it is Q3's measured failure. `3·MAX_FLOW = REFINE` is that
   > sentence with the fractions cleared.
   >
   > **The two conventions draw different pictures** — 60 walls under `apex`
   > against 48 under `ifs` at depth 2 on the same triangles [MEASURED], because
   > `ifs` reorders the B/C roles and the recursion carries that down, so a
   > triangle's ADDRESS and hence its charge differ. The curvature is the first
   > thing in the program that makes §E's order-2-against-order-6 visible on the
   > plate. Both fields are equivariant.
   >
   > **The rep-9 law ships in the library and has no UI**, because the draw page
   > builds a rep-4 hexagon and nothing else. `Z3_GRADE_WALL` is tested at two
   > depths on `buildRep9Hexagon`; it is one argument away from being drawn.
   >
   > **The relief and the curve do not compose, and the exclusion is at the
   > source.** A Bézier is affine-invariant, so the sector view's transform
   > passes through it exactly; the relief's remap is radial and defined at
   > lattice VERTICES, and a control point is not a vertex. Each control turns
   > the other off and announces it.
   >
   > **The export still writes the straight figure**, flagged: `emit.ts` pairs
   > shapes position for position, so a curved file is a format decision and
   > deserves its own pass. Nothing in `emit.ts`/`artfile.ts` was touched, and
   > all three byte pins are green because flow 0 builds no field at all.
3. **Eased flow** under G1–G3 (this wave — LANDED, see `src/lib/morph.ts`).
   The dial retargets rather than writes; the picture walks the dozenal ladder
   to it; both endpoints are structural.

   > **Corrected by building it — four times, and two of them are about the
   > tests rather than the code.**
   >
   > **(a) The proportional clamp cannot be landed on a fixed integer
   > denominator, and it never fires anyway.** §12.1 zeroes the base weight and
   > rescales the overlays by 1/Σt. On integers over 144 that rescaling does not
   > exist — `Σ tᵢ·targetᵢ / Σ tᵢ` is not an integer over 144 or over any other
   > constant — so it is landed by moving the DENOMINATOR instead of the
   > numerators: unclamped weights `(144 − Σw, w₁ … wₙ)` over `den = 144`,
   > clamped weights `(0, w₁ … wₙ)` over `den = Σw`. The weights sum to exactly
   > `den` in both, which is "sum to exactly 1" with the fraction cleared, and
   > the overlay numerators are untouched, so the ratios are preserved
   > literally rather than to a rounding. That is why `CurvatureField` now
   > carries its own `scale`: the dial's denominator stopped being a constant.
   >
   > And then the clamp turns out to be **unreachable from this dial** [PROVEN].
   > At most one overlay is ever rising; a tick raises it by 1 and lowers every
   > departing one by 1, so **Σ steps ≤ 12** at every reachable state; and over
   > the finite domain that leaves — multisets of steps summing to at most 12,
   > all 272 of them enumerated — `Σ stop(sᵢ) ≤ 144` always, with equality
   > exactly on the seven mirror pairs `stop(a) + stop(12 − a) = 144`. Measured
   > over 6,700 driven states (regular cadences 1–15 ticks plus an irregular
   > script): worst Σ steps 11, worst Σ stops 142, up to **5 overlays alive at
   > once**, clamp fires 0 times. It ships tested anyway, driven directly past
   > what the dial can build, because a normalisation rule that is only correct
   > on the states one control happens to produce is not a normalisation rule.
   >
   > **(b) The guard-fire the brief predicted does not fire.** A float ladder
   > was to be caught by "its endpoints or sum or arrival-identity". None of the
   > three catches it: `Math.round(144·(3u² − 2u³))` at twelfths has endpoints
   > exactly 0 and 144, increments that telescope to exactly 144, strict
   > monotonicity, and an exact arrival — **every headline property of G2**.
   > What catches it is the MIRROR, and it fails at exactly the two samples the
   > cubic Hermite lands on a half-integer: `(18s² − s³)/6` at s = 3 and s = 9
   > is 22½ and 121½ — fold-re's own reason for shipping that ladder over 864
   > rather than rounding it into 144 — and round-half-up sends them to 23 and
   > 122, so `23 + 122 = 145`. The shipped ladder is caught by a second oracle
   > as well: its rising half has the closed form `stop(s) = 2s²`, the
   > increments being an arithmetic progression of difference 4.
   >
   > **(c) The linearity identity is `den ×`, not `144 ×`.** `cp = scale·P +
   > flow·(A − P)` is linear in the pair, so an eased build at `num = den·k` is
   > exactly `den` times the static build at dial `k` — the same integers one
   > refinement apart, on the ×`REFINE·den` lattice rather than a fixed ×REFINE².
   > `controlPoints` took an optional `scale` and `buildCurvature` split into a
   > guard plus a shared builder; every increment-2 call site is unchanged in
   > signature, behaviour and output, and the identity is the SAME code rather
   > than a second formula that agrees.
   >
   > **(d) One state, not two.** The page's `flow` is now `morph.base` rather
   > than a `useState` the driver keeps in step with a registry — two writers
   > for one value is the bug `stopEasing` exists to avoid. With one state the
   > two acceptance lines are not maintained but true: at rest the registry is
   > empty and the memo takes `buildCurvature` at an integer dial, and arrival
   > is absorption, so the tick that lands is the tick that returns to the
   > static path. The slider's thumb reads `morphTarget` — where the user put
   > it — while the picture reads the composed dial.
   >
   > Also load-bearing: **the combinatorics are dial-independent** [PROVEN over
   > the whole 1…48 range and three eased denominators, both radices] — `flow`
   > and `scale` reach exactly one expression in `wallsOf`, the `controlPoints`
   > call — so an ease slides two points along a fixed anchor→apex segment and
   > never rebuilds a wall set. Nothing is cached on the strength of it; it is
   > the reason nothing NEEDS to be. Cost [MEASURED]: 0.64 ms per tick at depth
   > 3 and 7.2 ms at depth 5, the deepest canvas, for the field and every path
   > string together, against a 30 ms cadence. Ticks are COUNTED, so a slow
   > machine stretches the transition and never skips a rung.
   >
   > **The export is still straight**, and still on purpose: increment 2's
   > deferral stands, `emit.ts` and `artfile.ts` are untouched, and the three
   > byte pins are green without being looked at.
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

  > **Met at increment 3, structurally.** Arrival is ABSORPTION: `morph.tick`
  > moves the overlay into the base and empties the registry, so the arrived
  > render is `buildCurvature(table, charges, law, target)` — the same call with
  > the same argument, not a comparison. Return to zero empties onto `base = 0`,
  > where that call returns `null` and the board takes its pre-curvature branch.
  > The tick count is exact and exhaustive: all 49 × 49 ordered dial pairs, 12
  > ticks for every move and 0 for every stay, registry empty after; a departure
  > reaches exactly 0 in exactly its starting step's ticks, all twelve rungs
  > checked, and the entry is DELETED rather than held at zero. Containment
  > holds at every tick and not only at the ends — every composed dial is a
  > convex combination of dials at or below the ceiling, so it is one too.
- The charge → flow binding visible on the plate: same-coset cells curve
  the same way, and the `data-` provenance in exports says which.

  > **Half met at increment 2.** On the plate it is met and measured — the
  > walls are exactly the incoherent pairs, 4 × 66 of the 552 interior edges at
  > depth 3, and the panel reads the count off the field rather than stating a
  > constant. In the FILE it is not: the export writes the straight figure and
  > carries no curvature provenance, because `emit.ts` pairs shapes position
  > for position and neither it nor `artfile.ts` was touched. That is the one
  > acceptance line increment 2 leaves open, and it is open on purpose.
