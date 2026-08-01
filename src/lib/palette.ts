import type { Axis, Charge } from "./figure";
import { ID, S2, S2S3, S3 } from "./figure";

/**
 * Fill colours, lifted verbatim from equilat_v4.py so a screenshot of the
 * board and a render of the SVG are the same picture. Index 0 is upright
 * (eps = 0), index 1 is inverted (eps = 1, deeper saturation).
 */
export const FILL: Record<Charge, readonly [string, string]> = {
  [ID]: ["#d4a017", "#9c7510"],
  [S3]: ["#d6336c", "#9b2350"],
  [S2]: ["#1f6feb", "#1450a5"],
  [S2S3]: ["#7c3aed", "#5a26b0"],
};

/**
 * Coset-mode fills: collapse the four charges onto the one distinction the
 * rules actually use — inside H (gold/purple) versus outside it (blue/red).
 * Gold against blue is the single hue axis all three dichromacies retain
 * (measured ΔE 142 deutan, 136 protan, 69 tritan), so this mode is legible
 * to colour-blind players in a way the four-hue palette is not.
 */
export const COSET_FILL: Record<"H" | "notH", readonly [string, string]> = {
  H: ["#d4a017", "#9c7510"],
  notH: ["#1f6feb", "#1450a5"],
};

/**
 * Axis accents. Kept off the four charge hues so they never read as fills.
 * Axis A is tinted cyan rather than off-white: bone was within ΔE 4 of the
 * BONE player colour, so "vertical axis" and "player one" read as one thing.
 */
export const AXIS_COLOR: Record<Axis, string> = {
  A: "#67e8f9",
  B: "#4ade80",
  C: "#f59e0b",
};

export const AXIS_NAME: Record<Axis, string> = {
  A: "vertical",
  B: "left diagonal",
  C: "right diagonal",
};

/** Player accents, chosen to be unmistakable against all eight fills. */
export const PLAYER_COLOR: readonly [string, string] = ["#f5efe3", "#a3e635"];
export const PLAYER_NAME: readonly [string, string] = ["BONE", "LIME"];
