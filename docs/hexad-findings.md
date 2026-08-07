# Hexad findings — one hue class is the arm's flag bundle

**Status:** measured on one exported artifact, 2026-08-07. Everything quantitative
below was computed from the file's own `fourfold:art:1` payload by
`docs/hexad-findings/analyze.mjs` (committed beside this note; it runs on any
full-canvas hexad export). Labels per the standing discipline: MEASURED is this
file, PROVEN cites a committed proof elsewhere, CONJECTURED is neither.

## The artifact

A depth-5 hexagon (6,144 cells), filled with the 6-fold brush under the `hexad`
scheme — six hues 60° apart, one per orbit member (`schemes.ts`). Whatever
gesture sequence produced it, the RESULT is the canonical mode-6 hexad
colouring: every hue owns exactly 1,024 cells, and all six hues have the
IDENTICAL block census [MEASURED]. Gesture order washed out completely, which is
itself worth recording: the fill is a property of the figure, not of the hand.

## The census, and the closed form

Decomposing one hue class into maximal address-prefix blocks — exact rep-4
subtriangles, no geometry involved — gives, for EVERY hue [MEASURED]:

| block size (cells) | 64 | 16 | 4 | 1 |
|---|---|---|---|---|
| blocks per hue | 6 | 18 | 42 | 184 |

and the generic part has a closed form. Writing addresses in `REP4_LETTERS`
order (digit 0 = A, 1 = B, 2 = C, 3 = X — `plate.DIGITS` reads this order), the
green class (`#4bd417`) in every sector is

```
u · C · (anything)     with u ∈ {A,X}+ and u ≠ X^k
```

— walk down the sector's ARM (the mirror-fixed spine: addresses over the two
letters the sector's reflection fixes), and take every subtree hanging off it on
one chosen side. The arm is a BINARY tree inside the quaternary tree, so at
arm-depth j there are 2^j − 1 admissible arm nodes (the pure-X node excluded),
each shedding one flag of 4^(5−j−1) cells:

| arm depth j | 1 | 2 | 3 | 4 |
|---|---|---|---|---|
| flags per sector | 1 | 3 | 7 | 15 |
| flag size | 64 | 16 | 4 | 1 |

**Mersenne counts against a base-4 geometric tower.** Per sector that is
64 + 3·16 + 7·4 + 15 = 155 cells; six sectors plus the 94 residue cells below
give exactly 1,024. At general depth d the same form gives flags of size
4^(d−1−j) with 2^j − 1 per sector, j = 1 … d−1 — the observed series is "the
start of" the infinite one only because d truncates it: every added depth
extends it by exactly one rung.

## The residue — where the wheel actually turns

Three families do not join the generic series, and each sees a different
subgroup of C₆ ≅ C₃ × C₂ [MEASURED]:

- **The root flags** (`B·…` and `C·…`, 256 cells each — arm depth 0) are split
  between the other two hue pairs, subdivided one level down by the same
  first-departure rule. This is why the series starts at 64 and not 256.
- **The ftype spine flags** (`X^j·B·…` and `X^j·C·…` — the prefix is PURE X,
  which is exactly the classical ftype classes) are carved out of the generic
  rule and distributed with the root-flag families, orientation-striped: the
  painting DISTINGUISHES the mixed {A,X} arm from the pure-X ftype spine.
- **The arm itself** (all-{A,X} words) is orientation-striped — one hue on even
  sectors, its antipodal hue (180° across the wheel) on odd. The arm sees only
  the C₂.
- **The tip** — the single all-X cell, one per sector — walks the entire wheel,
  six sectors, six hues. It is the only cell whose hue orbit is free.

So: generic flags are rotation-blind (the same address pattern carries the same
hue in all six sectors), the arm sees only orientation, and the tip sees
everything. The wheel's C₃ acts only at the two coarsest strata.

## What this means, at the honest labels

- The arm as the canonical mirror-fixed structure, existing at exactly radices
  4 and 9, is PROVEN in `docs/rep9-charge.md`. This export is its display-side
  witness: the hue boundaries ARE the arms, and one hue class is the arm's
  one-sided flag bundle. The hue of a generic cell is *the side on which its
  address first breaks the sector's mirror symmetry* — a chirality refinement
  of ftype (ftype strips only X; this strips the whole mirror-fixed pair).
- The binary-arm-inside-quaternary-canvas is a mixed-radix object in exactly
  `scale.ts`'s sense, with the radix varying along a PATH rather than a level.
- The flags accumulate toward the tip as a geometric tower — the same nesting
  shape as the ε̄^k hexagon tower the ring-LNS spine addresses
  (`docs/ring-lns-fit.md`). Whether arm-depth j can literally ride the LNS
  exponent axis is CONJECTURED — but this is the first drawing with a concrete
  candidate for what that exponent would index: the flag series, one rung per
  arm level.

## Reproduction

`node docs/hexad-findings/analyze.mjs <export.svg>` — decodes the payload,
decomposes every hue into maximal prefix blocks, prints the census and the
per-sector block lists. It asserts nothing; it is an instrument, not a test.
The figures above came from
`fourfold-hexagon-d5-b6-hexad-20260807-064714.svg`.
