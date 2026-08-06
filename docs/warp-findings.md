# Vertex-shared geometry with a warp at the display boundary — a scoping verdict

Scope: is the owner's inversion sound — *the vertices are what warrant shared
allocation; the whole shape derives from a single FlowAngle-based hexagon, then
rep-tiled; triangles are the lemmas* — and does the framing that goes with it
hold: *containment is decided on the straight integer lattice; curvature and
vertex motion are a WARP at the display boundary, and a warp is a bijection so
`theory.md` §9 is untouched*?

Everything below was decided by computation in `test/warp.test.ts` against
`src/lib/warp.ts`, with `src/lib/figure.ts` and `src/lib/reptile.ts` as the
oracles. Labels follow the house convention:

- **[PROVEN]** exhaustive computation, decided by an oracle independent of the
  thing under test, with a guard-fire mutation shown lethal.
- **[MEASURED]** a number this run produced, not exhaustive over its domain.
- **[DERIVED]** follows from a [PROVEN] fact by an argument stated here.
- **[ANALOGY]** structural resemblance only. Not evidence.

**Three of the brief's five framings were wrong, and the most important one was
wrong in both directions at once.** Q5 is the headline and it is a refutation.

**Float:** `src/lib/warp.ts` contains none — no `Math.`, no division on
`number`, no `number` used as a coordinate past the lattice. Warped coordinates
are exact rationals over `bigint`; ring elements are exact `a + b√3`; even the
decimals quoted below are rendered in `bigint` by `rToFixed`. `test/warp.test.ts`
has float in exactly one `it`, marked FLOAT ORACLE, which cross-checks the ring
values of §R against `Math.tan` and decides nothing. The display boundary this
work is *about* is `figure.toXY` and `hexagon.latticeToPixel`; neither is touched
and neither is called.

---

## Q1 — the redundancy. The brief's ~6× is right, and the limit is exactly 6.

**Verdict: confirmed [PROVEN], with the approach law measured.**

Per-triangle storage holds 3 slots per cell. The census walks the shipped
figure's own `bary` triples and counts distinct exact integer lattice points.

| canvas | radix | scale s | cells | slots | distinct | ratio | deficit |
|---|---|---|---|---|---|---|---|
| triangle | 4 | 2 | 4 | 12 | 6 | 2.0000 | 24 |
| triangle | 4 | 8 | 64 | 192 | 45 | 4.2667 | 78 |
| triangle | 4 | 32 | 1,024 | 3,072 | 561 | 5.4759 | 294 |
| triangle | 4 | 64 | 4,096 | 12,288 | 2,145 | **5.7287** | 582 |
| triangle | 9 | 3 | 9 | 27 | 10 | 2.7000 | 33 |
| triangle | 9 | 27 | 729 | 2,187 | 406 | 5.3867 | 249 |
| triangle | 9 | 81 | 6,561 | 19,683 | 3,403 | **5.7840** | 735 |
| hexagon | 4 | 2 | 24 | 72 | 19 | 3.7895 | 42 |
| hexagon | 4 | 32 | 6,144 | 18,432 | 3,169 | **5.8163** | 582 |
| hexagon | 9 | 27 | 4,374 | 13,122 | 2,269 | **5.7832** | 492 |

**The limit is 6 and it is approached strictly from below, never reached
[PROVEN].** The accounting is exact and leaves nothing to interpretation:
Σ_v deg(v) = slots identically, so

```
slots = 6·V − Σ_v (6 − deg v)
```

and every term of that sum sits on the **boundary** — interior vertices have
degree 6 and contribute zero. The degree histogram is the whole explanation:

- triangle: 3 corners of degree **1**, 3(s−1) edge vertices of degree **3**,
  (s−1)(s−2)/2 interior of degree **6**; deficit = **9s + 6**.
- hexagon: 6 corners of degree **2**, 6(s−1) edge vertices of degree **3**;
  deficit = **18s + 6**.

Checked at every depth measured, and cross-checked against `triangleBoundary`:
`distinct − |boundary| = #(degree 6)` exactly.

> **The radix does not enter [PROVEN].** Both radices obey the same two closed
> forms *in the scale*: `distinct = (s+1)(s+2)/2` and `deficit = 9s + 6` on the
> triangle; `3s² + 3s + 1` and `18s + 6` on the hexagon. That is forced once
> `rep-tile-findings.md` Q2's "rep-4 ∘ rep-9 = rep-36, the same 36 triangles" is
> taken seriously — at equal scale the two radices produce the same point set, so
> they cannot disagree about a count of points. Redundancy is a property of the
> **canvas and the scale**, never of the radix.

Guard-fire: de-identify one vertex per cell (exactly what per-triangle storage
permits) and distinct rises 153 → **364** at depth 4, ratio falls. The census
notices [PROVEN].

**So the shape of the saving is: ~6× on slots, but only ~2× on distinct objects
against cells** (2,145 vertices for 4,096 cells). Sharing vertices roughly halves
the number of geometric objects and cuts the slots by six.

---

## Q2 — log versus linear. Exact, and the denominator does **not** grow.

**Verdict: the brief's worry was misplaced; the answer is better than hoped
[PROVEN].**

An address is a descent path and each digit is an affine map, so a cell is a
product of *d* maps applied to the root — **O(d) time, O(1) space** (one 3×3
integer accumulator). Written as integer weight matrices over the parent's own
vertices:

```
child_i = Σ_j W[i][j] · V_j / k          (rows sum to k, the edge division)
(W_inner ∘ W_outer)[i][m] = Σ_j W_inner[i][j] · W_outer[j][m]
```

`figure.ts` starts its walk at (scale·e₀, scale·e₁, scale·e₂), so the scale
cancels and **the cell's stored barycentrics are literally the rows of the
accumulator**.

**Agreement [PROVEN].** Derived == `buildFigure`, cell for cell, all three
coordinates: rep-4 `apex` **4,096**, rep-4 `ifs` **4,096**, rep-9 **6,561**. Zero
mismatches. Independently, the derived cell *set* equals `reptile.subdivide`'s at
k = 2 (depths 1–4) and k = 3 (depths 1–3), as canonical point-set keys — an
oracle that knows nothing about letters, frames or `figure.ts`.

Guard-fire: permute two role slots in the X map — same three points, only the
role order moves, the exact error a point-set comparison cannot see — and depth 5
reports **3,416** coordinate mismatches over 1,024 cells [PROVEN].

### Does the derived path stay exact? Yes, and there is no growing denominator.

**[PROVEN].** A product of integer matrices is an integer matrix. After *d* levels
there is exactly **one** denominator — the scale, the product of the edge
divisions — and every row sums to it. Verified on rep-4 words, rep-9 words, and
**mixed** words, which is where a per-node denominator would have to appear:

| word | scale | `scaleOfWord` | row sums |
|---|---|---|---|
| `AXBC` | 16 | 16 | 16, 16, 16 |
| `abcuvw` | 729 | 729 | 729, 729, 729 |
| `AXaBu` | 72 | 72 | 72, 72, 72 |
| `xyzABC` | 216 | 216 | 216, 216, 216 |

> **The cost law, and it is not fold-re's [PROVEN].** Affine descent costs
> **log₂(k) bits per level** — 1 for rep-4, log₂3 ≈ 1.585 for rep-9 — and
> accumulates **no denominator at all**, only a single one equal to the scale.
> fold-re §11's `D_k = D0·8^k`, three bits per level, is the **cubic Bézier
> subdivision** law and is forced by the *degree*, not by composition. They are
> different laws about different objects and the brief conflated them.
>
> A rep-9 map's denominator 3 does **not** compound into 3^d as a common factor
> needing clearing: it is the same single scale denominator the rep-4 path has,
> arrived at in bigger steps. This is `rep-tile-findings.md` Q4's cost law
> restated for the derive-on-demand path.

At this program's `MAX_DEPTH` of 5 the widest accumulator entry is **32**. The
descent would not leave `number`'s exact range until depth **53**.

### The costs, measured

| depth | cells | distinct V | derive all (O(d)) | build table (O(V)) | lookup all (O(1)) |
|---|---|---|---|---|---|
| 4 | 256 | 153 | 0.15 ms | 0.39 ms | 0.007 ms |
| 6 | 4,096 | 2,145 | 2.40 ms | 1.54 ms | 0.124 ms |
| 8 | 65,536 | 33,153 | 33–45 ms | 13–35 ms | **0.26–0.31 ms** |

[MEASURED; the assertions in the test are on operation counts and space, which
are exact, plus one inequality with two orders of magnitude of headroom.]

**Read:** materialising costs about as much as one full derivation pass, and
buys a lookup that is **~130× faster**. Deriving is the right default for
*random access to a few cells at unbounded depth*; the table is the right default
for *anything that touches every cell more than once* — which is every render.
They are not competitors: the table is a **cache of the derivation**, and the
derivation is what makes the cache reconstructible rather than authoritative.

### The unit parameterisation — the owner's correction, tested

The owner's correction (relayed mid-run): park the identity so that a regular
hexagon side is the zero of flow and angle, make curvature a **deviation**, and
deviations compose by **multiplication**. Then everything turns on one property of
the per-level factor.

> **N(x) = ±1 (a UNIT) → x^k *and* x^(−k) are algebraic integers at every k. No
> denominator ever appears, in either direction** [PROVEN, k = 0..60, with the
> Pell invariant a² − 3b² = 1 checked at every power rather than inferred from
> multiplicativity]. `ε·ε̄ = 1` exactly; N(ε̄) = 1; ε̄ = 2 − √3 = tan(π/12).

| factor | apex angle | N | integral forward | integral **backward** | denominator |
|---|---|---|---|---|---|
| ε̄ = 2 − √3 | 30° | 1 | yes | **yes** | never |
| ε = 2 + √3 | 150° | 1 | yes | **yes** | never |
| 1 | 90° | 1 | yes | **yes** | never |
| √3 | 60° | −3 | yes | **no** | on the inverse |
| √3/3 | 120° | −1/3 | **no** | yes | 3^⌈k/2⌉ |

**"Unit", not "integral", is the right condition [DERIVED].** A rep-tile needs
both directions — refine down, resolve prefixes up — so a factor that is integral
forward and not backward is an escape even though it looks safe.

**The precision lookahead [PROVEN].** bits(ε̄^k) rises by 2 nine times then 1, in
a period of 10 — **19 bits per 10 levels**, which is log₂(2 + √3) = 1.9004… to
four places, knowable from the factor alone without computing it. A JavaScript
`number` runs out at **k = 29** (`safeIntegerDepth(ε̄) = 29`).

### On BigInt, since it was challenged

Two width laws, and they must not be confused:

| path | per-level cost | denominator? | leaves 2^53 at |
|---|---|---|---|
| rep-tile descent, rep-4 | 1 bit | no (single denom = scale) | depth 53 |
| rep-tile descent, rep-9 | log₂3 ≈ 1.585 bits | no | depth 33 |
| FlowAngle unit composition | ≈1.9 bits | **no** | k = **29** |
| FlowAngle non-unit (120°) | ≈0.79 bits of denominator | **yes**, 3^⌈k/2⌉ | k ≈ 67 |
| fold-re cubic Bézier §11 | 3 bits | yes, D0·8^k | k = 16 from D0 = 48 |

**The proposal does not need BigInt.** At `MAX_DEPTH` 5 the descent's widest
entry is 32, and unit composition is safe to 29 levels.

**The instrument does** [MEASURED]. `warp.ts` decides Q3 and Q5 by *exact
rational polygon clipping* — intersection parameters, affine combinations at those
parameters, areas that are sums of products of them. `ratWidth()` reports the
widest values actually formed on the Q5 run: **45-bit numerators, 43-bit
denominators**, whose pairwise products reach ~90 bits. That is past 2^53, so the
choice is forced *for the measuring apparatus*, not for the thing measured.

`tsconfig.json` targets ES2017, where BigInt **literals** are a syntax error while
the `BigInt()` constructor and the `bigint` type (via `lib: esnext`) are fine —
so `warp.ts` writes `B0`, `B1`, … and `rat()` accepts `number | bigint` so no
caller writes a literal. **An ES2020 target bump is the cleaner long-run fix and
is deliberately not made here**; it is a build-config change with browser-support
implications and belongs in its own diff. `tsc --noEmit` and `eslint` are clean
as it stands.

---

## Q3 — does a warp preserve containment? **Not across scales. It is a threshold, and the threshold vanishes under refinement.**

**Verdict: the brief's framing is REFUTED [PROVEN].** "A bijection cannot change
which cell a point is in" is true of the *set-theoretic* question and irrelevant
to the one §9 actually asks.

Two readings of a warp, and keeping them apart is most of the answer:

- **POINTWISE** — W is a function of the plane. The image of a centroid is not the
  centroid of an image. **256 / 256** cells differ at depth 4 under a non-affine
  shear; **0 / 256** under an affine one [PROVEN]. The shear used is a genuine
  bijection of ℚ² with an exhibited inverse, checked on every centroid.
- **VERTEX** — W is evaluated at the vertices of one chosen scale and the drawing
  joins the images with straight lines. This is what a renderer does, and it is
  **affine on each cell of that scale**. Which is exactly why its failures are
  never local: a cell always contains its own centroid.

**Affine control [PROVEN]:** four different affine warps × four (fine, δ) pairs →
**0 mismatches, 0 boundary hits**, everywhere.

### ★ The law

Cross-scale containment survives a non-affine warp **only while the warp's
sagitta over a coarse cell's edge stays below the fine centroid's own margin**.
For the shear W(a,b) = (a + λb², b), the chord through two warped endpoints
deviates from the true image by λ·t(1−t)(Δb)², so the sagitta over a coarse edge
of extent s is **λs²/4**; the margin is a fine cell's centroid distance to its own
edge, **1/3**.

| coarse:fine ratio s | λ = 1/s² (sagitta 1/4) | λ = 2/s² (sagitta 1/2) |
|---|---|---|
| 2 | **0 mismatches** | 64 |
| 4 | **0 mismatches** | 56 |
| 8 | **0 mismatches** | 112 |

[PROVEN — the right-hand column is the guard-fire.] The tolerable curvature
scales as **1/s²**, and the analytic derivation and the measurement bracket the
same constant: predicted λ* = 4/(3s²) ≈ 1.33/s², measured between 1/s² and 2/s².

**The threshold is a property of the depth gap, not of the fine depth** — the same
ratio gives the same verdict from figures at depths 4, 5 and 6 [PROVEN].

### ★★ And the failure is inevitable under refinement

Hold the warp fixed **in screen terms** and refine. The sagitta is then fixed too,
but the margin — one third of a fine cell — halves at every level.

| fine depth (coarse root at depth 2) | λ in fine units | mismatches |
|---|---|---|
| 3 | 1/8 | 0 |
| 4 | 1/16 | 0 |
| 5 | 1/32 | **112** |
| 6 | 1/64 | **616** |

[PROVEN.] **A warp that is safe at one resolution stops being safe at a deeper
one, with no change to the warp at all.**

> **What this costs, stated rather than assumed.** Containment must be decided
> **pre-warp, always** — which is fine, and is what the brief proposed. What is
> *not* fine is the accompanying claim that §9 is therefore "untouched". §9 is a
> **cross-depth** theorem and its whole purpose is mixed-depth rendering; a
> non-affine warp breaks the cross-depth half of it at a computable budget. The
> honest statement is: **§9 decides ownership, and the warp must not be asked to
> re-decide it.** Any code that tests containment on warped coordinates is wrong;
> any code that tests it on lattice coordinates and then warps is right.

---

## Q4 — vertex motion. The brief was **half right, and half wrong in an instructive way**.

### In the lattice — **not lethal per se**, and the brief's reasoning does not transfer

The published 7-of-576 is reproduced as an anchor [PROVEN]: `reptile.shiftNode`
on the MIX-B mixed tree, N = 24, 576 fine cells, **7** lose their unique owner.
But that is a **node** displacement, and a shared-**vertex** displacement is a
different object: it keeps the triangulation a triangulation, so nothing is
double-claimed.

> **★ Moving a shared lattice vertex is lethal exactly when the vertex lies on a
> COARSER cell's boundary, and then it is lethal at ANY displacement [PROVEN].**
> The coarse cell's straight edge and its children's polyline part company
> immediately, and the lens between them has twice-area exactly **2mδ** —
> verified at δ = 1/2, 1/1024 and 1/1048576, giving 8, 1/64 and 1/65536.
> A vertex moved strictly **inside** a coarse cell gives lens = **0** at every one
> of those displacements.

**Two failure modes with two different thresholds, and this is the part worth
carrying forward:**

| failure | threshold | who sees it |
|---|---|---|
| **partition** (the lens opens) | **any ε ≠ 0** | the exact-area tier |
| **ownership** (a centroid crosses) | a full fine-cell of motion | the centroid test |

Swept [MEASURED]: a vertex on a coarse edge moved by +1/4, 2/4, 3/4, 4/4, 6/4,
8/4 of a fine unit gives 0, 2, 16, 28, 40, 52 mismatches. A centroid moves by one
third of its vertex, and its margin is one third of a cell, so ownership needs a
full unit — while the crack is already open at 1/1048576.

### In the warp — **free, exactly as claimed [PROVEN]**

The gate is global and exact: the warped cells' signed areas sum to the warped
**outline's** area, so there is no crack to miss and no overlap to double-count.
Shared-vertex warps (a non-affine shear; a bump moving one vertex by (1/2, −1/3))
both give `cellSum2 = boundary2 = 256/1`, **0 flipped** cells.

**Guard-fire, and it is the whole point:** hand each incident cell its **own** copy
of the moved vertex — exactly what per-triangle vertex storage permits and sharing
forbids — and the same gate reads `cellSum2 = 260/1` against `boundary2 = 256/1`,
with **1 flipped** cell [PROVEN].

> A measured aside worth knowing before anyone over-reads the areas agreeing: on
> **this** lattice a shear in `a` by a function of `b` preserves every cell's area
> exactly, because a lattice triangle always has two vertices with equal `b`. The
> partition gate is therefore testing coincidence of *edges*, not conservation of
> *area*, and that is the property that matters.

---

## Q5 — ★★★ the seam identity. **The conjecture is refuted, in both directions at once.**

The conjecture under test: *the identity survives as a topological fact while the
formula stops computing it.*

### On a shared edge, the FORMULA survives — exactly

> **α_L + α_R = 1 holds to the last bit under every warp tried** [PROVEN]:
> identity, affine, shear λ = 1/8, shear λ = 1/2, and a bump that drags the
> seam's own endpoint by 3/2. `linearWorst = 0` exactly, on every internal seam
> cell, in every case. The exact-area tier is 1 on every cell too.

The reason, once measured, is plain and it is the correction to the brief:

> **§10.1's identity never depended on the edge being STRAIGHT.** It depends on
> the two sides reading the **same directed segment with opposite orientation**,
> so that E_R = −E_L, and on a common positive step. That is an *orientation*
> fact. A warp does not touch it, and neither does curvature.

Model error against the exact-area oracle stays in the same band a straight edge
gives: 0.0556–0.0822 mean per (cell, piece) [MEASURED], consistent with §10.2's
recorded ~16.6% bound on single-edge cells. **Curvature does not force the
exact-area tier for complementarity.**

### At a T-junction, the TOPOLOGY fails first — at any ε

The configuration §9 exists to make safe: a coarse cell beside two finer ones. On
the straight lattice the shared vertex lies **on** the coarse cell's edge and the
three tile their union exactly. Move it and the coarse chord and the fine polyline
part company.

The measurement region is defined by the **stitched** configuration — whose pieces
share every vertex and therefore partition for any vertex warp — so the
exact-area answer for the configuration under test cannot be a tautology.

| warp | lens (×2) | region | still covered | seam cells | exact Σα = 1 | linear Σα = 1 | worst exact | worst linear |
|---|---|---|---|---|---|---|---|---|
| identity | 0 | 322 | 322 | 14 | **14** | **14** | 0 | 0 |
| affine | 0 | 162 | 162 | 12 | **12** | **12** | 0 | 0 |
| shear λ=1/8 | −128 | 138 | 84 | 14 | **0** | **0** | 0.8889 | 0.8333 |
| bump +3/2 | 24 | 332 | 280 | 15 | **0** | 1 | 0.99998 | 1.0000 |
| bump +1/16 | 1 | 322 | 294 | 14 | **0** | **0** | 0.0622 | 0.0583 |
| **bump +1/1024** | 1/64 | 322 | 294 | 14 | **0** | **0** | 0.00092 | 0.00091 |

[PROVEN.] **Both tiers break, and the exact-area tier — the one the brief expected
to survive — is the one reporting a real hole**, because the geometry genuinely
stops partitioning: the chord configuration stops covering 28 of 322 region cells
at a displacement of one part in 1,024.

The linear model breaks by **very nearly the same amount** (0.00091 against
0.00092), because the two sides are now reading two *different* segments and
E_R = −E_L is simply false.

### So, precisely:

| the conjecture said | measurement |
|---|---|
| the identity survives topologically | **false at a T-junction** — the lens opens at any ε |
| the formula stops computing it | **false on a shared edge** — exact, always |

**Neither half is right anywhere.** The true law is a third thing:

> **The seam identity depends on the two sides reading the SAME drawn edge, not on
> the edge being straight. Warping does not break that. Tessellating one edge at
> two different resolutions does** [PROVEN].

### The repair, constructed

Re-tessellate the coarse cell through the moved vertex — ordinary T-junction
stitching — and **the linear identity comes back exactly**: `linearOne = cells`
and `linearWorst = 0` for every warp tested, including the ±3/2 bumps and the
non-affine shear [PROVEN].

> **Consequence for the exact-area tier, and it is the opposite of what the brief
> priced.** Curvature does **not** force the exact-area mode, so fold-re's
> recorded **1.222×** cost for `exact-boundary` is *not* incurred by adding a
> warp. What the exact-area tier buys is something else and arguably more
> valuable: **it is the only tier that detects a T-junction crack at all**, since
> the linear model at 1/1024 displacement is wrong by 0.0009 — a number no
> model-internal check would flag. That is §10.2's lesson repeating ("the two
> model weights still summed to 1 on every one of these cells, which is precisely
> why a model-internal check could never have caught it"), and here it is the
> exact-area oracle catching a *geometry* error rather than a *model* error.

---

## R — the FlowAngle apex. **Exact, and the apex needs no square root.**

`height = (base/2)/tan(angle/2)` then "step along the unit perpendicular" looks as
though it needs |PQ|, hence a square root, hence an escape from any quadratic
ring. **It does not** — the length cancels:

```
height · unitPerp = ((|PQ|/2)·cot(θ/2)) · perp/|PQ| = (cot(θ/2)/2) · perp

apex = midpoint(P,Q) ± (cot(angle/2)/2) · rot90(Q − P)
```

**So the whole exactness question is one membership test on one ring element**
[DERIVED, and used throughout].

### Which angles stay in the ring

Generated, not tabulated: from tan(15°) = 2 − √3 the double-angle map
tan(2θ) = 2t/(1 − t²) is applied in ℚ(√3).

| apex angle | cot(angle/2) | in ℤ[√3]? | tan is a **unit**? |
|---|---|---|---|
| 30° | 2 + √3 | yes | **yes** (N = 1) |
| 60° | √3 | yes | no (N = −3) |
| 90° | 1 | yes | **yes** |
| 120° | √3/3 | **no** — denominator 3 | no |
| 150° | 2 − √3 | yes | **yes** (N = 1) |

[PROVEN.] So: **30°, 90° and 150° are the angles whose apex is exact *and*
reversible**; 60° is exact forward only; 120° leaves ℤ[√3] for (1/3)ℤ[√3];
anything that is not a multiple of 30° leaves ℚ(√3) altogether.

**The escapes, decided rather than searched [PROVEN].** A square in ℚ(√3) must
have zero √-component and be a rational square or three times one — so
**√2 ∉ ℚ(√3)** and **√5 ∉ ℚ(√3)**, which is n = 8 and n = 5 out, which is §11's
exact-angle family **n ∈ {3, 4, 6, 12}** and §11.4's "ℤ[φ] needs √5, which
ℤ[√2,√3] does not contain".

### ★ And the FOURFOLD hexagon *is* a FlowAngle

> **The six inward 60° caps of a regular hexagon land exactly on its centre**
> [PROVEN, all six, in exact ℤ[√3]]. cot(30°) = √3, so the cap height is the
> apothem R√3/2, and the apex is the centre.

Which means `hexagon.buildHexagon`'s six sectors **are** the six caps of the
FlowAngle `{n = 6, angle = 60°}` at flow = 0, with the apex at the origin — not an
analogy, the same construction. The owner's "derive the whole shape from a single
FlowAngle-based hexagon" is therefore not a rewrite of the canvas: **it is a
renaming of the canvas that already ships**, and the renaming is exact.

Guard-fire: any other angle (30°, 90°, 150°) misses the centre [PROVEN].

**No duplication of `rationall-dev`.** `snellius_pi.py` in
`demos/precision-lookahead/` computes π digits three ways; it shares the ring and
the ε̄ constant but not the object. Nothing in §R re-implements it.

---

## Verdict

**Vertex-shared geometry is worth building. Warp-at-display is worth building.
The two together are worth building *only with one rule stated out loud*, and
that rule is not the one the brief assumed.**

What the measurements support:

1. **Shared vertices** — ~6× fewer slots, ~2× fewer objects, and the *only* thing
   that makes vertex motion safe (Q4's guard-fire is lethal without them).
2. **Derive-on-demand** — exact, O(d)/O(1), no denominator growth, and it makes
   any vertex table a *cache* rather than the authority.
3. **The warp at the display boundary** — free on same-scale seams, in both α
   tiers, under strongly non-affine maps.
4. **The FlowAngle hexagon** — already the shipped canvas, exactly, in ℤ[√3].

What they do **not** support, and what has to be a stated rule rather than an
assumption:

> **A warp may not be evaluated at two different resolutions on the same edge.**
>
> Everything that breaks in Q3 and Q5 breaks for this one reason and no other. It
> is not curvature, it is not non-affineness, and it is not the warp being a
> bijection or not. It is a coarse cell drawing a chord where its finer neighbour
> draws a polyline.

Three consequences, each with a number attached:

- **Containment must be decided pre-warp, always** (Q3). Not a preference: the
  tolerable non-affineness is λ ≲ 1/s² and it *vanishes under refinement*.
- **Mixed-depth rendering under a warp requires T-junction stitching** (Q5). With
  it, the linear identity is exact. Without it, both tiers break at any ε.
- **The exact-area tier's value is detection, not complementarity** (Q5). It is
  not needed to keep α_L + α_R = 1 under curvature; it is the only thing that
  sees a 1/1024 crack.

### The first honest increment

**Give the figure a shared vertex table, derived, with the derivation as the
authority — and change nothing about how anything is drawn.**

That is: `buildVertexTable` over the existing `bary` triples, `deriveCell` as the
oracle that regenerates any vertex from its address alone, and a test that the two
agree cell-for-cell at every depth. It is a no-op by construction (both already
agree with `buildFigure` at 4,096 + 4,096 + 6,561 cells), it is independently
useful — it is the precondition for *any* vertex-motion feature, and Q4 shows
vertex motion is unsafe without it — and it commits to none of the warp
mathematics.

**What not to build first:** a warp applied to a mixed-depth render. Its cracks
are invisible to the linear model at small displacements, they open at any ε, and
the only tier that would catch them is the one nobody would have turned on,
because the reason to turn it on has just been shown to be the wrong reason.

**Existing modules that would have to change, named and not touched** (this pass
edited nothing outside its three files):

- `src/lib/figure.ts` — `Cell.verts`/`Cell.bary` are per-triangle by construction;
  a shared table is an *addition* alongside them, not a replacement, until
  something reads it. No change is required for the increment above.
- `src/lib/scale.ts` — unchanged. `radixAt`'s signature is what makes `deriveCell`
  possible at all, and Q2 depends on it.
- `tsconfig.json` — an ES2020 `target` bump would let `warp.ts` use BigInt
  literals. **Not made here**; it is a build-config change and belongs in its own
  diff. Nothing is blocked without it.
- Anything that would test containment on warped coordinates — nothing does today,
  and Q3 says nothing should.

---

## Artifacts

- `src/lib/warp.ts` — exact rationals over `bigint`, the vertex census, the
  descent-as-matrix-product, three warp families with an exhibited inverse, exact
  convex clipping and both α tiers, the partition gate, the T-junction, and the
  ℤ[√3] apex machinery. No float. Nothing in `src/app` imports it.
- `test/warp.test.ts` — **28 tests**, every number above.
- Suite: **1,573 → 1,601**, none of the existing tests modified.
  (Baseline at the start of this pass was 1,541; a concurrent lane added 32.)
- `tsc --noEmit` clean; `eslint` clean.
- Lethality: five guard-fires, each shown red — the de-identified census (Q1), the
  permuted frame (Q2, 3,416 mismatches), the sagitta-1/2 warp (Q3), the unshared
  bump (Q4, 260 vs 256 with a fold), and the un-stitched T-junction (Q5).
