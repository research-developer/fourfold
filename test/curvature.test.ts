/**
 * CURVATURE — increment 2 of `docs/spec-curvature.md`, decided by computation.
 *
 * The feature exists to make the charge visible through its GRADIENT, so the
 * question this file has to answer is not "does it draw" but **is the drawing a
 * function of the charge in the way D₆ requires**. `docs/symmetry-findings.md`
 * measured the action: the six rotations carry each cell's charge unchanged and
 * the six reflections carry it by φ = (σ₂ σ₃). A curve field built from the
 * charge must therefore map to itself under all twelve isometries — and it is
 * built from the REAL machinery on both sides, `hexagon.HEX_ISOMETRIES` acting
 * on the lattice and `hexagon.indexMap` on the cells, never from a fixture.
 *
 * Labels follow the house convention: [PROVEN] is exhaustive computation against
 * an independent oracle with a mutation shown lethal; [MEASURED] is a number
 * this run produced.
 *
 * ── WHAT THE MEASUREMENT DID TO THE BRIEF'S CANDIDATE ────────────────────
 *
 * The candidate was the full V₄ coboundary. It is **refuted**, and not by
 * argument: `V4_FULL_COBOUNDARY` is planted here and shown red, the failures are
 * shown to be exactly the {σ₂, σ₃} edges, and the obstruction is exhibited on
 * the figure itself — every edge lying on one of the six mirror lines is fixed
 * by that reflection while its two cells are SWAPPED, so on those edges a side
 * is a contradiction outright and the pair really is {σ₂, σ₃} there. What
 * survives is the coboundary of the charge through V₄ → V₄/H, and H is forced:
 * it is the unique index-2 subgroup φ fixes.
 *
 * ── FLOAT ────────────────────────────────────────────────────────────────
 *
 * `src/lib/curvature.ts` contains no `Math.` call, no division and no float —
 * asserted below by reading its own source. One `it` is marked FLOAT ORACLE: it
 * cross-checks the ×144 refinement against `hexagon.latticeToPixel`'s own
 * pixels, and decides nothing the exact tests have not already decided.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import {
  buildHexagon,
  buildRep9Hexagon,
  HEX_ISOMETRIES,
  indexMap,
  latKey,
  latticeToPixel,
  type HexIsometry,
  type Lat,
} from "../src/lib/hexagon";
import {
  buildVertexTable,
  tableTriangle,
  type CanvasSpec,
  type DerivedVertexTable,
} from "../src/lib/vertices";
import { fmtUnit } from "../src/lib/view";
import {
  area2,
  buildCurvature,
  cellPath,
  controlPoints,
  curvePaths,
  curvatureFor,
  edgeKey,
  insideTriangle,
  MAX_FLOW,
  REFINE,
  V4_FULL_COBOUNDARY,
  V4_H_WALL,
  wallsContained,
  Z3_GRADE_WALL,
  type CurvatureField,
  type EdgeLaw,
  type Step,
  type Wall,
} from "../src/lib/curvature";

// ── the two canvases, built by the SHIPPED constructors ──────────────────

interface Canvas {
  readonly name: string;
  readonly spec: CanvasSpec;
  readonly table: DerivedVertexTable;
  readonly charges: readonly number[];
  readonly law: EdgeLaw;
  /** The shipped hexagon, as the oracle for cell order and the cell action. */
  readonly hex: {
    readonly cells: readonly { readonly i: number; readonly key: Lat }[];
    readonly byKey: ReadonlyMap<string, number>;
  };
}

const rep4 = (depth: number): Canvas => {
  const hex = buildHexagon(depth);
  const spec: CanvasSpec = { radix: 4, depth, sectors: 6 };
  return {
    name: `rep-4 d${depth}`,
    spec,
    table: buildVertexTable(spec),
    charges: hex.cells.map((c) => c.charge),
    law: V4_H_WALL,
    hex,
  };
};

const rep9 = (depth: number): Canvas => {
  const hex = buildRep9Hexagon(depth);
  const spec: CanvasSpec = { radix: 9, depth, sectors: 6 };
  return {
    name: `rep-9 d${depth}`,
    spec,
    table: buildVertexTable(spec),
    charges: hex.cells.map((c) => c.charge),
    law: Z3_GRADE_WALL,
    hex,
  };
};

const CANVASES = (): Canvas[] => [rep4(1), rep4(2), rep4(3), rep9(1), rep9(2)];

const DIAL = 36; // 36/144 = ¼, inside the ceiling and not a round number of it

const fieldOf = (c: Canvas, flow = DIAL, mutation: "none" | "per-cell" = "none") => {
  const f = buildCurvature(c.table, c.charges, c.law, flow, mutation);
  if (f === null) throw new Error("curvature: expected a field");
  return f;
};

/**
 * The test's OWN edge sweep — a second opinion on the module's.
 *
 * The module retains only the walls; this enumerates every edge, so the straight
 * ones can be held to equivariance too. An equivariance test that only checked
 * the curved edges would pass on a law that curved everything.
 */
function edgesOf(table: DerivedVertexTable): Map<string, number[]> {
  const out = new Map<string, number[]>();
  table.cells.forEach((tri, cell) => {
    for (let r = 0; r < 3; r++) {
      const k = edgeKey(tri[r], tri[(r + 1) % 3]);
      const l = out.get(k);
      if (l === undefined) out.set(k, [cell]);
      else l.push(cell);
    }
  });
  return out;
}

/** The permutation an isometry induces on the table's VERTICES. */
function vertexMap(table: DerivedVertexTable, g: HexIsometry): number[] {
  return table.vertices.map((v, i) => {
    const j = table.index.get(latKey(g.apply(v)));
    if (j === undefined) {
      throw new Error(`${g.name}: vertex ${i} leaves the table`);
    }
    return j;
  });
}

// ═════════════════════════════════════════════════════════════════════════
describe("the edge law, on its own terms", () => {
  /**
   * SYMMETRY IS L1 AT THE LAW LEVEL. One edge, one curve: a law that read its
   * two charges in an order would be two laws, and the two cells would be
   * entitled to different answers about the same edge.
   */
  it("both shipped laws are symmetric in the pair, exhaustively [PROVEN]", () => {
    for (const law of [V4_H_WALL, Z3_GRADE_WALL, V4_FULL_COBOUNDARY]) {
      for (const a of law.charges) {
        for (const b of law.charges) {
          expect([law.name, a, b, law.bowsInto(a, b)]).toEqual([
            law.name,
            a,
            b,
            law.bowsInto(b, a),
          ]);
        }
      }
    }
  });

  /**
   * ★ THE CONDITION THE FEATURE TURNS ON, stated on the law before it is stated
   * on the figure: `bowsInto(φa, φb) = φ(bowsInto(a, b))`.
   *
   * And the guard-fire in the same breath — the brief's full-coboundary
   * candidate is symmetric, curves strictly more edges, and fails this on
   * exactly one pair.
   */
  it("the shipped laws commute with φ; the full coboundary fails on {σ₂, σ₃} [PROVEN]", () => {
    const check = (law: EdgeLaw) => {
      const bad: string[] = [];
      for (const a of law.charges) {
        for (const b of law.charges) {
          const want = law.bowsInto(a, b);
          const got = law.bowsInto(law.phi(a), law.phi(b));
          const image = want === null ? null : law.phi(want);
          if (got !== image) bad.push(`{${a},${b}}`);
        }
      }
      return bad;
    };
    expect([V4_H_WALL.name, check(V4_H_WALL)]).toEqual([V4_H_WALL.name, []]);
    expect([Z3_GRADE_WALL.name, check(Z3_GRADE_WALL)]).toEqual([
      Z3_GRADE_WALL.name,
      [],
    ]);
    // σ₂ = 2, σ₃ = 1 in `figure.ts`'s codes. The failure is that pair and
    // nothing else — the transposition φ has no fixed point inside it.
    expect(check(V4_FULL_COBOUNDARY)).toEqual(["{1,2}", "{2,1}"]);
  });

  /**
   * WHICH PAIRS EACH LAW CURVES — the tiers, counted rather than described.
   *
   * rep-4: of the 16 ordered pairs, 8 are H-walls (the coset boundary) and 8 are
   * not — the 4 equal pairs plus the 4 coherent-but-different ones, which are
   * the two tiers the quotient throws away. rep-9 curves every unequal pair: 6
   * of 9, the whole coboundary.
   */
  it("the tiers: rep-4 draws V₄/H, rep-9 draws all of ℤ/3 [MEASURED]", () => {
    const curved = (law: EdgeLaw) => {
      let n = 0;
      for (const a of law.charges) {
        for (const b of law.charges) if (law.bowsInto(a, b) !== null) n++;
      }
      return n;
    };
    expect([
      ["rep-4 H-wall", curved(V4_H_WALL), V4_H_WALL.charges.length ** 2],
      ["rep-9 grade", curved(Z3_GRADE_WALL), Z3_GRADE_WALL.charges.length ** 2],
      ["rejected full coboundary", curved(V4_FULL_COBOUNDARY), 16],
    ]).toEqual([
      ["rep-4 H-wall", 8, 16],
      ["rep-9 grade", 6, 9],
      ["rejected full coboundary", 12, 16],
    ]);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("the join to the model", () => {
  /**
   * THE ONE JOIN, AND THE ONE WAY IT COULD BE SILENTLY WRONG.
   *
   * `buildCurvature` is handed charges index-aligned to the table's cells. If the
   * table's cell order were not the hexagon's, every wall would be a correct
   * picture of the wrong charge field and every other test here would still pass.
   * So it is checked against the hexagon's own exact lattice keys — the sum of a
   * cell's three vertices, which is how `buildHexagon` indexes itself.
   */
  it("the table's cells ARE the hexagon's, key for key, both radices [PROVEN]", () => {
    const rows: [string, number, number][] = [];
    for (const c of CANVASES()) {
      let bad = 0;
      for (let i = 0; i < c.table.cells.length; i++) {
        const tri = tableTriangle(c.table, i);
        const key: Lat = [
          tri[0][0] + tri[1][0] + tri[2][0],
          tri[0][1] + tri[1][1] + tri[2][1],
        ];
        if (c.hex.byKey.get(latKey(key)) !== i) bad++;
      }
      rows.push([c.name, c.table.cells.length, bad]);
    }
    expect(rows).toEqual([
      ["rep-4 d1", 24, 0],
      ["rep-4 d2", 96, 0],
      ["rep-4 d3", 384, 0],
      ["rep-9 d1", 54, 0],
      ["rep-9 d2", 486, 0],
    ]);
  });

  /**
   * The census, against the test's own sweep. Every interior edge is accounted
   * for by exactly one pair bucket, and the walls are a subset of the interior.
   */
  it("the census counts the same edges the sweep finds [PROVEN]", () => {
    for (const c of CANVASES()) {
      const f = fieldOf(c);
      const edges = edgesOf(c.table);
      const interior = [...edges.values()].filter((l) => l.length === 2).length;
      const boundary = [...edges.values()].filter((l) => l.length === 1).length;
      let pairSum = 0;
      for (const n of f.census.pairs.values()) pairSum += n;
      expect([c.name, f.census.edges, f.census.interior, f.census.boundary, pairSum]).toEqual(
        [c.name, edges.size, interior, boundary, interior]
      );
      expect(f.census.walls).toBe(f.walls.length);
      expect(f.census.walls).toBeLessThanOrEqual(f.census.interior);
      // every edge has one or two cells: the table is a surface, not a fold.
      expect([...edges.values()].every((l) => l.length <= 2)).toBe(true);
    }
  });

  /**
   * THE OTHER CONVENTION, because the app can be in it — and it does NOT draw
   * the same picture, which is worth stating because the guess was that it
   * would.
   *
   * `ifs` reorders the ROLES of the B and C corner children, and the recursion
   * carries that ordering down, so the same physical triangle gets a different
   * ADDRESS and therefore a different charge. The cells are the same triangles;
   * the charge FIELD on them is not. **60 walls under `apex`, 48 under `ifs`**
   * at depth 2 [MEASURED] — which is the drawing telling the two conventions
   * apart, and is the visible face of `docs/symmetry-findings.md` §E's order-2
   * against order-6.
   *
   * What has to survive the convention is the machinery, and it does: the cell
   * order still matches the hexagon key for key, and the field is equivariant
   * under all twelve isometries in both.
   */
  it("the ifs convention is a DIFFERENT charge field, equally equivariant [PROVEN]", () => {
    const depth = 2;
    const hex = buildHexagon(depth, "ifs");
    const table = buildVertexTable({ radix: 4, depth, sectors: 6, convention: "ifs" });
    const charges = hex.cells.map((c) => c.charge);
    let keyBad = 0;
    for (let i = 0; i < table.cells.length; i++) {
      const tri = tableTriangle(table, i);
      const key: Lat = [
        tri[0][0] + tri[1][0] + tri[2][0],
        tri[0][1] + tri[1][1] + tri[2][1],
      ];
      if (hex.byKey.get(latKey(key)) !== i) keyBad++;
    }
    const f = buildCurvature(table, charges, V4_H_WALL, DIAL);
    let bad = 0;
    for (const g of HEX_ISOMETRIES) {
      const vp = vertexMap(table, g);
      for (const w of f?.walls ?? []) {
        const image = f?.wallByEdge.get(edgeKey(vp[w.p], vp[w.q]));
        if (image === undefined || image.apex !== vp[w.apex]) bad++;
      }
    }
    // 48 here against the apex convention's 60 on the same triangles — the two
    // conventions are two charge fields, and the curvature draws the difference.
    expect([keyBad, f?.walls.length, bad]).toEqual([0, 48, 0]);
    expect(fieldOf(rep4(depth)).walls.length).toBe(60);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("★ D₆-equivariance — the test this feature exists for", () => {
  /**
   * THE WHOLE CLAIM, ON THE SHIPPED FIGURE.
   *
   * For each of the twelve isometries: every wall's image edge is a wall, its
   * apex is the image of the apex (which is the SIDE — this is what makes it an
   * equivariance of the drawing and not merely of the wall SET), and the cell it
   * bows into is the image of the cell it bowed into, taken from
   * `hexagon.indexMap`. Every straight interior edge maps to a straight one.
   *
   * The charge field is not transformed by hand: the reflections carry it by φ
   * already, so a field built from the hexagon's own charges and found invariant
   * IS the statement "the mirrored drawing equals the drawing of the μ-transformed
   * charges".
   */
  it("every wall maps to a wall, apex for apex, over all twelve [PROVEN]", () => {
    const rows: [string, number, number, number][] = [];
    for (const c of CANVASES()) {
      const f = fieldOf(c);
      const edges = edgesOf(c.table);
      let checked = 0;
      let bad = 0;
      for (const g of HEX_ISOMETRIES) {
        const vp = vertexMap(c.table, g);
        const cp = indexMap(c.hex, g);
        for (const w of f.walls) {
          checked++;
          const image = f.wallByEdge.get(edgeKey(vp[w.p], vp[w.q]));
          if (
            image === undefined ||
            image.apex !== vp[w.apex] ||
            image.into !== cp[w.into] ||
            image.from !== cp[w.from]
          ) {
            bad++;
          }
        }
        for (const [k, cells] of edges) {
          if (cells.length !== 2) continue;
          if (f.wallByEdge.has(k)) continue;
          const [a, b] = k.split(":").map(Number);
          checked++;
          if (f.wallByEdge.has(edgeKey(vp[a], vp[b]))) bad++;
        }
      }
      rows.push([c.name, f.walls.length, checked, bad]);
    }
    expect(rows).toEqual([
      ["rep-4 d1", 12, 360, 0],
      ["rep-4 d2", 60, 1584, 0],
      ["rep-4 d3", 264, 6624, 0],
      ["rep-9 d1", 54, 864, 0],
      ["rep-9 d2", 648, 8424, 0],
    ]);
  });

  /**
   * ★ GUARD-FIRE, and it is the brief's own candidate.
   *
   * The full V₄ coboundary curves more edges and answers every pair, so nothing
   * about it looks wrong until it is asked to commute with a reflection. Planted
   * here and shown red — and the failures are ALL on the six reflections and
   * none on the six rotations, which is exactly where φ lives.
   */
  it("guard-fire: the full V₄ coboundary reddens the reflections and only those [PROVEN]", () => {
    const rows: [string, number, number, number][] = [];
    for (const c of [rep4(2), rep4(3)]) {
      const f = fieldOf({ ...c, law: V4_FULL_COBOUNDARY });
      let rotBad = 0;
      let flipBad = 0;
      for (const g of HEX_ISOMETRIES) {
        const vp = vertexMap(c.table, g);
        for (const w of f.walls) {
          const image = f.wallByEdge.get(edgeKey(vp[w.p], vp[w.q]));
          if (image === undefined || image.apex !== vp[w.apex]) {
            if (g.flip) flipBad++;
            else rotBad++;
          }
        }
      }
      rows.push([c.name, f.walls.length, rotBad, flipBad]);
    }
    expect(rows).toEqual([
      ["rep-4 d2", 108, 0, 144],
      ["rep-4 d3", 456, 0, 576],
    ]);
  });

  /**
   * ★★ AND THE OBSTRUCTION IS REALISED, not hypothetical.
   *
   * An edge lying ON a mirror line is fixed by that reflection while its two
   * cells are swapped by it. Any law that names a side there contradicts itself.
   * Measured: those edges exist in quantity, their charge pairs are always
   * {x, φx} — which is forced, since one cell is the other's image — and
   *
   *   > **{σ₂, σ₃} occurs among them**, so the rejected law is refuted by the
   *   > figure rather than by the group theory, while
   *   > **no such edge is ever an H-wall**, because h(x) = h(φx) always.
   *
   * That second line is why the shipped law is not merely equivariant but
   * *never asked a question it cannot answer*.
   */
  it("mirror-line edges swap their cells; {σ₂,σ₃} is among them, an H-wall never is [PROVEN]", () => {
    const c = rep4(3);
    const f = fieldOf(c);
    const edges = edgesOf(c.table);
    const pairs = new Map<string, number>();
    let swapped = 0;
    let wallsOnMirrors = 0;
    for (const g of HEX_ISOMETRIES) {
      if (!g.flip) continue;
      const vp = vertexMap(c.table, g);
      const cp = indexMap(c.hex, g);
      for (const [k, cells] of edges) {
        if (cells.length !== 2) continue;
        const [a, b] = k.split(":").map(Number);
        // fixed as a SET by g, and the two cells exchanged by it
        if (edgeKey(vp[a], vp[b]) !== k) continue;
        if (cp[cells[0]] !== cells[1] || cp[cells[1]] !== cells[0]) continue;
        swapped++;
        const x = c.charges[cells[0]];
        const y = c.charges[cells[1]];
        expect([g.name, y]).toEqual([g.name, V4_H_WALL.phi(x)]);
        const key = x <= y ? `${x}|${y}` : `${y}|${x}`;
        pairs.set(key, (pairs.get(key) ?? 0) + 1);
        if (f.wallByEdge.has(k)) wallsOnMirrors++;
      }
    }
    expect([swapped, wallsOnMirrors]).toEqual([48, 0]);
    expect([...pairs].sort()).toEqual([
      ["0|0", 6],
      ["1|2", 24],
      ["3|3", 18],
    ]);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("L1 — the edge is owned once", () => {
  /**
   * ONE CURVE OBJECT PER EDGE, referenced by both cells — asserted by `===` and
   * not by comparing numbers, because two computations that agree today is the
   * failure mode L1 names.
   */
  it("both cells reference the same wall and the same control points [PROVEN]", () => {
    const rows: [string, number, number, number][] = [];
    for (const c of CANVASES()) {
      const f = fieldOf(c);
      const refs = new Map<Wall, { cell: number; step: Step }[]>();
      f.outlines.forEach((steps, cell) => {
        for (const s of steps) {
          if (s.kind !== "curve") continue;
          const l = refs.get(s.wall);
          if (l === undefined) refs.set(s.wall, [{ cell, step: s }]);
          else l.push({ cell, step: s });
        }
      });
      let bad = 0;
      for (const w of f.walls) {
        const seen = refs.get(w);
        if (seen === undefined || seen.length !== 2) {
          bad++;
          continue;
        }
        const cells = seen.map((r) => r.cell).sort((x, y) => x - y);
        const want = [w.into, w.from].sort((x, y) => x - y);
        if (cells[0] !== want[0] || cells[1] !== want[1]) bad++;
        // the two sides walk the edge in opposite directions, so the SAME two
        // objects appear in swapped order and nothing is recomputed.
        const [u, v] = seen;
        const us = u.step as Extract<Step, { kind: "curve" }>;
        const vs = v.step as Extract<Step, { kind: "curve" }>;
        if (us.c1 !== vs.c2 || us.c2 !== vs.c1) bad++;
        if (us.c1 !== w.cp[0] && us.c1 !== w.cp[1]) bad++;
      }
      rows.push([c.name, f.walls.length, refs.size, bad]);
    }
    expect(rows).toEqual([
      ["rep-4 d1", 12, 12, 0],
      ["rep-4 d2", 60, 60, 0],
      ["rep-4 d3", 264, 264, 0],
      ["rep-9 d1", 54, 54, 0],
      ["rep-9 d2", 648, 648, 0],
    ]);
  });

  /**
   * ★ GUARD-FIRE: the per-cell reading — `vertices.explode`'s lesson, one level
   * up. Each cell computes its own curve from its own third vertex, which is
   * what a per-triangle implementation gets for free and what sharing forbids.
   * Every seam then carries two different curves.
   */
  it("guard-fire: per-cell curves disagree on every seam [PROVEN]", () => {
    const c = rep4(2);
    const honest = fieldOf(c);
    const mutant = fieldOf(c, DIAL, "per-cell");
    const disagreeing = (f: CurvatureField) => {
      let n = 0;
      for (const w of f.walls) {
        const sides: Lat[][] = [];
        for (const cell of [w.into, w.from]) {
          for (const s of f.outlines[cell]) {
            if (s.kind === "curve" && s.wall === w) sides.push([s.c1, s.c2]);
          }
        }
        if (sides.length !== 2) continue;
        const key = (v: Lat[]) =>
          [...v].sort((a, b) => a[0] - b[0] || a[1] - b[1]).join("|");
        if (key(sides[0]) !== key(sides[1])) n++;
      }
      return n;
    };
    expect([honest.walls.length, disagreeing(honest), disagreeing(mutant)]).toEqual([
      60, 0, 60,
    ]);
  });

  /**
   * ★★ THE PARTITION GATE, ON CURVES — `docs/warp-findings.md` Q4's gate,
   * restated for Béziers and computed EXACTLY.
   *
   * Green's theorem: `2A = ∮ (x dy − y dx)`, and for a cubic with integer
   * control points the integrand is a degree-5 polynomial with integer
   * coefficients, so `60·∫` is an integer and the whole gate is exact — no
   * tolerance, no sampling, no float.
   *
   * The claim it decides is the one L1 is *for*: a wall is traversed p→q by one
   * cell and q→p by the other, over the SAME control points, so the two line
   * integrals are exact negatives and cancel. The curved cells therefore still
   * sum to the straight hexagon's area — the same partition, redistributed. And
   * no cell flips: every signed area keeps the sign it had.
   *
   * GUARD-FIRE, and it is the same shape as Q4's 260-against-256: run the gate
   * on the per-cell mutant, where the two sides are two different curves, and
   * the total moves.
   */
  it("the curved cells still sum to the straight figure's area; per-cell does not [PROVEN]", () => {
    // ∫₀¹ of a cubic step's (x y' − y x'), times 60. Bernstein → power basis,
    // then a convolution; every coefficient is an integer and 60 clears every
    // denominator up to 1/6.
    const seg60 = (
      p0: Lat,
      p1: Lat,
      p2: Lat,
      p3: Lat
    ): number => {
      const power = (a: number, b: number, c: number, d: number) => [
        a,
        3 * (b - a),
        3 * (c - 2 * b + a),
        d - 3 * c + 3 * b - a,
      ];
      const X = power(p0[0], p1[0], p2[0], p3[0]);
      const Y = power(p0[1], p1[1], p2[1], p3[1]);
      const dX = [X[1], 2 * X[2], 3 * X[3]];
      const dY = [Y[1], 2 * Y[2], 3 * Y[3]];
      const conv = (f: number[], g: number[]) => {
        const out = new Array<number>(f.length + g.length - 1).fill(0);
        f.forEach((u, i) => g.forEach((v, j) => (out[i + j] += u * v)));
        return out;
      };
      const a = conv(X, dY);
      const b = conv(Y, dX);
      let acc = 0;
      for (let k = 0; k < a.length; k++) acc += ((a[k] ?? 0) - (b[k] ?? 0)) * (60 / (k + 1));
      return acc;
    };
    /** The same, for a straight step: 60·(x_p·y_q − x_q·y_p). */
    const line60 = (p: Lat, q: Lat) => 60 * (p[0] * q[1] - q[0] * p[1]);

    const gate = (f: CurvatureField) =>
      f.outlines.map((steps, cell) => {
        let acc = 0;
        let from = f.refined.vertices[f.table.cells[cell][0]];
        for (const s of steps) {
          acc +=
            s.kind === "line"
              ? line60(from, s.to)
              : seg60(from, s.c1, s.c2, s.to);
          from = s.to;
        }
        return acc;
      });
    /** The straight figure, through the same integral — the oracle. */
    const straight = (f: CurvatureField) =>
      f.table.cells.map((tri) => {
        const v = tri.map((i) => f.refined.vertices[i]);
        return line60(v[0], v[1]) + line60(v[1], v[2]) + line60(v[2], v[0]);
      });

    const rows: [string, number, number, number, number][] = [];
    for (const c of [rep4(2), rep9(1)]) {
      const f = fieldOf(c);
      const flat = straight(f);
      const curved = gate(f);
      const total = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
      const flipped = curved.filter(
        (a, i) => a === 0 || a > 0 !== flat[i] > 0
      ).length;
      const mutant = gate(fieldOf(c, DIAL, "per-cell"));
      rows.push([
        c.name,
        total(curved) - total(flat),
        flipped,
        // every cell's area really did MOVE — the gate is not passing because
        // nothing happened
        curved.filter((a, i) => a !== flat[i]).length,
        total(mutant) - total(flat),
      ]);
    }
    expect(rows).toEqual([
      ["rep-4 d2", 0, 0, 72, -41990400],
      ["rep-9 d1", 0, 0, 54, -37791360],
    ]);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("L3 — identity at zero", () => {
  /**
   * NO FIELD AT ALL AT FLOW 0 — structural, not a field of straight curves that
   * agrees with the polygons. The board's branch is on `curve === null`, so the
   * zero dial takes the same path it took before this increment existed, exactly
   * as `layers.strata` returning `null` keeps the flat paint path.
   */
  it("flow 0 builds nothing, and one 144th builds something [PROVEN]", () => {
    for (const c of CANVASES()) {
      expect([c.name, buildCurvature(c.table, c.charges, c.law, 0)]).toEqual([
        c.name,
        null,
      ]);
      const one = buildCurvature(c.table, c.charges, c.law, 1);
      expect([c.name, one === null]).toEqual([c.name, false]);
      expect([c.name, one?.walls.length ?? 0]).toEqual([
        c.name,
        fieldOf(c).walls.length,
      ]);
    }
  });

  it("the dial is an integer in 0…48 and the ceiling is enforced", () => {
    const c = rep4(1);
    expect(() => buildCurvature(c.table, c.charges, c.law, MAX_FLOW + 1)).toThrow(
      /dial/
    );
    expect(() => buildCurvature(c.table, c.charges, c.law, -1)).toThrow(/dial/);
    expect(() => buildCurvature(c.table, c.charges, c.law, 1.5)).toThrow(/dial/);
    expect(() =>
      buildCurvature(c.table, c.charges.slice(1), c.law, 1)
    ).toThrow(/charges/);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("exactness — the ring is the lattice, and the float is one call", () => {
  /**
   * EVERY EMITTED COORDINATE IS AN INTEGER on the ×144 lattice, and it is the
   * integer the FlowAngle handle formula says: `144·P + k·(A − P)`, recomputed
   * here from the table's own vertices rather than read back from the module.
   */
  it("control points are exact integers, and are the handle formula [PROVEN]", () => {
    for (const c of CANVASES()) {
      for (const flow of [1, 12, DIAL, MAX_FLOW]) {
        const f = fieldOf(c, flow);
        for (const w of f.walls) {
          const P = c.table.vertices[w.p];
          const Q = c.table.vertices[w.q];
          const A = c.table.vertices[w.apex];
          expect(w.cp[0]).toEqual([
            REFINE * P[0] + flow * (A[0] - P[0]),
            REFINE * P[1] + flow * (A[1] - P[1]),
          ]);
          expect(w.cp[1]).toEqual([
            REFINE * Q[0] + flow * (A[0] - Q[0]),
            REFINE * Q[1] + flow * (A[1] - Q[1]),
          ]);
          for (const v of [...w.cp[0], ...w.cp[1]]) {
            expect(Number.isSafeInteger(v)).toBe(true);
          }
        }
        // the anchors come from `vertices.refineTable` — resolution in the
        // scale, not in the number type.
        for (let i = 0; i < c.table.vertices.length; i++) {
          expect(f.refined.vertices[i]).toEqual([
            REFINE * c.table.vertices[i][0],
            REFINE * c.table.vertices[i][1],
          ]);
        }
        expect(f.refined.cells).toBe(c.table.cells);
      }
    }
  });

  /**
   * ★ THE CEILING IS A MEASUREMENT, and this is the arithmetic that ties it to
   * `docs/warp-findings.md` Q3.
   *
   * The cubic's midpoint is `8B = P + 3C₁ + 3C₂ + Q`, so `8(B − M) = 3k(2A − P
   * − Q) = 6k(A − mid)` — an exact integer identity, checked on every wall. The
   * sagitta is therefore `(3/4)·(k/144)` of the median, and at k = 48 that is
   * **exactly ¼ of a cell height**, which is Q3's measured-safe value (0
   * mismatches at every coarse:fine ratio), against ½ where it measured 56–112.
   *
   * `3·MAX_FLOW === REFINE` is that statement with the fractions cleared.
   */
  it("the midpoint identity, and the sagitta at the ceiling is exactly ¼ [PROVEN]", () => {
    expect(3 * MAX_FLOW).toBe(REFINE);
    for (const c of [rep4(2), rep9(1)]) {
      for (const flow of [1, DIAL, MAX_FLOW]) {
        const f = fieldOf(c, flow);
        for (const w of f.walls) {
          const P = c.table.vertices[w.p];
          const Q = c.table.vertices[w.q];
          const A = c.table.vertices[w.apex];
          const Pr = f.refined.vertices[w.p];
          const Qr = f.refined.vertices[w.q];
          for (const d of [0, 1]) {
            const eightB = Pr[d] + 3 * w.cp[0][d] + 3 * w.cp[1][d] + Qr[d];
            const eightM = 4 * (Pr[d] + Qr[d]);
            expect(eightB - eightM).toBe(3 * flow * (2 * A[d] - P[d] - Q[d]));
          }
        }
      }
    }
  });

  /**
   * CONTAINMENT, EXACT — every control point lies in the cell the wall bows
   * into, so the curve lies in the union of the two cells it separates and no
   * wall reaches a cell that is not its own.
   *
   * GUARD-FIRE: `controlPoints` past the apex (flow > 144, i.e. beyond the
   * ceiling by a factor of three) leaves the triangle. The containment claim has
   * a false side and the module's range check is what keeps it out of reach.
   */
  it("no control point leaves the cell it bows into; past the apex it does [PROVEN]", () => {
    for (const c of CANVASES()) {
      for (const flow of [1, 12, DIAL, MAX_FLOW]) {
        expect([c.name, flow, wallsContained(fieldOf(c, flow))]).toEqual([
          c.name,
          flow,
          true,
        ]);
      }
    }
    // the guard-fire, on the primitive the ceiling is a policy over
    const c = rep4(2);
    const f = fieldOf(c);
    const w = f.walls[0];
    const tri = tableTriangle(f.refined, w.into);
    const escape = controlPoints(
      c.table.vertices[w.p],
      c.table.vertices[w.q],
      c.table.vertices[w.apex],
      2 * REFINE
    );
    expect([
      insideTriangle(w.cp[0], tri[0], tri[1], tri[2]),
      insideTriangle(escape[0], tri[0], tri[1], tri[2]),
    ]).toEqual([true, false]);
    // and the orientation primitive is not vacuous
    expect(area2([0, 0], [1, 0], [0, 1])).toBe(1);
  });

  /**
   * NO FLOAT AND NO `Math.` ANYWHERE IN THE MODULE — read off its own source,
   * the way `warp.ts`'s float claim was made checkable rather than asserted.
   *
   * Comments, string literals and import paths are stripped first (they carry
   * slashes and talk about arithmetic); what is left is the code, and a single
   * `/` in it would be a division and therefore a rational this module has no
   * business holding. The resolution lives in the ×144 scale instead.
   */
  it("the module's own source carries no division and no Math [PROVEN]", () => {
    const code = readFileSync(
      new URL("../src/lib/curvature.ts", import.meta.url),
      "utf8"
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "")
      .replace(/"[^"]*"/g, '""')
      .replace(/`[^`]*`/g, "``");
    expect(/\bMath\./.test(code)).toBe(false);
    expect(code.includes("/")).toBe(false);
    expect(code.includes("%")).toBe(true); // the role walk, which is not division
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("the display boundary", () => {
  const toPixel =
    (unit: number, cx: number, cy: number) =>
    (p: Lat): readonly [number, number] =>
      latticeToPixel(p, unit / REFINE, cx, cy);

  it("a path per cell, one command per side, closed [PROVEN]", () => {
    const c = rep4(2);
    const f = fieldOf(c);
    const paths = curvePaths(f, toPixel(32, 0, 0));
    expect(paths.length).toBe(c.table.cells.length);
    let curves = 0;
    paths.forEach((d, i) => {
      expect(d.startsWith("M")).toBe(true);
      expect(d.endsWith("Z")).toBe(true);
      const cmds = d.slice(1, -1).match(/[LC]/g) ?? [];
      expect([i, cmds.length]).toEqual([i, 3]);
      curves += cmds.filter((x) => x === "C").length;
    });
    // every wall is drawn twice, once from each side — which is the seam, seen
    // in the emitted strings rather than in the objects.
    expect(curves).toBe(2 * f.walls.length);
  });

  /**
   * THE SEAM, IN THE BYTES. Both cells' `d` strings carry the same two control
   * points, in opposite order — so the two drawn edges are the same curve and
   * not two curves that happen to agree to two decimals.
   */
  it("the two sides of a seam emit the same control points [PROVEN]", () => {
    const c = rep4(2);
    const f = fieldOf(c);
    const px = toPixel(32, 0, 0);
    const point = (p: Lat) => {
      const q = px(p);
      return `${fmtUnit(q[0])},${fmtUnit(q[1])}`;
    };
    let bad = 0;
    for (const w of f.walls) {
      const a = cellPath(f, w.into, px);
      const b = cellPath(f, w.from, px);
      const c1 = point(w.cp[0]);
      const c2 = point(w.cp[1]);
      if (!(a.includes(c1) && a.includes(c2) && b.includes(c1) && b.includes(c2))) {
        bad++;
      }
    }
    expect([f.walls.length, bad]).toEqual([60, 0]);
  });

  /**
   * FLOAT ORACLE — decides nothing. The ×144 refinement has to land the curve's
   * anchors exactly where `buildHexagon` put the polygon's corners, or the
   * curved plate would sit a fraction of a pixel off the straight one it
   * replaces. Cross-checked against `hexagon.latticeToPixel` at the hexagon's
   * own unit.
   */
  it("FLOAT ORACLE: the refined anchors land on the shipped pixels", () => {
    const depth = 2;
    const hex = buildHexagon(depth);
    const c = rep4(depth);
    const f = fieldOf(c);
    const unit = hex.radius / hex.scale;
    const px = toPixel(unit, hex.centre[0], hex.centre[1]);
    let worst = 0;
    for (let i = 0; i < hex.cells.length; i++) {
      const tri = c.table.cells[i];
      for (let r = 0; r < 3; r++) {
        const got = px(f.refined.vertices[tri[r]]);
        const want = hex.cells[i].verts[r];
        worst = Math.max(worst, Math.abs(got[0] - want[0]), Math.abs(got[1] - want[1]));
      }
    }
    expect(worst).toBeLessThan(1e-9);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("L2 — the module boundary, read off the import graph", () => {
  /**
   * "NO WARPED COORDINATE REACHES A MASK, PLATE, BRUSH OR CONTAINMENT DECISION"
   * is a property of the import graph, so it is decided as one rather than by
   * review. The curvature module may be named by the board and the page — the
   * display — and by nothing else in `src/`.
   */
  const files = (dir: string): string[] => {
    const out: string[] = [];
    for (const e of readdirSync(new URL(`../${dir}`, import.meta.url), {
      withFileTypes: true,
    })) {
      if (e.isDirectory()) out.push(...files(`${dir}/${e.name}`));
      else if (/\.tsx?$/.test(e.name)) out.push(`${dir}/${e.name}`);
    }
    return out;
  };

  it("only the display names it [PROVEN]", () => {
    const importers = files("src")
      .filter((p) => !p.endsWith("/curvature.ts"))
      .filter((p) =>
        /from\s+"(@\/lib\/curvature|\.\/curvature|\.\.\/lib\/curvature)"/.test(
          readFileSync(new URL(`../${p}`, import.meta.url), "utf8")
        )
      )
      .sort();
    // TWO FILES, and the second arrived with increment 3. The board does not
    // import it: it declares its own `CurveView` — `d` strings and nothing else
    // — exactly as it declares `ReliefView` rather than importing `relief.ts`.
    // So the curvature model still reaches the DOM through a single page-level
    // memo, and `morph.ts` is on the display side of the boundary rather than
    // through it: it names `curvature` for the dial's denominator and ceiling
    // and holds no coordinate at all. `test/morph.test.ts` runs the mirror of
    // this test on `morph.ts`'s own importers.
    expect(importers).toEqual(["src/app/draw/page.tsx", "src/lib/morph.ts"]);
  });

  it("and it names nothing that decides ownership [PROVEN]", () => {
    const src = readFileSync(
      new URL("../src/lib/curvature.ts", import.meta.url),
      "utf8"
    );
    const imports = [...src.matchAll(/from\s+"\.\/([\w-]+)"/g)].map((m) => m[1]).sort();
    expect(imports).toEqual(["figure", "hexagon", "vertices", "view"]);
    for (const forbidden of [
      "plate",
      "brush",
      "orbit",
      "arms",
      "focus",
      "strokes",
      "lattice",
      "emit",
      "artfile",
      "layers",
      "frames",
      "timeline",
      "relief",
    ]) {
      expect([forbidden, src.includes(`"./${forbidden}"`)]).toEqual([
        forbidden,
        false,
      ]);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("what the charge draws, measured", () => {
  /**
   * THE FIELD, IN NUMBERS. Walls as a fraction of the interior edges, the pair
   * histogram, the cells left flat, and the sinks — cells every one of whose
   * edges bows inward.
   *
   * Recorded because the feature's claim is that the drawing IS the charge: if
   * these ever move, the charge field has moved, and no other test in this file
   * would say so.
   */
  it("the wall census, rep-4 and rep-9 [MEASURED]", () => {
    const rows = CANVASES().map((c) => {
      const f = fieldOf(c);
      return [c.name, f.census.interior, f.census.walls, f.census.flat, f.census.sinks];
    });
    expect(rows).toEqual([
      ["rep-4 d1", 30, 12, 6, 0],
      ["rep-4 d2", 132, 60, 24, 0],
      ["rep-4 d3", 552, 264, 72, 0],
      ["rep-9 d1", 72, 54, 0, 0],
      ["rep-9 d2", 702, 648, 0, 18],
    ]);
  });

  it("the pair histogram at rep-4 depth 3 [MEASURED]", () => {
    const c = rep4(3);
    const f = fieldOf(c);
    expect([...f.census.pairs].sort()).toEqual([
      ["0|0", 18],
      ["0|1", 66],
      ["0|2", 66],
      ["0|3", 96],
      ["1|1", 24],
      ["1|2", 96],
      ["1|3", 66],
      ["2|2", 24],
      ["2|3", 66],
      ["3|3", 30],
    ]);
    // the walls are exactly the four incoherent buckets — 4 × 66 — and the two
    // tiers the quotient drops are `0|3` (96) and `1|2` (96), the second of
    // which is the one no equivariant side exists for.
    expect(f.census.walls).toBe(4 * 66);
  });

  /**
   * `curvatureFor` builds its own table — the convenience the page does not use,
   * kept honest so nothing has to build a table by hand to get a field.
   */
  it("the spec entry point agrees with the borrowed-table one", () => {
    const c = rep4(2);
    const built = curvatureFor(c.spec, c.charges, c.law, DIAL);
    expect(built.field?.walls.length).toBe(fieldOf(c).walls.length);
    expect(curvatureFor(c.spec, c.charges, c.law, 0).field).toBe(null);
  });
});
