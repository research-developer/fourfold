import { describe, expect, it } from "vitest";
import {
  BREATHE_HIGH,
  BREATHE_LOW,
  BREATHE_PERIOD,
  FADE_FLOOR,
  FADE_RATE,
  HUE_DRIFT_STEP,
  PROGRESSION_NAMES,
  PROGRESSIONS,
  SCHEME_WALK_DEFAULT_HUES,
  schemeWalk,
  type ProgressionName,
} from "../src/lib/progression";
import { normalizeHue, SCHEMES, swatch, type Swatch } from "../src/lib/schemes";

const BASE = swatch(200, 0.7, 0.5);

const BASES: Swatch[] = [
  swatch(0, 0.7, 0.5),
  swatch(200, 0.7, 0.5),
  swatch(359, 1, 0.1),
  swatch(120, 0.25, 0.9),
  swatch(45, 0, 0.5),
  swatch(300, 1, 1),
];

// ── the catalogue ────────────────────────────────────────────────────────

describe("the progressions are the five the UI names", () => {
  it("every name is present exactly once, self-consistent and labelled", () => {
    const want: ProgressionName[] = [
      "off",
      "hue-drift",
      "lightness-breathe",
      "saturation-fade",
      "scheme-walk",
    ];
    expect([...PROGRESSION_NAMES].sort()).toEqual([...want].sort());
    for (const name of PROGRESSION_NAMES) {
      expect([name, PROGRESSIONS[name].name]).toEqual([name, name]);
      expect([name, PROGRESSIONS[name].label.length > 0]).toEqual([name, true]);
    }
  });

  it("the constants are the ones the module advertises", () => {
    expect([HUE_DRIFT_STEP, BREATHE_PERIOD, BREATHE_LOW, BREATHE_HIGH]).toEqual([
      7, 24, 0.3, 0.7,
    ]);
    expect([FADE_FLOOR, FADE_RATE, SCHEME_WALK_DEFAULT_HUES]).toEqual([
      0.25, 0.85, 6,
    ]);
    // "a full wheel in about 51 strokes"
    expect(Math.round(360 / HUE_DRIFT_STEP)).toBe(51);
  });
});

// ── purity, the load-bearing property ────────────────────────────────────

describe("at(base, n) depends on base and n and nothing else", () => {
  /**
   * The reason the app can undo through a progression: nothing accumulates. If
   * `at` ever consulted a hidden counter, an out-of-order sweep would disagree
   * with an in-order one — which is exactly what an undo followed by a redraw
   * is.
   */
  const SHUFFLED = [17, 3, 0, 41, 8, 1, 2, 23, 5, 96, 4, 12, 0, 17, 2];

  it("an out-of-order sweep agrees with an in-order one, every progression", () => {
    for (const name of PROGRESSION_NAMES) {
      const p = PROGRESSIONS[name];
      for (const base of BASES) {
        const inOrder = new Map<number, Swatch>();
        for (let n = 0; n <= 100; n++) inOrder.set(n, p.at(base, n));
        for (const n of SHUFFLED) {
          expect([name, base.hex, n, p.at(base, n)]).toEqual([
            name,
            base.hex,
            n,
            inOrder.get(n),
          ]);
        }
      }
    }
  });

  it("interleaving two bases does not let one leak into the other", () => {
    for (const name of PROGRESSION_NAMES) {
      const p = PROGRESSIONS[name];
      const a = BASES[1];
      const b = BASES[3];
      const cleanA = [0, 1, 2, 3, 4].map((n) => p.at(a, n));
      const cleanB = [0, 1, 2, 3, 4].map((n) => p.at(b, n));
      for (let n = 0; n < 5; n++) {
        p.at(b, n * 13);
        expect([name, n, p.at(a, n)]).toEqual([name, n, cleanA[n]]);
        p.at(a, n * 7);
        expect([name, n, p.at(b, n)]).toEqual([name, n, cleanB[n]]);
      }
    }
  });

  it("no progression mutates the base it was handed", () => {
    for (const name of PROGRESSION_NAMES) {
      const base = swatch(200, 0.7, 0.5);
      const snapshot = { ...base };
      for (let n = 0; n < 30; n++) PROGRESSIONS[name].at(base, n);
      expect([name, base]).toEqual([name, snapshot]);
    }
  });

  it("every progression returns a well-formed swatch at every n", () => {
    for (const name of PROGRESSION_NAMES) {
      for (const base of BASES) {
        for (const n of [-30, -1, 0, 1, 7, 24, 51, 1000]) {
          const c = PROGRESSIONS[name].at(base, n);
          expect([name, n, c.h >= 0, c.h < 360]).toEqual([name, n, true, true]);
          expect([name, n, c.s >= 0, c.s <= 1]).toEqual([name, n, true, true]);
          expect([name, n, c.l >= 0, c.l <= 1]).toEqual([name, n, true, true]);
          expect([name, n, /^#[0-9a-f]{6}$/.test(c.hex)]).toEqual([
            name,
            n,
            true,
          ]);
        }
      }
    }
  });
});

// ── off ──────────────────────────────────────────────────────────────────

describe("off is the identity", () => {
  it("returns the base untouched at every n, including a hex-derived base", () => {
    for (const base of BASES) {
      for (const n of [0, 1, 99, -4]) {
        expect([base.hex, n, PROGRESSIONS.off.at(base, n)]).toEqual([
          base.hex,
          n,
          base,
        ]);
      }
    }
  });
});

// ── hue-drift ────────────────────────────────────────────────────────────

describe("hue-drift walks the wheel at 7° per event", () => {
  it("the hue is exactly base + 7n, and s and l never move", () => {
    const p = PROGRESSIONS["hue-drift"];
    for (const base of BASES) {
      for (let n = 0; n <= 120; n++) {
        const c = p.at(base, n);
        expect([base.hex, n, c.h]).toEqual([
          base.hex,
          n,
          normalizeHue(base.h + HUE_DRIFT_STEP * n),
        ]);
        expect([base.hex, n, c.s, c.l]).toEqual([base.hex, n, base.s, base.l]);
      }
    }
  });

  it("n = 0 is the base itself", () => {
    for (const base of BASES) {
      expect([base.hex, PROGRESSIONS["hue-drift"].at(base, 0)]).toEqual([
        base.hex,
        base,
      ]);
    }
  });

  it("it does NOT close after 51 events — 7 does not divide 360", () => {
    // The "about 51 strokes" in the brief is a feel, not a period. 360/7 is
    // 51.43, so the wheel closes only after 360 events, and the drift never
    // repeats a hue inside one turn.
    const p = PROGRESSIONS["hue-drift"];
    expect(p.at(BASE, 51).h).not.toBe(BASE.h);
    expect(p.at(BASE, 52).h).not.toBe(BASE.h);
    expect(p.at(BASE, 360).h).toBe(BASE.h);
    const hues = new Set(
      Array.from({ length: 360 }, (_, n) => p.at(BASE, n).h)
    );
    expect(hues.size).toBe(360);
  });
});

// ── lightness-breathe ────────────────────────────────────────────────────

describe("lightness-breathe returns instead of running away", () => {
  const p = PROGRESSIONS["lightness-breathe"];

  it("the first quarter-cycle is 0.5 → 0.7 → 0.5 → 0.3 → 0.5", () => {
    const got = [0, 6, 12, 18, 24].map((n) => p.at(BASE, n).l);
    expect(got.map((l) => Math.round(l * 1000) / 1000)).toEqual([
      0.5, 0.7, 0.5, 0.3, 0.5,
    ]);
    // n = 0 is the neutral midpoint, heading up: the first stroke of a drawing
    // must not come out at the dark end of the cycle.
    expect(p.at(BASE, 0).l).toBeCloseTo(0.5, 12);
    expect(p.at(BASE, 1).l).toBeGreaterThan(p.at(BASE, 0).l);
  });

  it("the period is exactly 24 events, at every n and every base", () => {
    for (const base of BASES) {
      for (let n = -30; n <= 60; n++) {
        expect([base.hex, n, p.at(base, n + BREATHE_PERIOD).l]).toEqual([
          base.hex,
          n,
          p.at(base, n).l,
        ]);
      }
    }
  });

  it("lightness stays inside [0.3, 0.7] and reaches both ends", () => {
    const ls = Array.from({ length: 24 }, (_, n) => p.at(BASE, n).l);
    for (const l of ls) {
      expect(l).toBeGreaterThanOrEqual(BREATHE_LOW - 1e-12);
      expect(l).toBeLessThanOrEqual(BREATHE_HIGH + 1e-12);
    }
    expect(Math.min(...ls)).toBeCloseTo(BREATHE_LOW, 12);
    expect(Math.max(...ls)).toBeCloseTo(BREATHE_HIGH, 12);
  });

  it("hue and saturation are carried through untouched", () => {
    for (const base of BASES) {
      for (let n = 0; n < 24; n++) {
        const c = p.at(base, n);
        expect([base.hex, n, c.h, c.s]).toEqual([base.hex, n, base.h, base.s]);
      }
    }
  });

  it("the rate is constant — it is a triangle, not an ease", () => {
    const steps: number[] = [];
    for (let n = 0; n < 5; n++) steps.push(p.at(BASE, n + 1).l - p.at(BASE, n).l);
    for (const s of steps) expect(s).toBeCloseTo(steps[0], 12);
  });
});

// ── saturation-fade ──────────────────────────────────────────────────────

describe("saturation-fade eases to a floor and stays", () => {
  const p = PROGRESSIONS["saturation-fade"];

  it("n = 0 is the base saturation, exactly", () => {
    for (const base of BASES) {
      expect([base.hex, p.at(base, 0).s]).toEqual([base.hex, base.s]);
    }
  });

  it("it is monotone down, never below the floor, never negative", () => {
    let prev = Infinity;
    for (let n = 0; n <= 400; n++) {
      const s = p.at(BASE, n).s;
      expect([n, s <= prev]).toEqual([n, true]);
      expect([n, s > 0]).toEqual([n, true]);
      expect([n, s >= FADE_FLOOR]).toEqual([n, true]);
      prev = s;
    }
    // Strictly falling while there is anything left to fall by.
    for (let n = 0; n < 100; n++) {
      expect([n, p.at(BASE, n + 1).s < p.at(BASE, n).s]).toEqual([n, true]);
    }
  });

  it("in doubles it SETTLES on the floor rather than approaching forever", () => {
    /**
     * "Asymptotic, never reaches" is the description of the real-valued
     * function. In doubles the remaining gap eventually underflows against the
     * floor and the sum lands on 0.25 exactly — measured at n = 230 for a base
     * of s = 0.7 — after which it is constant. That is the behaviour the brief
     * actually asks for ("and stays there"), and it is stated here as measured
     * rather than asserted as an approach that never lands.
     */
    expect(p.at(BASE, 229).s).toBeGreaterThan(FADE_FLOOR);
    expect(p.at(BASE, 230).s).toBe(FADE_FLOOR);
    expect(p.at(BASE, 5000).s).toBe(FADE_FLOOR);
  });

  it("each step closes the same fraction of the remaining gap", () => {
    for (let n = 0; n < 10; n++) {
      const a = p.at(BASE, n).s - FADE_FLOOR;
      const b = p.at(BASE, n + 1).s - FADE_FLOOR;
      expect(b / a).toBeCloseTo(FADE_RATE, 12);
    }
  });

  it("a base at or below the floor has nothing to fade and is untouched", () => {
    for (const s of [0, 0.1, FADE_FLOOR]) {
      const base = swatch(200, s, 0.5);
      for (const n of [0, 1, 10, 500]) {
        expect([s, n, p.at(base, n)]).toEqual([s, n, base]);
      }
    }
  });

  it("hue and lightness are carried through untouched", () => {
    for (const base of BASES) {
      for (const n of [0, 1, 5, 40]) {
        const c = p.at(base, n);
        expect([base.hex, n, c.h, c.l]).toEqual([base.hex, n, base.h, base.l]);
      }
    }
  });
});

// ── scheme-walk ──────────────────────────────────────────────────────────

describe("scheme-walk steps the hue by 360/k", () => {
  it("the default entry is the six-hue walk", () => {
    const p = PROGRESSIONS["scheme-walk"];
    expect([0, 1, 2, 3, 4, 5, 6].map((n) => p.at(BASE, n).h)).toEqual([
      200, 260, 320, 20, 80, 140, 200,
    ]);
  });

  it("k events return to the base hue exactly, for every k a scheme offers", () => {
    const ks = new Set(
      Object.values(SCHEMES).map((s) => s.offsets.length)
    );
    expect([...ks].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const k of ks) {
      const p = schemeWalk(k);
      for (const base of BASES) {
        expect([k, base.hex, p.at(base, k).h]).toEqual([k, base.hex, base.h]);
        expect([k, base.hex, p.at(base, 0)]).toEqual([k, base.hex, base]);
      }
    }
  });

  it("the walk lands ON the scheme's hues, not between them", () => {
    // With the triad selected, three events walk 0°, 120°, 240° — the triad's
    // own offsets — so consecutive strokes are scheme members rather than
    // arbitrary neighbours. That is the whole reason this progression exists.
    for (const name of ["complementary", "triad", "tetrad", "hexad"] as const) {
      const scheme = SCHEMES[name];
      const p = schemeWalk(scheme.offsets.length);
      const walked = scheme.offsets.map((_, n) => p.at(BASE, n).h);
      const wanted = scheme.offsets
        .map((_, n) => normalizeHue(BASE.h + (360 / scheme.offsets.length) * n))
        .sort((a, b) => a - b);
      expect([name, [...walked].sort((a, b) => a - b)]).toEqual([name, wanted]);
    }
  });

  it("s and l are carried through untouched at every n", () => {
    for (const k of [1, 3, 6, 12]) {
      const p = schemeWalk(k);
      for (const base of BASES) {
        for (let n = 0; n < 2 * k; n++) {
          const c = p.at(base, n);
          expect([k, base.hex, n, c.s, c.l]).toEqual([
            k,
            base.hex,
            n,
            base.s,
            base.l,
          ]);
        }
      }
    }
  });

  it("a degenerate k is folded to 1 rather than producing an Infinity", () => {
    for (const k of [0, -3, 0.5, NaN, Infinity]) {
      const p = schemeWalk(k);
      for (const n of [0, 1, 5]) {
        expect([k, n, p.at(BASE, n).h]).toEqual([k, n, BASE.h]);
      }
    }
  });

  it("a non-integer k is floored rather than producing a fractional wheel", () => {
    expect(schemeWalk(3.9).at(BASE, 3).h).toBe(BASE.h);
  });
});
