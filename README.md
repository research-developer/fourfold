# FOURFOLD

A two-player symmetry-claiming game played on the V₄ XOR Sierpiński figure.

**▶ Play: https://fourfold-seven.vercel.app**

---

## The board

An equilateral triangle is cut into four half-scale children — three upright
corners (**A**, **B**, **C**) and one inverted centre (**X**) — and the cut
repeats. Every leaf at depth *d* is named by an address: a word of length *d*
over `{A, B, C, X}`. Two functions live on those addresses:

| | |
|---|---|
| **charge** `c(w) ∈ V₄` | the product of the per-digit charges |
| **orientation** `ε(w) ∈ ℤ₂` | the parity of the number of X's |

`V₄` is the Klein four-group, realised here as `Gal(ℚ(√2,√3)/ℚ)`. On 2-bit
codes its group law is bitwise XOR — hence the name. The four colours name
four field automorphisms:

| colour | element | action on K | fixes |
|---|---|---|---|
| gold | `1` | identity | all of K |
| blue | `σ₂` | `√2 ↦ −√2` | `√3` |
| red | `σ₃` | `√3 ↦ −√3` | `√2` |
| purple | `σ₂σ₃` | both flip | `√6` |

Bright is upright (`ε = 0`), dark is inverted (`ε = 1`). Colour is a rendering
decision applied at the end — the mathematics is entirely in `(c, ε)`.

## The rules

Click cells to build a **claim**. A cell scores only if its mirror partner
across some median is *also* in the claim **and** the two charges are
**coherent** — both drawn from `{gold, purple}`, or both from `{blue, red}`.

Those two sets are the cosets of `H = {1, σ₂σ₃}`, the subgroup fixing `√6`.

- A claim needs **three** scoring cells to stand.
- Unpaired cells score nothing and are released back to the board.
- Cells that score are locked to the player who claimed them.
- Two consecutive passes ends the game.

Scoring: `m_A` pays **+1**, `m_B` and `m_C` pay **+3** each, and a cell
collects from *every* axis it satisfies. The hub is worth **+7**.

## Why the axes are priced differently

This is the whole game, and it is a theorem.

**The vertical median is free.** Reflecting across `m_A` swaps the digits B and
C in every address. That swap lifts to an **automorphism** `φ` of `V₄` — it
exchanges `σ₂` with `σ₃` and fixes `1` and `σ₂σ₃`. So `c(σ_A w) = φ(c(w))`
holds for *every* leaf, and every vertical pair is legal.

**The diagonals are earned.** They act on addresses *with carry*, like an
odometer — the digit permutation at position *i* depends on how many X's
precede it. No relabelling of the four colours can track that. Writing
`ftype(w)` for the first non-X digit of `w`:

> **Theorem.** A cell `w` and its mirror `r_a(w)` are coherent iff
> - `a = A`: always;
> - `a = B`: `ftype(w) = B`, or `w = Xᵈ`;
> - `a = C`: `ftype(w) = C`, or `w = Xᵈ`.

Each diagonal therefore reaches exactly `(4ᵈ − 1)/3 + 1` cells — 86 of 256 at
depth 4, 1366 of 4096 at depth 6. A player who works out *"look at the first
digit that isn't X"* has found the same obstruction that stops the figure from
having 120° rotational symmetry.

The all-X **hub** is the unique cell on all three medians, and the only place
where the figure's threefold structure is exact.

## Verification

The scoring rule is not asserted, it is checked. `tools/game_theorem.py`
enumerates the figure with exact `Fraction` arithmetic, derives mirror
partners geometrically, and verifies the theorem by set equality at depths
2–6. Its output at depths 2, 3, 4 is committed as golden fixtures under
`test/golden/`, and the test suite pins the TypeScript implementation against
them cell by cell — charge, orientation, all three mirror partners, coherent
axes, and geometry.

`tools/symmetry_truth.py` is the wider survey it came from: for each of the
six triangle isometries it searches all 24 colour permutations for the best
match, and reports the twist `c(σw) ⊕ c(w)` grouped by `ftype`. That table is
where the `(4ᵈ−1)/3` structure first showed up.

The TypeScript builder carries barycentric coordinates as **integers scaled by
2^depth**, so every midpoint is exact and mirror partners are found by integer
key lookup. There is no floating-point comparison in the geometry path.

```bash
npm install
npm test          # 36 tests, incl. golden-fixture agreement
npm run dev

python3 tools/game_theorem.py    # re-verify the theorem, regenerate fixtures
python3 tools/symmetry_truth.py  # the full isometry × permutation survey
```

## Provenance

The figure comes from `equilat_v4.py` in the `mathster` research line, and the
group-theoretic companion note `equilat_v4_symmetry_laws.md` supplies Theorems
1–3 (covariance, the median law, the mirror). The `ftype` classification and
the axis-pricing theorem above were derived for this game and verified here.

## Stack

Next.js 16 · React 19 · TypeScript · Vitest. No runtime dependencies beyond
React; the figure is generated in the browser.

## Security note

`npm audit` reports 3 high advisories against `postcss` and `sharp`. Both are
transitive dependencies **bundled inside Next.js 16.2.12**, which is the
current `latest`; no patched Next release exists yet. `npm audit fix --force`
resolves them by downgrading to `next@9.3.3`, which is not a fix.

Neither is reachable here: the app uses no `next/image` (so `sharp` is not in
any code path), and `postcss` runs only at build time over CSS in this repo.
The site is statically prerendered with no server runtime. Revisit when Next
ships a patch.

## Licence

MIT
