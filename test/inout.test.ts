import { describe, expect, it } from "vitest";
import {
  animatedSvg,
  animationSteps,
  animationTiming,
  boundAnimation,
  clampSpan,
  everyState,
  spanSteps,
  type AnimationSpec,
  type AnimationStep,
  type InOut,
} from "../src/lib/replay";
import { encodeGif, type GifSpec } from "../src/lib/gif";
import { parse, serialise, type EmitDoc, type EmitLayer } from "../src/lib/emit";
import { extractArt, ART_MARKER, ART_VERSION } from "../src/lib/artfile";
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
import {
  commit,
  EMPTY_HISTORY,
  type ArtCell,
  type History,
  type PaintMap,
} from "../src/lib/strokes";

/**
 * THE IN POINT AND THE OUT POINT.
 *
 * Two marks that say which part of a drawing the replay plays: everything
 * before the in point is already there when the loop starts, everything after
 * the out point is not shown at all.
 *
 * Three things are load-bearing and each is MEASURED here rather than argued
 * for. That the pair is closed and therefore cannot name an empty replay — the
 * degenerate table below is the whole of that claim. That cutting the front
 * needs no mechanism, because `AnimationSpec.ground` already means "there from
 * the first frame", so the fold is checked against the model's OWN state after
 * that gesture rather than against the folding code's idea of it. And that the
 * SVG and the GIF cannot disagree about the cut, which is checked by building
 * both from one `BoundedAnimation` and weighing the cycle each ended up with.
 */

// ── a drawing, made through the real brush ───────────────────────────────

const HUES = ["#d4a017", "#4ade80", "#67e8f9", "#f0a3a3", "#a78bfa", "#a3e635"];
const TILE = "#201c19";

interface Drawn {
  cells: readonly ArtCell[];
  width: number;
  height: number;
  /** The animation's own beats. */
  steps: AnimationStep[];
  /** The plate before the first gesture. */
  ground: PaintMap;
  /** Every state of the journal, oldest first. `states[k+1]` is after gesture k. */
  states: PaintMap[];
}

/**
 * A drawing whose gestures all land inside the frame, so step k IS gesture k.
 *
 * That equality is not assumed anywhere in the implementation — it is the whole
 * reason the marks index STEPS — but it is what lets these tests weigh a cut
 * animation against `everyState`, which is the journal's own answer and shares
 * no code with the cutting.
 */
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
    states,
  };
}

/**
 * The plate a document DRAWS after a ground and a run of steps.
 *
 * Painter's algorithm, which is what the file is: every step lays its cells over
 * whatever was there. Written here so the tests can ask what a frame looks like
 * without going through either encoder.
 */
function surfaceOf(ground: PaintMap, steps: readonly AnimationStep[]): PaintMap {
  const out = new Map(ground);
  for (const s of steps) {
    for (const g of s.groups) g.cells.forEach((i, n) => out.set(i, g.fills[n]));
  }
  return out;
}

const specOf = (d: Drawn, ground: PaintMap, steps: readonly AnimationStep[]): AnimationSpec => ({
  width: d.width,
  height: d.height,
  cells: d.cells,
  background: "#0a0908",
  unpainted: TILE,
  tileSeam: "rgba(236,230,220,.16)",
  paintSeam: "rgba(10,9,8,.34)",
  seamWidth: 0.6,
  title: "FOURFOLD replay",
  ground,
  steps,
  stepMs: 250,
  ...animationTiming(250, steps.length),
  grouping: "orbit",
});

const gifSpecOf = (d: Drawn, ground: PaintMap, steps: readonly AnimationStep[]): GifSpec => ({
  viewWidth: d.width,
  viewHeight: d.height,
  width: 160,
  cells: d.cells,
  background: "#0a0908",
  unpainted: TILE,
  tileSeam: "rgba(236,230,220,.16)",
  paintSeam: "rgba(10,9,8,.34)",
  seamWidth: 0.6,
  ground,
  steps,
  stepMs: 250,
  holdMs: animationTiming(250, steps.length).holdMs,
});

// ── the marks themselves ─────────────────────────────────────────────────

describe("clampSpan", () => {
  it("names the whole replay when there are no marks", () => {
    expect(clampSpan(undefined, 6)).toEqual({ in: 0, out: 5 });
    expect(clampSpan(null, 6)).toEqual({ in: 0, out: 5 });
  });

  it("is CLOSED: both ends play, so the count is out - in + 1", () => {
    expect(spanSteps(clampSpan({ in: 3, out: 7 }, 20))).toBe(5);
    expect(spanSteps(clampSpan(undefined, 6))).toBe(6);
    expect(spanSteps(null)).toBe(0);
  });

  /**
   * THE DEGENERATE TABLE. Every one of these is a clamp rather than a refusal,
   * because this is the end of the feature a slider is wired to; the payload
   * end refuses the same shapes outright, and that block is below.
   */
  it("clamps every degenerate pair to something that names at least one step", () => {
    const table: [InOut | null | undefined, number, InOut | null][] = [
      // in == out — ONE step, and not an empty replay. That is the whole
      // argument for the closed pair: the empty case is unrepresentable.
      [{ in: 4, out: 4 }, 10, { in: 4, out: 4 }],
      // in > out — the OUT point is pulled back, so the first frame the fold
      // produces is still the one the author asked for.
      [{ in: 7, out: 2 }, 10, { in: 7, out: 7 }],
      // Out of range, both directions.
      [{ in: -5, out: 99 }, 10, { in: 0, out: 9 }],
      [{ in: 99, out: 99 }, 10, { in: 9, out: 9 }],
      [{ in: -5, out: -5 }, 10, { in: 0, out: 0 }],
      // In at 0 and out at the LAST step — the whole replay, spelled out.
      [{ in: 0, out: 9 }, 10, { in: 0, out: 9 }],
      // A single-step drawing has exactly one legal span whatever is asked for.
      [{ in: 3, out: 8 }, 1, { in: 0, out: 0 }],
      [undefined, 1, { in: 0, out: 0 }],
      // NO steps: no span exists. `null` rather than an invented empty pair,
      // so a caller cannot spread it into a spec and get a file with no frames.
      [{ in: 0, out: 0 }, 0, null],
      [undefined, 0, null],
      [undefined, -3, null],
      // Not numbers at all: each mark falls back to its OWN end of the track,
      // which is `clampIndex`'s rule for the same problem.
      [{ in: Number.NaN, out: Number.NaN }, 10, { in: 0, out: 9 }],
      [{ in: Number.NaN, out: 4 }, 10, { in: 0, out: 4 }],
      [{ in: 4, out: Number.NaN }, 10, { in: 4, out: 9 }],
      [{ in: Number.POSITIVE_INFINITY, out: 2 }, 10, { in: 0, out: 2 }],
      // Fractions round; they do not truncate toward the start.
      [{ in: 2.6, out: 5.4 }, 10, { in: 3, out: 5 }],
    ];
    for (const [span, steps, want] of table) {
      expect(clampSpan(span, steps), JSON.stringify({ span, steps })).toEqual(want);
    }
  });
});

// ── the cut ──────────────────────────────────────────────────────────────

describe("boundAnimation", () => {
  const d = draw(2, [5, 9, 21, 33, 41, 57]);

  it("has six steps to work with, one per gesture", () => {
    expect(d.steps).toHaveLength(6);
    expect(d.states).toHaveLength(7);
  });

  it("plays everything, and copies the ground, when there are no marks", () => {
    const b = boundAnimation(d.ground, d.steps);
    expect(b.steps).toHaveLength(6);
    expect(b.span).toEqual({ in: 0, out: 5 });
    expect(b.folded).toBe(0);
    expect(b.dropped).toBe(0);
    expect(b.ground).not.toBe(d.ground);
    expect([...b.ground.entries()]).toEqual([...d.ground.entries()]);
  });

  it("counts what it folded and what it dropped", () => {
    const b = boundAnimation(d.ground, d.steps, { in: 2, out: 3 });
    expect(b.steps).toHaveLength(2);
    expect(b.folded).toBe(2);
    expect(b.dropped).toBe(2);
    expect(spanSteps(b.span)).toBe(b.steps.length);
  });

  /**
   * THE IN POINT AGAINST THE JOURNAL, not against the folding code.
   *
   * `everyState` walks the recorded edits and knows nothing about animations,
   * so a ground that matches `states[in]` is a ground that matches the drawing
   * rather than one that matches the loop that built it.
   */
  it("folds the prefix into a ground that IS the plate at the in point", () => {
    for (const from of [0, 1, 3, 5]) {
      const b = boundAnimation(d.ground, d.steps, { in: from, out: 5 });
      expect([...b.ground.entries()].sort((a, c) => a[0] - c[0])).toEqual(
        [...d.states[from].entries()].sort((a, c) => a[0] - c[0])
      );
    }
  });

  it("does not touch the ground it was handed", () => {
    const before = [...d.ground.entries()];
    boundAnimation(d.ground, d.steps, { in: 4, out: 5 });
    expect([...d.ground.entries()]).toEqual(before);
  });

  /**
   * A REPAINT INSIDE THE FOLDED PREFIX has to land on the colour it ended on.
   * Applying the prefix as a set, or in any order but this one, would fold the
   * first colour over the second and start the replay on a plate the drawing
   * never had.
   */
  it("folds a repaint to the colour it ended on, not the one it started at", () => {
    const r = draw(2, [5, 5, 21]);
    expect(r.steps).toHaveLength(3);
    const b = boundAnimation(r.ground, r.steps, { in: 2, out: 2 });
    const repainted = r.steps[1].groups[0];
    for (let n = 0; n < repainted.cells.length; n++) {
      expect(b.ground.get(repainted.cells[n])).toBe(repainted.fills[n]);
    }
    // And it is the SECOND gesture's colour, so the assertion above is not
    // satisfied by the first one having been left in place.
    const first = r.steps[0].groups[0];
    expect(repainted.fills[0]).not.toBe(first.fills[0]);
  });

  /**
   * THE FINAL-FRAME INVARIANT, RETARGETED.
   *
   * `animationSteps` promises that the last group to name a cell is the last
   * gesture that touched it, so the final frame is the final state. Truncation
   * does not break it — the property is local to the list — it moves it: the
   * final frame becomes the state at the OUT POINT. Measured against the
   * journal again, not against `surfaceOf`.
   */
  it("ends on the plate at the out point, not on the finished drawing", () => {
    for (const [from, to] of [
      [0, 0],
      [0, 3],
      [2, 4],
      [4, 5],
      [1, 1],
    ]) {
      const b = boundAnimation(d.ground, d.steps, { in: from, out: to });
      const last = surfaceOf(b.ground, b.steps);
      expect([...last.entries()].sort((a, c) => a[0] - c[0])).toEqual(
        [...d.states[to + 1].entries()].sort((a, c) => a[0] - c[0])
      );
      // And it is NOT the finished drawing, except where the cut is the whole
      // drawing — otherwise this test would pass on an implementation that
      // ignored the out point entirely.
      if (to < 5) {
        expect([...last.entries()]).not.toEqual([...d.states[6].entries()]);
      }
    }
  });

  it("survives a single-gesture drawing and a drawing with none", () => {
    const one = draw(2, [7]);
    expect(one.steps).toHaveLength(1);
    const b = boundAnimation(one.ground, one.steps, { in: 9, out: 9 });
    expect(b.span).toEqual({ in: 0, out: 0 });
    expect(b.steps).toHaveLength(1);

    const none = draw(2, []);
    expect(none.steps).toHaveLength(0);
    const e = boundAnimation(none.ground, none.steps, { in: 0, out: 0 });
    expect(e.span).toBeNull();
    expect(e.steps).toHaveLength(0);
    expect(e.folded).toBe(0);
    expect(e.dropped).toBe(0);
  });

  /**
   * An ERASE folded into the ground wears the TILE COLOUR rather than being
   * absent, because that is what the animation draws — nothing is ever removed
   * from the document. The pixels agree; the map does not, and saying so here
   * is cheaper than a reader discovering it from a diff.
   */
  it("folds an erase as the unpainted fill, which is what the document draws", () => {
    const hex = buildHexagon(2);
    const book = addressBook(hex);
    const surface = hexagonSurface(hex, "hexagon");
    const bands = buildBandSurface(hex);
    const stamp = brushStamp(surface, bands, 5, { mode: 6, band: null });
    const addrs = stamp.cells.map((c) => book.addr[c]);
    const lay = planPlateEdits(new Map(), book, addrs, stamp.cells.map(() => "#d4a017"));
    const one = applyPlateEdits(new Map<Address, string>(), lay, "do");
    const wipe = planPlateEdits(one, book, addrs, stamp.cells.map(() => null));
    const two = applyPlateEdits(one, wipe, "do");
    const history: History<Address> = { past: [{ edits: lay }, { edits: wipe }], future: [] };
    const states = everyState(two, history.past).map((p) => resolvePlate(p, book));
    const steps = animationSteps(states, history.past, book, TILE);
    const b = boundAnimation(states[0], steps, { in: 2, out: 2 });
    expect(b.span).toEqual({ in: 1, out: 1 });
    // Clamped to the last step, so only the LAY is folded and the cell is gold.
    expect(b.ground.get(steps[0].groups[0].cells[0])).toBe("#d4a017");
    const all = boundAnimation(states[0], steps, { in: 1, out: 1 });
    expect(all.ground.get(steps[0].groups[0].cells[0])).toBe("#d4a017");
    // Fold BOTH by taking the erase into the ground of a longer replay.
    const erased = surfaceOf(states[0], steps);
    expect(erased.get(steps[0].groups[0].cells[0])).toBe(TILE);
    // The model's own state has the cell UNPAINTED. That difference is the
    // point of this test: the ground is the FRAME, not the plate.
    expect(states[2].has(steps[0].groups[0].cells[0])).toBe(false);
  });
});

// ── the timing follows the cut ───────────────────────────────────────────

describe("the cycle is derived from the bounded count", () => {
  it("plays a five-step cycle out of a hundred-gesture drawing", () => {
    const d = draw(3, Array.from({ length: 100 }, (_, k) => (k * 137 + 11) % 384));
    expect(d.steps.length).toBeGreaterThan(50);
    const b = boundAnimation(d.ground, d.steps, { in: 40, out: 44 });
    expect(b.steps).toHaveLength(5);
    const t = animationTiming(250, b.steps.length);
    const whole = animationTiming(250, d.steps.length);
    expect(t.holdMs).toBeLessThan(whole.holdMs);
    const svg = animatedSvg({ ...specOf(d, b.ground, b.steps), stepMs: 250, ...t });
    expect(svg).toContain(`animation-duration:${5 * 250 + t.holdMs}ms`);
    // Five rules and five keyframe lists, not a hundred.
    expect(svg.match(/@keyframes s\d+\{/g)).toHaveLength(5);
    expect(svg.match(/\.s\d+\{animation-name:s\d+\}/g)).toHaveLength(5);
  });

  it("lights the first surviving step at zero, not at the in point's old place", () => {
    const d = draw(2, [5, 9, 21, 33]);
    const b = boundAnimation(d.ground, d.steps, { in: 2, out: 3 });
    const svg = animatedSvg(specOf(d, b.ground, b.steps));
    // `s0` is the step at the in point and it comes up on the first beat: its
    // keyframe list has no dark run at all.
    expect(svg).toContain("@keyframes s0{0%{opacity:0}");
  });
});

// ── the SVG and the GIF cannot disagree ──────────────────────────────────

describe("one cut, two encoders", () => {
  const d = draw(2, [5, 9, 21, 33, 41, 57]);

  /**
   * NEITHER ENCODER KNOWS WHAT AN IN POINT IS. `boundAnimation` cuts once and
   * both specs are filled from the one value it returns, so the two files
   * cannot be cut differently — there is nothing to cut twice. This weighs the
   * cycle each one ended up with, which is the number a disagreement would show
   * up in first.
   */
  it("gives the SVG and the GIF the same frames and the same cycle", () => {
    for (const span of [
      { in: 0, out: 5 },
      { in: 2, out: 4 },
      { in: 5, out: 5 },
      { in: 0, out: 0 },
    ]) {
      const b = boundAnimation(d.ground, d.steps, span);
      const t = animationTiming(250, b.steps.length);
      const svg = animatedSvg({ ...specOf(d, b.ground, b.steps), stepMs: 250, ...t });
      const gif = encodeGif({
        ...gifSpecOf(d, b.ground, b.steps),
        stepMs: 250,
        holdMs: t.holdMs,
      });
      const cycle = b.steps.length * 250 + t.holdMs;
      expect(gif.frames).toBe(b.steps.length);
      expect(gif.cycleMs).toBe(cycle);
      expect(svg).toContain(`animation-duration:${cycle}ms`);
      expect(svg.match(/@keyframes s\d+\{/g)).toHaveLength(b.steps.length);
    }
  });

  /**
   * The GIF's first frame is the plate with the first step already on it, and
   * with a cut that plate is the FOLDED ground. A GIF that had kept the uncut
   * ground would carry the whole drawing's colours in its palette, so the
   * palette is what this weighs — the encoder's own report, on a drawing whose
   * every gesture uses a different hue.
   */
  it("gives the GIF only the colours the cut actually shows", () => {
    const b = boundAnimation(d.ground, d.steps, { in: 4, out: 5 });
    const cut = encodeGif({ ...gifSpecOf(d, b.ground, b.steps), holdMs: 400 });
    const whole = encodeGif({ ...gifSpecOf(d, d.ground, d.steps), holdMs: 400 });
    expect(cut.frames).toBe(2);
    expect(whole.frames).toBe(6);
    expect(cut.exact).toBe(true);
    expect(whole.exact).toBe(true);
    // The cut plate is a subset of the whole one: folding cannot invent a
    // colour, and dropping the tail cannot keep one that only the tail showed.
    expect(cut.palette).toBeLessThanOrEqual(whole.palette);
  });
});

// ── the payload ──────────────────────────────────────────────────────────

const cellsOf = (depth: number) => {
  const hex = buildHexagon(depth);
  const pf = plateFrame(hex, { mode: "hexagon", sector: 0 });
  const cells = new Map<number, ArtCell>();
  pf.cells.forEach((c, i) => cells.set(i, { verts: c.verts }));
  return { pf, cells };
};

const PALETTE = ["#d4a017", "#c0392b", "#2e86c1", "#7d3c98", "#1e8449", "#e67e22"];

/** Six gesture layers over a ground layer, each carrying its reveal index. */
function animatedDoc(anim: EmitDoc["animation"]): EmitDoc {
  const { pf, cells } = cellsOf(3);
  const layers: EmitLayer[] = [
    { id: "plate", paint: new Map(pf.shown.slice(200, 210).map((i) => [i, "#333333"])) },
  ];
  for (let k = 0; k < 6; k++) {
    layers.push({
      id: `s${k}`,
      reveal: k,
      mode: 6,
      orbit: 6,
      paint: new Map(pf.shown.slice(k * 6, k * 6 + 6).map((i) => [i, PALETTE[k % 6]])),
    });
  }
  const flat = new Map<number, string>();
  for (const l of layers) if (l.paint !== undefined) for (const [i, c] of l.paint) flat.set(i, c);
  return {
    width: pf.width,
    height: pf.height,
    cells,
    shown: pf.shown,
    background: "#0a0908",
    unpainted: "#141110",
    tileSeam: "rgba(236,230,220,.16)",
    paintSeam: "rgba(0,0,0,.3)",
    seamWidth: 0.7,
    weldPaint: false,
    title: "FOURFOLD — hexagon, depth 3",
    layers,
    overlay: [],
    animation: anim,
    payload: {
      version: 1,
      canvas: "hexagon",
      depth: 3,
      convention: "apex",
      cells: [...flat.entries()].sort((a, b) => a[0] - b[0]),
    },
  };
}

const PLAIN = { stepMs: 250, holdMs: 1800, fadeMs: 90, steps: 6 } as const;

/** The `anim` object out of a serialised document's payload comment. */
const animOf = (svg: string): Record<string, unknown> | undefined => {
  const p = extractArt(svg);
  return p?.comp?.anim as unknown as Record<string, unknown> | undefined;
};

describe("the marks in the file", () => {
  /**
   * BYTE IDENTITY. A drawing with no in and no out point must export exactly
   * the file it exported before the field existed, or every drawing anyone has
   * already made becomes a different document the next time it is saved.
   *
   * Three ways, because each catches a different way of getting it wrong: the
   * payload must carry the same four keys IN THE SAME ORDER, the stylesheet
   * must be the same bytes, and the two spellings of "no marks" — absent, and
   * present-but-undefined — must produce one file and not two.
   */
  it("writes the same four keys, in order, when there are no marks", () => {
    const svg = serialise(animatedDoc({ ...PLAIN }));
    expect(Object.keys(animOf(svg) as object)).toEqual([
      "stepMs",
      "holdMs",
      "fadeMs",
      "steps",
    ]);
    expect(svg).not.toContain(`"in"`);
    expect(svg).not.toContain(`"out"`);
  });

  it("writes the same stylesheet it wrote before the marks existed", () => {
    const svg = serialise(animatedDoc({ ...PLAIN }));
    const root = /id="(ff[0-9a-f]{6})"/.exec(svg)?.[1] as string;
    const at = `#${root} `;
    // Pinned in full, from the algorithm as it stood before this feature: the
    // base rule, one name per reveal, one keyframe list per reveal at k·stepMs,
    // and the reduced-motion block with nothing after it.
    const cycle = 6 * 250 + 1800;
    const want: string[] = [
      `${at}[data-reveal] { opacity: 0; animation-duration: ${cycle}ms; ` +
        `animation-timing-function: linear; animation-iteration-count: infinite; ` +
        `animation-fill-mode: both }`,
    ];
    for (let k = 0; k < 6; k++) {
      want.push(`${at}[data-reveal="${k}"] { animation-name: ${root}-r${k} }`);
    }
    const pc = (n: number) => {
      const r = Math.round(n * 1000) / 1000;
      return Object.is(r, -0) ? "0" : String(r);
    };
    for (let k = 0; k < 6; k++) {
      const on = (100 * (k * 250)) / cycle;
      const lit = (100 * Math.min(k * 250 + 90, cycle)) / cycle;
      const dark = on <= 0 ? "0%" : `0%, ${pc(on)}%`;
      want.push(
        `@keyframes ${root}-r${k} { ${dark} { opacity: 0 } ${pc(lit)}%, 100% { opacity: 1 } }`
      );
    }
    want.push(
      `@media (prefers-reduced-motion: reduce) { ${at}[data-reveal] ` +
        `{ animation: none; opacity: 1 } }`
    );
    for (const rule of want) expect(svg).toContain(`\n    ${rule}`);
    // And nothing the cut would have added.
    expect(svg).not.toContain("animation: none; opacity: 0");
    expect(svg).not.toMatch(/\[data-reveal="\d+"\] \{ animation: none; opacity: 1 \}/);
  });

  it("treats an undefined mark as an absent one, to the byte", () => {
    const absent = serialise(animatedDoc({ ...PLAIN }));
    const undef = serialise(
      animatedDoc({ ...PLAIN, in: undefined, out: undefined })
    );
    expect(undef).toBe(absent);
    // Half a pair is not a pair: an `in` with no `out` is dropped rather than
    // completed, so it too writes the file it always wrote.
    expect(serialise(animatedDoc({ ...PLAIN, in: 2 }))).toBe(absent);
    expect(serialise(animatedDoc({ ...PLAIN, out: 4 }))).toBe(absent);
  });

  it("round trips a marked composition through its own bytes", () => {
    const svg = serialise(animatedDoc({ ...PLAIN, in: 2, out: 4 }));
    expect(Object.keys(animOf(svg) as object)).toEqual([
      "stepMs",
      "holdMs",
      "fadeMs",
      "steps",
      "in",
      "out",
    ]);
    const back = parse(svg) as EmitDoc;
    expect(back).not.toBeNull();
    expect(back.animation).toEqual({ ...PLAIN, in: 2, out: 4 });
    expect(serialise(back)).toBe(svg);
  });

  /**
   * THE CUT IS THE STYLESHEET, AND THE MARKUP IS UNTOUCHED. `data-reveal`,
   * `data-mode` and `data-orbit` are the record of what MADE the gesture and
   * are written even for a still export, so cutting three strokes off the end
   * must not delete the file's statement that those three were six-fold.
   */
  it("keeps every gesture's provenance, and cuts only what plays", () => {
    const svg = serialise(animatedDoc({ ...PLAIN, in: 2, out: 4 }));
    expect(svg.match(/<g [^>]*data-reveal="\d+"/g)).toHaveLength(6);
    expect(svg).toContain(`data-reveal="5" data-orbit="6" data-mode="6"`);
    // Three steps play, so three names and three keyframe lists.
    expect(
      svg.match(/\[data-reveal="\d+"\] \{ animation-name: ff[0-9a-f]{6}-r\d+ \}/g)
    ).toHaveLength(3);
    expect(svg.match(/@keyframes ff[0-9a-f]{6}-r\d+ \{/g)).toHaveLength(3);
    // Before the in point: the ground, up from the first frame.
    expect(svg).toMatch(/\[data-reveal="0"\] \{ animation: none; opacity: 1 \}/);
    expect(svg).toMatch(/\[data-reveal="1"\] \{ animation: none; opacity: 1 \}/);
    // After the out point: not shown at all.
    expect(svg).toMatch(/\[data-reveal="5"\] \{ animation: none; opacity: 0 \}/);
    // The cycle is the three steps that play, not the six the drawing has.
    expect(svg).toContain(`animation-duration: ${3 * 250 + 1800}ms`);
  });

  it("rebases the keyframes on the in point", () => {
    const svg = serialise(animatedDoc({ ...PLAIN, in: 2, out: 4 }));
    const ons = [
      ...svg.matchAll(/@keyframes ff[0-9a-f]{6}-r(\d+) \{ 0%(?:, ([\d.]+)%)? \{/g),
    ].map((m) => [Number(m[1]), Number(m[2] ?? 0)] as [number, number]);
    expect(ons.map((o) => o[0])).toEqual([2, 3, 4]);
    // The step AT the in point is lit on the first beat.
    expect(ons[0][1]).toBe(0);
    // Against the three decimals the file is stated at, not against the exact
    // ratio: the percentage is where a timing becomes a float and `fmtAlpha`
    // rounds it, so comparing at full precision would be measuring the writer's
    // rounding rather than the rebasing.
    const cycle = 3 * 250 + 1800;
    const pc = (n: number) => Math.round(n * 1000) / 1000;
    expect(ons[1][1]).toBe(pc((100 * 250) / cycle));
    expect(ons[2][1]).toBe(pc((100 * 500) / cycle));
  });

  /**
   * A reduced-motion reader gets the finished plate — and with a cut, "the
   * finished plate" is the plate AT THE OUT POINT. Without the extra rule the
   * preference would quietly restore strokes the author had cut, so the one
   * reader who asked for less would be the only one seeing a different drawing.
   */
  it("holds the cut strokes down under prefers-reduced-motion", () => {
    const svg = serialise(animatedDoc({ ...PLAIN, in: 2, out: 3 }));
    const block = /@media \(prefers-reduced-motion: reduce\) \{([^}]*\}[^@]*)\}/.exec(svg);
    expect(block).not.toBeNull();
    const text = (block as RegExpExecArray)[0];
    expect(text).toContain(`[data-reveal] { animation: none; opacity: 1 }`);
    expect(text).toMatch(/\[data-reveal="4"\] \{ opacity: 0 \}/);
    expect(text).toMatch(/\[data-reveal="5"\] \{ opacity: 0 \}/);
    // Not the ones that play, and not the ones before the in point — those are
    // meant to be up.
    expect(text).not.toMatch(/\[data-reveal="[0-3]"\] \{ opacity: 0 \}/);
    expect(parse(svg)).not.toBeNull();
  });

  it("cuts to a single step, and to the whole drawing spelled out", () => {
    const one = serialise(animatedDoc({ ...PLAIN, in: 3, out: 3 }));
    expect(one.match(/@keyframes ff[0-9a-f]{6}-r\d+ \{/g)).toHaveLength(1);
    expect(one).toContain(`animation-duration: ${1 * 250 + 1800}ms`);

    // `in: 0, out: steps-1` is the whole drawing. It is NOT byte-identical to
    // the unmarked file — it says something the unmarked one does not, namely
    // that somebody set the marks there — but it must DRAW the same picture.
    const whole = serialise(animatedDoc({ ...PLAIN, in: 0, out: 5 }));
    const plain = serialise(animatedDoc({ ...PLAIN }));
    expect(whole).not.toBe(plain);
    expect(whole.match(/@keyframes ff[0-9a-f]{6}-r\d+ \{/g)).toHaveLength(6);
    expect(whole).toContain(`animation-duration: ${6 * 250 + 1800}ms`);
    // No step is held up or held down: the only `animation: none` in the file
    // is the reduced-motion block, which is there whether or not it is cut.
    expect(whole).not.toMatch(/\[data-reveal="\d+"\] \{ animation: none/);
    // Everything but the payload, with the document's own hash normalised: the
    // payload legitimately differs (it carries the marks, and carrying them
    // moves where its own line wrapping falls), and the id is a hash OF the
    // payload. What must be identical is the picture and the stylesheet.
    const drawn = (s: string) =>
      s.replace(/<!-- fourfold:art:1[\s\S]*?-->/, "").replace(/ff[0-9a-f]{6}/g, "ID");
    expect(drawn(whole)).toBe(drawn(plain));
  });
});

// ── the payload REFUSES what the slider clamps ───────────────────────────

/** A payload comment carrying a hand-built `anim`, for the validator. */
const fileWith = (anim: Record<string, unknown>): string => {
  const body = JSON.stringify({
    canvas: "hexagon",
    depth: 1,
    convention: "apex",
    cells: [],
    comp: { anim, layers: [{ id: "a" }] },
  });
  return `<svg><!-- ${ART_MARKER}:${ART_VERSION} ${body} --></svg>`;
};

describe("a file's marks are refused, never clamped", () => {
  const ok = { stepMs: 250, holdMs: 1800, fadeMs: 90, steps: 6 };

  it("accepts a well-formed pair and keeps it", () => {
    const p = extractArt(fileWith({ ...ok, in: 2, out: 4 }));
    expect(p?.comp?.anim).toEqual({ ...ok, in: 2, out: 4 });
    // Both ends of the range, and a single step.
    expect(extractArt(fileWith({ ...ok, in: 0, out: 5 }))?.comp?.anim?.in).toBe(0);
    expect(extractArt(fileWith({ ...ok, in: 5, out: 5 }))?.comp?.anim?.out).toBe(5);
  });

  it("refuses the whole payload for every malformed pair", () => {
    const bad: Record<string, unknown>[] = [
      { ...ok, in: 2 }, // half a pair
      { ...ok, out: 2 }, // the other half
      { ...ok, in: 4, out: 2 }, // inverted
      { ...ok, in: -1, out: 3 }, // before the start
      { ...ok, in: 0, out: 6 }, // past the last step
      { ...ok, in: 0, out: 99 },
      { ...ok, in: 1.5, out: 3 }, // not an index
      { ...ok, in: 0, out: 3.5 },
      { ...ok, in: "0", out: "3" }, // not numbers
      { ...ok, in: null, out: 3 },
      { ...ok, in: Number.NaN, out: 3 },
      // A drawing with no steps cannot have marked where to stop playing it.
      { stepMs: 250, holdMs: 1800, fadeMs: 90, steps: 0, in: 0, out: 0 },
    ];
    for (const anim of bad) {
      expect(extractArt(fileWith(anim)), JSON.stringify(anim)).toBeNull();
    }
  });

  it("still reads a file written before the marks existed", () => {
    const p = extractArt(fileWith(ok));
    expect(p).not.toBeNull();
    expect(p?.comp?.anim).toEqual(ok);
    expect(p?.comp?.anim?.in).toBeUndefined();
    expect(p?.comp?.anim?.out).toBeUndefined();
  });
});
