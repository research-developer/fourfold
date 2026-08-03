/**
 * The adjustment brush: a stroke that transforms the colour already there.
 *
 * Every other brush in this program SETS a colour. This one reads what the cell
 * is holding and hands back a modified version of it — Photoshop's adjustment
 * layer, applied through the same symmetry machinery as the paint brush. Drag a
 * "lighten" brush across a 6-fold orbit and six cells get lighter, each from its
 * own starting colour, so the drawing's colour relationships survive the edit
 * instead of being flattened by it.
 *
 * FLOAT IS FINE HERE, and only here, for the same reason as `schemes.ts`:
 * `orbit.ts` and `bands.ts` decide WHICH cells a stroke touches, by exact
 * integer key lookup, and this module decides what happens to the colour once
 * the cells are chosen. No number computed in this file ever feeds back into an
 * index.
 *
 * ── An adjustment on nothing is nothing ──────────────────────────────────
 *
 * `apply` is total on Swatches, but a cell that was never painted has no Swatch
 * to transform, and `adjustCells` SKIPS it. Inventing a colour there — treating
 * unpainted as black, or as the current brush colour — would make "lighten"
 * behave as a fill, which is a different tool wearing this one's name. The
 * eraser is the tool for putting colour where there is none; this one is not.
 *
 * `adjustCells` also drops no-ops, matching `planEdits` in `strokes.ts`: a
 * "saturate" dragged over a cell already at s = 1 changes nothing, and reporting
 * it as an edit would make the undo stack and the announced cell count both
 * lie.
 *
 * ── Step sizes, and the honest thing about clamping ──────────────────────
 *
 * The steps are sized for REPETITION, because that is how this brush is used: a
 * pointer held down crosses the same orbit many times, and a step large enough
 * to see in one pass is far too large in ten. 15° of hue is a twenty-fourth of
 * the wheel; 8 points of lightness and 10 of saturation take about a dozen
 * passes to travel the range.
 *
 * s and l CLAMP at 0 and 1 rather than wrapping, which means `lighten` and
 * `darken` are NOT inverse once either end is reached — lighten a cell to white
 * and darken it once and you are at 0.92, not back where you started. That is
 * the correct behaviour (a wrap would flash white to black mid-drag) and it is
 * tested as such rather than papered over. Even away from the ends the pair is
 * only inverse to within float rounding: 0.5 + 0.08 − 0.08 is 0.49999999999999994.
 *
 * Hue WRAPS mod 360, so `hue+` twenty-four times is a full turn. On the integer
 * degree grid — every hue `swatch()` is given by a scheme, whose offsets are all
 * integers — that return is EXACT, measured over all 360 starting degrees. For a
 * hue recovered from a hex triple by `swatchFromHex`, which is an arbitrary
 * double, the twenty-fourth step lands within 4e-14 of the start rather than on
 * it: `h + 15` is not exactly representable when the sum crosses a binade the
 * addend does not fit in. The RENDERED colour is unaffected — the hex byte
 * triple after a full turn was identical in all 160 000 (hue, s, l) probes —
 * and `test/adjust.test.ts` states both halves of that instead of asserting the
 * stronger claim that is false.
 */

import { normalizeHue, swatch, type Swatch } from "./schemes";

export type AdjustName =
  | "hue+"
  | "hue-"
  | "lighten"
  | "darken"
  | "saturate"
  | "desaturate"
  | "complement"
  | "invert";

/** A twenty-fourth of the wheel, so twenty-four steps is a full turn. */
export const HUE_STEP = 15;
/** Points of lightness per step, as a fraction. */
export const LIGHT_STEP = 0.08;
/** Points of saturation per step, as a fraction. */
export const SAT_STEP = 0.1;

export interface Adjustment {
  name: AdjustName;
  label: string;
  /** Pure: old swatch -> new swatch. Must be a no-op on an unpainted cell. */
  apply(s: Swatch): Swatch;
}

/**
 * `swatch()` already normalises the hue into [0, 360) and clamps s and l into
 * [0, 1], so every adjustment is total by construction and none of them needs
 * its own guard. The hex field is recomputed from the new (h, s, l), which is
 * what keeps a Swatch from ever holding a colour and a hex that disagree.
 */
function make(
  name: AdjustName,
  label: string,
  apply: (s: Swatch) => Swatch
): Adjustment {
  return { name, label, apply };
}

export const ADJUSTMENTS: Record<AdjustName, Adjustment> = {
  "hue+": make("hue+", `hue +${HUE_STEP}° — a step round the wheel`, (c) =>
    swatch(c.h + HUE_STEP, c.s, c.l)
  ),
  "hue-": make("hue-", `hue −${HUE_STEP}° — a step back round the wheel`, (c) =>
    swatch(c.h - HUE_STEP, c.s, c.l)
  ),
  lighten: make(
    "lighten",
    `lighten +${Math.round(LIGHT_STEP * 100)} — clamps at white`,
    (c) => swatch(c.h, c.s, c.l + LIGHT_STEP)
  ),
  darken: make(
    "darken",
    `darken −${Math.round(LIGHT_STEP * 100)} — clamps at black`,
    (c) => swatch(c.h, c.s, c.l - LIGHT_STEP)
  ),
  saturate: make(
    "saturate",
    `saturate +${Math.round(SAT_STEP * 100)} — clamps at full chroma`,
    (c) => swatch(c.h, c.s + SAT_STEP, c.l)
  ),
  desaturate: make(
    "desaturate",
    `desaturate −${Math.round(SAT_STEP * 100)} — clamps at grey`,
    (c) => swatch(c.h, c.s - SAT_STEP, c.l)
  ),
  complement: make(
    "complement",
    "complement — the opposite hue, an involution",
    (c) => swatch(c.h + 180, c.s, c.l)
  ),
  /**
   * l ↦ 1 − l with hue and saturation untouched. This is a LIGHTNESS inversion,
   * not an RGB one: a photographic negative would move the hue by 180° as well,
   * and the two are different tools. `complement` is the one that moves hue.
   */
  invert: make("invert", "invert lightness — l ↦ 1 − l, hue kept", (c) =>
    swatch(c.h, c.s, 1 - c.l)
  ),
};

export const ADJUST_NAMES = Object.keys(ADJUSTMENTS) as AdjustName[];

/** True when two swatches are the same colour in every field. */
export function sameSwatch(a: Swatch, b: Swatch): boolean {
  return a.h === b.h && a.s === b.s && a.l === b.l && a.hex === b.hex;
}

/**
 * Apply an adjustment to a set of cells against the current plate; returns only
 * the cells that actually changed.
 *
 * Cells absent from `plate` are unpainted and are skipped — see the note above.
 * Cells the adjustment leaves alone are dropped too, so the returned map is
 * exactly the edit, ready to be turned into a `Stroke`. An empty map means the
 * gesture did nothing and should not be committed.
 *
 * `cells` may repeat an index — a band unioned with its orbit can, and a drag
 * across the same cell certainly does. The adjustment is applied ONCE per cell
 * regardless, against the plate as it stands, never against a partially adjusted
 * copy: a stroke that lightened a cell twice because the pointer wobbled would
 * make the brush's speed a colour control.
 */
export function adjustCells(
  plate: ReadonlyMap<number, Swatch>,
  cells: readonly number[],
  adj: Adjustment
): Map<number, Swatch> {
  const out = new Map<number, Swatch>();
  for (const cell of cells) {
    if (out.has(cell)) continue;
    const before = plate.get(cell);
    if (before === undefined) continue;
    const after = adj.apply(before);
    if (sameSwatch(before, after)) continue;
    out.set(cell, after);
  }
  return out;
}

/**
 * The same adjustment applied `n` times, as a single swatch.
 *
 * Exported because the UI wants to preview "what does holding this down do?"
 * without stepping the plate n times, and because the tests need it to state
 * the twenty-four-step hue cycle. Not a shortcut: it really is n applications,
 * because the clamping means the composite is not a single scaled step.
 */
export function applyTimes(adj: Adjustment, s: Swatch, n: number): Swatch {
  let out = s;
  for (let k = 0; k < n; k++) out = adj.apply(out);
  return out;
}

/** Hue distance on the circle, so 359° and 1° are 2° apart. Used by the tests. */
export function hueGap(a: number, b: number): number {
  const d = Math.abs(normalizeHue(a) - normalizeHue(b));
  return Math.min(d, 360 - d);
}
