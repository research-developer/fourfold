import { describe, expect, it } from "vitest";
import { ADJUSTMENTS } from "@/lib/adjust";
import { buildBands, type BandFamily } from "@/lib/bands";
import {
  activeProgression,
  BAND_NOTE,
  brushCells,
  brushColours,
  defaultDragMode,
  EMPTY_EVENTS,
  eventCount,
  progressionIndex,
  pushEvents,
  redoEvents,
  TOOLS,
  undoEvents,
  upcomingBases,
  type ColourPlan,
  type EventLog,
} from "@/lib/brush";
import { buildSurface } from "@/lib/orbit";
import { PROGRESSIONS } from "@/lib/progression";
import { SCHEMES, swatchFromHex } from "@/lib/schemes";
import {
  applyEdits,
  commit,
  EMPTY_HISTORY,
  HISTORY_LIMIT,
  planEdits,
  redo,
  undo,
  type History,
  type PaintMap,
} from "@/lib/strokes";

const GOLD = swatchFromHex("#d4a017");

const plan = (over: Partial<ColourPlan> = {}): ColourPlan => ({
  tool: "paint",
  scheme: SCHEMES.hexad,
  base: GOLD,
  adjust: ADJUSTMENTS["hue+"],
  ...over,
});

describe("brushCells", () => {
  const surface = buildSurface("triangle", 3);
  const bands = buildBands("triangle", 3);

  it("is the orbit when no band is selected", () => {
    for (const i of [0, 5, 17, 40, 63]) {
      expect(brushCells(surface, bands, i, { mode: 3, band: null })).toEqual(
        surface.orbit(i, 3)
      );
    }
  });

  it("contains the whole row through the cell when a band is selected", () => {
    const row = bands.bandThrough(21, "A");
    const cells = brushCells(surface, bands, 21, { mode: 1, band: "A" });
    // Mode 1 is the trivial subgroup, so the band is carried by nothing and the
    // brush is exactly the row.
    expect(cells).toEqual(row);
    expect(row.length % 2).toBe(1);
  });

  it("composes with the symmetry rather than replacing it", () => {
    const row = bands.bandThrough(21, "A");
    const alone = brushCells(surface, bands, 21, { mode: 1, band: "A" });
    const carried = brushCells(surface, bands, 21, { mode: 6, band: "A" });
    // Every cell of the row survives, and the 6-fold brush adds its images.
    for (const c of row) expect(carried).toContain(c);
    expect(carried.length).toBeGreaterThan(alone.length);
    // …and the union is closed under the subgroup, band or no band.
    for (const c of carried) {
      for (const g of surface.orbit(c, 6)) expect(carried).toContain(g);
    }
  });

  it("returns ascending, duplicate-free cells for every family and mode", () => {
    const families: BandFamily[] = ["A", "B", "C"];
    for (const f of families) {
      for (const mode of [1, 2, 3, 6] as const) {
        const cells = brushCells(surface, bands, 30, { mode, band: f });
        expect(new Set(cells).size).toBe(cells.length);
        expect([...cells].sort((a, b) => a - b)).toEqual(cells);
      }
    }
  });
});

describe("brushColours", () => {
  const cells = [4, 9, 14];
  const painted: PaintMap = new Map([
    [4, "#3366cc"],
    [14, "#cc3366"],
  ]);

  it("paints the scheme's colour at each orbit position", () => {
    const got = brushColours(plan(), new Map(), cells);
    expect(got).toEqual(
      cells.map((_, k) => SCHEMES.hexad.at(GOLD, k, cells.length).hex)
    );
  });

  it("erases to null everywhere, painted or not", () => {
    expect(brushColours(plan({ tool: "erase" }), painted, cells)).toEqual([
      null,
      null,
      null,
    ]);
  });

  it("adjusts only the cells that carry colour", () => {
    const got = brushColours(plan({ tool: "adjust" }), painted, cells);
    expect(got[1]).toBeNull();
    expect(got[0]).not.toBe("#3366cc");
    expect(got[2]).not.toBe("#cc3366");
  });

  it("leaves an unpainted cell as a no-op edit rather than a fill", () => {
    const colours = brushColours(plan({ tool: "adjust" }), painted, cells);
    const edits = planEdits(painted, cells, colours);
    expect(edits.map((e) => e.cell)).toEqual([4, 14]);
    // The cell that had nothing still has nothing.
    const after = applyEdits(painted, edits, "do");
    expect(after.has(9)).toBe(false);
  });

  it("compounds when applied again to its own result", () => {
    let plate: PaintMap = painted;
    const seen = new Set<string>([plate.get(4)!]);
    for (let k = 0; k < 6; k++) {
      const colours = brushColours(plan({ tool: "adjust" }), plate, cells);
      plate = applyEdits(plate, planEdits(plate, cells, colours), "do");
      seen.add(plate.get(4)!);
    }
    // Six 15° steps round the wheel are six distinct rendered colours.
    expect(seen.size).toBe(7);
  });

  it("emits nothing when the adjustment cannot move the colour", () => {
    // Pure white has nothing left to lighten.
    const white: PaintMap = new Map([[4, "#ffffff"]]);
    const colours = brushColours(
      plan({ tool: "adjust", adjust: ADJUSTMENTS.lighten }),
      white,
      [4]
    );
    expect(planEdits(white, [4], colours)).toEqual([]);
  });

  it("drops an adjustment that moves the swatch but not the rendered colour", () => {
    // A grey has zero chroma, so a hue step changes h and no byte of the hex.
    const grey: PaintMap = new Map([[4, "#808080"]]);
    const colours = brushColours(plan({ tool: "adjust" }), grey, [4]);
    expect(planEdits(grey, [4], colours)).toEqual([]);
  });
});

describe("activeProgression", () => {
  it("passes the plain progressions through untouched", () => {
    for (const name of ["off", "hue-drift", "lightness-breathe", "saturation-fade"] as const) {
      expect(activeProgression(name, 3)).toBe(PROGRESSIONS[name]);
    }
  });

  it("builds the scheme walk at the scheme's own hue count", () => {
    const triad = activeProgression("scheme-walk", 3);
    // Three events walk the triad and the fourth is back at the base.
    expect(triad.at(GOLD, 3).hex).toBe(GOLD.hex);
    expect(triad.at(GOLD, 1).hex).toBe(SCHEMES.triad.at(GOLD, 1, 3).hex);
    const hexad = activeProgression("scheme-walk", 6);
    expect(hexad.at(GOLD, 6).hex).toBe(GOLD.hex);
    expect(hexad.at(GOLD, 3).hex).not.toBe(triad.at(GOLD, 3).hex);
  });
});

describe("upcomingBases", () => {
  it("starts at n and steps forward, matching at() exactly", () => {
    const prog = PROGRESSIONS["hue-drift"];
    const got = upcomingBases(prog, GOLD, 5, 4);
    expect(got.map((s) => s.hex)).toEqual(
      [5, 6, 7, 8].map((n) => prog.at(GOLD, n).hex)
    );
  });

  it("is empty rather than reversed for a non-positive count", () => {
    expect(upcomingBases(PROGRESSIONS["hue-drift"], GOLD, 0, 0)).toEqual([]);
    expect(upcomingBases(PROGRESSIONS["hue-drift"], GOLD, 0, -3)).toEqual([]);
  });
});

describe("the event log", () => {
  it("sums the past and ignores the future", () => {
    let log = EMPTY_EVENTS;
    log = pushEvents(log, 3);
    log = pushEvents(log, 2);
    expect(eventCount(log)).toBe(5);
    log = undoEvents(log);
    expect(eventCount(log)).toBe(3);
    log = redoEvents(log);
    expect(eventCount(log)).toBe(5);
  });

  it("discards the redo branch on a new push, exactly as commit does", () => {
    let log = pushEvents(pushEvents(EMPTY_EVENTS, 4), 1);
    log = undoEvents(log);
    expect(log.future).toEqual([1]);
    log = pushEvents(log, 9);
    expect(log.future).toEqual([]);
    expect(eventCount(log)).toBe(13);
  });

  it("is a no-op at either end", () => {
    expect(undoEvents(EMPTY_EVENTS)).toBe(EMPTY_EVENTS);
    expect(redoEvents(EMPTY_EVENTS)).toBe(EMPTY_EVENTS);
  });

  it("never mutates the log it was given", () => {
    const log: EventLog = { past: [1, 2], future: [] };
    pushEvents(log, 5);
    undoEvents(log);
    expect(log).toEqual({ past: [1, 2], future: [] });
  });

  /**
   * The invariant the whole design rests on. A pseudo-random walk of paired
   * operations, including well past the HISTORY_LIMIT trim, has to leave the two
   * stacks the same height at every step — otherwise n is read against the wrong
   * gesture and every colour after the 256th stroke is wrong.
   */
  it("stays rung-for-rung with the undo history across a long random walk", () => {
    let history: History = EMPTY_HISTORY;
    let log = EMPTY_EVENTS;
    let seed = 12345;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };

    for (let step = 0; step < 4000; step++) {
      const roll = next();
      if (roll < 0.6) {
        const stroke = { edits: [{ cell: step, from: null, to: "#ffffff" }] };
        history = commit(history, stroke);
        log = pushEvents(log, step % 4);
      } else if (roll < 0.85) {
        const s = undo(history);
        history = s.history;
        if (s.stroke !== null) log = undoEvents(log);
      } else {
        const s = redo(history);
        history = s.history;
        if (s.stroke !== null) log = redoEvents(log);
      }
      expect(log.past.length).toBe(history.past.length);
      expect(log.future.length).toBe(history.future.length);
    }
    expect(history.past.length).toBeLessThanOrEqual(HISTORY_LIMIT);
  });
});

describe("progressionIndex", () => {
  it("counts events since the origin", () => {
    const log = pushEvents(pushEvents(EMPTY_EVENTS, 4), 3);
    expect(progressionIndex(log, 0)).toBe(7);
    expect(progressionIndex(log, 4)).toBe(3);
    expect(progressionIndex(log, 4, 2)).toBe(5);
  });

  it("clamps at zero rather than running the progression backwards", () => {
    const log = pushEvents(EMPTY_EVENTS, 2);
    expect(progressionIndex(log, 9)).toBe(0);
  });

  /**
   * The reason `at` is pure, stated as a test at the level the UI uses it:
   * undoing back to a previous state and recomputing must give the colour that
   * state was drawn with, not a colour derived from how far the counter got.
   */
  it("returns to the same index after an undo, so colours are restored exactly", () => {
    const prog = PROGRESSIONS["hue-drift"];
    let log = EMPTY_EVENTS;
    const drawn: string[] = [];
    for (let k = 0; k < 10; k++) {
      drawn.push(prog.at(GOLD, progressionIndex(log, 0)).hex);
      log = pushEvents(log, 1);
    }
    for (let k = 0; k < 4; k++) log = undoEvents(log);
    for (let k = 6; k < 10; k++) {
      expect(prog.at(GOLD, progressionIndex(log, 0)).hex).toBe(drawn[k]);
      log = pushEvents(log, 1);
    }
  });
});

describe("small statements the UI depends on", () => {
  it("offers exactly three tools", () => {
    expect(TOOLS).toEqual(["paint", "erase", "adjust"]);
  });

  it("proposes on a coarse pointer and paints otherwise", () => {
    expect(defaultDragMode(true)).toBe("propose");
    expect(defaultDragMode(false)).toBe("paint");
  });

  it("has a note for every family on every canvas", () => {
    for (const kind of ["triangle", "hexagon"] as const) {
      for (const f of ["A", "B", "C"] as const) {
        expect(BAND_NOTE[kind][f].length).toBeGreaterThan(8);
      }
    }
  });
});
