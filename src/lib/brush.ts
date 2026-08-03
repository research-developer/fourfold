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
 *   paint    the scheme's colour for the cell's scheme POSITION — see the note
 *            on `BrushStamp`, which is where a position comes from and why it
 *            is not simply the cell's place in the list
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
import {
  bandOrbit,
  bandOrbitGrouped,
  type BandFamily,
  type BandSurface,
} from "./bands";
import type { BrushMode, CanvasKind, SymmetrySurface } from "./orbit";
import {
  PROGRESSIONS,
  schemeWalk,
  type Progression,
  type ProgressionName,
} from "./progression";
import {
  paintKeys,
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

/**
 * One application of the brush, with the scheme's index attached to every cell.
 *
 * `brushCells` says WHICH cells. This says which cells and, for each of them,
 * which position of the colour scheme it takes — and the second half is not
 * derivable from the first, which is the entire reason this exists.
 *
 * ── The law: index the scheme by the IMAGE BAND, not by list position ────
 *
 * With no band the two coincide and nothing changes: a k-cell orbit takes the
 * scheme's k positions in order, exactly as `paintOrbit` always did.
 *
 * With a band they come apart badly. The brush paints the row through the cell
 * carried by the subgroup, which is a set of ROWS — an isometry takes a lattice
 * line to a lattice line — and indexing the scheme by position in the flattened
 * cell list hands consecutive hues to cells that happen to be adjacent in index
 * order, which is speckle. Indexing by which image band the cell belongs to
 * gives every row one hue and hands the k rows the scheme's k hues. Exact, and
 * with no tie-break anywhere: `bandOrbitGrouped` returns the bands themselves.
 *
 * ── Crossings ───────────────────────────────────────────────────────────
 *
 * Image bands are lines and lines of different families cross, so a cell can
 * lie in two of them at once — and in three, where a band runs through the
 * triangle's hub, which is fixed by all of D3 and so lands in every image at
 * once. A cell takes ONE colour, so the tie is settled by rule: the LOWEST
 * group index wins. The source band is group 0, so it keeps every cell it holds
 * and each later image yields to every earlier one. Deterministic, and a total
 * order rather than a pairwise tie-break precisely because three-way overlaps
 * exist. Measured in `test/bandcolour.test.ts` rather than hoped for: the
 * hexagon's twelve crossing cells per seed at mode 6 are exactly the twelve
 * non-parallel pairs among six rows, and nothing anywhere lies in four.
 *
 * `span` is what the scheme is indexed OVER — the number of image bands, not
 * the number of cells — so a 6-fold hexad band reads as six hues even though it
 * covers hundreds of cells, and the analogous scheme fans its lightness across
 * the rows rather than across the cell list.
 */
export interface BrushStamp {
  /** The cells one application touches, ascending. Equal to `brushCells`. */
  cells: number[];
  /** The scheme position each cell takes, aligned to `cells`. */
  keys: number[];
  /** How many positions the scheme is indexed over. */
  span: number;
  /**
   * The image bands, identity first, when the brush carries a band. `null` for
   * a plain orbit — where there is no grouping, not a grouping of one.
   */
  groups: number[][] | null;
}

/** The positional stamp: cell k of the list takes scheme position k. */
function positionalStamp(cells: number[]): BrushStamp {
  return {
    cells,
    keys: cells.map((_, k) => k),
    span: cells.length,
    groups: null,
  };
}

export function brushStamp(
  surface: SymmetrySurface,
  bands: BandSurface,
  i: number,
  shape: BrushShape
): BrushStamp {
  if (shape.band === null) return positionalStamp(surface.orbit(i, shape.mode));

  const groups = bandOrbitGrouped(surface, bands, i, shape.band, shape.mode);
  // First writer wins, and the groups arrive in ascending index order, so this
  // IS the lowest-index rule — stated as an insertion order rather than as a
  // comparison, which is one fewer place for it to be got backwards.
  const key = new Map<number, number>();
  groups.forEach((g, k) => {
    for (const c of g) if (!key.has(c)) key.set(c, k);
  });
  const cells = [...key.keys()].sort((a, b) => a - b);
  return {
    cells,
    keys: cells.map((c) => key.get(c) as number),
    span: groups.length,
    groups,
  };
}

/**
 * How many positions of the scheme this brush shape will use.
 *
 * What the colour tape in the UI is a picture of. Without a band it is the
 * mode: a generic orbit is |H| cells long and takes |H| hues, and a cell with a
 * non-trivial stabiliser takes fewer — which the tape cannot show without
 * knowing which cell, and which the panel says in words instead.
 *
 * With a band it is the number of IMAGE BANDS, and that number is emphatically
 * not the mode. A 6-fold brush is D3 on the triangle, where m_A fixes the
 * family-A bands and the band orbit is three rows, and C6 on the hexagon, where
 * it is six. Probed at cell 0 by default, because on the whole-plate groups the
 * count is a fact about the subgroup and the family and NOT about the cell:
 * `test/bandcolour.test.ts` measures it at every cell of both canvases and
 * finds exactly one value per (canvas, mode, family). If that ever stopped
 * being true the test would fail before this function started lying.
 *
 * ── Why there is a seed after all ───────────────────────────────────────
 *
 * That invariance is a property of the whole-plate groups, and the SECTOR scope
 * does not have it. A hexagon band clipped to sector s is a band of the base
 * triangle in family (A, B, C)[s mod 3] — the sector is a rotated copy, so the
 * lattice direction the family names arrives rotated too — and the local D3
 * treats the three triangle families differently: ⟨m_A⟩ fixes a family-A band
 * and swaps B with C, so a mode-2 sector brush spans 1 row in sectors 0, 3 and
 * 2 rows in the other four. Passing the seed is how a readout can be right
 * about the sector the pointer is actually in.
 */
export function brushSpan(
  surface: SymmetrySurface,
  bands: BandSurface,
  shape: BrushShape,
  seed = 0
): number {
  if (shape.band === null) return surface.order(shape.mode);
  return bandOrbitGrouped(surface, bands, seed, shape.band, shape.mode).length;
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
export function stampColours(
  plan: ColourPlan,
  paint: PaintMap,
  stamp: BrushStamp
): (string | null)[] {
  const { cells } = stamp;
  if (plan.tool === "erase") return cells.map(() => null);
  if (plan.tool === "paint") {
    return paintKeys(plan.scheme, plan.base, stamp.keys, stamp.span).map(
      (s) => s.hex
    );
  }
  // adjust. `adjustCells` owns both rules that matter — an unpainted cell is
  // skipped, and a cell the adjustment does not move is dropped — so a cell
  // missing from its result keeps whatever it already had, which `planEdits`
  // then reads as the no-op it is. The scheme is not consulted at all, so the
  // stamp's keys are irrelevant here and an adjustment behaves identically
  // whether or not a band is in play.
  const after = adjustCells(swatchPlate(paint, cells), cells, plan.adjust);
  return cells.map((c) => after.get(c)?.hex ?? paint.get(c) ?? null);
}

/**
 * The colours for a bare cell list, indexed POSITIONALLY.
 *
 * The original form, kept because it is the honest answer whenever the caller
 * has cells and no grouping — and because that is exactly what an orbit is.
 * A caller holding a band stamp must use `stampColours`, or it will paint the
 * speckle this pair of functions exists to tell apart.
 */
export function brushColours(
  plan: ColourPlan,
  paint: PaintMap,
  cells: readonly number[]
): (string | null)[] {
  return stampColours(plan, paint, positionalStamp([...cells]));
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
