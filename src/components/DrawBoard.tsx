"use client";

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ReactElement,
} from "react";
import type { Direction, Guides, RotationGuide } from "@/lib/guides";
import { WELD_WIDTH, type PaintMap } from "@/lib/strokes";

/**
 * The drawing surface.
 *
 * Four things had to be true at once here, and they pull against each other:
 *
 *   1. A drag paints. On touch as well as with a mouse, and without the page
 *      scrolling out from under the finger.
 *   2. Depth-4 hexagon is 1536 cells, and the pointer moves at ~120 Hz.
 *   3. The hover preview and the keyboard cursor change on nearly every one of
 *      those events.
 *   4. The tiling underneath never changes at all.
 *
 * So the board is stacked in layers by RATE OF CHANGE, and each layer is a
 * memoised component with only the props it truly depends on. The static
 * tiling and the transparent hit layer render once per figure and are never
 * touched again; the paint layer renders once per stroke step; only the
 * preview, the cursor and the axis overlay follow the pointer, and those are at
 * most a dozen elements each.
 *
 * ── Why the hit layer carries no handlers ────────────────────────────────
 *
 * Putting `onPointerEnter` on 1536 polygons means rebuilding 1536 closures
 * every render, which defeats the memoisation the layer exists for. Instead
 * every polygon carries `data-i` and ONE set of handlers sits on the <svg>.
 * The hit layer is painted last, so it is always the topmost element under the
 * pointer, and `event.target` names the cell directly.
 *
 * ── The touch capture that has to be given back ──────────────────────────
 *
 * A touch pointer is IMPLICITLY captured by the element that received
 * pointerdown, so every subsequent pointermove reports that same element as its
 * target and a drag paints exactly one cell forever. Releasing the capture on
 * pointerdown is the fix, and it is the entire reason drag-to-paint works on a
 * phone.
 *
 * ── Two drag behaviours, and why the second one exists ───────────────────
 *
 * A finger has no hover. The ghost preview — the thing that TEACHES what a
 * symmetry brush is about to do — is therefore unreachable on a phone, where it
 * is needed most, because the first contact with the plate is already a stroke.
 *
 * `propose` mode makes the press itself the hover: a drag GATHERS applications
 * and commits nothing, lifting the finger leaves them standing, and a tap on
 * them lays the paint. Two consequences fall out for free. The proposal survives
 * a change of brush, scheme or colour, so the settings can be auditioned against
 * a real proposal before anything is committed; and a mis-aimed first touch
 * costs nothing, which on a 390px screen is the difference between a drawing
 * tool and a guessing game.
 *
 * The commit gesture is a TAP ON THE PROPOSAL, not a tap anywhere, so the "add
 * to it" and "keep it" gestures never contend: pressing inside the standing
 * proposal arms a commit and pressing outside it adds. Dragging away from an
 * armed press disarms it, because that is a drag and not a tap.
 *
 * ── The third gesture: DOUBLE-TAP, and what it had to be guarded against ──
 *
 * A double-tap drills the focus in or out (`lib/focus.ts` decides which; this
 * component only reports the cell). Three guards, and each one is a bug that was
 * reachable without it.
 *
 * THE BROWSER'S OWN DOUBLE-TAP. On touch, two quick taps are the UA's
 * zoom-to-fit gesture and on a desktop they are a text selection. `touch-action:
 * none` on the canvas already takes the first — it is set for drag-to-paint and
 * happens to cover this — and `preventDefault` on the second press takes the
 * second. Both are needed: `touch-action` does nothing about a mouse, and
 * `preventDefault` on a touch pointerdown does not suppress a UA zoom that is
 * decided from the touch stream rather than the pointer stream.
 *
 * IT IS DECIDED ON THE RELEASE, NOT THE PRESS. With a sector drilled into,
 * "outside" is five sixths of the plate, so a stroke that begins with a slightly
 * mis-aimed press would read as "leave this sector" if the second press alone
 * decided it. So the second press only ARMS the gesture, and the release fires
 * it — and only if the pointer never moved past `TAP_SLOP`. A press that turns
 * into a drag arms nothing.
 *
 * WHAT THAT COSTS, stated rather than hidden: the armed press lays no paint, so
 * a drag that BEGINS as the second of two quick taps on one cell is swallowed
 * whole. The alternative — paint on the press and exit on the release as well —
 * is the mis-aim the guard exists to stop, and the alternative to THAT is
 * deferring every press by `DOUBLE_TAP_MS` to see whether a second one arrives,
 * which is the 300 ms tap delay that touch UIs spent a decade removing. On a
 * drawing surface a press has to mark immediately or the tool feels broken.
 *
 * The FIRST tap of the pair is an ordinary press and does whatever the tool
 * does. Entering therefore costs one application; leaving costs nothing at all,
 * because the exit tap lands outside the focus where the page already refuses to
 * paint. That asymmetry is the right way round — leaving is the gesture a
 * mis-aim can reach.
 *
 * A TAP ON A STANDING PROPOSAL IS NOT THE SECOND OF A PAIR. The commit gesture
 * and the drill-in gesture are the same two taps on the same cell — gathering a
 * proposal at X and then committing it IS "tap X, tap X" — so one of them has to
 * be tested first and the other one loses. The commit wins; `commitsProposal`
 * carries the reason. Outside a standing ghost, which is the whole plate
 * whenever no proposal is up, the double-tap is unchanged.
 *
 * ── A drag gathers, it does not replace ─────────────────────────────────
 *
 * It used to replace: every cell the finger crossed became THE candidate and the
 * one before it was forgotten, so the mode that exists for touch could lay
 * exactly one application per gesture while the mode that exists for a mouse
 * could lay a hundred. `onPropose` is now called on the press and on every cell
 * the drag enters — the same event stream `onPaint` gets in paint mode, which is
 * the whole point — and the page accumulates them. See `lib/propose.ts` for the
 * accumulation rule, and `page.tsx`'s `commitProposal` for why the whole run
 * commits as ONE rung of the journal.
 */

export interface BoardCell {
  readonly verts: readonly (readonly [number, number])[];
  readonly centroid: readonly [number, number];
}

export interface BoardGeometry {
  width: number;
  height: number;
  /** The figure's outer boundary, as a closed polygon. */
  outline: readonly (readonly [number, number])[];
  cells: readonly BoardCell[];
  /** Hairline width in canvas units, chosen for the depth. */
  seamWidth: number;
  /**
   * The cell indices this view draws, ascending. Absent means all of them.
   *
   * The board is handed the WHOLE model and told which part of it is framed,
   * rather than a shortened array, because every index it reports back — a hover,
   * a paint, a cursor — is an index on the model, and renumbering them at the
   * edge of the render layer would mean a second address space for the page to
   * translate. So the array stays whole and the layers walk this list.
   */
  shown?: readonly number[];
}

export interface PreviewSpec {
  /** The cells that would take colour. */
  cells: readonly number[];
  /** Their colours, aligned to `cells`. */
  colours: readonly string[];
  /**
   * Cells under the brush that would NOT change — an adjustment landing on a
   * cell nobody has painted yet. Outlined and not filled, because "the brush
   * reaches here and will do nothing" is a fact worth showing rather than an
   * absence worth hiding.
   */
  inert: readonly number[];
  /** The cell actually under the pointer. */
  seed: number;
  /** True when the brush would erase rather than paint. */
  erasing: boolean;
}

/** True when the spec's brush reaches cell `i` at all, inert or not. */
export const previewCovers = (spec: PreviewSpec, i: number): boolean =>
  spec.cells.includes(i) || spec.inert.includes(i);

export type DragBehaviour = "paint" | "propose";

/**
 * What a press-drag-release lays down.
 *
 * `free` is the brush: every cell the pointer crosses is an application. The
 * other two are ANCHORED — the press names a cell and the drag names a second,
 * and nothing is painted until the release, so the whole figure is a single
 * gesture and a single rung of the undo stack. See `lattice.ts` for what each
 * one is on the lattice.
 */
export type ShapeTool = "free" | "line" | "ring";

/**
 * The visible window, in canvas units.
 *
 * `null` is the whole figure, which is what the board always showed. Anything
 * else is a zoom: the SVG's own `viewBox` is narrowed, so every layer, every
 * guide and — crucially — the transparent hit layer scale together and a click
 * still lands on the cell under the finger. Nothing about the model moves, so an
 * export taken while zoomed is the same file as one taken while not.
 */
export interface ViewWindow {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A zoom factor and a centre — the two numbers the page's view state holds.
 *
 * Returned rather than applied, because the page owns the transform and there is
 * exactly one of it. See `focusFrame`.
 */
export interface FocusFrame {
  zoom: number;
  cx: number;
  cy: number;
}

/**
 * The window that makes a set of cells fill the canvas.
 *
 * Pure, and exported for the tests, because it is the one piece of drill-in that
 * is real arithmetic and the page cannot be rendered under vitest — there is no
 * jsdom here. Everything else about the gesture is structure.
 *
 * ── Why a bounding box of VERTICES and not of centroids ─────────────────
 *
 * A centroid box is the box of the cells' MIDDLES, which is smaller than the
 * cells by about half a cell on each side, so framing to it crops the outer ring
 * of whatever was focused. At depth 2 an arm is 5 cells and the error is a fifth
 * of the picture; it shrinks with depth but never to nothing, and the one thing
 * a "make this fill the canvas" gesture must not do is cut the thing off.
 *
 * ── `margin` is a FRACTION of the box, not a pixel inset ────────────────
 *
 * The canvas is scaled to the viewport by CSS and the figure is drawn in its own
 * units, so a pixel inset would be a different visual gap at every depth and
 * every window size. A fraction is the same gap everywhere.
 *
 * ── The cases that return `null`, and why they are not errors ───────────
 *
 * An empty cell list and a box of zero area both mean "there is nothing here to
 * frame". `focus.focusCells` says outright that it may return nothing — a fresh
 * layer, a hidden layer, an erase gesture, a query that matched nothing — and
 * the documented answer is to KEEP THE FRAME YOU HAVE rather than zoom to a
 * degenerate box. `null` is that answer, and it is a value rather than a throw so
 * the caller's handling of it is one `if` at the one place it can happen.
 *
 * Indices that are not on this geometry are skipped rather than refused: the
 * page hands over model indices and a framed sector's geometry only carries the
 * ones it draws, so a focus naming cells in another sector is an ordinary state
 * and not a bug.
 */
export function focusFrame(
  geom: BoardGeometry,
  cells: Iterable<number>,
  maxZoom: number,
  margin = 0.14
): FocusFrame | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const i of cells) {
    const cell = geom.cells[i];
    if (cell === undefined) continue;
    for (const [x, y] of cell.verts) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX)) return null;
  const bw = (maxX - minX) * (1 + margin);
  const bh = (maxY - minY) * (1 + margin);
  if (bw <= 0 && bh <= 0) return null;
  // A box with no width is a legitimate degenerate — a single column of cells —
  // and `Infinity` is the honest scale for it, which the clamp then takes down
  // to `maxZoom`. Only a box with NEITHER extent is nothing to look at.
  const fit = Math.min(
    bw <= 0 ? Infinity : geom.width / bw,
    bh <= 0 ? Infinity : geom.height / bh
  );
  return {
    zoom: Math.min(maxZoom, Math.max(1, fit)),
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
  };
}

/** A completed zero-drag tap: which cell, and when it was let go. */
export interface Tap {
  cell: number;
  t: number;
}

/**
 * How long a second tap has to arrive within, in milliseconds.
 *
 * 400 rather than the ~300 a browser uses, because this gesture is made with a
 * whole hand over a large target rather than with a thumb over a link, and
 * because the cost of being slightly generous is bounded: a slow pair of taps
 * that misses the window is two ordinary presses, which is what they would have
 * been anyway.
 */
export const DOUBLE_TAP_MS = 400;

/**
 * How far the pointer may travel and still count as a tap, in CLIENT pixels.
 *
 * Client pixels and not canvas units, because this is about whether a hand held
 * still — a fact about the hand — and the canvas may be at any zoom. A finger
 * that never leaves its cell can still wander several pixels while it presses.
 */
export const TAP_SLOP = 8;

/**
 * Is this press the second half of a double-tap?
 *
 * SAME CELL, not merely nearby: two taps a cell apart are two taps, and on a
 * plate whose cells are the things being addressed, "which cell" is the only
 * identity that means anything. `TAP_SLOP` covers the hand's wobble WITHIN one
 * press; it deliberately does not smear across cells.
 *
 * Pure and exported for the tests, for the same reason `focusFrame` is: this is
 * the decision the guard rests on and there is no jsdom to press a button in.
 */
export function isDoubleTap(
  prev: Tap | null,
  cell: number,
  t: number,
  within = DOUBLE_TAP_MS
): boolean {
  if (prev === null || prev.cell !== cell) return false;
  const dt = t - prev.t;
  // A non-negative test as well as an upper one: event timestamps come from two
  // listeners (a press here, a release on the window) and a clock that appeared
  // to run backwards would otherwise read as an instant double-tap.
  return dt >= 0 && dt <= within;
}

/**
 * Is this press the COMMIT of a standing proposal?
 *
 * THE ONE ANSWER, asked twice by `down` and asked in that order for a reason.
 * A tap inside the standing ghost is the documented commit gesture — see the
 * header — and the cell it lands on is necessarily the cell the tap that
 * gathered the proposal landed on, so it is also, unavoidably, the second of two
 * quick taps on one cell. Whichever of the two gestures is tested first wins
 * every time, and the drill-in used to be: it armed, the release fired
 * `onFocusTap`, the page entered a sector and dropped the proposal, and the
 * gathered work went with it. Propose mode is the default on touch, where Enter
 * — the only other commit route — does not exist, so that was the whole feature
 * on the whole platform it was built for.
 *
 * So the commit wins, and the argument is not merely "it was reported": a tap
 * inside the ghost ALREADY HAS A MEANING, stated on screen by the marching
 * outline and by the live region, and a gesture that takes a meaning away from
 * a control the user is looking at is worse than one that is unreachable. The
 * drill-in keeps every cell that is not under a standing ghost, which at the
 * moment a proposal stands is nearly the whole plate, and keeps all of them when
 * none does.
 *
 * ANY of the gathered applications counts, because the whole ghost is one tap
 * target — the whole ghost is one gesture. The shape and drag conditions are
 * named here rather than inherited from the caller's branch order: `candidate`
 * is empty in the other modes today, and this must not become a fact about what
 * the page happens to pass down.
 *
 * Pure and exported for the tests, for the same reason `isDoubleTap` is.
 */
export function commitsProposal(
  shape: ShapeTool,
  drag: DragBehaviour,
  candidate: readonly PreviewSpec[],
  i: number
): boolean {
  if (shape !== "free" || drag !== "propose") return false;
  return candidate.some((c) => previewCovers(c, i));
}

/** What a release does to a live propose-mode press. See `proposeRelease`. */
export type ProposeRelease = "commit" | "cancelled" | "nothing";

/**
 * A propose-mode press has ended. Does the plate change?
 *
 * `"commit"` only for a press that ARMED on the standing ghost, never travelled
 * past `TAP_SLOP`, and was released by the HAND.
 *
 * `"cancelled"` is the third answer and the reason this is a function rather
 * than a conjunction. A `pointercancel` is the browser taking the pointer away —
 * palm rejection, an OS edge gesture, a second contact starting a pinch, an
 * orientation change, a long-press context menu — and it can never complete a
 * tap, exactly as it can never complete a double-tap one branch above. This is
 * the branch where that matters most: it is the only one that writes to the
 * plate, so the version of this test that omitted `cancelled` would paint every
 * application of a standing proposal, with a rung in the journal, off a finger
 * that never came up.
 *
 * It is told apart from `"nothing"` because the proposal SURVIVES a cancel and
 * the user is left looking at a ghost that did not commit. A decline that says
 * nothing at all is a control that reads as broken; declines here are counted
 * preconditions, not silences. `"nothing"` is the ordinary case — a press that
 * was never on the ghost, or that became a drag — and has nothing to report,
 * because the drag itself was the report.
 */
export function proposeRelease(
  armed: boolean,
  moved: boolean,
  cancelled: boolean
): ProposeRelease {
  if (!armed || moved) return "nothing";
  return cancelled ? "cancelled" : "commit";
}

/**
 * The relief, as the board needs it: the plate's polygons already deformed.
 *
 * Everything here is a DISPLAY substitution — the same cells, in the same order,
 * with the same indices, drawn somewhere else. The board never learns what the
 * deformation is; it is handed the answer, which is what keeps a lens out of the
 * component that owns hit-testing and undo.
 *
 * It arrives whole and changes ONLY when the template ring changes. That is the
 * cheapness: a pointer sweeping a depth-4 hexagon crosses some fifty rings, so
 * the 1536 polygons are rewritten fifty times over a whole sweep rather than
 * once per pointer event. In between, this object is referentially identical and
 * the memoised tiling and hit layers do not re-render at all.
 */
export interface ReliefView {
  /** `points` text per cell, aligned to `geom.cells`. */
  points: readonly string[];
  centroids: readonly (readonly [number, number])[];
  /** Cells grouped by the tone they take, darkest last. */
  wash: readonly { fill: string; alpha: number; cells: readonly number[] }[];
  /** The same remap applied to a loose canvas point, for the axis overlay. */
  bend: (p: readonly [number, number]) => readonly [number, number];
}

interface Props {
  geom: BoardGeometry;
  /** `null` when the relief is off, which is also the exported-file default. */
  relief: ReliefView | null;
  paint: PaintMap;
  preview: PreviewSpec | null;
  /**
   * The standing proposal in `propose` mode, ONE ENTRY PER APPLICATION the drag
   * gathered, in the order it gathered them. Empty when nothing stands.
   *
   * A list and not a single spec, because a propose drag accumulates: see
   * `lib/propose.ts` for why the seeds are kept apart rather than merged, and
   * `Ghost` below for what one entry looks like. A tap anywhere inside ANY of
   * them commits the whole thing.
   */
  candidate: readonly PreviewSpec[];
  cursor: number | null;
  guides: Guides;
  showGuides: boolean;
  showTiling: boolean;
  /** Stroke painted cells in their own fill, so a filled row is one shape. */
  weld: boolean;
  dragBehaviour: DragBehaviour;
  /** The anchored tool in hand. `free` is the ordinary brush. */
  shape: ShapeTool;
  /**
   * Space is held, so the pointer drags the PLATE rather than paint.
   *
   * A modifier and not a mode: it is reported by the page, which owns the key
   * state, and it overrides every other gesture while it is true. Only useful
   * while `view` is narrowed — see the note in `page.tsx` on why zoom had to
   * arrive with it.
   */
  panning: boolean;
  /** `null` shows the whole figure, exactly as the board always did. */
  view: ViewWindow | null;
  /**
   * The cells the focus HOLDS, or `null` at the root.
   *
   * Everything NOT in this set is dulled — dimmed, not hidden, which is the
   * whole of the owner's brief: "it doesn't disappear the canvas, just zooms in
   * so the triangle fills the canvas and greatly dulls the other sides". The
   * complement is what gets drawn over, so `null` is genuinely cheaper than a set
   * holding every index and is also the honest statement: there is no focus, not
   * a focus that admits everything. Same shape and same reasoning as `visible`.
   *
   * The board does not know what a focus IS. It is handed the answer, exactly as
   * it is handed the relief's deformed points, which is what keeps `lib/focus.ts`
   * out of the component that owns hit-testing.
   */
  focused: ReadonlySet<number> | null;
  label: string;
  /** Supplied by the page, which owns the CSS module the class lives in. */
  className: string;
  /** Ditto: the marching-ants animation on the candidate outline. */
  candidateClass: string;
  /** Ditto: the dim layer's fade, which `prefers-reduced-motion` turns off. */
  dimClass: string;
  onHover: (i: number | null) => void;
  onPaint: (i: number) => void;
  onStrokeEnd: () => void;
  onPropose: (i: number) => void;
  onCommit: () => void;
  /**
   * An armed commit tap was taken away by the browser rather than released.
   *
   * A SEPARATE CALLBACK and not a flag on `onCommit`, because the two are not
   * two flavours of one event: one lays paint and one lays none. The page has to
   * say something — the proposal is still standing and the tap it just received
   * did nothing visible — and a decline that shares a door with a commit is a
   * decline that will one day be routed through the committing half of it.
   * See `proposeRelease` for the four ways a browser takes a pointer away.
   */
  onCommitCancelled: () => void;
  onArrow: (dir: Direction) => void;
  /**
   * The anchored drag moved. `anchor` never changes during one gesture, `at` is
   * the cell under the pointer now, and `alt` is Option/Alt as it stands at this
   * instant — read off every event rather than once at the press, so letting go
   * of the modifier mid-drag changes the figure under the finger.
   */
  onShapeDrag: (anchor: number, at: number, alt: boolean) => void;
  /** The anchored drag ended. The page turns the standing figure into a stroke. */
  onShapeEnd: () => void;
  /** A pan, in CANVAS units — the board converts, the page only translates. */
  onPan: (dx: number, dy: number) => void;
  /**
   * A clean double-tap landed on this cell. What it MEANS is the page's to
   * decide — `focus.gestureFor` answers enter, exit or nothing — because
   * "inside" is a fact about the focus path and this component holds no path.
   *
   * Fired on the release of the second press and only when that press never
   * became a drag. See the header for the two things that buys and the one thing
   * it costs.
   */
  onFocusTap: (i: number) => void;
}

/**
 * Plate and tile.
 *
 * The tile is OPAQUE and slightly lighter than the plate at every radius, not a
 * translucent white over the vignette. Two reasons: the unpainted tiling has to
 * lift off the plate uniformly rather than fading out at the rim where the
 * vignette darkens, and the exported SVG has to be able to name the same colour
 * without reproducing a gradient it does not carry.
 */
const PLATE = "#0d0b0a";
const PLATE_LIT = "#171412";
export const TILE = "#201c19";
export const SEAM = "rgba(236,230,220,.16)";
export const PAINT_SEAM = "rgba(10,9,8,.34)";

const points = (c: { readonly verts: readonly (readonly [number, number])[] }) =>
  c.verts.map((v) => `${v[0]},${v[1]}`).join(" ");

const line = (p: readonly [number, number]) => `${p[0]},${p[1]}`;

/**
 * The tiling. Renders once per figure — and, with the relief on, once per ring
 * the pointer crosses, which is what `pts` changing identity means.
 */
const TileLayer = memo(function TileLayer({
  geom,
  pts,
  order,
  show,
}: {
  geom: BoardGeometry;
  pts: readonly string[];
  order: readonly number[];
  show: boolean;
}) {
  if (!show) return null;
  return (
    <g
      data-layer="tiling"
      fill={TILE}
      stroke={SEAM}
      strokeWidth={geom.seamWidth}
      pointerEvents="none"
    >
      {order.map((i) => (
        <polygon key={i} points={pts[i]} />
      ))}
    </g>
  );
});

/**
 * The relief's tone, one group per ring rather than one element per cell.
 *
 * Flat black at an alpha, which is an ordinary multiply — see the note in
 * `relief.ts` on why no blend mode appears anywhere. The fill sits on the GROUP,
 * so `importByGeometry` cannot mistake a wash for paint when the file is read
 * back by something that has not found the payload.
 */
const WashLayer = memo(function WashLayer({
  pts,
  wash,
  visible,
}: {
  pts: readonly string[];
  wash: readonly { fill: string; alpha: number; cells: readonly number[] }[];
  visible: ReadonlySet<number> | null;
}) {
  return (
    <g data-layer="relief" pointerEvents="none">
      {wash.map((band) => (
        <g
          key={`${band.fill}-${band.alpha}`}
          fill={band.fill}
          opacity={band.alpha}
        >
          {band.cells.map((i) =>
            visible !== null && !visible.has(i) ? null : (
              <polygon key={i} points={pts[i]} />
            )
          )}
        </g>
      ))}
    </g>
  );
});

/**
 * Only the painted cells. Re-renders once per stroke step.
 *
 * `weld` is what makes a band read as one thick line instead of a run of
 * triangles. Turning the seam OFF is not enough on its own: two polygons that
 * share an edge each cover about half of the boundary pixels, and the plate
 * shows through the rest as a dark hairline at every cell. Stroking each cell in
 * its own fill closes the join at the source, and cells of different colours
 * still meet cleanly because each side of the join is painted in its own colour.
 * `artworkSvg`'s `weldPaint` does the identical thing in the exported file.
 */
const PaintLayer = memo(function PaintLayer({
  geom,
  pts,
  paint,
  visible,
  weld,
}: {
  geom: BoardGeometry;
  pts: readonly string[];
  paint: PaintMap;
  visible: ReadonlySet<number> | null;
  weld: boolean;
}) {
  const out: ReactElement[] = [];
  for (const [i, colour] of paint) {
    const p = pts[i];
    if (p === undefined) continue;
    // Paint in an unframed sector is still ON the plate — it is simply not in
    // this picture. Skipped rather than dropped from the model, which is the
    // difference between a view and a canvas.
    if (visible !== null && !visible.has(i)) continue;
    out.push(
      <polygon
        key={i}
        points={p}
        fill={colour}
        stroke={weld ? colour : undefined}
      />
    );
  }
  return (
    <g
      data-layer="paint"
      stroke={weld ? undefined : PAINT_SEAM}
      strokeWidth={weld ? geom.seamWidth * WELD_WIDTH : geom.seamWidth}
      pointerEvents="none"
    >
      {out}
    </g>
  );
});

/**
 * How much of the plate shows through outside the focus.
 *
 * A scrim in the PLATE's own colour rather than a global `opacity` on the layers
 * underneath. Two reasons, and the second is the load-bearing one. An opacity on
 * the paint layer would fade it toward whatever is behind it, which at the rim is
 * the vignette's dark end and at the centre its light end, so the same colour
 * would dull by different amounts depending on where it sat. And `opacity` on a
 * group of 1500 polygons is a composited layer the browser has to allocate,
 * where a flat fill is not.
 *
 * 0.78 was chosen against the brief's words — "greatly dulls the other sides",
 * not "hides them". A fifth of the paint survives, which is enough to read a
 * six-fold stroke's shape in the five sectors you are not inside and not nearly
 * enough to mistake for the sector you are.
 */
const DIM = 0.78;

/**
 * Everything OUTSIDE the focus, dulled.
 *
 * Re-renders only when the focus changes, which is once per drill-in — the set
 * arrives whole from the page and is memoised there, so a pointer move does not
 * touch this at all.
 *
 * DRAWN AFTER THE GUIDES AND BEFORE THE GHOSTS, which is the whole of the layer
 * choice. Under the ghosts and the cursor, because those are statements about
 * what the brush is ABOUT to do and must stay legible over a dulled plate. Over
 * the guides, so the symmetry axes fade out with the cells they cross — a spine
 * mirror that stayed at full strength across five dimmed sectors would be the
 * loudest thing on a screen whose point is that those sectors are not where you
 * are working. And under the hit layer, which is untouched: the plate outside the
 * focus is still clickable, because the gesture that LEAVES a focus is a tap on
 * exactly that plate.
 */
const DimLayer = memo(function DimLayer({
  pts,
  order,
  focused,
  className,
}: {
  pts: readonly string[];
  order: readonly number[];
  focused: ReadonlySet<number>;
  className: string;
}) {
  return (
    <g
      data-layer="dim"
      className={className}
      fill={PLATE}
      // `fill-opacity` and NOT `opacity`, and this was a real bug before it was
      // a comment. The fade in the stylesheet animates the CSS `opacity`
      // property, and a CSS property beats an SVG PRESENTATION ATTRIBUTE of the
      // same name — so `opacity={DIM}` here would have been overridden to 1 for
      // the whole of the animation and left there by its `both` fill, making the
      // scrim fully opaque and the plate outside the focus genuinely disappear.
      // The two multiply, so on this axis they compose instead of fighting.
      //
      // It costs nothing else: the cells are a tiling and do not overlap, so
      // per-fill alpha and group alpha are the same picture — and per-fill is
      // the cheaper of the two, because group `opacity` needs an offscreen
      // buffer and this does not.
      fillOpacity={DIM}
      pointerEvents="none"
    >
      {order.map((i) =>
        focused.has(i) ? null : <polygon key={i} points={pts[i]} />
      )}
    </g>
  );
});

/**
 * Transparent, topmost, and the only thing the pointer ever hits.
 *
 * It carries the SAME deformed points as everything else, so a click lands on
 * the cell that is under the finger rather than on the cell that would have been
 * there with the relief off. A lens the pointer does not go through is a lens
 * that has broken the drawing program.
 */
const HitLayer = memo(function HitLayer({
  pts,
  order,
}: {
  pts: readonly string[];
  order: readonly number[];
}) {
  return (
    <g data-layer="hit" fill="transparent">
      {order.map((i) => (
        <polygon key={i} data-i={i} points={pts[i]} />
      ))}
    </g>
  );
});

const FAMILY_COLOUR: Record<string, string> = {
  m_A: "#67e8f9",
  m_B: "#4ade80",
  m_C: "#f59e0b",
};

const polar = (
  cx: number,
  cy: number,
  r: number,
  deg: number
): [number, number] => {
  const t = (deg * Math.PI) / 180;
  // SVG y grows downward, so a positive mathematical angle turns anticlockwise
  // on screen only if the y term is subtracted.
  return [cx + r * Math.cos(t), cy - r * Math.sin(t)];
};

const arcPath = (cx: number, cy: number, r: number, a0: number, a1: number) => {
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 0 ${x1} ${y1}`;
};

/**
 * The axis overlay.
 *
 * Mirrors are drawn twice — a wide, faint pass under a narrow, bright one — so
 * a hairline stays visible over saturated paint without being a heavy line over
 * bare plate. Rotational subgroups get arcs and a centre mark instead, because
 * they HAVE no mirror: see the note at the top of `guides.ts`.
 */
const RotationMark = memo(function RotationMark({
  rot,
  quiet,
}: {
  rot: RotationGuide;
  quiet: boolean;
}) {
  const gap = Math.min(22, 120 / rot.order);
  return (
    <g stroke="#a78bfa" fill="none">
      <circle
        cx={rot.cx}
        cy={rot.cy}
        r={rot.radius}
        strokeWidth={1}
        opacity={0.2}
        strokeDasharray="3 6"
      />
      {Array.from({ length: rot.order }, (_, k) => {
        const step = 360 / rot.order;
        const a0 = k * step + gap / 2;
        const a1 = (k + 1) * step - gap / 2;
        const [hx, hy] = polar(rot.cx, rot.cy, rot.radius, a1);
        const t = (a1 * Math.PI) / 180;
        // Tangent of the anticlockwise sweep, in screen coordinates.
        const tx = -Math.sin(t);
        const ty = -Math.cos(t);
        const nx = -ty;
        const ny = tx;
        const s = Math.max(7, rot.radius * (quiet ? 0.05 : 0.07));
        return (
          <g key={k}>
            <path
              d={arcPath(rot.cx, rot.cy, rot.radius, a0, a1)}
              strokeWidth={quiet ? 2 : 3.6}
              opacity={quiet ? 0.5 : 0.92}
              strokeLinecap="round"
            />
            <polygon
              points={`${hx + tx * s},${hy + ty * s} ${hx - nx * s * 0.55},${
                hy - ny * s * 0.55
              } ${hx + nx * s * 0.55},${hy + ny * s * 0.55}`}
              fill="#a78bfa"
              stroke="none"
              opacity={quiet ? 0.6 : 0.95}
            />
          </g>
        );
      })}
      <circle
        cx={rot.cx}
        cy={rot.cy}
        r={quiet ? 5 : 7}
        strokeWidth={quiet ? 2 : 2.6}
        opacity={0.92}
      />
      <circle
        cx={rot.cx}
        cy={rot.cy}
        r={2}
        fill="#a78bfa"
        stroke="none"
        opacity={0.92}
      />
    </g>
  );
});

/** How many segments a bent mirror is drawn with. Twelve is smooth at any depth. */
const BEND_STEPS = 12;

const GuideLayer = memo(function GuideLayer({
  guides,
  show,
  bend,
}: {
  guides: Guides;
  show: boolean;
  bend: ((p: readonly [number, number]) => readonly [number, number]) | null;
}) {
  if (!show) return null;
  // A rotation drawn beside mirrors is the second thing being said. Alone it is
  // the ONLY thing being said, and has to carry the overlay by itself.
  const quiet = guides.mirrors.length > 0;

  return (
    <g pointerEvents="none">
      {guides.mirrors.map((m) => {
        const colour =
          FAMILY_COLOUR[m.id] ?? (m.family === "spine" ? "#67e8f9" : "#f59e0b");
        const dashed = m.family === "boundary";
        // Under the relief a mirror is still the SAME set of cells, so it has to
        // ride the deformation with them. Drawn as a polyline through the bent
        // points rather than as a chord, which would cut across the bulge and
        // put the axis somewhere the brush does not mirror about.
        const pts =
          bend === null
            ? `${m.x1},${m.y1} ${m.x2},${m.y2}`
            : Array.from({ length: BEND_STEPS + 1 }, (_, k) => {
                const t = k / BEND_STEPS;
                return line(
                  bend([m.x1 + (m.x2 - m.x1) * t, m.y1 + (m.y2 - m.y1) * t])
                );
              }).join(" ");
        return (
          <g key={`${m.id}-${m.sector ?? ""}`}>
            <polyline
              points={pts}
              fill="none"
              stroke={colour}
              strokeWidth={7}
              opacity={0.13}
              strokeLinecap="round"
            />
            <polyline
              points={pts}
              fill="none"
              stroke={colour}
              strokeWidth={2.1}
              // The dashed boundaries cross the whole figure corner to corner
              // and read louder than the shorter spines at equal opacity.
              opacity={dashed ? 0.58 : 0.8}
              strokeDasharray={dashed ? "9 7" : undefined}
              strokeLinecap="round"
            />
          </g>
        );
      })}

      {guides.rotation && (
        <RotationMark rot={guides.rotation} quiet={quiet} />
      )}
      {guides.local.map((r, k) => (
        <RotationMark key={k} rot={r} quiet />
      ))}
    </g>
  );
});

/**
 * The ghost: the cells that WOULD be touched, in the colours they would take.
 *
 * Fill at a third under a full-strength edge, over an ink halo. The halo is not
 * decoration — the ghost has to be legible both on bare plate and on paint of
 * any hue the user chose, and a single stroke cannot do both: over a similar
 * colour it vanishes.
 *
 * `standing` is the propose-mode candidate rather than a hover. It reads
 * DIFFERENTLY on purpose, and by two channels at once, because "this is not
 * committed yet" has to survive both a colour-blind viewer and a monochrome
 * screenshot: the fill drops to a quarter and the outline becomes a marching
 * dash. Colour alone would have said it to nobody.
 */
const Ghost = memo(function Ghost({
  geom,
  pts,
  centroids,
  spec,
  standing,
  dashClass,
}: {
  geom: BoardGeometry;
  pts: readonly string[];
  centroids: readonly (readonly [number, number])[];
  spec: PreviewSpec;
  standing: boolean;
  dashClass: string;
}) {
  const seed = centroids[spec.seed];
  return (
    <g pointerEvents="none">
      {spec.cells.map((i, k) => {
        const p = pts[i];
        if (p === undefined) return null;
        const colour = spec.erasing ? "#ece6dc" : spec.colours[k] ?? "#ece6dc";
        return (
          <g key={i}>
            <polygon
              points={p}
              fill="none"
              stroke="rgba(10,9,8,.85)"
              strokeWidth={5}
              strokeLinejoin="round"
            />
            <polygon
              className={standing ? dashClass : undefined}
              points={p}
              fill={spec.erasing ? "none" : colour}
              fillOpacity={standing ? 0.26 : 0.55}
              stroke={colour}
              strokeWidth={standing ? 2.2 : 2.6}
              strokeDasharray={
                standing ? "7 5" : spec.erasing ? "5 4" : undefined
              }
              strokeLinejoin="round"
            />
          </g>
        );
      })}

      {/* Reached, and nothing to do here. */}
      {spec.inert.map((i) => {
        const p = pts[i];
        if (p === undefined) return null;
        return (
          <polygon
            key={`inert-${i}`}
            points={p}
            fill="none"
            stroke="rgba(236,230,220,.42)"
            strokeWidth={1.2}
            strokeDasharray="2 5"
            strokeLinejoin="round"
          />
        );
      })}

      {seed && (
        <circle
          cx={seed[0]}
          cy={seed[1]}
          r={Math.max(3, geom.seamWidth * 5)}
          fill="none"
          stroke="#ece6dc"
          strokeWidth={standing ? 2.6 : 2}
          opacity={0.9}
        />
      )}
    </g>
  );
});

export default function DrawBoard({
  geom,
  relief,
  paint,
  preview,
  candidate,
  cursor,
  guides,
  showGuides,
  showTiling,
  weld,
  dragBehaviour,
  shape,
  panning,
  view,
  focused,
  label,
  className,
  candidateClass,
  dimClass,
  onHover,
  onPaint,
  onStrokeEnd,
  onPropose,
  onCommit,
  onCommitCancelled,
  onArrow,
  onShapeDrag,
  onShapeEnd,
  onPan,
  onFocusTap,
}: Props) {
  /**
   * The plate's polygons, from whichever source is in force.
   *
   * One array, shared by every layer, so a point string is built once and not
   * once per layer. With the relief off it is memoised on the figure and is
   * therefore built once ever; with it on it arrives whole from the page and
   * changes only when the template ring does.
   */
  const flat = useMemo(() => geom.cells.map(points), [geom]);
  const pts = relief === null ? flat : relief.points;
  const flatCentroids = useMemo(() => geom.cells.map((c) => c.centroid), [geom]);
  const centroids = relief === null ? flatCentroids : relief.centroids;

  /**
   * The framed cells, as a list to walk and a set to test.
   *
   * Both are memoised on the geometry, so the layers below stay memoised: a set
   * rebuilt every render would defeat the whole layer split. `null` for the
   * unframed case, which is cheaper than a set holding every index and is also
   * the honest statement — there is no frame, not a frame that admits everything.
   */
  const order = useMemo(
    () => geom.shown ?? geom.cells.map((_, i) => i),
    [geom]
  );
  const visible = useMemo(
    () => (geom.shown === undefined ? null : new Set(geom.shown)),
    [geom]
  );

  const drawing = useRef(false);
  const proposing = useRef(false);
  /** A press that landed inside the standing candidate: a tap here commits. */
  const armed = useRef(false);
  const moved = useRef(false);
  const last = useRef<number | null>(null);
  /** The cell an anchored gesture started at, or `null` when none is running. */
  const anchor = useRef<number | null>(null);
  /** The last client point of a pan drag, or `null` when none is running. */
  const panFrom = useRef<{ x: number; y: number } | null>(null);
  const svg = useRef<SVGSVGElement | null>(null);

  /**
   * The double-tap bookkeeping. Four refs, and each answers a different question.
   *
   * `lastTap`  the previous CLEAN tap — which cell, and when it was released.
   *            Only a zero-drag press becomes one, so a drag never half-arms the
   *            next press.
   * `tapCell`  the cell the live press landed on, kept because the release
   *            arrives on the WINDOW and its target may be anywhere at all —
   *            off the plate, off the window, or the browser cancelling.
   * `tapFrom`  where the live press landed in client pixels, for the slop test.
   * `tapDrag`  whether the live press has already travelled past `TAP_SLOP`.
   *
   * Refs and not state for the reason every other gesture ref here is one: they
   * change several times between two renders and nothing reads them from the
   * render.
   */
  const lastTap = useRef<Tap | null>(null);
  const tapCell = useRef<number | null>(null);
  const tapFrom = useRef<{ x: number; y: number } | null>(null);
  const tapDrag = useRef(false);
  /**
   * The cell an ARMED double-tap is on, or `null`.
   *
   * Non-null means this press laid nothing and is waiting for its release to say
   * whether the hand held still. See the header.
   *
   * IT BELONGS TO ONE PRESS. `down` clears it on its first line and `end` clears
   * it on every release, so it cannot outlive the gesture that set it — which
   * matters because the release is the one event that is not guaranteed to
   * arrive, and a flag left standing would steal the NEXT press's release.
   */
  const focusArmed = useRef<number | null>(null);

  const indexOf = (target: EventTarget | null): number | null => {
    const raw = (target as SVGElement | null)?.dataset?.i;
    if (raw === undefined) return null;
    const i = Number(raw);
    return Number.isInteger(i) ? i : null;
  };

  const end = useCallback(
    (e?: PointerEvent) => {
      // `performance.now()` only for the call that has no event — there is none
      // today, and the fallback is here so a future caller cannot make the clock
      // jump to zero and read as an instant double-tap.
      const t = e?.timeStamp ?? performance.now();
      // A CANCEL is the browser taking the pointer away, not the hand letting
      // go, so it can never complete a tap. Treated as a drag rather than as a
      // clean release, which is the conservative reading and the one that cannot
      // fire a focus change nobody asked for.
      const cancelled = e?.type === "pointercancel";

      // An ARMED second press. It laid nothing on the way down, so this release
      // is the whole of the gesture: fire it if the hand held still, drop it
      // silently if it drifted. Either way the pair is spent — a third quick tap
      // starts a new one rather than firing again on the same cell.
      //
      // READ AND CLEARED HERE, but FIRED at the bottom. This branch used to
      // return before every other one, which was only safe while nothing could
      // arm a focus tap with a gesture already live — and nothing enforced that,
      // because `down` never cleared this ref. A press whose release never
      // reached the window (the window blurred, the OS took the pointer) left the
      // flag set, and the NEXT press painted normally on the way down and then
      // had its release stolen: the focus fired on a cell from the gesture
      // before, and `onStrokeEnd` never ran at all, so edits already written into
      // the page's composition were never journalled and undo could not reach
      // them. `down` now clears the flag on every press, which closes that door;
      // this closes the other side of it, so that an armed press with a live
      // gesture behind it still ENDS the gesture rather than abandoning it.
      const focusCell = focusArmed.current;
      const focusHeld = focusCell !== null && !tapDrag.current && !cancelled;
      focusArmed.current = null;

      // Every release: remember it as a tap if it never became a drag, and
      // forget whatever was remembered if it did. An ARMED release is never
      // remembered — the pair is spent. Done BEFORE the branches below, because
      // every one of them used to return and the bookkeeping is common to all.
      const cell = tapCell.current;
      lastTap.current =
        focusCell === null && cell !== null && !tapDrag.current && !cancelled
          ? { cell, t }
          : null;
      tapCell.current = null;
      tapFrom.current = null;
      tapDrag.current = false;

      if (panFrom.current !== null) {
        panFrom.current = null;
      } else if (anchor.current !== null) {
        anchor.current = null;
        onShapeEnd();
      } else if (proposing.current) {
        const release = proposeRelease(armed.current, moved.current, cancelled);
        proposing.current = false;
        armed.current = false;
        moved.current = false;
        last.current = null;
        if (release === "commit") onCommit();
        else if (release === "cancelled") onCommitCancelled();
      } else if (drawing.current) {
        drawing.current = false;
        last.current = null;
        onStrokeEnd();
      }

      if (focusHeld) onFocusTap(focusCell);
    },
    [onStrokeEnd, onCommit, onCommitCancelled, onShapeEnd, onFocusTap]
  );

  // A gesture can finish anywhere — off the plate, off the window, or by the
  // browser cancelling the pointer. Every one of those has to close the stroke,
  // or the next click silently joins the previous undo step.
  useEffect(() => {
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [end]);

  /**
   * Client pixels to canvas units.
   *
   * FLOAT, and legitimately: this converts a mouse delta into a scroll offset.
   * It never chooses a cell — the hit layer does that, by `data-i`, and it does
   * it under whatever `viewBox` is in force without knowing there is one.
   */
  const toUnits = (dx: number, dy: number): [number, number] => {
    const el = svg.current;
    if (el === null) return [0, 0];
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return [0, 0];
    const w = view === null ? geom.width : view.w;
    const h = view === null ? geom.height : view.h;
    return [(dx * w) / rect.width, (dy * h) / rect.height];
  };

  const down = (e: React.PointerEvent<SVGSVGElement>) => {
    // A STALE ARM CANNOT SURVIVE INTO THE NEXT PRESS. `focusArmed` is set by the
    // double-tap branch below and consumed by that press's release — but the
    // release is the one event that is not guaranteed to arrive, so a flag set
    // and abandoned would steal the release of whatever press came next: a focus
    // change on a cell from the gesture before, and, worse, an `onStrokeEnd` that
    // never fires, leaving edits already written into the page's composition with
    // no rung to undo them by.
    //
    // FIRST LINE OF THE FUNCTION, above the pan branch and above the "not a cell"
    // return, because both of those are presses too and neither of them wants an
    // arm from an older one. This ref is about THIS press and nothing else.
    focusArmed.current = null;

    // Space wins over everything. A pan that only worked when the press landed
    // on a cell would fail exactly at the rim, where a pan is most wanted.
    if (panning) {
      panFrom.current = { x: e.clientX, y: e.clientY };
      // A pan is never a tap, and the tap before it is not half of anything.
      lastTap.current = null;
      tapCell.current = null;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      return;
    }

    const i = indexOf(e.target);
    if (i === null) return;
    const el = e.target as Element;
    if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);

    tapCell.current = i;
    tapFrom.current = { x: e.clientX, y: e.clientY };
    tapDrag.current = false;

    // Asked ONCE, before the double-tap test and again as the arm below, because
    // the two gestures land on the same cell and whichever is tested first wins.
    // See `commitsProposal` for why the commit is the one that must.
    const committing = commitsProposal(shape, dragBehaviour, candidate, i);

    // THE SECOND OF A PAIR — two decisions, and they are not the same decision.
    //
    // WHETHER THE BROWSER GETS THIS CLICK is a question about the mouse, and the
    // answer is no for every second press on one cell however this program then
    // reads it. `DOUBLE_TAP_MS` is 400 and sits inside every UA's double-click
    // window, `touch-action: none` on the canvas covers only touch, and there is
    // no `user-select: none` anywhere — so an unguarded second click starts a
    // text selection that drags across the whole page. That is true of the
    // commit tap as well, which is the ordinary mouse gesture in propose mode:
    // gather at X, click X again. The veto below moved the `preventDefault` with
    // it for one commit and put the selection drag back on exactly that click.
    //
    // WHETHER IT ARMS A DRILL-IN is the question the veto answers. Decided here
    // so this press lays nothing — see the header — but not FIRED here: the
    // release decides, once the slop test has something to say.
    const pair = isDoubleTap(lastTap.current, i, e.timeStamp);
    if (pair) e.preventDefault();
    if (pair && !committing) {
      focusArmed.current = i;
      lastTap.current = null;
      return;
    }

    if (shape !== "free") {
      anchor.current = i;
      onShapeDrag(i, i, e.altKey);
      return;
    }

    if (dragBehaviour === "propose") {
      proposing.current = true;
      moved.current = false;
      last.current = i;
      // Inside the standing proposal this press is a commit, and must NOT also
      // add to it: the plate would gain an application under the finger and then
      // be painted somewhere the user did not aim. The same answer the double-tap
      // veto above was taken from, so the two cannot come to disagree about what
      // a tap on the ghost is.
      armed.current = committing;
      if (!committing) onPropose(i);
      return;
    }

    drawing.current = true;
    last.current = i;
    onHover(i);
    onPaint(i);
  };

  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    if (panFrom.current !== null) {
      const [dx, dy] = toUnits(
        e.clientX - panFrom.current.x,
        e.clientY - panFrom.current.y
      );
      panFrom.current = { x: e.clientX, y: e.clientY };
      onPan(dx, dy);
      return;
    }

    // The slop test, run on EVERY move while a press is live — including the
    // armed one, which is the whole point: a press that travels is a drag and
    // must not fire a focus change on release. Client pixels, because this asks
    // whether the hand held still and the hand does not know what zoom it is at.
    if (tapFrom.current !== null && !tapDrag.current) {
      const dx = e.clientX - tapFrom.current.x;
      const dy = e.clientY - tapFrom.current.y;
      if (dx * dx + dy * dy > TAP_SLOP * TAP_SLOP) tapDrag.current = true;
    }
    // An armed double-tap owns the pointer until it is released. No hover, no
    // paint, no proposal — it laid nothing on the way down and must lay nothing
    // on the way across either.
    if (focusArmed.current !== null) return;

    const i = indexOf(e.target);

    if (anchor.current !== null) {
      // `alt` is read HERE and not at the press: releasing Option mid-drag has
      // to turn a symmetric figure back into a one-sided one under the finger,
      // or the modifier is a mode with no indicator.
      if (i !== null) onShapeDrag(anchor.current, i, e.altKey);
      return;
    }

    if (shape !== "free" && !panning) {
      onHover(i);
      return;
    }

    if (dragBehaviour === "propose") {
      if (!proposing.current) {
        onHover(i);
        return;
      }
      if (i === null || i === last.current) return;
      last.current = i;
      moved.current = true;
      // Dragged off the tap it started as, so it is a drag: re-propose.
      armed.current = false;
      onPropose(i);
      return;
    }

    if (!drawing.current) {
      onHover(i);
      return;
    }
    if (i === null || i === last.current) return;
    last.current = i;
    onHover(i);
    onPaint(i);
  };

  const key = (e: React.KeyboardEvent<SVGSVGElement>) => {
    const dir: Record<string, Direction> = {
      ArrowUp: "up",
      ArrowDown: "down",
      ArrowLeft: "left",
      ArrowRight: "right",
    };
    const d = dir[e.key];
    if (d !== undefined) {
      e.preventDefault();
      onArrow(d);
      return;
    }
    // The ARROWS only. Enter and Space have both moved to the page's window
    // listener, and for the same reason: they have to work while the hand is on
    // a rail control, or the anchored tools have no keyboard path at all —
    // measured, by pressing Enter with the body focused and watching nothing
    // happen. The arrows stay because they are a walk by SCREEN direction and
    // the plate is the thing that has a screen; binding ↑ and ↓ globally would
    // also take the page's own scrolling away.
  };

  const cursorPoints = cursor === null ? undefined : pts[cursor];

  return (
    <svg
      ref={svg}
      viewBox={
        view === null
          ? `0 0 ${geom.width} ${geom.height}`
          : `${view.x} ${view.y} ${view.w} ${view.h}`
      }
      className={className}
      data-gesture={panning ? "pan" : shape === "free" ? undefined : shape}
      role="application"
      aria-label={label}
      tabIndex={0}
      onPointerDown={down}
      onPointerMove={move}
      onPointerLeave={() => onHover(null)}
      onKeyDown={key}
    >
      <defs>
        <radialGradient id="draw-vignette" cx="50%" cy="42%" r="72%">
          <stop offset="0%" stopColor={PLATE_LIT} />
          <stop offset="100%" stopColor={PLATE} />
        </radialGradient>
      </defs>

      <rect width={geom.width} height={geom.height} fill="url(#draw-vignette)" />

      <TileLayer geom={geom} pts={pts} order={order} show={showTiling} />
      <PaintLayer
        geom={geom}
        pts={pts}
        paint={paint}
        visible={visible}
        weld={weld}
      />
      {relief && (
        <WashLayer pts={pts} wash={relief.wash} visible={visible} />
      )}

      {/* The outline never moves under the relief: the rim is one level set of
          the ring index, so its scale factor is pinned at 1 and the plate
          curves inside a boundary that stays exactly where it was. */}
      <polygon
        points={geom.outline.map((v) => `${v[0]},${v[1]}`).join(" ")}
        fill="none"
        stroke="rgba(236,230,220,.22)"
        strokeWidth={1.4}
        pointerEvents="none"
      />

      <GuideLayer
        guides={guides}
        show={showGuides}
        bend={relief === null ? null : relief.bend}
      />

      {focused !== null && (
        <DimLayer
          pts={pts}
          order={order}
          focused={focused}
          className={dimClass}
        />
      )}

      {preview && (
        <Ghost
          geom={geom}
          pts={pts}
          centroids={centroids}
          spec={preview}
          standing={false}
          dashClass={candidateClass}
        />
      )}
      {/* ONE GHOST PER APPLICATION, keyed by its seed — which is unique inside a
          proposal, because `propose.proposeSeed` refuses a repeat. Drawn as a
          run of `standing` ghosts rather than as one merged outline, for the
          reason `lib/propose.ts` gives: an application's colours are indexed
          over ITS OWN span, so merging them would show hues the commit is not
          going to lay.

          WHAT THIS COSTS, stated rather than optimised away. `Ghost` is
          memoised, but the page rebuilds the whole spec list each time the drag
          gathers one more application, so every standing ghost re-renders on
          every new seed — O(seeds × orbit) polygons per pointer move. That is
          inside a budget this component already spends: a PAINT drag re-renders
          `PaintLayer` over the entire plate on every application, which at depth
          4 is 1536 polygons, and a proposal a finger could plausibly gather is
          well under that. If it is ever measured to matter, the fix is an
          identity cache in the page keyed by seed, so an unchanged spec keeps
          its object and this `memo` bails out. It has not been measured, so it
          has not been written. */}
      {candidate.map((spec) => (
        <Ghost
          key={spec.seed}
          geom={geom}
          pts={pts}
          centroids={centroids}
          spec={spec}
          standing
          dashClass={candidateClass}
        />
      ))}

      {cursorPoints !== undefined && (
        <polygon
          points={cursorPoints}
          fill="none"
          stroke="#a3e635"
          strokeWidth={3}
          strokeLinejoin="round"
          pointerEvents="none"
        />
      )}

      <HitLayer pts={pts} order={order} />
    </svg>
  );
}
