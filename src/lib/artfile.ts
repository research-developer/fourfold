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
import type { CanvasKind } from "./orbit";
import { READINGS, type Reading } from "./relief";
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
   * address scheme — a word over `{A,B,C,X}`, with an `s0:`…`s5:` sector tag on
   * the hexagon.
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
}

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
export const MAX_DEPTH: Record<CanvasKind, number> = { triangle: 5, hexagon: 4 };

/** Cells in a canvas: one wedge of 4^d, six of them on the hexagon. */
export const cellCount = (canvas: CanvasKind, depth: number): number =>
  (canvas === "hexagon" ? 6 : 1) * 4 ** depth;

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

  return {
    version,
    canvas,
    depth,
    convention,
    cells: out,
    ...(relief ?? {}),
    ...(plate ?? {}),
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
 * The address a plate entry may name, per canvas.
 *
 * Anchored at both ends and bounded by the depth this build can DRAW, on the
 * same principle as the depth check above: an address of length 9 names a cell
 * no control here can select, so accepting it would mean loading paint nobody
 * can see or edit. The hexagon's tag is one digit because there are six
 * sectors, and `s` and `:` are outside `{A,B,C,X}` so the tag can never be
 * mistaken for a cut. See `plate.ts`.
 */
const ADDRESS = (canvas: CanvasKind): RegExp =>
  canvas === "hexagon"
    ? new RegExp(`^s[0-5]:[ABCX]{1,${MAX_DEPTH[canvas]}}$`)
    : new RegExp(`^[ABCX]{1,${MAX_DEPTH[canvas]}}$`);

/**
 * How many addresses a canvas has, over every depth it can be drawn at.
 *
 * The ceiling on the plate field, for the same reason `cells.length > n` is a
 * rejection: a file that names more cells than exist at any depth is not a
 * plate to clamp, it is a declaration that disagrees with itself.
 */
const addressCount = (canvas: CanvasKind): number => {
  let n = 0;
  for (let d = MIN_DEPTH; d <= MAX_DEPTH[canvas]; d++) n += cellCount(canvas, d);
  return n;
};

/**
 * `undefined` for a file that says nothing about the address plate — which is
 * every file written before the field existed, and every drawing that never
 * left the depth it was started at.
 *
 * Present and malformed is rejected outright, like every other field here.
 */
function validatePlate(
  raw: unknown,
  canvas: CanvasKind
): { plate: [string, string][] } | undefined | typeof REJECT {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) return REJECT;
  if (raw.length > addressCount(canvas)) return REJECT;

  const form = ADDRESS(canvas);
  const out: [string, string][] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length !== 2) return REJECT;
    const addr: unknown = entry[0];
    const hex: unknown = entry[1];
    if (typeof addr !== "string" || !form.test(addr)) return REJECT;
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
  plate?: readonly (readonly [string, string])[]
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
    const form = ADDRESS(canvas);
    addressed = [];
    // Dropped rather than thrown, on the rule the cell list already follows:
    // an export is the one moment where refusing to write is worse than
    // writing less. Neither drop is reachable from this program.
    for (const [addr, colour] of plate) {
      const hex = normalizeHex(colour);
      if (hex === null || !form.test(addr)) continue;
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
 * One attribute out of a tag's attribute text.
 *
 * The leading `[^-\w]` alternative is doing real work: a plain `\b` would let
 * `fill` match inside `data-fill` and, worse, inside `stroke-fill`-shaped names
 * a foreign tool might emit. Written as a character class rather than a
 * lookbehind so the module parses on every browser that runs the app.
 */
const ATTR = (name: string) =>
  new RegExp(`(?:^|[^-\\w])${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i");

const attrOf = (attrs: string, name: string): string | null => {
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
  canvas: Figure | Hexagon
): GeometricImport {
  const matched = new Map<number, Swatch>();
  if (typeof svgText !== "string") return { matched, total: 0, unmatched: 0 };

  const byShape = new Map<string, number>();
  canvas.cells.forEach((c, i) => byShape.set(shapeKey(c.verts), i));

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
