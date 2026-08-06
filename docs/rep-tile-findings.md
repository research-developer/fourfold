# Rep-tile refinement on the FOURFOLD figure — a scoping verdict

Scope: is subdivision by a factor other than 4 — principally **rep-9** (edge ×3,
6 upright + 3 inverted) — sound on this figure, and does mixing radices down one
tree stay exact?

Everything below was decided by computation in `test/reptile.test.ts` against
`src/lib/reptile.ts`. Labels follow the house convention:

- **[PROVEN]** exhaustive computation, decided by an oracle independent of the
  thing under test, with a guard-fire mutation shown lethal.
- **[MEASURED]** a number this run produced, not exhaustive over its domain.
- **[DERIVED]** follows from a [PROVEN] fact by an argument stated here.
- **[ANALOGY]** structural resemblance only. Not evidence.

Nothing was upgraded past its artifact. Three claims in the brief were mine to
check; **one was wrong, one was half wrong, one held**, and one claim I wrote
into a comment mid-run was refuted by the next depth and is recorded as such.

Anchor: the generic cut, restricted to k = 2, **is** `figure.ts`'s `ifs`
convention — the same triangles at depths 1–3, compared as point sets [PROVEN].
So every rep-9 statement below is about THIS lattice, not a lookalike.

---

## Q1 — the theorem is about descent agreeing with geometry. The 4 is incidental.

**Verdict: the brief's reading is confirmed [PROVEN].**

theory.md §9's load-bearing clause is *"that set EQUALS the set of depth-(d+δ)
cells whose barycentric centroid lies inside the node's footprint"*. Run against
an independent oracle at k = 3, it holds with the same margin it holds at k = 2.

| gate | k = 2 (rep-4) | k = 3 (rep-9) |
|---|---|---|
| children per node, exhaustive | 4, all distinct, no cell claimed twice, to d = 6 | 9, all distinct, no cell claimed twice, to d = 4 |
| descendants δ levels down | 4^δ exact, δ = 1..6 | 9^δ exact, δ = 1..4 |
| containment tests | **81,920** (4,096 fine × 20 roots; the 16 depth-2 roots alone give MATH-76's **65,536**) | **590,490** (6,561 fine × 90 roots) |
| mismatches descent vs geometry | **0** | **0** |
| centroids on a node boundary | **0** | **0** |
| roots at one depth tile the frame | every fine cell claimed exactly once | every fine cell claimed exactly once |
| guard-fire: one child displaced one lattice unit | frame accounting red **and** geometric agreement red | same |

Also run at k = 4 (rep-16): 16 distinct children, 16^δ descendants to d = 3
[PROVEN]. And the FOURFOLD canvas survives: six rep-9 sectors assemble into the
hexagon with **6 × 9^d distinct lattice keys and zero collisions** at d = 1,2,3
[PROVEN] — the same check `hexagon.ts` throws on.

**Why it never fails, once measured [DERIVED].** A fine cell's centroid is
strictly interior to that fine cell. Every coarse node boundary is a union of
lines of the node's own grid, which is a sub-grid of the fine grid. A fine cell's
interior meets no fine grid line, so a centroid can never land on a coarse
boundary — which is exactly the `onBoundary = 0` column, and it is the whole
theorem. Nothing in that argument mentions 4, or 9.

---

## Q2 — mixed radix. The real gate. **It survives**, and it costs one thing.

### The general condition

> **Condition (aligned integer refinement).** Let each node carry an *edge
> division* k ≥ 2 and let its children be exactly the k² triangles of the
> node's own 1/k grid. Then for any finite tiling T, N = lcm{ scale(n) : n ∈ T }
> exists, every node is a union of (N/scale(n))² cells of the N-grid, and
> descent-equals-centroid holds relative to **N**.

Two things to notice about what the condition does **not** say:

- It says nothing about the radices agreeing, or even about them sharing
  factors. Integer edge divisions give commensurability for free: scales are
  products of integers, so an lcm always exists. **Commensurability is not the
  condition** — it cannot fail.
- What *can* fail is **alignment**. That is what the guard-fire attacks, and it
  is lethal: one node moved by a single unit of the refinement grid — still
  congruent, still the right size, still in the right parent's child list —
  and 7 of 576 fine cells lose their unique owner [PROVEN].

### The measurement

Three trees whose radix is a function of the node:

| tree | shape | leaves | scales present | common refinement N | descent-vs-geometry tests | mismatches | boundary hits |
|---|---|---|---|---|---|---|---|
| MIX-A | rep-4 root; children rep-9, rep-4, rep-9, **leaf** | 23 | 2, 4, 6 | 12 | 3,888 | **0** | **0** |
| MIX-B | rep-4 root; children rep-9, rep-16, rep-9, rep-4 | 38 | 4, 6, 8 | 24 | 24,768 | **0** | **0** |
| MIX-C | rep-9 root, then rep-4 or rep-9 by parent-digit parity, 3 levels | 354 | 12, 18, 27 | 108 | **4,898,880** | **0** | **0** |

In every tree, every node holds exactly (N/scale)² refinement cells — the
mixed-radix form of §9's 4^δ — and the leaves partition the frame exactly once
[PROVEN]. MIX-A does mixed radix **and** mixed depth at once (a depth-1 leaf
beside depth-2 leaves of two different scales), so foveation's existing freedom
composes with the new one rather than competing with it.

**Seams.** In MIX-B, **69** fine cells lie against an edge whose neighbour
belongs to a leaf of a *different scale* — a rep-9 leaf touching a rep-16 leaf.
Each is claimed exactly once [PROVEN]. This is the crack that mixed radix was
supposed to open, and it does not open. As MATH-76 put it: the band boundary IS
a cut, so there is nothing to tune away.

**Refinement composes and commutes** [PROVEN]: rep-4 ∘ rep-9, rep-9 ∘ rep-4 and
a single rep-36 cut all produce the *same* 36 triangles, as point sets. Checked
for (2,3), (3,2), (2,2), (3,3), (2,6), (4,3).

### The one thing it costs — and it is not small

**Depth stops being resolution [PROVEN].** MIX-C's 354 leaves are all at depth 3
and come in three different scales (12, 18, 27). The order that survives is not
`≤` on depth; it is **divisibility of scale**.

> **SHARPENED after the refactor landed (`e4faf9c`).** "Depth stops being
> resolution" was the right conclusion stated one notch too broadly. Depth
> remains **the number of cuts**, which is real, durable, and still needed —
> what it stops being is a *resolution*. The distinction was forced by a case
> this scoping run did not anticipate: see *the gasket count* below. Counting
> levels is fine; exponentiating by them was not.

Concretely, in this codebase:

- `figure.ts:252` and `hexagon.ts:196` (`const scale = 2 ** depth`),
  `lattice.ts:235,341`, `view.ts:243`, `relief.ts:297`, `artfile.ts:373`
  (`(canvas === "hexagon" ? 6 : 1) * 4 ** depth`) and `arms.ts:229`
  (`(4 ** depth − 1)/3`) all compute a scale or a count *from a depth*. Each is
  a place where depth is doing the work scale must do.

  **The list was incomplete: there were sixteen, not eight.** All eight above
  were real. The eight this run missed, found by doing the work:
  `presets.ts:179` (the gasket count — see below), `plate.ts:235` (the
  constraint site prefix inheritance actually runs through), `plate.ts:560` (an
  equality-of-resolution test deciding whether the `plate` field is written to
  the file at all), `provenance.ts:267–272` (a **three-way** same/deeper/
  shallower comparison, not two-way), and six in `page.tsx` — one of which was
  a second spelling of `arms.ts:229`. Out of that lane and still open:
  `src/app/page.tsx`, `src/app/conventions/page.tsx` (five sites, all labels)
  and `Board.tsx:330`, the only one that is arithmetic rather than display
  (a pixel period divided by a scale).

- **The gasket count is not a function of scale, and cannot be made one
  [PROVEN, found during the refactor].** `presets.ts` computes `3 ** depth`.
  Scale is the product of **edge divisions**; the gasket is the product of
  **upright child counts** `k(k+1)/2`, and that is not recoverable from `k²`
  once `k` varies — scale 6 is `2·3` (18 upright words) or `6·1` (21). It stays
  a depth-indexed *product over levels*. This is the case that drew the line
  above: a quantity indexed by the number of cuts is legitimate; a quantity
  computed as `radix ** depth` was the bug.
- MATH-76's quality field is a *depth* field. Under mixed radix a depth field no
  longer names a resolution, and a buffer keyed by depth would be comparing
  incomparable things. The fix is mechanical (key by scale) but it is not
  cosmetic, and it is where the work is.
- `artfile.ts:968` pins the on-disk address alphabet to `[ABCX]{1,5}`. A rep-9
  address needs nine letters; a mixed address needs the radix schedule to be
  recoverable.

**The address rule that keeps `plate.ts` working [DERIVED].** `plate.ts` rests
on *address prefix = ancestry*, and on an address of length d naming a cell at
the render depth. Under mixed radix that survives **iff the radix is a pure
function of the address** (as `buildTree` here takes it). If the radix is
per-node *data*, an address no longer determines its own scale, prefix
resolution stops being well defined, and the plate's four resolution rules lose
their meaning. That is a design constraint to fix before any code is written,
not a bug to find later.

---

## Q3 — the charge group. **You were half wrong, and the half that is wrong is the important half.**

The claim under test: "rep-9 would analogously carry (ℤ/3)²".

### The obstruction, and it is decisive

A group automorphism fixes the identity. So a charge group needs a letter fixed
by the rotation. Whether one exists is a clean arithmetic law:

> **A rotation-fixed letter exists iff 3 ∤ k** [PROVEN, k = 2..9].

| k | children | fixed by rot⁺ | fixed by each mirror | hub (fixed by all of D₃) |
|---|---|---|---|---|
| 2 | 4 | 1 (the inverted centre X) | 2 | yes |
| **3** | **9** | **0** | 3 | **no** |
| 4 | 16 | 1 (the middle upright) | 4 | yes |
| 5 | 25 | 1 | 5 | yes |
| 6 | 36 | 0 | 6 | no |
| 7, 8 | 49, 64 | 1 | 7, 8 | yes |
| 9 | 81 | 0 | 9 | no |

At rep-9 the rotation acts **freely** — three orbits of three, no fixed point —
so no letter can be the identity, so no group law on Σ₉ can make D₃ act by
automorphisms. Checked by brute force rather than left as an argument:

> **Exhaustive: over both groups of order 9 (ℤ/9 and (ℤ/3)²) and all 9! =
> 362,880 labellings — 725,760 candidates — exactly 0 make the D₃ action
> automorphic** [PROVEN].
>
> The same search at rep-4 finds **6** labellings, and **every one of them sends
> the inverted centre X to the identity** [PROVEN]. ℤ/4 admits none.

That last line is a finding about the shipped code too: the geometrically
natural charge basepoint is **X**, not A. `figure.ts` uses `A ↦ ID`, which
differs by a fixed translation — harmless, because V4 has exponent 2 and the
field is only ever read up to a palette, but it is precisely why the codebase's
rotation is not a charge automorphism either.

### What does exist

Drop "automorphism" to "affine map" — keep the group acting, give up the
basepoint — and rep-9 comes back:

> **1,296 affine labellings for (ℤ/3)²; 0 for ℤ/9** [PROVEN].
> 1,296 = 3 × 432 = 3 × |AGL(2,3)|: three genuinely distinct structures, each a
> free orbit of the full affine group.

So **(ℤ/3)² is forced** — ℤ/9 is refuted outright — but its role is not the
role V4 plays at rep-4:

**Σ₉ is a (ℤ/3)²-torsor, not a (ℤ/3)²-valued charge.** A torsor has no identity,
so "the charge of the empty word" and therefore "charge = product of the digits"
have no canonical meaning. Pick a basepoint (1,296 ways, none distinguished) and
a charge exists; it is just no longer *the* charge.

For contrast, the rep-4 count 24 of affine labellings is **vacuous**:
|AGL(2,2)| = 24 = 4!, so every relabelling of four charges is affine. The affine
condition only starts carrying information at rep-9 (432 of 362,880).

### The consolation prize is real, and it goes the other way

Under the torsor structure the rotation's induced map has **linear part exactly
the identity — it is a pure translation** [PROVEN]. Consequence:

> The rotation twist c(ρw) − c(w) is **a single global constant** n·t at depth n
> — one value over the entire figure — versus rep-4's **four** twist classes
> [PROVEN, depths 1–4]. Measured t: depth 1 → 2, depth 2 → 1, depth 3 → 0,
> depth 4 → 2, i.e. exactly n·t in (ℤ/3)².

`docs/symmetry-findings.md` §B's "three ftype classes plus the hub" — the
structure behind the 1366/4096 — has no rep-9 analogue **because there is
nothing left to classify**. One class. Rep-9's rotation is *cleaner* than
rep-4's, and the entire price is paid on the basepoint.

The charge field measured the way `hexagon.ts`'s `hexIsometryReport` measures it
(best affine relabelling of the palette, exhaustive, per symmetry) [MEASURED]:

| depth | rep-4 rotations | rep-4 mirrors | rep-9 rotations | rep-9 mirrors |
|---|---|---|---|---|
| 2 | exact | 13/16 = .8125 | exact | 54/81 = .6667 |
| 3 | exact | 43/64 = .6719 | exact | 405/729 = .5556 |
| 4 | exact | 148/256 = .5781 | exact | 3,645/6,561 = .5556 |
| 5 | exact | 511/1,024 = .4990 | exact | 26,244/59,049 = .4444 |

> **Refuted mid-run, and recorded.** An earlier comment in the test file claimed
> rep-9's mirror fraction "settles at exactly 5/9" — written when depths 3 and 4
> both read 5/9. Depth 5 is 4/9. Two equal terms are not a limit. Both radices
> decay; neither is measured to a floor.

So on the mirrors, rep-9 is not worse than rep-4 — §G's "the reflections are
messier" is a property of the *figure*, not of the radix.

### (c) — how the symmetries move addresses. Radix-independent, and it explains §A.

> **D₃ acts on addresses by a transducer whose state is an element of S₃, and
> the state changes only when the descent passes through an INVERTED child**
> [PROVEN, k = 2, 3, 4, 5].
>
> - rotations: the state never changes ⇒ a **uniform digit rewrite** at every
>   level (verified cell-for-cell: 4^3, 9^3, 16^2, 25^2 cells)
> - mirrors: m_A → m_B → m_C, advancing on each inverted digit

This *is* §A's odometer, generalised. In the `apex` convention the rotation's
residual is absorbed into each corner child's frame, and X is the one child that
cannot absorb it — a frame fixed by a 3-cycle would be an ordered triple equal to
its own rotation. Hence "rotate the **first non-X** digit": the rewrite has to
walk past the leading X's because they carry the rotation down with them.

At rep-9 **no child is rotation-fixed, so every child can absorb it** [DERIVED
from the free action]: an apex-style convention exists at rep-9 where the
rotation rewrites the first digit and stops, **with no hub exception at all**.
The same fact that kills the charge group makes the address law simpler.

Two structures do NOT carry over, and they should be priced in:

- **No hub.** The rotation's fixed point at rep-9 is a lattice *vertex* (six
  children meet there), not a cell. `arms.ts`'s "three arms plus the excluded
  hub" has no rep-9 analogue in that form.
- **Non-canonical arms.** Rep-9 still splits into three congruent rotation-
  permuted arms of exactly 9^d/3 cells with **no leftover cell** — arguably
  cleaner than (4^d − 1)/3 + 1 — but the split needs a transversal of the three
  first-digit orbits (27 choices), and none is distinguished. Same missing
  basepoint, showing up a second time.

---

## Q4 — rings. **Confirmed, and the boundary is sharper than the brief states.**

**No new ring [PROVEN].** Subdivision is a scaling by an integer edge division,
so every coordinate stays an integer over a product of radices; nothing in
`reptile.ts` divides and no √ appears anywhere in it. The geometric oracle
decides everything in ℤ by cross-multiplication. The single √3 the figure needs
lives in the projection to pixels (`figure.ts` `toXY`, `hexagon.ts`
`latticeToPixel`) and is untouched by the radix. §11's Niven boundary constrains
polygon **anchors**; rep-9 changes the **scale**; 3 is rational; nothing moves.

**The sharpening — and this is the part to say loudly.** The ring is not
threatened by the radix, it is threatened by the **child count**:

> The aligned family divides the edge by an integer k and produces **k²**
> children, so the admissible child counts are exactly the perfect squares:
> 4, 9, 16, 25, 36, … [PROVEN for m ≤ 40].

A "rep-3" cut — three children — would need edge ratio 1/√3 and a 30° turn:
an irrational scaling, ℤ[√3] in the coordinates, and §11's Niven boundary
reappearing in the SUBDIVISION rather than in the polygon anchors. **Any
proposal whose child count is not a perfect square drags in the carrier ring and
changes the cost enormously.** rep-9 is safe precisely because 9 = 3².

**The cost law [PROVEN].** The denominator after a descent is exactly the product
of the edge divisions, whatever order they were applied in — (2,2,3), (3,2,2),
(2,3,2) and a single 12 all land on denominator 12 and the identical 144-cell
grid. So bits of denominator = log₂(edge division reached): exactness costs the
same per unit of resolution at every radix. Rep-9 is not more expensive than
rep-4; it arrives in bigger steps.

What *does* change: rep-4's denominators are powers of two — the shifts
`figure.ts` leans on with `2 ** depth` and `half() = (p+q)/2`. Mixed
denominators are only 3-smooth, so that halving is no longer available. Worth
noting that the formulation here needs **no division at all** (it multiplies the
denominator up rather than halving coordinates down), so this is a change of
style, not a loss of exactness.

### The senary note: coincidence of notation, with a real fact underneath

4 × 9 = 36 = 100₆ is **not** "one senary digit per level" [DERIVED]. The numeral
lives on the **edge division**, not on the child count:

- Edge divisions multiply along a path: a path of a twos and b threes has scale
  2^a 3^b. The address is therefore a genuine mixed-radix numeral **over the
  edge divisions** {2, 3}, and its reachable resolutions are exactly the
  3-smooth numbers. Prefix inheritance and positional truncation are the same
  operation — but that is true at fixed radix too, so it is not new.
- 6 = 2 × 3 is one rep-4 level **plus** one rep-9 level, and the composite is
  rep-36, not rep-6. Rep-6 does not exist: 6 is not a perfect square. A rep-36
  alphabet is 36 letters = 21 upright + 15 inverted [PROVEN], which is *two*
  senary digits' worth, not one.
- What is real: the rep-4 and rep-9 cuts **commute**, producing the same 36
  triangles either way [PROVEN]. Only the addressing differs. So "one senary
  digit of EDGE SCALE per rep-4 + rep-9 pair" is exactly true, and "one senary
  digit per level" is not.

---

## Verdict

**Rep-tile refinement is sound on this figure and worth building on.** The
mathematics does not resist at any point that was tested: the containment
theorem is about descent agreeing with geometry, mixed radix partitions the
common refinement with zero boundary incidents across 4.9M tests, the hexagon
canvas carries over unchanged, and no new ring appears.

The cost is not geometric. It is in **two representational commitments the
codebase currently makes**:

1. **Depth is used as resolution.** True at fixed radix, false the moment two
   radices meet. Eight sites compute a scale or a count from a depth.
2. **Charge has a canonical basepoint.** True at rep-4 because the rotation
   fixes X; false at rep-9, where 725,760 candidate labellings all fail. A
   rep-9 charge exists only relative to a chosen basepoint, and the hub and the
   canonical arm decomposition go with it.

### The first honest increment — **LANDED, `e4faf9c`**

**Replace depth with scale, at fixed radix 4, changing nothing else.**

> **Outcome.** All four bullets below were done. **1,440 tests passed
> unmodified**, 23 added; `tsc`, `eslint` and `next build` clean. Byte identity
> pinned for all three export paths (still 17,228 B, animated 22,959 B, layered
> gesture 20,449 B, each with its sha256), captured pre-refactor by stashing
> `src/` so the pins could not be a re-encode of the new behaviour.
>
> **The single boundary is `src/lib/scale.ts`** — the only `EDGE_DIVISION **
> depth` in `src/`, with exactly two callers, both seams where a depth *enters*
> the model from outside: `buildFigure(depth)` (the UI states one) and
> `cellCount(_, depth)` (the file states one). `ArtPayload.depth` is untouched.
>
> **The address rule is enforced by type, not by comment.** `radixAt(word,
> level)` takes a string and an index and nothing else, so per-node radix data
> cannot enter without changing the signature.
>
> **A guard-fire found a hole in the refactor's own test.** The first
> byte-identity fixture hand-built its payload and stayed **green** under a
> deliberately mutated `scaleOfDepth` — because the still picture's geometry is
> genuinely scale-invariant: `buildFigure` multiplies barycentrics up by scale
> and `toXY` divides them back, so a uniform scale error cancels in the pixels.
> Rebuilt through the real `payloadFromPaint` + `plateEntries` path it reaches
> `cellCount` and is lethal. **A pinned digest that cannot fail measures
> nothing**, and only the mutation distinguished the two.
>
> **Two things marked rather than built.** Divisibility is a **partial** order,
> so mixed radix admits a fourth case the current two- and three-way branches do
> not decide: *incomparable* (18 against 27). It cannot arise at one radix, so
> nothing was invented; both branch sites carry a comment saying where the case
> goes. And `plate.depthCensus` is **still keyed by depth** — precisely the
> depth-keyed buffer this document warns about — because rekeying changes what
> the function returns, which that pass was not permitted to do. It is the
> named follow-on.

Every claim above says the geometry is ready and the *bookkeeping* is not. So
the first increment should buy the bookkeeping and no new mathematics:

- carry `scale` (the product of edge divisions) on nodes and buffers instead of
  deriving it from `depth`;
- make the resolution comparison divisibility of scale rather than `≤` on depth;
- make the radix a **pure function of the address** and keep it that way, so
  `plate.ts`'s prefix semantics stay well defined;
- keep k = 2 everywhere. The tests must be bit-identical to today's, because at
  fixed radix scale and depth agree and this refactor is *by construction* a
  no-op.

That is a change with a lethal test already available (any drift shows up as a
diff against the current 1,421 tests), it is independently useful even if rep-9
is never built, and it is the only thing standing between this codebase and a
mixed-radix tree. Rep-9 itself — a nine-letter alphabet, the torsor charge with
a declared basepoint, the transversal arms — should not start until that lands.

**What not to build first:** a rep-9 renderer. Its charge would need a basepoint
chosen by fiat, its arms a transversal chosen by fiat, and both choices would
harden into the file format before anyone has decided what they mean.

> **HALF RETRACTED — see `docs/rep9-charge.md`.** The arms need **no fiat at
> all**: requiring the *mirrors* (not merely the rotation) to permute the parts
> cuts 27 transversals to 9 decompositions to **exactly one**. Q3's "27 choices,
> none distinguished" was true of the rotation alone and false of D₃. The charge
> reduces to **one bit** — which upright class is +1 — and that bit is never
> serialised. Rep-9's residual freedom is `Aut(ℤ/3)`, order 2, against rep-4's
> `Aut(V₄)`, order 6: **rep-9 is the less arbitrary of the two.**
>
> Also corrected there: this document's "[PROVEN] the rotation's linear part is
> exactly the identity" came from a **single witness**. The 1,296 affine
> labellings fall into **three** classes of 432, and that property holds in only
> one of them — it is a property of the structure we want, not of the torsor.

---

## Artifacts

- `src/lib/reptile.ts` — generic aligned rep-k² subdivision, the independent
  containment oracle, mixed-radix trees, the group/torsor search, the frame
  residual. No float anywhere; nothing in `src/app` imports it.
- `test/reptile.test.ts` — 19 tests, all counts above.
- Suite at scoping: 1,421 → **1,440** tests, all passing.

**Added by the refactor (`e4faf9c`), which this document specified:**

- `src/lib/scale.ts` — the single depth↔scale boundary, `refines` (divisibility),
  and `radixAt`, whose signature is what keeps an address determining its own
  scale.
- `test/scale.test.ts` — 20 tests, using `reptile.ts` as an **independent
  geometric oracle**: `scale = 2^depth` checked against it rather than against
  the formula, divisibility ≡ ordering at radix 4 *and* its failure on a mixed
  tree the oracle builds, and an address determining its own scale with no
  figure in hand.
- `test/byteidentity.test.ts` — 3 tests, the pinned digests for the three export
  paths.
- Suite: 1,440 → **1,463** tests, **none of the 1,440 modified**.

## Where this stands for fold-re

The §9 amendment this work supports — from *"exactly 4 children"* to the
alignment condition, with mixed radix admitted — is now backed by three things
rather than one: the generalised theorem (Q1), the mixed-radix condition and its
lethal guard-fire (Q2), and a worked demonstration in a real codebase that the
representational cost is a clean no-op (`e4faf9c`).

Cite by SHA, not by branch: `bca3e84` for this document, `e4faf9c` for the
refactor. What does **not** transfer for free is MATH-76's quality field, which
is a *depth* field feeding a descent policy with measured latency
characteristics. Changing it there touches that verdict and needs its own ticket
and its own committed artifact. This is evidence the change is clean, not a
substitute for measuring it in fold-re.
