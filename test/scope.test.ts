import { describe, expect, it } from "vitest";
import { bandOrbit, bandOrbitGrouped, buildBandSurface, BAND_FAMILIES } from "../src/lib/bands";
import { brushSpan, brushStamp } from "../src/lib/brush";
import { TRIANGLE_SUBGROUPS } from "../src/lib/orbit";
import {
  buildHexagon,
  HEX_ISOMETRIES,
  indexMap,
  type Hexagon,
} from "../src/lib/hexagon";
import {
  hexagonSurface,
  orbitPartition,
  SCOPE_MODES,
  subgroupMaps,
  type BrushMode,
  type BrushScope,
} from "../src/lib/orbit";
import { sectorFrame, symmetryGuides, type HexagonFrame } from "../src/lib/guides";

/**
 * The SECTOR scopes.
 *
 * The claim under test is not that they work but that they are NEW: a sector's
 * own D3 is not a subgroup of the hexagon's D6, and cannot be, because every
 * spine mirror of D6 reflects two opposite sectors at once and every rotation of
 * D6 moves every sector. What is measured here is exactly that — that the
 * element lists are groups, that they are groups D6 does not contain, and that
 * the brush, the bands and the axis overlay all agree about where the scope
 * stops.
 */

const DEPTHS = [1, 2, 3];
const SCOPES: BrushScope[] = ["hexagon", "sector", "sector6"];

/** (a ∘ b)(x) = a[b[x]]. */
const compose = (a: number[], b: number[]) => b.map((_, x) => a[b[x]]);

const sectorsOf = (hex: Hexagon, cells: readonly number[]) =>
  new Set(cells.map((i) => hex.cells[i].sector));

// ── the element lists really are groups ──────────────────────────────────

describe("each scope names a genuine group", () => {
  for (const scope of SCOPES) {
    it(`${scope}: the element maps close under composition`, () => {
      const hex = buildHexagon(2, "apex");
      const surface = hexagonSurface(hex, scope);
      for (const mode of SCOPE_MODES[scope]) {
        const maps = subgroupMaps(surface, mode);
        const sigs = new Set(maps.map((m) => m.join()));
        expect([scope, mode, sigs.size]).toEqual([scope, mode, maps.length]);
        for (const a of maps) {
          for (const b of maps) {
            expect([scope, mode, sigs.has(compose(a, b).join())]).toEqual([
              scope,
              mode,
              true,
            ]);
          }
        }
      }
    });
  }

  it("the order is the mode, except at SECTOR ×6 where it is six times it", () => {
    const hex = buildHexagon(2, "apex");
    for (const scope of SCOPES) {
      const surface = hexagonSurface(hex, scope);
      for (const mode of SCOPE_MODES[scope]) {
        const want = scope === "sector6" ? 6 * mode : mode;
        expect([scope, mode, surface.order(mode)]).toEqual([scope, mode, want]);
        expect([scope, mode, subgroupMaps(surface, mode).length]).toEqual([
          scope,
          mode,
          want,
        ]);
      }
    }
  });

  it("every map is a permutation of the whole cell set", () => {
    const hex = buildHexagon(2, "apex");
    for (const scope of SCOPES) {
      const surface = hexagonSurface(hex, scope);
      for (const mode of SCOPE_MODES[scope]) {
        for (const m of subgroupMaps(surface, mode)) {
          expect([scope, mode, new Set(m).size]).toEqual([
            scope,
            mode,
            hex.cells.length,
          ]);
        }
      }
    }
  });
});

// ── and they are groups D6 does not contain ──────────────────────────────

describe("the sector groups are new structure, not a subset of D6", () => {
  it("no sector-local element but the identity is one of the twelve", () => {
    const hex = buildHexagon(2, "apex");
    const d6 = new Set(HEX_ISOMETRIES.map((g) => indexMap(hex, g).join()));
    const identity = hex.cells.map((c) => c.i).join();
    const local = subgroupMaps(hexagonSurface(hex, "sector"), 6);
    const shared = local.filter((m) => d6.has(m.join()));
    // Only the identity is common. In particular the sector's own m_A — its
    // spine mirror — is NOT the hexagon's m30/m90/m150, which reflect the
    // opposite sector at the same time.
    expect(shared.map((m) => m.join())).toEqual([identity]);
  });

  it("SECTOR ×6 meets D6 in exactly the six rotations", () => {
    const hex = buildHexagon(2, "apex");
    const rotations = new Set(
      HEX_ISOMETRIES.filter((g) => !g.flip).map((g) => indexMap(hex, g).join())
    );
    const all = new Set(HEX_ISOMETRIES.map((g) => indexMap(hex, g).join()));
    const group = subgroupMaps(hexagonSurface(hex, "sector6"), 6);
    const shared = new Set(group.map((m) => m.join()).filter((s) => all.has(s)));
    expect([shared.size, [...shared].every((s) => rotations.has(s))]).toEqual([
      6,
      true,
    ]);
  });
});

// ── orbits ───────────────────────────────────────────────────────────────

describe("orbits under a scope", () => {
  for (const d of DEPTHS) {
    it(`d=${d}: every scope and mode partitions the cells, seed included`, () => {
      const hex = buildHexagon(d, "apex");
      for (const scope of SCOPES) {
        const surface = hexagonSurface(hex, scope);
        for (const mode of SCOPE_MODES[scope]) {
          const seen = new Set<number>();
          for (const o of orbitPartition(surface, mode)) {
            for (const j of o) {
              expect([scope, mode, seen.has(j)]).toEqual([scope, mode, false]);
              seen.add(j);
            }
          }
          expect([scope, mode, seen.size]).toEqual([
            scope,
            mode,
            hex.cells.length,
          ]);
          for (let i = 0; i < hex.cells.length; i++) {
            expect([scope, mode, i, surface.orbit(i, mode).includes(i)]).toEqual(
              [scope, mode, i, true]
            );
          }
        }
      }
    });
  }

  for (const d of DEPTHS) {
    it(`d=${d}: a SECTOR orbit never leaves the cell's own sector`, () => {
      const hex = buildHexagon(d, "apex");
      const surface = hexagonSurface(hex, "sector");
      for (const mode of SCOPE_MODES.sector) {
        for (const c of hex.cells) {
          const orbit = surface.orbit(c.i, mode);
          expect([mode, c.i, [...sectorsOf(hex, orbit)]]).toEqual([
            mode,
            c.i,
            [c.sector],
          ]);
        }
      }
    });
  }

  it("a SECTOR ×6 orbit is the local orbit in all six sectors", () => {
    const hex = buildHexagon(2, "apex");
    const local = hexagonSurface(hex, "sector");
    const six = hexagonSurface(hex, "sector6");
    for (const mode of SCOPE_MODES.sector6) {
      for (const c of hex.cells) {
        const here = local.orbit(c.i, mode);
        const all = six.orbit(c.i, mode);
        expect([mode, c.i, all.length]).toEqual([mode, c.i, 6 * here.length]);
        expect([mode, c.i, [...sectorsOf(hex, all)].sort()]).toEqual([
          mode,
          c.i,
          [0, 1, 2, 3, 4, 5],
        ]);
        // The local orbit is exactly the part of it in the seed's own sector.
        expect([mode, c.i, all.filter((j) => hex.cells[j].sector === c.sector)]).toEqual(
          [mode, c.i, here]
        );
      }
    }
  });

  it("the local action is the base triangle's, sector by sector", () => {
    // The point of the whole scope: sector s is a copy of the base figure, so
    // its orbit is the triangle's orbit read through `base`.
    const hex = buildHexagon(2, "apex");
    const surface = hexagonSurface(hex, "sector");
    for (const mode of SCOPE_MODES.sector) {
      expect(TRIANGLE_SUBGROUPS[mode as 1 | 2 | 3 | 6].length).toBe(mode);
      const byBase = new Map<string, Set<number>>();
      for (const c of hex.cells) {
        const bases = surface
          .orbit(c.i, mode)
          .map((j) => hex.cells[j].base)
          .sort((a, b) => a - b)
          .join(",");
        const at = byBase.get(`${c.base}`) ?? new Set<string>();
        (at as Set<string>).add(bases);
        byBase.set(`${c.base}`, at as unknown as Set<number>);
      }
      // One answer per base cell, whichever sector it was reached through.
      for (const [base, answers] of byBase) {
        expect([mode, base, (answers as unknown as Set<string>).size]).toEqual([
          mode,
          base,
          1,
        ]);
      }
    }
  });
});

// ── regions, and the band that must respect them ─────────────────────────

describe("a band in SECTOR scope is clipped to the sector", () => {
  it("regionOf is the sector under SECTOR and 0 under the others", () => {
    const hex = buildHexagon(2, "apex");
    for (const scope of SCOPES) {
      const surface = hexagonSurface(hex, scope);
      for (const c of hex.cells) {
        expect([scope, c.i, surface.regionOf(c.i)]).toEqual([
          scope,
          c.i,
          scope === "sector" ? c.sector : 0,
        ]);
      }
    }
  });

  for (const d of DEPTHS) {
    it(`d=${d}: the band orbit stays inside the sector, and the unclipped one does not`, () => {
      const hex = buildHexagon(d, "apex");
      const bands = buildBandSurface(hex);
      const scoped = hexagonSurface(hex, "sector");
      const plate = hexagonSurface(hex, "hexagon");
      let escaped = 0;
      for (const family of BAND_FAMILIES) {
        for (const mode of SCOPE_MODES.sector) {
          for (const c of hex.cells) {
            const cells = bandOrbit(scoped, bands, c.i, family, mode);
            expect([family, mode, c.i, [...sectorsOf(hex, cells)]]).toEqual([
              family,
              mode,
              c.i,
              [c.sector],
            ]);
          }
        }
        // The same band under the plate's own group crosses seams — which is
        // correct there, and is exactly what the clipping exists to prevent
        // being carried into a scope that says "this sector only".
        for (const c of hex.cells) {
          if (sectorsOf(hex, bandOrbit(plate, bands, c.i, family, 1)).size > 1) {
            escaped++;
          }
        }
      }
      expect(escaped).toBeGreaterThan(0);
    });
  }

  it("clipping regroups the band without inventing or losing a cell", () => {
    const hex = buildHexagon(2, "apex");
    const bands = buildBandSurface(hex);
    const surface = hexagonSurface(hex, "sector");
    for (const family of BAND_FAMILIES) {
      for (const mode of SCOPE_MODES.sector) {
        for (const c of hex.cells) {
          const groups = bandOrbitGrouped(surface, bands, c.i, family, mode);
          const flat = [...new Set(groups.flat())].sort((a, b) => a - b);
          expect([family, mode, c.i, flat]).toEqual([
            family,
            mode,
            c.i,
            bandOrbit(surface, bands, c.i, family, mode),
          ]);
          const stamp = brushStamp(surface, bands, c.i, { mode, band: family });
          expect([family, mode, c.i, stamp.span]).toEqual([
            family,
            mode,
            c.i,
            groups.length,
          ]);
        }
      }
    }
  });

  /**
   * MEASURED, and it is why `brushSpan` grew a seed.
   *
   * A hexagon band clipped to sector s is a band of the base triangle in family
   * (A, B, C)[s mod 3], because the sector is a rotated copy. ⟨m_A⟩ fixes a
   * family-A band and swaps B with C, so a mode-2 sector brush spans one row in
   * the sectors where the family lands on A and two in the rest.
   */
  it("the span of a sector band depends on the sector, and this is the census", () => {
    const hex = buildHexagon(2, "apex");
    const bands = buildBandSurface(hex);
    const surface = hexagonSurface(hex, "sector");
    const census: Record<string, number[]> = {};
    for (const mode of SCOPE_MODES.sector) {
      for (const family of BAND_FAMILIES) {
        census[`${mode}${family}`] = [0, 1, 2, 3, 4, 5].map((s) => {
          const seed = hex.cells.find((c) => c.sector === s)!.i;
          return brushSpan(surface, bands, { mode, band: family }, seed);
        });
      }
    }
    expect(census["2A"]).toEqual([1, 2, 2, 1, 2, 2]);
    expect(census["1A"]).toEqual([1, 1, 1, 1, 1, 1]);
    expect(census["3A"]).toEqual([3, 3, 3, 3, 3, 3]);
    expect(census["6A"]).toEqual([3, 3, 3, 3, 3, 3]);
  });
});

// ── the overlay follows the scope ────────────────────────────────────────

describe("the axis overlay never promises a symmetry the brush lacks", () => {
  const frame: HexagonFrame = { kind: "hexagon", centre: [100, 100], radius: 40 };

  it("SECTOR draws that sector's three medians and no diameter", () => {
    for (const s of [0, 1, 2, 3, 4, 5]) {
      const g = symmetryGuides(frame, 6, [s]);
      expect([s, g.mirrors.map((m) => m.id)]).toEqual([s, ["m_A", "m_B", "m_C"]]);
      expect([s, g.mirrors.map((m) => m.sector)]).toEqual([s, [s, s, s]]);
      expect([s, g.mirrors.every((m) => m.family === "median")]).toEqual([s, true]);
      // The rotation is about the SECTOR's centroid, never the plate's.
      expect([s, g.rotation]).toEqual([s, null]);
      expect([s, g.local.length]).toEqual([s, 1]);
      expect([s, g.local[0].order]).toEqual([s, 3]);
      expect([s, g.local[0].cx === 100 && g.local[0].cy === 100]).toEqual([s, false]);
    }
  });

  it("SECTOR at mode 3 draws no mirror at all", () => {
    const g = symmetryGuides(frame, 3, [2]);
    expect(g.mirrors).toEqual([]);
    expect(g.local.length).toBe(1);
  });

  it("SECTOR ×6 draws all six copies plus the C6 about the centre", () => {
    const g = symmetryGuides(frame, 6, [0, 1, 2, 3, 4, 5], 6);
    expect(g.mirrors.length).toBe(18);
    expect(new Set(g.mirrors.map((m) => m.sector)).size).toBe(6);
    expect(g.local.length).toBe(6);
    expect(g.rotation?.order).toBe(6);
    expect([g.rotation?.cx, g.rotation?.cy]).toEqual([100, 100]);
  });

  it("the whole-plate overlay is untouched", () => {
    expect(symmetryGuides(frame, 12).mirrors.map((m) => m.id)).toEqual([
      "m0", "m30", "m60", "m90", "m120", "m150",
    ]);
    expect(symmetryGuides(frame, 12).mirrors.every((m) => m.sector === undefined)).toBe(
      true
    );
    expect(symmetryGuides(frame, 12).local).toEqual([]);
  });

  it("a sector frame has the plate's centre as its apex, and two corners", () => {
    // Vertex A at the centre is what makes the sector's m_A its spine — see the
    // note on `sectorFrame`. Corners land on the circumradius.
    for (const s of [0, 1, 2, 3, 4, 5]) {
      const f = sectorFrame(frame, s);
      expect([s, f.corners[0]]).toEqual([s, frame.centre]);
      for (const k of [1, 2] as const) {
        const r = Math.hypot(f.corners[k][0] - 100, f.corners[k][1] - 100);
        expect([s, k, Math.abs(r - 40) < 1e-9]).toEqual([s, k, true]);
      }
    }
  });
});

// ── the whole-plate scope is exactly what it was ─────────────────────────

describe("nothing about the hexagon scope moved", () => {
  it("orbits and band orbits agree with the default surface", () => {
    for (const d of DEPTHS) {
      const hex = buildHexagon(d, "apex");
      const bands = buildBandSurface(hex);
      const now = hexagonSurface(hex, "hexagon");
      const before = hexagonSurface(hex);
      for (const mode of SCOPE_MODES.hexagon) {
        for (const c of hex.cells) {
          expect(now.orbit(c.i, mode)).toEqual(before.orbit(c.i, mode));
        }
        for (const family of BAND_FAMILIES) {
          expect(bandOrbit(now, bands, 0, family, mode)).toEqual(
            bandOrbit(before, bands, 0, family, mode)
          );
        }
        expect(brushSpan(now, bands, { mode: mode as BrushMode, band: null })).toBe(mode);
      }
    }
  });
});
