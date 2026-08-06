# The rep-9 charge and the rep-9 arms — what is forced, and what is fiat

Continues `docs/rep-tile-findings.md` Q3, which left rep-9 with a torsor and two
holes: no canonical charge basepoint, and *"the split needs a transversal of the
three first-digit orbits (27 choices), and none is distinguished."*

Both holes are real. Both are **smaller than Q3 believed**, and one of them —
the arms — is not a hole at all. Everything below was decided by computation in
`test/reptile.test.ts` against `src/lib/reptile.ts`; labels follow the house
convention.

- **[PROVEN]** exhaustive computation, decided by an oracle independent of the
  thing under test, with a mutation shown lethal.
- **[MEASURED]** a number this run produced, not exhaustive over its domain.
- **[DERIVED]** follows from a [PROVEN] fact by an argument stated here.
- **[ANALOGY]** structural resemblance only. Not evidence.

Three claims were mine to check. **Lead (a) is three-quarters right, lead (b) is
right but is not a second lead, and the guess behind both — that this partition
would give the arms — is refuted.** One claim in `rep-tile-findings.md` is
corrected and one is sharpened; both are marked below.

---

## The headline

> **Σ₉ carries TWO canonical parallel classes, not one, and they do different
> jobs** [PROVEN].
>
> | | the class | under D₃ | job |
> |---|---|---|---|
> | **P₁** | the rotation's orbits — `{0,3,5} {1,2,4} {6,7,8}` | every line fixed by all six symmetries | the **charge** |
> | **P₂** | the mirrors' fixed sets — `{0,4,6} {2,3,7} {1,5,8}` | class fixed; lines permuted exactly as the triangle's own vertices are | the **arms** |
>
> Every line of one meets every line of the other in exactly one letter, so the
> two coordinatise the alphabet with no group, no labelling and no search:
> **Σ₉ ≅ P₁ × P₂**.

The brief expected P₁ to do both jobs. It cannot: the rotation *fixes* each of
its own orbits, so the induced regions are rotation-invariant and no labelling
of them can be cyclic [PROVEN, checked geometrically over all 729 cells at depth
3]. A fibration whose fibres are invariant is a **charge**. The arms need a
fibration the rotation *moves*, and there is exactly one canonical such — P₂,
which the brief did not consider.

### The alphabet, with both coordinates

Nine letters, indexed as `alphabet(3)` orders them. `grade` names the P₁ class,
`vertex` the P₂ class. Both columns are computed from geometry, never declared.

| letter | (i,j,l) | orientation | grade | vertex | what it is |
|---|---|---|---|---|---|
| 0 | (2,0,0) | up | corner | **A** | the corner child at vertex A |
| 3 | (0,2,0) | up | corner | **B** | the corner child at B |
| 5 | (0,0,2) | up | corner | **C** | the corner child at C |
| 4 | (0,1,1) | up | edge | **A** | the upright on the edge *opposite* A |
| 2 | (1,0,1) | up | edge | **B** | the upright opposite B |
| 1 | (1,1,0) | up | edge | **C** | the upright opposite C |
| 6 | (1,0,0) | **down** | inverted | **A** | the inverted child beside corner A |
| 7 | (0,1,0) | **down** | inverted | **B** | beside corner B |
| 8 | (0,0,1) | **down** | inverted | **C** | beside corner C |

Both classifications are geometric, and both are *nameable in words*, which is
what makes them conventions rather than choices:

- **grade** — the corner class is the three children sharing a vertex with the
  parent, decided by coordinate equality in `cornerLetters` [PROVEN]. Dually:
  the corner class is exactly the three children that do **not** touch the
  parent's centroid; the other six do, alternating orientation around it
  [MEASURED].
- **vertex** — the letter fixed by `m_v`. At rep-9 every letter is fixed by
  exactly one mirror, which is the whole of the next section.

---

## Why this is rep-9 structure, and where the hub went

> **The three mirrors fix k letters each, and 3k = k² only at k = 3** [PROVEN,
> k = 2..9].

| k | fixed per mirror | do they partition Σ? | letters fixed by all of D₃ |
|---|---|---|---|
| 2 | 2 | no | **1** — X, the hub |
| **3** | **3** | **yes** | **0** |
| 4 | 4 | no | 1 |
| 5 | 5 | no | 1 |
| 6 | 6 | no | 0 |
| 7, 8 | 7, 8 | no | 1 |
| 9 | 9 | no | 0 |

At rep-4 the three mirror sets are **concurrent** — all three contain X — and at
rep-9 they are **parallel**. That is the same three sets seen from two sides, and
it collapses two facts into one:

> **"rep-9 has no hub" and "rep-9 has an arm partition" are one statement**
> [DERIVED, from the k = 2..9 sweep].

The consequence for `arms.ts` is that its central design decision stops being a
decision:

> An arm label is a D₃-**equivariant** map from letters to the three vertices.
> Such a map is free on each D₃-orbit subject to one condition — the value must
> be fixed by everything that fixes the letter. A mirror stabiliser admits
> exactly one value; a trivial stabiliser admits three; **the letter fixed by all
> of D₃ admits none, because no vertex is fixed by all of D₃** [PROVEN].

`arms.ts` argues at length that the hub must be *excluded* because including it
destroys disjointness. True, and now beside the point: **there is nothing
equivariant to map it to.** The exclusion is forced, not chosen.

The same count answers "is a canonical arm control a general phenomenon":

| k | 2 | **3** | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|
| equivariant arm maps | **1** | **1** | 3 | 9 | 27 | 243 |
| letters excluded | X | **none** | 1 | 1 | none | 1 |

[PROVEN.] From k = 4 the free orbits appear and each multiplies the count by
three. **A canonical three-arm decomposition exists at exactly two radices, 4 and
9, and rep-9 is the one with nothing left over.** Cross-checked by a second,
independent route — brute-force enumeration of every transversal — which agrees
at k = 3 (1) and k = 6 (27) [PROVEN].

---

## Q1(a) — are the inverted children a line in AG(2,3)?

**Yes, in the structure that is itself forced — and the question has a hidden
parameter the brief did not name.**

The three inverted letters `{6,7,8}` are not merely *a* line. They are **one of
the rotation's own orbits**, decided by set equality and no labelling at all
[PROVEN]. So the parallel class of the inverted line *is* the rotation-orbit
partition, and lead (a) and lead (b) are the same object approached from two
sides.

But "is this set a line" is not a question about Σ₉. It is a question about Σ₉
**together with an affine structure**, and there are three:

> The 1,296 affine labellings fall into exactly **3 classes of 432** under
> recolouring — AGL(2,3), whose orbits are precisely the classes of equal line
> set [PROVEN]. In **one** the inverted set is a line and every rotation orbit is
> a line. In the other **two** neither is.

The one where it is, is exactly the one where the rotation is a pure
translation. In the other two the rotation's linear part is a transvection
(`[0,4,8,3,7,2,6,1,5]`, unipotent of order 3) and the rotation twist takes
**three** values per depth instead of one, at depths 1, 2 and 3 [PROVEN].

> **SHARPENING to `rep-tile-findings.md` Q3.** That document recorded *"the
> rotation's linear part is exactly the identity — it is a pure translation
> [PROVEN]"*, and the corresponding twist result, from a **single witness**
> labelling. It is a property of **one of the three structures**, not of "the
> torsor". Nothing built on it is wrong — the structure it describes is the one
> anybody would choose — but it was stated one notch too broadly, and the choice
> it silently made is now made out loud.

The mirror sets are lines in **all three** structures, which is forced (the fixed
set of an affine map is an affine subspace, and a 3-element affine subspace of
AG(2,3) is a line) and is checked anyway [PROVEN]. So P₂ is structure-independent
and P₁ is not — which is the reason the arms turn out to be the sturdier of the
two constructions.

## Q1(b) — do the rotation orbits give the same partition?

**They give the same partition, necessarily** [PROVEN]. Not "the same as it
happens": the inverted set is a rotation orbit, so confirming (a) *is*
confirming (b). There are no competing gradings and therefore no choice to make
between them.

Where a genuine competition would have been — and is not:

> Of the **4** parallel classes of the canonical structure, exactly **2 are
> D₃-canonical**. P₁ has every line fixed by every symmetry; P₂ is fixed as a
> class with each line fixed by its own mirror and permuted by the rotations.
> The remaining two — the diagonals — are **exchanged with each other by every
> mirror** [PROVEN].

A charge built on a diagonal would be carried onto a *different* charge by a
reflection of the figure, so neither diagonal can be named. Two of four survive,
and they are the two the geometry had already handed over.

---

## The three layers, and which is fiat

### Layer 1 — the partition. **Forced.**

Two canonical fibrations, named above, both from geometry, no search. Refuting
this would take a third D₃-stable fibration; there is none [PROVEN].

### Layer 2 — the labelling. **Canonical up to one named equivalence.**

A charge is a value, not a fibre: turning a fibration into a number needs a
linear functional (φ and 2φ share every fibre and disagree on every value) and,
on a torsor, an offset. The chain, each step an observed filter over the 1,296
[PROVEN]:

| surviving | condition added |
|---|---|
| **1,296** | affine under the D₃ action |
| **144** | basepoint at letter 6 — the inverted letter fixed by `m_A` |
| **4** | each canonical class on its own coordinate factor |
| **2** | `rot⁺` translating by +1 rather than −1 on the vertex axis |

Notice the step that does **not** appear: no filter for the structure. Putting
both canonical classes on the coordinate axes already forces it.

The surviving two are `coordLabelling(3, 1)` and `coordLabelling(3, 2)`. They are
*constructed* from the two geometric coordinates with no search — the exhaustive
sweep is used to confirm they are among the 1,296, not to find them — and they
differ **by negating the grade axis and by nothing else** [PROVEN].

> **The named equivalence.** The rep-9 charge is canonical up to the unique
> non-trivial automorphism of ℤ/3 on the grade coordinate: which of the two
> upright classes counts as +1. Nothing geometric picks between them — both
> classes are nameable (`corner` shares a vertex with the parent, `edge` does
> not) but neither is *positive*. Mirrors and rotations both fix each class, so
> there is no chirality argument either.

This is the exact analogue of rep-4, where the basepoint is forced (all 6
automorphic labellings send X to the identity) and the residual freedom is a free
`Aut(V₄)`-torsor of order 6. Rep-9's residual freedom is `Aut(ℤ/3)`, of order 2.
**Rep-9 is less arbitrary here than rep-4, not more.**

### Layer 3 — the alphabet. **The thing that hardens, and it need not be fiat.**

Charge is *derived* from an address, so a basepoint convention is recoverable and
revisable; a letter ↔ child-position assignment written into files is not. The
number that matters is therefore the orbit count of layer 2's first line:

> **3 inequivalent affine structures** [PROVEN], of which **1** is selected by a
> property `rep-tile-findings.md` had already measured and wanted: the rotation
> being a translation, hence one global twist constant instead of three classes.

So the alphabet does not have to encode an arbitrary choice, provided it encodes
the two coordinates rather than an index order:

> **Recommendation.** Name the nine letters by (vertex, grade) — the vertex from
> `{A, B, C}` exactly as today, and the grade by a mark for each of the three
> classes. Then `armOfWord` is "read the vertex of the first letter", the grade
> charge is "sum the marks", and neither needs a table. One admissible spelling:
> `A B C` for the corner class, `a b c` for the edge class, `X Y Z` for the
> inverted class with `X` on the A-median — which keeps `[ABCX]`'s meaning where
> it can (`A` is still the corner child at A, `X` is still an inverted child on
> the A-median) and keeps the address regex a single character class.

What is genuinely hardened by that: the naming of the triangle's vertices A/B/C,
and the sense of `rot⁺`. **The format already contains both** — `AXES`,
`AXIS_SWAP` and the existing `[ABCX]` alphabet — so a rep-9 address adds no new
convention to the file. The grade *sign* never enters the file at all, because
the file stores addresses and the charge is computed from them.

### Layer 4 — the downstream constraint. **No trade exists.**

The brief asked whether the same assignment can make the rotation law
single-digit *and* admit the arm transversal, and flagged a forced trade as the
possible headline. It is not: they live at different levels [PROVEN].

Under the `ifs`-style frames the rotation is a **uniform** digit rewrite; under
the frames `rotationFrames` solves for, it rewrites **only the first digit** —
729 of 729 cells at depth 3, and 0 of 729 the other way round, so the two are
genuinely different addressings of the same triangles. The construction is the
one rep-4 cannot have: the recurrence `F(π d) = r ∘ F(d)` closes iff the rotation
acts freely, and at rep-4 the orbit through X has length one. That is
`rep-tile-findings.md`'s DERIVED claim, now **constructed and checked cell for
cell**.

Across that convention change, at depth 3 (729 cells) [PROVEN]:

| quantity | unchanged | why |
|---|---|---|
| the **arm** of every cell | **729 / 729** | it reads the first digit, which no convention moves |
| the **grade** of every cell | **729 / 729** | a convention rewrites digits by elements of S₃, and every element of S₃ preserves the grade classes |
| the **vertex sum** | 243 / 729 | the component that was never canonical |

So the arm decomposition and the grade charge are invariants of the **cell**,
immune both to the symmetry applied and to the addressing convention chosen.

---

## The verdict on a canonical charge

> **A canonical rep-9 charge exists, it is ℤ/3-valued, and it is defined from
> the digit word alone: the sum of the per-letter grades, 0 on the inverted
> letters and ±1 on the two upright classes** [PROVEN].
>
> It is **exactly D₃-invariant**, cell for cell, at every depth: **44,280 tests,
> zero mismatches**, depths 1–4 over all six symmetries. Not
> equivariant-up-to-a-relabelling as the full charge is — *invariant*.
> Guard-fire: moving one letter between grade classes produces 126 mismatches at
> depth 2 alone.

The reason it survives the mirrors, which act by a **transducer** and not by a
digit rewrite, is that every element of S₃ preserves each grade class — the
classes are cut out by the multiset `{i, j, l}`, which a coordinate permutation
cannot change. Whatever state the transducer is in, each digit's grade is
preserved and the sum with it.

The full (ℤ/3)² charge does **not** exist canonically, and the measurement shows
exactly where it fails:

| depth | full charge under `m_A` | grade under `m_A` |
|---|---|---|
| 2 | 54 / 81 | **81 / 81** |
| 3 | 405 / 729 | **729 / 729** |
| 4 | 3,645 / 6,561 | **6,561 / 6,561** |

[PROVEN; the left column reproduces Q3's table from the constructed labelling
rather than the searched witness, which is an independent confirmation of it.]
The vertex component is where every obstruction lives: it needs a basepoint,
the rotation translates it by +1 per level, and the mirrors preserve it only up
to a word-dependent shift driven by the inverted digits.

**So the split is:**

| | needs | status |
|---|---|---|
| grade (ℤ/3) | a sign | canonical up to `Aut(ℤ/3)`; never enters the file |
| vertex (ℤ/3 torsor) | a named vertex + a rotation sense | both already in the format |
| the pair | both | canonical relative to conventions the codebase already has |

The minimal fiat, stated plainly: **one bit** — which upright class is +1 — and
it is isolated to the layer that does the least damage, because it is not
serialised.

---

## Q2 — the arms, with no hub

### The transversal is forced, and Q3 was wrong on both halves

> **27** is the count of **transversals**; the count of **decompositions** is
> **9**, because T, πT and π²T name the same three parts. Of those 9, requiring
> the **mirrors** to permute the parts as well as the rotation leaves **exactly
> one** — the mirror fixed sets [PROVEN].

The rotation alone cannot see the difference, which is why Q3 found none: it was
asking a question the rotation cannot answer. The guard-fire makes this concrete
rather than rhetorical — take the rival decomposition `{0,1,6} {2,5,8} {3,4,7}`,
a genuine transversal, and *every gate a rotation-only argument can raise stays
green*: the parts are still 243 cells each at depth 3 and the rotation still
permutes them cyclically. What dies is the mirror [PROVEN].

### The decomposition

`arm(w)` = the **vertex class of the first digit**. No skipping, because there is
nothing to skip.

| depth | arm A | arm B | arm C | residual |
|---|---|---|---|---|
| 1 | 3 | 3 | 3 | **0** |
| 2 | 27 | 27 | 27 | **0** |
| 3 | 243 | 243 | 243 | **0** |
| 4 | 2,187 | 2,187 | 2,187 | **0** |

[PROVEN.] Against rep-4's `(4^d − 1)/3` per arm **plus one hub**. The rotation
permutes them A → C → B and each mirror fixes its own and swaps the other two —
the vertex action and nothing else [PROVEN, from the geometric image lookup at
every depth]. Congruence is checked as **point sets**, not by counting: the
rotated image of arm A is arm C key for key at depth 3 [PROVEN].

The label is stable under extension — a suffix cannot change the first digit —
which is the property `arms.ts` needs for isolation and the address-keyed plate
to compose without either knowing about the other [DERIVED].

**The shape, honestly** [MEASURED]. Arm A is the corner child at A and the
inverted child beside it, sharing a full edge (a rhombus), plus the upright on
the edge opposite A, meeting that rhombus at a **single point** — the parent's
centroid. So the arm is connected but pinched, which is the same character as
rep-4's spiralling chain of triangles meeting at points, arriving in one step
instead of infinitely many.

### The induced action survives verbatim

The setwise stabiliser of arm A in D₃ is `⟨m_A⟩`, of order 2: the rotations carry
the arm off itself, and of the three mirrors only `m_A` fixes it. Measured at
depth 3 over all 243 cells of arm A [PROVEN]:

| mode | full orbit sizes | clipped to the arm |
|---|---|---|
| 1 | 1 × 243 | 1 × 243 |
| 2 | 1 × 27, 2 × 216 | 1 × 27, 2 × 216 — **unchanged** |
| 3 | 3 × 243 | **1 × 243** |
| 6 | 3 × 27, 6 × 216 | **1 × 27, 2 × 216** |

Mode 3 paints what mode 1 paints and mode 6 paints what mode 2 paints, exactly as
`arms.ts` documents for rep-4, and for exactly the same reason. **What has
changed is that there is no hub to be unreachable while an arm is isolated** —
the cost `arms.ts` states in the open simply is not incurred at rep-9.

---

## Can a rep-9 figure be serialised without hardening an arbitrary choice?

**Yes** [DERIVED, from the layer analysis above], subject to one condition and
one caveat.

- **The condition.** The nine letters must be named by their two canonical
  coordinates, not by an index order. An index order would be harmless in itself
  — any documented bijection is recoverable — but it would put the burden of the
  structure in a lookup table rather than in the address, and `plate.ts` and
  `arms.ts` both want to read the structure off the letter.
- **What gets hardened:** the naming of the triangle's vertices and the sense of
  `rot⁺`. Both are already in the file format and in `figure.ts`. Nothing new.
- **What does NOT get hardened:** the charge basepoint (derived, revisable), the
  grade sign (never serialised), the affine structure (selected by the
  translation property, and in any case only used to *interpret* the address),
  and the role convention (both the uniform and single-digit rotation laws leave
  the arm and the grade of every cell unchanged).
- **The caveat.** `artfile.ts:984-985` pins the address alphabet to
  `[ABCX]{1,MAX_DEPTH}` (with an `s[0-5]:` sector tag on the hexagon) and the
  payload states a **depth**. A rep-9 address needs nine letters, and a
  mixed address needs the radix schedule to be recoverable — which is
  `rep-tile-findings.md` Q2's outstanding format work, unchanged by anything
  here.

The conclusion `rep-tile-findings.md` reached — *"what not to build first: a
rep-9 renderer, because its charge would need a basepoint chosen by fiat and its
arms a transversal chosen by fiat, and both choices would harden into the file
format"* — **is now half retracted**. The arms need no fiat at all. The charge
needs one bit that is not serialised. The reason not to build a rep-9 renderer
first is the depth/scale bookkeeping and the address alphabet, not the
mathematics of the charge.

---

## Corrections to `docs/rep-tile-findings.md`

1. **Q3, "Non-canonical arms"** — *"the split needs a transversal of the three
   first-digit orbits (27 choices), and none is distinguished"*. **Refuted.**
   There are 9 decompositions, not 27 choices, and exactly one is D₃-stable
   [PROVEN]. The claim was true of the rotation alone and false of D₃.
2. **Q3, "the rotation's linear part is exactly the identity"** — **sharpened.**
   True in one of the three affine structures, false in the other two; the
   original measurement used a single witness [PROVEN].
3. **Q3, "no hub … `arms.ts`'s three arms plus the excluded hub has no rep-9
   analogue in that form"** — **stands, and is now explained.** The hub is the
   common point of the three mirror fixed sets; at rep-9 those sets are parallel
   instead of concurrent, which is why the residual is zero [PROVEN].
4. **Q3, "the apex-style single-digit rotation law exists at rep-9 with no hub
   exception" [DERIVED]** — **upgraded to [PROVEN]**, by construction plus a
   cell-for-cell check.
5. **`src/lib/scale.ts`'s `armCellsAtScale` comment** — *"Q3 prices what happens
   to this at rep-9: … the three arms need a transversal chosen by fiat"*. That
   sentence is now wrong; the formula is still radix-4 structure (rep-9's arm is
   `scale²/3` with no `−1`), so the code is right and only the reason given is
   stale. Left alone, because `scale.ts` is outside this pass's remit.

---

## Artifacts

- `src/lib/reptile.ts` — the two parallel classes (`rotationOrbits`,
  `mirrorFixedSets`), the coordinates (`canonicalCoords`, `coordLabelling`), the
  affine-structure machinery (`collectAffineLabellings`, `planeLines`,
  `groupIntoStructures`), the arm counts (`armLetterMaps`,
  `rotationTransversals`, `d3StableTransversals`) and the frames
  (`subdivideFramed`, `rotationFrames`). No float; nothing in `src/app` imports
  it.
- `test/reptile.test.ts` — 12 tests added, all counts above.
- Suite: 1,463 → **1,475**, **none of the 1,463 modified**. `tsc --noEmit` and
  `eslint` clean.
- Lethality: a one-line mutation of the vertex coordinate in `canonicalCoords`
  turns **4** of the 12 red, including the induced-action table.
