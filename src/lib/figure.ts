/**
 * The V4 XOR Sierpinski figure.
 *
 * An equilateral triangle is cut into four half-scale children -- three
 * upright corners (A, B, C) and one inverted centre (X) -- and the cut
 * repeats. Each leaf at depth d is named by an address: a word of length d
 * over {A, B, C, X}. Two functions live on those addresses:
 *
 *   charge c(w) in V4   -- the product of the per-digit charges
 *   orientation e(w)    -- the parity of the number of X's
 *
 * V4 is the Klein four-group, realised here as Gal(Q(sqrt2, sqrt3)/Q). On
 * 2-bit codes its group law is bitwise XOR, which is where the figure gets
 * its name. Colour is a rendering decision applied at the very end and
 * carries no mathematical content.
 *
 * Barycentric coordinates are held as integers scaled by 2^depth so every
 * midpoint is exact. Mirror partners are found by integer key lookup --
 * there is no floating-point comparison anywhere in this module.
 */

/** V4 elements as 2-bit codes. Matches equilat_v4.py exactly. */
export const ID = 0b00;
export const S3 = 0b01;
export const S2 = 0b10;
export const S2S3 = 0b11;

export type Charge = 0 | 1 | 2 | 3;
export type Axis = "A" | "B" | "C";
export type Digit = "A" | "B" | "C" | "X";

export const AXES: readonly Axis[] = ["A", "B", "C"] as const;

/**
 * Which vertex of each child plays role A.
 *
 *   apex -- every corner child keeps the PARENT's corner as its role-A
 *           vertex. This is what equilat_v4.py implements, and what the game
 *           is built on.
 *   ifs  -- each corner child's roles are the images of (A,B,C) under the
 *           homothety that produces it. The standard IFS reading.
 *
 * The four children are the SAME four triangles either way, and the centre
 * child is (M_BC, M_AC, M_AB) -- inverted -- in both. Only the role ordering
 * of the two corner children B and C differs, and that ordering is what the
 * recursion carries down, so it decides the digit at every deeper level.
 *
 * The consequence is not cosmetic. Under `apex` the exact symmetry group has
 * order 2; under `ifs` it has order 6, and `Aut(V4)` acts transitively on the
 * three quadratic subfields. See docs/symmetry-findings.md section E.
 */
export type Convention = "apex" | "ifs";

export const CONVENTIONS: readonly Convention[] = ["apex", "ifs"] as const;

/**
 * H = {1, sigma2*sigma3} = {gold, purple}, the order-2 subgroup fixing
 * sqrt6. Its complementary coset {sigma2, sigma3} = {blue, red} is the pair
 * of automorphisms sending sqrt6 to -sqrt6. Every scoring rule in the game
 * is a statement about this partition.
 */
export const H: ReadonlySet<Charge> = new Set<Charge>([ID, S2S3]);

/** Two charges are coherent when they lie in the same coset of H. */
export function coherent(a: Charge, b: Charge): boolean {
  return H.has(a) === H.has(b);
}

export const CHARGE_NAME: Record<Charge, string> = {
  [ID]: "gold",
  [S3]: "red",
  [S2]: "blue",
  [S2S3]: "purple",
};

/** The Galois automorphism each charge denotes. */
export const CHARGE_LABEL: Record<Charge, string> = {
  [ID]: "1",
  [S3]: "σ₃",
  [S2]: "σ₂",
  [S2S3]: "σ₂σ₃",
};

export const CHARGE_FIXES: Record<Charge, string> = {
  [ID]: "identity",
  [S3]: "√3 ↦ −√3",
  [S2]: "√2 ↦ −√2",
  [S2S3]: "both flip, √6 fixed",
};

export interface Cell {
  /** Index into the cells array, in recursion order. */
  i: number;
  /** Address word over {A,B,C,X}. */
  addr: string;
  charge: Charge;
  /** 0 = upright (bright), 1 = inverted (dark). */
  eps: 0 | 1;
  /** First non-X digit; "" for the all-X hub. Governs the diagonal axes. */
  ftype: "" | Digit;
  /** Triangle vertices in SVG pixel space. */
  verts: [number, number][];
  centroid: [number, number];
  /**
   * Exact integer barycentric centroid key (the three vertex coordinates
   * summed). Cells are located by this, never by pixel comparison, so an
   * isometry can be applied as a permutation of the three slots.
   */
  key: [number, number, number];
  /**
   * The three vertices in exact integer barycentric coordinates over `2^depth`.
   *
   * `verts` is the same three points already projected to pixels, which is
   * lossy for anything that needs to transform them. The hexagon canvas maps
   * these into the triangular lattice and rotates by exact integer matrices,
   * so it needs the pre-projection values.
   */
  bary: [IVec, IVec, IVec];
  /** Mirror partner index across each median. */
  mirror: Record<Axis, number>;
  /** Axes on which this cell's mirror partner is charge-coherent. */
  coherentAxes: Axis[];
}

export interface Figure {
  depth: number;
  convention: Convention;
  cells: Cell[];
  /** Index of the all-X hub, the unique cell on all three medians. */
  hub: number;
  width: number;
  height: number;
  /** Outer triangle corners in SVG pixels: apex (A), bottom-left (B), bottom-right (C). */
  corners: [[number, number], [number, number], [number, number]];
}

/** Canvas geometry, matching equilat_v4.py so renders line up. */
const SIDE = 1024;
const PADDING = 60;
const SQRT3_2 = Math.sqrt(3) / 2;

export type IVec = readonly [number, number, number];

/** Barycentric (integer numerators over `scale`) -> SVG pixels. */
function toXY(b: IVec, scale: number): [number, number] {
  const apex = [PADDING + SIDE / 2, PADDING] as const;
  const bl = [PADDING, PADDING + SIDE * SQRT3_2] as const;
  const br = [PADDING + SIDE, PADDING + SIDE * SQRT3_2] as const;
  const a = b[0] / scale;
  const bb = b[1] / scale;
  const c = b[2] / scale;
  return [
    a * apex[0] + bb * bl[0] + c * br[0],
    a * apex[1] + bb * bl[1] + c * br[1],
  ];
}

const half = (p: IVec, q: IVec): IVec => [
  (p[0] + q[0]) / 2,
  (p[1] + q[1]) / 2,
  (p[2] + q[2]) / 2,
];

const sum3 = (p: IVec, q: IVec, r: IVec): IVec => [
  p[0] + q[0] + r[0],
  p[1] + q[1] + r[1],
  p[2] + q[2] + r[2],
];

/** Per-digit charge, exposed for prefix arithmetic. */
export const DIGIT_CHARGE: Record<Digit, Charge> = {
  A: ID,
  B: S2,
  C: S3,
  X: S2S3,
};

/** Charge accumulated over the first `k` digits of an address. */
export function prefixCharge(addr: string, k: number): Charge {
  let c: Charge = ID;
  const n = Math.min(k, addr.length);
  for (let i = 0; i < n; i++) c = (c ^ DIGIT_CHARGE[addr[i] as Digit]) as Charge;
  return c;
}

/**
 * Mirror phase of the sub-triangle a cell sits in, `k` levels down.
 *
 * Every sub-triangle carries an exact mirror -- verified on all 1364
 * sub-triangles of the depth-6 figure -- but the recolouring that realises
 * it depends on the prefix charge. The twist is t(u) = c(u) XOR phi(c(u)),
 * which is the identity exactly when c(u) lies in H. So:
 *
 *   prefix in H      -> mirrors IN PHASE with the whole figure
 *                       (gold stays gold, purple stays purple)
 *   prefix outside H -> mirrors OUT OF PHASE, H-cosets swapped
 *                       (gold becomes purple, blue becomes red)
 *
 * The split is exactly even: 682 / 682 at depth 6.
 */
export function inPhase(addr: string, k: number): boolean {
  return H.has(prefixCharge(addr, k));
}

/** First non-X digit. Empty only for the all-X hub. */
export function firstNonX(addr: string): "" | Digit {
  for (const ch of addr) if (ch !== "X") return ch as Digit;
  return "";
}

/**
 * Which barycentric coordinates a median reflection permutes. Reflecting
 * across the median from vertex A fixes A's coordinate and swaps the two
 * others; this is why the reflections are coordinate permutations rather
 * than anything requiring trigonometry.
 */
const AXIS_SWAP: Record<Axis, IVec> = {
  A: [0, 2, 1],
  B: [2, 1, 0],
  C: [1, 0, 2],
};

export function buildFigure(
  depth: number,
  convention: Convention = "apex"
): Figure {
  const scale = 2 ** depth;
  const cells: Cell[] = [];
  /** Exact integer centroid key per cell, parallel to `cells`. */
  const keys: IVec[] = [];
  const byKey = new Map<string, number>();

  const walk = (
    PA: IVec,
    PB: IVec,
    PC: IVec,
    addr: string,
    charge: Charge,
    nCentres: number
  ): void => {
    if (addr.length === depth) {
      const key = sum3(PA, PB, PC);
      const i = cells.length;
      keys.push(key);
      byKey.set(key.join(","), i);
      cells.push({
        i,
        addr,
        charge,
        eps: (nCentres % 2) as 0 | 1,
        ftype: firstNonX(addr),
        verts: [toXY(PA, scale), toXY(PB, scale), toXY(PC, scale)],
        centroid: toXY(key, scale * 3),
        key: [key[0], key[1], key[2]],
        bary: [PA, PB, PC],
        mirror: { A: -1, B: -1, C: -1 },
        coherentAxes: [],
      });
      return;
    }
    const MAB = half(PA, PB);
    const MAC = half(PA, PC);
    const MBC = half(PB, PC);
    // The A child and the inverted X child are the same either way; only the
    // role ordering of the B and C corners moves. Charge XOR is identical to
    // equilat_v4.py's recurse() in both conventions.
    walk(PA, MAB, MAC, addr + "A", (charge ^ ID) as Charge, nCentres);
    if (convention === "apex") {
      walk(PB, MBC, MAB, addr + "B", (charge ^ S2) as Charge, nCentres);
      walk(PC, MAC, MBC, addr + "C", (charge ^ S3) as Charge, nCentres);
    } else {
      walk(MAB, PB, MBC, addr + "B", (charge ^ S2) as Charge, nCentres);
      walk(MAC, MBC, PC, addr + "C", (charge ^ S3) as Charge, nCentres);
    }
    walk(MBC, MAC, MAB, addr + "X", (charge ^ S2S3) as Charge, nCentres + 1);
  };

  walk([scale, 0, 0], [0, scale, 0], [0, 0, scale], "", ID, 0);

  for (const cell of cells) {
    const k = keys[cell.i];
    for (const axis of AXES) {
      const p = AXIS_SWAP[axis];
      const j = byKey.get([k[p[0]], k[p[1]], k[p[2]]].join(","));
      if (j === undefined) {
        throw new Error(`no mirror partner for ${cell.addr} across m_${axis}`);
      }
      cell.mirror[axis] = j;
    }
  }

  for (const cell of cells) {
    cell.coherentAxes = AXES.filter((ax) =>
      coherent(cell.charge, cells[cell.mirror[ax]].charge)
    );
  }

  return {
    depth,
    convention,
    cells,
    hub: cells.findIndex((c) => c.addr === "X".repeat(depth)),
    width: SIDE + 2 * PADDING,
    height: SIDE * SQRT3_2 + 2 * PADDING,
    corners: [
      toXY([scale, 0, 0], scale),
      toXY([0, scale, 0], scale),
      toXY([0, 0, scale], scale),
    ],
  };
}
