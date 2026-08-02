import { describe, expect, it } from "vitest";
import { buildFigure } from "../src/lib/figure";
import {
  buildHexagon,
  census,
  closedFormMap,
  HEX_ISOMETRIES,
  hexIsometryReport,
  indexMap,
  latKey,
  mutantRotMap,
  refl,
  rot,
  rotK,
  triangleCensus,
  type Hexagon,
  type HexIsometry,
} from "../src/lib/hexagon";

import hexD1 from "./golden/hex_d1.json";
import hexD2 from "./golden/hex_d2.json";
import hexD3 from "./golden/hex_d3.json";

const CONVENTIONS = ["apex", "ifs"] as const;
const GOLDENS = [hexD1, hexD2, hexD3];

// ── the lattice itself ───────────────────────────────────────────────────

describe("the Eisenstein lattice action is exact and integer", () => {
  it("rot has order 6 and refl is an involution, on a spread of points", () => {
    const pts = [
      [1, 0],
      [0, 1],
      [3, -1],
      [-2, 5],
      [7, 7],
      [0, 0],
    ] as const;
    // Normalise -0 to 0: negating a zero coordinate produces -0, which
    // toEqual distinguishes and the lattice does not.
    const z = (v: readonly [number, number]) => [v[0] + 0, v[1] + 0];
    for (const p of pts) {
      expect(z(rotK(p, 6))).toEqual(z(p));
      expect(z(refl(refl(p)))).toEqual(z(p));
      // rot^3 is the inversion x -> -x.
      expect(z(rotK(p, 3))).toEqual(z([-p[0], -p[1]]));
    }
  });

  it("every coordinate stays an integer — no float can leak in", () => {
    let v: readonly [number, number] = [5, -3];
    for (let i = 0; i < 24; i++) {
      v = i % 2 ? refl(v) : rot(v);
      expect(Number.isInteger(v[0])).toBe(true);
      expect(Number.isInteger(v[1])).toBe(true);
    }
  });
});

// ── structure ────────────────────────────────────────────────────────────

describe("the hexagon is six sectors of the triangle", () => {
  for (const conv of CONVENTIONS) {
    for (const d of [1, 2, 3, 4]) {
      it(`${conv} d=${d}: 6·4^d cells, all keys distinct`, () => {
        const hex = buildHexagon(d, conv);
        expect(hex.cells.length).toBe(6 * 4 ** d);
        expect(new Set(hex.cells.map((c) => latKey(c.key))).size).toBe(
          hex.cells.length
        );
        // Six equal sectors.
        for (let s = 0; s < 6; s++) {
          expect(hex.cells.filter((c) => c.sector === s).length).toBe(4 ** d);
        }
      });
    }
  }

  it("leaves the triangle untouched — same cells, same charges", () => {
    for (const conv of CONVENTIONS) {
      const hex = buildHexagon(3, conv);
      const tri = buildFigure(3, conv);
      expect(hex.base.cells.length).toBe(tri.cells.length);
      for (let i = 0; i < tri.cells.length; i++) {
        expect(hex.base.cells[i].charge).toBe(tri.cells[i].charge);
        expect(hex.base.cells[i].addr).toBe(tri.cells[i].addr);
      }
    }
  });
});

// ── the index law ────────────────────────────────────────────────────────

describe("the D6 index law, derived rather than assumed", () => {
  for (const conv of CONVENTIONS) {
    for (const d of [1, 2, 3]) {
      it(`${conv} d=${d}: closed form equals the lattice-derived map`, () => {
        const hex = buildHexagon(d, conv);
        for (const g of HEX_ISOMETRIES) {
          expect([g.name, indexMap(hex, g)]).toEqual([
            g.name,
            closedFormMap(hex, g),
          ]);
        }
      });
    }
  }

  /**
   * The planted mutation. The obvious prose reading puts the median mirror μ
   * on rot60 -- (s,c) ↦ (s+1, μ(c)) -- and makes the reflections'
   * μ parity-dependent. Under an INTRINSIC cell index that is geometrically
   * wrong: μ belongs uniformly on the six reflections and nowhere on the
   * rotations. This test commits the mutation, not the belief.
   */
  it("the μ-on-rot60 candidate is caught", () => {
    const hex = buildHexagon(3, "apex");
    const differing = HEX_ISOMETRIES.filter(
      (g) => indexMap(hex, g).join() !== mutantRotMap(hex, g).join()
    );
    expect(differing.length).toBeGreaterThan(0);
    // Specifically: it is the odd rotations that the mutation corrupts.
    expect(differing.map((g) => g.name).sort()).toEqual(
      ["r60", "r180", "r300"].sort()
    );
  });

  it("the mutation also breaks the group — it is not merely a relabelling", () => {
    const hex = buildHexagon(2, "apex");
    const maps = HEX_ISOMETRIES.map((g) => mutantRotMap(hex, g));
    const sigs = new Set(maps.map((m) => m.join()));
    let escapes = 0;
    for (let i = 0; i < 12; i++) {
      for (let j = 0; j < 12; j++) {
        const comp = maps[i].map((_, x) => maps[i][maps[j][x]]);
        if (!sigs.has(comp.join())) escapes++;
      }
    }
    expect(escapes).toBeGreaterThan(0);
  });
});

// ── the group ────────────────────────────────────────────────────────────

/** D6 product: r_i·r_j = r_{i+j}, r_i·m_j = m_{i+j}, m_i·r_j = m_{i-j}, m_i·m_j = r_{i-j}. */
function d6Product(a: HexIsometry, b: HexIsometry): string {
  const mod6 = (x: number) => ((x % 6) + 6) % 6;
  if (!a.flip && !b.flip) return `r${mod6(a.k + b.k)}`;
  if (!a.flip && b.flip) return `m${mod6(a.k + b.k)}`;
  if (a.flip && !b.flip) return `m${mod6(a.k - b.k)}`;
  return `r${mod6(a.k - b.k)}`;
}

function tag(g: HexIsometry): string {
  return `${g.flip ? "m" : "r"}${g.k}`;
}

describe("the twelve isometries are D6", () => {
  for (const conv of CONVENTIONS) {
    it(`${conv}: the Cayley table closes and matches D6`, () => {
      const hex = buildHexagon(2, conv);
      const maps = HEX_ISOMETRIES.map((g) => indexMap(hex, g));
      const byTag = new Map(HEX_ISOMETRIES.map((g, i) => [tag(g), maps[i]]));
      for (let i = 0; i < 12; i++) {
        for (let j = 0; j < 12; j++) {
          const a = HEX_ISOMETRIES[i];
          const b = HEX_ISOMETRIES[j];
          // (a ∘ b)(x) = a[b[x]]
          const comp = maps[j].map((_, x) => maps[i][maps[j][x]]);
          const want = byTag.get(d6Product(a, b))!;
          expect([tag(a), tag(b), comp.join()]).toEqual([
            tag(a),
            tag(b),
            want.join(),
          ]);
        }
      }
    });

    it(`${conv}: rot60^6 = id, rot60^3 = inversion, every mirror is an involution`, () => {
      for (const d of [1, 2, 3]) {
        const hex = buildHexagon(d, conv);
        const id = indexMap(hex, HEX_ISOMETRIES[0]);
        const r60 = indexMap(hex, HEX_ISOMETRIES[1]);

        let acc = id;
        for (let i = 0; i < 6; i++) acc = acc.map((_, x) => r60[acc[x]]);
        expect(acc.join()).toBe(id.join());

        let cube = id;
        for (let i = 0; i < 3; i++) cube = cube.map((_, x) => r60[cube[x]]);
        expect(cube.join()).toBe(
          indexMap(hex, HEX_ISOMETRIES.find((g) => g.name === "r180")!).join()
        );

        for (const g of HEX_ISOMETRIES.filter((x) => x.flip)) {
          const m = indexMap(hex, g);
          expect(m.map((_, x) => m[m[x]]).join()).toBe(id.join());
        }
      }
    });
  }
});

// ── render-space fixture ─────────────────────────────────────────────────

/**
 * The index maps are exact integer algebra; the drawing is float. This checks
 * they agree: for hand-picked cells, the mapped cell's screen centroid equals
 * the geometric rotation/reflection of the original's screen centroid about
 * the hexagon centre.
 */
function geoImage(
  hex: Hexagon,
  p: readonly [number, number],
  g: HexIsometry
): [number, number] {
  const [cx, cy] = hex.centre;
  // To maths coordinates (y up).
  const X = p[0] - cx;
  const Y = cy - p[1];
  let x: number, y: number;
  if (!g.flip) {
    const t = (Math.PI / 180) * 60 * g.k;
    x = X * Math.cos(t) - Y * Math.sin(t);
    y = X * Math.sin(t) + Y * Math.cos(t);
  } else {
    // Reflection in the line at angle 30k.
    const a = (Math.PI / 180) * 2 * 30 * g.k;
    x = X * Math.cos(a) + Y * Math.sin(a);
    y = X * Math.sin(a) - Y * Math.cos(a);
  }
  return [cx + x, cy - y];
}

describe("index maps agree with the drawing", () => {
  for (const conv of CONVENTIONS) {
    it(`${conv}: three cells per isometry land where geometry says`, () => {
      const hex = buildHexagon(3, conv);
      // Hand-picked: one deep in sector 0, one on a seam, one near the rim.
      const picks = [
        hex.cells.findIndex((c) => c.sector === 0 && c.addr === "AAA"),
        hex.cells.findIndex((c) => c.sector === 2 && c.addr === "XXX"),
        hex.cells.findIndex((c) => c.sector === 4 && c.addr === "BCB"),
      ];
      expect(picks.every((i) => i >= 0)).toBe(true);

      for (const g of HEX_ISOMETRIES) {
        const image = indexMap(hex, g);
        for (const i of picks) {
          const got = hex.cells[image[i]].centroid;
          const want = geoImage(hex, hex.cells[i].centroid, g);
          expect(got[0]).toBeCloseTo(want[0], 6);
          expect(got[1]).toBeCloseTo(want[1], 6);
        }
      }
    });
  }
});

// ── what the hexagon measures ────────────────────────────────────────────

describe("the lift table, measured", () => {
  for (const conv of CONVENTIONS) {
    it(`${conv}: all twelve lift exactly, and the relabelling splits by parity`, () => {
      const hex = buildHexagon(3, conv);
      const rows = hexIsometryReport(hex);
      expect(rows.length).toBe(12);
      for (const r of rows) {
        expect([r.name, r.exact]).toEqual([r.name, true]);
        expect(r.matches).toBe(6 * 4 ** 3);
      }
      // Rotations carry the identity relabelling; reflections carry
      // phi = (sigma2 sigma3), fixing gold and purple.
      const rot = rows.find((r) => r.name === "r60")!;
      expect([rot.best[0], rot.best[1], rot.best[2], rot.best[3]]).toEqual([
        0, 1, 2, 3,
      ]);
      const mir = rows.find((r) => r.name === "m30")!;
      expect([mir.best[0], mir.best[1], mir.best[2], mir.best[3]]).toEqual([
        0, 2, 1, 3,
      ]);
    });
  }

  it("so the hexagon canvas cannot see the convention difference", () => {
    // The triangle table separates the two conventions (order 2 vs order 6).
    // The hexagon table does not: it is identical either way. Recorded
    // because it is the point, not because it is convenient.
    const a = hexIsometryReport(buildHexagon(3, "apex")).map(
      (r) => `${r.name}:${r.matches}`
    );
    const b = hexIsometryReport(buildHexagon(3, "ifs")).map(
      (r) => `${r.name}:${r.matches}`
    );
    expect(a).toEqual(b);
  });
});

describe("the balance census", () => {
  for (const conv of CONVENTIONS) {
    for (const d of [1, 2, 3, 4]) {
      it(`${conv} d=${d}: hexagon balanced at 3·4^d, triangle off by 2^d`, () => {
        const hex = census(buildHexagon(d, conv));
        expect(hex.balanced).toBe(true);
        expect(hex.up).toBe(3 * 4 ** d);
        expect(hex.down).toBe(3 * 4 ** d);

        const tri = triangleCensus(buildFigure(d, conv));
        expect(tri.balanced).toBe(false);
        // up = (4^d + 2^d)/2, down = (4^d - 2^d)/2, so the gap is exactly 2^d.
        expect(tri.up - tri.down).toBe(2 ** d);
      });
    }
  }

  it("the balance comes from sector parity, not from missing corners", () => {
    // Three sectors are drawn in each lattice orientation, so the triangle's
    // 2^d surplus appears once with each sign and cancels. Every sector is a
    // COMPLETE triangle -- no corner is absent from the hexagon.
    const hex = buildHexagon(3, "apex");
    const even = hex.cells.filter((c) => c.sector % 2 === 0);
    const odd = hex.cells.filter((c) => c.sector % 2 === 1);
    const up = (xs: typeof hex.cells) => xs.filter((c) => c.eps === 0).length;
    expect(up(even) - (even.length - up(even))).toBe(3 * 2 ** 3);
    expect(up(odd) - (odd.length - up(odd))).toBe(-3 * 2 ** 3);
  });
});

// ── TS <-> Python parity ─────────────────────────────────────────────────

describe("TypeScript and Python agree", () => {
  GOLDENS.forEach((golden, idx) => {
    const d = idx + 1;
    it(`depth ${d}: identical lift tables and census, both conventions`, () => {
      expect(golden.depth).toBe(d);
      for (const conv of CONVENTIONS) {
        const want = (golden.conventions as Record<string, {
          lift: Record<string, { matches: number; total: number }>;
          hexCensus: { up: number; down: number; total: number };
          triangleCensus: { up: number; down: number; total: number };
        }>)[conv];

        const hex = buildHexagon(d, conv);
        for (const r of hexIsometryReport(hex)) {
          expect([conv, r.name, r.matches, r.total]).toEqual([
            conv,
            r.name,
            want.lift[r.name].matches,
            want.lift[r.name].total,
          ]);
        }

        const c = census(hex);
        expect([conv, c.up, c.down, c.total]).toEqual([
          conv,
          want.hexCensus.up,
          want.hexCensus.down,
          want.hexCensus.total,
        ]);

        const t = triangleCensus(buildFigure(d, conv));
        expect([conv, t.up, t.down, t.total]).toEqual([
          conv,
          want.triangleCensus.up,
          want.triangleCensus.down,
          want.triangleCensus.total,
        ]);
      }
    });
  });
});
