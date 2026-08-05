/**
 * Editing the drawing's past, measured rather than described.
 *
 * The claims this file pins down are the ones the design turns on:
 *
 *   A REBASE KEEPS THE LATER WORK. That is the whole difference between what was
 *   asked for and what undo already does, so it is asserted first and asserted on
 *   the tree rather than on a count.
 *
 *   THE INTENT IS KEPT AND THE RECORD IS RE-READ. A later act still paints what it
 *   painted; every `from` it recorded is re-read from the drawing it now lands on.
 *   The consequence a naive rebase gets wrong — undo restoring a colour from
 *   before the edit — is asserted directly, because it is silent and it is the
 *   reason this file exists.
 *
 *   THE SPLIT CASE. An erase inside a coarse wash records three repaints whose
 *   colour was COPIED from the wash. Rewrite the wash and the copies must follow,
 *   and no `from` field anywhere mismatches, so nothing but the derived-write rule
 *   can catch it.
 *
 *   A `place` RUNG CARRIES A PHOTOGRAPH OF A PLATE. Reorder a layer after painting
 *   into it, then edit the paint, and the frozen node must be re-read or the
 *   reorder puts the pre-edit paint back.
 *
 *   A MERGED FRAME IS THE SAME WORK IN ONE RUNG, and its mark says what actually
 *   happened: every group concatenated when the modes agree, and NO mark at all
 *   when they do not.
 *
 * The Flash mapping is asserted where it is real — every act is a key or a hold,
 * and the classification agrees with the animation's own drop rule — and nowhere
 * else, because holds are not emitted and tweens are not built.
 */

import { describe, expect, it } from "vitest";
import { buildHexagon } from "../src/lib/hexagon";
import {
  addressBook,
  planPlateEdits,
  type Address,
  type AddressBook,
} from "../src/lib/plate";
import {
  act,
  addLayer,
  arrange,
  find,
  flatten,
  fromPlate,
  layerId,
  newSession,
  NO_GESTURE,
  select,
  undo,
  type Act,
  type Composition,
  type Move,
  type Session,
} from "../src/lib/layers";
import {
  beatCount,
  insertHold,
  rebaseTree,
  stepId,
  timelineOf,
  type Timeline,
} from "../src/lib/nested";
import { actStrokes, everyComposition, stepComposition } from "../src/lib/composer";
import { animationSteps } from "../src/lib/replay";
import { beatsOf } from "../src/lib/timeline";
import type { StrokeMark } from "../src/lib/strokes";
import {
  editFrame,
  frameKinds,
  frameLayers,
  framesTouching,
  holdCount,
  mergeActs,
  mergeFrames,
  NO_REVISIONS,
  recolourAct,
  redoRevision,
  remember,
  rewriteFrames,
  undoRevision,
} from "../src/lib/frames";

const book: AddressBook = addressBook(buildHexagon(2));
const L1 = layerId(1);
const L2 = layerId(2);

const GOLD = "#aa8800";
const RED = "#cc0000";
const BLUE = "#0000cc";
const INK = "#111111";

/** A paint move planned against the composition as it stands. */
function paint(
  comp: Composition,
  layer = L1,
  targets: Address[] = [],
  colours: (string | null)[] = [],
  mark?: StrokeMark<Address>
): Move {
  const l = find(comp, layer);
  if (l === null) throw new Error(`no layer ${layer}`);
  const edits = planPlateEdits(l.plate, book, targets, colours);
  return {
    kind: "paint",
    layer,
    stroke: mark === undefined ? { edits } : { edits, mark },
    gesture: NO_GESTURE,
  };
}

/** A one-move painting act, appended. */
function drew(
  s: Session,
  targets: Address[],
  colours: (string | null)[],
  note: string,
  mark?: StrokeMark<Address>,
  layer = L1
): Session {
  return act(s, [paint(s.composition, layer, targets, colours, mark)], note);
}

const fresh = (): Session => newSession(fromPlate(new Map()));

/** The colour a cell shows on the flattened board. */
const shows = (s: Session, a: Address): string | undefined =>
  flatten(s.composition, book).get(book.index.get(a) as number);

/** The addresses a layer's own plate holds, as a sorted list of pairs. */
const plateOf = (s: Session, id = L1): [Address, string][] => {
  const l = find(s.composition, id);
  if (l === null) throw new Error("no layer");
  return [...l.plate.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1));
};

/** Every state the journal can show, flattened. What `beatsOf` takes. */
const statesOf = (s: Session) =>
  everyComposition(s.composition, s.journal.past).map((c) => flatten(c, book));

// ── the fork ─────────────────────────────────────────────────────────────

describe("a rebase keeps the later work", () => {
  it("editing frame 0 leaves frames 1 and 2 in the journal", () => {
    let s = fresh();
    s = drew(s, ["s0:AA"], [GOLD], "one");
    s = drew(s, ["s0:AB"], [INK], "two");
    s = drew(s, ["s0:AC"], [RED], "three");

    const done = editFrame(s, 0, (a) => recolourAct(a, () => BLUE));
    expect(done.ok).toBe(true);
    if (!done.ok) return;

    expect(done.value.session.journal.past).toHaveLength(3);
    expect(done.value.session.journal.past.map((a) => a.note)).toEqual([
      "one",
      "two",
      "three",
    ]);
    expect(done.value.report.rebased).toBe(3);
    // The later strokes are still on the plate, unchanged.
    expect(shows(done.value.session, "s0:AA")).toBe(BLUE);
    expect(shows(done.value.session, "s0:AB")).toBe(INK);
    expect(shows(done.value.session, "s0:AC")).toBe(RED);
  });

  it("a later repaint still wins: the animation moves and the drawing does not", () => {
    let s = fresh();
    s = drew(s, ["s0:AA"], [GOLD], "gold");
    s = drew(s, ["s0:AB"], [INK], "filler");
    s = drew(s, ["s0:AA"], [RED], "red over it");
    expect(shows(s, "s0:AA")).toBe(RED);

    const done = editFrame(s, 0, (a) => recolourAct(a, () => BLUE));
    expect(done.ok).toBe(true);
    if (!done.ok) return;

    // THE FINISHED DRAWING IS UNCHANGED — `applyEdits` writes `to` and never
    // consults `from`, so frame 2 still wins the cell.
    expect(shows(done.value.session, "s0:AA")).toBe(RED);

    // THE ANIMATION IS NOT. The state after frame 0 is what moved, which is
    // exactly what "in case I want a particular animation" asks for.
    const past = done.value.session.journal.past;
    const after0 = stepComposition(done.value.session.composition, past, past.length, 1);
    expect(flatten(after0, book).get(book.index.get("s0:AA") as number)).toBe(BLUE);
  });

  it("the base of the journal is untouched by any rewrite", () => {
    let s = fresh();
    s = drew(s, ["s0:AA"], [GOLD], "one");
    s = drew(s, ["s0:AB"], [INK], "two");
    const before = stepComposition(s.composition, s.journal.past, s.journal.past.length, 0);

    const done = editFrame(s, 1, (a) => recolourAct(a, () => BLUE));
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    const past = done.value.session.journal.past;
    const after = stepComposition(done.value.session.composition, past, past.length, 0);
    expect(flatten(after, book)).toEqual(flatten(before, book));
  });
});

// ── the record is re-read ────────────────────────────────────────────────

describe("the intent is kept and the record is re-read", () => {
  it("undo after a rebase is exact — the defect a naive replay has", () => {
    let s = fresh();
    s = drew(s, ["s0:AA"], [GOLD], "gold");
    s = drew(s, ["s0:AA"], [RED], "red");

    const done = editFrame(s, 0, (a) => recolourAct(a, () => BLUE));
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    // Frame 1 recorded `from: GOLD` and the plate now holds BLUE at that point.
    expect(done.value.report.repaired).toBeGreaterThan(0);

    const back = undo(done.value.session);
    expect(back.act).not.toBeNull();
    // Without the repair this is GOLD — the colour from before the edit.
    expect(plateOf(back.session)).toEqual([["s0:AA", BLUE]]);
  });

  it("an edit that became a no-op is dropped, and the frame becomes a hold", () => {
    let s = fresh();
    s = drew(s, ["s0:AA"], [GOLD], "gold");
    s = drew(s, ["s0:AA"], [RED], "red");

    // Rewrite frame 0 to paint RED — frame 1 now has nothing left to do.
    const done = editFrame(s, 0, (a) => recolourAct(a, () => RED));
    expect(done.ok).toBe(true);
    if (!done.ok) return;

    expect(done.value.report.dropped).toBe(1);
    expect(done.value.report.quiet).toBe(1);
    const frame1 = done.value.session.journal.past[1];
    expect(frame1.moves).toHaveLength(1);
    const m = frame1.moves[0];
    expect(m.kind).toBe("paint");
    if (m.kind === "paint") expect(m.stroke.edits).toHaveLength(0);

    // And it holds rather than keying: no beat, but still an act.
    const kinds = frameKinds(statesOf(done.value.session));
    expect(kinds).toEqual(["key", "hold"]);
  });

  it("a stale rename is re-read from the live layer", () => {
    let s = fresh();
    s = act(s, [{ kind: "rename", layer: L1, from: "Layer 1", to: "sky" }], "rename 1");
    s = act(s, [{ kind: "rename", layer: L1, from: "sky", to: "sea" }], "rename 2");

    const done = editFrame(s, 0, () => ({
      moves: [{ kind: "rename", layer: L1, from: "Layer 1", to: "stone" }],
      note: "rename 1",
      events: 0,
    }));
    expect(done.ok).toBe(true);
    if (!done.ok) return;

    const second = done.value.session.journal.past[1].moves[0];
    expect(second.kind).toBe("rename");
    if (second.kind === "rename") {
      expect(second.from).toBe("stone");
      expect(second.to).toBe("sea");
    }
    // So undoing frame 1 gives back the name frame 0 actually left.
    expect(undo(done.value.session).session.composition.layers[0].name).toBe("stone");
  });

  it("a later act's mark rides through untouched", () => {
    const mark: StrokeMark<Address> = { mode: 6, groups: [["s0:AB", "s0:AC"]] };
    let s = fresh();
    s = drew(s, ["s0:AA"], [GOLD], "one");
    s = drew(s, ["s0:AB", "s0:AC"], [RED, RED], "two", mark);

    const done = editFrame(s, 0, (a) => recolourAct(a, () => BLUE));
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    const m = done.value.session.journal.past[1].moves[0];
    expect(m.kind).toBe("paint");
    if (m.kind === "paint") expect(m.stroke.mark).toEqual(mark);
  });
});

// ── the split case ───────────────────────────────────────────────────────

describe("a split write follows the wash it was copied from", () => {
  /**
   * The measurement the rule exists for. `planPlateEdits` cannot erase inside a
   * coarse wash by deleting an address that holds no paint of its own, so it
   * deletes the wash and repaints the siblings it covered — three writes whose
   * colour was COPIED from the wash. Every one of them records `from: null`, and
   * null is still what those addresses hold after a rewrite, so no `from` check
   * can see the problem.
   */
  it("the recorded stroke really is derived data", () => {
    let s = fresh();
    s = drew(s, ["s0:A"], [GOLD], "wash");
    const erase = paint(s.composition, L1, ["s0:AB"], [null]);
    expect(erase.kind).toBe("paint");
    if (erase.kind !== "paint") return;
    expect(erase.stroke.edits).toEqual([
      { cell: "s0:A", from: GOLD, to: null },
      { cell: "s0:AA", from: null, to: GOLD },
      { cell: "s0:AC", from: null, to: GOLD },
      { cell: "s0:AX", from: null, to: GOLD },
    ]);
  });

  it("rewriting the wash retargets the three repaints", () => {
    let s = fresh();
    s = drew(s, ["s0:A"], [GOLD], "wash");
    s = drew(s, ["s0:AB"], [null], "erase inside it");
    expect(plateOf(s)).toEqual([
      ["s0:AA", GOLD],
      ["s0:AC", GOLD],
      ["s0:AX", GOLD],
    ]);

    const done = editFrame(s, 0, (a) => recolourAct(a, () => BLUE));
    expect(done.ok).toBe(true);
    if (!done.ok) return;

    expect(done.value.report.retargeted).toBe(3);
    expect(plateOf(done.value.session)).toEqual([
      ["s0:AA", BLUE],
      ["s0:AC", BLUE],
      ["s0:AX", BLUE],
    ]);
    // And the erased cell is still erased — the hole survives the retarget.
    expect(shows(done.value.session, "s0:AB")).toBeUndefined();
  });

  it("a split write whose wash is gone is dropped, not repainted", () => {
    let s = fresh();
    s = drew(s, ["s0:A"], [GOLD], "wash");
    s = drew(s, ["s0:AB"], [null], "erase inside it");

    // Rewrite the wash into a stroke that paints somewhere else entirely, so the
    // ancestor the split was preserving is not painted at all.
    const done = editFrame(s, 0, (a) => ({
      ...a,
      moves: [paint(fresh().composition, L1, ["s0:BA"], [GOLD])],
    }));
    expect(done.ok).toBe(true);
    if (!done.ok) return;

    expect(done.value.report.orphaned).toBe(3);
    expect(plateOf(done.value.session)).toEqual([["s0:BA", GOLD]]);
  });
});

// ── the frozen node ──────────────────────────────────────────────────────

describe("a place rung's frozen node is re-read", () => {
  /** Paint into L1, add L2, then reorder L1 — the rung freezes L1's plate. */
  function reordered(): Session {
    let s = fresh();
    s = drew(s, ["s0:AA"], [GOLD], "paint");
    s = addLayer(s); // act 1 — adds L2 above L1, and selects it
    s = { ...s, composition: select(s.composition, L1) };
    const moved = arrange(s, "up"); // act 2 — remove L1, insert L1
    expect(moved.ok).toBe(true);
    if (!moved.ok) throw new Error(moved.said);
    return moved.value;
  }

  it("the rung really does carry a photograph of the plate", () => {
    const s = reordered();
    const m = s.journal.past[2].moves[0];
    expect(m.kind).toBe("place");
    if (m.kind === "place") {
      expect([...m.node.plate.entries()]).toEqual([["s0:AA", GOLD]]);
    }
  });

  it("editing the paint under it does not resurrect the old colour", () => {
    const s = reordered();
    const done = editFrame(s, 0, (a) => recolourAct(a, () => BLUE));
    expect(done.ok).toBe(true);
    if (!done.ok) return;

    // Two `place` moves in the reorder, both re-read.
    expect(done.value.report.refrozen).toBe(2);
    expect(plateOf(done.value.session)).toEqual([["s0:AA", BLUE]]);
    expect(shows(done.value.session, "s0:AA")).toBe(BLUE);
    // And L1 is still where the reorder put it: above L2.
    expect(done.value.session.composition.layers.map((l) => l.id)).toEqual([L2, L1]);
  });
});

// ── refusals ─────────────────────────────────────────────────────────────

describe("refusals are counted preconditions", () => {
  it("a frame index that names nothing is refused, not clamped", () => {
    let s = fresh();
    s = drew(s, ["s0:AA"], [GOLD], "one");
    for (const k of [-1, 1, 4, 1.5, NaN]) {
      const done = editFrame(s, k, (a) => a);
      expect(done.ok).toBe(false);
      if (!done.ok) expect(done.why).toBe("empty");
    }
  });

  it("a range that runs off the end is refused", () => {
    let s = fresh();
    s = drew(s, ["s0:AA"], [GOLD], "one");
    s = drew(s, ["s0:AB"], [RED], "two");
    const done = mergeFrames(s, 1, 3);
    expect(done.ok).toBe(false);
    if (!done.ok) expect(done.said).toContain("run past the end");
  });

  it("merging fewer than two frames is refused", () => {
    let s = fresh();
    s = drew(s, ["s0:AA"], [GOLD], "one");
    const done = mergeFrames(s, 0, 1);
    expect(done.ok).toBe(false);
    if (!done.ok) expect(done.said).toBe("a merge needs at least two frames");
  });

  it("a rewrite naming no frames at all is refused", () => {
    const s = fresh();
    const done = rewriteFrames(s, { at: 0, count: 0, acts: [] });
    expect(done.ok).toBe(false);
    if (!done.ok) expect(done.why).toBe("empty");
  });

  it("a tail that cannot be replayed refuses whole, leaving the session alone", () => {
    let s = fresh();
    s = addLayer(s); // act 0 — adds L2
    s = drew(s, ["s0:AA"], [GOLD], "into L2", undefined, L2); // act 1
    const before = s;

    // Delete the act that ADDED L2. Frame 1 then paints into a layer that is not
    // there, which `layers.applyMove` would throw over.
    const done = rewriteFrames(s, { at: 0, count: 1, acts: [] });
    expect(done.ok).toBe(false);
    if (!done.ok) expect(done.why).toBe("unknown-layer");
    // Nothing moved.
    expect(s).toBe(before);
    expect(s.journal.past).toHaveLength(2);
  });
});

// ── deleting a frame ─────────────────────────────────────────────────────

describe("deleting a frame is the same primitive", () => {
  it("drops the act and rebases the rest", () => {
    let s = fresh();
    s = drew(s, ["s0:AA"], [GOLD], "one");
    s = drew(s, ["s0:AB"], [INK], "two");
    s = drew(s, ["s0:AC"], [RED], "three");

    const done = rewriteFrames(s, { at: 1, count: 1, acts: [] });
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.value.session.journal.past.map((a) => a.note)).toEqual(["one", "three"]);
    expect(done.value.replaced.map((a) => a.note)).toEqual(["two"]);
    expect(shows(done.value.session, "s0:AB")).toBeUndefined();
    expect(shows(done.value.session, "s0:AA")).toBe(GOLD);
    expect(shows(done.value.session, "s0:AC")).toBe(RED);
  });

  it("the redo branch is discarded and reported", () => {
    let s = fresh();
    s = drew(s, ["s0:AA"], [GOLD], "one");
    s = drew(s, ["s0:AB"], [INK], "two");
    s = undo(s).session;
    expect(s.journal.future).toHaveLength(1);

    const done = rewriteFrames(s, { at: 0, count: 1, acts: [] });
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.value.report.discardedRedo).toBe(1);
    expect(done.value.session.journal.future).toHaveLength(0);
  });
});

// ── merging a range ──────────────────────────────────────────────────────

describe("a merged frame is the same work in one rung", () => {
  it("the plate is identical and the journal is one shorter", () => {
    let s = fresh();
    s = drew(s, ["s0:AA"], [GOLD], "one");
    s = drew(s, ["s0:AB"], [INK], "two");
    s = drew(s, ["s0:AC"], [RED], "three");
    const was = flatten(s.composition, book);

    const done = mergeFrames(s, 0, 2);
    expect(done.ok).toBe(true);
    if (!done.ok) return;

    expect(done.value.session.journal.past).toHaveLength(2);
    expect(flatten(done.value.session.composition, book)).toEqual(was);
    expect(done.value.merge.frames).toBe(2);
    expect(done.value.merge.coalesced).toBe(1);
    expect(done.value.merge.moves).toBe(1);
  });

  it("the animation loses a beat, which is what a merge is for", () => {
    let s = fresh();
    s = drew(s, ["s0:AA"], [GOLD], "one");
    s = drew(s, ["s0:AB"], [INK], "two");
    s = drew(s, ["s0:AC"], [RED], "three");
    expect(beatsOf(statesOf(s))).toHaveLength(3);

    const done = mergeFrames(s, 0, 2);
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(beatsOf(statesOf(done.value.session))).toHaveLength(2);
  });

  it("a repaint inside the range cancels, exactly as the two strokes did", () => {
    let s = fresh();
    s = drew(s, ["s0:AA"], [GOLD], "on");
    s = drew(s, ["s0:AA"], [null], "off");
    const done = mergeFrames(s, 0, 2);
    expect(done.ok).toBe(true);
    if (!done.ok) return;

    const m = done.value.session.journal.past[0].moves[0];
    expect(m.kind).toBe("paint");
    // Painted and erased in one gesture is a gesture that did nothing.
    if (m.kind === "paint") expect(m.stroke.edits).toEqual([]);
    expect(plateOf(done.value.session)).toEqual([]);
  });

  it("the merged mark concatenates the groups when the modes agree", () => {
    const a: StrokeMark<Address> = { mode: 6, groups: [["s0:AA"]] };
    const b: StrokeMark<Address> = { mode: 6, groups: [["s0:AB"], ["s0:AC"]] };
    let s = fresh();
    s = drew(s, ["s0:AA"], [GOLD], "one", a);
    s = drew(s, ["s0:AB", "s0:AC"], [RED, RED], "two", b);

    const done = mergeFrames(s, 0, 2);
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    const m = done.value.session.journal.past[0].moves[0];
    if (m.kind !== "paint") throw new Error("expected a paint");
    expect(m.stroke.mark).toEqual({
      mode: 6,
      groups: [["s0:AA"], ["s0:AB"], ["s0:AC"]],
    });
    expect(done.value.merge.marked).toBe(true);
    expect(done.value.merge.groups).toBe(3);
    expect(done.value.merge.modes).toEqual([6]);
  });

  it("modes that disagree leave NO mark, and the report says which they were", () => {
    let s = fresh();
    s = drew(s, ["s0:AA"], [GOLD], "one", { mode: 6, groups: [["s0:AA"]] });
    s = drew(s, ["s0:AB"], [RED], "two", { mode: 3, groups: [["s0:AB"]] });

    const done = mergeFrames(s, 0, 2);
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    const m = done.value.session.journal.past[0].moves[0];
    if (m.kind !== "paint") throw new Error("expected a paint");
    expect(m.stroke.mark).toBeUndefined();
    expect(done.value.merge.marked).toBe(false);
    expect(done.value.merge.modes).toEqual([3, 6]);
  });

  it("an unmarked stroke keeps the other's groups and adds none", () => {
    let s = fresh();
    s = drew(s, ["s0:AA"], [GOLD], "marked", { mode: 6, groups: [["s0:AA"]] });
    s = drew(s, ["s0:AB"], [RED], "plain");

    const { act: merged, report } = mergeActs(s.journal.past, "merged");
    const m = merged.moves[0];
    if (m.kind !== "paint") throw new Error("expected a paint");
    expect(m.stroke.mark).toEqual({ mode: 6, groups: [["s0:AA"]] });
    expect(report.groups).toBe(1);
    expect(report.marked).toBe(true);
  });

  it("a structural move is carried through and never coalesced", () => {
    let s = fresh();
    s = drew(s, ["s0:AA"], [GOLD], "one");
    s = addLayer(s);
    s = drew(s, ["s0:AB"], [RED], "two");

    const { act: merged, report } = mergeActs(s.journal.past, "merged");
    expect(merged.moves.map((m) => m.kind)).toEqual(["paint", "place", "paint"]);
    expect(report.coalesced).toBe(0);
  });

  it("events are summed", () => {
    let s = fresh();
    s = act(s, [paint(s.composition, L1, ["s0:AA"], [GOLD])], "one", 2);
    s = act(s, [paint(s.composition, L1, ["s0:AB"], [RED])], "two", 3);
    const { act: merged } = mergeActs(s.journal.past, "merged");
    expect(merged.events).toBe(5);
  });

  it("merging a whole range then undoing the rung takes it all back at once", () => {
    let s = fresh();
    s = drew(s, ["s0:AA"], [GOLD], "one");
    s = drew(s, ["s0:AB"], [INK], "two");
    s = drew(s, ["s0:AC"], [RED], "three");

    const done = mergeFrames(s, 0, 3);
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.value.session.journal.past).toHaveLength(1);
    expect(undo(done.value.session).session.composition.layers[0].plate.size).toBe(0);
  });
});

// ── the Flash mapping ────────────────────────────────────────────────────

describe("every act is a key or a hold", () => {
  it("a structural act holds and a paint keys", () => {
    let s = fresh();
    s = drew(s, ["s0:AA"], [GOLD], "one");
    s = act(s, [{ kind: "rename", layer: L1, from: "Layer 1", to: "sky" }], "rename");
    s = drew(s, ["s0:AB"], [RED], "two");

    const kinds = frameKinds(statesOf(s));
    expect(kinds).toEqual(["key", "hold", "key"]);
    expect(holdCount(kinds)).toBe(1);
  });

  it("the classification agrees with the animation's own drop rule", () => {
    let s = fresh();
    s = drew(s, ["s0:AA"], [GOLD], "one");
    s = addLayer(s);
    s = act(s, [{ kind: "rename", layer: L1, from: "Layer 1", to: "sky" }], "rename");
    s = drew(s, ["s0:AB"], [RED], "two");
    s = drew(s, ["s0:AB"], [RED], "a repaint that changes nothing");

    const states = statesOf(s);
    const kinds = frameKinds(states);
    const steps = animationSteps(states, actStrokes(s.journal.past), book, "#000000");
    // Keys and beats are the same count, and the holds are the difference
    // between act space and step space.
    expect(kinds.filter((k) => k === "key")).toHaveLength(steps.length);
    expect(kinds).toHaveLength(s.journal.past.length);
    expect(holdCount(kinds)).toBe(s.journal.past.length - steps.length);
  });

  it("a sector frame turns a key into a hold without touching the journal", () => {
    let s = fresh();
    s = drew(s, ["s0:AA"], [GOLD], "in sector 0");
    s = drew(s, ["s1:AA"], [RED], "in sector 1");
    const states = statesOf(s);
    // Only sector 0's cells are on screen.
    const shown = book.addr
      .map((a, i) => (a.startsWith("s0:") ? i : -1))
      .filter((i) => i >= 0);
    expect(frameKinds(states)).toEqual(["key", "key"]);
    expect(frameKinds(states, shown)).toEqual(["key", "hold"]);
  });
});

// ── revisions ────────────────────────────────────────────────────────────

describe("a frame edit is taken back by revision", () => {
  it("the round trip is the identity, journal and all", () => {
    let s = fresh();
    s = drew(s, ["s0:AA"], [GOLD], "one");
    s = drew(s, ["s0:AB"], [INK], "two");

    const done = editFrame(s, 0, (a) => recolourAct(a, () => BLUE));
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    // A FRAME EDIT IS THE IDENTITY ON THE TREE — `rewriteFrames` with count 1
    // replaced by one act keeps every act index — so both sides of this
    // revision carry the same timeline, and it is stated rather than left off.
    const tree = timelineOf(s.journal.past);
    const revisions = remember(NO_REVISIONS, { session: s, timeline: tree });
    const edited = { session: done.value.session, timeline: tree };
    expect(shows(edited.session, "s0:AA")).toBe(BLUE);

    const back = undoRevision(revisions, edited);
    expect(back).not.toBeNull();
    if (back === null) return;
    // The exact session, not an inverse of it.
    expect(back.session).toBe(s);
    expect(back.timeline).toBe(tree);
    expect(shows(back.session, "s0:AA")).toBe(GOLD);

    // `RevisionStep` extends `Revision`, so the value an undo produced is the
    // live value the redo takes — the pair is never reassembled by hand.
    const forward = redoRevision(back.revisions, back);
    expect(forward).not.toBeNull();
    if (forward === null) return;
    expect(forward.session).toBe(edited.session);
    expect(forward.timeline).toBe(tree);
    expect(forward.revisions.past).toHaveLength(1);
  });

  it("nothing to take back answers null rather than the same session", () => {
    const live = { session: fresh(), timeline: null };
    expect(undoRevision(NO_REVISIONS, live)).toBeNull();
    expect(redoRevision(NO_REVISIONS, live)).toBeNull();
  });

  it("remembering discards the redo branch", () => {
    const a = { session: fresh(), timeline: null };
    const b = { session: drew(a.session, ["s0:AA"], [GOLD], "one"), timeline: null };
    const stepped = undoRevision(remember(NO_REVISIONS, a), b);
    expect(stepped).not.toBeNull();
    if (stepped === null) return;
    expect(stepped.revisions.future).toHaveLength(1);
    expect(remember(stepped.revisions, b).future).toHaveLength(0);
  });

  it("a step handed straight back does not pin a stack inside a stack", () => {
    // `remember` and the two swaps take the pair BY NAME rather than storing the
    // value given. Without that, handing a `RevisionStep` back — which is the
    // arrangement the two tests above rely on — would put a whole `Revisions`
    // inside every rung, and thirty-two of those would each hold a copy of the
    // stack below them.
    const a = { session: fresh(), timeline: null };
    const b = { session: drew(a.session, ["s0:AA"], [GOLD], "one"), timeline: null };
    const stepped = undoRevision(remember(NO_REVISIONS, a), b);
    expect(stepped).not.toBeNull();
    if (stepped === null) return;
    // The step itself handed back to `remember`: two keys stored, not three.
    const again = remember(stepped.revisions, stepped);
    expect(Object.keys(again.past[0]).sort()).toEqual(["session", "timeline"]);
    // And the same on the redo branch the undo just wrote.
    expect(Object.keys(stepped.revisions.future[0]).sort()).toEqual([
      "session",
      "timeline",
    ]);
  });

  /**
   * A DRAWING WITH A TIMELINE BESIDE IT: six gestures, one beat each.
   *
   * `nested.ts` keeps the timeline tree BESIDE `Journal.past` rather than inside
   * `Session`, on the argument this module's own header makes about revisions —
   * a journal rewrite cannot be a `Move` because a `Move` cannot reach the
   * journal, and putting the tree inside `Session` would put it somewhere a
   * `Move` could reach. That decision is what makes the tree a SECOND thing a
   * revision has to remember.
   */
  const sixGestures = (): Session => {
    let s = fresh();
    const cells: Address[] = ["s0:AA", "s0:AB", "s0:AC", "s0:AX", "s0:BA", "s0:BB"];
    cells.forEach((c, k) => {
      s = drew(s, [c], [k % 2 === 0 ? GOLD : RED], `gesture ${k}`);
    });
    return s;
  };

  it("carries the timeline tree beside the session, so a merge can be taken back whole", () => {
    const s = sixGestures();
    const tree = timelineOf(s.journal.past);
    expect(s.journal.past).toHaveLength(6);
    expect(beatCount(tree)).toBe(6);

    // Frames 3, 4 and 5 — the last three gestures — coalesced into one rung.
    const done = mergeFrames(s, 3, 3, "merged");
    expect(done.ok).toBe(true);
    if (!done.ok) return;

    // The two halves of the document move TOGETHER, and are remembered
    // together. `remember` takes the pair, so there is no arrangement of these
    // three lines in which one of them is saved and the other is not.
    const revisions = remember(NO_REVISIONS, { session: s, timeline: tree });
    const edited = { session: done.value.session, timeline: rebaseTree(tree, 3, 3, 1) };
    expect(edited.session.journal.past).toHaveLength(4);
    expect(beatCount(edited.timeline)).toBe(4);

    const back = undoRevision(revisions, edited);
    expect(back).not.toBeNull();
    if (back === null) return;

    // THE MEASURED FAILURE THIS TEST EXISTS FOR. Before the tree joined the
    // remembered value, `undoRevision` restored a six-rung journal and handed
    // back nothing to restore the tree with, so the caller kept the REBASED
    // four-beat tree: gestures 4 and 5 had no beat, and two gestures the person
    // had drawn silently stopped appearing in the animation with nothing
    // anywhere reporting a problem.
    expect(back.session.journal.past).toHaveLength(6);
    expect(beatCount(back.timeline as Timeline)).toBe(6);
    expect(back.session).toBe(s);
    expect(back.timeline).toBe(tree);
    // Stated as the property rather than as two numbers that happen to agree:
    // every rung of the restored journal is named by exactly one beat.
    const named = (back.timeline as Timeline).length;
    expect(named).toBe(back.session.journal.past.length);

    // And forward again is the exact inverse, on BOTH halves.
    const forward = redoRevision(back.revisions, back);
    expect(forward).not.toBeNull();
    if (forward === null) return;
    expect(forward.session).toBe(edited.session);
    expect(forward.timeline).toBe(edited.timeline);
    expect(beatCount(forward.timeline as Timeline)).toBe(4);
  });

  it("a tree-only edit is a revision too, with the session unmoved", () => {
    // `group`, `ungroup` and `insertHold` change the TREE and never the journal.
    // The paired value spells that directly — the same `Session` on both sides,
    // a different tree — which is what makes those three undoable on the same
    // stack as a merge rather than needing a third one.
    const s = sixGestures();
    const tree = timelineOf(s.journal.past);
    const held = insertHold(tree, null, 3, stepId(900));
    expect(beatCount(held)).toBe(7);

    const revisions = remember(NO_REVISIONS, { session: s, timeline: tree });
    const back = undoRevision(revisions, { session: s, timeline: held });
    expect(back).not.toBeNull();
    if (back === null) return;
    expect(back.session).toBe(s);
    expect(beatCount(back.timeline as Timeline)).toBe(6);
  });

  it("a document with no nested timeline says so, rather than leaving it out", () => {
    // `null` is a CLAIM — "this document has no tree" — and not an omission, on
    // `layers.NO_GESTURE`'s rule. The key is required, so the compiler names
    // every site the day a fourth one appears; see `Revision`.
    const s = sixGestures();
    const back = undoRevision(
      remember(NO_REVISIONS, { session: s, timeline: null }),
      { session: fresh(), timeline: null }
    );
    expect(back).not.toBeNull();
    if (back === null) return;
    expect(back.session).toBe(s);
    expect(back.timeline).toBeNull();
  });
});

// ── drilling in ──────────────────────────────────────────────────────────

describe("the act-space half of drilling in", () => {
  it("a place move touches every layer under it", () => {
    let s = fresh();
    s = addLayer(s); // L2
    s = { ...s, composition: select(s.composition, L1) };
    const moved = arrange(s, "up");
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect([...frameLayers(moved.value.journal.past[1])]).toEqual([L1]);
  });

  it("a per-layer timeline is the acts that touched it, by index", () => {
    let s = fresh();
    s = drew(s, ["s0:AA"], [GOLD], "into L1"); // 0
    s = addLayer(s); // 1 — adds L2
    s = drew(s, ["s0:AB"], [RED], "into L2", undefined, L2); // 2
    s = drew(s, ["s0:AC"], [INK], "into L1 again"); // 3

    expect(framesTouching(s.journal.past, new Set([L1]))).toEqual([0, 3]);
    expect(framesTouching(s.journal.past, new Set([L2]))).toEqual([1, 2]);
    expect(framesTouching(s.journal.past, new Set([L1, L2]))).toEqual([0, 1, 2, 3]);
    expect(framesTouching(s.journal.past, new Set())).toEqual([]);
  });
});

// ── the rewriter ─────────────────────────────────────────────────────────

describe("recolourAct states intent and nothing else", () => {
  it("leaves erases, cells and marks alone", () => {
    const mark: StrokeMark<Address> = { mode: 3, groups: [["s0:AA"]] };
    let s = fresh();
    s = drew(s, ["s0:AA", "s0:AB"], [GOLD, RED], "two colours", mark);
    s = drew(s, ["s0:AA"], [null], "erase one");

    const one = recolourAct(s.journal.past[0], () => BLUE);
    const m = one.moves[0];
    if (m.kind !== "paint") throw new Error("expected a paint");
    expect(m.stroke.edits.map((e) => [e.cell, e.to])).toEqual([
      ["s0:AA", BLUE],
      ["s0:AB", BLUE],
    ]);
    expect(m.stroke.mark).toEqual(mark);

    const two = recolourAct(s.journal.past[1], () => BLUE);
    const n = two.moves[0];
    if (n.kind !== "paint") throw new Error("expected a paint");
    expect(n.stroke.edits.every((e) => e.to === null)).toBe(true);
  });

  it("a rewriter may turn a paint into an erase", () => {
    let s = fresh();
    s = drew(s, ["s0:AA"], [GOLD], "one");
    s = drew(s, ["s0:AB"], [RED], "two");
    const done = editFrame(s, 0, (a) => recolourAct(a, () => null));
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(plateOf(done.value.session)).toEqual([["s0:AB", RED]]);
  });
});

// ── the report ───────────────────────────────────────────────────────────

describe("the report counts rather than describes", () => {
  it("an untouched tail costs nothing", () => {
    let s = fresh();
    s = drew(s, ["s0:AA"], [GOLD], "one");
    s = drew(s, ["s0:AB"], [INK], "two");
    // Rewrite frame 0 to a colour nothing later touches.
    const done = editFrame(s, 0, (a) => recolourAct(a, () => BLUE));
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    const r = done.value.report;
    expect(r).toEqual({
      rebased: 2,
      repaired: 0,
      dropped: 0,
      retargeted: 0,
      orphaned: 0,
      refrozen: 0,
      quiet: 0,
      discardedRedo: 0,
    });
  });

  it("replaced carries what was taken out", () => {
    let s = fresh();
    s = drew(s, ["s0:AA"], [GOLD], "one");
    s = drew(s, ["s0:AB"], [INK], "two");
    s = drew(s, ["s0:AC"], [RED], "three");
    const done = mergeFrames(s, 1, 2);
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.value.replaced.map((a: Act) => a.note)).toEqual(["two", "three"]);
  });
});
