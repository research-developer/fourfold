import { describe, expect, it } from "vitest";
import {
  applyEdits,
  artworkSvg,
  clearStroke,
  commit,
  EMPTY_HISTORY,
  exportName,
  HISTORY_LIMIT,
  mergeEdits,
  planEdits,
  redo,
  undo,
  WELD_WIDTH,
  type CellEdit,
  type History,
  type Stroke,
} from "../src/lib/strokes";

const paintOf = (pairs: [number, string][]) => new Map(pairs);

// ── planning ─────────────────────────────────────────────────────────────

describe("planEdits", () => {
  it("records the colour that was there, per cell", () => {
    const paint = paintOf([[2, "#111111"]]);
    expect(planEdits(paint, [1, 2], ["#aaaaaa", "#bbbbbb"])).toEqual([
      { cell: 1, from: null, to: "#aaaaaa" },
      { cell: 2, from: "#111111", to: "#bbbbbb" },
    ]);
  });

  it("drops no-ops, so the announced count is the count that changed", () => {
    const paint = paintOf([
      [1, "#aaaaaa"],
      [2, "#bbbbbb"],
    ]);
    expect(planEdits(paint, [1, 2, 3], ["#aaaaaa", "#cccccc", "#dddddd"])).toEqual([
      { cell: 2, from: "#bbbbbb", to: "#cccccc" },
      { cell: 3, from: null, to: "#dddddd" },
    ]);
  });

  it("treats a missing colour as an erase", () => {
    const paint = paintOf([[7, "#abcdef"]]);
    expect(planEdits(paint, [7, 8], [null, null])).toEqual([
      { cell: 7, from: "#abcdef", to: null },
    ]);
  });
});

// ── merging within one gesture ───────────────────────────────────────────

describe("mergeEdits", () => {
  it("keeps the colour from the START of the gesture", () => {
    const base: CellEdit[] = [{ cell: 4, from: "#000000", to: "#111111" }];
    const next: CellEdit[] = [{ cell: 4, from: "#111111", to: "#222222" }];
    expect(mergeEdits(base, next)).toEqual([
      { cell: 4, from: "#000000", to: "#222222" },
    ]);
  });

  it("removes a cell a gesture put back the way it found it", () => {
    const base: CellEdit[] = [{ cell: 4, from: "#000000", to: "#111111" }];
    const next: CellEdit[] = [{ cell: 4, from: "#111111", to: "#000000" }];
    expect(mergeEdits(base, next)).toEqual([]);
  });

  it("sorts by cell, so edit order is a fact about the canvas", () => {
    const merged = mergeEdits(
      [{ cell: 9, from: null, to: "#a" }],
      [
        { cell: 2, from: null, to: "#b" },
        { cell: 5, from: null, to: "#c" },
      ]
    );
    expect(merged.map((e) => e.cell)).toEqual([2, 5, 9]);
  });

  it("is idempotent — merging the same edits twice changes nothing", () => {
    const next: CellEdit[] = [{ cell: 3, from: "#000000", to: "#ffffff" }];
    const once = mergeEdits([], next);
    expect(mergeEdits(once, next)).toEqual(once);
  });
});

// ── applying ─────────────────────────────────────────────────────────────

describe("applyEdits", () => {
  const edits: CellEdit[] = [
    { cell: 1, from: null, to: "#aaaaaa" },
    { cell: 2, from: "#111111", to: null },
  ];

  it("goes forwards", () => {
    const out = applyEdits(paintOf([[2, "#111111"]]), edits, "do");
    expect([...out.entries()]).toEqual([[1, "#aaaaaa"]]);
  });

  it("goes backwards", () => {
    const out = applyEdits(paintOf([[1, "#aaaaaa"]]), edits, "undo");
    expect([...out.entries()]).toEqual([[2, "#111111"]]);
  });

  it("does not mutate the map it was handed", () => {
    const before = paintOf([[2, "#111111"]]);
    applyEdits(before, edits, "do");
    expect([...before.entries()]).toEqual([[2, "#111111"]]);
  });

  it("round-trips: do then undo is the identity on any paint map", () => {
    const start = paintOf([
      [1, "#010101"],
      [5, "#050505"],
    ]);
    const stroke = planEdits(start, [1, 2, 5], ["#aaaaaa", "#bbbbbb", null]);
    const after = applyEdits(start, stroke, "do");
    const back = applyEdits(after, stroke, "undo");
    expect([...back.entries()].sort()).toEqual([...start.entries()].sort());
  });
});

// ── history ──────────────────────────────────────────────────────────────

const strokeOf = (cell: number): Stroke => ({
  edits: [{ cell, from: null, to: "#ffffff" }],
});

describe("history", () => {
  it("refuses to record an empty gesture", () => {
    expect(commit(EMPTY_HISTORY, { edits: [] })).toBe(EMPTY_HISTORY);
  });

  it("undo then redo returns the same gesture", () => {
    const h0 = commit(EMPTY_HISTORY, strokeOf(1));
    const u = undo(h0);
    expect(u.stroke).toEqual(strokeOf(1));
    expect(u.history.past).toHaveLength(0);
    const r = redo(u.history);
    expect(r.stroke).toEqual(strokeOf(1));
    expect(r.history.past).toHaveLength(1);
    expect(r.history.future).toHaveLength(0);
  });

  it("reports nothing to do on an empty stack, without moving", () => {
    expect(undo(EMPTY_HISTORY)).toEqual({ history: EMPTY_HISTORY, stroke: null });
    expect(redo(EMPTY_HISTORY)).toEqual({ history: EMPTY_HISTORY, stroke: null });
  });

  it("a new gesture discards the redo branch", () => {
    const h = commit(commit(EMPTY_HISTORY, strokeOf(1)), strokeOf(2));
    const u = undo(h);
    expect(u.history.future).toHaveLength(1);
    const after = commit(u.history, strokeOf(3));
    expect(after.future).toHaveLength(0);
    expect(after.past.map((s) => s.edits[0].cell)).toEqual([1, 3]);
  });

  it("drops the OLDEST gesture past the limit, never the newest", () => {
    let h: History = EMPTY_HISTORY;
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) h = commit(h, strokeOf(i));
    expect(h.past).toHaveLength(HISTORY_LIMIT);
    expect(h.past[0].edits[0].cell).toBe(5);
    expect(h.past[h.past.length - 1].edits[0].cell).toBe(HISTORY_LIMIT + 4);
  });
});

describe("clearStroke", () => {
  it("erases every painted cell as one undoable gesture", () => {
    const paint = paintOf([
      [3, "#333333"],
      [1, "#111111"],
    ]);
    const s = clearStroke(paint);
    expect(s.edits).toEqual([
      { cell: 1, from: "#111111", to: null },
      { cell: 3, from: "#333333", to: null },
    ]);
    expect(applyEdits(paint, s.edits, "do").size).toBe(0);
    expect([...applyEdits(applyEdits(paint, s.edits, "do"), s.edits, "undo")]).toEqual(
      [...paint].sort((a, b) => a[0] - b[0])
    );
  });

  it("on an empty canvas produces a gesture the history will refuse", () => {
    expect(clearStroke(new Map()).edits).toEqual([]);
    expect(commit(EMPTY_HISTORY, clearStroke(new Map()))).toBe(EMPTY_HISTORY);
  });
});

// ── export ───────────────────────────────────────────────────────────────

describe("exportName", () => {
  const at = new Date(Date.UTC(2026, 7, 2, 9, 4, 7));

  it("stamps in UTC, so the same plate names itself the same everywhere", () => {
    expect(
      exportName({
        kind: "hexagon",
        depth: 4,
        mode: 12,
        scheme: "triad",
        at,
        ext: "svg",
      })
    ).toBe("fourfold-hexagon-d4-b12-triad-20260802-090407.svg");
  });

  it("zero-pads every field", () => {
    expect(
      exportName({
        kind: "triangle",
        depth: 1,
        mode: 1,
        scheme: "solid",
        at: new Date(Date.UTC(2026, 0, 3, 0, 0, 0)),
        ext: "png",
      })
    ).toBe("fourfold-triangle-d1-b1-solid-20260103-000000.png");
  });
});

describe("artworkSvg", () => {
  const cells = [
    { verts: [[0, 0], [10, 0], [5, 8.6602540378]] as [number, number][] },
    { verts: [[10, 0], [20, 0], [15, 8.6602540378]] as [number, number][] },
    { verts: [[5, 8.66], [15, 8.66], [10, 17.32]] as [number, number][] },
  ];
  const spec = {
    width: 20,
    height: 18,
    cells,
    paint: paintOf([[1, "#ff0000"]]),
    background: "#0a0908",
    unpainted: "#141110",
    tileSeam: "rgba(236,230,220,.16)",
    paintSeam: "rgba(0,0,0,.3)",
    seamWidth: 0.5,
    title: "test plate",
  };

  it("is a standalone document with the right viewBox", () => {
    const svg = artworkSvg(spec);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain('viewBox="0 0 20 18"');
    expect(svg.endsWith("</svg>")).toBe(true);
  });

  it("emits every cell exactly once when the tiling is on", () => {
    expect(artworkSvg(spec).match(/<polygon/g)).toHaveLength(3);
  });

  it("emits only the painted cells when the tiling is off", () => {
    const svg = artworkSvg({ ...spec, unpainted: null });
    expect(svg.match(/<polygon/g)).toHaveLength(1);
    expect(svg).toContain('fill="#ff0000"');
  });

  it("rounds coordinates to two places", () => {
    expect(artworkSvg(spec)).toContain("5,8.66");
    expect(artworkSvg(spec)).not.toContain("8.6602540378");
  });

  it("escapes the title rather than letting it close a tag", () => {
    expect(artworkSvg({ ...spec, title: "a <b> & c" })).toContain(
      "<title>a &lt;b&gt; &amp; c</title>"
    );
  });

  it("gives the tiling a light seam and the paint a dark one", () => {
    const svg = artworkSvg(spec);
    expect(svg).toContain('<g fill="#141110" stroke="rgba(236,230,220,.16)"');
    expect(svg).toContain('<g stroke="rgba(0,0,0,.3)"');
  });

  it("says nothing at all about an empty canvas beyond the plate", () => {
    const svg = artworkSvg({ ...spec, paint: new Map(), unpainted: null });
    expect(svg).not.toContain("<polygon");
    expect(svg).toContain('fill="#0a0908"');
  });

  describe("weldPaint", () => {
    const many = {
      ...spec,
      paint: paintOf([
        [0, "#ff0000"],
        [1, "#ff0000"],
        [2, "#00ff00"],
      ]),
    };

    it("is off unless asked for, so an old spec exports the same bytes", () => {
      expect(artworkSvg(many)).toBe(artworkSvg({ ...many, weldPaint: false }));
    });

    it("strokes each painted cell in its own fill and drops the group seam", () => {
      const svg = artworkSvg({ ...many, weldPaint: true });
      expect(svg).not.toContain('<g stroke="rgba(0,0,0,.3)"');
      expect(svg).toContain('fill="#ff0000" stroke="#ff0000" stroke-width="1.5"');
      expect(svg).toContain('fill="#00ff00" stroke="#00ff00" stroke-width="1.5"');
    });

    /**
     * The weld is wider than the hairline it replaces, because a sub-pixel
     * stroke only partly covers the join it is closing — see the note on
     * WELD_WIDTH for what that is and is not claimed to fix.
     */
    it("welds wider than the hairline it replaces", () => {
      expect(WELD_WIDTH).toBeGreaterThan(1);
      // 0.7 is a depth-4 hexagon's hairline, to two places.
      const svg = artworkSvg({ ...many, weldPaint: true, seamWidth: 0.7 });
      // Written through the same two-place rounding as every other number in
      // the file — 0.7 * 3 is 2.0999999999999996 in doubles, and the file says
      // 2.1, which is the whole reason `fmt` exists.
      expect(WELD_WIDTH).toBe(3);
      expect(svg).toContain('stroke-width="2.1"');
      // The tiling's own seam is untouched by the factor.
      expect(svg).toContain('stroke="rgba(236,230,220,.16)" stroke-width="0.7"');
    });

    it("leaves the tiling's own seam alone", () => {
      const svg = artworkSvg({ ...spec, weldPaint: true });
      expect(svg).toContain('<g fill="#141110" stroke="rgba(236,230,220,.16)"');
    });
  });
});
