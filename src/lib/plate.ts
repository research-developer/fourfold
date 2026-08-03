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
import type { ArtPayload } from "./artfile";
import type { CanvasKind } from "./orbit";
import { type CellEdit, type EditDirection, applyEdits, mergeEdits } from "./strokes";

/** A word over `{A,B,C,X}`, with a sector tag on the hexagon. */
export type Address = string;

/** Address → `#rrggbb`. Absent means "nothing said here", NOT "unpainted". */
export type AddressPlate = ReadonlyMap<Address, string>;

/** One edit of the address plate. The same shape a cell edit has always had. */
export type PlateEdit = CellEdit<Address>;

/**
 * The four cuts, in the order `buildFigure` takes them.
 *
 * Written out rather than derived from `DIGIT_CHARGE`'s keys: the split in
 * `erasePlan` needs the digits as a LIST with a stable order, and key order of
 * a record is a fact about how it was written rather than a promise it makes.
 */
export const DIGITS: readonly string[] = ["A", "B", "C", "X"] as const;

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
  return { kind, depth: canvas.depth, addr, index, stem, id: `${kind}:${canvas.depth}` };
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
  const { stem, depth, addr } = book;

  const below = new Map<Address, Address[]>();
  const agreed = new Map<Address, string | typeof CONFLICT>();
  for (const [a, hex] of plate) {
    if (addressDepth(a, stem) <= depth) continue;
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
 */
function splitEdits(
  plate: AddressPlate,
  anc: Address,
  holes: readonly Address[]
): PlateEdit[] {
  const colour = plate.get(anc) as string;
  const out: PlateEdit[] = [{ cell: anc, from: colour, to: null }];

  const onPath = new Set<Address>();
  for (const h of holes) {
    for (let n = anc.length + 1; n <= h.length; n++) onPath.add(h.slice(0, n));
  }
  // The holes are all at one depth, so a path node shorter than a hole is a
  // node whose children still have to be dealt with; a node as long as a hole IS
  // a hole, and everything below it is being erased.
  const holeLength = holes[0].length;
  const parents: Address[] = [anc];
  for (const p of onPath) if (p.length < holeLength) parents.push(p);

  for (const p of parents) {
    for (const g of DIGITS) {
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
  let offDepth = false;
  for (const a of plate.keys()) {
    if (addressDepth(a, book.stem) !== book.depth) {
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
