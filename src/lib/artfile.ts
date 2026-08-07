/**
 * How a plate leaves the browser and comes back the same plate.
 *
 * `artworkSvg` already writes the drawing out of the MODEL rather than the DOM,
 * so the file is an exact statement of which cells hold which colour. What it
 * could not say until now is which cells those indices refer to — an index is
 * meaningless without the canvas, the depth and the convention that numbered
 * them. This module writes that missing sentence into the file as an XML
 * comment, and reads it back.
 *
 * ── Why a comment and not a data attribute ───────────────────────────────
 *
 * A comment is invisible to every renderer, survives being embedded in a page,
 * and cannot change how the artwork draws. An attribute on `<svg>` would be
 * carried into the DOM of anything that inlines the file and would show up in
 * a serialisation diff as a change to the artwork; a `<metadata>` element is
 * the "correct" SVG answer but is a live element that a sloppy consumer can
 * render. The comment is the only place to put a payload that is guaranteed
 * inert. The cost is one hard rule, enforced below: `--` may never appear.
 *
 * ── The payload is a promise, so it is checked like one ──────────────────
 *
 * A loaded file is UNTRUSTED INPUT. It arrives from a download folder, from a
 * chat client, from a tool that is not this one. So `extractArt` is total: it
 * returns `null` for anything it cannot vouch for and throws for nothing, and
 * every field is checked against the canvas it claims — a cell index outside
 * `[0, cellCount)` is a rejection of the whole payload, not a cell to skip,
 * because a payload that names an impossible cell is not a payload that was
 * written by a canvas we understand. Nothing here parses markup by handing it
 * to the DOM; it is text and regex only, and no code path can execute.
 *
 * ── The fallback is geometric, and it is the one tolerant thing here ──────
 *
 * A file without the marker can still be matched cell by cell against the
 * canvas's own vertices. That is the single place in this codebase where a
 * numeric tolerance decides an index, and it is a tolerance only in the sense
 * that both sides are rounded to the SAME precision the exporter writes at —
 * see `GEOMETRY_PRECISION`. Everywhere else (`orbit.ts`, `bands.ts`) indices
 * come from exact integer keys and no comparison could go either way.
 */

import { CONVENTIONS, type Convention, type Figure } from "./figure";
import type { Hexagon } from "./hexagon";
import { HEXAGON_MODES, TRIANGLE_MODES, type CanvasKind } from "./orbit";
import { READINGS, type Reading } from "./relief";
import {
  cellsAtScale,
  radixAt,
  REP9_LETTERS,
  scaleOfDepth,
  scaleOfWord,
} from "./scale";
import { swatchFromHex, type Swatch } from "./schemes";

export const ART_MARKER = "fourfold:art";
export const ART_VERSION = 1;

/**
 * The relief the plate was exported under.
 *
 * The shading is a DISPLAY effect and not paint — no cell holds a colour it did
 * not hold before — but it is baked into the exported polygons, so a file that
 * did not say this could not be re-exported to the same bytes. Reading is which
 * of the two cube corners the plate was read as; see `relief.ts`.
 */
export interface ArtRelief {
  on: boolean;
  reading: Reading;
}

export interface ArtPayload {
  version: number;
  canvas: CanvasKind;
  depth: number;
  convention: Convention;
  /** [cell index, lower-case #rrggbb], ascending by index. */
  cells: [number, string][];
  /**
   * Optional, and NOT versioned.
   *
   * A field that only ever ADDS a statement about the file does not need a
   * version bump, because every reader of version 1 that predates it already
   * behaves correctly on a file that carries it: absent means "no relief", which
   * is what such a reader assumes, and that is exactly what every file written
   * before this existed meant. Bumping would have made those files unreadable to
   * gain nothing. The field is omitted entirely when the relief is off, so a
   * plain drawing exports the same bytes it always did.
   */
  relief?: ArtRelief;
  /**
   * The plate keyed by ADDRESS, at every depth it was painted at.
   *
   * `cells` states the drawing as indices into the canvas at ONE depth, which is
   * everything a file needed to say while a depth change cleared the plate. It
   * no longer does: a plate may carry paint above and below the depth it was
   * exported at, and an index list cannot name any of it. See `plate.ts` for the
   * address scheme — a word over the cut alphabet, with an `s0:`…`s5:` sector tag
   * on the hexagon.
   *
   * THE ALPHABET IS THIRTEEN LETTERS AND NOT FOUR, and this field is the only
   * place the second radix reaches the file. `[ABCX]` is rep-4, `[a-cu-z]` is
   * rep-9, the two are disjoint, and a mixed word is therefore self-describing —
   * see `ADDRESS_LETTERS`. No version bump and no new field: every address this
   * program has ever written is still admitted, spelled identically, and a reader
   * that predates rep-9 sees the same bytes for the same drawing. What a reader
   * that predates it CANNOT do is draw a rep-9 address, and that is the same
   * position it was already in for an address deeper than its own ceiling.
   *
   * Optional, and NOT versioned, on exactly the argument the relief field makes:
   * a reader that predates it treats its absence as "the plate is entirely at
   * the declared depth", and that is what every file written before it existed
   * meant and what `cells` still says. Bumping would have made every one of
   * those files unreadable to gain nothing.
   *
   * OMITTED whenever every painted address sits at the exported depth, so a
   * drawing made the ordinary way — one depth, start to finish — exports byte
   * for byte the file it always did. When present it is AUTHORITATIVE and
   * `cells` is the depth-d rendering of it, written so that a reader without
   * this field still sees the drawing.
   */
  plate?: [string, string][];
  /**
   * The sector the plate was FRAMED in when it was written, or absent for the
   * whole hexagon.
   *
   * Display state, like the relief, and carried for the same reason: the
   * polygons in the file are the ones that were on screen, and a sector view
   * draws one sector turned apex-up. A file that did not say so could be
   * reloaded — the payload names cells, not pictures — but could not be
   * re-exported to the same bytes, and the round trip is the promise.
   *
   * Optional and NOT versioned, on the argument the other two optional fields
   * make: absent means "the whole plate", which is what every file written
   * before this existed showed and what a reader that predates it assumes.
   *
   * The PLATE is always whole. Only the picture is framed — a file exported from
   * a sector view still carries every painted address in every sector, or
   * switching view before saving would quietly destroy five sixths of a drawing.
   */
  view?: { sector: number };
  /**
   * The drawing as a STACK rather than as one flat colouring.
   *
   * `cells` says what the picture looks like; it cannot say that those colours
   * came from four layers, one of them hidden, two of them nested inside a
   * pasted composition. This field says it, and it is what makes "copy this
   * layer" and "paste a composition onto a layer" round trips rather than
   * flattenings.
   *
   * Optional and NOT versioned, on exactly the argument `relief`, `plate` and
   * `view` already make: a reader that predates it treats its absence as "one
   * layer, and `cells` is it", which is what every file written before this
   * existed meant and what `cells` still says. Bumping would have made every one
   * of those files unreadable to gain nothing.
   *
   * OMITTED entirely by `payloadFromPaint`, so every export this program made
   * before layers existed still writes exactly the bytes it did. Only `emit.ts`
   * writes it, and when it does, `cells` remains the flattened rendering of it
   * so a reader that ignores this field still sees the drawing.
   */
  comp?: ArtComposition;
}

/**
 * A layer, as the FILE states it.
 *
 * Every flag here is the layer's OWN, never the value it resolves to under its
 * ancestors. A hidden parent hides its descendants when the stack is rendered,
 * but each descendant keeps its own `hidden` — writing the resolved flag would
 * mean that saving a composition with a hidden parent and loading it back
 * permanently marked every child hidden, and no amount of un-hiding the parent
 * would bring them back. The same argument applies to `locked` and `opacity`.
 */
export interface ArtLayer {
  /** Unique within the composition, and an XML name — see `LAYER_ID`. */
  id: string;
  name?: string;
  /** The layer's OWN visibility. Absent means visible. */
  hidden?: boolean;
  /** The layer's OWN lock. Absent means unlocked. */
  locked?: boolean;
  /** The layer's OWN alpha, `0…1`. Absent means 1. */
  opacity?: number;
  /** This layer's own paint: [cell index, `#rrggbb`], ascending. */
  cells?: [number, string][];
  /** Sub-layers, in paint order — later children sit over earlier ones. */
  children?: ArtLayer[];
  /**
   * Animation: the step this layer is revealed at. See `emit.ts`.
   *
   * This and the two below are optional and NOT versioned, on exactly the
   * argument `relief`, `plate`, `view` and `comp` already make: a composition
   * written before gestures were recorded says nothing about them, and a reader
   * that predates them treats their absence as "this layer was not made by a
   * gesture we know about" — which is what such a file meant. A DEFAULT would be
   * worse than a bump: `mode: 1` invented here is indistinguishable from a real
   * one-fold stroke, so the format would be answering a question it was never
   * told the answer to. `test/artfile.test.ts` holds them absent.
   */
  reveal?: number;
  /** The brush symmetry the gesture was made under, when one was recorded. */
  mode?: number;
  /**
   * How many cells the recorded orbit held, when this layer is one.
   *
   * VALIDATED INDEPENDENTLY OF `mode`, and they are frequently unequal: a seed
   * on a mirror line of the group is stabilised, so a 6-fold brush produces an
   * orbit of 3. Nothing here may cross-check one against the other — a payload
   * stating `mode: 6, orbit: 3` is the ordinary case and not a contradiction.
   */
  orbit?: number;
  /**
   * THE COMPOSITION BOUNDARY: which nested timeline compositions this layer's
   * reveal step sits INSIDE, outermost first, space separated — `"t9"`, or
   * `"t9 t14"` for a step two deep. Absent means the step is at the root, which
   * is every step of every drawing nobody has grouped.
   *
   * ── What it is for, and why ONE field is enough ─────────────────────────
   *
   * `nested.ts` builds a timeline as a TREE — a `Comp` is a run of consecutive
   * steps under a minted name — and the whole reason it exists is that a name
   * survives an insertion where an index does not: `test/nested.test.ts` runs one
   * probe against five insertion sites and only the minted name survives all
   * five. `reveal` above is the DERIVED flat index, computed by flattening that
   * tree, so a file carrying only `reveal` states the answer and throws away the
   * question — load it and the tree is gone, every group with it, and the next
   * hold inserted anywhere renumbers the lot.
   *
   * This states the nesting and nothing else. The ORDER of the steps is already
   * in `reveal`, and the CONTENTS of a composition are exactly the maximal run of
   * layers whose trail begins the same way, so a run needs no start marker and no
   * length. `timeline.compTrails` writes these and `timeline.treeFromTrails`
   * rebuilds the tree from them; the round trip is asserted in
   * `test/timeline.test.ts`.
   *
   * A TRAIL AND NOT A BRACKET PAIR, on this module's own standards: an unmatched
   * bracket is a file that cannot be read at all, while a trail is true of each
   * layer BY ITSELF and so survives a file whose layers were filtered — which is
   * exactly what a per-layer copy and a scoped `emit.serialise` already produce.
   * `timeline.ts` carries the full argument and the two rejected alternatives.
   *
   * ── Optional, and NOT versioned ─────────────────────────────────────────
   *
   * On exactly the argument `relief`, `plate`, `view`, `comp` and the in/out
   * marks already make: a reader that predates this treats its absence as "the
   * timeline is flat", which is what every file written before it existed meant
   * and what `reveal` alone still says. Bumping would have made every one of
   * those files unreadable to gain nothing.
   *
   * OMITTED whenever a layer's step is at the root, so a drawing that has never
   * been grouped exports byte for byte the file it always did —
   * `test/artfile.test.ts` asserts that on the bytes rather than describing it.
   *
   * WRITTEN AFTER `orbit` AND BEFORE `cells`. The validator rebuilds the object
   * in that position and the round trip here is on BYTES, so an emitter that
   * wrote it anywhere else would re-encode to a different file. That is the same
   * constraint `validateComposition` already records for `anim`'s key order.
   */
  nest?: string;
}

export interface ArtAnimation {
  /** Milliseconds between reveals. */
  stepMs: number;
  /** Milliseconds the finished plate holds before the loop restarts. */
  holdMs: number;
  /** How long a layer takes to come up. */
  fadeMs: number;
  /**
   * How many reveal steps the DRAWING has.
   *
   * The cycle's length only when there are no in and out points below; with
   * them it is `out - in + 1` steps that play and this is still the whole
   * drawing, because the marks have to be stated against something that does
   * not move when they do.
   */
  steps: number;
  /**
   * The in point: the first reveal step that plays. Everything before it is
   * already on the plate when the loop starts — the ground, not something that
   * gets revealed.
   *
   * This and `out` are a CLOSED pair, so `{in: 3, out: 7}` is five steps and
   * both ends play; `replay.InOut` is the same pair in the model, and its
   * header carries the argument for closed over half-open.
   *
   * Optional and NOT versioned, on exactly the argument `relief`, `plate`,
   * `view` and `comp` already make: a reader that predates them treats their
   * absence as "the whole drawing plays", which is what every file written
   * before they existed meant and what `steps` alone still says. Omitted
   * entirely when unset, so a drawing with no marks exports byte for byte the
   * file it always did — `test/inout.test.ts` asserts that on the bytes.
   *
   * BOTH OR NEITHER, enforced below. One without the other would need a second
   * spelling of "to the end", and two ways to write one thing is two ways for a
   * round trip to pick the other one.
   */
  in?: number;
  /** The out point: the last reveal step that plays. Closed with `in`. */
  out?: number;
}

export interface ArtComposition {
  /**
   * The cell indices the picture FRAMES, as ascending ranges — `"0-1023"`, or
   * `"0-5,12,40-63"`. Absent means every cell of the declared canvas.
   *
   * A range string rather than a list because the two real cases are one whole
   * canvas and one whole sector, and both are a single range. It is validated
   * as strictly as everything else here: ascending, non-overlapping, and inside
   * the canvas it claims.
   */
  shown?: string;
  anim?: ArtAnimation;
  layers: ArtLayer[];
}

/**
 * What a layer id may be.
 *
 * An XML name, because `emit.ts` writes it straight into `id="…"` and a reader
 * should be able to match a `<g>` in the markup to an entry in the payload
 * without a lookup table. Leading digits are excluded for the same reason: an
 * id is a name, not a number.
 */
export const LAYER_ID = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;

/**
 * Ids `emit.ts` gives to FIXED elements of its own, which a layer may therefore
 * not take. A payload naming one is rejected rather than silently renamed — a
 * file that collides with the document's own furniture is not a file whose
 * layer tree we should trust either.
 *
 * This list is NOT what keeps ids unique, and it must not be mistaken for it.
 * It covers the two group ids that are literals in the emitter and the two
 * prototype names it reaches for first; but `emit.prototypeId` also mints `u2`,
 * `d2`, `p` and `ux`, `serialise` mints a root id and a title id, and none of
 * those could ever be enumerated here without this list having to be extended
 * every time that code learns a new name — which is exactly how a document
 * came to be written with two `id="u2"` in it. Uniqueness is enforced where the
 * ids are minted, by reading the ones the document actually holds. See
 * `emit.prototypeId`. What remains here is a small closed set of literals,
 * which cannot fall behind anything because nothing generates it.
 */
export const RESERVED_IDS: ReadonlySet<string> = new Set(["u", "d", "tiling", "paint"]);

/**
 * How deep a layer tree may nest, and how many layers it may hold in total.
 *
 * Not a limit of the idea — pasting a composition onto a layer nests by one
 * each time, and nobody is going to do that thirty-two times. It is a limit on
 * what an UNTRUSTED file may ask this program to walk: the validator below
 * recurses, and a payload nested ten thousand deep is a stack overflow rather
 * than a drawing. The node cap is the same argument for breadth.
 */
export const MAX_LAYER_DEPTH = 32;
export const MAX_LAYERS = 8192;

/**
 * THE FORMAT'S OWN RESOLUTION FOR AN ALPHA: three decimals.
 *
 * Stated HERE, in the file format, because that is what it is a property of.
 * `layers.ALPHA_STEP` is the model's copy of the same number and `emit.fmtAlpha`
 * is the markup's; all three have to agree or one file says two things, and this
 * is the one a payload is validated against on the way in. See `validateLayer`.
 */
export const ALPHA_QUANTUM = 1000;

/**
 * The depths a plate may declare.
 *
 * Not a limit of the format — `buildFigure` will happily cut deeper — but a
 * limit of what this program can SHOW. A file declaring depth 9 would be a file
 * whose plate has no control that can select it, so accepting it would mean
 * loading a drawing nobody can then edit or re-export. The page builds its own
 * depth buttons from these numbers, so the two cannot drift apart.
 */
export const MIN_DEPTH = 1;
/**
 * The hexagon's ceiling used to be 4 and is now 5, and that is a REAL CHANGE
 * rather than a loosening for its own sake.
 *
 * The triangle stopped being a canvas and became a VIEW of one sector of the
 * hexagon, so a triangle file at depth 5 — 1024 cells, which this program has
 * always been able to draw and export — is now a hexagon file at depth 5 with
 * sector 0 painted. Leaving the hexagon at 4 would have made every one of those
 * files loadable exactly once: readable as a triangle, and unwritable, because
 * the re-export declares the canvas it now lives on. A ceiling that turns
 * existing work into a one-way trip is not a ceiling worth keeping.
 *
 * The cost is stated rather than hidden: 6·4^5 = 6144 cells in the model.
 * `test/view.test.ts` measures what that costs; `page.tsx` says what it means
 * for the two views.
 */
// PROBE (branch probe/depth-6): raised 5 → 7 to test a deeper canvas. Not a
// format decision — a deep file writes scale 64/128 and a MAX_DEPTH-5 reader
// refuses it, which is exactly what the cap exists to make loud. Depth 7 is
// 98,304 hexagon cells; the SVG plate is expected to hurt, and finding out
// where it breaks is the probe's whole purpose.
export const MAX_DEPTH: Record<CanvasKind, number> = { triangle: 7, hexagon: 7 };

/**
 * Cells in a canvas: one wedge of scale², six of them on the hexagon.
 *
 * THE BOUNDARY, second of two — and the one that justifies there being two.
 * `figure.ts` converts a depth the UI stated; this converts a depth THE FILE
 * stated, and it has no figure to read a scale off because it is called while
 * deciding whether the file is loadable at all.
 *
 * That is exactly where the depth→scale boundary belongs. `ArtPayload.depth`
 * stays a depth and stays written as one — the format does not change here, and
 * `test/byteidentity.test.ts` pins the bytes that say so — while everything past
 * this line holds a scale. At radix 4 the file may state one and the model hold
 * the other because `scale = 2^depth` is a bijection.
 *
 * ── THE ONE PLACE A SCHEDULE FIELD IS STILL OWED ─────────────────────────
 *
 * This comment used to end: *"What a second radix would need is a radix SCHEDULE
 * in the payload, and that is a format change and a different piece of work."*
 * Half of that is now discharged and half of it is sharpened, and the split is
 * worth stating precisely because it is the whole answer to "is the alphabet
 * enough".
 *
 * The PLATE needs no schedule: its addresses are words over a disjoint alphabet,
 * so each one states its own scale (see `ADDRESS_LETTERS`). The `cells` LIST
 * still does, and this line is why — `cells` is keyed by INDEX, an index means
 * nothing without the canvas that issued it, and the only thing the file says
 * about that canvas is `depth`. `scaleOfDepth` reads that as 2^depth, so a
 * document whose canvas was cut rep-9 would have its cell indices validated
 * against the wrong canvas and a quarter of them silently refused.
 *
 * So a rep-9 CANVAS — not a rep-9 address — is what still needs a field, and the
 * minimal one is a `scale`: optional, unversioned on the argument `relief`,
 * `plate`, `view` and `comp` already make, absent meaning `scaleOfDepth(depth)`,
 * which is what every file written to date means. It is not added here because
 * nothing can yet write one: `MAX_SCALE` admits a rep-9 address, and a rep-9
 * canvas is the figure lane's to build. `test/rep9format.test.ts` measures the
 * gap rather than describing it.
 */
export const cellCount = (canvas: CanvasKind, depth: number): number =>
  (canvas === "hexagon" ? 6 : 1) * cellsAtScale(scaleOfDepth(depth));

/**
 * The largest file this program will read.
 *
 * A plate is at most 1536 cells and its payload is a few tens of kilobytes; the
 * whole exported document at depth 4 is well under a megabyte. Eight is
 * therefore not a measured threshold but a wall a long way past anything real,
 * placed so that dropping a video onto the canvas fails as a sentence rather
 * than as a frozen tab.
 */
export const MAX_ART_BYTES = 8 * 1024 * 1024;

/** The conventions come from `figure.ts`; a second list here could drift from it. */
const CANVASES: readonly CanvasKind[] = ["triangle", "hexagon"];

/**
 * Which brush symmetries a file may claim, per canvas.
 *
 * Taken from `orbit.ts` rather than written out here, for the reason the note on
 * `CANVASES` gives: a second list of the subgroup orders would be a second thing
 * to keep in step with the group theory, and it would fall behind silently — a
 * file would simply stop loading, or start loading when it should not.
 *
 * The SECTOR scopes are covered without being named. `SCOPE_MODES` gives both of
 * them `SECTOR_MODES`, which is `TRIANGLE_MODES`, which is a subset of
 * `HEXAGON_MODES` — so a hexagon file drawn under any scope claims a mode in the
 * hexagon list, and a triangle file claims one in the triangle list. The file
 * does not record its scope and does not need to.
 */
const MODES_FOR: Readonly<Record<CanvasKind, ReadonlySet<number>>> = {
  triangle: new Set(TRIANGLE_MODES),
  hexagon: new Set(HEXAGON_MODES),
};

/** The exact shape the payload promises. Upper case is not accepted, it is normalised on the way in. */
const HEX6 = /^#[0-9a-f]{6}$/;

// ── writing ──────────────────────────────────────────────────────────────

/**
 * Make a JSON string safe to sit inside an XML comment.
 *
 * XML forbids `--` anywhere in a comment, which means a colour or a field that
 * happens to contain two dashes would produce a document that is not merely
 * wrong but unparseable — and `-->` inside it would end the comment early and
 * spill the payload into the drawing. The escape is `-`, which JSON.parse
 * turns back into a dash, so the round trip is exact.
 *
 * A dash can only ever be adjacent to another dash INSIDE a string literal: the
 * only other place JSON writes one is a number's leading minus, and two numbers
 * are always separated by a comma or a bracket. So escaping dashes inside
 * strings is total, and the assertion in `encodeArt` is unreachable rather than
 * hopeful.
 */
function commentSafe(json: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < json.length; i++) {
    const ch = json[i];
    if (!inString) {
      if (ch === '"') inString = true;
      out += ch;
      continue;
    }
    if (ch === "\\") {
      // A backslash escape is two characters and neither is a dash we may touch.
      out += ch + (json[i + 1] ?? "");
      i++;
      continue;
    }
    if (ch === '"') {
      inString = false;
      out += ch;
      continue;
    }
    out += ch === "-" ? "\\u002d" : ch;
  }
  return out;
}

/**
 * The payload as the comment line that goes immediately after `<svg>`.
 *
 * The version rides in the MARKER rather than in the JSON, so a reader can
 * decide whether it understands the file before it parses a byte of it.
 */
export function encodeArt(p: ArtPayload): string {
  const body = commentSafe(
    JSON.stringify({
      canvas: p.canvas,
      depth: p.depth,
      convention: p.convention,
      cells: p.cells,
      // `JSON.stringify` drops an undefined value, so a payload with no relief
      // and no address plate writes exactly the bytes it wrote before either
      // field existed.
      relief: p.relief,
      plate: p.plate,
      view: p.view,
      comp: p.comp,
    })
  );
  const line = `<!-- ${ART_MARKER}:${p.version} ${body} -->`;
  // Unreachable by construction; kept because the failure it guards against is
  // a file that cannot be parsed at all, and that is worth a loud death here
  // rather than a silent one in someone else's parser.
  if (line.slice(4, -3).includes("--")) {
    throw new Error("art payload would break the XML comment");
  }
  return line;
}

// ── reading ──────────────────────────────────────────────────────────────

/**
 * Where the payload starts.
 *
 * Bounded whitespace (`{0,64}`) rather than `\s*` so that scanning a large
 * hostile file stays linear: every `<!--` in the document costs a fixed number
 * of steps to reject. The body is then found with `indexOf`, not with a lazy
 * quantifier, for the same reason.
 */
const MARKER_HEAD = new RegExp(`<!--\\s{0,64}${ART_MARKER}:(\\d{1,9})\\s{1,64}`);

/**
 * The payload carried by an SVG document, or `null`.
 *
 * `null` for: no marker, a marker that never closes, malformed JSON, a version
 * this build does not speak, a canvas or convention it does not know, a depth
 * it cannot draw, a cell index that canvas cannot hold, a colour that is not a
 * colour, the same cell named twice, or more cells than the canvas has. It
 * throws for none of them. The first marker in the file wins, which makes the
 * read deterministic on a file that somehow carries two.
 */
export function extractArt(svgText: string): ArtPayload | null {
  if (typeof svgText !== "string") return null;
  const head = MARKER_HEAD.exec(svgText);
  if (head === null) return null;
  const start = head.index + head[0].length;
  const close = svgText.indexOf("-->", start);
  if (close < 0) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(svgText.slice(start, close));
  } catch {
    return null;
  }
  return validate(Number(head[1]), raw);
}

function validate(version: number, raw: unknown): ArtPayload | null {
  if (version !== ART_VERSION) return null;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;

  const canvas = o.canvas as CanvasKind;
  if (!CANVASES.includes(canvas)) return null;
  const convention = o.convention as Convention;
  if (!CONVENTIONS.includes(convention)) return null;

  const depth = o.depth;
  if (
    typeof depth !== "number" ||
    !Number.isInteger(depth) ||
    depth < MIN_DEPTH ||
    depth > MAX_DEPTH[canvas]
  ) {
    return null;
  }

  const cells = o.cells;
  if (!Array.isArray(cells)) return null;
  const n = cellCount(canvas, depth);
  // More painted cells than the canvas HAS is not a plate to clamp; it is a
  // declaration that disagrees with itself.
  if (cells.length > n) return null;

  const out: [number, string][] = [];
  const seen = new Set<number>();
  for (const entry of cells) {
    if (!Array.isArray(entry) || entry.length !== 2) return null;
    const i: unknown = entry[0];
    const hex: unknown = entry[1];
    if (typeof i !== "number" || !Number.isInteger(i) || i < 0 || i >= n) return null;
    if (typeof hex !== "string" || !HEX6.test(hex)) return null;
    if (seen.has(i)) return null;
    seen.add(i);
    out.push([i, hex]);
  }
  out.sort((a, b) => a[0] - b[0]);

  const relief = validateRelief(o.relief);
  if (relief === REJECT) return null;

  const plate = validatePlate(o.plate, canvas);
  if (plate === REJECT) return null;

  const view = validateView(o.view, canvas);
  if (view === REJECT) return null;

  const comp = validateComposition(o.comp, n, canvas);
  if (comp === REJECT) return null;

  return {
    version,
    canvas,
    depth,
    convention,
    cells: out,
    ...(relief ?? {}),
    ...(plate ?? {}),
    ...(view ?? {}),
    ...(comp ?? {}),
  };
}

/** Distinguishable from `undefined`, which is the legitimate "absent" answer. */
const REJECT = Symbol("reject");

/**
 * `undefined` for a file that says nothing about relief — which is every file
 * written before the field existed, and every plain drawing since.
 *
 * A field that is PRESENT and malformed is rejected outright, like every other
 * malformed field here: a writer that disagrees with us about the shape of this
 * payload is not a writer whose cell indices we should trust either.
 */
function validateRelief(
  raw: unknown
): { relief: ArtRelief } | undefined | typeof REJECT {
  if (raw === undefined) return undefined;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return REJECT;
  const r = raw as Record<string, unknown>;
  if (typeof r.on !== "boolean") return REJECT;
  const reading = r.reading as Reading;
  if (!READINGS.includes(reading)) return REJECT;
  return { relief: { on: r.on, reading } };
}

/**
 * `undefined` for a file that says nothing about the framing — the whole plate,
 * which is what every file written before this field existed showed.
 *
 * A sector on a TRIANGLE file is rejected rather than ignored: the triangle has
 * no sectors, so a file claiming one disagrees with its own canvas, and this
 * module's rule for that has always been to refuse the payload rather than to
 * guess which half of it was meant.
 */
function validateView(
  raw: unknown,
  canvas: CanvasKind
): { view: { sector: number } } | undefined | typeof REJECT {
  if (raw === undefined) return undefined;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return REJECT;
  if (canvas !== "hexagon") return REJECT;
  const s = (raw as Record<string, unknown>).sector;
  if (typeof s !== "number" || !Number.isInteger(s) || s < 0 || s > 5) return REJECT;
  return { view: { sector: s } };
}

/**
 * `undefined` for a file that says nothing about a layer stack — which is every
 * file this program wrote before layers existed, and every export that is one
 * flat colouring.
 *
 * Present and malformed is rejected outright, like every other field here, and
 * the checks are the same ones `cells` gets plus the two the tree introduces:
 * ids must be unique across the WHOLE tree, and the tree must be shallower than
 * `MAX_LAYER_DEPTH` and smaller than `MAX_LAYERS`. Both of those are refusals
 * rather than truncations: a file that nests ten thousand deep is not a
 * composition to trim, it is an attempt to overflow the walk below.
 */
function validateComposition(
  raw: unknown,
  cellsInCanvas: number,
  canvas: CanvasKind
): { comp: ArtComposition } | undefined | typeof REJECT {
  if (raw === undefined) return undefined;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return REJECT;
  const c = raw as Record<string, unknown>;

  let shown: string | undefined;
  if (c.shown !== undefined) {
    if (typeof c.shown !== "string") return REJECT;
    if (parseRanges(c.shown, cellsInCanvas) === null) return REJECT;
    shown = c.shown;
  }

  let anim: ArtAnimation | undefined;
  if (c.anim !== undefined) {
    if (typeof c.anim !== "object" || c.anim === null || Array.isArray(c.anim)) {
      return REJECT;
    }
    const a = c.anim as Record<string, unknown>;
    const ms = (v: unknown, lo: number): number | null =>
      typeof v === "number" && Number.isInteger(v) && v >= lo && v <= 3_600_000
        ? v
        : null;
    const stepMs = ms(a.stepMs, 1);
    const holdMs = ms(a.holdMs, 0);
    const fadeMs = ms(a.fadeMs, 0);
    const steps = ms(a.steps, 0);
    if (stepMs === null || holdMs === null || fadeMs === null || steps === null) {
      return REJECT;
    }
    if (steps > MAX_LAYERS) return REJECT;

    // The in and out points. REFUSED rather than clamped, which is the
    // opposite of what `replay.clampSpan` does with the same two numbers, and
    // the split is on purpose: a slider being dragged off the end of its track
    // is an ordinary event, a FILE that names a step its own `steps` says does
    // not exist is a declaration disagreeing with itself. This module's rule
    // for that has never been to guess which half was meant.
    //
    // Both or neither, and `0 ≤ in ≤ out < steps`. Note that `steps: 0` admits
    // no span at all — `out < 0` is unsatisfiable — which is right: a drawing
    // with nothing to play cannot have marked where to stop playing it.
    const from: unknown = a.in;
    const to: unknown = a.out;
    if ((from === undefined) !== (to === undefined)) return REJECT;
    let span: { in: number; out: number } | undefined;
    if (from !== undefined) {
      if (typeof from !== "number" || !Number.isInteger(from)) return REJECT;
      if (typeof to !== "number" || !Number.isInteger(to)) return REJECT;
      if (from < 0 || to < from || to >= steps) return REJECT;
      span = { in: from, out: to };
    }

    // Key order matches `emit.compositionOf`, because a payload is re-encoded
    // from what this returns and the round trip is on BYTES.
    anim = { stepMs, holdMs, fadeMs, steps, ...(span ?? {}) };
  }

  if (!Array.isArray(c.layers)) return REJECT;
  const seen = new Set<string>();
  const budget = { left: MAX_LAYERS };
  const layers = validateLayers(c.layers, cellsInCanvas, canvas, seen, budget, 1);
  if (layers === REJECT) return REJECT;

  return {
    comp: {
      ...(shown === undefined ? {} : { shown }),
      ...(anim === undefined ? {} : { anim }),
      layers,
    },
  };
}

function validateLayers(
  raw: readonly unknown[],
  cellsInCanvas: number,
  canvas: CanvasKind,
  seen: Set<string>,
  budget: { left: number },
  depth: number
): ArtLayer[] | typeof REJECT {
  if (depth > MAX_LAYER_DEPTH) return REJECT;
  const out: ArtLayer[] = [];
  for (const entry of raw) {
    if (budget.left-- <= 0) return REJECT;
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return REJECT;
    }
    const l = entry as Record<string, unknown>;

    if (typeof l.id !== "string" || !LAYER_ID.test(l.id)) return REJECT;
    if (RESERVED_IDS.has(l.id)) return REJECT;
    if (seen.has(l.id)) return REJECT;
    seen.add(l.id);

    const layer: ArtLayer = { id: l.id };

    if (l.name !== undefined) {
      if (typeof l.name !== "string" || l.name.length > 128) return REJECT;
      layer.name = l.name;
    }
    for (const flag of ["hidden", "locked"] as const) {
      const v = l[flag];
      if (v === undefined) continue;
      if (typeof v !== "boolean") return REJECT;
      // Only `true` is written; `false` is the absent case, so a payload
      // carrying it round trips to the same bytes either way.
      if (v) layer[flag] = true;
    }
    /**
     * RANGE-CHECKED AND THEN QUANTISED, and the second half was missing.
     *
     * This format has a quantum for an alpha — three decimals — and three places
     * agree on it: `emit.fmtAlpha` rounds to it before writing the markup
     * attribute, `layers.ALPHA_STEP` rounds to it before the model holds one, and
     * `layers.canonicalAlpha` is the one writer. The validator did not, so a
     * payload could state `0.1234567` while the markup of the SAME FILE said
     * `0.123` — one file, two alphas, and no reader with a rule for choosing.
     *
     * The consequence was not the two digits, it was the ROUND TRIP: on load
     * `composer.stackFromEmit` canonicalises, so `0.1234567` became `0.123` and
     * the re-saved file was a different file from the one that was opened. Worse
     * at the top of the range, where `0.9995` canonicalises to exactly 1 — and 1
     * is the absent case, so the field disappeared and the re-saved file stated no
     * alpha at all. Accepted, then changed, and nothing counted the change.
     *
     * QUANTISED HERE rather than refused, which is the one place in this file
     * that goes that way, so the reason is written down: everything else this
     * validator refuses is a statement the format cannot express — a mode that is
     * not a symmetry, an orbit larger than its plate, a half-stated in/out pair.
     * An alpha of `0.1234567` is not that; it is the same alpha this format
     * already writes, spelled with digits below its own resolution. 1/1000 of
     * alpha is a quarter of one 8-bit level and no screen shows it. Refusing the
     * file over it would decline a drawing for a difference nobody can see.
     *
     * What it buys is that load → save is now a FIXED POINT for this field: the
     * value the model canonicalises to is the value the payload already held.
     */
    if (l.opacity !== undefined) {
      if (typeof l.opacity !== "number" || !(l.opacity >= 0 && l.opacity <= 1)) {
        return REJECT;
      }
      layer.opacity = Math.round(l.opacity * ALPHA_QUANTUM) / ALPHA_QUANTUM;
    }
    // THREE FIELDS, THREE BOUNDS, and they were one. All three used to be
    // checked against `MAX_LAYERS`, which is the layer-NODE budget: the right
    // bound for `reveal`, which is an animation step and has one per gesture
    // layer, and a bound that means nothing at all for the other two. It admitted
    // `mode: 0` — a symmetry group that does not exist, and one that `unmarked`
    // will not find, because it tests `mode !== undefined`; so the layer counts
    // as MARKED and turns up in a census as a `modes` bucket of zero. It admitted
    // `orbit: 8000` on a canvas of 384 cells, which is an orbit larger than the
    // plate it is an orbit of.
    //
    // So each is bounded by the thing it is a number OF.
    if (l.reveal !== undefined) {
      const v = l.reveal;
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > MAX_LAYERS) {
        return REJECT;
      }
      layer.reveal = v;
    }
    if (l.mode !== undefined) {
      // The canvas's OWN modes. The triangle's group is D3 and the hexagon's is
      // D6, so 12 is a hexagon word and a triangle file claiming it disagrees
      // with its own canvas — the same rule `validateView` applies to a sector on
      // a triangle. The sector scopes offer a SUBSET of the hexagon's modes, so
      // one list per canvas covers every scope a file could have been drawn in.
      if (!MODES_FOR[canvas].has(l.mode as number)) return REJECT;
      layer.mode = l.mode as number;
    }
    if (l.orbit !== undefined) {
      // A count of CELLS, so the canvas is the bound. One at the bottom and not
      // zero: an orbit is the image of a seed under a subgroup and always
      // contains the seed, so the smallest true orbit is the stabilised one of
      // size 1. `orbit: 0` claims a gesture that painted nothing, which is not a
      // short orbit but an absent one, and `shortOrbits` would report it as the
      // shortest of all.
      //
      // NOT CROSS-CHECKED AGAINST `mode`, and nothing here may start. `mode: 6,
      // orbit: 3` is a seed on a mirror line: the ordinary case, and the case a
      // symmetry-minded reader is most interested in. See `emit.ts`'s header,
      // `layers.ts`'s `LayerGesture`, and this file's own note above.
      const v = l.orbit;
      if (
        typeof v !== "number" ||
        !Number.isInteger(v) ||
        v < 1 ||
        v > cellsInCanvas
      ) {
        return REJECT;
      }
      layer.orbit = v;
    }
    if (l.nest !== undefined) {
      const trail = nestTrail(l.nest);
      if (trail === null) return REJECT;
      // RE-JOINED FROM WHAT WAS CHECKED, which on accepted input is the string
      // that arrived: the split is the check and not a normalisation, because
      // any spacing other than one space between two names produces an empty
      // part and an empty part is not a name. Written this way so that the value
      // stored is provably the value validated, rather than a second reading of
      // the same field.
      layer.nest = trail.join(" ");
    }

    if (l.cells !== undefined) {
      if (!Array.isArray(l.cells)) return REJECT;
      if (l.cells.length > cellsInCanvas) return REJECT;
      const cells: [number, string][] = [];
      const here = new Set<number>();
      let last = -1;
      for (const pair of l.cells) {
        if (!Array.isArray(pair) || pair.length !== 2) return REJECT;
        const i: unknown = pair[0];
        const hex: unknown = pair[1];
        if (typeof i !== "number" || !Number.isInteger(i) || i < 0 || i >= cellsInCanvas) {
          return REJECT;
        }
        if (typeof hex !== "string" || !HEX6.test(hex)) return REJECT;
        if (here.has(i)) return REJECT;
        // Ascending is a promise the markup relies on: `emit.ts` pairs the k-th
        // `<use>` of a layer with the k-th entry here, so an unordered list
        // would silently colour the wrong triangles.
        if (i <= last) return REJECT;
        last = i;
        here.add(i);
        cells.push([i, hex]);
      }
      layer.cells = cells;
    }

    if (l.children !== undefined) {
      if (!Array.isArray(l.children)) return REJECT;
      const kids = validateLayers(
        l.children,
        cellsInCanvas,
        canvas,
        seen,
        budget,
        depth + 1
      );
      if (kids === REJECT) return REJECT;
      layer.children = kids;
    }

    out.push(layer);
  }
  return out;
}

/**
 * A stated composition trail → its names, or `null` for one this program will
 * not walk.
 *
 * ── What is checked, and what each bound is a bound OF ──────────────────
 *
 * The same discipline the three animation fields above were given when they were
 * found sharing one meaningless bound: each limit here is a limit of the thing it
 * is a limit ON, rather than whatever constant was nearest.
 *
 *   THE NAME'S SHAPE is `LAYER_ID`'s, reused rather than restated. A composition
 *   name and a layer id are the same kind of token — an XML-safe name minted from
 *   a counter — and `nested.stepId` mints `t0`, `t1`, … which that pattern already
 *   admits. A second pattern here would be a second thing to keep in step, and it
 *   would fall behind silently.
 *
 *   THE DEPTH is `MAX_LAYER_DEPTH`, because a trail IS a nesting depth and the
 *   walker that rebuilds the tree recurses exactly as `validateLayers` does. The
 *   same argument, the same number.
 *
 *   NO DUPLICATE NAME, because a composition inside itself is not a tree. A file
 *   claiming it is a file whose timeline cannot be built, and this module refuses
 *   a payload that disagrees with itself rather than guessing which half was
 *   meant — the rule it already applies to a sector on a triangle.
 *
 * AN EMPTY STRING IS REFUSED and not read as "no nesting". Absent is the spelling
 * for that, and a second spelling of one thing is two ways for a round trip to
 * pick the other one — `ArtAnimation`'s in/out pair makes the identical argument.
 */
function nestTrail(raw: unknown): string[] | null {
  if (typeof raw !== "string") return null;
  const parts = raw.split(" ");
  if (parts.length === 0 || parts.length > MAX_LAYER_DEPTH) return null;
  const seen = new Set<string>();
  for (const p of parts) {
    if (!LAYER_ID.test(p)) return null;
    if (seen.has(p)) return null;
    seen.add(p);
  }
  return parts;
}

/**
 * `"0-5,12,40-63"` → the indices it names, ascending, or `null`.
 *
 * Strict: ascending, non-overlapping, inside `[0, limit)`, no empty parts, no
 * whitespace. A range list is a statement about which cells the picture frames,
 * and a sloppy one would frame cells the canvas does not have.
 */
export function parseRanges(text: string, limit: number): number[] | null {
  if (text.length === 0) return [];
  if (text.length > 1 << 16) return null;
  const out: number[] = [];
  let last = -1;
  for (const part of text.split(",")) {
    const m = /^(\d{1,7})(?:-(\d{1,7}))?$/.exec(part);
    if (m === null) return null;
    const lo = Number(m[1]);
    const hi = m[2] === undefined ? lo : Number(m[2]);
    if (hi < lo || lo <= last || hi >= limit) return null;
    if (out.length + (hi - lo + 1) > limit) return null;
    for (let i = lo; i <= hi; i++) out.push(i);
    last = hi;
  }
  return out;
}

/** The inverse: ascending indices → the shortest range string naming them. */
export function formatRanges(indices: readonly number[]): string {
  const parts: string[] = [];
  let k = 0;
  while (k < indices.length) {
    const lo = indices[k];
    let hi = lo;
    while (k + 1 < indices.length && indices[k + 1] === hi + 1) {
      k++;
      hi = indices[k];
    }
    parts.push(lo === hi ? String(lo) : `${lo}-${hi}`);
    k++;
  }
  return parts.join(",");
}

// ── the address alphabet ─────────────────────────────────────────────────

/**
 * The four rep-4 letters.
 *
 * Written here rather than imported from `scale.ts` beside `REP9_LETTERS`
 * because the asymmetry is real and not an oversight: `radixAt` dispatches on
 * membership of the REP-9 set and answers `EDGE_DIVISION` for everything else,
 * so rep-4 has a default there and not a letter set. The place rep-4's four
 * characters are actually a closed list is the FILE — they are the alphabet
 * every document written to date is spelled in — so this module is where the
 * list belongs, and `plate.DIGITS` now reads it from here rather than restating
 * it, on the rule `CANVASES` and `MODES_FOR` already follow.
 */
export const REP4_LETTERS = "ABCX";

/**
 * THE ALPHABET IS THE RADIX SCHEDULE. This is the whole format change.
 *
 * ── What was expected to be needed, and is not ───────────────────────────
 *
 * `docs/rep-tile-findings.md` Q2 left the format with one open item: *"a rep-9
 * address needs nine letters; a mixed address needs the radix schedule to be
 * recoverable"*, and `scale.ts`'s header priced the recovery as *"a radix
 * SCHEDULE in the file — which is a format change"*. No such field exists below,
 * and none is needed, for one reason: **the two letter sets are disjoint**, so
 * every character of an address states the edge division of its own cut and a
 * word is a self-describing mixed-radix numeral. `radixAt(word, level)` reads
 * `word.charAt(level)` and answers; `scaleOfWord` multiplies. There is nothing
 * left for a schedule field to say that the address does not already say.
 *
 * Measured, not assumed — `test/rep9format.test.ts` decides three things:
 * the two sets are disjoint; every admissible word's scale is the product of its
 * letters' own radices with no word context read; and under the OVERLAPPING
 * spelling `docs/rep9-charge.md` offered (`A B C` corner, `a b c` edge, `X Y Z`
 * inverted) there are words with two admissible scales, i.e. the schedule is
 * unrecoverable and the file would have to carry one. That document's *naming*
 * — by (vertex, grade) rather than by index order — is honoured in
 * `scale.REP9_LETTERS`; only its characters are refused, and this is why.
 *
 * ── ONE CHARACTER PER CUT, and that is load-bearing ──────────────────────
 *
 * `plate.ancestorAt` truncates an address by LEVEL COUNT — `a.slice(0, stem +
 * k)` — so "the ancestor k cuts down" is a character count. Any spelling that
 * used two characters for a rep-9 letter would make that slice land mid-letter
 * and prefix-equals-ancestry would fail on the first mixed address. Nine single
 * characters is not a tidiness preference; it is what keeps `plate.ts` working.
 *
 * ── What the tag argument now covers ─────────────────────────────────────
 *
 * `plate.ts` gets prefix-equals-ancestry across sectors from `s` and `:` being
 * outside the cut alphabet. That argument now has to hold against thirteen
 * letters rather than four, and it does: the rep-9 letters are `a`–`c` and
 * `u`–`z`, so neither `s` nor `:` nor any decimal digit is one. Asserted rather
 * than believed, in the same file.
 */
export const ADDRESS_LETTERS = REP4_LETTERS + REP9_LETTERS;

/**
 * The letters of one radix, for a caller that needs a node's siblings.
 *
 * Sieved out of the alphabet through `radixAt` rather than written as two lists,
 * so the letters a cut offers and the radix a letter states cannot disagree.
 * MEMOISED because `plate.splitEdits` asks once per node on the path down to
 * every hole of a stroke — a band brush at depth 4 is 1536 targets — and
 * `plate.ts`'s own header is explicit that the split must not become quadratic
 * in the size of a stroke. An unknown edge division answers with the empty list;
 * nothing here invents letters for a radix the alphabet does not spell.
 */
const LETTERS_AT = new Map<number, readonly string[]>();

export const lettersAt = (edgeDivision: number): readonly string[] => {
  const hit = LETTERS_AT.get(edgeDivision);
  if (hit !== undefined) return hit;
  const out = [...ADDRESS_LETTERS].filter((ch) => radixAt(ch, 0) === edgeDivision);
  LETTERS_AT.set(edgeDivision, out);
  return out;
};

/**
 * THE RESOLUTION CEILING, and it is a SCALE and no longer a depth.
 *
 * `MAX_DEPTH` bounds what this program can show, and at one radix a depth said
 * that exactly: depth 5 is 32² = 1024 cells per sector, and there is a button
 * for it. A nine-letter alphabet breaks the equivalence — a rep-9 address of
 * length 5 is 243² = 59,049 cells per sector, fifty-seven times what the ceiling
 * was ever asked to admit — so the quantity that has to be bounded is the scale
 * the address states, not the number of characters it took to state it.
 *
 * Equal to the old bound where the old bound applied: over `[ABCX]` an address
 * has scale 2^length, so `scale ≤ 32` and `length ≤ 5` are the same predicate on
 * every address this program has ever written. `test/rep9format.test.ts` runs
 * both over all 1,364 of them.
 */
export const MAX_SCALE: Readonly<Record<CanvasKind, number>> = {
  triangle: scaleOfDepth(MAX_DEPTH.triangle),
  hexagon: scaleOfDepth(MAX_DEPTH.hexagon),
};

/**
 * The address a plate entry may name, per canvas — SHAPE only; see
 * `addressWord` for the gate.
 *
 * Anchored at both ends, and the character class is the alphabet itself rather
 * than a second spelling of it, so a change to either radix's letters cannot
 * leave this behind. Every letter is ASCII alphanumeric, which is what lets them
 * go into a character class unescaped; a future spelling that reached for a
 * regex metacharacter would have to escape here, and the disjointness test is
 * where that would be noticed.
 *
 * THE LENGTH BOUND IS THE SCALE BOUND'S SHADOW, not an independent limit. The
 * coarsest cut divides the edge by two, so an address of length L has scale at
 * least 2^L, so `scale ≤ 2^MAX_DEPTH` forces `L ≤ MAX_DEPTH`. Keeping it here
 * means a hostile file is rejected on its length before anything walks it,
 * without the bound ever being the thing that decides a legitimate address.
 */
const ADDRESS = (canvas: CanvasKind): RegExp =>
  canvas === "hexagon"
    ? new RegExp(`^s[0-5]:([${ADDRESS_LETTERS}]{1,${MAX_DEPTH[canvas]}})$`)
    : new RegExp(`^([${ADDRESS_LETTERS}]{1,${MAX_DEPTH[canvas]}})$`);

/**
 * THE GATE. An address a canvas may hold → its word (the cuts, without the
 * sector tag); `null` for one it may not.
 *
 * One function rather than a regex at each site, because there are two sites —
 * the reader and the writer — and they must agree exactly or a file this program
 * writes could be a file it refuses to read. Both call this.
 *
 * A DECLINE HERE IS A COUNTED PRECONDITION. `validatePlate` turns it into a
 * whole-payload rejection, which is this module's standing rule for a field that
 * disagrees with itself; `payloadFromPaint` drops the entry, which is the
 * export-side rule stated at its own call site. Neither guesses a radix: with a
 * disjoint alphabet there is no address whose schedule is ambiguous, so there is
 * nothing to guess and the only refusals are letters that are not letters and
 * scales this build cannot draw.
 */
export function addressWord(addr: string, canvas: CanvasKind): string | null {
  const m = ADDRESS(canvas).exec(addr);
  if (m === null) return null;
  const word = m[1];
  if (scaleOfWord(word) > MAX_SCALE[canvas]) return null;
  return word;
}

/**
 * How many addresses a canvas has — every word the gate above admits, times the
 * six sectors on the hexagon.
 *
 * The ceiling on the plate field, for the same reason `cells.length > n` is a
 * rejection: a file that names more addresses than exist is not a plate to
 * clamp, it is a declaration that disagrees with itself.
 *
 * WAS `Σ cellCount(canvas, d)` over the drawable depths, which counted the words
 * of length 1…5 over four letters and is exactly right while four letters is
 * what an address may use. It is no longer, and the direction of the error is
 * the dangerous one: the old count is a floor, so a legitimate mixed plate
 * larger than 8,184 entries would have been refused as self-contradictory. The
 * walk below counts what the gate admits, one cut at a time, and terminates
 * because every cut at least doubles the scale and the cap is finite.
 *
 * It is deliberately NOT `13 + 13² + … + 13^5`. Most of those words are refused
 * on scale — `aaaa` is four cuts and 81² cells — so counting them would put the
 * ceiling six times higher than the address space actually is.
 *
 * EXPORTED so the ceiling can be measured rather than described:
 * `test/rep9format.test.ts` decides it against a brute-force enumeration of
 * every word the gate admits, which is an oracle that shares no line with this.
 */
export const addressCount = (canvas: CanvasKind): number => {
  const cap = MAX_SCALE[canvas];
  let words = 0;
  // Words that reach each scale, by number of cuts. The empty word is the
  // sector itself, at scale 1, and is not an address.
  let level = new Map<number, number>([[1, 1]]);
  while (level.size > 0) {
    const next = new Map<number, number>();
    for (const [scale, n] of level) {
      for (const ch of ADDRESS_LETTERS) {
        const finer = scale * radixAt(ch, 0);
        if (finer > cap) continue;
        next.set(finer, (next.get(finer) ?? 0) + n);
      }
    }
    for (const n of next.values()) words += n;
    level = next;
  }
  return (canvas === "hexagon" ? 6 : 1) * words;
};

/**
 * `undefined` for a file that says nothing about the address plate — which is
 * every file written before the field existed, and every drawing that never
 * left the depth it was started at.
 *
 * Present and malformed is rejected outright, like every other field here.
 *
 * ── What a mixed-radix address does NOT get ─────────────────────────────
 *
 * Special treatment. A rep-9 or mixed address is admitted on exactly the terms a
 * rep-4 one is — the alphabet, the tag, and a scale this build can draw — because
 * with a disjoint alphabet there is no third thing to check. In particular there
 * is no cross-check against the payload's `depth`: `depth` says what the
 * index-keyed `cells` list is indexed by, and the plate is held over addresses
 * ABOVE and BELOW the exported resolution by design. Refusing an address that
 * does not lie in the declared canvas's own tree would refuse exactly the plates
 * mixed radix exists to carry. What such an address does when resolved against a
 * canvas that cannot contain it is stated in `plate.buildView`: nothing. It is
 * carried, it is re-exported, and it is not drawn.
 */
function validatePlate(
  raw: unknown,
  canvas: CanvasKind
): { plate: [string, string][] } | undefined | typeof REJECT {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) return REJECT;
  if (raw.length > addressCount(canvas)) return REJECT;

  const out: [string, string][] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length !== 2) return REJECT;
    const addr: unknown = entry[0];
    const hex: unknown = entry[1];
    if (typeof addr !== "string" || addressWord(addr, canvas) === null) return REJECT;
    if (typeof hex !== "string" || !HEX6.test(hex)) return REJECT;
    if (seen.has(addr)) return REJECT;
    seen.add(addr);
    out.push([addr, hex]);
  }
  return { plate: out };
}

// ── plate ↔ payload ──────────────────────────────────────────────────────

/**
 * `#rgb`, `#RRGGBB` and friends → the one spelling the payload allows.
 *
 * `null` for anything that is not a hex colour at all. Colour NAMES and
 * `rgb()` are deliberately not resolved: this program only ever writes hex, and
 * a loader that guesses at CSS colour syntax is a loader whose failures are
 * invisible.
 */
export function normalizeHex(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  if (HEX6.test(t)) return t;
  if (/^#[0-9a-f]{3}$/.test(t)) {
    return (
      "#" +
      t
        .slice(1)
        .split("")
        .map((d) => d + d)
        .join("")
    );
  }
  return null;
}

/**
 * The plate as it is actually held: cell index → `#rrggbb`.
 *
 * Two cells are dropped rather than written: one whose index the declared
 * canvas cannot hold, and one whose colour cannot be read as a colour. Both are
 * unreachable from this program — the paint map is filled by `schemes.ts`,
 * which cannot produce either — and both are dropped rather than thrown because
 * an export is the one moment where refusing to write is worse than writing
 * less. The polygon itself still carries the colour into the file, so the
 * geometric fallback can recover what the payload declined to promise.
 */
export function payloadFromPaint(
  canvas: CanvasKind,
  depth: number,
  convention: Convention,
  paint: ReadonlyMap<number, string>,
  relief?: ArtRelief,
  /**
   * The address plate, when it says more than `cells` can. Pass `undefined` —
   * which is what `plateEntries` returns for a drawing that never left one
   * depth — and the field is omitted and the bytes are unchanged.
   */
  plate?: readonly (readonly [string, string])[],
  /**
   * The framed sector, when the picture is one. `undefined` — the whole plate —
   * writes exactly the bytes it wrote before this field existed.
   */
  view?: { sector: number }
): ArtPayload {
  const n = cellCount(canvas, depth);
  const cells: [number, string][] = [];
  for (const [i, colour] of paint) {
    if (!Number.isInteger(i) || i < 0 || i >= n) continue;
    const hex = normalizeHex(colour);
    if (hex === null) continue;
    cells.push([i, hex]);
  }
  cells.sort((a, b) => a[0] - b[0]);

  let addressed: [string, string][] | undefined;
  if (plate !== undefined) {
    addressed = [];
    // Dropped rather than thrown, on the rule the cell list already follows:
    // an export is the one moment where refusing to write is worse than
    // writing less. Neither drop is reachable from this program.
    //
    // THE SAME GATE THE READER USES, and that is the point of there being a
    // function: a file this program writes has to be a file it will read back,
    // and two spellings of "which addresses are allowed" is how that stops being
    // true. An over-scale address dropped here is one `validatePlate` would have
    // rejected the whole payload for.
    for (const [addr, colour] of plate) {
      const hex = normalizeHex(colour);
      if (hex === null || addressWord(addr, canvas) === null) continue;
      addressed.push([addr, hex]);
    }
  }

  return {
    version: ART_VERSION,
    canvas,
    depth,
    convention,
    cells,
    ...(relief === undefined ? {} : { relief }),
    ...(addressed === undefined ? {} : { plate: addressed }),
    // Dropped rather than thrown, on the rule the cell list already follows.
    // Unreachable from this program, whose view control cannot leave 0…5.
    ...(view === undefined ||
    canvas !== "hexagon" ||
    !Number.isInteger(view.sector) ||
    view.sector < 0 ||
    view.sector > 5
      ? {}
      : { view: { sector: view.sector } }),
  };
}

/** The paint map a payload restores. */
export function paintFromPayload(p: ArtPayload): Map<number, string> {
  return new Map(p.cells);
}

/**
 * The same pair in Swatch terms, for callers that hold colour rather than text.
 *
 * A Swatch's `hex` is by construction the exact 8-bit rendering of its (h,s,l),
 * and `swatchFromHex` preserves the digits verbatim, so this round trip loses
 * nothing that the hex map does not also lose. The drawing page holds hex —
 * see `PaintMap` in `strokes.ts` — and uses the pair above.
 */
export function payloadFromPlate(
  canvas: CanvasKind,
  depth: number,
  convention: Convention,
  plate: ReadonlyMap<number, Swatch>
): ArtPayload {
  const hex = new Map<number, string>();
  for (const [i, s] of plate) hex.set(i, s.hex);
  return payloadFromPaint(canvas, depth, convention, hex);
}

export function plateFromPayload(p: ArtPayload): Map<number, Swatch> {
  const out = new Map<number, Swatch>();
  for (const [i, hex] of p.cells) out.set(i, swatchFromHex(hex));
  return out;
}

// ── the fallback: match by geometry ──────────────────────────────────────

/**
 * Decimal places both sides of the geometric match are rounded to.
 *
 * NOT a tuned tolerance. `artworkSvg` writes coordinates through its own `fmt`,
 * which rounds to exactly two decimals, so two is the precision the file itself
 * is stated at and rounding the canvas to the same place is a comparison of
 * like with like rather than a fuzzy one. It also happens to be under a
 * thousandth of a cell edge at every depth this program draws, so a file from
 * some other tool that agrees with the canvas to within a thousandth of a cell
 * is a file that means the same triangle.
 */
export const GEOMETRY_PRECISION = 2;

export interface GeometricImport {
  matched: Map<number, Swatch>;
  /** Polygons in the file that carried both a shape and a hex fill. */
  total: number;
  /** Of those, how many matched no cell of this canvas. */
  unmatched: number;
}

const round = (n: number): string => {
  const f = 10 ** GEOMETRY_PRECISION;
  const r = Math.round(n * f) / f;
  return Object.is(r, -0) ? "0" : String(r);
};

/**
 * A shape's identity, independent of how the vertices were listed.
 *
 * The vertex strings are SORTED before joining, so a polygon written starting
 * at a different corner, or wound the other way, is still the same key. Two
 * distinct triangles cannot share a multiset of vertices, so nothing is
 * conflated by this.
 */
const shapeKey = (verts: readonly (readonly [number, number])[]): string =>
  verts
    .map((v) => `${round(v[0])},${round(v[1])}`)
    .sort()
    .join(" ");

const POLYGON = /<polygon\b([^>]*)>/gi;

/**
 * One attribute out of a tag's attribute text. THE one — `emit.ts` imports it.
 *
 * There used to be two of these, one here and a near-identical one in
 * `emit.ts`, and they had already drifted: this one accepted `x='1'` and that
 * one did not, so a file that had been through a toolchain which prefers single
 * quotes read as geometry to the geometric importer and as nothing at all to
 * the layer reader. Two readers of the same bytes that disagree about what an
 * attribute is are a bug waiting for a file to find it, so there is now one
 * function and both readers call it.
 *
 * The leading `[^-\w]` alternative is doing real work: a plain `\b` would let
 * `fill` match inside `data-fill` and, worse, inside `stroke-fill`-shaped names
 * a foreign tool might emit. Written as a character class rather than a
 * lookbehind so the module parses on every browser that runs the app.
 */
const ATTR = (name: string) =>
  new RegExp(`(?:^|[^-\\w])${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i");

export const attrOf = (attrs: string, name: string): string | null => {
  const m = ATTR(name).exec(attrs);
  if (m === null) return null;
  return m[2] ?? m[3] ?? null;
};

/** `fill` as an attribute, or out of an inline `style`. Nothing cascades. */
const fillOf = (attrs: string): string | null => {
  const direct = attrOf(attrs, "fill");
  if (direct !== null) return direct;
  const style = attrOf(attrs, "style");
  if (style === null) return null;
  const m = /(?:^|;)\s*fill\s*:\s*([^;]+)/i.exec(style);
  return m === null ? null : m[1];
};

const pointsOf = (raw: string): [number, number][] | null => {
  const nums = raw
    .trim()
    .split(/[\s,]+/)
    .filter((s) => s.length > 0)
    .map(Number);
  if (nums.length < 6 || nums.length % 2 !== 0) return null;
  if (nums.some((n) => !Number.isFinite(n))) return null;
  const out: [number, number][] = [];
  for (let i = 0; i < nums.length; i += 2) out.push([nums[i], nums[i + 1]]);
  return out;
};

/**
 * Import an SVG that carries no payload, by matching shapes to cells.
 *
 * Only polygons that carry a hex fill OF THEIR OWN are candidates. That is not
 * laziness about the CSS cascade — it is what keeps this program's own exported
 * TILING out of the import, since unpainted cells are written as bare polygons
 * inside a group that holds the tile colour. A file whose fills all live on
 * ancestors imports nothing, and says so through the match rate rather than by
 * quietly filling the plate with somebody's background.
 *
 * The last polygon to claim a cell wins, which is what a painter's-algorithm
 * document means by "the colour of that shape".
 */
export function importByGeometry(
  svgText: string,
  canvas: Figure | Hexagon,
  /**
   * The cells AS DRAWN, index-aligned to the canvas, when the view moves them.
   *
   * The sector view frames one sector of the hexagon and turns it apex-up, so
   * the polygons a file exported from it carries are not the model's own pixels.
   * Matching a foreign file against the model's pixels while the screen shows
   * something else would report a match rate about a picture nobody has. Absent
   * — which is every caller that draws the plate where it was built — this is
   * the canvas's own vertices and nothing changes.
   */
  drawn?: readonly { readonly verts: readonly (readonly [number, number])[] }[]
): GeometricImport {
  const matched = new Map<number, Swatch>();
  if (typeof svgText !== "string") return { matched, total: 0, unmatched: 0 };

  const byShape = new Map<string, number>();
  (drawn ?? canvas.cells).forEach((c, i) => byShape.set(shapeKey(c.verts), i));

  let total = 0;
  let unmatched = 0;
  POLYGON.lastIndex = 0;
  for (let m = POLYGON.exec(svgText); m !== null; m = POLYGON.exec(svgText)) {
    const attrs = m[1];
    const rawPoints = attrOf(attrs, "points");
    if (rawPoints === null) continue;
    const rawFill = fillOf(attrs);
    if (rawFill === null) continue;
    const hex = normalizeHex(rawFill);
    if (hex === null) continue;
    const verts = pointsOf(rawPoints);
    if (verts === null) continue;

    total++;
    const i = byShape.get(shapeKey(verts));
    if (i === undefined) {
      unmatched++;
      continue;
    }
    matched.set(i, swatchFromHex(hex));
  }

  return { matched, total, unmatched };
}
