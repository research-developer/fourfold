import { describe, expect, it } from "vitest";
import { buildFigure } from "../src/lib/figure";
import { buildHexagon } from "../src/lib/hexagon";
import { buildSurface } from "../src/lib/orbit";
import {
  ANALOGOUS_LIGHTNESS_FAN,
  hslToHex,
  normalizeHue,
  paintOrbit,
  SCHEME_NAMES,
  SCHEMES,
  swatch,
  swatchFromHex,
  type SchemeName,
} from "../src/lib/schemes";

const BASE = swatch(200, 0.7, 0.5);

/** Circular hue distance, so 359° and 1° are 2° apart rather than 358°. */
const hueGap = (a: number, b: number) => {
  const d = Math.abs(normalizeHue(a) - normalizeHue(b));
  return Math.min(d, 360 - d);
};

// ── the offsets are the specification ────────────────────────────────────

describe("the schemes carry the offsets they claim", () => {
  const WANT: Record<SchemeName, number[]> = {
    solid: [0],
    complementary: [0, 180],
    triad: [0, 120, 240],
    tetrad: [0, 90, 180, 270],
    "split-complementary": [0, 150, 210],
    analogous: [0, 30, -30, 60, -60],
    hexad: [0, 60, 120, 180, 240, 300],
  };

  it("every name is present exactly once and its offsets match", () => {
    expect(SCHEME_NAMES.sort()).toEqual(
      (Object.keys(WANT) as SchemeName[]).sort()
    );
    for (const name of SCHEME_NAMES) {
      expect([name, SCHEMES[name].name]).toEqual([name, name]);
      expect([name, SCHEMES[name].offsets]).toEqual([name, WANT[name]]);
      expect([name, SCHEMES[name].label.length > 0]).toEqual([name, true]);
    }
  });

  it("position k of a short orbit is the k-th offset, verbatim", () => {
    for (const name of SCHEME_NAMES) {
      const s = SCHEMES[name];
      for (let k = 0; k < s.offsets.length; k++) {
        const got = s.at(BASE, k, s.offsets.length);
        expect([name, k, got.h]).toEqual([
          name,
          k,
          normalizeHue(BASE.h + s.offsets[k]),
        ]);
      }
    }
  });
});

// ── hue arithmetic ───────────────────────────────────────────────────────

describe("hue arithmetic wraps and never leaks a negative", () => {
  it("normalizeHue lands in [0, 360) for anything thrown at it", () => {
    const probes = [0, 360, -360, 359.9, -0.1, -30, 720, -1080.5, 1e6];
    for (const p of probes) {
      const h = normalizeHue(p);
      expect([p, h >= 0, h < 360]).toEqual([p, true, true]);
    }
    expect(normalizeHue(-30)).toBeCloseTo(330, 12);
    expect(normalizeHue(360)).toBe(0);
  });

  it("every scheme, every base hue, every position stays in [0, 360)", () => {
    for (const name of SCHEME_NAMES) {
      const s = SCHEMES[name];
      for (let h = 0; h < 360; h += 7) {
        const base = swatch(h, 0.6, 0.5);
        for (let n = 1; n <= 12; n++) {
          for (let k = 0; k < n; k++) {
            const got = s.at(base, k, n);
            expect([name, h, n, k, got.h >= 0, got.h < 360]).toEqual([
              name,
              h,
              n,
              k,
              true,
              true,
            ]);
          }
        }
      }
    }
  });

  it("the analogous scheme's negative offsets wrap rather than go negative", () => {
    // Offsets −30 and −60 against a base at 10° must give 340° and 310°.
    const base = swatch(10, 0.6, 0.5);
    const s = SCHEMES.analogous;
    expect(s.at(base, 2, 5).h).toBeCloseTo(340, 9);
    expect(s.at(base, 4, 5).h).toBeCloseTo(310, 9);
  });

  it("the wheel divisions are what their names say", () => {
    const gaps = (name: SchemeName, n: number) => {
      const hs = Array.from({ length: n }, (_, k) => SCHEMES[name].at(BASE, k, n).h);
      return hs.map((h) => Math.round(hueGap(h, BASE.h)));
    };
    expect(gaps("complementary", 2)).toEqual([0, 180]);
    expect(gaps("triad", 3)).toEqual([0, 120, 120]);
    expect(gaps("tetrad", 4)).toEqual([0, 90, 180, 90]);
    expect(gaps("hexad", 6)).toEqual([0, 60, 120, 180, 120, 60]);
    expect(gaps("split-complementary", 3)).toEqual([0, 150, 150]);
  });
});

// ── wrapping and determinism ─────────────────────────────────────────────

describe("at() wraps the offset list and is deterministic", () => {
  it("an orbit longer than the offset list repeats the list", () => {
    // A triad brush on a 6-orbit paints the triad twice: the 6-fold orbit is
    // seen to have a 3-fold colour period, which is the containment C3 < C6.
    const s = SCHEMES.triad;
    for (let k = 0; k < 6; k++) {
      expect([k, s.at(BASE, k, 6).hex]).toEqual([k, s.at(BASE, k % 3, 3).hex]);
    }
    // And a 12-orbit repeats it four times.
    for (let k = 0; k < 12; k++) {
      expect([k, s.at(BASE, k, 12).h]).toEqual([
        k,
        normalizeHue(BASE.h + s.offsets[k % 3]),
      ]);
    }
  });

  it("an orbit shorter than the offset list takes the leading offsets", () => {
    const s = SCHEMES.hexad;
    expect(s.at(BASE, 0, 2).h).toBe(normalizeHue(BASE.h));
    expect(s.at(BASE, 1, 2).h).toBe(normalizeHue(BASE.h + 60));
  });

  it("out-of-range and negative k fold into the orbit", () => {
    for (const name of SCHEME_NAMES) {
      const s = SCHEMES[name];
      for (const n of [1, 2, 3, 6, 12]) {
        for (const k of [0, 1, 2]) {
          expect([name, n, k, s.at(BASE, k + n, n).hex]).toEqual([
            name,
            n,
            k,
            s.at(BASE, k, n).hex,
          ]);
          expect([name, n, k, s.at(BASE, k - n, n).hex]).toEqual([
            name,
            n,
            k,
            s.at(BASE, k, n).hex,
          ]);
        }
      }
    }
  });

  it("the same inputs always give the same swatch", () => {
    for (const name of SCHEME_NAMES) {
      for (const n of [1, 3, 5, 6]) {
        for (let k = 0; k < n; k++) {
          const a = SCHEMES[name].at(BASE, k, n);
          const b = SCHEMES[name].at(BASE, k, n);
          expect([name, n, k, a]).toEqual([name, n, k, b]);
        }
      }
    }
  });

  it("a singleton orbit is the base colour under every scheme", () => {
    for (const name of SCHEME_NAMES) {
      const got = SCHEMES[name].at(BASE, 0, 1);
      expect([name, got.h, got.s, got.l, got.hex]).toEqual([
        name,
        BASE.h,
        BASE.s,
        BASE.l,
        BASE.hex,
      ]);
    }
  });
});

// ── saturation and lightness ─────────────────────────────────────────────

describe("only analogous touches lightness", () => {
  it("every other scheme carries s and l through untouched", () => {
    for (const name of SCHEME_NAMES) {
      if (name === "analogous") continue;
      for (const n of [1, 2, 3, 4, 6, 12]) {
        for (let k = 0; k < n; k++) {
          const got = SCHEMES[name].at(BASE, k, n);
          expect([name, n, k, got.s, got.l]).toEqual([
            name,
            n,
            k,
            BASE.s,
            BASE.l,
          ]);
        }
      }
    }
  });

  it("analogous fans lightness monotonically, centred on the base", () => {
    const s = SCHEMES.analogous;
    for (const n of [2, 3, 5, 6]) {
      const ls = Array.from({ length: n }, (_, k) => s.at(BASE, k, n).l);
      for (let k = 1; k < n; k++) {
        expect([n, k, ls[k] > ls[k - 1]]).toEqual([n, k, true]);
      }
      // Symmetric about the base: first and last are ±half the fan.
      expect([n, ls[0]]).toEqual([n, BASE.l - ANALOGOUS_LIGHTNESS_FAN / 2]);
      expect([n, ls[n - 1]]).toEqual([n, BASE.l + ANALOGOUS_LIGHTNESS_FAN / 2]);
      // And the mean is the base lightness.
      expect(ls.reduce((a, b) => a + b, 0) / n).toBeCloseTo(BASE.l, 12);
    }
    // Saturation is never touched, even by analogous.
    for (let k = 0; k < 5; k++) expect(s.at(BASE, k, 5).s).toBe(BASE.s);
    // A singleton has nothing to fan.
    expect(s.at(BASE, 0, 1).l).toBe(BASE.l);
  });

  it("the fan cannot push lightness out of range", () => {
    for (const l of [0, 0.02, 0.98, 1]) {
      const base = swatch(120, 0.8, l);
      for (const n of [2, 6]) {
        for (let k = 0; k < n; k++) {
          const got = SCHEMES.analogous.at(base, k, n);
          expect([l, n, k, got.l >= 0, got.l <= 1]).toEqual([l, n, k, true, true]);
        }
      }
    }
  });
});

// ── conversion ───────────────────────────────────────────────────────────

describe("HSL and hex convert exactly enough to round-trip", () => {
  it("hex → hsl → hex is EXACT, over a sweep of the cube", () => {
    let checked = 0;
    for (let r = 0; r < 256; r += 3) {
      for (let g = 0; g < 256; g += 7) {
        for (let b = 0; b < 256; b += 11) {
          const hex =
            "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
          const sw = swatchFromHex(hex);
          expect([hex, hslToHex(sw.h, sw.s, sw.l)]).toEqual([hex, hex]);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(10000);
  });

  it("hsl → hex → hsl is within 8-bit quantisation", () => {
    // Not exact, and cannot be: 24-bit RGB has fewer states than the HSL grid
    // being sampled. These bounds are MEASURED over the grid below, not chosen.
    let worstH = 0;
    let worstS = 0;
    let worstL = 0;
    for (let h = 0; h < 360; h += 1) {
      for (const s of [0.2, 0.5, 0.8, 1]) {
        for (const l of [0.2, 0.35, 0.5, 0.65, 0.8]) {
          const sw = swatchFromHex(hslToHex(h, s, l));
          worstH = Math.max(worstH, hueGap(sw.h, h));
          worstS = Math.max(worstS, Math.abs(sw.s - s));
          worstL = Math.max(worstL, Math.abs(sw.l - l));
        }
      }
    }
    expect(worstH).toBeLessThan(2.1);
    expect(worstS).toBeLessThan(0.005);
    expect(worstL).toBeLessThan(0.002);
  });

  it("a Swatch's hex always agrees with its own hsl", () => {
    for (let h = 0; h < 360; h += 11) {
      for (const s of [0, 0.3, 1]) {
        for (const l of [0, 0.25, 0.5, 0.75, 1]) {
          const sw = swatch(h, s, l);
          expect(sw.hex).toBe(hslToHex(sw.h, sw.s, sw.l));
          expect(sw.hex).toMatch(/^#[0-9a-f]{6}$/);
        }
      }
    }
    for (const name of SCHEME_NAMES) {
      for (let k = 0; k < 6; k++) {
        const sw = SCHEMES[name].at(BASE, k, 6);
        expect([name, k, sw.hex]).toEqual([
          name,
          k,
          hslToHex(sw.h, sw.s, sw.l),
        ]);
      }
    }
  });

  it("known anchors convert the way the standard says", () => {
    expect(hslToHex(0, 1, 0.5)).toBe("#ff0000");
    expect(hslToHex(120, 1, 0.5)).toBe("#00ff00");
    expect(hslToHex(240, 1, 0.5)).toBe("#0000ff");
    expect(hslToHex(60, 1, 0.5)).toBe("#ffff00");
    expect(hslToHex(180, 1, 0.5)).toBe("#00ffff");
    expect(hslToHex(300, 1, 0.5)).toBe("#ff00ff");
    expect(hslToHex(0, 0, 0)).toBe("#000000");
    expect(hslToHex(0, 0, 1)).toBe("#ffffff");
    // Hue is meaningless at zero chroma; 0 is the value that round-trips.
    expect(swatchFromHex("#808080").s).toBe(0);
    expect(swatchFromHex("#808080").h).toBe(0);
    // Short form expands.
    expect(swatchFromHex("#f00").hex).toBe("#ff0000");
    expect(swatchFromHex("D4A017").hex).toBe("#d4a017");
    expect(() => swatchFromHex("#gggggg")).toThrow(/not a hex colour/);
    expect(() => swatchFromHex("#12345")).toThrow(/not a hex colour/);
  });
});

// ── the point of the module: colour indexed by orbit ─────────────────────

describe("the orbit position indexes the wheel", () => {
  it("a triad on a triangle 3-orbit gives three hues 120° apart", () => {
    const figure = buildFigure(3, "apex");
    const surface = buildSurface("triangle", 3, "apex");
    const orbit = surface.orbit(
      figure.cells.findIndex((c) => c.addr === "ABC"),
      3
    );
    expect(orbit.length).toBe(3);
    const hues = paintOrbit(SCHEMES.triad, BASE, orbit).map((s) => s.h);
    expect(new Set(hues).size).toBe(3);
    expect(hues.map((h) => Math.round(hueGap(h, BASE.h)))).toEqual([0, 120, 120]);
  });

  it("a hexad on a hexagon 6-orbit walks the wheel once", () => {
    const hex = buildHexagon(2, "apex");
    const surface = buildSurface("hexagon", 2, "apex");
    const centre = hex.cells.find((c) => c.addr === "AA" && c.sector === 0)!;
    const orbit = surface.orbit(centre.i, 6);
    expect(orbit.length).toBe(6);
    const painted = paintOrbit(SCHEMES.hexad, BASE, orbit);
    expect(painted.length).toBe(6);
    expect(new Set(painted.map((s) => s.hex)).size).toBe(6);
    expect(painted.map((s) => Math.round(normalizeHue(s.h - BASE.h)))).toEqual([
      0, 60, 120, 180, 240, 300,
    ]);
  });

  it("a pinned cell paints one swatch, and it is the base colour", () => {
    // The hub is its own orbit under every triangle mode, so no scheme can
    // give it a second hue — a symmetry brush on a fixed point is a single
    // stroke by construction, not by a special case in the colour code.
    const figure = buildFigure(3, "apex");
    const surface = buildSurface("triangle", 3, "apex");
    for (const mode of surface.modes) {
      const orbit = surface.orbit(figure.hub, mode);
      expect([mode, orbit.length]).toEqual([mode, 1]);
      for (const name of SCHEME_NAMES) {
        const painted = paintOrbit(SCHEMES[name], BASE, orbit);
        expect([mode, name, painted]).toEqual([mode, name, [BASE]]);
      }
    }
  });

  it("painting the whole canvas gives every cell exactly one swatch", () => {
    const surface = buildSurface("hexagon", 2, "apex");
    const painted = new Map<number, string>();
    for (let i = 0; i < surface.cellCount; i++) {
      const orbit = surface.orbit(i, 12);
      if (painted.has(orbit[0])) continue;
      const cols = paintOrbit(SCHEMES.hexad, BASE, orbit);
      orbit.forEach((cell, k) => {
        expect(painted.has(cell)).toBe(false);
        painted.set(cell, cols[k].hex);
      });
    }
    expect(painted.size).toBe(surface.cellCount);
  });
});
