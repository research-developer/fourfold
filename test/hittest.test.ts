import { describe, expect, it } from "vitest";

/**
 * THE GEOMETRIC HIT TEST, against the geometry the board is actually handed.
 *
 * ── What is being proved, and what a browser would have to prove ────────
 *
 * The board used to answer "which cell is under the pointer" only by reading
 * `data-i` off `event.target`, which required one transparent DOM element per
 * cell to exist for the pointer to land on — 98,304 of them at depth 7.
 * `makeCellIndex` answers the same question from `geom.cells[i].verts` with no
 * elements at all, and the whole of the claim is that the two answers agree.
 *
 * There is no jsdom here and there never has been (see `test/drillin.test.ts`),
 * so the agreement cannot be measured against a real browser in this file. It is
 * pinned where it is decidable instead, and the decidable part is all of it that
 * matters:
 *
 *   - The hit layer's polygons are `geom.cells[i].verts` VERBATIM — the same
 *     array this test indexes — filled `transparent`, which is a painted fill
 *     and therefore hittable, with no stroke to widen them.
 *   - For a point in the INTERIOR of one cell of a tiling, exactly one polygon
 *     contains it, so "the topmost element under the pointer" and "the cell that
 *     contains the point" are the same cell by construction. That is what the
 *     exhaustive sweep below asserts, at seven probes per cell.
 *   - On a shared EDGE the two rules differ in principle: the browser gives the
 *     point to whichever element is painted last, the crossing rule gives it to
 *     exactly one of the two incident cells by a half-open comparison. Both are
 *     deterministic, neither can answer "no cell", and the set they disagree on
 *     has zero area. `edges and vertices` below pins that the crossing rule
 *     never answers `null` on a boundary point inside the figure, which is the
 *     property a drawing tool needs from it.
 *
 * The other half of the file is the CONVERSION, which is the part a zoom can
 * break silently: a hit test that is exact in canvas units and wrong about which
 * canvas unit the finger is on is a hit test that lands on the wrong cell.
 */

import {
  BRIDGE_CAP,
  bridgeStep,
  makeCellIndex,
  onePath,
  unitsAt,
  unitsBy,
  viewBoxOf,
  type BoardGeometry,
  type ViewWindow,
} from "../src/components/DrawBoard";
import { buildHexagon } from "../src/lib/hexagon";
import { plateFrame, type PlateView } from "../src/lib/view";

/** The board's geometry, built exactly as `draw/page.tsx` builds it. */
const board = (depth: number, view: PlateView = { mode: "hexagon", sector: 0 }): BoardGeometry => {
  const hex = buildHexagon(depth, "apex");
  const pf = plateFrame(hex, view);
  return {
    width: pf.width,
    height: pf.height,
    outline: pf.outline,
    cells: pf.cells,
    seamWidth: 1,
    shown: pf.view.mode === "sector" ? pf.shown : undefined,
  };
};

const orderOf = (geom: BoardGeometry): readonly number[] =>
  geom.shown ?? geom.cells.map((_, i) => i);

/**
 * Seven interior probes per cell: the centroid, a point nine tenths of the way
 * to each vertex, and a point nine tenths of the way to each edge's midpoint.
 *
 * Nine tenths and not ninety-nine hundredths: the claim under test is that the
 * INTERIOR resolves, and a probe pushed to within a rounding error of a corner
 * is testing the boundary convention instead, which is pinned separately and on
 * purpose.
 */
const probes = (
  verts: readonly (readonly [number, number])[],
  centroid: readonly [number, number]
): [number, number][] => {
  const towards = (p: readonly [number, number]): [number, number] => [
    centroid[0] + (p[0] - centroid[0]) * 0.9,
    centroid[1] + (p[1] - centroid[1]) * 0.9,
  ];
  const out: [number, number][] = [[centroid[0], centroid[1]]];
  for (let k = 0; k < verts.length; k++) {
    const a = verts[k];
    const b = verts[(k + 1) % verts.length];
    out.push(towards(a));
    out.push(towards([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]));
  }
  return out;
};

describe("makeCellIndex — every cell, exhaustively", () => {
  for (const depth of [2, 3, 4]) {
    it(`resolves every interior probe of every cell at depth ${depth}`, () => {
      const geom = board(depth);
      const order = orderOf(geom);
      const index = makeCellIndex(geom, order);
      let checked = 0;
      for (const i of order) {
        const cell = geom.cells[i];
        for (const [x, y] of probes(cell.verts, cell.centroid)) {
          expect(index.cellAt(x, y), `cell ${i} at ${x},${y}`).toBe(i);
          checked += 1;
        }
      }
      // 6·4^d cells, seven probes each — stated so a geometry that silently
      // stopped producing cells could not pass by checking nothing.
      expect(order.length).toBe(6 * 4 ** depth);
      expect(checked).toBe(order.length * 7);
    });
  }

  it("answers null off the figure and outside the canvas", () => {
    const geom = board(3);
    const index = makeCellIndex(geom, orderOf(geom));
    // The padding band inside the canvas box but outside the hexagon.
    expect(index.cellAt(1, 1)).toBeNull();
    expect(index.cellAt(geom.width - 1, 1)).toBeNull();
    // And genuinely off the canvas, in both directions on both axes.
    expect(index.cellAt(-500, -500)).toBeNull();
    expect(index.cellAt(geom.width + 500, geom.height + 500)).toBeNull();
  });

  it("indexes only the framed cells in sector view", () => {
    const geom = board(3, { mode: "sector", sector: 2 });
    const order = orderOf(geom);
    expect(order.length).toBe(4 ** 3);
    expect(geom.cells.length).toBe(6 * 4 ** 3);
    const index = makeCellIndex(geom, order);
    const shown = new Set(order);
    for (const i of order) {
      const cell = geom.cells[i];
      for (const [x, y] of probes(cell.verts, cell.centroid)) {
        expect(index.cellAt(x, y)).toBe(i);
      }
    }
    // Nothing the frame does not draw can ever be returned — the five sectors
    // the sector transform pushed off the plate are not in the index at all.
    for (let x = 0; x < geom.width; x += 7) {
      for (let y = 0; y < geom.height; y += 7) {
        const hit = index.cellAt(x, y);
        if (hit !== null) expect(shown.has(hit)).toBe(true);
      }
    }
  });

  /**
   * THE BOUNDARY CONVENTION, stated as a test rather than as a sentence.
   *
   * A point exactly on an interior edge belongs to exactly one of the two cells
   * that share it — never to both, and never to neither. Which one is the
   * crossing rule's business and is not pinned, because the browser's answer to
   * the same question is "whichever element was painted last" and the two rules
   * are allowed to differ on a set of zero area. What is NOT allowed is a hole:
   * a pointer on a seam that resolves to nothing would be a brush that misses.
   */
  it("gives every interior edge point to exactly one of its two cells", () => {
    const geom = board(3);
    const order = orderOf(geom);
    const index = makeCellIndex(geom, order);
    let seams = 0;
    for (const i of order) {
      const cell = geom.cells[i];
      for (let k = 0; k < cell.verts.length; k++) {
        const a = cell.verts[k];
        const b = cell.verts[(k + 1) % cell.verts.length];
        const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        // Only the seams: an edge on the figure's rim has one incident cell and
        // may legitimately answer either that cell or nothing.
        const inward: [number, number] = [
          mid[0] + (cell.centroid[0] - mid[0]) * 0.02,
          mid[1] + (cell.centroid[1] - mid[1]) * 0.02,
        ];
        const outward: [number, number] = [
          mid[0] - (cell.centroid[0] - mid[0]) * 0.02,
          mid[1] - (cell.centroid[1] - mid[1]) * 0.02,
        ];
        expect(index.cellAt(inward[0], inward[1])).toBe(i);
        const other = index.cellAt(outward[0], outward[1]);
        if (other === null) continue;
        seams += 1;
        expect(other).not.toBe(i);
        const hit = index.cellAt(mid[0], mid[1]);
        expect(hit === i || hit === other).toBe(true);
      }
    }
    // Every interior edge of a depth-3 hexagon, counted from both sides.
    expect(seams).toBeGreaterThan(1000);
  });
});

describe("client pixels to canvas units", () => {
  const geom = board(2);
  const rect = { left: 40, top: 12, width: 600, height: 500 };

  it("maps the box's corners onto the window's corners, unzoomed", () => {
    expect(unitsAt(rect, null, geom, rect.left, rect.top)).toEqual([0, 0]);
    expect(
      unitsAt(rect, null, geom, rect.left + rect.width, rect.top + rect.height)
    ).toEqual([geom.width, geom.height]);
  });

  it("maps them onto a zoomed and panned window", () => {
    const view: ViewWindow = { x: 130, y: 90, w: 200, h: 160 };
    expect(unitsAt(rect, view, geom, rect.left, rect.top)).toEqual([130, 90]);
    expect(
      unitsAt(rect, view, geom, rect.left + rect.width, rect.top + rect.height)
    ).toEqual([330, 250]);
    const mid = unitsAt(
      rect,
      view,
      geom,
      rect.left + rect.width / 2,
      rect.top + rect.height / 2
    );
    expect(mid).toEqual([230, 170]);
  });

  it("refuses a box with no area rather than dividing by zero", () => {
    expect(unitsAt({ ...rect, width: 0 }, null, geom, 100, 100)).toBeNull();
    expect(unitsBy({ ...rect, height: 0 }, null, geom, 10, 10)).toEqual([0, 0]);
  });

  it("scales a delta by the same factor it scales a point", () => {
    const view: ViewWindow = { x: 130, y: 90, w: 200, h: 160 };
    const a = unitsAt(rect, view, geom, 100, 100)!;
    const b = unitsAt(rect, view, geom, 137, 152)!;
    const d = unitsBy(rect, view, geom, 37, 52);
    expect(d[0]).toBeCloseTo(b[0] - a[0], 12);
    expect(d[1]).toBeCloseTo(b[1] - a[1], 12);
  });

  /**
   * THE WHOLE PATH, end to end: a cell's centroid, pushed out to the client
   * pixel a pointer would be at to be over it, and back through the conversion
   * and the index. This is the test that a zoom cannot silently break.
   */
  it("lands on the cell under the finger at zoom 1 and while zoomed", () => {
    const geom4 = board(3);
    const index = makeCellIndex(geom4, orderOf(geom4));
    const check = (view: ViewWindow | null) => {
      const w = view === null ? geom4.width : view.w;
      const h = view === null ? geom4.height : view.h;
      const x0 = view === null ? 0 : view.x;
      const y0 = view === null ? 0 : view.y;
      for (const i of orderOf(geom4)) {
        const c = geom4.cells[i].centroid;
        // Only cells the window actually shows can be pointed at.
        if (c[0] < x0 || c[0] > x0 + w || c[1] < y0 || c[1] > y0 + h) continue;
        const clientX = rect.left + ((c[0] - x0) / w) * rect.width;
        const clientY = rect.top + ((c[1] - y0) / h) * rect.height;
        const p = unitsAt(rect, view, geom4, clientX, clientY)!;
        expect(index.cellAt(p[0], p[1])).toBe(i);
      }
    };
    check(null);
    check({ x: 200, y: 150, w: 400, h: 320 });
    check({ x: 500, y: 300, w: 150, h: 120 });
  });
});

describe("bridging a fast drag", () => {
  it("steps at half a cell edge", () => {
    const geom = board(3);
    const cell = geom.cells[0];
    const edge = Math.hypot(
      cell.verts[1][0] - cell.verts[0][0],
      cell.verts[1][1] - cell.verts[0][1]
    );
    expect(bridgeStep(geom)).toBeCloseTo(edge / 2, 9);
  });

  /**
   * WHAT HALF A CELL EDGE ACTUALLY GUARANTEES — and it is not "every cell".
   *
   * MEASURED HERE, and it refuted the sentence this test was first written to
   * assert. A segment walked at `bridgeStep` reaches every cell it crosses by
   * at least one step of arc length, and NOT every cell it touches: a line that
   * grazes a triangle's corner meets it in a chord that can be arbitrarily
   * short, and no fixed step can catch all of those. At depth 4 across the
   * whole plate the difference is a handful of cells per sweep, every one of
   * them a corner clipped by a few units.
   *
   * That is the right trade and not merely the affordable one. The cells this
   * misses are the ones a hand did not aim at, and the alternative — an exact
   * walk of the triangular lattice, which really would be hole-free — is a
   * different algorithm that would have to know the lattice this component is
   * deliberately not told about. What the guarantee has to cover is the failure
   * in the field report: a drag fast enough to put two pointer samples several
   * cells apart, which leaves gaps of many cells rather than of a clipped
   * corner. It covers that with a factor of two to spare.
   *
   * The ground truth is a walk twenty times finer, and the cells it is held to
   * are the ones it spent at least one coarse step inside.
   */
  it("reaches every cell it crosses by a step or more", () => {
    const geom = board(4);
    const index = makeCellIndex(geom, orderOf(geom));
    const step = bridgeStep(geom);
    const walk = (
      a: readonly [number, number],
      b: readonly [number, number],
      s: number
    ): number[] => {
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const n = Math.max(1, Math.min(BRIDGE_CAP, Math.ceil(Math.hypot(dx, dy) / s)));
      const out: number[] = [];
      for (let k = 1; k <= n; k++) {
        const t = k / n;
        const i = index.cellAt(a[0] + dx * t, a[1] + dy * t);
        if (i !== null && out[out.length - 1] !== i) out.push(i);
      }
      return out;
    };
    /** Cells the fine walk spent at least `run` consecutive samples inside. */
    const solid = (
      a: readonly [number, number],
      b: readonly [number, number],
      s: number,
      run: number
    ): number[] => {
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const n = Math.max(1, Math.min(BRIDGE_CAP, Math.ceil(Math.hypot(dx, dy) / s)));
      const out: number[] = [];
      let held: number | null = null;
      let count = 0;
      const flush = () => {
        if (held !== null && count >= run) out.push(held);
      };
      for (let k = 1; k <= n; k++) {
        const t = k / n;
        const i = index.cellAt(a[0] + dx * t, a[1] + dy * t);
        if (i === held) {
          count += 1;
          continue;
        }
        flush();
        held = i;
        count = 1;
      }
      flush();
      return out.filter((i) => i !== null);
    };
    const c = [geom.width / 2, geom.height / 2] as const;
    const runs: [readonly [number, number], readonly [number, number]][] = [
      [[c[0] - 400, c[1]], [c[0] + 400, c[1]]],
      [[c[0], c[1] - 300], [c[0], c[1] + 300]],
      [[c[0] - 380, c[1] - 260], [c[0] + 380, c[1] + 260]],
      [[c[0] - 380, c[1] + 260], [c[0] + 380, c[1] - 260]],
      [[c[0] - 17, c[1] - 311], [c[0] + 401, c[1] + 97]],
    ];
    for (const [a, b] of runs) {
      const coarse = new Set(walk(a, b, step));
      const crossed = solid(a, b, step / 20, 20);
      expect(crossed.length).toBeGreaterThan(15);
      for (const i of crossed) expect(coarse.has(i)).toBe(true);
    }
  });

  /**
   * AND THE FAILURE IT WAS BUILT FOR: two samples several cells apart.
   *
   * This is the field report — "fast drags skip cells" — as arithmetic. A drag
   * that jumps 300 units between two pointer events used to lay ONE cell, the
   * one it landed in. Bridged, it lays the whole run, and the run is connected:
   * every consecutive pair shares an edge, which is the property that makes a
   * stroke a line rather than a dotted one.
   */
  it("turns a jump between two samples into a connected run", () => {
    const geom = board(4);
    const index = makeCellIndex(geom, orderOf(geom));
    const step = bridgeStep(geom);
    const a: [number, number] = [geom.width / 2 - 150, geom.height / 2 - 100];
    const b: [number, number] = [geom.width / 2 + 150, geom.height / 2 + 100];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const n = Math.ceil(Math.hypot(dx, dy) / step);
    const out: number[] = [];
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const i = index.cellAt(a[0] + dx * t, a[1] + dy * t);
      if (i !== null && out[out.length - 1] !== i) out.push(i);
    }
    // The unbridged answer was one cell for the whole jump.
    expect(out.length).toBeGreaterThan(10);
    // Consecutive cells TOUCH — they share an edge, or, where the line passed
    // close enough to a lattice vertex that the cell between them was clipped
    // to a sliver shorter than a step, a vertex. MEASURED, and it is the second
    // half of the sentence above: the run is connected, and its connectivity is
    // through corners at the grazes and through edges everywhere else. What it
    // never does is jump, which is what an unbridged drag did.
    const key = (p: readonly [number, number]) =>
      `${Math.round(p[0] * 100)},${Math.round(p[1] * 100)}`;
    for (let k = 1; k < out.length; k++) {
      const prev = new Set(geom.cells[out[k - 1]].verts.map(key));
      const shared = geom.cells[out[k]].verts.filter((v) => prev.has(key(v)));
      expect(shared.length, `${out[k - 1]} → ${out[k]}`).toBeGreaterThan(0);
    }
  });

  it("keeps the order along the stroke", () => {
    const geom = board(4);
    const index = makeCellIndex(geom, orderOf(geom));
    const step = bridgeStep(geom);
    const a: [number, number] = [geom.width / 2 - 300, geom.height / 2];
    const b: [number, number] = [geom.width / 2 + 300, geom.height / 2];
    const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step);
    const seen: number[] = [];
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const i = index.cellAt(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
      if (i !== null && seen[seen.length - 1] !== i) seen.push(i);
    }
    // A left-to-right sweep across the middle of the hexagon crosses one row of
    // cells, and each of them once: no cell is entered, left and re-entered.
    expect(new Set(seen).size).toBe(seen.length);
    // 600 units across a depth-4 plate, whose cells are 32 units on a side.
    expect(seen.length).toBeGreaterThan(15);
  });
});

describe("one path per layer", () => {
  it("writes one closed subpath per cell, in order", () => {
    const geom = board(2);
    const order = orderOf(geom);
    const pts = geom.cells.map((c) => c.verts.map((v) => `${v[0]},${v[1]}`).join(" "));
    const d = onePath(pts, false, order);
    const subs = d.split("M").filter((s) => s.length > 0);
    expect(subs.length).toBe(order.length);
    for (const s of subs) expect(s.endsWith("Z")).toBe(true);
    expect(d.startsWith(`M${pts[order[0]]}Z`)).toBe(true);
  });

  it("skips what it is told to skip", () => {
    const geom = board(2);
    const order = orderOf(geom);
    const pts = geom.cells.map((c) => c.verts.map((v) => `${v[0]},${v[1]}`).join(" "));
    const skip = new Set(order.filter((i) => i % 3 === 0));
    const d = onePath(pts, false, order, skip);
    expect(d.split("M").filter((s) => s.length > 0).length).toBe(
      order.length - skip.size
    );
  });

  it("concatenates curved cells verbatim", () => {
    const paths = ["M0,0C1,1 2,2 3,3Z", "M3,3L4,4Z"];
    expect(onePath(paths, true, [0, 1])).toBe(paths[0] + paths[1]);
  });
});

describe("the viewBox both svgs read", () => {
  it("is the figure at zoom 1 and the window otherwise", () => {
    const geom = board(2);
    expect(viewBoxOf(geom, null)).toBe(`0 0 ${geom.width} ${geom.height}`);
    expect(viewBoxOf(geom, { x: 1, y: 2, w: 3, h: 4 })).toBe("1 2 3 4");
  });
});
