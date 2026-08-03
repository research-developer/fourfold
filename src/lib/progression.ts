/**
 * Progressive colour: the base colour moves as you draw.
 *
 * The brush colour stops being a constant and becomes a function of how many
 * colouring events have happened. Twenty strokes into a drawing the hue has
 * drifted, or the lightness has breathed through a cycle, or the saturation has
 * faded toward a floor — so a plate made with one "colour" carries a gradient
 * that records the ORDER it was made in, which is exactly the thing a static
 * palette cannot say.
 *
 * FLOAT IS FINE HERE, on the `schemes.ts` rule: this module decides colour,
 * never an index.
 *
 * ── Purity is the whole design constraint ────────────────────────────────
 *
 * `at(base, n)` depends on `base` and `n` and NOTHING ELSE. Not on the previous
 * call, not on a stored accumulator, not on which order the UI happened to ask.
 * That is not a stylistic preference — it is what keeps undo exact.
 *
 * The obvious implementation is a mutable "current colour" that each stroke
 * nudges. It works until the first undo, at which point the accumulator is one
 * step ahead of the plate and every subsequent stroke is off by one; undoing
 * five strokes and redrawing gives different colours than drawing five strokes
 * did, and the history stops being a history. With a pure `at`, the app stores
 * only the integer n alongside each stroke — it already stores a stroke list —
 * and recomputes the colour for stroke n whenever it needs it. Undo becomes
 * decrement, redo becomes increment, and the plate and the counter cannot drift
 * apart because there is nothing to drift.
 *
 * `test/progression.test.ts` checks purity the only way it can be checked: by
 * evaluating n out of order, interleaved with other n, and comparing against a
 * clean in-order pass.
 *
 * ── What each one is trying to feel like ─────────────────────────────────
 *
 * hue-drift          7° per event. A full wheel in about 51 events — slow
 *                    enough that two adjacent strokes read as the same colour,
 *                    fast enough that a drawing gets all the way round.
 *
 * lightness-breathe  a triangle wave between 30% and 70%, period 24, phased so
 *                    n = 0 sits at the neutral midpoint and RISES. It returns
 *                    instead of running away, which a sine would too — the
 *                    triangle is chosen because its rate is constant, so the
 *                    change per stroke is the same everywhere and the cycle
 *                    reads as deliberate rather than as an ease.
 *
 * saturation-fade    geometric ease toward a floor of 0.25 — asymptotic as a
 *                    real-valued function, so it never crosses the floor and
 *                    never goes negative. In DOUBLES it does not merely
 *                    approach: the remaining gap eventually underflows against
 *                    the floor and the sum lands on 0.25 exactly, measured at
 *                    n = 230 from s = 0.7, after which it is constant. That is
 *                    the wanted behaviour ("and stays there") rather than a
 *                    defect, and `test/progression.test.ts` states it as the
 *                    measurement rather than as an approach that never lands.
 *                    A colour that starts at or below the floor has nothing to
 *                    fade and is returned untouched at every n — easing it UP
 *                    toward 0.25 would be a saturate tool wearing a fade's name.
 *
 * scheme-walk        360/k per event, where k is the number of hues in the
 *                    active scheme. This is the one progression that is aware
 *                    of the rest of the program: with the triad selected, three
 *                    events walk the triad and the fourth is back at the base,
 *                    so consecutive strokes land ON the scheme rather than
 *                    between its hues. k arrives through the factory
 *                    `schemeWalk(k)` because it is a property of the UI's
 *                    current scheme, not of this module; the entry in
 *                    `PROGRESSIONS` is `schemeWalk(SCHEME_WALK_DEFAULT_HUES)`
 *                    so the record is total, and a UI that cares should call
 *                    `schemeWalk(SCHEMES[name].offsets.length)` instead.
 */

import { swatch, type Swatch } from "./schemes";

export type ProgressionName =
  | "off"
  | "hue-drift"
  | "lightness-breathe"
  | "saturation-fade"
  | "scheme-walk";

export interface Progression {
  name: ProgressionName;
  label: string;
  /** The base colour after `n` completed colouring events. Pure in n. */
  at(base: Swatch, n: number): Swatch;
}

/** Degrees of hue per event for `hue-drift`. 360/7 ≈ 51.4 events per wheel. */
export const HUE_DRIFT_STEP = 7;

/** Events per full breath. */
export const BREATHE_PERIOD = 24;
export const BREATHE_LOW = 0.3;
export const BREATHE_HIGH = 0.7;

/** Where `saturation-fade` settles, and how much of the gap it closes per event. */
export const FADE_FLOOR = 0.25;
export const FADE_RATE = 0.85;

/** Hues in the scheme `PROGRESSIONS["scheme-walk"]` assumes: the hexad. */
export const SCHEME_WALK_DEFAULT_HUES = 6;

const mod = (x: number, m: number) => ((x % m) + m) % m;

/**
 * Unit triangle wave: 0 at t = 0, 1 at t = P/2, 0 again at t = P.
 *
 * Total for every real t, including negative, because `n` is an event counter
 * that a UI is entitled to decrement past zero while undoing.
 */
function tri(t: number, period: number): number {
  const u = mod(t, period);
  const half = period / 2;
  return u <= half ? u / half : 2 - u / half;
}

function make(
  name: ProgressionName,
  label: string,
  at: (base: Swatch, n: number) => Swatch
): Progression {
  return { name, label, at };
}

/**
 * The scheme walk at a given number of hues.
 *
 * `k` is folded to at least 1: a scheme always has at least one offset, but a
 * caller computing k from a filtered list could hand over 0, and 360/0 would
 * put an Infinity into a hue. At k = 1 the step is a full 360°, so every event
 * lands back on the base — the correct reading of "walk a one-hue scheme".
 */
export function schemeWalk(k: number): Progression {
  const hues = Number.isFinite(k) && k >= 1 ? Math.floor(k) : 1;
  const step = 360 / hues;
  return make(
    "scheme-walk",
    `scheme walk — ${
      Number.isInteger(step) ? step : step.toFixed(1)
    }° per event, ${hues} ${hues === 1 ? "hue" : "hues"} to the turn`,
    (base, n) => swatch(base.h + step * n, base.s, base.l)
  );
}

export const PROGRESSIONS: Record<ProgressionName, Progression> = {
  off: make("off", "off — the base colour, unchanged", (base) => base),

  "hue-drift": make(
    "hue-drift",
    `hue drift — +${HUE_DRIFT_STEP}° per event, a wheel in ~${Math.round(
      360 / HUE_DRIFT_STEP
    )} strokes`,
    (base, n) => swatch(base.h + HUE_DRIFT_STEP * n, base.s, base.l)
  ),

  /**
   * The phase shift of a quarter period is what puts n = 0 at the midpoint of
   * the range and heading up. Without it the first stroke of a drawing would
   * come out at the darkest point of the cycle, which reads as a bug rather
   * than as a breath.
   *
   * This progression OVERRIDES the base lightness — it has to. A breathe
   * anchored to an arbitrary base lightness would have a period that depended
   * on where it started, and would not return.
   */
  "lightness-breathe": make(
    "lightness-breathe",
    `lightness breathe — ${Math.round(BREATHE_LOW * 100)}%…${Math.round(
      BREATHE_HIGH * 100
    )}%, period ${BREATHE_PERIOD}`,
    (base, n) =>
      swatch(
        base.h,
        base.s,
        BREATHE_LOW +
          (BREATHE_HIGH - BREATHE_LOW) *
            tri(n + BREATHE_PERIOD / 4, BREATHE_PERIOD)
      )
  ),

  "saturation-fade": make(
    "saturation-fade",
    `saturation fade — eases toward ${Math.round(FADE_FLOOR * 100)}% and stays`,
    (base, n) => {
      const gap = base.s - FADE_FLOOR;
      if (gap <= 0) return base;
      return swatch(base.h, FADE_FLOOR + gap * Math.pow(FADE_RATE, n), base.l);
    }
  ),

  "scheme-walk": schemeWalk(SCHEME_WALK_DEFAULT_HUES),
};

export const PROGRESSION_NAMES = Object.keys(PROGRESSIONS) as ProgressionName[];
