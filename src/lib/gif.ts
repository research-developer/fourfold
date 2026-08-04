/**
 * The replay as a GIF: palette-indexed pixels, rasterised from the MODEL.
 *
 * ── Why there is no dependency here ──────────────────────────────────────
 *
 * The app ships under a strict CSP and every export in this program is a pure
 * function of the drawing. An encoder that reached for a CDN, a WASM blob or a
 * `new Function` would break the first; one that read pixels back off the live
 * board would break the second — the same argument `strokes.artworkSvg` and
 * `replay.animatedSvg` already make, and for the same reason: the board carries
 * a hover ghost, a keyboard cursor and a transparent hit layer, none of which
 * are the drawing.
 *
 * So the frames are rasterised here, from the same `AnimationStep`s the animated
 * SVG is written from, and GIF89a is written here too. It is arithmetic and a
 * scanline loop, and it costs the bundle nothing.
 *
 * ── Why the palette is EXACT and not quantised ───────────────────────────
 *
 * A GIF is 256 colours, palette-indexed. Ordinarily that is a lossy constraint
 * and an encoder answers it with a median cut. This drawing does not need one:
 * it is flat fills of a handful of colours on a tiling colour, so if the
 * rasteriser never antialiases then the set of colours in the raster is exactly
 * the set of colours in the model. No quantisation, no dither, no drift — the
 * gold in the GIF is byte-for-byte the gold in the SVG.
 *
 * That is a property of the RASTERISER rather than a hope: `scan` writes whole
 * colour ids at pixel centres and never blends, so a colour can only enter the
 * raster by being written into it. What it costs is the antialiasing: a cell
 * edge in the GIF is a staircase where the SVG's is smooth. That is the trade
 * GIF forces, and taking it the other way — rasterise with coverage, then
 * quantise — would spend the whole palette on edge ramps.
 *
 * ── When it cannot be exact, and it is SOONER than it looks ──────────────
 *
 * The first draft of this comment said the relief wash was what broke the
 * budget. Measured, that is wrong, and the honest numbers are worth the space.
 * Three things multiply the count:
 *
 *   THE SEAM is `rgba(…)`, so every fill has a second colour: the seam
 *   composited over it. That is a FACTOR OF TWO on everything below.
 *
 *   THE COLOUR PER GESTURE. A gesture paints its orbit from a scheme, and a
 *   scheme with six offsets paints six fills. So a drawing that picks a fresh
 *   base hue every gesture costs twelve entries a gesture, and 255 is gone at
 *   TWENTY-ONE of them. `solid` costs two a gesture and lasts to about 127.
 *   Measured at depth 4 in `test/gif.test.ts`: `hexad` is exact at 20 gestures
 *   with 243 colours and cut at 40 with 381; `solid` is exact at 120 with 242
 *   and cut at 200 with 385. A drawing that keeps ONE palette — which is what
 *   the colour well encourages, and what a real session looks like — stays at
 *   fifteen colours over any number of gestures.
 *
 *   THE RELIEF WASH is a stack of translucent bands, one per ring, over the
 *   whole plate. A pixel is then `wash(ring) over fill`, so everything above is
 *   multiplied by (rings + 1) as well: at depth 4 there are 29 bands and a
 *   fifteen-colour drawing becomes 361; at depth 5 there are 53 and it becomes
 *   607. With the relief on, nothing is exact.
 *
 * So: exact when it fits, and a median cut over the colours that ACTUALLY
 * OCCUR — weighted by how many pixels wear each — when it does not. `GifResult`
 * reports which happened and how many colours the drawing really had, so a
 * caller can say so out loud rather than quietly shipping a quantised file.
 * That reporting is the load-bearing part, because the crossing point is not
 * where anybody's intuition puts it.
 *
 * ── Frames: one per gesture, and no interpolation ────────────────────────
 *
 * The animated SVG fades a group up over `fadeMs`. A GIF cannot fade without
 * spending frames on it, and every intermediate opacity is a NEW COLOUR — a
 * six-frame fade over a twenty-colour drawing is 120 colours of ramp for
 * something the eye reads as an appearance either way. So a gesture is one
 * frame, the frame count is the gesture count, and the fade is dropped rather
 * than faked.
 *
 * The delays are the same numbers the SVG uses. GIF counts in CENTISECONDS,
 * which would normally be a rounding problem; it is not one here, because every
 * value the interval control offers — 80, 150, 250, 400, 700, 1200 ms — is a
 * whole number of centiseconds. The GIF's cycle and the SVG's, written from one
 * drawing, are equal to the millisecond.
 *
 * ── Frames are DIFFERENCES ───────────────────────────────────────────────
 *
 * The animation is additive: a step only ever covers cells. So frame 0 carries
 * the whole plate and every frame after it carries the bounding box of the
 * cells that step painted, transparent everywhere inside that box that did not
 * change, with a disposal method of "leave it alone". A 200-gesture drawing
 * costs one plate plus 200 small rectangles rather than 200 plates.
 *
 * The transparent index is bought out of the palette: 255 colours and one hole,
 * rather than 256 colours and full frames. On this figure that is free — the
 * exact palette is tens of entries, not hundreds — and on a composition that
 * needs the cut, one merged colour is a far smaller loss than a file forty
 * times the size.
 */

import type { AnimationStep } from "./replay";
import type { ArtCell, ArtOverlayGroup, PaintMap } from "./strokes";

// ── colour ───────────────────────────────────────────────────────────────

/** Opaque 24-bit colour, packed `0xRRGGBB`. Alpha is carried beside it. */
export type RGB = number;

export interface Colour {
  rgb: RGB;
  /** 0…1. */
  a: number;
}

const clamp255 = (n: number): number => (n < 0 ? 0 : n > 255 ? 255 : Math.round(n));

const KEYWORD: Readonly<Record<string, RGB>> = {
  black: 0x000000,
  white: 0xffffff,
  red: 0xff0000,
  lime: 0x00ff00,
  blue: 0x0000ff,
};

/**
 * A CSS colour this program can produce, as numbers.
 *
 * `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb(…)`, `rgba(…)`, and the few keywords the
 * palette and the relief use. `null` for anything else — including `none` —
 * which every caller here treats as "do not draw", exactly as SVG does.
 *
 * Deliberately NOT a general CSS colour parser. An exported file only ever
 * carries colours this program wrote, and a parser that guessed at `hsl(…)` or
 * `color(display-p3 …)` would be inventing pixels.
 */
export function parseColour(css: string): Colour | null {
  if (typeof css !== "string") return null;
  const s = css.trim().toLowerCase();
  if (s.length === 0) return null;
  if (s[0] === "#") {
    const h = s.slice(1);
    if (/^[0-9a-f]{3}$/.test(h)) {
      const r = parseInt(h[0] + h[0], 16);
      const g = parseInt(h[1] + h[1], 16);
      const b = parseInt(h[2] + h[2], 16);
      return { rgb: (r << 16) | (g << 8) | b, a: 1 };
    }
    if (/^[0-9a-f]{6}$/.test(h)) return { rgb: parseInt(h, 16), a: 1 };
    if (/^[0-9a-f]{8}$/.test(h)) {
      return { rgb: parseInt(h.slice(0, 6), 16), a: parseInt(h.slice(6), 16) / 255 };
    }
    return null;
  }
  const fn = /^rgba?\(\s*([^)]*)\)$/.exec(s);
  if (fn !== null) {
    const parts = fn[1].split(/[\s,/]+/).filter((t) => t.length > 0);
    if (parts.length < 3 || parts.length > 4) return null;
    const ch = parts
      .slice(0, 3)
      .map((t) => (t.endsWith("%") ? (Number(t.slice(0, -1)) * 255) / 100 : Number(t)));
    if (ch.some((n) => !Number.isFinite(n))) return null;
    let a = 1;
    if (parts.length === 4) {
      const t = parts[3];
      const raw = t.endsWith("%") ? Number(t.slice(0, -1)) / 100 : Number(t);
      if (!Number.isFinite(raw)) return null;
      a = raw < 0 ? 0 : raw > 1 ? 1 : raw;
    }
    return { rgb: (clamp255(ch[0]) << 16) | (clamp255(ch[1]) << 8) | clamp255(ch[2]), a };
  }
  const kw = KEYWORD[s];
  return kw === undefined ? null : { rgb: kw, a: 1 };
}

/**
 * `src` at `alpha` over `dst`, rounded to whole channels.
 *
 * The one place a colour is arithmetic rather than a lookup, and it is exact in
 * the sense that matters: one pair always yields one byte triple, so a
 * translucent seam over a fill is ONE palette entry however many pixels wear it.
 */
export function over(src: RGB, alpha: number, dst: RGB): RGB {
  if (alpha >= 1) return src;
  if (alpha <= 0) return dst;
  const r = clamp255(((src >> 16) & 255) * alpha + ((dst >> 16) & 255) * (1 - alpha));
  const g = clamp255(((src >> 8) & 255) * alpha + ((dst >> 8) & 255) * (1 - alpha));
  const b = clamp255((src & 255) * alpha + (dst & 255) * (1 - alpha));
  return (r << 16) | (g << 8) | b;
}

/** `0xrrggbb` back as `#rrggbb`, for a message a person reads. */
export const hexOf = (c: RGB): string => `#${c.toString(16).padStart(6, "0")}`;

// ── the palette ──────────────────────────────────────────────────────────

/**
 * How many colours the drawing may keep.
 *
 * The format allows 256. One is spent on the transparent index that makes a
 * difference frame possible — see the header — so the drawing gets 255.
 */
export const PALETTE_LIMIT = 255;

export interface Palette {
  /** The colours, in index order. Length ≤ `PALETTE_LIMIT`. */
  colours: readonly RGB[];
  /** Every colour the drawing contained → the entry that now stands for it. */
  index: ReadonlyMap<RGB, number>;
  /** True when nothing was merged: every colour is its own entry. */
  exact: boolean;
  /** How many distinct colours the drawing actually had. */
  distinct: number;
}

/**
 * A palette for a set of colours: exact if it fits, median cut if it does not.
 *
 * `counts` is how many pixels wear each colour, and it is what makes the cut
 * honest — a wash band covering a third of the plate should not be merged away
 * to preserve a colour that shows on nine pixels. Boxes split on the widest
 * channel at the WEIGHTED median and collapse to their weighted mean, which is
 * the standard construction; it is named rather than invented.
 *
 * Sorted when exact, so the palette is a function of the colours and not of a
 * Map's insertion order: two exports of one drawing are byte-identical.
 */
export function buildPalette(counts: ReadonlyMap<RGB, number>): Palette {
  const all = [...counts.keys()];
  if (all.length <= PALETTE_LIMIT) {
    const colours = [...all].sort((a, b) => a - b);
    const index = new Map<RGB, number>();
    colours.forEach((c, i) => index.set(c, i));
    return { colours, index, exact: true, distinct: all.length };
  }

  const weight = (m: readonly RGB[]): number =>
    m.reduce((s, c) => s + (counts.get(c) ?? 1), 0);
  const boxes: { members: RGB[]; w: number }[] = [
    { members: [...all].sort((a, b) => a - b), w: weight(all) },
  ];

  while (boxes.length < PALETTE_LIMIT) {
    let best = -1;
    let bestSpread = 0;
    let bestAxis = 0;
    for (let i = 0; i < boxes.length; i++) {
      const m = boxes[i].members;
      if (m.length < 2) continue;
      for (let axis = 0; axis < 3; axis++) {
        const sh = 16 - 8 * axis;
        let lo = 255;
        let hi = 0;
        for (const c of m) {
          const v = (c >> sh) & 255;
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        if (hi - lo > bestSpread) {
          bestSpread = hi - lo;
          best = i;
          bestAxis = axis;
        }
      }
    }
    if (best < 0) break;
    const box = boxes[best];
    const sh = 16 - 8 * bestAxis;
    const sorted = [...box.members].sort(
      (a, b) => ((a >> sh) & 255) - ((b >> sh) & 255) || a - b
    );
    let half = 0;
    let cut = 0;
    for (; cut < sorted.length - 1; cut++) {
      half += counts.get(sorted[cut]) ?? 1;
      if (half >= box.w / 2) break;
    }
    const lo = sorted.slice(0, cut + 1);
    const hi = sorted.slice(cut + 1);
    boxes[best] = { members: lo, w: weight(lo) };
    boxes.push({ members: hi, w: weight(hi) });
  }

  const colours: RGB[] = [];
  const index = new Map<RGB, number>();
  for (const box of boxes) {
    let r = 0;
    let g = 0;
    let b = 0;
    let w = 0;
    for (const c of box.members) {
      const n = counts.get(c) ?? 1;
      r += ((c >> 16) & 255) * n;
      g += ((c >> 8) & 255) * n;
      b += (c & 255) * n;
      w += n;
    }
    const at = colours.length;
    colours.push((clamp255(r / w) << 16) | (clamp255(g / w) << 8) | clamp255(b / w));
    for (const c of box.members) index.set(c, at);
  }
  return { colours, index, exact: false, distinct: all.length };
}

// ── the specification ────────────────────────────────────────────────────

export interface GifSpec {
  /** The document's own coordinates — what the SVG puts in its `viewBox`. */
  viewWidth: number;
  viewHeight: number;
  /** Output width in pixels. The height follows from the aspect ratio. */
  width: number;
  /** Cell polygons in document coordinates, indexed by model cell index. */
  cells: readonly ArtCell[];
  /** The cell indices the picture frames, ascending. Absent means all of them. */
  shown?: readonly number[];
  background: string;
  /** Fill for a cell nobody has painted, or `null` to leave the plate showing. */
  unpainted: string | null;
  tileSeam: string | null;
  paintSeam: string | null;
  seamWidth: number;
  weldPaint?: boolean;
  /** Flat translucent shapes over the finished drawing — the relief wash. */
  overlay?: readonly ArtOverlayGroup[];
  /** The plate before the first recorded gesture. Present in the first frame. */
  ground: PaintMap;
  steps: readonly AnimationStep[];
  stepMs: number;
  holdMs: number;
}

export interface GifResult {
  /**
   * The file. Typed against a plain `ArrayBuffer` rather than the default
   * `ArrayBufferLike`, so it can go straight into a `Blob` — the alternative
   * was a cast at the one call site that matters.
   */
  bytes: Uint8Array<ArrayBuffer>;
  width: number;
  height: number;
  /** How many frames the file holds. One per gesture. */
  frames: number;
  /** How many palette entries it uses, transparency aside. */
  palette: number;
  /** True when no colour was merged — the palette is the drawing's own. */
  exact: boolean;
  /** How many distinct colours the drawing actually contained. */
  distinct: number;
  /** The cycle in milliseconds. Equal to the animated SVG's, exactly. */
  cycleMs: number;
}

export interface GifProgress {
  done: number;
  total: number;
}

/** Under two centiseconds a browser substitutes a hundred milliseconds of its own. */
const MIN_DELAY_CS = 2;

/**
 * How long each frame is held, in centiseconds, in order.
 *
 * The last frame carries the hold as well as its own step, so the cycle is
 * `steps · stepMs + holdMs` — the number `replay.animatedSvg` writes into
 * `animation-duration`. Exported so a test can weigh the two against each other
 * rather than trust this paragraph.
 */
export function frameDelays(steps: number, stepMs: number, holdMs: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < steps; k++) {
    const ms = k === steps - 1 ? stepMs + holdMs : stepMs;
    out.push(Math.max(MIN_DELAY_CS, Math.round(ms / 10)));
  }
  return out;
}

// ── the raster ───────────────────────────────────────────────────────────

interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const emptyBounds = (): Bounds => ({
  x0: Infinity,
  y0: Infinity,
  x1: -Infinity,
  y1: -Infinity,
});

/**
 * The interner: every (colour, wash band) pair the drawing reaches, once.
 *
 * Ids are into the DRAWING's colour list, which is allowed to be longer than
 * 256; the reduction to a GIF palette happens once, at the end, and never
 * inside the rasteriser. That is what keeps "the palette is exact" a property
 * of this file rather than of the input.
 */
class Interner {
  readonly rgb: RGB[] = [];
  private readonly at = new Map<number, number>();
  /** `wash` is 0 for none and band+1 otherwise; 255 means "already composited". */
  id(colour: RGB, wash: number, bands: readonly Colour[]): number {
    const key = colour * 256 + wash;
    const hit = this.at.get(key);
    if (hit !== undefined) return hit;
    const w = wash === 0 || wash === 255 ? null : bands[wash - 1];
    const final = w === null ? colour : over(w.rgb, w.a, colour);
    const n = this.rgb.length;
    this.rgb.push(final);
    this.at.set(key, n);
    return n;
  }
}

interface Plan {
  w: number;
  h: number;
  scale: number;
  /** Colour id per pixel. */
  id: Uint16Array;
  /** Wash band per pixel: 0 for none, band+1 otherwise. */
  wash: Uint8Array;
  bands: Colour[];
  seamPx: number;
  weldPx: number;
  /** What fraction of a pixel the document's hairline really covers, ≤ 1. */
  thin: number;
  shown: readonly number[];
  ink: Interner;
}

/**
 * The pixel grid, the wash mask under it, and the geometry scale.
 *
 * The wash is rasterised ONCE into its own byte per pixel, because it is
 * static: the plate's curvature is a property of the figure and not of the
 * order it was drawn in, which is the same reason `animatedSvg` puts it outside
 * the animation. Everything drawn afterwards costs one table lookup to
 * composite rather than a blend per pixel.
 */
function plan(spec: GifSpec, ink: Interner): Plan {
  const scale = spec.width / spec.viewWidth;
  const h = Math.max(1, Math.round(spec.viewHeight * scale));
  const w = Math.max(1, Math.round(spec.width));
  const p: Plan = {
    w,
    h,
    scale,
    id: new Uint16Array(w * h),
    wash: new Uint8Array(w * h),
    bands: [],
    // A hairline is under a pixel at every size this exports at, and a seam
    // that rounds to zero is a grid that disappears. One pixel is the floor.
    seamPx: Math.max(1, spec.seamWidth * scale),
    weldPx: Math.max(1, spec.seamWidth * 3 * scale),
    shown: spec.shown ?? spec.cells.map((_, i) => i),
    // A hairline is a FRACTION of a pixel, and a rasteriser with no coverage
    // cannot draw a fraction of a pixel wide. Drawn at one pixel it comes out
    // heavier than the document's — measured side by side against the animated
    // SVG at 512 px, where the seam is 0.34 of a pixel and the GIF's grid read
    // three times as strongly as the SVG's.
    //
    // So the coverage moves out of the WIDTH and into the ALPHA: one pixel
    // wide at a third of the opacity puts the same ink on the plate. It costs
    // no colour at all, because a seam over a fill is one entry whatever the
    // alpha is — which is exactly why this is affordable here and antialiasing
    // is not.
    thin: Math.min(1, spec.seamWidth * scale),
    ink,
  };
  // 254 bands is far past the relief's few dozen; past it the extra bands are
  // dropped rather than aliased onto another band's colour.
  for (const g of spec.overlay ?? []) {
    if (p.bands.length >= 254) break;
    const c = parseColour(g.fill);
    if (c === null || g.opacity <= 0) continue;
    p.bands.push({ rgb: c.rgb, a: Math.min(1, c.a * g.opacity) });
    const mark = p.bands.length;
    for (const shape of g.shapes) {
      scanBytes(p, shape.map((v) => [v[0] * scale, v[1] * scale]), mark);
    }
  }
  return p;
}

/**
 * A polygon filled at pixel centres, by scanline, into the colour buffer.
 *
 * Crossings are collected per row and filled in pairs — the even-odd rule,
 * right for every shape this program draws: triangles, and the quads the seam
 * is made of. NO COVERAGE and no partial pixels: a pixel is inside or it is
 * not. That is the whole reason the palette can be exact.
 *
 * `band` restricts the write to pixels whose wash band matches, which is how a
 * cell straddling two bands gets both of its colours. `null` writes everywhere
 * and is the fast path a drawing without relief takes.
 */
function scan(
  p: Plan,
  verts: readonly (readonly [number, number])[],
  id: number,
  band: number | null,
  dirty: Bounds | null
): void {
  const n = verts.length;
  if (n < 3) return;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const v of verts) {
    if (v[1] < minY) minY = v[1];
    if (v[1] > maxY) maxY = v[1];
  }
  let y0 = Math.max(0, Math.ceil(minY - 0.5));
  let y1 = Math.min(p.h - 1, Math.floor(maxY - 0.5));
  if (y0 > y1) {
    // A shape thinner than a scanline still has to leave a mark, or a hairline
    // seam vanishes at small output sizes. It takes the row its centre falls
    // in, which is the row a one-pixel-high box would have taken.
    const mid = Math.round((minY + maxY) / 2 - 0.5);
    if (mid < 0 || mid >= p.h) return;
    y0 = mid;
    y1 = mid;
  }
  const xs: number[] = [];
  for (let y = y0; y <= y1; y++) {
    const sy = y + 0.5;
    xs.length = 0;
    for (let i = 0; i < n; i++) {
      const a = verts[i];
      const b = verts[(i + 1) % n];
      if (a[1] === b[1]) continue;
      if (sy < Math.min(a[1], b[1]) || sy >= Math.max(a[1], b[1])) continue;
      xs.push(a[0] + ((sy - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
    if (xs.length < 2) continue;
    xs.sort((q, r) => q - r);
    const row = y * p.w;
    for (let k = 0; k + 1 < xs.length; k += 2) {
      let x0 = Math.ceil(xs[k] - 0.5);
      let x1 = Math.floor(xs[k + 1] - 0.5);
      if (x1 < x0) {
        const mid = Math.round((xs[k] + xs[k + 1]) / 2 - 0.5);
        x0 = mid;
        x1 = mid;
      }
      if (x0 < 0) x0 = 0;
      if (x1 > p.w - 1) x1 = p.w - 1;
      if (x1 < x0) continue;
      if (band === null) {
        p.id.fill(id, row + x0, row + x1 + 1);
        if (dirty !== null) grow(dirty, x0, y, x1, y);
        continue;
      }
      for (let x = x0; x <= x1; x++) {
        if (p.wash[row + x] !== band) continue;
        p.id[row + x] = id;
        if (dirty !== null) grow(dirty, x, y, x, y);
      }
    }
  }
}

/** The same scanline against the wash mask. Bytes, and no interner. */
function scanBytes(
  p: Plan,
  verts: readonly (readonly [number, number])[],
  value: number
): void {
  const n = verts.length;
  if (n < 3) return;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const v of verts) {
    if (v[1] < minY) minY = v[1];
    if (v[1] > maxY) maxY = v[1];
  }
  const y0 = Math.max(0, Math.ceil(minY - 0.5));
  const y1 = Math.min(p.h - 1, Math.floor(maxY - 0.5));
  const xs: number[] = [];
  for (let y = y0; y <= y1; y++) {
    const sy = y + 0.5;
    xs.length = 0;
    for (let i = 0; i < n; i++) {
      const a = verts[i];
      const b = verts[(i + 1) % n];
      if (a[1] === b[1]) continue;
      if (sy < Math.min(a[1], b[1]) || sy >= Math.max(a[1], b[1])) continue;
      xs.push(a[0] + ((sy - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
    if (xs.length < 2) continue;
    xs.sort((q, r) => q - r);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.ceil(xs[k] - 0.5));
      const x1 = Math.min(p.w - 1, Math.floor(xs[k + 1] - 0.5));
      if (x1 < x0) continue;
      p.wash.fill(value, y * p.w + x0, y * p.w + x1 + 1);
    }
  }
}

function grow(b: Bounds, x0: number, y0: number, x1: number, y1: number): void {
  if (x0 < b.x0) b.x0 = x0;
  if (y0 < b.y0) b.y0 = y0;
  if (x1 > b.x1) b.x1 = x1;
  if (y1 > b.y1) b.y1 = y1;
}

/** Which wash bands lie under a polygon. Usually one; never many. */
function bandsUnder(p: Plan, verts: readonly (readonly [number, number])[]): number[] {
  if (p.bands.length === 0) return [0];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const v of verts) {
    if (v[0] < minX) minX = v[0];
    if (v[0] > maxX) maxX = v[0];
    if (v[1] < minY) minY = v[1];
    if (v[1] > maxY) maxY = v[1];
  }
  const x0 = Math.max(0, Math.floor(minX));
  const x1 = Math.min(p.w - 1, Math.ceil(maxX));
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(p.h - 1, Math.ceil(maxY));
  const seen = new Set<number>();
  for (let y = y0; y <= y1; y++) {
    const row = y * p.w;
    for (let x = x0; x <= x1; x++) seen.add(p.wash[row + x]);
  }
  return seen.size === 0 ? [0] : [...seen];
}

/**
 * One cell: its fill, and its seam.
 *
 * The seam is a STROKE in the document and a stroke is not a fill, so it is
 * built as geometry rather than approximated: each edge becomes a rectangle of
 * the right width about the edge's own line and the corners are left to
 * overlap. Mitre joins would be the careful thing and would move a pixel nobody
 * can see at a hairline width; overlapping quads cost one extra fill per corner
 * and cannot open a gap.
 *
 * WHAT IS APPROXIMATED, said plainly: a translucent seam straddles the join, so
 * its outer half in the document composites over the NEIGHBOUR's fill. Here it
 * composites over this cell's fill on both sides. At a hairline that is a
 * fraction of a pixel of a colour a fraction of the way between two neighbours,
 * and buying it back would cost a colour per ordered pair of adjacent fills —
 * which is precisely the palette explosion this format cannot afford.
 */
function paintCell(
  p: Plan,
  cell: ArtCell,
  fill: RGB,
  seam: Colour | null,
  seamPx: number,
  dirty: Bounds | null
): void {
  const verts = cell.verts.map(
    (v) => [v[0] * p.scale, v[1] * p.scale] as [number, number]
  );
  const bands = bandsUnder(p, verts);
  const mask = p.bands.length === 0 ? null : 0;
  for (const g of bands) {
    scan(p, verts, p.ink.id(fill, g, p.bands), mask === null ? null : g, dirty);
  }
  if (seam === null) return;
  // The weld is the fill's own colour and is meant to be a solid third of a
  // cell edge, so it keeps its width and its opacity. Only a translucent seam
  // trades width for alpha — see `Plan.thin`.
  const seamed = over(seam.rgb, seam.a >= 1 ? 1 : seam.a * p.thin, fill);
  for (const g of bands) {
    const id = p.ink.id(seamed, g, p.bands);
    strokeRing(p, verts, seamPx, id, mask === null ? null : g, dirty);
  }
}

function strokeRing(
  p: Plan,
  verts: readonly (readonly [number, number])[],
  width: number,
  id: number,
  band: number | null,
  dirty: Bounds | null
): void {
  const half = width / 2;
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len === 0) continue;
    const nx = (-dy / len) * half;
    const ny = (dx / len) * half;
    scan(
      p,
      [
        [a[0] + nx, a[1] + ny],
        [b[0] + nx, b[1] + ny],
        [b[0] - nx, b[1] - ny],
        [a[0] - nx, a[1] - ny],
      ],
      id,
      band,
      dirty
    );
  }
}

/** The plate as the history began: background, tiling, ground paint. */
function paintGround(p: Plan, spec: GifSpec): void {
  const bg = parseColour(spec.background)?.rgb ?? 0x000000;
  const tile = spec.unpainted === null ? null : parseColour(spec.unpainted);
  const tileSeam = spec.tileSeam === null ? null : parseColour(spec.tileSeam);
  const weld = spec.weldPaint === true;
  const paintSeam = weld || spec.paintSeam === null ? null : parseColour(spec.paintSeam);

  // The plate itself takes no wash where no cell covers it, and the wash where
  // one does — the wash shapes ARE cells, so this is the document's own answer.
  // One id per band, looked up once: the alternative is an interner hit per
  // pixel, and at half a megapixel that is the slowest line in the file.
  const bgId = new Uint16Array(p.bands.length + 1);
  for (let g = 0; g <= p.bands.length; g++) bgId[g] = p.ink.id(bg, g, p.bands);
  for (let i = 0; i < p.id.length; i++) p.id[i] = bgId[p.wash[i]];

  if (tile !== null) {
    for (const i of p.shown) {
      if (spec.ground.has(i) || spec.cells[i] === undefined) continue;
      paintCell(p, spec.cells[i], tile.rgb, tileSeam, p.seamPx, null);
    }
  }
  for (const i of p.shown) {
    const c = spec.ground.get(i);
    if (c === undefined || spec.cells[i] === undefined) continue;
    const rgb = parseColour(c);
    if (rgb === null) continue;
    paintCell(
      p,
      spec.cells[i],
      rgb.rgb,
      weld ? { rgb: rgb.rgb, a: 1 } : paintSeam,
      weld ? p.weldPx : p.seamPx,
      null
    );
  }
}

/** One gesture, drawn over whatever was there. Returns the pixels it moved. */
function paintStep(p: Plan, spec: GifSpec, step: AnimationStep, dirty: Bounds | null): void {
  const weld = spec.weldPaint === true;
  const paintSeam = weld || spec.paintSeam === null ? null : parseColour(spec.paintSeam);
  for (const g of step.groups) {
    g.cells.forEach((i, n) => {
      const cell = spec.cells[i];
      if (cell === undefined) return;
      const c = parseColour(g.fills[n]);
      if (c === null) return;
      paintCell(
        p,
        cell,
        c.rgb,
        weld ? { rgb: c.rgb, a: 1 } : paintSeam,
        weld ? p.weldPx : p.seamPx,
        dirty
      );
    });
  }
}

// ── the export ───────────────────────────────────────────────────────────

/**
 * The whole export, as a generator that yields between gestures.
 *
 * A generator rather than a worker, and that is a CSP decision as much as an
 * ergonomic one: a blob worker needs `worker-src blob:`, which this app does
 * not grant, and a bundled worker is a second entry point to audit. Yielding
 * between gestures gives the caller somewhere to hand the main thread back and
 * to move a progress indicator, and it keeps every line of this file testable
 * in Node.
 *
 * TWO passes over the same geometry. The first discovers the colours — it has
 * to, because a pixel's colour depends on the wash band under it and the bands
 * are geometry rather than a table. The second re-runs the identical walk
 * against a palette that is now fixed, and emits. Two passes over a few
 * thousand small triangles is cheaper than holding every frame's pixels alive
 * to decide later, and it is the reason peak memory is two rasters and not N.
 */
export function* gifSteps(spec: GifSpec): Generator<GifProgress, GifResult> {
  const steps = spec.steps;
  const total = Math.max(1, steps.length * 2);
  let done = 0;

  const ink = new Interner();

  // ── pass one: which colours does this drawing actually contain ──
  const first = plan(spec, ink);
  const counts = new Map<RGB, number>();
  // Counted by ID first and folded into colours afterwards, because a Map
  // lookup per pixel is half a million of them and a typed-array bump is not.
  const tally = (p: Plan): void => {
    const byId = new Int32Array(p.ink.rgb.length);
    for (const id of p.id) byId[id] += 1;
    for (let id = 0; id < byId.length; id++) {
      if (byId[id] === 0) continue;
      const c = p.ink.rgb[id];
      counts.set(c, (counts.get(c) ?? 0) + byId[id]);
    }
  };
  paintGround(first, spec);
  tally(first);
  for (const step of steps) {
    paintStep(first, spec, step, null);
    done += 1;
    yield { done, total };
  }
  tally(first);
  const palette = buildPalette(counts);

  // ── pass two: the frames ──
  const p = plan(spec, ink);
  paintGround(p, spec);
  const at = (id: number): number => palette.index.get(ink.rgb[id]) ?? 0;

  const bits = Math.max(2, Math.ceil(Math.log2(Math.max(2, palette.colours.length + 1))));
  const tableSize = 1 << bits;
  const transparent = palette.colours.length;

  const out = new ByteSink();
  writeHeader(out, p.w, p.h, palette.colours, tableSize);

  const delays = frameDelays(steps.length, spec.stepMs, spec.holdMs);
  const shown = new Uint8Array(p.w * p.h);

  for (let k = 0; k < steps.length; k++) {
    const dirty = emptyBounds();
    paintStep(p, spec, steps[k], dirty);
    if (k === 0) {
      // Frame 0 is the plate with the FIRST gesture already on it, because that
      // is what the animated SVG shows at t = 0: reveal 0 is lit from the first
      // beat. A GIF that opened on the empty plate would be one beat longer
      // than the SVG written from the same drawing.
      for (let i = 0; i < shown.length; i++) shown[i] = at(p.id[i]);
      writeFrame(out, 0, 0, p.w, p.h, shown, bits, delays[k], -1);
    } else if (dirty.x1 >= dirty.x0) {
      const bw = dirty.x1 - dirty.x0 + 1;
      const bh = dirty.y1 - dirty.y0 + 1;
      const box = new Uint8Array(bw * bh);
      for (let y = 0; y < bh; y++) {
        const src = (dirty.y0 + y) * p.w + dirty.x0;
        const dst = y * bw;
        for (let x = 0; x < bw; x++) {
          const now = at(p.id[src + x]);
          if (now === shown[src + x]) {
            box[dst + x] = transparent;
          } else {
            box[dst + x] = now;
            shown[src + x] = now;
          }
        }
      }
      writeFrame(out, dirty.x0, dirty.y0, bw, bh, box, bits, delays[k], transparent);
    } else {
      // A gesture too small to move a pixel at this size still owes the cycle
      // its beat, or the GIF would run short of the SVG. One transparent pixel.
      writeFrame(out, 0, 0, 1, 1, Uint8Array.of(transparent), bits, delays[k], transparent);
    }
    done += 1;
    yield { done, total };
  }

  out.byte(0x3b);
  return {
    bytes: out.take(),
    width: p.w,
    height: p.h,
    frames: steps.length,
    palette: palette.colours.length,
    exact: palette.exact,
    distinct: palette.distinct,
    cycleMs: steps.length * spec.stepMs + spec.holdMs,
  };
}

/** The whole export, run to completion. */
export function encodeGif(spec: GifSpec): GifResult {
  const it = gifSteps(spec);
  let r = it.next();
  while (r.done !== true) r = it.next();
  return r.value;
}

// ── GIF89a ───────────────────────────────────────────────────────────────

class ByteSink {
  private buf: Uint8Array<ArrayBuffer> = new Uint8Array(1 << 16);
  private n = 0;
  private room(k: number): void {
    if (this.n + k <= this.buf.length) return;
    let cap = this.buf.length;
    while (cap < this.n + k) cap *= 2;
    const next: Uint8Array<ArrayBuffer> = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.n));
    this.buf = next;
  }
  byte(b: number): void {
    this.room(1);
    this.buf[this.n++] = b & 255;
  }
  short(v: number): void {
    this.room(2);
    this.buf[this.n++] = v & 255;
    this.buf[this.n++] = (v >> 8) & 255;
  }
  bytes(b: Uint8Array): void {
    this.room(b.length);
    this.buf.set(b, this.n);
    this.n += b.length;
  }
  ascii(s: string): void {
    for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i));
  }
  take(): Uint8Array<ArrayBuffer> {
    return this.buf.slice(0, this.n) as Uint8Array<ArrayBuffer>;
  }
}

function writeHeader(
  out: ByteSink,
  w: number,
  h: number,
  colours: readonly RGB[],
  tableSize: number
): void {
  out.ascii("GIF89a");
  out.short(w);
  out.short(h);
  // Global table present, eight bits of colour resolution, unsorted, size code.
  out.byte(0x80 | 0x70 | (Math.log2(tableSize) - 1));
  out.byte(0);
  out.byte(0);
  for (let i = 0; i < tableSize; i++) {
    const c = i < colours.length ? colours[i] : 0;
    out.byte((c >> 16) & 255);
    out.byte((c >> 8) & 255);
    out.byte(c & 255);
  }
  // NETSCAPE2.0, loop count zero: forever. The one extension every decoder has.
  out.byte(0x21);
  out.byte(0xff);
  out.byte(11);
  out.ascii("NETSCAPE2.0");
  out.byte(3);
  out.byte(1);
  out.short(0);
  out.byte(0);
}

function writeFrame(
  out: ByteSink,
  x: number,
  y: number,
  w: number,
  h: number,
  pixels: Uint8Array,
  bits: number,
  delayCs: number,
  transparent: number
): void {
  out.byte(0x21);
  out.byte(0xf9);
  out.byte(4);
  // Disposal 1 — leave the frame where it is. That is what makes a difference
  // frame legal: the next one is drawn ON TOP, which is exactly the additive
  // reveal the animation already is.
  out.byte((1 << 2) | (transparent >= 0 ? 1 : 0));
  out.short(delayCs);
  out.byte(transparent >= 0 ? transparent : 0);
  out.byte(0);

  out.byte(0x2c);
  out.short(x);
  out.short(y);
  out.short(w);
  out.short(h);
  out.byte(0);
  lzw(out, pixels, bits);
}

/**
 * GIF's LZW, as the spec states it.
 *
 * Codes widen from `min + 1` to twelve bits, a clear code goes out at the start
 * and whenever the table fills, and the codes are packed LSB-first into
 * sub-blocks of at most 255 bytes. The dictionary is a flat `Map` keyed by
 * `prefix · 256 + byte`, which is the only line with a choice in it: a trie of
 * objects allocates a node per string and this does not.
 */
function lzw(out: ByteSink, pixels: Uint8Array, minCodeSize: number): void {
  out.byte(minCodeSize);
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let dict = new Map<number, number>();
  let next = eoi + 1;
  let width = minCodeSize + 1;

  let acc = 0;
  let bits = 0;
  let block: number[] = [];
  const flush = (): void => {
    if (block.length === 0) return;
    out.byte(block.length);
    out.bytes(Uint8Array.from(block));
    block = [];
  };
  const emit = (code: number): void => {
    acc |= code << bits;
    bits += width;
    while (bits >= 8) {
      block.push(acc & 255);
      acc >>>= 8;
      bits -= 8;
      if (block.length === 255) flush();
    }
  };

  emit(clear);
  if (pixels.length > 0) {
    let prefix = pixels[0];
    for (let i = 1; i < pixels.length; i++) {
      const k = pixels[i];
      const key = prefix * 4096 + k;
      const hit = dict.get(key);
      if (hit !== undefined) {
        prefix = hit;
        continue;
      }
      emit(prefix);
      if (next === 4096) {
        emit(clear);
        dict = new Map();
        next = eoi + 1;
        width = minCodeSize + 1;
      } else {
        dict.set(key, next);
        if (next === 1 << width && width < 12) width += 1;
        next += 1;
      }
      prefix = k;
    }
    emit(prefix);
  }
  emit(eoi);
  if (bits > 0) block.push(acc & 255);
  flush();
  out.byte(0);
}
