import { describe, expect, it } from "vitest";
import { buildFigure, ID, S2, S2S3, S3, type Charge } from "../src/lib/figure";
import {
  characterReport,
  chargeDivergence,
  exactIsometries,
  isometryReport,
} from "../src/lib/conventions";
import { makeIdentifier } from "../src/lib/identify";

/**
 * These gates exist because docs/symmetry-findings.md section E previously
 * asserted "√6 is genuinely special" -- a claim that is true in the apex
 * convention and false in the ifs one. A doc can drift from the code; a test
 * cannot. Every number quoted in section E is re-derived here.
 */

const DEPTHS = [2, 3, 4, 5] as const;

describe("the two conventions differ ONLY in the labelling", () => {
  for (const d of DEPTHS) {
    it(`depth ${d}: identical geometry, identical orientation`, () => {
      const apex = buildFigure(d, "apex");
      const ifs = buildFigure(d, "ifs");

      expect(apex.cells.length).toBe(ifs.cells.length);

      // Same set of triangles, located by exact integer key.
      const ka = new Set(apex.cells.map((c) => c.key.join(",")));
      const ki = new Set(ifs.cells.map((c) => c.key.join(",")));
      expect(ka).toEqual(ki);

      // Same orientation everywhere: eps counts X's, and the inverted centre
      // child is the same in both conventions, so it cannot change.
      const byKey = new Map(ifs.cells.map((c) => [c.key.join(","), c]));
      for (const c of apex.cells) {
        expect(byKey.get(c.key.join(","))!.eps).toBe(c.eps);
      }
    });

    it(`depth ${d}: the labelling really does diverge`, () => {
      // If it did not, the toggle would be showing nothing.
      const n = chargeDivergence(buildFigure(d, "apex"), buildFigure(d, "ifs"));
      expect(n).toBeGreaterThan(0);
    });
  }
});

describe("which subgroup of Aut(V4) is realised", () => {
  for (const d of DEPTHS) {
    it(`apex has order 2 at depth ${d} — {id, m_A}`, () => {
      const rows = isometryReport(buildFigure(d, "apex"));
      expect(exactIsometries(rows).sort()).toEqual(["id", "m_A"]);
    });

    it(`ifs has order 6 at depth ${d} — every isometry`, () => {
      const rows = isometryReport(buildFigure(d, "ifs"));
      expect(exactIsometries(rows).sort()).toEqual(
        ["id", "m_A", "m_B", "m_C", "rot+", "rot-"].sort()
      );
    });

    if (d >= 3) {
      it(`apex: every non-exact isometry matches (4^d-1)/3 + 1 at depth ${d}`, () => {
        const expected = (4 ** d - 1) / 3 + 1;
        for (const r of isometryReport(buildFigure(d, "apex"))) {
          if (r.exact) continue;
          expect([r.name, r.matches]).toEqual([r.name, expected]);
        }
      });
    }
  }

  /**
   * Depth 2 is the one exception, and it is recorded rather than skipped.
   *
   * The ftype construction gives one class plus the hub = 5 + 1 = 6, but the
   * best permutation reaches 7: at 16 cells a relabelling can pick up an extra
   * cell by coincidence, which is why the closed form is a lower bound that
   * only becomes tight from d = 3. docs/symmetry-findings.md section C quotes
   * the table from d = 3 onward for this reason.
   */
  it("apex: depth 2 beats the closed form by exactly one cell", () => {
    const expected = (4 ** 2 - 1) / 3 + 1; // 6
    for (const r of isometryReport(buildFigure(2, "apex"))) {
      if (r.exact) continue;
      expect([r.name, r.matches]).toEqual([r.name, expected + 1]);
    }
  });

  it("ifs: rot+ realises a 3-cycle on the non-identity elements", () => {
    const rows = isometryReport(buildFigure(4, "ifs"));
    const rot = rows.find((r) => r.name === "rot+")!;
    expect(rot.exact).toBe(true);
    // 1 -> 1, s2 -> s2s3, s3 -> s2, s2s3 -> s3.
    expect(rot.best[ID]).toBe(ID);
    expect(rot.best[S2]).toBe(S2S3);
    expect(rot.best[S3]).toBe(S2);
    expect(rot.best[S2S3]).toBe(S3);
    // ...so Aut(V4) acts transitively on the three quadratic subfields, and
    // none of them is canonical.
    const orbit = new Set<Charge>([S2, rot.best[S2], rot.best[rot.best[S2]]]);
    expect(orbit).toEqual(new Set([S2, S3, S2S3]));
  });
});

describe("section E's character table, re-derived", () => {
  it("apex at d=6: only m_A carries a character, and it is χ√6", () => {
    const r = characterReport(buildFigure(6, "apex"));
    expect(r.chi6.m_A).toBe(4096);
    expect(r.chi6.m_B).toBe(1366);
    expect(r.chi6.m_C).toBe(1366);
    expect(r.chi3.m_A).toBe(2048);
    expect(r.chi3.m_B).toBe(2048);
    expect(r.chi3.m_C).toBe(2050);
    expect(r.chi2.m_A).toBe(2048);
    expect(r.chi2.m_B).toBe(2050);
    expect(r.chi2.m_C).toBe(2048);
  });

  it("ifs at d=6: each median carries a DIFFERENT character exactly", () => {
    const r = characterReport(buildFigure(6, "ifs"));
    expect(r.chi6.m_A).toBe(4096);
    expect(r.chi2.m_B).toBe(4096);
    expect(r.chi3.m_C).toBe(4096);
    // ...and nothing else is exact.
    expect(r.chi6.m_B).toBe(2048);
    expect(r.chi6.m_C).toBe(2048);
    expect(r.chi3.m_A).toBe(2048);
    expect(r.chi3.m_B).toBe(2048);
    expect(r.chi2.m_A).toBe(2048);
    expect(r.chi2.m_C).toBe(2048);
  });

  it("under m_A, χ√3 and χ√2 CANNOT differ — the 2050 was a wrong column", () => {
    // m_A fixes gold and purple and swaps blue with red, so both characters
    // are preserved on exactly the gold-or-purple cells. The old doc gave
    // 2048 and 2050; they must be equal, and equal to #gold + #purple.
    for (const conv of ["apex", "ifs"] as const) {
      const fig = buildFigure(6, conv);
      const r = characterReport(fig);
      expect(r.chi3.m_A).toBe(r.chi2.m_A);
      const goldPurple = fig.cells.filter(
        (c) => c.charge === ID || c.charge === S2S3
      ).length;
      expect(r.chi3.m_A).toBe(goldPurple);
    }
  });
});

describe("the extracted identifier is carrier-agnostic", () => {
  it("scores an abstract carrier that knows nothing about triangles", () => {
    // Four sites on one axis: 0<->1 coherent, 2<->3 not.
    type Ax = "m";
    const sites = [
      { charge: 0, mirror: { m: 1 } },
      { charge: 0, mirror: { m: 0 } },
      { charge: 0, mirror: { m: 3 } },
      { charge: 1, mirror: { m: 2 } },
    ];
    const identify = makeIdentifier<Ax>({
      axes: ["m"],
      coherent: (a, b) => a === b,
      axisValue: { m: 5 },
      minClaim: 2,
      maxClaim: 4,
    });
    const r = identify(sites, new Set([0, 1, 2, 3]));
    expect(r.points).toBe(10); // only the 0<->1 pair scores
    expect(r.dead.sort()).toEqual([2, 3]);
    expect(r.valid).toBe(true);
  });

  it("still refuses on-axis sites that witness nothing", () => {
    // Three sites each their own partner, mutually unrelated: the exploit
    // closed in PR #3, re-checked at the extracted layer.
    type Ax = "m";
    const sites = [
      { charge: 0, mirror: { m: 0 } },
      { charge: 0, mirror: { m: 1 } },
      { charge: 0, mirror: { m: 2 } },
    ];
    const identify = makeIdentifier<Ax>({
      axes: ["m"],
      coherent: () => true,
      axisValue: { m: 3 },
      minClaim: 2,
      maxClaim: 12,
    });
    const r = identify(sites, new Set([0, 1, 2]));
    expect(r.points).toBe(0);
    expect(r.valid).toBe(false);
  });
});
