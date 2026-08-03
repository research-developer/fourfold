import { describe, expect, it } from "vitest";
import {
  ADJUST_NAMES,
  ADJUSTMENTS,
  adjustCells,
  applyTimes,
  HUE_STEP,
  LIGHT_STEP,
  SAT_STEP,
  sameSwatch,
  type AdjustName,
} from "../src/lib/adjust";
import { normalizeHue, swatch, swatchFromHex, type Swatch } from "../src/lib/schemes";

const BASE = swatch(200, 0.7, 0.5);

/** A spread of starting colours, including both ends of s and of l. */
const PROBES: Swatch[] = [
  swatch(0, 0.7, 0.5),
  swatch(200, 0.7, 0.5),
  swatch(359, 0.7, 0.5),
  swatch(120, 0, 0.5),
  swatch(120, 1, 0.5),
  swatch(120, 0.5, 0),
  swatch(120, 0.5, 1),
  swatch(45, 0.03, 0.97),
  swatch(300, 0.97, 0.03),
];

// ── the catalogue ────────────────────────────────────────────────────────

describe("the adjustments are the eight the UI names", () => {
  it("every name is present exactly once, self-consistent and labelled", () => {
    const want: AdjustName[] = [
      "hue+",
      "hue-",
      "lighten",
      "darken",
      "saturate",
      "desaturate",
      "complement",
      "invert",
    ];
    expect([...ADJUST_NAMES].sort()).toEqual([...want].sort());
    for (const name of ADJUST_NAMES) {
      expect([name, ADJUSTMENTS[name].name]).toEqual([name, name]);
      expect([name, ADJUSTMENTS[name].label.length > 0]).toEqual([name, true]);
    }
  });

  it("the step sizes are the ones the module advertises", () => {
    expect([HUE_STEP, LIGHT_STEP, SAT_STEP]).toEqual([15, 0.08, 0.1]);
    // 15° is a twenty-fourth of the wheel — the whole point of choosing it.
    expect(360 / HUE_STEP).toBe(24);
  });
});

// ── totality ─────────────────────────────────────────────────────────────

describe("no adjustment can produce a colour that is not a colour", () => {
  it("h stays in [0, 360), s and l stay in [0, 1], hex stays canonical", () => {
    for (const name of ADJUST_NAMES) {
      const adj = ADJUSTMENTS[name];
      for (const p of PROBES) {
        let c = p;
        for (let k = 0; k < 40; k++) {
          c = adj.apply(c);
          expect([name, k, c.h >= 0, c.h < 360]).toEqual([name, k, true, true]);
          expect([name, k, c.s >= 0, c.s <= 1]).toEqual([name, k, true, true]);
          expect([name, k, c.l >= 0, c.l <= 1]).toEqual([name, k, true, true]);
          expect([name, k, /^#[0-9a-f]{6}$/.test(c.hex)]).toEqual([
            name,
            k,
            true,
          ]);
        }
      }
    }
  });

  it("apply never mutates the swatch it was handed", () => {
    for (const name of ADJUST_NAMES) {
      const before = swatch(200, 0.7, 0.5);
      const snapshot = { ...before };
      ADJUSTMENTS[name].apply(before);
      expect([name, before]).toEqual([name, snapshot]);
    }
  });
});

// ── each adjustment does what its name says ──────────────────────────────

describe("the transforms are exactly what they claim", () => {
  it("hue± move the hue by 15° and touch nothing else", () => {
    for (const p of PROBES) {
      const up = ADJUSTMENTS["hue+"].apply(p);
      const down = ADJUSTMENTS["hue-"].apply(p);
      expect([p.h, up.h]).toEqual([p.h, normalizeHue(p.h + 15)]);
      expect([p.h, down.h]).toEqual([p.h, normalizeHue(p.h - 15)]);
      expect([p.h, up.s, up.l]).toEqual([p.h, p.s, p.l]);
      expect([p.h, down.s, down.l]).toEqual([p.h, p.s, p.l]);
    }
  });

  it("complement is +180° and an involution", () => {
    for (const p of PROBES) {
      const c = ADJUSTMENTS.complement.apply(p);
      expect([p.h, c.h]).toEqual([p.h, normalizeHue(p.h + 180)]);
      expect([p.h, c.s, c.l]).toEqual([p.h, p.s, p.l]);
      expect([p.h, sameSwatch(ADJUSTMENTS.complement.apply(c), p)]).toEqual([
        p.h,
        true,
      ]);
    }
  });

  it("invert is l ↦ 1 − l with hue and saturation untouched", () => {
    for (const p of PROBES) {
      const c = ADJUSTMENTS.invert.apply(p);
      expect([p.l, c.l]).toEqual([p.l, 1 - p.l]);
      expect([p.l, c.h, c.s]).toEqual([p.l, p.h, p.s]);
    }
  });

  it("invert is an involution on dyadic lightness, and near-one elsewhere", () => {
    /**
     * `1 − (1 − l)` is not `l` for every double: at l = 0.03 it comes back as
     * 0.030000000000000027, because 0.97 is not representable and the round
     * trip carries the error. Exact where l is dyadic — which includes every
     * end and midpoint a UI slider lands on — and within a rounding elsewhere.
     * Stated as measured rather than as an exact involution it is not.
     */
    for (const l of [0, 0.125, 0.25, 0.5, 0.75, 1]) {
      const p = swatch(200, 0.7, l);
      expect([l, sameSwatch(applyTimes(ADJUSTMENTS.invert, p, 2), p)]).toEqual([
        l,
        true,
      ]);
    }
    let inexact = 0;
    let worst = 0;
    for (let k = 0; k <= 100; k++) {
      const l = k / 100;
      const p = swatch(200, 0.7, l);
      const back = applyTimes(ADJUSTMENTS.invert, p, 2);
      if (back.l !== p.l) inexact++;
      worst = Math.max(worst, Math.abs(back.l - p.l));
    }
    expect(inexact).toBeGreaterThan(0);
    expect(worst).toBeLessThan(1e-15);
  });

  it("lighten/darken move l only, saturate/desaturate move s only", () => {
    const mid = swatch(200, 0.5, 0.5);
    expect(ADJUSTMENTS.lighten.apply(mid).l).toBeCloseTo(0.58, 12);
    expect(ADJUSTMENTS.darken.apply(mid).l).toBeCloseTo(0.42, 12);
    expect(ADJUSTMENTS.saturate.apply(mid).s).toBeCloseTo(0.6, 12);
    expect(ADJUSTMENTS.desaturate.apply(mid).s).toBeCloseTo(0.4, 12);
    for (const name of ["lighten", "darken"] as const) {
      const c = ADJUSTMENTS[name].apply(mid);
      expect([name, c.h, c.s]).toEqual([name, mid.h, mid.s]);
    }
    for (const name of ["saturate", "desaturate"] as const) {
      const c = ADJUSTMENTS[name].apply(mid);
      expect([name, c.h, c.l]).toEqual([name, mid.h, mid.l]);
    }
  });
});

// ── the twenty-four-step hue cycle, measured honestly ────────────────────

describe("hue+ twenty-four times is one full turn", () => {
  it("EXACT for every one of the 360 integer starting degrees", () => {
    for (let h = 0; h < 360; h++) {
      const start = swatch(h, 0.7, 0.5);
      expect([h, applyTimes(ADJUSTMENTS["hue+"], start, 24)]).toEqual([
        h,
        start,
      ]);
      expect([h, applyTimes(ADJUSTMENTS["hue-"], start, 24)]).toEqual([
        h,
        start,
      ]);
    }
  });

  it("the intermediate steps walk the twenty-four-point grid", () => {
    const start = swatch(0, 0.7, 0.5);
    const walked: number[] = [];
    let c = start;
    for (let k = 0; k < 24; k++) {
      c = ADJUSTMENTS["hue+"].apply(c);
      walked.push(c.h);
    }
    expect(walked).toEqual([
      15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180, 195, 210, 225, 240,
      255, 270, 285, 300, 315, 330, 345, 0,
    ]);
  });

  it("NOT exact for an arbitrary hue recovered from a hex — but the colour is", () => {
    /**
     * The brief asks for an exact return at every starting hue. Measured, that
     * is false: `h + 15` is not representable when the sum crosses a binade the
     * addend does not fit in, and a hue recovered from a hex triple is an
     * arbitrary double rather than a grid point. The measurement wins, and this
     * is what it actually shows — a drift under 1e-12 degrees, and a rendered
     * colour that is bit-identical, which is the part a drawing program cares
     * about.
     */
    let drifted = 0;
    let worst = 0;
    let probes = 0;
    for (let r = 0; r < 256; r += 11) {
      for (let g = 0; g < 256; g += 13) {
        for (let b = 0; b < 256; b += 17) {
          const hex =
            "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
          const start = swatchFromHex(hex);
          const back = applyTimes(ADJUSTMENTS["hue+"], start, 24);
          probes++;
          if (back.h !== start.h) drifted++;
          worst = Math.max(worst, Math.abs(back.h - start.h));
          expect([hex, back.hex]).toEqual([hex, start.hex]);
        }
      }
    }
    expect(probes).toBeGreaterThan(1000);
    expect(drifted).toBeGreaterThan(0);
    expect(worst).toBeLessThan(1e-12);
  });
});

// ── clamping, stated as it is rather than as one would like it ───────────

describe("lightness and saturation clamp, and clamping is not reversible", () => {
  it("lighten saturates at white and darken at black", () => {
    const white = swatch(200, 0.7, 1);
    const black = swatch(200, 0.7, 0);
    expect(sameSwatch(ADJUSTMENTS.lighten.apply(white), white)).toBe(true);
    expect(sameSwatch(ADJUSTMENTS.darken.apply(black), black)).toBe(true);
    expect(applyTimes(ADJUSTMENTS.lighten, BASE, 50).l).toBe(1);
    expect(applyTimes(ADJUSTMENTS.darken, BASE, 50).l).toBe(0);
  });

  it("saturate saturates at full chroma and desaturate at grey", () => {
    const full = swatch(200, 1, 0.5);
    const grey = swatch(200, 0, 0.5);
    expect(sameSwatch(ADJUSTMENTS.saturate.apply(full), full)).toBe(true);
    expect(sameSwatch(ADJUSTMENTS.desaturate.apply(grey), grey)).toBe(true);
    expect(applyTimes(ADJUSTMENTS.saturate, BASE, 50).s).toBe(1);
    expect(applyTimes(ADJUSTMENTS.desaturate, BASE, 50).s).toBe(0);
  });

  it("darken ∘ lighten does NOT restore a colour near white", () => {
    const near = swatch(200, 0.7, 0.98);
    const up = ADJUSTMENTS.lighten.apply(near);
    expect(up.l).toBe(1);
    const back = ADJUSTMENTS.darken.apply(up);
    expect(back.l).toBeCloseTo(0.92, 12);
    expect(back.l).not.toBe(near.l);
  });

  it("away from the ends it restores only to within float rounding", () => {
    const back = ADJUSTMENTS.darken.apply(ADJUSTMENTS.lighten.apply(BASE));
    expect(back.l).not.toBe(BASE.l);
    expect(back.l).toBeCloseTo(BASE.l, 12);
  });
});

// ── adjustCells ──────────────────────────────────────────────────────────

describe("adjustCells edits the plate and nothing else", () => {
  const plate = (): Map<number, Swatch> =>
    new Map([
      [3, swatch(200, 0.7, 0.5)],
      [7, swatch(10, 0.7, 0.5)],
      [9, swatch(120, 1, 0.5)],
    ]);

  it("an unpainted cell is skipped, never invented", () => {
    const p = plate();
    const got = adjustCells(p, [0, 1, 2, 4, 5, 6, 8], ADJUSTMENTS.lighten);
    expect(got.size).toBe(0);
    const mixed = adjustCells(p, [0, 3, 99], ADJUSTMENTS.lighten);
    expect([...mixed.keys()]).toEqual([3]);
  });

  it("an empty plate cannot be adjusted into existence", () => {
    for (const name of ADJUST_NAMES) {
      const got = adjustCells(new Map(), [0, 1, 2, 3], ADJUSTMENTS[name]);
      expect([name, got.size]).toEqual([name, 0]);
    }
  });

  it("a no-op is dropped rather than reported as an edit", () => {
    // Cell 9 is already at full saturation, so `saturate` changes nothing there.
    const got = adjustCells(plate(), [3, 7, 9], ADJUSTMENTS.saturate);
    expect([...got.keys()].sort((a, b) => a - b)).toEqual([3, 7]);
  });

  it("a repeated cell is adjusted once, not once per mention", () => {
    const p = plate();
    const once = adjustCells(p, [3], ADJUSTMENTS.lighten);
    const many = adjustCells(p, [3, 3, 3, 3], ADJUSTMENTS.lighten);
    expect(many.size).toBe(1);
    expect(sameSwatch(many.get(3)!, once.get(3)!)).toBe(true);
    expect(many.get(3)!.l).toBeCloseTo(0.58, 12);
  });

  it("the plate handed in is left exactly as it was", () => {
    const p = plate();
    const snapshot = [...p.entries()].map(([k, v]) => [k, { ...v }]);
    adjustCells(p, [3, 7, 9], ADJUSTMENTS["hue+"]);
    expect([...p.entries()].map(([k, v]) => [k, { ...v }])).toEqual(snapshot);
  });

  it("every returned swatch is the adjustment applied to what was there", () => {
    const p = plate();
    for (const name of ADJUST_NAMES) {
      const got = adjustCells(p, [3, 7, 9], ADJUSTMENTS[name]);
      for (const [cell, after] of got) {
        const want = ADJUSTMENTS[name].apply(p.get(cell)!);
        expect([name, cell, sameSwatch(after, want)]).toEqual([name, cell, true]);
        expect([name, cell, sameSwatch(after, p.get(cell)!)]).toEqual([
          name,
          cell,
          false,
        ]);
      }
    }
  });
});
