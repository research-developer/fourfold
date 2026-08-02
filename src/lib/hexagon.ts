/**
 * The hexagon canvas: six copies of the depth-d triangle sharing their apex.
 *
 * Each sector is the existing figure with its apex at a common centre vertex,
 * rotated by 60°·s. Six 60° apex angles close the circle exactly, so the six
 * sectors tile a regular hexagon of 6·4^d cells with no overlap and no gap.
 *
 * ZERO FLOAT IN THIS FILE except `latticeToPixel`, which is the render layer.
 * Every isometry is an exact integer matrix on the triangular lattice, and
 * every cell is located by an exact integer key. `Math.sqrt` appears once, to
 * draw; it never decides an index.
 *
 * ── The lattice ──────────────────────────────────────────────────────────
 *
 * Work in the Eisenstein basis e1 = (1,0), e2 = (1/2, √3/2), so a lattice
 * point is an integer pair (a, b) meaning a·e1 + b·e2. Rotation by 60° about
 * the origin is then an INTEGER matrix, which is the whole reason for this
 * basis:
 *
 *     R : (a, b) ↦ (−b, a + b)        e1 ↦ e2,  e2 ↦ e2 − e1
 *     M : (a, b) ↦ (a + b, −b)        reflection across the e1 axis
 *
 * Placing the base triangle with apex A at the origin, B at scale·e1 and C at
 * scale·e2 makes the barycentric-to-lattice map trivial: a vertex with
 * integer barycentrics (x, y, z), x + y + z = scale, sits at (y, z).
 *
 * ── The index law, DERIVED (not assumed) ─────────────────────────────────
 *
 * Sector s is R^s applied to the base wedge. For a base cell k:
 *
 *     R · (R^s k) = R^(s+1) k                    → (s, c) ↦ (s+1 mod 6, c)
 *
 * so a 60° rotation carries the cell index UNCHANGED. For the reflection,
 * dihedral commutation gives M·R^s = R^(−s)·M, and M carries the base wedge
 * to the wedge at [−60°, 0°] = sector −1, so
 *
 *     M · (R^s k) = R^(−1−s) · (R·M) k           → (s, c) ↦ (−1−s mod 6, μ(c))
 *
 * where R·M = [[0,1],[1,0]] is the swap a ↔ b. In barycentric terms that
 * swaps the B and C coordinates — which is exactly `AXIS_SWAP.A`, the median
 * mirror m_A. So μ = the within-sector median mirror, already computed by
 * `buildFigure` as `cell.mirror.A`.
 *
 * NOTE, because it contradicts the obvious guess: the μ lands on the SIX
 * REFLECTIONS and not on the rotation, and it is uniform rather than
 * parity-dependent. A law of the form (s,c) ↦ (s+1, μ(c)) for rot60 does not
 * agree with the geometry; `test/hexagon.test.ts` plants exactly that as a
 * mutation and shows it caught. The difference comes from the cell index here
 * being INTRINSIC to the sector (the base figure's own index) rather than
 * screen-relative: a screen-relative "pos within row" would reverse on odd
 * sectors and put a μ in the rotation instead.
 */

import {
  buildFigure,
  type Charge,
  type Convention,
  type Figure,
  type IVec,
} from "./figure";

/** A point of the triangular lattice, as integer coefficients of (e1, e2). */
export type Lat = readonly [number, number];

/** Rotation by +60° about the origin. Exact, integer, order 6. */
export function rot(v: Lat): Lat {
  return [-v[1], v[0] + v[1]];
}

/** Reflection across the e1 axis. Exact, integer, an involution. */
export function refl(v: Lat): Lat {
  return [v[0] + v[1], -v[1]];
}

/** R^k, k taken mod 6 (negative allowed). */
export function rotK(v: Lat, k: number): Lat {
  let out = v;
  const n = ((k % 6) + 6) % 6;
  for (let i = 0; i < n; i++) out = rot(out);
  return out;
}

/** A vertex in integer barycentrics over `scale` sits at (y, z). */
export function baryToLat(v: IVec): Lat {
  return [v[1], v[2]];
}

export const latKey = (v: Lat) => `${v[0]},${v[1]}`;

// ── the twelve isometries of D6 ──────────────────────────────────────────

export type HexIsometryName =
  | "r0" | "r60" | "r120" | "r180" | "r240" | "r300"
  | "m0" | "m30" | "m60" | "m90" | "m120" | "m150";

export interface HexIsometry {
  name: HexIsometryName;
  /** true for the six reflections. */
  flip: boolean;
  /** R^k, then M if `flip`. Mirror lines sit at 30°·k. */
  k: number;
  apply: (v: Lat) => Lat;
  label: string;
}

/**
 * R^k for k = 0..5, then R^k·M for k = 0..5.
 *
 * R^k·M is the reflection whose mirror line lies at 30°·k, so the even k are
 * the three SECTOR-BOUNDARY diameters (0°, 60°, 120°) and the odd k are the
 * three SECTOR-SPINE diameters (30°, 90°, 150°) — each spine being the apex
 * median of two opposite sectors, collinear.
 */
export const HEX_ISOMETRIES: HexIsometry[] = [
  ...([0, 1, 2, 3, 4, 5] as const).map((k) => ({
    name: (["r0", "r60", "r120", "r180", "r240", "r300"] as const)[k],
    flip: false,
    k,
    apply: (v: Lat) => rotK(v, k),
    label: k === 0 ? "identity" : `rotate ${60 * k}°`,
  })),
  ...([0, 1, 2, 3, 4, 5] as const).map((k) => ({
    name: (["m0", "m30", "m60", "m90", "m120", "m150"] as const)[k],
    flip: true,
    k,
    apply: (v: Lat) => rotK(refl(v), k),
    label:
      k % 2 === 0
        ? `mirror ${30 * k}° — sector boundary`
        : `mirror ${30 * k}° — sector spine`,
  })),
];

export const HEX_ISOMETRY_NAMES = HEX_ISOMETRIES.map((g) => g.name);

// ── the figure ───────────────────────────────────────────────────────────

export interface HexCell {
  i: number;
  /** 0..5, counter-clockwise from the wedge between e1 and e2. */
  sector: number;
  /** Index of the corresponding cell in the base triangle. */
  base: number;
  addr: string;
  charge: Charge;
  /**
   * Orientation AS DRAWN. Odd sectors are rotated by an odd multiple of 60°,
   * which exchanges the two lattice orientations, so the drawn orientation is
   * the base cell's ε flipped on odd sectors. This is what makes the hexagon
   * balance; see `census`.
   */
  eps: 0 | 1;
  /** ε of the underlying base cell, unflipped. */
  baseEps: 0 | 1;
  /** Exact integer lattice key: the three vertices summed. */
  key: Lat;
  verts: [number, number][];
  centroid: [number, number];
}

export interface Hexagon {
  depth: number;
  convention: Convention;
  base: Figure;
  cells: HexCell[];
  /** Cell index by exact lattice key. */
  byKey: Map<string, number>;
  width: number;
  height: number;
  centre: [number, number];
  /** Circumradius in pixels. */
  radius: number;
  /** The six hexagon corners, in pixels. */
  corners: [number, number][];
}

const RADIUS = 512;
const PADDING = 60;
const SQRT3 = Math.sqrt(3);

/** Render layer. The only floating-point arithmetic in this module. */
export function latticeToPixel(
  v: Lat,
  unit: number,
  cx: number,
  cy: number
): [number, number] {
  return [cx + (v[0] + v[1] / 2) * unit, cy - (v[1] * SQRT3) / 2 * unit];
}

export function buildHexagon(
  depth: number,
  convention: Convention = "apex"
): Hexagon {
  const base = buildFigure(depth, convention);
  const scale = 2 ** depth;
  const unit = RADIUS / scale;
  const width = 2 * RADIUS + 2 * PADDING;
  const height = SQRT3 * RADIUS + 2 * PADDING;
  const cx = width / 2;
  const cy = height / 2;

  const cells: HexCell[] = [];
  const byKey = new Map<string, number>();

  for (let s = 0; s < 6; s++) {
    for (const c of base.cells) {
      const lat = c.bary.map((b) => rotK(baryToLat(b), s)) as [Lat, Lat, Lat];
      const key: Lat = [
        lat[0][0] + lat[1][0] + lat[2][0],
        lat[0][1] + lat[1][1] + lat[2][1],
      ];
      const kk = latKey(key);
      if (byKey.has(kk)) {
        throw new Error(
          `hexagon: two cells share the lattice key ${kk} (sector ${s}, ${c.addr})`
        );
      }
      const i = cells.length;
      byKey.set(kk, i);
      const verts = lat.map((p) => latticeToPixel(p, unit, cx, cy)) as [
        number,
        number
      ][];
      cells.push({
        i,
        sector: s,
        base: c.i,
        addr: c.addr,
        charge: c.charge,
        eps: ((c.eps ^ (s & 1)) as 0 | 1),
        baseEps: c.eps,
        key,
        verts,
        centroid: [
          (verts[0][0] + verts[1][0] + verts[2][0]) / 3,
          (verts[0][1] + verts[1][1] + verts[2][1]) / 3,
        ],
      });
    }
  }

  const corners = ([0, 1, 2, 3, 4, 5] as const).map((k) =>
    latticeToPixel(rotK([scale, 0], k), unit, cx, cy)
  ) as [number, number][];

  return {
    depth,
    convention,
    base,
    cells,
    byKey,
    width,
    height,
    centre: [cx, cy],
    radius: RADIUS,
    corners,
  };
}

// ── index maps ───────────────────────────────────────────────────────────

/**
 * The permutation of cell indices induced by an isometry, derived from the
 * exact lattice action and a key lookup. Throws if the isometry fails to
 * permute the cell set, which would mean the hexagon is not what we think.
 */
export function indexMap(hex: Hexagon, g: HexIsometry): number[] {
  const out = new Array<number>(hex.cells.length);
  for (const c of hex.cells) {
    const j = hex.byKey.get(latKey(g.apply(c.key)));
    if (j === undefined) {
      throw new Error(`${g.name}: the hexagon is not invariant (cell ${c.i})`);
    }
    out[c.i] = j;
  }
  return out;
}

/**
 * The same permutation expressed in (sector, base-cell) form, which is what
 * the derivation above predicts:
 *
 *   rotations   (s, c) ↦ (s + k,      c)
 *   reflections (s, c) ↦ (k − 1 − s,  μ(c))
 *
 * Returned so a test can check the closed form against the lattice-derived
 * map rather than either one being taken on trust.
 */
export function closedFormMap(hex: Hexagon, g: HexIsometry): number[] {
  const n = hex.base.cells.length;
  const at = (s: number, c: number) => (((s % 6) + 6) % 6) * n + c;
  const out = new Array<number>(hex.cells.length);
  for (const c of hex.cells) {
    out[c.i] = g.flip
      ? at(g.k - 1 - c.sector, hex.base.cells[c.base].mirror.A)
      : at(c.sector + g.k, c.base);
  }
  return out;
}

/**
 * The prose candidate this implementation had to correct: rot60 carrying a μ.
 * Exported ONLY so `test/hexagon.test.ts` can plant it and show it caught.
 * Never used by the model or the UI.
 */
export function mutantRotMap(hex: Hexagon, g: HexIsometry): number[] {
  const n = hex.base.cells.length;
  const at = (s: number, c: number) => (((s % 6) + 6) % 6) * n + c;
  const out = new Array<number>(hex.cells.length);
  for (const c of hex.cells) {
    const mu = hex.base.cells[c.base].mirror.A;
    out[c.i] = g.flip
      ? at(g.k - 1 - c.sector, mu)
      : at(c.sector + g.k, g.k % 2 === 1 ? mu : c.base);
  }
  return out;
}

// ── measurements ─────────────────────────────────────────────────────────

const CHARGES: readonly Charge[] = [0, 1, 2, 3];

const PERMUTATIONS: Charge[][] = (function build() {
  const out: Charge[][] = [];
  const rec = (left: Charge[], acc: Charge[]) => {
    if (left.length === 0) return void out.push(acc);
    for (let i = 0; i < left.length; i++) {
      rec([...left.slice(0, i), ...left.slice(i + 1)], [...acc, left[i]]);
    }
  };
  rec([...CHARGES], []);
  return out;
})();

export interface HexIsometryRow {
  name: HexIsometryName;
  label: string;
  matches: number;
  total: number;
  exact: boolean;
  best: Record<Charge, Charge>;
}

/**
 * For each of the twelve isometries, the best relabelling of V4 and how many
 * cells it carries. Same methodology as the triangle table: exhaustive over
 * all 24 permutations, every cell checked, nothing assumed in advance.
 */
export function hexIsometryReport(hex: Hexagon): HexIsometryRow[] {
  const total = hex.cells.length;
  return HEX_ISOMETRIES.map((g) => {
    const image = indexMap(hex, g);
    let matches = -1;
    let best = {} as Record<Charge, Charge>;
    for (const perm of PERMUTATIONS) {
      const pi = {} as Record<Charge, Charge>;
      CHARGES.forEach((c, idx) => (pi[c] = perm[idx]));
      let hits = 0;
      for (const c of hex.cells) {
        if (hex.cells[image[c.i]].charge === pi[c.charge]) hits++;
      }
      if (hits > matches) {
        matches = hits;
        best = pi;
      }
    }
    return {
      name: g.name,
      label: g.label,
      matches,
      total,
      exact: matches === total,
      best,
    };
  });
}

export interface Census {
  up: number;
  down: number;
  balanced: boolean;
  total: number;
}

/** Drawn-orientation census. In hexagon mode the two must come out equal. */
export function census(hex: Hexagon): Census {
  let up = 0;
  for (const c of hex.cells) if (c.eps === 0) up++;
  const down = hex.cells.length - up;
  return { up, down, balanced: up === down, total: hex.cells.length };
}

/** The same census for a bare triangle, where it is generally NOT balanced. */
export function triangleCensus(figure: Figure): Census {
  let up = 0;
  for (const c of figure.cells) if (c.eps === 0) up++;
  const down = figure.cells.length - up;
  return { up, down, balanced: up === down, total: figure.cells.length };
}
