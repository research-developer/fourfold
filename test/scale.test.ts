/**
 * SCALE — the properties that only start to matter later, measured now.
 *
 * `src/lib/scale.ts` replaced depth with scale as the carrier of resolution. At
 * the radix this program cuts, `scale = 2^depth`, so every assertion here has a
 * trivially true reading — and that is exactly why the file exists. These are
 * the invariants a mixed-radix tree would rest on, and the only moment they can
 * be pinned against a working program is while they are still trivial. Written
 * after a second radix existed, a failure would be indistinguishable from the
 * new radix being wrong.
 *
 * ── The oracle ───────────────────────────────────────────────────────────
 *
 * Where a claim can be decided by something that does not import `scale.ts`, it
 * is. `src/lib/reptile.ts` is the independent instrument: it builds the same
 * subdivision from barycentric grid points, with the 2 taken out of the
 * recursion and made a parameter, and it computes a denominator by multiplying
 * edge divisions along an actual descent. So `reptile` deciding that a depth-6
 * descent lands on denominator 64 is a fact about the GEOMETRY, and
 * `scaleOfDepth(6) === 64` agreeing with it is the claim under test — not the
 * same arithmetic written twice.
 *
 * `reptile.ts` is a measurement instrument that nothing in `src/app` imports and
 * that this pass did not touch. Importing it from a test is what it is for.
 *
 * ── The four properties ──────────────────────────────────────────────────
 *
 *   1. scale = 2^depth at radix 4, against the geometric oracle.
 *   2. divisibility agrees with ordering at radix 4 — and stops agreeing the
 *      moment a second radix exists, which is measured here too, on a mixed tree
 *      the oracle builds. That second half is the whole justification for
 *      `refines` and it can be shown TODAY.
 *   3. an address determines its own scale, with no figure, node or tree in
 *      hand. This is the constraint `plate.ts`'s prefix semantics rest on.
 *   4. everything that carries a scale carries the same one.
 */

import { describe, expect, it } from "vitest";
import {
  EDGE_DIVISION,
  armCellsAtScale,
  cellsAtScale,
  gasketAtDepth,
  radixAt,
  refines,
  scaleOfDepth,
  scaleOfWord,
  uprightsAt,
} from "../src/lib/scale";
import { ROOT, alphabet, buildTree, descend, subdivide, upCount } from "../src/lib/reptile";
import { buildFigure } from "../src/lib/figure";
import { buildHexagon } from "../src/lib/hexagon";
import { latticeView } from "../src/lib/lattice";
import { addressBook, wordOf } from "../src/lib/plate";
import { armCensus } from "../src/lib/arms";
import { gasketCells } from "../src/lib/presets";
import { cellCount } from "../src/lib/artfile";

// ── 1. scale = 2^depth at radix 4 ────────────────────────────────────────

describe("scale is the edge-division product, and at radix 4 that is 2^depth", () => {
  it("agrees with the geometric oracle's denominator, depth 0 to 8", () => {
    // `descend` multiplies the denominator by the edge division at every actual
    // cut of an actual triangle. Nothing in it knows what a depth is.
    for (let d = 0; d <= 8; d++) {
      const word = Array.from({ length: d }, () => 0);
      expect(descend(ROOT, EDGE_DIVISION, word).den).toBe(scaleOfDepth(d));
    }
  });

  it("is the same down EVERY address, not just the leftmost", () => {
    // A scale that depended on WHICH children were taken would be a scale that
    // is not a function of the address length, and the whole bijection would be
    // false. Exhaustive over all 4^4 = 256 addresses of depth 4.
    const want = scaleOfDepth(4);
    const walk = (tri: typeof ROOT, left: number): void => {
      if (left === 0) {
        expect(tri.den).toBe(want);
        return;
      }
      for (const kid of subdivide(tri, EDGE_DIVISION)) walk(kid, left - 1);
    };
    walk(ROOT, 4);
  });

  it("the child count is the SQUARE of the edge division, not the edge division", () => {
    // The one confusion this module exists to prevent: `2 ** depth` and
    // `4 ** depth` were both in the old code and they are different quantities.
    expect(alphabet(EDGE_DIVISION).length).toBe(cellsAtScale(EDGE_DIVISION));
    expect(cellsAtScale(scaleOfDepth(5))).toBe(4 ** 5);
    expect(uprightsAt(EDGE_DIVISION)).toBe(upCount(EDGE_DIVISION));
  });

  it("the radix is a constant function of the address today", () => {
    // Not an interesting fact; it is a REGRESSION GUARD on the signature. If a
    // schedule ever lands, this test is the one that has to be rewritten, which
    // is the notice that the bijection above stopped holding.
    for (const word of ["", "A", "ABX", "XXXXX", "s3:AB"]) {
      for (let i = 0; i < word.length; i++) {
        expect(radixAt(word, i)).toBe(EDGE_DIVISION);
      }
    }
  });
});

// ── 2. divisibility agrees with ordering — here, and only here ───────────

describe("resolution comparison: divisibility, which at radix 4 IS ordering", () => {
  it("refines(scale(a), scale(b)) === (a <= b) for every pair of depths 0..10", () => {
    for (let a = 0; a <= 10; a++) {
      for (let b = 0; b <= 10; b++) {
        expect(refines(scaleOfDepth(a), scaleOfDepth(b))).toBe(a <= b);
      }
    }
  });

  it("is a TOTAL order at radix 4 — any two scales are comparable", () => {
    for (let a = 0; a <= 8; a++) {
      for (let b = 0; b <= 8; b++) {
        const s = scaleOfDepth(a);
        const t = scaleOfDepth(b);
        expect(refines(s, t) || refines(t, s)).toBe(true);
      }
    }
  });

  /**
   * THE HALF THAT JUSTIFIES THE CHANGE, and it is measurable today.
   *
   * A mixed tree built by the oracle: rep-9 at the root, then rep-4 or rep-9 by
   * the parity of the first digit, then stop. Every leaf is at DEPTH 2 and the
   * leaves carry two different scales, so depth orders nothing — which is
   * `docs/rep-tile-findings.md`'s MIX-C finding in miniature (354 leaves, all
   * depth 3, scales 12, 18 and 27).
   *
   * The scales here are 6 and 9. Neither divides the other, so they are
   * INCOMPARABLE — a state `≤` cannot express at all, since `6 ≤ 9` is true and
   * says nothing true about containment. That is the defect the old spelling
   * would have shipped, and it is why the comparison had to become divisibility
   * before a second radix could exist rather than after.
   */
  it("stops agreeing with ordering the moment a second radix exists", () => {
    const tree = buildTree((path) =>
      path.length === 0 ? 3 : path.length === 1 ? (path[0] % 2 === 0 ? 2 : 3) : 1
    );
    const leaves = tree.leaves.map((i) => tree.nodes[i]);

    expect(leaves.length).toBeGreaterThan(0);
    // Every leaf at one depth — depth has stopped distinguishing anything.
    expect(new Set(leaves.map((n) => n.path.length))).toEqual(new Set([2]));
    // Two resolutions among them.
    const scales = [...new Set(leaves.map((n) => n.tri.den))].sort((a, b) => a - b);
    expect(scales).toEqual([6, 9]);

    // Ordering says one is finer. Divisibility says neither contains the other,
    // which is the true statement.
    expect(6 <= 9).toBe(true);
    expect(refines(6, 9)).toBe(false);
    expect(refines(9, 6)).toBe(false);

    // And both refine the common grid, which is what `Tree.refinement` is.
    expect(tree.refinement).toBe(18);
    for (const s of scales) expect(refines(s, tree.refinement)).toBe(true);
  });
});

// ── 3. an address determines its own scale ───────────────────────────────

describe("an address determines its own scale", () => {
  it("scaleOfWord needs no figure, no node and no tree", () => {
    // Called with nothing but a string. If a radix were ever per-node DATA this
    // function could not exist, and `plate.ts`'s "prefix = ancestry" would lose
    // its meaning — Q2's DERIVED address rule, which is a design constraint
    // rather than a bug to find later.
    expect(scaleOfWord("")).toBe(1);
    expect(scaleOfWord("A")).toBe(scaleOfDepth(1));
    expect(scaleOfWord("ABX")).toBe(scaleOfDepth(3));
    expect(scaleOfWord("XXXXXXX")).toBe(scaleOfDepth(7));
  });

  it("every cell of the figure reports the figure's scale, from its address alone", () => {
    const fig = buildFigure(4);
    for (const c of fig.cells) expect(scaleOfWord(c.addr)).toBe(fig.scale);
  });

  it("every PREFIX reports the scale of the level it names", () => {
    // The property the plate's ancestor walk rests on: truncating an address is
    // coarsening it, and the scale follows the truncation exactly.
    const fig = buildFigure(4);
    for (const c of fig.cells) {
      for (let k = 0; k <= c.addr.length; k++) {
        expect(scaleOfWord(c.addr.slice(0, k))).toBe(scaleOfDepth(k));
      }
    }
  });

  it("the sector tag is not a cut — a hexagon address scales by its word only", () => {
    const hex = buildHexagon(3);
    const book = addressBook(hex);
    for (const a of book.addr) {
      expect(scaleOfWord(wordOf(a, book.stem))).toBe(book.scale);
      // Counting the three-character tag would make every address three levels
      // finer than it is, which is the failure this asserts against.
      expect(scaleOfWord(a)).not.toBe(book.scale);
    }
  });
});

// ── 4. everything that carries a scale carries the same one ──────────────

describe("the carried scale agrees everywhere", () => {
  for (const d of [1, 2, 3, 4]) {
    it(`figure, hexagon, lattice view and address book agree at depth ${d}`, () => {
      const want = scaleOfDepth(d);
      const fig = buildFigure(d);
      const hex = buildHexagon(d);

      expect(fig.scale).toBe(want);
      expect(hex.scale).toBe(want);
      expect(hex.base.scale).toBe(want);
      expect(latticeView(fig).scale).toBe(want);
      expect(latticeView(hex).scale).toBe(want);
      expect(addressBook(fig).scale).toBe(want);
      expect(addressBook(hex).scale).toBe(want);
    });

    it(`the counts derived from that scale match what is actually there at depth ${d}`, () => {
      const fig = buildFigure(d);
      const hex = buildHexagon(d);

      // Cell count: scale², and six of them on the hexagon.
      expect(cellsAtScale(fig.scale)).toBe(fig.cells.length);
      expect(6 * cellsAtScale(hex.scale)).toBe(hex.cells.length);
      // The file-format boundary lands on the same numbers.
      expect(cellCount("triangle", d)).toBe(fig.cells.length);
      expect(cellCount("hexagon", d)).toBe(hex.cells.length);

      // The arm size, counted rather than predicted — `armCensus` reports both.
      const census = armCensus(fig);
      expect(armCellsAtScale(fig.scale)).toBe(census.predicted);
      expect(census.sizes.A).toBe(census.predicted);
      expect(census.even).toBe(true);

      // The gasket, which is the count that is NOT a function of the scale:
      // `gasketCells` throws unless the figure holds exactly this many.
      expect(gasketCells(fig).length).toBe(gasketAtDepth(d));
      expect(gasketCells(hex).length).toBe(6 * gasketAtDepth(d));
    });
  }

  it("the gasket count is not recoverable from the scale once the radix varies", () => {
    // Stated as a measurement so the claim in `scale.gasketAtDepth`'s comment is
    // not just an assertion in prose: two schedules reaching the SAME scale 6
    // hold different numbers of upright words, so no function of the scale alone
    // could return both.
    expect(uprightsAt(2) * uprightsAt(3)).toBe(18);
    expect(uprightsAt(6)).toBe(21);
    expect(2 * 3).toBe(6);
    expect(cellsAtScale(6)).toBe(36);
  });
});
