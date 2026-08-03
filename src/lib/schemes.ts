/**
 * Colour schemes indexed by symmetry orbit.
 *
 * The idea in one line: a cell's POSITION IN ITS ORBIT indexes the colour
 * wheel. Paint a 3-orbit with the triad scheme and its three cells come out
 * 120° apart; paint a 6-orbit with the hexad and the six cells walk the wheel
 * once. The drawing's colour structure is therefore not decoration applied over
 * its symmetry — it is a reading of that symmetry, and a viewer who can see the
 * hues can see the orbit.
 *
 * FLOAT IS FINE HERE, and only here. Colour is a display concern: `orbit.ts`
 * decides WHICH cells a stroke touches, by exact integer key lookup, and this
 * module decides what colour each one gets. No number computed in this file
 * ever feeds back into an index. Compare `hexagon.ts`, where `latticeToPixel`
 * is fenced off for the same reason.
 *
 * ── Conventions ─────────────────────────────────────────────────────────
 *
 * `h` is degrees in [0, 360); `s` and `l` are fractions in [0, 1] — NOT the
 * percentages CSS writes, so `hsl(${h} ${s * 100}% ${l * 100}%)` if you want a
 * CSS string. `hex` is lower-case `#rrggbb`, matching `palette.ts`, and is
 * always the exact 8-bit rendering of the other three fields: a Swatch cannot
 * hold an hsl and a hex that disagree, because the only constructors compute
 * one from the other.
 *
 * ── Wrapping ────────────────────────────────────────────────────────────
 *
 * When an orbit is longer than the scheme's offset list, the list WRAPS: a
 * triad on a 6-orbit paints 0°, 120°, 240°, 0°, 120°, 240°. The repeat is the
 * point rather than a shortfall — it makes a 6-fold orbit read as having a
 * 3-fold colour period, which is exactly the subgroup relation C3 < C6.
 */

export interface Swatch {
  /** Hue in degrees, normalised to [0, 360). */
  h: number;
  /** Saturation as a fraction in [0, 1]. */
  s: number;
  /** Lightness as a fraction in [0, 1]. */
  l: number;
  /** Lower-case `#rrggbb`, the exact 8-bit rendering of (h, s, l). */
  hex: string;
}

// ── exact-as-float conversion ────────────────────────────────────────────

/** Hue into [0, 360). Negative offsets (analogous uses them) must not leak. */
export function normalizeHue(h: number): number {
  const x = h % 360;
  return x < 0 ? x + 360 : x;
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

const byte = (v: number) => {
  const n = Math.round(v * 255);
  return n < 0 ? 0 : n > 255 ? 255 : n;
};

/**
 * HSL → `#rrggbb`, the standard chroma construction.
 *
 * c is the chroma the (s, l) pair affords, x the second-largest component on
 * the hue's face of the RGB cube, m the lift that puts the pair at the right
 * lightness. Out-of-range inputs are normalised rather than rejected, so an
 * offset arithmetic slip degrades to a wrong colour, never to a crash mid-draw.
 */
export function hslToHex(h: number, s: number, l: number): string {
  const H = normalizeHue(h);
  const S = clamp01(s);
  const L = clamp01(l);

  const c = (1 - Math.abs(2 * L - 1)) * S;
  const hp = H / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = L - c / 2;

  let r: number, g: number, b: number;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  return (
    "#" +
    [r + m, g + m, b + m]
      .map((v) => byte(v).toString(16).padStart(2, "0"))
      .join("")
  );
}

const HEX6 = /^#?([0-9a-fA-F]{6})$/;
const HEX3 = /^#?([0-9a-fA-F]{3})$/;

/**
 * `#rgb` or `#rrggbb` → a Swatch.
 *
 * Achromatic input has no hue to recover, so h is reported as 0. That is a
 * choice, not a measurement: any hue renders the same grey, and 0 is the one
 * that round-trips.
 */
export function swatchFromHex(hex: string): Swatch {
  const six = HEX6.exec(hex.trim());
  const three = HEX3.exec(hex.trim());
  const digits = six
    ? six[1]
    : three
    ? three[1]
        .split("")
        .map((d) => d + d)
        .join("")
    : null;
  if (digits === null) throw new Error(`not a hex colour: ${hex}`);

  const r = parseInt(digits.slice(0, 2), 16) / 255;
  const g = parseInt(digits.slice(2, 4), 16) / 255;
  const b = parseInt(digits.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;
  // The chroma-to-saturation divisor degenerates at pure black and pure white,
  // where d is 0 anyway, so the guard on d covers both.
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));

  let h = 0;
  if (d !== 0) {
    if (max === r) h = 60 * ((g - b) / d);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }

  return { h: normalizeHue(h), s, l, hex: "#" + digits.toLowerCase() };
}

/** Build a Swatch from HSL, normalising the hue and clamping s and l. */
export function swatch(h: number, s: number, l: number): Swatch {
  const H = normalizeHue(h);
  const S = clamp01(s);
  const L = clamp01(l);
  return { h: H, s: S, l: L, hex: hslToHex(H, S, L) };
}

// ── the schemes ──────────────────────────────────────────────────────────

export type SchemeName =
  | "solid"
  | "complementary"
  | "triad"
  | "tetrad"
  | "split-complementary"
  | "analogous"
  | "hexad";

export interface Scheme {
  name: SchemeName;
  label: string;
  /** Hue offsets in degrees, in orbit order. */
  offsets: number[];
  /** Colour for orbit position k of an orbit of size n, from a base colour. */
  at(base: Swatch, k: number, n: number): Swatch;
}

/**
 * How far the analogous scheme fans lightness across an orbit, end to end.
 *
 * Analogous is the one scheme whose offsets are deliberately CLOSE (±30°, ±60°)
 * rather than spread around the wheel, so hue alone barely separates the orbit.
 * A shallow lightness ramp — ±6% about the base — restores the separation
 * without turning the scheme into a different one. Every other scheme leaves s
 * and l exactly as the base carried them; `test/schemes.test.ts` pins both
 * halves of that statement.
 */
export const ANALOGOUS_LIGHTNESS_FAN = 0.12;

const mod = (x: number, m: number) => ((x % m) + m) % m;

/**
 * Orbit position k of an orbit of size n, reduced to an index into a list of
 * `len` offsets.
 *
 * k is first folded into [0, n) so a caller counting past the end of the orbit
 * (or backwards) still names a real position, then into [0, len) so the offset
 * list wraps. Both folds are total, which is what "deterministic" has to mean
 * for a function a pointer-drag calls thousands of times.
 */
function position(k: number, n: number, len: number): number {
  const kk = n >= 1 ? mod(k, n) : 0;
  return mod(kk, len);
}

function make(
  name: SchemeName,
  label: string,
  offsets: number[],
  vary?: (base: Swatch, k: number, n: number) => { s: number; l: number }
): Scheme {
  return {
    name,
    label,
    offsets,
    at(base, k, n) {
      const idx = position(k, n, offsets.length);
      const sl = vary ? vary(base, k, n) : { s: base.s, l: base.l };
      return swatch(base.h + offsets[idx], sl.s, sl.l);
    },
  };
}

export const SCHEMES: Record<SchemeName, Scheme> = {
  solid: make("solid", "solid — one hue, the orbit read as a single shape", [0]),
  complementary: make(
    "complementary",
    "complementary — 180° apart, matched to a 2-fold brush",
    [0, 180]
  ),
  triad: make("triad", "triad — 120° apart, matched to a 3-fold brush", [
    0, 120, 240,
  ]),
  tetrad: make("tetrad", "tetrad — 90° apart, two complementary pairs", [
    0, 90, 180, 270,
  ]),
  "split-complementary": make(
    "split-complementary",
    "split complementary — a hue against the two neighbours of its opposite",
    [0, 150, 210]
  ),
  analogous: make(
    "analogous",
    "analogous — neighbouring hues, separated by a shallow lightness fan",
    [0, 30, -30, 60, -60],
    (base, k, n) => {
      const span = Math.max(n, 1);
      // −0.5 at the first position, +0.5 at the last, 0 for a singleton.
      const t = span === 1 ? 0 : mod(k, span) / (span - 1) - 0.5;
      return { s: base.s, l: clamp01(base.l + ANALOGOUS_LIGHTNESS_FAN * t) };
    }
  ),
  hexad: make(
    "hexad",
    "hexad — 60° apart, the whole wheel once, matched to a 6-fold brush",
    [0, 60, 120, 180, 240, 300]
  ),
};

export const SCHEME_NAMES = Object.keys(SCHEMES) as SchemeName[];

/**
 * The colour for each of a list of scheme POSITIONS.
 *
 * The general form, of which `paintOrbit` is the special case where the
 * positions are 0, 1, 2, … and `span` is the orbit's own length.
 *
 * It exists because position-in-the-cell-list is not always the right index. A
 * band brush paints a set of IMAGE BANDS, and what should carry the hue is
 * which band a cell is in, not where it sits in the flattened list — six rows
 * take six hues and each row comes out solid. `bands.ts` computes the grouping
 * and `brush.ts` turns it into these keys; this function only reads them.
 *
 * `span` is how many positions the scheme is being indexed over — the number of
 * image bands for a band brush, the orbit size for an orbit. It is separate
 * from `keys.length` because the two differ exactly when the indexing is not
 * positional, and because it is what the analogous scheme fans its lightness
 * across: over rows when the brush paints rows, over cells when it paints an
 * orbit. Both folds inside `scheme.at` are total, so a mismatched pair
 * degrades to a wrong colour rather than to a crash mid-drag.
 */
export function paintKeys(
  scheme: Scheme,
  base: Swatch,
  keys: readonly number[],
  span: number
): Swatch[] {
  return keys.map((k) => scheme.at(base, k, span));
}

/**
 * The colour of every cell of an orbit, aligned to the orbit array.
 *
 * This is the module's whole purpose in one call: hand it what `orbit()`
 * returned and a base colour, and the returned swatches are the stroke.
 */
export function paintOrbit(
  scheme: Scheme,
  base: Swatch,
  orbit: readonly number[]
): Swatch[] {
  return paintKeys(
    scheme,
    base,
    orbit.map((_, k) => k),
    orbit.length
  );
}
