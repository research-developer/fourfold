/**
 * FRAMES: editing the drawing's PAST, and coalescing a range of it.
 *
 * The request this answers, in the owner's words: *"I want to be able to edit
 * the previous frames in case I want a particular animation"*, *"we need to be
 * able to select a range of frames and merge them into one frame"*, and *"the
 * timeline needs to drill down … a lot like how Flash worked with their tweens
 * motion frames and keyframes"*.
 *
 * A FRAME here is an `layers.Act` — one rung of the journal, one thing the person
 * did. That identification is not a convenience: `composer.everyComposition`
 * walks acts, `timeline.beatsOf` maps acts to the animation's beats, and
 * `replay.animationSteps` reveals one step per gesture. The timeline the owner is
 * looking at IS the journal, drawn sideways.
 *
 * ── THE ARCHITECTURAL FORK, decided and evidenced ───────────────────────
 *
 * "Edit a previous frame" has three readings and they are different work.
 *
 *   (a) DESTRUCTIVE — editing at act k discards k+1…n. `layers.undo` already
 *       does this, `act()` already discards the redo branch, and it is not what
 *       was asked for: "in case I want a particular animation" presupposes the
 *       later work survives.
 *
 *   (b) REBASE — edit act k, then replay k+1…n on top of the result. TAKEN.
 *
 *   (c) FLASH-STYLE INDEPENDENT FRAMES — each frame owns its picture, so editing
 *       frame 5 cannot touch frame 6. REJECTED, and the model refuses it rather
 *       than merely disliking it. A frame here holds `CellEdit {cell, from, to}`,
 *       a DIFFERENCE, and `layers.Layer.plate` is one cumulative
 *       `Map<Address, hex>` that every act writes into. There is no per-frame
 *       plate to own a picture with, and giving each act one would mean storing
 *       n plates instead of n strokes — at `HISTORY_LIMIT` = 256 acts on a
 *       depth-5 hexagon that is 256 × ~1.5k entries where the journal costs a few
 *       dozen edits per act. Flash could do it because a Flash frame is a display
 *       list; ours is a stroke on one plate. AGREED with the brief on this point.
 *
 * ── WHAT WAS MEASURED, before anything was written ──────────────────────
 *
 * Every number below came from running the real model (depth-2 hexagon, one
 * layer, `planPlateEdits` for every stroke), not from reading it.
 *
 *   1. LATER STROKES STILL WIN. Act 0 paints `s0:AA` gold, act 2 paints it red;
 *      rewrite act 0 to blue and replay; the final plate is RED. `applyEdits`
 *      writes `e.to` and never consults `e.from`, so a rebase changes the
 *      ANIMATION and not the finished drawing wherever a later act repaints the
 *      same cell. The brief predicted this and it is true.
 *
 *   2. AND UNDO BREAKS, WHICH THE BRIEF DID NOT SAY. Same journal: after the
 *      naive rebase, undoing act 1 restores `s0:AA` to `#aa8800` — the colour
 *      from BEFORE the rewrite — because act 1's `CellEdit.from` still records
 *      gold while the plate now holds blue. The whole promise of `strokes.ts` is
 *      that "undo is exact rather than approximate: it does not recompute what
 *      the canvas should look like, it puts back what was measured to be there",
 *      and a naive rebase silently makes every later `from` a lie. SO THE `from`
 *      FIELDS OF THE TAIL MUST BE RE-READ. That is the core of `rebaseEdits`.
 *
 *   3. THE SPLIT CASE IS INVISIBLE TO A `from` CHECK, and it is the one that
 *      corrupts the picture. Wash `s0:A` gold, then erase `s0:AB`;
 *      `plate.planPlateEdits` emits
 *
 *        {s0:A, gold→null} {s0:AA, null→gold} {s0:AC, null→gold} {s0:AX, null→gold}
 *
 *      because an erase inside a wash has to DELETE the wash and repaint the
 *      three siblings it covered. Rewrite the wash to red and replay naively: the
 *      plate comes out `{s0:AA gold, s0:AC gold, s0:AX gold}`. The red is gone
 *      and no `from` mismatched — the three repaints record `from: null`, and
 *      null is still what is there. The tell is the FOURTH edit, `{s0:A, from:
 *      gold}`, whose `from` is now stale. See `washSource`.
 *
 *   4. A `place` MOVE FREEZES A PLATE. `Move.place` carries `node: Layer`, and
 *      that layer carries its plate: after painting `s0:AA` gold and reordering,
 *      the rung's frozen node holds `[["s0:AA","#aa8800"]]`. `layers.ts` needs
 *      that so undoing a delete restores the exact subtree. Under a rebase it is
 *      a photograph of a plate that no longer exists, and undoing across it would
 *      resurrect pre-rewrite paint. So `place` nodes are RE-FROZEN. The brief did
 *      not mention this case; it is the second-largest thing in this file.
 *
 *   5. ACT SPACE ALREADY HAS HOLDS AND STEP SPACE DROPS THEM. Three acts — a
 *      paint, a rename, a paint — give `animationSteps` length 2. Measured. That
 *      is the Flash mapping, and the write-up is below.
 *
 * ── THE CONFLICT RULE ───────────────────────────────────────────────────
 *
 * A rebase replays the tail against the drawing as it now stands. Every act
 * states an INTENT (`to`, and which cells) and a RECORD (`from`, and the frozen
 * node). THE INTENT IS KEPT AND THE RECORD IS RE-READ. That one sentence is the
 * whole rule, and each clause below is a consequence of it rather than a case:
 *
 *   `CellEdit.from` mismatched      → RE-READ from the live plate. Counted as
 *                                     `repaired`. Not a refusal: "paint this
 *                                     cell red" is still a thing the gesture
 *                                     said, and it still says it.
 *
 *   the edit is now a no-op         → DROPPED, by handing the repaired list to
 *                                     `mergeEdits`, which has always dropped
 *                                     no-ops ("a gesture that ends where it
 *                                     started leaves an empty stroke"). Counted
 *                                     as `dropped`. Keeping it would make the
 *                                     act's reported cell count a lie, which is
 *                                     the exact defect `planEdits` avoids.
 *
 *   a SPLIT WRITE whose wash moved  → RETARGETED to the wash's live colour. A
 *                                     split write is derived data — its `to` was
 *                                     COPIED from the deleted ancestor's colour
 *                                     — so when the source moves the copy moves.
 *                                     Counted as `retargeted`.
 *
 *   a SPLIT WRITE whose wash is gone→ DROPPED. There is no colour left to
 *                                     preserve around the hole. Counted as
 *                                     `orphaned`.
 *
 *   a `place` node that is stale    → RE-FROZEN from the live tree, and carried
 *                                     to the matching `insert` in the same act
 *                                     so a reorder does not lose the plate
 *                                     between its two halves. Counted as
 *                                     `refrozen`.
 *
 *   a move naming a layer that is
 *   not in the tree                 → REFUSED, whole. `layers.applyMove` throws
 *                                     here and says why: "a journal that has come
 *                                     apart is the one failure a drawing program
 *                                     cannot recover from". A rebase is the
 *                                     operation that can cause that, so it is
 *                                     the operation that has to check. The
 *                                     refusal is a COUNTED PRECONDITION — the
 *                                     session is returned untouched — and never a
 *                                     fallback that half-applies.
 *
 * WHAT IS NOT A CONFLICT, stated because the brief expected it to be: a later
 * act's `StrokeMark.groups` naming an address the edited act no longer paints.
 * A mark records the SYMMETRY THE BRUSH WAS HELD AT and the addresses that
 * brush stamped — facts about the gesture, not about the plate. Editing an
 * earlier act cannot change which cells a later brush reached. `markLookup`
 * already answers −1 for an address nothing painted and `provenance.ts` already
 * states the rule for an empty group ("a group whose cells were all no-ops still
 * happened"). So later marks are carried through UNTOUCHED, and the only mark a
 * rewrite may invalidate is the one on the act being rewritten — which is the
 * caller's to supply, exactly as `layers.applyMove` makes a paint strip the
 * layer's own `mode`/`orbit` rather than guessing a new one.
 *
 * ── UNDOING A FRAME EDIT: why it is a REVISION and not an `Act` ─────────
 *
 * DEVIATION, flagged rather than quietly taken. The brief says "it must be
 * undoable — the edit itself is an act". It cannot be an `Act`, and the reason is
 * structural rather than awkward:
 *
 *   `layers.applyMove` has the type `(Composition, Move, direction) → Composition`.
 *   A `Composition` is layers, selection, `nextId` and switches. THE JOURNAL IS
 *   NOT IN IT. So no `Move` can reach the journal, and an `Act` — which is a list
 *   of `Move`s — cannot describe a change to the list of acts.
 *
 * That is the same argument `layers.ts` makes about the switches, run the other
 * way: the switches left `Layer` because a `Move` COULD reach them and must not;
 * a journal rewrite cannot be a `Move` because a `Move` CANNOT reach the journal.
 * Making it one would mean giving `applyMove` the session, at which point undo
 * becomes recursive and a rung can contain the stack it lives in.
 *
 * So a frame edit is undone by REVISION: the whole state before the rewrite is
 * remembered, and `undoRevision` puts it back. That is not a weaker promise than
 * an act — it is the strongest one available, because it restores the exact
 * journal rather than an inverse of it — and it is cheap: a `Session` is two
 * pointers into immutable structure, so a revision costs one array of at most
 * `HISTORY_LIMIT` pointers, not a copy of the drawing. `REVISION_LIMIT` says why
 * there are 32 of them.
 *
 * WHAT IS REMEMBERED IS A `Revision` AND NOT A `Session`, and the distinction is
 * a measured data loss rather than a nicety. `nested.ts` keeps the timeline tree
 * BESIDE the journal — for the reason above, run one step further: putting it
 * inside `Session` would put it where a `Move` could reach it — so a `Session`
 * is not the whole of what a rewrite moves. A revision that remembered only the
 * session restored a six-rung journal beside a four-beat tree and silently
 * dropped two gestures from the animation. `Revision` carries both halves, and
 * the key is required so the compiler names every site. See `Revision`.
 *
 * ── THE FLASH MAPPING: what a hold would cost, what a tween could mean ──
 *
 * NOTHING IS BUILT HERE beyond the classification, on the owner's own words
 * ("we don't have motion frames yet"). What follows is what was found.
 *
 * THE PROGRAM IS ALL KEYFRAMES. `animationSteps` drops any gesture that changed
 * nothing visible in the current frame, and `timeline.beatsOf` re-derives the
 * same rule so the playhead can name the act behind a beat. Measured above: three
 * acts, two steps. Flash's IN-BETWEEN FRAME — a frame that holds, showing the
 * same picture as the one before it — is exactly the thing being dropped. So the
 * distinction already exists in the model; it is only ever discarded.
 * `frameKinds` names it: every act is a `"key"` or a `"hold"`.
 *
 * WHAT A HOLD COSTS, if it were ever emitted rather than dropped:
 *
 *   THE CHEAP PART. `AnimationStep` is `{mode, groups}` and a hold is
 *   `{mode: null, groups: []}`. `boundAnimation`'s fold loop iterates groups and
 *   so folds nothing; `animationCensus` adds nothing; `animatedSvg`'s
 *   `spec.steps.forEach` emits an empty `<g class="sK">`. The cycle grows by one
 *   `stepMs`, which is the entire point of a hold.
 *
 *   THE PART THAT IS NOT FREE. `styleBlock` writes `.sK{animation-name:sK}` and a
 *   `@keyframes sK` block for every step, so a hold costs ~60 dead bytes each in
 *   the `orbit` grouping — a rule and a keyframe list for a class no element
 *   carries. Skipping empty steps there is a two-line guard in `replay.ts`.
 *
 *   THE PART THAT IS A BREAKING CHANGE, and it is the reason this is not a
 *   two-line patch. STEP SPACE IS AN INDEX SPACE THAT THREE THINGS ALREADY
 *   SHARE: `emit.EmitLayer.reveal`, `replay.InOut`, and `timeline`'s playhead.
 *   Emitting holds renumbers every beat after the first hold, so a saved in/out
 *   pair or a file's `reveal` written before holds existed names a DIFFERENT beat
 *   after. The honest shapes are (i) a per-render flag that defaults off and is
 *   recorded in the payload, or (ii) `animationSteps` returning the act index
 *   alongside each step — which `timeline.ts` already says out loud it wants
 *   ("the right fix is for `animationSteps` to return the index alongside the
 *   step; that is a change to the model and this module is not allowed to make
 *   it"). Either is a `replay.ts` change and belongs in its own pass.
 *
 * WHAT A TWEEN COULD HONESTLY MEAN ON A DISCRETE CELL PLATE. A tween is a
 * function of a fractional time between two keys, and this plate has exactly two
 * quantities that can take one:
 *
 *   REVEAL ORDER WITHIN ONE STEP — the strong candidate. A step already holds
 *   ordered `groups`, one per brush application, and `animatedSvg` gives the
 *   whole step ONE reveal time. Spreading a step's groups across its own `stepMs`
 *   would make a drag come up in the order the hand made it: honest, because the
 *   order is RECORDED (`StrokeMark.groups` is "in the order they were applied")
 *   and nothing is interpolated — it is a re-timing of facts. It needs no new
 *   data, and it costs one `@keyframes` per group instead of per step.
 *
 *   COLOUR — possible and lossy. `layers.ts` forbids blending outright ("every
 *   colour in this program is `#rrggbb` … an alpha would make the flattened board
 *   hold colours no scheme ever named, so the adjust tool would start inventing
 *   hues"). A colour tween in the FILE is different from one in the model — CSS
 *   can interpolate a fill without the plate ever holding a between-colour — so
 *   it is available, but only as an export-time effect, and it cannot be scrubbed
 *   in the editor without breaking that rule.
 *
 *   POSITION — not available, and this is the honest "no". Flash tweens a
 *   symbol's transform. Here there is no symbol: a stroke is a set of cell
 *   indices and the cells are fixed by the figure. Moving paint would mean
 *   re-running the brush at a new seed, which is a DIFFERENT GESTURE and not an
 *   interpolation of this one. `orbit.ts` could generate the intermediate
 *   gestures, and that is a generator rather than a tween.
 *
 * ── DRILLING IN: how a per-layer or per-gesture timeline composes ───────
 *
 * `focus.ts` is already shaped for this and needs no change. Its `FocusKind`
 * union already carries `"layer"` and `"gesture"`, both declared `masks: false`
 * because "a layer is not a region … it is a sheet you write ON", and a gesture
 * step's id already names a SET rather than one thing.
 *
 * The composition is two INDEPENDENT NARROWINGS, and keeping them independent is
 * the whole of the design:
 *
 *   ACT SPACE narrows by WHO. A per-layer timeline is the journal filtered to the
 *   acts that touched the focused layer — `framesTouching` below, which is the
 *   `focus.layerStep` case — and a per-gesture timeline is the journal filtered
 *   to an explicit set of indices, which is the `focus.gestureStep` case and is
 *   already canonical and already sorted.
 *
 *   STEP SPACE narrows by WHAT IS ON SCREEN. That is the `shown` argument
 *   `animationSteps` and `beatsOf` already take, and it is how a sector view
 *   drops gestures that landed elsewhere.
 *
 * They compose in that order — filter the acts, then take beats of the filtered
 * states — and NEITHER needs to know about the other. The one thing a caller must
 * not do is filter acts and then reuse a beat index computed over the unfiltered
 * journal, which is the same off-by-one `timeline.stepAtAct` exists to prevent.
 *
 * The bridge to `provenance.gestureLayers` is one line and is deliberately not
 * written here: that module mints `${prefix}${k}` where k is the index into
 * `past`, so a `focus.gestureStep` id and a frame index are the same number
 * wearing the module's own prefix. Writing a converter here would be a second
 * place for the prefix to be decided.
 *
 * ── ZERO FLOAT ─────────────────────────────────────────────────────────
 *
 * Array indices, map lookups and string prefixing. Addresses are compared with
 * `plate.covers`, which is `startsWith`. There is no arithmetic here beyond
 * counting and bounds.
 */

import {
  applyMove,
  at as layerAt,
  find,
  gestureOf,
  type Act,
  type Composition,
  type Journal,
  type Layer,
  type LayerGesture,
  type LayerId,
  type Move,
  type MoveGesture,
  type Outcome,
  type Refusal,
  type Refused,
  type Session,
} from "./layers";
import { stepComposition } from "./composer";
// TYPE ONLY, and one type. `nested.ts` imports `type Act` from `layers.ts` and
// nothing else, so this direction cannot close a cycle — and `import type` is
// erased entirely, so it adds no edge to the module graph at runtime either.
// What it buys is that `Revision` can name the thing a revision has to carry
// rather than describing it; see `Revision`.
import type { Timeline } from "./nested";
import { covers, type Address, type AddressPlate, type PlateEdit } from "./plate";
import { HISTORY_LIMIT, mergeEdits, type PaintMap, type Stroke, type StrokeMark } from "./strokes";
import { beatsOf } from "./timeline";

/**
 * `layers.ts` keeps its two `Outcome` constructors private, so they are restated
 * here rather than exported from there.
 *
 * Two lines against widening another module's surface, and the trade is not
 * close: `Refused` and `Outcome<T>` are already exported, the page already
 * renders `said` in its live region, and the alternative — a second refusal type
 * of this module's own — would give one panel two shapes of "no".
 *
 * NOTHING IS ADDED TO `Refusal` EITHER. This module declines for exactly two
 * reasons and the union already spells both: `"empty"` for a range that names no
 * work, and `"unknown-layer"` for a journal that has come apart. Adding a member
 * would make every existing exhaustive switch over `Refusal` — in a file this
 * pass does not own — a compile error somebody else has to answer for.
 */
const no = (why: Refusal, said: string): Refused => ({ ok: false, why, said });
const yes = <T>(value: T): Outcome<T> => ({ ok: true, value });

// ── what a frame is ──────────────────────────────────────────────────────

/**
 * A frame either MOVES the picture or HOLDS it.
 *
 * `"key"` is Flash's keyframe: this act changed at least one cell that is on
 * screen, so the replay shows something happen. `"hold"` is Flash's in-between
 * frame: the act happened — a rename, a reorder, a stroke that landed entirely
 * in a sector this view does not draw, a stroke a rebase reduced to nothing — and
 * the picture does not move.
 *
 * The distinction is the model's already; only its DISPOSAL is the model's. See
 * the header for what emitting a hold would cost.
 */
export type FrameKind = "key" | "hold";

/**
 * Every act classified, in journal order. `states.length - 1` of them.
 *
 * `states` is `composer.everyComposition(comp, past)` flattened onto the book —
 * the same `PaintMap[]` `timeline.beatsOf` and `replay.animationSteps` take, and
 * the same one `page.tsx` already builds for the animated export. `shown` is the
 * frame's own cell list in a sector view and absent for the whole hexagon.
 *
 * IMPLEMENTED BY CALLING `beatsOf` RATHER THAN BY RESTATING ITS PREDICATE, which
 * is a deliberate dependency and not laziness. `timeline.ts` already carries one
 * restatement of `animationSteps`' drop rule and says so at length, with a test
 * pinning the two together; a third copy here would be a third thing to keep in
 * step, and the one this module needs is exactly the one that file computes. A
 * hold is the COMPLEMENT of a beat, so there is nothing left to get wrong.
 */
export function frameKinds(
  states: readonly PaintMap[],
  shown?: readonly number[]
): FrameKind[] {
  const key = new Set(beatsOf(states, shown));
  const out: FrameKind[] = [];
  for (let k = 0; k + 1 < states.length; k++) out.push(key.has(k) ? "key" : "hold");
  return out;
}

/** How many acts hold rather than move. The count a filmstrip would grey. */
export const holdCount = (kinds: readonly FrameKind[]): number =>
  kinds.reduce((n, k) => (k === "hold" ? n + 1 : n), 0);

// ── the rewrite ──────────────────────────────────────────────────────────

/**
 * A splice of the journal: `count` acts at `at`, replaced by `acts`.
 *
 * ONE PRIMITIVE, because every frame edit the request names is one. Replacing a
 * frame is `count: 1` with one act; merging a range is `count: n` with one act;
 * deleting a frame is `count: 1` with none; reordering is `count: n` with the
 * same n acts in a different order. Writing four functions over four shapes
 * would give four places for the rebase to be forgotten.
 *
 * `acts` MAY STATE NONSENSE IN ITS `from` FIELDS and the result is still exact,
 * because the replacement acts are rebased along with the tail: THE REWRITE
 * STATES INTENT AND THE REBASE COMPUTES FACT. The one thing a caller should keep
 * verbatim is a split write's recorded `from` — see `washSource` for what reads
 * it — which is automatic for anything derived from the act it replaces.
 */
export interface Rewrite {
  /** The first act replaced. `0 … past.length`. */
  readonly at: number;
  /** How many acts are replaced. May be 0, which makes this an insertion. */
  readonly count: number;
  /** What takes their place, in order. May be empty, which makes this a delete. */
  readonly acts: readonly Act[];
}

/**
 * What the rebase had to repair, counted rather than described.
 *
 * A rebase is not a lossless operation and a report that said "ok" would be
 * hiding that. Every number here is a place where the journal's RECORD of the
 * past disagreed with the drawing and the record gave way. `page.tsx` can say
 * "23 frames replayed, 4 edits repaired, 1 dropped" in the live region, and a
 * number that is unexpectedly large is the signal that the edit did more than
 * the person meant.
 */
export interface RebaseReport {
  /** Acts replayed after the splice — the replacements and the whole tail. */
  readonly rebased: number;
  /**
   * Recorded before-values that no longer matched and were re-read from the
   * drawing: a `CellEdit.from`, a `rename.from`, a paint's `MoveGesture.from`.
   * All three are the same kind of fact, so they share one count.
   */
  readonly repaired: number;
  /** Edits that became no-ops once repaired, and were dropped by `mergeEdits`. */
  readonly dropped: number;
  /** Split writes whose wash changed colour, retargeted to follow it. */
  readonly retargeted: number;
  /** Split writes whose wash is gone entirely, dropped. */
  readonly orphaned: number;
  /** `place` moves whose frozen node was re-read from the live tree. */
  readonly refrozen: number;
  /**
   * Acts that painted and, after the rebase, paint nothing.
   *
   * Not a defect and not a repair: an act whose every edit became a no-op is a
   * frame that no longer moves the picture — precisely the in-between frame the
   * header discusses. It still occupies act space, still carries its note, and
   * `beatsOf` will simply not give it a beat.
   *
   * A CANDIDATE HOLD AND NOT A VERDICT. This counts cell edits and nothing else,
   * so an act that also reordered a layer is counted here while still changing
   * what the viewer sees, because occlusion moved. `frameKinds` is the authority
   * on key against hold, and it is the authority because it compares the two
   * states rather than the moves between them.
   */
  readonly quiet: number;
  /**
   * Redo entries discarded. A redo branch was recorded against the tail that is
   * being replaced and cannot be replayed onto the new one, which is the same
   * rule `layers.act` and `strokes.commit` already keep. Reported separately
   * because it is the one number a guard should fire on.
   */
  readonly discardedRedo: number;
}

/** A rewritten journal, and the price it paid. */
export interface Rebased {
  readonly session: Session;
  readonly report: RebaseReport;
  /** The acts the splice took out, oldest first. What a caller may re-offer. */
  readonly replaced: readonly Act[];
}

/** A running tally, mutable inside one rebase and frozen into the report. */
interface Tally {
  repaired: number;
  dropped: number;
  retargeted: number;
  orphaned: number;
  refrozen: number;
  quiet: number;
}

const tally = (): Tally => ({
  repaired: 0,
  dropped: 0,
  retargeted: 0,
  orphaned: 0,
  refrozen: 0,
  quiet: 0,
});

/**
 * The journal spliced and the tail rebased. THE ONE ENTRY POINT.
 *
 * REFUSES an out-of-range splice rather than clamping it, which is the opposite
 * of what `replay.clampSpan` does with an out-of-range mark, and the codebase
 * already draws that line: a slider being dragged off the end of its track is an
 * ordinary event, and a statement about which frames to replace is not. A frame
 * index comes from a panel row or a filmstrip cell — if it names nothing, the
 * caller is out of step with the journal and silently editing a different frame
 * is the worst available answer.
 *
 * ATOMIC. The session is rebuilt from the state before `at` and returned whole,
 * or nothing is returned at all. `layers.applyMove` THROWS when a move names a
 * layer or a slot that is not there, deliberately and loudly, and a rebase is
 * exactly the operation that can put it in that position — so the replay is
 * bracketed and a throw becomes a refusal. That is not swallowing an error: the
 * error is reported as the counted precondition it is, with the drawing
 * untouched, rather than as a stack trace over a half-applied journal.
 *
 * THE BASE IS INVARIANT, which is what makes this safe. The state before act
 * `at` is reached by `composer.stepComposition` walking the live composition
 * backwards, exactly as the rewind preview does, and no rewrite can touch it
 * because a rewrite only ever replaces acts at `at` or later. So the drawing this
 * builds on is the one the person already saw when they scrubbed there.
 */
export function rewriteFrames(
  session: Session,
  plan: Rewrite
): Outcome<Rebased> {
  const past = session.journal.past;
  const { at, count } = plan;
  if (!Number.isInteger(at) || at < 0 || at > past.length) {
    return no("empty", `there is no frame ${at} — the drawing has ${past.length}`);
  }
  if (!Number.isInteger(count) || count < 0 || at + count > past.length) {
    return no(
      "empty",
      `frames ${at} to ${at + count - 1} run past the end of the drawing`
    );
  }
  if (count === 0 && plan.acts.length === 0) {
    return no("empty", "that names no frames — there is nothing to change");
  }

  const t = tally();
  const base = stepComposition(session.composition, past, past.length, at);
  const replay = [...plan.acts, ...past.slice(at + count)];
  const out: Act[] = past.slice(0, at);
  let comp = base;

  try {
    for (const a of replay) {
      const step = rebaseAct(comp, a, t);
      if (!step.ok) return step;
      out.push(step.value.act);
      comp = step.value.comp;
    }
  } catch (e) {
    /**
     * NARROWED, because the two things this used to catch are not one thing.
     *
     * `insertAt` and `removeAt` throw on a path that names no slot, which is
     * reachable here: a rewrite that adds or removes a STRUCTURAL act moves every
     * later `place` path. That is a fact about the journal, `"unknown-layer"` is
     * the right word for it, and the message is carried through so the live
     * region says what actually happened.
     *
     * A `TypeError` out of a defect in `applyMove` is not that. It used to arrive
     * at the person wearing the same label and the same opening clause — a claim
     * about THEIR drawing for a fault in THIS program — and `"unknown-layer"` is
     * the counter a guard would fire on, so the lie was also arithmetic.
     *
     * TOLD APART BY THE PREFIX `layers.ts` puts on every throw it means. That is
     * a string test and it is the honest one available: the alternative is a
     * custom error class exported from `layers.ts` for one consumer, which is the
     * widening that module already declined for `yes`/`no`. If the prefix is ever
     * dropped the failure is loud in the safe direction — a real precondition
     * reported as a defect, which is a sentence somebody reads and fixes.
     */
    const known = e instanceof Error && e.message.startsWith("layers: ");
    const said = e instanceof Error ? e.message : String(e);
    return known
      ? no("unknown-layer", `that edit cannot be replayed onto the later frames — ${said}`)
      : no(
          "defect",
          `the rewrite could not be completed and the drawing is untouched — this is a fault in the program, not in your drawing: ${said}`
        );
  }

  /**
   * PAST `HISTORY_LIMIT` IS A REFUSAL, and it used to be a silent trim.
   *
   * ── What the trim actually cost, which was not the dropped rung ────────
   *
   * `out.slice(out.length - HISTORY_LIMIT)` drops m acts off the FRONT, so every
   * act index moves by m. `remember`'s docstring hands a direct caller of this
   * function the rule for keeping the timeline in step — "a delete takes the tree
   * to `rebaseTree(tl, at, count, 0)`" — and that rule is stated in the index
   * space of a journal that kept its front. Follow it after a trim and the tree
   * is misaligned against the journal by exactly m: the same tree/journal desync
   * `Revision` was built to close, arriving through a door nobody was watching.
   *
   * ── Refused rather than counted, and the choice is not close ───────────
   *
   * `RebaseReport` has a field for every other cost and a `trimmed` field would
   * have been a seventh. But a count only NAMES the shift; the caller still has
   * to correct for it, in a second rule it has to remember, at the one call site
   * where getting it wrong is invisible. Refusing removes the shift instead of
   * describing it, and it is the stance this function opens with: it "REFUSES an
   * out-of-range splice rather than clamping it", because "a statement about
   * which frames to replace" is not a slider being dragged off its track. A
   * splice that overruns the journal's own limit is that same statement one level
   * in, and it gets the same answer.
   *
   * THE LIMIT IS STILL KEPT, by never building the journal rather than by cutting
   * one. `layers.act` still trims, on its own terms, where the front moving costs
   * nothing because no tree is addressed against it.
   *
   * UNREACHABLE FROM THE UI TODAY, measured rather than assumed: this needs
   * `past.length - count + plan.acts.length > HISTORY_LIMIT`, and `past.length`
   * is already capped at `HISTORY_LIMIT` by `layers.act`, so it needs
   * `plan.acts.length > count`. `editFrame` replaces one act with one and
   * `mergeFrames` folds n into one — neither grows the journal. It is here
   * because this is "THE ONE ENTRY POINT" and `acts` is a free-form array.
   */
  if (out.length > HISTORY_LIMIT) {
    return no(
      "empty",
      `that rewrite would leave ${out.length} frames and a drawing holds ${HISTORY_LIMIT} — the oldest would be dropped and every later frame would be renumbered under the timeline. Merge frames first`
    );
  }
  const journal: Journal = { past: out, future: [] };

  return yes({
    session: { composition: reseat(comp), journal },
    report: {
      rebased: replay.length,
      repaired: t.repaired,
      dropped: t.dropped,
      retargeted: t.retargeted,
      orphaned: t.orphaned,
      refrozen: t.refrozen,
      quiet: t.quiet,
      discardedRedo: session.journal.future.length,
    },
    replaced: past.slice(at, at + count),
  });
}

/**
 * The selection brought back inside the document.
 *
 * `layers.reseat` is private and this is the same two lines: the only invariant
 * `selected` has is that it names a layer that exists or is null. Restated rather
 * than exported because widening `layers.ts` for two lines is the trade this
 * module already declined for `yes`/`no`.
 *
 * ONCE, AT THE END, where `layers.applyAct` does it after every act. The
 * difference is observable in exactly one shape — a layer removed by one act and
 * re-inserted by a later one, where the per-act rule nulls the selection at the
 * removal and this one does not — and this is the better answer for a rebase: the
 * person's selection was valid before the rewrite and is valid after it, and
 * clearing it because of an act in the middle of a replay they did not perform
 * would be the rewrite reaching into a fact about the person.
 */
function reseat(comp: Composition): Composition {
  if (comp.selected === null) return comp;
  return find(comp, comp.selected) === null ? { ...comp, selected: null } : comp;
}

/** One act replayed against the drawing as it now stands. */
function rebaseAct(
  comp: Composition,
  act: Act,
  t: Tally
): Outcome<{ act: Act; comp: Composition }> {
  const moves: Move[] = [];
  /**
   * Nodes re-frozen by a `remove` earlier in THIS act, keyed by id.
   *
   * `layers.arrange` and `layers.moveLayer` both emit `[remove, insert]` carrying
   * THE SAME `Layer` OBJECT, so re-reading the removal from the live tree and
   * leaving the insertion on the stale one would move a layer and blank its
   * plate in the same act. Scoped to the act because that is the scope the pair
   * is built in.
   */
  const frozen = new Map<LayerId, Layer>();
  let out = comp;
  let cells = 0;

  for (const m of act.moves) {
    switch (m.kind) {
      case "paint": {
        const layer = find(out, m.layer);
        if (layer === null) {
          return no(
            "unknown-layer",
            `frame "${act.note}" paints into a layer the drawing no longer has`
          );
        }
        const edits = rebaseEdits(layer.plate, m.stroke.edits, t);
        cells += edits.length;
        // The MARK RIDES THROUGH UNTOUCHED. It records the symmetry the brush was
        // held at and the addresses it stamped — facts about the gesture, which a
        // rebase cannot have changed. See the header.
        const stroke: Stroke<Address> =
          m.stroke.mark === undefined ? { edits } : { edits, mark: m.stroke.mark };
        const move: Move = {
          kind: "paint",
          layer: m.layer,
          stroke,
          gesture: rebaseGesture(layer, m.gesture, t),
        };
        moves.push(move);
        out = applyMove(out, move, "do");
        break;
      }
      case "rename": {
        const layer = find(out, m.layer);
        if (layer === null) {
          return no(
            "unknown-layer",
            `frame "${act.note}" renames a layer the drawing no longer has`
          );
        }
        // The same repair as a `CellEdit.from`, and the same reason: `applyMove`
        // writes `move.from` going backwards, so a stale one renames the layer to
        // a name it never had. Reachable whenever the rewritten act was itself a
        // rename of the same layer.
        const move: Move =
          layer.name === m.from
            ? m
            : { kind: "rename", layer: m.layer, from: layer.name, to: m.to };
        if (move !== m) t.repaired += 1;
        moves.push(move);
        out = applyMove(out, move, "do");
        break;
      }
      case "place": {
        let move: Move = m;
        if (m.op === "remove") {
          const live = find(out, m.node.id);
          if (live === null) {
            return no(
              "unknown-layer",
              `frame "${act.note}" moves a layer the drawing no longer has`
            );
          }
          /**
           * THE PATH IS CHECKED, NOT ONLY THE ID — and the two are different
           * questions.
           *
           * `find` asks "does this id exist ANYWHERE", and that guard passed
           * while `applyMove` went on to use the RECORDED path `m.at`. A rewrite
           * that changes the number of STRUCTURAL acts moves every later path by
           * exactly the shift, so the recorded path names a different layer — and
           * `removeAt` removed that one instead, silently.
           *
           * Measured before the fix: `rewriteFrames(s, { at: 3, count: 1, acts:
           * [] })` on a journal ending in an `arrange` returned `ok: true` with
           * `{rebased: 1, repaired: 0, refrozen: 0}` and a composition of `[L2,
           * L2, L3]` — a DUPLICATE `LayerId` with `L1` gone. That is precisely
           * the "drawing has come apart" state `layers.census.duplicateIds`
           * exists to detect, produced by this module and reported as success.
           *
           * REFUSED rather than repaired, and the choice is not close. Repairing
           * would mean re-deriving the path with `pathOf` and hoping the intent
           * was "this layer" rather than "this slot" — but a `place` pair is
           * `[remove, insert]` and the insert's path is recorded against the tree
           * as it stood BETWEEN them, so re-deriving one and not the other builds
           * a tree neither of them describes. `rewriteFrames` is documented as
           * refusing an out-of-range splice rather than clamping it; a splice
           * whose paths no longer name what they were recorded against is the
           * same fact one level in, and it gets the same answer.
           *
           * Latent from the UI today — `editFrame` replaces one act with one and
           * `mergeFrames` folds n into one, and neither changes how many
           * structural acts precede the tail — so this fires for no gesture a
           * person can currently make. It is here because `rewriteFrames` is
           * "THE ONE ENTRY POINT" with a free-form `acts` array, and the failure
           * it admits is unrecoverable and silent.
           */
          if (layerAt(out, m.at)?.id !== m.node.id) {
            return no(
              "unknown-layer",
              `frame "${act.note}" moves a layer from a place the drawing no longer keeps it — the rewrite shifted the tree under it`
            );
          }
          if (live !== m.node) {
            t.refrozen += 1;
            move = { kind: "place", op: "remove", at: m.at, node: live };
          }
          frozen.set(m.node.id, live);
        } else {
          // An `insert` with no matching `remove` in this act is an ADD or a
          // PASTE: its node was built at the time, from a fresh id or from the
          // clipboard, and never came off the live tree — so there is nothing to
          // re-read and the recorded node is already the right one.
          const live = frozen.get(m.node.id);
          if (live !== undefined && live !== m.node) {
            t.refrozen += 1;
            move = { kind: "place", op: "insert", at: m.at, node: live };
          }
        }
        moves.push(move);
        out = applyMove(out, move, "do");
        break;
      }
    }
  }

  if (cells === 0 && moves.some((m) => m.kind === "paint")) t.quiet += 1;
  return yes({ act: { moves, note: act.note, events: act.events }, comp: out });
}

/**
 * One stroke's edits, re-read against the plate they will actually land on.
 *
 * Three passes' worth of work in one loop, in this order and no other:
 *
 *   1. SPLIT WRITES FIRST, because they are identified by the RECORDED `from` of
 *      the wash they came from, and step 2 overwrites exactly that field.
 *   2. `from` RE-READ from the live plate.
 *   3. no-ops dropped, by `mergeEdits`, which also restores the ascending order
 *      the codebase promises a stroke's edits are in.
 *
 * The plate is read ONCE, before any of it is applied, and that is correct rather
 * than convenient: `mergeEdits` guarantees a stroke names each cell at most once,
 * so no edit in a stroke can see another's effect, and `applyEdits` writes them
 * as a set.
 */
function rebaseEdits(
  plate: AddressPlate,
  edits: readonly PlateEdit[],
  t: Tally
): PlateEdit[] {
  // Every address this stroke DELETES, and the colour it records deleting. These
  // are the possible sources of a split write. Built even when there are none,
  // which is one pass over a list that is about to be walked anyway.
  const washed = new Map<Address, string>();
  for (const e of edits) if (e.to === null && e.from !== null) washed.set(e.cell, e.from);

  const out: PlateEdit[] = [];
  for (const e of edits) {
    let to = e.to;
    if (washed.size > 0 && e.from === null && e.to !== null) {
      const source = washSource(washed, e.cell, e.to);
      if (source !== null) {
        const live = plate.get(source) ?? null;
        if (live === null) {
          // The wash this write was preserving is not there any more, so there is
          // no colour to keep around the hole. Dropping is the only honest
          // answer: writing the recorded colour would paint a region a colour
          // nothing in the drawing claims.
          t.orphaned += 1;
          continue;
        }
        if (live !== to) {
          t.retargeted += 1;
          to = live;
        }
      }
    }
    const from = plate.get(e.cell) ?? null;
    if (from !== e.from) t.repaired += 1;
    out.push({ cell: e.cell, from, to });
  }

  const merged = mergeEdits<Address>([], out);
  t.dropped += out.length - merged.length;
  return merged;
}

/**
 * The wash a repaint was preserving, or `null` if it was not preserving one.
 *
 * ── What a split write IS, measured ─────────────────────────────────────
 *
 * `plate.planPlateEdits` cannot erase inside a coarse wash by deleting an
 * address, because the address holds no paint of its own — the colour is
 * INHERITED. So `splitEdits` deletes the wash and repaints every sibling region
 * it covered. Measured on a depth-2 hexagon: wash `s0:A` gold, erase `s0:AB`,
 * and the stroke is
 *
 *   {s0:A, gold→null} {s0:AA, null→gold} {s0:AC, null→gold} {s0:AX, null→gold}
 *
 * The three repaints are DERIVED DATA: their `to` was copied from the wash's
 * colour at plan time. Rewriting the wash to red and replaying naively leaves the
 * plate holding gold in all three, with the red gone and no `from` field
 * mismatched anywhere — because `null` really is still what those three
 * addresses hold. That is the one conflict a `from` check cannot see.
 *
 * ── The signature, and why it cannot false-positive into damage ─────────
 *
 * A write is a split write when it lays down a colour on an address that held
 * nothing, and some PROPER ANCESTOR of that address is deleted by the same
 * stroke, and the deleted ancestor's recorded colour is the colour being laid
 * down. The nearest such ancestor wins, because `splitEdits` walks down from one
 * wash and a nested pair is a nested pair.
 *
 * A hand-made stroke can match this: erase `s0:A` and paint `s0:AA` the same
 * colour in one gesture. Retargeting that one is still correct, because it means
 * the same thing — the person removed a region and kept part of it — and the
 * "part they kept" is the colour the region actually has.
 *
 * Exact string prefixing via `plate.covers`, no arithmetic, and the wash map is
 * the handful of addresses one stroke deletes.
 */
function washSource(
  washed: ReadonlyMap<Address, string>,
  cell: Address,
  colour: string
): Address | null {
  let best: Address | null = null;
  for (const [a, was] of washed) {
    if (was !== colour) continue;
    if (a.length >= cell.length || !covers(a, cell)) continue;
    if (best === null || a.length > best.length) best = a;
  }
  return best;
}

/**
 * A paint's `MoveGesture`, with its `from` side re-read off the live layer.
 *
 * The same fact as a `CellEdit.from` and the same failure if it is left alone:
 * `applyMove` writes `move.gesture.from` back onto the layer going backwards, so
 * a stale one restores a `mode`/`orbit` pair the layer never carried at that
 * point. Reachable as soon as a rewritten act changes what the layer's gesture
 * was when the later act ran.
 *
 * `to` IS LEFT ALONE. It is what the act CLAIMS to leave behind — the intent side
 * — and an ordinary paint states none, which is what makes a paint strip the
 * gesture it invalidated. Only the record moves.
 *
 * Absent stays absent: an empty `LayerGesture` is spelled by leaving `from` off,
 * exactly as `layers.NO_GESTURE` does, so a layer with no gesture yields a move
 * with no key rather than one holding an empty object.
 *
 * ── "NO GESTURE" HAS TWO SPELLINGS AND THEY MUST COMPARE EQUAL ─────────
 *
 * That paragraph above describes what this function PRODUCES, and the defect was
 * that it did not describe what it CONSUMES. `page.tsx` writes every paint as
 * `gesture: { from: gestureOf(into) }`, and `gestureOf` returns `{}` for an
 * ordinary layer — so the journal this program actually produces holds `from:
 * {}` where this function's own output would have held nothing at all.
 * `sameGesture({}, undefined)` is false, so `repaired += 1` fired on EVERY PAINT
 * FRAME OF EVERY REBASE, and `repaired` is the number `RebaseReport` exists to
 * surface: "a number that is unexpectedly large is the signal that the edit did
 * more than the person meant". It was unexpectedly large on every edit.
 *
 * The tests could not see it because `test/frames.test.ts` builds its moves with
 * `NO_GESTURE`, which is `{ from: undefined }` — the shape this function emits,
 * not the shape the app writes. So both sides agreed, and neither was the
 * program.
 *
 * NORMALISED ON BOTH SIDES rather than fixed on one. `sameGesture` stays a plain
 * structural equality — it is worth keeping something in this file that means
 * exactly what it says — and `settled` is applied to the recorded side and the
 * live side alike, so the comparison is between two canonical values. Fixing only
 * the producer would have left every journal already in a `Revision` still
 * miscounting.
 */
const settled = (g: LayerGesture | undefined): LayerGesture | undefined =>
  g === undefined || isEmptyGesture(g) ? undefined : g;

function rebaseGesture(layer: Layer, was: MoveGesture, t: Tally): MoveGesture {
  const want = settled(gestureOf(layer));
  if (sameGesture(settled(was.from), want)) return was;
  t.repaired += 1;
  return was.to === undefined ? { from: want } : { from: want, to: was.to };
}

const isEmptyGesture = (g: LayerGesture): boolean =>
  g.reveal === undefined && g.mode === undefined && g.orbit === undefined;

const sameGesture = (
  a: LayerGesture | undefined,
  b: LayerGesture | undefined
): boolean => {
  if (a === undefined || b === undefined) return a === b;
  return a.reveal === b.reveal && a.mode === b.mode && a.orbit === b.orbit;
};

// ── editing one frame ────────────────────────────────────────────────────

/**
 * Frame `at`, rewritten by `edit`, with everything after it replayed on top.
 *
 * The rewriter is a FUNCTION rather than a value because there is no one edit a
 * person wants to make to a past frame — recolour it, restrict it, re-mark it —
 * and a model that enumerated them would be a list to extend rather than a
 * mechanism. `recolourAct` is the one worked example, because it is the case the
 * request actually names: the same gesture, a different colour, so the animation
 * changes and the drawing may not.
 *
 * ── The consequence to expect, measured ─────────────────────────────────
 *
 * If a later act repaints the same cell, editing this one changes the ANIMATION
 * and NOT the finished drawing. Act 0 paints `s0:AA` gold, act 2 paints it red;
 * rewrite act 0 to blue and the final plate is still red, because `applyEdits`
 * writes `to` and never consults `from`. That is not a limitation to work
 * around — it is exactly what "in case I want a particular animation" asks for,
 * and `test/frames.test.ts` asserts it rather than describing it.
 */
export function editFrame(
  session: Session,
  at: number,
  edit: (act: Act) => Act
): Outcome<Rebased> {
  const past = session.journal.past;
  if (!Number.isInteger(at) || at < 0 || at >= past.length) {
    return no("empty", `there is no frame ${at} — the drawing has ${past.length}`);
  }
  return rewriteFrames(session, { at, count: 1, acts: [edit(past[at])] });
}

/**
 * An act with every colour it LAYS DOWN passed through `f`.
 *
 * `to: null` is an erase and is left alone — an erase has no colour to change,
 * and `strokes.ts` is explicit that "`null` is a colour" only in the sense that
 * it means unpainted. `from` is left alone too, and does not need touching: the
 * rebase re-reads it. So this states intent and nothing else, which is what
 * `Rewrite` asks of a caller.
 *
 * `f` MAY RETURN `null`, which turns a paint into an erase. That is a real thing
 * to want from a frame edit — "this stroke should not have been there" — and it
 * costs nothing to allow, because the rebase's no-op drop then removes any edit
 * that erases a cell nothing had painted.
 *
 * The MARK is carried through. Recolouring does not change which cells the brush
 * reached or the symmetry it was held at, so the mark still describes the
 * gesture exactly.
 */
export function recolourAct(
  act: Act,
  f: (colour: string) => string | null
): Act {
  const moves = act.moves.map((m): Move => {
    if (m.kind !== "paint") return m;
    const edits = m.stroke.edits.map(
      (e): PlateEdit => (e.to === null ? e : { cell: e.cell, from: e.from, to: f(e.to) })
    );
    const stroke: Stroke<Address> =
      m.stroke.mark === undefined ? { edits } : { edits, mark: m.stroke.mark };
    return { kind: "paint", layer: m.layer, stroke, gesture: m.gesture };
  });
  return { moves, note: act.note, events: act.events };
}

// ── merging a range ──────────────────────────────────────────────────────

/**
 * What a merge actually did, so the panel can say it rather than assume it.
 *
 * The interesting number is `modes`. A merged frame's `StrokeMark` can only carry
 * ONE brush symmetry — `StrokeMark.mode` is a single number — so a range made at
 * two different modes has no honest mark, and this is where that is reported
 * instead of being silently absorbed.
 */
export interface MergeReport {
  /** How many frames went in. */
  readonly frames: number;
  /** How many moves the merged act holds. */
  readonly moves: number;
  /** Paint moves folded into a predecessor on the same layer. */
  readonly coalesced: number;
  /** Recorded symmetry groups the merged mark carries. Zero when it has no mark. */
  readonly groups: number;
  /**
   * The distinct brush modes the RANGE was made at, ascending.
   *
   * Read off what went in rather than off what came out, because a disagreement
   * is exactly what the fold destroys. More than one entry with `marked: false`
   * is the case the panel has to be able to describe. See `mergeActs`.
   */
  readonly modes: readonly number[];
  /**
   * Whether the merged act carries a mark at all.
   *
   * False when the range held no mark, and false when it held two that disagree.
   * The panel should say which; `modes.length` tells it.
   */
  readonly marked: boolean;
}

/**
 * A range of acts as ONE act.
 *
 * ── Concatenate, then coalesce. Nothing is recomputed ───────────────────
 *
 * The merged act's moves are the range's moves IN ORDER, with consecutive paint
 * moves on the SAME LAYER folded together by `mergeEdits`. That fold is exact
 * rather than approximate, and the check is two lines: `mergeEdits` keeps the
 * first edit's `from` and the last edit's `to`, so applying the merged stroke
 * forwards lands where applying both landed, and `applyAct` running the moves
 * backwards restores the first `from`, which is where the pair started. A cell
 * painted and painted back cancels and is dropped — which is the same thing the
 * two strokes did in sequence, one step later.
 *
 * ONLY CONSECUTIVE ONES. Two paints into the same layer with a `place` between
 * them are not folded, because the placement may have moved the layer out of the
 * tree and back and the fold would jump the moves past each other. Structural
 * moves are carried through in their original order and are never coalesced.
 *
 * ── The mark, which is the part that could have lied ────────────────────
 *
 * `provenance.ts` already argues the rule this follows: a layer that answered
 * `mode: 1` for a gesture that recorded no symmetry "would be indistinguishable
 * from a genuine one-fold stroke — which is a different statement, and a false
 * one". So:
 *
 *   ALL MARKS AGREE ON `mode` → one mark, that mode, with every group
 *   CONCATENATED in stroke order. This is the shape the codebase already has:
 *   `StrokeMark.groups` is "one entry per orbit or image band the gesture
 *   applied, in stroke order", a drag already produces many, and the multi-seed
 *   propose commit already produces one rung with many groups. A merged frame is
 *   a longer drag.
 *
 *   SOME STROKES ARE UNMARKED → the marked ones' groups are kept as they are. The
 *   unmarked cells belong to no group, `replay.markLookup` answers −1 for them,
 *   and `animationSteps` puts them in the REMAINDER group it already has for
 *   exactly this. Nothing is invented and nothing is lost.
 *
 *   MODES DISAGREE → NO MARK AT ALL. There is no single number that is true of
 *   the range, `mode` is not optional inside a `StrokeMark`, and picking the
 *   first would claim the whole merged gesture was made at a symmetry half of it
 *   was not. An absent mark is the codebase's existing spelling for "a real
 *   gesture with no symmetry to claim", so this states the truth in a vocabulary
 *   the animation and the exporter already read. `MergeReport.modes` carries what
 *   was given up so the panel can say so.
 *
 * `events` are SUMMED, because the colour progression counts what was spent and
 * merging two frames does not refund a colour. `note` is the caller's.
 */
export function mergeActs(
  acts: readonly Act[],
  note: string
): { act: Act; report: MergeReport } {
  const moves: Move[] = [];
  let coalesced = 0;
  let events = 0;
  /**
   * READ OFF THE INPUT, NOT OFF THE RESULT, and the first version read the
   * result — which could not work and is worth writing down because it looks
   * right. `foldMarks` DISCARDS both marks when their modes disagree, so by the
   * time the merged moves exist the disagreement has already been erased and the
   * set comes back empty. The report's whole job in the disagreeing case is to
   * name what was given up, and a count taken after the giving-up names nothing.
   * Measured: two frames at modes 6 and 3 reported `modes: []`.
   *
   * So the two halves of the report have two sources, deliberately: `modes` is a
   * fact about the RANGE and is collected as it goes in, while `groups` and
   * `marked` are facts about the MERGED ACT and are read off it afterwards.
   */
  const modes = new Set<number>();
  /**
   * WHICH SLOTS OF `moves` HAVE ALREADY GIVEN THE MARK UP — and why the set has
   * to exist outside the stroke.
   *
   * `foldMarks` says "no honest mark" by answering `undefined`, and a stroke has
   * no other spelling for it: `Stroke.mark` is present or absent, and absent also
   * means "this gesture recorded no symmetry". So the deliberate discard, once
   * written into a stroke, is indistinguishable from never having had one — and
   * the very next fold read it as "unmarked" and ADOPTED THE NEXT MARK WHOLE.
   *
   * Measured: merging three frames at modes 6, 3, 6 gave `{mode: 6, groups: […one
   * …]}` with `marked: true`, so `mergeSaid` printed "the merged mark keeps 1
   * symmetry group at the 6-fold brush" while two of the three recorded marks had
   * been destroyed — and because `marked` gates it, the MODES DISAGREE sentence,
   * which exists for exactly this range, never fired. The two-frame case is
   * correct, which is why it took a third frame agreeing with the first to see
   * it. REACHABLE FROM THE MERGE BUTTON.
   *
   * A set of indices rather than a sentinel mark: the alternative is a
   * distinguished `StrokeMark` value carried through `Stroke` and out into
   * `layers.ts`, the file format and the undo stack, to say something that is only
   * true for the length of this loop.
   *
   * STICKY, deliberately. Once two frames in one coalesced run disagree, no mode
   * is a true statement about the run, and a later frame agreeing with one of them
   * does not make it true again. That is the same judgement the two-frame case
   * already makes; this only stops it being forgotten on the third.
   */
  const gaveUp = new Set<number>();

  for (const a of acts) {
    events += a.events;
    for (const m of a.moves) {
      if (m.kind === "paint" && m.stroke.mark !== undefined) {
        modes.add(m.stroke.mark.mode);
      }
      const prev = moves[moves.length - 1];
      if (
        m.kind === "paint" &&
        prev !== undefined &&
        prev.kind === "paint" &&
        prev.layer === m.layer
      ) {
        const k = moves.length - 1;
        const folded = foldPaint(prev, m, gaveUp.has(k));
        moves[k] = folded.move;
        if (folded.gaveUp) gaveUp.add(k);
        coalesced += 1;
        continue;
      }
      moves.push(m);
    }
  }

  let groups = 0;
  let marked = false;
  for (const m of moves) {
    if (m.kind !== "paint" || m.stroke.mark === undefined) continue;
    marked = true;
    groups += m.stroke.mark.groups.length;
  }

  return {
    act: { moves, note, events },
    report: {
      frames: acts.length,
      moves: moves.length,
      coalesced,
      groups: marked ? groups : 0,
      modes: [...modes].sort((x, y) => x - y),
      marked,
    },
  };
}

/**
 * Two consecutive paints on one layer, as one. See `mergeActs`.
 *
 * `gaveUp` in and `gaveUp` out because the mark fold is NOT associative on its
 * own — `mergeActs` holds the flag and its header carries the measurement.
 */
function foldPaint(
  a: Extract<Move, { kind: "paint" }>,
  b: Extract<Move, { kind: "paint" }>,
  gaveUp: boolean
): { move: Move; gaveUp: boolean } {
  const edits = mergeEdits<Address>(a.stroke.edits, b.stroke.edits);
  const folded = foldMarks(a.stroke.mark, b.stroke.mark, gaveUp);
  const mark = folded.mark;
  const stroke: Stroke<Address> = mark === undefined ? { edits } : { edits, mark };
  // The SAME `{from, to}` composition `mergeEdits` performs on the cells, one
  // level up: the pair straddles the fold, so the merged move destroyed whatever
  // the first found and leaves whatever the second left. `layers.MoveGesture`
  // argues at length that the pair must invert as one gesture; folding it any
  // other way would put the two halves in different directions.
  const gesture: MoveGesture = {
    ...(a.gesture.from === undefined ? {} : { from: a.gesture.from }),
    ...(b.gesture.to === undefined ? {} : { to: b.gesture.to }),
  };
  return {
    move: { kind: "paint", layer: a.layer, stroke, gesture },
    gaveUp: folded.gaveUp,
  };
}

/**
 * Two marks as one, or none when they cannot honestly be one. See `mergeActs`.
 *
 * THREE ANSWERS AND NOT TWO, which is the whole of the fix. "No mark" and "a mark
 * given up" are the same value in a `Stroke` and are different facts here: the
 * first may absorb the next mark, the second may not, and the second must stay
 * given up for the rest of the run. `given` carries the second state in, `gaveUp`
 * carries it out, and `mergeActs` is the one place it is kept.
 */
function foldMarks(
  a: StrokeMark<Address> | undefined,
  b: StrokeMark<Address> | undefined,
  given: boolean
): { mark?: StrokeMark<Address>; gaveUp: boolean } {
  // ALREADY GIVEN UP, and it stays that way. Reading `a.stroke.mark` here would
  // read `undefined` and adopt `b` whole, which is the defect.
  if (given) return { gaveUp: true };
  if (a === undefined) return b === undefined ? { gaveUp: false } : { mark: b, gaveUp: false };
  if (b === undefined) return { mark: a, gaveUp: false };
  if (a.mode !== b.mode) return { gaveUp: true };
  return { mark: { mode: a.mode, groups: [...a.groups, ...b.groups] }, gaveUp: false };
}

/**
 * Frames `at … at+count-1` coalesced into one, with the tail rebased on top.
 *
 * REFUSES a range of fewer than two, because merging one frame is a no-op that
 * would still discard the redo branch and still count as a revision — a control
 * that appears to work and quietly costs something is worse than one that says
 * no. `count` is checked here rather than left to `rewriteFrames`, so the
 * sentence names the real problem.
 *
 * The merged frame is the SAME WORK IN ONE RUNG: the plate it produces is the
 * plate the range produced, cell for cell, because `mergeActs` only concatenates
 * and folds. What changes is the animation — the range's several beats become
 * one — which is what "merge them into one frame" means.
 */
export function mergeFrames(
  session: Session,
  at: number,
  count: number,
  note?: string
): Outcome<Merged> {
  const past = session.journal.past;
  if (!Number.isInteger(at) || at < 0 || at >= past.length) {
    return no("empty", `there is no frame ${at} — the drawing has ${past.length}`);
  }
  if (!Number.isInteger(count) || count < 2) {
    return no("empty", "a merge needs at least two frames");
  }
  if (at + count > past.length) {
    return no(
      "empty",
      `frames ${at} to ${at + count - 1} run past the end of the drawing`
    );
  }
  const range = past.slice(at, at + count);
  const merged = mergeActs(range, note ?? `merged ${count} frames`);
  const done = rewriteFrames(session, { at, count, acts: [merged.act] });
  if (!done.ok) return done;
  return yes({ ...done.value, merge: merged.report });
}

/** A merge is a rewrite that also has something to say about the mark. */
export interface Merged extends Rebased {
  readonly merge: MergeReport;
}

// ── revisions: taking a frame edit back ──────────────────────────────────

/**
 * EVERYTHING A REWRITE CAN MOVE, in one value: the session, and the timeline
 * tree that lives beside its journal.
 *
 * ── Why the tree is here, measured ──────────────────────────────────────
 *
 * `nested.ts` keeps the timeline tree BESIDE `Journal.past` rather than inside
 * `Session`, on this file's own argument run one step further: a `Move` cannot
 * reach the journal, and putting the tree inside a `Session` would put it
 * somewhere a `Move` could reach, at which point undo becomes recursive. That
 * decision is correct and it is not revisited here — but it makes the tree a
 * SECOND thing that a rewrite moves, and a revision that remembered only the
 * first was a silent loss rather than an incomplete undo.
 *
 * MEASURED, on six gestures with a beat each. Merge frames 3, 4 and 5 into one:
 * the journal goes to four rungs and `nested.rebaseTree` takes the tree to four
 * beats. Undo the revision, and the journal came back at six while the caller
 * was still holding the four-beat tree — so gestures 4 and 5 had no beat, and
 * TWO GESTURES THE PERSON DREW STOPPED APPEARING IN THE ANIMATION with nothing
 * anywhere reporting a problem. `test/frames.test.ts` reproduces exactly that
 * and now asserts the repair.
 *
 * ── Why the key is REQUIRED and the value is nullable ───────────────────
 *
 * `timeline?: Timeline` would have been the smaller diff and it is the same
 * defect wearing a default: a caller that forgot the tree on one of the four
 * paths — `remember`, `undoRevision`, `redoRevision`, or the live value handed
 * to either — would silently get `undefined` and lose it again. This is
 * `layers.MoveGesture`'s rule verbatim, and that comment says why it is a rule:
 * "REQUIRED on the move rather than optional … `was` was optional, three
 * consumers existed, and the third … simply did not mention it and nothing said
 * so. Required, the compiler names every construction site the day a fourth
 * appears."
 *
 * `null` is therefore a CLAIM — "this document has no nested timeline" — and
 * never an omission, exactly as `layers.NO_GESTURE` is.
 */
export interface Revision {
  readonly session: Session;
  /**
   * The nested timeline as it stood beside that journal, or `null` for a
   * document that has none. `nested.Timeline`.
   */
  readonly timeline: Timeline | null;
}

/**
 * The timeline's own past: whole revisions, remembered before a rewrite.
 *
 * A SECOND UNDO AXIS, and the header argues why it has to be one rather than a
 * rung of the first. In short: a `Move` acts on a `Composition`, the journal is
 * not in a `Composition`, so no `Act` can describe a change to the list of acts.
 *
 * It is the STRONGEST form of undo in the program, not the weakest: the other two
 * stacks store inverses and replay them, while this stores the thing itself. A
 * revision cannot drift from what it restores, because it IS what it restores —
 * and that promise is only true of a value that holds EVERY part of what it
 * restores, which is why `Revision` and not `Session` is what is stacked here.
 *
 * The cost is a pointer array. Every `Act`, `Layer`, `Map` and timeline `Step` in
 * this codebase is immutable and shared, so remembering a revision copies `past`
 * — at most `HISTORY_LIMIT` references — and pins two trees that are already
 * alive.
 */
export interface Revisions {
  readonly past: readonly Revision[];
  readonly future: readonly Revision[];
}

export const NO_REVISIONS: Revisions = { past: [], future: [] };

/**
 * How many frame edits are held.
 *
 * Far shorter than `HISTORY_LIMIT`, and for a different reason. That limit is
 * about a promise — past 256 gestures the undo stack is no longer something a
 * person is tracking. This one is about WEIGHT: each revision pins a whole
 * journal array — and now a whole timeline tree — alive, so an unbounded stack
 * turns a long editing session into a slow leak of structure nobody can reach
 * any more. Thirty-two deliberate, structural edits is already well past what a
 * person holds in their head, and a frame edit is a deliberate act rather than a
 * stroke.
 *
 * THE NUMBER DOES NOT MOVE FOR THE TREE. A `Timeline` is one `Step` per beat of
 * a journal that is already bounded by `HISTORY_LIMIT`, and every node of it is
 * immutable and shared with the tree the next revision holds — a merge rebuilds
 * the spine and reuses every beat it did not touch — so the second half of a
 * revision is the same order of cost as the first.
 */
export const REVISION_LIMIT = 32;

/**
 * Remember a revision, about to be rewritten.
 *
 * The redo branch is discarded, on the standard linear-history rule `strokes.
 * commit` and `layers.act` both keep: once you rewrite after undoing a rewrite,
 * the thing you undid is no longer a future anyone can reach.
 *
 * Called BEFORE the rewrite, with the state the rewrite is about to replace.
 * The three-line caller pattern is
 *
 *     const done = editFrame(session, k, recolour);
 *     if (done.ok) setRevisions(remember(revisions, { session, timeline }));
 *
 * and it is in that order deliberately: a refused rewrite must not cost a
 * revision, and testing `done.ok` first is the only arrangement in which it
 * cannot.
 *
 * ── EVERY REWRITE PATH, AND WHAT EACH OWES THE TREE ─────────────────────
 *
 * Audited, because "remember the pair" is only half a rule if one of the paths
 * moves one half without the other:
 *
 *   `editFrame` — `rewriteFrames` with `count === 1` replaced by one act. The
 *   journal keeps its length, so `nested.rebaseTree` is the IDENTITY on the tree
 *   and the pair remembered is `{ session, timeline }` with the same timeline on
 *   both sides. Nothing to do beyond remembering it.
 *
 *   `mergeFrames` — `count === n` replaced by one. The journal shrinks by n-1
 *   and the tree MUST be rebased with the same three numbers the plan carried:
 *   `rebaseTree(timeline, at, count, 1)`. This is the path the measured loss was
 *   found on.
 *
 *   `rewriteFrames` DIRECTLY — the general splice, and the one a caller can get
 *   wrong. `replaced` is `plan.acts.length` and NOT always one; `Rebased.replaced`
 *   reports the acts that came out, so `plan.count` and `plan.acts.length` are
 *   both in the caller's hand at the call site. A delete (`acts: []`) takes the
 *   tree to `rebaseTree(tl, at, count, 0)`.
 *
 *   `nested.group`, `nested.ungroup`, `nested.insertHold` — these move the TREE
 *   and never the journal. They are revisions too, and the paired value spells
 *   them directly: the same `Session` on both sides, a different timeline. That
 *   is what lets them share this stack rather than needing a third one.
 *
 *   `mergeActs` — a pure function on acts with no session and no tree. It is
 *   `mergeFrames`' ingredient and owes nothing here.
 */
export function remember(revisions: Revisions, before: Revision): Revisions {
  // NORMALISED rather than stored as given. `RevisionStep` extends `Revision`,
  // so the value a caller has in hand after an undo is accepted here — and
  // storing it whole would pin a `Revisions` inside a `Revisions`, one stack
  // holding a copy of itself at every rung. Two fields, taken by name.
  const past = [...revisions.past, { session: before.session, timeline: before.timeline }];
  return {
    past:
      past.length > REVISION_LIMIT ? past.slice(past.length - REVISION_LIMIT) : past,
    future: [],
  };
}

/**
 * The state to stand in, and the stacks it leaves behind.
 *
 * EXTENDS `Revision`, so the result of an undo is itself a live value the next
 * `undoRevision`/`redoRevision`/`remember` will take — the caller never has to
 * reassemble the pair, which is the arrangement in which it cannot be
 * reassembled wrongly.
 */
export interface RevisionStep extends Revision {
  readonly revisions: Revisions;
}

/**
 * Back to the state before the last frame edit, or `null` when there was none.
 *
 * `live` is the document as it stands — session AND tree — and it goes onto the
 * redo branch, so this is a swap rather than a pop and the round trip is the
 * identity on both halves. `null` rather than the live state unchanged, so a
 * caller cannot mistake "nothing happened" for "something happened and it looked
 * the same".
 */
export function undoRevision(
  revisions: Revisions,
  live: Revision
): RevisionStep | null {
  if (revisions.past.length === 0) return null;
  const at = revisions.past[revisions.past.length - 1];
  return {
    revisions: {
      past: revisions.past.slice(0, -1),
      future: [{ session: live.session, timeline: live.timeline }, ...revisions.future],
    },
    session: at.session,
    timeline: at.timeline,
  };
}

/** Forward again. The exact inverse of `undoRevision`, on both halves. */
export function redoRevision(
  revisions: Revisions,
  live: Revision
): RevisionStep | null {
  if (revisions.future.length === 0) return null;
  const [at, ...rest] = revisions.future;
  return {
    revisions: {
      past: [...revisions.past, { session: live.session, timeline: live.timeline }],
      future: rest,
    },
    session: at.session,
    timeline: at.timeline,
  };
}

// ── a per-layer timeline ─────────────────────────────────────────────────

/**
 * Every layer an act touches, including everything under a subtree it moved.
 *
 * A `place` move carries a whole `Layer`, so moving a group touches every
 * descendant — and a per-layer timeline that missed those would show a child's
 * row as untouched by the act that moved its parent out of the drawing.
 */
export function frameLayers(act: Act): Set<LayerId> {
  const out = new Set<LayerId>();
  const go = (l: Layer): void => {
    out.add(l.id);
    for (const c of l.children) go(c);
  };
  for (const m of act.moves) {
    if (m.kind === "place") go(m.node);
    else out.add(m.layer);
  }
  return out;
}

/**
 * The indices of the acts that touched any of these layers, ascending.
 *
 * THE ACT-SPACE HALF of drilling in, and the whole of what a per-layer timeline
 * needs from this module. The other half is `shown`, which narrows STEP space and
 * which `beatsOf` and `animationSteps` already take. See the header for why the
 * two must be composed in that order and never conflated.
 *
 * Returns indices rather than acts, because an index is what `stepComposition`,
 * `revertMoves`, `timeline.actAtStep` and every function in this file address the
 * journal with. A filtered list of acts would be a second journal with its own
 * numbering, which is the one thing a timeline must not have two of.
 */
export function framesTouching(
  past: readonly Act[],
  ids: ReadonlySet<LayerId>
): number[] {
  const out: number[] = [];
  past.forEach((a, k) => {
    for (const id of frameLayers(a)) {
      if (ids.has(id)) {
        out.push(k);
        return;
      }
    }
  });
  return out;
}
