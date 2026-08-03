import { describe, expect, it } from "vitest";
import {
  ARMS,
  armCells,
  armCensus,
  armMask,
  armOf,
  armOfWord,
  clipStamp,
  type Arm,
} from "../src/lib/arms";
import { brushStamp } from "../src/lib/brush";
import { buildBandSurface } from "../src/lib/bands";
import { triangleIndexMap } from "../src/lib/conventions";
import { buildFigure } from "../src/lib/figure";
import { triangleSurface, TRIANGLE_MODES } from "../src/lib/orbit";

const DEPTHS = [1, 2, 3, 4, 5];

// ── the decomposition ────────────────────────────────────────────────────

describe("the three ftype arms", () => {
  it("partition the board minus the hub, at every depth", () => {
    for (const d of DEPTHS) {
      const f = buildFigure(d);
      const seen = new Set<number>();
      for (const arm of ARMS) {
        for (const i of armCells(f, arm)) {
          expect(seen.has(i)).toBe(false);
          seen.add(i);
        }
      }
      expect(seen.size).toBe(f.cells.length - 1);
      expect(seen.has(f.hub)).toBe(false);
      expect(armOf(f, f.hub)).toBeNull();
    }
  });

  it("are congruent and hold (4^d − 1)/3 cells each — §D, measured", () => {
    for (const d of DEPTHS) {
      const c = armCensus(buildFigure(d));
      expect(c.even).toBe(true);
      expect(c.hub).toBe(1);
      expect(c.sizes.A).toBe(c.predicted);
      expect(3 * c.predicted + 1).toBe(c.total);
    }
    // The numbers the findings document quotes as raw data.
    expect(armCensus(buildFigure(6)).predicted + 1).toBe(1366);
  });

  it("are permuted cyclically by the rotation, and only by it", () => {
    const f = buildFigure(4);
    const rot = triangleIndexMap(f, "rot+");
    const cycle: Record<Arm, Arm> = { A: "B", B: "C", C: "A" };
    for (const c of f.cells) {
      const here = armOf(f, c.i);
      const there = armOf(f, rot[c.i]);
      expect(there).toBe(here === null ? null : cycle[here]);
    }
  });

  it("are each fixed by exactly one median — m_D fixes arm D", () => {
    const f = buildFigure(4);
    const fixes: Record<string, Record<Arm, Arm>> = {
      m_A: { A: "A", B: "C", C: "B" },
      m_B: { A: "C", B: "B", C: "A" },
      m_C: { A: "B", B: "A", C: "C" },
    };
    for (const [name, table] of Object.entries(fixes)) {
      const mu = triangleIndexMap(f, name as "m_A");
      for (const c of f.cells) {
        const here = armOf(f, c.i);
        const there = armOf(f, mu[c.i]);
        expect(there).toBe(here === null ? null : table[here]);
      }
    }
  });

  it("reads an arm off an address, and a suffix never changes it", () => {
    expect(armOfWord("ABX")).toBe("A");
    expect(armOfWord("XXB")).toBe("B");
    expect(armOfWord("XXXX")).toBeNull();
    // Stable under extension: every descendant of a cell in arm D is in arm D.
    const f = buildFigure(4);
    for (const c of f.cells) {
      expect(armOfWord(c.addr)).toBe(armOf(f, c.i));
      for (const g of ["A", "B", "C", "X"]) {
        const child = armOfWord(c.addr + g);
        if (armOf(f, c.i) !== null) expect(child).toBe(armOf(f, c.i));
      }
    }
  });
});

// ── isolation ────────────────────────────────────────────────────────────

describe("isolating an arm", () => {
  it("off is the whole triangle", () => {
    const f = buildFigure(3);
    const keep = armMask(f, null);
    expect(f.cells.every((c) => keep(c.i))).toBe(true);
  });

  it("confines a stroke to the arm, hub included in nothing", () => {
    const f = buildFigure(4);
    const surface = triangleSurface(f);
    const bands = buildBandSurface(f);
    for (const arm of ARMS) {
      const keep = armMask(f, arm);
      expect(keep(f.hub)).toBe(false);
      for (const mode of TRIANGLE_MODES) {
        for (const seed of armCells(f, arm).slice(0, 40)) {
          const clipped = clipStamp(
            brushStamp(surface, bands, seed, { mode, band: null }),
            keep
          );
          for (const i of clipped.cells) expect(armOf(f, i)).toBe(arm);
        }
      }
    }
  });

  it("clips a band to the arm too", () => {
    const f = buildFigure(4);
    const surface = triangleSurface(f);
    const bands = buildBandSurface(f);
    const keep = armMask(f, "B");
    const seed = armCells(f, "B")[10];
    const full = brushStamp(surface, bands, seed, { mode: 6, band: "A" });
    const clipped = clipStamp(full, keep);
    expect(clipped.cells.length).toBeGreaterThan(0);
    expect(clipped.cells.length).toBeLessThan(full.cells.length);
    for (const i of clipped.cells) expect(armOf(f, i)).toBe("B");
    // The colour reading is unchanged: the same cells keep the same scheme
    // positions, and the span still counts the subgroup's rows.
    expect(clipped.span).toBe(full.span);
    clipped.cells.forEach((c, k) => {
      expect(clipped.keys[k]).toBe(full.keys[full.cells.indexOf(c)]);
    });
  });

  it("MEASURED: inside an arm mode 3 collapses to mode 1 and mode 6 to mode 2", () => {
    // The setwise stabiliser of arm D in D3 is ⟨m_D⟩, of order 2. Nothing here
    // assumes it — the orbits are computed and the sizes counted.
    const f = buildFigure(4);
    const surface = triangleSurface(f);
    const bands = buildBandSurface(f);
    const sizes = (arm: Arm, mode: 1 | 2 | 3 | 6) => {
      const keep = armMask(f, arm);
      const out = new Set<number>();
      for (const seed of armCells(f, arm)) {
        out.add(
          clipStamp(brushStamp(surface, bands, seed, { mode, band: null }), keep)
            .cells.length
        );
      }
      return [...out].sort((a, b) => a - b);
    };
    expect(sizes("A", 1)).toEqual([1]);
    expect(sizes("A", 3)).toEqual([1]);
    // Arm A's stabiliser IS ⟨m_A⟩, which is mode 2, so mode 2 is untouched
    // there — 2 cells generically and 1 where m_A pins the cell.
    expect(sizes("A", 2)).toEqual([1, 2]);
    expect(sizes("A", 6)).toEqual([1, 2]);
    for (const arm of ["B", "C"] as Arm[]) {
      expect(sizes(arm, 3)).toEqual([1]);
      expect(sizes(arm, 6)).toEqual([1, 2]);
      // m_A does NOT fix arm B, so a mode-2 brush there paints one cell:
      // its partner is in arm C and is clipped away.
      expect(sizes(arm, 2)).toEqual([1]);
    }
  });

  it("clipping is exactly the intersection with the arm, never more", () => {
    const f = buildFigure(3);
    const surface = triangleSurface(f);
    const bands = buildBandSurface(f);
    for (const arm of ARMS) {
      const keep = armMask(f, arm);
      const inArm = new Set(armCells(f, arm));
      for (const c of f.cells) {
        const full = brushStamp(surface, bands, c.i, { mode: 6, band: null });
        const clipped = clipStamp(full, keep);
        expect(clipped.cells).toEqual(full.cells.filter((i) => inArm.has(i)));
      }
    }
  });

  it("an isolated brush seeded on the hub paints nothing", () => {
    // The hub is in no arm, so with isolation on it is unreachable — stated
    // plainly rather than special-cased into whichever arm is selected.
    const f = buildFigure(3);
    const surface = triangleSurface(f);
    const bands = buildBandSurface(f);
    for (const arm of ARMS) {
      const clipped = clipStamp(
        brushStamp(surface, bands, f.hub, { mode: 6, band: null }),
        armMask(f, arm)
      );
      expect(clipped.cells).toEqual([]);
    }
  });
});
