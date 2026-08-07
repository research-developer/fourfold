/**
 * VERTICES — the figure's shared vertex table, DERIVED, with the derivation as
 * the authority and the table as a memo.
 *
 * This is increment 1 of `docs/spec-curvature.md`, and it is the increment the
 * scoping verdict asked for in its own words (`docs/warp-findings.md`, "the first
 * honest increment"):
 *
 *   > Give the figure a shared vertex table, derived, with the derivation as the
 *   > authority — and change nothing about how anything is drawn.
 *
 * ── WHAT IS PROMOTED, AND FROM WHERE ─────────────────────────────────────
 *
 * `src/lib/warp.ts` is a MEASUREMENT INSTRUMENT — nothing in `src/app` imports
 * it, it draws nothing, and it exists so `test/warp.test.ts` can decide five
 * questions by computation. Two of its parts turned out not to be measurements at
 * all but the beginnings of a feature: the descent-as-matrix-product (`deriveCell`)
 * and the vertex table (`buildVertexTable`/`vertexCensus`). Those bodies now live
 * HERE and `warp.ts` re-exports them, so there is exactly ONE derivation in `src/`
 * and `test/warp.test.ts` — every assertion of which is the record of a published
 * measurement — keeps deciding the same questions against the same code, unmodified.
 *
 * What stayed in `warp.ts`: exact rationals, the warp families, the clipper, both
 * α tiers, the T-junction, the ℤ[√3] apex machinery, the range meter. Those are
 * instrument, and increments 2–4 will consume them at the display boundary rather
 * than promote them.
 *
 * ── THE DERIVATION IS THE AUTHORITY. THE TABLE IS A CACHE. ───────────────
 *
 * An address is a descent path and each digit is an affine map, so a cell is a
 * PRODUCT of per-digit integer weight matrices applied to the root — O(d) time,
 * O(1) space, one 3×3 integer accumulator, no figure and no tree in hand
 * [PROVEN, `docs/warp-findings.md` Q2: derived == `buildFigure` cell for cell,
 * 4,096 + 4,096 + 6,561 cells, zero mismatches].
 *
 * The table is built FROM that derivation and never from stored geometry, so it
 * is reconstructible rather than authoritative: lose it and it regenerates from
 * the addresses alone. That is the property the findings insisted on —
 *
 *   > the table is a CACHE of the derivation, and the derivation is what makes
 *   > the cache reconstructible rather than authoritative.
 *
 * — and it is why `test/vertices.test.ts` checks the table by DEREFERENCING it
 * back to triangles and comparing against a fresh derivation, and separately
 * checks the derivation against `buildFigure`/`buildRep9Figure`, which know
 * nothing about matrices.
 *
 * ── WHY THE TABLE IS NOT A FIELD ON `Figure`/`Hexagon` (yet) ─────────────
 *
 * MEASUREMENT OVER PREFERENCE: `docs/warp-findings.md` names `figure.ts` in its
 * "existing modules that would have to change" list and then says of it —
 *
 *   > a shared table is an ADDITION alongside them, not a replacement, UNTIL
 *   > SOMETHING READS IT. No change is required for the increment above.
 *
 * Nothing reads it yet; increment 2 (static per-charge flow) is the first thing
 * that will. Three concrete reasons to keep it standalone until then, in order of
 * weight:
 *
 *   1. A field on `Figure` is built EAGERLY on every `buildFigure` call — and
 *      `buildFigure` is called by `buildHexagon`, by the editor, and by hundreds
 *      of tests. That is O(cells) string-keyed interning charged to every caller
 *      for a memo with no reader. The findings measured the build at ~1.5 ms per
 *      4,096 cells; multiplied across the suite that is real, and it buys nothing.
 *   2. Byte identity is the acceptance criterion, and the surest way not to move
 *      an exported byte is not to touch the value objects the export path walks.
 *      `figure.ts` and `hexagon.ts` are UNMODIFIED by this increment.
 *   3. The table is a cache, and a cache belongs to the consumer that can say how
 *      long it is valid for. `Figure` cannot: a warped or refined table is still a
 *      table, and it is not the figure's.
 *
 * When increment 2 lands, `buildVertexTable(specOf(figure))` is one call, and the
 * decision to memoise it on the figure can be taken then with a reader in hand.
 *
 * ── NO FLOAT, AND NO RATIONAL EITHER ─────────────────────────────────────
 *
 * Every coordinate in this module is an exact INTEGER lattice coordinate. There
 * is no `Math.` call, no `/` outside `composeWeights`' documented exact division,
 * and nothing here reaches `figure.toXY` or `hexagon.latticeToPixel` — the two
 * display boundaries, both untouched.
 *
 * Sub-cell vertex displacement therefore does NOT introduce a rational: it is
 * expressed by REFINING the lattice (`refineTable`) and moving by an integer.
 * That is `scale.ts`'s own move — resolution lives in the scale, not in the number
 * type — and it is what lets `moveVertex` reproduce `warp.ts` §Q4's measurement,
 * which used offsets of 1/2 and −1/3, with integer arithmetic throughout.
 */

import {
  REP9_ALPHABET,
  type Convention,
  type Digit,
  type IVec,
} from "./figure";
import { baryToLat, latKey, rotK, type Lat } from "./hexagon";
import { REP9_LETTERS, scaleOfWord } from "./scale";

// ═════════════════════════════════════════════════════════════════════════
// THE GUARD
// ═════════════════════════════════════════════════════════════════════════
//
// `reptile.ts`'s discipline, restated: "a measurement instrument that can lie is
// worthless". Every product formed here is a lattice coordinate or a twice-area,
// both of which are small at every reachable depth — `MAX_DEPTH` puts the scale
// at 32 and the widest descent accumulator entry is exactly the scale
// [PROVEN, warp-findings Q2's dynamic-range table: 3 lanes × 3 bits] — so this
// guard is expected never to fire. It is here because a silent wrap past 2^53
// would report a fold as an exact partition, which is the one failure this
// module's whole claim rests on not having.

function exact(x: number): number {
  if (!Number.isSafeInteger(x)) {
    throw new Error(`vertices: exact integer range exceeded (${x})`);
  }
  return x;
}

// ═════════════════════════════════════════════════════════════════════════
// THE ADDRESS ALGEBRA — a descent is a product of integer weight matrices
// ═════════════════════════════════════════════════════════════════════════
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
// and the denominators multiply. `figure.ts` starts its walk at
// ([scale,0,0], [0,scale,0], [0,0,scale]), so V_j = scale·e_j, the scale cancels,
// and a cell's stored barycentrics are LITERALLY THE ROWS of the accumulator.
//
// EXACTNESS IS STRUCTURAL, not incidental: the product of integer matrices is an
// integer matrix, and after d levels there is exactly ONE denominator — the
// scale, the product of the edge divisions — with every row summing to it.
// Verified on rep-4 words, rep-9 words and MIXED words, which is where a
// per-node denominator would have to appear [PROVEN, warp-findings Q2].

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
 * with M_PQ = (P + Q)/2. That transcription is the load-bearing claim of the
 * whole derivation — if it is wrong the derived cells will not match
 * `buildFigure`'s, cell for cell, and `test/vertices.test.ts` says so at 4^6
 * cells. A hand transcription is DELIBERATE: extracting the maps from
 * `figure.ts`'s own recursion would make the agreement test a restatement rather
 * than a second opinion.
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
 * the check the test runs on the result: the composed cells are compared against
 * `buildRep9Figure`'s own stored barycentrics, which are produced one level at a
 * time by `rep9Blend` rather than by any matrix product.
 */
export const REP9_MAPS: ReadonlyMap<string, DigitMap> = new Map(
  REP9_ALPHABET.map((l) => [l.name, { k: 3, w: l.weights } as DigitMap])
);

export function digitMap(ch: string, convention: Convention): DigitMap {
  const nine = REP9_MAPS.get(ch);
  if (nine) return nine;
  const four = (convention === "ifs" ? REP4_IFS : REP4_APEX)[ch as Digit];
  if (!four) throw new Error(`vertices: ${ch} is not an address letter`);
  return four;
}

/** inner ∘ outer, as integer matrices. See the section header for the order. */
export function composeWeights(inner: Weights, outer: Weights): Weights {
  const row = (i: number): IVec => {
    const out: [number, number, number] = [0, 0, 0];
    for (let m = 0; m < 3; m++) {
      let acc = 0;
      for (let j = 0; j < 3; j++) acc += inner[i][j] * outer[j][m];
      out[m] = exact(acc);
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
 * is, because `digitMap` reads one character. `deriveCell(addr).scale` therefore
 * agrees with `scale.scaleOfWord(addr)` on every address, mixed radix included —
 * asserted rather than assumed, both here (`buildVertexTable`) and in the test.
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
 * The same cell as three LATTICE points, in the sector the hexagon puts it in.
 *
 * `hexagon.ts`'s basis makes this trivial and exact: a vertex with integer
 * barycentrics (x, y, z) summing to the scale sits at (y, z), and sector s is
 * R^s of the base wedge, R being an integer matrix of order 6. `rotK` is used
 * rather than a second copy of the rotation for the same reason `warp.ts` used
 * it: the sector identifications are the thing being counted, so they must come
 * from the module that ships them.
 */
export function deriveTriangle(
  addr: string,
  convention: Convention = "apex",
  sector = 0
): readonly [Lat, Lat, Lat] {
  const d = deriveCell(addr, convention);
  return [
    rotK(baryToLat(d.verts[0]), sector),
    rotK(baryToLat(d.verts[1]), sector),
    rotK(baryToLat(d.verts[2]), sector),
  ];
}

// ═════════════════════════════════════════════════════════════════════════
// THE ADDRESS SWEEP — a canvas, enumerated with no figure in hand
// ═════════════════════════════════════════════════════════════════════════
//
// The order matters and it is not arbitrary: `buildFigure` recurses A, B, C, X
// and `buildRep9Figure` recurses `REP9_ALPHABET` in index order, so in both cases
// the leaves come out in DFS pre-order, which on a complete tree is LEXICOGRAPHIC
// over the ordered alphabet. Reproducing that order here is what makes a
// cell-for-cell comparison against the shipped figures possible at all — and it
// is checked (`test/vertices.test.ts` compares the address lists themselves,
// not merely the geometry).
//
// The hexagon's order is `for s in 0..5 { for c of base.cells }`, i.e. cell index
// = 6·sector + base, exactly as `buildHexagon`/`buildRep9Hexagon` build it.

/** The four rep-4 letters, in `buildFigure`'s own recursion order. */
export const REP4_LETTERS = "ABCX";

/** Radix as the CHILD COUNT, matching `buildFigure` (4) and `buildRep9Figure` (9). */
export type Radix = 4 | 9;

export interface CanvasSpec {
  readonly radix: Radix;
  readonly depth: number;
  /** 1 = the triangle canvas; 6 = the hexagon. Nothing else tiles. */
  readonly sectors: 1 | 6;
  /**
   * rep-4 only. Rep-9's frame is forced by the mirror rule stated on
   * `figure.buildRep9Alphabet` and there is no second reading to name, which is
   * why `buildRep9Figure` takes no convention either.
   */
  readonly convention?: Convention;
}

export const alphabetOf = (radix: Radix): string =>
  radix === 9 ? REP9_LETTERS : REP4_LETTERS;

/** Every address of the given depth, in the figure's own DFS order. */
export function addressSweep(depth: number, alphabet: string): string[] {
  let out: string[] = [""];
  for (let d = 0; d < depth; d++) {
    const next: string[] = [];
    for (const w of out) for (const ch of alphabet) next.push(w + ch);
    out = next;
  }
  return out;
}

/** The canvas's cells as (address, sector) pairs, in the canvas's own order. */
export function canvasCells(
  spec: CanvasSpec
): readonly { readonly addr: string; readonly sector: number }[] {
  const addrs = addressSweep(spec.depth, alphabetOf(spec.radix));
  const out: { addr: string; sector: number }[] = [];
  for (let s = 0; s < spec.sectors; s++) {
    for (const addr of addrs) out.push({ addr, sector: s });
  }
  return out;
}

// ═════════════════════════════════════════════════════════════════════════
// THE SHARED VERTEX TABLE
// ═════════════════════════════════════════════════════════════════════════
//
// Distinct lattice vertices stored ONCE; cells referencing them by index. The
// saving measured on the shipped figure [PROVEN, warp-findings Q1]: ~6× on slots
// (the limit is exactly 6, approached strictly from below, the shortfall being
// the boundary's degree deficit and nothing else) and ~2× on distinct objects
// against cells — 2,145 vertices for 4,096 cells at depth 6.
//
// But the saving is NOT why this exists. Q4's guard-fire is: hand each incident
// cell its own copy of a moved vertex — exactly what per-triangle storage permits
// and sharing forbids — and the partition gate reads 260 against 256 with one
// cell FOLDED. Sharing is the precondition for any vertex-motion feature, which
// is every curvature increment after this one.

/** A cell as three indices into `VertexTable.vertices`, in role order. */
export type Tri = readonly [number, number, number];

export interface VertexTable {
  /** The distinct lattice vertices, in first-reference order. */
  readonly vertices: readonly Lat[];
  /** One index triple per cell, in the canvas's own cell order. */
  readonly cells: readonly Tri[];
  /**
   * Coordinate key → index, FIRST OCCURRENCE WINS.
   *
   * On a shared table `index.size === vertices.length`; that equality IS the
   * sharing property and `isShared` reads it. `explode` breaks it deliberately
   * and `moveVertex` would break it if a displacement landed one vertex on
   * another — which is a degeneracy, so it is worth being visible rather than
   * silently merged.
   */
  readonly index: ReadonlyMap<string, number>;
}

/** The table plus what the DERIVATION knows and raw triples cannot. */
export interface DerivedVertexTable extends VertexTable {
  readonly spec: CanvasSpec;
  /** The edge-division product every vertex coordinate is an integer over. */
  readonly scale: number;
  /** Parallel to `cells`: the address each one was derived from. */
  readonly addrs: readonly string[];
  /** Parallel to `cells`: which of the six sectors it sits in. */
  readonly sectorOf: readonly number[];
}

const reindex = (vertices: readonly Lat[]): ReadonlyMap<string, number> => {
  const index = new Map<string, number>();
  vertices.forEach((v, i) => {
    const k = latKey(v);
    if (!index.has(k)) index.set(k, i);
  });
  return index;
};

/**
 * INTERN a stream of lattice triangles into a shared table.
 *
 * The primitive both constructors share, and deliberately the SIMPLEST thing
 * that works — a string key per vertex. The findings measured this at ~1.5 ms
 * per 4,096 cells against a full derivation pass at ~2.4 ms, so the memo costs
 * about one derivation and buys a lookup ~130× faster [MEASURED]. Nothing here
 * is worth making cleverer before something reads it.
 */
function intern(triples: Iterable<readonly Lat[]>): VertexTable {
  const index = new Map<string, number>();
  const vertices: Lat[] = [];
  const cells: Tri[] = [];
  for (const tri of triples) {
    if (tri.length !== 3) {
      throw new Error(`vertices: a cell has ${tri.length} vertices, not 3`);
    }
    const ids = tri.map((v) => {
      const k = latKey(v);
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

/**
 * A table over ALREADY-KNOWN triangles — the oracle adapter.
 *
 * Used to intern the shipped figures' own `bary` triples so the census can be
 * taken against them, and to intern a deliberately mutated triple list for a
 * guard-fire. NOT the constructor the feature uses: `buildVertexTable` is, and it
 * reads no geometry at all.
 */
export function tableFromTriples(
  triples: readonly (readonly Lat[])[]
): VertexTable {
  return intern(triples);
}

/**
 * THE CONSTRUCTOR. A canvas's shared vertex table, built from the ADDRESS
 * ALGEBRA — no figure, no tree, no stored geometry.
 *
 * The scale is cross-checked two ways on every cell: against the accumulated
 * edge-division product, and against `scale.scaleOfWord`, which reads the address
 * and nothing else. A disagreement would mean the radix had stopped being a pure
 * function of the address — `scale.ts`'s one constraint, and the thing `plate.ts`'s
 * "prefix = ancestry" rests on — so it throws rather than returning a table whose
 * denominator is a guess.
 */
export function buildVertexTable(spec: CanvasSpec): DerivedVertexTable {
  const convention = spec.convention ?? "apex";
  const cellSpecs = canvasCells(spec);
  const addrs: string[] = [];
  const sectorOf: number[] = [];
  let scale = -1;

  const triples: Lat[][] = cellSpecs.map(({ addr, sector }) => {
    const d = deriveCell(addr, convention);
    if (scale < 0) scale = d.scale;
    if (d.scale !== scale || d.scale !== scaleOfWord(addr)) {
      throw new Error(
        `vertices: ${addr} resolves to scale ${d.scale}/${scaleOfWord(addr)}, not ${scale}`
      );
    }
    addrs.push(addr);
    sectorOf.push(sector);
    return [
      rotK(baryToLat(d.verts[0]), sector),
      rotK(baryToLat(d.verts[1]), sector),
      rotK(baryToLat(d.verts[2]), sector),
    ];
  });

  return {
    ...intern(triples),
    spec,
    scale: scale < 0 ? 1 : scale,
    addrs,
    sectorOf,
  };
}

/** Dereference a cell back to its three lattice points. The memo, read. */
export function tableTriangle(t: VertexTable, i: number): readonly [Lat, Lat, Lat] {
  const c = t.cells[i];
  if (c === undefined) throw new Error(`vertices: no cell ${i}`);
  return [t.vertices[c[0]], t.vertices[c[1]], t.vertices[c[2]]];
}

/**
 * Does every vertex sit at a distinct point? True exactly when the table SHARES.
 *
 * `explode` makes this false by construction; that is the counterexample Q4's
 * guard-fire needs, and this predicate is how the tests tell the two apart
 * without inspecting lengths by hand.
 */
export const isShared = (t: VertexTable): boolean =>
  t.index.size === t.vertices.length;

/** Which cells touch a vertex. Its degree is the length of this list. */
export function incidentCells(t: VertexTable, v: number): number[] {
  const out: number[] = [];
  t.cells.forEach((c, i) => {
    if (c[0] === v || c[1] === v || c[2] === v) out.push(i);
  });
  return out;
}

// ═════════════════════════════════════════════════════════════════════════
// THE CENSUS — the closed forms, checkable against an observed sweep
// ═════════════════════════════════════════════════════════════════════════
//
// Σ_v deg(v) = slots identically, so
//
//     slots = 6·V − Σ_v (6 − deg v)
//
// and every term of that sum sits on the BOUNDARY: interior vertices have degree
// 6 and contribute zero. The degree histogram is the whole explanation —
//
//   triangle: 3 corners of degree 1, 3(s−1) edge vertices of degree 3,
//             (s−1)(s−2)/2 interior of degree 6;   deficit = 9s + 6
//   hexagon:  6 corners of degree 2, 6(s−1) edge vertices of degree 3;
//             deficit = 18s + 6
//
// THE RADIX DOES NOT ENTER [PROVEN, warp-findings Q1]. Both radices obey the same
// closed forms IN THE SCALE, which is forced once `rep-tile-findings.md` Q2's
// "rep-4 ∘ rep-9 = rep-36, the same 36 triangles" is taken seriously: at equal
// scale the two radices produce the same point set, so they cannot disagree about
// a count of points. Redundancy is a property of the CANVAS and the SCALE.

export interface VertexCensus {
  /** Cells in the canvas. */
  readonly cells: number;
  /** Vertex slots under per-triangle storage: 3 per cell. */
  readonly slots: number;
  /** Distinct lattice vertices actually referenced by a cell. */
  readonly distinct: number;
  /** 6·distinct − slots: the total degree deficit, all of it on the boundary. */
  readonly deficit: number;
  /** How many referenced vertices have each incidence degree. */
  readonly degrees: ReadonlyMap<number, number>;
  /**
   * Vertices in the table that NO cell references.
   *
   * Zero on any table this module builds. Non-zero is how a corrupted index
   * triple shows up in the headline count — which is exactly the guard-fire, and
   * the reason the census is computed from `cells` and not from `vertices.length`.
   */
  readonly unreferenced: number;
}

export function vertexCensus(t: VertexTable): VertexCensus {
  const deg = new Array<number>(t.vertices.length).fill(0);
  let slots = 0;
  for (const c of t.cells) {
    for (const idx of c) {
      if (deg[idx] === undefined) {
        throw new Error(`vertices: cell references vertex ${idx}, which is not in the table`);
      }
      deg[idx]++;
      slots++;
    }
  }
  const degrees = new Map<number, number>();
  let distinct = 0;
  for (const d of deg) {
    if (d === 0) continue;
    distinct++;
    degrees.set(d, (degrees.get(d) ?? 0) + 1);
  }
  return {
    cells: t.cells.length,
    slots,
    distinct,
    deficit: 6 * distinct - slots,
    degrees,
    unreferenced: t.vertices.length - distinct,
  };
}

/** Distinct vertices of the triangle canvas at scale s: the triangular number. */
export const triangleDistinct = (s: number): number => ((s + 1) * (s + 2)) / 2;
/** Its boundary degree deficit. Independent of the radix. */
export const triangleDeficit = (s: number): number => 9 * s + 6;
/** Distinct vertices of the hexagon canvas: the centred hexagonal number. */
export const hexagonDistinct = (s: number): number => 3 * s * s + 3 * s + 1;
/** Its deficit — the triangle's doubled, six sectors having twice the boundary. */
export const hexagonDeficit = (s: number): number => 18 * s + 6;

/** The closed forms, dispatched on the canvas. Nothing here reads the radix. */
export const expectedDistinct = (spec: CanvasSpec, scale: number): number =>
  spec.sectors === 6 ? hexagonDistinct(scale) : triangleDistinct(scale);
export const expectedDeficit = (spec: CanvasSpec, scale: number): number =>
  spec.sectors === 6 ? hexagonDeficit(scale) : triangleDeficit(scale);

// ═════════════════════════════════════════════════════════════════════════
// THE ORACLE ADAPTER — the shipped figures' own `bary`, as lattice triples
// ═════════════════════════════════════════════════════════════════════════

/** Anything with three exact barycentric vertices. `Cell` and `Rep9Cell` both do. */
export interface BaryCell {
  readonly bary: readonly [IVec, IVec, IVec];
}

/**
 * The lattice-vertex triples of a canvas, read from STORED geometry.
 *
 * `sectors = 1` is the triangle canvas; `sectors = 6` is the hexagon, built the
 * way `hexagon.buildHexagon` builds it. This is the oracle side of every
 * agreement test in `test/vertices.test.ts` — the derivation is compared against
 * it and never built from it.
 */
export function latTriples(cells: readonly BaryCell[], sectors = 1): Lat[][] {
  const out: Lat[][] = [];
  for (let s = 0; s < sectors; s++) {
    for (const c of cells) {
      out.push(c.bary.map((b) => rotK(baryToLat(b), s)));
    }
  }
  return out;
}

// ═════════════════════════════════════════════════════════════════════════
// VERTEX MOTION — why sharing is the point, and not merely the saving
// ═════════════════════════════════════════════════════════════════════════
//
// `docs/spec-curvature.md` L4: *a moved vertex with per-cell copies FOLDS the
// mesh; with single ownership every incident cell moves together and no cell
// changes owner.* That is a claim about a data structure and it is decidable, so
// these three functions exist to decide it:
//
//   refineTable   express a sub-cell displacement as an integer one
//   moveVertex    the shared move — ONE write, the cell array untouched
//   explode       the counterexample — per-cell copies, which is what
//                 per-triangle vertex storage IS
//
// The gate is `areaGate`, and it is `warp.ts`'s exact partition gate restated on
// integers: for an INTERIOR vertex the outline does not move, so the signed areas
// must sum to the same total before and after, and Σ|area| must equal it too —
// the second equality failing exactly when a cell has folded.

/** v scaled by an integer factor. */
const latMul = (v: Lat, f: number): Lat => [exact(v[0] * f), exact(v[1] * f)];
const latAdd = (v: Lat, w: Lat): Lat => [exact(v[0] + w[0]), exact(v[1] + w[1])];
export const latEq = (v: Lat, w: Lat): boolean => v[0] === w[0] && v[1] === w[1];

/**
 * REFINE the lattice by an integer factor: every coordinate multiplied, the
 * combinatorics untouched.
 *
 * This is how a fractional displacement is expressed without a fractional
 * coordinate. A move of (1/2, −1/3) of a cell is the integer move (3, −2) on the
 * ×6 refinement, and the answer is the same geometry read at a finer resolution —
 * which is `scale.ts`'s whole thesis (resolution is the scale, not the type)
 * applied to vertex motion.
 */
export function refineTable(t: VertexTable, f: number): VertexTable {
  if (!Number.isSafeInteger(f) || f < 1) {
    throw new Error(`vertices: refinement factor ${f} is not a positive integer`);
  }
  const vertices = t.vertices.map((v) => latMul(v, f));
  return { vertices, cells: t.cells, index: reindex(vertices) };
}

/**
 * MOVE ONE SHARED VERTEX. One write to one array; `cells` is passed through
 * BY REFERENCE and is not rewritten.
 *
 * That reference identity is not an optimisation, it is the assertion: with a
 * shared table there is no ownership to change, because ownership is expressed by
 * an index and no index moved. `test/vertices.test.ts` asserts
 * `moved.cells === before.cells` for exactly that reason.
 *
 * The rebuilt `index` may shrink if the displacement lands this vertex on
 * another one. That is a degeneracy rather than a sharing failure, and `isShared`
 * reports it rather than the move throwing — a table that has folded is a thing
 * the gate should measure, not a thing a constructor should hide.
 */
export function moveVertex(t: VertexTable, v: number, delta: Lat): VertexTable {
  if (t.vertices[v] === undefined) throw new Error(`vertices: no vertex ${v}`);
  const vertices = t.vertices.map((p, i) => (i === v ? latAdd(p, delta) : p));
  return { vertices, cells: t.cells, index: reindex(vertices) };
}

/**
 * THE COUNTEREXAMPLE: give every cell its own copy of every vertex.
 *
 * This is not a straw man — it is precisely what `figure.ts` stores today
 * (`Cell.verts`/`Cell.bary` are per-triangle by construction) and what a naive
 * "just move the vertex" would then have to mean. Vertex 3i+j is cell i's copy of
 * role j, so the correspondence back to the shared table is arithmetic and needs
 * no lookup.
 *
 * The exploded table is geometrically IDENTICAL to the one it came from — same
 * triangles, same areas, same drawing. It differs only in what a move means, and
 * that is the entire finding.
 */
export function explode(t: VertexTable): VertexTable {
  const vertices: Lat[] = [];
  const cells: Tri[] = [];
  for (const c of t.cells) {
    const base = vertices.length;
    vertices.push(t.vertices[c[0]], t.vertices[c[1]], t.vertices[c[2]]);
    cells.push([base, base + 1, base + 2]);
  }
  return { vertices, cells, index: reindex(vertices) };
}

/** Twice the signed area of cell i. Exact, integer; the sign is the orientation. */
export function cellArea2(t: VertexTable, i: number): number {
  const [p, q, r] = tableTriangle(t, i);
  return exact(
    exact((q[0] - p[0]) * (r[1] - p[1])) - exact((q[1] - p[1]) * (r[0] - p[0]))
  );
}

export interface AreaGate {
  /** Σ |twice signed area| over the cells. */
  readonly abs2: number;
  /** Σ twice signed area — invariant under any INTERIOR vertex move. */
  readonly signed2: number;
  /** Cells of each orientation, and the degenerate ones. */
  readonly positive: number;
  readonly negative: number;
  readonly degenerate: number;
}

/**
 * THE PARTITION GATE, on integers.
 *
 * `warp.ts`'s version compares Σ|area| against the warped OUTLINE's area. Moving
 * an interior vertex cannot move the outline, so the same gate is available
 * without constructing one: `signed2` must not change (it telescopes to the
 * boundary), and `abs2` must equal `signed2` in magnitude — which fails exactly
 * when some cell has flipped, i.e. when the mesh has folded.
 */
export function areaGate(t: VertexTable): AreaGate {
  let abs2 = 0;
  let signed2 = 0;
  let positive = 0;
  let negative = 0;
  let degenerate = 0;
  for (let i = 0; i < t.cells.length; i++) {
    const a = cellArea2(t, i);
    abs2 = exact(abs2 + Math.abs(a));
    signed2 = exact(signed2 + a);
    if (a > 0) positive++;
    else if (a < 0) negative++;
    else degenerate++;
  }
  return { abs2, signed2, positive, negative, degenerate };
}
