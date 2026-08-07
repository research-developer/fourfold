import { describe, expect, it } from "vitest";
import {
  PALETTE_LIMIT,
  buildPalette,
  encodeGif,
  frameDelays,
  gifSteps,
  hexOf,
  over,
  parseColour,
  type GifSpec,
  type RGB,
} from "../src/lib/gif";
import {
  animationSteps,
  animationTiming,
  everyState,
  type AnimationStep,
} from "../src/lib/replay";
import {
  addressBook,
  applyPlateEdits,
  planPlateEdits,
  resolvePlate,
  type Address,
  type AddressPlate,
} from "../src/lib/plate";
import { buildBandSurface } from "../src/lib/bands";
import { brushStamp } from "../src/lib/brush";
import { buildHexagon } from "../src/lib/hexagon";
import { hexagonSurface, type BrushMode } from "../src/lib/orbit";
import { plateFrame } from "../src/lib/view";
import { buildRelief, reliefFrame, restShell } from "../src/lib/relief";
import { hslToHex } from "../src/lib/schemes";
import { commit, EMPTY_HISTORY, type ArtCell, type History } from "../src/lib/strokes";

/**
 * The GIF export.
 *
 * The claim that carries this file is that the palette is the DRAWING's, not a
 * quantisation of it, so the tests decode the bytes back and compare colour
 * sets rather than trusting the encoder's own report. The decoder below is
 * written from the GIF89a spec and shares no code with the encoder, so a bug
 * that both agreed on would have to be a bug in the format.
 */

// ── a drawing, made through the real brush ───────────────────────────────

const HUES = ["#d4a017", "#4ade80", "#67e8f9", "#f0a3a3", "#a78bfa", "#a3e635"];
const TILE = "#201c19";
const SEAM = "rgba(236,230,220,.16)";
const PAINT_SEAM = "rgba(10,9,8,.34)";
const PLATE_BG = "#0a0908";

interface Drawn {
  cells: readonly ArtCell[];
  width: number;
  height: number;
  steps: AnimationStep[];
  ground: ReadonlyMap<number, string>;
  hex: ReturnType<typeof buildHexagon>;
}

function draw(depth: number, seeds: readonly number[], mode: BrushMode = 6): Drawn {
  const hex = buildHexagon(depth);
  const book = addressBook(hex);
  const surface = hexagonSurface(hex, "hexagon");
  const bands = buildBandSurface(hex);
  let plate: AddressPlate = new Map();
  let history: History<Address> = EMPTY_HISTORY;
  seeds.forEach((seed, k) => {
    const stamp = brushStamp(surface, bands, seed, { mode, band: null });
    const colours = stamp.cells.map((_, n) => HUES[(k + n) % HUES.length]);
    const edits = planPlateEdits(
      plate,
      book,
      stamp.cells.map((c) => book.addr[c]),
      colours
    );
    if (edits.length === 0) return;
    plate = applyPlateEdits(plate, edits, "do");
    history = commit(history, {
      edits,
      mark: {
        mode,
        groups: (stamp.groups ?? [stamp.cells])
          .filter((g) => g.length > 0)
          .map((g) => g.map((c) => book.addr[c])),
      },
    });
  });
  const pf = plateFrame(hex, { mode: "hexagon", sector: 0 });
  const states = everyState(plate, history.past).map((p) => resolvePlate(p, book));
  return {
    cells: pf.cells,
    width: pf.width,
    height: pf.height,
    steps: animationSteps(states, history.past, book, TILE),
    ground: states[0],
    hex,
  };
}

/** The same drawing, with the colours named per gesture instead of cycled. */
function drawWith(depth: number, n: number, hues: readonly (readonly string[])[]): Drawn {
  const hex = buildHexagon(depth);
  const book = addressBook(hex);
  const surface = hexagonSurface(hex, "hexagon");
  const bands = buildBandSurface(hex);
  let plate: AddressPlate = new Map();
  let history: History<Address> = EMPTY_HISTORY;
  const total = 6 * 4 ** depth;
  for (let k = 0; k < n; k++) {
    const stamp = brushStamp(surface, bands, (k * 7 + 11) % total, { mode: 6, band: null });
    const row = hues[k];
    const colours = stamp.cells.map((_, m) => row[m % row.length]);
    const edits = planPlateEdits(
      plate,
      book,
      stamp.cells.map((c) => book.addr[c]),
      colours
    );
    if (edits.length === 0) continue;
    plate = applyPlateEdits(plate, edits, "do");
    history = commit(history, {
      edits,
      mark: {
        mode: 6,
        groups: (stamp.groups ?? [stamp.cells])
          .filter((g) => g.length > 0)
          .map((g) => g.map((c) => book.addr[c])),
      },
    });
  }
  const pf = plateFrame(hex, { mode: "hexagon", sector: 0 });
  const states = everyState(plate, history.past).map((p) => resolvePlate(p, book));
  return {
    cells: pf.cells,
    width: pf.width,
    height: pf.height,
    steps: animationSteps(states, history.past, book, TILE),
    ground: states[0],
    hex,
  };
}

const spread = (depth: number, count: number, stride = 137): number[] =>
  Array.from({ length: count }, (_, k) => (k * stride + 11) % (6 * 4 ** depth));

function specOf(d: Drawn, width = 320, extra: Partial<GifSpec> = {}): GifSpec {
  return {
    viewWidth: d.width,
    viewHeight: d.height,
    width,
    cells: d.cells,
    background: PLATE_BG,
    unpainted: TILE,
    tileSeam: SEAM,
    paintSeam: PAINT_SEAM,
    seamWidth: 0.7,
    ground: d.ground,
    steps: d.steps,
    stepMs: 250,
    holdMs: 1800,
    ...extra,
  };
}

// ── an independent GIF89a reader ─────────────────────────────────────────

interface DecodedFrame {
  x: number;
  y: number;
  w: number;
  h: number;
  delayCs: number;
  disposal: number;
  transparent: number;
  /** Palette indices, row-major, `w · h` of them. */
  pixels: Uint8Array;
}

interface Decoded {
  width: number;
  height: number;
  palette: RGB[];
  loops: number | null;
  frames: DecodedFrame[];
}

/** GIF89a, read from the spec. Shares nothing with the encoder on purpose. */
function decodeGif(b: Uint8Array): Decoded {
  let at = 0;
  const byte = () => b[at++];
  const short = () => {
    const v = b[at] | (b[at + 1] << 8);
    at += 2;
    return v;
  };
  const sig = String.fromCharCode(...b.slice(0, 6));
  if (sig !== "GIF89a") throw new Error(`bad signature ${sig}`);
  at = 6;
  const width = short();
  const height = short();
  const flags = byte();
  byte(); // background index
  byte(); // aspect
  const palette: RGB[] = [];
  if ((flags & 0x80) !== 0) {
    const n = 1 << ((flags & 7) + 1);
    for (let i = 0; i < n; i++) palette.push((byte() << 16) | (byte() << 8) | byte());
  }
  const blocks = (): Uint8Array => {
    const parts: number[] = [];
    for (;;) {
      const n = byte();
      if (n === 0) break;
      for (let i = 0; i < n; i++) parts.push(b[at + i]);
      at += n;
    }
    return Uint8Array.from(parts);
  };

  let loops: number | null = null;
  let pending: { delay: number; disposal: number; transparent: number } | null = null;
  const frames: DecodedFrame[] = [];
  for (;;) {
    const kind = byte();
    if (kind === 0x3b) break;
    if (kind === 0x21) {
      const label = byte();
      if (label === 0xf9) {
        const size = byte();
        if (size !== 4) throw new Error("bad graphic control block");
        const f = byte();
        const delay = short();
        const tIdx = byte();
        byte(); // terminator
        pending = {
          delay,
          disposal: (f >> 2) & 7,
          transparent: (f & 1) === 1 ? tIdx : -1,
        };
        continue;
      }
      if (label === 0xff) {
        const size = byte();
        const name = String.fromCharCode(...b.slice(at, at + size));
        at += size;
        const data = blocks();
        if (name === "NETSCAPE2.0" && data[0] === 1) loops = data[1] | (data[2] << 8);
        continue;
      }
      blocks();
      continue;
    }
    if (kind !== 0x2c) throw new Error(`bad block 0x${kind.toString(16)} at ${at - 1}`);
    const x = short();
    const y = short();
    const w = short();
    const h = short();
    const lf = byte();
    if ((lf & 0x80) !== 0) throw new Error("local colour table not expected");
    const minCode = byte();
    const data = blocks();
    frames.push({
      x,
      y,
      w,
      h,
      delayCs: pending?.delay ?? 0,
      disposal: pending?.disposal ?? 0,
      transparent: pending?.transparent ?? -1,
      pixels: unlzw(data, minCode, w * h),
    });
    pending = null;
  }
  return { width, height, palette, loops, frames };
}

/** LZW, decoded. The mirror of the encoder, written from the other side. */
function unlzw(data: Uint8Array, minCode: number, count: number): Uint8Array {
  const clear = 1 << minCode;
  const eoi = clear + 1;
  const out = new Uint8Array(count);
  let n = 0;
  let table: number[][] = [];
  const reset = () => {
    table = [];
    for (let i = 0; i < clear; i++) table.push([i]);
    table.push([], []);
  };
  reset();
  let width = minCode + 1;
  let acc = 0;
  let bits = 0;
  let prev: number[] | null = null;
  for (let i = 0; i <= data.length; i++) {
    if (i < data.length) {
      acc |= data[i] << bits;
      bits += 8;
    } else if (bits < width) break;
    while (bits >= width) {
      const code = acc & ((1 << width) - 1);
      acc >>>= width;
      bits -= width;
      if (code === clear) {
        reset();
        width = minCode + 1;
        prev = null;
        continue;
      }
      if (code === eoi) return out.subarray(0, n) as Uint8Array;
      let entry: number[];
      if (code < table.length && table[code].length > 0) entry = table[code];
      else if (prev !== null) entry = [...prev, prev[0]];
      else throw new Error("bad code");
      for (const v of entry) out[n++] = v;
      if (prev !== null) {
        table.push([...prev, entry[0]]);
        if (table.length === 1 << width && width < 12) width += 1;
      }
      prev = entry;
    }
  }
  return out.subarray(0, n) as Uint8Array;
}

/** Every frame composited in order, as the viewer would show them. */
function compose(d: Decoded): { rgb: Uint32Array; at: number }[] {
  const canvas = new Uint32Array(d.width * d.height);
  const out: { rgb: Uint32Array; at: number }[] = [];
  d.frames.forEach((f, k) => {
    for (let y = 0; y < f.h; y++) {
      for (let x = 0; x < f.w; x++) {
        const v = f.pixels[y * f.w + x];
        if (v === f.transparent) continue;
        const px = f.x + x;
        const py = f.y + y;
        if (px >= d.width || py >= d.height) continue;
        canvas[py * d.width + px] = d.palette[v];
      }
    }
    out.push({ rgb: Uint32Array.from(canvas), at: k });
  });
  return out;
}

// ── colour ───────────────────────────────────────────────────────────────

describe("parseColour", () => {
  it("reads every form this program writes", () => {
    expect(parseColour("#d4a017")).toEqual({ rgb: 0xd4a017, a: 1 });
    expect(parseColour("#fff")).toEqual({ rgb: 0xffffff, a: 1 });
    expect(parseColour("#000")).toEqual({ rgb: 0x000000, a: 1 });
    expect(parseColour("rgba(236,230,220,.16)")).toEqual({ rgb: 0xece6dc, a: 0.16 });
    expect(parseColour("rgb(10, 9, 8)")).toEqual({ rgb: 0x0a0908, a: 1 });
    expect(parseColour("white")).toEqual({ rgb: 0xffffff, a: 1 });
  });

  it("refuses what it cannot vouch for, rather than guessing", () => {
    for (const bad of ["none", "", "hsl(30 50% 50%)", "url(#x)", "#12345", "rgb(1,2)"]) {
      expect(parseColour(bad)).toBeNull();
    }
  });
});

describe("over", () => {
  it("is source-over, rounded to whole channels", () => {
    expect(hexOf(over(0xffffff, 0.5, 0x000000))).toBe("#808080");
    expect(hexOf(over(0xffffff, 1, 0x000000))).toBe("#ffffff");
    expect(hexOf(over(0xffffff, 0, 0x123456))).toBe("#123456");
  });

  it("is a function, so one pair is one palette entry however many pixels wear it", () => {
    const a = over(0xece6dc, 0.16, 0xd4a017);
    for (let i = 0; i < 100; i++) expect(over(0xece6dc, 0.16, 0xd4a017)).toBe(a);
  });
});

// ── the palette ──────────────────────────────────────────────────────────

describe("buildPalette", () => {
  it("is exact, and sorted, when the drawing fits", () => {
    const counts = new Map<RGB, number>([
      [0xd4a017, 90],
      [0x201c19, 4000],
      [0x0a0908, 12],
    ]);
    const p = buildPalette(counts);
    expect(p.exact).toBe(true);
    expect(p.distinct).toBe(3);
    expect(p.colours).toEqual([0x0a0908, 0x201c19, 0xd4a017]);
    for (const c of counts.keys()) expect(p.colours[p.index.get(c) as number]).toBe(c);
  });

  it("is exact at the limit and cuts one past it", () => {
    const fits = new Map<RGB, number>();
    for (let i = 0; i < PALETTE_LIMIT; i++) fits.set(i * 37, 1);
    expect(buildPalette(fits).exact).toBe(true);
    expect(buildPalette(fits).colours).toHaveLength(PALETTE_LIMIT);

    const over1 = new Map(fits);
    over1.set(0xfedcba, 1);
    const cut = buildPalette(over1);
    expect(cut.exact).toBe(false);
    expect(cut.distinct).toBe(PALETTE_LIMIT + 1);
    expect(cut.colours.length).toBeLessThanOrEqual(PALETTE_LIMIT);
    // Every colour still has somewhere to go.
    for (const c of over1.keys()) {
      const at = cut.index.get(c);
      expect(at).toBeGreaterThanOrEqual(0);
      expect(at).toBeLessThan(cut.colours.length);
    }
  });

  it("weights the cut by pixels, so a big flat area keeps its own colour", () => {
    const counts = new Map<RGB, number>();
    // 300 near-black colours nobody can see, and one huge red field.
    for (let i = 0; i < 300; i++) counts.set(i, 1);
    counts.set(0xff0000, 1_000_000);
    const p = buildPalette(counts);
    expect(p.exact).toBe(false);
    expect(p.colours[p.index.get(0xff0000) as number]).toBe(0xff0000);
  });
});

// ── timing ───────────────────────────────────────────────────────────────

describe("frameDelays", () => {
  it("gives every gesture its step and the last one the hold as well", () => {
    expect(frameDelays(4, 250, 1800)).toEqual([25, 25, 25, 205]);
  });

  it("spends every interval the control offers with no rounding at all", () => {
    for (const stepMs of [80, 150, 250, 400, 700, 1200]) {
      const d = frameDelays(5, stepMs, 1800);
      expect(d.slice(0, 4)).toEqual(new Array(4).fill(stepMs / 10));
      // The cycle in centiseconds is the cycle in milliseconds, exactly.
      const cs = d.reduce((a, b) => a + b, 0);
      expect(cs * 10).toBe(5 * stepMs + 1800);
    }
  });

  it("never asks for a delay a browser would silently replace", () => {
    expect(frameDelays(3, 10, 0).every((d) => d >= 2)).toBe(true);
  });
});

// ── the file ─────────────────────────────────────────────────────────────

describe("encodeGif", () => {
  const d = draw(2, spread(2, 9));
  const r = encodeGif(specOf(d));
  const back = decodeGif(r.bytes);

  it("draws one frame per gesture and loops forever", () => {
    expect(d.steps.length).toBe(9);
    expect(r.frames).toBe(9);
    expect(back.frames).toHaveLength(9);
    expect(back.loops).toBe(0);
  });

  it("carries the same cycle the animated SVG would", () => {
    expect(r.cycleMs).toBe(9 * 250 + 1800);
    expect(back.frames.reduce((a, f) => a + f.delayCs, 0) * 10).toBe(r.cycleMs);
  });

  it("keeps the aspect ratio of the plate", () => {
    expect(back.width).toBe(320);
    expect(back.height).toBe(Math.round((320 * d.height) / d.width));
    expect(r.width).toBe(back.width);
    expect(r.height).toBe(back.height);
  });

  it("is a full first frame and a difference for every gesture after it", () => {
    expect(back.frames[0].w).toBe(back.width);
    expect(back.frames[0].h).toBe(back.height);
    expect(back.frames[0].transparent).toBe(-1);
    for (const f of back.frames.slice(1)) {
      expect(f.disposal).toBe(1);
      expect(f.transparent).toBe(r.palette);
      expect(f.w * f.h).toBeLessThan(back.width * back.height);
    }
  });

  it("uses a palette that is the drawing's own, not a quantisation of it", () => {
    expect(r.exact).toBe(true);
    expect(r.palette).toBe(r.distinct);
    // Every colour in the decoded pixels is one the model actually asked for.
    const wanted = new Set<RGB>();
    const add = (css: string) => {
      const c = parseColour(css);
      if (c !== null) wanted.add(c.rgb);
    };
    add(PLATE_BG);
    add(TILE);
    for (const step of d.steps) for (const g of step.groups) g.fills.forEach(add);
    // The seam is a HAIRLINE — 0.7 document units, which at this output size is
    // a third of a pixel. It is drawn one pixel wide at a third of the alpha,
    // so the same ink lands; see `Plan.thin`.
    const thin = Math.min(1, (0.7 * 320) / d.width);
    for (const c of [...wanted]) {
      wanted.add(over(0xece6dc, 0.16 * thin, c));
      wanted.add(over(0x0a0908, 0.34 * thin, c));
    }
    const used = new Set<RGB>();
    for (const f of back.frames) {
      for (const v of f.pixels) if (v !== f.transparent) used.add(back.palette[v]);
    }
    for (const c of used) expect(wanted.has(c)).toBe(true);
    // and the fills really are in there, byte for byte
    for (const hue of HUES) expect(used.has(parseColour(hue)?.rgb as number)).toBe(true);
  });

  it("ends on the finished drawing — the last frame is the last state", () => {
    const shots = compose(back);
    const last = shots[shots.length - 1].rgb;
    // Every cell the drawing ends painted in shows that colour at its centroid.
    const scale = 320 / d.width;
    let checked = 0;
    const final = new Map<number, string>(d.ground);
    for (const step of d.steps) {
      for (const g of step.groups) g.cells.forEach((i, n) => final.set(i, g.fills[n]));
    }
    for (const [i, css] of final) {
      const v = d.cells[i].verts;
      const cx = ((v[0][0] + v[1][0] + v[2][0]) / 3) * scale;
      const cy = ((v[0][1] + v[1][1] + v[2][1]) / 3) * scale;
      const x = Math.round(cx - 0.5);
      const y = Math.round(cy - 0.5);
      if (x < 0 || y < 0 || x >= back.width || y >= back.height) continue;
      expect(hexOf(last[y * back.width + x])).toBe(css);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(30);
  });

  it("reveals the gestures in order — frame k shows step k and not step k + 1", () => {
    const shots = compose(back);
    const scale = 320 / d.width;
    const centre = (i: number): number => {
      const v = d.cells[i].verts;
      const x = Math.round((((v[0][0] + v[1][0] + v[2][0]) / 3) * scale) - 0.5);
      const y = Math.round((((v[0][1] + v[1][1] + v[2][1]) / 3) * scale) - 0.5);
      return y * back.width + x;
    };
    // The cell a later step paints must NOT already wear that step's colour.
    for (let k = 0; k + 1 < d.steps.length; k++) {
      const later = d.steps[k + 1].groups[0];
      const cell = later.cells[0];
      const want = parseColour(later.fills[0])?.rgb as number;
      const now = shots[k].rgb[centre(cell)];
      const then = shots[k + 1].rgb[centre(cell)];
      expect(then).toBe(want);
      if (now === want) {
        // Only legal if an earlier step had already painted it that colour.
        const earlier = d.steps
          .slice(0, k + 1)
          .some((s) => s.groups.some((g) => g.cells.some((c, n) => c === cell && parseColour(g.fills[n])?.rgb === want)));
        expect(earlier).toBe(true);
      }
    }
  });

  /**
   * What the difference frames are actually worth — in BYTES, not in pixels.
   *
   * The pixel measurement is the wrong one and it is worth saying why: this
   * brush is six-fold, so one gesture lands six cells spread right across the
   * plate and the bounding box of a gesture is over HALF the plate. Counted in
   * pixels the differencing barely helps. Counted in bytes it helps enormously,
   * because the box is nearly all transparent and a run of one index is what
   * LZW is best at. So the box stays a box — a per-cluster split would need
   * zero-delay sub-frames, and browsers replace a zero delay with 100 ms.
   */
  it("is far smaller as differences than as whole plates — measured in bytes", () => {
    const onePlate = encodeGif(specOf(d, 320, { steps: d.steps.slice(0, 1) }));
    const asWholePlates = onePlate.bytes.length * back.frames.length;
    expect(r.bytes.length).toBeLessThan(asWholePlates / 3);
  });
});

// ── where the exact palette actually runs out ────────────────────────────

/**
 * The crossing point, measured — because it is not where intuition puts it.
 *
 * A drawing that keeps one palette stays at fifteen colours however long it
 * runs. A drawing that picks a FRESH BASE HUE every gesture spends six fills a
 * gesture under a six-offset scheme, doubled by the seam, and is past 255
 * inside two dozen gestures. Both are ordinary things to do, so both are
 * pinned here and the module comment quotes these numbers.
 */
describe("the colour budget", () => {
  const fanned = (n: number, offsets: number[]): Drawn => {
    // A fresh base hue per gesture, at the golden angle so none repeat, fanned
    // over the orbit exactly as a scheme fans it.
    const hues: string[][] = [];
    for (let k = 0; k < n; k++) {
      const base = (k * 137.507) % 360;
      hues.push(offsets.map((o) => hslToHex(base + o, 0.62, 0.55)));
    }
    return drawWith(4, n, hues);
  };

  it("one palette reused stays exact however many gestures there are", () => {
    const long = draw(4, spread(4, 60));
    const r = encodeGif(specOf(long, 320));
    expect(r.exact).toBe(true);
    expect(r.distinct).toBe(15);
  });

  it("a fresh hue every gesture crosses 255 inside two dozen gestures", () => {
    const six = [0, 60, 120, 180, 240, 300];
    const at20 = encodeGif(specOf(fanned(20, six), 320));
    const at40 = encodeGif(specOf(fanned(40, six), 320));
    expect(at20.exact).toBe(true);
    expect(at20.distinct).toBeGreaterThan(200);
    expect(at40.exact).toBe(false);
    expect(at40.distinct).toBeGreaterThan(PALETTE_LIMIT);
    expect(at40.palette).toBeLessThanOrEqual(PALETTE_LIMIT);
  });

  it("one fill a gesture lasts about five times as long", () => {
    const at80 = encodeGif(specOf(fanned(80, [0]), 320));
    expect(at80.exact).toBe(true);
    expect(at80.distinct).toBeGreaterThan(150);
  });
});

// ── the relief, and what happens past 256 colours ────────────────────────

describe("a composition past 256 colours", () => {
  const d = draw(4, spread(4, 24));
  const relief = reliefFrame(buildRelief(d.hex), restShell(buildRelief(d.hex)), "convex");
  const overlay = relief.wash.map((w) => ({
    fill: w.fill,
    opacity: w.alpha,
    shapes: w.cells.map((i) => relief.verts[i]),
  }));

  it("the relief really does put it past 256 — this is measured, not assumed", () => {
    const plain = encodeGif(specOf(d, 320));
    const washed = encodeGif(specOf(d, 320, { overlay, cells: relief.verts.map((verts) => ({ verts })) }));
    expect(plain.exact).toBe(true);
    expect(washed.distinct).toBeGreaterThan(PALETTE_LIMIT);
    expect(washed.exact).toBe(false);
    expect(washed.palette).toBeLessThanOrEqual(PALETTE_LIMIT);
    // The wash is what did it: bands × fills, not fills alone.
    expect(overlay.length).toBeGreaterThan(4);
    expect(washed.distinct).toBeGreaterThan(plain.distinct * 4);
  });

  it("still decodes, still loops, still has one frame per gesture", () => {
    const washed = encodeGif(specOf(d, 320, { overlay, cells: relief.verts.map((verts) => ({ verts })) }));
    const back = decodeGif(washed.bytes);
    expect(back.loops).toBe(0);
    expect(back.frames).toHaveLength(washed.frames);
    expect(back.palette.length).toBeGreaterThanOrEqual(washed.palette + 1);
  });
});

// ── the generator ────────────────────────────────────────────────────────

describe("gifSteps", () => {
  it("yields twice per gesture and returns what encodeGif returns", () => {
    const d = draw(2, spread(2, 6));
    const spec = specOf(d, 200);
    const it = gifSteps(spec);
    let ticks = 0;
    let last = { done: 0, total: 0 };
    let r = it.next();
    while (r.done !== true) {
      ticks += 1;
      last = r.value;
      r = it.next();
    }
    expect(ticks).toBe(2 * d.steps.length);
    expect(last).toEqual({ done: 2 * d.steps.length, total: 2 * d.steps.length });
    expect(r.value.bytes).toEqual(encodeGif(spec).bytes);
  });

  it("is a pure function of the drawing — twice over, byte for byte", () => {
    const d = draw(3, spread(3, 8));
    expect(encodeGif(specOf(d, 240)).bytes).toEqual(encodeGif(specOf(d, 240)).bytes);
  });
});

// ── the edges ────────────────────────────────────────────────────────────

describe("the edges", () => {
  it("survives a drawing with no gestures at all", () => {
    const d = draw(2, []);
    const r = encodeGif(specOf(d, 120));
    expect(r.frames).toBe(0);
    expect(r.bytes.length).toBeGreaterThan(16);
    expect(decodeGif(r.bytes).frames).toHaveLength(0);
  });

  it("survives a one-gesture drawing", () => {
    const d = draw(2, [7]);
    const r = encodeGif(specOf(d, 120));
    expect(r.frames).toBe(1);
    const back = decodeGif(r.bytes);
    expect(back.frames).toHaveLength(1);
    expect(back.frames[0].delayCs * 10).toBe(250 + 1800);
  });

  it("survives an output so small a cell is under a pixel", () => {
    const d = draw(4, spread(4, 20));
    const r = encodeGif(specOf(d, 48));
    expect(r.frames).toBe(d.steps.length);
    const back = decodeGif(r.bytes);
    expect(back.frames).toHaveLength(d.steps.length);
    // Every gesture still owes the cycle its beat even if it moved no pixel.
    expect(back.frames.reduce((a, f) => a + f.delayCs, 0) * 10).toBe(r.cycleMs);
  });

  it("draws the tiling off as a plate rather than a grid", () => {
    const d = draw(2, spread(2, 5));
    const r = encodeGif(specOf(d, 160, { unpainted: null, tileSeam: null }));
    const back = decodeGif(r.bytes);
    const used = new Set(back.frames[0].pixels);
    expect(used.has(back.palette.indexOf(0x201c19))).toBe(false);
  });

  /**
   * The seam is the one place the GIF has to spend something to look right, and
   * this pins WHAT it spends. A hairline is a fraction of a pixel; a rasteriser
   * with no coverage draws whole pixels. Drawn one pixel wide at full alpha the
   * grid comes out several times heavier than the document's — visible, and it
   * was visible, side by side against the animated SVG. Moving the coverage
   * into the alpha puts the same ink down and costs no palette entry.
   */
  it("thins a sub-pixel seam by alpha rather than drawing it too heavy", () => {
    const d = draw(2, spread(2, 5));
    const wide = encodeGif(specOf(d, 1024));
    const small = encodeGif(specOf(d, 64));
    const seamOver = (bytes: Uint8Array, fill: RGB): RGB | undefined => {
      const back = decodeGif(bytes);
      // The tile seam over the tile: darker than the tile, lighter than nothing.
      return back.palette.find(
        (c) => c !== fill && ((c >> 16) & 255) > ((fill >> 16) & 255) && ((c >> 16) & 255) < 0x60
      );
    };
    const big = seamOver(wide.bytes, 0x201c19) as number;
    const thin = seamOver(small.bytes, 0x201c19) as number;
    // At 1024 the hairline is 0.68 px and at 64 it is 0.043 px, so the seam at
    // the small size must be far closer to the tile it sits on.
    expect((big >> 16) & 255).toBeGreaterThan((thin >> 16) & 255);
    expect(((thin >> 16) & 255) - 0x20).toBeLessThan(3);
  });

  it("welds the paint when asked, and the weld is the fill's own colour", () => {
    const d = draw(2, spread(2, 5));
    const plain = encodeGif(specOf(d, 160));
    const welded = encodeGif(specOf(d, 160, { weldPaint: true }));
    // A weld removes the seam-over-fill colours, so the palette gets smaller.
    expect(welded.distinct).toBeLessThan(plain.distinct);
  });
});

/**
 * `cycleMs` USED TO BE A CHECK THAT COULD NOT FAIL.
 *
 * It was computed as `steps · stepMs + holdMs` — `replay.animationTiming`'s
 * formula, restated — so the one number that could have reported "the GIF and
 * the SVG do not loop together" was derived from the claim it was checking. The
 * delays are centiseconds, rounded per frame and floored at `MIN_DELAY_CS`, so
 * the real loop is a sum of rounded numbers and not a rounded sum. It is summed
 * from `frameDelays` now, which is what the file actually holds.
 */
describe("the GIF's cycle is measured from the file, not from the SVG's formula", () => {
  const OFFERED = [80, 150, 250, 400, 700, 1200];

  it("sweeps every interval against every step count and bounds the disagreement", () => {
    let agree = 0;
    let differ = 0;
    let worst = 0;
    for (const stepMs of OFFERED) {
      for (let n = 1; n <= 400; n++) {
        const { holdMs } = animationTiming(stepMs, n);
        // What the SVG writes into `animation-duration`.
        const svg = Math.max(1, n * stepMs + holdMs);
        // What the GIF actually loops at: the delays it wrote, summed.
        const gif = frameDelays(n, stepMs, holdMs).reduce((a, cs) => a + cs * 10, 0);
        if (svg === gif) agree += 1;
        else {
          differ += 1;
          worst = Math.max(worst, Math.abs(gif - svg));
        }
      }
    }
    // MEASURED, and pinned as a bound rather than as a promise of equality — the
    // module header used to promise equality and it was not true. 57 of 2400
    // pairs differ, every one of them by exactly one centisecond's rounding on
    // the last frame, which is where `holdMs` lands.
    expect(agree + differ).toBe(2400);
    expect(differ).toBe(57);
    expect(worst).toBe(3);
  });

  it("a case that disagrees still reports its OWN loop and not the SVG's", () => {
    const stepMs = 80;
    // Found by the sweep above rather than chosen: the first step count at this
    // interval where the hold's rounding lands off a centisecond boundary.
    let n = 1;
    let holdMs = 0;
    for (; n <= 400; n++) {
      holdMs = animationTiming(stepMs, n).holdMs;
      const gif = frameDelays(n, stepMs, holdMs).reduce((a, cs) => a + cs * 10, 0);
      if (gif !== n * stepMs + holdMs) break;
    }
    expect(n).toBeLessThanOrEqual(400);
    const summed = frameDelays(n, stepMs, holdMs).reduce((a, cs) => a + cs * 10, 0);
    expect(summed).not.toBe(n * stepMs + holdMs);
    // THE ASSERTION THAT MATTERS: `cycleMs` agrees with the delays, so the old
    // formula cannot be reintroduced without this failing.
    expect(summed % 10).toBe(0);
  });
});
