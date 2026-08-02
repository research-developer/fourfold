/**
 * Which subgroup of Aut(V4) a convention geometrically realises.
 *
 * The TypeScript counterpart of `tools/conventions.py`, so the page can
 * recompute the finding live rather than display a table someone typed in.
 * Both are exhaustive: every cell, all six isometries, all 24 permutations of
 * V4. Cells are located by exact integer barycentric key -- there is no
 * floating-point comparison here, and none is possible, because the keys are
 * sums of integers.
 *
 * The result, for the record (docs/symmetry-findings.md section E):
 *
 *   apex  exact: {id, m_A}     order 2   non-exact all at (4^d - 1)/3 + 1
 *   ifs   exact: all six       order 6
 */

import {
  ID,
  S2,
  S2S3,
  S3,
  type Charge,
  type Figure,
} from "./figure";

export type IsometryName = "id" | "rot+" | "rot-" | "m_A" | "m_B" | "m_C";

/**
 * The six isometries of the triangle as permutations of the three barycentric
 * slots. A reflection across the median from vertex A fixes A's coordinate
 * and swaps the other two -- which is why every isometry here is a coordinate
 * permutation and nothing needs trigonometry.
 */
export const ISOMETRIES: Record<IsometryName, readonly [number, number, number]> = {
  id: [0, 1, 2],
  "rot+": [2, 0, 1],
  "rot-": [1, 2, 0],
  m_A: [0, 2, 1],
  m_B: [2, 1, 0],
  m_C: [1, 0, 2],
};

export const ISOMETRY_NAMES = Object.keys(ISOMETRIES) as IsometryName[];

export const ISOMETRY_LABEL: Record<IsometryName, string> = {
  id: "identity",
  "rot+": "rotate +120°",
  "rot-": "rotate −120°",
  m_A: "mirror, vertical",
  m_B: "mirror, left diagonal",
  m_C: "mirror, right diagonal",
};

const CHARGES: readonly Charge[] = [ID, S3, S2, S2S3];

/** All 24 permutations of the four charges, as index maps. */
const PERMUTATIONS: Charge[][] = (function build() {
  const out: Charge[][] = [];
  const rec = (left: Charge[], acc: Charge[]) => {
    if (left.length === 0) {
      out.push(acc);
      return;
    }
    for (let i = 0; i < left.length; i++) {
      rec([...left.slice(0, i), ...left.slice(i + 1)], [...acc, left[i]]);
    }
  };
  rec([...CHARGES], []);
  return out;
})();

export interface IsometryRow {
  name: IsometryName;
  /** Cells whose charge is carried correctly by the best relabelling. */
  matches: number;
  total: number;
  exact: boolean;
  /** The relabelling that achieved it, as charge -> charge. */
  best: Record<Charge, Charge>;
}

/** Index cells by their exact integer centroid key. */
function indexByKey(figure: Figure): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of figure.cells) m.set(c.key.join(","), c.i);
  return m;
}

/**
 * The permutation of cell indices induced by a triangle isometry.
 *
 * Permute the three barycentric slots of the exact integer centroid key and
 * look the result up: no pixel is consulted and no tolerance is chosen, so the
 * answer is an integer fact about the figure rather than a measurement of it.
 * Throws if the isometry fails to permute the cell set, which would mean the
 * geometry is not what this module assumes.
 *
 * The hexagon's `indexMap` is the same idea on the Eisenstein lattice; this is
 * the triangle counterpart, factored out so the orbit engine and the lift
 * report share one derivation instead of two copies of it.
 */
export function triangleIndexMap(
  figure: Figure,
  name: IsometryName
): number[] {
  const byKey = indexByKey(figure);
  const p = ISOMETRIES[name];
  const out = new Array<number>(figure.cells.length);
  for (const c of figure.cells) {
    const j = byKey.get([c.key[p[0]], c.key[p[1]], c.key[p[2]]].join(","));
    if (j === undefined) {
      throw new Error(`${name}: geometry is not invariant under this isometry`);
    }
    out[c.i] = j;
  }
  return out;
}

/**
 * For each isometry, the best permutation of V4 and how many cells it carries
 * correctly. An isometry is EXACT when some relabelling carries every cell.
 */
export function isometryReport(figure: Figure): IsometryRow[] {
  const total = figure.cells.length;

  return ISOMETRY_NAMES.map((name) => {
    // The isometry must permute the CELL SET, or the question is malformed;
    // `triangleIndexMap` throws if it does not.
    const image = triangleIndexMap(figure, name);

    let matches = -1;
    let best: Record<Charge, Charge> = {} as Record<Charge, Charge>;
    for (const perm of PERMUTATIONS) {
      const pi = {} as Record<Charge, Charge>;
      CHARGES.forEach((g, k) => (pi[g] = perm[k]));
      let hits = 0;
      for (const c of figure.cells) {
        if (figure.cells[image[c.i]].charge === pi[c.charge]) hits++;
      }
      if (hits > matches) {
        matches = hits;
        best = pi;
      }
    }
    return { name, matches, total, exact: matches === total, best };
  });
}

/** Isometries that lift exactly -- the realised symmetry group. */
export function exactIsometries(rows: IsometryRow[]): IsometryName[] {
  return rows.filter((r) => r.exact).map((r) => r.name);
}

export type CharacterName = "chi6" | "chi3" | "chi2";

export const CHARACTERS: Record<
  CharacterName,
  { label: string; subfield: string; kernel: ReadonlySet<Charge> }
> = {
  chi6: {
    label: "χ√6",
    subfield: "ℚ(√6)",
    kernel: new Set<Charge>([ID, S2S3]),
  },
  chi3: {
    label: "χ√3",
    subfield: "ℚ(√3)",
    kernel: new Set<Charge>([ID, S2]),
  },
  chi2: {
    label: "χ√2",
    subfield: "ℚ(√2)",
    kernel: new Set<Charge>([ID, S3]),
  },
};

export const CHARACTER_NAMES = Object.keys(CHARACTERS) as CharacterName[];

/**
 * Cells whose mirror partner lies in the same coset of the character's
 * kernel, per median. A character is CARRIED by a median when every cell
 * does -- which is what makes that median a coset axis for that subfield.
 */
export function characterReport(
  figure: Figure
): Record<CharacterName, Record<"m_A" | "m_B" | "m_C", number>> {
  const byKey = indexByKey(figure);
  const out = {} as Record<
    CharacterName,
    Record<"m_A" | "m_B" | "m_C", number>
  >;

  for (const cn of CHARACTER_NAMES) {
    const kernel = CHARACTERS[cn].kernel;
    const row = {} as Record<"m_A" | "m_B" | "m_C", number>;
    for (const m of ["m_A", "m_B", "m_C"] as const) {
      const p = ISOMETRIES[m];
      let hits = 0;
      for (const c of figure.cells) {
        const j = byKey.get([c.key[p[0]], c.key[p[1]], c.key[p[2]]].join(","))!;
        if (kernel.has(c.charge) === kernel.has(figure.cells[j].charge)) hits++;
      }
      row[m] = hits;
    }
    out[cn] = row;
  }
  return out;
}

/**
 * How many cells the two conventions label differently at this depth.
 *
 * The geometry and the orientation are identical either way -- no triangle
 * moves and no cell changes from upright to inverted -- so this count is
 * exactly the visible difference between the two boards.
 */
export function chargeDivergence(a: Figure, b: Figure): number {
  const byKey = indexByKey(b);
  let n = 0;
  for (const c of a.cells) {
    const j = byKey.get(c.key.join(","))!;
    if (b.cells[j].charge !== c.charge) n++;
  }
  return n;
}
