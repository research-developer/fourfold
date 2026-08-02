# What the figure is doing that the eye nearly sees

Findings from an exhaustive re-analysis of the V₄ XOR Sierpiński figure at
depths 2–6, prompted by a set of observations made by eye from the depth-6
render. Everything below is verified by full enumeration — no sampling — in
`tools/symmetry_truth.py` and `tools/game_theorem.py`.

**Which V₄ this is.** The Galois one: `V₄ ≅ Gal(ℚ(√2,√3)/ℚ)`. This is *not*
the fold-re octant charge, the Dirichlet `(ℤ/12ℤ)*`, or the FlowAngle `⟨ρ,ε⟩`
instance. No result here transports to those without a separate argument.

---

## Part 1 — the observations, confirmed

> *"Bright blue, bright gold, bright purple are always up; dark red, dark
> gold, dark purple are always down."*

Exact, and true by construction: brightness **is** `ε(w)`, the parity of the
number of X's in the address. Verified on all 4096 leaves at depth 6. Nothing
about the four hues enters into it — the up/down split and the colour split
are independent coordinates.

> *"Golds are never chiral in either direction and always aligned with the
> median."*

Correct, and it is Theorem 3 seen from the outside. The mirror across the
vertical median acts on addresses by the digit swap `B ↔ C`, which lifts to
the automorphism `φ = (σ₂ σ₃)` of V₄. `φ` **fixes** `1` and `σ₂σ₃` and
**swaps** `σ₂` with `σ₃`. So:

| | under `m_A` |
|---|---|
| gold `1` | ↦ gold |
| purple `σ₂σ₃` | ↦ purple |
| blue `σ₂` | ↔ red `σ₃` |

Measured at depth 6: the joint table is perfectly diagonal — gold→gold 1024,
purple→purple 1024, blue→red 1024, red→blue 1024, with **zero** off-pattern
entries. The gold set is invariant under `m_A` and under neither diagonal.

> *"Every ⅓ turn flips those rules so that gold becomes chiral and blue or red
> is the new gold."*

Right, and sharper than stated. Under the diagonal mirrors the best-matching
colour permutation makes a *different* colour self-paired, and gold always
becomes chiral. At depth 3 the `m_B` optimum is `gold→red, blue→blue,
red→purple, purple→gold` — **blue** is the new gold. At depth 4 it is
`gold→blue, blue→purple, red→red, purple→gold` — **red** is. The identity of
"the new gold" alternates with depth parity.

> *"Many symmetries centred and off the median(s) that repeat laterally; each
> off-centre one has a matching one on the opposite side."*

This is Theorem 1 (covariance), `c(uw) = c(u)c(w)`. The sharp point worth
holding: the sibling relations are **group translations `L_g`, not
automorphisms**. They move the identity. That is exactly why a repeated motif
comes back in a *permuted palette* rather than identically — and why the
inverted centre quarter pairs gold with purple and blue with red.

---

## Part 2 — what was missing

### A. The rotation is an odometer, and only touches one digit

The 120° rotation acts on addresses by

> `R(Xʲ D u) = Xʲ · ρ(D) · u`,  `D ∈ {A,B,C}`, `ρ = (A B C)`

It rotates **only the first non-X digit** and leaves the entire rest of the
address untouched. Leading X's are passed through; the hub `Xᵈ` is fixed.

This is the whole content of "acts with carry." The companion note says
rotation is "odometer-like, not digit-wise"; this is the explicit law.

### B. Therefore the twist is exactly constant on three classes

Write `ftype(w)` for the first non-X digit. The twist
`t(w) = c(Rw) · c(w)⁻¹` is **single-valued** on each `ftype` class:

| `ftype` | twist under `rot⁺` | count at d=6 |
|---|---|---|
| A | blue `σ₂` | 1365 |
| B | purple `σ₂σ₃` | 1365 |
| C | red `σ₃` | 1365 |
| hub `Xᵈ` | gold `1` (identity) | 1 |

Zero exceptions at any depth 2–6. The rotation obstruction is not diffuse
noise — it is a clean partition into three equal classes with one fixed point.

### C. This explains the 1366/4096

The companion note's verification table reports, as raw data:

> best other isometry + best permutation: 22/64, 86/256, 342/1024, 1366/4096

Those are exactly `(4ᵈ − 1)/3 + 1`. The `(4ᵈ−1)/3` is one `ftype` class; the
`+1` is the hub. A number that appeared as an empirical curiosity is the size
of a structurally defined set. Nothing else in the figure is one-third of
anything.

### D. The three classes are a triskelion

`S_D = { Xʲ D u }` is the union over `j` of the D-corner of the `j`-th nested
centre — a chain of shrinking triangles spiralling into the centroid. The
three arms are congruent, they tile the board minus the hub, and the rotation
permutes them cyclically. This is almost certainly what was being seen as
"off-median symmetries that repeat laterally."

### E. √6 is distinguished by the *convention*, not by the figure

**Corrected 2026-08-02.** This section previously read "√6 is genuinely
distinguished — an open question, answered" and asserted **"It is genuinely
special."** That over-claimed, and it also carried a wrong number. Both are
fixed below; the evidence is `tools/conventions.py`, exhaustive at depths 2–6.

The study guide asked whether √6 is really special or an artifact of which
child was chosen inverted. The answer is neither: it is an artifact of **which
vertex of each child plays role A** — a variable independent of the inverted
child, which `equilat_v4.py` and `src/lib/figure.ts` fix without comment.

Two conventions, *identical geometry* — the same 4096 triangles at depth 6,
the same single inverted centre `(M_BC, M_AC, M_AB)`, verified equal as a set
at every depth 2–6:

- **apex** — every corner child keeps the parent's corner as its own role-A
  vertex. This is what this repo implements.
- **ifs** — each corner child's roles are the images of `(A,B,C)` under the
  homothety that produces it. The standard IFS reading.

V₄ has three non-trivial characters, one per quadratic subfield. Cells whose
mirror partner lies in the same coset of the character's kernel, d=6:

**apex** — one median carries a subfield exactly; the other two carry none.

| character | kernel | `m_A` | `m_B` | `m_C` |
|---|---|---|---|---|
| `χ_√6` | {gold, purple} | **4096 / 4096** | 1366 / 4096 | 1366 / 4096 |
| `χ_√3` | {gold, blue} | 2048 / 4096 | 2048 / 4096 | 2050 / 4096 |
| `χ_√2` | {gold, red} | 2048 / 4096 | 2050 / 4096 | 2048 / 4096 |

**ifs** — *each* median carries a different subfield, exactly.

| character | kernel | `m_A` | `m_B` | `m_C` |
|---|---|---|---|---|
| `χ_√6` | {gold, purple} | **4096 / 4096** | 2048 / 4096 | 2048 / 4096 |
| `χ_√3` | {gold, blue} | 2048 / 4096 | 2048 / 4096 | **4096 / 4096** |
| `χ_√2` | {gold, red} | 2048 / 4096 | **4096 / 4096** | 2048 / 4096 |

**The number that was wrong.** The old table reported `χ_√2` at 2050/4096
under `m_A`. It is 2048. Under `m_A` the mirror fixes gold and purple and
swaps blue with red, so `χ_√3` and `χ_√2` are each preserved on exactly the
gold ∪ purple cells — 1024 + 1024 = 2048, and they cannot differ from one
another. The 2050 is real but belongs to a different cell of the grid: it is
`χ_√2` under `m_B` (and `χ_√3` under `m_C`). A number was carried across from
the wrong column.

**What survives, and what does not.** The vertical median carries `χ_√6`
exactly in *both* conventions — that much is a fact about the figure. What
was wrongly promoted to a fact about the figure is the *exclusivity*: that
√6 is the only one of the three to get a median. In the ifs convention all
three do, and `rot⁺` realises

> `1 ↦ 1`,  `σ₂ ↦ σ₂σ₃`,  `σ₃ ↦ σ₂`,  `σ₂σ₃ ↦ σ₃`

a 3-cycle on the non-identity elements. So `Aut(V₄) ≅ S₃` acts **transitively**
on the three quadratic subfields there, and no one of them is canonical.

The exact symmetry group, both conventions, depths 2–6:

| convention | isometries that lift exactly | order |
|---|---|---|
| apex | id, `m_A` | **2** |
| ifs | all six | **6** |

with the apex column reproducing 22/64, 86/256, 342/1024, 1366/4096 for every
non-exact isometry — the same `(4ᵈ−1)/3 + 1` of section C.

So the {gold, purple} vs {blue, red} split is canonical **within the apex
convention**, forced there by X carrying `σ₂σ₃` together with the mirror
fixing X. It is not forced by the geometry, which is the same either way.
This is theory.md §4's law in this figure's terms: *the choice of child-role
convention selects which subgroup of `Aut(V₄)` is geometrically realised.*

### F. Under a diagonal mirror, gold never maps to gold

Stronger than "gold becomes chiral." At depth 6 the `m_B` joint table has
gold→gold `= 1` — and that one cell is the hub. purple→purple `= 0`. At odd
depths the two swap, tracking `c(Xᵈ) = (σ₂σ₃)ᵈ`. So apart from a single
central cell, **no colour is ever preserved by a diagonal mirror.**

### G. The reflections are messier than the rotations

Worth knowing if you go looking. For rotations the twist is one value per
`ftype` class. For the diagonal *reflections* it takes two values per class —
`{gold, purple}` on the matching class and `{blue, red}` on the other two —
because a reflection also mixes in the H-coset of the cell itself. The
rotations are the cleaner object here, which is the reverse of the usual
situation.

### H. The corollary the game is built on

Let `H = {gold, purple}`, and call two charges **coherent** when they lie in
the same coset of `H`. Then:

> **Theorem.** `w` and its mirror `r_a(w)` are coherent iff
> `a = A`: always; `a = B`: `ftype(w) = B` or `w = Xᵈ`; `a = C`:
> `ftype(w) = C` or `w = Xᵈ`.

Verified by set equality — not by counting — at depths 2, 3, 4, 5, 6.

---

## Open, and now sharper

- The `ftype` map is a homomorphism-like invariant on a *suffix-blind* piece
  of the address. Is there a clean algebraic name for the quotient it
  generates? It is not `c`, and not `ε`.
- `S_A, S_B, S_C` are permuted by rotation and pairwise swapped by the mirrors.
  Together with the hub that is an `S₃`-set structure sitting **on top of** a
  figure whose colour symmetry group has order 2. What is the right object —
  a colouring valued in an `H`-torsor rather than in V₄ itself?
- The `--waves` overlay draws the three characters. Given E, `χ_√6` should be
  geometrically distinguished among the three wavefront families **in the apex
  convention**, and the three should be interchangeable in the ifs convention.
  Is that what the overlay shows?
- Does the `ftype` decomposition survive to the `sc` (self-count) variant, or
  does the lexicographic self-count rule cut across the arms?

---

# Part 3 — where the symmetry lives, and what causes the obstruction

Later additions, same standard of evidence: exhaustive enumeration, no
sampling. Scripts in `tools/`.

## The symmetry-breaking scale is exactly two levels

Exact colour-symmetry group of a sub-triangle spanning `j` levels:

| `j` | leaves | group order | isometries that lift exactly |
|---|---|---|---|
| 0 | 1 | **6** | all |
| 1 | 4 | **6** | all |
| 2 | 16 | **2** | id, `r_A` |
| 3–6 | 64–4096 | **2** | id, `r_A` |

Full triangle symmetry holds at one level of nesting and dies at two. No
gradual decay — one step, cliff edge.

**The cause is pigeonhole, not geometry.** At `j = 1` the four cells carry
four *distinct* charges, so any rearrangement can be undone by recolouring
and every isometry lifts for free. At `j = 2` there are sixteen cells and
four charges, each repeating four times, and a recolouring must satisfy
sixteen constraints with four degrees of freedom. **Symmetry survives
exactly as long as the colouring is injective.** The `j ≤ 1` symmetry is
real but vacuous.

## Every region mirrors, in one of two phases

All 1364 sub-triangles of the depth-6 figure carry an exact mirror — zero
mismatches. What varies is which recolouring realises it. With twist
`t(u) = c(u) · φ(c(u))`:

| prefix charge | twist | mirror acts by |
|---|---|---|
| gold, purple (in `H`) | identity | same map as the whole figure |
| blue, red (outside `H`) | `σ₂σ₃` | **H-cosets swapped**: gold↦purple, blue↦red |

Split at depth 6: **682 / 682**, exactly even. Half the regions mirror in
phase with the global figure, half out of phase, and the phase is determined
entirely by the path taken to reach the region. This is rendered live in the
app's `phase` view.

## The ±1 residual

Each ftype arm splits across the two cosets to within exactly one cell, at
every depth:

| | in `H` | outside | excess |
|---|---|---|---|
| arm A | `(4ᵈ+2)/6` | `(4ᵈ−4)/6` | **+1** |
| arms B, C | `(4ᵈ−4)/6` | `(4ᵈ+2)/6` | **−1** |
| hub | 1 | 0 | **+1** |

`1, 3, 11, 43, 171, 683, 2731, …` satisfying `a(d) = 4a(d−1) − 1`. The four
imbalances cancel to zero, so the board is exactly halved. The residual is
forced by the hub: it is the one cell with no partner to balance against,
and `(σ₂σ₃)ᵈ ∈ H` for every `d`.

## The obstruction needs the inverted child *and* the role convention

**Qualified 2026-08-02.** This section was headed "the obstruction is the
inverted child, not the triangle." The negative half stands — it is not
threeness, and the square experiment below proves it. The positive half was
too strong: the inverted child is **not sufficient**. Section E holds the
counterexample — the ifs convention has the same inverted child, the same 4096
triangles, and *no obstruction at all*. The role convention is a second
variable, and it was held fixed here without being noticed. (Whether the
inverted child is *necessary* is untested and stays open — nothing here
rules out a role convention that obstructs without one.)

The two conventions differ in exactly one place. The centre child is
`(M_BC, M_AC, M_AB)` in both, so the inverted child is **held constant**;
only the two corner children `B` and `C` have their role ordering shifted
(`(P_B, M_BC, M_AB)` in apex against `(M_AB, P_B, M_BC)` in ifs). So in *this*
figure the obstruction is produced by the corner role shift, with the
orientation-reversing child fixed throughout.

Read the rest of this section as: *given the apex role convention*, the
obstruction tracks the inverted child rather than the triangle.

| scheme | children | group | result |
|---|---|---|---|
| Square quadtree | 4, all translates | V₄ | **full D₄, every depth** |
| Sierpiński gasket | 3, all upright | ℤ/3 | **full S₃, every depth** |
| This figure | 3 upright + **1 inverted** | V₄ | order 2 |

Controlled experiment — a square quadtree with exactly one quadrant
point-reflected, nothing else changed:

```
PLAIN     id 100%  rot90 100%  rot180 100%  mir_x 100%  diag 100%
TWISTED   id 100%  rot90  50%  rot180  ~2/3  mir_x  50%  diag 100%
```

One reflected child in a *square* reproduces the phenomenon, and the
surviving reflection is precisely the one that **fixes the reflected child**
— exactly parallel to `r_A` fixing both `A` and `X` here.

**Mechanism.** When every child is a translate, an isometry induces the same
role permutation at every level, so the action is uniformly digit-wise. The
label group is abelian and all addresses have equal length `d`, so an affine
digit map `ψ(g) = t·φ(g)` gives `c(ρw) = tᵈ · φ(c(w))` — the translations
collect into a constant and the symmetry is exact. An orientation-reversing
child breaks that: the digit permutation at position `i` comes to depend on
how many reflected children precede it. That is the carry.

**Caveat on the mechanism, added 2026-08-02.** The diagnosis above — that the
carry comes from an orientation-reversing child — is *not* what separates the
two conventions of section E, since both have the same one. In ifs every child
(the centre included) is the image of the parent under the affine map that
produces it, with roles transported by that map, so an isometry conjugates to
the corresponding isometry of every child uniformly. In apex the corner
children's role-A is the parent's corner rather than the homothety image, and
that shift is what makes the induced digit permutation position-dependent. The
square experiment below still stands on its own terms; what is now open is
whether its twisted quadrant obstructs through orientation-reversal, through
the role shift that reversal induces, or through both.

**Two independent routes to an obstruction:**

1. An orientation-reversing child (this figure; any rep-tile with a rotated
   or reflected piece).
2. More than four children. Every permutation of the label group is affine
   only for `|G| ∈ {2, 3, 4}`, where `AGL(1,2) ≅ S₂`, `AGL(1,3) ≅ S₃` and
   `AGL(2,2) ≅ S₄` are the full symmetric groups. From `|G| = 5` the affine
   group is proper, so obstructions appear even with all-translate children.

**Why the triangle.** Among regular polygons only the triangle and the
square are rep-tiles at all. The midpoint subdivision of a triangle into
`n²` pieces always yields `n(n−1)/2` inverted ones — never zero for `n ≥ 2`
— while the square's yields zero, always. The triangle is the only regular
polygon whose self-similar subdivision *forces* an orientation-reversing
piece. The phenomenon is triangle-specific, but not because of threeness.

**Open:** scaling the triangle to `n² > 4` pieces should keep the
phenomenon and intensify it, since the inverted count grows quadratically.
Untested.

---

# Part 4 — the hexagon canvas

Added 2026-08-02. Six copies of the depth-*d* triangle share their apex at a
common centre vertex; six 60° apex angles close the circle exactly, so the
sectors tile a regular hexagon of 6·4ᵈ cells with no overlap and no gap.
Triangle mode is unchanged and remains the default. Evidence:
`src/lib/hexagon.ts`, `tools/conventions.py`, gates in
`test/hexagon.test.ts` — exhaustive, no sampling, and computed twice.

## The lattice, and why the index law is exact

Work in the Eisenstein basis `e1 = (1,0)`, `e2 = (1/2, √3/2)`. A 60° rotation
is then an **integer** matrix, which is the whole reason for the basis:

> `R : (a,b) ↦ (−b, a+b)`  and  `M : (a,b) ↦ (a+b, −b)`

Place the base triangle with apex `A` at the origin, `B` at `scale·e1` and `C`
at `scale·e2`; a vertex with integer barycentrics `(x,y,z)`, `x+y+z = scale`,
then sits at `(y, z)`. Every cell is located by an exact integer key and every
isometry is an exact integer map. Floats appear only in the projection to
pixels, and never decide an index.

## The index law, derived — and the correction it forced

Sector *s* is `R^s` applied to the base wedge. Then `R·(R^s k) = R^(s+1) k`, and
dihedral commutation `M·R^s = R^(−s)·M` together with `M` carrying the base
wedge to sector −1 gives:

| | index law |
|---|---|
| the six rotations | `(s, c) ↦ (s + k mod 6, c)` |
| the six reflections | `(s, c) ↦ (k − 1 − s mod 6, μ(c))` |

where `R·M = [[0,1],[1,0]]` is the swap `a ↔ b` — in barycentric terms the swap
of the `B` and `C` coordinates, which is exactly `m_A`. So **μ is the
within-sector median mirror**, already computed as `cell.mirror.A`.

The natural guess — that `rot60` carries a μ, and that the reflections' μ is
parity-dependent — is **geometrically wrong** under an index intrinsic to the
sector. The μ belongs uniformly on the six reflections and nowhere on the
rotations. `test/hexagon.test.ts` plants that exact candidate as a mutation and
shows it caught: it corrupts precisely the odd rotations (`r60`, `r180`,
`r300`) and breaks Cayley closure. The difference is one of indexing, not of
geometry — a *screen-relative* "position within row" would reverse on odd
sectors and put the μ back on the rotation.

The twelve maps close into D₆: Cayley table verified against
`r_i·r_j = r_{i+j}`, `r_i·m_j = m_{i+j}`, `m_i·r_j = m_{i−j}`, `m_i·m_j = r_{i−j}`,
0 escapes of 144, both conventions; `rot60⁶ = id`, `rot60³ = inversion`, every
mirror an involution, at *d* = 1,2,3. A render-space fixture checks three
hand-picked cells per isometry against the geometric rotation/reflection of
their screen centroids.

## What the hexagon measures — the D₆ is free

| | apex | ifs |
|---|---|---|
| isometries lifting exactly | **12 / 12** | **12 / 12** |
| rotations lift by | identity relabelling | identity relabelling |
| reflections lift by | `φ = (σ₂ σ₃)` | `φ = (σ₂ σ₃)` |

**The hexagon canvas cannot see the convention difference.** Its lift table is
identical in both, where the triangle's separates them sharply (order 2 against
order 6, Part 2 section E). The reason is structural rather than surprising:
every isometry either permutes sectors, leaving each cell's charge untouched,
or permutes sectors *and* applies μ = `m_A` — and `m_A` lifts exactly in both
conventions. The D₆ is inherited from the **arrangement** of six identical
sectors; the V₄ structure that distinguishes the conventions lives *inside* a
sector, where D₆ never reaches.

This is worth stating plainly because it is the opposite of what a richer
symmetry group usually means. Going from D₃-with-order-2-realised to a full D₆
buys no new information about the colouring.

## The balance fact — and a framing that did not survive

A lone triangle is **not** orientation-balanced. With `up = (4ᵈ+2ᵈ)/2` and
`down = (4ᵈ−2ᵈ)/2`:

| *d* | triangle up / down | surplus | hexagon up / down |
|---|---|---|---|
| 1 | 3 / 1 | 2 | 12 / 12 |
| 2 | 10 / 6 | 4 | 48 / 48 |
| 3 | 36 / 28 | 8 | 192 / 192 |
| 4 | 136 / 120 | 16 | 768 / 768 |

The hexagon is exactly balanced at 3·4ᵈ each, at every depth, in both
conventions — rendered in the app as a live check, not a constant.

**The mechanism is sector parity, not missing corners.** A rotation by an odd
multiple of 60° exchanges the two lattice orientations, so three sectors are
drawn in each; the triangle's surplus of 2ᵈ appears once with each sign and
cancels. Measured directly: the even sectors carry `+3·2ᵈ` and the odd sectors
`−3·2ᵈ`.

A proposed "corner-defect" framing — that the triangle's imbalance lives in
three corners the hexagon lacks — does **not** match the measurement, and is
recorded here as refuted rather than quietly dropped. The imbalance is `2ᵈ`
(16 at *d* = 4), not 3; and the hexagon contains six *complete* triangles, so
no corner is absent from it at all.

## Two notes on status

- This corresponds to the **FOLDKEY hex6 profile** — one `s=3` level
  restricted to its six central codes.
- Regular hexagons are **not rep-tiles**; sectors are. That is why the hexagon
  here is a *derived* canvas built from six triangle instances, and not a
  primitive with a subdivision rule of its own.
