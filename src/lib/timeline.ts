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
 * between two integer spaces, the arithmetic on the marks, the NAMES the marks
 * are now stored under, and the SENTENCES that report all of it — so every part
 * is reachable from `test/timeline.test.ts` under `environment: "node"`, which
 * is the whole reason it is a module and not a dozen helpers inside `page.tsx`.
 * The sentences are here for exactly that reason: `vitest` runs with no DOM, so
 * a string this program says out loud is testable only if the string is computed
 * somewhere a test can call.
 *
 * ── WHAT THIS PASS ADDED, and why each part is HERE and not in the page ──
 *
 * The three model files this page had never called — `frames.ts` (rewrite a past
 * frame, merge a range, `Revisions`), `nested.ts` (the named timeline tree) — are
 * wired to the strip under the plate by this pass. Every part of that wiring
 * which is a FUNCTION OF VALUES rather than of the DOM lives below:
 *
 *   THE SENTENCES that report a rebase, a merge and a refusal. `frames.ts`
 *   returns counters — `repaired`, `dropped`, `retargeted`, `orphaned` — and a
 *   `Refusal`; a counter nobody reads out loud is a silent repair, which is the
 *   exact class of loss this branch has spent three review rounds closing. The
 *   page must not be the only place those numbers become words, because a
 *   component under `environment: "node"` cannot be tested and a sentence that
 *   cannot be tested drifts.
 *
 *   THE TREE'S UPKEEP. `nested.Timeline` names beats so a mark survives an
 *   insertion, and `test/nested.test.ts` measures that the minted name is the
 *   ONLY address that survives all five insertion sites. But a tree beside a
 *   journal that moves has to be kept in step with the beat list, and THAT is
 *   arithmetic — `syncTree` below — not furniture.
 *
 *   THE ROUTING FACT for undo. `sameJournal` decides whether the journal has
 *   moved since the last frame edit, which is the whole of what makes one ⌘Z
 *   unambiguous over two stacks. See `sameJournal` for the argument.
 *
 * WHAT IS DELIBERATELY NOT HERE: anything that reconstructs a composition, and
 * anything that decides what a control looks like. `frames.rewriteFrames` does
 * the first and `page.tsx`/`LayersPanel.tsx` do the second.
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
 * TYPE ONLY, and the direction looks wrong until you check what is erased.
 *
 * `frames.ts` imports `beatsOf` from this module at RUNTIME. This import is
 * `import type`, so it is erased entirely at build and adds no edge to the
 * module graph — the same move `frames.ts` itself makes on `nested.Timeline`
 * and documents there. What it buys is that the two report sentences below can
 * name the shapes they report rather than restating them, which is what stops a
 * counter being renamed in one file and quietly ignored in the other.
 */
import type { MergeReport, RebaseReport } from "./frames";
import type { Journal } from "./layers";
import {
  flatten,
  stepId,
  type Beat,
  type Step,
  type StepId,
  type Timeline,
} from "./nested";

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
 * What the seam that opens and shuts the strip is called, in words.
 *
 * ── Why a shut strip has to say more than an open one ───────────────────
 *
 * The timeline is a SLIDEOUT now — it sits at the top of the band under the
 * plate and a centred seam collapses it — and collapsing it creates a state this
 * program did not have before: A CUT CAN BE IN FORCE WITH NOTHING ON SCREEN
 * SAYING SO. The marks are a property of the DRAWING and not of the strip, they
 * survive the strip being shut (see `Timeline`'s header), and they change what
 * REPLAY plays and what both animated exports write. A person who set an in
 * point, collapsed the strip and came back an hour later would otherwise export
 * a trimmed animation with no visible reason for it.
 *
 * So the OPEN name is bare — "hide the timeline", because the strip is right
 * there and every fact is legible on it — and the SHUT name carries the two
 * facts the collapse took away: where the playhead stands, and whether there is
 * a cut. The asymmetry is the point and not an oversight.
 *
 * ── What it defers to, rather than deciding again ───────────────────────
 *
 * `spanIsWhole` decides whether there IS a cut, for the same reason it decides
 * it for `spanSaid`: a span equal to the whole replay is what "no marks"
 * resolves to, and a seam that read `in 0, out n-1` as a cut would describe
 * every fresh drawing as trimmed. `clampSpan` decides what the numbers ARE, so
 * the seam reports the span that is in force rather than the one that was asked
 * for — the same deference, and the same reason, as `markIn`.
 *
 * NO COUNT IS THE ORDINARY RESTING STATE and not an error — `steps === null`
 * while no preview has stood the playhead up, and `steps === 0` on a frame in
 * which no gesture changed a cell. There is no playhead position to name in
 * either, but the marks may still be set, so they are still announced, from the
 * RAW span: this is the one place that reports marks with no count to clamp them
 * against, and it says only what it knows.
 */
export function seamSaid(
  open: boolean,
  steps: number | null,
  at: number | null,
  span: InOut | null
): string {
  if (open) return "hide the timeline";
  const said: string[] = [];
  if (steps !== null && steps > 0) {
    said.push(
      at === null
        ? "the playhead is before step 0"
        : `the playhead is on step ${at} of ${steps - 1}`
    );
    const cut = clampSpan(span, steps);
    if (cut !== null && !spanIsWhole(span, steps)) {
      said.push(`cut to in ${cut.in}, out ${cut.out}`);
    }
  } else if (span !== null) {
    said.push(`in ${span.in} and out ${span.out} are set`);
  }
  return said.length === 0
    ? "show the timeline"
    : `show the timeline — ${said.join(", ")}`;
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

// ── the tree the marks are named in ──────────────────────────────────────

/**
 * A source of fresh `StepId`s, monotone and never reused.
 *
 * `nested.stepId` mints from a counter "exactly as `layers.layerId` mints a
 * `LayerId` from a monotone counter rather than from a slot", and the counter
 * has to live SOMEWHERE that outlives a single call — the page holds one in a
 * ref, a test holds one on the stack. Handing the minter in rather than keeping
 * a module-level counter is what makes every function below PURE: two tests, or
 * two documents open at once, cannot mint the same name.
 */
export function minter(from = 0): () => StepId {
  let n = from;
  return () => stepId(n++);
}

/** Every beat of a tree in play order, compositions flattened away. */
function beatsIn(tree: Timeline): Beat[] {
  const out: Beat[] = [];
  const walk = (steps: readonly Step[]): void => {
    for (const s of steps) {
      if (s.kind === "comp") walk(s.steps);
      else out.push(s);
    }
  };
  walk(tree);
  return out;
}

/**
 * A tree brought back into step with a beat list, and what that cost.
 *
 * ── Why the tree needs syncing at all ───────────────────────────────────
 *
 * `nested.Timeline` holds one `Beat` per animation step, each naming the act
 * behind it, and the marks are stored as NAMES into it. The beat list, meanwhile,
 * is recomputed from the journal every time a playhead is stood up — and it moves
 * for three unrelated reasons: a gesture was committed (the list grows at the
 * end), a gesture was undone or rewritten (the list shrinks or shifts), or THE
 * FRAME CHANGED (a sector view drops every gesture that landed elsewhere, so the
 * list becomes a subsequence of itself). A tree that ignored any of those would
 * be naming beats that are not there.
 *
 * ── The three cases, in the order they are cheapest ─────────────────────
 *
 *   UNCHANGED. The tree's beats already name exactly these acts, so the tree is
 *   returned AS IT IS — same object, same groups, same holds. This is the
 *   ordinary case and it must not rebuild, or a group would evaporate the second
 *   time the playhead was stood up.
 *
 *   WHAT "EXACTLY THESE ACTS" LEAVES OUT, named rather than left latent: the
 *   comparison is over BEATS THAT NAME AN ACT, because `acts` filters `act !==
 *   null` — and a HOLD names none. So a tree carrying h holds passes this test
 *   against a beat list of the same acts, is returned unchanged, and `flatten`
 *   over it runs h entries LONGER than the beat list it was just declared in step
 *   with. Every index derived from it past the first hold is therefore h too far
 *   along: `nameAtStep`, `resolveSpan`, and any mark resolved through them.
 *
 *   That is a real defect and it is deliberately NOT fixed in this pass. The
 *   filter is right — a hold IS a step with no act, and demanding it match a beat
 *   list would make every held timeline rebuild itself and lose the holds, which
 *   is the failure this case exists to prevent. The fix is on the OTHER side: the
 *   consumers have to agree on whether they are indexing STEP space (holds
 *   included, which is what a rail position is) or BEAT space (holds excluded,
 *   which is what a beat list is), and today they quietly assume the two are the
 *   same list. Nothing in the program can insert a hold yet — `nested.insertHold`
 *   has no caller — so h is 0 for every tree this build can construct, which is
 *   what makes recording it honest rather than negligent. The first caller of
 *   `insertHold` is the change that makes this reachable, and it must not land
 *   before the two spaces are told apart.
 *
 *   APPENDED. The tree's acts are a strict PREFIX of the beat list, which is
 *   what committing new gestures produces. The new beats are added at the ROOT
 *   end and nothing that already exists is touched — so every existing name
 *   still resolves to the same index, which is `nested.ts`'s "at the root, after
 *   everything" row: the one insertion site under which even a flat index
 *   survives.
 *
 *   REBUILT. Anything else. The tree is laid out flat over the new beat list,
 *   AND EVERY NAME IS REUSED WHERE THE ACT SURVIVED — the id is carried across by
 *   act index, so a mark set on the gesture that painted act 12 still names act
 *   12 after a reframe that dropped acts 3 and 7, even though its flat index
 *   moved by two. That is the whole point of naming, and it is the case a flat
 *   index gets silently wrong: index 5 of the hexagon's beat list and index 5 of
 *   a sector's name different gestures.
 *
 * WHAT A REBUILD COSTS, stated rather than hidden: the tree's COMPOSITIONS and
 * HOLDS are dropped, because there is no honest place to put a wrapper whose
 * contents have changed shape underneath it. `rebuilt` is returned so the caller
 * can say so — a group is invisible under `nested.CompileMode` `"extend"` (it is
 * compile-invariant, measured), so losing one changes no picture, but it is still
 * a thing the person made and its loss is reported rather than assumed harmless.
 *
 * `frames.mergeFrames` is NOT one of the three cases and must not reach here: a
 * merge has `nested.rebaseTree`, which knows the splice's three numbers and can
 * therefore keep the holds inside the merged range. Rebuilding would drop them.
 */
export interface Synced {
  readonly tree: Timeline;
  /** Beats whose name came across from the tree that was handed in. */
  readonly kept: number;
  /** Beats that had to be named afresh. */
  readonly minted: number;
  /** Was the tree laid out flat again, dropping its groups and holds? */
  readonly rebuilt: boolean;
}

export function syncTree(
  tree: Timeline | null,
  beats: Beats,
  mint: () => StepId
): Synced {
  const was = tree === null ? [] : beatsIn(tree);
  const acts = was.filter((b) => b.act !== null).map((b) => b.act as number);

  const same =
    acts.length === beats.length && acts.every((a, k) => a === beats[k]);
  if (tree !== null && same) {
    return { tree, kept: acts.length, minted: 0, rebuilt: false };
  }

  const prefix =
    tree !== null &&
    acts.length < beats.length &&
    acts.every((a, k) => a === beats[k]);
  if (tree !== null && prefix) {
    const added: Beat[] = beats
      .slice(acts.length)
      .map((act) => ({ kind: "beat", id: mint(), act }));
    return {
      tree: [...tree, ...added],
      kept: acts.length,
      minted: added.length,
      rebuilt: false,
    };
  }

  // REBUILT. One pass, and the name is carried by ACT rather than by position,
  // which is the only reason a mark survives a reframe at all.
  const byAct = new Map<number, StepId>();
  for (const b of was) if (b.act !== null) byAct.set(b.act, b.id);
  let kept = 0;
  let minted = 0;
  const flat: Beat[] = beats.map((act) => {
    const had = byAct.get(act);
    if (had === undefined) {
      minted += 1;
      return { kind: "beat", id: mint(), act };
    }
    kept += 1;
    return { kind: "beat", id: had, act };
  });
  return { tree: flat, kept, minted, rebuilt: tree !== null };
}

/** What a sync did, when it did something worth saying. `null` when it did not. */
export function syncSaid(sync: Synced): string | null {
  if (!sync.rebuilt) return null;
  return `the timeline was rebuilt for this frame — ${sync.kept} step${
    sync.kept === 1 ? "" : "s"
  } kept their names, ${sync.minted} ${
    sync.minted === 1 ? "is" : "are"
  } new, and any grouping was dropped`;
}

/** The name of the beat standing at rail position `step`, or `null`. */
export function nameAtStep(tree: Timeline | null, step: number): StepId | null {
  if (tree === null || !Number.isFinite(step) || step < 0) return null;
  const { order } = flatten(tree);
  return order[Math.round(step)] ?? null;
}

// ── the marks, stored as NAMES ───────────────────────────────────────────

/**
 * The in point and the out point as `nested.StepId`s rather than as indices.
 *
 * ── Why a name and not a number, measured ───────────────────────────────
 *
 * `test/nested.test.ts` runs one probe against FIVE insertion sites — a hold at
 * the root before everything, at the root after everything, inside an earlier
 * sibling composition, inside the probe's own composition before it, and inside
 * its own composition after it — and tabulates which address survives each. The
 * flat index survives three, the positional path survives three (a DIFFERENT
 * three), and ONLY THE MINTED NAME SURVIVES ALL FIVE. A mark is exactly a stored
 * address into that list, so a mark stored as an index is a mark that names a
 * different gesture the moment anything is inserted before it.
 *
 * The same argument covers the case this program can already reach without any
 * holds at all: the beat list is per-FRAME, so index 5 of the hexagon's list and
 * index 5 of a sector's are different gestures. `syncTree` carries a name across
 * that change by act; nothing can carry an index across it.
 *
 * BOTH ENDS OR NEITHER, and that is the FILE's rule rather than a preference:
 * `artfile.ArtAnimation` enforces "both or neither" on `in`/`out` because "one
 * without the other would need a second spelling of 'to the end', and two ways
 * to write one thing is two ways for a round trip to pick the other one". So a
 * half-resolved span is not a span, and `resolveSpan` returns the whole replay
 * plus a sentence rather than half a cut.
 */
export interface NamedSpan {
  readonly in: StepId;
  readonly out: StepId;
}

/** A resolved span, and which end of it (if either) no longer names a beat. */
export interface ResolvedSpan {
  /** In step space, ready for `clampSpan`. `null` is the whole replay. */
  readonly span: InOut | null;
  readonly lost: "none" | "in" | "out" | "both";
}

/** The span in force, with the two ends named. `null` in, `null` out. */
export function nameSpan(
  tree: Timeline | null,
  span: InOut | null
): NamedSpan | null {
  if (tree === null || span === null) return null;
  const { order } = flatten(tree);
  const a = order[span.in];
  const b = order[span.out];
  if (a === undefined || b === undefined) return null;
  return { in: a, out: b };
}

/**
 * The named marks back in step space.
 *
 * A DANGLING NAME FALLS BACK TO THE WHOLE REPLAY AND SAYS SO. `nested.resolve`
 * puts the choice squarely on its caller — "a flat integer can always be CLAMPED
 * … whereas a name can DANGLE … the honest answers are 'fall back to the whole
 * replay' or 'refuse', and this module does not get to pick" — and this is where
 * it is picked, on two grounds:
 *
 *   REFUSING WOULD BREAK AN EXPORT for a reason the person cannot act on. The
 *   marks outlive the preview and the panel; a save is not the moment to
 *   discover that a beat named an hour ago has since been merged away.
 *
 *   FALLING BACK SILENTLY WOULD BE WORSE THAN EITHER, because the whole replay
 *   is a LONGER animation than the cut and a person who marked three steps would
 *   export sixty without a word. So the fallback is paired with `lost`, and every
 *   caller that resolves is expected to say `lostSaid`.
 */
export function resolveSpan(
  tree: Timeline | null,
  named: NamedSpan | null
): ResolvedSpan {
  if (named === null) return { span: null, lost: "none" };
  if (tree === null) return { span: null, lost: "both" };
  const { indexOf } = flatten(tree);
  const a = indexOf.get(named.in);
  const b = indexOf.get(named.out);
  if (a === undefined || b === undefined) {
    return {
      span: null,
      lost:
        a === undefined && b === undefined ? "both" : a === undefined ? "in" : "out",
    };
  }
  return { span: { in: a, out: b }, lost: "none" };
}

/**
 * THE CUT AS THE FRAME BEING WRITTEN SEES IT — sync first, resolve second.
 *
 * ── The failure this exists to close, measured ──────────────────────────
 *
 * `resolveSpan` answers in the STEP SPACE OF THE TREE IT IS HANDED, and a tree is
 * a naming of ONE frame's beat list. So resolving a live pair of marks against a
 * tree that was stood up in a different frame gives indices that are numbers of
 * the old frame and are then used as numbers of the new one. Nothing detects it:
 * the names still resolve, so `lost` is `"none"` and `lostSaid` never fires, and
 * `replay.clampSpan` brings the pair inside the new length WITHOUT REMAPPING IT —
 * a six-step cut over the hexagon becomes a one-step cut over a sector, silently,
 * in every replay this program writes.
 *
 * That is the exact failure `NamedSpan`'s header says the naming scheme exists to
 * prevent ("index 5 of the hexagon's beat list and index 5 of a sector's are
 * different gestures"), arriving through the one door the naming does not close
 * by itself: a name is only worth its index once the tree has been brought into
 * step with the list the index is about to be read against.
 *
 * ── Why this is a function and not a second call to `resolveSpan` ───────
 *
 * `resolveSpan`'s own header hands its callers a rule — "every caller that
 * resolves is expected to say `lostSaid`" — and the two-step version has a second
 * rule on top of it: SYNC FIRST, AGAINST THE BEATS YOU ARE ABOUT TO WRITE. A pair
 * of call sites that each spelled the two steps by hand would be two chances to
 * spell them in the other order, and the wrong order is undetectable by
 * inspection because it still returns a plausible pair of numbers.
 *
 * ── It COMMITS NOTHING, and that is the point of returning the sync ─────
 *
 * `syncTree` is pure; `page.tsx`'s `standTree` is the wrapper that also keeps the
 * result. This returns the `Synced` rather than keeping it so an EXPORT can
 * resolve honestly without a read mutating the document — a decline after this
 * point must be able to write nothing and change nothing. A caller that does want
 * to keep the tree has `sync.tree` and `syncSaid` in hand and commits on its own
 * success path.
 */
export interface FrameCut extends ResolvedSpan {
  /** The tree brought into step with the beats. NOT kept; see the header. */
  readonly sync: Synced;
}

export function cutForFrame(
  tree: Timeline | null,
  named: NamedSpan | null,
  beats: Beats,
  mint: () => StepId
): FrameCut {
  const sync = syncTree(tree, beats, mint);
  return { ...resolveSpan(sync.tree, named), sync };
}

/** What a dangling mark cost, in words. `null` when nothing was lost. */
export function lostSaid(lost: ResolvedSpan["lost"]): string | null {
  if (lost === "none") return null;
  const which =
    lost === "both"
      ? "the in and out points named steps"
      : `the ${lost} point named a step`;
  return `${which} this frame no longer has — the cut is off and the whole drawing plays`;
}

// ── act space, for the two frame edits ───────────────────────────────────

/**
 * The journal range a marked span covers: `count` acts starting at `at`.
 *
 * THE ONE CONVERSION A FRAME MERGE NEEDS, and it is not `actAtStep` twice. The
 * span names two BEATS; the acts to merge are every act from the one that
 * produced the first beat to the one that produced the last, INCLUDING the acts
 * between them that have no beat of their own — a rename, a reorder, a stroke
 * that landed outside this frame. Merging beats-only would leave those acts
 * stranded between two halves of a coalesced gesture, and `frames.mergeActs`
 * takes a contiguous slice of the journal because a non-contiguous one cannot be
 * one rung.
 *
 * So this is deliberately WIDER than the marks look on the rail, and the caller
 * is expected to say how many frames it is about to touch before it touches
 * them: `frames.mergeFrames` reports `frames` in its `MergeReport`, which is this
 * `count` and not the number of beats the person could see.
 *
 * `null` when the span names nothing, or names fewer than the two acts a merge
 * needs — the same refusal `frames.mergeFrames` makes, made early so the control
 * can be disabled rather than pressed into a refusal.
 */
export function rangeOfSpan(
  beats: Beats,
  span: InOut | null
): { at: number; count: number } | null {
  if (span === null || beats.length === 0) return null;
  const lo = Math.min(Math.max(0, span.in), beats.length - 1);
  const hi = Math.min(Math.max(0, span.out), beats.length - 1);
  if (hi < lo) return null;
  const at = beats[lo];
  const count = beats[hi] - at + 1;
  return count < 2 ? null : { at, count };
}

/**
 * Where a preview standing at `index` acts should stand after a merge.
 *
 * A merge replaces `count` acts at `at` with ONE, so act space shortens by
 * `count - 1` above the splice and the preview has to move with it or it will
 * show a state that is now somebody else's.
 *
 * Three cases and the middle one is the decision: a preview standing INSIDE the
 * merged range has no state to return to — the intermediate states are exactly
 * what the merge destroyed, and `test/nested.test.ts` says so out loud ("MERGE IS
 * NOT INVERTIBLE: the real mergeActs destroys the middle state"). It lands AFTER
 * the merged act rather than before it, because the merged act is the work the
 * person was looking at and showing them the state before it would look like the
 * merge had deleted their drawing.
 */
export function actAfterMerge(index: number, at: number, count: number): number {
  if (index <= at) return index;
  if (index >= at + count) return index - (count - 1);
  return at + 1;
}

// ── one undo over two stacks ─────────────────────────────────────────────

/**
 * Do these two journals hold the same COMMITTED rungs? — the undo direction.
 *
 * ── What this decides ───────────────────────────────────────────────────
 *
 * A frame edit cannot be an `Act` — `frames.ts` proves that at length: a `Move`
 * acts on a `Composition`, the journal is not in a `Composition`, so no act can
 * describe a change to the list of acts — so it is undone through `Revisions`, a
 * SECOND stack. Two stacks and one keystroke is how ⌘Z becomes ambiguous, and
 * this pair of functions is what stops it being. The question ⌘Z has to answer is
 * "is the frame edit still the most recent thing that is STANDING?", and that is
 * exactly this comparison: nothing has been committed since the edit that has not
 * already been taken back.
 *
 * IT IS EXACTLY LIFO. Rewrite a frame, paint a stroke, and `past` has grown, so
 * ⌘Z takes back the stroke; that undo restores `past` to what the edit left, so
 * the next ⌘Z reaches the edit. The seam between the two stacks unwinds in the
 * order the work was done and the person never has to know it is there.
 *
 * ── Why `future` IS NOT COMPARED HERE, which was a real bug ─────────────
 *
 * The first version compared both halves, on the reasoning that "has the journal
 * moved" means its whole state. That is right for redo and WRONG FOR UNDO, and
 * the sequence that shows it is two keystrokes long: rewrite a frame, paint,
 * ⌘Z. The undo leaves `past` where the edit left it and `future` holding the
 * stroke — so a both-halves test answers false, the next ⌘Z routes to the journal
 * instead, AND IT UNDOES THE ACT BENEATH THE FRAME EDIT: the edit is skipped over
 * entirely and the keystroke reaches something older than the thing it should
 * have taken back. An undone act is not standing on top of anything, so it must
 * not count against the edit.
 *
 * ── Where it goes blind, stated ─────────────────────────────────────────
 *
 * At `layers.HISTORY_LIMIT` the oldest rung is dropped when a new one is
 * committed, so undoing that new act does NOT restore the array the edit left —
 * one rung is gone from the far end. The revision then stays out of ⌘Z's reach
 * until it falls off the revision stack. That is a real corner and it is the
 * honest one: at the limit the journal genuinely no longer holds what it held.
 *
 * IDENTITY, not equality: acts are immutable and shared, so two journals holding
 * the same rungs hold the same objects. A deep comparison would be slower and
 * would answer true for two different acts that happened to say the same thing.
 */
export function sameCommitted(a: Journal, b: Journal): boolean {
  if (a === b) return true;
  if (a.past.length !== b.past.length) return false;
  return a.past.every((x, k) => x === b.past[k]);
}

/**
 * Is the journal in EXACTLY the state it was — both halves? — the redo direction.
 *
 * Redo asks a different question from undo and needs a different test, which is
 * the finding above run the other way. ⇧⌘Z has to answer "is the frame edit the
 * most recently UNDONE thing?", and any journal undo since would be more recent —
 * so an act sitting in `future` that was not there when the revision moved is
 * exactly the disqualifying evidence that the same act sitting there is NOT in
 * the undo direction.
 *
 * The sequence that needs it: take a frame edit back, paint, take THAT back. Now
 * `past` matches the state the revision undo left, because painting and undoing
 * the paint cancel — but the redo branch holds the stroke, which is the more
 * recent thing to put back, and a ⇧⌘Z that reinstated the frame edit here would
 * restore a whole session from an abandoned branch and take the stroke with it.
 */
export function sameJournal(a: Journal, b: Journal): boolean {
  if (a === b) return true;
  if (a.future.length !== b.future.length) return false;
  return sameCommitted(a, b) && a.future.every((x, k) => x === b.future[k]);
}

/**
 * What ⌘Z will take back, in words. THE WHOLE OF THE DISAMBIGUATION.
 *
 * The routing above is exact, but a rule the person cannot see is still a
 * surprise the first time it fires — so the strip states the answer BEFORE the
 * key is pressed, and this is the sentence. `pending` is the frame edit that is
 * on top when one is (see `sameJournal`), `next` is the note of the journal's own
 * last rung, and both being absent is a drawing with nothing to take back.
 */
export function undoSaid(pending: string | null, next: string | null): string {
  if (pending !== null) return `undo takes back ${pending}`;
  if (next !== null) return `undo takes back ${next}`;
  return "nothing to undo";
}

/**
 * The same for ⇧⌘Z, and it is a SEPARATE function rather than a flag on the one
 * above.
 *
 * The two sentences say different things about different stacks — "takes back"
 * against "puts back" — and the two routings ask different questions of the
 * journal (`sameCommitted` against `sameJournal`, and they disagree). A shared
 * function with a direction argument would put both of those behind one name and
 * make the caller responsible for keeping them apart, which is the arrangement
 * this pass has been unpicking everywhere else.
 */
export function redoSaid(pending: string | null, next: string | null): string {
  if (pending !== null) return `redo puts ${pending} back`;
  if (next !== null) return `redo puts ${next} back`;
  return "nothing to redo";
}

// ── saying what a frame edit did ─────────────────────────────────────────

/** `n thing`, `n things` — the plural this file writes a dozen times. */
const many = (n: number, one: string, more = `${one}s`): string =>
  `${n} ${n === 1 ? one : more}`;

/** `a`, `a and b`, `a, b and c` — for the modes a merged range disagreed over. */
function listed(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * WHAT A REBASE HAD TO REPAIR, said out loud.
 *
 * ── Why every counter gets a clause ─────────────────────────────────────
 *
 * `frames.RebaseReport` exists because "a rebase is not a lossless operation and
 * a report that said 'ok' would be hiding that", and a counter that reaches no
 * sentence is the same hiding one layer further out. So each of the six is
 * spelled, in the order a person cares about them: what was silently corrected
 * first, what was silently DELETED next, and the two structural ones last.
 *
 * The clauses say WHAT KIND OF FACT moved rather than naming the field, because
 * the fields are the model's vocabulary and this sentence is not:
 *
 *   `repaired`   → "records re-read from the drawing". A `CellEdit.from`, a
 *                  `rename.from` and a paint's `MoveGesture.from` are one kind of
 *                  fact — what was there before — and `frames.ts` counts them as
 *                  one for exactly that reason.
 *   `dropped`    → "edits that now change nothing, dropped". Named as a DROP and
 *                  not as a tidy-up: the act still occupies act space and now
 *                  paints less than it says it does.
 *   `retargeted` → "writes that followed a wash to its new colour". The split
 *                  write case, which no `from` check can see — measured in
 *                  `frames.washSource`.
 *   `orphaned`   → "writes dropped because the wash they preserved is gone".
 *   `refrozen`   → "layers re-read from the live tree", the `place` case.
 *   `quiet`      → "frames that now paint nothing", which is not a defect: it is
 *                  Flash's in-between frame arriving by arithmetic.
 *
 * NOTHING TO REPAIR IS ALSO SAID. "23 frames replayed" alone leaves a reader
 * wondering whether the counters were checked; "and nothing had to be repaired"
 * is the same length and answers it.
 */
export function rebaseSaid(report: RebaseReport): string {
  const parts: string[] = [];
  if (report.repaired > 0) {
    parts.push(`${many(report.repaired, "record")} re-read from the drawing`);
  }
  if (report.dropped > 0) {
    parts.push(`${many(report.dropped, "edit")} dropped for changing nothing`);
  }
  if (report.retargeted > 0) {
    parts.push(
      `${many(report.retargeted, "write")} retargeted to follow a wash that moved`
    );
  }
  if (report.orphaned > 0) {
    parts.push(`${many(report.orphaned, "write")} dropped for a wash that is gone`);
  }
  if (report.refrozen > 0) {
    parts.push(`${many(report.refrozen, "layer")} re-read from the live tree`);
  }
  if (report.quiet > 0) {
    parts.push(`${many(report.quiet, "frame")} left painting nothing`);
  }
  const lead = `${many(report.rebased, "frame")} replayed`;
  const said =
    parts.length === 0
      ? `${lead}, and nothing had to be repaired`
      : `${lead} — ${listed(parts)}`;
  return report.discardedRedo === 0
    ? said
    : `${said}. ${many(report.discardedRedo, "redo step")} discarded.`;
}

/**
 * A refusal, said so it cannot be mistaken for a result.
 *
 * `frames.ts` returns `layers.Refused`, whose `said` already names the problem —
 * "there is no frame 9 — the drawing has 6". What this adds is the half a
 * refusal must carry and a model cannot know: THAT NOTHING HAPPENED. A rebase
 * that declines is atomic by construction ("the session is returned untouched"),
 * and a person who pressed a button and saw a sentence has no way to tell an
 * atomic refusal from a half-applied one unless the sentence says.
 */
export function refusedSaid(what: string, said: string): string {
  return `${what} refused — ${said}. The drawing is exactly as it was.`;
}

/**
 * WHAT A MERGE GAVE UP, said out loud — and the mode disagreement is the point.
 *
 * `frames.mergeActs` is explicit that a merged frame whose sources were made at
 * DIFFERENT brush symmetries carries NO MARK AT ALL, because `StrokeMark.mode` is
 * a single number and "picking the first would claim the whole merged gesture was
 * made at a symmetry half of it was not". That is the right call and it is a
 * LOSS: the replay reveals a marked gesture orbit by orbit and an unmarked one as
 * the single remainder group `animationSteps` already has. A person who merges
 * six frames and finds their animation revealing in one lump deserves to have
 * been told, in the same breath as the merge.
 *
 * So `MergeReport.modes` — which is read off the RANGE and not off the result,
 * for the reason `mergeActs` records at length — is what this sentence is built
 * around. Three cases, and they are genuinely three:
 *
 *   MARKED → the modes agreed, so the merged mark keeps every group. `modes` has
 *   exactly one entry and it is named, because "12 groups at the 6-fold brush" is
 *   what the replay will actually do.
 *
 *   UNMARKED WITH NO MODES → nothing in the range was marked. Nothing was given
 *   up, and saying so is what stops the loud case being drowned in noise.
 *
 *   UNMARKED WITH MODES → THE DISAGREEMENT. Loud, and it names the modes, so the
 *   person can undo, split the range along a mode boundary, and merge twice.
 */
export function mergeSaid(report: MergeReport): string {
  const lead = `${many(report.frames, "frame")} merged into one — ${many(
    report.moves,
    "move"
  )} in the merged frame, ${many(
    report.coalesced,
    "paint"
  )} folded into the stroke before it`;
  if (report.marked) {
    const mode = report.modes.length === 1 ? ` at the ${report.modes[0]}-fold brush` : "";
    return `${lead}. The merged mark keeps ${many(
      report.groups,
      "symmetry group"
    )}${mode}.`;
  }
  if (report.modes.length === 0) {
    return `${lead}. No gesture in the range recorded a symmetry, so the merged frame carries no mark — exactly as they did.`;
  }
  return `${lead}. THE MODES DISAGREE: the range was made at ${listed(
    report.modes.map((m) => `${m}-fold`)
  )}, and one frame can carry only one — so the merged frame carries NO symmetry mark at all, and the replay will reveal its cells in one group rather than orbit by orbit.`;
}

// ── the tree, into a file and back ───────────────────────────────────────

/**
 * THE ONE THING A FILE HAS TO SAY ABOUT A NESTED TIMELINE, and why it is a
 * TRAIL rather than a pair of brackets.
 *
 * A `nested.Comp` is a run of consecutive steps with a name. A file could state
 * that three ways, and two of them are worse:
 *
 *   A START AND A LENGTH on the first layer of the run. Compact, and it puts the
 *   whole of a composition's existence on ONE layer — so a file whose layers are
 *   filtered, reordered or partially copied (all of which `emit.ts` and the
 *   panel's per-layer copy already do) loses the run entirely, or keeps a length
 *   that runs off the end of what survived.
 *
 *   A BRACKET PAIR, an "opens here" flag and a "closes here" flag. Two fields for
 *   one fact, and an unmatched bracket is a file that cannot be read at all.
 *
 *   THE TRAIL, taken: every layer states the compositions it is INSIDE, outermost
 *   first. It is idempotent under filtering — drop any layer and the rest still
 *   state their own nesting truthfully — it needs no second field, it expresses
 *   arbitrary depth in one string, and a run is simply a maximal stretch of
 *   layers whose trail begins the same way. This is the same shape `plate.ts`
 *   already uses for a cell: an ADDRESS WORD that names the path rather than a
 *   position that has to be counted.
 *
 * The cost is repetition — a ten-step group writes its name ten times — and it is
 * paid in a field that is absent from every ungrouped file, which is the trade
 * `artfile.ts` makes for every optional field it has.
 */
export const NEST_SEPARATOR = " ";

/** The trail a file states, from the ids of the compositions a beat sits in. */
export const compMark = (trail: readonly StepId[]): string | undefined =>
  trail.length === 0 ? undefined : trail.join(NEST_SEPARATOR);

/** The ids a stated trail names, outermost first. `[]` for an absent field. */
export const compTrail = (mark: string | undefined): StepId[] =>
  mark === undefined || mark.length === 0
    ? []
    : (mark.split(NEST_SEPARATOR).filter((s) => s.length > 0) as StepId[]);

/**
 * One trail per beat of the tree, in play order — the WRITER's half.
 *
 * `undefined` for a beat at the root, so a file with no groups writes no field
 * at all and its bytes are the bytes it wrote before this existed. That is the
 * property `test/artfile.test.ts` asserts directly rather than assuming, on the
 * same grounds `test/inout.test.ts` asserts it for the in and out points.
 */
export function compTrails(tree: Timeline): (string | undefined)[] {
  const out: (string | undefined)[] = [];
  const walk = (steps: readonly Step[], trail: StepId[]): void => {
    for (const s of steps) {
      if (s.kind === "comp") walk(s.steps, [...trail, s.id]);
      else out.push(compMark(trail));
    }
  };
  walk(tree, []);
  return out;
}

/**
 * The tree a file's trails describe — the READER's half, and the inverse of
 * `compTrails` on every tree this program can write.
 *
 * ── What a loaded document knows, and what it does not ──────────────────
 *
 * A file carries no journal. `Beat.act` is an index into `layers.Journal.past`,
 * and a document that has just been loaded has an EMPTY past — so the acts are
 * supplied by the caller when it has them and default to the step's own position
 * when it does not. That default is exactly `nested.timelineOf` applied to a
 * journal of one act per beat, which is what a loaded drawing is until somebody
 * draws on it, so it is the honest reading rather than a placeholder.
 *
 * ── The one malformed shape this repairs rather than refuses ────────────
 *
 * A trail may name a composition that has ALREADY BEEN CLOSED — steps 0–2 inside
 * `t9`, then step 3 at the root, then step 4 inside `t9` again. No tree this
 * program builds can produce that, because a `Comp` holds a contiguous run; a
 * hand-edited or half-merged file can. Refusing the whole payload for it would
 * be disproportionate — the drawing is perfectly good and only its timeline is
 * odd — so the re-opened composition is given a FRESH name and becomes a second
 * composition. Nothing dangles, nothing is ambiguous, and the tree stays
 * well-formed; what is lost is the claim that those two runs were one group,
 * which the file was not entitled to make.
 */
export function treeFromTrails(
  trails: readonly (string | undefined)[],
  mint: () => StepId,
  beats?: Beats
): Timeline {
  const root: Step[] = [];
  /** The compositions currently open, innermost last, with their own arrays. */
  const open: { id: StepId; steps: Step[] }[] = [];
  /** Every composition name already closed — see the repair above. */
  const closed = new Set<StepId>();

  trails.forEach((raw, k) => {
    const trail = compTrail(raw);
    let common = 0;
    while (
      common < open.length &&
      common < trail.length &&
      open[common].id === trail[common]
    ) {
      common += 1;
    }
    while (open.length > common) closed.add((open.pop() as { id: StepId }).id);
    for (let d = common; d < trail.length; d++) {
      const id = closed.has(trail[d]) ? mint() : trail[d];
      const steps: Step[] = [];
      (open.length === 0 ? root : open[open.length - 1].steps).push({
        kind: "comp",
        id,
        steps,
      });
      open.push({ id, steps });
    }
    (open.length === 0 ? root : open[open.length - 1].steps).push({
      kind: "beat",
      id: mint(),
      act: beats?.[k] ?? k,
    });
  });
  return root;
}
