/**
 * SCALE — the carrier of resolution, replacing depth.
 *
 * ── What this module is for, and what it is NOT ──────────────────────────
 *
 * `docs/rep-tile-findings.md` measured the mixed-radix question and returned a
 * verdict with one cost attached: **depth stops being resolution**. Its MIX-C
 * tree has 354 leaves, ALL AT DEPTH 3, carrying three different scales — 12, 18
 * and 27 [PROVEN there]. Depth 3 names all of them and distinguishes none. The
 * order that survives is not `≤` on depth; it is DIVISIBILITY of scale.
 *
 * At the radix this program actually cuts — four children, edge division two —
 * `scale = 2^depth` is a bijection, so nothing here can change what the program
 * draws. That is the entire point of doing it now. Every claim below is
 * checkable TODAY against the shipped behaviour, and `test/byteidentity.test.ts`
 * checks it on the bytes of all three exports. Written after a second radix
 * existed, none of it would be checkable at all.
 *
 * This module is BOOKKEEPING. It adds no geometry and no new ring (Q4:
 * subdivision is scaling by an integer, so nothing here divides and no √
 * appears).
 *
 * ── AMENDED: the second radix arrived, and it is ADDITIVE ────────────────
 *
 * When this module was written it added "and no second radix — `reptile.ts`
 * remains the only place a k ≠ 2 exists". That is no longer true: `figure.ts`
 * now also builds a rep-9 figure, `REP9_EDGE_DIVISION` is here, and `radixAt`
 * has a body that reads the address instead of ignoring it.
 *
 * What has NOT changed, and is the whole discipline of the addition: radix 4 is
 * still the default and is behaviourally untouched. Every address the program
 * wrote before this change is spelled over `[ABCX]` plus the `s0:`–`s5:` sector
 * tag, none of which is a rep-9 letter, so `radixAt` answers `EDGE_DIVISION` on
 * every one of them exactly as the constant did. The rep-9 letters are a
 * disjoint character set precisely so that this is a theorem about the alphabet
 * and not a hope about the call sites — see `REP9_LETTERS`.
 *
 * `src/lib/reptile.ts` remains a measurement instrument that nothing in `src/`
 * imports; it is the independent oracle the rep-9 tests decide against, and
 * keeping it un-imported is what makes those tests evidence rather than a
 * restatement.
 *
 * ── SCALE IS THE EDGE DIVISION PRODUCT, NOT THE CHILD COUNT ──────────────
 *
 * The single most confusable thing here, and `reptile.ts`'s header states the
 * same rule for the same reason: refinements compose by multiplying EDGE
 * divisions. Rep-4 then rep-9 is edge 2 then edge 3, i.e. edge 6, i.e. 36
 * children — so the edge division is what behaves like a numeral digit, and the
 * child count is its square.
 *
 *   scale       product of the edge divisions from the root. 2^depth here.
 *   cells       scale², per sector. 4^depth here.
 *
 * So `4 ** depth` in the old code is `scale * scale`, and `2 ** depth` is
 * `scale`. Both readings appear at the sites this module replaced, and mixing
 * them up is the one way to get an answer that is still a power of two and still
 * wrong. Hence `cellsAtScale`, so no caller writes the square by hand.
 *
 * ── THE RADIX IS A PURE FUNCTION OF THE ADDRESS. This is a constraint. ───
 *
 * Q2's DERIVED address rule: `plate.ts` rests on *address prefix = ancestry*,
 * and that survives mixed radix **iff the radix is a pure function of the
 * address**. If the radix were per-node DATA, an address would no longer
 * determine its own scale, prefix resolution would stop being well defined, and
 * the plate's four resolution rules would lose their meaning.
 *
 * REJECTED, explicitly, and this is the rejection that shapes the module: a
 * `radix` field on `Cell`, on `TreeNode`, or in `ArtPayload`. It is the obvious
 * way to write mixed radix and it is the one that cannot work. `radixAt` below
 * takes the word and the level and reads nothing else — no node, no map, no
 * closure over a tree — so the property is enforced by the SIGNATURE rather than
 * by a comment asking future code to be careful. `test/scale.test.ts` measures
 * it anyway, by deriving a scale from an address with no figure in hand.
 *
 * ── THE BOUNDARY ─────────────────────────────────────────────────────────
 *
 * `scaleOfDepth` is the ONE place a depth becomes a scale — the only expression
 * `EDGE_DIVISION ** depth` anywhere in `src/`. Its two callers are the two edges
 * where a depth enters the model from outside it:
 *
 *   `figure.ts` `buildFigure(depth)`    — the UI states a depth (a button).
 *   `artfile.ts` `cellCount(_, depth)`  — the FILE states a depth (a field).
 *
 * The file format does not change and must not: `ArtPayload.depth` stays a
 * depth, written exactly as before. At radix 4 the file can state a depth while
 * the model holds a scale because the two determine each other, and the pinned
 * bytes in `test/byteidentity.test.ts` are what holds that line. What a second
 * radix would need is a radix SCHEDULE in the file — which is a format change,
 * and deliberately not this change.
 */

/**
 * The edge division applied at every cut: two, giving 2² = 4 children.
 *
 * Named rather than written as a `2`, because the two 2s in the old `2 ** depth`
 * and `4 ** depth` are DIFFERENT NUMBERS — one is the edge division and one is
 * its square — and a bare literal cannot say which. Q4 fixes the admissible
 * family: the aligned refinements divide the edge by an integer k and produce k²
 * children, so the admissible child counts are exactly the perfect squares
 * [PROVEN for m ≤ 40]. A "rep-3" cut is not in the family at all.
 */
export const EDGE_DIVISION = 2;

/**
 * The edge division of the SECOND radix: three, giving 3² = 9 children.
 *
 * THREE, NOT NINE, and the number is worth being loud about because the brief
 * that commissioned this said nine. `radixAt` returns an EDGE DIVISION — it
 * returns 2 at rep-4, whose child count is 4 — so the rep-9 answer is 3. A 9
 * here would make `scaleOfWord` report 9^d where the geometry has 3^d and
 * `cellsAtScale` report 81^d cells where there are 9^d, which is precisely the
 * confusion the module header exists to prevent. Measured rather than argued:
 * `test/rep9figure.test.ts` decides it against `reptile.descend(ROOT, 3, …).den`,
 * an actual descent of an actual triangle that knows nothing about this file.
 */
export const REP9_EDGE_DIVISION = 3;

/**
 * The nine rep-9 letters, indexed `3·gradeClass + vertex` — corner A, corner B,
 * corner C, edge A, edge B, edge C, inverted A, inverted B, inverted C.
 *
 * ── Why the alphabet lives HERE and not in `figure.ts` ───────────────────
 *
 * Because it is what makes the radix recoverable from the address, which is this
 * module's one constraint. `figure.ts` derives everything else about a letter —
 * its vertex, its grade, its child position, its frame — from the geometry; the
 * only thing it takes from here is the spelling, so there is exactly one place
 * where the nine characters are written down and no way for the dispatch below
 * to drift from the alphabet it dispatches on.
 *
 * ── Why NOT `A B C / a b c / X Y Z`, which `docs/rep9-charge.md` suggests ─
 *
 * DEVIATION, and it is forced. That document offers `A B C` for the corner
 * class, `a b c` for the edge class and `X Y Z` for the inverted class as "one
 * admissible spelling", the point being that the letters must be named by
 * (vertex, grade) rather than by an index order. The naming is honoured below.
 * The *characters* cannot be: `A`, `B`, `C` and `X` are already rep-4 letters,
 * so under that spelling `radixAt("A", 0)` has two right answers and an address
 * stops determining its own scale — the exact property the module header calls
 * the constraint, that `test/scale.test.ts` measures, and that `plate.ts`'s
 * "prefix = ancestry" rests on. The alternative would be carrying the schedule
 * as per-node data, which is the rejection this module was built around.
 *
 * So the nine are lowercase and disjoint from `[ABCX]`, and they still spell the
 * two coordinates: position within a triple is the VERTEX (A, B, C), and which
 * triple is the GRADE class. `abc` are the corner children — lowercase `ABC`,
 * carrying rep-4's meaning, "the corner child at that vertex". `xyz` are the
 * inverted children — lowercase `X`, rep-4's inverted letter, of which rep-9 has
 * three rather than one. `uvw` are the remaining upright class, sitting
 * immediately before `xyz` so the alphabet reads corner, edge, inverted in one
 * run and the whole address alphabet is the single character class `[a-cu-z]`.
 *
 * Nothing in `[ABCX]`, in the `s0:`–`s5:` sector tag, or in the decimal digits
 * collides with it, so every address the program can write today keeps the
 * answer it has today. `test/scale.test.ts`'s existing regression guard on
 * `radixAt` is unmodified and still green.
 */
export const REP9_LETTERS = "abcuvwxyz";

const REP9_LETTER_SET: ReadonlySet<string> = new Set(REP9_LETTERS);

/**
 * The edge division applied at `level` of `word` — a PURE FUNCTION OF THE
 * ADDRESS, which is the constraint the module header states.
 *
 * The signature was the point before there was a second radix, and it still is:
 * a mixed-radix schedule is a different BODY for this function and never a new
 * argument, because a new argument is how per-node data gets in. This is that
 * body, and it reads exactly the one character the level names.
 *
 * Takes `(word, level)` rather than a prefix string so that walking an address
 * allocates nothing: `scaleOfWord` calls this once per level, and slicing a
 * prefix each time would make resolving a plate quadratic in the address length
 * for no gain.
 *
 * Anything that is not a rep-9 letter answers `EDGE_DIVISION`. That covers the
 * four rep-4 letters, the sector tag, and an out-of-range level — the last
 * mattering because `charAt` returns `""` past the end and a set membership test
 * is the one form of this check that does not accidentally say yes to it.
 */
export function radixAt(word: string, level: number): number {
  return REP9_LETTER_SET.has(word.charAt(level))
    ? REP9_EDGE_DIVISION
    : EDGE_DIVISION;
}

/**
 * THE BOUNDARY. A depth from outside the model becomes the scale the model
 * carries. See the module header for the two callers and why there are two.
 *
 * The inverse is not offered. Going back — scale to depth — is exactly the
 * operation that stops existing under mixed radix (scale 12 is one rep-4 and one
 * rep-9 cut, or one rep-12 cut, and depth cannot say which), so a `depthOfScale`
 * would be a function that has to be deleted later. The places that still need a
 * depth already have one: it is a field on the figure and on the payload.
 */
export function scaleOfDepth(depth: number): number {
  return EDGE_DIVISION ** depth;
}

/**
 * THE SAME BOUNDARY FOR REP-9. A depth from outside becomes a scale of 3^depth.
 *
 * A sibling rather than an optional second argument on `scaleOfDepth`. A default
 * parameter would let a caller that has forgotten which figure it is holding
 * still typecheck and still get an answer, and the answer would be the rep-4 one
 * — a silent wrong number of exactly the kind the scale/depth confusion produced
 * in the first place. Two names cannot be got wrong quietly.
 *
 * Its one caller is `buildRep9Figure`, the rep-9 analogue of `buildFigure`: the
 * UI states a depth. The FILE does not yet state a rep-9 depth — the format work
 * is a separate pass — so there is no second caller here where `scaleOfDepth`
 * has two.
 */
export function scaleOfRep9Depth(depth: number): number {
  return REP9_EDGE_DIVISION ** depth;
}

/**
 * The scale an address determines for itself — the product of the edge divisions
 * along it. No figure, no tree, no lookup.
 *
 * `word` is the CUTS, without the sector tag: `plate.ts`'s `wordOf(a, stem)`.
 * The tag names which of six copies of the triangle a cell is in and says
 * nothing about resolution, so counting it would make every hexagon address
 * three levels finer than it is.
 */
export function scaleOfWord(word: string): number {
  let scale = 1;
  for (let i = 0; i < word.length; i++) scale *= radixAt(word, i);
  return scale;
}

/**
 * Cells under a node of this scale, per sector: scale². Six of them on the
 * hexagon.
 *
 * The old spelling was `4 ** depth`. See the header on why the square is here
 * and not at the call sites.
 */
export const cellsAtScale = (scale: number): number => scale * scale;

/**
 * THE RESOLUTION COMPARISON. True when `fine` is a refinement of `coarse` — that
 * is, when a cell at `coarse` is exactly tiled by cells at `fine`.
 *
 * DIVISIBILITY, not `≤`. At radix 4 both scales are powers of two, so `coarse |
 * fine` and `coarse ≤ fine` agree on every pair and this changes nothing today.
 * That agreement is why the change is safe to make now and why it has to be made
 * now: at MIX-C's scales 12, 18 and 27 the two stop agreeing (18 ≤ 27 but 18 ∤
 * 27), and `<` would silently start answering a question nobody asked.
 *
 * ── The case this function admits and `≤` could not ──────────────────────
 *
 * Two scales can be INCOMPARABLE — neither refines the other, as 18 and 27 — and
 * that is a real state of a mixed tree, not an error. `≤` is total and can never
 * report it; divisibility is a partial order and does, by returning false both
 * ways round. The callers that today have a two-way branch (`plate.ts`) or a
 * three-way one (`provenance.ts`) will need a further case when a second radix
 * exists. Each says so where it branches. Nothing here invents an answer for a
 * case that cannot yet arise.
 */
export const refines = (coarse: number, fine: number): boolean =>
  fine % coarse === 0;

/**
 * Upright — non-inverted — children at one cut: k(k+1)/2. Three at edge
 * division two.
 *
 * `reptile.ts`'s `upCount`, restated rather than imported: `reptile.ts` is a
 * measurement instrument that nothing shipped depends on, and importing it here
 * would make it one. Three lines against a dependency the findings document
 * describes as deliberately absent.
 */
export const uprightsAt = (k: number): number => (k * (k + 1)) / 2;

/**
 * The gasket: words with no inverted digit, i.e. no `X`. `3^depth` here.
 *
 * THE ONE COUNT ON THIS PAGE THAT IS NOT A FUNCTION OF THE SCALE, and it is
 * worth being loud about because it looks like one. Scale is the product of the
 * edge divisions; the gasket is the product of the UPRIGHT CHILD COUNTS, and
 * k(k+1)/2 is not recoverable from k² alone once k varies — a scale-6 cell is
 * 2·3 or 6·1, with 3·6 = 18 or 21 upright words respectively. So this takes the
 * depth, walks the levels, and multiplies.
 *
 * Which is legitimate, and marks the line this refactor actually draws: DEPTH
 * REMAINS THE NUMBER OF CUTS — the length of an address, a real and durable
 * quantity — and stops only being a RESOLUTION. Counting levels is fine.
 * Exponentiating by them is what was wrong.
 */
export function gasketAtDepth(depth: number): number {
  let n = 1;
  for (let d = 0; d < depth; d++) n *= uprightsAt(EDGE_DIVISION);
  return n;
}

/**
 * Cells in one arm of the figure: (scale² − 1)/3.
 *
 * `docs/symmetry-findings.md` §D's prediction, in scale. Here rather than in
 * `arms.ts` because `draw/page.tsx` computes the same number for its own
 * announcement and a second spelling is a second thing to get wrong — which is
 * the state this refactor found it in, with `(4 ** depth − 1)/3` written out in
 * both places.
 *
 * This formula is radix-4 structure and not a general law — the `−1` is the hub,
 * which exists because the rotation fixes X — and it is named for the figure
 * rather than for the scale to keep that visible. `rep9ArmCellsAtScale` is the
 * other radix's answer, and the two differ by exactly that `−1`.
 *
 * CORRECTION. This comment used to end: *"Q3 prices what happens to this at
 * rep-9: the rotation acts freely, there is no hub, and the three arms need a
 * transversal chosen by fiat."* The last clause is wrong and
 * `docs/rep9-charge.md` retracts it: 27 transversals are 9 decompositions, and
 * requiring the MIRRORS to permute the parts — not merely the rotation — leaves
 * exactly one. The rest of the sentence stands, and the missing hub is the same
 * fact seen from the other side; see `rep9ArmCellsAtScale`.
 */
export const armCellsAtScale = (scale: number): number =>
  (cellsAtScale(scale) - 1) / 3;

/**
 * Cells in one arm of the REP-9 figure: scale²/3, with no `−1` and no hub.
 *
 * The missing `−1` is not a tidier formula, it is the whole structural
 * difference between the two radices, and it is one fact rather than two
 * [PROVEN in `docs/rep9-charge.md`]. An arm label is a D₃-equivariant map from
 * letters to the three vertices; a letter admits a value iff its stabiliser
 * fixes one. At rep-4 the three mirror fixed sets are CONCURRENT — all three
 * contain X — so X is fixed by all of D₃, no vertex is, and X has no admissible
 * value: it is the hub, and it is the `−1`. At rep-9 the three mirror fixed sets
 * are PARALLEL — three letters each, disjoint, covering, which happens iff
 * 3k = k², i.e. only at k = 3 — so every letter has exactly one mirror in its
 * stabiliser, every letter has exactly one admissible value, and the residual is
 * zero. "Rep-9 has no hub" and "rep-9's arms partition" are the same statement.
 *
 * Exact, not merely integral: scale is a power of 3 here, so the division always
 * lands. `test/rep9figure.test.ts` counts the arms of the built figure rather
 * than trusting this, at every depth it builds.
 */
export const rep9ArmCellsAtScale = (scale: number): number =>
  cellsAtScale(scale) / 3;
