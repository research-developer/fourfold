/**
 * THE PLAYHEAD: where the drawing stands in the animation's own index space.
 *
 * `replay.ts` established that the animation is measured in STEPS — beats of
 * `AnimationStep[]` — and not in gestures, because `animationSteps` drops a
 * gesture that changed nothing visible in the current frame. `emit.EmitLayer`
 * carries the same index as `reveal`, and `replay.InOut` marks the same index.
 * This module is the third thing that has to live there: the position a person
 * drags, and the two marks they set from it.
 *
 * Nothing here reconstructs a plate and nothing here writes one. It is a map
 * between two integer spaces plus the arithmetic on the marks, so all of it is
 * reachable from `test/timeline.test.ts` under `environment: "node"` — which is
 * the whole reason it is a module and not four helpers inside `page.tsx`.
 *
 * ── The two index spaces, and why the program has both ──────────────────
 *
 * ACT SPACE is the journal's: `0 … journal.past.length`, a COUNT of committed
 * acts, where 0 is the state the journal began from. It is what the rewind
 * preview scrubs, what `composer.stepComposition` walks, and what REVERT counts
 * in. Every act has a position in it, including the ones that painted nothing —
 * a rename, a reorder, a new sheet.
 *
 * STEP SPACE is the animation's: `0 … steps-1`, a list of BEATS, where beat j is
 * the j-th thing the replay actually shows coming up. An act that changed no
 * cell in this frame has no beat at all.
 *
 * They are therefore NOT the same axis with an offset, and they diverge
 * differently per frame: the same journal viewed as a sector drops every gesture
 * that landed in one of the other five, so `steps` falls and the map changes
 * with the view. `beatsOf` is that map, computed for the frame in hand.
 *
 * ── Why this file re-derives the drop rule, and what stops it drifting ──
 *
 * `animationSteps` decides which gestures become beats and does not report WHICH
 * gesture each beat came from — it returns the beats and nothing else. The
 * playhead needs the act index, because moving the playhead has to move the one
 * preview this program has, and that preview is walked in act space.
 *
 * The right fix is for `animationSteps` to return the index alongside the step;
 * that is a change to the model and this module is not allowed to make it. So
 * the drop rule is stated a second time here — one line, `changedCells(...)
 * .length === 0`, the same predicate on the same two states — and the DUPLICATION
 * IS GUARDED BY A TEST rather than by a comment asking for care:
 * `test/timeline.test.ts` asserts `beatsOf(states, shown).length ===
 * animationSteps(states, past, book, fill, shown).length` over journals that
 * include structural acts, repaints that cancel, and a sector frame that drops
 * gestures. If the model's rule ever moves, that assertion fails on the same run
 * as the change.
 *
 * ── ZERO FLOAT, one exception, named ────────────────────────────────────
 *
 * Everything above is integer array indices. `railPercent` is the exception and
 * it exists for the same reason `replay.pct` does: a CSS position has to be a
 * percentage. It is used to paint a track and never to decide a step.
 */

import { changedCells, clampSpan, spanSteps, type InOut } from "./replay";
import type { PaintMap } from "./strokes";

/**
 * Which committed act produced each beat, ascending.
 *
 * `beats[j]` is an index into the journal's `past`, so the state that stands on
 * beat j is the one after `beats[j] + 1` acts — see `actAtStep`, which is the
 * only place that `+ 1` is written.
 *
 * STRICTLY ASCENDING and free of duplicates by construction: `beatsOf` walks the
 * journal forward and pushes at most one entry per act. Both `stepAtAct` and the
 * marks rely on that, and `test/timeline.test.ts` asserts it rather than trusting
 * the construction to stay this way.
 */
export type Beats = readonly number[];

/**
 * The beats a replay of these states has, and which act produced each.
 *
 * `states` is `composer.everyComposition(comp, past)` flattened onto the book —
 * `past.length + 1` maps, oldest first — which is exactly what `page.tsx`
 * already builds for the animated export. `shown` is the frame's own cell list
 * in a sector view and absent for the whole hexagon, on `animationSteps`' own
 * signature.
 *
 * THE DROP RULE IS `animationSteps`', restated: an act whose two states differ
 * in no shown cell contributes no beat. See the header for why it is restated
 * and what stops the two copies drifting.
 *
 * O(acts × changed cells), one pass. The states themselves are the expensive
 * part and this function does not build them — measured at depth 5 with 256
 * acts, flattening the journal is ~170 ms and this walk is ~16 ms, which is why
 * `page.tsx` computes the pair ONCE when a preview opens rather than on every
 * stroke. It can afford to: the brush is switched off while a preview stands, so
 * the journal cannot move underneath a computed map.
 */
export function beatsOf(
  states: readonly PaintMap[],
  shown?: readonly number[]
): number[] {
  const out: number[] = [];
  for (let k = 0; k + 1 < states.length; k++) {
    if (changedCells(states[k], states[k + 1], shown).length === 0) continue;
    out.push(k);
  }
  return out;
}

/**
 * How many acts are applied when the playhead stands on beat `step`.
 *
 * The state a beat shows is the one AFTER its act ran, so this is `beats[step] +
 * 1` — and that `+ 1` is written once, here, because it is the join between the
 * two spaces and an off-by-one in it would show the frame before every beat.
 *
 * A step outside the list is brought inside it rather than refused, on
 * `clampSpan`'s rule for the same problem: this is the UI-facing end, and a
 * control dragged off the end of its own track is an ordinary event. An empty
 * `beats` has no state to name, so it answers 0 — the journal's own beginning.
 */
export function actAtStep(beats: Beats, step: number): number {
  if (beats.length === 0) return 0;
  const k = Number.isFinite(step) ? Math.round(step) : 0;
  const at = k < 0 ? 0 : k > beats.length - 1 ? beats.length - 1 : k;
  return beats[at] + 1;
}

/**
 * Which beat the drawing stands on after `acts` committed acts, or `null`.
 *
 * `null` IS A REAL ANSWER AND NOT A FAILURE, and it is the reason this returns a
 * nullable rather than clamping to 0 the way `actAtStep` clamps. Act space has a
 * position step space cannot name: the state before anything was drawn. The
 * animation calls that the GROUND — `AnimationSpec.ground`, "the plate before
 * the first step, visible from the first frame" — and it is a picture rather
 * than a beat. Answering 0 there would put the playhead on the first beat while
 * the plate showed the frame before it, which is precisely the off-by-one this
 * module exists to make impossible.
 *
 * Binary search on an ascending list: the largest j with `beats[j] < acts`.
 */
export function stepAtAct(beats: Beats, acts: number): number | null {
  if (beats.length === 0) return null;
  const want = Number.isFinite(acts) ? Math.round(acts) : 0;
  if (want <= beats[0]) return null;
  let lo = 0;
  let hi = beats.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (beats[mid] < want) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// ── the in point and the out point, set from the playhead ────────────────

/**
 * The whole replay: the span a drawing with no marks plays.
 *
 * `clampSpan(undefined, n)` already means this and the spelling is borrowed
 * rather than re-derived, so "no marks" is one value in one place.
 */
export const wholeSpan = (steps: number): InOut | null =>
  clampSpan(undefined, steps);

/**
 * The span with its IN point moved to `at`, clamped.
 *
 * `clampSpan` does the clamping, deliberately: it is the model's UI-facing end
 * and it already owns the two rules that matter here — a mark off the end of the
 * track lands on the end, and an INVERTED pair collapses by pulling the OUT
 * point back to the IN point rather than the other way round. Its header argues
 * that choice ("between two clamps, take the one that does not repaint the first
 * frame") and re-deciding it here would give the panel a second opinion about
 * one number.
 *
 * So setting an in point past the out point yields the single step at `in`. That
 * is not a silent surprise — `spanSaid` reports the span that resulted, not the
 * one that was asked for.
 */
export function markIn(
  span: InOut | null,
  at: number,
  steps: number
): InOut | null {
  const now = clampSpan(span, steps);
  if (now === null) return null;
  return clampSpan({ in: at, out: now.out }, steps);
}

/** The span with its OUT point moved to `at`, clamped. See `markIn`. */
export function markOut(
  span: InOut | null,
  at: number,
  steps: number
): InOut | null {
  const now = clampSpan(span, steps);
  if (now === null) return null;
  return clampSpan({ in: now.in, out: at }, steps);
}

/** Does this span play beat `step`? Closed at both ends — `replay.InOut`. */
export const spanCovers = (span: InOut | null, step: number): boolean =>
  span !== null && step >= span.in && step <= span.out;

/**
 * Is this span the whole replay — i.e. is it worth saying anything about?
 *
 * The control that clears the marks is disabled on this, and the strip only
 * announces a cut when there is one. A span equal to the whole drawing is what
 * "no marks" resolves to, so a panel that reported `0 … n-1` as a cut would
 * describe every fresh drawing as trimmed.
 */
export const spanIsWhole = (span: InOut | null, steps: number): boolean => {
  const at = clampSpan(span, steps);
  const all = wholeSpan(steps);
  if (at === null || all === null) return true;
  return at.in === all.in && at.out === all.out;
};

/**
 * The span in words, for the live region and for the track's accessible name.
 *
 * Says what the marks DID rather than what was asked for, which is the whole
 * point of routing every edit through `clampSpan` first: a person who sets an in
 * point past their own out point is told they now have one step, and does not
 * have to discover it by exporting.
 */
export function spanSaid(span: InOut | null, steps: number): string {
  const at = clampSpan(span, steps);
  if (at === null) return "nothing to play — no gesture changed a cell in this frame";
  const n = spanSteps(at);
  const beats = `${n} step${n === 1 ? "" : "s"}`;
  if (spanIsWhole(at, steps)) return `the whole replay — ${beats}`;
  const before = at.in;
  const after = steps - 1 - at.out;
  const folded =
    before === 0
      ? ""
      : `, ${before} step${before === 1 ? "" : "s"} already on the plate`;
  const dropped =
    after === 0 ? "" : `, ${after} step${after === 1 ? "" : "s"} not shown`;
  return `in ${at.in}, out ${at.out} — ${beats}${folded}${dropped}`;
}

/**
 * The rail position for the state before the first beat.
 *
 * THE RAIL HAS ONE MORE STOP THAN THE DRAWING HAS BEATS, and this is it. Step
 * space cannot name the plate an animation opens on — `stepAtAct` returns `null`
 * there and its header says why — but a scrub HAS to be able to stand on it: it
 * is `AnimationSpec.ground`, the first frame of the file, and REPLAY opens
 * exactly there. A rail that could not reach it would disagree with the preview
 * the moment REPLAY was pressed.
 *
 * So the rail runs `-1 … steps-1` and `-1` is the ground. It is a POSITION and
 * never a step: nothing indexes `AnimationStep[]` with it, `markIn`/`markOut`
 * clamp it away, and `spanCovers(-1)` is false for every span.
 */
export const GROUND = -1;

/**
 * Where a rail position sits along the track, as a percentage.
 *
 * The one float in this module, and it paints rather than decides — see the
 * header. The domain is the RAIL's, `GROUND … steps-1`, so the ground is the
 * left end and the last beat is the right end, and one function positions the
 * playhead and both marks. Two mappings for one rail would put a mark and the
 * thumb that set it in different places, which is the one defect a track like
 * this actually has.
 *
 * A drawing with no beats has no track, so everything on it reads 0.
 */
export function railPercent(step: number, steps: number): number {
  if (!Number.isFinite(step) || steps <= 0) return 0;
  const k = Math.min(Math.max(GROUND, Math.round(step)), steps - 1);
  return (100 * (k - GROUND)) / steps;
}
