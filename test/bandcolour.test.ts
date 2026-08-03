/**
 * The band brush's COLOUR law, and the two cases that had to be measured.
 *
 * `bands.test.ts` already pins what a band is and what `bandOrbit` returns as a
 * set. This file is about the grouping that set threw away: an isometry carries
 * a lattice line to a lattice line, so the orbit of a band is a set of BANDS,
 * and the scheme is indexed by which image band a cell lies in rather than by
 * where the cell sits in the flattened list. Six rows, six hues, each row solid.
 *
 * Everything here is exact. Nothing compares a coordinate.
 */

import { describe, expect, it } from "vitest";
import {
  BAND_FAMILIES,
  bandOrbit,
  bandOrbitGrouped,
  buildBandSurface,
  type BandFamily,
  type BandSurface,
} from "../src/lib/bands";
import { brushCells, brushStamp, stampColours } from "../src/lib/brush";
import { ADJUSTMENTS } from "../src/lib/adjust";
import { buildFigure } from "../src/lib/figure";
import { buildHexagon } from "../src/lib/hexagon";
import {
  hexagonSurface,
  subgroupMaps,
  triangleSurface,
  HEXAGON_MODES,
  TRIANGLE_MODES,
  type BrushMode,
  type SymmetrySurface,
} from "../src/lib/orbit";
import { SCHEMES, swatchFromHex } from "../src/lib/schemes";

const TRI_DEPTHS = [1, 2, 3];
const HEX_DEPTHS = [1, 2, 3];

const BASE = swatchFromHex("#d4a017");

interface Canvas {
  label: string;
  surface: SymmetrySurface;
  bands: BandSurface;
  modes: BrushMode[];
}

function triangle(d: number): Canvas {
  const fig = buildFigure(d);
  return {
    label: `tri d${d}`,
    surface: triangleSurface(fig),
    bands: buildBandSurface(fig),
    modes: TRIANGLE_MODES,
  };
}

function hexagon(d: number): Canvas {
  const hex = buildHexagon(d);
  return {
    label: `hex d${d}`,
    surface: hexagonSurface(hex),
    bands: buildBandSurface(hex),
    modes: HEXAGON_MODES,
  };
}

const ALL: Canvas[] = [
  ...TRI_DEPTHS.map(triangle),
  ...HEX_DEPTHS.map(hexagon),
];

// ── the subgroup, published ──────────────────────────────────────────────

describe("subgroupMaps hands over the subgroup itself", () => {
  it("one permutation per element, identity first, on both canvases", () => {
    for (const { label, surface, modes } of ALL) {
      for (const mode of modes) {
        const maps = subgroupMaps(surface, mode);
        expect([label, mode, maps.length]).toEqual([label, mode, mode]);

        // Each map is a bijection of the cell set.
        for (let g = 0; g < maps.length; g++) {
          const m = maps[g];
          expect([label, mode, g, m.length]).toEqual([
            label,
            mode,
            g,
            surface.cellCount,
          ]);
          expect([label, mode, g, new Set(m).size]).toEqual([
            label,
            mode,
            g,
            surface.cellCount,
          ]);
        }

        // The first element is the identity — the ordering `bandOrbitGrouped`
        // and every colour downstream of it depend on.
        expect([label, mode, maps[0]]).toEqual([
          label,
          mode,
          Array.from({ length: surface.cellCount }, (_, i) => i),
        ]);
      }
    }
  });

  it("the orbit is exactly the set the maps produce", () => {
    // The consistency the grouping rests on. It holds because the subgroup
    // tables are COMPLETE groups rather than generating sets — `orbit()` takes
    // a closure and would still be right if they were not, while this equality
    // would quietly fail. So it is checked rather than argued.
    for (const { label, surface, modes } of ALL) {
      for (const mode of modes) {
        const maps = subgroupMaps(surface, mode);
        for (let i = 0; i < surface.cellCount; i++) {
          const byElement = [...new Set(maps.map((m) => m[i]))].sort(
            (a, b) => a - b
          );
          expect([label, mode, i, byElement]).toEqual([
            label,
            mode,
            i,
            surface.orbit(i, mode),
          ]);
        }
      }
    }
  });

  it("a returned map cannot be used to corrupt the surface", () => {
    const { surface } = triangle(3);
    const before = surface.orbit(5, 6);
    const maps = subgroupMaps(surface, 6);
    maps[1].fill(0);
    maps.length = 0;
    expect(surface.orbit(5, 6)).toEqual(before);
    expect(subgroupMaps(surface, 6).length).toBe(6);
  });
});

// ── the refactor changes the grouping and nothing else ───────────────────

describe("the grouped band orbit flattens back to bandOrbit exactly", () => {
  /**
   * The warrant for the whole change. `bandOrbit` decides which cells a stroke
   * TOUCHES and is not being altered; `bandOrbitGrouped` decides which of them
   * share a hue. If the flattened union ever drifted from `bandOrbit`, the band
   * brush would be painting a different set of cells than it did before, which
   * is not a colour change at all.
   */
  it("both canvases, all three families, every mode, depths 1–3, every cell", () => {
    for (const { label, surface, bands, modes } of ALL) {
      for (const mode of modes) {
        for (const f of BAND_FAMILIES) {
          for (let i = 0; i < surface.cellCount; i++) {
            const groups = bandOrbitGrouped(surface, bands, i, f, mode);
            const flat = [...new Set(groups.flat())].sort((a, b) => a - b);
            expect([label, mode, f, i, flat]).toEqual([
              label,
              mode,
              f,
              i,
              bandOrbit(surface, bands, i, f, mode),
            ]);
            // And the stamp the UI actually paints from agrees with both.
            expect([label, mode, f, i, brushStamp(surface, bands, i, {
              mode,
              band: f,
            }).cells]).toEqual([
              label,
              mode,
              f,
              i,
              brushCells(surface, bands, i, { mode, band: f }),
            ]);
          }
        }
      }
    }
  });

  it("the source band is group 0, ascending and unchanged", () => {
    for (const { label, surface, bands, modes } of ALL) {
      for (const mode of modes) {
        for (const f of BAND_FAMILIES) {
          for (let i = 0; i < surface.cellCount; i += 3) {
            const groups = bandOrbitGrouped(surface, bands, i, f, mode);
            expect([label, mode, f, i, groups[0]]).toEqual([
              label,
              mode,
              f,
              i,
              bands.bandThrough(i, f),
            ]);
          }
        }
      }
    }
  });

  it("every image is itself a band — a whole row of some family", () => {
    // The claim the law rests on: an isometry maps a lattice line to a lattice
    // line. If an image were merely a SUBSET of a band, colouring by image
    // index would leave part of a row a different colour, and the "rows come
    // out solid" promise would be false in exactly the way it is hard to see.
    for (const { label, surface, bands, modes } of ALL) {
      for (const mode of modes) {
        for (const f of BAND_FAMILIES) {
          for (let i = 0; i < surface.cellCount; i += 5) {
            for (const image of bandOrbitGrouped(surface, bands, i, f, mode)) {
              const whole = BAND_FAMILIES.some(
                (g) =>
                  bands.bandThrough(image[0], g).join(",") === image.join(",")
              );
              expect([label, mode, f, i, image[0], whole]).toEqual([
                label,
                mode,
                f,
                i,
                image[0],
                true,
              ]);
            }
          }
        }
      }
    }
  });
});

// ── a band FIXED by an element is not counted twice ──────────────────────

describe("a band fixed by a group element yields one image, not two", () => {
  /**
   * MEASURED, and the numbers are not the naive ones. The count of image bands
   * is |H| / |stabiliser of the band|, and the stabiliser is often non-trivial:
   *
   *   triangle mode 2, family A   m_A fixes α and swaps β with γ, so it carries
   *                               every family-A band to ITSELF — 1 image, not 2
   *   triangle mode 6             D3 = C3 ∪ C3·m_A and m_A adds no new image, so
   *                               a 6-fold brush gives THREE rows, not six
   *   hexagon  mode 12            the six reflections land on the six rotation
   *                               images, so D6 gives SIX rows, not twelve
   *
   * The middle line is the one worth stating loudest: "a 6-fold brush paints six
   * rows" is true on the hexagon and FALSE on the triangle, where the six-fold
   * brush is D3 and its band orbit is a triangle of three rows.
   */
  const SPAN: Record<string, Partial<Record<BrushMode, Record<BandFamily, number>>>> =
    {
      triangle: {
        1: { A: 1, B: 1, C: 1 },
        2: { A: 1, B: 2, C: 2 },
        3: { A: 3, B: 3, C: 3 },
        6: { A: 3, B: 3, C: 3 },
      },
      hexagon: {
        1: { A: 1, B: 1, C: 1 },
        2: { A: 2, B: 2, C: 2 },
        3: { A: 3, B: 3, C: 3 },
        6: { A: 6, B: 6, C: 6 },
        12: { A: 6, B: 6, C: 6 },
      },
    };

  it("the exact image count, for every cell of both canvases", () => {
    for (const { label, surface, bands, modes } of ALL) {
      const want = SPAN[surface.kind];
      for (const mode of modes) {
        for (const f of BAND_FAMILIES) {
          for (let i = 0; i < surface.cellCount; i++) {
            expect([
              label,
              mode,
              f,
              i,
              bandOrbitGrouped(surface, bands, i, f, mode).length,
            ]).toEqual([label, mode, f, i, want[mode]![f]]);
          }
        }
      }
    }
  });

  it("the image count does not depend on which cell of the row was clicked", () => {
    // It could have: a band nearer the centre might have a larger stabiliser.
    // Measured across every cell above; stated here as the fact the UI relies
    // on when it reports how many hues a band brush will use.
    for (const { label, surface, bands, modes } of ALL) {
      for (const mode of modes) {
        for (const f of BAND_FAMILIES) {
          const spans = new Set<number>();
          for (let i = 0; i < surface.cellCount; i++) {
            spans.add(bandOrbitGrouped(surface, bands, i, f, mode).length);
          }
          expect([label, mode, f, spans.size]).toEqual([label, mode, f, 1]);
        }
      }
    }
  });

  it("the fixed case really is fixed: m_A carries a family-A band to itself", () => {
    const { surface, bands } = triangle(3);
    const [mA] = subgroupMaps(surface, 2).slice(1);
    for (let i = 0; i < surface.cellCount; i++) {
      const band = bands.bandThrough(i, "A");
      expect([i, [...new Set(band.map((j) => mA[j]))].sort((a, b) => a - b)]).toEqual(
        [i, band]
      );
    }
  });
});

// ── image bands CROSS, and the tie is settled by rule ────────────────────

describe("crossing image bands take the lower group index", () => {
  /**
   * Also measured. Image bands are lines and lines meet, so a cell can lie in
   * two of them; a cell takes one colour, so something has to decide. The rule
   * is the lowest group index, which makes the source band — group 0 — keep
   * every cell it holds.
   *
   * How much this decides is not negligible and is not guesswork:
   *
   *   triangle d3, mode 3 or 6    0 crossing cells for 16 of the 64 seeds,
   *                               4 for 11 of them and 6 for the other 37
   *   triangle d3, mode 2, A      NONE — the single image is the source band
   *   hexagon  d2, mode 2         NONE at all: r180 carries a row to a PARALLEL
   *                               row, and parallel rows never meet
   *   hexagon  d2, mode 6 or 12   12 crossing cells for 70 of the 96 seeds and
   *                               24 for the other 26
   *
   * The hexagon's 12 is exactly the count the geometry predicts: six rotation
   * images fall into three parallel PAIRS, so 15 − 3 = 12 pairs actually cross,
   * one cell each.
   */
  const keyOf = (
    surface: SymmetrySurface,
    bands: BandSurface,
    i: number,
    f: BandFamily,
    mode: BrushMode
  ) => {
    const stamp = brushStamp(surface, bands, i, { mode, band: f });
    return new Map(stamp.cells.map((c, k) => [c, stamp.keys[k]]));
  };

  it("every cell's key is the LOWEST group index that holds it", () => {
    for (const { label, surface, bands, modes } of ALL) {
      for (const mode of modes) {
        for (const f of BAND_FAMILIES) {
          for (let i = 0; i < surface.cellCount; i += 3) {
            const groups = bandOrbitGrouped(surface, bands, i, f, mode);
            const keys = keyOf(surface, bands, i, f, mode);
            const lowest = new Map<number, number>();
            groups.forEach((g, k) => {
              for (const c of g) {
                if (!lowest.has(c)) lowest.set(c, k);
              }
            });
            expect([label, mode, f, i, [...keys].sort((a, b) => a[0] - b[0])]).toEqual(
              [label, mode, f, i, [...lowest].sort((a, b) => a[0] - b[0])]
            );
          }
        }
      }
    }
  });

  it("the source band keeps every one of its cells", () => {
    for (const { label, surface, bands, modes } of ALL) {
      for (const mode of modes) {
        for (const f of BAND_FAMILIES) {
          for (let i = 0; i < surface.cellCount; i += 3) {
            const keys = keyOf(surface, bands, i, f, mode);
            for (const c of bands.bandThrough(i, f)) {
              expect([label, mode, f, i, c, keys.get(c)]).toEqual([
                label,
                mode,
                f,
                i,
                c,
                0,
              ]);
            }
          }
        }
      }
    }
  });

  it("the exact crossing census, triangle depth 3 and hexagon depth 2", () => {
    const census = (c: Canvas, mode: BrushMode, f: BandFamily) => {
      const hist = new Map<number, number>();
      for (let i = 0; i < c.surface.cellCount; i++) {
        const groups = bandOrbitGrouped(c.surface, c.bands, i, f, mode);
        const held = new Map<number, number>();
        for (const g of groups) {
          for (const cell of g) held.set(cell, (held.get(cell) ?? 0) + 1);
        }
        const n = [...held.values()].filter((x) => x > 1).length;
        hist.set(n, (hist.get(n) ?? 0) + 1);
      }
      return [...hist].sort((a, b) => a[0] - b[0]);
    };

    const tri = triangle(3);
    expect(census(tri, 2, "A")).toEqual([[0, 64]]);
    expect(census(tri, 2, "B")).toEqual([
      [0, 16],
      [2, 48],
    ]);
    for (const mode of [3, 6] as BrushMode[]) {
      for (const f of BAND_FAMILIES) {
        expect([mode, f, census(tri, mode, f)]).toEqual([
          mode,
          f,
          [
            [0, 16],
            [4, 11],
            [6, 37],
          ],
        ]);
      }
    }

    const hex = hexagon(2);
    for (const f of BAND_FAMILIES) {
      expect([f, census(hex, 2, f)]).toEqual([f, [[0, 96]]]);
      expect([f, census(hex, 3, f)]).toEqual([
        f,
        [
          [0, 40],
          [6, 56],
        ],
      ]);
      for (const mode of [6, 12] as BrushMode[]) {
        expect([mode, f, census(hex, mode, f)]).toEqual([
          mode,
          f,
          [
            [12, 70],
            [24, 26],
          ],
        ]);
      }
    }
  });

  it("a cell shared by two rows is shared by AT MOST three", () => {
    // The hub of the triangle is in all three images at once, which is why the
    // rule has to be a total order on group indices and not a pairwise
    // tie-break. Nothing anywhere is in four.
    for (const { label, surface, bands, modes } of ALL) {
      let worst = 0;
      for (const mode of modes) {
        for (const f of BAND_FAMILIES) {
          for (let i = 0; i < surface.cellCount; i += 3) {
            const held = new Map<number, number>();
            for (const g of bandOrbitGrouped(surface, bands, i, f, mode)) {
              for (const c of g) held.set(c, (held.get(c) ?? 0) + 1);
            }
            worst = Math.max(worst, ...held.values());
          }
        }
      }
      expect([label, worst <= 3]).toEqual([label, true]);
    }
  });

  it("the rule is deterministic — the same seed always decides the same way", () => {
    const { surface, bands } = hexagon(2);
    for (let i = 0; i < surface.cellCount; i += 7) {
      const a = brushStamp(surface, bands, i, { mode: 6, band: "B" });
      const b = brushStamp(surface, bands, i, { mode: 6, band: "B" });
      expect([i, a.cells, a.keys, a.span]).toEqual([i, b.cells, b.keys, b.span]);
    }
  });
});

// ── the colours a stroke actually lays ───────────────────────────────────

const paintPlan = (schemeName: keyof typeof SCHEMES) => ({
  tool: "paint" as const,
  scheme: SCHEMES[schemeName],
  base: BASE,
  adjust: ADJUSTMENTS["hue+"],
});

describe("a 6-fold hexad band paints six rows, one hue each", () => {
  it("hexagon: exactly six colours, six rows, every seed", () => {
    const { surface, bands } = hexagon(2);
    for (const f of BAND_FAMILIES) {
      for (let i = 0; i < surface.cellCount; i++) {
        const stamp = brushStamp(surface, bands, i, { mode: 6, band: f });
        const colours = stampColours(paintPlan("hexad"), new Map(), stamp);
        expect([f, i, stamp.span, new Set(colours).size]).toEqual([f, i, 6, 6]);
        // The six are the hexad's own six hues, 60° apart from the base.
        expect([f, i, [...new Set(colours)].sort()]).toEqual([
          f,
          i,
          SCHEMES.hexad.offsets
            .map((_, k) => SCHEMES.hexad.at(BASE, k, 6).hex)
            .sort(),
        ]);
      }
    }
  });

  it("each row is ONE colour on every cell it owns", () => {
    /**
     * The exact form of "solid", and the crossings are the reason it needs one.
     * A row is uniform on the cells no earlier row claimed; the cells it shares
     * with an earlier row wear that row's colour, because a cell has one colour
     * and a crossing is a real crossing. Group 0 owns all of its cells, so the
     * row the user actually clicked is solid without qualification.
     */
    const { surface, bands } = hexagon(3);
    for (const f of BAND_FAMILIES) {
      for (let i = 0; i < surface.cellCount; i += 11) {
        const stamp = brushStamp(surface, bands, i, { mode: 6, band: f });
        const colours = stampColours(paintPlan("hexad"), new Map(), stamp);
        const at = new Map(stamp.cells.map((c, k) => [c, colours[k]]));
        const keyAt = new Map(stamp.cells.map((c, k) => [c, stamp.keys[k]]));

        (stamp.groups ?? []).forEach((row, g) => {
          const owned = row.filter((c) => keyAt.get(c) === g);
          expect([f, i, g, new Set(owned.map((c) => at.get(c))).size]).toEqual([
            f,
            i,
            g,
            1,
          ]);
          // Every row owns most of itself — a crossing is a cell, not a stripe.
          expect([f, i, g, owned.length > row.length / 2]).toEqual([
            f,
            i,
            g,
            true,
          ]);
        });

        // The clicked row is solid outright.
        const first = (stamp.groups ?? [])[0];
        expect([f, i, new Set(first.map((c) => at.get(c))).size]).toEqual([
          f,
          i,
          1,
        ]);
      }
    }
  });

  it("triangle: the same brush paints THREE rows, and says so", () => {
    // Not six. D3's band orbit is a triangle of three rows; see the fixed-band
    // note above. The scheme is indexed over three positions, so the hexad
    // spends its first three hues and the drawing is honest about the group.
    const { surface, bands } = triangle(4);
    for (const f of BAND_FAMILIES) {
      for (let i = 0; i < surface.cellCount; i += 7) {
        const stamp = brushStamp(surface, bands, i, { mode: 6, band: f });
        const colours = stampColours(paintPlan("hexad"), new Map(), stamp);
        expect([f, i, stamp.span, new Set(colours).size]).toEqual([f, i, 3, 3]);
        expect([f, i, [...new Set(colours)].sort()]).toEqual([
          f,
          i,
          [0, 1, 2].map((k) => SCHEMES.hexad.at(BASE, k, 3).hex).sort(),
        ]);
      }
    }
  });

  it("a 1-fold band is a single solid row", () => {
    for (const { label, surface, bands } of ALL) {
      for (const f of BAND_FAMILIES) {
        for (let i = 0; i < surface.cellCount; i += 5) {
          const stamp = brushStamp(surface, bands, i, { mode: 1, band: f });
          const colours = stampColours(paintPlan("hexad"), new Map(), stamp);
          expect([label, f, i, stamp.cells]).toEqual([
            label,
            f,
            i,
            bands.bandThrough(i, f),
          ]);
          expect([label, f, i, stamp.span, new Set(colours).size]).toEqual([
            label,
            f,
            i,
            1,
            1,
          ]);
          expect([label, f, i, colours[0]]).toEqual([
            label,
            f,
            i,
            SCHEMES.hexad.at(BASE, 0, 1).hex,
          ]);
        }
      }
    }
  });

  it("the flat rule really did paint speckle — this is a change, not a no-op", () => {
    /**
     * The regression this file exists for, stated as the difference it makes.
     * Indexing by list position hands the six hexad hues to six CONSECUTIVE
     * cells of the flattened list, and a row's cells are scattered through that
     * list rather than consecutive in it. Measured on one seed: the clicked row
     * holds nine cells and the old rule gave them SIX different colours — the
     * speckle the ask described. The new rule gives them one.
     */
    const { surface, bands } = hexagon(2);
    const stamp = brushStamp(surface, bands, 40, { mode: 6, band: "B" });
    const byBand = stampColours(paintPlan("hexad"), new Map(), stamp);
    const byPosition = stampColours(
      paintPlan("hexad"),
      new Map(),
      { ...stamp, keys: stamp.cells.map((_, k) => k), span: stamp.cells.length }
    );

    expect(new Set(byBand).size).toBe(6);
    expect(new Set(byPosition).size).toBe(6);

    const runs = (cs: (string | null)[], group: number[]) => {
      const at = new Map(stamp.cells.map((c, k) => [c, cs[k]]));
      return new Set(group.map((c) => at.get(c))).size;
    };
    const row = (stamp.groups ?? [])[0];
    expect(row.length).toBe(9);
    // One colour across the clicked row; six different ones the old way.
    expect(runs(byBand, row)).toBe(1);
    expect(runs(byPosition, row)).toBe(6);
  });

  it("no band means no grouping, and the orbit colours are untouched", () => {
    // The other half of "changes only the grouping": with `band: null` the
    // stamp is positional and identical to what `paintOrbit` always produced.
    for (const { label, surface, bands, modes } of ALL) {
      for (const mode of modes) {
        for (let i = 0; i < surface.cellCount; i += 5) {
          const stamp = brushStamp(surface, bands, i, { mode, band: null });
          expect([label, mode, i, stamp.groups]).toEqual([label, mode, i, null]);
          expect([label, mode, i, stamp.cells]).toEqual([
            label,
            mode,
            i,
            surface.orbit(i, mode),
          ]);
          expect([label, mode, i, stamp.keys]).toEqual([
            label,
            mode,
            i,
            stamp.cells.map((_, k) => k),
          ]);
          const got = stampColours(paintPlan("triad"), new Map(), stamp);
          expect([label, mode, i, got]).toEqual([
            label,
            mode,
            i,
            stamp.cells.map((_, k) => SCHEMES.triad.at(BASE, k, stamp.cells.length).hex),
          ]);
        }
      }
    }
  });
});
