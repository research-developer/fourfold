import { describe, expect, it } from "vitest";
import {
  BAND_FAMILIES,
  bandOrbit,
  bandSizeCensus,
  bandSizes,
  buildBandSurface,
  buildBands,
  type BandFamily,
  type BandSurface,
} from "../src/lib/bands";
import { buildFigure, type Figure } from "../src/lib/figure";
import {
  baryToLat,
  buildHexagon,
  rotK,
  type Hexagon,
  type Lat,
} from "../src/lib/hexagon";
import {
  buildSurface,
  hexagonSurface,
  triangleSurface,
  type BrushMode,
} from "../src/lib/orbit";

const TRI_DEPTHS = [1, 2, 3, 4];
const HEX_DEPTHS = [1, 2, 3];

/**
 * The band index recomputed from the cell's THREE VERTICES rather than from the
 * summed key, so the test does not merely re-run the model's arithmetic.
 *
 * A cell occupies the strip between two consecutive lattice lines, so the strip
 * is named by the SMALLEST value the coordinate takes on the cell's corners —
 * an entirely different route to the same integer than `floor(key/3)`.
 */
function triStrip(fig: Figure, i: number, family: BandFamily): number {
  const slot = family === "A" ? 0 : family === "B" ? 1 : 2;
  return Math.min(...fig.cells[i].bary.map((v) => v[slot]));
}

/**
 * `rot` negates a coordinate, so a zero lattice coordinate comes back as −0 and
 * `Math.min` propagates it. The model never meets one — a key coordinate is
 * ≡ 1 or 2 (mod 3) and therefore never zero — but this helper works from the
 * raw vertices, where zeros are ordinary, so it normalises before comparing.
 */
const unmin0 = (x: number) => (Object.is(x, -0) ? 0 : x);

function hexStrip(hex: Hexagon, i: number, family: BandFamily): number {
  const c = hex.cells[i];
  const lats = hex.base.cells[c.base].bary.map((v) =>
    rotK(baryToLat(v), c.sector)
  );
  const value = (p: Lat) =>
    family === "A" ? p[0] + p[1] : family === "B" ? p[0] : p[1];
  return unmin0(Math.min(...lats.map(value)));
}

// ── the derivation's linchpin ────────────────────────────────────────────

describe("no key coordinate is divisible by three", () => {
  /**
   * The whole module rests on it. A key coordinate is 3·(corner) + 1 on an
   * upright cell and 3·(corner) + 2 on an inverted one, never 3·(corner), so
   * floor-dividing by three lands on the corner rather than straddling two
   * strips. If a cell ever produced a coordinate ≡ 0 (mod 3) the band it was
   * placed in would be a coin toss.
   */
  const mod3 = (x: number) => ((x % 3) + 3) % 3;

  it("triangle keys are ≡ 1 (mod 3) upright and ≡ 2 (mod 3) inverted", () => {
    for (const d of TRI_DEPTHS) {
      const fig = buildFigure(d);
      for (const c of fig.cells) {
        const want = c.eps === 0 ? 1 : 2;
        expect([d, c.addr, c.key.map(mod3)]).toEqual([
          d,
          c.addr,
          [want, want, want],
        ]);
      }
    }
  });

  it("hexagon keys, and their sum, avoid 0 (mod 3) in every sector", () => {
    for (const d of HEX_DEPTHS) {
      const hex = buildHexagon(d);
      for (const c of hex.cells) {
        // `eps` is the DRAWN orientation, flipped on odd sectors; the lattice
        // sees the drawn one, so that is the one the residue follows.
        const want = c.eps === 0 ? 1 : 2;
        expect([d, c.i, c.key.map(mod3)]).toEqual([d, c.i, [want, want]]);
        expect([d, c.i, mod3(c.key[0] + c.key[1])]).toEqual([
          d,
          c.i,
          want === 1 ? 2 : 1,
        ]);
      }
    }
  });
});

// ── the model agrees with an independent derivation ──────────────────────

describe("band membership is the strip the cell's corners name", () => {
  it("triangle, every family, every cell, depths 1–4", () => {
    for (const d of TRI_DEPTHS) {
      const fig = buildFigure(d);
      const bs = buildBandSurface(fig);
      for (const f of BAND_FAMILIES) {
        for (const c of fig.cells) {
          expect([d, f, c.addr, bs.bandOf(c.i, f)]).toEqual([
            d,
            f,
            c.addr,
            { family: f, line: triStrip(fig, c.i, f) },
          ]);
        }
      }
    }
  });

  it("hexagon, every family, every cell, depths 1–3", () => {
    for (const d of HEX_DEPTHS) {
      const hex = buildHexagon(d);
      const bs = buildBandSurface(hex);
      for (const f of BAND_FAMILIES) {
        for (const c of hex.cells) {
          expect([d, f, c.i, bs.bandOf(c.i, f)]).toEqual([
            d,
            f,
            c.i,
            { family: f, line: hexStrip(hex, c.i, f) },
          ]);
        }
      }
    }
  });
});

// ── the partition ────────────────────────────────────────────────────────

function checkPartition(bs: BandSurface, label: string) {
  for (const f of BAND_FAMILIES) {
    const seen = new Map<number, number>();
    for (const ix of bs.bands(f)) {
      const cells = bs.band(ix);
      expect([label, f, ix.line, cells.length > 0]).toEqual([
        label,
        f,
        ix.line,
        true,
      ]);
      // Ascending, and free of repeats.
      expect([label, f, ix.line, cells]).toEqual([
        label,
        f,
        ix.line,
        [...new Set(cells)].sort((a, b) => a - b),
      ]);
      for (const i of cells) {
        expect([label, f, i, seen.has(i)]).toEqual([label, f, i, false]);
        seen.set(i, ix.line);
      }
    }
    expect([label, f, seen.size]).toEqual([label, f, bs.cellCount]);

    for (let i = 0; i < bs.cellCount; i++) {
      expect([label, f, i, bs.bandOf(i, f).line]).toEqual([
        label,
        f,
        i,
        seen.get(i),
      ]);
      expect([label, f, i, bs.bandThrough(i, f).includes(i)]).toEqual([
        label,
        f,
        i,
        true,
      ]);
    }
  }
}

describe("bands of one family partition the cell set", () => {
  it("triangle, depths 1–4, all three families", () => {
    for (const d of TRI_DEPTHS) checkPartition(buildBands("triangle", d), `tri d${d}`);
  });

  it("hexagon, depths 1–3, all three families", () => {
    for (const d of HEX_DEPTHS) checkPartition(buildBands("hexagon", d), `hex d${d}`);
  });

  it("both conventions partition alike", () => {
    for (const d of TRI_DEPTHS) {
      checkPartition(buildBands("triangle", d, "ifs"), `tri-ifs d${d}`);
    }
    for (const d of HEX_DEPTHS) {
      checkPartition(buildBands("hexagon", d, "ifs"), `hex-ifs d${d}`);
    }
  });
});

// ── the triangle's 2r+1 law ──────────────────────────────────────────────

describe("triangle band sizes are exactly 2r+1", () => {
  it("depths 1–4, all three families, apex-to-base", () => {
    for (const d of TRI_DEPTHS) {
      const bs = buildBands("triangle", d);
      for (const f of BAND_FAMILIES) {
        const sizes = bandSizes(bs, f);
        expect([d, f, sizes.length]).toEqual([d, f, 2 ** d]);
        expect([d, f, sizes]).toEqual([
          d,
          f,
          Array.from({ length: 2 ** d }, (_, r) => 2 * r + 1),
        ]);
        expect([d, f, sizes.reduce((a, b) => a + b, 0)]).toEqual([d, f, 4 ** d]);
      }
    }
  });

  it("the exact tables at depth 2 and depth 3", () => {
    for (const f of BAND_FAMILIES) {
      expect([f, bandSizes(buildBands("triangle", 2), f)]).toEqual([
        f,
        [1, 3, 5, 7],
      ]);
      expect([f, bandSizes(buildBands("triangle", 3), f)]).toEqual([
        f,
        [1, 3, 5, 7, 9, 11, 13, 15],
      ]);
    }
  });

  it("band r holds r+1 upright cells and r inverted ones", () => {
    for (const d of TRI_DEPTHS) {
      const fig = buildFigure(d);
      const bs = buildBandSurface(fig);
      for (const f of BAND_FAMILIES) {
        bs.bands(f).forEach((ix, r) => {
          const cells = bs.band(ix);
          const up = cells.filter((i) => fig.cells[i].eps === 0).length;
          expect([d, f, r, up, cells.length - up]).toEqual([d, f, r, r + 1, r]);
        });
      }
    }
  });

  it("the apex band is the single corner cell of that family's vertex", () => {
    // Under the apex convention a corner child keeps the parent's corner as its
    // role-A vertex, so the cell in the corner at vertex V has address V·A^(d−1).
    for (const d of TRI_DEPTHS) {
      const fig = buildFigure(d);
      const bs = buildBandSurface(fig);
      const want: Record<BandFamily, string> = {
        A: "A".repeat(d),
        B: "B" + "A".repeat(d - 1),
        C: "C" + "A".repeat(d - 1),
      };
      for (const f of BAND_FAMILIES) {
        const apex = bs.band(bs.bands(f)[0]);
        expect([d, f, apex.length]).toEqual([d, f, 1]);
        expect([d, f, fig.cells[apex[0]].addr]).toEqual([d, f, want[f]]);
      }
    }
  });

  it("apex-to-base order is descending line, ending at the opposite edge", () => {
    for (const d of TRI_DEPTHS) {
      const bs = buildBands("triangle", d);
      for (const f of BAND_FAMILIES) {
        const lines = bs.bands(f).map((ix) => ix.line);
        expect([d, f, lines]).toEqual([
          d,
          f,
          Array.from({ length: 2 ** d }, (_, r) => 2 ** d - 1 - r),
        ]);
      }
    }
  });
});

// ── the hexagon, measured rather than assumed ────────────────────────────

describe("hexagon band sizes are NOT uniform", () => {
  /**
   * Measured, not predicted. With S = 2^d there are 2S bands per family on
   * lines −S … S−1; the two central strips (lines −1 and 0, the pair either
   * side of the origin) are the longest at 4S−1 cells and the sizes fall by 2
   * in each direction to 2S+1 at the rim, so every size appears exactly twice
   * and the distribution is symmetric about the centre. A model that assumed
   * uniformity would be asserting something false.
   */
  const S = (d: number) => 2 ** d;
  const reflect = (t: number) => (t >= 0 ? t : -1 - t);

  it("the exact tables at depth 2 and depth 3", () => {
    for (const f of BAND_FAMILIES) {
      expect([f, bandSizes(buildBands("hexagon", 2), f)]).toEqual([
        f,
        [9, 11, 13, 15, 15, 13, 11, 9],
      ]);
      expect([f, bandSizes(buildBands("hexagon", 3), f)]).toEqual([
        f,
        [17, 19, 21, 23, 25, 27, 29, 31, 31, 29, 27, 25, 23, 21, 19, 17],
      ]);
    }
    expect([...bandSizeCensus(buildBands("hexagon", 2), "A")]).toEqual([
      [9, 2],
      [11, 2],
      [13, 2],
      [15, 2],
    ]);
  });

  it("lines run −2^d … 2^d−1 and sizes follow 4S−1−2|reflected line|", () => {
    for (const d of HEX_DEPTHS) {
      const bs = buildBands("hexagon", d);
      for (const f of BAND_FAMILIES) {
        const ixs = bs.bands(f);
        expect([d, f, ixs.map((x) => x.line)]).toEqual([
          d,
          f,
          Array.from({ length: 2 * S(d) }, (_, k) => k - S(d)),
        ]);
        for (const ix of ixs) {
          expect([d, f, ix.line, bs.band(ix).length]).toEqual([
            d,
            f,
            ix.line,
            4 * S(d) - 1 - 2 * reflect(ix.line),
          ]);
        }
        expect([d, f, bandSizes(bs, f).reduce((a, b) => a + b, 0)]).toEqual([
          d,
          f,
          6 * 4 ** d,
        ]);
      }
    }
  });

  it("every band crosses sector seams — exactly three sectors, always", () => {
    for (const d of HEX_DEPTHS) {
      const hex = buildHexagon(d);
      const bs = buildBandSurface(hex);
      for (const f of BAND_FAMILIES) {
        for (const ix of bs.bands(f)) {
          const sectors = new Set(bs.band(ix).map((i) => hex.cells[i].sector));
          expect([d, f, ix.line, sectors.size]).toEqual([d, f, ix.line, 3]);
        }
      }
    }
  });
});

// ── conventions ──────────────────────────────────────────────────────────

describe("the two conventions cut the same bands", () => {
  /**
   * The same care `orbit.ts` takes with orbits. The `apex` and `ifs` recursions
   * cut the same triangles but hand them out in a different order from depth 2,
   * so the bands agree as sets of TRIANGLES — compared by exact key — and
   * generally disagree as sets of indices.
   */
  it("bands match as key sets at depths 1–4", () => {
    for (const d of TRI_DEPTHS) {
      const apex = buildFigure(d, "apex");
      const ifs = buildFigure(d, "ifs");
      const ba = buildBandSurface(apex);
      const bi = buildBandSurface(ifs);
      for (const f of BAND_FAMILIES) {
        const keysOf = (fig: Figure, bs: BandSurface) =>
          bs
            .bands(f)
            .map((ix) => bs.band(ix).map((i) => fig.cells[i].key.join(",")).sort());
        expect([d, f, keysOf(ifs, bi)]).toEqual([d, f, keysOf(apex, ba)]);
      }
    }
  });
});

// ── bands under symmetry ─────────────────────────────────────────────────

describe("bandOrbit composes a band with a brush", () => {
  const triModes: BrushMode[] = [1, 2, 3, 6];
  const hexModes: BrushMode[] = [1, 2, 3, 6, 12];

  it("mode 1 leaves the band exactly as it was", () => {
    const fig = buildFigure(3);
    const bs = buildBandSurface(fig);
    const sf = triangleSurface(fig);
    for (const f of BAND_FAMILIES) {
      for (let i = 0; i < fig.cells.length; i += 7) {
        expect([f, i, bandOrbit(sf, bs, i, f, 1)]).toEqual([
          f,
          i,
          bs.bandThrough(i, f),
        ]);
      }
    }
  });

  it("the result contains the band, is deduplicated and ascending", () => {
    const hex = buildHexagon(2);
    const bs = buildBandSurface(hex);
    const sf = hexagonSurface(hex);
    for (const mode of hexModes) {
      for (const f of BAND_FAMILIES) {
        for (let i = 0; i < hex.cells.length; i += 5) {
          const got = bandOrbit(sf, bs, i, f, mode);
          const band = bs.bandThrough(i, f);
          expect([mode, f, i, band.every((j) => got.includes(j))]).toEqual([
            mode,
            f,
            i,
            true,
          ]);
          expect([mode, f, i, got]).toEqual([
            mode,
            f,
            i,
            [...new Set(got)].sort((a, b) => a - b),
          ]);
        }
      }
    }
  });

  it("the result is closed under the subgroup — it is a union of orbits", () => {
    for (const [surface, bs, modes] of [
      [triangleSurface(buildFigure(3)), buildBands("triangle", 3), triModes],
      [hexagonSurface(buildHexagon(2)), buildBands("hexagon", 2), hexModes],
    ] as const) {
      for (const mode of modes) {
        for (const f of BAND_FAMILIES) {
          for (let i = 0; i < surface.cellCount; i += 11) {
            const got = new Set(bandOrbit(surface, bs, i, f, mode));
            for (const j of got) {
              for (const k of surface.orbit(j, mode)) {
                expect([surface.kind, mode, f, i, j, k, got.has(k)]).toEqual([
                  surface.kind,
                  mode,
                  f,
                  i,
                  j,
                  k,
                  true,
                ]);
              }
            }
          }
        }
      }
    }
  });

  it("a triangle family-A band is already closed under m_A", () => {
    // m_A fixes α and swaps β with γ, so it carries a constant-α band to
    // itself. Families B and C are NOT closed under it — measured below, so
    // the first claim is not vacuous.
    const fig = buildFigure(3);
    const bs = buildBandSurface(fig);
    const sf = triangleSurface(fig);
    let movedB = 0;
    for (let i = 0; i < fig.cells.length; i++) {
      expect([i, bandOrbit(sf, bs, i, "A", 2)]).toEqual([
        i,
        bs.bandThrough(i, "A"),
      ]);
      if (bandOrbit(sf, bs, i, "B", 2).length > bs.bandThrough(i, "B").length) {
        movedB++;
      }
    }
    expect(movedB).toBe(fig.cells.length);
  });

  it("on the triangle the 3-fold and 6-fold band orbits coincide", () => {
    // D3 = C3 ∪ C3·m_A and m_A preserves the family-A bands, so adding the
    // reflections to the rotations adds nothing to any band's orbit — and by
    // the C3 action permuting the three families, the same holds for B and C.
    const fig = buildFigure(3);
    const bs = buildBandSurface(fig);
    const sf = triangleSurface(fig);
    for (const f of BAND_FAMILIES) {
      for (let i = 0; i < fig.cells.length; i += 3) {
        expect([f, i, bandOrbit(sf, bs, i, f, 6)]).toEqual([
          f,
          i,
          bandOrbit(sf, bs, i, f, 3),
        ]);
      }
    }
  });

  it("on the hexagon the 6-fold and 12-fold band orbits coincide", () => {
    const hex = buildHexagon(2);
    const bs = buildBandSurface(hex);
    const sf = hexagonSurface(hex);
    for (const f of BAND_FAMILIES) {
      for (let i = 0; i < hex.cells.length; i += 3) {
        expect([f, i, bandOrbit(sf, bs, i, f, 12)]).toEqual([
          f,
          i,
          bandOrbit(sf, bs, i, f, 6),
        ]);
      }
    }
  });

  it("refuses to mix two different canvases", () => {
    const bs = buildBands("triangle", 3);
    const sf = buildSurface("hexagon", 2);
    expect(() => bandOrbit(sf, bs, 0, "A", 1)).toThrow(/not the same canvas/);
  });
});

// ── the surface's contract ───────────────────────────────────────────────

describe("the band surface reports and guards itself", () => {
  it("both canvases carry exactly the three families", () => {
    for (const bs of [buildBands("triangle", 2), buildBands("hexagon", 2)]) {
      expect([bs.kind, bs.families]).toEqual([bs.kind, ["A", "B", "C"]]);
    }
    expect(buildBands("triangle", 2).cellCount).toBe(16);
    expect(buildBands("hexagon", 2).cellCount).toBe(96);
  });

  it("a cell off the surface, or a line with no band, is an error", () => {
    const bs = buildBands("triangle", 2);
    expect(() => bs.bandOf(-1, "A")).toThrow(/not on this triangle/);
    expect(() => bs.bandOf(16, "A")).toThrow(/not on this triangle/);
    expect(() => bs.bandOf(1.5, "A")).toThrow(/not on this triangle/);
    expect(() => bs.band({ family: "A", line: 99 })).toThrow(/no band on line/);
    expect(() => bs.bandOf(0, "D" as BandFamily)).toThrow(/no family D/);
  });

  it("a returned band cannot be used to corrupt the surface", () => {
    const bs = buildBands("triangle", 3);
    const first = bs.bandThrough(0, "A");
    first.length = 0;
    expect(bs.bandThrough(0, "A").length).toBeGreaterThan(0);
  });

  it("the methods survive being destructured off the surface", () => {
    const { band, bandOf, bandThrough, bands } = buildBands("hexagon", 2);
    expect(bands("A").length).toBe(8);
    expect(band(bandOf(0, "A"))).toEqual(bandThrough(0, "A"));
  });
});
