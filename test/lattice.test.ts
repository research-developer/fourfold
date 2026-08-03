import { describe, expect, it } from "vitest";
import { BAND_FAMILIES } from "../src/lib/bands";
import { buildBandSurface } from "../src/lib/bands";
import { buildFigure } from "../src/lib/figure";
import { buildHexagon } from "../src/lib/hexagon";
import {
  alongBand,
  clipToRegion,
  imageStamp,
  latticeView,
  lineCells,
  lineFamily,
  orbitStamp,
  ringCells,
  ringUnit,
  RING_DIRS,
  type RingDir,
} from "../src/lib/lattice";
import { hexagonSurface, triangleSurface } from "../src/lib/orbit";
import { shell } from "../src/lib/relief";

const DEPTHS = [1, 2, 3, 4];

/**
 * The screen angle of a step, in degrees anticlockwise from east.
 *
 * FLOAT, and only here: the model's steps are exact integer deltas and this is
 * the measurement that checks the NAME on each one is the direction it actually
 * goes. Nothing in `lattice.ts` computes an angle.
 */
const angle = (from: readonly [number, number], to: readonly [number, number]) => {
  const deg = (Math.atan2(-(to[1] - from[1]), to[0] - from[0]) * 180) / Math.PI;
  return (deg + 360) % 360;
};

/** How far apart two bearings are, the short way round. Degrees. */
const bearingGap = (a: number, b: number) => {
  const d = Math.abs(((a - b) % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
};

const WANT: Record<RingDir, number> = {
  E: 0,
  NE: 60,
  NW: 120,
  W: 180,
  SW: 240,
  SE: 300,
};

// ── the six ring directions ──────────────────────────────────────────────

describe("the ring steps", () => {
  it("go where they are named, on both canvases, at every depth", () => {
    for (const d of DEPTHS) {
      for (const canvas of [buildFigure(d), buildHexagon(d)]) {
        const view = latticeView(canvas);
        let checked = 0;
        for (let i = 0; i < view.cellCount; i++) {
          for (const dir of RING_DIRS) {
            const j = view.step(i, dir);
            if (j < 0) continue;
            const a = angle(canvas.cells[i].centroid, canvas.cells[j].centroid);
            expect(bearingGap(a, WANT[dir])).toBeLessThan(1e-6);
            checked++;
          }
        }
        expect(checked).toBeGreaterThan(0);
      }
    }
  });

  it("are all one cell edge long, and the same length as each other", () => {
    for (const canvas of [buildFigure(3), buildHexagon(3)]) {
      const view = latticeView(canvas);
      const lengths = new Set<number>();
      for (let i = 0; i < view.cellCount; i++) {
        for (const dir of RING_DIRS) {
          const j = view.step(i, dir);
          if (j < 0) continue;
          const p = canvas.cells[i].centroid;
          const q = canvas.cells[j].centroid;
          lengths.add(Math.round(Math.hypot(q[0] - p[0], q[1] - p[1]) * 1e6));
        }
      }
      expect(lengths.size).toBe(1);
    }
  });

  it("preserve orientation — which is why the radial keys have to exist", () => {
    for (const canvas of [buildFigure(3), buildHexagon(3)]) {
      const view = latticeView(canvas);
      for (let i = 0; i < view.cellCount; i++) {
        const here = ((view.keyOf(i)[0] % 3) + 3) % 3;
        for (const dir of RING_DIRS) {
          const j = view.step(i, dir);
          if (j < 0) continue;
          expect(((view.keyOf(j)[0] % 3) + 3) % 3).toBe(here);
        }
      }
    }
  });

  it("are reversible: stepping back lands on the cell you left", () => {
    const opposite: Record<RingDir, RingDir> = {
      E: "W",
      W: "E",
      NE: "SW",
      SW: "NE",
      NW: "SE",
      SE: "NW",
    };
    for (const canvas of [buildFigure(3), buildHexagon(2)]) {
      const view = latticeView(canvas);
      for (let i = 0; i < view.cellCount; i++) {
        for (const dir of RING_DIRS) {
          const j = view.step(i, dir);
          if (j < 0) continue;
          expect(view.step(j, opposite[dir])).toBe(i);
        }
      }
    }
  });

  it("differ between the two canvases by exactly a third of a turn", () => {
    for (const dir of RING_DIRS) {
      const h = ringUnit("hexagon", dir);
      const t = ringUnit("triangle", dir);
      // rot² applied to the hexagon unit, written out rather than reused.
      const once: [number, number] = [-h[1], h[0] + h[1]];
      const twice: [number, number] = [-once[1], once[0] + once[1]];
      expect(t).toEqual(twice);
    }
  });
});

// ── up and down cells, and what really differs ───────────────────────────

describe("the two orientations", () => {
  it("have DISJOINT edge-neighbour direction sets", () => {
    const canvas = buildFigure(3);
    const view = latticeView(canvas);
    const up: number[][] = [];
    const down: number[][] = [];
    // The edge steps are the three key deltas of size one unit; recovered here
    // by brute force from the figure rather than from the module's table.
    for (let i = 0; i < view.cellCount; i++) {
      const k = view.keyOf(i);
      const inverted = ((k[0] % 3) + 3) % 3 === 2;
      for (let j = 0; j < view.cellCount; j++) {
        if (i === j) continue;
        const l = view.keyOf(j);
        const d = [l[0] - k[0], l[1] - k[1]];
        const size = Math.max(Math.abs(d[0]), Math.abs(d[1]), Math.abs(d[0] + d[1]));
        if (size !== 2) continue;
        (inverted ? down : up).push(d);
      }
    }
    const sig = (xs: number[][]) => new Set(xs.map((d) => d.join(",")));
    const u = sig(up);
    const v = sig(down);
    expect([...u].sort()).toEqual(["-2,1", "1,-2", "1,1"]);
    expect([...v].sort()).toEqual(["-1,-1", "-1,2", "2,-1"]);
    for (const x of u) expect(v.has(x)).toBe(false);
  });
});

// ── the radial axis ──────────────────────────────────────────────────────

describe("the radial steps", () => {
  it("flip the orientation every time, on both canvases", () => {
    for (const canvas of [buildFigure(3), buildHexagon(3)]) {
      const view = latticeView(canvas);
      for (let i = 0; i < view.cellCount; i++) {
        for (const way of ["out", "in"] as const) {
          const j = view.radial(i, way);
          if (j < 0) continue;
          const a = ((view.keyOf(i)[0] % 3) + 3) % 3;
          const b = ((view.keyOf(j)[0] % 3) + 3) % 3;
          expect(a).not.toBe(b);
        }
      }
    }
  });

  it("hold the angular position exactly — the move is along the sector median", () => {
    // On the triangle the sector ray is vertical, so x must not move at all.
    const canvas = buildFigure(4);
    const view = latticeView(canvas);
    for (let i = 0; i < view.cellCount; i++) {
      const j = view.radial(i, "out");
      if (j < 0) continue;
      expect(
        Math.abs(canvas.cells[j].centroid[0] - canvas.cells[i].centroid[0])
      ).toBeLessThan(1e-9);
    }
  });

  it("move exactly one band of family A on the triangle", () => {
    const canvas = buildFigure(4);
    const view = latticeView(canvas);
    let moved = 0;
    for (let i = 0; i < view.cellCount; i++) {
      const j = view.radial(i, "out");
      if (j < 0) continue;
      expect(view.rowOf(j)).toBe(view.rowOf(i) + 1);
      moved++;
    }
    expect(moved).toBeGreaterThan(0);
  });

  it("strictly increase the ring index on the hexagon", () => {
    const canvas = buildHexagon(3);
    const view = latticeView(canvas);
    let moved = 0;
    for (let i = 0; i < view.cellCount; i++) {
      const j = view.radial(i, "out");
      if (j < 0) continue;
      expect(view.ringOf(j)).toBeGreaterThan(view.ringOf(i));
      moved++;
    }
    expect(moved).toBeGreaterThan(0);
  });

  it("are inverse to each other wherever both exist", () => {
    for (const canvas of [buildFigure(3), buildHexagon(3)]) {
      const view = latticeView(canvas);
      for (let i = 0; i < view.cellCount; i++) {
        const j = view.radial(i, "out");
        if (j < 0) continue;
        expect(view.radial(j, "in")).toBe(i);
      }
    }
  });
});

// ── the cluster reaches everything ───────────────────────────────────────

describe("the eight keys together", () => {
  it("reach every cell of both canvases from any start", () => {
    for (const canvas of [buildFigure(3), buildHexagon(2)]) {
      const view = latticeView(canvas);
      const seen = new Set<number>([0]);
      const queue = [0];
      for (let q = 0; q < queue.length; q++) {
        const i = queue[q];
        const next: number[] = [];
        for (const dir of RING_DIRS) next.push(view.step(i, dir));
        next.push(view.radial(i, "out"), view.radial(i, "in"));
        for (const j of next) {
          if (j < 0 || seen.has(j)) continue;
          seen.add(j);
          queue.push(j);
        }
      }
      expect(seen.size).toBe(view.cellCount);
    }
  });
});

// ── the ring index ───────────────────────────────────────────────────────

describe("the ring index", () => {
  it("is the shell of the key on the hexagon — relief.ts's own ring", () => {
    const canvas = buildHexagon(3);
    const view = latticeView(canvas);
    for (const c of canvas.cells) expect(view.ringOf(c.i)).toBe(shell(c.key));
  });

  it("is symmetric in the three barycentric coordinates on the triangle", () => {
    for (const d of DEPTHS) {
      const canvas = buildFigure(d);
      const view = latticeView(canvas);
      const scale = 2 ** d;
      for (const c of canvas.cells) {
        const want = Math.max(
          Math.abs(c.key[0] - scale),
          Math.abs(c.key[1] - scale),
          Math.abs(c.key[2] - scale)
        );
        expect(view.ringOf(c.i)).toBe(want);
      }
    }
  });

  it("puts the hub alone at ring 0 on the triangle", () => {
    for (const d of DEPTHS) {
      const canvas = buildFigure(d);
      const view = latticeView(canvas);
      expect(view.ring(0)).toEqual([canvas.hub]);
    }
  });

  it("is constant on every orbit of the whole-plate group", () => {
    const canvas = buildHexagon(2);
    const view = latticeView(canvas);
    const surface = hexagonSurface(canvas);
    for (const mode of [2, 3, 6, 12] as const) {
      for (let i = 0; i < view.cellCount; i++) {
        for (const j of surface.orbit(i, mode)) {
          expect(view.ringOf(j)).toBe(view.ringOf(i));
        }
      }
    }
  });

  it("partitions the canvas", () => {
    for (const canvas of [buildFigure(4), buildHexagon(3)]) {
      const view = latticeView(canvas);
      let total = 0;
      for (const r of view.ringValues) total += view.ring(r).length;
      expect(total).toBe(view.cellCount);
    }
  });
});

// ── the along coordinate, and the segment ────────────────────────────────

describe("the along-band coordinate", () => {
  it("is injective on every band of every family, on both canvases", () => {
    for (const canvas of [buildFigure(4), buildHexagon(3)]) {
      const view = latticeView(canvas);
      const bands = buildBandSurface(canvas);
      for (const f of BAND_FAMILIES) {
        for (const ix of bands.bands(f)) {
          const seen = new Set<number>();
          for (const c of bands.band(ix)) {
            const t = alongBand(view, c, f);
            expect(seen.has(t)).toBe(false);
            seen.add(t);
          }
        }
      }
    }
  });
});

describe("the line", () => {
  it("is a contiguous run of one exact band", () => {
    const canvas = buildFigure(4);
    const view = latticeView(canvas);
    const bands = buildBandSurface(canvas);
    for (let a = 0; a < view.cellCount; a += 7) {
      for (let b = 0; b < view.cellCount; b += 11) {
        const line = lineCells(view, bands, a, b);
        const whole = new Set(bands.bandThrough(a, line.family));
        for (const c of line.cells) expect(whole.has(c)).toBe(true);
        // Contiguous: the along coordinates of the run are exactly the ones the
        // band holds between the two ends.
        const ts = line.cells.map((c) => alongBand(view, c, line.family));
        const lo = Math.min(...ts);
        const hi = Math.max(...ts);
        const inside = bands
          .bandThrough(a, line.family)
          .filter((c) => {
            const t = alongBand(view, c, line.family);
            return t >= lo && t <= hi;
          });
        expect(line.cells.length).toBe(inside.length);
      }
    }
  });

  it("always contains its anchor", () => {
    const canvas = buildHexagon(2);
    const view = latticeView(canvas);
    const bands = buildBandSurface(canvas);
    for (let a = 0; a < view.cellCount; a += 5) {
      for (let b = 0; b < view.cellCount; b += 13) {
        expect(lineCells(view, bands, a, b).cells).toContain(a);
      }
    }
  });

  it("is a single cell when the drag never left the anchor", () => {
    const canvas = buildFigure(3);
    const view = latticeView(canvas);
    const bands = buildBandSurface(canvas);
    for (let a = 0; a < view.cellCount; a++) {
      expect(lineCells(view, bands, a, a).cells).toEqual([a]);
    }
  });

  it("snaps to a family whose band really does contain the target", () => {
    // The guarantee, and it is the one the tool needs: whenever the release cell
    // lies on ANY band through the anchor, the family chosen is one whose band
    // holds it. Two cells of one rhombus share TWO of the three lines — the
    // upright (a,b,c) and the inverted (a,b,c−1) agree on families A and B — so
    // "the" family is not always unique, and the honest claim is this one.
    for (const canvas of [buildFigure(4), buildHexagon(3)]) {
      const view = latticeView(canvas);
      const bands = buildBandSurface(canvas);
      for (const f of BAND_FAMILIES) {
        for (let a = 0; a < view.cellCount; a += 9) {
          for (const target of bands.bandThrough(a, f)) {
            if (target === a) continue;
            const got = lineFamily(bands, a, target);
            expect(bands.bandThrough(a, got)).toContain(target);
          }
        }
      }
    }
  });

  it("picks the unique family when the target lies on exactly one band", () => {
    const canvas = buildFigure(4);
    const view = latticeView(canvas);
    const bands = buildBandSurface(canvas);
    let checked = 0;
    for (const f of BAND_FAMILIES) {
      for (let a = 0; a < view.cellCount; a += 9) {
        for (const target of bands.bandThrough(a, f)) {
          if (target === a) continue;
          const shared = BAND_FAMILIES.filter(
            (g) => bands.bandOf(target, g).line === bands.bandOf(a, g).line
          );
          if (shared.length !== 1) continue;
          expect(lineFamily(bands, a, target)).toBe(f);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("reaches the same distance both ways when symmetric", () => {
    const canvas = buildFigure(4);
    const view = latticeView(canvas);
    const bands = buildBandSurface(canvas);
    for (let a = 0; a < view.cellCount; a += 13) {
      for (let b = 0; b < view.cellCount; b += 17) {
        const one = lineCells(view, bands, a, b, false);
        const two = lineCells(view, bands, a, b, true);
        expect(two.cells.length).toBeGreaterThanOrEqual(one.cells.length);
        const t0 = alongBand(view, a, two.family);
        const ts = two.cells.map((c) => alongBand(view, c, two.family));
        // Every cell of the symmetric run is within the reach of the anchor.
        for (const t of ts) expect(Math.abs(t - t0)).toBeLessThanOrEqual(two.reach);
      }
    }
  });
});

// ── the ring set ─────────────────────────────────────────────────────────

describe("the ring set", () => {
  it("is exactly one shell when the drag never left the anchor", () => {
    const canvas = buildHexagon(3);
    const view = latticeView(canvas);
    for (let i = 0; i < view.cellCount; i += 23) {
      const r = view.ringOf(i);
      const spec = ringCells(view, r, r);
      expect(spec.cells).toEqual(view.ring(r));
      for (const c of spec.cells) expect(view.ringOf(c)).toBe(r);
    }
  });

  it("is closed under the whole isometry group on the hexagon", () => {
    const canvas = buildHexagon(2);
    const view = latticeView(canvas);
    const surface = hexagonSurface(canvas);
    for (const r of view.ringValues) {
      const set = new Set(view.ring(r));
      for (const c of set) {
        for (const j of surface.orbit(c, 12)) expect(set.has(j)).toBe(true);
      }
    }
  });

  it("is closed under D₃ on the triangle", () => {
    const canvas = buildFigure(3);
    const view = latticeView(canvas);
    const surface = triangleSurface(canvas);
    for (const r of view.ringValues) {
      const set = new Set(view.ring(r));
      for (const c of set) {
        for (const j of surface.orbit(c, 6)) expect(set.has(j)).toBe(true);
      }
    }
  });

  it("grows monotonically as the drag reaches further", () => {
    const canvas = buildHexagon(2);
    const view = latticeView(canvas);
    const rs = view.ringValues;
    let last = 0;
    for (const r of rs) {
      const n = ringCells(view, rs[0], r).cells.length;
      expect(n).toBeGreaterThanOrEqual(last);
      last = n;
    }
    expect(last).toBe(view.cellCount);
  });
});

// ── composing with the brush ─────────────────────────────────────────────

describe("a shape under a brush", () => {
  it("paints six lines under a 6-fold hexagon brush", () => {
    const canvas = buildHexagon(2);
    const bands = buildBandSurface(canvas);
    const surface = hexagonSurface(canvas);
    const seed = 40;
    const row = bands.bandThrough(seed, "A");
    const stamp = imageStamp(surface, 6, row);
    expect(stamp.groups).not.toBeNull();
    expect(stamp.span).toBe(6);
    // The flattened union is the orbit of the set, and nothing is listed twice.
    expect(new Set(stamp.cells).size).toBe(stamp.cells.length);
    for (const c of row) expect(stamp.cells).toContain(c);
  });

  it("collapses to one group when the shape is already invariant", () => {
    const canvas = buildHexagon(2);
    const view = latticeView(canvas);
    const surface = hexagonSurface(canvas);
    const r = view.ringValues[1];
    const stamp = imageStamp(surface, 12, view.ring(r));
    expect(stamp.span).toBe(1);
  });

  it("gives an invariant ring a full colour period by orbit position", () => {
    const canvas = buildHexagon(2);
    const view = latticeView(canvas);
    const surface = hexagonSurface(canvas);
    const r = view.ringValues[1];
    const cells = view.ring(r);
    const stamp = orbitStamp(surface, 6, cells);
    expect(stamp.cells.length).toBe(cells.length);
    expect(stamp.span).toBe(6);
    expect(new Set(stamp.keys).size).toBe(6);
  });

  it("keeps a sector-scoped shape inside its sector", () => {
    const canvas = buildHexagon(2);
    const bands = buildBandSurface(canvas);
    const surface = hexagonSurface(canvas, "sector");
    const seed = 40;
    const row = bands.bandThrough(seed, "A");
    const clipped = clipToRegion(surface, seed, row);
    expect(clipped.length).toBeLessThan(row.length);
    const region = surface.regionOf(seed);
    for (const c of clipped) expect(surface.regionOf(c)).toBe(region);
    for (const c of imageStamp(surface, 6, clipped).cells) {
      expect(surface.regionOf(c)).toBe(region);
    }
  });

  it("is empty for an empty source rather than throwing", () => {
    const canvas = buildFigure(2);
    const surface = triangleSurface(canvas);
    expect(imageStamp(surface, 6, []).cells).toEqual([]);
    expect(orbitStamp(surface, 6, []).cells).toEqual([]);
  });
});
