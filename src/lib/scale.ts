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
 * This module is BOOKKEEPING. It adds no geometry, no new ring (Q4: subdivision
 * is scaling by an integer, so nothing here divides and no √ appears), and no
 * second radix. `src/lib/reptile.ts` remains the only place a k ≠ 2 exists, and
 * it is a measurement instrument that nothing in `src/app` imports.
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
 * The edge division applied at `level` of `word` — a PURE FUNCTION OF THE
 * ADDRESS, which is the constraint the module header states.
 *
 * Both arguments are read today only to be ignored: at fixed radix the answer is
 * the constant. The signature is the point. A mixed-radix schedule is a
 * different BODY for this function — `word.charCodeAt(level)`, a parity of the
 * prefix, whatever the schedule turns out to be — and never a new argument,
 * because a new argument is how per-node data gets in.
 *
 * Takes `(word, level)` rather than a prefix string so that walking an address
 * allocates nothing: `scaleOfWord` calls this once per level, and slicing a
 * prefix each time would make resolving a plate quadratic in the address length
 * for no gain.
 */
export function radixAt(word: string, level: number): number {
  void word;
  void level;
  return EDGE_DIVISION;
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
 * Q3 prices what happens to this at rep-9: the rotation acts freely, there is no
 * hub, and the three arms need a transversal chosen by fiat. So this formula is
 * radix-4 structure and not a general law, and it is named for the figure rather
 * than for the scale to keep that visible.
 */
export const armCellsAtScale = (scale: number): number =>
  (cellsAtScale(scale) - 1) / 3;
