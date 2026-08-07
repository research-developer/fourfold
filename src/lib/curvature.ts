/**
 * CURVATURE — the charge, drawn.
 *
 * Increment 2 of `docs/spec-curvature.md`: *static per-charge flow*. One dial;
 * the charge decides everything else. A cell's edge bends when the two cells it
 * separates are on opposite sides of a canonical charge partition, and it stays
 * straight when they are not — so what the eye reads is the GRADIENT of the
 * charge field, the domain walls, rather than a per-cell decoration.
 *
 * Nothing here is drawn per cell. An edge is owned once, its curve is computed
 * once, and both cells reference THE SAME OBJECT (L1). That is the whole reason
 * increment 1 had to land first: `vertices.ts` gives edges an identity — a pair
 * of shared vertex INDICES — and identity is what makes "one curve" a structural
 * fact rather than an agreement between two computations.
 *
 * ── THE EDGE LAW, AND WHAT MEASUREMENT DID TO THE CANDIDATE ──────────────
 *
 * The candidate handed to this increment was *curvature as the coboundary of
 * the charge*: straight inside a domain, curved on a wall, the difference being
 * the V₄ product c_L·c_R (every element self-inverse, so the product is
 * symmetric in the pair, which an edge law must be).
 *
 * **It does not survive D₆-equivariance in that form, and the obstruction is
 * exhibited rather than argued** — see `test/curvature.test.ts`, which measures
 * it on the shipped figure at several depths.
 *
 * The reason, stated once because everything else here follows from it:
 *
 *   `docs/symmetry-findings.md` — the six rotations carry each cell's charge
 *   UNCHANGED; the six reflections carry it by φ = (σ₂ σ₃), the relabelling
 *   μ = m_A induces. So the drawing is equivariant iff the law commutes with φ.
 *
 *   A law needs two things from the pair: a MAGNITUDE (symmetric — one flow per
 *   edge, L1) and a SIDE (which of the two cells the wall bows into). The
 *   magnitude may be any φ-invariant function of the pair. The SIDE may not:
 *   picking a cell out of the pair {σ₂, σ₃} is picking a fixed point of a
 *   transposition, and φ has none there.
 *
 *   And the obstruction is REALISED, not hypothetical: every edge lying on one
 *   of the six mirror lines is fixed by that reflection while its two cells are
 *   SWAPPED by it, so on such an edge a side is a contradiction outright. The
 *   test counts those edges and their charge pairs.
 *
 * What does survive is the coboundary of the charge pushed through the unique
 * φ-stable quotient of V₄. The three subgroups of index 2 are {1, σ₂σ₃} = `H`,
 * {1, σ₂} and {1, σ₃}; φ swaps the last two and fixes `H`, so
 *
 *   > **V₄ → V₄/H ≅ ℤ/2 is the ONLY non-trivial φ-equivariant charge quotient**,
 *
 * and `H` is not a convenience: it is `figure.ts`'s own H, the subgroup fixing
 * √6, of which that module says *"every scoring rule in the game is a statement
 * about this partition"*. So the law is
 *
 *   > **an edge curves exactly when its two cells are INCOHERENT** — when they
 *   > lie in different cosets of H — **and bows into the non-H side.**
 *
 * `figure.coherent` is that predicate, already shipped and already tested. The
 * V₄ tiers this law cannot draw are exactly the coherent-but-different pairs
 * ({1, σ₂σ₃} and {σ₂, σ₃}), and one of those two is the obstruction itself; a
 * law that drew {1, σ₂σ₃} while leaving {σ₂, σ₃} flat would be equivariant but
 * would split a coset, which is a statement about neither of the two canonical
 * structures. Measurement beat the brief's candidate and this is what was left.
 *
 * ── AND THE SECOND RADIX DRAWS ITS WHOLE CHARGE ──────────────────────────
 *
 * At rep-9 the grade is **invariant**, not equivariant-up-to-a-relabelling
 * [PROVEN, `docs/rep9-charge.md`: 44,280 tests, zero mismatches], so φ₉ is the
 * identity and there is nothing to be stable under. The full ℤ/3 coboundary is
 * drawable, and it even supplies its own side for free: of two adjacent grades
 * exactly one is the other's +1, so *bow into the cell whose grade is the
 * other's successor* is a complete, symmetric, invariant rule.
 *
 *   > rep-4 can draw its charge only through V₄/H; rep-9 draws all of ℤ/3.
 *
 * The one bit of fiat at rep-9 is the one `docs/rep9-charge.md` already names
 * and refuses to serialise — which upright class counts as +1 — and flipping it
 * mirrors the curve field. At rep-4 the matching bit is "bows into the non-H
 * side"; H itself is forced, the direction is the fiat.
 *
 * ── THE APEX, AND WHY THERE IS NO ARITHMETIC HERE AT ALL ─────────────────
 *
 * `docs/warp-findings.md` §R: `apex = mid ± (cot(θ/2)/2)·rot90(Q − P)`, no
 * square root. At θ = 60° — the FlowAngle the canvas already IS, at flow 0 —
 * that apex over an edge of an equilateral cell is exactly the THIRD VERTEX of
 * the cell on that side. Every cell of this figure is an equilateral lattice
 * triangle of one size, so:
 *
 *   > **the 60° apex of an interior edge is a vertex the table already holds**,
 *   > and the wall's apex is an INDEX, not a computation.
 *
 * No ring element is constructed, no √3 is multiplied, and the ring-membership
 * question §R decides never has to be asked here. (Worth recording because it
 * inverts the table: in the EISENSTEIN frame this figure actually lives in,
 * √3·rot90 = 2ω − 1 is the integral map, so 60° and 120° are the lattice-exact
 * apex angles and 30°/90°/150° — §R's *reversible* ones, in the Cartesian
 * ℤ[√3] frame — are not. Ring membership is a statement about a FRAME. Nothing
 * in this increment composes apexes, so §R's unit condition, which is about
 * composing them, is not the condition that binds.)
 *
 * ── EXACTNESS: WHERE THE RING LIVES, AND THE ONE FLOAT ───────────────────
 *
 * A control point is `P + flow·(A − P)` with flow a rational, so the resolution
 * goes into the SCALE and not into the number type — `vertices.refineTable`'s
 * move, reused rather than restated:
 *
 *   > every coordinate this module emits is an exact INTEGER on the ×144
 *   > lattice: `cp = 144·P + k·(A − P)`, k the dial.
 *
 * 144 because `docs/spec-curvature.md` G2 already names it (the dozenal
 * smoothstep's denominator, and the twelfth-based rationals the exported
 * keyframes state). There is no `Math.` call and no division in this file. The
 * single float boundary is the `ToPixel` the caller supplies at path emission,
 * which is `hexagon.latticeToPixel` — the display boundary that already exists,
 * unmodified.
 *
 * The view transform composes with this EXACTLY, and that is a fact rather than
 * a hope: a Bézier is an affine-invariant construction, so the image of the
 * curve is the curve of the imaged control points, and `view.plateFrame`'s
 * sector transform is affine. `relief.ts`'s remap is NOT — see the exclusion
 * note on `MAX_FLOW` below and in `draw/page.tsx`.
 *
 * ── THE CEILING, TAKEN FROM A MEASUREMENT AND NOT FROM TASTE ─────────────
 *
 * At dial k the curve's deviation from the chord at its midpoint is
 * `(3/4)·(k/144)·h`, h the cell's height. `docs/warp-findings.md` Q3 measured
 * the containment budget in exactly those units: **sagitta ¼ of a cell → 0
 * mismatches at every ratio tested; sagitta ½ → 56–112 mismatches.** So
 *
 *   > **MAX_FLOW = 48/144 = 1/3, the dial at which the sagitta is exactly ¼ of
 *   > a cell height** — the largest value Q3 measured with zero mismatches, and
 *   > exactly half the dial at which it measured failure.
 *
 * That is a display ceiling, not a licence: L2 stands, and no coordinate this
 * module produces may reach a containment decision. It is here so the picture
 * does not visibly contradict the ownership the lattice decided.
 *
 * ── L2, ENFORCED BY THE MODULE BOUNDARY ──────────────────────────────────
 *
 * This module imports the charge and the table; it is imported by the BOARD and
 * by the page, and by nothing else. `test/curvature.test.ts` asserts that over
 * the source tree — no mask, plate, brush, orbit, arm, focus or export module
 * may name it — because "no warped coordinate reaches a decision" is a property
 * of the import graph and is checkable as one.
 */

import { H, type Charge } from "./figure";
import { type Lat } from "./hexagon";
import {
  refineTable,
  tableTriangle,
  type CanvasSpec,
  type DerivedVertexTable,
  type VertexTable,
  buildVertexTable,
} from "./vertices";
import { fmtUnit } from "./view";

// ═════════════════════════════════════════════════════════════════════════
// THE GUARD — `vertices.ts`'s, restated
// ═════════════════════════════════════════════════════════════════════════
//
// Every product here is `144 · lattice coordinate` or `dial · lattice
// coordinate`, and the widest reachable is 144 × 81 = 11,664 at a rep-9 depth-4
// hexagon — six ULPs into a `number`'s exact range, not sixty bits from its
// end. The guard is expected never to fire; it is here because a wrapped
// coordinate would draw a curve somewhere else entirely and nothing downstream
// would notice, which is the same argument `vertices.exact` makes.

function exact(x: number): number {
  if (!Number.isSafeInteger(x)) {
    throw new Error(`curvature: exact integer range exceeded (${x})`);
  }
  return x;
}

// ═════════════════════════════════════════════════════════════════════════
// THE DIAL
// ═════════════════════════════════════════════════════════════════════════

/**
 * The dial's denominator. `flow = k / REFINE`, and every coordinate emitted is
 * an exact integer on the lattice refined by this factor.
 *
 * 144 is `docs/spec-curvature.md` G2's own denominator, adopted here rather
 * than invented: the easing ladder increments 2, 6, 10, 14, 18, 22 over 144
 * land on this dial without a second denominator when increment 3 eases it.
 */
export const REFINE = 144;

/**
 * The largest dial the model accepts: 48/144 = 1/3, the value at which the
 * midpoint sagitta is exactly ¼ of a cell's height.
 *
 * NOT a taste. `docs/warp-findings.md` Q3 swept the containment budget in those
 * units and measured 0 mismatches at sagitta ¼ for coarse:fine ratios 2, 4 and
 * 8, against 64/56/112 at sagitta ½. The dial stops at the measured-safe value.
 */
export const MAX_FLOW = 48;

/** A dial position, in 144ths. `0` is off and is the ONLY value that is off. */
export type Flow = number;

// ═════════════════════════════════════════════════════════════════════════
// THE EDGE LAW
// ═════════════════════════════════════════════════════════════════════════

/**
 * A law is a SYMMETRIC function of the unordered pair of adjacent charges that
 * answers one question: *which of the two does the wall bow into?*
 *
 * `null` is a straight edge — the two cells are inside one domain, or the pair
 * is one no equivariant side exists for. The returned value is a CHARGE, not a
 * cell, so the law never sees an index and cannot smuggle an orientation in
 * through one: the caller resolves it to the cell holding that charge.
 *
 * Two conditions, both checked exhaustively over the charge set in
 * `test/curvature.test.ts` rather than promised here:
 *
 *   SYMMETRY      `bowsInto(a, b) === bowsInto(b, a)` — L1. One edge, one curve;
 *                 a law that read the pair in an order would be two laws.
 *   EQUIVARIANCE  `bowsInto(φa, φb) === φ(bowsInto(a, b))` for the relabelling
 *                 the reflections apply. This is the whole feature.
 */
export interface EdgeLaw {
  readonly name: string;
  /** The relabelling the six reflections apply to the charge. */
  readonly phi: (c: number) => number;
  /** Every charge value the law is defined on — the exhaustive test's domain. */
  readonly charges: readonly number[];
  readonly bowsInto: (a: number, b: number) => number | null;
}

/** `figure.H`, read rather than restated: the coset of a charge, 0 = in H. */
const coset = (c: number): 0 | 1 => (H.has(c as Charge) ? 0 : 1);

/**
 * REP-4. The wall of the H-coset partition — the coboundary of the charge
 * pushed through V₄ → V₄/H, which the header shows is the unique non-trivial
 * φ-equivariant quotient there is.
 *
 * Bows into the NON-H side: the √6-fixing domain {1, σ₂σ₃} pushes outward and
 * the {σ₂, σ₃} domain gives ground. That direction is the one bit of fiat in the
 * rep-4 law — flipping it mirrors every wall and is equally equivariant — and it
 * is named here because it is not derivable, exactly as `docs/rep9-charge.md`
 * names its own one bit instead of hiding it.
 */
export const V4_H_WALL: EdgeLaw = {
  name: "V₄ H-coset wall",
  phi: (c) => (c === 1 ? 2 : c === 2 ? 1 : c),
  charges: [0, 1, 2, 3],
  bowsInto: (a, b) =>
    coset(a) === coset(b) ? null : coset(a) === 1 ? a : b,
};

/**
 * REP-9. The full ℤ/3 coboundary, side included.
 *
 * Of two distinct grades exactly one is the other's successor, so "bow into the
 * successor" is total, symmetric, and needs no tie-break. φ₉ is the identity
 * because the grade is INVARIANT under all of D₃ [PROVEN, `docs/rep9-charge.md`],
 * so there is no stability condition to satisfy and no tier is lost.
 */
export const Z3_GRADE_WALL: EdgeLaw = {
  name: "ℤ/3 grade wall",
  phi: (c) => c,
  charges: [0, 1, 2],
  bowsInto: (a, b) => (a === b ? null : (a + 1) % 3 === b ? b : a),
};

/**
 * THE CANDIDATE THIS INCREMENT WAS HANDED, KEPT AS A COUNTEREXAMPLE.
 *
 * The full V₄ coboundary: curve whenever `c_L ⊕ c_R ≠ 0`, with the side taken
 * from an order on the charge codes — which is what any implementation that has
 * not noticed the obstruction will reach for, since SOME side must be picked and
 * the codes are right there.
 *
 * Exported ONLY so `test/curvature.test.ts` can plant it and show it caught,
 * exactly as `hexagon.mutantRotMap` is. Never used by the model or the UI.
 * It fails on, and only on, the pair {σ₂, σ₃} — which is the header's claim,
 * made lethal.
 */
export const V4_FULL_COBOUNDARY: EdgeLaw = {
  name: "V₄ full coboundary (REJECTED — no φ-equivariant side)",
  phi: V4_H_WALL.phi,
  charges: [0, 1, 2, 3],
  bowsInto: (a, b) => (a === b ? null : a > b ? a : b),
};

// ═════════════════════════════════════════════════════════════════════════
// THE APEX ALGEBRA — one subtraction, no ring element
// ═════════════════════════════════════════════════════════════════════════

/**
 * The two control points of one wall, on the ×`REFINE` lattice.
 *
 * `cp₁ = REFINE·P + k·(A − P)`, `cp₂ = REFINE·Q + k·(A − Q)` — the FlowAngle
 * handles `anchor + flow·(apex − anchor)` with the division deferred into the
 * lattice. At k = 0 they collapse onto the anchors and the cubic IS the chord,
 * which is why L3's identity is an arithmetic fact and not a special case (the
 * model still refuses to build at all at k = 0; see `buildCurvature`).
 *
 * `flow` is NOT range-checked here. This is the primitive the ceiling is a
 * policy over, and `test/curvature.test.ts` drives it past the ceiling to show
 * the containment claim is not vacuous.
 */
export function controlPoints(
  p: Lat,
  q: Lat,
  apex: Lat,
  flow: Flow
): readonly [Lat, Lat] {
  return [
    [
      exact(REFINE * p[0] + flow * (apex[0] - p[0])),
      exact(REFINE * p[1] + flow * (apex[1] - p[1])),
    ],
    [
      exact(REFINE * q[0] + flow * (apex[0] - q[0])),
      exact(REFINE * q[1] + flow * (apex[1] - q[1])),
    ],
  ];
}

// ═════════════════════════════════════════════════════════════════════════
// THE FIELD
// ═════════════════════════════════════════════════════════════════════════

/** An interior edge's identity: its two vertex indices, ascending. */
export const edgeKey = (a: number, b: number): string =>
  a < b ? `${a}:${b}` : `${b}:${a}`;

/**
 * ONE CURVE, OWNED BY THE EDGE. Both incident cells hold this object; neither
 * holds a copy.
 */
export interface Wall {
  /** The anchors, as indices into the table's vertices. `p < q`. */
  readonly p: number;
  readonly q: number;
  /** The 60° apex: the third vertex of the cell bowed into. An INDEX. */
  readonly apex: number;
  /** The cell the wall bows into, and the one it bows away from. */
  readonly into: number;
  readonly from: number;
  /** The charges that decided it, aligned to `into` / `from`. */
  readonly chargeInto: number;
  readonly chargeFrom: number;
  /** Exact control points on the ×REFINE lattice, at `p`'s end and `q`'s end. */
  readonly cp: readonly [Lat, Lat];
}

/**
 * One side of one cell's outline, in traversal order.
 *
 * A curved step carries the WALL, not a copy of its geometry, and `c1`/`c2` are
 * the wall's own control-point objects — swapped when this cell walks the edge
 * from `q` to `p`. That is L1 made testable by `===`.
 */
export type Step =
  | { readonly kind: "line"; readonly to: Lat }
  | {
      readonly kind: "curve";
      readonly wall: Wall;
      readonly c1: Lat;
      readonly c2: Lat;
      readonly to: Lat;
    };

export interface CurvatureCensus {
  readonly cells: number;
  readonly edges: number;
  readonly interior: number;
  readonly boundary: number;
  readonly walls: number;
  /** Interior edges by unordered charge pair, keyed `"a|b"` with a ≤ b. */
  readonly pairs: ReadonlyMap<string, number>;
  /**
   * Cells every one of whose edges bows INWARD.
   *
   * A sink shrinks rather than grows, and at a dial far above the ceiling its
   * three curves would meet. Counted rather than assumed absent: at the ceiling
   * each inward curve's midpoint stops short of the centroid (the sagitta is ¼
   * of the height and the centroid is at ⅓), so the three stay apart.
   */
  readonly sinks: number;
  /** Cells with no curved edge at all — wholly inside one domain. */
  readonly flat: number;
}

export interface CurvatureField {
  /** The dial, in 144ths. Never 0 — a zero dial produces no field at all. */
  readonly flow: Flow;
  readonly law: EdgeLaw;
  /** The table this was built on. `vertices.ts` owns it; this borrows it. */
  readonly table: VertexTable;
  /** The same table on the ×REFINE lattice — every emitted anchor comes from it. */
  readonly refined: VertexTable;
  readonly walls: readonly Wall[];
  readonly wallByEdge: ReadonlyMap<string, Wall>;
  /** Per cell, its three sides in role order, starting at role 0. */
  readonly outlines: readonly (readonly Step[])[];
  readonly census: CurvatureCensus;
}

/**
 * THE MUTATION SWITCH — a guard-fire, and it is not reachable from the app.
 *
 * `"per-cell"` builds the outlines the way a per-triangle implementation would:
 * every cell decides its own edge, bowing each wall into ITSELF, so the two
 * sides of a seam are two curves that disagree. It is exactly the failure L1
 * exists to forbid and exactly what `vertices.explode` is to L4 — a
 * counterexample kept in the module so the property has something to be lethal
 * against. Never `"per-cell"` from `src/app`.
 */
export type Mutation = "none" | "per-cell";

const wallsOf = (
  table: VertexTable,
  charges: readonly number[],
  law: EdgeLaw,
  flow: Flow
): { walls: Wall[]; byEdge: Map<string, Wall>; census: CurvatureCensus } => {
  // The edge sweep. A triangulation gives every edge one or two incident cells;
  // three would mean the table is not a surface, which is a corruption worth a
  // throw rather than a curve drawn over a fold.
  interface Side {
    readonly cell: number;
    /** The cell's third vertex — the 60° apex on this side. */
    readonly apex: number;
  }
  const sides = new Map<string, Side[]>();
  const ends = new Map<string, readonly [number, number]>();

  table.cells.forEach((tri, cell) => {
    for (let r = 0; r < 3; r++) {
      const a = tri[r];
      const b = tri[(r + 1) % 3];
      const apex = tri[(r + 2) % 3];
      const k = edgeKey(a, b);
      const list = sides.get(k);
      if (list === undefined) {
        sides.set(k, [{ cell, apex }]);
        ends.set(k, a < b ? [a, b] : [b, a]);
      } else if (list.length === 2) {
        throw new Error(`curvature: edge ${k} has three incident cells`);
      } else {
        list.push({ cell, apex });
      }
    }
  });

  const walls: Wall[] = [];
  const byEdge = new Map<string, Wall>();
  const pairs = new Map<string, number>();
  let interior = 0;

  for (const [k, list] of sides) {
    if (list.length === 1) continue; // the perimeter. See `buildCurvature`.
    interior++;
    const [l, r] = list;
    const cl = charges[l.cell];
    const cr = charges[r.cell];
    const pk = cl <= cr ? `${cl}|${cr}` : `${cr}|${cl}`;
    pairs.set(pk, (pairs.get(pk) ?? 0) + 1);

    const target = law.bowsInto(cl, cr);
    if (target === null) continue;
    if ((target === cl) === (target === cr)) {
      throw new Error(
        `curvature: ${law.name} answered ${target} for the pair (${cl}, ${cr}), which names both cells or neither`
      );
    }
    const into = target === cl ? l : r;
    const from = target === cl ? r : l;
    const [p, q] = ends.get(k) as readonly [number, number];
    const wall: Wall = {
      p,
      q,
      apex: into.apex,
      into: into.cell,
      from: from.cell,
      chargeInto: charges[into.cell],
      chargeFrom: charges[from.cell],
      cp: controlPoints(
        table.vertices[p],
        table.vertices[q],
        table.vertices[into.apex],
        flow
      ),
    };
    walls.push(wall);
    byEdge.set(k, wall);
  }

  return {
    walls,
    byEdge,
    census: {
      cells: table.cells.length,
      edges: sides.size,
      interior,
      boundary: sides.size - interior,
      walls: walls.length,
      pairs,
      sinks: 0,
      flat: 0,
    },
  };
};

/**
 * THE FIELD. One curve per wall, referenced by both its cells.
 *
 * `charges` is index-aligned to the table's cells, which for a canvas built by
 * `buildVertexTable` is `buildHexagon`'s own cell order — both enumerate
 * `for s in 0..5 { for base cells }` over the same DFS address sweep. The
 * alignment is ASSERTED in `test/curvature.test.ts` against the hexagon's exact
 * lattice keys rather than assumed here, because it is the one join between this
 * module and the model and a silent misalignment would draw a correct picture of
 * the wrong charge field.
 *
 * **Returns `null` at flow 0, always, before any work** — L3. The zero dial is
 * not a field of straight curves that happens to agree with the polygons; there
 * is no field, the board's `curve` prop is `null`, and the board takes the same
 * branch it took before this increment existed.
 *
 * BOUNDARY EDGES ARE STRAIGHT, and the reason is the law rather than a
 * convenience: a coboundary is a function of a PAIR and the perimeter has no
 * pair. Two consequences make it the right answer as well as the forced one —
 * the hexagon's rim is the frame every export, mask and hit target is sized to,
 * and the rim is D₆-invariant as a set, so leaving it alone cannot break the
 * equivariance the interior is being held to.
 */
export function buildCurvature(
  table: VertexTable,
  charges: readonly number[],
  law: EdgeLaw,
  flow: Flow,
  mutation: Mutation = "none"
): CurvatureField | null {
  if (flow === 0) return null;
  if (!Number.isSafeInteger(flow) || flow < 0 || flow > MAX_FLOW) {
    throw new Error(
      `curvature: dial ${flow} is not an integer in 0…${MAX_FLOW} (144ths)`
    );
  }
  if (charges.length !== table.cells.length) {
    throw new Error(
      `curvature: ${charges.length} charges for ${table.cells.length} cells`
    );
  }

  const { walls, byEdge, census } = wallsOf(table, charges, law, flow);
  const refined = refineTable(table, REFINE);

  let sinks = 0;
  let flat = 0;
  const outlines = table.cells.map((tri, cell) => {
    const steps: Step[] = [];
    let curved = 0;
    for (let r = 0; r < 3; r++) {
      const a = tri[r];
      const b = tri[(r + 1) % 3];
      const to = refined.vertices[b];
      const wall = byEdge.get(edgeKey(a, b));
      if (wall === undefined) {
        steps.push({ kind: "line", to });
        continue;
      }
      curved++;
      if (mutation === "per-cell") {
        // THE GUARD-FIRE. Each cell bows the wall into itself, from its own
        // third vertex — one edge, two curves, which is the whole of what L1
        // forbids. See `Mutation`.
        const cp = controlPoints(
          table.vertices[a],
          table.vertices[b],
          table.vertices[tri[(r + 2) % 3]],
          flow
        );
        steps.push({ kind: "curve", wall, c1: cp[0], c2: cp[1], to });
        continue;
      }
      // The SAME control-point objects both sides, swapped for the direction
      // this cell walks the edge in. No arithmetic: L1 is an identity here.
      const forward = a === wall.p;
      steps.push({
        kind: "curve",
        wall,
        c1: forward ? wall.cp[0] : wall.cp[1],
        c2: forward ? wall.cp[1] : wall.cp[0],
        to,
      });
    }
    if (curved === 0) flat++;
    else if (curved === 3 && steps.every((s) => s.kind === "curve" && s.wall.into === cell)) {
      sinks++;
    }
    return steps;
  });

  return {
    flow,
    law,
    table,
    refined,
    walls,
    wallByEdge: byEdge,
    outlines,
    census: { ...census, sinks, flat },
  };
}

/** The same, from a canvas spec — the table built here and not borrowed. */
export function curvatureFor(
  spec: CanvasSpec,
  charges: readonly number[],
  law: EdgeLaw,
  flow: Flow
): { field: CurvatureField | null; table: DerivedVertexTable } {
  const table = buildVertexTable(spec);
  return { field: buildCurvature(table, charges, law, flow), table };
}

/** The wall on the edge between two vertices, or `undefined` if it is straight. */
export const wallBetween = (
  field: CurvatureField,
  a: number,
  b: number
): Wall | undefined => field.wallByEdge.get(edgeKey(a, b));

// ═════════════════════════════════════════════════════════════════════════
// THE DISPLAY BOUNDARY — the one float, and it belongs to the caller
// ═════════════════════════════════════════════════════════════════════════

/**
 * A refined lattice point, in whatever pixels the caller draws in.
 *
 * Supplied rather than imported so this module contains no projection and no
 * float: the page passes `p => applyAffine(transform, latticeToPixel(p, unit /
 * REFINE, cx, cy))`, which is `hexagon.ts`'s existing display boundary followed
 * by `view.ts`'s existing affine — and a Bézier is affine-invariant, so passing
 * the control points through that composition IS the image of the curve.
 */
export type ToPixel = (p: Lat) => readonly [number, number];

const at = (toPixel: ToPixel, p: Lat): string => {
  const x = toPixel(p);
  return `${fmtUnit(x[0])},${fmtUnit(x[1])}`;
};

/**
 * One cell's outline as an SVG `d`.
 *
 * Two decimals, from `view.fmtUnit`, because that is what the board's polygons
 * and the exported file already round to and a curve that rounded differently
 * would not sit on the vertices its neighbours drew.
 */
export function cellPath(
  field: CurvatureField,
  cell: number,
  toPixel: ToPixel
): string {
  const steps = field.outlines[cell];
  if (steps === undefined) throw new Error(`curvature: no cell ${cell}`);
  const tri = field.table.cells[cell];
  let d = `M${at(toPixel, field.refined.vertices[tri[0]])}`;
  for (const s of steps) {
    d +=
      s.kind === "line"
        ? `L${at(toPixel, s.to)}`
        : `C${at(toPixel, s.c1)} ${at(toPixel, s.c2)} ${at(toPixel, s.to)}`;
  }
  return `${d}Z`;
}

/** Every cell's outline, index-aligned to the canvas — the board's `paths`. */
export function curvePaths(field: CurvatureField, toPixel: ToPixel): string[] {
  return field.outlines.map((_, i) => cellPath(field, i, toPixel));
}

// ═════════════════════════════════════════════════════════════════════════
// CONTAINMENT, EXACTLY — and it decides nothing
// ═════════════════════════════════════════════════════════════════════════

/**
 * Twice the signed area of a refined-lattice triangle. Integer, exact.
 *
 * `vertices.cellArea2` is the same determinant over a table; this one takes
 * three loose points because the question here is about a CONTROL POINT and a
 * cell, and a control point is not in any table.
 */
export const area2 = (p: Lat, q: Lat, r: Lat): number =>
  exact(
    exact((q[0] - p[0]) * (r[1] - p[1])) - exact((q[1] - p[1]) * (r[0] - p[0]))
  );

/**
 * Is a control point inside the closed triangle it was built over?
 *
 * Exact integer orientation tests on the refined lattice — no tolerance, no
 * float, and no bearing whatever on ownership: this is the assertion that the
 * PICTURE stays where the lattice put it, run in the tests, not a containment
 * decision (L2 forbids that and nothing here is called from a decision path).
 *
 * True for every wall at every dial up to `MAX_FLOW` by construction — a handle
 * sits on the segment from an anchor to the apex — and the test drives
 * `controlPoints` past the ceiling to show the claim has a false side.
 */
export function insideTriangle(
  point: Lat,
  a: Lat,
  b: Lat,
  c: Lat
): boolean {
  const s = area2(a, b, c);
  if (s === 0) return false;
  const w0 = area2(point, b, c);
  const w1 = area2(a, point, c);
  const w2 = area2(a, b, point);
  return s > 0
    ? w0 >= 0 && w1 >= 0 && w2 >= 0
    : w0 <= 0 && w1 <= 0 && w2 <= 0;
}

/**
 * Does every control point of every wall lie inside the cell it bows into?
 *
 * The cell's own triangle, on the refined lattice — so the answer covers both
 * halves of the L1 seam at once: the two cells share the curve, and the curve
 * lies in the union of the two triangles because it lies in one of them.
 */
export function wallsContained(field: CurvatureField): boolean {
  for (const w of field.walls) {
    const tri = tableTriangle(field.refined, w.into);
    if (!insideTriangle(w.cp[0], tri[0], tri[1], tri[2])) return false;
    if (!insideTriangle(w.cp[1], tri[0], tri[1], tri[2])) return false;
  }
  return true;
}
