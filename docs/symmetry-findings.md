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

### E. √6 is genuinely distinguished — an open question, answered

The study guide asked whether √6 is really special or an artifact of which
child was chosen inverted. **It is genuinely special.** V₄ has three
non-trivial characters, one per quadratic subfield. Only one survives the
mirror:

| character | kernel | preserved by `m_A`, d=6 |
|---|---|---|
| `χ_√6` | {gold, purple} | **4096 / 4096** |
| `χ_√3` | {gold, blue} | 2048 / 4096 |
| `χ_√2` | {gold, red} | 2050 / 4096 |

The latter two sit at chance. So the {gold, purple} vs {blue, red} split is
not one of three equivalent ways to two-colour the figure — it is *the*
canonical one, forced by X carrying `σ₂σ₃` together with the mirror fixing X.

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
  geometrically distinguished among the three wavefront families. Is it?
- Does the `ftype` decomposition survive to the `sc` (self-count) variant, or
  does the lexicographic self-count rule cut across the arms?
