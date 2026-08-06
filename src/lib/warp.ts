/**
 * WARP — is vertex-shared geometry with curvature at the display boundary sound?
 *
 * SCOPE. This module is a MEASUREMENT INSTRUMENT, not a feature, in exactly the
 * sense `src/lib/reptile.ts` is one: nothing in `src/app` imports it, it draws
 * nothing, and it exists so that `test/warp.test.ts` can decide five questions by
 * exhaustive computation rather than by argument. The verdict is
 * `docs/warp-findings.md`.
 *
 * The proposal under test, in the owner's words: *the vertices are what warrant
 * shared allocation; the whole shape derives from a single FlowAngle-based
 * hexagon, then rep-tiled; triangles are the lemmas.* The framing under test:
 * *containment is decided on the straight integer lattice; curvature and vertex
 * motion are a WARP at the display boundary, and a warp is a bijection so
 * theory.md §9 is untouched.*
 *
 *   Q1  how much geometry does per-triangle storage actually duplicate?
 *   Q2  derive-on-demand (O(d) time, O(1) space) vs a materialised vertex table
 *       (O(V) space, O(1) lookup) — do they agree exactly, and what do they cost?
 *   Q3  does §9's centroid-in-footprint test survive a NON-AFFINE warp?
 *   Q4  vertex motion: in the lattice vs in the warp.
 *   Q5  does §10.1's seam identity α_L + α_R = 1 survive a warp, separately in
 *       the linear residue model and in the exact-area tier?
 *
 * and one arithmetic question the FlowAngle construction raises:
 *
 *   R   for which apex angles is the FlowAngle apex an exact element of ℤ[√3]?
 *
 * ── WHERE THE FLOAT IS ───────────────────────────────────────────────────
 *
 * NOWHERE IN THIS FILE. There is no `Math.` call, no `/` on numbers, and no
 * `number` used as a coordinate past the lattice. Warped coordinates are exact
 * rationals over `number` with every product routed through a `safe()` overflow
 * guard (`Rat`); ring elements are exact `a + b√3` over the same rationals
 * (`Z3`). `rToFixed` renders a decimal digit by digit, so even the
 * human-readable numbers are exact and no wide intermediate is formed.
 *
 * The display boundary this module is ABOUT is `figure.toXY` and
 * `hexagon.latticeToPixel`, which are the two places the shipped program divides
 * by a scale and multiplies by √3/2. Neither is touched and neither is called
 * from here.
 *
 * `test/warp.test.ts` uses float in exactly one labelled block, to cross-check
 * the ring apex against `Math.tan`. That is a verification oracle, stated as one.
 *
 * ── WHY THE MEASUREMENTS ARE IN LATTICE COORDINATES AND NOT PIXELS ───────
 *
 * `hexagon.ts`'s basis is e1 = (1,0), e2 = (1/2, √3/2), so a lattice point (a, b)
 * is the plane point a·e1 + b·e2. That basis change is a fixed LINEAR map of
 * determinant √3/2. Everything this module measures — collinearity, orientation,
 * containment, and every AREA RATIO — is invariant under a linear change of
 * basis, so working in (a, b) is not an approximation of the pixel plane: it is
 * the same question with the √3 factored out, and factoring it out is what makes
 * every answer here an exact rational instead of an element of ℤ[√3].
 *
 * The one quantity that is NOT ratio-invariant is an absolute area, and this
 * module never reports one except as a fraction of another area in the same
 * basis. Section R is where √3 genuinely enters, and it is carried exactly.
 */

import {
  REP9_ALPHABET,
  type Convention,
  type Digit,
  type IVec,
} from "./figure";
import { baryToLat, rotK, type Lat } from "./hexagon";

// ═════════════════════════════════════════════════════════════════════════
// EXACT RATIONALS OVER `number`, WITH A HARD GUARD
// ═════════════════════════════════════════════════════════════════════════
//
// ── The arithmetic type is not the question. The DYNAMIC RANGE is. ───────
//
// An earlier draft of this module used `bigint`, on the reasoning that exact
// rational clipping forms wide intermediates. That was answering the wrong
// question. The exactness argument belongs to the RING, and the production
// arithmetic belongs to `floang-core`'s RNS path — see
// `rationall-dev@feat/bigdozenal-rns-montgomery`,
// `demos/rns-ring-multiply-synth/RATIONAL.md`:
//
//   > In RNS the only carries are the ⌈log₂ mᵢ⌉-bit modular reductions, BOUNDED
//   > BY THE MODULUS WIDTH, NOT BY 2·W. … As long as |result| < 𝓜/2, CRT is
//   > exact — the RNS path returns bit-for-bit the same (a_out, b_out) as the
//   > schoolbook (verified: 128/128 RTL vectors, 128/128 Rust).
//
// So the width of a machine word is not a constraint to be worked around; it is
// a LANE SIZING INPUT. What a scoping prototype owes the design is therefore not
// a wider integer type but a NUMBER: the dynamic range each operation actually
// needs at each reachable depth, from which the moduli set is sized once.
//
// Hence: plain `number`, and every product routed through `safe()` — exactly the
// discipline `reptile.ts` already uses ("a measurement instrument that can lie is
// worthless"). Where the guard fires, that is not a failure of the prototype; it
// is the measurement, and `rangeReport()` turns it into a lane count.
//
// This also clears `tsc --noEmit` and `next build` under the repo's ES2017
// target with no config change, which was the immediate need.

/** n/d in lowest terms, d > 0. Both are exact integers below 2^53. */
export interface Rat {
  readonly n: number;
  readonly d: number;
}

/**
 * THE RANGE METER. The widest magnitude any guarded operation has formed since
 * the last reset — INCLUDING un-normalised intermediates, which is the number
 * that actually sizes a datapath.
 *
 * Reported as bits, and converted to a lane count by `laneCount` below. A meter
 * that is never read is decoration; `test/warp.test.ts` asserts on this one.
 */
let widest = 1;

const bitsOf = (v: number): number => {
  const a = Math.abs(v);
  return a < 1 ? 1 : a.toString(2).replace(/[-.].*$/, "").length;
};

/**
 * Every product, sum-of-products and quotient numerator passes through here.
 * Throwing rather than silently rounding is the whole point: a prototype whose
 * answer degrades quietly past 2^53 would report Q5's identities as holding when
 * they had merely stopped being computed.
 */
function safe(x: number): number {
  const a = Math.abs(x);
  if (a > widest) widest = a;
  if (!Number.isSafeInteger(x)) {
    throw new Error(
      `warp: exact range exceeded (${x}) — this is a MEASUREMENT, not a bug: ` +
        `the operation needs ${bitsOf(x)} bits, see rangeReport()`
    );
  }
  return x;
}

export interface RangeReport {
  /** Widest magnitude formed, in bits. */
  readonly bits: number;
  /**
   * Lanes needed under `rns_ring_multiply.pow2_adjacent_base(k)` — the classic
   * low-cost triple {2^k−1, 2^k, 2^k+1}, whose dynamic range is
   * 𝓜 = 2^k(2^{2k}−1) ≈ 2^{3k} with a signed window of ±2^{3k−1}.
   *
   * That base is ALWAYS three lanes; what the measurement fixes is the lane
   * WIDTH k. Reported as both, because "three lanes of 16 bits" is the sentence
   * a hardware design needs and "62 bits" is not.
   */
  readonly lanes: number;
  readonly laneBits: number;
}

/** k = ⌈(bits + 1)/3⌉ for the {2^k−1, 2^k, 2^k+1} triple. Three lanes, always. */
export const laneCount = (bits: number): RangeReport => ({
  bits,
  lanes: 3,
  laneBits: Math.ceil((bits + 1) / 3),
});

export const rangeReport = (): RangeReport => laneCount(bitsOf(widest));
export const rangeReset = (): void => {
  widest = 1;
};

/**
 * The same measurement WITHOUT the throw, for probing where a composition's
 * range boundary lies. Returns null when the operation would leave exact range.
 */
export function tryMul(a: number, b: number): number | null {
  const x = a * b;
  return Number.isSafeInteger(x) ? x : null;
}

const igcd = (a: number, b: number): number => {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) [x, y] = [y, x % y];
  return x;
};

export function rat(n: number, d = 1): Rat {
  if (d === 0) throw new Error("warp: zero denominator");
  safe(n);
  safe(d);
  const s = d < 0 ? -1 : 1;
  const g = igcd(n, d) || 1;
  return { n: (s * n) / g, d: (s * d) / g };
}

export const rInt = (n: number): Rat => ({ n: safe(n), d: 1 });
export const R0: Rat = { n: 0, d: 1 };
export const R1: Rat = { n: 1, d: 1 };

export const rAdd = (x: Rat, y: Rat): Rat =>
  rat(safe(safe(x.n * y.d) + safe(y.n * x.d)), safe(x.d * y.d));
export const rSub = (x: Rat, y: Rat): Rat =>
  rat(safe(safe(x.n * y.d) - safe(y.n * x.d)), safe(x.d * y.d));
export const rMul = (x: Rat, y: Rat): Rat => rat(safe(x.n * y.n), safe(x.d * y.d));
export const rDiv = (x: Rat, y: Rat): Rat => {
  if (y.n === 0) throw new Error("warp: division by zero");
  return rat(safe(x.n * y.d), safe(x.d * y.n));
};
export const rNeg = (x: Rat): Rat => ({ n: -x.n, d: x.d });
export const rSign = (x: Rat): number => (x.n > 0 ? 1 : x.n < 0 ? -1 : 0);
export const rCmp = (x: Rat, y: Rat): number => rSign(rSub(x, y));
export const rEq = (x: Rat, y: Rat): boolean => x.n === y.n && x.d === y.d;
export const rAbs = (x: Rat): Rat => (x.n < 0 ? rNeg(x) : x);
export const rMax = (x: Rat, y: Rat): Rat => (rCmp(x, y) >= 0 ? x : y);

/** Clamp to [0, 1]. The residue model's clamp, exactly. */
export const rClamp01 = (x: Rat): Rat =>
  rSign(x) < 0 ? R0 : rCmp(x, R1) > 0 ? R1 : x;

/**
 * A fixed-point decimal rendering, digit by digit, with no wide product.
 *
 * For reports only. The naive `n·10^p / d` would form exactly the kind of
 * intermediate this module exists to measure, so the integer part is taken first
 * and the fraction is emitted one digit at a time from the remainder — every
 * step bounded by 10·d.
 */
export function rToFixed(x: Rat, places: number): string {
  const neg = x.n < 0;
  let r = Math.abs(x.n);
  const d = x.d;
  const whole = Math.floor(r / d);
  r -= whole * d;
  let frac = "";
  let carry = 0;
  const digits: number[] = [];
  for (let i = 0; i < places; i++) {
    r = safe(r * 10);
    digits.push(Math.floor(r / d));
    r -= digits[i] * d;
  }
  // round half away from zero on the first dropped digit
  if (r * 2 >= d) carry = 1;
  for (let i = places - 1; i >= 0 && carry; i--) {
    const v = digits[i] + carry;
    digits[i] = v % 10;
    carry = v >= 10 ? 1 : 0;
  }
  frac = digits.join("");
  const head = whole + carry;
  const body = places === 0 ? `${head}` : `${head}.${frac}`;
  return neg && (head !== 0 || r !== 0 || frac.replace(/0/g, "") !== "") ? `-${body}` : body;
}

/** A point of the warped plane. Exact. */
export type QPt = readonly [Rat, Rat];

export const qOf = (a: number, b: number): QPt => [rInt(a), rInt(b)];
export const qEq = (p: QPt, q: QPt): boolean => rEq(p[0], q[0]) && rEq(p[1], q[1]);

/** Twice the signed area of the triangle (o, a, b). Sign is the orientation. */
export const qOrient2 = (o: QPt, a: QPt, b: QPt): Rat =>
  rSub(
    rMul(rSub(a[0], o[0]), rSub(b[1], o[1])),
    rMul(rSub(a[1], o[1]), rSub(b[0], o[0]))
  );

export const qCentroid = (t: readonly QPt[]): QPt => {
  const three = rInt(t.length);
  let x = R0;
  let y = R0;
  for (const p of t) {
    x = rAdd(x, p[0]);
    y = rAdd(y, p[1]);
  }
  return [rDiv(x, three), rDiv(y, three)];
};

// ═════════════════════════════════════════════════════════════════════════
// Q1 — THE REDUNDANCY, MEASURED
// ═════════════════════════════════════════════════════════════════════════
//
// The claim to test: per-triangle storage duplicates the vertex data ~6×,
// because an interior vertex of the triangular lattice has degree 6.
//
// The measurement is a census, not a formula: collect every triangle's three
// vertices as EXACT integer lattice points, count the slots (3 per triangle) and
// the distinct points, and report the ratio and the degree histogram. The
// histogram is what turns "≈6" into an accounting: Σ_v deg(v) = slots, so the
// gap between the ratio and 6 is exactly the boundary's degree deficit and
// nothing else.

export interface VertexCensus {
  /** Triangles in the canvas. */
  readonly cells: number;
  /** Vertex slots under per-triangle storage: 3 per triangle. */
  readonly slots: number;
  /** Distinct lattice vertices. */
  readonly distinct: number;
  /** slots / distinct — the redundancy factor, exact. */
  readonly ratio: Rat;
  /** 6·distinct − slots: the total degree deficit, all of it on the boundary. */
  readonly deficit: number;
  /** How many vertices have each incidence degree. */
  readonly degrees: ReadonlyMap<number, number>;
}

/** Anything with three exact barycentric vertices. `Cell` and `Rep9Cell` both do. */
export interface BaryCell {
  readonly bary: readonly [IVec, IVec, IVec];
}

/**
 * The lattice-vertex triples of a canvas.
 *
 * `sectors = 1` is the triangle canvas; `sectors = 6` is the hexagon, built the
 * way `hexagon.buildHexagon` builds it — the base figure's barycentrics mapped to
 * the lattice and rotated by R^s. Using `rotK` rather than a second copy of the
 * rotation is deliberate: the hexagon's vertex identifications are the thing
 * being counted, so they must come from the module that ships them.
 */
export function latTriples(
  cells: readonly BaryCell[],
  sectors = 1
): Lat[][] {
  const out: Lat[][] = [];
  for (let s = 0; s < sectors; s++) {
    for (const c of cells) {
      out.push(c.bary.map((b) => rotK(baryToLat(b), s)));
    }
  }
  return out;
}

export function vertexCensus(triples: readonly (readonly Lat[])[]): VertexCensus {
  const seen = new Map<string, number>();
  let slots = 0;
  for (const tri of triples) {
    for (const v of tri) {
      const k = `${v[0]},${v[1]}`;
      seen.set(k, (seen.get(k) ?? 0) + 1);
      slots++;
    }
  }
  const degrees = new Map<number, number>();
  for (const d of seen.values()) degrees.set(d, (degrees.get(d) ?? 0) + 1);
  const distinct = seen.size;
  return {
    cells: triples.length,
    slots,
    distinct,
    ratio: rat(slots, distinct),
    deficit: 6 * distinct - slots,
    degrees,
  };
}

// ═════════════════════════════════════════════════════════════════════════
// Q2 — LOG VERSUS LINEAR: THE DESCENT AS A PRODUCT OF AFFINE MAPS
// ═════════════════════════════════════════════════════════════════════════
//
// An address is a descent path and each digit is an affine map, so a cell's
// geometry is a product of d maps applied to the root: O(d) time, O(1) space.
// The alternative is a materialised vertex table: O(V) space, O(1) lookup.
//
// ── The representation, and why it stays in ℤ ────────────────────────────
//
// A child of a triangle with vertex triple V = (V₀, V₁, V₂) has vertices
//
//     child_i = Σ_j W[i][j] · V_j / k
//
// for an INTEGER matrix W whose rows sum to k, k the edge division. Composing two
// levels multiplies the matrices — with the deeper digit on the LEFT, because it
// acts on the child's frame:
//
//     (W_inner ∘ W_outer)[i][m] = Σ_j W_inner[i][j] · W_outer[j][m]
//
// and the denominators multiply. So after d levels the accumulator is an integer
// 3×3 matrix over the denominator ∏ k_i = `scaleOfWord(addr)`, and the cell's
// vertices in `figure.ts`'s own convention (integer numerators over `scale`) are
// LITERALLY THE ROWS of that accumulator — because `figure.ts` starts the walk at
// ([scale,0,0], [0,scale,0], [0,0,scale]), so V_j = scale·e_j and the scale
// cancels.
//
// THE ANSWER TO "does the derived path stay exact" IS THEREFORE STRUCTURAL: the
// product of integer matrices is an integer matrix, and the denominator is the
// product of the edge divisions and nothing more. A rep-9 map has denominator 3
// and it does NOT accumulate a growing common factor: 3 per rep-9 level, 2 per
// rep-4 level, exactly `rep-tile-findings.md` Q4's cost law. Contrast fold-re
// §11's curve path, where D_k = D0·8^k — three bits per level, forced by the
// CUBIC degree. Affine descent costs log₂(k) bits per level; Bézier subdivision
// costs 3. They are different laws and the difference is the degree.

/** Rows are the child's vertices as integer weights in the parent's vertices. */
export type Weights = readonly [IVec, IVec, IVec];

export interface DigitMap {
  /** Edge division applied at this digit. */
  readonly k: number;
  readonly w: Weights;
}

/**
 * The four rep-4 maps in the `apex` convention, WRITTEN OUT from `figure.ts`'s
 * documented recursion rather than extracted from it.
 *
 *   A → walk(PA,  MAB, MAC)      B → walk(PB,  MBC, MAB)
 *   C → walk(PC,  MAC, MBC)      X → walk(MBC, MAC, MAB)
 *
 * with M_PQ = (P + Q)/2. That transcription is the whole of the claim being
 * tested in Q2 — if it is wrong the derived cells will not match `buildFigure`'s,
 * cell for cell, and the test says so at 4^6 cells.
 */
export const REP4_APEX: Readonly<Record<Digit, DigitMap>> = {
  A: { k: 2, w: [[2, 0, 0], [1, 1, 0], [1, 0, 1]] },
  B: { k: 2, w: [[0, 2, 0], [0, 1, 1], [1, 1, 0]] },
  C: { k: 2, w: [[0, 0, 2], [1, 0, 1], [0, 1, 1]] },
  X: { k: 2, w: [[0, 1, 1], [1, 0, 1], [1, 1, 0]] },
};

/** The `ifs` convention: only B and C differ, and only in ROLE ORDER. */
export const REP4_IFS: Readonly<Record<Digit, DigitMap>> = {
  A: REP4_APEX.A,
  B: { k: 2, w: [[1, 1, 0], [0, 2, 0], [0, 1, 1]] },
  C: { k: 2, w: [[1, 0, 1], [0, 1, 1], [0, 0, 2]] },
  X: REP4_APEX.X,
};

/**
 * The nine rep-9 maps, taken from `figure.REP9_ALPHABET[..].weights`.
 *
 * STATED AS A DEPENDENCY, because it is one: unlike the rep-4 table above, this
 * is not an independent transcription — the rep-9 alphabet is itself derived
 * inside `figure.ts` from the geometry, and re-deriving it here would be a second
 * place for it to be wrong rather than a second opinion. What IS independent is
 * the check `test/warp.test.ts` runs on the result: the depth-d rep-9 cell set
 * produced by composing these maps is compared, as a set of canonical point-set
 * keys, against `reptile.descend`'s own subdivision — a module that knows nothing
 * about letters, frames or `figure.ts`.
 */
export const REP9_MAPS: ReadonlyMap<string, DigitMap> = new Map(
  REP9_ALPHABET.map((l) => [l.name, { k: 3, w: l.weights } as DigitMap])
);

export function digitMap(ch: string, convention: Convention): DigitMap {
  const nine = REP9_MAPS.get(ch);
  if (nine) return nine;
  const four = (convention === "ifs" ? REP4_IFS : REP4_APEX)[ch as Digit];
  if (!four) throw new Error(`warp: ${ch} is not an address letter`);
  return four;
}

/** inner ∘ outer, as integer matrices. See the section header for the order. */
export function composeWeights(inner: Weights, outer: Weights): Weights {
  const row = (i: number): IVec => {
    const out: [number, number, number] = [0, 0, 0];
    for (let m = 0; m < 3; m++) {
      let acc = 0;
      for (let j = 0; j < 3; j++) acc += inner[i][j] * outer[j][m];
      if (!Number.isSafeInteger(acc)) throw new Error("warp: descent overflow");
      out[m] = acc;
    }
    return out;
  };
  return [row(0), row(1), row(2)];
}

export interface DerivedCell {
  /** Integer barycentric numerators over `scale`, in role order. */
  readonly verts: Weights;
  /** Product of the edge divisions along the address. */
  readonly scale: number;
}

const IDENTITY_W: Weights = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

/**
 * DERIVE-ON-DEMAND. O(d) time in 3×3 integer multiplies, O(1) space — one
 * accumulator, no table, no figure, no tree.
 *
 * The signature takes only the word and the convention, which is `scale.ts`'s
 * constraint restated: the radix must be a pure function of the address, and it
 * is, because `digitMap` reads one character.
 */
export function deriveCell(addr: string, convention: Convention = "apex"): DerivedCell {
  let acc = IDENTITY_W;
  let scale = 1;
  for (const ch of addr) {
    const m = digitMap(ch, convention);
    acc = composeWeights(m.w, acc);
    scale *= m.k;
  }
  return { verts: acc, scale };
}

/**
 * MATERIALISE. One shared vertex array, one index per distinct lattice point,
 * three indices per cell: O(V) space, O(1) lookup.
 *
 * This is the other side of Q2's trade and it is deliberately the SIMPLEST thing
 * that could work, because the point of the comparison is the cost of the shape
 * of the answer and not the cleverness of the implementation.
 */
export interface VertexTable {
  readonly vertices: readonly Lat[];
  readonly cells: readonly (readonly [number, number, number])[];
  readonly index: ReadonlyMap<string, number>;
}

export function buildVertexTable(triples: readonly (readonly Lat[])[]): VertexTable {
  const index = new Map<string, number>();
  const vertices: Lat[] = [];
  const cells: [number, number, number][] = [];
  for (const tri of triples) {
    const ids = tri.map((v) => {
      const k = `${v[0]},${v[1]}`;
      let i = index.get(k);
      if (i === undefined) {
        i = vertices.length;
        index.set(k, i);
        vertices.push(v);
      }
      return i;
    });
    cells.push([ids[0], ids[1], ids[2]]);
  }
  return { vertices, cells, index };
}

// ═════════════════════════════════════════════════════════════════════════
// WARPS
// ═════════════════════════════════════════════════════════════════════════
//
// A warp is a map of the plane applied AT THE DISPLAY BOUNDARY: the partition is
// decided on the straight integer lattice, and the warp only decides where the
// decided things are drawn. The whole question is which of §9's and §10's
// guarantees survive that.
//
// TWO READINGS, and keeping them apart is most of Q3's answer:
//
//   POINTWISE   W is a function of the plane. The image of a straight edge is a
//               curve; the image of a centroid is not the centroid of an image.
//   VERTEX      W is evaluated at the vertices of one chosen scale and the
//               drawing joins the images with straight lines. This is what a
//               renderer does, and it is AFFINE ON EACH CELL OF THAT SCALE —
//               which is exactly why its failures are cross-scale and not local.
//
// Both are exercised. `Warp.apply` is the pointwise map; the vertex reading is
// what `warpTriangle` produces when handed a cell's own vertices.

export interface Warp {
  readonly name: string;
  /** True when W is affine — the control case for every gate below. */
  readonly affine: boolean;
  apply(v: Lat): QPt;
}

export const IDENTITY_WARP: Warp = {
  name: "identity",
  affine: true,
  apply: (v) => qOf(v[0], v[1]),
};

/** (a, b) ↦ (p·a + q·b + e, r·a + s·b + f). Affine, and the control. */
export function affineWarp(
  m: readonly [readonly [number, number], readonly [number, number]],
  t: readonly [Rat, Rat] = [R0, R0]
): Warp {
  return {
    name: `affine[${m[0][0]},${m[0][1]};${m[1][0]},${m[1][1]}]`,
    affine: true,
    apply: (v) => [
      rAdd(rat(m[0][0] * v[0] + m[0][1] * v[1]), t[0]),
      rAdd(rat(m[1][0] * v[0] + m[1][1] * v[1]), t[1]),
    ],
  };
}

/**
 * A GLOBALLY BIJECTIVE NON-AFFINE WARP: two triangular shears composed.
 *
 *     S₁(a, b) = (a + λ·b², b)          S₂(a, b) = (a, b + μ·a²)
 *     W = S₂ ∘ S₁
 *
 * Each factor is invertible on all of ℚ² by inspection — subtract the square of
 * the coordinate the other one did not touch — so W is a bijection of ℚ² with an
 * explicit inverse, not merely an injection on the domain measured. That matters
 * for Q3: the brief's claim "a bijection cannot change which cell a point is in"
 * is only worth testing against a warp that is provably a bijection everywhere,
 * because a warp that folds would refute the claim for an uninteresting reason.
 *
 * Both factors have unit Jacobian, so the composite does too and W is
 * area-preserving as a smooth map. It is nonetheless emphatically NON-AFFINE: it
 * takes collinear points off their line, which is the property every gate below
 * is actually sensitive to.
 */
export function shearWarp(lambda: Rat, mu: Rat): Warp {
  return {
    name: `shear(λ=${lambda.n}/${lambda.d}, μ=${mu.n}/${mu.d})`,
    affine: false,
    apply: (v) => {
      const a = rInt(v[0]);
      const b = rInt(v[1]);
      const a2 = rAdd(a, rMul(lambda, rMul(b, b)));
      const b2 = rAdd(b, rMul(mu, rMul(a2, a2)));
      return [a2, b2];
    },
  };
}

/** The inverse of `shearWarp`, so bijectivity is exhibited and not asserted. */
export function shearInverse(lambda: Rat, mu: Rat): (p: QPt) => QPt {
  return (p) => {
    const b = rSub(p[1], rMul(mu, rMul(p[0], p[0])));
    const a = rSub(p[0], rMul(lambda, rMul(b, b)));
    return [a, b];
  };
}

/**
 * A BUMP: the identity everywhere except at a named lattice vertex, which moves
 * by an exact rational offset. This is "shift a vertex in the warp", isolated to
 * one degree of freedom so the consequences can be attributed to it.
 *
 * As a pointwise map on the plane it is only defined on lattice points; extended
 * over each cell by its own vertices it is a piecewise-affine homeomorphism for
 * offsets small enough to keep every incident cell positively oriented, which
 * `test/warp.test.ts` checks by exact integer orientation rather than assuming.
 */
export function bumpWarp(target: Lat, offset: readonly [Rat, Rat]): Warp {
  const key = `${target[0]},${target[1]}`;
  return {
    name: `bump(${key} += ${offset[0].n}/${offset[0].d},${offset[1].n}/${offset[1].d})`,
    affine: false,
    apply: (v) =>
      `${v[0]},${v[1]}` === key
        ? [rAdd(rInt(v[0]), offset[0]), rAdd(rInt(v[1]), offset[1])]
        : qOf(v[0], v[1]),
  };
}

/**
 * A DELIBERATELY BROKEN warp for the guard-fire: the same bump, but each incident
 * cell gets its OWN copy of the moved vertex, displaced by a cell-dependent
 * amount. This is precisely what per-triangle vertex storage permits and shared
 * vertices forbid, and it is the mutation that has to be lethal for "shared
 * vertices make vertex motion free" to mean anything.
 */
export function unsharedBumpWarp(
  target: Lat,
  offset: readonly [Rat, Rat]
): (cellIndex: number) => Warp {
  return (cellIndex) =>
    bumpWarp(target, [
      rMul(offset[0], rInt(cellIndex + 1)),
      rMul(offset[1], rInt(cellIndex + 1)),
    ]);
}

/**
 * The same warp, translated by an exact rational vector.
 *
 * NOT decoration. Every mesh edge on this lattice is a lattice line, and a
 * lattice line is a RASTER CELL BOUNDARY — which is `theory.md` §9's "a band
 * boundary IS a quadtree cut" showing up as a measurement problem: with the mesh
 * exactly on the grid, no raster cell is ever straddled and every coverage
 * identity holds vacuously. A generic rational offset puts the seams through
 * cell interiors so that §10's α is exercised at all. Composing on the OUTSIDE
 * keeps `affine` honest: translating an affine warp leaves it affine, and
 * translating a non-affine one does not make it affine.
 */
export function offsetWarp(w: Warp, t: readonly [Rat, Rat]): Warp {
  return {
    name: `${w.name}+t(${t[0].n}/${t[0].d},${t[1].n}/${t[1].d})`,
    affine: w.affine,
    apply: (v) => {
      const p = w.apply(v);
      return [rAdd(p[0], t[0]), rAdd(p[1], t[1])];
    },
  };
}

export function warpTriangle(w: Warp, tri: readonly Lat[]): readonly QPt[] {
  return tri.map((v) => w.apply(v));
}

/** A lattice triangle scaled up to a stated denominator, for cross-scale work. */
export function latScale(tri: readonly Lat[], f: number): Lat[] {
  return tri.map((v) => [v[0] * f, v[1] * f] as Lat);
}

/**
 * The shear evaluated at an ARBITRARY exact point — the POINTWISE reading.
 *
 * `Warp.apply` takes integer lattice coordinates because that is what a renderer
 * has: vertices. This is the same map off the lattice, and the gap between the
 * two readings is the whole of Q3 — `W(centroid)` comes from here and
 * `centroid(W(verts))` comes from `Warp.apply`.
 */
export function shearApplyQ(lambda: Rat, mu: Rat): (p: QPt) => QPt {
  return (p) => {
    const a2 = rAdd(p[0], rMul(lambda, rMul(p[1], p[1])));
    const b2 = rAdd(p[1], rMul(mu, rMul(a2, a2)));
    return [a2, b2];
  };
}

// ═════════════════════════════════════════════════════════════════════════
// CONTAINMENT, EXACTLY, IN THE WARPED PLANE
// ═════════════════════════════════════════════════════════════════════════
//
// The same decision `reptile.containsCentroid` takes on the straight lattice —
// sign agreement of three cross products — but over `Rat` rather than ℤ, because
// warped coordinates are rational. `onBoundary` is reported separately for the
// same reason it is there: a centroid landing exactly on a footprint edge is the
// partition hazard, and folding it into a boolean would hide it.

export interface QContainment {
  readonly inside: boolean;
  readonly onBoundary: boolean;
}

export function qContains(tri: readonly QPt[], p: QPt): QContainment {
  const c0 = qOrient2(tri[0], tri[1], p);
  const c1 = qOrient2(tri[1], tri[2], p);
  const c2 = qOrient2(tri[2], tri[0], p);
  const s0 = rSign(c0);
  const s1 = rSign(c1);
  const s2 = rSign(c2);
  return {
    inside: (s0 > 0 && s1 > 0 && s2 > 0) || (s0 < 0 && s1 < 0 && s2 < 0),
    onBoundary: s0 === 0 || s1 === 0 || s2 === 0,
  };
}

// ═════════════════════════════════════════════════════════════════════════
// EXACT AREAS AND CONVEX CLIPPING — the exact-area tier, §10.4
// ═════════════════════════════════════════════════════════════════════════

/** Twice the signed area, by the shoelace sum. Exact. */
export function polyArea2(poly: readonly QPt[]): Rat {
  let acc = R0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    acc = rAdd(acc, rSub(rMul(p[0], q[1]), rMul(q[0], p[1])));
  }
  return acc;
}

/** Counter-clockwise, so the clipper's half-plane sign is unambiguous. */
export function ccw(poly: readonly QPt[]): readonly QPt[] {
  return rSign(polyArea2(poly)) < 0 ? [...poly].reverse() : poly;
}

/**
 * Sutherland–Hodgman, over exact rationals. Both operands must be CONVEX; every
 * operand here is a triangle or a clipped triangle, so that holds by construction
 * and the one place it would not — the T-junction repair, whose stitched coarse
 * cell is a quadrilateral that goes reflex for a negative offset — is split into
 * two triangles by its caller rather than handed to this function.
 *
 * No tolerance appears anywhere: an intersection parameter is an exact rational
 * and a vertex either is or is not on a clip line.
 */
export function clipConvex(
  subject: readonly QPt[],
  clip: readonly QPt[]
): readonly QPt[] {
  const C = ccw(clip);
  let out: QPt[] = [...ccw(subject)];
  for (let i = 0; i < C.length && out.length > 0; i++) {
    const A = C[i];
    const B = C[(i + 1) % C.length];
    const side = (p: QPt) => rSign(qOrient2(A, B, p));
    const next: QPt[] = [];
    for (let j = 0; j < out.length; j++) {
      const P = out[j];
      const Q = out[(j + 1) % out.length];
      const sp = side(P);
      const sq = side(Q);
      if (sp >= 0) next.push(P);
      if ((sp > 0 && sq < 0) || (sp < 0 && sq > 0)) {
        // exact intersection: t = orient(A,B,P) / (orient(A,B,P) − orient(A,B,Q))
        const dp = qOrient2(A, B, P);
        const dq = qOrient2(A, B, Q);
        const t = rDiv(dp, rSub(dp, dq));
        next.push([
          rAdd(P[0], rMul(t, rSub(Q[0], P[0]))),
          rAdd(P[1], rMul(t, rSub(Q[1], P[1]))),
        ]);
      }
    }
    out = next;
  }
  return out;
}

/** area(cell ∩ tri) / area(cell), exact. §10.4's α. */
export function alphaExact(cell: readonly QPt[], tri: readonly QPt[]): Rat {
  const whole = rAbs(polyArea2(cell));
  if (rSign(whole) === 0) throw new Error("warp: degenerate raster cell");
  const piece = clipConvex(cell, tri);
  if (piece.length < 3) return R0;
  return rDiv(rAbs(polyArea2(piece)), whole);
}

// ═════════════════════════════════════════════════════════════════════════
// THE LINEAR RESIDUE MODEL — §10.1
// ═════════════════════════════════════════════════════════════════════════
//
// α = clamp(1/2 + E/(2s)), with E the edge function at the cell centre and s the
// per-cell step. §10.1's identity is that on a SHARED edge E_R = −E_L exactly and
// the steps agree, so α_L + α_R = clamp(x) + clamp(1 − x) = 1 in all three
// regimes — including where the raw model would hand out an α outside [0,1].
//
// WHAT THE IDENTITY ACTUALLY DEPENDS ON, and it is worth stating before
// measuring: NOT linearity. It depends on the two sides deriving E from the SAME
// directed segment with opposite orientation, and on a common positive s. That is
// an orientation fact, and orientation facts survive any map that keeps the two
// sides looking at one curve. This is the prediction Q5 is designed to break, and
// the section of the findings that reports the break also reports where it does
// not.

/**
 * The edge function of the directed segment P→Q, evaluated at p: twice the signed
 * area of (P, Q, p). Positive on the left of P→Q.
 */
export const edgeFunction = (P: QPt, Q: QPt, p: QPt): Rat => qOrient2(P, Q, p);

/**
 * The per-cell step for a directed segment against a raster cell: half the total
 * swing of the edge function across the cell. A single positive normaliser, taken
 * from the CELL and the SEGMENT, so that two triangles sharing the segment
 * necessarily agree on it.
 */
export function edgeStep(P: QPt, Q: QPt, cell: readonly QPt[]): Rat {
  let lo: Rat | null = null;
  let hi: Rat | null = null;
  for (const v of cell) {
    const e = edgeFunction(P, Q, v);
    if (lo === null || rCmp(e, lo) < 0) lo = e;
    if (hi === null || rCmp(e, hi) > 0) hi = e;
  }
  const swing = rSub(hi as Rat, lo as Rat);
  if (rSign(swing) === 0) throw new Error("warp: edge is parallel to a degenerate cell");
  return rDiv(swing, rInt(2));
}

/** clamp(1/2 + E(centre)/(2s)) — the residue weight, exact, with the clamp. */
export function alphaLinear(P: QPt, Q: QPt, cell: readonly QPt[]): Rat {
  const c = qCentroid(cell);
  const e = edgeFunction(P, Q, c);
  const s = edgeStep(P, Q, cell);
  return rClamp01(rAdd(rat(1, 2), rDiv(e, rMul(rInt(2), s))));
}

// ═════════════════════════════════════════════════════════════════════════
// A RASTER — the fixed grid the warped geometry is drawn onto
// ═════════════════════════════════════════════════════════════════════════
//
// The raster does NOT move with the warp: the warp maps geometry into display
// space and the display's cells are where they always were. That asymmetry is the
// whole reason a warp can break a coverage identity at all, and it is why the
// raster here is built from plain integer lattice triangles.

export interface RasterCell {
  readonly a: number;
  readonly b: number;
  readonly up: boolean;
  readonly poly: readonly QPt[];
}

/** The unit lattice triangles covering [a0,a1) × [b0,b1) of the rhombic grid. */
export function raster(a0: number, a1: number, b0: number, b1: number): RasterCell[] {
  const out: RasterCell[] = [];
  for (let a = a0; a < a1; a++) {
    for (let b = b0; b < b1; b++) {
      out.push({
        a,
        b,
        up: true,
        poly: [qOf(a, b), qOf(a + 1, b), qOf(a, b + 1)],
      });
      out.push({
        a,
        b,
        up: false,
        poly: [qOf(a + 1, b), qOf(a + 1, b + 1), qOf(a, b + 1)],
      });
    }
  }
  return out;
}

// ═════════════════════════════════════════════════════════════════════════
// THE SEAM — §10.1 and §10.4 under a warp
// ═════════════════════════════════════════════════════════════════════════

/** One rendered triangle plus the directed segment its residue α is read from. */
export interface SeamPiece {
  readonly tri: readonly QPt[];
  readonly edge: readonly [QPt, QPt];
}

/** Does the closed segment P→Q meet the closed convex cell? Exact, no tolerance. */
export function segmentMeetsCell(P: QPt, Q: QPt, cell: readonly QPt[]): boolean {
  const C = ccw(cell);
  let t0 = R0;
  let t1 = R1;
  for (let i = 0; i < C.length; i++) {
    const A = C[i];
    const B = C[(i + 1) % C.length];
    // Keep the half-plane orient(A, B, ·) ≥ 0. Along the segment that value is
    // affine in t, so the admissible interval is solved for exactly.
    const e0 = qOrient2(A, B, P);
    const e1 = qOrient2(A, B, Q);
    const slope = rSub(e1, e0);
    if (rSign(slope) === 0) {
      if (rSign(e0) < 0) return false;
      continue;
    }
    const tc = rDiv(rNeg(e0), slope);
    if (rSign(slope) > 0) {
      if (rCmp(tc, t0) > 0) t0 = tc;
    } else if (rCmp(tc, t1) < 0) {
      t1 = tc;
    }
    if (rCmp(t0, t1) > 0) return false;
  }
  return true;
}

/**
 * THE INTERNAL SEAM CELLS of a drawn segment: the raster cells the segment passes
 * through, minus the cells that also hold one of its ENDPOINTS.
 *
 * The exclusion is §10.5's scope, not a convenience. A cell holding a seam's
 * endpoint is a CORNER cell — more than two triangles meet there — and fold-re
 * records that the linear model is not complementarity-safe at corner cells even
 * on the straight lattice (§10.4's G4d: 6 broken sums for min-over-edges, 5 for
 * exact-corners, 0 only for exact-boundary). Including them would mix a known
 * pre-existing failure into a measurement about warping, and the finding would be
 * worth nothing.
 */
export function seamCells(
  cells: readonly RasterCell[],
  P: QPt,
  Q: QPt
): RasterCell[] {
  return cells.filter(
    (c) =>
      segmentMeetsCell(P, Q, c.poly) &&
      !segmentMeetsCell(P, P, c.poly) &&
      !segmentMeetsCell(Q, Q, c.poly)
  );
}

/**
 * The cells a set of pieces EXACTLY covers — Σ area(cell ∩ piece) = area(cell).
 *
 * Used to define the region a seam measurement runs on, and it must be called
 * with a piece list that PROVABLY partitions: the stitched T-junction, whose
 * pieces share every vertex. Called with the configuration under test it would
 * make the exact tier's answer a tautology, which is why the tests pass the
 * stitched list here and the chord list to `seamReport`.
 */
export function coveredCells(
  cells: readonly RasterCell[],
  pieces: readonly { readonly tri: readonly QPt[] }[]
): RasterCell[] {
  return cells.filter((c) => {
    let acc = R0;
    for (const p of pieces) acc = rAdd(acc, alphaExact(c.poly, p.tri));
    return rEq(acc, R1);
  });
}

export interface SeamRow {
  readonly cell: RasterCell;
  readonly exactSum: Rat;
  readonly linearSum: Rat;
}

export interface SeamReport {
  readonly rows: readonly SeamRow[];
  readonly cells: number;
  /** Cells where the exact-area αs sum to exactly 1. */
  readonly exactOne: number;
  /** Cells where the linear-model αs sum to exactly 1. */
  readonly linearOne: number;
  /** max |Σα − 1|, exact tier. */
  readonly exactWorst: Rat;
  /** max |Σα − 1|, linear tier. */
  readonly linearWorst: Rat;
  /** mean |α_linear − α_exact| over every (cell, piece): §10.2's model error. */
  readonly modelError: Rat;
}

/**
 * §10.1 AND §10.4 ON ONE SEAM, MEASURED SEPARATELY.
 *
 * `seam` is the segment whose cells are measured — the shared edge AS DRAWN BY
 * THE FINER SIDE, because that is the one that actually bounds the finer
 * triangles. `pieces` are the two triangles that are supposed to partition each
 * of those cells, each carrying the directed segment ITS OWN α is read from.
 *
 * When the two pieces' edges are the same segment reversed this is §10.1's
 * configuration exactly, and the linear identity is forced by clamp(x) +
 * clamp(1 − x) = 1. When they are DIFFERENT segments — a coarse cell's chord
 * against a fine cell's sub-edge, i.e. a T-junction — nothing forces it. The gap
 * between those two calls is Q5's whole answer.
 *
 * Neither weight is ever computed as 1 − the other: each α comes from its own
 * piece's own geometry, which is §10.3's admission rule and the only thing that
 * makes a sum of 1 evidence rather than a tautology.
 */
export function seamReport(
  cells: readonly RasterCell[],
  seam: readonly [QPt, QPt],
  pieces: readonly SeamPiece[]
): SeamReport {
  const region = seamCells(cells, seam[0], seam[1]);
  const rows: SeamRow[] = [];
  let exactOne = 0;
  let linearOne = 0;
  let exactWorst = R0;
  let linearWorst = R0;
  let errorSum = R0;
  for (const cell of region) {
    let ex = R0;
    let li = R0;
    for (const p of pieces) {
      const ae = alphaExact(cell.poly, p.tri);
      const al = alphaLinear(p.edge[0], p.edge[1], cell.poly);
      ex = rAdd(ex, ae);
      li = rAdd(li, al);
      errorSum = rAdd(errorSum, rAbs(rSub(al, ae)));
    }
    rows.push({ cell, exactSum: ex, linearSum: li });
    if (rEq(ex, R1)) exactOne++;
    if (rEq(li, R1)) linearOne++;
    exactWorst = rMax(exactWorst, rAbs(rSub(ex, R1)));
    linearWorst = rMax(linearWorst, rAbs(rSub(li, R1)));
  }
  return {
    rows,
    cells: rows.length,
    exactOne,
    linearOne,
    exactWorst,
    linearWorst,
    modelError:
      rows.length === 0 ? R0 : rDiv(errorSum, rInt(rows.length * pieces.length)),
  };
}

/**
 * THE T-JUNCTION, built explicitly, because it is the configuration §9 exists to
 * make safe and the one a warp attacks.
 *
 *   L   the coarse cell: the upright lattice triangle of side 2m at the origin.
 *   R1  the fine neighbour across the first half of L's long edge.
 *   R2  the fine neighbour across the second half.
 *
 * On the straight lattice the shared vertex (m, m) lies ON L's long edge, so the
 * three tile their union exactly — that is §9's "a band boundary IS a quadtree
 * cut". Move (m, m) and L's chord and the fine polyline part company by exactly
 * the lens between them.
 */
export function tJunction(m: number, w: Warp) {
  const P0: Lat = [2 * m, 0];
  const Pm: Lat = [m, m];
  const P1: Lat = [0, 2 * m];
  const L: readonly Lat[] = [[0, 0], P0, P1];
  const R1: readonly Lat[] = [P0, [2 * m, m], Pm];
  const R2: readonly Lat[] = [Pm, [m, 2 * m], P1];
  const wL = warpTriangle(w, L);
  const wR1 = warpTriangle(w, R1);
  const wR2 = warpTriangle(w, R2);
  const wP0 = w.apply(P0);
  const wPm = w.apply(Pm);
  const wP1 = w.apply(P1);
  return {
    L: wL,
    R1: wR1,
    R2: wR2,
    /** The coarse cell's own chord across the seam. */
    chord: [wP0, wP1] as readonly [QPt, QPt],
    /** The fine side's two sub-edges. */
    subEdges: [
      [wP0, wPm] as readonly [QPt, QPt],
      [wPm, wP1] as readonly [QPt, QPt],
    ],
    /** Twice the area of the lens between chord and polyline. Zero iff aligned. */
    lens2: qOrient2(wP0, wPm, wP1),
    /** The repair: L re-tessellated through the moved vertex, as two triangles. */
    stitched: [
      [w.apply([0, 0]), wP0, wPm] as readonly QPt[],
      [w.apply([0, 0]), wPm, wP1] as readonly QPt[],
    ],
  };
}

// ═════════════════════════════════════════════════════════════════════════
// Q4 — DOES THE WARPED FIGURE STILL PARTITION?
// ═════════════════════════════════════════════════════════════════════════
//
// The global gate, and it is a single exact equality rather than a pairwise
// sweep: if the piecewise-affine extension of a vertex warp is a homeomorphism
// of the figure onto its image, then the signed areas of the warped cells sum to
// the signed area of the warped OUTER BOUNDARY POLYGON — no overlap to
// double-count and no gap to miss. Any crack, fold or double claim shows up as a
// difference, and the difference is exact.
//
// This is what makes "shifting a vertex in the warp is free" checkable. It is
// free precisely because every incident cell reads the SAME warped vertex; hand
// each incident cell its own copy and the equality breaks, which is the
// guard-fire.

/** The boundary of the depth-d triangle canvas at scale s, in lattice order. */
export function triangleBoundary(scale: number): Lat[] {
  const out: Lat[] = [];
  for (let i = 0; i < scale; i++) out.push([i, 0]);
  for (let i = 0; i < scale; i++) out.push([scale - i, i]);
  for (let i = 0; i < scale; i++) out.push([0, scale - i]);
  return out;
}

export interface PartitionGate {
  /** Σ |signed area| over the warped cells, doubled (shoelace units). */
  readonly cellSum2: Rat;
  /** |signed area| of the warped boundary polygon, doubled. */
  readonly boundary2: Rat;
  readonly agrees: boolean;
  /** Warped cells whose orientation flipped — a fold, always fatal. */
  readonly flipped: number;
}

export function partitionGate(
  triples: readonly (readonly Lat[])[],
  boundary: readonly Lat[],
  warpFor: (cellIndex: number) => Warp
): PartitionGate {
  let cellSum2 = R0;
  let flipped = 0;
  const ref = rSign(polyArea2(warpTriangle(warpFor(0), triples[0])));
  triples.forEach((tri, i) => {
    const a = polyArea2(warpTriangle(warpFor(i), tri));
    if (rSign(a) !== ref) flipped++;
    cellSum2 = rAdd(cellSum2, rAbs(a));
  });
  // The boundary is drawn with the SHARED warp — cell index −1 is not a cell —
  // because an outline is a property of the figure, not of any one triangle.
  const boundary2 = rAbs(
    polyArea2(boundary.map((v) => warpFor(-1).apply(v)))
  );
  return { cellSum2, boundary2, agrees: rEq(cellSum2, boundary2), flipped };
}

// ═════════════════════════════════════════════════════════════════════════
// SECTION R — THE FLOWANGLE APEX IN ℤ[√3]
// ═════════════════════════════════════════════════════════════════════════
//
// The FlowAngle construction, from the `flowangle-method` skill:
//
//   anchors  anchor[k] = R·(cos 2πk/n, sin 2πk/n)          exact ring elements
//   apex     height    = (base/2) / tan(angle/2)           isosceles construction
//   handles  cp        = anchor + flow·(apex − anchor)     linear interpolation
//   curve    cubic Bézier through anchors with those handles
//
// The apex is the only stage that DIVIDES, so it is the only stage that can leave
// the ring. At angle = 30° the divisor is tan(π/12) = 2 − √3 = ε̄, the conjugate
// fundamental unit of ℤ[√3], whose norm is 1 — so the division is multiplication
// by 2 + √3 and the apex stays INTEGRAL. That is not a coincidence about 30°; it
// is what "unit" means, and the sweep below is what tells the units from the
// merely-rational and both from the escapes.

/** a + b√3, with a and b exact rationals. */
export interface Z3 {
  readonly a: Rat;
  readonly b: Rat;
}

export const z3 = (a: Rat, b: Rat): Z3 => ({ a, b });
export const z3Int = (a: number, b: number): Z3 => ({ a: rInt(a), b: rInt(b) });
export const z3Add = (x: Z3, y: Z3): Z3 => ({ a: rAdd(x.a, y.a), b: rAdd(x.b, y.b) });
export const z3Sub = (x: Z3, y: Z3): Z3 => ({ a: rSub(x.a, y.a), b: rSub(x.b, y.b) });
export const z3Mul = (x: Z3, y: Z3): Z3 => ({
  a: rAdd(rMul(x.a, y.a), rMul(rInt(3), rMul(x.b, y.b))),
  b: rAdd(rMul(x.a, y.b), rMul(x.b, y.a)),
});
export const z3Conj = (x: Z3): Z3 => ({ a: x.a, b: rNeg(x.b) });
/** N(a + b√3) = a² − 3b². Multiplicative; ±1 marks a unit. */
export const z3Norm = (x: Z3): Rat => rSub(rMul(x.a, x.a), rMul(rInt(3), rMul(x.b, x.b)));
export const z3Eq = (x: Z3, y: Z3): boolean => rEq(x.a, y.a) && rEq(x.b, y.b);
export const z3IsZero = (x: Z3): boolean => rSign(x.a) === 0 && rSign(x.b) === 0;

export function z3Div(x: Z3, y: Z3): Z3 {
  const n = z3Norm(y);
  if (rSign(n) === 0) throw new Error("warp: division by a zero-norm ring element");
  const num = z3Mul(x, z3Conj(y));
  return { a: rDiv(num.a, n), b: rDiv(num.b, n) };
}

/** Is this an ALGEBRAIC INTEGER of ℤ[√3] — both components integers? */
export const z3IsIntegral = (x: Z3): boolean => x.a.d === 1 && x.b.d === 1;
/** Is this a UNIT of ℤ[√3] — integral with norm ±1? */
export const z3IsUnit = (x: Z3): boolean => {
  if (!z3IsIntegral(x)) return false;
  const n = z3Norm(x);
  return n.d === 1 && (n.n === 1 || n.n === -1);
};

/** ε = 2 + √3, the fundamental unit of ℤ[√3]. */
export const EPS: Z3 = z3Int(2, 1);
/** ε̄ = 2 − √3 = σ(ε). tan(π/12), and the conjugate fundamental unit. */
export const EPS_BAR: Z3 = z3Int(2, -1);

/** x^k by repeated multiplication. k ≥ 0. */
export function z3Pow(x: Z3, k: number): Z3 {
  let acc = z3Int(1, 0);
  for (let i = 0; i < k; i++) acc = z3Mul(acc, x);
  return acc;
}

export interface WidthRow {
  readonly k: number;
  /** Bits in the rational component's numerator. */
  readonly bitsA: number;
  /** Bits in the √3 component's numerator. */
  readonly bitsB: number;
  /** Bits in the shared denominator. 0 means the power is an ALGEBRAIC INTEGER. */
  readonly bitsDen: number;
  readonly integral: boolean;
  /**
   * N(x^k) = N(x)^k, checked rather than assumed — or `null` once a² − 3b²
   * leaves exact range.
   *
   * NULLABLE ON PURPOSE, and this is a finding rather than an inconvenience: the
   * norm squares the coefficients, so it needs 2·W bits where the product needs
   * W. The Galois error CHECK is wider than the thing it checks, which is exactly
   * why `floang_core::ring_arena::RingPair` exposes `norm_i128` beside an i64
   * product. `unitPowerWidths` therefore reports two depths, not one.
   */
  readonly norm: Rat | null;
}

/**
 * THE WIDTH LAW OF A COMPOSED RING FACTOR — the precision lookahead, measured.
 *
 * ── Why this is here, and what it corrects ──────────────────────────────
 *
 * The brief that commissioned this module asked whether the derive-on-demand
 * path's denominator GROWS, on the model of fold-re §11's `D_k = D0·8^k` — three
 * bits of denominator per subdivision level, "the entire cost of exactness in the
 * curve path". The answer for the rep-tile descent is measured in Q2 and is NO:
 * that path composes integer matrices over a single denominator equal to the
 * scale, so it costs log₂(k) bits per level and never accumulates a denominator
 * at all.
 *
 * The FlowAngle path is a different composition and deserved its own measurement.
 * The owner's correction, which this function tests: park the identity so that a
 * regular hexagon side is the zero of both flow and angle, make curvature a
 * DEVIATION from it, and the deviations compose by MULTIPLICATION — so a descent
 * is a product of ring factors rather than a chain of affine maps with offsets.
 *
 * Then everything turns on ONE property of the per-level factor:
 *
 *   N(x) = ±1 (a UNIT)  →  x^k is an algebraic integer for every k, AND so is
 *                          x^(−k). No denominator ever appears, in either
 *                          direction. The coefficients grow, but only linearly
 *                          in BITS, and the rate is a property of x alone.
 *   N(x) ≠ ±1           →  x^k may stay integral while x^(−k) does not. A
 *                          rep-tile needs both directions — you refine down and
 *                          you resolve prefixes up — so a non-unit is an escape
 *                          even when it looks integral going forward.
 *
 * That is why ε̄ = 2 − √3 = tan(π/12) is the distinguished factor and why the 30°
 * apex angle is not an arbitrary choice: N(ε̄) = 1, ε·ε̄ = 1 exactly, and the Pell
 * invariant a² − 3b² = 1 holds at every power. `test/warp.test.ts` checks the
 * invariant at every k it computes rather than trusting multiplicativity.
 */
export function unitPowerWidths(x: Z3, kmax: number): WidthRow[] {
  const out: WidthRow[] = [];
  for (let k = 0; k <= kmax; k++) {
    let p: Z3;
    try {
      p = z3Pow(x, k);
    } catch {
      // THE RANGE BOUNDARY, reached and reported rather than worked around. The
      // caller reads `out.length` to learn the depth this factor composes to in
      // one machine word, and `rangeReport()` to learn the lane width it would
      // take to go further.
      break;
    }
    const den = p.a.d > p.b.d ? p.a.d : p.b.d;
    let norm: Rat | null;
    try {
      norm = z3Norm(p);
    } catch {
      norm = null; // the norm ran out before the product did — see WidthRow.norm
    }
    out.push({
      k,
      bitsA: bitsOf(p.a.n),
      bitsB: bitsOf(p.b.n),
      bitsDen: den === 1 ? 0 : bitsOf(den),
      integral: z3IsIntegral(p),
      norm,
    });
  }
  return out;
}

/**
 * The smallest k at which a ring factor's widest component leaves the exact
 * range of a JavaScript `number`. THE PRECISION LOOKAHEAD, as a number.
 *
 * `precision-lookahead.py` defines the idea as "an integer-state computation that
 * determines a structural property of its output BEFORE performing the full
 * computation". This is the weaker, honest version: it performs the computation
 * and reports where the boundary is, which is what a caller needs in order to
 * choose an arithmetic type once instead of discovering the answer at depth.
 */
export function safeIntegerDepth(x: Z3, cap = 200): number {
  let a = 1;
  let b = 0;
  if (x.a.d !== 1 || x.b.d !== 1) {
    // A non-integral factor accumulates a DENOMINATOR, so the boundary is a
    // different question and the caller wants `unitPowerWidths`. Refuse rather
    // than return a number that means something else.
    throw new Error("warp: safeIntegerDepth is for integral factors; see unitPowerWidths");
  }
  const A = x.a.n;
  const B = x.b.n;
  for (let k = 0; k <= cap; k++) {
    const na = tryMul(a, A);
    const nb3 = tryMul(3 * b, B);
    const nb1 = tryMul(a, B);
    const nb2 = tryMul(b, A);
    if (na === null || nb3 === null || nb1 === null || nb2 === null) return k;
    const ra = na + nb3;
    const rb = nb1 + nb2;
    if (!Number.isSafeInteger(ra) || !Number.isSafeInteger(rb)) return k;
    a = ra;
    b = rb;
  }
  return cap + 1;
}

/**
 * tan(2θ) = 2t/(1 − t²), in the ring. Returns null at the pole t² = 1, which is
 * θ = 45° — where the doubled angle is 90° and the tangent genuinely does not
 * exist rather than merely leaving the ring.
 */
export function z3TanDouble(t: Z3): Z3 | null {
  const den = z3Sub(z3Int(1, 0), z3Mul(t, t));
  if (z3IsZero(den)) return null;
  return z3Div(z3Mul(z3Int(2, 0), t), den);
}

/**
 * Is x a square in ℚ(√3)? Decidable, and decided — not searched.
 *
 * (p + q√3)² = p² + 3q² + 2pq√3. Matching the √-part forces p = 0 or q = 0, so
 * x = a + b√3 is a square only if b = 0 AND (a is a rational square, giving q = 0,
 * or a/3 is a rational square, giving p = 0). Everything else is not a square in
 * the field, which is how §11's "ℤ[φ] needs √5, which ℤ[√2,√3] does not contain"
 * gets checked here rather than cited.
 */
export function ratIsSquare(x: Rat): boolean {
  if (rSign(x) < 0) return false;
  const isq = (v: number) => {
    if (v < 0) return false;
    if (v < 2) return true;
    let lo = 1;
    let hi = v;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (safe(mid * mid) < v) lo = mid + 1;
      else hi = mid;
    }
    return safe(lo * lo) === v;
  };
  return isq(x.n) && isq(x.d);
}

export function z3HasSquareRoot(x: Z3): boolean {
  if (rSign(x.b) !== 0) return false;
  return ratIsSquare(x.a) || ratIsSquare(rDiv(x.a, rInt(3)));
}

/** A plane point with both coordinates in ℚ(√3). */
export interface Z3Pt {
  readonly x: Z3;
  readonly y: Z3;
}

export const z3PtEq = (p: Z3Pt, q: Z3Pt): boolean => z3Eq(p.x, q.x) && z3Eq(p.y, q.y);

/**
 * The n = 6 anchors: R·(cos 60°k, sin 60°k), exactly, for k = 0..5.
 *
 * cos and sin of multiples of 60° are 0, ±1/2, ±1 and ±√3/2 — every one of them
 * in ℚ(√3), which is §11's exact-angle family restricted to n = 6. n = 3, 4 and
 * 12 land in the same carrier; n = 5 needs √5 and n = 8 needs √2, and
 * `z3HasSquareRoot` decides both without a search.
 */
export function hexAnchor(k: number, R: Rat): Z3Pt {
  const half = rat(1, 2);
  const cos: Rat[] = [R, rMul(R, half), rMul(R, rNeg(half)), rNeg(R), rMul(R, rNeg(half)), rMul(R, half)];
  // sin 60°k = 0, √3/2, √3/2, 0, −√3/2, −√3/2 — carried in the √-component.
  const sinRoot: Rat[] = [R0, half, half, R0, rNeg(half), rNeg(half)];
  const i = ((k % 6) + 6) % 6;
  return { x: z3(cos[i], R0), y: z3(R0, rMul(R, sinRoot[i])) };
}

/**
 * THE FLOWANGLE APEX, exactly, with NO square root anywhere.
 *
 * The skill's construction is `height = (base/2)/tan(angle/2)` then step off the
 * midpoint along the unit perpendicular. Written that way it looks as if it needs
 * |PQ|, hence a square root, hence an escape from any quadratic ring. It does
 * not, and this is the point worth being loud about:
 *
 *     height · unitPerp = ((|PQ|/2)·cot(angle/2)) · perp/|PQ|
 *                       = (cot(angle/2)/2) · perp
 *
 * — the length cancels. So
 *
 *     apex = midpoint(P, Q) ± (cot(angle/2)/2) · rot90(Q − P)
 *
 * and the apex is an exact element of whatever ring holds the anchors AND
 * cot(angle/2). No norm, no √ of a norm, no normalisation. The whole exactness
 * question for the apex therefore collapses to one membership test on a single
 * ring element, which is what `apexRing` reports.
 */
export function flowAngleApex(
  P: Z3Pt,
  Q: Z3Pt,
  cotHalf: Z3,
  inward: boolean
): Z3Pt {
  const half = z3(rat(1, 2), R0);
  const mid: Z3Pt = {
    x: z3Mul(z3Add(P.x, Q.x), half),
    y: z3Mul(z3Add(P.y, Q.y), half),
  };
  // rot90(Q − P) = (−(Qy − Py), Qx − Px). `inward` flips the cap.
  const dx = z3Sub(Q.x, P.x);
  const dy = z3Sub(Q.y, P.y);
  // For anchors in COUNTER-CLOCKWISE order the left normal (−dy, dx) points into
  // the polygon, so `inward` is the POSITIVE sign here. Measured, not assumed:
  // the first spelling of this had the sign the other way and put the hexagon's
  // 60° caps at (6, 2√3) instead of the origin, which is what the centre gate in
  // `test/warp.test.ts` exists to catch.
  const s = z3Mul(cotHalf, half);
  const sign = inward ? z3Int(1, 0) : z3Int(-1, 0);
  const k = z3Mul(s, sign);
  return {
    x: z3Add(mid.x, z3Mul(k, z3Sub(z3Int(0, 0), dy))),
    y: z3Add(mid.y, z3Mul(k, dx)),
  };
}

export interface ApexRow {
  /** The FlowAngle apex angle, in degrees. */
  readonly deg: number;
  /** tan(deg/2) as a ring element. */
  readonly tanHalf: Z3;
  /** cot(deg/2): the apex height per unit half-base. */
  readonly cotHalf: Z3;
  /** cot lies in ℤ[√3] — the apex needs no denominator. */
  readonly integral: boolean;
  /** tan is a UNIT of ℤ[√3] — the division that makes cot is exact in the ring. */
  readonly unit: boolean;
  /** |N(tan)| — the denominator the division actually introduces. */
  readonly norm: Rat;
}

export function apexRing(deg: number, tanHalf: Z3): ApexRow {
  const cot = z3Div(z3Int(1, 0), tanHalf);
  return {
    deg,
    tanHalf,
    cotHalf: cot,
    integral: z3IsIntegral(cot),
    unit: z3IsUnit(tanHalf),
    norm: rAbs(z3Norm(tanHalf)),
  };
}

/**
 * The apex height for an isosceles cap of half-base h: h · cot(angle/2). Kept
 * because it is the skill's own spelling, and because the ring membership of the
 * height and of `cotHalf` are the same question.
 */
export function apexHeight(cot: Z3, halfBase: Rat): Z3 {
  return { a: rMul(cot.a, halfBase), b: rMul(cot.b, halfBase) };
}

// ═════════════════════════════════════════════════════════════════════════
// SMALL HELPERS THE TESTS SHARE
// ═════════════════════════════════════════════════════════════════════════

/** The exact rational centroid of a lattice triangle, in lattice coordinates. */
export function latCentroid(tri: readonly Lat[]): QPt {
  let a = 0;
  let b = 0;
  for (const v of tri) {
    a += v[0];
    b += v[1];
  }
  return [rat(a, 3), rat(b, 3)];
}
