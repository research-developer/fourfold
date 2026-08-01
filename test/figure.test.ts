import { describe, expect, it } from "vitest";
import {
  AXES,
  buildFigure,
  coherent,
  firstNonX,
  H,
  inPhase,
  prefixCharge,
  type Axis,
} from "../src/lib/figure";
import {
  analyseClaim,
  AXIS_VALUE,
  MAX_CLAIM,
  MIN_CLAIM,
  newGame,
  submitClaim,
  toggleCell,
} from "../src/lib/game";

import golden2 from "./golden/golden_d2.json";
import golden3 from "./golden/golden_d3.json";
import golden4 from "./golden/golden_d4.json";

interface GoldenCell {
  i: number;
  addr: string;
  charge: number;
  eps: number;
  ftype: string;
  // Widened to match what `resolveJsonModule` infers from the fixtures.
  verts: number[][];
  mirror: Record<string, number>;
  coherentAxes: string[];
  centroid: number[];
}
interface Golden {
  depth: number;
  count: number;
  hub: number;
  cells: GoldenCell[];
}

const GOLDENS: Golden[] = [
  golden2 as Golden,
  golden3 as Golden,
  golden4 as Golden,
];

/**
 * The Python reference (game_theorem.py) enumerates the figure with exact
 * Fraction arithmetic and derives mirror partners geometrically. These
 * fixtures are its output. If the TypeScript ever drifts from it, the game
 * is scoring something the mathematics does not say.
 *
 * The fixtures are sorted by ADDRESS; the TS builder emits recursion order.
 * We join on address rather than assuming the orders coincide.
 */
describe("figure matches the Python reference", () => {
  for (const g of GOLDENS) {
    describe(`depth ${g.depth}`, () => {
      const fig = buildFigure(g.depth);
      const byAddr = new Map(fig.cells.map((c) => [c.addr, c]));
      const goldByAddr = new Map(g.cells.map((c) => [c.addr, c]));
      const goldIdxToAddr = new Map(g.cells.map((c) => [c.i, c.addr]));

      it("has the same cell count and address set", () => {
        expect(fig.cells.length).toBe(g.count);
        expect(new Set(byAddr.keys())).toEqual(new Set(goldByAddr.keys()));
      });

      it("agrees on charge and orientation for every cell", () => {
        for (const gc of g.cells) {
          const c = byAddr.get(gc.addr)!;
          expect([gc.addr, c.charge]).toEqual([gc.addr, gc.charge]);
          expect([gc.addr, c.eps]).toEqual([gc.addr, gc.eps]);
          expect([gc.addr, c.ftype]).toEqual([gc.addr, gc.ftype]);
        }
      });

      it("agrees on every mirror partner across all three medians", () => {
        for (const gc of g.cells) {
          const c = byAddr.get(gc.addr)!;
          for (const ax of AXES) {
            const mineAddr = fig.cells[c.mirror[ax]].addr;
            const theirsAddr = goldIdxToAddr.get(gc.mirror[ax])!;
            expect([gc.addr, ax, mineAddr]).toEqual([
              gc.addr,
              ax,
              theirsAddr,
            ]);
          }
        }
      });

      it("agrees on which axes are charge-coherent", () => {
        for (const gc of g.cells) {
          const c = byAddr.get(gc.addr)!;
          expect([gc.addr, c.coherentAxes]).toEqual([
            gc.addr,
            gc.coherentAxes as Axis[],
          ]);
        }
      });

      it("agrees on geometry to sub-pixel precision", () => {
        for (const gc of g.cells) {
          const c = byAddr.get(gc.addr)!;
          for (let v = 0; v < 3; v++) {
            expect(c.verts[v][0]).toBeCloseTo(gc.verts[v][0], 3);
            expect(c.verts[v][1]).toBeCloseTo(gc.verts[v][1], 3);
          }
        }
      });
    });
  }
});

/**
 * The structural theorem the whole game rests on. Stated independently of
 * the fixtures so it is tested at depths the fixtures do not cover.
 */
describe("the ftype theorem", () => {
  for (const depth of [2, 3, 4, 5]) {
    it(`holds at depth ${depth}`, () => {
      const fig = buildFigure(depth);
      const hub = "X".repeat(depth);
      for (const c of fig.cells) {
        const isHub = c.addr === hub;
        // m_A is an exact symmetry: every cell is coherent across it.
        expect(c.coherentAxes).toContain("A");
        // The diagonals work only for their own ftype class, plus the hub.
        expect(c.coherentAxes.includes("B")).toBe(c.ftype === "B" || isHub);
        expect(c.coherentAxes.includes("C")).toBe(c.ftype === "C" || isHub);
      }
    });

    it(`counts (4^d-1)/3 + 1 coherent cells per diagonal at depth ${depth}`, () => {
      const fig = buildFigure(depth);
      const expected = (4 ** depth - 1) / 3 + 1;
      for (const ax of ["B", "C"] as Axis[]) {
        const n = fig.cells.filter((c) => c.coherentAxes.includes(ax)).length;
        expect(n).toBe(expected);
      }
    });
  }
});

describe("mirror maps are involutions that preserve orientation", () => {
  for (const depth of [2, 3, 4, 5]) {
    it(`depth ${depth}`, () => {
      const fig = buildFigure(depth);
      for (const c of fig.cells) {
        for (const ax of AXES) {
          const p = fig.cells[c.mirror[ax]];
          expect(p.mirror[ax]).toBe(c.i);
          expect(p.eps).toBe(c.eps);
        }
      }
    });
  }
});

describe("coherence is the H-coset relation", () => {
  it("gold/purple pair with each other, blue/red with each other", () => {
    expect(coherent(0, 0)).toBe(true); // gold-gold
    expect(coherent(0, 3)).toBe(true); // gold-purple
    expect(coherent(3, 3)).toBe(true); // purple-purple
    expect(coherent(1, 2)).toBe(true); // red-blue
    expect(coherent(2, 2)).toBe(true); // blue-blue
    expect(coherent(0, 1)).toBe(false); // gold-red
    expect(coherent(3, 2)).toBe(false); // purple-blue
  });
});

describe("firstNonX", () => {
  it("skips leading centres and reports the hub as empty", () => {
    expect(firstNonX("XXBA")).toBe("B");
    expect(firstNonX("ABXC")).toBe("A");
    expect(firstNonX("XXXX")).toBe("");
  });
});

describe("claim scoring", () => {
  const fig = buildFigure(3);

  it("gives nothing to an unpaired cell", () => {
    const lone = fig.cells.find((c) => c.mirror.A !== c.i)!;
    const a = analyseClaim(fig, new Set([lone.i]));
    expect(a.points).toBe(0);
    expect(a.valid).toBe(false);
    expect(a.dead).toEqual([lone.i]);
  });

  it("scores a vertical pair at +1 per cell", () => {
    const c = fig.cells.find((x) => x.mirror.A !== x.i)!;
    const a = analyseClaim(fig, new Set([c.i, c.mirror.A]));
    expect(a.points).toBe(2 * AXIS_VALUE.A);
    // Two cells is still short of a complete symmetry.
    expect(a.valid).toBe(false);
  });

  it(`needs ${MIN_CLAIM} scoring cells to be valid`, () => {
    const c = fig.cells.find(
      (x) => x.mirror.A !== x.i && x.ftype !== ""
    )!;
    const onAxis = fig.cells.find((x) => x.mirror.A === x.i)!;
    const a = analyseClaim(fig, new Set([c.i, c.mirror.A, onAxis.i]));
    expect(a.verdicts.size).toBe(3);
    expect(a.valid).toBe(true);
  });

  it("pays a diagonal pair more than a vertical pair", () => {
    const b = fig.cells.find(
      (x) => x.ftype === "B" && x.mirror.B !== x.i
    )!;
    const diag = analyseClaim(fig, new Set([b.i, b.mirror.B]));
    const vert = analyseClaim(fig, new Set([b.i, b.mirror.A]));
    expect(diag.points).toBeGreaterThan(vert.points);
  });

  it("stacks axes: the hub pairs on all three", () => {
    const hub = fig.cells[fig.hub];
    expect(hub.coherentAxes.sort()).toEqual(["A", "B", "C"]);
  });

  it("releases dead cells instead of locking them", () => {
    let g = newGame(3);
    // A cell with a genuine partner on both the vertical and its own diagonal.
    const c = g.figure.cells.find(
      (x) => x.ftype === "B" && x.mirror.A !== x.i && x.mirror.B !== x.i
    )!;
    const core = new Set([c.i, c.mirror.A, c.mirror.B]);
    expect(core.size).toBe(3);
    // A cell that cannot score: not self-paired on any axis, and none of its
    // three partners is in the claim.
    const dead = g.figure.cells.find(
      (x) =>
        !core.has(x.i) &&
        AXES.every((ax) => x.mirror[ax] !== x.i && !core.has(x.mirror[ax]))
    )!;
    expect(dead).toBeDefined();
    for (const i of [...core, dead.i]) {
      g = toggleCell(g, i);
    }
    const before = analyseClaim(g.figure, g.selection);
    const after = submitClaim(g);
    // Scoring cells are owned; the unpaired one stays free.
    for (const i of before.verdicts.keys()) expect(after.owner[i]).toBe(0);
    for (const i of before.dead) expect(after.owner[i]).toBeNull();
    expect(after.turn).toBe(1);
    expect(after.scores[0]).toBe(before.points);
  });

  it("refuses a claim made only of cells sitting on a median", () => {
    // Three cells that are each their own m_B partner and have no mirror
    // relation to one another. Before the fix this scored the highest-value
    // axis three times over while demonstrating no symmetry at all.
    const f4 = buildFigure(4);
    const selfB = f4.cells.filter((c) => c.mirror.B === c.i).slice(0, 3);
    expect(selfB.length).toBe(3);
    const ids = new Set(selfB.map((c) => c.i));
    // ...and they really are mutually unrelated.
    for (const c of selfB) {
      for (const ax of AXES) {
        if (c.mirror[ax] !== c.i) expect(ids.has(c.mirror[ax])).toBe(false);
      }
    }
    const a = analyseClaim(f4, ids);
    expect(a.points).toBe(0);
    expect(a.valid).toBe(false);
  });

  it("does not hand out the hub for free", () => {
    const f4 = buildFigure(4);
    const hub = f4.cells[f4.hub];
    // The hub is its own partner on all three medians.
    for (const ax of AXES) expect(hub.mirror[ax]).toBe(hub.i);
    expect(analyseClaim(f4, new Set([hub.i])).points).toBe(0);
  });

  it("pays the hub +7 once all three axes are genuinely witnessed", () => {
    const f4 = buildFigure(4);
    const hub = f4.cells[f4.hub];
    const sel = new Set<number>([hub.i]);
    // One real pair on each axis.
    for (const ax of AXES) {
      const w = f4.cells.find(
        (c) =>
          c.i !== hub.i &&
          c.mirror[ax] !== c.i &&
          c.coherentAxes.includes(ax) &&
          !sel.has(c.i) &&
          !sel.has(c.mirror[ax])
      )!;
      sel.add(w.i);
      sel.add(w.mirror[ax]);
    }
    const a = analyseClaim(f4, sel);
    expect(a.verdicts.get(hub.i)!.points).toBe(7);
    expect(a.verdicts.get(hub.i)!.axes.sort()).toEqual(["A", "B", "C"]);
  });

  it("lets an on-median cell join a symmetry that a real pair witnesses", () => {
    const f4 = buildFigure(4);
    const pair = f4.cells.find((c) => c.mirror.A !== c.i)!;
    const onAxis = f4.cells.find(
      (c) => c.mirror.A === c.i && c.i !== pair.i && c.i !== pair.mirror.A
    )!;
    const a = analyseClaim(f4, new Set([pair.i, pair.mirror.A, onAxis.i]));
    expect(a.verdicts.has(onAxis.i)).toBe(true);
    expect(a.valid).toBe(true);
  });

  it("refuses a board sweep", () => {
    // m_A is an exact symmetry, so a selection of EVERY cell has every cell
    // paired. Without a cap, player one claims the whole board on turn one.
    for (const d of [3, 4]) {
      const f = buildFigure(d);
      const everything = new Set(f.cells.map((c) => c.i));
      const a = analyseClaim(f, everything);
      expect(a.verdicts.size).toBe(f.cells.length); // every cell does pair
      expect(a.valid).toBe(false); // ...and it is still refused
      expect(a.reason).toMatch(/at most/);
    }
  });

  it("will not grow a selection past the cap", () => {
    let g = newGame(4);
    for (const c of g.figure.cells) g = toggleCell(g, c.i);
    expect(g.selection.size).toBe(MAX_CLAIM);
  });

  it("still allows deselecting at the cap", () => {
    let g = newGame(4);
    for (const c of g.figure.cells) g = toggleCell(g, c.i);
    const first = [...g.selection][0];
    g = toggleCell(g, first);
    expect(g.selection.size).toBe(MAX_CLAIM - 1);
    expect(g.selection.has(first)).toBe(false);
  });

  it("refuses a claim that does not stand", () => {
    let g = newGame(3);
    const lone = g.figure.cells.find((c) => c.mirror.A !== c.i)!;
    g = toggleCell(g, lone.i);
    const after = submitClaim(g);
    expect(after).toBe(g); // unchanged
    expect(after.turn).toBe(0);
  });
});

/**
 * Every sub-triangle carries an exact mirror, but the recolouring that
 * realises it depends on the prefix charge: twist t(u) = c(u) XOR phi(c(u)),
 * which is trivial exactly when c(u) lies in H. The Python survey found the
 * split to be exactly even -- 682 in phase, 682 out, at depth 6.
 */
describe("mirror phase", () => {
  const PHI: Record<number, number> = { 0: 0, 1: 2, 2: 1, 3: 3 };

  it("is the H-membership of the prefix charge", () => {
    const fig = buildFigure(5);
    for (const c of fig.cells) {
      for (let k = 0; k <= fig.depth; k++) {
        expect(inPhase(c.addr, k)).toBe(H.has(prefixCharge(c.addr, k)));
      }
    }
  });

  it("is exactly the twist c(u) XOR phi(c(u)) being trivial", () => {
    const fig = buildFigure(4);
    for (const c of fig.cells) {
      for (let k = 0; k <= fig.depth; k++) {
        const cu = prefixCharge(c.addr, k);
        const twist = cu ^ PHI[cu];
        expect(inPhase(c.addr, k)).toBe(twist === 0);
      }
    }
  });

  it("splits the sub-triangles evenly at every depth", () => {
    for (const depth of [3, 4, 5, 6]) {
      const fig = buildFigure(depth);
      const seen = new Map<string, boolean>();
      for (const c of fig.cells) {
        for (let k = 1; k < depth; k++) {
          seen.set(c.addr.slice(0, k), inPhase(c.addr, k));
        }
      }
      const inN = [...seen.values()].filter(Boolean).length;
      const outN = seen.size - inN;
      // (4 + 16 + ... + 4^(d-1)) sub-triangles, split exactly down the middle.
      expect(inN).toBe(outN);
      expect(seen.size).toBe((4 ** depth - 4) / 3);
    }
  });

  it("collapses to the cell's own coset at full depth", () => {
    const fig = buildFigure(4);
    for (const c of fig.cells) {
      expect(inPhase(c.addr, fig.depth)).toBe(H.has(c.charge));
    }
  });
});
