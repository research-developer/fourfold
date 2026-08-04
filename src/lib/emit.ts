/**
 * The one serialiser: a composition — or any layer inside it — as SVG text, and
 * that text back again.
 *
 * ── Why there is one function and not four ───────────────────────────────
 *
 * Copy/paste and export/import are the same operation twice. Both turn a
 * drawing into text and text back into a drawing; the only difference is where
 * the text goes, and that is the caller's business. So there is `serialise` and
 * `parse`, SCOPE is a parameter of the first, and the word "clipboard" does not
 * appear in this file. Two code paths would be two chances for a pasted layer
 * and a saved layer to disagree about what a layer is.
 *
 * ── The observation this is built on ────────────────────────────────────
 *
 * Every cell of this figure is CONGRUENT. At one depth the leaves of the V4 cut
 * are unit triangles of the Eisenstein lattice, so there are exactly TWO of
 * them — one pointing up, one pointing down — and a drawing of six thousand
 * cells is those two shapes at six thousand positions. Measured rather than
 * assumed: `test/emit.test.ts` counts the distinct shapes at every depth in
 * both views and gets 2 every time.
 *
 * So the file says each shape ONCE, in `<defs>`, and every cell is a `<use>` of
 * one of them at its own position. Colour is a CSS class, one rule per distinct
 * colour, rather than an attribute repeated per cell. Both are worth real
 * bytes, and the test measures them rather than this comment arguing for them.
 * A hexagon with a third of its cells painted, against what `artworkSvg` writes
 * for the same drawing:
 *
 *              THE DRAWING                 THE WHOLE FILE
 *            raw          gzipped        raw          gzipped
 *   depth 3  81%          64%            93%          75%
 *   depth 4  80%          54%            91%          62%
 *   depth 5  79%  (275k)  52%  (24.5k)   90%  (344k)  67%  (36.4k)
 *
 * Two columns because they answer different questions. THE DRAWING is what this
 * format is worth — the same numbers with the payload comment removed from both
 * files. THE WHOLE FILE includes the payload, and a layered file states its
 * paint twice: once flattened, for a reader that predates layers, and once per
 * layer. That duplication is the price of the stack and it is stated here
 * rather than hidden in the better number.
 *
 * The gzipped saving is the bigger one, which is the opposite of the intuition
 * that repetition compresses so well that structure cannot help. It helps
 * because the repeated thing gets SHORTER, not merely more repetitive. Welding
 * the paint widens the gap further — 65% raw on the drawing, because a weld
 * costs two attributes per CELL in the polygon form and one word per RULE here.
 *
 * ── `x`/`y`, and not `transform` ────────────────────────────────────────
 *
 * `<use x y>` on a `<polygon>` is a translate of the referenced content, and
 * that is what this file relies on. Measured by rewriting THIS emitter's own
 * output into each of the alternatives, depth 5, drawing bytes:
 *
 *                             raw        gzipped
 *   x="…" y="…"               274 615    24 451
 *   transform="translate(…)"  366 775    25 187     +34% raw, +3.0% gzipped
 *   style="--x:…;--y:…"       323 767    25 218     +18% raw, +3.1% gzipped
 *
 * `x`/`y` wins on both counts and is the shortest thing to read; the custom
 * properties would additionally need a `transform` rule to do anything at all.
 * The one thing `<use>` must not do is behave differently from a polygon at the
 * same place — `test/emit.test.ts` resolves the geometry both ways and compares
 * vertex sets, and the same two documents were rendered side by side in a
 * browser: 384 cells, worst positional difference 6·10⁻⁵ of a device pixel,
 * identical computed fill and stroke on every one, and a hit test at every cell
 * centre returning the same colour in both.
 *
 * ── Coordinates: two decimals, and rounded BEFORE the offset ────────────
 *
 * The lattice is exact integers before projection, and a surprising amount
 * survives: on the hexagon every x coordinate is an EXACT INTEGER at every
 * depth this program draws, because the unit is 512/2^d ≥ 16 and a lattice
 * point sits at x = (a + b/2)·unit. The y coordinates are cy − b·unit·√3/2 and
 * are irrational, so they are the only ones that need decimals at all.
 *
 * Two of them, matching `artworkSvg`'s `fmt` and `artfile.GEOMETRY_PRECISION`.
 * NOT a taste: the geometric importer compares a file's coordinates against the
 * canvas's own at exactly two places, so writing three would be writing digits
 * nothing reads and writing one would put a cell 0.05 units from where the
 * importer looks for it. What the two decimals cost is set out on `shapeOf`.
 *
 * The shortest encoding was measured and NOT taken: wrap the drawing in
 * `transform="matrix(u, 0, u/2, −u√3/2, 0, 0)"` and every position becomes a
 * small exact integer — 19 030 bytes gzipped at depth 5, a further 22% off. It
 * is rejected because that matrix is a shear. Its singular values are √1.5 and
 * √0.5, so a stroke of one width comes out 1.22 wide in one direction and 0.71
 * in another: the hairline that shows the tiling would be 73% heavier along one
 * axis than another. A file that is smaller and draws a different picture is
 * not smaller.
 *
 * ── The markup is indented, and that is nearly free ─────────────────────
 *
 * One element per line, two-space indent. It costs 11% of the raw bytes and
 * between 0.7% and 2.3% of the gzipped ones — measured, in the test. A file a
 * person can open and read is worth two parts in a hundred.
 *
 * ── Layers ──────────────────────────────────────────────────────────────
 *
 * A layer is a `<g>`; a sub-layer is a `<g>` inside it, to any depth. Pasting a
 * composition onto a layer grafts it in whole, so the depth grows and nothing
 * is flattened. Serialising a layer means that `<g>` and everything under it,
 * plus ONLY the prototypes and rules that subtree references — a copied layer
 * is small and self-sufficient rather than dragging the document's whole
 * palette with it.
 *
 * Every flag written into the markup is the layer's OWN. `hidden` becomes
 * `display:none`, which hides the descendants when the file is rendered while
 * leaving each of them saying what it says — so a round trip through a hidden
 * parent does not permanently mark the children hidden. Same for `opacity`,
 * which SVG already composites down the tree.
 *
 * ── Reading is text and regex only ──────────────────────────────────────
 *
 * A loaded file is UNTRUSTED. `parse` returns `null` for anything it cannot
 * vouch for and throws for nothing; it never hands markup to a DOM parser and
 * never assigns to `innerHTML`, so no code path in a hostile file can execute.
 * The payload in the comment is the authority for everything model-side — which
 * cells, which layers, which ids — and it is validated by `artfile.ts` before a
 * byte of the markup is trusted. The markup supplies the picture.
 */

import {
  encodeArt,
  extractArt,
  formatRanges,
  parseRanges,
  cellCount,
  LAYER_ID,
  MAX_ART_BYTES,
  MAX_LAYER_DEPTH,
  MAX_LAYERS,
  RESERVED_IDS,
  type ArtAnimation,
  type ArtComposition,
  type ArtLayer,
  type ArtPayload,
} from "./artfile";
import { fmtCoord, type ArtCell, type ArtOverlayGroup } from "./strokes";

// ── the interface this module requires of the layer model ────────────────

/**
 * What a layer has to be for this file to write it down.
 *
 * Deliberately the smallest thing that can be serialised, and deliberately not
 * the thing the editor holds: no selection, no order operations, no parent
 * pointers, nothing that would make the file format an opinion about how layers
 * are edited. A layer model is free to be richer; it only has to be able to
 * produce this and to accept it back.
 *
 * `id` must be an XML name (`artfile.LAYER_ID`) and unique across the whole
 * composition, because it is written straight into `id="…"` so that a reader
 * can match a `<g>` in the markup to an entry in the payload by eye. `rekey`
 * below is what makes that safe when a pasted subtree arrives carrying ids the
 * target already uses.
 *
 * Every flag is the layer's OWN and never the resolved one. A hidden parent
 * hides its descendants when the stack is drawn; it does not make them hidden.
 */
export interface EmitLayer {
  id: string;
  name?: string;
  /** OWN visibility. Absent or false means visible. */
  hidden?: boolean;
  /** OWN lock. Carried through the file; nothing here renders it. */
  locked?: boolean;
  /** OWN alpha in `0…1`. Absent means 1. */
  opacity?: number;
  /** This layer's own paint: model cell index → `#rrggbb`. */
  paint?: ReadonlyMap<number, string>;
  /** Sub-layers, in paint order: later children sit over earlier ones. */
  children?: readonly EmitLayer[];
  /** Animation: the step this layer is revealed at. See `EmitAnimation`. */
  reveal?: number;
  /** The brush symmetry the gesture was made under, when one was recorded. */
  mode?: number;
  /** How many cells the recorded orbit held, when this layer is one. */
  orbit?: number;
}

/**
 * The timing of a looping reveal.
 *
 * A layer carrying `reveal: k` comes up at `k · stepMs` and stays up for the
 * rest of the cycle. One CSS rule and one `@keyframes` per DISTINCT reveal
 * index — not per layer and not per cell — which is O(gestures) rather than
 * O(cells).
 *
 * One shared `@keyframes` plus a per-layer `animation-delay` is the obvious
 * shape and it CANNOT loop: with an infinite iteration count the delay applies
 * to the first iteration only, so the second cycle plays every layer at once,
 * and with a finite count nothing ever resets. The window a layer is visible
 * for has a different LENGTH for every reveal index, and a delay shifts a
 * window without resizing it. That argument is `replay.ts`'s, and it is
 * reproduced here because it is the reason this looks more expensive than it
 * needs to be.
 */
export interface EmitAnimation {
  /** Milliseconds between reveals. */
  stepMs: number;
  /** Milliseconds the finished plate holds before the loop restarts. */
  holdMs: number;
  /** How long a layer takes to come up. Short — it reads as a stroke landing. */
  fadeMs: number;
  /** How many reveal steps the cycle has. */
  steps: number;
}

// ── the document ─────────────────────────────────────────────────────────

/**
 * Everything a file says, in one value.
 *
 * `serialise` writes it and `parse` returns it, and the round trip is on the
 * TEXT: `serialise(parse(t)) === t`. It is not on this object — the file states
 * coordinates to two decimals, so a document that went through it comes back
 * with coordinates rounded to what the file could say. That is the file being
 * honest about its own precision rather than a loss.
 */
export interface EmitDoc {
  width: number;
  height: number;
  /** Model cell index → its polygon, in the document's own pixels. */
  cells: ReadonlyMap<number, ArtCell>;
  /** The cell indices the picture frames, ascending. */
  shown: readonly number[];
  /** Plate colour behind the tiling. */
  background: string;
  /** Fill for cells nobody painted, or `null` to leave them as background. */
  unpainted: string | null;
  tileSeam: string | null;
  paintSeam: string | null;
  seamWidth: number;
  /** Stroke every painted cell in its own fill, closing the sub-pixel seam. */
  weldPaint: boolean;
  title: string;
  layers: readonly EmitLayer[];
  overlay: readonly ArtOverlayGroup[];
  animation: EmitAnimation | null;
  /**
   * The model-side statement of what this drawing IS. Mandatory, because a
   * layer names cells by INDEX and an index is meaningless without the canvas,
   * the depth and the convention that issued it. `comp` is filled in by
   * `serialise` from `layers` and must not be set here.
   */
  payload: Omit<ArtPayload, "comp">;
}

/** Whole composition, or one layer and everything under it. */
export type EmitScope = { readonly layer: string } | undefined;

/**
 * How many distinct cell shapes are worth a `<defs>` entry.
 *
 * Two is the answer for every ordinary drawing — the figure has two cell shapes
 * and that is the whole point of this module. It is a LIMIT rather than an
 * assertion because the relief bakes a per-ring scale into the vertices and
 * genuinely destroys the congruence: at depth 4 a relieved plate has 1134
 * distinct shapes among 1536 cells, and a prototype per shape would be a bigger
 * file than plain polygons. Past this limit the emitter writes polygons, which
 * is the honest thing to do about a picture whose cells are not congruent.
 *
 * Eight rather than two so a canvas that ever has a handful of shapes — a mixed
 * depth, a decorated rim — still gets the saving.
 */
export const PROTOTYPE_LIMIT = 8;

const INDENT = "  ";

/**
 * What a colour may look like on its way into the file.
 *
 * `#rrggbb`, `rgba(…)`, a keyword. Anything outside this set becomes `none`
 * rather than being written: a colour is caller data, and caller data that
 * contains a quote or an angle bracket would be a way to write markup through
 * an attribute. Nothing in this program can produce such a colour; the guard is
 * here because "nothing can" is a claim about today's callers.
 */
const COLOUR = /^[#A-Za-z0-9(),.%\s/-]{1,64}$/;

const colourSafe = (c: string): string => (COLOUR.test(c) ? c : "none");

const escapeText = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const escapeAttr = (s: string) => escapeText(s).replace(/"/g, "&quot;");

const unescapeAttr = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");

/** Three decimals for an alpha, exactly as `artworkSvg` writes one. */
const fmtAlpha = (n: number): string => {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? "0" : String(r);
};

// ── prototypes ───────────────────────────────────────────────────────────

interface Placed {
  /** Prototype id, or `null` when this shape is written out in full. */
  proto: string | null;
  /** Where the prototype is placed, already formatted. */
  x: string;
  y: string;
  /** The full `points` text, for the polygon fallback. */
  points: string;
}

/** Two decimals, as a number. The file's own quantum, from `strokes.fmtCoord`. */
const q2 = (n: number): number => {
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
};

/**
 * A cell's shape and where it sits, with the shape stated independently of the
 * position — and, crucially, QUANTISED FIRST.
 *
 * The anchor is the cell's lowest vertex — smallest x, then smallest y — and
 * the shape is the other vertices measured from it, SORTED. Sorting collapses
 * the six ways of writing one triangle into one: a polygon that starts at a
 * different corner, or winds the other way, is the same shape here, and nothing
 * downstream can tell, because a triangle's fill and its stroke do not depend on
 * which corner it was written from.
 *
 * ── Why the rounding happens before the subtraction, and what it costs ────
 *
 * Round the vertex, THEN take the offset, and the anchor and the offset are
 * both exact multiples of the file's own quantum — so `x` plus the prototype's
 * coordinate reproduces the number `artworkSvg` would have written for that
 * vertex EXACTLY, not to within a hundredth. Take the offset first and round
 * afterwards and the two roundings compound: a cell comes out up to 0.01 from
 * where the polygon form puts it, adjacent cells stop sharing an edge, and a
 * geometric import that matches at two decimals — which is what
 * `artfile.GEOMETRY_PRECISION` does — misses.
 *
 * It costs TWO EXTRA PROTOTYPES. The figure has two cell shapes; the row height
 * is `unit·√3/2`, which is irrational, so consecutive rounded rows sit either
 * `⌊h⌋` or `⌈h⌉` hundredths apart and each of the two shapes is written down two
 * ways. Four, at every depth, in both views — measured in `test/emit.test.ts`,
 * along with the claim that the reconstruction is exact. Four `<defs>` lines
 * instead of two is what exactness costs here, and it is worth it.
 */
function shapeOf(cell: ArtCell): { sig: string; ax: number; ay: number } {
  const sorted = cell.verts
    .map((v) => [q2(v[0]), q2(v[1])] as [number, number])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const o = sorted[0];
  return {
    sig: sorted.map((v) => `${fmtCoord(q2(v[0] - o[0]))},${fmtCoord(q2(v[1] - o[1]))}`).join(" "),
    ax: o[0],
    ay: o[1],
  };
}

/**
 * The id a shape gets in `<defs>`.
 *
 * `u` when the odd corner sits ABOVE the line of the other two and `d` when it
 * sits below — which on this figure is the up-pointing and down-pointing
 * triangle, and on any other is still the only two-way distinction a triangle
 * has. The variants are `u2`, `d2`, and so on, in discovery order, so a reader
 * meeting `#u2` knows it is an up triangle and that there is more than one way
 * to write one at two decimals.
 */
function prototypeId(sig: string, taken: ReadonlySet<string>): string {
  const mid = sig.split(" ")[1];
  const dy = Number(mid?.split(",")[1]);
  const stem = Number.isFinite(dy) ? (dy < 0 ? "u" : "d") : "p";
  if (!taken.has(stem)) return stem;
  for (let n = 2; n < 100; n++) if (!taken.has(`${stem}${n}`)) return `${stem}${n}`;
  // Unreachable: `PROTOTYPE_LIMIT` is far below 100, and past it nothing is
  // factored at all.
  return `${stem}x`;
}

/** The full `points` text a cell would be written as, unfactored. */
const pointsOf = (cell: ArtCell): string =>
  cell.verts.map((v) => `${fmtCoord(v[0])},${fmtCoord(v[1])}`).join(" ");

// ── serialise ────────────────────────────────────────────────────────────

/** Every layer of a tree, parents before children, in paint order. */
function walkLayers(
  layers: readonly EmitLayer[],
  visit: (l: EmitLayer, depth: number) => void,
  depth = 0
): void {
  for (const l of layers) {
    visit(l, depth);
    if (l.children !== undefined) walkLayers(l.children, visit, depth + 1);
  }
}

/** The subtree rooted at `id`, or `null`. */
export function findLayer(
  layers: readonly EmitLayer[],
  id: string
): EmitLayer | null {
  for (const l of layers) {
    if (l.id === id) return l;
    if (l.children === undefined) continue;
    const hit = findLayer(l.children, id);
    if (hit !== null) return hit;
  }
  return null;
}

/**
 * The colouring the stack resolves to, later layers over earlier ones.
 *
 * HIDDEN SUBTREES ARE SKIPPED, because this is what the picture shows and the
 * picture does not show them. Their paint is still written into the payload —
 * hiding a layer must not delete it — so the flattened `cells` list and the
 * layer tree say different things on purpose, and each says the true one.
 */
export function flatten(layers: readonly EmitLayer[]): Map<number, string> {
  const out = new Map<number, string>();
  const rec = (list: readonly EmitLayer[]) => {
    for (const l of list) {
      if (l.hidden === true) continue;
      if (l.paint !== undefined) for (const [i, c] of l.paint) out.set(i, c);
      if (l.children !== undefined) rec(l.children);
    }
  };
  rec(layers);
  return out;
}

/**
 * The composition, or one layer of it, as an SVG document.
 *
 * Throws only for a caller error the program itself can make — an unknown layer
 * id, or a cell that has to be drawn and has no geometry. Untrusted input goes
 * the other way, through `parse`, which never throws.
 */
export function serialise(doc: EmitDoc, scope?: EmitScope): string {
  const scoped = scopeOf(doc, scope);

  const shownSet = new Set(scoped.shown);
  const composite = flatten(scoped.layers);

  // Everything the document will draw, so the prototypes and the palette are
  // read off what is actually emitted and a scoped export carries neither a
  // shape nor a rule it does not use.
  const drawn: number[] = [];
  if (scoped.unpainted !== null) {
    for (const i of scoped.shown) if (!composite.has(i)) drawn.push(i);
  }
  const tiling = [...drawn];
  walkLayers(scoped.layers, (l) => {
    if (l.paint === undefined) return;
    for (const i of sortedKeys(l.paint)) if (shownSet.has(i)) drawn.push(i);
  });

  const geom = new Map<number, ArtCell>();
  for (const i of drawn) {
    const c = doc.cells.get(i);
    if (c === undefined) {
      throw new Error(`emit: cell ${i} is drawn but has no geometry`);
    }
    geom.set(i, c);
  }

  // ── prototypes ──
  const protoOf = new Map<string, string>();
  const ids = new Set<string>();
  for (const c of geom.values()) {
    const s = shapeOf(c).sig;
    if (protoOf.has(s)) continue;
    if (protoOf.size >= PROTOTYPE_LIMIT) {
      // Past the limit nothing is factored, so the ids stop mattering; the
      // count is still needed to reach the verdict.
      protoOf.set(s, "");
      continue;
    }
    const id = prototypeId(s, ids);
    ids.add(id);
    protoOf.set(s, id);
  }
  const factored = protoOf.size <= PROTOTYPE_LIMIT;
  const placed = new Map<number, Placed>();
  for (const [i, c] of geom) {
    const s = shapeOf(c);
    placed.set(i, {
      proto: factored ? (protoOf.get(s.sig) as string) : null,
      x: fmtCoord(s.ax),
      y: fmtCoord(s.ay),
      points: pointsOf(c),
    });
  }

  // ── palette ──
  const klass = new Map<string, string>();
  walkLayers(scoped.layers, (l) => {
    if (l.paint === undefined) return;
    for (const i of sortedKeys(l.paint)) {
      if (!shownSet.has(i)) continue;
      const c = l.paint.get(i) as string;
      if (!klass.has(c)) klass.set(c, `k${klass.size}`);
    }
  });

  const out: string[] = [];
  const w = fmtCoord(scoped.width);
  const h = fmtCoord(scoped.height);
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img">`
  );
  // No tag ever appears inside this line, even spelled out: the reader below
  // blanks comments before it tokenises, but a file is also read by eye and by
  // other people's tools, and a comment that looks like markup invites both to
  // guess.
  out.push(
    `${INDENT}<!-- FOURFOLD composition. Every cell is a congruent triangle: the shapes are ` +
      `named once in the defs block and each cell is one use of one of them at its own x and y. ` +
      `Colour is a CSS class, one rule per colour. Layers are nested groups. ` +
      `Self contained: no script, no external reference. -->`
  );
  out.push(
    `${INDENT}${encodeArt({ ...scoped.payload, comp: compositionOf(scoped) })}`
  );
  out.push(`${INDENT}<title>${escapeText(scoped.title)}</title>`);

  if (factored && protoOf.size > 0) {
    out.push(`${INDENT}<defs>`);
    for (const [sig, id] of protoOf) {
      out.push(`${INDENT.repeat(2)}<polygon id="${id}" points="${sig}"/>`);
    }
    out.push(`${INDENT}</defs>`);
  }

  const css = styleRules(scoped, klass);
  if (css.length > 0) {
    out.push(`${INDENT}<style>`);
    for (const rule of css) out.push(`${INDENT.repeat(2)}${rule}`);
    out.push(`${INDENT}</style>`);
  }

  out.push(
    `${INDENT}<rect width="${w}" height="${h}" fill="${colourSafe(scoped.background)}"/>`
  );

  const shapeAt = (i: number, cls: string, depth: number): string => {
    const p = placed.get(i) as Placed;
    const attr = cls === "" ? "" : ` class="${cls}"`;
    return p.proto === null
      ? `${INDENT.repeat(depth)}<polygon points="${p.points}"${attr}/>`
      : `${INDENT.repeat(depth)}<use href="#${p.proto}" x="${p.x}" y="${p.y}"${attr}/>`;
  };

  if (scoped.unpainted !== null) {
    out.push(`${INDENT}<g id="tiling" class="tile">`);
    for (const i of tiling) out.push(shapeAt(i, "", 2));
    out.push(`${INDENT}</g>`);
  }

  const seam =
    scoped.weldPaint || scoped.paintSeam === null
      ? ""
      : ` stroke="${colourSafe(scoped.paintSeam)}" stroke-width="${fmtCoord(
          scoped.seamWidth
        )}"`;
  out.push(`${INDENT}<g id="paint"${seam}>`);
  emitLayers(out, scoped.layers, shownSet, klass, shapeAt, 2);
  out.push(`${INDENT}</g>`);

  for (const g of scoped.overlay) {
    if (g.shapes.length === 0) continue;
    out.push(
      `${INDENT}<g class="wash" fill="${colourSafe(g.fill)}" opacity="${fmtAlpha(
        g.opacity
      )}">`
    );
    for (const shape of g.shapes) {
      out.push(
        `${INDENT.repeat(2)}<polygon points="${shape
          .map((v) => `${fmtCoord(v[0])},${fmtCoord(v[1])}`)
          .join(" ")}"/>`
      );
    }
    out.push(`${INDENT}</g>`);
  }

  out.push(`</svg>`);
  return out.join("\n");
}

const sortedKeys = (m: ReadonlyMap<number, string>): number[] =>
  [...m.keys()].sort((a, b) => a - b);

function emitLayers(
  out: string[],
  layers: readonly EmitLayer[],
  shown: ReadonlySet<number>,
  klass: ReadonlyMap<string, string>,
  shapeAt: (i: number, cls: string, depth: number) => string,
  depth: number
): void {
  for (const l of layers) {
    const attrs: string[] = [`id="${l.id}"`];
    if (l.name !== undefined) attrs.push(`data-name="${escapeAttr(l.name)}"`);
    // The layer's OWN flag. SVG hides the descendants of a `display:none`
    // group when it draws, and each of them goes on saying what it says, so a
    // round trip through a hidden parent cannot flatten the children's state.
    if (l.hidden === true) attrs.push(`style="display:none"`);
    if (l.locked === true) attrs.push(`data-locked="1"`);
    if (l.opacity !== undefined && l.opacity !== 1) {
      attrs.push(`opacity="${fmtAlpha(l.opacity)}"`);
    }
    if (l.reveal !== undefined) attrs.push(`data-reveal="${l.reveal}"`);
    if (l.orbit !== undefined) attrs.push(`data-orbit="${l.orbit}"`);
    if (l.mode !== undefined) attrs.push(`data-mode="${l.mode}"`);
    out.push(`${INDENT.repeat(depth)}<g ${attrs.join(" ")}>`);
    if (l.paint !== undefined) {
      for (const i of sortedKeys(l.paint)) {
        if (!shown.has(i)) continue;
        out.push(shapeAt(i, klass.get(l.paint.get(i) as string) as string, depth + 1));
      }
    }
    if (l.children !== undefined) {
      emitLayers(out, l.children, shown, klass, shapeAt, depth + 1);
    }
    out.push(`${INDENT.repeat(depth)}</g>`);
  }
}

function styleRules(
  doc: EmitDoc,
  klass: ReadonlyMap<string, string>
): string[] {
  const rules: string[] = [];
  if (doc.unpainted !== null) {
    const seam =
      doc.tileSeam === null
        ? ""
        : `; stroke: ${colourSafe(doc.tileSeam)}; stroke-width: ${fmtCoord(
            doc.seamWidth
          )}`;
    rules.push(`.tile { fill: ${colourSafe(doc.unpainted)}${seam} }`);
  }
  for (const [colour, k] of klass) {
    // The weld — every painted cell stroked in its own fill, which closes the
    // sub-pixel join a run of same-coloured cells would otherwise show — costs
    // one word per RULE here where the polygon form costs two attributes per
    // CELL. It is where the class form pays best: 63% of the polygon file's raw
    // bytes against 83% for the same file written with fill attributes.
    const weld = doc.weldPaint
      ? `; stroke: ${colourSafe(colour)}; stroke-width: ${fmtCoord(doc.seamWidth * 3)}`
      : "";
    rules.push(`.${k} { fill: ${colourSafe(colour)}${weld} }`);
  }
  if (doc.animation !== null) rules.push(...animationRules(doc));
  return rules;
}

/** How much wider than a hairline a weld stroke is. `strokes.WELD_WIDTH`. */
const WELD = 3;

function animationRules(doc: EmitDoc): string[] {
  const a = doc.animation as EmitAnimation;
  const cycle = Math.max(1, a.steps * a.stepMs + a.holdMs);
  const reveals = new Set<number>();
  walkLayers(doc.layers, (l) => {
    if (l.reveal !== undefined) reveals.add(l.reveal);
  });
  const rules: string[] = [
    `[data-reveal] { opacity: 0; animation-duration: ${cycle}ms; ` +
      `animation-timing-function: linear; animation-iteration-count: infinite; ` +
      `animation-fill-mode: both }`,
  ];
  const order = [...reveals].sort((x, y) => x - y);
  for (const k of order) rules.push(`[data-reveal="${k}"] { animation-name: r${k} }`);
  for (const k of order) {
    const at = k * a.stepMs;
    const on = (100 * at) / cycle;
    const lit = (100 * Math.min(at + Math.max(1, a.fadeMs), cycle)) / cycle;
    // The first step reveals at 0, where `0%, 0%` would be a duplicate selector.
    const dark = on <= 0 ? "0%" : `0%, ${fmtAlpha(on)}%`;
    rules.push(
      `@keyframes r${k} { ${dark} { opacity: 0 } ${fmtAlpha(lit)}%, 100% { opacity: 1 } }`
    );
  }
  return rules;
}

/**
 * The document a scope names.
 *
 * A layer scope produces a STANDALONE COMPOSITION — same canvas, same
 * coordinates, one layer in the stack — rather than a fragment, so that pasting
 * it is the same operation as loading it and the round trip is the same round
 * trip. The tiling is dropped, because a copied layer is the layer and not the
 * grid behind it, and `shown` narrows to the cells that subtree paints.
 *
 * `plate` is dropped from the payload: it is the WHOLE model's address plate at
 * every depth, and a subtree does not own it. `relief` and `view` are kept —
 * they describe the pixels the layer was drawn at, which are the pixels being
 * copied.
 */
function scopeOf(doc: EmitDoc, scope: EmitScope): EmitDoc {
  if (scope === undefined) return doc;
  const root = findLayer(doc.layers, scope.layer);
  if (root === null) throw new Error(`emit: no layer ${scope.layer}`);
  const own = flattenAll([root]);
  const shown = doc.shown.filter((i) => own.has(i));
  const visible = flatten([root]);
  const cells: [number, string][] = [];
  for (const i of shown) {
    const c = visible.get(i);
    if (c !== undefined) cells.push([i, c]);
  }
  const payload = { ...doc.payload };
  delete payload.plate;
  return {
    ...doc,
    shown,
    unpainted: null,
    layers: [root],
    overlay: [],
    payload: { ...payload, cells },
  };
}

/** Every cell any layer of the tree paints, hidden ones included. */
function flattenAll(layers: readonly EmitLayer[]): Set<number> {
  const out = new Set<number>();
  walkLayers(layers, (l) => {
    if (l.paint !== undefined) for (const i of l.paint.keys()) out.add(i);
  });
  return out;
}

function compositionOf(doc: EmitDoc): ArtComposition {
  const anim: ArtAnimation | undefined =
    doc.animation === null
      ? undefined
      : {
          stepMs: doc.animation.stepMs,
          holdMs: doc.animation.holdMs,
          fadeMs: doc.animation.fadeMs,
          steps: doc.animation.steps,
        };
  return {
    shown: formatRanges(doc.shown),
    ...(anim === undefined ? {} : { anim }),
    layers: doc.layers.map(toArtLayer),
  };
}

/**
 * Key order here MUST match `artfile`'s validator, because a payload is
 * re-encoded from what the validator returned and the round trip is on bytes.
 */
function toArtLayer(l: EmitLayer): ArtLayer {
  const out: ArtLayer = { id: l.id };
  if (l.name !== undefined) out.name = l.name;
  if (l.hidden === true) out.hidden = true;
  if (l.locked === true) out.locked = true;
  if (l.opacity !== undefined && l.opacity !== 1) out.opacity = l.opacity;
  if (l.reveal !== undefined) out.reveal = l.reveal;
  if (l.mode !== undefined) out.mode = l.mode;
  if (l.orbit !== undefined) out.orbit = l.orbit;
  if (l.paint !== undefined && l.paint.size > 0) {
    out.cells = sortedKeys(l.paint).map(
      (i) => [i, l.paint?.get(i) as string] as [number, string]
    );
  }
  if (l.children !== undefined && l.children.length > 0) {
    out.children = l.children.map(toArtLayer);
  }
  return out;
}

// ── parse ────────────────────────────────────────────────────────────────

/** One `<g>`, `<use>` or `<polygon>` the reader met, with its attribute text. */
interface Token {
  kind: "open" | "close" | "shape";
  tag: string;
  attrs: string;
}

const TOKEN = /<(\/?)(g|use|polygon)\b([^>]*?)(\/?)>/g;

/**
 * The document with every comment blanked out.
 *
 * A comment is not markup, and anything that reads markup has to agree: this
 * file's own header comment names the elements it uses, and a hostile file
 * could hide an unbalanced `<g>` in one and walk the reader's stack off the
 * end. Replaced with spaces rather than removed so that offsets into the
 * document are unchanged and the two texts stay comparable.
 */
const withoutComments = (text: string): string =>
  text.replace(/<!--[\s\S]*?-->/g, (m) => " ".repeat(m.length));

const attrOf = (attrs: string, name: string): string | null => {
  const m = new RegExp(`(?:^|[^-\\w])${name}\\s*=\\s*"([^"]*)"`, "i").exec(attrs);
  return m === null ? null : m[1];
};

/**
 * An SVG document this module wrote, back as the value it was written from.
 *
 * `null` for: anything that is not a string, anything past `MAX_ART_BYTES`, a
 * document with no payload or a payload this build will not vouch for, a
 * document with no layer composition in that payload, markup that nests past
 * `MAX_LAYER_DEPTH`, a `<use>` naming a prototype the file does not define, a
 * layer whose drawn cells do not line up with what the payload says it paints,
 * and anything that makes the reader throw. It throws for nothing.
 *
 * The payload is the AUTHORITY for which cells and which layers. The markup
 * supplies the picture: the shapes, the colours, the seams and the frame. So a
 * file whose markup has been tampered with either fails the count checks and is
 * refused, or differs only in pixels the payload does not claim.
 */
export function parse(text: string): EmitDoc | null {
  try {
    return read(text);
  } catch {
    // Unreachable by construction — every branch below returns rather than
    // throws — and kept because "returns null for hostile input" is a promise
    // this module makes to a drop handler, and a promise with an exception
    // escaping through it is not one.
    return null;
  }
}

function read(text: string): EmitDoc | null {
  if (typeof text !== "string") return null;
  if (text.length === 0 || text.length > MAX_ART_BYTES) return null;

  const payload = extractArt(text);
  if (payload === null || payload.comp === undefined) return null;
  const comp = payload.comp;
  // The composition is lifted OUT of the payload and into `layers`, so there is
  // one place a layer lives and the two cannot drift.
  const rest: Omit<ArtPayload, "comp"> & { comp?: ArtComposition } = { ...payload };
  delete rest.comp;

  // Everything below reads MARKUP, so it reads the document with the comments
  // taken out — including the payload comment, which has already been read and
  // whose contents must not be able to look like an element.
  const markup = withoutComments(text);

  const head = /^<svg\b([^>]*)>/.exec(text);
  if (head === null) return null;
  const width = num(attrOf(head[1], "width"));
  const height = num(attrOf(head[1], "height"));
  if (width === null || height === null) return null;

  const titleAt = /<title>([\s\S]{0,4096}?)<\/title>/.exec(markup);
  const title = titleAt === null ? "" : unescapeAttr(titleAt[1]);

  // ── prototypes ──
  const protos = new Map<string, [number, number][]>();
  const defs = /<defs>([\s\S]{0,8192}?)<\/defs>/.exec(markup);
  if (defs !== null) {
    const re = /<polygon\s+id="([A-Za-z][\w.-]{0,15})"\s+points="([^"]{0,256})"\s*\/>/g;
    for (let m = re.exec(defs[1]); m !== null; m = re.exec(defs[1])) {
      const verts = readPoints(m[2]);
      if (verts === null) return null;
      protos.set(m[1], verts);
    }
  }

  // ── style ──
  const styleAt = /<style>([\s\S]{0,1048576}?)<\/style>/.exec(markup);
  const style = styleAt === null ? "" : styleAt[1];
  let unpainted: string | null = null;
  let tileSeam: string | null = null;
  let seamWidth = 0;
  const tile = /\.tile\s*\{\s*fill:\s*([^;}]+?)\s*(?:;\s*stroke:\s*([^;}]+?)\s*;\s*stroke-width:\s*([^;}\s]+)\s*)?\}/.exec(
    style
  );
  if (tile !== null) {
    unpainted = tile[1];
    if (tile[2] !== undefined) {
      tileSeam = tile[2];
      const w = num(tile[3]);
      if (w === null) return null;
      seamWidth = w;
    }
  }
  const colourOf = new Map<string, string>();
  let weldPaint = false;
  const kre = /\.(k\d{1,5})\s*\{\s*fill:\s*([^;}]+?)\s*(?:;\s*stroke:\s*([^;}]+?)\s*;\s*stroke-width:\s*([^;}\s]+)\s*)?\}/g;
  for (let m = kre.exec(style); m !== null; m = kre.exec(style)) {
    colourOf.set(m[1], m[2]);
    if (m[3] !== undefined) {
      weldPaint = true;
      const w = num(m[4]);
      if (w === null) return null;
      if (tile === null || tile[2] === undefined) seamWidth = w / WELD;
    }
  }

  const rect = /<rect\b[^>]*\bfill="([^"]{0,64})"/.exec(markup);
  const background = rect === null ? "none" : rect[1];

  // ── the drawing ──
  const body = readBody(markup);
  if (body === null) return null;

  const shown =
    comp.shown === undefined
      ? Array.from({ length: cellCount(payload.canvas, payload.depth) }, (_, i) => i)
      : parseRanges(comp.shown, cellCount(payload.canvas, payload.depth));
  if (shown === null) return null;
  const shownSet = new Set(shown);

  const layers = fromArtLayers(comp.layers);
  const composite = flatten(layers);

  const cells = new Map<number, ArtCell>();
  const place = (i: number, s: Shape): boolean => {
    const verts = resolve(s, protos);
    if (verts === null) return false;
    cells.set(i, { verts });
    return true;
  };

  // The tiling, in the order it was written: every framed cell the visible
  // stack does not paint, ascending.
  if (body.tiling !== null) {
    const want: number[] = [];
    for (const i of shown) if (!composite.has(i)) want.push(i);
    if (want.length !== body.tiling.length) return null;
    for (let k = 0; k < want.length; k++) if (!place(want[k], body.tiling[k])) return null;
  } else if (unpainted !== null) {
    // A `.tile` rule with nothing to apply it to. Harmless in a renderer and a
    // disagreement here, so it is refused rather than half-believed.
    return null;
  }

  const paintSeam = body.paintSeam;
  if (body.paintSeamWidth !== null && !weldPaint) seamWidth = body.paintSeamWidth;

  if (!matchLayers(layers, body.layers, shownSet, place)) return null;

  const overlay: ArtOverlayGroup[] = [];
  for (const g of body.overlay) {
    const shapes: [number, number][][] = [];
    for (const s of g.shapes) {
      if (s.points === null) return null;
      const verts = readPoints(s.points);
      if (verts === null) return null;
      shapes.push(verts);
    }
    overlay.push({ fill: g.fill, opacity: g.opacity, shapes });
  }

  const animation: EmitAnimation | null =
    comp.anim === undefined
      ? null
      : {
          stepMs: comp.anim.stepMs,
          holdMs: comp.anim.holdMs,
          fadeMs: comp.anim.fadeMs,
          steps: comp.anim.steps,
        };

  return {
    width,
    height,
    cells,
    shown,
    background,
    unpainted,
    tileSeam,
    paintSeam,
    seamWidth,
    weldPaint,
    title,
    layers,
    overlay,
    animation,
    payload: rest,
  };
}

const num = (raw: string | null): number | null => {
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

/** A shape as the markup states it: a placed prototype, or its own points. */
interface Shape {
  proto: string | null;
  x: number;
  y: number;
  points: string | null;
}

function resolve(
  s: Shape,
  protos: ReadonlyMap<string, [number, number][]>
): [number, number][] | null {
  if (s.proto === null) return s.points === null ? null : readPoints(s.points);
  const base = protos.get(s.proto);
  if (base === undefined) return null;
  return base.map((v) => [v[0] + s.x, v[1] + s.y] as [number, number]);
}

function readPoints(raw: string): [number, number][] | null {
  const nums = raw
    .trim()
    .split(/[\s,]+/)
    .filter((t) => t.length > 0)
    .map(Number);
  if (nums.length < 6 || nums.length % 2 !== 0 || nums.length > 512) return null;
  if (nums.some((n) => !Number.isFinite(n))) return null;
  const out: [number, number][] = [];
  for (let i = 0; i < nums.length; i += 2) out.push([nums[i], nums[i + 1]]);
  return out;
}

/** A `<g>` of the layer tree, as the markup states it. */
interface MarkupLayer {
  id: string;
  shapes: Shape[];
  children: MarkupLayer[];
}

interface Body {
  tiling: Shape[] | null;
  paintSeam: string | null;
  paintSeamWidth: number | null;
  layers: MarkupLayer[];
  overlay: { fill: string; opacity: number; shapes: Shape[] }[];
}

/**
 * The three top-level groups, walked with a stack rather than a DOM.
 *
 * One pass of one regex over the document, so a hostile file costs a fixed
 * number of steps per tag rather than backtracking; the depth cap is what stops
 * a file made of a million `<g>`s from becoming a million-deep tree.
 */
function readBody(text: string): Body | null {
  const body: Body = {
    tiling: null,
    paintSeam: null,
    paintSeamWidth: null,
    layers: [],
    overlay: [],
  };
  const stack: MarkupLayer[] = [];
  /** Which top-level group we are inside: none, the tiling, the paint, a wash. */
  let region: "" | "tiling" | "paint" | "wash" = "";
  let wash: { fill: string; opacity: number; shapes: Shape[] } | null = null;
  let depth = 0;

  TOKEN.lastIndex = 0;
  for (let m = TOKEN.exec(text); m !== null; m = TOKEN.exec(text)) {
    const tok: Token = {
      kind: m[1] === "/" ? "close" : m[4] === "/" ? "shape" : "open",
      tag: m[2],
      attrs: m[3],
    };
    if (tok.tag !== "g") {
      if (tok.kind !== "shape") continue;
      const shape = shapeToken(tok);
      if (shape === null) return null;
      if (region === "tiling") (body.tiling as Shape[]).push(shape);
      else if (region === "wash" && wash !== null) wash.shapes.push(shape);
      else if (region === "paint" && stack.length > 0) {
        stack[stack.length - 1].shapes.push(shape);
      }
      // A shape outside every group is furniture — the defs' own prototypes —
      // and is not part of the drawing.
      continue;
    }

    if (tok.kind === "close") {
      if (depth === 0) return null;
      depth -= 1;
      if (region === "paint" && stack.length > 0) {
        const done = stack.pop() as MarkupLayer;
        if (stack.length > 0) stack[stack.length - 1].children.push(done);
        else body.layers.push(done);
        if (stack.length === 0 && depth === 0) region = "";
        continue;
      }
      if (depth === 0) {
        if (region === "wash" && wash !== null) {
          body.overlay.push(wash);
          wash = null;
        }
        region = "";
      }
      continue;
    }

    if (tok.kind !== "open") continue;
    depth += 1;
    if (depth > MAX_LAYER_DEPTH + 1) return null;
    if (stack.length > MAX_LAYERS) return null;

    if (depth === 1) {
      const id = attrOf(tok.attrs, "id");
      const cls = attrOf(tok.attrs, "class");
      if (id === "tiling") {
        if (body.tiling !== null) return null;
        body.tiling = [];
        region = "tiling";
        continue;
      }
      if (id === "paint") {
        body.paintSeam = attrOf(tok.attrs, "stroke");
        body.paintSeamWidth = num(attrOf(tok.attrs, "stroke-width"));
        region = "paint";
        continue;
      }
      if (cls === "wash") {
        const fill = attrOf(tok.attrs, "fill");
        const opacity = num(attrOf(tok.attrs, "opacity"));
        if (fill === null || opacity === null) return null;
        wash = { fill, opacity, shapes: [] };
        region = "wash";
        continue;
      }
      region = "";
      continue;
    }

    if (region !== "paint") continue;
    const id = attrOf(tok.attrs, "id");
    if (id === null || !LAYER_ID.test(id) || RESERVED_IDS.has(id)) return null;
    stack.push({ id, shapes: [], children: [] });
  }

  if (depth !== 0 || stack.length !== 0) return null;
  return body;
}

function shapeToken(tok: Token): Shape | null {
  if (tok.tag === "use") {
    const href = attrOf(tok.attrs, "href");
    if (href === null || href[0] !== "#") return null;
    const x = num(attrOf(tok.attrs, "x"));
    const y = num(attrOf(tok.attrs, "y"));
    if (x === null || y === null) return null;
    return { proto: href.slice(1), x, y, points: null };
  }
  if (tok.tag !== "polygon") return null;
  const points = attrOf(tok.attrs, "points");
  if (points === null) return null;
  return { proto: null, x: 0, y: 0, points };
}

function fromArtLayers(list: readonly ArtLayer[]): EmitLayer[] {
  return list.map((l) => {
    const out: EmitLayer = { id: l.id };
    if (l.name !== undefined) out.name = l.name;
    if (l.hidden === true) out.hidden = true;
    if (l.locked === true) out.locked = true;
    if (l.opacity !== undefined) out.opacity = l.opacity;
    if (l.reveal !== undefined) out.reveal = l.reveal;
    if (l.mode !== undefined) out.mode = l.mode;
    if (l.orbit !== undefined) out.orbit = l.orbit;
    if (l.cells !== undefined) out.paint = new Map(l.cells);
    if (l.children !== undefined) out.children = fromArtLayers(l.children);
    return out;
  });
}

/**
 * Pair the payload's layers with the markup's, and take the geometry off the
 * markup.
 *
 * The k-th shape inside a `<g>` is the k-th cell that layer paints AND FRAMES,
 * which is the order `serialise` wrote them in. That is what lets a cell cost
 * an `x` and a `y` and nothing else: the index is stated once, in the payload,
 * rather than repeated on every element. A count that does not line up is a
 * file whose picture and payload disagree, and it is refused rather than
 * half-read.
 */
function matchLayers(
  model: readonly EmitLayer[],
  markup: readonly MarkupLayer[],
  shown: ReadonlySet<number>,
  place: (i: number, s: Shape) => boolean
): boolean {
  if (model.length !== markup.length) return false;
  for (let k = 0; k < model.length; k++) {
    const m = model[k];
    const g = markup[k];
    if (m.id !== g.id) return false;
    const want =
      m.paint === undefined ? [] : sortedKeys(m.paint).filter((i) => shown.has(i));
    if (want.length !== g.shapes.length) return false;
    for (let n = 0; n < want.length; n++) {
      if (!place(want[n], g.shapes[n])) return false;
    }
    if (!matchLayers(m.children ?? [], g.children, shown, place)) return false;
  }
  return true;
}

// ── grafting a parsed subtree ────────────────────────────────────────────

/**
 * The same tree with every id made unique against `taken`.
 *
 * NOT a layer operation — it moves nothing and reorders nothing. It is what
 * makes a PARSED subtree safe to hand to a layer model: a pasted composition
 * arrives carrying the ids it was written with, and those ids are `id="…"` in
 * the target's markup, where two of anything is a document that no longer says
 * what it means. `parse` cannot do this itself, because it does not know what
 * the target already holds; the caller does, and this is the one line it needs.
 *
 * Deterministic: `base`, `base-2`, `base-3`, and the suffix is stripped from an
 * id that already carries one so pasting the same thing four times gives four
 * ids rather than one with four suffixes. An id that cannot be made to fit
 * `LAYER_ID` is replaced outright rather than mangled.
 */
export function rekey(
  layers: readonly EmitLayer[],
  taken: ReadonlySet<string>
): EmitLayer[] {
  const used = new Set(taken);
  let anon = 0;
  const fresh = (id: string): string => {
    const base = /^(.*?)-\d{1,4}$/.exec(id)?.[1] ?? id;
    const seed = LAYER_ID.test(base) && !RESERVED_IDS.has(base) ? base : `layer${anon++}`;
    if (!used.has(seed) && !RESERVED_IDS.has(seed)) {
      used.add(seed);
      return seed;
    }
    for (let n = 2; n < 10000; n++) {
      const c = `${seed}-${n}`;
      if (!used.has(c) && c.length <= 64) {
        used.add(c);
        return c;
      }
    }
    // Unreachable while `taken` is finite and ids are bounded; a thrown error
    // here would be a paste that silently dropped a layer instead.
    throw new Error("emit: cannot find a free layer id");
  };
  const rec = (list: readonly EmitLayer[]): EmitLayer[] =>
    list.map((l) => ({
      ...l,
      id: fresh(l.id),
      ...(l.children === undefined ? {} : { children: rec(l.children) }),
    }));
  return rec(layers);
}

/** Every id a tree uses, for the caller that is about to `rekey` against it. */
export function idsOf(layers: readonly EmitLayer[]): Set<string> {
  const out = new Set<string>();
  walkLayers(layers, (l) => out.add(l.id));
  return out;
}

// ── reading a foreign file's geometry ────────────────────────────────────

/**
 * Every filled shape in a document, with `<use>` resolved against `<defs>`.
 *
 * `artfile.importByGeometry` matches a file cell by cell against the canvas and
 * only looks at `<polygon>` elements carrying a fill of their own — which is
 * exactly right for a file `artworkSvg` wrote and finds NOTHING in one this
 * module wrote, where the shape is a `<use>` and the fill is a class. This is
 * the missing half: it resolves both, so a file in this format still has a
 * geometric fallback when its payload has been stripped.
 *
 * `null` on the same terms as `parse`: too big, or markup it cannot follow.
 */
export function resolvedShapes(
  text: string
): { verts: [number, number][]; fill: string }[] | null {
  if (typeof text !== "string" || text.length > MAX_ART_BYTES) return null;
  const markup = withoutComments(text);
  const protos = new Map<string, [number, number][]>();
  const defs = /<defs>([\s\S]{0,8192}?)<\/defs>/.exec(markup);
  if (defs !== null) {
    const re = /<polygon\s+id="([A-Za-z][\w.-]{0,15})"\s+points="([^"]{0,256})"\s*\/>/g;
    for (let m = re.exec(defs[1]); m !== null; m = re.exec(defs[1])) {
      const verts = readPoints(m[2]);
      if (verts === null) return null;
      protos.set(m[1], verts);
    }
  }
  const fills = new Map<string, string>();
  const styleAt = /<style>([\s\S]{0,1048576}?)<\/style>/.exec(markup);
  if (styleAt !== null) {
    const re = /\.([\w-]{1,32})\s*\{\s*fill:\s*([^;}]+?)\s*[;}]/g;
    for (let m = re.exec(styleAt[1]); m !== null; m = re.exec(styleAt[1])) {
      fills.set(m[1], m[2]);
    }
  }
  const out: { verts: [number, number][]; fill: string }[] = [];
  // A group's own fill cascades to the shapes inside it, which is how the
  // tiling states its colour once. Tracked with a stack, so a nested layer
  // inherits what its ancestors said and nothing more.
  const inherited: (string | null)[] = [null];
  TOKEN.lastIndex = 0;
  for (let m = TOKEN.exec(markup); m !== null; m = TOKEN.exec(markup)) {
    const close = m[1] === "/";
    const selfClose = m[4] === "/";
    const tag = m[2];
    const attrs = m[3];
    if (tag === "g") {
      if (close) {
        if (inherited.length > 1) inherited.pop();
        continue;
      }
      if (selfClose) continue;
      const cls = attrOf(attrs, "class");
      const own =
        attrOf(attrs, "fill") ??
        (cls === null ? null : (fills.get(cls) ?? null));
      inherited.push(own ?? inherited[inherited.length - 1]);
      continue;
    }
    if (!selfClose) continue;
    const cls = attrOf(attrs, "class");
    const fill =
      attrOf(attrs, "fill") ??
      (cls === null ? null : (fills.get(cls) ?? null)) ??
      inherited[inherited.length - 1];
    if (fill === null) continue;
    const shape = shapeToken({ kind: "shape", tag, attrs });
    if (shape === null) continue;
    // A prototype in `<defs>` carries an id and no fill; it is the shape, not a
    // use of it, and counting it would put a triangle at the origin.
    if (shape.proto === null && attrOf(attrs, "id") !== null) continue;
    const verts = resolve(shape, protos);
    if (verts === null) continue;
    out.push({ verts, fill });
  }
  return out;
}
