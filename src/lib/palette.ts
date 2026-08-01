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

/** Axis accents. Kept off the four charge hues so they never read as fills. */
export const AXIS_COLOR: Record<Axis, string> = {
  A: "#e8e3db",
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
