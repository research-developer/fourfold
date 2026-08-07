/**
 * VERTICES — the shared vertex table, decided by computation.
 *
 * Companion to `src/lib/vertices.ts`. This is increment 1 of
 * `docs/spec-curvature.md`, and it is the increment `docs/warp-findings.md`
 * asked for: *give the figure a shared vertex table, derived, with the derivation
 * as the authority — and change nothing about how anything is drawn.*
 *
 * Labels follow the house convention:
 *
 *   [PROVEN]     exhaustive computation, decided against an oracle independent of
 *                the thing under test, with a mutation shown lethal.
 *   [MEASURED]   a number this run produced, not exhaustive over its domain.
 *
 * ── The oracles, and why they are oracles ────────────────────────────────
 *
 *   `figure.buildFigure`      the shipped rep-4 geometry. Produced by halving
 *   `figure.buildRep9Figure`  coordinates (`half`) or blending them (`rep9Blend`)
 *                             one level at a time. The derivation under test
 *                             instead COMPOSES 3×3 integer matrices and applies
 *                             the product once. Different computation, same
 *                             answer, or the agreement means nothing.
 *   `hexagon.buildHexagon`    the six-sector canvas, with its own `rotK` and its
 *   `hexagon.buildRep9Hexagon` own collision check on lattice keys.
 *
 * The address enumeration takes NO figure: `addressSweep` builds the words from
 * the alphabet alone, and the first test checks that the resulting order is
 * `buildFigure`'s own — because a cell-for-cell comparison is worth nothing if
 * the two sides are not comparing the same cells.
 *
 * ── Where the float is ───────────────────────────────────────────────────
 *
 * NOWHERE. `src/lib/vertices.ts` has no `Math.` call outside `Math.abs` on an
 * integer twice-area, no division, and no rational. This file has none either:
 * every assertion below is on an integer, a count, or a string key. There is no
 * wall-clock assertion in this file at all — the cost measurements live in
 * `test/warp.test.ts`, which already pins the direction of the derive/lookup
 * asymmetry, and a second timing assertion would be a second thing to flake
 * without being a second piece of evidence. The saving is asserted STRUCTURALLY
 * instead (slots against distinct), which is exact.
 */

import { describe, expect, it } from "vitest";
import { buildFigure, buildRep9Figure, type Convention } from "../src/lib/figure";
import {
  buildHexagon,
  buildRep9Hexagon,
  latKey,
  type Lat,
} from "../src/lib/hexagon";
import { scaleOfWord } from "../src/lib/scale";
import {
  REP4_LETTERS,
  addressSweep,
  alphabetOf,
  areaGate,
  buildVertexTable,
  deriveCell,
  deriveTriangle,
  expectedDeficit,
  expectedDistinct,
  explode,
  incidentCells,
  isShared,
  latTriples,
  moveVertex,
  refineTable,
  tableFromTriples,
  tableTriangle,
  vertexCensus,
  type CanvasSpec,
  type DerivedVertexTable,
  type Tri,
  type VertexTable,
} from "../src/lib/vertices";

/** A triangle as a single comparable string. Exact — these are integers. */
const triKey = (t: readonly Lat[]): string => t.map(latKey).join("|");

/**
 * THE TABLE AGAINST THE DERIVATION, cell for cell.
 *
 * Dereference every cell through its three indices and compare against a FRESH
 * derivation from the same address. This is the check that makes the table a
 * memo rather than a second source of truth: it can only pass if every index
 * points where the derivation says it should.
 */
function agreement(t: DerivedVertexTable): {
  readonly cells: number;
  readonly mismatches: number;
} {
  const convention = t.spec.convention ?? "apex";
  let mismatches = 0;
  for (let i = 0; i < t.cells.length; i++) {
    const fromTable = triKey(tableTriangle(t, i));
    const fromDerivation = triKey(
      deriveTriangle(t.addrs[i], convention, t.sectorOf[i])
    );
    if (fromTable !== fromDerivation) mismatches++;
  }
  return { cells: t.cells.length, mismatches };
}

/** The derivation against the SHIPPED geometry, cell for cell. */
function oracleAgreement(
  t: DerivedVertexTable,
  triples: readonly (readonly Lat[])[]
): { readonly cells: number; readonly mismatches: number } {
  if (triples.length !== t.cells.length) {
    throw new Error(`oracle has ${triples.length} cells, table has ${t.cells.length}`);
  }
  let mismatches = 0;
  for (let i = 0; i < triples.length; i++) {
    if (triKey(tableTriangle(t, i)) !== triKey(triples[i])) mismatches++;
  }
  return { cells: triples.length, mismatches };
}

const TRIANGLE_REP4: CanvasSpec[] = [1, 2, 3, 4, 5, 6].map((depth) => ({
  radix: 4,
  depth,
  sectors: 1,
}));
const TRIANGLE_REP9: CanvasSpec[] = [1, 2, 3, 4].map((depth) => ({
  radix: 9,
  depth,
  sectors: 1,
}));
const HEX_REP4: CanvasSpec[] = [1, 2, 3, 4, 5].map((depth) => ({
  radix: 4,
  depth,
  sectors: 6,
}));
const HEX_REP9: CanvasSpec[] = [1, 2, 3].map((depth) => ({
  radix: 9,
  depth,
  sectors: 6,
}));

// ═════════════════════════════════════════════════════════════════════════
describe("the derivation is the authority", () => {
  /**
   * THE ORDER, FIRST, because everything below is a cell-for-cell comparison.
   *
   * `buildFigure` recurses A, B, C, X and `buildRep9Figure` recurses
   * `REP9_ALPHABET` in index order, so on a complete tree the leaves come out in
   * DFS pre-order, which IS lexicographic over the ordered alphabet.
   * `addressSweep` reproduces that from the alphabet alone — no figure, no tree,
   * no recursion over geometry — and this test is what says so. If it ever fails,
   * every agreement count below is comparing two different cells and means
   * nothing, which is why it is the first assertion in the file.
   */
  it("the address sweep reproduces the figures' own cell order, with no figure in hand [PROVEN]", () => {
    for (const depth of [1, 2, 3, 4, 5, 6]) {
      expect(addressSweep(depth, REP4_LETTERS)).toEqual(
        buildFigure(depth).cells.map((c) => c.addr)
      );
    }
    for (const depth of [1, 2, 3, 4]) {
      expect(addressSweep(depth, alphabetOf(9))).toEqual(
        buildRep9Figure(depth).cells.map((c) => c.addr)
      );
    }
    // and the hexagon's own order: six sectors of the base figure, in sector
    // order, which is the loop `buildHexagon` writes.
    const hex = buildHexagon(3);
    const table = buildVertexTable({ radix: 4, depth: 3, sectors: 6 });
    expect(table.addrs).toEqual(hex.cells.map((c) => c.addr));
    expect(table.sectorOf).toEqual(hex.cells.map((c) => c.sector));
  });

  /**
   * DERIVED == THE SHIPPED FIGURE, CELL FOR CELL, ALL THREE COORDINATES.
   *
   * `docs/warp-findings.md` Q2's headline, re-decided through the promoted
   * module rather than through the instrument. The rep-4 maps in `vertices.ts`
   * are a hand transcription of `figure.ts`'s documented recursion, so this is a
   * second opinion and not a restatement; the rep-9 maps are `REP9_ALPHABET`'s
   * own weights, and what is independent there is the COMPOSITION — the figure
   * blends one level at a time, the derivation multiplies the matrices and
   * applies the product once.
   */
  it("derived == buildFigure at rep-4 (both conventions) and buildRep9Figure [PROVEN]", () => {
    const counts: [string, number, number][] = [];
    for (const convention of ["apex", "ifs"] as Convention[]) {
      const spec: CanvasSpec = { radix: 4, depth: 6, sectors: 1, convention };
      const t = buildVertexTable(spec);
      const r = oracleAgreement(t, latTriples(buildFigure(6, convention).cells));
      counts.push([`rep-4 ${convention}`, r.cells, r.mismatches]);
    }
    const nine = buildVertexTable({ radix: 9, depth: 4, sectors: 1 });
    const r9 = oracleAgreement(nine, latTriples(buildRep9Figure(4).cells));
    counts.push(["rep-9", r9.cells, r9.mismatches]);
    expect(counts).toEqual([
      ["rep-4 apex", 4096, 0],
      ["rep-4 ifs", 4096, 0],
      ["rep-9", 6561, 0],
    ]);
  });

  /**
   * THE SECOND CANVAS. Six sectors, and the identifications between them are the
   * whole reason the hexagon's vertex count is `3s² + 3s + 1` and not six times
   * the triangle's. `rotK` is taken from `hexagon.ts` rather than re-spelled, so
   * the sectors this module builds are the sectors that ship.
   */
  it("derived == buildHexagon and buildRep9Hexagon, all six sectors [PROVEN]", () => {
    const four = buildVertexTable({ radix: 4, depth: 5, sectors: 6 });
    const r4 = oracleAgreement(four, latTriples(buildHexagon(5).base.cells, 6));
    const nine = buildVertexTable({ radix: 9, depth: 3, sectors: 6 });
    const r9 = oracleAgreement(nine, latTriples(buildRep9Hexagon(3).base.cells, 6));
    expect([r4, r9]).toEqual([
      { cells: 6144, mismatches: 0 },
      { cells: 4374, mismatches: 0 },
    ]);
    // the sectors really do share: six copies of 1,024 cells hold 3,169 vertices,
    // not 6 × 561, because the sector boundaries are identified.
    expect(four.vertices.length).toBe(3169);
    expect(nine.vertices.length).toBe(2269);
  });

  /**
   * AN ADDRESS DETERMINES ITS OWN SCALE — `scale.ts`'s one constraint, and the
   * thing `plate.ts`'s "prefix = ancestry" rests on.
   *
   * `deriveCell` accumulates the edge divisions as it walks; `scaleOfWord` reads
   * the characters and multiplies. Two computations, and they have to agree on
   * MIXED words too, because that is where a per-node radix would have to show
   * up. `buildVertexTable` throws if they ever disagree, so this test is the
   * measurement and the constructor's guard is the enforcement.
   */
  it("an address determines its own scale, mixed radix included [PROVEN]", () => {
    const words = [
      "",
      "AAAA",
      "AXBC",
      "abcuvw",
      "xxxxx",
      "AXaBu",
      "xyzABC",
      "AXBCAXBCAXBCAXBCAXBC",
    ];
    const rows = words.map((w) => [w, deriveCell(w).scale, scaleOfWord(w)]);
    expect(rows).toEqual([
      ["", 1, 1],
      ["AAAA", 16, 16],
      ["AXBC", 16, 16],
      ["abcuvw", 729, 729],
      ["xxxxx", 243, 243],
      ["AXaBu", 72, 72],
      ["xyzABC", 216, 216],
      ["AXBCAXBCAXBCAXBCAXBC", 1048576, 1048576],
    ]);
    // and the rows of the accumulator are barycentric weights, so each sums to
    // the scale exactly — one denominator after d levels, never a product of
    // per-node ones. `docs/warp-findings.md` Q2, restated on the promoted code.
    for (const w of words) {
      const d = deriveCell(w);
      for (const row of d.verts) {
        expect(row[0] + row[1] + row[2]).toBe(d.scale);
      }
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("the table is a memo of the derivation", () => {
  /**
   * THE MEMO, DEREFERENCED AND COMPARED BACK.
   *
   * Every cell's three indices are followed into the vertex array and the
   * resulting triangle is compared against a fresh derivation from the same
   * address. This is the assertion that the table adds no information and loses
   * none — it is a cache, and a cache that disagrees with its source is a bug in
   * exactly one direction.
   */
  it("table dereference == derivation, cell for cell, both canvases and both radices [PROVEN]", () => {
    const rows = [
      ...TRIANGLE_REP4,
      ...TRIANGLE_REP9,
      ...HEX_REP4,
      ...HEX_REP9,
      { radix: 4, depth: 5, sectors: 1, convention: "ifs" } as CanvasSpec,
    ].map((spec) => {
      const t = buildVertexTable(spec);
      const a = agreement(t);
      return [`r${spec.radix}s${spec.sectors}d${spec.depth}`, a.cells, a.mismatches];
    });
    // every mismatch column is zero, and the cell counts are the canvases'
    expect(rows.every((r) => r[2] === 0)).toBe(true);
    expect(rows.map((r) => r[1])).toEqual([
      4, 16, 64, 256, 1024, 4096,
      9, 81, 729, 6561,
      24, 96, 384, 1536, 6144,
      54, 486, 4374,
      1024,
    ]);
  });

  /**
   * THE TABLE SHARES, AND THE INTERNING IS EXACTLY THE CENSUS.
   *
   * `vertices.length === census.distinct` says every stored vertex is used;
   * `unreferenced === 0` says none is orphaned; `isShared` says no two entries
   * sit at the same point. All three are needed: a table could satisfy any two
   * and still be wrong.
   */
  it("the table interns exactly the census's distinct count, and shares [PROVEN]", () => {
    for (const spec of [...TRIANGLE_REP4, ...TRIANGLE_REP9, ...HEX_REP4, ...HEX_REP9]) {
      const t = buildVertexTable(spec);
      const c = vertexCensus(t);
      expect(t.vertices.length).toBe(c.distinct);
      expect(c.unreferenced).toBe(0);
      expect(isShared(t)).toBe(true);
      expect(c.slots).toBe(3 * c.cells);
    }
  });

  /**
   * ★ GUARD-FIRE. ONE PERTURBED VERTEX INDEX, AND BOTH GATES GO RED.
   *
   * The mutation is the smallest one the structure admits: cell 0's role-0 index
   * is repointed from vertex 0 to vertex 1. Nothing moves, no coordinate changes,
   * no vertex is added or removed — only ONE integer in ONE index triple.
   *
   * It has to be lethal twice over, and it is:
   *
   *   AGREEMENT  cell 0 now dereferences to a triangle the derivation does not
   *              produce. 1 mismatch out of 256.
   *   CENSUS     vertex 0 is the figure's A corner, of degree 1 — the only cell
   *              that referenced it was cell 0 — so it becomes UNREFERENCED, the
   *              distinct count falls 153 → 152, and the closed form
   *              (s+1)(s+2)/2 stops holding.
   *
   * That the census notices at all is the reason it is computed from `cells` and
   * not from `vertices.length`. A census that counted stored vertices would have
   * reported 153 either way and this mutation would have passed it.
   */
  it("guard-fire: one perturbed vertex index reddens the agreement AND the census [PROVEN]", () => {
    const honest = buildVertexTable({ radix: 4, depth: 4, sectors: 1 });
    expect(honest.scale).toBe(16);
    expect(agreement(honest)).toEqual({ cells: 256, mismatches: 0 });

    const honestCensus = vertexCensus(honest);
    expect(honestCensus.distinct).toBe(153);
    expect(honestCensus.distinct).toBe(expectedDistinct(honest.spec, honest.scale));
    expect(honestCensus.unreferenced).toBe(0);
    // the perturbation target: vertex 0 is the A corner, at lattice (0,0), and it
    // has degree 1 — stated rather than assumed, because the mutation's lethality
    // to the census depends on it.
    expect(latKey(honest.vertices[0])).toBe("0,0");
    expect(incidentCells(honest, 0)).toEqual([0]);

    const mutant: DerivedVertexTable = {
      ...honest,
      cells: honest.cells.map((c, i) => (i === 0 ? ([1, c[1], c[2]] as Tri) : c)),
    };
    expect(agreement(mutant)).toEqual({ cells: 256, mismatches: 1 });

    const mutantCensus = vertexCensus(mutant);
    expect(mutantCensus.distinct).toBe(152);
    expect(mutantCensus.unreferenced).toBe(1);
    expect(mutantCensus.distinct).not.toBe(
      expectedDistinct(mutant.spec, honest.scale)
    );
    // the degree histogram moves too: one corner of degree 1 is gone and one
    // vertex has gained an incidence it should not have.
    expect(honestCensus.degrees.get(1)).toBe(3);
    expect(mutantCensus.degrees.get(1)).toBe(2);
    expect(mutantCensus.degrees).not.toEqual(honestCensus.degrees);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("the census, against the closed forms", () => {
  /**
   * THE SWEEP, OBSERVED. Every row is a count this run produced by walking the
   * table; the closed forms are then checked against it, not used to produce it.
   *
   * These are the numbers `docs/warp-findings.md` Q1 published — reproduced here
   * from a table built by the DERIVATION, where Q1 built its census from the
   * shipped figures' stored `bary`. Two roads to the same counts.
   *
   * THE RADIX DOES NOT ENTER: both radices obey `distinct = (s+1)(s+2)/2` and
   * `deficit = 9s + 6` IN THE SCALE, which is forced once "rep-4 ∘ rep-9 =
   * rep-36, the same 36 triangles" is taken seriously — at equal scale the two
   * radices produce the same point set, so they cannot disagree about a count of
   * points.
   */
  it("triangle canvas: rep-4 depths 1–6 and rep-9 depths 1–4 [PROVEN]", () => {
    const row = (spec: CanvasSpec) => {
      const t = buildVertexTable(spec);
      const c = vertexCensus(t);
      return [t.scale, c.cells, c.slots, c.distinct, c.deficit];
    };
    const rep4 = TRIANGLE_REP4.map(row);
    expect(rep4).toEqual([
      [2, 4, 12, 6, 24],
      [4, 16, 48, 15, 42],
      [8, 64, 192, 45, 78],
      [16, 256, 768, 153, 150],
      [32, 1024, 3072, 561, 294],
      [64, 4096, 12288, 2145, 582],
    ]);
    const rep9 = TRIANGLE_REP9.map(row);
    expect(rep9).toEqual([
      [3, 9, 27, 10, 33],
      [9, 81, 243, 55, 87],
      [27, 729, 2187, 406, 249],
      [81, 6561, 19683, 3403, 735],
    ]);
    for (const [s, , , distinct, deficit] of [...rep4, ...rep9]) {
      expect(distinct).toBe(((s + 1) * (s + 2)) / 2);
      expect(deficit).toBe(9 * s + 6);
      expect(distinct).toBe(expectedDistinct({ radix: 4, depth: 0, sectors: 1 }, s));
      expect(deficit).toBe(expectedDeficit({ radix: 4, depth: 0, sectors: 1 }, s));
    }
  });

  it("hexagon canvas: rep-4 depths 1–5 and rep-9 depths 1–3 [PROVEN]", () => {
    const row = (spec: CanvasSpec) => {
      const t = buildVertexTable(spec);
      const c = vertexCensus(t);
      return [t.scale, c.cells, c.slots, c.distinct, c.deficit];
    };
    const rep4 = HEX_REP4.map(row);
    expect(rep4).toEqual([
      [2, 24, 72, 19, 42],
      [4, 96, 288, 61, 78],
      [8, 384, 1152, 217, 150],
      [16, 1536, 4608, 817, 294],
      [32, 6144, 18432, 3169, 582],
    ]);
    const rep9 = HEX_REP9.map(row);
    expect(rep9).toEqual([
      [3, 54, 162, 37, 60],
      [9, 486, 1458, 271, 168],
      [27, 4374, 13122, 2269, 492],
    ]);
    // The centred hexagonal number, and the triangle's deficit DOUBLED — six
    // sectors have twice the boundary a single triangle does.
    for (const [s, , , distinct, deficit] of [...rep4, ...rep9]) {
      expect(distinct).toBe(3 * s * s + 3 * s + 1);
      expect(deficit).toBe(18 * s + 6);
      expect(distinct).toBe(expectedDistinct({ radix: 4, depth: 0, sectors: 6 }, s));
      expect(deficit).toBe(expectedDeficit({ radix: 4, depth: 0, sectors: 6 }, s));
    }
  });

  /**
   * WHY IT IS NOT EXACTLY 6, ACCOUNTED RATHER THAN ASSERTED.
   *
   * Σ_v deg(v) = slots identically, so slots = 6·V − Σ_v (6 − deg v), and the
   * whole shortfall sits on the boundary: interior vertices have degree 6 and
   * contribute nothing. The histogram is the proof, and it is the reason the
   * deficit is a closed form in the scale rather than a fitted constant.
   */
  it("the deficit is entirely the boundary's degree shortfall [PROVEN]", () => {
    for (const spec of TRIANGLE_REP4.slice(2)) {
      const t = buildVertexTable(spec);
      const s = t.scale;
      const c = vertexCensus(t);
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
    }
    for (const spec of HEX_REP4.slice(2)) {
      const t = buildVertexTable(spec);
      const c = vertexCensus(t);
      expect(c.degrees.get(2)).toBe(6);
      expect(c.degrees.get(3)).toBe(6 * (t.scale - 1));
      expect(c.degrees.get(6)).toBe(c.distinct - 6 * t.scale);
    }
  });

  /**
   * THE TWO ROADS MEET EXACTLY.
   *
   * One table built from the ADDRESS ALGEBRA and one interned from the shipped
   * figures' own stored `bary`, compared as whole structures — same vertex array
   * in the same order, same index triples in the same order. Not merely the same
   * counts: the same table.
   *
   * This is also the increment's "no drawing change" assertion in its strongest
   * available form. The table describes exactly the triangles `figure.ts` and
   * `hexagon.ts` already draw, in exactly their order, so nothing downstream
   * could read it and get a different picture.
   */
  it("the derived table and the shipped bary intern to the SAME table [PROVEN]", () => {
    const cases: [DerivedVertexTable, VertexTable][] = [
      [
        buildVertexTable({ radix: 4, depth: 5, sectors: 1 }),
        tableFromTriples(latTriples(buildFigure(5).cells)),
      ],
      [
        buildVertexTable({ radix: 4, depth: 5, sectors: 1, convention: "ifs" }),
        tableFromTriples(latTriples(buildFigure(5, "ifs").cells)),
      ],
      [
        buildVertexTable({ radix: 9, depth: 3, sectors: 1 }),
        tableFromTriples(latTriples(buildRep9Figure(3).cells)),
      ],
      [
        buildVertexTable({ radix: 4, depth: 4, sectors: 6 }),
        tableFromTriples(latTriples(buildHexagon(4).base.cells, 6)),
      ],
      [
        buildVertexTable({ radix: 9, depth: 2, sectors: 6 }),
        tableFromTriples(latTriples(buildRep9Hexagon(2).base.cells, 6)),
      ],
    ];
    for (const [derived, interned] of cases) {
      expect(derived.vertices).toEqual(interned.vertices);
      expect(derived.cells).toEqual(interned.cells);
      expect([...derived.index.entries()]).toEqual([...interned.index.entries()]);
    }
  });

  /**
   * THE SAVING, STRUCTURALLY — no clock involved.
   *
   * `docs/warp-findings.md` Q1's summary sentence, as an assertion: ~6× on slots,
   * but only ~2× on distinct objects against cells. Both halves matter and they
   * are different claims; quoting only the 6× oversells what sharing buys in
   * allocations.
   */
  it("the saving: slots fall ~6× and objects ~2×, and the ratio never reaches 6 [MEASURED]", () => {
    const t = buildVertexTable({ radix: 4, depth: 6, sectors: 1 });
    const c = vertexCensus(t);
    expect([c.cells, c.slots, c.distinct]).toEqual([4096, 12288, 2145]);
    // slots per distinct vertex, strictly below 6 — the boundary always has
    // vertices of degree < 6, so 6 is an asymptote and not a value.
    expect(c.slots).toBeLessThan(6 * c.distinct);
    expect(c.slots * 100).toBeGreaterThan(572 * c.distinct); // > 5.72×
    // and only about half as many vertices as cells
    expect(c.distinct * 2).toBeGreaterThan(c.cells);
    expect(c.distinct).toBeLessThan(c.cells);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("sharing is the point — one vertex moved", () => {
  /**
   * ── The configuration, and why it is this one ─────────────────────────
   *
   * The depth-4 rep-4 triangle (256 cells, scale 16), REFINED ×6 so that a
   * displacement of (1/2, −1/3) of a cell is the integer move (3, −2). That is
   * `docs/warp-findings.md` Q4's own bump, and refining rather than introducing a
   * rational is the point: the table holds integers and resolution lives in the
   * scale, exactly as `scale.ts` argues.
   *
   * The moved vertex is lattice (5, 6) — refined (30, 36) — chosen because it is
   * strictly interior, hence of degree 6, hence the outline cannot move. The gate
   * is then available with no boundary polygon to construct: the signed areas
   * must sum to the same total, and Σ|area| must equal it, the second equality
   * failing exactly when a cell has folded.
   */
  const SPEC: CanvasSpec = { radix: 4, depth: 4, sectors: 1 };
  const REFINEMENT = 6;
  const TARGET: Lat = [5 * REFINEMENT, 6 * REFINEMENT];

  function fineTable() {
    const t = refineTable(buildVertexTable(SPEC), REFINEMENT);
    const v = t.index.get(latKey(TARGET));
    if (v === undefined) throw new Error(`no vertex at ${latKey(TARGET)}`);
    return { t, v };
  }

  /**
   * ★ THE LAW THE WHOLE INCREMENT EXISTS FOR (`spec-curvature.md` L4).
   *
   * One shared vertex moves, and:
   *
   *   — every incident cell moves WITH it, all six of them, reading the identical
   *     moved point. Not six agreeing copies: the same integer index.
   *   — no cell that is not incident moves at all.
   *   — no cell changes owner. `cells` is passed through BY REFERENCE, so the
   *     assertion is object identity — there is no ownership to change, because
   *     ownership is an index and no index moved.
   *   — nothing folds: 256 positively oriented before and after, none degenerate,
   *     and the two area gates agree exactly at 9,216.
   *
   * 9,216 is 256 unit cells × 36, the refinement squared — i.e. the twice-area of
   * the whole canvas, which is what an interior move must leave alone.
   */
  it("★ a shared vertex moves every incident cell together: no fold, no ownership change [PROVEN]", () => {
    const { t, v } = fineTable();
    const before = areaGate(t);
    expect(before).toEqual({
      abs2: 9216,
      signed2: 9216,
      positive: 256,
      negative: 0,
      degenerate: 0,
    });
    const incident = incidentCells(t, v);
    expect(incident.length).toBe(6); // strictly interior

    const moved = moveVertex(t, v, [3, -2]);

    // NO OWNERSHIP CHANGE, in the strongest form available: the same array.
    expect(moved.cells).toBe(t.cells);
    expect(isShared(moved)).toBe(true);
    expect(moved.vertices.length).toBe(t.vertices.length);

    // NO FOLD, and the partition is exactly conserved.
    expect(areaGate(moved)).toEqual(before);

    // EVERY INCIDENT CELL MOVED, AND NOTHING ELSE DID.
    const changed: number[] = [];
    for (let i = 0; i < t.cells.length; i++) {
      if (triKey(tableTriangle(t, i)) !== triKey(tableTriangle(moved, i))) {
        changed.push(i);
      }
    }
    expect(changed).toEqual(incident);
    expect(changed).toEqual([249, 250, 251, 252, 253, 255]);

    // AND THEY ALL READ THE SAME POINT. Six cells, one coordinate, no agreement
    // to maintain — which is the difference the next test makes lethal.
    const seen = new Set<string>();
    for (const i of incident) {
      const tri = tableTriangle(moved, i);
      const slot = t.cells[i].indexOf(v);
      seen.add(latKey(tri[slot]));
    }
    expect([...seen]).toEqual(["33,34"]);
  });

  /**
   * ★★ THE GUARD-FIRE, AND IT IS THE WHOLE POINT.
   *
   * Give every cell its own copy of every vertex — which is precisely what
   * `figure.ts` stores today, `Cell.bary` being per-triangle by construction —
   * and then move "the same" vertex. There is no same vertex: there are six of
   * them, and a per-cell displacement is now expressible. It is expressed, with
   * `docs/warp-findings.md` Q4's own multiplier schedule, and the mesh folds.
   *
   * The numbers are Q4's, at this refinement:
   *
   *   shared      abs2 = 9,216 = signed2      0 flipped
   *   per-cell    abs2 = 9,360 ≠ signed2      1 flipped
   *
   * and 9,360/36 = 260 against 9,216/36 = 256, which is the published pair
   * exactly — the same measurement, reproduced through the promoted module in
   * integers rather than in rationals.
   *
   * The control matters as much as the mutation: the SAME displacement applied to
   * the SHARED table is free. So what breaks the mesh is not the motion and not
   * its size; it is the copies.
   */
  it("★★ guard-fire: per-cell copies FOLD under the same motion — 9,360 against 9,216 [PROVEN]", () => {
    const { t, v } = fineTable();

    // THE CONTROL: the same delta, shared. Free.
    const control = moveVertex(t, v, [3, 0]);
    expect(areaGate(control)).toEqual({
      abs2: 9216,
      signed2: 9216,
      positive: 256,
      negative: 0,
      degenerate: 0,
    });

    // THE MUTATION: per-cell copies, displaced by a cell-dependent amount.
    // `(i % 7) + 1` is Q4's own schedule — the point is only that the copies can
    // disagree, and under sharing they cannot.
    const exploded = explode(t);
    expect(isShared(exploded)).toBe(false);
    expect(exploded.vertices.length).toBe(3 * t.cells.length);
    // …and it is the SAME DRAWING until something moves: identical triangles.
    for (let i = 0; i < t.cells.length; i++) {
      expect(triKey(tableTriangle(exploded, i))).toBe(triKey(tableTriangle(t, i)));
    }
    expect(areaGate(exploded)).toEqual(areaGate(t));

    let mutant: VertexTable = exploded;
    t.cells.forEach((cell, i) => {
      cell.forEach((idx, j) => {
        if (idx === v) mutant = moveVertex(mutant, 3 * i + j, [3 * ((i % 7) + 1), 0]);
      });
    });

    const gate = areaGate(mutant);
    expect(gate).toEqual({
      abs2: 9360,
      signed2: 9216,
      positive: 255,
      negative: 1,
      degenerate: 0,
    });
    // the partition is broken: Σ|area| no longer equals the conserved signed sum
    expect(gate.abs2).not.toBe(gate.signed2);
    expect(gate.abs2 - gate.signed2).toBe(144);
    // …and in the units the findings published, that is 260 against 256.
    expect(gate.abs2 / (REFINEMENT * REFINEMENT)).toBe(260);
    expect(gate.signed2 / (REFINEMENT * REFINEMENT)).toBe(256);
  });
});
