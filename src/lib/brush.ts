/**
 * The brush as one object: which cells a gesture touches, what colour each of
 * them ends up, and how many colouring events the drawing has spent.
 *
 * `orbit.ts` answers "which cells are the same cell?" and `bands.ts` answers
 * "which cells are the same row?". `schemes.ts`, `adjust.ts` and
 * `progression.ts` each answer a colour question. None of them knows about the
 * others, which is correct — and it leaves exactly one job unclaimed: composing
 * them into the single thing a pointer-down actually is. That is this file.
 *
 * ZERO GEOMETRY IS DECIDED HERE. Every cell index this module returns came out
 * of `orbit.ts` or `bands.ts` by exact integer key lookup; every colour came out
 * of `schemes.ts` or `adjust.ts`. This module only routes.
 *
 * ── One colour vector, three tools ───────────────────────────────────────
 *
 * The three tools look like three different operations and are not. Each one is
 * a function from "the cells under the brush" to "the colour each of those cells
 * should hold afterwards, or `null` for unpainted" — and once it is written that
 * way, `planEdits` turns any of them into an ordinary undoable stroke with no
 * per-tool branch anywhere downstream:
 *
 *   paint    the scheme's colour for orbit position k
 *   erase    null, everywhere
 *   adjust   the transformed colour where there IS one, and null where there is
 *            not, so an unpainted cell yields from = null, to = null, which
 *            `planEdits` drops as the no-op it is
 *
 * That last line is why the adjustment brush cannot accidentally behave as a
 * fill: the "leave unpainted cells alone" rule is not a guard that has to be
 * remembered at each call site, it is a consequence of the shape of the vector.
 *
 * ── Why the event log is a second stack and not a counter ────────────────
 *
 * `progression.ts` makes the base colour a pure function of an integer n, and
 * says plainly why: an accumulator desynchronises on the first undo. So n has
 * to be RECOVERABLE from the history rather than remembered alongside it.
 *
 * `EventLog` is that recovery. It shadows `History` one-for-one — one entry per
 * committed gesture, holding how many colouring events that gesture spent — so
 * n is the sum of the past, undo pops, redo pushes, and there is no state that
 * can drift because there is no state that is not derived. A gesture spends one
 * event per distinct cell it starts an application at, so a drag lays a
 * gradient along its own path and undoing the drag takes back the whole
 * gradient. Erase, adjust and clear are gestures too and spend ZERO events:
 * they are recorded so the two stacks stay aligned, and contribute nothing to n.
 *
 * The alignment is the whole invariant: `pushEvents` must be called exactly when
 * `commit` is, `undoEvents` exactly when `undo` moves a stroke, `redoEvents`
 * exactly when `redo` does. `test/brush.test.ts` drives a random walk of paired
 * operations and checks the two stacks stay the same height, including across
 * the `HISTORY_LIMIT` trim, which is the one place a naive implementation
 * silently loses a rung.
 */

import { adjustCells, type Adjustment } from "./adjust";
import { bandOrbit, type BandFamily, type BandSurface } from "./bands";
import type { BrushMode, CanvasKind, SymmetrySurface } from "./orbit";
import {
  PROGRESSIONS,
  schemeWalk,
  type Progression,
  type ProgressionName,
} from "./progression";
import {
  paintOrbit,
  swatchFromHex,
  type Scheme,
  type Swatch,
} from "./schemes";
import { HISTORY_LIMIT, type PaintMap } from "./strokes";

// ── what the hand is holding ─────────────────────────────────────────────

export type Tool = "paint" | "erase" | "adjust";

export const TOOLS: readonly Tool[] = ["paint", "erase", "adjust"] as const;

/**
 * How a drag behaves.
 *
 * `paint` lays colour continuously, which is what a mouse wants. `propose`
 * moves a CANDIDATE and commits nothing until it is tapped, which is what a
 * finger needs: touch has no hover, so on a phone the ghost preview — the thing
 * that teaches what the symmetry is about to do — is otherwise unreachable.
 * Proposing restores it by making the press itself the hover.
 */
export type DragMode = "paint" | "propose";

/** `propose` on a coarse pointer, `paint` otherwise. The toggle overrides it. */
export function defaultDragMode(coarsePointer: boolean): DragMode {
  return coarsePointer ? "propose" : "paint";
}

/** The geometric brush: a symmetry, and optionally a band family to sweep. */
export interface BrushShape {
  mode: BrushMode;
  /** `null` = the orbit alone; a family = the whole row, carried by the orbit. */
  band: BandFamily | null;
}

/**
 * The cells one application of the brush touches.
 *
 * With no band this is the orbit. With a band it is the row through the cell
 * UNIONED with the orbit of that row, which is composition rather than
 * replacement: a band under a 6-fold brush is six rows, not one row and not six
 * cells. See `bandOrbit`.
 */
export function brushCells(
  surface: SymmetrySurface,
  bands: BandSurface,
  i: number,
  shape: BrushShape
): number[] {
  return shape.band === null
    ? surface.orbit(i, shape.mode)
    : bandOrbit(surface, bands, i, shape.band, shape.mode);
}

// ── what colour they end up ──────────────────────────────────────────────

export interface ColourPlan {
  tool: Tool;
  scheme: Scheme;
  /** The EFFECTIVE base — the progression has already been applied to it. */
  base: Swatch;
  adjust: Adjustment;
}

/**
 * The swatch view of the cells in play.
 *
 * The plate stores `#rrggbb` because that is what a stroke and an SVG both
 * need, and `adjustCells` wants Swatches, so the two are bridged here rather
 * than by carrying a parallel swatch map around all day. The round trip through
 * eight bits per channel is lossy in (h, s, l) and EXACTLY faithful in the
 * rendered colour, which is the right way round: what the user sees is the
 * fixed point, and an adjustment applied twice reads the cell as it actually
 * stands rather than as an accumulated ideal that the screen never showed.
 */
function swatchPlate(
  paint: PaintMap,
  cells: readonly number[]
): Map<number, Swatch> {
  const out = new Map<number, Swatch>();
  for (const c of cells) {
    if (out.has(c)) continue;
    const hex = paint.get(c);
    if (hex !== undefined) out.set(c, swatchFromHex(hex));
  }
  return out;
}

/**
 * The colour each cell would hold after the stroke, aligned to `cells`.
 *
 * `null` means "unpainted afterwards" — erased, or never painted and left that
 * way. Hand the result straight to `planEdits` and the stroke is built; hand it
 * to the preview and the ghost is built from the same numbers, so the ghost
 * cannot promise a colour the stroke will not lay.
 */
export function brushColours(
  plan: ColourPlan,
  paint: PaintMap,
  cells: readonly number[]
): (string | null)[] {
  if (plan.tool === "erase") return cells.map(() => null);
  if (plan.tool === "paint") {
    return paintOrbit(plan.scheme, plan.base, cells).map((s) => s.hex);
  }
  // adjust. `adjustCells` owns both rules that matter — an unpainted cell is
  // skipped, and a cell the adjustment does not move is dropped — so a cell
  // missing from its result keeps whatever it already had, which `planEdits`
  // then reads as the no-op it is.
  const after = adjustCells(swatchPlate(paint, cells), cells, plan.adjust);
  return cells.map((c) => after.get(c)?.hex ?? paint.get(c) ?? null);
}

// ── the progression, and the integer it is a function of ─────────────────

/**
 * The progression the UI has selected, at the scheme it is selected alongside.
 *
 * `scheme-walk` is the one progression that reads the rest of the program: its
 * step is 360/k for the k hues of the ACTIVE scheme, so consecutive strokes land
 * on the scheme's own hues rather than between them. The record entry in
 * `progression.ts` is a fixed six-hue default so the record can be total; a UI
 * that knows its scheme must call the factory instead, which is what this does.
 */
export function activeProgression(
  name: ProgressionName,
  schemeHues: number
): Progression {
  return name === "scheme-walk" ? schemeWalk(schemeHues) : PROGRESSIONS[name];
}

/** The next `count` base colours, starting at event `n`. For the drift strip. */
export function upcomingBases(
  prog: Progression,
  base: Swatch,
  n: number,
  count: number
): Swatch[] {
  const out: Swatch[] = [];
  for (let k = 0; k < Math.max(0, count); k++) out.push(prog.at(base, n + k));
  return out;
}

/**
 * Colouring events per gesture, shadowing the undo history one rung for one.
 *
 * `past[j]` is how many events the j-th committed gesture spent. Never mutated;
 * every operation returns a new log, exactly as `History` does.
 */
export interface EventLog {
  past: number[];
  future: number[];
}

export const EMPTY_EVENTS: EventLog = { past: [], future: [] };

/**
 * Record a committed gesture.
 *
 * The trim MUST match `commit`'s — same limit, same end — or the two stacks
 * drift apart after 256 gestures and every colour computed afterwards is off by
 * however many rungs were lost. Dropping the oldest is also what makes the loss
 * harmless: n is a sum, and the events at the bottom of the stack are the ones
 * no undo can still reach.
 */
export function pushEvents(log: EventLog, events: number): EventLog {
  const past = [...log.past, events];
  return {
    past:
      past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past,
    future: [],
  };
}

export function undoEvents(log: EventLog): EventLog {
  if (log.past.length === 0) return log;
  return {
    past: log.past.slice(0, -1),
    future: [log.past[log.past.length - 1], ...log.future],
  };
}

export function redoEvents(log: EventLog): EventLog {
  if (log.future.length === 0) return log;
  const [head, ...rest] = log.future;
  return { past: [...log.past, head], future: rest };
}

/** How many colouring events the plate as it stands has spent. */
export function eventCount(log: EventLog): number {
  let n = 0;
  for (const e of log.past) n += e;
  return n;
}

/**
 * The progression's argument: events since the progression was selected.
 *
 * Rebased on `origin` — the event count at the moment the user picked this
 * progression — so choosing one drifts from where the drawing IS rather than
 * jumping to wherever a counter had wandered while it was switched off. Clamped
 * at zero because undoing past the origin would otherwise run the progression
 * backwards, and a saturation fade run backwards is a saturate.
 */
export function progressionIndex(log: EventLog, origin: number, live = 0): number {
  const n = eventCount(log) + live - origin;
  return n > 0 ? n : 0;
}

// ── band copy ────────────────────────────────────────────────────────────

/**
 * What each band family is, in words, per canvas.
 *
 * Stated here rather than in the component because it is a claim about the
 * lattice and belongs next to the code that indexes it. The three families are
 * the three EDGE directions; see the "not on offer" note in `bands.ts` for why
 * a median-parallel family cannot exist.
 */
export const BAND_NOTE: Record<CanvasKind, Record<BandFamily, string>> = {
  triangle: {
    A: "rows parallel to edge BC — stacked apex to base",
    B: "rows parallel to edge CA",
    C: "rows parallel to edge AB",
  },
  hexagon: {
    A: "rows across the figure — the same direction family A names on the triangle",
    B: "rows on constant lattice a",
    C: "rows on constant lattice b",
  },
};
