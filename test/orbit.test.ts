import { describe, expect, it } from "vitest";
import { buildFigure } from "../src/lib/figure";
import { triangleIndexMap, type IsometryName } from "../src/lib/conventions";
import {
  buildHexagon,
  HEX_ISOMETRIES,
  indexMap,
  type HexIsometryName,
} from "../src/lib/hexagon";
import {
  buildSurface,
  HEXAGON_MODES,
  HEXAGON_SUBGROUPS,
  orbitPartition,
  orbitSizeCensus,
  TRIANGLE_MODES,
  TRIANGLE_SUBGROUPS,
  type BrushMode,
  type CanvasKind,
  type SymmetrySurface,
} from "../src/lib/orbit";

const CONVENTIONS = ["apex", "ifs"] as const;
const DEPTHS = [1, 2, 3];
const KINDS: CanvasKind[] = ["triangle", "hexagon"];

const modesOf = (kind: CanvasKind) =>
  kind === "triangle" ? TRIANGLE_MODES : HEXAGON_MODES;

/** size → count, as a plain object, so a whole census fits in one assertion. */
function census(surface: SymmetrySurface, mode: BrushMode) {
  return Object.fromEntries(orbitSizeCensus(surface, mode));
}

// ── the subgroups really are subgroups ───────────────────────────────────

/** (a ∘ b)(x) = a[b[x]]. */
const compose = (a: number[], b: number[]) => b.map((_, x) => a[b[x]]);

describe("the brush modes name genuine subgroups", () => {
  it("triangle: each element list closes under composition", () => {
    const figure = buildFigure(3, "apex");
    for (const mode of TRIANGLE_MODES) {
      const names = TRIANGLE_SUBGROUPS[mode as 1 | 2 | 3 | 6];
      expect([mode, names.length]).toEqual([mode, mode]);
      const maps = names.map((n) => triangleIndexMap(figure, n));
      const sigs = new Set(maps.map((m) => m.join()));
      for (const a of maps) {
        for (const b of maps) {
          expect([mode, sigs.has(compose(a, b).join())]).toEqual([mode, true]);
        }
      }
    }
  });

  it("hexagon: each element list closes under composition", () => {
    const hex = buildHexagon(2, "apex");
    const byName = new Map(HEX_ISOMETRIES.map((g) => [g.name, g]));
    for (const mode of HEXAGON_MODES) {
      const names = HEXAGON_SUBGROUPS[mode];
      expect([mode, names.length]).toEqual([mode, mode]);
      const maps = names.map((n) => indexMap(hex, byName.get(n)!));
      const sigs = new Set(maps.map((m) => m.join()));
      for (const a of maps) {
        for (const b of maps) {
          expect([mode, sigs.has(compose(a, b).join())]).toEqual([mode, true]);
        }
      }
    }
  });
});

// ── the partition property ───────────────────────────────────────────────

describe("orbits partition the cell set", () => {
  for (const conv of CONVENTIONS) {
    for (const kind of KINDS) {
      for (const d of DEPTHS) {
        it(`${conv} ${kind} d=${d}: every mode covers every cell exactly once`, () => {
          const surface = buildSurface(kind, d, conv);
          expect(surface.cellCount).toBe(
            kind === "triangle" ? 4 ** d : 6 * 4 ** d
          );

          for (const mode of modesOf(kind)) {
            const parts = orbitPartition(surface, mode);
            const seen = new Set<number>();
            let total = 0;
            for (const o of parts) {
              for (const j of o) {
                expect([mode, j, seen.has(j)]).toEqual([mode, j, false]);
                seen.add(j);
              }
              total += o.length;
            }
            expect([mode, total, seen.size]).toEqual([
              mode,
              surface.cellCount,
              surface.cellCount,
            ]);
          }
        });

        it(`${conv} ${kind} d=${d}: orbits contain their seed, sorted and deduplicated`, () => {
          const surface = buildSurface(kind, d, conv);
          for (const mode of modesOf(kind)) {
            for (let i = 0; i < surface.cellCount; i++) {
              const o = surface.orbit(i, mode);
              expect([mode, i, o.includes(i)]).toEqual([mode, i, true]);
              expect([mode, i, new Set(o).size]).toEqual([mode, i, o.length]);
              expect([mode, i, [...o].sort((a, b) => a - b)]).toEqual([
                mode,
                i,
                o,
              ]);
            }
          }
        });

        it(`${conv} ${kind} d=${d}: mode 1 is the trivial brush`, () => {
          const surface = buildSurface(kind, d, conv);
          for (let i = 0; i < surface.cellCount; i++) {
            expect(surface.orbit(i, 1)).toEqual([i]);
          }
        });

        it(`${conv} ${kind} d=${d}: membership is symmetric — j ∈ orbit(i) ⟺ i ∈ orbit(j)`, () => {
          const surface = buildSurface(kind, d, conv);
          for (const mode of modesOf(kind)) {
            for (let i = 0; i < surface.cellCount; i++) {
              const o = surface.orbit(i, mode);
              for (const j of o) {
                // Stronger than the stated ⟺: the two orbits are the same set,
                // which is what makes the partition well defined.
                expect([mode, i, j, surface.orbit(j, mode)]).toEqual([
                  mode,
                  i,
                  j,
                  o,
                ]);
              }
              // And the negative direction, on the first cell outside the orbit.
              const outside = [...Array(surface.cellCount).keys()].find(
                (j) => !o.includes(j)
              );
              if (outside !== undefined) {
                expect([mode, i, surface.orbit(outside, mode).includes(i)]).toEqual(
                  [mode, i, false]
                );
              }
            }
          }
        });
      }
    }
  }
});

// ── orbit–stabiliser, measured rather than assumed ───────────────────────

/** Index maps of every element of the mode's subgroup. */
function subgroupMaps(
  kind: CanvasKind,
  depth: number,
  conv: (typeof CONVENTIONS)[number],
  mode: BrushMode
): number[][] {
  if (kind === "triangle") {
    const figure = buildFigure(depth, conv);
    return (TRIANGLE_SUBGROUPS[mode as 1 | 2 | 3 | 6] as IsometryName[]).map(
      (n) => triangleIndexMap(figure, n)
    );
  }
  const hex = buildHexagon(depth, conv);
  const byName = new Map(HEX_ISOMETRIES.map((g) => [g.name, g]));
  return (HEXAGON_SUBGROUPS[mode] as HexIsometryName[]).map((n) =>
    indexMap(hex, byName.get(n)!)
  );
}

describe("|orbit| · |stabiliser| = |subgroup|", () => {
  for (const conv of CONVENTIONS) {
    for (const kind of KINDS) {
      for (const d of DEPTHS) {
        it(`${conv} ${kind} d=${d}: sizes divide the order, and equal it exactly when nothing is pinned`, () => {
          const surface = buildSurface(kind, d, conv);
          for (const mode of modesOf(kind)) {
            const maps = subgroupMaps(kind, d, conv, mode);
            for (let i = 0; i < surface.cellCount; i++) {
              const size = surface.orbit(i, mode).length;
              const stab = maps.filter((m) => m[i] === i).length;
              expect([mode, i, size * stab]).toEqual([mode, i, mode]);
              expect([mode, i, mode % size]).toEqual([mode, i, 0]);
              // "Exactly the order when the stabiliser is trivial" is the
              // stab === 1 half of the same identity, stated separately
              // because it is the half the brief gates on.
              if (stab === 1) expect([mode, i, size]).toEqual([mode, i, mode]);
            }
          }
        });
      }
    }
  }
});

// ── convention independence ──────────────────────────────────────────────

/**
 * The two conventions cut the SAME triangles — no cell moves and none changes
 * orientation — but from depth 2 they hand those triangles out in a different
 * ORDER, because `ifs` re-roles the B and C children and the recursion carries
 * that ordering down. Cell index 4 is therefore a different triangle under the
 * two conventions, and comparing index sets directly compares nothing.
 *
 * So compare through the exact integer key, which names the triangle itself.
 * This is the claim that actually matters for a drawing program: the brush is
 * geometric, so the shape a stroke paints is the same shape either way.
 */
function orbitsByKey(
  kind: CanvasKind,
  depth: number,
  conv: (typeof CONVENTIONS)[number],
  mode: BrushMode
): string[][] {
  const surface = buildSurface(kind, depth, conv);
  const keys =
    kind === "triangle"
      ? buildFigure(depth, conv).cells.map((c) => c.key.join(","))
      : buildHexagon(depth, conv).cells.map((c) => c.key.join(","));
  return orbitPartition(surface, mode)
    .map((o) => o.map((i) => keys[i]).sort())
    .sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
}

describe("the brush is geometric, so it cannot see the convention", () => {
  for (const kind of KINDS) {
    for (const d of DEPTHS) {
      it(`${kind} d=${d}: apex and ifs orbit the same triangles`, () => {
        for (const mode of modesOf(kind)) {
          expect([kind, mode, orbitsByKey(kind, d, "apex", mode)]).toEqual([
            kind,
            mode,
            orbitsByKey(kind, d, "ifs", mode),
          ]);
        }
      });
    }
  }

  it("and the index tables agree only where the two orderings agree", () => {
    // Recorded because it is a trap, not because it is convenient: at depth 1
    // the two conventions index cells identically, so a test written on raw
    // indices passes there and silently means nothing at depth 2.
    const same = (d: number) =>
      JSON.stringify(orbitPartition(buildSurface("triangle", d, "apex"), 6)) ===
      JSON.stringify(orbitPartition(buildSurface("triangle", d, "ifs"), 6));
    expect(same(1)).toBe(true);
    expect(same(2)).toBe(false);
    expect(same(3)).toBe(false);
    // The cells at a given index really are different triangles.
    expect(buildFigure(2, "apex").cells[4].key).not.toEqual(
      buildFigure(2, "ifs").cells[4].key
    );
  });
});

// ── the subgroup tower refines the partition ─────────────────────────────

describe("a larger subgroup coarsens the partition", () => {
  // Only along genuine containments. C2 and C3 are NOT nested in each other,
  // so 2 ≤ 3 is deliberately absent from both lists.
  const CHAINS: Record<CanvasKind, [BrushMode, BrushMode][]> = {
    triangle: [
      [1, 2],
      [1, 3],
      [2, 6],
      [3, 6],
    ],
    hexagon: [
      [1, 2],
      [1, 3],
      [2, 6],
      [3, 6],
      [6, 12],
    ],
  };

  for (const kind of KINDS) {
    it(`${kind}: every small orbit sits inside one large orbit`, () => {
      const surface = buildSurface(kind, 3, "apex");
      for (const [small, large] of CHAINS[kind]) {
        for (let i = 0; i < surface.cellCount; i++) {
          const inner = surface.orbit(i, small);
          const outer = surface.orbit(i, large);
          expect([small, large, i, inner.every((j) => outer.includes(j))]).toEqual(
            [small, large, i, true]
          );
        }
      }
    });

    it(`${kind}: C2 and C3 do not nest, and the orbits show it`, () => {
      const surface = buildSurface(kind, 2, "apex");
      const crossing = [...Array(surface.cellCount).keys()].some((i) =>
        surface.orbit(i, 2).some((j) => !surface.orbit(i, 3).includes(j))
      );
      expect(crossing).toBe(true);
    });
  }
});

// ── what is actually pinned, on the triangle ─────────────────────────────

describe("the triangle's pinned cells, measured", () => {
  for (const conv of CONVENTIONS) {
    for (const d of DEPTHS) {
      it(`${conv} d=${d}: the hub X^d is pinned by every mode`, () => {
        const figure = buildFigure(d, conv);
        const surface = buildSurface("triangle", d, conv);
        expect(figure.cells[figure.hub].addr).toBe("X".repeat(d));
        for (const mode of TRIANGLE_MODES) {
          expect([mode, surface.orbit(figure.hub, mode)]).toEqual([
            mode,
            [figure.hub],
          ]);
        }
      });

      it(`${conv} d=${d}: the mode-2 fixed cells are exactly the {A,X} addresses, 2^d of them`, () => {
        const figure = buildFigure(d, conv);
        const surface = buildSurface("triangle", d, conv);
        const pinned = figure.cells
          .filter((c) => surface.orbit(c.i, 2).length === 1)
          .map((c) => c.addr);
        // m_A fixes the barycentric slots B and C, so a cell survives it iff
        // its address never chooses between them — i.e. is a word over {A, X}.
        const axWords = figure.cells
          .filter((c) => /^[AX]+$/.test(c.addr))
          .map((c) => c.addr);
        expect(pinned).toEqual(axWords);
        expect(pinned.length).toBe(2 ** d);
      });

      it(`${conv} d=${d}: the orbit-size census is the closed form`, () => {
        const surface = buildSurface("triangle", d, conv);
        const n = 4 ** d;
        const t = 2 ** d;
        expect(census(surface, 1)).toEqual({ 1: n });
        // ⟨m_A⟩: 2^d fixed cells, the rest in mirror pairs.
        expect(census(surface, 2)).toEqual({ 1: t, 2: (n - t) / 2 });
        // ⟨rot+⟩: the hub alone is pinned; the rotations fix nothing else,
        // because only one cell can hold the centroid.
        expect(census(surface, 3)).toEqual({ 1: 1, 3: (n - 1) / 3 });
        // D3: the hub (order-6 stabiliser), the 2^d − 1 non-hub cells that lie
        // on exactly one median (order-2 stabiliser), and the free remainder.
        const d3: Record<number, number> = { 1: 1 };
        if (t - 1 > 0) d3[3] = t - 1;
        if (n - 3 * t + 2 > 0) d3[6] = (n - 3 * t + 2) / 6;
        expect(census(surface, 6)).toEqual(d3);
      });
    }
  }
});

// ── what is actually pinned, on the hexagon ──────────────────────────────

describe("the hexagon's pinned cells, measured", () => {
  /**
   * The brief expected "the hexagon centre" to be a pinned cell. It is not:
   * the centre of the hexagon is a lattice POINT, the shared apex of the six
   * sectors, and no cell sits on it. In the Eisenstein basis a non-trivial
   * rotation fixes only the origin, so a cell could only be pinned by a
   * rotation if its key were (0,0), and no cell's key is. Every rotational
   * brush on the hexagon is therefore FREE — mode 2, 3 and 6 orbits are always
   * exactly 2, 3 and 6 cells, with no exceptions at any depth.
   */
  for (const conv of CONVENTIONS) {
    for (const d of DEPTHS) {
      it(`${conv} d=${d}: the rotational modes are free — nothing is pinned`, () => {
        const surface = buildSurface("hexagon", d, conv);
        const n = 6 * 4 ** d;
        expect(census(surface, 1)).toEqual({ 1: n });
        expect(census(surface, 2)).toEqual({ 2: n / 2 });
        expect(census(surface, 3)).toEqual({ 3: n / 3 });
        expect(census(surface, 6)).toEqual({ 6: n / 6 });
      });

      it(`${conv} d=${d}: no cell key is the origin, which is why`, () => {
        const hex = buildHexagon(d, conv);
        expect(
          hex.cells.filter((c) => c.key[0] === 0 && c.key[1] === 0).length
        ).toBe(0);
      });

      it(`${conv} d=${d}: only the three SPINE mirrors pin anything`, () => {
        // m·R^s = R^(−1−s)·m sends sector s to k−1−s, so a reflection can fix a
        // sector only when 2s ≡ k−1 (mod 6). For the boundary mirrors k is even,
        // k−1 is odd, and there is no solution; for the spine mirrors there are
        // two, s = (k−1)/2 and that plus 3.
        const hex = buildHexagon(d, conv);
        const counts = HEX_ISOMETRIES.map((g) => {
          const m = indexMap(hex, g);
          return [g.name, m.filter((v, i) => v === i).length] as const;
        });
        const pinning = counts.filter(([, c]) => c > 0).map(([n]) => n);
        expect(pinning.sort()).toEqual(["m150", "m30", "m90", "r0"]);
        for (const name of ["m30", "m90", "m150"] as const) {
          expect([name, counts.find(([n]) => n === name)![1]]).toEqual([
            name,
            2 ** (d + 1),
          ]);
        }
      });

      it(`${conv} d=${d}: mode 12 splits into 2^d short orbits and the free rest`, () => {
        const surface = buildSurface("hexagon", d, conv);
        expect(census(surface, 12)).toEqual({
          6: 2 ** d,
          12: (4 ** d - 2 ** d) / 2,
        });
      });

      it(`${conv} d=${d}: the six centre-adjacent cells are one 6-orbit, in mode 6 AND mode 12`, () => {
        // The cells touching the hexagon centre are the six copies of the base
        // figure's apex cell A^d, one per sector. C6 already sweeps all six, and
        // D6 adds nothing: each is pinned by the spine mirror of its own sector,
        // so its stabiliser has order 2 and its D6 orbit is 12/2 = 6, not 12.
        const hex = buildHexagon(d, conv);
        const surface = buildSurface("hexagon", d, conv);
        const centre = hex.cells
          .filter((c) => c.addr === "A".repeat(d))
          .map((c) => c.i);
        expect(centre.length).toBe(6);
        expect(new Set(hex.cells.filter((c) => centre.includes(c.i)).map((c) => c.sector)).size).toBe(6);
        for (const i of centre) {
          expect([i, surface.orbit(i, 6)]).toEqual([i, [...centre].sort((a, b) => a - b)]);
          expect([i, surface.orbit(i, 12)]).toEqual([i, [...centre].sort((a, b) => a - b)]);
          expect([i, surface.orbit(i, 2).length, surface.orbit(i, 3).length]).toEqual([i, 2, 3]);
        }
      });
    }
  }
});

// ── the surface contract ─────────────────────────────────────────────────

describe("the surface contract", () => {
  it("advertises its modes, ascending, and rejects any other", () => {
    const tri = buildSurface("triangle", 2, "apex");
    const hex = buildSurface("hexagon", 2, "apex");
    expect(tri.modes).toEqual([1, 2, 3, 6]);
    expect(hex.modes).toEqual([1, 2, 3, 6, 12]);
    expect(tri.kind).toBe("triangle");
    expect(hex.kind).toBe("hexagon");
    // The triangle has no order-12 subgroup to offer.
    expect(() => tri.orbit(0, 12)).toThrow(/brush mode 12/);
  });

  it("rejects a cell index that is not on the surface", () => {
    const tri = buildSurface("triangle", 2, "apex");
    expect(() => tri.orbit(-1, 3)).toThrow(/not on this surface/);
    expect(() => tri.orbit(16, 3)).toThrow(/not on this surface/);
    expect(() => tri.orbit(1.5, 3)).toThrow(/not on this surface/);
  });

  it("hands back a copy, so a caller cannot corrupt the table", () => {
    const hex = buildSurface("hexagon", 2, "apex");
    const first = hex.orbit(0, 6);
    first.length = 0;
    first.push(-99);
    expect(hex.orbit(0, 6).length).toBe(6);
    expect(hex.orbit(0, 6)).not.toContain(-99);
  });

  it("is stable under repetition — the same call gives the same answer", () => {
    const tri = buildSurface("triangle", 3, "apex");
    for (const mode of TRIANGLE_MODES) {
      for (let i = 0; i < tri.cellCount; i += 7) {
        expect(tri.orbit(i, mode)).toEqual(tri.orbit(i, mode));
      }
    }
  });
});
