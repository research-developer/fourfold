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
 * ── Why one `@keyframes` per stroke, and not one shared ─────────────────
 *
 * A shared `@keyframes` plus a per-stroke `animation-delay` is the obvious
 * shape and it CANNOT loop. With `animation-iteration-count: infinite` the
 * delay applies to the first iteration only, so the second cycle plays every
 * group at once; with a finite count nothing ever resets. The window a stroke
 * is visible for — from its own reveal to the end of the cycle — has a
 * different LENGTH for every stroke, and a delay can only shift a window, not
 * resize it. So the reveal point lives in the keyframes, which makes it one
 * keyframes per stroke. That is still O(strokes) and not O(cells), which is the
 * whole of the requirement; the measurement in the test is against the per-cell
 * form of the same thing, written the same way.
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
  /** The plate before the first recorded gesture. Visible from the first frame. */
  ground: PaintMap;
  steps: readonly AnimationStep[];
  /** Milliseconds between steps. An integer; the percentages are derived. */
  stepMs: number;
  /** Milliseconds the finished plate holds before the loop restarts. */
  holdMs: number;
  /** How long a group takes to come up. Short — it reads as a stroke landing. */
  fadeMs: number;
  grouping: AnimationGrouping;
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
