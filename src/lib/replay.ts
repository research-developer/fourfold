/**
 * The drawing's own past: reconstructed as a PREVIEW, and written out as an
 * animation.
 *
 * Two controls sit on this file and they are the same instrument twice. REPLAY
 * plays the history forward on a timer; HISTORY scrubs it by hand. Both are
 * asking one question — what did the plate look like after gesture n? — so both
 * are answered by `stateAt`, and neither of them writes anything.
 *
 * ── Nothing here mutates ─────────────────────────────────────────────────
 *
 * `stateAt` returns a NEW map, exactly as `applyEdits` does, and the caller
 * shows it instead of the live plate. There is no "restore" step to forget: the
 * live plate is still the object it always was, and closing the preview is
 * dropping a reference. That is the whole of the non-destructiveness claim, and
 * it is a property of the shape rather than of a promise made in a handler.
 *
 * ── Why the walk is incremental and not a rebuild ───────────────────────
 *
 * `stateAt(state, past, from, to)` takes the state at `from` to the state at
 * `to` by applying or unapplying exactly the strokes BETWEEN them. Rebuilding
 * from the base every step would be O(all edits) per step and would make a
 * replay quadratic in the length of the history; stepping is O(one stroke),
 * which is a few dozen edits. A scrub across the whole slider costs one pass of
 * the edits it crosses, once.
 *
 * ZERO FLOAT in the reconstruction: it is map writes keyed by address. Floats
 * appear in `animatedSvg`, and only to shorten coordinates and to turn
 * millisecond timings into keyframe percentages — the same place and for the
 * same reason `artworkSvg` has them.
 *
 * ── The markup requirement ───────────────────────────────────────────────
 *
 * The animation is asked to carry the symmetry in the FILE and not only in the
 * picture: a 6-fold stroke is one `<g>` with one animation, not six polygons
 * each repeating the same delay. So the orbit becomes a DOM group, `data-orbit`
 * states its size, `data-mode` states the brush that made it, and the CSS is
 * one rule per STROKE. `grouping: "cell"` writes the identical animation the
 * other way round, one rule per cell, so the saving can be measured rather than
 * asserted — see `test/replay.test.ts`, which measures it.
 *
 * ── Why one `@keyframes` per stroke: MEASURED, not forced ───────────────
 *
 * This section used to claim the per-stroke form was the only thing that works.
 * THAT WAS FALSE, and a comment claiming impossibility when the thing is
 * possible is worse than no comment, so here is what is actually true.
 *
 * AN O(1) FORM EXISTS AND WORKS. One `@property --t` registered as a number,
 * one `@keyframes` driving it 0 → 1 across the cycle, one animation on the
 * root, and each stroke carrying its own reveal point as `style="--k:0.37"`,
 * with visibility from a comparison of `--t` against `--k`. It was BUILT and
 * verified byte-for-byte against the per-stroke control in Chromium, Firefox
 * and WebKit, across three cycles including both loop boundaries. It is not a
 * sketch and it is not broken.
 *
 * IT WAS REJECTED ON MEASUREMENT. Registered custom properties animate on the
 * main thread and every tick invalidates style for every element that reads
 * them, so the work moves from "one keyframe list per stroke, resolved once"
 * to "every cell restyled every frame":
 *
 *                            per-stroke keyframes      @property clock
 *   200 gestures / 1600 cells   60.3 fps, 115 ms/3 s    59.7 fps,  530 ms/3 s
 *   500 gestures / 6000 cells   60.2 fps, 227 ms/3 s    56.7 fps, 1070 ms/3 s
 *
 * That is 4.6× the style recalculation for a 9.4% saving in bytes, and it drops
 * frames at depth-5 scale, which is exactly the size this program is built for.
 * It also needs `@property` — Safari 16.4+, Firefox 128+ — where the current
 * form works everywhere, and `syntax:"<number>"` written literally makes the
 * SVG an XML parse error, so it has to be escaped or the file will not open at
 * all. Cheaper bytes are not worth dropped frames and a narrower reader set.
 *
 * TWO THINGS REALLY ARE REFUTED, and they are the ones worth writing down
 * because they are what a reader would reach for first:
 *
 *   SHARED KEYFRAMES PLUS `animation-delay` FAILS FROM CYCLE ONE. A per-stroke
 *   delay applies only to the FIRST iteration, so with
 *   `animation-iteration-count: infinite` the second cycle plays every group at
 *   once. A delay shifts a window; it cannot resize one, and the window a
 *   stroke is visible for — its own reveal to the end of the cycle — has a
 *   different LENGTH for every stroke.
 *
 *   NESTED WRAPPERS FAIL GENERALLY, not just awkwardly. Nesting multiplies
 *   opacities, so the set visible at time t must be a PRODUCT set; but the set
 *   that must be visible is `{k : t_k ≤ t}`, a THRESHOLD set, and threshold
 *   sets are not products. The two-bit counterexample is `{00, 01, 10}`: it is
 *   a threshold set, and no product of per-bit factors yields it, because any
 *   product containing 01 and 10 contains 11.
 *
 * So the per-stroke form is kept for its cost and its reach, not because it is
 * the only thing that compiles. It is O(strokes) and not O(cells), which is the
 * whole of the requirement; `grouping: "cell"` writes the per-cell form for
 * real so the saving is measured rather than asserted.
 *
 * ── The in point and the out point ──────────────────────────────────────
 *
 * A replay may be CUT: an in point, before which the drawing is already there,
 * and an out point, after which it is not shown at all. Both are indices into
 * `AnimationStep[]` — the animation's own beats — and the pair is CLOSED, so
 * `{in: 3, out: 7}` is five steps and both ends play. `boundAnimation` is the
 * one place that reads them and `InOut` is the one spelling; everything else in
 * this module and in `gif.ts` sees a step list that has already been cut.
 *
 * WHY STEPS AND NOT GESTURES. `animationSteps` DROPS a gesture that changed
 * nothing in the current frame — in a sector view a stroke may land entirely
 * outside the picture — so the k-th step is not in general the k-th gesture.
 * Marks on gestures would therefore name beats the replay does not have, and
 * would name different ones as soon as the view changed. Marks on steps are
 * marks on what the viewer is actually watching, and they are the same index
 * `emit.EmitLayer.reveal` carries and the same index `k · stepMs` is computed
 * from, so there is one index space for the whole feature rather than two that
 * have to be kept in step.
 *
 * WHY CLOSED AND NOT HALF-OPEN. Half-open would match `slice` and would make
 * the count a subtraction, which is the argument for it. It also makes `in ==
 * out` mean an EMPTY replay, and an empty replay is a thing every consumer then
 * has to answer for — a GIF with no image descriptor is not a file. Closed
 * cannot express the empty span at all: `0 ≤ in ≤ out < steps` always names at
 * least one beat. The degenerate case is removed by the representation rather
 * than handled in six places, and `out` means what a person setting an out
 * point means by it — the last thing you see.
 *
 * WHY THE IN POINT NEEDS NO NEW MECHANISM. `AnimationSpec.ground` is already
 * "the plate before the first recorded gesture, visible from the first frame",
 * so cutting the front is composing the dropped steps INTO it. The steps are
 * additive by construction — see `animationSteps` — so replaying the prefix in
 * order onto the ground map is exactly what the document would have drawn by
 * the time the in point came round.
 */

import { encodeArt, type ArtPayload } from "./artfile";
import {
  addressDepth,
  ancestorAt,
  type Address,
  type AddressBook,
} from "./plate";
import {
  applyEdits,
  cellPoints,
  fmtCoord,
  mergeEdits,
  WELD_WIDTH,
  type ArtCell,
  type ArtOverlayGroup,
  type CellEdit,
  type EditKey,
  type History,
  type PaintMap,
  type Stroke,
  type StrokeMark,
} from "./strokes";

// ── reconstructing a state ───────────────────────────────────────────────

/** `n` brought inside `0 … past.length`. State 0 is before the first gesture. */
export function clampIndex(n: number, length: number): number {
  if (!Number.isFinite(n)) return length;
  const k = Math.round(n);
  return k < 0 ? 0 : k > length ? length : k;
}

/**
 * The state after `to` gestures, given the state after `from` of them.
 *
 * Both indices are counts of COMMITTED gestures, so `0` is the state the
 * history began from and `past.length` is the live plate. Walking either way is
 * exact rather than approximate — every edit carries the colour that was there
 * — so scrubbing back and forth over the same range returns the same map every
 * time, and a round trip is the identity.
 */
export function stateAt<K extends EditKey>(
  state: ReadonlyMap<K, string>,
  past: readonly Stroke<K>[],
  from: number,
  to: number
): Map<K, string> {
  let at = clampIndex(from, past.length);
  const want = clampIndex(to, past.length);
  let out = new Map(state);
  while (at > want) {
    out = applyEdits(out, past[at - 1].edits, "undo");
    at -= 1;
  }
  while (at < want) {
    out = applyEdits(out, past[at].edits, "do");
    at += 1;
  }
  return out;
}

/** The state the history began from — every recorded gesture taken back. */
export function historyBase<K extends EditKey>(
  state: ReadonlyMap<K, string>,
  past: readonly Stroke<K>[]
): Map<K, string> {
  return stateAt(state, past, past.length, 0);
}

/**
 * Every state the history can show, oldest first. `length` is `past.length + 1`.
 *
 * Built by one forward walk from the base, so the whole sequence costs one pass
 * of the edits rather than one pass per state. The animated export wants all of
 * them at once; the preview wants one at a time and uses `stateAt`.
 */
export function everyState<K extends EditKey>(
  state: ReadonlyMap<K, string>,
  past: readonly Stroke<K>[]
): Map<K, string>[] {
  const out: Map<K, string>[] = [historyBase(state, past)];
  for (let k = 0; k < past.length; k++) {
    out.push(applyEdits(out[k], past[k].edits, "do"));
  }
  return out;
}

// ── reverting ────────────────────────────────────────────────────────────

/**
 * What reverting to a state would cost, and the gesture that would do it.
 *
 * REVERT is ONE MORE ENTRY rather than a truncation, and that is the whole
 * design: the edits below take the live plate to the earlier state in a single
 * undoable gesture, so `NEW` remains the only control on the page that destroys
 * anything. Undo after a revert puts every rolled-back gesture back at once,
 * and undo again walks on down the stack as it always did.
 *
 * `rolledBack` is how many committed gestures the drawing gives up in one step.
 * `discardedRedo` is the only thing that is genuinely LOST — pushing a gesture
 * clears the redo branch, exactly as drawing after an undo has always done —
 * and it is reported separately because it is the one number a guard should
 * fire on.
 */
export interface Revert<K extends EditKey = number> {
  stroke: Stroke<K>;
  /** Committed gestures the drawing is rolled back over. */
  rolledBack: number;
  /** Redo entries this would discard. Zero unless something was undone first. */
  discardedRedo: number;
  /** Cells whose colour changes. */
  changed: number;
}

/**
 * The gesture that takes the live state back to state `index`, or `null` when
 * the drawing already stands there.
 *
 * A symmetric difference rather than a re-run of the strokes between: the
 * strokes between may have painted a cell and painted it back, and re-running
 * their inverses would record edits for cells that never really moved. The
 * difference records exactly the cells whose colour differs, which is what
 * `mergeEdits` then orders and de-duplicates.
 */
export function revertTo<K extends EditKey>(
  state: ReadonlyMap<K, string>,
  history: History<K>,
  index: number
): Revert<K> | null {
  const want = clampIndex(index, history.past.length);
  const target = stateAt(state, history.past, history.past.length, want);
  const raw: CellEdit<K>[] = [];
  for (const [cell, was] of state) {
    const now = target.get(cell) ?? null;
    if (now !== was) raw.push({ cell, from: was, to: now });
  }
  for (const [cell, now] of target) {
    if (state.has(cell)) continue;
    raw.push({ cell, from: null, to: now });
  }
  const edits = mergeEdits([], raw);
  if (edits.length === 0) return null;
  return {
    stroke: { edits },
    rolledBack: history.past.length - want,
    discardedRedo: history.future.length,
    changed: edits.length,
  };
}

// ── which cells a step moved ─────────────────────────────────────────────

/** The shown cells whose colour differs between two resolved states, ascending. */
export function changedCells(
  before: PaintMap,
  after: PaintMap,
  shown?: readonly number[]
): number[] {
  const out: number[] = [];
  if (shown === undefined) {
    const seen = new Set<number>();
    for (const i of before.keys()) seen.add(i);
    for (const i of after.keys()) seen.add(i);
    for (const i of [...seen].sort((a, b) => a - b)) {
      if (before.get(i) !== after.get(i)) out.push(i);
    }
    return out;
  }
  for (const i of shown) {
    if (before.get(i) !== after.get(i)) out.push(i);
  }
  return out;
}

// ── recovering the symmetry group of a cell ──────────────────────────────

/**
 * Which recorded group a cell belongs to, or −1.
 *
 * The mark names ADDRESSES, because that is the only key that survives a depth
 * change; the picture names cell INDICES at whatever depth is on screen. The
 * bridge is the one the plate already uses: a cell takes the paint of its
 * nearest painted ancestor, so it takes the GROUP of its nearest recorded
 * ancestor too. Exact string prefixing, no arithmetic, and it degrades the
 * right way — a mark recorded deeper than the current depth simply matches
 * nothing and the cells fall into the stroke's residual group.
 */
export function markLookup(
  mark: StrokeMark<Address> | undefined,
  book: Pick<AddressBook, "addr" | "stem">
): (cell: number) => number {
  if (mark === undefined) return () => -1;
  const at = new Map<Address, number>();
  mark.groups.forEach((g, k) => {
    for (const a of g) if (!at.has(a)) at.set(a, k);
  });
  return (cell) => {
    const a = book.addr[cell];
    if (a === undefined) return -1;
    const exact = at.get(a);
    if (exact !== undefined) return exact;
    for (let k = addressDepth(a, book.stem) - 1; k >= 1; k--) {
      const hit = at.get(ancestorAt(a, book.stem, k));
      if (hit !== undefined) return hit;
    }
    return -1;
  };
}

// ── the animation, as data ───────────────────────────────────────────────

/** One symmetry group revealed at a step: an orbit, an image band, or a rest. */
export interface AnimationGroup {
  /** True when this group is a recorded orbit or image band, not a remainder. */
  orbit: boolean;
  cells: readonly number[];
  /** Fill per cell, aligned to `cells`. Never null — an erase is the tile fill. */
  fills: readonly string[];
}

/** One committed gesture, as the animation reveals it. */
export interface AnimationStep {
  /** The brush symmetry, when the gesture recorded one. */
  mode: number | null;
  groups: readonly AnimationGroup[];
}

/**
 * The steps an animation plays, one per committed gesture.
 *
 * Every step is ADDITIVE in the document: its cells are drawn over whatever was
 * there, so a repaint covers the old colour and an ERASE is drawn in the
 * unpainted fill rather than removed. That is what lets the whole animation be
 * one opacity reveal per group with no element ever having to be taken away —
 * and it is exact, because the last group to name a cell is the last gesture
 * that touched it, so the final frame is the final state.
 *
 * A step that changed nothing visible in this FRAME is dropped: in a sector view
 * a gesture may have landed entirely in a sector that is not drawn, and a step
 * that reveals nothing would be a pause the drawing never had.
 */
export function animationSteps(
  states: readonly PaintMap[],
  past: readonly Stroke<Address>[],
  book: Pick<AddressBook, "addr" | "stem">,
  unpaintedFill: string,
  shown?: readonly number[]
): AnimationStep[] {
  const out: AnimationStep[] = [];
  for (let k = 0; k < past.length && k + 1 < states.length; k++) {
    const cells = changedCells(states[k], states[k + 1], shown);
    if (cells.length === 0) continue;
    const mark = past[k].mark;
    const groupOf = markLookup(mark, book);
    // Insertion order is the recorded group order, with the remainder last, so
    // the file reads in the order the brush actually applied.
    const bins = new Map<number, { cells: number[]; fills: string[] }>();
    for (const i of cells) {
      const g = groupOf(i);
      let bin = bins.get(g);
      if (bin === undefined) {
        bin = { cells: [], fills: [] };
        bins.set(g, bin);
      }
      bin.cells.push(i);
      bin.fills.push(states[k + 1].get(i) ?? unpaintedFill);
    }
    const groups: AnimationGroup[] = [];
    for (const [g, bin] of [...bins.entries()].sort((a, b) =>
      a[0] < 0 ? 1 : b[0] < 0 ? -1 : a[0] - b[0]
    )) {
      groups.push({ orbit: g >= 0, cells: bin.cells, fills: bin.fills });
    }
    out.push({ mode: mark?.mode ?? null, groups });
  }
  return out;
}

// ── the in point and the out point ───────────────────────────────────────

/**
 * Which part of the drawing a replay plays.
 *
 * CLOSED, and indices into `AnimationStep[]` rather than into the gesture
 * journal. Both ends play: `{in: 3, out: 7}` is FIVE steps, not four. The
 * argument for both of those choices is in the module header, and the one thing
 * worth repeating here is that the count is `out - in + 1` — `spanSteps` exists
 * so nothing has to write that subtraction twice.
 *
 * A valid span satisfies `0 ≤ in ≤ out < steps`, so a replay with no steps has
 * no valid span at all and `clampSpan` says so by returning `null` rather than
 * by inventing an empty one.
 */
export interface InOut {
  /** The first step that plays. Everything before it is already on the plate. */
  readonly in: number;
  /** The last step that plays. Everything after it is not shown at all. */
  readonly out: number;
}

/** How many steps a span names. `null` — nothing to play — is zero of them. */
export const spanSteps = (span: InOut | null): number =>
  span === null ? 0 : span.out - span.in + 1;

/**
 * One mark brought inside `0 … steps-1`, with the same rule `clampIndex` uses
 * for a number that is not one: fall back rather than throw.
 */
const clampMark = (n: number, fallback: number, steps: number): number => {
  if (!Number.isFinite(n)) return fallback;
  const k = Math.round(n);
  return k < 0 ? 0 : k > steps - 1 ? steps - 1 : k;
};

/**
 * A span brought inside a replay of `steps` beats, or `null` when there are
 * none.
 *
 * THE UI-FACING END OF THE FEATURE, and it CLAMPS rather than refuses, which is
 * the opposite of what `artfile` does with the same two numbers. That is
 * deliberate and the split is the codebase's own: a payload is a promise from a
 * writer we do not control, so a malformed one is refused whole; a slider is a
 * live control being dragged, and a drag that runs off the end of the track is
 * an ordinary event rather than a broken statement.
 *
 * The rules, all of them:
 *
 *   ABSENT — the whole replay, `{in: 0, out: steps-1}`. So a drawing with no
 *   marks set behaves exactly as it did before this existed, which is what
 *   makes the field safe to leave off everywhere.
 *
 *   OUT OF RANGE — clamped to the ends. A mark that is not a finite number at
 *   all falls back to its own end of the track, so a lost `in` is 0 and a lost
 *   `out` is the last step; that is `clampIndex`'s rule for the same problem.
 *
 *   INVERTED (`in > out`) — the OUT point is pulled back to the in point, so
 *   the span collapses to the single step at `in`. Moving `in` instead would
 *   have been equally short, and it is the worse answer: `in` is what the
 *   ground is folded to, so moving it changes the PICTURE the replay starts on,
 *   while moving `out` only changes how much of it plays. Between two clamps,
 *   take the one that does not repaint the first frame.
 */
export function clampSpan(
  span: InOut | null | undefined,
  steps: number
): InOut | null {
  const n = Math.floor(steps);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (span === undefined || span === null) return { in: 0, out: n - 1 };
  const from = clampMark(span.in, 0, n);
  const to = clampMark(span.out, n - 1, n);
  return { in: from, out: to < from ? from : to };
}

/** A replay cut to its in and out points: what both encoders are handed. */
export interface BoundedAnimation {
  /** The plate the first frame shows: `ground` with the prefix folded in. */
  ground: PaintMap;
  /** The steps that play — `steps[in … out]`, both ends included. */
  steps: readonly AnimationStep[];
  /** The span actually used, after clamping. `null` when there is nothing. */
  span: InOut | null;
  /** Steps folded into the ground: everything before the in point. */
  folded: number;
  /** Steps not shown at all: everything after the out point. */
  dropped: number;
}

/**
 * The replay, cut.
 *
 * THE ONE PLACE THE MARKS ARE READ, and that is the whole answer to "how do the
 * SVG and the GIF avoid disagreeing". Neither `animatedSvg` nor `gif.gifSteps`
 * knows what an in point is: each is handed a `ground` and a `steps` that have
 * already been cut, and a caller that wants both files computes this ONCE and
 * spreads the same two fields into both specs. Two encoders reading two marks
 * would be two chances to be off by one; two encoders reading one value is
 * none. It is the same discipline the page already applies to `animationSteps`
 * itself, which is walked once and handed to both.
 *
 * ── The prefix folds; it does not need a mechanism ──────────────────────
 *
 * Every step is additive in the document — its cells are drawn OVER whatever
 * was there — so replaying steps `0 … in-1` onto the ground map, in order, with
 * later writes winning, produces exactly the plate the uncut animation shows at
 * `in · stepMs`. `AnimationSpec.ground` already means "there from the first
 * frame", so there is nothing to add: the fold is a `Map` and a loop.
 *
 * The one thing to say out loud is what an ERASE folds to. `animationSteps`
 * records an erase as the UNPAINTED FILL rather than as an absence, because the
 * animation draws it that way — nothing is ever removed from the document. So a
 * cell erased before the in point lands in the folded ground wearing the tile
 * colour, and is drawn in the ground group rather than in the tiling group. The
 * pixels are the same either way, because the uncut animation had covered that
 * cell's tiling polygon with an identically shaped one in the same colour by
 * the time it reached `in`. What the folded ground is NOT is the model's own
 * state at that point, where the cell would be genuinely unpainted. It is the
 * FRAME, and the frame is what an animation's first frame has to be.
 *
 * ── The suffix truncates, and the final-frame invariant survives ────────
 *
 * `animationSteps` promises that "the last group to name a cell is the last
 * gesture that touched it, so the final frame is the final state". Dropping a
 * SUFFIX cannot break that: the property is local to the list, so after the cut
 * the last group to name a cell is the last INCLUDED step that touched it, and
 * the final frame is the state at the out point. That is the retarget the
 * feature asks for, and it holds without a repair pass because nothing before
 * the cut ever depended on what came after it.
 *
 * Nothing here mutates: `ground` is copied even when nothing is folded into it,
 * on the rule this whole module keeps.
 */
export function boundAnimation(
  ground: PaintMap,
  steps: readonly AnimationStep[],
  span?: InOut | null
): BoundedAnimation {
  const at = clampSpan(span, steps.length);
  if (at === null) {
    return { ground: new Map(ground), steps: [], span: null, folded: 0, dropped: 0 };
  }
  const start = new Map(ground);
  for (let k = 0; k < at.in; k++) {
    for (const g of steps[k].groups) {
      // Later writes win, which is what makes a repaint before the in point
      // fold to the colour it ended on rather than to the one it started at.
      g.cells.forEach((i, n) => start.set(i, g.fills[n]));
    }
  }
  return {
    ground: start,
    steps: steps.slice(at.in, at.out + 1),
    span: at,
    folded: at.in,
    dropped: steps.length - 1 - at.out,
  };
}

// ── the animation, as a file ─────────────────────────────────────────────

/** How the per-step markup is written. `cell` exists to be measured against. */
export type AnimationGrouping = "orbit" | "cell";

export interface AnimationSpec {
  width: number;
  height: number;
  cells: readonly ArtCell[];
  /** The cell indices the picture shows, ascending. Absent means all of them. */
  shown?: readonly number[];
  background: string;
  /** Fill for a cell nobody has painted, or `null` to leave the plate showing. */
  unpainted: string | null;
  tileSeam: string | null;
  paintSeam: string | null;
  seamWidth: number;
  weldPaint?: boolean;
  title: string;
  payload?: ArtPayload;
  /**
   * Flat shapes laid OVER the finished drawing — the relief wash, and nothing
   * here knows that. Static: the plate's curvature is a property of the figure
   * rather than of the order it was drawn in, so it is there from the first
   * frame and the strokes come up underneath it.
   */
  overlay?: readonly ArtOverlayGroup[];
  /**
   * The plate before the first step below. Visible from the first frame.
   *
   * "Before the first recorded gesture" when the whole drawing plays, and the
   * plate at the IN POINT when it does not. There is no second field for the
   * cut: `boundAnimation` returns this pair already cut, and a caller passes
   * what it returns. See its header for why the fold needs no mechanism.
   */
  ground: PaintMap;
  /** The steps that play. Already cut to the in and out points, if there are any. */
  steps: readonly AnimationStep[];
  /** Milliseconds between steps. An integer; the percentages are derived. */
  stepMs: number;
  /** Milliseconds the finished plate holds before the loop restarts. */
  holdMs: number;
  /** How long a group takes to come up. Short — it reads as a stroke landing. */
  fadeMs: number;
  grouping: AnimationGrouping;
}

// ── how long a step, a fade and a hold are ───────────────────────────────

/**
 * The longest a group takes to come up, and the longest the finished plate
 * holds before the loop restarts.
 *
 * CEILINGS, not constants, and that is the fix to two real defects. Both used
 * to be absolute numbers written into `page.tsx`, and both broke at the fast
 * end of the step control:
 *
 *   FADE 90 ms EXCEEDED THE FASTEST STEP, which is 80 ms. On an 80 ms export
 *   exactly one group was mid-fade at every instant, so the reveals overlapped
 *   CONTINUOUSLY and the claim that the fade "stops a fast replay looking like a
 *   strobe" was false there — it was a smear, which is the opposite complaint.
 *   At 150 ms the fade was still 60% of the step.
 *
 *   THE HOLD WAS ABSOLUTE. Thirteen gestures at 80 ms draw for 1.04 s and then
 *   held for 1.8 s: 63% of the loop was a still frame. A hundred gestures at
 *   250 ms draw for 25 s and hold for the same 1.8 s: 7%. One number cannot
 *   mean the same thing across a thirty-fold range of drawing lengths.
 *
 * See `animationTiming` for the rule and the numbers it produces.
 */
export const FADE_MS = 90;
export const HOLD_MS = 1800;

/**
 * The shortest hold worth having.
 *
 * A hold exists so the last stroke is not on screen for one step — without it
 * the loop reads as a flicker rather than as a drawing that was finished — so
 * scaling it down with the drawing has to stop somewhere. Below about this a
 * pause stops reading as a pause at all, and a five-gesture replay needs to
 * rest on its finished state as much as a fifty-gesture one does.
 */
export const MIN_HOLD_MS = 400;

export interface AnimationTiming {
  readonly fadeMs: number;
  readonly holdMs: number;
}

/**
 * The fade and the hold for a replay of `steps` gestures at `stepMs` each.
 *
 * FADE = min(FADE_MS, stepMs / 3). A third is the largest share of a step that
 * still reads as a stroke LANDING rather than as a dissolve, and it guarantees
 * the thing the old constant could not: a group finishes coming up strictly
 * before the next one starts, at every step length the control offers. The cap
 * keeps the slow end exactly where it was — at 400 ms and above the fade is the
 * same 90 ms it has always been.
 *
 *   80 ms step → 26 ms fade (was 90, i.e. longer than the step itself)
 *   150        → 50          (was 90 — 60% of the step)
 *   250        → 83
 *   400 and up → 90, unchanged
 *
 * HOLD = min(HOLD_MS, max(MIN_HOLD_MS, drawing / 3)). A third of the drawing's
 * own length keeps the still frame to about a quarter of the loop whatever the
 * drawing is, the floor stops a very short replay flickering, and the cap
 * leaves every long replay exactly as it was.
 *
 *   13 gestures @  80 ms → draw 1.04 s, hold 0.40 s — 28% of the loop, was 63%
 *   50          @ 250    → draw 12.5 s, hold 1.8 s  — unchanged
 *  100          @ 250    → draw 25 s,   hold 1.8 s  — unchanged
 *
 * Integers throughout: the percentages downstream are the only floats.
 *
 * `steps` IS THE BOUNDED COUNT when a replay has an in and an out point — a
 * hundred-gesture drawing cut to five plays a five-step cycle, and a hold
 * scaled to the hundred would be four fifths of a loop spent on a still frame.
 * Spell it `boundAnimation(...).steps.length` and it cannot be the other one.
 */
export function animationTiming(stepMs: number, steps: number): AnimationTiming {
  const fadeMs = Math.max(1, Math.min(FADE_MS, Math.floor(stepMs / 3)));
  const draw = Math.max(0, steps) * Math.max(0, stepMs);
  const holdMs = Math.min(HOLD_MS, Math.max(MIN_HOLD_MS, Math.round(draw / 3)));
  return { fadeMs, holdMs };
}

/** Percentages are the one place a timing becomes a float. Three decimals. */
const pct = (n: number): string => {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? "0" : String(r);
};

const escapeText = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * The replay as a standalone, looping SVG document.
 *
 * Serialised from the MODEL, like `artworkSvg` and for the same reason: reading
 * the board back would drag the ghost, the cursor and the hit layer into the
 * file. It is a SEPARATE output and shares no bytes with the still — the still
 * is unchanged, to the byte, by everything in this module.
 *
 * Self-contained: one `<style>` element, no external anything, no script. It
 * opens from `file://` and loops for as long as it is left open.
 */
export function animatedSvg(spec: AnimationSpec): string {
  const parts: string[] = [];
  const fmt = fmtCoord;
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(
      spec.width
    )} ${fmt(spec.height)}" width="${fmt(spec.width)}" height="${fmt(
      spec.height
    )}" role="img">`
  );
  if (spec.payload !== undefined) parts.push(encodeArt(spec.payload));
  parts.push(`<title>${escapeText(spec.title)}</title>`);

  const cycle = Math.max(1, spec.steps.length * spec.stepMs + spec.holdMs);
  parts.push(styleBlock(spec, cycle));

  parts.push(
    `<rect width="${fmt(spec.width)}" height="${fmt(spec.height)}" fill="${
      spec.background
    }"/>`
  );

  const seamAttr = (colour: string | null) =>
    colour === null ? "" : ` stroke="${colour}" stroke-width="${fmt(spec.seamWidth)}"`;

  const shown =
    spec.shown ?? Array.from({ length: spec.cells.length }, (_, i) => i);

  // The tiling under everything: every framed cell the ground state does not
  // already paint. A cell painted later is drawn here first and covered when its
  // step comes up, which is what makes a stroke look like it lands.
  if (spec.unpainted !== null) {
    parts.push(`<g fill="${spec.unpainted}"${seamAttr(spec.tileSeam)}>`);
    for (const i of shown) {
      if (spec.ground.has(i)) continue;
      parts.push(`<polygon points="${cellPoints(spec.cells[i])}"/>`);
    }
    parts.push(`</g>`);
  }

  const weld = spec.weldPaint === true;
  const paintAttrs = weld ? "" : seamAttr(spec.paintSeam);
  const poly = (i: number, colour: string) =>
    `<polygon points="${cellPoints(spec.cells[i])}" fill="${colour}"${
      weld
        ? ` stroke="${colour}" stroke-width="${fmt(spec.seamWidth * WELD_WIDTH)}"`
        : ""
    }/>`;

  // The state the history began from. No animation: it was already there.
  parts.push(`<g data-layer="ground"${paintAttrs}>`);
  for (const i of shown) {
    const c = spec.ground.get(i);
    if (c !== undefined) parts.push(poly(i, c));
  }
  parts.push(`</g>`);

  parts.push(`<g data-layer="strokes"${paintAttrs}>`);
  let cell = 0;
  spec.steps.forEach((step, k) => {
    const modeAttr = step.mode === null ? "" : ` data-mode="${step.mode}"`;
    if (spec.grouping === "cell") {
      // The same animation, addressed one cell at a time. This is the form the
      // grouped one is measured against; it is emitted for real so the
      // comparison is between two files that both work.
      parts.push(`<g data-stroke="${k}"${modeAttr}>`);
      for (const g of step.groups) {
        g.cells.forEach((i, n) => {
          parts.push(
            poly(i, g.fills[n]).replace("<polygon ", `<polygon class="c${cell}" `)
          );
          cell += 1;
        });
      }
      parts.push(`</g>`);
      return;
    }
    // One stroke, one class, one rule. The orbit is the group.
    const single = step.groups.length === 1;
    const orbitAttr = (g: AnimationGroup) =>
      g.orbit ? ` data-orbit="${g.cells.length}"` : "";
    if (single) {
      const g = step.groups[0];
      parts.push(`<g class="s${k}"${orbitAttr(g)}${modeAttr}>`);
      g.cells.forEach((i, n) => parts.push(poly(i, g.fills[n])));
      parts.push(`</g>`);
      return;
    }
    parts.push(`<g class="s${k}"${modeAttr}>`);
    for (const g of step.groups) {
      parts.push(`<g${orbitAttr(g)}>`);
      g.cells.forEach((i, n) => parts.push(poly(i, g.fills[n])));
      parts.push(`</g>`);
    }
    parts.push(`</g>`);
  });
  parts.push(`</g>`);

  for (const g of spec.overlay ?? []) {
    if (g.shapes.length === 0) continue;
    parts.push(`<g fill="${g.fill}" opacity="${pct(g.opacity)}">`);
    for (const shape of g.shapes) {
      parts.push(
        `<polygon points="${shape
          .map((v) => `${fmt(v[0])},${fmt(v[1])}`)
          .join(" ")}"/>`
      );
    }
    parts.push(`</g>`);
  }

  parts.push(`</svg>`);
  return parts.join("");
}

/**
 * The whole animation, in one element.
 *
 * One rule and one `@keyframes` per STROKE in the grouped form, per CELL in the
 * other. Nothing else differs between the two files: same polygons, same fills,
 * same order, same timings — so the byte difference is the markup requirement
 * and nothing else.
 */
function styleBlock(spec: AnimationSpec, cycle: number): string {
  const css: string[] = [];
  const target = spec.grouping === "orbit" ? "[class^=s]" : "[class^=c]";
  css.push(
    `${target}{opacity:0;animation-duration:${cycle}ms;animation-timing-function:linear;animation-iteration-count:infinite;animation-fill-mode:both}`
  );
  const key = (name: string, at: number) => {
    const on = (100 * at) / cycle;
    const lit = (100 * Math.min(at + Math.max(1, spec.fadeMs), cycle)) / cycle;
    // The first step reveals at 0, where `0%,0%` would be a duplicate selector.
    const dark = on <= 0 ? "0%" : `0%,${pct(on)}%`;
    css.push(`@keyframes ${name}{${dark}{opacity:0}${pct(lit)}%,100%{opacity:1}}`);
  };
  let cell = 0;
  spec.steps.forEach((step, k) => {
    const at = k * spec.stepMs;
    if (spec.grouping === "orbit") {
      css.push(`.s${k}{animation-name:s${k}}`);
      key(`s${k}`, at);
      return;
    }
    for (const g of step.groups) {
      for (let n = 0; n < g.cells.length; n++) {
        css.push(`.c${cell}{animation-name:c${cell}}`);
        key(`c${cell}`, at);
        cell += 1;
      }
    }
  });
  // Newline-free: an animation file is not read by hand, and the joiner would be
  // one byte per rule on a measurement this module exists to make honestly.
  return `<style>${css.join("")}</style>`;
}

/**
 * How many cells the animation draws, and how many groups carry them.
 *
 * Reported for the panel — "23 gestures, 138 cells, 23 rules" is the sentence
 * that makes the grouping legible before the file is opened.
 */
export function animationCensus(steps: readonly AnimationStep[]): {
  steps: number;
  groups: number;
  cells: number;
  orbitGroups: number;
} {
  let groups = 0;
  let cells = 0;
  let orbitGroups = 0;
  for (const s of steps) {
    groups += s.groups.length;
    for (const g of s.groups) {
      cells += g.cells.length;
      if (g.orbit) orbitGroups += 1;
    }
  }
  return { steps: steps.length, groups, cells, orbitGroups };
}
