import { describe, expect, it } from "vitest";
import {
  animatedSvg,
  animationCensus,
  animationSteps,
  animationTiming,
  changedCells,
  clampIndex,
  everyState,
  FADE_MS,
  historyBase,
  HOLD_MS,
  markLookup,
  MIN_HOLD_MS,
  revertTo,
  stateAt,
  type AnimationSpec,
} from "../src/lib/replay";
import {
  addressBook,
  applyPlateEdits,
  planPlateEdits,
  resolvePlate,
  type Address,
  type AddressPlate,
} from "../src/lib/plate";
import { buildBandSurface, type BandFamily } from "../src/lib/bands";
import { brushStamp } from "../src/lib/brush";
import { buildHexagon } from "../src/lib/hexagon";
import { hexagonSurface, type BrushMode } from "../src/lib/orbit";
import { plateFrame } from "../src/lib/view";
import {
  applyEdits,
  commit,
  EMPTY_HISTORY,
  type ArtCell,
  type CellEdit,
  type History,
  type PaintMap,
  type Stroke,
} from "../src/lib/strokes";

/**
 * REPLAY and HISTORY.
 *
 * Two claims are load-bearing and both are measured here rather than argued
 * for. The first is that a preview CANNOT change the drawing: reconstruction is
 * a pure function of the plate and the history, and the maps it is handed come
 * back untouched. The second is the markup requirement — that a symmetry group
 * costs one CSS rule and not one per cell — which is a claim about BYTES, so
 * the same drawing is written out both ways and the two are weighed.
 */

const HUES = ["#d4a017", "#4ade80", "#67e8f9", "#f0a3a3", "#a78bfa", "#a3e635"];

interface Drawn {
  book: ReturnType<typeof addressBook>;
  cells: readonly ArtCell[];
  plate: AddressPlate;
  history: History<Address>;
}

/**
 * A drawing made through the REAL brush.
 *
 * Not a hand-written history: the grouping the animation writes down is
 * `brushStamp`'s own, so a test that invented its groups would be measuring a
 * fiction. Every gesture here goes through the same stamp → colours → plate
 * edits path the page does.
 */
function draw(
  depth: number,
  seeds: readonly number[],
  mode: BrushMode = 6,
  band: BandFamily | null = null
): Drawn {
  const hex = buildHexagon(depth);
  const book = addressBook(hex);
  const surface = hexagonSurface(hex, "hexagon");
  const bands = buildBandSurface(hex);
  let plate: AddressPlate = new Map();
  let history: History<Address> = EMPTY_HISTORY;
  seeds.forEach((seed, k) => {
    const stamp = brushStamp(surface, bands, seed, { mode, band });
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
  return {
    book,
    cells: plateFrame(hex, { mode: "hexagon", sector: 0 }).cells,
    plate,
    history,
  };
}

const resolved = (d: Drawn, plate: AddressPlate) => resolvePlate(plate, d.book);

/** Seeds spread across the plate by a stride coprime to it. */
const spread = (depth: number, count: number, stride = 137): number[] =>
  Array.from({ length: count }, (_, k) => (k * stride + 11) % (6 * 4 ** depth));

// ── reconstructing a state ───────────────────────────────────────────────

describe("stateAt", () => {
  const d = draw(2, [0, 5, 9, 17, 33]);

  it("walks back to the state the history began from", () => {
    expect(d.history.past.length).toBe(5);
    expect(historyBase(d.plate, d.history.past).size).toBe(0);
  });

  it("agrees with a forward re-run at every index", () => {
    const forward = everyState(d.plate, d.history.past);
    for (let n = 0; n <= d.history.past.length; n++) {
      const back = stateAt(d.plate, d.history.past, d.history.past.length, n);
      expect([...back.entries()].sort()).toEqual([...forward[n].entries()].sort());
    }
  });

  it("is reversible — a round trip through any index is the identity", () => {
    const live = [...d.plate.entries()].sort();
    for (let n = 0; n <= d.history.past.length; n++) {
      const there = stateAt(d.plate, d.history.past, d.history.past.length, n);
      const back = stateAt(there, d.history.past, n, d.history.past.length);
      expect([...back.entries()].sort()).toEqual(live);
    }
  });

  it("does not touch the map it was handed — a preview cannot edit the plate", () => {
    const before = [...d.plate.entries()].sort();
    for (let n = 0; n <= d.history.past.length; n++) {
      stateAt(d.plate, d.history.past, d.history.past.length, n);
    }
    everyState(d.plate, d.history.past);
    expect([...d.plate.entries()].sort()).toEqual(before);
  });

  it("clamps rather than walking off either end", () => {
    expect(clampIndex(-4, 5)).toBe(0);
    expect(clampIndex(99, 5)).toBe(5);
    expect(clampIndex(Number.NaN, 5)).toBe(5);
    const low = stateAt(d.plate, d.history.past, d.history.past.length, -3);
    expect(low.size).toBe(0);
    const high = stateAt(d.plate, d.history.past, d.history.past.length, 99);
    expect([...high.entries()].sort()).toEqual([...d.plate.entries()].sort());
  });

  it("steps one gesture at a time, which is what makes a replay affordable", () => {
    // The one-step walk from n to n+1 must equal the whole-history rebuild, or
    // the incremental preview and the exported animation would disagree.
    let at = historyBase(d.plate, d.history.past) as AddressPlate;
    for (let n = 0; n < d.history.past.length; n++) {
      at = stateAt(at, d.history.past, n, n + 1);
      const rebuilt = stateAt(d.plate, d.history.past, d.history.past.length, n + 1);
      expect([...at.entries()].sort()).toEqual([...rebuilt.entries()].sort());
    }
  });
});

// ── reverting ────────────────────────────────────────────────────────────

describe("revertTo", () => {
  const d = draw(2, [0, 5, 9, 17, 33, 41]);

  it("is null when the drawing already stands there", () => {
    expect(revertTo(d.plate, d.history, d.history.past.length)).toBeNull();
  });

  it("states its cost in gestures, and it is the number after the index", () => {
    for (let n = 0; n < d.history.past.length; n++) {
      const r = revertTo(d.plate, d.history, n);
      expect(r).not.toBeNull();
      expect(r?.rolledBack).toBe(d.history.past.length - n);
    }
  });

  it("takes the plate exactly to the state it names", () => {
    for (let n = 0; n < d.history.past.length; n++) {
      const r = revertTo(d.plate, d.history, n);
      const after = applyEdits(d.plate, r!.stroke.edits, "do");
      const want = stateAt(d.plate, d.history.past, d.history.past.length, n);
      expect([...after.entries()].sort()).toEqual([...want.entries()].sort());
    }
  });

  it("is ONE more entry, so undoing it restores every rolled-back gesture", () => {
    const r = revertTo(d.plate, d.history, 2) as NonNullable<
      ReturnType<typeof revertTo<Address>>
    >;
    const after = applyEdits(d.plate, r.stroke.edits, "do");
    const grown = commit(d.history, r.stroke);
    expect(grown.past.length).toBe(d.history.past.length + 1);
    // Undo of the revert — the ordinary one, no special case anywhere.
    const back = applyEdits(after, r.stroke.edits, "undo");
    expect([...back.entries()].sort()).toEqual([...d.plate.entries()].sort());
  });

  it("reports the redo branch separately — it is the only thing truly lost", () => {
    const clean = revertTo(d.plate, d.history, 1);
    expect(clean?.discardedRedo).toBe(0);
    const undone: History<Address> = {
      past: d.history.past.slice(0, 4),
      future: d.history.past.slice(4),
    };
    const at4 = stateAt(d.plate, d.history.past, d.history.past.length, 4);
    const dirty = revertTo(at4, undone, 1);
    expect(dirty?.discardedRedo).toBe(2);
    expect(dirty?.rolledBack).toBe(3);
  });

  it("records no edit for a cell the intervening gestures put back", () => {
    // Paint a cell, then paint it back to what it was: the state is unchanged,
    // so reverting across both is a no-op even though two gestures happened.
    const one: CellEdit<Address>[] = [{ cell: "s0:AA", from: null, to: "#111111" }];
    const two: CellEdit<Address>[] = [{ cell: "s0:AA", from: "#111111", to: null }];
    const history: History<Address> = {
      past: [{ edits: one }, { edits: two }],
      future: [],
    };
    expect(revertTo(new Map<Address, string>(), history, 0)).toBeNull();
  });
});

// ── recovering a cell's symmetry group ───────────────────────────────────

describe("markLookup", () => {
  const book = addressBook(buildHexagon(2));

  it("finds a cell by its own address", () => {
    const at = markLookup({ mode: 6, groups: [[book.addr[0]], [book.addr[7]]] }, book);
    expect(at(0)).toBe(0);
    expect(at(7)).toBe(1);
    expect(at(3)).toBe(-1);
  });

  it("finds a cell by its nearest recorded ANCESTOR, so a depth change degrades", () => {
    const deep = addressBook(buildHexagon(3));
    // A group recorded at depth 2 still names every depth-3 cell under it, on
    // exactly the prefix rule the plate resolves paint by.
    const shallow = book.addr[0];
    const at = markLookup({ mode: 6, groups: [[shallow]] }, deep);
    const under = deep.addr.findIndex((a) => a.startsWith(shallow) && a !== shallow);
    expect(under).toBeGreaterThanOrEqual(0);
    expect(at(under)).toBe(0);
  });

  it("claims nothing when the gesture recorded nothing", () => {
    const at = markLookup(undefined, book);
    expect(at(0)).toBe(-1);
  });

  it("gives a cell to the FIRST group that holds it", () => {
    const a = book.addr[0];
    const at = markLookup({ mode: 6, groups: [[a], [a]] }, book);
    expect(at(0)).toBe(0);
  });
});

// ── the animation, as data ───────────────────────────────────────────────

describe("animationSteps", () => {
  it("makes a 6-fold gesture ONE group of six, not six groups of one", () => {
    const d = draw(2, [5, 9, 21]);
    const states = everyState(d.plate, d.history.past).map((p) => resolved(d, p));
    const steps = animationSteps(states, d.history.past, d.book, "#201c19");
    expect(steps).toHaveLength(3);
    for (const s of steps) {
      expect(s.mode).toBe(6);
      expect(s.groups).toHaveLength(1);
      expect(s.groups[0].orbit).toBe(true);
      expect(s.groups[0].cells).toHaveLength(6);
      expect(s.groups[0].fills).toHaveLength(6);
    }
  });

  it("makes a BAND gesture one group per image row", () => {
    const d = draw(2, [5], 6, "A");
    const states = everyState(d.plate, d.history.past).map((p) => resolved(d, p));
    const steps = animationSteps(states, d.history.past, d.book, "#201c19");
    expect(steps).toHaveLength(1);
    // Six rows under C6 on the hexagon — the count `brushSpan` reports, arrived
    // at here through the recorded stamp rather than recomputed.
    expect(steps[0].groups.length).toBeGreaterThan(1);
    expect(steps[0].groups.every((g) => g.orbit)).toBe(true);
    const cells = steps[0].groups.flatMap((g) => g.cells);
    expect(new Set(cells).size).toBe(cells.length);
  });

  it("draws an ERASE in the unpainted fill rather than removing an element", () => {
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
    const history: History<Address> = {
      past: [{ edits: lay }, { edits: wipe }],
      future: [],
    };
    const states = everyState(two, history.past).map((p) => resolvePlate(p, book));
    const steps = animationSteps(states, history.past, book, "#201c19");
    expect(steps).toHaveLength(2);
    expect(steps[1].groups[0].fills.every((f) => f === "#201c19")).toBe(true);
    // No mark on either gesture here, so nothing claims a symmetry it lacks.
    expect(steps[1].mode).toBeNull();
    expect(steps[1].groups[0].orbit).toBe(false);
  });

  it("drops a gesture that changed nothing IN THIS FRAME", () => {
    const d = draw(2, [0, 5, 9]);
    const hex = buildHexagon(2);
    // Frame one sector; gestures whose orbit missed it must not become pauses.
    const shown = plateFrame(hex, { mode: "sector", sector: 3 }).shown;
    const states = everyState(d.plate, d.history.past).map((p) => resolved(d, p));
    const all = animationSteps(states, d.history.past, d.book, "#201c19");
    const framed = animationSteps(states, d.history.past, d.book, "#201c19", shown);
    expect(all).toHaveLength(3);
    for (const s of framed) {
      expect(s.groups.flatMap((g) => g.cells).length).toBeGreaterThan(0);
    }
    expect(framed.length).toBeLessThanOrEqual(all.length);
  });

  it("counts what it wrote", () => {
    const d = draw(2, [5, 9]);
    const states = everyState(d.plate, d.history.past).map((p) => resolved(d, p));
    const census = animationCensus(
      animationSteps(states, d.history.past, d.book, "#201c19")
    );
    expect(census).toEqual({ steps: 2, groups: 2, cells: 12, orbitGroups: 2 });
  });
});

describe("changedCells", () => {
  it("names every cell whose colour moved, in either direction", () => {
    const before: PaintMap = new Map([
      [1, "#111111"],
      [2, "#222222"],
    ]);
    const after: PaintMap = new Map([
      [2, "#222222"],
      [3, "#333333"],
    ]);
    expect(changedCells(before, after)).toEqual([1, 3]);
  });

  it("looks only inside the frame when there is one", () => {
    const before: PaintMap = new Map([[1, "#111111"]]);
    const after: PaintMap = new Map([[7, "#777777"]]);
    expect(changedCells(before, after, [5, 6, 7])).toEqual([7]);
  });
});

// ── the animation, as a file ─────────────────────────────────────────────

function specFor(d: Drawn, grouping: "orbit" | "cell"): AnimationSpec {
  const states = everyState(d.plate, d.history.past).map((p) => resolved(d, p));
  return {
    width: 900,
    height: 780,
    cells: d.cells,
    background: "#0a0908",
    unpainted: "#201c19",
    tileSeam: "rgba(236,230,220,.16)",
    paintSeam: "rgba(10,9,8,.34)",
    seamWidth: 0.6,
    title: "FOURFOLD replay",
    ground: states[0],
    steps: animationSteps(states, d.history.past, d.book, "#201c19"),
    stepMs: 250,
    holdMs: 1800,
    fadeMs: 90,
    grouping,
  };
}

// ── the fade and the hold ────────────────────────────────────────────────

/**
 * THE TIMINGS ARE MEASURED AGAINST THE FILE, not against the constants.
 *
 * Two defects at the fast end of the step control, both from absolute numbers:
 *
 *   A 90 ms FADE IS LONGER THAN THE FASTEST 80 ms STEP, so on an 80 ms export
 *   exactly one group was mid-fade at every instant — the reveals overlapped
 *   continuously and the fade read as a smear rather than as strokes landing.
 *   At 150 ms it was still 60% of the step.
 *
 *   A 1.8 s HOLD IS 63% OF A THIRTEEN-GESTURE LOOP AT 80 ms and 7% of a
 *   hundred-gesture loop at 250 ms. One number cannot mean the same thing
 *   across that range.
 *
 * The overlap test below reads the emitted `@keyframes` and checks the windows
 * directly, so it measures what the browser will actually do rather than what
 * the constants say.
 */
describe("the fade never outruns the step", () => {
  /** Every stroke's [dark-until, lit-from] pair, in ms, read off the CSS. */
  const windows = (svg: string, cycle: number): [number, number][] => {
    const out: [number, number][] = [];
    const re = /@keyframes s\d+\{([^{]*)\{opacity:0\}([\d.]+)%,100%\{opacity:1\}\}/g;
    for (const m of svg.matchAll(re)) {
      const dark = m[1].split(",").pop() ?? "0%";
      const on = (Number.parseFloat(dark) / 100) * cycle;
      const lit = (Number.parseFloat(m[2]) / 100) * cycle;
      out.push([on, lit]);
    }
    return out;
  };

  const overlaps = (w: readonly [number, number][]): number => {
    let n = 0;
    for (let k = 1; k < w.length; k++) if (w[k][0] < w[k - 1][1]) n += 1;
    return n;
  };

  it("has no two reveals in flight at once, at every step the control offers", () => {
    const d = draw(3, spread(3, 8));
    for (const stepMs of [80, 150, 250, 400, 700, 1200]) {
      const steps = animationSteps(
        everyState(d.plate, d.history.past).map((p) => resolved(d, p)),
        d.history.past,
        d.book,
        "#201c19"
      );
      const { fadeMs, holdMs } = animationTiming(stepMs, steps.length);
      const svg = animatedSvg({ ...specFor(d, "orbit"), stepMs, fadeMs, holdMs });
      const cycle = steps.length * stepMs + holdMs;
      const w = windows(svg, cycle);
      expect(w.length).toBe(steps.length);
      expect(overlaps(w)).toBe(0);
      // A group is fully up before the next one begins.
      expect(fadeMs).toBeLessThanOrEqual(stepMs);
    }
  });

  /**
   * The defect, still measurable — this is what the old absolute 90 ms did on
   * the fastest step, and it is why the rule is a ceiling and not a constant.
   */
  it("the old absolute fade overlapped EVERY reveal at 80 ms", () => {
    const d = draw(3, spread(3, 8));
    const steps = animationSteps(
      everyState(d.plate, d.history.past).map((p) => resolved(d, p)),
      d.history.past,
      d.book,
      "#201c19"
    );
    const cycle = steps.length * 80 + 1800;
    const bad = animatedSvg({
      ...specFor(d, "orbit"),
      stepMs: 80,
      fadeMs: FADE_MS,
      holdMs: HOLD_MS,
    });
    // Every reveal after the first is still fading when the next one starts.
    expect(overlaps(windows(bad, cycle))).toBe(steps.length - 1);
  });

  it("caps the fade at the old constant, so nothing slow moved", () => {
    for (const stepMs of [400, 700, 1200]) {
      expect(animationTiming(stepMs, 20).fadeMs).toBe(FADE_MS);
    }
    expect(animationTiming(80, 20).fadeMs).toBe(26);
    expect(animationTiming(150, 20).fadeMs).toBe(50);
    expect(animationTiming(250, 20).fadeMs).toBe(83);
  });
});

describe("the hold is a share of the drawing, not an absolute", () => {
  const share = (stepMs: number, steps: number): number => {
    const { holdMs } = animationTiming(stepMs, steps);
    return holdMs / (steps * stepMs + holdMs);
  };

  it("no longer spends most of a short fast loop on a still frame", () => {
    // 13 gestures at 80 ms: 1.04 s of drawing. The old absolute hold was 1.8 s
    // — 63% of the cycle. Measured here as the share it is now.
    const old = 1800 / (13 * 80 + 1800);
    expect(old).toBeGreaterThan(0.6);
    expect(share(80, 13)).toBeLessThan(0.35);
    expect(animationTiming(80, 13).holdMs).toBe(MIN_HOLD_MS);
  });

  it("leaves a long replay exactly where it was", () => {
    expect(animationTiming(250, 50).holdMs).toBe(HOLD_MS);
    expect(animationTiming(250, 100).holdMs).toBe(HOLD_MS);
    expect(animationTiming(1200, 20).holdMs).toBe(HOLD_MS);
  });

  it("never lets the still frame dominate, at any length the control offers", () => {
    for (const stepMs of [80, 150, 250, 400, 700, 1200]) {
      for (const steps of [5, 13, 25, 50, 100, 200]) {
        expect(share(stepMs, steps)).toBeLessThanOrEqual(0.5);
      }
    }
  });

  it("still rests long enough to read as finished on a tiny replay", () => {
    expect(animationTiming(80, 1).holdMs).toBeGreaterThanOrEqual(MIN_HOLD_MS);
  });
});

describe("animatedSvg", () => {
  const d = draw(3, spread(3, 8));
  const svg = animatedSvg(specFor(d, "orbit"));

  it("is a standalone document with one embedded style block and no script", () => {
    expect(svg.startsWith("<svg xmlns=")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg.match(/<style>/g)).toHaveLength(1);
    expect(svg).not.toMatch(/<script/i);
    // Nothing to fetch: no href, no url(), no external anything. It has to open
    // from file:// with the network off.
    expect(svg).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
    expect(svg).not.toMatch(/xlink:href|url\(/);
  });

  it("loops, and every group is on the same clock", () => {
    expect(svg).toContain("animation-iteration-count:infinite");
    const cycle = 8 * 250 + 1800;
    expect(svg).toContain(`animation-duration:${cycle}ms`);
  });

  it("writes the ORBIT as a group, with one rule and one keyframes per stroke", () => {
    expect(svg).toContain(`<g class="s0" data-orbit="6" data-mode="6">`);
    expect(svg.match(/@keyframes s\d+\{/g)).toHaveLength(8);
    expect(svg.match(/\.s\d+\{animation-name:s\d+\}/g)).toHaveLength(8);
    // Six polygons inside the one group, and not one class among them.
    const first = svg.slice(svg.indexOf(`<g class="s0"`));
    const group = first.slice(0, first.indexOf("</g>"));
    expect(group.match(/<polygon /g)).toHaveLength(6);
    // The class is on the GROUP and on nothing else: six polygons, no class
    // among them, which is the whole of the markup requirement.
    expect(group.match(/<polygon [^>]*class=/g)).toBeNull();
    expect(group.match(/class=/g)).toHaveLength(1);
  });

  it("reveals the strokes in order, each one later in the cycle than the last", () => {
    const ons = [...svg.matchAll(/@keyframes s(\d+)\{0%(?:,([\d.]+)%)?\{/g)].map(
      (m) => Number(m[2] ?? 0)
    );
    expect(ons).toHaveLength(8);
    for (let k = 1; k < ons.length; k++) expect(ons[k]).toBeGreaterThan(ons[k - 1]);
    expect(ons[0]).toBe(0);
    expect(ons[ons.length - 1]).toBeLessThan(100);
  });

  it("ends on the drawing — the last polygon naming a cell holds its final colour", () => {
    const last = new Map<string, string>();
    for (const m of svg.matchAll(/<polygon points="([^"]+)" fill="([^"]+)"/g)) {
      last.set(m[1], m[2]);
    }
    const paint = resolved(d, d.plate);
    for (const [i, hex] of paint) {
      const pts = d.cells[i].verts
        .map((v) => `${round2(v[0])},${round2(v[1])}`)
        .join(" ");
      expect(last.get(pts)).toBe(hex);
    }
  });

  it("carries no animation for the state the history began from", () => {
    const loaded = draw(2, [5, 9]);
    const ground = new Map(resolved(loaded, loaded.plate));
    const spec = { ...specFor(loaded, "orbit" as const), ground };
    const out = animatedSvg(spec);
    expect(out).toContain(`<g data-layer="ground"`);
    const g = out.slice(out.indexOf(`<g data-layer="ground"`));
    expect(g.slice(0, g.indexOf("</g>"))).not.toContain("class=");
  });
});

const round2 = (n: number) => {
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? "0" : String(r);
};

// ── what the grouping is worth, in bytes ─────────────────────────────────

describe("grouped against per-cell markup, measured", () => {
  it("costs one rule per gesture instead of one per cell", () => {
    const rows: string[] = [];
    for (const [depth, count, mode] of [
      [3, 8, 6],
      [4, 24, 6],
      [4, 24, 12],
    ] as const) {
      const d = draw(depth, spread(depth, count), mode);
      const orbit = animatedSvg(specFor(d, "orbit"));
      const cell = animatedSvg(specFor(d, "cell"));
      const cells = animationCensus(specFor(d, "orbit").steps).cells;
      const css = (s: string) =>
        s.slice(s.indexOf("<style>") + 7, s.indexOf("</style>")).length;
      rows.push(
        `d${depth} ${mode}-fold  ${d.history.past.length} gestures / ${cells} cells  ` +
          `grouped ${orbit.length} B (css ${css(orbit)} B)  ` +
          `per-cell ${cell.length} B (css ${css(cell)} B)  ` +
          `saved ${cell.length - orbit.length} B = ${(
            (100 * (cell.length - orbit.length)) /
            cell.length
          ).toFixed(1)}%  css ${(css(cell) / css(orbit)).toFixed(1)}×`
      );

      // The claim under test. The CSS is the part the requirement is about, and
      // it must scale with GESTURES and not with cells.
      expect(css(orbit)).toBeLessThan(css(cell));
      expect(cells).toBeGreaterThan(d.history.past.length);
      // Both files are real, and both say the same drawing: same polygon count,
      // same fills, same order. Only the addressing differs.
      const polys = (s: string) => (s.match(/<polygon /g) ?? []).length;
      expect(polys(orbit)).toBe(polys(cell));
      expect(orbit.length).toBeLessThan(cell.length);
    }
    console.log(`animated SVG, grouped vs per-cell:\n  ${rows.join("\n  ")}`);
  });
});

// ── what a replay costs at the deepest plate ─────────────────────────────

describe("replay cost at depth 5, reported", () => {
  it("steps one gesture and resolves the plate", () => {
    const depth = 5;
    const t0 = performance.now();
    const d = draw(depth, spread(depth, 40, 149));
    const built = performance.now() - t0;

    // The preview's own loop: step one gesture, then resolve for the board.
    let at: AddressPlate = historyBase(d.plate, d.history.past);
    const t1 = performance.now();
    for (let n = 0; n < d.history.past.length; n++) {
      at = stateAt(at, d.history.past, n, n + 1);
      resolvePlate(at, d.book);
    }
    const stepped = performance.now() - t1;

    const t2 = performance.now();
    const states = everyState(d.plate, d.history.past).map((p) =>
      resolvePlate(p, d.book)
    );
    const frames = animationSteps(states, d.history.past, d.book, "#201c19");
    const walked = performance.now() - t2;

    const t3 = performance.now();
    const out = animatedSvg({ ...specFor(d, "orbit"), cells: d.cells, steps: frames });
    const written = performance.now() - t3;

    console.log(
      `d5  ${6 * 4 ** depth} cells  ${d.history.past.length} gestures  ` +
        `drawn in ${built.toFixed(1)}ms  ` +
        `replay ${stepped.toFixed(1)}ms for the whole run = ` +
        `${(stepped / d.history.past.length).toFixed(2)}ms a step ` +
        `(reconstruct + resolve)  ` +
        `whole-history walk ${walked.toFixed(1)}ms  ` +
        `write ${written.toFixed(1)}ms for ${Math.round(out.length / 1024)} kB`
    );

    // A step has to be well inside the fastest interval on offer, or the
    // transport is quoting a rate it cannot keep.
    expect(stepped / d.history.past.length).toBeLessThan(80);
    expect(frames).toHaveLength(d.history.past.length);
  });
});

// ── the history holds gestures and nothing else ──────────────────────────

describe("only the drawing is in the history", () => {
  it("a stroke is edits, and a state is those edits applied", () => {
    // Not a tautology: it is the reason a view, a frame or a depth change can
    // never appear on the scrub. Nothing but a `Stroke` reaches `stateAt`, and
    // a `Stroke` is cell edits — there is no rung any display state could take.
    const d = draw(2, [5, 9]);
    for (const s of d.history.past) {
      const keys = Object.keys(s).sort();
      expect(keys).toEqual(["edits", "mark"]);
      for (const e of s.edits) {
        expect(Object.keys(e).sort()).toEqual(["cell", "from", "to"]);
      }
    }
    const bare: Stroke<Address> = { edits: [] };
    expect(Object.keys(bare)).toEqual(["edits"]);
  });
});
