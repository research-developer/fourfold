import { describe, expect, it } from "vitest";
import { buildFigure } from "../src/lib/figure";
import { buildHexagon } from "../src/lib/hexagon";
import {
  glyphOrbit,
  stepCursor,
  subgroupOrder,
  subgroupShape,
  symmetryGuides,
  type CanvasFrame,
  type Pt,
} from "../src/lib/guides";
import {
  buildSurface,
  HEXAGON_MODES,
  TRIANGLE_MODES,
  type BrushMode,
} from "../src/lib/orbit";

const triFrame = (depth: number): CanvasFrame => ({
  kind: "triangle",
  corners: buildFigure(depth, "apex").corners,
});

const hexFrame = (depth: number): CanvasFrame => {
  const h = buildHexagon(depth, "apex");
  return { kind: "hexagon", centre: h.centre, radius: h.radius };
};

// ── the overlay only ever shows the active subgroup ──────────────────────

describe("symmetryGuides draws no axis that is not in the subgroup", () => {
  it("triangle: 1 → none, 2 → m_A only, 3 → none, 6 → all three", () => {
    const f = triFrame(3);
    expect(symmetryGuides(f, 1).mirrors.map((m) => m.id)).toEqual([]);
    expect(symmetryGuides(f, 2).mirrors.map((m) => m.id)).toEqual(["m_A"]);
    expect(symmetryGuides(f, 3).mirrors.map((m) => m.id)).toEqual([]);
    expect(symmetryGuides(f, 6).mirrors.map((m) => m.id)).toEqual([
      "m_A",
      "m_B",
      "m_C",
    ]);
  });

  it("hexagon: only mode 12 has mirrors — 2, 3 and 6 are rotations only", () => {
    const f = hexFrame(2);
    for (const mode of [1, 2, 3, 6] as BrushMode[]) {
      expect([mode, symmetryGuides(f, mode).mirrors.length]).toEqual([mode, 0]);
    }
    expect(symmetryGuides(f, 12).mirrors.map((m) => m.id)).toEqual([
      "m0",
      "m30",
      "m60",
      "m90",
      "m120",
      "m150",
    ]);
  });

  it("the mirror count matches the subgroup's own mirror list, in every mode", () => {
    for (const mode of TRIANGLE_MODES) {
      expect([mode, symmetryGuides(triFrame(2), mode).mirrors.length]).toEqual([
        mode,
        subgroupShape("triangle", mode).mirrors.length,
      ]);
    }
    for (const mode of HEXAGON_MODES) {
      expect([mode, symmetryGuides(hexFrame(2), mode).mirrors.length]).toEqual([
        mode,
        subgroupShape("hexagon", mode).mirrors.length,
      ]);
    }
  });
});

describe("rotation indicators", () => {
  it("triangle: only the modes containing A3 get one, at order 3", () => {
    const f = triFrame(3);
    expect(symmetryGuides(f, 1).rotation).toBeNull();
    expect(symmetryGuides(f, 2).rotation).toBeNull();
    expect(symmetryGuides(f, 3).rotation?.order).toBe(3);
    expect(symmetryGuides(f, 6).rotation?.order).toBe(3);
  });

  it("hexagon: the order is the rotational part of the mode", () => {
    const f = hexFrame(2);
    expect(symmetryGuides(f, 1).rotation).toBeNull();
    expect(symmetryGuides(f, 2).rotation?.order).toBe(2);
    expect(symmetryGuides(f, 3).rotation?.order).toBe(3);
    expect(symmetryGuides(f, 6).rotation?.order).toBe(6);
    expect(symmetryGuides(f, 12).rotation?.order).toBe(6);
  });

  it("the centre is the figure's centre, not the viewBox's", () => {
    const h = buildHexagon(2, "apex");
    const r = symmetryGuides(hexFrame(2), 6).rotation!;
    expect([r.cx, r.cy]).toEqual([h.centre[0], h.centre[1]]);
  });
});

/**
 * The correction this brief called out by name: spines reach the inradius,
 * boundaries reach the circumradius. Measured from the emitted endpoints.
 */
describe("hexagon mirror lengths", () => {
  const h = buildHexagon(2, "apex");
  const g = symmetryGuides(hexFrame(2), 12);
  const half = (id: string) => {
    const m = g.mirrors.find((x) => x.id === id)!;
    return Math.hypot(m.x2 - m.x1, m.y2 - m.y1) / 2;
  };

  it("boundaries run to the corners", () => {
    for (const id of ["m0", "m60", "m120"]) {
      expect(half(id)).toBeCloseTo(h.radius, 6);
    }
  });

  it("spines run to the edge midpoints, √3/2 as far", () => {
    for (const id of ["m30", "m90", "m150"]) {
      expect(half(id)).toBeCloseTo((h.radius * Math.sqrt(3)) / 2, 6);
    }
  });

  it("so a spine is strictly shorter than a boundary", () => {
    expect(half("m30")).toBeLessThan(half("m0"));
  });

  it("families are labelled the way the geometry says", () => {
    expect(g.mirrors.filter((m) => m.family === "spine").map((m) => m.id)).toEqual([
      "m30",
      "m90",
      "m150",
    ]);
    expect(
      g.mirrors.filter((m) => m.family === "boundary").map((m) => m.id)
    ).toEqual(["m0", "m60", "m120"]);
  });
});

describe("triangle medians land on the figure", () => {
  const f = buildFigure(3, "apex");
  const g = symmetryGuides(triFrame(3), 6);

  it("each starts at its corner and ends at the opposite edge midpoint", () => {
    const mid = (p: Pt, q: Pt): Pt => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    const [A, B, C] = f.corners;
    const want: [string, Pt, Pt][] = [
      ["m_A", A, mid(B, C)],
      ["m_B", B, mid(A, C)],
      ["m_C", C, mid(A, B)],
    ];
    for (const [id, p, q] of want) {
      const m = g.mirrors.find((x) => x.id === id)!;
      expect([id, m.x1, m.y1, m.x2, m.y2]).toEqual([id, p[0], p[1], q[0], q[1]]);
    }
  });

  it("all three meet at the rotation centre", () => {
    const r = g.rotation!;
    for (const m of g.mirrors) {
      // Cross product of (end − start) with (centre − start) vanishes on the line.
      const cross =
        (m.x2 - m.x1) * (r.cy - m.y1) - (m.y2 - m.y1) * (r.cx - m.x1);
      expect(Math.abs(cross)).toBeLessThan(1e-6);
    }
  });
});

// ── the button glyph is the real group ───────────────────────────────────

describe("subgroup glyphs", () => {
  const generic: Pt = [0.37, 0.19];

  it("the orbit of a generic point has exactly |H| points", () => {
    for (const mode of TRIANGLE_MODES) {
      const shape = subgroupShape("triangle", mode);
      expect([mode, glyphOrbit(shape, generic).length]).toEqual([mode, mode]);
      expect([mode, subgroupOrder(shape)]).toEqual([mode, mode]);
    }
    for (const mode of HEXAGON_MODES) {
      const shape = subgroupShape("hexagon", mode);
      expect([mode, glyphOrbit(shape, generic).length]).toEqual([mode, mode]);
      expect([mode, subgroupOrder(shape)]).toEqual([mode, mode]);
    }
  });

  it("a point ON a mirror has a short orbit, exactly as a pinned cell does", () => {
    // (0, 1) lies on the 90° median, so ⟨m_A⟩ fixes it.
    expect(glyphOrbit(subgroupShape("triangle", 2), [0, 1])).toHaveLength(1);
    // D3 then carries it to three places, not six.
    expect(glyphOrbit(subgroupShape("triangle", 6), [0, 1])).toHaveLength(3);
    expect(glyphOrbit(subgroupShape("hexagon", 12), [1, 0])).toHaveLength(6);
  });

  it("the triangle's three medians sit 60° apart, not 120°", () => {
    expect(subgroupShape("triangle", 6).mirrors).toEqual([30, 90, 150]);
  });

  it("there is no 12-fold brush on D3", () => {
    expect(() => subgroupShape("triangle", 12)).toThrow(/no 12-fold/);
  });

  it("the glyph's orbit length agrees with a real orbit on the canvas", () => {
    // A generic cell of the hexagon is unpinned in every mode (nothing sits on
    // the centre), so its orbit must be the full subgroup order.
    const s = buildSurface("hexagon", 2, "apex");
    for (const mode of HEXAGON_MODES) {
      const sizes = new Set(
        Array.from({ length: s.cellCount }, (_, i) => s.orbit(i, mode).length)
      );
      expect([mode, Math.max(...sizes)]).toEqual([
        mode,
        subgroupOrder(subgroupShape("hexagon", mode)),
      ]);
    }
  });
});

// ── keyboard walking ─────────────────────────────────────────────────────

describe("stepCursor", () => {
  /** A 3×3 lattice, index = row * 3 + col, spaced 10 apart, y downward. */
  const grid: Pt[] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) grid.push([c * 10, r * 10]);

  it("moves one cell in the direction named", () => {
    expect(stepCursor(grid, 4, "right")).toBe(5);
    expect(stepCursor(grid, 4, "left")).toBe(3);
    expect(stepCursor(grid, 4, "up")).toBe(1);
    expect(stepCursor(grid, 4, "down")).toBe(7);
  });

  it("stays put at the edge rather than wrapping", () => {
    expect(stepCursor(grid, 2, "right")).toBe(2);
    expect(stepCursor(grid, 0, "up")).toBe(0);
    expect(stepCursor(grid, 8, "down")).toBe(8);
  });

  it("prefers straight ahead over a nearer diagonal", () => {
    // Straight ahead at distance 10; a diagonal at distance ~7.1.
    const cells: Pt[] = [
      [0, 0],
      [10, 0],
      [5, 5],
    ];
    expect(stepCursor(cells, 0, "right")).toBe(1);
  });

  it("with no cursor, lands on the cell nearest the centre", () => {
    expect(stepCursor(grid, null, "right")).toBe(4);
    expect(stepCursor(grid, -1, "up")).toBe(4);
    expect(stepCursor(grid, 99, "up")).toBe(4);
  });

  it("reports -1 on an empty canvas rather than throwing", () => {
    expect(stepCursor([], null, "up")).toBe(-1);
  });

  it("walks a real hexagon end to end without leaving the cell set", () => {
    const h = buildHexagon(2, "apex");
    const centroids: Pt[] = h.cells.map((c) => c.centroid);
    let at = stepCursor(centroids, null, "right");
    for (let i = 0; i < 200; i++) {
      at = stepCursor(centroids, at, "right");
      expect(at).toBeGreaterThanOrEqual(0);
      expect(at).toBeLessThan(centroids.length);
    }
  });
});
