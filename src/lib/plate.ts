/**
 * The plate, keyed by ADDRESS rather than by cell index.
 *
 * A cell index is only meaningful next to the canvas that issued it. Change the
 * depth and index 4 is a different triangle, so a plate held as `index → colour`
 * cannot survive a depth change and the drawing program used to clear it. An
 * ADDRESS survives, because it is not a position in a list — it is the word over
 * `{A,B,C,X}` that says which cuts were taken to reach the cell, and those
 * words NEST. `AB` at depth 2 is the parent of `ABA`, `ABB`, `ABC`, `ABX` at
 * depth 3, and that relation is plain string prefixing.
 *
 * So the plate is held once, over addresses of every depth, and RESOLVED to
 * whichever depth is on screen. Deepening the view is exact; shallowing it is a
 * summary that throws nothing away, so returning to the deeper view restores the
 * plate byte for byte.
 *
 * ZERO FLOAT, and no arithmetic at all beyond string lengths: an address is a
 * word, an ancestor is a prefix, and both are exact. There is no tolerance here
 * to get wrong.
 *
 * ── TWO RADICES, ONE ALPHABET, AND WHY NOTHING ABOVE CHANGES ─────────────
 *
 * The word above is no longer over `{A,B,C,X}` alone: `A B C X` are the four
 * rep-4 cuts and `a b c u v w x y z` are the nine rep-9 cuts, and the two sets
 * are DISJOINT. That single fact is what keeps every sentence in this header
 * true under mixed radix, and it is worth spelling out which sentence rests on
 * which part of it:
 *
 *   ONE CHARACTER PER CUT, in both alphabets. `ancestorAt` truncates by
 *   character count, so "the ancestor k cuts down" is `slice(0, stem + k)`. A
 *   two-character rep-9 letter would land that slice mid-letter and prefix-
 *   equals-ancestry would fail on the first mixed address.
 *
 *   THE LETTER STATES ITS OWN RADIX, so `scale.scaleOfWord` reads a scale off a
 *   word with no tree in hand and `buildView`'s resolution comparison keeps
 *   meaning what it meant. `docs/rep-tile-findings.md` Q2 names this as the
 *   condition the plate rests on; the alphabet is how it is met, and no radix
 *   field is carried anywhere.
 *
 *   `s` AND `:` ARE STILL OUTSIDE IT. The rep-9 letters are `a`–`c` and `u`–`z`,
 *   so the sector tag argument below survives thirteen letters unchanged.
 *
 * WHAT IS GENUINELY NEW is in the WRITE path, not the read path: a node's
 * siblings are the letters of the cut that made it, and under two radices there
 * are two answers. `splitEdits` says where that is read from and why it cannot
 * be read from the parent.
 *
 * ── The address of a cell ────────────────────────────────────────────────
 *
 * On the TRIANGLE it is the cell's own `addr` — `"ABX"` — and nothing else.
 *
 * On the HEXAGON a cell is a pair (sector, base cell), and six sectors carry the
 * same base addresses, so the word alone names six different triangles. The
 * address is the sector tag `s0:` … `s5:` followed by the word: `"s3:ABX"`.
 *
 * The tag is chosen so that PLAIN STRING PREFIXING still means ancestry. It is a
 * fixed three characters, and `s` and `:` are outside `{A,B,C,X}`, so `"s3:A"`
 * is a prefix of `"s3:AB"` and of nothing in any other sector. Six sectors is
 * one digit, so the tag can never grow and shift the word. That is why the stem
 * length is a constant per canvas and not a search.
 *
 * ── Resolving to a depth ────────────────────────────────────────────────
 *
 * For a cell at the render depth, in this order:
 *
 *   1. EXACT      the address itself carries paint          — that colour
 *   2. ANCESTOR   the nearest painted proper prefix         — that colour
 *   3. CONSENSUS  every painted address strictly BELOW it
 *                 agrees on one colour                      — that colour
 *   4. otherwise unpainted
 *
 * Rule 2 is "going deeper": a child with no paint of its own inherits its
 * nearest painted ancestor, exactly, with no interpolation. Rule 3 is "going
 * shallower": a parent shows the colour its descendants agree on and shows
 * nothing when they disagree — a summary, not a loss, because the deeper
 * addresses are still in the map.
 *
 * ── Why EXACT beats CONSENSUS, which the sketch left open ────────────────
 *
 * The two can only ever both apply after a coarse paint followed by a finer one:
 * paint `AB` gold at depth 2, drop to depth 4, paint `ABAA` red. A write CLEARS
 * everything strictly below it (see `planPlateEdits`), so any other order leaves
 * at most one of them standing.
 *
 * In that state, depth 2 shows `AB` GOLD. The alternative — the consensus rule
 * winning, so a region goes blank the moment it is detailed — would mean zooming
 * out made work disappear, and the user has to trust that the plate is still
 * there. Gold is also the honest summary: it is the colour that cell was painted
 * at that depth. Either choice round-trips; only one of them is legible.
 *
 * ── The one rule that is not obvious ────────────────────────────────────
 *
 * A paint at depth d writes the depth-d address AND CLEARS EVERY STRICTLY
 * DEEPER ADDRESS UNDER IT. Without that, painting `AB` gold over a region that
 * was detailed at depth 4 leaves the old depth-4 addresses in the map; they are
 * invisible at depth 2, and they come back the instant the user zooms in —
 * paint they did not make, on top of paint they did. The clear is emitted as
 * ordinary edits carrying their own `from`, so undo puts the detail back.
 *
 * ── Erasing has to break the ancestor, not just delete ──────────────────
 *
 * Erasing a cell whose colour came from an ancestor cannot be done by deleting
 * anything: the ancestor is still there and the cell inherits again. The fix is
 * to SPLIT the ancestor — delete it and repaint the siblings hanging off the
 * path down to the erased cell, in the ancestor's own colour. Three writes per
 * level, exact, and the resolved plate is unchanged everywhere except the hole
 * that was asked for.
 *
 * A tombstone entry — an address recorded as explicitly unpainted — would have
 * been fewer lines and was rejected: it makes every consumer of the plate carry
 * a third state, including the file format, and it makes "the plate is a set of
 * coloured cells" stop being true.
 */

import type { Figure } from "./figure";
import type { Hexagon } from "./hexagon";
import { REP4_LETTERS, lettersAt, type ArtPayload } from "./artfile";
import type { CanvasKind } from "./orbit";
import { type CellEdit, type EditDirection, applyEdits, mergeEdits } from "./strokes";
import { radixAt, refines, scaleOfWord } from "./scale";

/** A word over the cut alphabet, with a sector tag on the hexagon. */
export type Address = string;

/** Address → `#rrggbb`. Absent means "nothing said here", NOT "unpainted". */
export type AddressPlate = ReadonlyMap<Address, string>;

/** One edit of the address plate. The same shape a cell edit has always had. */
export type PlateEdit = CellEdit<Address>;

/**
 * The four rep-4 cuts, in the order `buildFigure` takes them.
 *
 * A LIST with a stable order, because the split in `erasePlan` enumerates
 * siblings and the edits it emits have to come out the same way twice. That is
 * why it is not derived from `DIGIT_CHARGE`'s keys: key order of a record is a
 * fact about how it was written rather than a promise it makes. A STRING does
 * promise its order, so it is now read from `artfile.REP4_LETTERS` — the file
 * format's own statement of the four characters — rather than restated here,
 * which is the rule `artfile`'s `CANVASES` and `MODES_FOR` already follow.
 *
 * NO LONGER THE ONLY ANSWER to "what are this node's siblings". See
 * `splitEdits`: under two radices that question is about a particular cut, and
 * this is the answer for one of them.
 */
export const DIGITS: readonly string[] = [...REP4_LETTERS];

/** `s0:` … `s5:`. Fixed width, so the stem below is a constant. */
export const sectorTag = (s: number): string => `s${s}:`;

/** How many leading characters name the sector rather than the cuts. */
export const STEM: Readonly<Record<CanvasKind, number>> = {
  triangle: 0,
  hexagon: 3,
};

/**
 * The canvas's addresses, both ways round.
 *
 * Convention-independent by construction, and that is worth stating because it
 * looks like it should not be: `apex` and `ifs` cut the same four children in
 * the same recursion order and only differ in which vertex of a corner child
 * plays role A, so `cells[i].addr` is the SAME string under both. The
 * convention changes which triangle an address denotes, never the list of
 * addresses or the index each one sits at. So a book may be keyed by (kind,
 * depth) alone, which is what makes the resolution cache small.
 */
export interface AddressBook {
  kind: CanvasKind;
  depth: number;
  /**
   * The canvas's resolution. `depth` is still the address LENGTH this book
   * indexes, which is what `ancestorAt` truncates to; `scale` is what the
   * resolution comparisons in `buildView` and in `provenance.ts` are asked
   * against. Under one radix they determine each other; the two fields are
   * separate because under two radices they would not.
   */
  scale: number;
  /** Cell index → address. */
  addr: readonly Address[];
  /** Address → cell index. */
  index: ReadonlyMap<Address, number>;
  /** `STEM[kind]`, carried so callers never re-derive it. */
  stem: number;
  /** The cache key: two canvases with these equal have identical address lists. */
  id: string;
}

const isHexagon = (canvas: Figure | Hexagon): canvas is Hexagon =>
  "base" in canvas;

export function addressBook(canvas: Figure | Hexagon): AddressBook {
  const kind: CanvasKind = isHexagon(canvas) ? "hexagon" : "triangle";
  const stem = STEM[kind];
  const addr: Address[] = isHexagon(canvas)
    ? canvas.cells.map((c) => sectorTag(c.sector) + c.addr)
    : canvas.cells.map((c) => c.addr);
  const index = new Map<Address, number>();
  addr.forEach((a, i) => index.set(a, i));
  if (index.size !== addr.length) {
    // Unreachable: the hexagon already refuses to build two cells on one
    // lattice key. Kept because a collision here would silently make two
    // triangles the same triangle, which is the one failure a drawing program
    // cannot recover from.
    throw new Error(`plate: ${kind} depth ${canvas.depth} has duplicate addresses`);
  }
  return {
    kind,
    depth: canvas.depth,
    scale: canvas.scale,
    addr,
    index,
    stem,
    // The cache key stays (kind, depth) because it identifies the ADDRESS LIST,
    // and the list is fixed by how many cuts were taken, not by how far they
    // refined. Adding the scale would be a second name for the same book.
    id: `${kind}:${canvas.depth}`,
  };
}

/** The word part — the cuts, without the sector tag. */
export const wordOf = (a: Address, stem: number): string => a.slice(stem);

/** How many cuts an address names. Its depth. */
export const addressDepth = (a: Address, stem: number): number => a.length - stem;

/** The ancestor `k` cuts down, as an address. `k = 0` is the whole sector. */
export const ancestorAt = (a: Address, stem: number, k: number): Address =>
  a.slice(0, stem + k);

/** True when `b` is `a` or lies strictly below it. Plain prefixing; see the header. */
export const covers = (a: Address, b: Address): boolean => b.startsWith(a);

// ── resolving ────────────────────────────────────────────────────────────

/**
 * Everything a depth needs to know about a plate, computed in one pass.
 *
 * `below` is what a WRITE needs — the painted addresses strictly under each
 * address of this depth — and `resolved` is what the BOARD needs. They are
 * built together because both are a single sweep of the plate keyed by the same
 * depth-d prefix, and because they are invalidated at the same moment.
 */
interface PlateView {
  resolved: Map<number, string>;
  below: Map<Address, Address[]>;
}

/**
 * The resolution cache, keyed by plate IDENTITY.
 *
 * Every operation here returns a new Map, so object identity is an exact
 * generation counter — there is no version number to forget to bump. A `WeakMap`
 * means a plate that has been undone away takes its cached views with it.
 *
 * The inner key is the address book's `id`, so the two depths a user is toggling
 * between are both resident and switching back and forth costs nothing after the
 * first visit.
 */
const VIEWS = new WeakMap<AddressPlate, Map<string, PlateView>>();

function viewOf(plate: AddressPlate, book: AddressBook): PlateView {
  let perBook = VIEWS.get(plate);
  if (perBook === undefined) {
    perBook = new Map();
    VIEWS.set(plate, perBook);
  }
  const hit = perBook.get(book.id);
  if (hit !== undefined) return hit;
  const built = buildView(plate, book);
  perBook.set(book.id, built);
  return built;
}

/**
 * A sentinel for "two painted descendants disagree".
 *
 * Distinguishable from `undefined`, which means "nothing below here", and from
 * a colour. A conflicted parent renders unpainted, and the disagreement is the
 * whole reason: there is no colour it could honestly show.
 */
const CONFLICT = Symbol("conflict");

function buildView(plate: AddressPlate, book: AddressBook): PlateView {
  const { stem, depth, scale, addr } = book;

  const below = new Map<Address, Address[]>();
  const agreed = new Map<Address, string | typeof CONFLICT>();
  for (const [a, hex] of plate) {
    /**
     * IS THIS ADDRESS COARSER THAN, OR AT, THE RENDER RESOLUTION?
     *
     * Asked as DIVISIBILITY of scale and no longer as `≤` on depth. At radix 4
     * both scales are powers of two, so `scale(a) | scale(book)` and `depth(a) ≤
     * depth(book)` are the same predicate on every pair this program can build —
     * which is why the change is a no-op today and why it had to be written
     * today. `docs/rep-tile-findings.md` MIX-C has leaves at scales 12, 18 and
     * 27, all at depth 3: there `18 ≤ 27` is true and `18 | 27` is false, and
     * `≤` would start quietly claiming one region contained another.
     *
     * THE THIRD ANSWER NOW ARRIVES, AND IT IS INERT — MEASURED, not designed.
     * Divisibility is partial, so two scales can be INCOMPARABLE (12 and 27,
     * neither refining the other), and with a second radix in the alphabet that
     * is now reachable rather than hypothetical. This comment used to say the
     * case could not arise and marked where a third branch would go. What
     * measurement found is that the `else` already handles it correctly, for a
     * reason worth writing down rather than a coincidence:
     *
     *   `ancestorAt` truncates by LEVEL COUNT, so the bucket key is the address's
     *   own first `depth` letters. An address that genuinely refines a cell of
     *   this book begins with that cell's word — one letter per cut, in either
     *   alphabet — so it buckets under it exactly, whatever radices it used
     *   further down. `s0:ABa` is scale 12 against a scale-4 book and lands under
     *   `s0:AB`, which is right and is the whole point of mixed radix.
     *
     *   An address that DIVERGES — `s0:ab`, a rep-9 first cut where this canvas
     *   cut rep-4 — buckets under a key no cell of this book has, so it
     *   contributes to no cell's consensus and resolves nowhere. It is carried,
     *   it is re-exported, and it is not drawn. That is the honest answer: there
     *   is no cell of this canvas it is the paint of.
     *
     * The cost of inertness is stated where it bites: such an address is also
     * not in any target's `below`, so a stroke that covers the region does not
     * clear it. That is the "detail resurrects" case this module's header names,
     * surviving across radices only. `test/rep9format.test.ts` pins the
     * behaviour so it is a counted precondition and not a surprise.
     */
    if (refines(scaleOfWord(wordOf(a, stem)), scale)) continue;
    const parent = ancestorAt(a, stem, depth);
    const list = below.get(parent);
    if (list === undefined) below.set(parent, [a]);
    else list.push(a);
    const seen = agreed.get(parent);
    if (seen === undefined) agreed.set(parent, hex);
    else if (seen !== CONFLICT && seen !== hex) agreed.set(parent, CONFLICT);
  }

  const resolved = new Map<number, string>();
  for (let i = 0; i < addr.length; i++) {
    const a = addr[i];
    const exact = plate.get(a);
    if (exact !== undefined) {
      resolved.set(i, exact);
      continue;
    }
    // Longest proper prefix first: the NEAREST ancestor, which is the one whose
    // paint was laid closest to this cell and therefore the one it inherits.
    let inherited: string | undefined;
    for (let k = depth - 1; k >= 1; k--) {
      inherited = plate.get(ancestorAt(a, stem, k));
      if (inherited !== undefined) break;
    }
    if (inherited !== undefined) {
      resolved.set(i, inherited);
      continue;
    }
    const consensus = agreed.get(a);
    if (consensus !== undefined && consensus !== CONFLICT) resolved.set(i, consensus);
  }

  return { resolved, below };
}

/**
 * The plate as the board draws it: cell index → colour, at this book's depth.
 *
 * Memoised on (plate identity, book id), so a re-render that changed neither
 * costs one map lookup. The returned map is the CACHED one and must not be
 * mutated; every writer here builds a new plate and lets the cache follow.
 */
export function resolvePlate(
  plate: AddressPlate,
  book: AddressBook
): ReadonlyMap<number, string> {
  return viewOf(plate, book).resolved;
}

/** The painted addresses strictly below `a`, or an empty list. */
export function descendantsOf(
  plate: AddressPlate,
  book: AddressBook,
  a: Address
): readonly Address[] {
  return viewOf(plate, book).below.get(a) ?? [];
}

/** The nearest painted proper ancestor of `a`, or `null`. */
export function nearestAncestor(
  plate: AddressPlate,
  book: AddressBook,
  a: Address
): Address | null {
  for (let k = addressDepth(a, book.stem) - 1; k >= 1; k--) {
    const p = ancestorAt(a, book.stem, k);
    if (plate.has(p)) return p;
  }
  return null;
}

/** The colour `a` would inherit if it held no paint of its own. */
export function inheritedColour(
  plate: AddressPlate,
  book: AddressBook,
  a: Address
): string | null {
  const anc = nearestAncestor(plate, book, a);
  return anc === null ? null : (plate.get(anc) as string);
}

// ── writing ──────────────────────────────────────────────────────────────

/**
 * The edits that lay `colours` on `targets`, as an ordinary undoable stroke.
 *
 * `targets` are addresses AT THE BOOK'S DEPTH — the cells the brush picked out —
 * and `colours` is read positionally against them, which is the shape
 * `stampColours` already returns. `null` erases.
 *
 * Three things happen that a naive `set`/`delete` would not do, and each of them
 * is a bug that was reachable from the UI:
 *
 *   a paint CLEARS what is under it, so detail painted at depth 4 does not
 *   resurrect when a depth-2 stroke has covered it;
 *
 *   a paint that changes nothing VISIBLE still clears, because the stale
 *   descendants are invisible at this depth and are exactly the ones that would
 *   come back;
 *
 *   an erase SPLITS the nearest painted ancestor, because deleting an address
 *   that holds no paint of its own does nothing at all.
 *
 * Erases that share an ancestor are split TOGETHER rather than one after
 * another. Folding them one at a time would make each split read a plate the
 * previous split had already rewritten, and the cost would be quadratic in the
 * size of the stroke — a band brush at depth 4 is 1536 targets.
 */
export function planPlateEdits(
  plate: AddressPlate,
  book: AddressBook,
  targets: readonly Address[],
  colours: readonly (string | null)[]
): PlateEdit[] {
  const view = viewOf(plate, book);
  const out: PlateEdit[] = [];
  /** Erase targets, grouped by the painted ancestor that has to be split. */
  const toSplit = new Map<Address, Address[]>();

  for (let k = 0; k < targets.length; k++) {
    const a = targets[k];
    const to = colours[k] ?? null;
    const exact = plate.get(a) ?? null;

    if (to !== null) {
      // The test is NOT "does the cell already show this colour". It is "will
      // the cell and everything under it hold this colour once the clear below
      // has run" — and those come apart in the one case that matters. A cell
      // whose only claim to a colour is the CONSENSUS of a few painted
      // descendants shows it, but the rest of the cell holds nothing; drop the
      // write on that evidence and the clear then wipes the only paint there
      // was. Inheritance from an ancestor is different: it covers the whole
      // cell, so there the write really is redundant.
      const covering = exact ?? inheritedColour(plate, book, a);
      if (covering !== to) out.push({ cell: a, from: exact, to });
      for (const d of view.below.get(a) ?? []) {
        out.push({ cell: d, from: plate.get(d) as string, to: null });
      }
      continue;
    }

    if (exact !== null) out.push({ cell: a, from: exact, to: null });
    for (const d of view.below.get(a) ?? []) {
      out.push({ cell: d, from: plate.get(d) as string, to: null });
    }
    const anc = nearestAncestor(plate, book, a);
    if (anc !== null) {
      const group = toSplit.get(anc);
      if (group === undefined) toSplit.set(anc, [a]);
      else group.push(a);
    }
  }

  for (const [anc, holes] of toSplit) out.push(...splitEdits(plate, anc, holes));

  // Deduplicated and ordered by `mergeEdits`, which is also what folds a split
  // that touched an address a clear had already named.
  return mergeEdits([], out);
}

/**
 * Delete a painted ancestor and repaint everything it covered EXCEPT the holes.
 *
 * The paths from `anc` down to each hole form a trie. Every child hanging off
 * that trie is a maximal region that keeps the ancestor's colour, so writing the
 * colour there and nowhere else reproduces the ancestor exactly, minus the
 * holes. At most three writes per level per hole, and the resolved plate is
 * unchanged at every depth except inside the holes.
 *
 * A child that already carries paint of its own is SKIPPED: it was overriding
 * the ancestor before and must go on overriding it. That is the case where a
 * fine detail sits inside a coarse wash and the user erases beside it.
 *
 * ── THE ONE PLACE A SECOND RADIX CHANGES THE CODE AND NOT THE COMMENT ────
 *
 * "Every child hanging off that trie" was `DIGITS`, the four rep-4 cuts, and
 * that is now a question with two answers. It is also the question a mixed
 * alphabet makes genuinely hard, and it is worth being exact about why, because
 * the obvious repair is wrong:
 *
 *   THE PARENT CANNOT ANSWER IT. A letter states the radix of its OWN cut, so an
 *   address determines its own scale — that is the property everything here
 *   rests on — but it says nothing about the cut BELOW it. `p + "A"` and
 *   `p + "a"` are both admissible addresses, and they are not siblings: they are
 *   the same corner of `p` divided two different ways, overlapping regions in two
 *   different trees. Enumerating all thirteen letters would paint both, and the
 *   rep-4 sibling would cover the hole the rep-9 path was cut to make.
 *
 *   THE HOLES ANSWER IT. A hole is an address in the tree that is actually on
 *   screen, and the path from `anc` down to it names, one letter per level, the
 *   cut that tree took at every level in between. So the radix of each on-path
 *   node's cut is read off its own on-path child, and the siblings enumerated
 *   are that cut's letters and no others. No book is needed, no figure, and no
 *   new argument to this function.
 *
 * Two holes disagreeing at a level would be a node cut two ways at once. It is
 * unreachable — the targets of a stroke come from one book, hence one tree — and
 * it throws rather than picking one, on the same grounds as `addressBook`'s
 * duplicate check: guessing would silently repaint overlapping regions, which is
 * paint the user did not make on top of paint they did.
 */
function splitEdits(
  plate: AddressPlate,
  anc: Address,
  holes: readonly Address[]
): PlateEdit[] {
  const colour = plate.get(anc) as string;
  const out: PlateEdit[] = [{ cell: anc, from: colour, to: null }];

  const onPath = new Set<Address>();
  /** On-path node → the edge division of the cut immediately below it. */
  const cutBelow = new Map<Address, number>();
  for (const h of holes) {
    for (let n = anc.length + 1; n <= h.length; n++) {
      onPath.add(h.slice(0, n));
      const parent = h.slice(0, n - 1);
      const k = radixAt(h, n - 1);
      const seen = cutBelow.get(parent);
      if (seen === undefined) cutBelow.set(parent, k);
      else if (seen !== k) {
        throw new Error(`plate: ${parent} is cut ${seen} and ${k} in one stroke`);
      }
    }
  }
  // The holes are all at one depth, so a path node shorter than a hole is a
  // node whose children still have to be dealt with; a node as long as a hole IS
  // a hole, and everything below it is being erased.
  const holeLength = holes[0].length;
  const parents: Address[] = [anc];
  for (const p of onPath) if (p.length < holeLength) parents.push(p);

  for (const p of parents) {
    // Every parent here has an on-path child by construction — `anc` from the
    // first level of the walk above, and the rest by the length test — so the
    // cut below it is known.
    for (const g of lettersAt(cutBelow.get(p) as number)) {
      const child = p + g;
      if (onPath.has(child) || plate.has(child)) continue;
      out.push({ cell: child, from: null, to: colour });
    }
  }
  return out;
}

/** Apply plate edits forwards or backwards. Exactly `applyEdits`, named here. */
export function applyPlateEdits(
  plate: AddressPlate,
  edits: readonly PlateEdit[],
  direction: EditDirection
): AddressPlate {
  return applyEdits(plate, edits, direction);
}

// ── the file ─────────────────────────────────────────────────────────────

/**
 * The plate a payload restores.
 *
 * A file that carries the address field is taken at its word — it is the whole
 * plate, at every depth it was painted at. A file that does not carry one is
 * every file written before this existed, and every plate that only ever had one
 * depth: its `cells` are indices into the canvas it DECLARES, so they become
 * addresses of that depth and the drawing is restored exactly.
 *
 * `book` must be the book of the payload's own canvas and depth, not of the
 * canvas currently on screen. The caller builds the figure the file asks for.
 */
export function plateFromArtPayload(
  payload: ArtPayload,
  book: AddressBook
): AddressPlate {
  if (payload.plate !== undefined) return new Map(payload.plate);
  const out = new Map<Address, string>();
  for (const [i, hex] of payload.cells) {
    const a = book.addr[i];
    if (a !== undefined) out.set(a, hex);
  }
  return out;
}

/**
 * A triangle-keyed plate, read into one sector of the hexagon.
 *
 * Every file written before the hexagon became the model declares
 * `canvas: "triangle"` and a plate keyed by bare words — `"ABX"` — because the
 * triangle was its own canvas with its own address space. There is one address
 * space now, and a triangle is a SECTOR of it, so those words are the same words
 * with a sector tag in front. Sector 0 is the one to use: `buildHexagon` builds
 * it by applying `rotK(·, 0)` — the identity — to the base figure, so sector 0
 * and the standalone triangle are the same cells in the same order, and the
 * migration is a rename rather than a reinterpretation.
 *
 * The word is untouched, so ancestry survives: `"AB"` covered `"ABA"` before and
 * `"s0:AB"` covers `"s0:ABA"` after, by the same plain string prefixing. Nothing
 * is resolved, summarised or dropped — a plate painted at four depths arrives
 * with all four.
 */
export function plateIntoSector(
  plate: AddressPlate,
  sector: number
): AddressPlate {
  const tag = sectorTag(((sector % 6) + 6) % 6);
  const out = new Map<Address, string>();
  for (const [a, hex] of plate) out.set(tag + a, hex);
  return out;
}

/**
 * The address entries a payload should carry, or `undefined` when it need not
 * carry any.
 *
 * Omitted when every painted address is at the exported depth, because then the
 * index-keyed `cells` list already states the whole plate and a second copy of
 * it would only make the file bigger and the bytes different. That is what keeps
 * an ordinary single-depth drawing exporting exactly the bytes it always did.
 *
 * Sorted by address so the field is a function of the plate and not of the order
 * a Map happened to be built in — two identical plates must export identical
 * files.
 */
export function plateEntries(
  plate: AddressPlate,
  book: AddressBook
): [Address, string][] | undefined {
  // "At the exported resolution" is an equality of SCALE, not of depth. The two
  // agree at radix 4 and this decides whether the `plate` field is written at
  // all, so `test/byteidentity.test.ts`'s pins are the check that they agreed.
  //
  // They stop agreeing the moment an address uses a rep-9 letter — `s0:ABa` is
  // three cuts and scale 12, where three rep-4 cuts are scale 8 — and the SCALE
  // reading is the one that is right: an address at a different scale from the
  // book is exactly an address `cells` cannot state, which is what this field
  // exists to carry. A length comparison would have called those equal and
  // dropped the field, losing the paint.
  let offDepth = false;
  for (const a of plate.keys()) {
    if (scaleOfWord(wordOf(a, book.stem)) !== book.scale) {
      offDepth = true;
      break;
    }
  }
  if (!offDepth) return undefined;
  return [...plate.entries()].sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
}

// ── measurements ─────────────────────────────────────────────────────────

/**
 * How many addresses the plate holds at each depth, ascending.
 *
 * Reported rather than asserted. A plate painted at one depth has one entry
 * here; a plate that has been zoomed and detailed has several, and the erase
 * split adds shallow entries the user never explicitly made. Both are correct
 * and neither is worth an invariant.
 *
 * STILL KEYED BY DEPTH, deliberately, and it is the one buffer left that way.
 * `docs/rep-tile-findings.md` names a depth-keyed buffer as the thing that goes
 * wrong under mixed radix — MIX-C's 354 leaves would all land in one bucket — so
 * this map's KEYS are what would have to become scales. Rekeying it is a visible
 * change to what the function returns, which the depth→scale refactor was not
 * allowed to make.
 *
 * THE HAZARD IS NO LONGER HYPOTHETICAL. With a second radix in the alphabet a
 * plate really can hold `s0:ABC` and `s0:abc` — three cuts each, scale 8 and
 * scale 27 — and this function reports them as one bucket of two at depth 3.
 * That is a true statement about the number of CUTS, which is what the name
 * says, and a useless one about resolution. Nothing here reads it for a
 * resolution today. Recorded as the follow-on, and now with a witness.
 */
export function depthCensus(
  plate: AddressPlate,
  stem: number
): Map<number, number> {
  const out = new Map<number, number>();
  for (const a of plate.keys()) {
    const d = addressDepth(a, stem);
    out.set(d, (out.get(d) ?? 0) + 1);
  }
  return new Map([...out].sort((a, b) => a[0] - b[0]));
}
