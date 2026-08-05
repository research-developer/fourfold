/**
 * NESTED TIMELINES, measured. The verdict this file reaches:
 *
 *   1. NESTING LOCALISES RENUMBERING ONLY IF THE STORED THING IS A NAME. A
 *      positional path is still an ordinal and still moves. What survives every
 *      insertion is a minted id, and the stability matrix below is the evidence
 *      — including the case that fails, which is the one worth having.
 *
 *   2. IT RENDERS, and the objection a reader would reach for does not apply.
 *      The browser numbers are in `nested.ts`'s header; what is pinned here is
 *      the invariant those numbers depend on — a composition never reveals after
 *      a step it contains, so the product of thresholds is the threshold the
 *      model meant.
 *
 *   3. AUTO-GROUPING IS BOUNDED BY REUSE, not by a cap. Editing one step five
 *      times gives depth 1, and the rule is a function of the document.
 *
 *   4. MERGE AND GROUP ARE NOT INVERSES AND ARE NOT ON THE SAME AXIS. `ungroup`
 *      is `group`'s inverse and the round trip is asserted on the tree. Merge is
 *      not invertible at all, and the asymmetry is measured with the real
 *      `frames.mergeActs` rather than described.
 *
 *   5. THE TREE SURVIVES LIVING BESIDE THE JOURNAL, including across the case
 *      that was named as the risk to it: a merge whose range contains a `place`
 *      move. It survives because `rebaseTree` is index arithmetic over
 *      `Beat.act` and CANNOT SEE A MOVE AT ALL — asserted by rebasing two
 *      journals of the same length, one with a reorder in the merged range and
 *      one without, and comparing the trees character for character. What it
 *      does not keep is a wrapper every beat of which fell inside the range;
 *      that is measured too, and left standing as a name that dangles rather
 *      than fixed into a number that is wrong.
 *
 *   6. A REVISION REMEMBERS BOTH HALVES. `frames.Revision` is `{session,
 *      timeline}`, because remembering only the session restored a six-rung
 *      journal beside a four-beat tree and dropped two gestures from the
 *      animation. The defect's arithmetic and its repair are asserted in the
 *      same test, so neither can be read without the other.
 */

import { describe, expect, it } from "vitest";
import {
  act,
  addLayer,
  arrange,
  find,
  fromPlate,
  layerId,
  newSession,
  NO_GESTURE,
  select,
  type Act,
  type Composition,
  type Move,
  type Session,
} from "../src/lib/layers";
import {
  mergeActs,
  mergeFrames,
  NO_REVISIONS,
  redoRevision,
  remember,
  undoRevision,
} from "../src/lib/frames";
import { serialise, type EmitDoc, type EmitLayer } from "../src/lib/emit";
import { buildHexagon } from "../src/lib/hexagon";
import type { ArtCell } from "../src/lib/strokes";
import { addressBook, planPlateEdits, type Address, type AddressBook } from "../src/lib/plate";
import {
  beatCount,
  compile,
  rootOrder,
  depth,
  flatten,
  group,
  groupFor,
  innermost,
  insertHold,
  keyframeCost,
  rebaseTree,
  resolve,
  stepId,
  timelineOf,
  ungroup,
  wellOrdered,
  type Beat,
  type Step,
  type StepId,
  type Timeline,
} from "../src/lib/nested";

// ── a tree to measure ────────────────────────────────────────────────────

const beat = (n: number, act: number): Beat => ({ kind: "beat", id: stepId(n), act });

/**
 * root: [ b0, D=[b1, b2], C=[b3, b4, b5], b6 ]
 *
 * TWO sibling compositions, because the interesting insertion sites are "inside
 * my own composition" and "inside somebody else's" and a tree with one
 * composition cannot tell them apart.
 */
const tree = (): Timeline => [
  beat(0, 0),
  { kind: "comp", id: stepId(100), steps: [beat(1, 1), beat(2, 2)] },
  { kind: "comp", id: stepId(200), steps: [beat(3, 3), beat(4, 4), beat(5, 5)] },
  beat(6, 6),
];

const D = stepId(100);
const C = stepId(200);
/** The probe: the middle step of the second composition. */
const PROBE = stepId(4);

/** Which act each flat beat plays, in play order. What the viewer sees. */
function acts(tl: Timeline): (number | null)[] {
  const out: (number | null)[] = [];
  const walk = (steps: Timeline): void => {
    for (const s of steps) {
      if (s.kind === "comp") walk(s.steps);
      else out.push(s.act);
    }
  };
  walk(tl);
  return out;
}

/** A positional path to `id`, the address scheme this module does NOT use. */
function path(tl: Timeline, id: StepId): number[] | null {
  const walk = (steps: Timeline, prefix: number[]): number[] | null => {
    for (let k = 0; k < steps.length; k++) {
      const s: Step = steps[k];
      if (s.id === id) return [...prefix, k];
      if (s.kind === "comp") {
        const hit = walk(s.steps, [...prefix, k]);
        if (hit !== null) return hit;
      }
    }
    return null;
  };
  return walk(tl, []);
}

// ── a real journal, for the sections that need one ──────────────────────

/**
 * A real journal, so the merges measured below are `frames.mergeFrames` and not
 * descriptions of it.
 *
 * The whole point of this section is that `rebaseTree` is being driven by a
 * splice a REAL rewrite performed, on a range that contains the one move kind
 * `frames.ts` spends its second-largest paragraph on — a `place`, which carries
 * a frozen `Layer` and which `arrange` emits as a `[remove, insert]` PAIR
 * sharing one object. A synthetic `timelineOf(Array.from(...))` cannot reach
 * that case, because it has no moves in it at all.
 */
const book: AddressBook = addressBook(buildHexagon(2));
const L1 = layerId(1);
const L2 = layerId(2);
const GOLD = "#aa8800";
const RED = "#cc0000";
const INK = "#111111";

const fresh = (): Session => newSession(fromPlate(new Map()));

/** A paint move planned against the composition as it stands. */
function paintMove(
  comp: Composition,
  layer: ReturnType<typeof layerId>,
  targets: Address[],
  colours: (string | null)[]
): Move {
  const l = find(comp, layer);
  if (l === null) throw new Error(`no layer ${layer}`);
  return {
    kind: "paint",
    layer,
    stroke: { edits: planPlateEdits(l.plate, book, targets, colours) },
    gesture: NO_GESTURE,
  };
}

const drew = (
  s: Session,
  targets: Address[],
  colours: (string | null)[],
  note: string,
  layer = L1
): Session => act(s, [paintMove(s.composition, layer, targets, colours)], note);

/**
 * Five acts, the middle one a REORDER.
 *
 *   0  paint into L1
 *   1  add L2
 *   2  reorder L1 above L2   ← `[place remove, place insert]`, one frozen Layer
 *   3  paint into L1
 *   4  paint into L2
 *
 * The notes are all distinct, because "the tree still names the same work" is
 * asserted on what each rung SAYS rather than on an index that would still line
 * up if the work behind it had moved.
 */
function withAPlace(): Session {
  let s = fresh();
  s = drew(s, ["s0:AA"], [GOLD], "paint under");
  s = addLayer(s); // adds L2 and selects it
  s = { ...s, composition: select(s.composition, L1) };
  const moved = arrange(s, "up");
  if (!moved.ok) throw new Error(moved.said);
  s = moved.value;
  s = drew(s, ["s0:AB"], [RED], "paint after");
  s = drew(s, ["s0:AC"], [INK], "into L2", L2);
  return s;
}

/** The same five rungs with NO structural move: five plain paints. */
function withNoPlace(): Session {
  let s = fresh();
  const cells: Address[] = ["s0:AA", "s0:AB", "s0:AC", "s0:AX", "s0:BA"];
  const notes = ["paint under", "second", "third", "paint after", "into L2"];
  cells.forEach((c, k) => {
    s = drew(s, [c], [GOLD], notes[k]);
  });
  return s;
}

/** What each beat of a tree NAMES in a journal: the rung's note, in play order. */
function notesOf(tl: Timeline, past: readonly Act[]): (string | null)[] {
  return acts(tl).map((a) => (a === null ? null : (past[a]?.note ?? "DANGLING")));
}

// ── 1. does nesting localise renumbering? ────────────────────────────────

describe("the flat index is derived, and it moves", () => {
  it("flattens pre-order, contiguously, with a composition taking no beat of its own", () => {
    const tl = tree();
    const { order, indexOf } = flatten(tl);
    expect(order.length).toBe(7);
    expect(acts(tl)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    // The composition reveals with its FIRST step and consumes nothing. That is
    // what makes grouping beat-count-preserving; see `Comp`.
    expect(indexOf.get(C)).toBe(indexOf.get(stepId(3)));
    expect(indexOf.get(D)).toBe(indexOf.get(stepId(1)));
    expect(beatCount(tl)).toBe(7);
  });

  it("a composition never reveals after a step it contains", () => {
    // The precondition the browser measurement turns on: a child revealing
    // before its ancestor is silently clamped up to the ancestor's time, so a
    // tree violating this animates differently from the model that wrote it.
    expect(wellOrdered(tree())).toBe(true);
    expect(wellOrdered(insertHold(tree(), C, 0, stepId(900)))).toBe(true);
    expect(wellOrdered(insertHold(tree(), null, 0, stepId(901)))).toBe(true);
  });
});

/**
 * THE STABILITY MATRIX. Five insertion sites, three candidate addresses.
 *
 * This is the load-bearing measurement of the whole design, and it is stated as
 * a table rather than as five assertions because the SHAPE of the answer is the
 * finding: the flat index and the positional path each survive some insertions
 * and not others, and only the minted name survives all five.
 */
describe("what survives a hold inserted somewhere else", () => {
  const sites: {
    what: string;
    insert: (tl: Timeline) => Timeline;
    /** Does the probe's FLAT index move? */
    flatMoves: boolean;
    /** Does the probe's POSITIONAL path move? */
    pathMoves: boolean;
  }[] = [
    {
      what: "at the root, before everything",
      insert: (tl) => insertHold(tl, null, 0, stepId(900)),
      flatMoves: true,
      pathMoves: true,
    },
    {
      what: "at the root, after everything",
      insert: (tl) => insertHold(tl, null, 4, stepId(901)),
      flatMoves: false,
      pathMoves: false,
    },
    {
      what: "inside an EARLIER SIBLING composition",
      insert: (tl) => insertHold(tl, D, 0, stepId(902)),
      flatMoves: true,
      // A sibling's insides are a different composition, so the path is intact.
      pathMoves: false,
    },
    {
      what: "inside the probe's OWN composition, before it",
      insert: (tl) => insertHold(tl, C, 0, stepId(903)),
      flatMoves: true,
      pathMoves: true,
    },
    {
      what: "inside the probe's OWN composition, after it",
      insert: (tl) => insertHold(tl, C, 3, stepId(904)),
      flatMoves: false,
      pathMoves: false,
    },
  ];

  for (const site of sites) {
    it(`a hold ${site.what}: the NAME always still names act 4`, () => {
      const before = tree();
      const after = site.insert(before);

      const wasFlat = resolve(before, PROBE) as number;
      const nowFlat = resolve(after, PROBE) as number;
      expect(wasFlat).toBe(4);

      // The flat index moves exactly when the hold lands before the probe in
      // play order — which is what "emitting holds renumbers every beat after
      // the first" means, restated on the tree.
      expect(nowFlat !== wasFlat).toBe(site.flatMoves);

      // The positional path is an ORDINAL and moves on a strict subset of those.
      const wasPath = path(before, PROBE) as number[];
      const nowPath = path(after, PROBE) as number[];
      expect(JSON.stringify(nowPath) !== JSON.stringify(wasPath)).toBe(site.pathMoves);

      // THE CLAIM. Whatever moved, the minted name still resolves to a beat that
      // plays the same act. That is the whole of "nesting localises renumbering"
      // and it is a property of the NAME, not of the nesting.
      expect(acts(after)[nowFlat]).toBe(4);
      expect(acts(before)[wasFlat]).toBe(4);
    });
  }

  it("the hold is a beat with no act, and the journal never grew", () => {
    const before = tree();
    const after = insertHold(before, C, 1, stepId(905));
    expect(beatCount(after)).toBe(beatCount(before) + 1);
    // A hold references no act. `Journal.past` is untouched, so every index into
    // it still names what it named — which is why this composes with `frames.ts`.
    expect(acts(after)).toEqual([0, 1, 2, 3, null, 4, 5, 6]);
    expect(acts(after).filter((a) => a !== null)).toEqual(acts(before));
  });

  it("REFUTES the strong form: nesting alone does NOT localise renumbering", () => {
    // A hold at the root still renumbers every root-level beat after it. So the
    // mechanism does not by itself solve the problem — the POLICY of pushing the
    // insertion into a sub-composition is what keeps it off the root, which is
    // exactly why (A) and (B) are not alternatives.
    const before = tree();
    const after = insertHold(before, null, 1, stepId(906));
    expect(resolve(before, stepId(6))).toBe(6);
    expect(resolve(after, stepId(6))).toBe(7);
  });
});

// ── 3. what auto-grouping costs ──────────────────────────────────────────

describe("auto-grouping on a past edit", () => {
  it("wraps a step without changing how many beats the drawing has", () => {
    const before = tree();
    const at = (path(before, PROBE) as number[]).pop() as number;
    const after = group(before, C, at, 1, stepId(300)) as Timeline;
    expect(after).not.toBeNull();
    // Grouping is BEAT-COUNT-PRESERVING. A composition takes no beat of its own,
    // so wrapping changes the tree and not the animation.
    expect(beatCount(after)).toBe(beatCount(before));
    expect(acts(after)).toEqual(acts(before));
    expect(resolve(after, PROBE)).toBe(resolve(before, PROBE));
  });

  it("then a hold inside the new group leaves every sibling name put", () => {
    const before = tree();
    const wrapped = group(before, C, 1, 1, stepId(300)) as Timeline;
    const held = insertHold(wrapped, stepId(300), 1, stepId(907));
    // The root's later step still resolves to its own act, and the sibling
    // inside C after the group does too — only the flat NUMBERS moved.
    expect(acts(held)[resolve(held, stepId(6)) as number]).toBe(6);
    expect(acts(held)[resolve(held, stepId(5)) as number]).toBe(5);
    expect(beatCount(held)).toBe(beatCount(before) + 1);
  });

  it("editing the same step five times gives depth 1, not five", () => {
    let tl: Timeline = tree();
    let made = 0;
    for (let n = 0; n < 5; n++) {
      const got = groupFor(tl, PROBE, stepId(400 + n));
      expect(got).not.toBeNull();
      tl = (got as { tree: Timeline }).tree;
      if ((got as { made: boolean }).made) made += 1;
      // Every edit after the first goes INTO the wrapper the first one made.
      expect(innermost(tl, PROBE)).toBe(stepId(400));
    }
    expect(made).toBe(1);
    expect(depth(tl)).toBe(2); // C, and the wrapper inside it. Never six.
    expect(beatCount(tl)).toBe(7);
  });

  it("grouping two different steps makes two wrappers, not two levels", () => {
    let tl: Timeline = tree();
    tl = (groupFor(tl, stepId(3), stepId(500)) as { tree: Timeline }).tree;
    tl = (groupFor(tl, stepId(5), stepId(501)) as { tree: Timeline }).tree;
    expect(depth(tl)).toBe(2);
    expect(beatCount(tl)).toBe(7);
    expect(acts(tl)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});

describe("the tree beside a journal that moves", () => {
  it("a frame EDIT is the identity on the tree", () => {
    const tl = timelineOf(Array.from({ length: 5 }, () => ({ moves: [], note: "", events: 0 })));
    // `frames.editFrame` is always count 1 replaced by 1.
    expect(acts(rebaseTree(tl, 2, 1, 1))).toEqual(acts(tl));
  });

  it("a MERGE shifts every act index above it and collapses the range", () => {
    const tl = timelineOf(Array.from({ length: 6 }, () => ({ moves: [], note: "", events: 0 })));
    // frames 1..3 merged into one rung: past goes 6 -> 4.
    const after = rebaseTree(tl, 1, 3, 1);
    expect(acts(after)).toEqual([0, 1, 2, 3]);
    expect(beatCount(after)).toBe(4);
  });

  it("a hold inside a merged range SURVIVES the merge", () => {
    const flat = timelineOf(Array.from({ length: 4 }, () => ({ moves: [], note: "", events: 0 })));
    const held = insertHold(flat, null, 2, stepId(908));
    // A hold references no act, so a merge of the gestures around it is not a
    // statement about it and it is not coalesced away.
    const after = rebaseTree(held, 1, 2, 1);
    expect(acts(after)).toEqual([0, 1, null, 2]);
  });

  it("USED TO DESYNCHRONISE from frames.Revisions, and no longer can", () => {
    // THE DEFECT, first, because the arithmetic that caused it has not changed
    // and is what a reader has to see to know the repair is a repair. A merge
    // takes the tree to four beats naming acts 0…3 while the journal a revision
    // restores has six rungs — so acts 4 and 5 would have no beat at all.
    const past = Array.from({ length: 6 }, () => ({ moves: [], note: "", events: 0 }));
    const tl = timelineOf(past);
    const merged = rebaseTree(tl, 1, 3, 1); // the journal is now 4 long
    const highest = Math.max(...(acts(merged).filter((a) => a !== null) as number[]));
    expect(highest).toBe(3);
    expect(highest).toBeLessThan(past.length - 1);

    // THE REPAIR. `frames.Revision` is `{session, timeline}` — both halves of
    // what a rewrite moves, in one remembered value — so an undo that restores
    // the six-rung journal restores the six-beat tree in the same call. It is
    // not possible to save one and not the other: the key is required, and the
    // pair comes back together or `undoRevision` answers `null`.
    const s = withAPlace();
    const before = timelineOf(s.journal.past);
    const done = mergeFrames(s, 1, 3, "merged");
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    const live = { session: done.value.session, timeline: rebaseTree(before, 1, 3, 1) };
    const back = undoRevision(
      remember(NO_REVISIONS, { session: s, timeline: before }),
      live
    );
    expect(back).not.toBeNull();
    if (back === null) return;
    expect(back.session.journal.past).toHaveLength(5);
    expect(beatCount(back.timeline as Timeline)).toBe(5);
    expect(notesOf(back.timeline as Timeline, back.session.journal.past)).toEqual(
      back.session.journal.past.map((a) => a.note)
    );
    // And forward again gives back the merged pair, not a half of it.
    const forward = redoRevision(back.revisions, back);
    expect(forward).not.toBeNull();
    if (forward === null) return;
    expect(forward.session.journal.past).toHaveLength(3);
    expect(beatCount(forward.timeline as Timeline)).toBe(3);
  });
});

// ── the tree across a REAL merge, with a `place` inside the range ────────

describe("a merge whose range contains a place move", () => {
  it("is the journal the assertions below claim it is", () => {
    // The fixture guarding itself, on `frames.test.ts`' own rule: everything
    // after this is worthless if act 2 is not really a reorder carrying a
    // photograph of a plate.
    const s = withAPlace();
    expect(s.journal.past).toHaveLength(5);
    const pair = s.journal.past[2].moves;
    expect(pair.map((m) => m.kind)).toEqual(["place", "place"]);
    if (pair[0].kind !== "place" || pair[1].kind !== "place") return;
    expect(pair[0].op).toBe("remove");
    expect(pair[1].op).toBe("insert");
    // ONE object, shared by the two halves — the fact `frames.rebaseAct` keeps a
    // per-act `frozen` map for.
    expect(pair[0].node).toBe(pair[1].node);
    expect([...pair[0].node.plate.entries()]).toEqual([["s0:AA", GOLD]]);
  });

  it("THE RISK: the tree survives it, and names each new rung exactly once", () => {
    const s = withAPlace();
    const before = timelineOf(s.journal.past);
    expect(notesOf(before, s.journal.past)).toEqual([
      "paint under",
      "added Layer 2",
      "moved Layer 1 up",
      "paint after",
      "into L2",
    ]);

    // Frames 1..3 — add, reorder, paint — coalesced into one rung.
    const done = mergeFrames(s, 1, 3, "merged");
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    const past = done.value.session.journal.past;

    // THE ARITHMETIC `rebaseTree` ASSUMES, checked against the real rewrite
    // rather than assumed: n acts out, one in, nothing else added or dropped.
    // A `place` in the range does not change the length of the splice.
    expect(past).toHaveLength(5 - 3 + 1);
    expect(done.value.replaced).toHaveLength(3);
    // And the reorder really did survive the fold: three structural moves in one
    // rung, both frozen nodes re-read, and L1 still above L2.
    const merged = past[1];
    expect(merged.moves.filter((m) => m.kind === "place")).toHaveLength(3);
    expect(done.value.session.composition.layers.map((l) => l.id)).toEqual([L2, L1]);
    // NOTHING WAS RE-FROZEN, and that is the measurement rather than the
    // expectation this test was written with. `refrozen` counts photographs of
    // a plate that no longer matches the live tree, and a MERGE rewrites no act
    // BELOW the frozen node — act 0 is outside the range and is replayed
    // nowhere — so the photograph is still accurate and `frames.rebaseAct`
    // keeps it. A merge is not the operation that stales a `place`; an EDIT of
    // an earlier frame is, which is what `test/frames.test.ts` measures.
    expect(done.value.report.refrozen).toBe(0);

    const after = rebaseTree(before, 1, 3, 1);
    // ONE BEAT PER RUNG, in order, naming the same work. This is the whole
    // verdict: no dangling index, no rung without a beat, no beat without a
    // rung.
    expect(acts(after)).toEqual([0, 1, 2]);
    expect(notesOf(after, past)).toEqual(past.map((a) => a.note));
    expect(notesOf(after, past)).toEqual(["paint under", "merged", "into L2"]);
    // The minted names of the beats OUTSIDE the range are untouched, which is
    // the property the whole addressing scheme exists for.
    expect(resolve(after, stepId(0))).toBe(0);
    expect(resolve(after, stepId(4))).toBe(2);
  });

  it("and it survives it because `rebaseTree` cannot see a move at all", () => {
    // THE SHARP FORM OF THE VERDICT. `rebaseTree` is index arithmetic over
    // `Beat.act`; the moves inside a rung are not an input to it. So the tree a
    // journal WITH a reorder in the merged range rebases to is the same tree a
    // journal of five plain paints rebases to, character for character.
    const withPlace = timelineOf(withAPlace().journal.past);
    const without = timelineOf(withNoPlace().journal.past);
    expect(JSON.stringify(rebaseTree(withPlace, 1, 3, 1))).toBe(
      JSON.stringify(rebaseTree(without, 1, 3, 1))
    );
    // Both journals really are five rungs, so the equality above is about the
    // tree and not about two different-sized inputs agreeing by accident.
    expect(withAPlace().journal.past).toHaveLength(5);
    expect(withNoPlace().journal.past).toHaveLength(5);
  });

  it("a group and a hold over the merged range survive it too", () => {
    const s = withAPlace();
    // The composite case: the range the merge will eat is wrapped in a
    // sub-composition, and a hold the person authored sits inside it.
    const wrapped = group(timelineOf(s.journal.past), null, 1, 3, stepId(950)) as Timeline;
    expect(wrapped).not.toBeNull();
    const held = insertHold(wrapped, stepId(950), 1, stepId(951));
    expect(beatCount(held)).toBe(6);

    const done = mergeFrames(s, 1, 3, "merged");
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    const past = done.value.session.journal.past;

    const after = rebaseTree(held, 1, 3, 1);
    // The wrapper is still there, still holding the surviving beat and the hold
    // — a merge of the gestures around a hold is not a statement about the hold.
    expect(depth(after)).toBe(1);
    expect(acts(after)).toEqual([0, 1, null, 2]);
    expect(notesOf(after, past)).toEqual(["paint under", "merged", null, "into L2"]);
    // Every name still resolves: nothing the person authored dangles.
    for (const id of [stepId(0), stepId(4), stepId(950), stepId(951)]) {
      expect(resolve(after, id)).not.toBeNull();
    }
    expect(wellOrdered(after)).toBe(true);
  });

  it("MEASURED AND LEFT STANDING: a wrapper emptied by a merge becomes a dangling name", () => {
    // The one thing the merge repair does NOT keep, found while measuring the
    // case above and written down rather than quietly fixed. It is not about
    // `place` — it is about a composition ALL of whose beats fall inside the
    // merged range. The first survivor is kept, so a wrapper over the range
    // keeps one beat; a wrapper over a PROPER SUBSET of the range that does not
    // contain the first survivor keeps none, and an empty composition resolves
    // to `null` — `Comp` has no beat of its own to take an index from.
    const s = withAPlace();
    const wrapped = group(timelineOf(s.journal.past), null, 2, 2, stepId(960)) as Timeline;
    expect(wrapped).not.toBeNull();
    const after = rebaseTree(wrapped, 1, 3, 1);
    expect(acts(after)).toEqual([0, 1, 2]);
    // The wrapper is still IN the tree and names nothing. `resolve` answering
    // `null` is the documented failure mode of addressing (see `resolve`), so
    // this is a name that dangles rather than a number that is wrong — which is
    // the difference the whole design was chosen for.
    expect(resolve(after, stepId(960))).toBeNull();
    expect(JSON.stringify(after)).toContain(stepId(960));
    // It costs nothing in the animation: an empty composition contributes no
    // beat and no time, so the drawing plays exactly as the flat tree does.
    expect(beatCount(after)).toBe(3);
    expect(wellOrdered(after)).toBe(true);
  });
});

// ── 4. are merge and group inverses? ─────────────────────────────────────

describe("merge and group are NOT inverses", () => {
  it("ungroup is group's exact inverse, on the tree", () => {
    const before = tree();
    const grouped = group(before, C, 0, 2, stepId(600)) as Timeline;
    expect(grouped).not.toBeNull();
    expect(depth(grouped)).toBe(2);
    const back = ungroup(grouped, stepId(600)) as Timeline;
    // Structural equality, not a count: the round trip is the identity.
    expect(JSON.stringify(back)).toBe(JSON.stringify(before));
  });

  it("group preserves the beat count; merge reduces it — different axes", () => {
    const before = tree();
    const grouped = group(before, C, 0, 2, stepId(601)) as Timeline;
    expect(beatCount(grouped)).toBe(beatCount(before)); // 7 -> 7
    const merged = rebaseTree(before, 3, 2, 1);
    expect(beatCount(merged)).toBe(beatCount(before) - 1); // 7 -> 6
  });

  it("MERGE IS NOT INVERTIBLE: the real mergeActs destroys the middle state", () => {
    const L = layerId(1);
    const cell: Address = "s0:AA";
    const paint = (from: string | null, to: string | null): Act => ({
      moves: [
        {
          kind: "paint",
          layer: L,
          stroke: { edits: [{ cell, from, to }] },
          gesture: {},
        } as Move,
      ],
      note: "paint",
      events: 1,
    });

    const first = paint(null, "#aa8800");
    const second = paint("#aa8800", "#cc2222");
    const { act, report } = mergeActs([first, second], "merged");

    expect(report.frames).toBe(2);
    expect(report.coalesced).toBe(1);

    const move = act.moves[0] as Extract<Move, { kind: "paint" }>;
    expect(act.moves.length).toBe(1);
    expect(move.stroke.edits.length).toBe(1);
    // THE ASYMMETRY, in one assertion. `mergeEdits` keeps the FIRST `from` and
    // the LAST `to`, so the gold the drawing passed through is simply gone. The
    // merged act cannot be split back into the two that made it, because the
    // information a split would need is not in it. `ungroup` needs no
    // information at all — the steps it restores were never altered.
    expect(move.stroke.edits[0]).toEqual({ cell, from: null, to: "#cc2222" });
    expect(JSON.stringify(act).includes("aa8800")).toBe(false);
  });

  it("and merge can drop a rung entirely, which group can never do", () => {
    const L = layerId(1);
    const cell: Address = "s0:AB";
    const paint = (from: string | null, to: string | null): Act => ({
      moves: [
        { kind: "paint", layer: L, stroke: { edits: [{ cell, from, to }] }, gesture: {} } as Move,
      ],
      note: "paint",
      events: 1,
    });
    // Painted and painted back: `mergeEdits` drops the no-op, so two frames of
    // real work merge to an act that paints nothing at all.
    const { act } = mergeActs([paint(null, "#aa8800"), paint("#aa8800", null)], "merged");
    const move = act.moves[0] as Extract<Move, { kind: "paint" }>;
    expect(move.stroke.edits.length).toBe(0);
  });
});

// ── the compiler: nested model, one flat clock ───────────────────────────

const TEMPO = { stepMs: 250, holdMs: 1800, fadeMs: 90 };

/** A minimal document the real emitter will serialise. Synthetic congruent cells. */
function docWith(reveals: readonly number[]): EmitDoc {
  const cells = new Map<number, ArtCell>();
  for (let i = 0; i < 8; i++) {
    const x = i * 10;
    cells.set(i, { verts: [[x, 0], [x + 10, 0], [x + 5, 8]] });
  }
  const layers: EmitLayer[] = reveals.map((r, k) => ({
    id: `s${k}`,
    reveal: r,
    paint: new Map([[k, "#aa8800"]]),
  }));
  return {
    width: 80,
    height: 8,
    cells,
    shown: [0, 1, 2, 3, 4, 5, 6, 7],
    background: "#0a0908",
    unpainted: "#141110",
    tileSeam: null,
    paintSeam: null,
    seamWidth: 0.7,
    weldPaint: false,
    title: "compile probe",
    layers,
    overlay: [],
    animation: { ...TEMPO, steps: reveals.length },
    payload: {
      version: 1,
      canvas: "hexagon",
      depth: 1,
      convention: "apex",
      cells: reveals.map((_, k): [number, string] => [k, "#aa8800"]),
    },
  };
}

describe("compiling a nested model onto one flat clock", () => {
  it("MIGRATION: an unnested composition compiles to today's numbers", () => {
    const flat = timelineOf(Array.from({ length: 6 }, () => ({ moves: [], note: "", events: 0 })));
    const c = compile(flat, TEMPO);
    // `emit.animationRules`: a keyframe sits at `k * stepMs`, and the cycle is
    // `steps * stepMs + holdMs`. Both restated by the compiler, not reinvented.
    expect(c.reveals.map((r) => r.at)).toEqual([0, 250, 500, 750, 1000, 1250]);
    expect(c.reveals.map((r) => r.index)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(c.cycle).toBe(6 * 250 + 1800);
  });

  it("MIGRATION, ON BYTES: the real emitter writes the same file either way", () => {
    const flat = timelineOf(Array.from({ length: 6 }, () => ({ moves: [], note: "", events: 0 })));
    const c = compile(flat, TEMPO);
    const today = serialise(docWith([0, 1, 2, 3, 4, 5]));
    const compiled = serialise(docWith(c.reveals.map((r) => r.index)));
    // The migration guarantee, asserted where it actually matters: not on a
    // formula, on the bytes the program ships.
    expect(compiled).toBe(today);
    // And the cycle the compiler computed is the cycle the emitter wrote, read
    // back out of the CSS rather than assumed.
    const said = /animation-duration: (\d+)ms/.exec(today);
    expect(said).not.toBeNull();
    expect(Number((said as RegExpExecArray)[1])).toBe(c.cycle);
  });

  it("LOCALISATION: a hold inside a child leaves every parent-level ordinal alone", () => {
    const before = tree();
    const after = insertHold(before, C, 1, stepId(910));
    // The parent-level ordinals are the root's own steps. A composition occupies
    // ONE of them whatever it contains, so nothing inside can move this list.
    expect(rootOrder(after)).toEqual(rootOrder(before));
    // And the root-level start times before the edited composition are untouched.
    const a = compile(before, TEMPO);
    const b = compile(after, TEMPO);
    expect(b.rootAt.get(stepId(0))).toBe(a.rootAt.get(stepId(0)));
    expect(b.rootAt.get(D)).toBe(a.rootAt.get(D));
    expect(b.rootAt.get(C)).toBe(a.rootAt.get(C));
  });

  it("THE CONSERVATION LAW: extend shifts the parent, within shifts the child", () => {
    const before = tree();
    // Insert at the END of C, so every existing child step is UPSTREAM of it.
    const after = insertHold(before, C, 3, stepId(911));

    // "extend": the child keeps its tempo, its slot grows, and the root step
    // AFTER the edited composition moves later by exactly one stepMs.
    const ea = compile(before, TEMPO, "extend");
    const eb = compile(after, TEMPO, "extend");
    const upstream = (c: typeof ea, id: StepId) =>
      (c.reveals.find((r) => r.id === id) as { at: number }).at;
    expect(upstream(eb, stepId(3))).toBe(upstream(ea, stepId(3)));
    expect(upstream(eb, stepId(5))).toBe(upstream(ea, stepId(5)));
    expect((eb.rootAt.get(stepId(6)) as number) - (ea.rootAt.get(stepId(6)) as number)).toBe(
      TEMPO.stepMs
    );
    expect(eb.cycle - ea.cycle).toBe(TEMPO.stepMs);

    // "within": every parent time is pinned, and the child's own UPSTREAM steps
    // speed up to pay for the hold — the half of the brief's property that
    // cannot hold.
    const wa = compile(before, TEMPO, "within");
    const wb = compile(after, TEMPO, "within");
    expect(wb.rootAt.get(stepId(6))).toBe(wa.rootAt.get(stepId(6)));
    expect(wb.cycle).toBe(wa.cycle);
    expect(upstream(wb, stepId(5))).not.toBe(upstream(wa, stepId(5)));
    // And it leaves the integer discipline the moment the beat count does not
    // divide the slot. C holds three steps compressed into one 250 ms beat, so
    // the tempo is 250/3 and the reveal times are not whole milliseconds —
    // against `replay.animationTiming`'s "integers throughout".
    expect(compile(before, TEMPO, "within").reveals.some((r) => !Number.isInteger(r.at))).toBe(
      true
    );
    // THE MODE INTRODUCES THE FLOAT, not the tree: the same tree under
    // "extend" is whole milliseconds throughout, because nothing is ever
    // divided — every step is one `stepMs` and the slots are sums of them.
    expect(compile(before, TEMPO, "extend").reveals.every((r) => Number.isInteger(r.at))).toBe(
      true
    );
    expect(compile(after, TEMPO, "extend").reveals.every((r) => Number.isInteger(r.at))).toBe(
      true
    );
  });

  it("GROUPING IS COMPILE-INVARIANT under extend, and destructive under within", () => {
    const before = tree();
    const grouped = group(before, C, 0, 2, stepId(920)) as Timeline;

    // THE ARGUMENT FOR THE DEFAULT. Auto-grouping is applied for the person
    // rather than by them, so it must not be visible in the animation.
    const a = compile(before, TEMPO, "extend");
    const b = compile(grouped, TEMPO, "extend");
    expect(b.reveals.map((r) => [r.id, r.at])).toEqual(a.reveals.map((r) => [r.id, r.at]));
    expect(b.cycle).toBe(a.cycle);

    // Under "within" the same wrapping collapses two beats into one parent slot
    // and the region plays twice as fast — the invisible policy would be the
    // most visible edit in the program.
    const w = compile(grouped, TEMPO, "within");
    expect(w.cycle).not.toBe(a.cycle);
  });

  it("group-then-ungroup compiles to the identical flat timeline", () => {
    const before = tree();
    const grouped = group(before, C, 1, 2, stepId(921)) as Timeline;
    const back = ungroup(grouped, stepId(921)) as Timeline;
    const a = compile(before, TEMPO);
    const c = compile(back, TEMPO);
    expect(c.reveals).toEqual(a.reveals);
    expect(c.cycle).toBe(a.cycle);
  });
});

// ── what independent looping would cost ──────────────────────────────────

describe("the two readings of nested, priced", () => {
  it("addressing costs what the program already costs: O(beats)", () => {
    const tl = tree();
    const { addressing } = keyframeCost(tl);
    expect(addressing.blocks).toBe(7);
    // Four stops a block, three for step 0 — `emit.animationRules`' own shape.
    expect(addressing.stops).toBe(3 + 4 * 6);
    // Grouping does not create reveal indices, it renames them, so the cost of
    // the whole nesting feature under this reading is ZERO extra stylesheet.
    const grouped = group(tl, C, 0, 2, stepId(700)) as Timeline;
    expect(keyframeCost(grouped).addressing).toEqual(addressing);
  });

  it("independent looping costs the LCM, and the LCM explodes", () => {
    // Three clips of 7, 11 and 13 beats. lcm(7, 11, 13) = 1001.
    const clip = (id: number, n: number, from: number): Step => ({
      kind: "comp",
      id: stepId(id),
      steps: Array.from({ length: n }, (_, k) => beat(from + k, from + k)),
    });
    const tl: Timeline = [clip(800, 7, 0), clip(801, 11, 7), clip(802, 13, 18)];
    const periods = new Map<StepId, number>([
      [stepId(800), 7],
      [stepId(801), 11],
      [stepId(802), 13],
    ]);
    const { addressing, independent } = keyframeCost(tl, periods);

    expect(independent.cycle).toBe(1001);
    expect(addressing.blocks).toBe(31);
    expect(independent.blocks).toBe(31);
    // Same number of blocks, wildly different contents: an element of the 7-clip
    // pulses 143 times inside the flat cycle and needs 2 stops per pulse.
    expect(addressing.stops).toBe(3 + 4 * 30);
    expect(independent.stops).toBe(
      7 * (2 + 2 * 143) + 11 * (2 + 2 * 91) + 13 * (2 + 2 * 77)
    );
    // The ratio is the number that decides how big this feature is.
    expect(independent.stops / addressing.stops).toBeGreaterThan(40);
  });

  it("commensurate clips cost nothing extra — the blowup is arithmetic, not structural", () => {
    const clip = (id: number, n: number, from: number): Step => ({
      kind: "comp",
      id: stepId(id),
      steps: Array.from({ length: n }, (_, k) => beat(from + k, from + k)),
    });
    // 2, 4 and 8 divide 8, so the flat cycle is the document's own length.
    const tl: Timeline = [clip(810, 2, 0), clip(811, 4, 2), clip(812, 8, 6)];
    const periods = new Map<StepId, number>([
      [stepId(810), 2],
      [stepId(811), 4],
      [stepId(812), 8],
    ]);
    const { independent } = keyframeCost(tl, periods);
    expect(independent.cycle).toBe(8);
    // Still 7x the stops of addressing, but bounded — the cost is lcm/period and
    // nothing about the structure changed. A UI that only offered clip lengths
    // dividing the parent's would keep this affordable.
    expect(independent.stops).toBeLessThan(400);
  });
});
