import { describe, expect, it } from "vitest";
import { buildFigure, H, prefixCharge } from "../src/lib/figure";
import { buildHexagon } from "../src/lib/hexagon";
import { COSET_FILL, FILL } from "../src/lib/palette";
import {
  gasketCells,
  presetCensus,
  presetColours,
  PRESETS,
  PRESET_NAMES,
} from "../src/lib/presets";

const INK = "#a3e635";

// ── the gasket ───────────────────────────────────────────────────────────

describe("the Sierpinski preset", () => {
  it("is exactly 3^d cells of the 4^d on the triangle", () => {
    for (const d of [1, 2, 3, 4, 5]) {
      const f = buildFigure(d);
      const g = gasketCells(f);
      expect(g.length).toBe(3 ** d);
      expect(f.cells.length).toBe(4 ** d);
    }
  });

  it("is 6·3^d on the hexagon — one gasket per sector", () => {
    for (const d of [1, 2, 3, 4]) {
      const h = buildHexagon(d);
      expect(gasketCells(h).length).toBe(6 * 3 ** d);
    }
  });

  it("is exactly the addresses with no X", () => {
    const f = buildFigure(4);
    const g = new Set(gasketCells(f));
    for (const c of f.cells) {
      expect(g.has(c.i)).toBe(!c.addr.includes("X"));
    }
  });

  it("is entirely upright — no X means no inversion", () => {
    for (const d of [1, 2, 3, 4]) {
      const f = buildFigure(d);
      for (const i of gasketCells(f)) expect(f.cells[i].eps).toBe(0);
      const h = buildHexagon(d);
      // On the hexagon the DRAWN orientation flips on odd sectors, so the claim
      // is about the base cell, which is what the gasket is a statement about.
      for (const i of gasketCells(h)) expect(h.cells[i].baseEps).toBe(0);
    }
  });

  it("keeps the three corner children and drops the centre, recursively", () => {
    const f = buildFigure(3);
    const g = new Set(gasketCells(f));
    // Every gasket cell's parent prefix is also all-corner, and no gasket cell
    // lies under an X at any level.
    for (const i of g) {
      for (let k = 1; k <= f.depth; k++) {
        expect(f.cells[i].addr.slice(0, k).includes("X")).toBe(false);
      }
    }
  });

  it("paints the gasket in the ink and leaves the rest bare", () => {
    const f = buildFigure(3);
    const colours = presetColours("sierpinski", f, INK);
    const g = new Set(gasketCells(f));
    for (let i = 0; i < colours.length; i++) {
      expect(colours[i]).toBe(g.has(i) ? INK : null);
    }
    const census = presetCensus("sierpinski", f);
    expect(census.painted).toBe(3 ** 3);
    expect(census.bare).toBe(4 ** 3 - 3 ** 3);
  });
});

// ── the charge presets ───────────────────────────────────────────────────

describe("the V4 charge presets", () => {
  it("reproduce the canonical figure on an apex canvas", () => {
    for (const d of [1, 2, 3, 4]) {
      const f = buildFigure(d, "apex");
      const colours = presetColours("charge-apex", f, INK);
      for (const c of f.cells) expect(colours[c.i]).toBe(FILL[c.charge][c.eps]);
    }
  });

  it("read the ifs figure onto the apex canvas by exact key", () => {
    const apex = buildFigure(3, "apex");
    const ifs = buildFigure(3, "ifs");
    const byKey = new Map(ifs.cells.map((c) => [c.key.join(","), c]));
    const colours = presetColours("charge-ifs", apex, INK);
    for (const c of apex.cells) {
      const other = byKey.get(c.key.join(","));
      expect(other).toBeDefined();
      expect(colours[c.i]).toBe(FILL[other!.charge][other!.eps]);
    }
  });

  it("agree at depth 1 and disagree from depth 2 — the convention, drawn", () => {
    // Depth 1 has no recursion to carry the re-roling down, so the two
    // conventions cut and label the same four triangles.
    const one = buildFigure(1);
    expect(presetColours("charge-apex", one, INK)).toEqual(
      presetColours("charge-ifs", one, INK)
    );
    for (const d of [2, 3, 4]) {
      const f = buildFigure(d);
      const a = presetColours("charge-apex", f, INK);
      const b = presetColours("charge-ifs", f, INK);
      expect(a).not.toEqual(b);
      let differ = 0;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) differ++;
      expect(differ).toBeGreaterThan(0);
    }
  });

  it("are a permutation of one another — the same tiling, relabelled", () => {
    for (const d of [2, 3, 4]) {
      const f = buildFigure(d);
      const count = (xs: (string | null)[]) => {
        const m = new Map<string, number>();
        for (const x of xs) m.set(String(x), (m.get(String(x)) ?? 0) + 1);
        return [...m].sort();
      };
      expect(count(presetColours("charge-apex", f, INK))).toEqual(
        count(presetColours("charge-ifs", f, INK))
      );
    }
  });

  it("paint every cell on both canvases", () => {
    for (const canvas of [buildFigure(3), buildHexagon(2)]) {
      for (const name of ["charge-apex", "charge-ifs", "coset"] as const) {
        const census = presetCensus(name, canvas);
        expect(census.bare).toBe(0);
        expect(census.painted).toBe(canvas.cells.length);
      }
    }
  });

  it("work on the hexagon, per sector", () => {
    const h = buildHexagon(2);
    const colours = presetColours("charge-apex", h, INK);
    for (const c of h.cells) expect(colours[c.i]).toBe(FILL[c.charge][c.eps]);
    // Six sectors, and each one is the base figure's colouring under rotation:
    // the multiset of colours is the same in every sector.
    const perSector = new Map<number, string[]>();
    for (const c of h.cells) {
      const list = perSector.get(c.sector) ?? [];
      list.push(colours[c.i] as string);
      perSector.set(c.sector, list);
    }
    const sig = (xs: string[]) => [...xs].sort().join("|");
    const sigs = new Set([...perSector.values()].map(sig));
    // Odd sectors carry the flipped orientation, so there are two signatures,
    // not one — measured, not assumed.
    expect(sigs.size).toBeLessThanOrEqual(2);
  });
});

// ── the coset preset ─────────────────────────────────────────────────────

describe("the coset preset", () => {
  it("is the H / not-H partition in COSET_FILL", () => {
    for (const canvas of [buildFigure(4), buildHexagon(3)]) {
      const colours = presetColours("coset", canvas, INK);
      for (const c of canvas.cells) {
        expect(colours[c.i]).toBe(
          COSET_FILL[H.has(c.charge) ? "H" : "notH"][c.eps]
        );
      }
    }
  });

  it("uses exactly two hues, one per coset", () => {
    const f = buildFigure(4);
    const hues = new Set(presetColours("coset", f, INK));
    // Two cosets times two orientations.
    expect(hues.size).toBe(4);
    for (const h of hues) {
      expect(
        [
          COSET_FILL.H[0],
          COSET_FILL.H[1],
          COSET_FILL.notH[0],
          COSET_FILL.notH[1],
        ]
      ).toContain(h);
    }
  });

  it("agrees with the prefix-charge reading at the top level", () => {
    const f = buildFigure(3);
    const colours = presetColours("coset", f, INK);
    for (const c of f.cells) {
      const inH = H.has(prefixCharge(c.addr, f.depth));
      expect(colours[c.i]).toBe(COSET_FILL[inH ? "H" : "notH"][c.eps]);
    }
  });
});

describe("the preset table", () => {
  it("names every preset exactly once, with a note", () => {
    expect(new Set(PRESET_NAMES).size).toBe(PRESET_NAMES.length);
    for (const n of PRESET_NAMES) {
      expect(PRESETS[n].name).toBe(n);
      expect(PRESETS[n].label.length).toBeGreaterThan(0);
      expect(PRESETS[n].note.length).toBeGreaterThan(0);
    }
  });
});
