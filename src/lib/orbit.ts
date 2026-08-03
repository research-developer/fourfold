/**
 * Symmetry brushes: the geometric orbit engine behind the drawing program.
 *
 * A brush paints a cell and everything the chosen subgroup carries that cell
 * to. That is all this module computes — the ORBIT of a cell under a subgroup
 * of the canvas's isometry group, as a set of cell indices.
 *
 * ZERO FLOAT IN THIS FILE. Every isometry arrives here already expressed as a
 * permutation of cell indices, derived by exact integer key lookup upstream
 * (`triangleIndexMap` on barycentric keys, `indexMap` on Eisenstein lattice
 * keys). Nothing here does arithmetic on a coordinate; it does arithmetic on
 * indices. There is no tolerance to tune and no comparison that could go
 * either way.
 *
 * ── What this deliberately does NOT ask ──────────────────────────────────
 *
 * Whether an isometry LIFTS to the V4 charge is a different question, already
 * answered by `isometryReport` / `hexIsometryReport`: on the triangle the apex
 * convention lifts only {id, m_A} while ifs lifts all six. A drawing program
 * has no stake in that. The brush is a geometric statement — "these cells are
 * the same cell, up to the symmetry I selected" — and the geometry is
 * identical under both conventions, so every orbit here is too.
 *
 * That last claim has a trap in it, and `test/orbit.test.ts` states it the
 * careful way. The two conventions cut the same triangles but, from depth 2,
 * hand them out in a DIFFERENT ORDER, because `ifs` re-roles the B and C
 * children and the recursion carries that down. Cell index 4 is a different
 * triangle under the two conventions. The orbits agree as sets of TRIANGLES —
 * compare them by exact key — and disagree as sets of indices.
 *
 * ── Orbits are not the subgroup ──────────────────────────────────────────
 *
 * |orbit(i)| = |H| / |Stab(i)|, so an orbit is at most the subgroup order and
 * divides it. Cells with a non-trivial stabiliser have SHORT orbits, and a
 * three-fold brush applied to such a cell paints one cell, not three. What is
 * actually pinned was measured, not assumed:
 *
 *   triangle  the hub X^d is fixed by all of D3, so it is a singleton orbit in
 *             every mode. Each median pins 2^d cells — exactly the addresses
 *             that are words over {A, X}, m_A being blind to the B/C choice.
 *             The rotations pin the hub and nothing else, since only one cell
 *             can hold the centroid.
 *
 *   hexagon   NOTHING is pinned by a rotation. The hexagon's centre is a
 *             lattice point — the shared apex of the six sectors — and no cell
 *             sits on it; in the Eisenstein basis a non-trivial rotation fixes
 *             only the origin, and no cell key is the origin. So modes 2, 3
 *             and 6 are FREE at every depth, and only mode 12 has short
 *             orbits, from the three sector-SPINE mirrors. The three
 *             sector-BOUNDARY mirrors pin nothing either: m·R^s = R^(−1−s)·m
 *             fixes a sector only when 2s ≡ k−1 (mod 6), which is unsolvable
 *             for even k.
 *
 * `orbit()` returns the true, deduplicated set; it never pads to |H|, and it
 * never returns a cell twice, because painting a cell twice is a visible bug
 * the moment the second paint carries a different colour.
 *
 * Orbits partition the cell set for every mode. That is the invariant the
 * drawing program actually relies on: every cell belongs to exactly one brush
 * stroke, so a full sweep over orbits covers the canvas once.
 */

import { buildFigure, type Convention, type Figure } from "./figure";
import { triangleIndexMap, type IsometryName } from "./conventions";
import {
  buildHexagon,
  HEX_ISOMETRIES,
  indexMap,
  type Hexagon,
  type HexIsometryName,
} from "./hexagon";

export type CanvasKind = "triangle" | "hexagon";

/**
 * WHOSE symmetries the hexagon's brush uses.
 *
 * `hexagon` is D6 — the twelve isometries of the whole plate. The other two are
 * NOT subgroups of it, and that is the entire reason they exist.
 *
 * ── Why a sector's own D3 is new structure, not a subset ─────────────────
 *
 * The six sector spines lie at 30° + 60s, which mod 180 collapse to three
 * lines, so each of D6's spine mirrors (m30, m90, m150) reflects TWO OPPOSITE
 * SECTORS AT ONCE. Reflecting one sector and leaving its opposite alone is not
 * an isometry of the hexagon at all — it is a piecewise map, invisible to every
 * one of the twelve elements. The sector triangle's own 120° rotation is about
 * ITS centroid rather than the plate's, so it likewise carries that sector to
 * itself and touches nothing else.
 *
 * Both are exact and cost nothing to compute, because each sector IS a copy of
 * the base triangle: the local action is `triangleIndexMap` on the cell's `base`
 * index with its `sector` held fixed. No new geometry, no tolerance.
 *
 *   hexagon    D6                       modes 1 2 3 6 12
 *   sector     D3 inside one sector     modes 1 2 3 6     — paints there only
 *   sector6    C6 × D3, order 6·mode    modes 1 2 3 6     — the local orbit, six times
 *
 * `sector6` really is a group: the sector-local μ acts identically in every
 * sector, so it COMMUTES with the rotation that permutes them, and the product
 * is the direct product C6 × D3 of order 6·mode. Its intersection with D6 is
 * exactly C6 — D6's reflections reverse the sector order, which no element of
 * C6 × D3 does — so it is a genuinely different group, not a relabelling.
 */
export type BrushScope = "hexagon" | "sector" | "sector6";

export const BRUSH_SCOPES: readonly BrushScope[] = [
  "hexagon",
  "sector",
  "sector6",
] as const;

/**
 * The order of the subgroup a brush uses — NOT the number of cells it paints.
 * See the stabiliser note above: a mode-6 brush on a cell of the vertical
 * median paints three cells, and on the hub, one.
 */
export type BrushMode = 1 | 2 | 3 | 6 | 12;

export interface SymmetrySurface {
  kind: CanvasKind;
  cellCount: number;
  /** Available brush modes for this surface, ascending. */
  modes: BrushMode[];
  /**
   * Which part of the canvas the group is confined to, as a cell → region id.
   *
   * `0` everywhere for a group that acts on the whole plate, which is every
   * surface but the SECTOR-scoped hexagon; there the region is the sector, and
   * an orbit can never leave it. Published because a BAND is a whole-canvas
   * object and has to be CLIPPED to the region before the brush carries it, or
   * a stroke escapes the scope it is named for. `bands.ts` is the caller.
   */
  regionOf(i: number): number;
  /**
   * The ORDER of the subgroup `mode` names on this surface.
   *
   * Equal to `mode` everywhere except the SECTOR ×6 scope, where the group is
   * C6 × D3 and the order is 6·mode. It is what a colour scheme is indexed
   * over, so it cannot simply be assumed to be the mode number.
   */
  order(mode: BrushMode): number;
  /** The orbit of cell i under the subgroup chosen by `mode`, sorted ascending. */
  orbit(i: number, mode: BrushMode): number[];
  /**
   * The subgroup itself, one index permutation per element.
   *
   * An orbit is what you get after forgetting WHICH element carried the cell,
   * and for a single cell that is all anyone needs. For a SET it is not: the
   * image of a band under one element is a band, and the orbit of a band is a
   * set of bands, which the flattened union has already thrown away. `bands.ts`
   * needs the elements back to recover that grouping, so they are published
   * rather than kept private to the orbit computation.
   *
   * Read `subgroupMaps` for the contract; this is the surface's half of it.
   */
  maps(mode: BrushMode): number[][];
}

// ── the subgroups ────────────────────────────────────────────────────────

/**
 * The triangle's geometric group is D3, order 6: two rotations, three median
 * mirrors, the identity. Its subgroup lattice is small enough to enumerate,
 * and every proper non-trivial subgroup is cyclic:
 *
 *   1  {id}                     trivial
 *   2  ⟨m_A⟩ = {id, m_A}        one mirror — the vertical median
 *   3  ⟨rot+⟩ = A3              the rotations
 *   6  D3                       everything
 *
 * m_B and m_C generate conjugate order-2 subgroups; ⟨m_A⟩ is chosen because
 * m_A is the median that survives in BOTH conventions as an exact V4 symmetry,
 * so a mode-2 brush and the charge structure agree on the apex board even
 * though the brush does not consult the charge.
 */
export const TRIANGLE_SUBGROUPS: Readonly<
  Record<1 | 2 | 3 | 6, readonly IsometryName[]>
> = {
  1: ["id"],
  2: ["id", "m_A"],
  3: ["id", "rot+", "rot-"],
  6: ["id", "rot+", "rot-", "m_A", "m_B", "m_C"],
};

/**
 * The hexagon's group is D6, order 12. The cyclic tower C1 < C2 < C3 < C6 gives
 * the four rotational brushes and D6 itself gives the fifth:
 *
 *   1   {r0}
 *   2   ⟨r180⟩ = C2
 *   3   ⟨r120⟩ = C3
 *   6   ⟨r60⟩  = C6
 *   12  D6
 *
 * The rotational modes are all subgroups of C6, so they nest: a mode-3 orbit is
 * a union of mode-1 orbits, and so on up. Only mode 12 brings in reflections.
 */
export const HEXAGON_SUBGROUPS: Readonly<
  Record<BrushMode, readonly HexIsometryName[]>
> = {
  1: ["r0"],
  2: ["r0", "r180"],
  3: ["r0", "r120", "r240"],
  6: ["r0", "r60", "r120", "r180", "r240", "r300"],
  12: [
    "r0", "r60", "r120", "r180", "r240", "r300",
    "m0", "m30", "m60", "m90", "m120", "m150",
  ],
};

export const TRIANGLE_MODES: BrushMode[] = [1, 2, 3, 6];
export const HEXAGON_MODES: BrushMode[] = [1, 2, 3, 6, 12];

/**
 * The sector-local subgroups are the TRIANGLE's, because a sector IS the
 * triangle. Naming them again here would be a second copy that could drift.
 */
export const SECTOR_MODES: BrushMode[] = [1, 2, 3, 6];

/** Which modes each scope offers. Mode 12 belongs to D6 and to nothing else. */
export const SCOPE_MODES: Readonly<Record<BrushScope, BrushMode[]>> = {
  hexagon: HEXAGON_MODES,
  sector: SECTOR_MODES,
  sector6: SECTOR_MODES,
};

export const SCOPE_LABEL: Readonly<Record<BrushScope, string>> = {
  hexagon: "the whole plate — D₆",
  sector: "one sector — its own D₃, and nothing outside it",
  sector6: "one sector's D₃, repeated in all six",
};

// ── the engine ───────────────────────────────────────────────────────────

/**
 * Orbits of `cellCount` cells under the permutations `maps`, as a table that
 * sends each cell to the (shared) array holding its orbit.
 *
 * Computed as forward closure under the given permutations. That is exactly
 * the orbit even if `maps` is only a GENERATING set rather than the whole
 * subgroup: the closure F of {i} satisfies g(F) ⊆ F for every generator g, and
 * a permutation mapping a finite set into itself maps it onto itself, so F is
 * closed under the inverses too. Nothing here assumes the caller handed over a
 * complete group — though `TRIANGLE_SUBGROUPS` and `HEXAGON_SUBGROUPS` do, and
 * `test/orbit.test.ts` checks that they close under composition.
 *
 * Sharing one array between all members of an orbit is what makes the
 * partition property structural rather than merely tested: two cells in the
 * same orbit cannot disagree about what that orbit is.
 */
function orbitTable(cellCount: number, maps: number[][]): number[][] {
  const table = new Array<number[] | null>(cellCount).fill(null);

  for (let seed = 0; seed < cellCount; seed++) {
    if (table[seed] !== null) continue;

    const seen = new Set<number>([seed]);
    const queue = [seed];
    for (let q = 0; q < queue.length; q++) {
      const x = queue[q];
      for (const m of maps) {
        const y = m[x];
        if (!seen.has(y)) {
          seen.add(y);
          queue.push(y);
        }
      }
    }

    // Ascending order, so orbit position is a stable, canvas-independent fact
    // about the orbit rather than an artefact of which cell was clicked.
    const orbit = [...seen].sort((a, b) => a - b);
    for (const j of orbit) table[j] = orbit;
  }

  return table as number[][];
}

/**
 * Wire a cell count, a mode → element-name table and an element-name → index-map
 * function into a `SymmetrySurface`.
 *
 * Both the per-element index maps and the per-mode orbit tables are memoised on
 * first use: a depth-6 hexagon is 24 576 cells and twelve maps, and a brush is
 * dragged across a canvas at pointer rate.
 */
function makeSurface<N extends string>(
  kind: CanvasKind,
  cellCount: number,
  modes: BrushMode[],
  subgroups: Readonly<Partial<Record<BrushMode, readonly N[]>>>,
  mapFor: (name: N) => number[],
  /** Cell → region id, or `null` when the group acts on the whole canvas. */
  regions: readonly number[] | null = null
): SymmetrySurface {
  const maps = new Map<N, number[]>();
  const groups = new Map<BrushMode, number[][]>();
  const tables = new Map<BrushMode, number[][]>();

  /**
   * The subgroup's element maps, memoised per mode AND per element name — the
   * two caches are separate because the modes SHARE elements (the identity is
   * in all of them, and mode 3's rotations are also in mode 6), and rebuilding
   * an index map is a full pass over the figure's keys.
   */
  const groupFor = (mode: BrushMode): number[][] => {
    const cached = groups.get(mode);
    if (cached !== undefined) return cached;

    const names = subgroups[mode];
    if (names === undefined) {
      throw new Error(`${kind}: no brush mode ${mode} on this surface`);
    }
    const built = names.map((n) => {
      let m = maps.get(n);
      if (m === undefined) {
        m = mapFor(n);
        maps.set(n, m);
      }
      return m;
    });
    groups.set(mode, built);
    return built;
  };

  const tableFor = (mode: BrushMode): number[][] => {
    const cached = tables.get(mode);
    if (cached !== undefined) return cached;
    const built = orbitTable(cellCount, groupFor(mode));
    tables.set(mode, built);
    return built;
  };

  return {
    kind,
    cellCount,
    modes,
    regionOf(i) {
      if (!Number.isInteger(i) || i < 0 || i >= cellCount) {
        throw new Error(`${kind}: cell ${i} is not on this surface`);
      }
      return regions === null ? 0 : regions[i];
    },
    order: (mode) => groupFor(mode).length,
    orbit(i, mode) {
      if (!Number.isInteger(i) || i < 0 || i >= cellCount) {
        throw new Error(`${kind}: cell ${i} is not on this surface`);
      }
      // A copy: the table's arrays are shared between every member of an orbit,
      // and a caller that sorted or spliced one in place would corrupt them all.
      return [...tableFor(mode)[i]];
    },
    // Copies for the same reason, and one level deeper: these arrays are the
    // memoised maps every future orbit on this surface will be computed from,
    // so one in-place sort by a caller would silently change the geometry.
    maps: (mode) => groupFor(mode).map((m) => [...m]),
  };
}

/** The D3 brush surface of a triangle figure. */
export function triangleSurface(figure: Figure): SymmetrySurface {
  return makeSurface<IsometryName>(
    "triangle",
    figure.cells.length,
    TRIANGLE_MODES,
    TRIANGLE_SUBGROUPS,
    (name) => triangleIndexMap(figure, name)
  );
}

// ── the sector-local action ──────────────────────────────────────────────

/**
 * Cell index by (sector, base-cell), read off the hexagon rather than assumed.
 *
 * `buildHexagon` happens to lay the cells out sector-major, so the index IS
 * `sector·n + base` — but that is a fact about a loop in another module, and a
 * brush that silently depended on it would break the day the loop was reordered.
 * The table is built from the cells' own `sector` and `base` fields, and the
 * lookup throws rather than returning `undefined`.
 */
function sectorBaseIndex(hex: Hexagon): (s: number, c: number) => number {
  const n = hex.base.cells.length;
  const at = new Array<number>(6 * n).fill(-1);
  for (const c of hex.cells) at[c.sector * n + c.base] = c.i;
  return (s, c) => {
    const i = at[((((s % 6) + 6) % 6) * n) + c];
    if (i === undefined || i < 0) {
      throw new Error(`hexagon: no cell in sector ${s} at base index ${c}`);
    }
    return i;
  };
}

/**
 * The permutation a sector-local triangle isometry induces, optionally followed
 * by a rotation of the sectors.
 *
 * (s, c) ↦ (s + spin, μ(c)). Exact: μ is `triangleIndexMap` on the BASE figure,
 * which is itself an exact barycentric key lookup, and the sector arithmetic is
 * integer. Nothing here compares a coordinate.
 *
 * At `spin = 0` this fixes every sector setwise, which is precisely what no
 * element of D6 does — see the note on `BrushScope`.
 */
function sectorMap(
  hex: Hexagon,
  at: (s: number, c: number) => number,
  name: IsometryName,
  spin: number
): number[] {
  const mu = triangleIndexMap(hex.base, name);
  const out = new Array<number>(hex.cells.length);
  for (const c of hex.cells) out[c.i] = at(c.sector + spin, mu[c.base]);
  return out;
}

/** `spin·name`, the composite element name a `sector6` subgroup lists. */
const SPIN_NAME = (spin: number, name: IsometryName) => `r${spin}·${name}`;

const parseSpin = (composite: string): [number, IsometryName] => {
  const cut = composite.indexOf("·");
  return [Number(composite.slice(1, cut)), composite.slice(cut + 1) as IsometryName];
};

/**
 * The element lists of C6 × D3, mode by mode: every sector rotation composed
 * with every element of the local D3. Built from `TRIANGLE_SUBGROUPS` so the
 * local half can never disagree with the sector scope's own.
 */
const SECTOR6_SUBGROUPS: Readonly<Record<1 | 2 | 3 | 6, readonly string[]>> = (() => {
  const out = {} as Record<1 | 2 | 3 | 6, readonly string[]>;
  for (const mode of [1, 2, 3, 6] as const) {
    const names: string[] = [];
    for (let spin = 0; spin < 6; spin++) {
      for (const n of TRIANGLE_SUBGROUPS[mode]) names.push(SPIN_NAME(spin, n));
    }
    out[mode] = names;
  }
  return out;
})();

/**
 * The brush surface of a hexagon, under the scope's group.
 *
 * `hexagon` is the original D6 surface and is the default, so every existing
 * caller gets exactly the surface it always got.
 */
export function hexagonSurface(
  hex: Hexagon,
  scope: BrushScope = "hexagon"
): SymmetrySurface {
  if (scope === "hexagon") {
    const byName = new Map(HEX_ISOMETRIES.map((g) => [g.name, g]));
    return makeSurface<HexIsometryName>(
      "hexagon",
      hex.cells.length,
      HEXAGON_MODES,
      HEXAGON_SUBGROUPS,
      (name) => indexMap(hex, byName.get(name)!)
    );
  }

  const at = sectorBaseIndex(hex);
  if (scope === "sector") {
    // The regions ARE the sectors, and they are what stops a band escaping.
    const regions = hex.cells.map((c) => c.sector);
    return makeSurface<IsometryName>(
      "hexagon",
      hex.cells.length,
      SECTOR_MODES,
      TRIANGLE_SUBGROUPS,
      (name) => sectorMap(hex, at, name, 0),
      regions
    );
  }

  return makeSurface<string>(
    "hexagon",
    hex.cells.length,
    SECTOR_MODES,
    SECTOR6_SUBGROUPS,
    (composite) => {
      const [spin, name] = parseSpin(composite);
      return sectorMap(hex, at, name, spin);
    }
  );
}

/** Build the canvas and its brush surface in one step. */
export function buildSurface(
  kind: CanvasKind,
  depth: number,
  convention: Convention = "apex",
  scope: BrushScope = "hexagon"
): SymmetrySurface {
  return kind === "triangle"
    ? triangleSurface(buildFigure(depth, convention))
    : hexagonSurface(buildHexagon(depth, convention), scope);
}

// ── the subgroup, element by element ─────────────────────────────────────

/**
 * The subgroup `mode` names, as one index permutation per element.
 *
 * `orbit()` is a forgetful function: it says which cells are the same cell and
 * says nothing about WHICH isometry made them so. For a cell that is the whole
 * truth. For a SET it is not — an isometry carries a lattice line to a lattice
 * line, so the orbit of a band is a set of BANDS, and flattening it into one
 * cell list destroys the only structure a colour scheme could index. Recovering
 * that grouping needs the elements themselves, so they are exported.
 *
 * ── What is guaranteed ──────────────────────────────────────────────────
 *
 *   length      exactly `mode` maps, one per element of the subgroup, in the
 *               order `TRIANGLE_SUBGROUPS` / `HEXAGON_SUBGROUPS` list them —
 *               which puts the IDENTITY first in every mode on both canvases.
 *   permutation each map is a bijection of [0, cellCount), by construction:
 *               `triangleIndexMap` and `indexMap` throw rather than return a
 *               map that is not, and `test/orbit.test.ts` checks the lists
 *               close under composition, so these really are groups.
 *   consistency `orbit(i, mode)` is exactly `{ m[i] : m ∈ maps(mode) }`, sorted
 *               and deduplicated. Checked in `test/orbit.test.ts` rather than
 *               argued: it holds because the lists are complete subgroups, and
 *               would quietly fail if one ever became a generating set instead.
 *
 * ZERO FLOAT, like everything else here: these are the permutations the exact
 * integer key lookup upstream produced, handed on unchanged.
 */
export function subgroupMaps(
  surface: SymmetrySurface,
  mode: BrushMode
): number[][] {
  return surface.maps(mode);
}

// ── measurements ─────────────────────────────────────────────────────────

/**
 * Every orbit of `mode`, each listed once, ordered by least member. The full
 * partition — useful for a "fill the canvas" sweep, and for the tests that
 * check it IS a partition.
 */
export function orbitPartition(
  surface: SymmetrySurface,
  mode: BrushMode
): number[][] {
  const out: number[][] = [];
  const seen = new Set<number>();
  for (let i = 0; i < surface.cellCount; i++) {
    if (seen.has(i)) continue;
    const o = surface.orbit(i, mode);
    for (const j of o) seen.add(j);
    out.push(o);
  }
  return out;
}

/**
 * How many orbits of each size the mode produces, size → count.
 *
 * The short orbits are the interesting entry: they are precisely the cells
 * whose stabiliser is non-trivial, i.e. the cells the symmetry PINS. Reported
 * rather than asserted in the model, because what is pinned is a fact about
 * the figure and is measured in the tests.
 */
export function orbitSizeCensus(
  surface: SymmetrySurface,
  mode: BrushMode
): Map<number, number> {
  const out = new Map<number, number>();
  for (const o of orbitPartition(surface, mode)) {
    out.set(o.length, (out.get(o.length) ?? 0) + 1);
  }
  return new Map([...out].sort((a, b) => a[0] - b[0]));
}
