/**
 * The drawing program's memory: what a stroke is, how it is taken back, and
 * how the finished plate leaves the browser.
 *
 * A stroke here is a GESTURE, not a cell. One press-drag-release paints many
 * orbits, and undo has to take back the whole gesture, because that is what the
 * hand thinks it did. So a stroke carries a list of per-cell edits accumulated
 * over the drag, and each edit remembers the colour that was there BEFORE it.
 * Undo is then exact rather than approximate: it does not recompute what the
 * canvas "should" look like, it puts back what was measured to be there.
 *
 * ── Why `from` is stored and not derived ─────────────────────────────────
 *
 * The tempting cheaper model is a stack of paint maps, or a stack of "cells
 * touched" plus a replay of every earlier stroke. Both are wrong here for the
 * same reason: the brush is not injective on colour. Two different strokes can
 * land on the same cell with the same hue by different routes — a 6-fold brush
 * and a 3-fold brush on a mirror-pinned cell paint identical single cells — and
 * a replay cannot tell which stroke owns the pixel. Storing `from` per edit
 * makes undo a local, order-independent inverse.
 *
 * ── `null` is a colour ───────────────────────────────────────────────────
 *
 * `to: null` means "unpainted", which makes the eraser and CLEAR ordinary
 * strokes rather than special cases outside the history. CLEAR being undoable
 * costs nothing and is the difference between a toy and an instrument.
 *
 * FLOAT APPEARS ONLY IN `artworkSvg`, and only to shorten coordinates for the
 * file. Nothing in this module decides an index; cell indices arrive already
 * chosen by `orbit.ts`, which does exact integer key lookup.
 */

import type { BrushMode } from "./orbit";

/** Cell index → `#rrggbb`. Absent means unpainted. */
export type PaintMap = ReadonlyMap<number, string>;

export interface CellEdit {
  cell: number;
  /** The colour that was there. `null` = the cell was unpainted. */
  from: string | null;
  /** The colour to put there. `null` = erase. */
  to: string | null;
}

export interface Stroke {
  edits: CellEdit[];
}

export interface History {
  past: Stroke[];
  future: Stroke[];
}

export const EMPTY_HISTORY: History = { past: [], future: [] };

/**
 * How many gestures are held.
 *
 * Not a memory limit — a stroke is a few dozen bytes and a thousand of them
 * cost nothing. It is a promise limit: past this depth the undo stack is no
 * longer something a person is tracking, and an unbounded one silently turns a
 * long session into a leak. The oldest gesture is dropped, never the newest.
 */
export const HISTORY_LIMIT = 256;

// ── building a stroke ────────────────────────────────────────────────────

/**
 * The edits that would take `paint` to the given colouring of `cells`.
 *
 * No-ops are DROPPED. That matters more than it looks: a drag crosses the same
 * orbit dozens of times, and without this filter one gesture accumulates
 * thousands of identity edits whose undo is correct but whose reported "cells
 * painted" is a lie. The count this returns is the count the live region
 * announces, so it has to be the count of cells that actually changed.
 *
 * `colours` is read positionally against `cells`, which is exactly the shape
 * `paintOrbit` returns, so the two compose without an intermediate.
 */
export function planEdits(
  paint: PaintMap,
  cells: readonly number[],
  colours: readonly (string | null)[]
): CellEdit[] {
  const out: CellEdit[] = [];
  for (let k = 0; k < cells.length; k++) {
    const cell = cells[k];
    const from = paint.get(cell) ?? null;
    const to = colours[k] ?? null;
    if (from === to) continue;
    out.push({ cell, from, to });
  }
  return out;
}

/**
 * Fold fresh edits into the gesture already in progress.
 *
 * The invariant is that a merged edit's `from` is the colour at the START of
 * the gesture, never the colour halfway through it — otherwise undoing a drag
 * that crossed itself would leave the intermediate colour behind. So an
 * existing edit keeps its `from` and takes the new `to`.
 *
 * The consequence worth stating: if a drag paints a cell and then puts it back
 * the way it was, the merged edit becomes a no-op and is REMOVED. A gesture
 * that ends where it started leaves an empty stroke, which the caller declines
 * to commit, so the undo stack never grows a rung that does nothing.
 */
export function mergeEdits(
  base: readonly CellEdit[],
  next: readonly CellEdit[]
): CellEdit[] {
  const byCell = new Map<number, CellEdit>();
  for (const e of base) byCell.set(e.cell, e);
  for (const e of next) {
    const prior = byCell.get(e.cell);
    const merged: CellEdit = prior
      ? { cell: e.cell, from: prior.from, to: e.to }
      : e;
    if (merged.from === merged.to) byCell.delete(e.cell);
    else byCell.set(e.cell, merged);
  }
  // Ascending, so a stroke's edit order is a fact about the canvas rather than
  // an artefact of the path the pointer happened to take across it.
  return [...byCell.values()].sort((a, b) => a.cell - b.cell);
}

/** Every painted cell erased, as one ordinary undoable gesture. */
export function clearStroke(paint: PaintMap): Stroke {
  const edits: CellEdit[] = [];
  for (const [cell, from] of [...paint.entries()].sort((a, b) => a[0] - b[0])) {
    edits.push({ cell, from, to: null });
  }
  return { edits };
}

// ── applying and taking back ─────────────────────────────────────────────

export type EditDirection = "do" | "undo";

/** A new paint map with `edits` applied forwards or backwards. */
export function applyEdits(
  paint: PaintMap,
  edits: readonly CellEdit[],
  direction: EditDirection
): Map<number, string> {
  const out = new Map(paint);
  for (const e of edits) {
    const v = direction === "do" ? e.to : e.from;
    if (v === null) out.delete(e.cell);
    else out.set(e.cell, v);
  }
  return out;
}

/**
 * Push a finished gesture.
 *
 * The redo branch is discarded, which is the standard linear-history rule: once
 * you draw after undoing, the thing you undid is no longer a future anyone can
 * reach, and pretending otherwise produces a redo that lands on a canvas it was
 * never recorded against.
 */
export function commit(history: History, stroke: Stroke): History {
  if (stroke.edits.length === 0) return history;
  const past = [...history.past, stroke];
  return {
    past: past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past,
    future: [],
  };
}

export interface Step {
  history: History;
  /** The gesture that moved, or `null` when there was nothing to move. */
  stroke: Stroke | null;
}

export function undo(history: History): Step {
  if (history.past.length === 0) return { history, stroke: null };
  const stroke = history.past[history.past.length - 1];
  return {
    history: {
      past: history.past.slice(0, -1),
      future: [stroke, ...history.future],
    },
    stroke,
  };
}

export function redo(history: History): Step {
  if (history.future.length === 0) return { history, stroke: null };
  const [stroke, ...rest] = history.future;
  return {
    history: { past: [...history.past, stroke], future: rest },
    stroke,
  };
}

// ── leaving the browser ──────────────────────────────────────────────────

export interface ExportStamp {
  kind: string;
  depth: number;
  mode: BrushMode;
  scheme: string;
  at: Date;
  ext: "svg" | "png";
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * The download filename.
 *
 * UTC, deliberately. A filename is a record of a plate, and two people
 * comparing plates across a timezone should not find that the same export
 * carries two different stamps. It also makes this function pure in the only
 * sense that can be tested — same Date in, same string out, on any machine.
 */
export function exportName(stamp: ExportStamp): string {
  const d = stamp.at;
  const day = `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}`;
  const time = `${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}`;
  return [
    "fourfold",
    stamp.kind,
    `d${stamp.depth}`,
    `b${stamp.mode}`,
    stamp.scheme,
    day,
    time,
  ].join("-") + `.${stamp.ext}`;
}

export interface ArtCell {
  readonly verts: readonly (readonly [number, number])[];
}

export interface ArtworkSpec {
  width: number;
  height: number;
  cells: readonly ArtCell[];
  paint: PaintMap;
  /** Plate colour behind the tiling. */
  background: string;
  /** Fill for cells nobody painted, or `null` to leave them as background. */
  unpainted: string | null;
  /**
   * Hairline around unpainted cells — a light seam that shows the tiling — and
   * around painted ones — a dark seam that keeps adjacent colours apart. They
   * are separate because they are doing opposite jobs, and reusing one for both
   * makes the exported plate disagree with the board on screen.
   */
  tileSeam: string | null;
  paintSeam: string | null;
  seamWidth: number;
  title: string;
  /**
   * Weld the paint: stroke every painted cell in ITS OWN fill colour instead of
   * in `paintSeam`, so a run of same-coloured cells is one shape.
   *
   * This is not the same as `paintSeam: null`, and the difference is the whole
   * reason the flag exists. With no stroke at all, two polygons that share an
   * edge each cover about half of the boundary pixels, the plate shows through
   * the other half, and a filled row comes out with a dark hairline every cell —
   * exactly the "run of triangles" a band brush is trying not to be. Stroking
   * each cell in its own fill closes that seam at the source, in the file as
   * well as on screen, and leaves cells of DIFFERENT colours meeting cleanly
   * because each half of the join is painted in its own colour.
   *
   * Optional and absent by default, so a spec written before this existed still
   * exports exactly the bytes it did.
   */
  weldPaint?: boolean;
}

/**
 * How much wider than a hairline a weld stroke is.
 *
 * The weld exists because dropping the seam is NOT enough — that much was
 * measured directly: the same exported file, rendered once as written and once
 * with the per-cell strokes deleted, comes out as a solid band and as a ruled
 * run of triangles. So the stroke is load-bearing.
 *
 * The factor is a margin rather than a measured threshold, and the honest
 * reason is arithmetic. The seam is a hairline by construction — about 2.2% of
 * a cell edge — and a board scales its whole viewBox to fit, so at a depth-4
 * hexagon on a 700px board that hairline is 0.43 of a DEVICE pixel and on a
 * 350px phone it is 0.2. A stroke thinner than a pixel only ever covers a
 * fraction of the join it is closing. At three seam widths it is over a pixel
 * at every depth on both canvases and on both screen sizes, and still under a
 * tenth of a cell edge — so a join between two DIFFERENT colours does not
 * visibly move, both sides growing by the same amount about a boundary the
 * geometry already fixed.
 *
 * What is NOT claimed: that 1x is visibly broken at desktop scale. Rendered
 * side by side at the board's own scale, 1x and 3x were indistinguishable. The
 * factor buys the small scales, where the arithmetic says the hairline runs
 * out.
 */
export const WELD_WIDTH = 3;

/** Two decimals is under a thousandth of a cell edge at every depth we draw. */
function fmt(n: number): string {
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? "0" : String(r);
}

const points = (c: ArtCell) =>
  c.verts.map((v) => `${fmt(v[0])},${fmt(v[1])}`).join(" ");

const escapeText = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * The artwork as a standalone SVG document.
 *
 * Serialised from the MODEL, not from the live DOM. Reading the rendered board
 * back out would drag along the hover ghost, the axis overlay, the keyboard
 * cursor and the transparent hit layer — none of which are the drawing — and
 * would make the export depend on what the pointer happened to be doing. This
 * way the file contains exactly the cells and exactly the colours the paint map
 * holds, and nothing else can leak into it.
 *
 * Unpainted cells are emitted only when `unpainted` is set, so an export with
 * the tiling switched off is a clean shape on a plate rather than a full grid
 * of near-black polygons.
 */
export function artworkSvg(spec: ArtworkSpec): string {
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(spec.width)} ${fmt(
      spec.height
    )}" width="${fmt(spec.width)}" height="${fmt(spec.height)}" role="img">`
  );
  parts.push(`<title>${escapeText(spec.title)}</title>`);
  parts.push(
    `<rect width="${fmt(spec.width)}" height="${fmt(spec.height)}" fill="${spec.background}"/>`
  );

  const seamAttr = (colour: string | null) =>
    colour === null
      ? ""
      : ` stroke="${colour}" stroke-width="${fmt(spec.seamWidth)}"`;

  if (spec.unpainted !== null) {
    parts.push(`<g fill="${spec.unpainted}"${seamAttr(spec.tileSeam)}>`);
    for (let i = 0; i < spec.cells.length; i++) {
      if (spec.paint.has(i)) continue;
      parts.push(`<polygon points="${points(spec.cells[i])}"/>`);
    }
    parts.push(`</g>`);
  }

  const weld = spec.weldPaint === true;
  parts.push(`<g${weld ? "" : seamAttr(spec.paintSeam)}>`);
  for (let i = 0; i < spec.cells.length; i++) {
    const c = spec.paint.get(i);
    if (c === undefined) continue;
    parts.push(
      `<polygon points="${points(spec.cells[i])}" fill="${c}"${
        weld
          ? ` stroke="${c}" stroke-width="${fmt(spec.seamWidth * WELD_WIDTH)}"`
          : ""
      }/>`
    );
  }
  parts.push(`</g>`);

  parts.push(`</svg>`);
  return parts.join("");
}
