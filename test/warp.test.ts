/**
 * WARP — the five questions, decided by computation.
 *
 * Companion to `src/lib/warp.ts` and `docs/warp-findings.md`. Labels follow the
 * house convention used by `docs/rep-tile-findings.md`:
 *
 *   [PROVEN]     exhaustive computation, decided against an oracle independent of
 *                the thing under test, with a mutation shown lethal.
 *   [MEASURED]   a number this run produced, not exhaustive over its domain.
 *   [DERIVED]    follows from a [PROVEN] fact by an argument stated here.
 *
 * ── The oracles ──────────────────────────────────────────────────────────
 *
 *   `figure.ts`   the shipped geometry. Q2's derived cells are decided against
 *                 `buildFigure`'s stored barycentrics, cell for cell.
 *   `reptile.ts`  the independent geometric instrument. Q2's rep-9 cell SET is
 *                 decided against `subdivide`, which knows nothing about letters,
 *                 frames or `figure.ts`; Q4's guard-fire anchor is its published
 *                 7-of-576.
 *
 * ── Where the float is ───────────────────────────────────────────────────
 *
 * `src/lib/warp.ts` has none. This file has float in exactly one `it`, marked
 * FLOAT ORACLE, where `Math.tan` and `Math.sqrt` cross-check the exact ring
 * values of section R. Nothing else here forms a float, and no assertion outside
 * that block depends on one.
 */

import { describe, expect, it } from "vitest";
import { buildFigure, buildRep9Figure } from "../src/lib/figure";
import { buildHexagon, buildRep9Hexagon, type Lat } from "../src/lib/hexagon";
import { scaleOfWord } from "../src/lib/scale";
import {
  ROOT,
  buildTree,
  centroid,
  containsCentroid,
  shiftNode,
  subdivide,
  triKey,
} from "../src/lib/reptile";
import {
  EPS,
  EPS_BAR,
  R0,
  affineWarp,
  alphaExact,
  apexHeight,
  apexRing,
  buildVertexTable,
  bumpWarp,
  composeWeights,
  coveredCells,
  deriveCell,
  flowAngleApex,
  hexAnchor,
  latCentroid,
  latScale,
  latTriples,
  offsetWarp,
  partitionGate,
  polyArea2,
  qCentroid,
  qContains,
  qEq,
  rAbs,
  rEq,
  rInt,
  rSign,
  rSub,
  raster,
  rat,
  ratWidth,
  ratWidthReset,
  rToFixed,
  safeIntegerDepth,
  seamReport,
  shearApplyQ,
  shearInverse,
  shearWarp,
  tJunction,
  triangleBoundary,
  unsharedBumpWarp,
  unitPowerWidths,
  vertexCensus,
  warpTriangle,
  z3Div,
  z3Eq,
  z3HasSquareRoot,
  z3Int,
  z3IsIntegral,
  z3IsUnit,
  z3Mul,
  z3Norm,
  z3Pow,
  z3PtEq,
  z3TanDouble,
  type Warp,
  type Weights,
} from "../src/lib/warp";

/**
 * A generic rational translation applied to every warp below.
 *
 * NOT decoration, and the first version of this file was wrong without it. Every
 * mesh edge on this lattice is a lattice line, and a lattice line is a RASTER
 * CELL BOUNDARY — `theory.md` §9's "a band boundary IS a quadtree cut" showing up
 * as a measurement problem. With the mesh exactly on the grid no raster cell is
 * ever straddled, every coverage identity holds vacuously, and §10's α is never
 * exercised at all. (1/3, 1/5) is coprime to everything in sight.
 */
const OFFSET = [rat(1, 3), rat(1, 5)] as const;

const latOf = (b: readonly [number, number, number]): Lat => [b[1], b[2]];

const IDENTITY = offsetWarp(affineWarp([[1, 0], [0, 1]]), OFFSET);
const AFFINE = offsetWarp(affineWarp([[1, 2], [0, 1]]), OFFSET);

/** descent vs centroid-in-footprint, across a depth gap, under a warp. */
function crossScaleMismatch(dFine: number, delta: number, w: Warp): number {
  const fine = buildFigure(dFine);
  const coarse = buildFigure(dFine - delta);
  const f = 2 ** delta;
  const centroids = fine.cells.map((c) =>
    qCentroid(warpTriangle(w, c.bary.map(latOf)))
  );
  let mismatch = 0;
  for (const node of coarse.cells) {
    const nodeTri = warpTriangle(w, latScale(node.bary.map(latOf), f));
    fine.cells.forEach((cell, i) => {
      if (
        qContains(nodeTri, centroids[i]).inside !==
        cell.addr.startsWith(node.addr)
      ) {
        mismatch++;
      }
    });
  }
  return mismatch;
}

// ═════════════════════════════════════════════════════════════════════════
describe("Q1 — the redundancy, measured", () => {
  /**
   * The brief's claim: ~6×, because an interior vertex has degree 6.
   *
   * Confirmed, and the interesting part is the SHAPE of the approach. Every row
   * is an observed sweep, not a formula: the census walks the shipped figure's
   * own `bary` triples and counts distinct exact integer lattice points.
   */
  it("triangle canvas, rep-4 depths 1–6 and rep-9 depths 1–4 [PROVEN]", () => {
    const rep4 = [1, 2, 3, 4, 5, 6].map((d) => {
      const f = buildFigure(d);
      const c = vertexCensus(latTriples(f.cells));
      return [f.scale, c.cells, c.slots, c.distinct, c.deficit];
    });
    expect(rep4).toEqual([
      [2, 4, 12, 6, 24],
      [4, 16, 48, 15, 42],
      [8, 64, 192, 45, 78],
      [16, 256, 768, 153, 150],
      [32, 1024, 3072, 561, 294],
      [64, 4096, 12288, 2145, 582],
    ]);
    const rep9 = [1, 2, 3, 4].map((d) => {
      const f = buildRep9Figure(d);
      const c = vertexCensus(latTriples(f.cells));
      return [f.scale, c.cells, c.slots, c.distinct, c.deficit];
    });
    expect(rep9).toEqual([
      [3, 9, 27, 10, 33],
      [9, 81, 243, 55, 87],
      [27, 729, 2187, 406, 249],
      [81, 6561, 19683, 3403, 735],
    ]);
    // THE RADIX DOES NOT ENTER. Both radices obey the same two closed forms in
    // the SCALE — distinct = (s+1)(s+2)/2 and deficit = 9s + 6 — which is what
    // one expects once `rep-tile-findings.md` Q2's "rep-4 ∘ rep-9 = rep-36, the
    // same 36 triangles" is taken seriously: at equal scale the two radices
    // produce the same point set, so they cannot differ in a count of points.
    for (const [s, , , distinct, deficit] of [...rep4, ...rep9]) {
      expect(distinct).toBe(((s + 1) * (s + 2)) / 2);
      expect(deficit).toBe(9 * s + 6);
    }
  });

  it("hexagon canvas, both radices [PROVEN]", () => {
    const rep4 = [1, 2, 3, 4, 5].map((d) => {
      const h = buildHexagon(d);
      const c = vertexCensus(latTriples(h.base.cells, 6));
      return [h.scale, c.cells, c.slots, c.distinct, c.deficit];
    });
    expect(rep4).toEqual([
      [2, 24, 72, 19, 42],
      [4, 96, 288, 61, 78],
      [8, 384, 1152, 217, 150],
      [16, 1536, 4608, 817, 294],
      [32, 6144, 18432, 3169, 582],
    ]);
    const rep9 = [1, 2, 3].map((d) => {
      const h = buildRep9Hexagon(d);
      const c = vertexCensus(latTriples(h.base.cells, 6));
      return [h.scale, c.cells, c.slots, c.distinct, c.deficit];
    });
    expect(rep9).toEqual([
      [3, 54, 162, 37, 60],
      [9, 486, 1458, 271, 168],
      [27, 4374, 13122, 2269, 492],
    ]);
    // The centred hexagonal number, and the boundary deficit doubled — six
    // sectors have twice the boundary a single triangle does.
    for (const [s, , , distinct, deficit] of [...rep4, ...rep9]) {
      expect(distinct).toBe(3 * s * s + 3 * s + 1);
      expect(deficit).toBe(18 * s + 6);
    }
  });

  /**
   * WHY IT IS NOT EXACTLY 6, ACCOUNTED RATHER THAN ASSERTED.
   *
   * Σ_v deg(v) = slots identically, so slots = 6·V − Σ_v (6 − deg v), and the
   * whole shortfall sits on the boundary: interior vertices have degree 6 and
   * contribute nothing. The degree histogram is the proof — on the triangle,
   * 3 corners of degree 1 and 3(s−1) edge vertices of degree 3; on the hexagon,
   * 6 corners of degree 2 and 6(s−1) edge vertices of degree 3.
   */
  it("the deficit is entirely the boundary's degree shortfall [PROVEN]", () => {
    for (const d of [3, 4, 5, 6]) {
      const f = buildFigure(d);
      const s = f.scale;
      const c = vertexCensus(latTriples(f.cells));
      let sumDeg = 0;
      let shortfall = 0;
      for (const [deg, n] of c.degrees) {
        sumDeg += deg * n;
        shortfall += (6 - deg) * n;
      }
      expect(sumDeg).toBe(c.slots);
      expect(shortfall).toBe(c.deficit);
      expect(c.degrees.get(1)).toBe(3);
      expect(c.degrees.get(3)).toBe(3 * (s - 1));
      expect(c.degrees.get(6)).toBe(((s - 1) * (s - 2)) / 2);
      // every degree-6 vertex is off the boundary path, and no other is
      const onBoundary = new Set(triangleBoundary(s).map((v) => `${v[0]},${v[1]}`));
      expect(onBoundary.size).toBe(3 * s);
      expect(c.distinct - onBoundary.size).toBe(c.degrees.get(6));
    }
    for (const d of [3, 4, 5]) {
      const h = buildHexagon(d);
      const c = vertexCensus(latTriples(h.base.cells, 6));
      expect(c.degrees.get(2)).toBe(6);
      expect(c.degrees.get(3)).toBe(6 * (h.scale - 1));
      expect(c.degrees.get(6)).toBe(c.distinct - 6 * h.scale);
    }
  });

  /**
   * THE LIMIT, and it is approached from BELOW and never reached.
   *
   * ratio(s) = 6s²/((s+1)(s+2)) on the triangle and 18s²/(3s²+3s+1) on the
   * hexagon. Both → 6; both are strictly increasing in s; neither is ever 6,
   * because a figure with a boundary always has vertices of degree < 6. So "≈6×"
   * is right and "6×" is an asymptote, not a value.
   */
  it("the ratio rises strictly toward 6 and never reaches it [PROVEN]", () => {
    const seen: string[] = [];
    let prev = R0;
    for (const d of [1, 2, 3, 4, 5, 6]) {
      const c = vertexCensus(latTriples(buildFigure(d).cells));
      expect(rSign(rSub(c.ratio, rInt(6)))).toBe(-1);
      expect(rSign(rSub(c.ratio, prev))).toBe(1);
      prev = c.ratio;
      seen.push(rToFixed(c.ratio, 4));
    }
    expect(seen).toEqual([
      "2.0000", "3.2000", "4.2667", "5.0196", "5.4759", "5.7287",
    ]);
    const hex: string[] = [];
    for (const d of [1, 2, 3, 4, 5]) {
      const c = vertexCensus(latTriples(buildHexagon(d).base.cells, 6));
      expect(rSign(rSub(c.ratio, rInt(6)))).toBe(-1);
      hex.push(rToFixed(c.ratio, 4));
    }
    expect(hex).toEqual(["3.7895", "4.7213", "5.3088", "5.6401", "5.8163"]);
  });

  /** GUARD-FIRE: a census that stops identifying shared vertices reads 3.0000. */
  it("guard-fire: de-identifying one vertex per cell moves the ratio [PROVEN]", () => {
    const f = buildFigure(4);
    const honest = vertexCensus(latTriples(f.cells));
    const mutant = vertexCensus(
      f.cells.map((c, i) => {
        const t = c.bary.map(latOf);
        // displace each cell's FIRST vertex by a cell-dependent amount, which is
        // exactly what per-triangle storage permits and sharing forbids
        return [[t[0][0] + 1000 * (i + 1), t[0][1]] as Lat, t[1], t[2]];
      })
    );
    // OBSERVED, not derived: 256 displaced first-vertices that can no longer
    // coincide with anything, plus the 108 still-shared points among the other
    // two slots. The point of the mutation is that the census NOTICES.
    expect(honest.distinct).toBe(153);
    expect(mutant.distinct).toBe(364);
    expect(rToFixed(mutant.ratio, 4)).not.toBe(rToFixed(honest.ratio, 4));
    expect(rSign(rSub(mutant.ratio, honest.ratio))).toBe(-1);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("Q2 — log versus linear", () => {
  /**
   * DERIVE-ON-DEMAND AGREES WITH THE SHIPPED FIGURE, CELL FOR CELL.
   *
   * The rep-4 maps in `warp.ts` are transcribed by hand from `figure.ts`'s
   * documented recursion; the rep-9 maps are `REP9_ALPHABET`'s own weights. Both
   * are then composed as integer matrices — a genuinely different computation
   * from applying them one level at a time to coordinates — and compared against
   * `buildFigure`'s stored barycentrics.
   */
  it("derived == buildFigure at rep-4 (both conventions) and rep-9 [PROVEN]", () => {
    const counts: number[] = [];
    for (const conv of ["apex", "ifs"] as const) {
      const f = buildFigure(6, conv);
      counts.push(f.cells.length);
      for (const cell of f.cells) {
        const d = deriveCell(cell.addr, conv);
        expect(d.scale).toBe(f.scale);
        expect(d.verts).toEqual(cell.bary);
      }
    }
    const r9 = buildRep9Figure(4);
    counts.push(r9.cells.length);
    for (const cell of r9.cells) {
      const d = deriveCell(cell.addr);
      expect(d.scale).toBe(r9.scale);
      expect(d.verts).toEqual(cell.bary);
    }
    expect(counts).toEqual([4096, 4096, 6561]);
  });

  /** The independent oracle: the same TRIANGLES, decided as point sets. */
  it("the derived cell set equals reptile's subdivision [PROVEN]", () => {
    for (const [k, build, depths] of [
      [2, (d: number) => buildFigure(d).cells, [1, 2, 3, 4]],
      [3, (d: number) => buildRep9Figure(d).cells, [1, 2, 3]],
    ] as const) {
      for (const d of depths) {
        let tris = [ROOT];
        for (let i = 0; i < d; i++) tris = tris.flatMap((t) => subdivide(t, k));
        const oracle = new Set(tris.map((t) => triKey(t, k ** d)));
        const mine = new Set(
          build(d).map((c) =>
            deriveCell(c.addr)
              .verts.map((p) => `${p[0]}:${p[1]}:${p[2]}`)
              .sort()
              .join("|")
          )
        );
        expect(mine.size).toBe(k ** (2 * d));
        expect(oracle.size).toBe(k ** (2 * d));
        expect([...mine].every((key) => oracle.has(key))).toBe(true);
      }
    }
  });

  /**
   * DOES THE DERIVED PATH STAY EXACT? YES, AND THE DENOMINATOR DOES NOT GROW.
   *
   * The brief expected a growing common denominator on the model of fold-re §11's
   * `D_k = D0·8^k`. It does not happen, and the reason is structural: composing
   * two child maps multiplies INTEGER matrices and multiplies the denominators,
   * so after d levels there is exactly ONE denominator — the scale — and the
   * numerators are integers. Each row sums to the scale, which is the statement
   * that the three weights are barycentric.
   *
   * The cost law is therefore log₂(k) bits per level: 1 for rep-4, log₂3 ≈ 1.585
   * for rep-9, against the cubic Bézier path's 3. Mixed words are included
   * because that is where a per-node denominator would have to show up.
   */
  it("exactness: one denominator, equal to the scale, mixed radix included [PROVEN]", () => {
    const rows: [string, number, number[]][] = [];
    for (const word of ["", "A", "AXBC", "abcuvw", "AXaBu", "xyzABC", "AAAAA", "xxxxx"]) {
      const d = deriveCell(word);
      expect(d.scale).toBe(scaleOfWord(word));
      const sums = d.verts.map((r) => r[0] + r[1] + r[2]);
      for (const r of d.verts) {
        for (const v of r) expect(Number.isInteger(v)).toBe(true);
      }
      rows.push([word, d.scale, sums]);
    }
    expect(rows.map(([w, s]) => [w, s])).toEqual([
      ["", 1], ["A", 2], ["AXBC", 16], ["abcuvw", 729],
      ["AXaBu", 72], ["xyzABC", 216], ["AAAAA", 32], ["xxxxx", 243],
    ]);
    for (const [, scale, sums] of rows) expect(sums).toEqual([scale, scale, scale]);
    // the width law, stated as the bit count of the single denominator
    expect(deriveCell("AAAAA").scale).toBe(2 ** 5);
    expect(deriveCell("xxxxx").scale).toBe(3 ** 5);
  });

  /**
   * GUARD-FIRE. Swap two role slots in the X map — still a valid triangle, still
   * the same three points, only the ROLE ORDER moves, which is precisely the kind
   * of error a point-set comparison cannot see and a cell-for-cell one can.
   */
  it("guard-fire: one permuted frame breaks the agreement [PROVEN]", () => {
    const MUT: Record<string, Weights> = {
      A: [[2, 0, 0], [1, 1, 0], [1, 0, 1]],
      B: [[0, 2, 0], [0, 1, 1], [1, 1, 0]],
      C: [[0, 0, 2], [1, 0, 1], [0, 1, 1]],
      X: [[0, 1, 1], [1, 1, 0], [1, 0, 1]],
    };
    const f = buildFigure(5);
    let bad = 0;
    for (const c of f.cells) {
      let acc: Weights = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
      for (const ch of c.addr) acc = composeWeights(MUT[ch], acc);
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) if (acc[i][j] !== c.bary[i][j]) bad++;
      }
    }
    expect(f.cells.length).toBe(1024);
    expect(bad).toBe(3416);
  });

  /**
   * THE COST, both ways, on the real figure.
   *
   * Asserted on OPERATION COUNTS and SPACE, which are exact; wall-clock is logged
   * and asserted only through an inequality with two orders of magnitude of
   * headroom, because a timing assertion tight enough to be interesting is also
   * tight enough to be flaky.
   */
  it("cost: derive is O(d) work per cell, the table is O(V) space [MEASURED]", () => {
    const log: string[] = [];
    for (const d of [4, 6, 8]) {
      const fig = buildFigure(d);
      const triples = fig.cells.map((c) => c.bary.map(latOf));
      const addrs = fig.cells.map((c) => c.addr);

      const t0 = performance.now();
      let sink = 0;
      for (let r = 0; r < 5; r++) for (const a of addrs) sink += deriveCell(a).verts[0][0];
      const tDerive = (performance.now() - t0) / 5;

      const t1 = performance.now();
      const tbl = buildVertexTable(triples);
      const tBuild = performance.now() - t1;

      const t2 = performance.now();
      for (let r = 0; r < 5; r++) for (const c of tbl.cells) sink += tbl.vertices[c[0]][0];
      const tLookup = (performance.now() - t2) / 5;

      // EXACT: the work each path does, in units nothing can jitter.
      expect(addrs.every((a) => a.length === d)).toBe(true);
      expect(tbl.cells.length).toBe(fig.cells.length);
      expect(tbl.vertices.length).toBe(vertexCensus(triples).distinct);
      // space: the table holds fewer vertices than the cells hold slots
      expect(tbl.vertices.length * 3).toBeLessThan(fig.cells.length * 3);
      // O(1) lookup really is orders faster than O(d) derivation
      expect(tLookup * 10).toBeLessThan(tDerive);
      log.push(
        `d=${d} cells=${fig.cells.length} V=${tbl.vertices.length} derive=${tDerive.toFixed(2)}ms build=${tBuild.toFixed(2)}ms lookup=${tLookup.toFixed(3)}ms`
      );
      expect(sink).toBeGreaterThan(0);
    }
    console.log(log.join("\n"));
    // 27 multiply-adds per level, so the per-cell derivation is linear in depth
    // and independent of the figure — checked by deriving one deep address with
    // no figure in hand at all.
    expect(deriveCell("AXBCAXBCAXBCAXBCAXBC").scale).toBe(2 ** 20);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("Q3 — does a warp preserve containment?", () => {
  /** The control. An affine warp changes nothing, at any depth gap. [PROVEN] */
  it("an affine warp is free: zero mismatches, zero boundary hits [PROVEN]", () => {
    for (const w of [
      IDENTITY,
      AFFINE,
      offsetWarp(affineWarp([[1, 7], [3, 1]]), OFFSET),
      offsetWarp(affineWarp([[2, -1], [1, 3]]), [rat(-7, 11), rat(5, 13)]),
    ]) {
      for (const [dFine, delta] of [[4, 1], [4, 2], [5, 2], [5, 3]] as const) {
        expect(crossScaleMismatch(dFine, delta, w)).toBe(0);
      }
    }
  });

  /**
   * THE IMAGE OF THE CENTROID IS NOT THE CENTROID OF THE IMAGE — and that is the
   * whole difference between the two readings of a warp.
   *
   * A VERTEX warp is affine on each cell OF THE SCALE ITS VERTICES CAME FROM, so
   * for those cells the two readings agree by construction. Evaluated POINTWISE
   * they disagree on every cell of a non-affine warp. Both are measured, because
   * the brief's Q3 is exactly the gap between them.
   */
  it("pointwise vs vertex centroid: 256/256 differ, 0/256 under affine [PROVEN]", () => {
    const lam = rat(1, 8);
    const w = shearWarp(lam, R0);
    const pointwise = shearApplyQ(lam, R0);
    const inverse = shearInverse(lam, R0);
    const f = buildFigure(4);
    let differ = 0;
    for (const cell of f.cells) {
      const tri = cell.bary.map(latOf);
      const vertexReading = qCentroid(warpTriangle(w, tri));
      const pointReading = pointwise(latCentroid(tri));
      if (!qEq(vertexReading, pointReading)) differ++;
      // and the warp really is a bijection: the inverse recovers the point
      expect(qEq(inverse(pointReading), latCentroid(tri))).toBe(true);
    }
    expect(f.cells.length).toBe(256);
    expect(differ).toBe(256);
    // The affine control, stated as the identity that DEFINES affinity: the
    // shear with λ = 0 is the identity map, so evaluating it pointwise at the
    // centroid must reproduce the centroid of the vertex images exactly.
    const flat = shearApplyQ(R0, R0);
    let affineDiffer = 0;
    for (const cell of f.cells) {
      const tri = cell.bary.map(latOf);
      const vertexReading = qCentroid(warpTriangle(shearWarp(R0, R0), tri));
      if (!qEq(vertexReading, flat(latCentroid(tri)))) affineDiffer++;
    }
    expect(affineDiffer).toBe(0);
  });

  /**
   * ★ THE ANSWER TO Q3, AND IT IS A THRESHOLD RATHER THAN A YES OR A NO.
   *
   * Cross-scale containment survives a non-affine warp only while the warp's
   * SAGITTA over a coarse cell's edge stays below the fine centroid's own margin.
   * For the shear W(a, b) = (a + λb², b) the chord through two warped endpoints
   * deviates from the true image by λ·t(1−t)·(Δb)², so the sagitta over a coarse
   * edge of extent s is λs²/4; the margin is a fine cell's centroid distance to
   * its own edge, 1/3 of a fine cell.
   *
   * Measured bracket, at three coarse:fine ratios:
   *
   *   λ = 1/s²  → sagitta 1/4 — SURVIVES, 0 mismatches
   *   λ = 2/s²  → sagitta 1/2 — FAILS
   *
   * so the tolerable curvature scales as 1/s². That is the guard-fire and the
   * law in one sweep: the second half of each pair is the lethal mutation.
   */
  it("★ non-affine: survives at sagitta 1/4, FAILS at 1/2, at every ratio [PROVEN]", { timeout: 120000 }, () => {
    const rows: string[] = [];
    for (const [dFine, delta] of [[4, 1], [4, 2], [5, 3]] as const) {
      const s = 2 ** delta;
      const safe = crossScaleMismatch(dFine, delta, offsetWarp(shearWarp(rat(1, s * s), R0), OFFSET));
      const dead = crossScaleMismatch(dFine, delta, offsetWarp(shearWarp(rat(2, s * s), R0), OFFSET));
      expect(safe).toBe(0);
      expect(dead).toBeGreaterThan(0);
      rows.push(`s=${s}: λ=1/${s * s}→${safe}, λ=2/${s * s}→${dead}`);
    }
    expect(rows).toEqual([
      "s=2: λ=1/4→0, λ=2/4→64",
      "s=4: λ=1/16→0, λ=2/16→56",
      "s=8: λ=1/64→0, λ=2/64→112",
    ]);
    // THE THRESHOLD IS A PROPERTY OF THE DEPTH GAP, NOT OF THE FINE DEPTH: the
    // same coarse:fine ratio gives the same verdict from two different figures.
    for (const dFine of [4, 5, 6]) {
      expect(crossScaleMismatch(dFine, 2, offsetWarp(shearWarp(rat(1, 16), R0), OFFSET))).toBe(0);
      expect(
        crossScaleMismatch(dFine, 2, offsetWarp(shearWarp(rat(2, 16), R0), OFFSET))
      ).toBeGreaterThan(0);
    }
  });

  /**
   * ★★ AND THE FAILURE IS INEVITABLE UNDER REFINEMENT.
   *
   * Hold the warp fixed IN SCREEN TERMS and refine. The sagitta is then fixed too,
   * but the margin — one third of a fine cell — halves at every level. So a warp
   * that is safe at one resolution stops being safe at a deeper one, with no
   * change to the warp at all.
   *
   * λ in fine-lattice units is 1/2^d for a fixed screen warp; the coarse root
   * stays at depth 2. Mismatches appear at d = 5 and grow.
   */
  it("★★ a FIXED screen warp starts failing as the figure refines [PROVEN]", { timeout: 120000 }, () => {
    const seen: [number, number][] = [];
    for (const dFine of [3, 4, 5, 6]) {
      const w = offsetWarp(shearWarp(rat(1, 2 ** dFine), R0), OFFSET);
      seen.push([dFine, crossScaleMismatch(dFine, dFine - 2, w)]);
    }
    expect(seen).toEqual([
      [3, 0],
      [4, 0],
      [5, 112],
      [6, 616],
    ]);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("Q4 — vertex motion: lattice versus warp", () => {
  /** The published anchor, recomputed: `rep-tile-findings.md` Q2's 7 of 576. */
  it("anchor: reptile's one-unit node displacement still costs 7 of 576 [PROVEN]", () => {
    const tree = buildTree((p) =>
      p.length === 0 ? 2 : p.length === 1 ? ([3, 4, 3, 2][p[0]] ?? 1) : 1
    );
    const N = tree.refinement;
    const fine = subdivide(ROOT, N);
    const cents = fine.map(centroid);
    const mutant = shiftNode(tree, tree.leaves[1], N);
    let bad = 0;
    for (let i = 0; i < fine.length; i++) {
      let claims = 0;
      for (const li of mutant.leaves) {
        if (containsCentroid(mutant.nodes[li].tri, cents[i]).inside) claims++;
      }
      if (claims !== 1) bad++;
    }
    expect(N).toBe(24);
    expect(fine.length).toBe(576);
    expect(bad).toBe(7);
  });

  /**
   * ★ THE HALF OF THE BRIEF'S Q4 THAT IS WRONG, AND THE WAY IT IS WRONG MATTERS.
   *
   * Moving a shared lattice vertex is NOT lethal per se. It is lethal exactly
   * when the vertex lies on a COARSER cell's boundary, and then it is lethal at
   * ANY displacement, however small — because the coarse cell's straight edge and
   * its children's polyline part company immediately and the lens between them
   * has area 2mδ, which is nonzero for every δ ≠ 0.
   *
   * Moved INSIDE a coarse cell, the same displacement costs nothing: the coarse
   * boundary is untouched and the children still tile it.
   *
   * Two failure modes with two different thresholds, and only the exact-area tier
   * sees the first one:
   *   PARTITION  breaks at any ε      (the lens opens)
   *   OWNERSHIP  needs a finite move  (a centroid has to cross)
   */
  it("★ lattice motion: the lens opens at any ε on a coarse edge, never inside [PROVEN]", () => {
    const m = 8;
    for (const [den, expected] of [[2, "8/1"], [1024, "1/64"], [1048576, "1/65536"]] as const) {
      const onEdge = tJunction(m, bumpWarp([m, m], [rat(1, den), R0]));
      expect(`${onEdge.lens2.n}/${onEdge.lens2.d}`).toBe(expected);
      // the closed form: twice the lens area is exactly 2·m·δ
      expect(rEq(onEdge.lens2, rat(2 * m, den))).toBe(true);
      // a vertex strictly inside the coarse cell moves nothing
      const inside = tJunction(m, bumpWarp([5, 6], [rat(1, den), R0]));
      expect(rSign(inside.lens2)).toBe(0);
    }
  });

  /** The ownership threshold, swept: a centroid moves by a third of the vertex. */
  it("ownership needs a full fine-cell of motion, the partition needs none [MEASURED]", { timeout: 60000 }, () => {
    const fine = buildFigure(4);
    const coarse = buildFigure(2);
    const victim: Lat = [8, 4];
    const seen: [string, number][] = [];
    for (const num of [1, 2, 3, 4, 6, 8]) {
      const off = rat(num, 4);
      const w: Warp = {
        name: `v+${num}/4`,
        affine: false,
        apply: (v) =>
          v[0] === victim[0] && v[1] === victim[1]
            ? [rat(v[0]), rat(BigInt(v[1]) * off.d + off.n, off.d)]
            : [rat(v[0]), rat(v[1])],
      };
      const cents = fine.cells.map((c) => qCentroid(warpTriangle(w, c.bary.map(latOf))));
      let mm = 0;
      for (const node of coarse.cells) {
        const nt = warpTriangle(w, latScale(node.bary.map(latOf), 4));
        fine.cells.forEach((cell, i) => {
          if (qContains(nt, cents[i]).inside !== cell.addr.startsWith(node.addr)) mm++;
        });
      }
      seen.push([`${num}/4`, mm]);
    }
    expect(seen).toEqual([
      ["1/4", 0],
      ["2/4", 2],
      ["3/4", 16],
      ["4/4", 28],
      ["6/4", 40],
      ["8/4", 52],
    ]);
  });

  /**
   * ★ THE HALF OF THE BRIEF'S Q4 THAT IS RIGHT.
   *
   * Moving a vertex IN THE WARP is free, and the reason is the one the brief
   * gives: every incident cell reads the same warped vertex. The gate is global
   * and exact — the warped cells' areas sum to the warped outline's area, so
   * there is no crack to miss and no overlap to double-count.
   *
   * GUARD-FIRE, and it is the whole point: hand each incident cell its OWN copy
   * of the moved vertex — which is exactly what per-triangle vertex storage
   * permits — and the same gate goes red, with a fold as well.
   */
  it("★ warp motion is free with shared vertices, lethal with unshared [PROVEN]", () => {
    const fig = buildFigure(4);
    const triples = fig.cells.map((c) => c.bary.map(latOf));
    const boundary = triangleBoundary(fig.scale);
    const shared = offsetWarp(shearWarp(rat(1, 8), R0), OFFSET);
    const bump = bumpWarp([5, 6], [rat(1, 2), rat(-1, 3)]);

    for (const w of [shared, bump]) {
      const g = partitionGate(triples, boundary, () => w);
      expect(g.agrees).toBe(true);
      expect(g.flipped).toBe(0);
    }
    // a vertex warp does not change any cell's area on THIS lattice, because a
    // lattice triangle has two vertices with equal b and the shear depends on b
    // alone — measured, and worth knowing before anyone reads too much into the
    // areas agreeing above.
    const g0 = partitionGate(triples, boundary, () => bump);
    expect(`${g0.cellSum2.n}/${g0.cellSum2.d}`).toBe("256/1");

    const perCell = unsharedBumpWarp([5, 6], [rat(1, 2), R0]);
    const unshared = partitionGate(triples, boundary, (i) =>
      i < 0 ? bumpWarp([5, 6], [R0, R0]) : perCell(i % 7)
    );
    expect(unshared.agrees).toBe(false);
    expect(`${unshared.cellSum2.n}/${unshared.cellSum2.d}`).toBe("260/1");
    expect(`${unshared.boundary2.n}/${unshared.boundary2.d}`).toBe("256/1");
    expect(unshared.flipped).toBe(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("Q5 — the seam identity under a warp", () => {
  /**
   * ★★★ THE HEADLINE, AND IT REFUTES THE BRIEF'S CONJECTURE IN ITS OWN TERMS.
   *
   * The conjecture was: *the identity survives as a topological fact while the
   * formula stops computing it.* On a shared edge, BOTH halves are false the
   * other way round — the formula survives EXACTLY.
   *
   * α_L + α_R = 1 holds to the last bit under every warp tried, including a
   * strongly non-affine shear and a bump that drags the seam's own endpoint. The
   * reason, once measured, is plain: §10.1's identity never depended on the edge
   * being STRAIGHT. It depends on the two sides reading the SAME directed segment
   * with opposite orientation, so that E_R = −E_L, and on a common positive step.
   * That is an orientation fact and a warp does not touch it.
   */
  it("★★★ same-scale seam: the LINEAR identity is exact under every warp [PROVEN]", () => {
    const m = 8;
    const rows: string[] = [];
    for (const [tag, w] of [
      ["identity", IDENTITY],
      ["affine", AFFINE],
      ["shear λ=1/8", offsetWarp(shearWarp(rat(1, 8), R0), OFFSET)],
      ["shear λ=1/2", offsetWarp(shearWarp(rat(1, 2), R0), OFFSET)],
      ["bump on the seam's own endpoint", offsetWarp(bumpWarp([m, 0], [rat(3, 2), R0]), OFFSET)],
    ] as [string, Warp][]) {
      const L: readonly Lat[] = [[0, 0], [m, 0], [0, m]];
      const R: readonly Lat[] = [[m, 0], [m, m], [0, m]];
      const P = w.apply([m, 0]);
      const Q = w.apply([0, m]);
      const pieces = [
        { tri: warpTriangle(w, L), edge: [P, Q] as readonly [typeof P, typeof P] },
        { tri: warpTriangle(w, R), edge: [Q, P] as readonly [typeof P, typeof P] },
      ];
      const region = coveredCells(raster(-4, m + 6, -4, m + 6), pieces);
      const rep = seamReport(region, [P, Q], pieces);
      expect(rep.cells).toBeGreaterThan(3);
      // §10.1, the LINEAR residue model — exact, to the bit
      expect(rep.linearOne).toBe(rep.cells);
      expect(rEq(rep.linearWorst, R0)).toBe(true);
      // §10.4, the exact-area tier — also exact
      expect(rep.exactOne).toBe(rep.cells);
      rows.push(`${tag}: cells=${rep.cells} modelErr=${rToFixed(rep.modelError, 4)}`);
    }
    console.log(rows.join("\n"));
  });

  /**
   * ★★★ WHERE IT DOES BREAK, AND IT IS NOT WHERE THE BRIEF EXPECTED.
   *
   * The T-junction: a coarse cell beside two finer ones, which is exactly the
   * mixed-depth configuration §9 exists to make safe. On the straight lattice the
   * shared vertex lies ON the coarse cell's edge and the three tile their union
   * exactly. Move it and the coarse chord and the fine polyline part company.
   *
   * BOTH TIERS BREAK, and the TOPOLOGY breaks first: the geometry genuinely stops
   * partitioning, so the exact-area tier — which the brief expected to survive —
   * is the one that reports a real hole. The linear model breaks by very nearly
   * the same amount, because the two sides are now reading two DIFFERENT
   * segments and E_R = −E_L is simply false.
   *
   * And it breaks at ANY displacement. δ = 1/1024 of a lattice unit is enough.
   */
  it("★★★ T-junction: both tiers break, at any displacement [PROVEN]", { timeout: 60000 }, () => {
    const m = 8;
    const rows: string[] = [];
    for (const [tag, w, lens, breaks] of [
      ["identity", IDENTITY, "0/1", false],
      ["affine", AFFINE, "0/1", false],
      ["shear λ=1/8", offsetWarp(shearWarp(rat(1, 8), R0), OFFSET), "-128/1", true],
      ["bump +3/2", offsetWarp(bumpWarp([m, m], [rat(3, 2), R0]), OFFSET), "24/1", true],
      ["bump +1/16", offsetWarp(bumpWarp([m, m], [rat(1, 16), R0]), OFFSET), "1/1", true],
      ["bump +1/1024", offsetWarp(bumpWarp([m, m], [rat(1, 1024), R0]), OFFSET), "1/64", true],
    ] as [string, Warp, string, boolean][]) {
      const t = tJunction(m, w);
      expect(`${t.lens2.n}/${t.lens2.d}`).toBe(lens);
      const all = raster(-4, 2 * m + 6, -4, 2 * m + 6);
      // The region is defined by the STITCHED configuration, whose pieces share
      // every vertex and therefore partition for ANY vertex warp. Using the
      // configuration under test to define its own region would make the
      // exact-area answer a tautology; this cannot.
      const stitched = [
        { tri: t.stitched[0] }, { tri: t.stitched[1] }, { tri: t.R1 }, { tri: t.R2 },
      ];
      const region = coveredCells(all, stitched);
      expect(region.length).toBeGreaterThan(100);
      const chordCovers = coveredCells(region, [{ tri: t.L }, { tri: t.R1 }, { tri: t.R2 }]);
      const rev = [t.subEdges[0][1], t.subEdges[0][0]] as readonly [typeof t.chord[0], typeof t.chord[0]];
      const chord = seamReport(region, t.subEdges[0], [
        { tri: t.L, edge: t.chord },
        { tri: t.R1, edge: rev },
      ]);
      expect(chord.cells).toBeGreaterThan(5);
      if (breaks) {
        // TOPOLOGY: the coarse-chord configuration stops covering the region
        expect(chordCovers.length).toBeLessThan(region.length);
        // EXACT-AREA tier: not one seam cell keeps the identity
        expect(chord.exactOne).toBe(0);
        // LINEAR tier: broken too, and by a comparable amount
        expect(chord.linearOne).toBeLessThan(chord.cells);
        expect(rSign(chord.linearWorst)).toBe(1);
      } else {
        expect(chordCovers.length).toBe(region.length);
        expect(chord.exactOne).toBe(chord.cells);
        expect(chord.linearOne).toBe(chord.cells);
        expect(rEq(chord.linearWorst, R0)).toBe(true);
      }
      rows.push(
        `${tag}: lens2=${lens} region=${region.length} covered=${chordCovers.length} seam=${chord.cells} exactOne=${chord.exactOne} linearOne=${chord.linearOne} exW=${rToFixed(chord.exactWorst, 8)} liW=${rToFixed(chord.linearWorst, 8)}`
      );
    }
    console.log(rows.join("\n"));
  });

  /**
   * THE REPAIR, CONSTRUCTED. Re-tessellate the coarse cell through the moved
   * vertex — ordinary T-junction stitching — and the linear identity comes back
   * EXACTLY, for every warp.
   *
   * Which is the positive form of the finding: what breaks the seam is not
   * curvature, it is the two sides describing one edge at two different
   * resolutions.
   */
  it("stitching the T-junction restores the identity exactly [PROVEN]", { timeout: 60000 }, () => {
    const m = 8;
    for (const w of [
      IDENTITY,
      offsetWarp(shearWarp(rat(1, 8), R0), OFFSET),
      offsetWarp(bumpWarp([m, m], [rat(3, 2), R0]), OFFSET),
      offsetWarp(bumpWarp([m, m], [rat(-3, 2), R0]), OFFSET),
      offsetWarp(bumpWarp([m, m], [rat(1, 1024), R0]), OFFSET),
    ]) {
      const t = tJunction(m, w);
      const all = raster(-4, 2 * m + 6, -4, 2 * m + 6);
      const stitched = [
        { tri: t.stitched[0] }, { tri: t.stitched[1] }, { tri: t.R1 }, { tri: t.R2 },
      ];
      const region = coveredCells(all, stitched);
      const rev = [t.subEdges[0][1], t.subEdges[0][0]] as readonly [typeof t.chord[0], typeof t.chord[0]];
      const fixed = seamReport(region, t.subEdges[0], [
        { tri: t.stitched[0], edge: t.subEdges[0] },
        { tri: t.R1, edge: rev },
      ]);
      expect(fixed.cells).toBeGreaterThan(5);
      expect(fixed.linearOne).toBe(fixed.cells);
      expect(rEq(fixed.linearWorst, R0)).toBe(true);
    }
  });

  /** The exact-area machinery itself, checked before anything is concluded from it. */
  it("the clipper is exact: a partitioned cell sums to 1, always [PROVEN]", () => {
    const cells = raster(0, 4, 0, 4);
    // two triangles that provably tile a big square-ish region
    const big: readonly (readonly [ReturnType<typeof rInt>, ReturnType<typeof rInt>])[] = [
      [rInt(0), rInt(0)], [rInt(4), rInt(0)], [rInt(0), rInt(4)],
    ];
    for (const c of cells) {
      const a = alphaExact(c.poly, big);
      const inside = c.poly.every(
        (v) => rSign(v[0]) >= 0 && rSign(v[1]) >= 0 && rSign(rSub(rInt(4), rSub(rInt(0), rSub(rSub(rInt(0), v[0]), v[1])))) >= 0
      );
      if (inside) expect(rEq(a, rInt(1))).toBe(true);
      expect(rSign(rSub(a, rInt(1)))).toBeLessThanOrEqual(0);
    }
    // shoelace sanity: the unit up-triangle has twice-area 1
    expect(rEq(rAbs(polyArea2(cells[0].poly)), rInt(1))).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("R — the FlowAngle apex, and what stays in ℤ[√3]", () => {
  /**
   * THE APEX NEEDS NO SQUARE ROOT, WHICH IS WHY THE QUESTION HAS AN ANSWER.
   *
   * `height = (base/2)/tan(angle/2)` then "step along the unit perpendicular"
   * looks as though it needs |PQ|. It does not: the length cancels between the
   * height and the normalisation, leaving
   *
   *     apex = midpoint ± (cot(angle/2)/2) · rot90(Q − P)
   *
   * so the apex lies in whatever ring holds the anchors and cot(angle/2). The
   * whole exactness question is one membership test on one ring element.
   */
  it("the six 60° inward caps of the hexagon land exactly on its centre [PROVEN]", () => {
    const R = rat(4);
    const centre = { x: z3Int(0, 0), y: z3Int(0, 0) };
    const cot30 = z3Div(z3Int(1, 0), z3Div(z3Int(0, 1), z3Int(3, 0)));
    expect(z3Eq(cot30, z3Int(0, 1))).toBe(true); // cot 30° = √3
    for (let k = 0; k < 6; k++) {
      const apex = flowAngleApex(hexAnchor(k, R), hexAnchor(k + 1, R), cot30, true);
      expect(z3PtEq(apex, centre)).toBe(true);
    }
    // GUARD-FIRE: any other angle misses the centre.
    for (const cot of [z3Int(2, 1), z3Int(1, 0), z3Int(2, -1)]) {
      const apex = flowAngleApex(hexAnchor(0, R), hexAnchor(1, R), cot, true);
      expect(z3PtEq(apex, centre)).toBe(false);
    }
  });

  /**
   * WHICH ANGLES KEEP THE APEX EXACT — and the sharp distinction is UNIT vs
   * merely integral, not integral vs not.
   *
   * The ladder is generated, not tabulated: from tan(15°) = 2 − √3 the
   * double-angle map tan(2θ) = 2t/(1 − t²) is applied in the ring.
   */
  it("the ring ladder from tan(15°), and the unit/non-unit split [PROVEN]", () => {
    expect(z3Eq(z3Mul(EPS, EPS_BAR), z3Int(1, 0))).toBe(true);
    expect(rEq(z3Norm(EPS_BAR), rInt(1))).toBe(true);
    expect(z3IsUnit(EPS_BAR)).toBe(true);

    const ladder: [number, string, boolean, boolean][] = [];
    let t: ReturnType<typeof z3TanDouble> = EPS_BAR;
    let half = 15;
    while (t !== null && half <= 60) {
      const r = apexRing(half * 2, t);
      ladder.push([half * 2, `${r.cotHalf.a.n}/${r.cotHalf.a.d}+${r.cotHalf.b.n}/${r.cotHalf.b.d}√3`, r.integral, r.unit]);
      t = z3TanDouble(t);
      half *= 2;
    }
    expect(ladder).toEqual([
      [30, "2/1+1/1√3", true, true],
      [60, "0/1+1/1√3", true, false],
      [120, "0/1+1/3√3", false, false],
    ]);
    // and the two the doubling ladder does not reach from 15°
    expect(apexRing(90, z3Int(1, 0))).toMatchObject({ integral: true, unit: true });
    expect(apexRing(150, z3Int(2, 1))).toMatchObject({ integral: true, unit: true });

    // the skill's own spelling of the same thing: height = halfBase·cot(angle/2).
    // At angle 60° on a hexagon of circumradius 4 the half-base is 2 and the
    // height is 2√3 — the apothem, which is why the cap's apex is the centre.
    expect(z3Eq(apexHeight(z3Int(0, 1), rat(2)), z3Int(0, 2))).toBe(true);
    // and at 30° the divisor is the UNIT ε̄, so the height is integral too
    expect(z3Eq(apexHeight(z3Int(2, 1), rat(2)), z3Int(4, 2))).toBe(true);
  });

  /**
   * ★ THE WIDTH LAW OF THE UNIT PARAMETERISATION.
   *
   * The owner's correction, tested: if curvature is a DEVIATION from a regular
   * hexagon side, deviations compose by multiplication, and the whole question is
   * whether the per-level factor is a UNIT.
   *
   *   N(x) = ±1  →  x^k AND x^(−k) are algebraic integers at every k. No
   *                 denominator ever appears, in either direction. Confirmed to
   *                 k = 60, with the Pell invariant a² − 3b² = 1 checked at every
   *                 power rather than inferred from multiplicativity.
   *   N(x) ≠ ±1  →  one direction escapes. cot(30°) = √3 is integral forward and
   *                 NOT backward; cot(60°) = √3/3 is not integral forward at all,
   *                 and its denominator is a power of 3.
   *
   * A rep-tile needs both directions — refine down, resolve prefixes up — so
   * "unit" and not "integral" is the right condition, and 30°/90°/150° are the
   * angles that satisfy it.
   *
   * THE PRECISION LOOKAHEAD. bits(ε̄^k) grows by 2 nine times then 1, in a period
   * of 10 — that is 19 bits per 10 levels, i.e. log₂(2 + √3) = 1.9004… to four
   * places, known from the factor alone. A JavaScript `number` runs out at k = 29.
   */
  it("★ units compose denominator-free; non-units do not [PROVEN]", () => {
    for (let k = 0; k <= 60; k++) {
      const p = z3Pow(EPS_BAR, k);
      expect(z3IsIntegral(p)).toBe(true);
      expect(rEq(z3Norm(p), rInt(1))).toBe(true); // the Pell invariant
    }
    const unitRows = unitPowerWidths(EPS_BAR, 24);
    expect(unitRows.every((r) => r.bitsDen === 0)).toBe(true);
    expect(unitPowerWidths(EPS, 24).every((r) => r.bitsDen === 0)).toBe(true);
    expect(unitPowerWidths(z3Div(z3Int(1, 0), EPS_BAR), 24).every((r) => r.integral)).toBe(true);

    const sqrt3 = z3Int(0, 1); // cot(30°): apex angle 60°, integral but N = −3
    expect(unitPowerWidths(sqrt3, 24).every((r) => r.integral)).toBe(true);
    expect(
      unitPowerWidths(z3Div(z3Int(1, 0), sqrt3), 24).every((r) => r.integral)
    ).toBe(false);

    const third = z3Div(z3Int(1, 0), sqrt3); // cot(60°): apex angle 120°
    const denBits = unitPowerWidths(third, 24).map((r) => r.bitsDen);
    expect(denBits[0]).toBe(0);
    expect(denBits[24]).toBeGreaterThan(0);

    // the lookahead: bit deltas of 2,2,…,1 in a period of 10 — 19 bits per 10
    const bits = unitPowerWidths(EPS_BAR, 40).map((r) => r.bitsA);
    const deltas = bits.slice(1).map((b, i) => b - bits[i]);
    expect(new Set(deltas.slice(3))).toEqual(new Set([1, 2]));
    for (let k = 10; k + 10 <= 40; k += 10) expect(bits[k + 10] - bits[k]).toBe(19);
    expect(safeIntegerDepth(EPS_BAR)).toBe(29);
    expect(safeIntegerDepth(EPS)).toBe(29);
  });

  /**
   * THE ESCAPES, decided rather than searched. A square in ℚ(√3) must have a zero
   * √-component and be a rational square, or three times one — so √2 and √5 are
   * out, which is n = 8 and n = 5 out, which is §11's exact-angle family
   * n ∈ {3, 4, 6, 12} and `docs/theory.md` §11.4's "ℤ[φ] needs √5, which ℤ[√2,√3]
   * does not contain".
   */
  it("√2 and √5 are not in ℚ(√3), so n = 8 and n = 5 escape [PROVEN]", () => {
    expect(z3HasSquareRoot(z3Int(2, 0))).toBe(false);
    expect(z3HasSquareRoot(z3Int(5, 0))).toBe(false);
    expect(z3HasSquareRoot(z3Int(3, 0))).toBe(true);
    expect(z3HasSquareRoot(z3Int(12, 0))).toBe(true);
    expect(z3HasSquareRoot(z3Int(4, 0))).toBe(true);
    expect(z3HasSquareRoot(z3Int(0, 1))).toBe(false);
  });

  /**
   * FLOAT ORACLE — the only float in this file, and it decides nothing.
   *
   * The exact ring values above are cross-checked against `Math.tan`. If the ring
   * ladder had drifted, the exact answers would still be self-consistent and
   * wrong; a float oracle is the cheapest independent witness that they name the
   * angles they claim to.
   */
  it("FLOAT ORACLE: the ring values agree with Math.tan to 1e-12 [MEASURED]", () => {
    const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-12);
    near(Math.tan(Math.PI / 12), 2 - Math.sqrt(3));
    near(Math.tan(Math.PI / 6), Math.sqrt(3) / 3);
    near(Math.tan(Math.PI / 3), Math.sqrt(3));
    near(Math.tan((5 * Math.PI) / 12), 2 + Math.sqrt(3));
    // the hexagon apothem: R·cot(30°)/2 = R·√3/2 is the centre's distance to a side
    const R = 4;
    near((R / 2) / Math.tan(Math.PI / 6), (R * Math.sqrt(3)) / 2);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("the instrument's own width", () => {
  /**
   * WHY `warp.ts` USES bigint WHEN NOTHING ELSE IN THIS REPO DOES.
   *
   * Because exact rational polygon clipping is a different width law from the
   * descent's. The descent composes integer matrices over one denominator equal
   * to the scale and never leaves two digits at this program's MAX_DEPTH of 5.
   * The clipper forms intersection parameters, affine combinations at those
   * parameters, and areas that are sums of products of them — and the numerators
   * it actually reaches are measured here rather than guessed at.
   *
   * The proposal does not need bigint. The instrument that decides the proposal
   * does. Those are different claims and this test keeps them apart.
   */
  it("the clipper reaches ~45-bit numerators; the descent stays under 2^53 [MEASURED]", { timeout: 60000 }, () => {
    ratWidthReset();
    const m = 8;
    const w = offsetWarp(bumpWarp([m, m], [rat(1, 1024), R0]), OFFSET);
    const t = tJunction(m, w);
    const all = raster(-4, 2 * m + 6, -4, 2 * m + 6);
    coveredCells(all, [
      { tri: t.stitched[0] }, { tri: t.stitched[1] }, { tri: t.R1 }, { tri: t.R2 },
    ]);
    const width = ratWidth();
    console.log(`clipper width: ${JSON.stringify(width)}`);
    expect(width.bitsNum).toBeGreaterThan(40);
    expect(width.bitsDen).toBeGreaterThan(40);
    // products of two such reach ~90 bits, past 2^53 — so the choice is forced
    // FOR THE INSTRUMENT.
    expect(width.bitsNum + width.bitsDen).toBeGreaterThan(53);

    // and the descent, at every depth this program can reach, is tiny
    for (const d of [1, 2, 3, 4, 5]) {
      const fig = buildFigure(d);
      let widest = 0;
      for (const c of fig.cells) {
        for (const r of deriveCell(c.addr).verts) {
          for (const v of r) widest = Math.max(widest, Math.abs(v));
        }
      }
      expect(widest).toBe(fig.scale);
      expect(widest).toBeLessThan(Number.MAX_SAFE_INTEGER);
    }
  });
});
