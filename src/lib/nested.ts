/**
 * NESTED TIMELINES: a composition that contains its own timeline, and what
 * that buys.
 *
 * PROTOTYPE. Nothing here is wired to the UI and nothing here changes the file
 * format. It exists to answer four questions with running code, and
 * `test/nested.test.ts` is where the answers are. Read that file for the
 * verdict; read this one for the shape the verdict is about.
 *
 * ONE THING IN THE PROGRAM NOW NAMES IT, and the sentence that said nothing did
 * has been corrected rather than left standing. `frames.Revision` imports
 * `Timeline` — TYPE ONLY, erased at build — because a revision has to remember
 * everything a rewrite moves and this tree is one of those things. Measured: a
 * revision that remembered only the `Session` restored a six-rung journal beside
 * a four-beat tree and dropped two gestures from the animation with nothing
 * reporting it.
 *
 * AND THAT IS NO LONGER THE WHOLE OF THE COUPLING. This paragraph used to end
 * "no function here is called by the program", which was true when it was written
 * and stopped being true in this same branch: `page.tsx` imports `groupFor` and
 * `rebaseTree` at runtime and calls both — `groupFor` from `rewriteFrame`, to put
 * a wrapper round an edited step so a later hold cannot renumber the drawing, and
 * `rebaseTree` from `mergeMarked`, because only it knows a splice's three numbers
 * and can therefore keep a hold inside the merged range. `flatten` and `stepId`
 * are called from `timeline.ts`, which the program calls throughout.
 *
 * A stale "nothing calls this" is the most expensive kind of wrong comment here,
 * because it invites exactly the change nobody may safely make.
 *
 * ── THE SHAPE: NESTING IN THE MODEL, ONE FLAT CLOCK IN THE FILE ─────────
 *
 * `compile` is the whole design. It walks the tree and gathers every leaf's
 * reveal onto ONE clock as an absolute time, so what leaves this module is the
 * shape `emit.animationRules` already consumes: a flat list of reveal indices on
 * a single cycle. The browser never sees a nested timeline, so the
 * `animation-delay` constraint in `emit.EmitAnimation` never applies — not
 * because it was worked around, but because nothing nested is ever emitted.
 *
 * TWO PROPERTIES MAKE IT SAFE, and `test/nested.test.ts` asserts both:
 *
 *   MIGRATION. An unnested composition compiles to `at = k · stepMs` and
 *   `cycle = n · stepMs + holdMs`, which are `emit.animationRules`' own two
 *   formulas. Asserted on BYTES, by running the real `serialise` over the same
 *   document twice — once with today's numbering, once with the compiler's — and
 *   comparing the strings, and by reading the cycle back out of the emitted CSS.
 *
 *   LOCALISATION. Inserting a hold inside a child leaves every parent-level
 *   ORDINAL alone. That is the property the whole feature exists for, and it is
 *   real. What it is NOT is a guarantee about absolute TIMES — see the
 *   conservation law below, which is the sharpest thing this file found.
 *
 * ── THE CONSERVATION LAW ────────────────────────────────────────────────
 *
 * A brief for this work asked that inserting a hold inside a child change "no
 * parent-level index and no other child's absolute times except those downstream
 * within the same child". THE SECOND HALF CANNOT HOLD, and the reason is
 * arithmetic rather than architectural: a hold ADDS `stepMs` of duration, and
 * that duration has to be absorbed somewhere. There are exactly two places, and
 * `CompileMode` is the choice between them:
 *
 *   `"extend"` — the child keeps its own tempo and its slot grows. Every time
 *   inside the child is untouched except downstream of the insertion, exactly as
 *   asked. THE PARENT'S DOWNSTREAM BEATS SHIFT LATER by one `stepMs`, because
 *   the drawing genuinely got one beat longer.
 *
 *   `"within"` — the child's slot is pinned to one parent beat and its steps
 *   COMPRESS to fit. Every parent time is untouched, as asked. THE CHILD'S OWN
 *   UPSTREAM STEPS SPEED UP, including ones before the insertion point, so the
 *   half of the property about "no other child's absolute times" fails instead.
 *
 * You may have one or the other and not both. Indices localise unconditionally;
 * times do not localise at all.
 *
 * `"extend"` IS THE DEFAULT, and that is a DEVIATION from the brief, which asked
 * for play-once-within-parent as the default. It was measured and the measurement
 * decided it:
 *
 *   GROUPING MUST NOT CHANGE THE ANIMATION. Auto-grouping is a POLICY applied
 *   automatically so that a hold can be inserted off the root — the person did
 *   not ask for it and must not be able to see it. Under `"extend"`, grouping is
 *   COMPILE-INVARIANT: `compile(group(T)) === compile(T)`, asserted on the
 *   reveal list. Under `"within"`, wrapping n steps collapses them into one
 *   parent beat and the drawing plays n times faster in that region — so the
 *   invisible policy would be the most visible edit in the program.
 *
 *   `"within"` ALSO BREAKS THE INTEGER DISCIPLINE. Compression is
 *   `slot / beats`, and `replay.animationTiming` is explicit that timings are
 *   "integers throughout: the percentages downstream are the only floats". A
 *   compressed child puts a non-integer millisecond into the model.
 *
 * `"within"` is implemented anyway, because it is the honest statement of the
 * alternative and because the test that kills it has to be able to run it.
 *
 * ── The problem, in one paragraph ───────────────────────────────────────
 *
 * `replay.animationSteps` DROPS a gesture that changed nothing visible, so the
 * program is all keyframes and no holds — Flash's in-between frame is exactly
 * the thing being discarded. Emitting holds is a two-line patch that breaks a
 * shared index space: `emit.EmitLayer.reveal`, `replay.InOut` and the timeline
 * playhead all index `AnimationStep[]`, and inserting a hold renumbers every
 * beat after it, so a saved in/out pair and every `reveal` a file carries name a
 * DIFFERENT beat afterwards. `frames.ts` documents that cost and declines to pay
 * it.
 *
 * ── THE TWO READINGS OF "NESTED", AND WHICH ONE THIS IS ─────────────────
 *
 * The proposal is "make the stack a recursive composition so it contains its own
 * timeline". That has two readings and they cost wildly different amounts.
 *
 *   ADDRESSING — one global cycle, nested NAMES. A sub-composition is a labelled
 *   region of the one timeline; the flat step index is DERIVED from the tree at
 *   emit time and never stored. TAKEN, and it is the whole of what the
 *   renumbering problem needs.
 *
 *   INDEPENDENT LOOPING — true Flash movie clips, each cycling on its own clock
 *   inside the parent's. NOT TAKEN. It renders (measured — see below), but
 *   flattening it costs the LCM of every clip length and `keyframeCost` measures
 *   what that does to the stylesheet.
 *
 * ── MEASURED IN A REAL BROWSER, and both results matter ─────────────────
 *
 * Chromium 130 (Blink), 30 Hz sampling of resolved `opacity` on the browser's
 * own clock — nothing set `currentTime`, because whether the browser keeps
 * nested cycles in phase BY ITSELF is the entire question.
 *
 *   INDEPENDENT NESTED CYCLES DO LOOP. A `<g>` on a 3200 ms cycle containing
 *   children on their own 800 ms cycle held both periods to the millisecond over
 *   14 sub-cycles and 3 parent cycles, with zero drift, and every animation
 *   reported `startTime: 0` — parent and child share one document timeline
 *   origin. The children kept ticking while the parent sat at `opacity: 0` and
 *   came back in phase, so an invisible ancestor does not pause or throttle a
 *   sub-composition. THE `animation-delay` CONTROL FAILED IN THE SAME PAGE, as
 *   `emit.EmitAnimation` says it must: all three delayed groups sat at opacity 1
 *   for the whole run, dark fraction 0.000. So the refutation in that header is
 *   about DELAY and does not reach nested cycles, and the design is not blocked
 *   by the renderer. It is blocked by the flattening cost, which is a different
 *   objection and a real one.
 *
 *   WHEN THE PERIODS ARE INCOMMENSURATE THE SUB-CLIP FREEWHEELS. Parent 3200 ms,
 *   sub 1000 ms: the sub-composition's phase inside the parent cycle walked
 *   1000 → 800 → 600 → 400 ms, i.e. by 3200 mod 1000 = 200 ms per parent cycle,
 *   repeating only at lcm = 16 000 ms. The picture at parent beat k is therefore
 *   NOT the same picture on successive loops. That is what a Flash movie clip
 *   does, and it is a design decision rather than a defect — but it means an
 *   independent loop cannot be exported to a GIF or a still frame sequence
 *   without picking a cycle, and `gif.ts` takes one frame per step.
 *
 *   THE NESTED-WRAPPER OBJECTION DOES NOT APPLY TO THE TAKEN READING, and this
 *   is the measurement that mattered most, because a reader will reach for that
 *   objection to kill this design. `replay.ts` says "NESTED WRAPPERS FAIL
 *   GENERALLY: nesting multiplies opacities, so the set visible at time t must be
 *   a PRODUCT set; but the set that must be visible is a THRESHOLD set, and
 *   threshold sets are not products", with the counterexample {00, 01, 10}. TRUE,
 *   AND ABOUT A DIFFERENT CONSTRUCTION: that argument is about factoring ONE flat
 *   reveal set into per-bit wrappers to save bytes, where the wrappers carry the
 *   bits and the leaves carry nothing. Here every element states its OWN
 *   threshold and merely inherits its ancestors', and a product of thresholds is
 *   a threshold AT THE MAX. Measured on a flat 3200 ms cycle with a nested DOM,
 *   visible = parent × child, half-opacity crossing relative to the cycle:
 *
 *     parent 800 × child 1200  →  1200 ms      (max, as predicted)
 *     parent 800 × child 1600  →  1601 ms      (max)
 *     three levels, 400/1200/1600 → 1601 ms    (max composes down a chain)
 *     parent 800 × child  400  →   801 ms      (max — NOT 400)
 *
 *   THE LAST ROW IS A PRECONDITION, NOT A CURIOSITY. A child that reveals BEFORE
 *   its ancestor is silently held back to the ancestor's time, so a file
 *   violating it animates differently from the model that wrote it. `emit.ts`
 *   NOW ENFORCES IT — `emit.revealBreak` is the check, `serialise` throws on a
 *   document that fails it and `parse` refuses such a file whole — and
 *   `wellOrdered` below is the same statement about this module's own tree,
 *   where the flat compiler makes it true by construction.
 *
 *   CO-TIMED FADES COMPOUND. A group and its child revealing at the SAME step
 *   crossed half opacity 34 ms late against a 60 ms fade, because each is at
 *   0.707 when the other is. Harmless to the threshold and visible as a slightly
 *   softer landing; worth knowing before someone measures a fade and finds it
 *   long.
 *
 * ── WHY THE TREE DOES NOT TOUCH THE JOURNAL ─────────────────────────────
 *
 * THE ONE DECISION EVERYTHING ELSE FOLLOWS FROM. A `Beat` here references an act
 * by INDEX into `layers.Journal.past`, and a `Hold` references nothing at all. So
 * inserting a hold adds a node to this tree and does not add a rung to the
 * journal — `past` is untouched, every index into it still names what it named,
 * and `frames.rewriteFrames`, `composer.stepComposition`, `frames.framesTouching`
 * and `timeline.actAtStep` all keep working with no change whatsoever.
 *
 * The alternative — a hold as an `Act` with no moves — was rejected because it
 * puts the hold in the one array whose indices three modules address, which is
 * the original problem wearing a different hat. `frames.ts` already argues the
 * mirror of this for revisions: a journal rewrite cannot be a `Move` because a
 * `Move` cannot reach the journal. A hold is the same shape of fact — it is
 * about the ANIMATION and not about the drawing — so it belongs where the
 * animation is described and not where the drawing is recorded.
 *
 * WHAT THIS DOES NOT SURVIVE, stated because it is the tree's real cost: a
 * rewrite that CHANGES THE LENGTH of `past` shifts every act index above the
 * splice, and this tree holds those indices. `frames.rewriteFrames` with
 * `count === acts.length` — which is what `editFrame` always does — preserves
 * them, so a frame edit is free. A MERGE does not: `mergeFrames` replaces n acts
 * with one, so every `Beat.act` above the splice must be shifted down by n-1 and
 * the n-1 beats inside the range collapse to one. `rebaseTree` is that repair,
 * and it is the honest price of keeping the tree beside the journal rather than
 * inside it.
 *
 * ── ZERO FLOAT ─────────────────────────────────────────────────────────
 *
 * Array indices, map lookups, and one `lcm` over integers. `keyframeCost`
 * counts; it does not measure time.
 */

import type { Act } from "./layers";

// ── the tree ─────────────────────────────────────────────────────────────

/**
 * A step's STABLE NAME, and the reason this module exists.
 *
 * Minted once and never derived from a position, exactly as `layers.layerId`
 * mints a `LayerId` from a monotone counter rather than from a slot. That is
 * what makes it survive an insertion anywhere: a positional path `[2, 1, 3]` is
 * still an ordinal and still moves when something is inserted before it in its
 * own composition, which `test/nested.test.ts` measures rather than assumes.
 *
 * The flat reveal index is the DERIVED thing. Store the name, derive the number
 * — the same move `plate.ts` already makes, where a cell is stored as an address
 * word and the index into the canvas is computed for whatever depth is on
 * screen.
 */
export type StepId = string & { readonly __step: true };

export const stepId = (n: number): StepId => `t${n}` as StepId;

/**
 * One leaf of the timeline: something that occupies a beat.
 *
 * `act` is an index into `layers.Journal.past`, or `null` for a HOLD — Flash's
 * in-between frame, a beat during which the picture does not move. A hold is the
 * whole point: it is a beat with no gesture behind it, which is precisely the
 * thing the journal cannot represent and precisely the thing `animationSteps`
 * drops.
 */
export interface Beat {
  readonly kind: "beat";
  readonly id: StepId;
  /** Index into `Journal.past`, or `null` for a hold. */
  readonly act: number | null;
}

/**
 * A SUB-COMPOSITION: a run of steps that occupies one slot of its parent and
 * contains a timeline of its own.
 *
 * IT DOES NOT CONSUME A BEAT OF ITS OWN, and that is load bearing rather than
 * tidy. If wrapping a step added a beat, grouping would change the number of
 * beats in the drawing, `group` could not be undone by `ungroup` without also
 * removing one, and the whole claim that grouping is index-preserving would be
 * false at the root. A composition's reveal is the reveal of its first step —
 * measured to be correct in the browser, where a wrapper and its first child
 * revealing together produce a threshold at their common time.
 */
export interface Comp {
  readonly kind: "comp";
  readonly id: StepId;
  readonly steps: readonly Step[];
}

export type Step = Beat | Comp;

/** A whole timeline is the root composition's steps. */
export type Timeline = readonly Step[];

// ── flattening: the index is DERIVED ─────────────────────────────────────

/**
 * Every beat of the tree in play order, with the flat reveal index it gets.
 *
 * PRE-ORDER, and a `Comp` contributes nothing of its own — it is a name for a
 * region, so its beats are simply its parent's beats in the parent's order. The
 * result is exactly the flat list `emit.ts` already writes rules for: one reveal
 * index per beat, ascending, no gaps.
 *
 * THIS IS THE WHOLE OF "FLATTEN AT EMIT". Nothing nested animates: the CSS the
 * emitter would write from this is one flat set of `@keyframes` on one cycle,
 * which is the form the program already emits and the form the browser
 * measurement confirms loops. The nesting lives in the model and is spent here.
 */
export function flatten(tl: Timeline): { order: readonly StepId[]; indexOf: ReadonlyMap<StepId, number> } {
  const order: StepId[] = [];
  const indexOf = new Map<StepId, number>();
  const walk = (steps: Timeline): void => {
    for (const s of steps) {
      if (s.kind === "comp") {
        // The composition takes the index of its first beat rather than one of
        // its own. See `Comp`.
        walk(s.steps);
        const first = firstBeat(s);
        if (first !== null) indexOf.set(s.id, indexOf.get(first) as number);
        continue;
      }
      indexOf.set(s.id, order.length);
      order.push(s.id);
    }
  };
  walk(tl);
  return { order, indexOf };
}

/** The first beat under a step, or `null` for a composition holding none. */
export function firstBeat(s: Step): StepId | null {
  if (s.kind === "beat") return s.id;
  for (const c of s.steps) {
    const hit = firstBeat(c);
    if (hit !== null) return hit;
  }
  return null;
}

/** How many beats the timeline plays. The cycle is `beats * stepMs + holdMs`. */
export const beatCount = (tl: Timeline): number => flatten(tl).order.length;

/**
 * The flat reveal index a stable name resolves to, or `null` when it is gone.
 *
 * `null` IS THE NEW FAILURE MODE and it is the cost of addressing. A flat
 * integer can always be CLAMPED — `replay.clampSpan` does exactly that and its
 * header argues for it — whereas a name can DANGLE, because the composition it
 * lived in may have been deleted. So anything that stores a name has to answer
 * for a name that no longer resolves, and there is no clamping available: the
 * honest answers are "fall back to the whole replay" or "refuse", and this
 * module does not get to pick.
 */
export function resolve(tl: Timeline, id: StepId): number | null {
  return flatten(tl).indexOf.get(id) ?? null;
}

// ── the ordering precondition the browser measured ───────────────────────

/**
 * Does every step reveal at or after the composition that contains it?
 *
 * MEASURED, NOT ARGUED. A child that reveals before its ancestor is silently
 * held back to the ancestor's time, because SVG composites group opacity
 * multiplicatively and a product of thresholds is a threshold at the max — see
 * the header for the numbers. So a file violating this animates differently from
 * the model that wrote it, with nothing anywhere reporting a problem.
 *
 * Under the flat timeline this module builds the property holds BY
 * CONSTRUCTION, because `flatten` walks in play order and a composition takes
 * its first beat's index. It is checked anyway: the invariant is about what the
 * EMITTER writes, an emitter may one day assign reveals some other way, and a
 * silent failure is exactly the kind this codebase pins with a test.
 *
 * THE EMITTER'S OWN HALF IS `emit.revealBreak`, and the two are deliberately not
 * one function. This one walks a `Timeline` of `Step`s and answers about the
 * MODEL; that one walks a tree of `EmitLayer`s and answers about the DOCUMENT,
 * and names the two layers that disagree so a refusal can say which. Sharing an
 * implementation would mean one of the two modules importing the other's tree
 * type for a four-line walk.
 */
export function wellOrdered(tl: Timeline): boolean {
  const { indexOf } = flatten(tl);
  const walk = (steps: Timeline, floor: number): boolean =>
    steps.every((s) => {
      const at = indexOf.get(s.id);
      if (at === undefined) return true; // an empty composition reveals nothing
      if (at < floor) return false;
      return s.kind === "comp" ? walk(s.steps, at) : true;
    });
  return walk(tl, 0);
}

// ── inserting a hold ─────────────────────────────────────────────────────

/**
 * A hold inserted at `at` inside the composition named by `into`, or at the root
 * when `into` is `null`.
 *
 * THE JOURNAL IS NOT TOUCHED. A hold carries `act: null`, so `Journal.past` does
 * not grow and no index into it moves. That is the whole mechanism, and it is
 * why this composes with `frames.ts` rather than fighting it.
 *
 * ── IT CANNOT DECLINE, WHERE `group` AND `ungroup` BOTH CAN ────────────
 *
 * Named because the asymmetry is real and looks like an oversight. `into` naming
 * no composition returns the tree UNCHANGED — `walk` simply matches nothing — and
 * an out-of-range `at` is clamped by `splice`. So a caller cannot tell "the hold
 * went in" from "the id was wrong" by the return value, and there is no `Outcome`
 * here to say which.
 *
 * Left that way DELIBERATELY, because the two are not the same kind of operation:
 * `group` and `ungroup` restructure and can produce a tree that is not a tree, so
 * they have to be able to say no. A hold adds one leaf and every argument to it
 * comes from a control that already knows the tree — `at` from a rail position,
 * `into` from a step the panel is pointing at. There is no path today by which a
 * bad `into` reaches here. If one is ever added, THIS is the function that needs
 * an `Outcome` first, and the reason it did not have one is that nothing could
 * have used it.
 */
export function insertHold(
  tl: Timeline,
  into: StepId | null,
  at: number,
  id: StepId
): Timeline {
  const hold: Beat = { kind: "beat", id, act: null };
  if (into === null) return splice(tl, at, hold);
  const walk = (steps: Timeline): Step[] =>
    steps.map((s) => {
      if (s.kind !== "comp") return s;
      if (s.id === into) return { ...s, steps: splice(s.steps, at, hold) };
      return { ...s, steps: walk(s.steps) };
    });
  return walk(tl);
}

const splice = (steps: Timeline, at: number, one: Step): Step[] => {
  const k = Math.max(0, Math.min(steps.length, at));
  return [...steps.slice(0, k), one, ...steps.slice(k)];
};

// ── grouping and ungrouping ──────────────────────────────────────────────

/**
 * Steps `at … at+count-1` of the composition named by `into`, wrapped in a new
 * sub-composition.
 *
 * THE POLICY HALF OF THE PROPOSAL. "Any time we try to edit something from the
 * past, it becomes a group and we pass the edits through" — this is the group,
 * and `insertHold` into the group it returns is the pass-through. The two are
 * not alternatives to each other: grouping is what keeps an insertion OFF the
 * root, and an insertion off the root is what leaves the root's step names
 * alone.
 *
 * `null` when the range names nothing, on `frames.mergeFrames`' rule for the
 * same problem: a control that appears to work and quietly does nothing is worse
 * than one that says no.
 */
export function group(
  tl: Timeline,
  into: StepId | null,
  at: number,
  count: number,
  id: StepId
): Timeline | null {
  if (!Number.isInteger(at) || !Number.isInteger(count) || count < 1) return null;
  const wrap = (steps: Timeline): Step[] | null => {
    if (at < 0 || at + count > steps.length) return null;
    const inner = steps.slice(at, at + count);
    const comp: Comp = { kind: "comp", id, steps: inner };
    return [...steps.slice(0, at), comp, ...steps.slice(at + count)];
  };
  if (into === null) return wrap(tl);
  let done = false;
  const walk = (steps: Timeline): Step[] =>
    steps.map((s) => {
      if (s.kind !== "comp") return s;
      if (s.id === into) {
        const inner = wrap(s.steps);
        if (inner === null) return s;
        done = true;
        return { ...s, steps: inner };
      }
      return { ...s, steps: walk(s.steps) };
    });
  const out = walk(tl);
  return done ? out : null;
}

/**
 * A composition dissolved: its steps spliced back into its parent at its slot.
 *
 * THE EXACT INVERSE of `group`, and `test/nested.test.ts` asserts the round trip
 * on the tree rather than on a count. That inverse is what makes auto-grouping
 * safe to apply automatically: a policy that could not be taken back would be a
 * policy that silently deepens a document forever.
 */
export function ungroup(tl: Timeline, id: StepId): Timeline | null {
  let done = false;
  const walk = (steps: Timeline): Step[] => {
    const out: Step[] = [];
    for (const s of steps) {
      if (s.kind === "comp" && s.id === id) {
        done = true;
        out.push(...s.steps);
        continue;
      }
      out.push(s.kind === "comp" ? { ...s, steps: walk(s.steps) } : s);
    }
    return out;
  };
  const res = walk(tl);
  return done ? res : null;
}

// ── the depth rule ───────────────────────────────────────────────────────

/** How deep the tree nests. The root's own steps are depth 0. */
export function depth(tl: Timeline): number {
  let most = 0;
  const walk = (steps: Timeline, d: number): void => {
    for (const s of steps) {
      if (s.kind !== "comp") continue;
      most = Math.max(most, d + 1);
      walk(s.steps, d + 1);
    }
  };
  walk(tl, 0);
  return most;
}

/** The composition that most closely contains `id`, or `null` for the root. */
export function innermost(tl: Timeline, id: StepId): StepId | null {
  let hit: StepId | null = null;
  const walk = (steps: Timeline, owner: StepId | null): boolean =>
    steps.some((s) => {
      if (s.id === id) {
        hit = owner;
        return true;
      }
      return s.kind === "comp" && walk(s.steps, s.id);
    });
  walk(tl, null);
  return hit;
}

/**
 * THE RULE THAT STOPS RUNAWAY DEPTH: editing a step five times must not produce
 * five levels.
 *
 * A step is grouped ONLY IF it is not already the SOLE member of a composition.
 * If it is, that composition is the group the edit belongs in and is returned
 * instead of a new one — so the second edit and every edit after it reuses the
 * wrapper the first one made, and depth is bounded by the number of DISTINCT
 * nesting intents rather than by the number of edits.
 *
 * The alternative rules were considered and are worse. A DEPTH CAP (`stop at
 * 8`) makes the ninth edit behave differently from the eighth for a reason the
 * person cannot see. A TIME WINDOW ("reuse if edited within a minute") makes the
 * document's shape depend on how fast somebody types. Reusing the existing sole
 * wrapper is the only rule that is a function of the DOCUMENT rather than of the
 * history of interaction with it, which is the same standard `layers.ts` holds
 * `Composition` to.
 *
 * Returns the composition the edit should go into, and whether one had to be
 * made. `null` when the step is not in the tree at all.
 */
export function groupFor(
  tl: Timeline,
  step: StepId,
  mint: StepId
): { tree: Timeline; into: StepId; made: boolean } | null {
  const owner = innermost(tl, step);
  if (owner === null && !hasStep(tl, step)) return null;
  if (owner !== null) {
    const comp = findComp(tl, owner);
    // Already alone in a wrapper: that wrapper IS the group for this edit.
    if (comp !== null && comp.steps.length === 1 && comp.steps[0].id === step) {
      return { tree: tl, into: owner, made: false };
    }
  }
  const at = indexIn(tl, owner, step);
  if (at === null) return null;
  const tree = group(tl, owner, at, 1, mint);
  if (tree === null) return null;
  return { tree, into: mint, made: true };
}

const hasStep = (tl: Timeline, id: StepId): boolean =>
  tl.some((s) => s.id === id || (s.kind === "comp" && hasStep(s.steps, id)));

function findComp(tl: Timeline, id: StepId): Comp | null {
  for (const s of tl) {
    if (s.kind !== "comp") continue;
    if (s.id === id) return s;
    const hit = findComp(s.steps, id);
    if (hit !== null) return hit;
  }
  return null;
}

/** Where `step` sits inside the composition `owner`, or `null`. */
function indexIn(tl: Timeline, owner: StepId | null, step: StepId): number | null {
  const steps = owner === null ? tl : findComp(tl, owner)?.steps;
  if (steps === undefined) return null;
  const at = steps.findIndex((s) => s.id === step);
  return at < 0 ? null : at;
}

// ── keeping the tree beside a journal that moves ─────────────────────────

/**
 * The tree repaired after a splice of `count` acts at `at` into `replaced` of
 * them. THE PRICE OF LIVING BESIDE THE JOURNAL RATHER THAN INSIDE IT.
 *
 * `frames.editFrame` is always `count === 1, replaced === 1`, so it is the
 * identity here and a frame edit costs nothing. `frames.mergeFrames` is
 * `count === n, replaced === 1`: the n beats in the range become one, and every
 * act index above the range shifts down by n-1.
 *
 * HOLDS INSIDE A MERGED RANGE SURVIVE. A hold references no act, so it is not
 * part of the work being coalesced and there is nothing to merge it into — it is
 * a beat the person put there on purpose, and a merge of the gestures around it
 * is not a statement about it. That is a decision rather than a fallout, and it
 * is the one that keeps merge from silently deleting timing the person authored.
 */
export function rebaseTree(
  tl: Timeline,
  at: number,
  count: number,
  replaced: number
): Timeline {
  const delta = replaced - count;
  let kept = false;
  const walk = (steps: Timeline): Step[] => {
    const out: Step[] = [];
    for (const s of steps) {
      if (s.kind === "comp") {
        out.push({ ...s, steps: walk(s.steps) });
        continue;
      }
      if (s.act === null) {
        out.push(s); // a hold survives a merge. See above.
        continue;
      }
      if (s.act < at) {
        out.push(s);
        continue;
      }
      if (s.act < at + count) {
        // Inside the merged range: the first survivor becomes the merged act,
        // the rest are gone because the work is now in that one rung.
        if (kept) continue;
        kept = true;
        out.push({ ...s, act: at });
        continue;
      }
      out.push({ ...s, act: s.act + delta });
    }
    return out;
  };
  return walk(tl);
}

/** The timeline a flat journal has before anything is grouped or held. */
export const timelineOf = (past: readonly Act[]): Timeline =>
  past.map((_, k): Beat => ({ kind: "beat", id: stepId(k), act: k }));

// ── the compiler: a nested model onto one flat clock ─────────────────────

/**
 * How the duration a hold adds is absorbed. See the conservation law in the
 * header — this is the choice, and there is no third option.
 */
export type CompileMode = "extend" | "within";

/** The one clock. The same three numbers `emit.EmitAnimation` carries. */
export interface Tempo {
  readonly stepMs: number;
  readonly holdMs: number;
  readonly fadeMs: number;
}

/** A composition's own `stepMs`, when it does not inherit its parent's. */
export type Tempos = ReadonlyMap<StepId, number>;

/** One leaf, placed on the flat clock. */
export interface Reveal {
  readonly id: StepId;
  readonly act: number | null;
  /** Absolute milliseconds from the start of the cycle. */
  readonly at: number;
  /** The flat index `emit.EmitLayer.reveal` would carry. DERIVED, and unstable. */
  readonly index: number;
}

export interface Compiled {
  readonly reveals: readonly Reveal[];
  /** `emit.animationRules`' cycle: the drawing's length plus the hold. */
  readonly cycle: number;
  /** Where each ROOT-level step starts. The parent-level facts, isolated. */
  readonly rootAt: ReadonlyMap<StepId, number>;
}

/**
 * The nested model, compiled onto one clock. THE WHOLE DESIGN.
 *
 * The greatest ancestor walks to the furthest leaf and gathers every reveal into
 * one ascending list of absolute times; the flat index is then just the position
 * in that list. Nothing nested survives into the output, which is why the file
 * this feeds is the file `emit.ts` already writes.
 *
 * PURE, and that matters more than it looks: the tree is the only input, so two
 * documents with the same tree compile to the same timeline, and a compile can
 * be run twice to compare — which is exactly what the group-invariance test does.
 */
export function compile(
  tl: Timeline,
  tempo: Tempo,
  mode: CompileMode = "extend",
  tempos: Tempos = new Map()
): Compiled {
  const placed: { id: StepId; act: number | null; at: number }[] = [];
  const rootAt = new Map<StepId, number>();

  /** How long a step occupies its parent's line. */
  const durationOf = (s: Step, stepMs: number): number => {
    if (s.kind === "beat") return stepMs;
    // A child pinned to one parent beat occupies exactly that, whatever it holds.
    if (mode === "within") return stepMs;
    const own = tempos.get(s.id) ?? stepMs;
    return s.steps.reduce((n, c) => n + durationOf(c, own), 0);
  };

  const lay = (steps: Timeline, start: number, stepMs: number, root: boolean): number => {
    let at = start;
    for (const s of steps) {
      if (root) rootAt.set(s.id, at);
      if (s.kind === "beat") {
        placed.push({ id: s.id, act: s.act, at });
        at += stepMs;
        continue;
      }
      const slot = durationOf(s, stepMs);
      let own = tempos.get(s.id) ?? stepMs;
      if (mode === "within") {
        const beats = beatCount(s.steps);
        // COMPRESSION, and the one place this module produces a non-integer
        // millisecond. See the header for why that is an argument against the
        // mode rather than a detail of it.
        //
        // ONE-SIDED, and the other side is named rather than left to be found: it
        // only ever SHORTENS. A composition whose beats at their own tempo come
        // to LESS than its slot keeps that tempo and the slot is under-filled —
        // the children finish early and the remainder is dead time inside the
        // group. Not fixed here: "stretch to fill" is a different intent from
        // "fit inside", nothing in the program selects `"within"` yet, and
        // inventing the stretch would be choosing for a mode with no caller. It
        // is a real gap in the mode, recorded as one.
        if (beats > 0 && beats * own > slot) own = slot / beats;
      }
      lay(s.steps, at, own, false);
      at += slot;
    }
    return at;
  };

  const drawn = lay(tl, 0, tempo.stepMs, true);
  placed.sort((a, b) => a.at - b.at);
  const reveals: Reveal[] = placed.map((p, k) => ({ ...p, index: k }));
  // `emit.animationRules`' own formula, and for an unnested tree `drawn` is
  // exactly `steps * stepMs`, which is what makes the migration byte-identical.
  return { reveals, cycle: Math.max(1, drawn + tempo.holdMs), rootAt };
}

/**
 * Which root-level step each parent-level ordinal names.
 *
 * THE THING THAT LOCALISES. A hold anywhere inside a child cannot change this
 * list, because a composition occupies one entry of it whatever it contains —
 * which is the precise sense in which nesting solves the renumbering problem,
 * and the only sense in which it does.
 */
export const rootOrder = (tl: Timeline): readonly StepId[] => tl.map((s) => s.id);

// ── what the two readings cost the stylesheet ────────────────────────────

/**
 * How many `@keyframes` blocks and keyframe STOPS a timeline costs, under each
 * reading. The number that decides how big this feature is.
 *
 * `emit.animationRules` writes one rule and one `@keyframes` per DISTINCT reveal
 * index, and each block has four stops — `0%`, the dark edge, the lit edge,
 * `100%` — or three for step 0, which has no dark edge. So the ADDRESSING
 * reading costs exactly what the program already costs: O(beats), because
 * flattening a tree does not create reveal indices, it only renames them.
 *
 * INDEPENDENT LOOPING COSTS THE LCM. A clip of period p inside a document whose
 * cycle is L pulses L/p times per cycle, and a pulse is an on/off pair, so every
 * element of that clip needs 2·(L/p) stops instead of 2. Clips of 7, 11 and 13
 * steps give L = 1001 and an element of the 7-clip needs 143 pulses — 286 stops
 * in one keyframes block, against 4. `test/nested.test.ts` computes both on the
 * same tree so the ratio is measured rather than asserted.
 *
 * ── THE LCM IS AN ARTEFACT OF FLATTENING, NOT OF LOOPING ────────────────
 *
 * Worth stating because it changes what the number below means. An independent
 * loop does NOT need the LCM if the nesting stays in the DOM: a `<g>` on its own
 * cycle containing children on theirs was measured holding both periods to the
 * millisecond with zero drift. The LCM appears only when the requirement is ONE
 * element per reveal on ONE clock, which is what flattening is.
 *
 * THE ONE-ELEMENT ESCAPE WAS MEASURED AND DOES NOT EXIST. A comma-separated
 * `animation` list — `animation: fast 800ms infinite, slow 3200ms infinite`,
 * both on `opacity` — would express two independent cycles on a single element
 * if the list composed multiplicatively. IT DOES NOT: the last animation in the
 * list simply wins. Against a true nested product built from the same two
 * keyframe sets in the same document, the single element agreed with its LAST
 * ANIMATION ALONE on 100% of samples and with the product on 87.7%; dark
 * fraction 0.340 for the list against 0.340 for the outer cycle by itself and
 * 0.462 for the product. So there is no way to multiply two opacity cycles on
 * one element short of `@property` and `calc()`, and `replay.ts` already
 * rejected registered custom properties on measured grounds — 4.6× the style
 * recalculation for a 9.4% byte saving.
 *
 * The choice is therefore between flat markup paying the LCM and nested markup
 * paying a per-composition selector. There is no third form.
 *
 * `periods` is the beat length of each independent clip; the addressing reading
 * ignores it entirely, which is the point.
 */
export function keyframeCost(
  tl: Timeline,
  periods?: ReadonlyMap<StepId, number>
): { addressing: { blocks: number; stops: number }; independent: { cycle: number; blocks: number; stops: number } } {
  const beats = beatCount(tl);
  // One block per distinct reveal index; four stops each, three for step 0.
  const addressing = { blocks: beats, stops: beats === 0 ? 0 : 3 + 4 * (beats - 1) };

  if (periods === undefined || periods.size === 0) {
    return { addressing, independent: { cycle: beats, ...addressing } };
  }
  // The flat cycle an independent-loop document has to be written on: a common
  // multiple of every clip's period AND of the root's own run of beats.
  //
  // SEEDED WITH THE ROOT'S OWN BEATS AND NOT WITH THE TOTAL, which is the
  // mistake the first version made and is worth writing down because the wrong
  // number is bigger and therefore looks like the more conservative one. Folding
  // the total beat count in gave lcm(31, 7, 11, 13) = 31 031 for three clips of
  // 7, 11 and 13 — but 31 is just 7 + 11 + 13, an artefact of how many beats
  // happen to be inside the clips, and a document's cycle cannot depend on a sum
  // it never plays as a run. The root here has NO beats of its own, so the cycle
  // is lcm(7, 11, 13) = 1001.
  const rootBeats = tl.reduce((n, s) => (s.kind === "beat" ? n + 1 : n), 0);
  const lengths = [...periods.values()].filter((n) => n > 0);
  const cycle = lengths.reduce(lcm, Math.max(1, rootBeats));
  let stops = 0;
  let blocks = 0;
  const walk = (steps: Timeline, period: number): void => {
    for (const s of steps) {
      if (s.kind === "comp") {
        walk(s.steps, periods.get(s.id) ?? period);
        continue;
      }
      blocks += 1;
      // Every repeat of the clip inside the flat cycle is one on/off pulse, and
      // a pulse is two stops. Plus the `0%`/`100%` anchors the block needs.
      stops += 2 + 2 * Math.max(1, Math.floor(cycle / Math.max(1, period)));
    }
  };
  walk(tl, cycle);
  return { addressing, independent: { cycle, blocks, stops } };
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
const lcm = (a: number, b: number): number => (a / gcd(a, b)) * b;
