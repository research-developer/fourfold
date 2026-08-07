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

import { REP9_LETTERS, scaleOfDepth, scaleOfRep9Depth } from "./scale";

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
  /**
   * How many cuts were taken. Still a depth, and still true — what it stopped
   * being is a RESOLUTION; see `scale` below and `scale.ts`'s header.
   */
  depth: number;
  /**
   * The edge division product — the denominator every `bary` is a numerator
   * over, and the figure's resolution.
   *
   * CARRIED rather than derived. Six modules used to recompute `2 ** depth` from
   * this figure's own depth; they now read this. At radix 4 the two are the same
   * number, which is what makes the change checkable: `test/byteidentity.test.ts`
   * pins the bytes of all three exports across it.
   */
  scale: number;
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

/**
 * The triangle canvas, independent of depth.
 *
 * `buildFigure` returns these three numbers on every figure it builds, because
 * the frame is a property of the CANVAS and not of the cut. Naming it once means
 * the sector view — which frames one sector of the hexagon into exactly this
 * triangle, and must land on the same pixels the standalone triangle always did
 * — can ask for the frame without building a figure to read it off, and cannot
 * come to disagree with it either. See `view.ts`.
 */
export const TRIANGLE_FRAME: {
  readonly width: number;
  readonly height: number;
  /** Apex (A), bottom-left (B), bottom-right (C), in SVG pixels. */
  readonly corners: readonly [
    [number, number],
    [number, number],
    [number, number]
  ];
} = {
  width: SIDE + 2 * PADDING,
  height: SIDE * SQRT3_2 + 2 * PADDING,
  corners: [toXY([1, 0, 0], 1), toXY([0, 1, 0], 1), toXY([0, 0, 1], 1)],
};

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
  // THE BOUNDARY, first of two. A depth comes in from the UI — a button — and
  // becomes the scale everything downstream carries. See `scale.ts`.
  const scale = scaleOfDepth(depth);
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
    scale,
    convention,
    cells,
    hub: cells.findIndex((c) => c.addr === "X".repeat(depth)),
    width: TRIANGLE_FRAME.width,
    height: TRIANGLE_FRAME.height,
    // `toXY([scale,0,0], scale)` is `toXY([1,0,0], 1)` — the corner does not
    // move with the depth — so the frame is read from the one constant rather
    // than recomputed here where it could drift from it.
    corners: [
      [TRIANGLE_FRAME.corners[0][0], TRIANGLE_FRAME.corners[0][1]],
      [TRIANGLE_FRAME.corners[1][0], TRIANGLE_FRAME.corners[1][1]],
      [TRIANGLE_FRAME.corners[2][0], TRIANGLE_FRAME.corners[2][1]],
    ],
  };
}

// ═════════════════════════════════════════════════════════════════════════
// REP-9 — the second radix, built ALONGSIDE and not instead of the first
// ═════════════════════════════════════════════════════════════════════════
//
// Everything above cuts a triangle into FOUR: three upright corners and one
// inverted centre, edge division 2. Everything below cuts it into NINE: six
// upright and three inverted, edge division 3. The two constructions share this
// module's canvas (`TRIANGLE_FRAME`, `toXY`, `AXIS_SWAP`) and its discipline —
// exact integer barycentrics, mirror partners by integer key lookup, float only
// at the projection to pixels — and share nothing else. `buildFigure` is not
// touched, not parameterised and not called from here.
//
// The mathematics is `docs/rep9-charge.md`, which was decided by exhaustive
// computation in `test/reptile.test.ts` against `src/lib/reptile.ts`. NOTHING IS
// IMPORTED FROM `reptile.ts`: it is the independent oracle that
// `test/rep9figure.test.ts` decides this code against, and an import would make
// the two sides the same side. The cut below is therefore RE-DERIVED here, in
// this module's own idiom, and the test's job is to catch it if the derivation
// slipped.
//
// ── What is forced, what is derived, and the one thing that is fiat ──────
//
// FORCED. The nine letters carry two canonical coordinates, both read off the
// geometry with no group, no labelling and no search:
//
//   GRADE   the rotation's orbits on the alphabet — corner, edge, inverted.
//           Every one of the three is fixed by every symmetry, so a function of
//           the grade is an INVARIANT, which is what a charge has to be.
//   VERTEX  the mirrors' fixed sets — Fix(m_A), Fix(m_B), Fix(m_C). The class is
//           fixed and the three lines are permuted exactly as the triangle's own
//           vertices are, which is what an ARM label has to be.
//
// Each meets each in one letter, so Σ₉ ≅ grade × vertex and the letters are
// named by the pair rather than by an index order. That naming is the condition
// `docs/rep9-charge.md` attaches to serialising a rep-9 figure at all.
//
// DERIVED, below, from the (i, j, l) enumeration and `AXIS_SWAP`:
// which mirror fixes each child, which children touch a parent corner, and each
// child's role frame. Every one of those is computed and cross-checked with a
// throw, never declared as a table. A table would be a second place for the
// alphabet to be wrong.
//
// FIAT: exactly one bit — which of the two UPRIGHT grade classes counts as +1.
// See `REP9_POSITIVE_CLASS`. It is never serialised.
//
// ── There is NO HUB, and its absence is derived ─────────────────────────
//
// Rep-4's hub is the letter X, fixed by all six symmetries. At rep-9 no letter
// is: the rotation acts freely on the alphabet (three orbits of three), and the
// three mirror fixed sets are PARALLEL rather than concurrent — three letters
// each, disjoint, covering, which happens iff 3k = k², i.e. at k = 3 and nowhere
// else. So `Figure.hub` has no analogue on `Rep9Figure` and there is no field
// for it. See `arms.ts` and `scale.rep9ArmCellsAtScale` for what that buys.

/** ℤ/3 — the rep-9 charge group, as `figure.ts`'s `Charge` is V4 for rep-4. */
export type Grade = 0 | 1 | 2;

/**
 * The nine letters. Lowercase and disjoint from rep-4's `[ABCX]`, which is what
 * lets `scale.radixAt` recover the radix from the address; the spelling and the
 * reason both live in `scale.REP9_LETTERS`, so that there is one place the nine
 * characters are written down.
 */
export type Rep9Digit =
  | "a" | "b" | "c"
  | "u" | "v" | "w"
  | "x" | "y" | "z";

/**
 * The three grade classes, named by geometry and not by index:
 *
 *   corner    shares a vertex with the parent. Equivalently — and this is the
 *             dual the measurement produced — the three children that do NOT
 *             touch the parent's centroid.
 *   edge      upright, on the edge opposite its own vertex, touching the
 *             centroid.
 *   inverted  points the other way to the parent, touching the centroid.
 *
 * These are exactly the rotation's three orbits, so the classification is D₃-
 * invariant: no symmetry moves a letter out of its class. That is the reason the
 * charge below survives the mirrors, which act on addresses by a transducer and
 * not by a digit rewrite — every element of S₃ permutes (i, j, l) and the
 * classes are cut out by the MULTISET {i, j, l}, which a permutation cannot
 * change.
 */
export type GradeClass = "corner" | "edge" | "inverted";

export const GRADE_CLASSES: readonly GradeClass[] = [
  "corner",
  "edge",
  "inverted",
] as const;

/**
 * THE ONE ARBITRARY CHOICE IN THE WHOLE CONSTRUCTION: which upright class is +1.
 *
 * The grade charge is ℤ/3-valued: 0 on the inverted class and ±1 on the two
 * upright classes. Which upright class takes +1 is not decided by anything.
 * Both classes are nameable — `corner` shares a vertex with the parent, `edge`
 * does not — but neither is POSITIVE. The mirrors and the rotations all fix each
 * class setwise, so there is no chirality argument either, and the residual
 * freedom is exactly `Aut(ℤ/3)`, of order 2. (Rep-4's residual freedom, once its
 * basepoint is forced, is `Aut(V₄)`, of order 6. Rep-9 is the LESS arbitrary of
 * the two, not the more.)
 *
 * It is isolated to the layer that does the least damage: **the sign is never
 * serialised.** Files store addresses; the charge is computed from them. Flip
 * this constant and every stored figure still names the same triangles, and
 * every charge in memory maps through the unique non-trivial automorphism of
 * ℤ/3. `test/rep9figure.test.ts` measures exactly that and nothing weaker.
 */
export const REP9_POSITIVE_CLASS: GradeClass = "corner";

/** Grade of a class under the sign convention above. Inverted is always 0. */
function gradeOfClass(g: GradeClass): Grade {
  if (g === "inverted") return 0;
  return g === REP9_POSITIVE_CLASS ? 1 : 2;
}

export interface Rep9Letter {
  readonly name: Rep9Digit;
  /** Position in `REP9_ALPHABET`: `3 · gradeClass + vertex`. */
  readonly index: number;
  /** The vertex whose median mirror fixes this child. The ARM coordinate. */
  readonly vertex: Axis;
  readonly gradeClass: GradeClass;
  /** ℤ/3. The CHARGE coordinate. 0 inverted; ±1 on the two upright classes. */
  readonly grade: Grade;
  /** true for the three children that point the other way to the parent. */
  readonly inverted: boolean;
  /** Barycentric index triple in the parent's 3-grid, before framing. */
  readonly ijl: IVec;
  /**
   * The child's three vertices as integer weights over 3 in the PARENT's own
   * vertices, in ROLE ORDER — i.e. already framed. `buildRep9Figure` blends
   * these against the parent triple and recurses on the result, so the frame is
   * carried into the subtree exactly as `buildFigure`'s role ordering is.
   */
  readonly weights: readonly [IVec, IVec, IVec];
}

const REP9_CORNERS: readonly IVec[] = [
  [3, 0, 0],
  [0, 3, 0],
  [0, 0, 3],
];

const sameVec = (p: IVec, q: IVec) => p[0] === q[0] && p[1] === q[1] && p[2] === q[2];

const permVec = (p: IVec, s: IVec): IVec => [p[s[0]], p[s[1]], p[s[2]]];

/**
 * The alphabet, DERIVED. Enumerate the nine children of the 3-grid, then read
 * each letter's two coordinates and its frame off the geometry.
 *
 * ── The frame rule, and why it is this one ───────────────────────────────
 *
 * A "convention" in `figure.ts`'s sense is a choice, per child, of which of its
 * vertices plays role 0 — and the choice is carried into the subtree, because
 * the next cut is written in the child's own vertex order. Rep-4 has two such
 * conventions (`apex` and `ifs`) and neither is forced. Rep-9 admits a rule that
 * states itself in one line:
 *
 *   > ROLE 0 IS THE CHILD'S UNIQUE VERTEX FIXED BY THE MIRROR THAT FIXES THE
 *   > CHILD, and the other two follow in the subdivision's own cyclic order.
 *
 * Every letter is fixed by exactly one mirror m_v — that is the vertex
 * coordinate — and m_v fixes the child triangle setwise, hence fixes exactly one
 * of its three vertices and swaps the other two. So the rule is total, it is
 * unique, and it is manifestly a function of the (vertex, grade) naming rather
 * than of an index order. Geometrically it lands on: the parent's own corner for
 * the three corner children, and the parent's CENTROID for the other six — which
 * are precisely the six that touch the centroid.
 *
 * It is apex-style in rep-4's exact sense on the class where that phrase means
 * something: each corner child keeps the parent's corner as its role-A vertex.
 *
 * ── What this buys, and what was rejected ────────────────────────────────
 *
 * Under it the 120° rotation REWRITES ONLY THE FIRST DIGIT — 729 of 729 cells at
 * depth 3, measured against the geometry rather than asserted, with the `ifs`
 * reading scoring 0 of 729 on the same gate. That is the law rep-4 cannot have:
 * the recurrence F(π d) = r ∘ F(d) closes iff the rotation acts freely on the
 * alphabet, and at rep-4 the orbit through X has length one, which is where
 * `docs/symmetry-findings.md` §A's "first NON-X digit" comes from. At rep-9
 * every orbit has length 3 and r³ = id, so there is no exception to state.
 *
 * REJECTED: `reptile.rotationFrames(3)`'s own solution, `[0,0,2,1,1,2,0,1,2]`.
 * It solves the same recurrence and gives the same 729/729 — the recurrence
 * constrains each rotation orbit's frames only up to post-composition by a
 * constant, so there are 6³ = 216 solutions and it returns one of them. But its
 * phase on each orbit comes from "frames[d] = 0 at the orbit representative",
 * and the representative is whichever letter reptile's index order reached
 * first. That is not a statable rule, and the frame choice IS serialised — it
 * decides which triangle each address names.
 *
 * MEASURED, because the first guess about this was wrong and the test caught it:
 * the two solutions agree on the CORNER orbit only — where both are apex, the
 * parent's corner in role 0 — and differ by a constant on each of the other two
 * orbits. This is a DEVIATION from the literal artifact in
 * `docs/rep9-charge.md`, and `test/rep9figure.test.ts` measures all of it: the
 * rule holds letter for letter, the derived frames solve the recurrence, the
 * single-digit law holds 729/729 under them, and the disagreement with
 * `rotationFrames(3)` is exactly one constant per orbit.
 *
 * Every step below throws rather than guessing. Those throws are the derivation's
 * proof obligations, and they are the reason no table appears in this file.
 */
function buildRep9Alphabet(): readonly Rep9Letter[] {
  const raw: { ijl: IVec; verts: [IVec, IVec, IVec]; inverted: boolean }[] = [];
  // upright children: i + j + l = 2
  for (let i = 2; i >= 0; i--) {
    for (let j = 2 - i; j >= 0; j--) {
      const l = 2 - i - j;
      raw.push({
        ijl: [i, j, l],
        verts: [
          [i + 1, j, l],
          [i, j + 1, l],
          [i, j, l + 1],
        ],
        inverted: false,
      });
    }
  }
  // inverted children: i + j + l = 1
  for (let i = 1; i >= 0; i--) {
    for (let j = 1 - i; j >= 0; j--) {
      const l = 1 - i - j;
      raw.push({
        ijl: [i, j, l],
        verts: [
          [i + 1, j + 1, l],
          [i, j + 1, l + 1],
          [i + 1, j, l + 1],
        ],
        inverted: true,
      });
    }
  }
  if (raw.length !== 9) throw new Error(`rep9: ${raw.length} children, not 9`);

  // Filled with `null` rather than left sparse, because `Array.prototype.some`
  // SKIPS HOLES: on a sparse array the coverage check below would pass while a
  // slot was empty, which is exactly the failure it exists to catch.
  const out: (Rep9Letter | null)[] = new Array<Rep9Letter | null>(9).fill(null);
  for (const { ijl, verts, inverted } of raw) {
    // VERTEX: the unique median mirror fixing this child as a POINT SET.
    const fixing = AXES.filter((ax) =>
      verts.every((p) => verts.some((q) => sameVec(permVec(p, AXIS_SWAP[ax]), q)))
    );
    if (fixing.length !== 1) {
      throw new Error(`rep9: child ${ijl} is fixed by ${fixing.length} mirrors, not 1`);
    }
    const vertex = fixing[0];

    // GRADE CLASS: inverted, or upright split by whether a parent corner is one
    // of this child's own vertices.
    const touchesCorner = verts.some((p) => REP9_CORNERS.some((q) => sameVec(p, q)));
    const gradeClass: GradeClass = inverted
      ? "inverted"
      : touchesCorner
        ? "corner"
        : "edge";

    // FRAME: rotate the vertex triple so that the m_vertex-fixed vertex is role 0.
    const swap = AXIS_SWAP[vertex];
    const pinned = verts
      .map((p, r) => (sameVec(permVec(p, swap), p) ? r : -1))
      .filter((r) => r >= 0);
    if (pinned.length !== 1) {
      throw new Error(
        `rep9: child ${ijl} has ${pinned.length} vertices on the m_${vertex} median, not 1`
      );
    }
    const r = pinned[0];
    const weights: [IVec, IVec, IVec] = [
      verts[r],
      verts[(r + 1) % 3],
      verts[(r + 2) % 3],
    ];

    const index = 3 * GRADE_CLASSES.indexOf(gradeClass) + AXES.indexOf(vertex);
    const name = REP9_LETTERS[index] as Rep9Digit | undefined;
    if (name === undefined) throw new Error(`rep9: no letter at index ${index}`);
    if (out[index] !== null) {
      throw new Error(`rep9: two children share the coordinates (${gradeClass}, ${vertex})`);
    }
    out[index] = {
      name,
      index,
      vertex,
      gradeClass,
      grade: gradeOfClass(gradeClass),
      inverted,
      ijl,
      weights,
    };
  }
  const filled = out.filter((l): l is Rep9Letter => l !== null);
  if (filled.length !== 9) {
    throw new Error("rep9: the (grade, vertex) coordinates do not cover the alphabet");
  }
  return filled;
}

/** The nine letters in `3 · gradeClass + vertex` order: a b c u v w x y z. */
export const REP9_ALPHABET: readonly Rep9Letter[] = buildRep9Alphabet();

export const REP9_BY_NAME: ReadonlyMap<string, Rep9Letter> = new Map(
  REP9_ALPHABET.map((l) => [l.name, l])
);

/** Per-digit grade, exposed for prefix arithmetic as `DIGIT_CHARGE` is. */
export const REP9_DIGIT_GRADE: Record<Rep9Digit, Grade> = Object.fromEntries(
  REP9_ALPHABET.map((l) => [l.name, l.grade])
) as Record<Rep9Digit, Grade>;

/**
 * THE REP-9 CHARGE, over the first `k` digits: the sum of the per-letter grades
 * in ℤ/3.
 *
 * No group table, no basepoint, no affine structure — a sum of nine small
 * integers modulo three. It is EXACTLY D₃-INVARIANT, cell for cell, at every
 * depth: not equivariant-up-to-a-relabelling as rep-4's V4 charge is under the
 * mirrors, and not up to a twist as the full (ℤ/3)² charge is. Invariant.
 * `docs/rep9-charge.md` reports 44,280 tests and zero mismatches over depths 1–4
 * and all six symmetries; `test/rep9figure.test.ts` re-runs it against the built
 * figure, where the symmetry is an integer key lookup rather than a permutation
 * of words, and shows a one-letter mutation lethal.
 *
 * The vertex sum — the other coordinate — does NOT survive, and that asymmetry
 * is the whole content of the split: the vertex needs a basepoint, the rotation
 * translates it, and the mirrors shift it by a word-dependent amount. So the
 * canonical rep-9 charge is the grade and only the grade.
 */
export function rep9PrefixCharge(addr: string, k: number): Grade {
  let g = 0;
  const n = Math.min(k, addr.length);
  for (let i = 0; i < n; i++) {
    const letter = REP9_BY_NAME.get(addr[i]);
    if (letter === undefined) throw new Error(`rep9: ${addr[i]} is not a rep-9 letter`);
    g = (g + letter.grade) % 3;
  }
  return g as Grade;
}

/** The charge of a whole address. */
export const rep9Charge = (addr: string): Grade => rep9PrefixCharge(addr, addr.length);

export interface Rep9Cell {
  /** Index into the cells array, in recursion order. */
  i: number;
  /** Address word over the nine rep-9 letters. */
  addr: string;
  /** ℤ/3, the sum of the per-letter grades. See `rep9PrefixCharge`. */
  charge: Grade;
  /** 0 = upright, 1 = inverted — the parity of the inverted digits, as rep-4. */
  eps: 0 | 1;
  /**
   * The arm: the VERTEX of the first digit.
   *
   * `Cell.ftype` is "the first NON-X digit", and the difference is the hub: at
   * rep-4 an address can be all X and name a cell that is in no arm at any
   * depth. At rep-9 there is nothing to skip and nothing to exclude.
   *
   * `null` occurs at exactly one address, the EMPTY one — the depth-0 figure,
   * whose single cell is the whole triangle and has no first digit. That is not
   * the hub coming back: it is the empty word, it exists at rep-4 too, and at
   * every depth ≥ 1 the three arms partition the cells with residual exactly
   * zero. `rep9ArmCensus` counts that residual rather than asserting it.
   */
  arm: Axis | null;
  /** Triangle vertices in SVG pixel space. THE ONLY FLOAT ON THIS CELL. */
  verts: [number, number][];
  centroid: [number, number];
  /** Exact integer barycentric centroid key: the three vertex coordinates summed. */
  key: [number, number, number];
  /** The three vertices in exact integer barycentrics over `3^depth`. */
  bary: [IVec, IVec, IVec];
  /** Mirror partner index across each median, by exact integer key. */
  mirror: Record<Axis, number>;
}

export interface Rep9Figure {
  /** How many cuts were taken. Still the address length. */
  depth: number;
  /** The edge-division product: 3^depth, the denominator every `bary` is over. */
  scale: number;
  cells: Rep9Cell[];
  width: number;
  height: number;
  corners: [[number, number], [number, number], [number, number]];
}

/**
 * G(w) = (w₀·P_A + w₁·P_B + w₂·P_C)/3, the parent's 3-grid point at integer
 * weights `w` summing to 3.
 *
 * Exact for the same reason `half` is: a figure built to depth d holds every
 * coordinate as an integer over 3^d, and a triangle t levels down has vertices
 * divisible by 3^(d−t), so a cut with t < d divides cleanly. Unlike `half` this
 * SAYS SO — a silent non-integer here would put a cell a third of a lattice unit
 * off its true position, still plausible, still drawable, and undetectable
 * downstream because everything downstream trusts the key. The check has never
 * fired; it is here because the whole claim of this module is exactness.
 */
function rep9Blend(PA: IVec, PB: IVec, PC: IVec, w: IVec): IVec {
  const out: [number, number, number] = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const n = w[0] * PA[k] + w[1] * PB[k] + w[2] * PC[k];
    if (n % 3 !== 0) {
      throw new Error(`rep9: grid point ${w} is not on the integer lattice (${n}/3)`);
    }
    out[k] = n / 3;
  }
  return out;
}

/**
 * The rep-9 figure at a stated depth: 9^depth cells, exact integer geometry.
 *
 * Deliberately NOT a `convention` parameter. Rep-4 carries one because its frame
 * choice is genuinely unconstrained and the two readings give different exact
 * symmetry groups (`docs/symmetry-findings.md` §E). Rep-9's frame is fixed by the
 * mirror rule stated on `buildRep9Alphabet`, which is a statable geometric law
 * rather than a taste, and which also delivers the single-first-digit rotation
 * law. An `ifs` reading exists — it is what `reptile.subdivide` produces
 * unframed — and the test measures it as the losing side of that gate, but there
 * is no reason to ship an addressing that scores 0/729 on the property this one
 * was chosen for.
 */
export function buildRep9Figure(depth: number): Rep9Figure {
  // THE BOUNDARY. A depth comes in from the UI and becomes the scale everything
  // downstream carries — `scale.ts`'s rule, at the other radix.
  const scale = scaleOfRep9Depth(depth);
  const cells: Rep9Cell[] = [];
  const keys: IVec[] = [];
  const byKey = new Map<string, number>();

  const walk = (
    PA: IVec,
    PB: IVec,
    PC: IVec,
    addr: string,
    charge: Grade,
    nInverted: number
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
        eps: (nInverted % 2) as 0 | 1,
        // Never a search: the first letter's vertex, full stop. `null` only at
        // the empty address, which is only the depth-0 figure.
        arm: addr.length === 0 ? null : (REP9_BY_NAME.get(addr[0]) as Rep9Letter).vertex,
        verts: [toXY(PA, scale), toXY(PB, scale), toXY(PC, scale)],
        centroid: toXY(key, scale * 3),
        key: [key[0], key[1], key[2]],
        bary: [PA, PB, PC],
        mirror: { A: -1, B: -1, C: -1 },
      });
      return;
    }
    for (const letter of REP9_ALPHABET) {
      walk(
        rep9Blend(PA, PB, PC, letter.weights[0]),
        rep9Blend(PA, PB, PC, letter.weights[1]),
        rep9Blend(PA, PB, PC, letter.weights[2]),
        addr + letter.name,
        ((charge + letter.grade) % 3) as Grade,
        nInverted + (letter.inverted ? 1 : 0)
      );
    }
  };

  walk([scale, 0, 0], [0, scale, 0], [0, 0, scale], "", 0, 0);

  // Mirror partners, by exact integer key — the same lookup `buildFigure` does,
  // and it works here for the same reason: the cut is equivariant, so the cell
  // set is D₃-stable and every cell has a partner across every median. A missing
  // partner would mean the subdivision is not what this module thinks it is,
  // which is why it throws rather than storing −1.
  for (const cell of cells) {
    const k = keys[cell.i];
    for (const axis of AXES) {
      const p = AXIS_SWAP[axis];
      const j = byKey.get([k[p[0]], k[p[1]], k[p[2]]].join(","));
      if (j === undefined) {
        throw new Error(`rep9: no mirror partner for ${cell.addr} across m_${axis}`);
      }
      cell.mirror[axis] = j;
    }
  }

  // NO `coherentAxes`. Rep-4's is membership in H = {1, σ₂σ₃}, the index-2
  // subgroup of V4 fixing √6, and every scoring rule in the game is a statement
  // about that partition. ℤ/3 has NO subgroup of index 2 — it has no proper
  // non-trivial subgroup at all — so there is no rep-9 analogue to compute and
  // none is invented. This absence is a fact about the group, not an omission.

  return {
    depth,
    scale,
    cells,
    width: TRIANGLE_FRAME.width,
    height: TRIANGLE_FRAME.height,
    corners: [
      [TRIANGLE_FRAME.corners[0][0], TRIANGLE_FRAME.corners[0][1]],
      [TRIANGLE_FRAME.corners[1][0], TRIANGLE_FRAME.corners[1][1]],
      [TRIANGLE_FRAME.corners[2][0], TRIANGLE_FRAME.corners[2][1]],
    ],
  };
}
