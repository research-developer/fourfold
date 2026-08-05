/**
 * THE PLAYHEAD's arithmetic: the map between the journal's index space and the
 * animation's, and the two marks that are set from it.
 *
 * FIVE CLAIMS about the playhead itself, then — under "WHAT THIS PASS ADDED",
 * half way down — four more about the frame edits the strip now reaches. The
 * five came first and are unchanged; the divide is chronological rather than
 * structural, and it is kept because the first five are the ones every later
 * claim stands on.
 *
 * The five are the ones the strip under the plate turns on — the fifth arrived
 * with the slideout, which gave the program a state it did not have before: the
 * strip shut, with a cut still in force:
 *
 *   THE BEAT LIST AGREES WITH THE MODEL. `timeline.beatsOf` restates
 *   `replay.animationSteps`' drop rule — an act that changed no shown cell has
 *   no beat — because `animationSteps` does not report which act each beat came
 *   from and the playhead has to know. That duplication is the one real risk in
 *   the module, so it is asserted directly, on journals that exercise every way
 *   a beat can go missing: a structural act, a repaint that cancels, a gesture
 *   that lands outside the framed sector.
 *
 *   THE MAP IS A BIJECTION where it is defined, and says `null` where it is not.
 *   Act space has a position step space cannot name — the state before anything
 *   was drawn — and answering `0` there would put the playhead on the first beat
 *   while the plate showed the frame before it.
 *
 *   THE MARKS DEFER TO `clampSpan`. Every edit goes through it, so the panel
 *   cannot form a span the payload writer would refuse, and an inverted pair
 *   collapses the way the model says it does rather than the way this file
 *   might have preferred.
 *
 *   A DRAWING WITH NOTHING TO PLAY IS `null` THROUGHOUT, not an empty span.
 *   `replay.InOut` cannot express the empty span at all, deliberately, and the
 *   panel has to be able to sit on a drawing that has not been drawn.
 *
 *   A CUT CANNOT HIDE BEHIND A COLLAPSED STRIP. The marks belong to the drawing
 *   rather than to the panel, so shutting the panel leaves them in force with
 *   nothing on screen saying so — unless the seam says it, which is what
 *   `seamSaid` is for and what the last block below asserts.
 *
 * WHAT IS NOT HERE, and cannot be: anything about the picture. `vitest` runs
 * under `environment: "node"` with no DOM, so the slideout's markup, its
 * transition, the direction the chevron points and every collision measured on
 * screen are outside this file by construction. They are argued where they are
 * drawn — `page.tsx` and `draw.module.css` — and the report that accompanied
 * them carries the measurements.
 */

import { describe, expect, it } from "vitest";
import { buildHexagon } from "../src/lib/hexagon";
import { addressBook, type Address, type AddressBook } from "../src/lib/plate";
import {
  act,
  addLayer,
  emptyComposition,
  flatten,
  newSession,
  NO_GESTURE,
  renameLayer,
  type Journal,
  type LayerId,
  type Move,
  type Session,
} from "../src/lib/layers";
import { actStrokes, everyComposition } from "../src/lib/composer";
import { animationSteps, clampSpan, spanSteps } from "../src/lib/replay";
import {
  editFrame,
  mergeActs,
  mergeFrames,
  recolourAct,
  type MergeReport,
  type RebaseReport,
} from "../src/lib/frames";
import {
  beatCount,
  group,
  insertHold,
  resolve,
  stepId,
  type StepId,
  type Timeline,
} from "../src/lib/nested";
import {
  actAfterMerge,
  actAtStep,
  beatsOf,
  compMark,
  compTrail,
  compTrails,
  GROUND,
  lostSaid,
  markIn,
  markOut,
  mergeSaid,
  minter,
  nameAtStep,
  nameSpan,
  railPercent,
  rangeOfSpan,
  rebaseSaid,
  redoSaid,
  refusedSaid,
  resolveSpan,
  sameCommitted,
  sameJournal,
  seamSaid,
  spanCovers,
  spanIsWhole,
  spanSaid,
  stepAtAct,
  syncSaid,
  syncTree,
  treeFromTrails,
  undoSaid,
  wholeSpan,
} from "../src/lib/timeline";

const BOOK: AddressBook = addressBook(buildHexagon(2, "apex"));

/**
 * A fresh session with one empty sheet and an EMPTY JOURNAL.
 *
 * `emptyComposition` is already a one-layer document, so nothing is added here —
 * and nothing may be, because `addLayer` journals an act and every test below
 * counts acts. `newSession` is what guarantees the journal starts at zero.
 */
function sheet(): { session: Session; id: LayerId } {
  const session = newSession(emptyComposition());
  return { session, id: session.composition.layers[0].id };
}

const paint = (
  layer: LayerId,
  edits: [Address, string | null, string | null][]
): Move => ({
  kind: "paint",
  layer,
  stroke: { edits: edits.map(([cell, from, to]) => ({ cell, from, to })) },
  gesture: NO_GESTURE,
});

/** Commit one act and hand back the session, so the journals below read as a list. */
const commit = (s: Session, moves: Move[], note = "x"): Session =>
  act(s, moves, note);

/** The two things every claim here is measured against, built the page's way. */
function walk(s: Session, shown?: readonly number[]) {
  const past = s.journal.past;
  const states = everyComposition(s.composition, past).map((c) =>
    flatten(c, BOOK)
  );
  return {
    past,
    states,
    beats: beatsOf(states, shown),
    frames: animationSteps(states, actStrokes(past), BOOK, "#000000", shown),
  };
}

/** An address that exists in this book, by index. */
const at = (i: number): Address => BOOK.addr[i];

describe("beatsOf agrees with the model's own drop rule", () => {
  it("counts one beat per act that changed a cell", () => {
    const { session, id } = sheet();
    let s = session;
    for (let k = 0; k < 5; k++) {
      s = commit(s, [paint(id, [[at(k), null, "#aabbcc"]])]);
    }
    const { beats, frames } = walk(s);
    expect(beats).toEqual([0, 1, 2, 3, 4]);
    expect(beats.length).toBe(frames.length);
  });

  it("drops a STRUCTURAL act — it changed no cell", () => {
    const { session, id } = sheet();
    let s = commit(session, [paint(id, [[at(0), null, "#aabbcc"]])]);
    // A rename and a new sheet are acts with no paint move at all. They occupy
    // a position in act space and must occupy none in step space.
    const renamed = renameLayer(s, id, "renamed");
    expect(renamed.ok).toBe(true);
    if (renamed.ok) s = renamed.value;
    s = addLayer(s);
    s = commit(s, [paint(id, [[at(1), null, "#ddeeff"]])]);
    const { past, beats, frames } = walk(s);
    expect(past.length).toBe(4);
    expect(beats.length).toBe(frames.length);
    expect(beats.length).toBe(2);
    // The SECOND beat is the LAST act, not act 1 — which is the whole reason
    // the playhead cannot simply use the journal index.
    expect(beats[0]).toBe(0);
    expect(beats[1]).toBe(3);
  });

  it("drops a paint that CHANGED NO COLOUR — the states are equal either side", () => {
    const { session, id } = sheet();
    let s = commit(session, [paint(id, [[at(0), null, "#aabbcc"]])]);
    // A real act with a real paint move, over a cell that already wears that
    // colour: the brush was dragged back over its own stroke. It occupies a
    // position in act space and changes nothing, so it has no beat — and unlike
    // a structural act it is one `changedCells` has to notice, because the move
    // IS a paint and `actStrokes` yields a non-empty stroke for it.
    s = commit(s, [paint(id, [[at(0), "#aabbcc", "#aabbcc"]])]);
    s = commit(s, [paint(id, [[at(2), null, "#ddeeff"]])]);
    const { past, beats, frames } = walk(s);
    expect(past.length).toBe(3);
    expect(beats.length).toBe(frames.length);
    expect(beats).toEqual([0, 2]);
  });

  it("drops a gesture that landed outside the FRAMED SECTOR", () => {
    const { session, id } = sheet();
    let s = session;
    // Three gestures, each on a different cell. `shown` names only the first.
    s = commit(s, [paint(id, [[at(0), null, "#aabbcc"]])]);
    s = commit(s, [paint(id, [[at(1), null, "#aabbcc"]])]);
    s = commit(s, [paint(id, [[at(2), null, "#aabbcc"]])]);
    const shown = [0];
    const { beats, frames } = walk(s, shown);
    expect(beats.length).toBe(frames.length);
    expect(beats).toEqual([0]);
    // The SAME journal in the whole-plate frame has three beats. This is the
    // "they diverge differently per frame" claim, measured.
    const whole = walk(s);
    expect(whole.beats).toEqual([0, 1, 2]);
  });

  it("is strictly ascending, always", () => {
    const { session, id } = sheet();
    let s = session;
    for (let k = 0; k < 12; k++) {
      s =
        k % 3 === 0
          ? addLayer(s)
          : commit(s, [paint(id, [[at(k), null, "#aabbcc"]])]);
    }
    const { beats, frames } = walk(s);
    expect(beats.length).toBe(frames.length);
    expect(beats.length).toBe(8);
    for (let j = 1; j < beats.length; j++) {
      expect(beats[j]).toBeGreaterThan(beats[j - 1]);
    }
  });

  it("an undrawn document has no beats and no frames", () => {
    const { states, beats, frames } = walk(sheet().session);
    expect(states.length).toBe(1);
    expect(beats).toEqual([]);
    expect(frames).toEqual([]);
  });
});

describe("the map between act space and step space", () => {
  const beats = [0, 3, 4, 9];

  it("a beat names the state AFTER its act ran", () => {
    expect(actAtStep(beats, 0)).toBe(1);
    expect(actAtStep(beats, 1)).toBe(4);
    expect(actAtStep(beats, 3)).toBe(10);
  });

  it("round-trips: every beat is recovered from the state it names", () => {
    for (let j = 0; j < beats.length; j++) {
      expect(stepAtAct(beats, actAtStep(beats, j))).toBe(j);
    }
  });

  it("names the state before the first beat `null`, not zero", () => {
    expect(stepAtAct(beats, 0)).toBeNull();
    // Acts 1…3 all stand on beat 0: acts 1 and 2 painted nothing in frame, so
    // the picture has not moved since beat 0 came up.
    expect(stepAtAct(beats, 1)).toBe(0);
    expect(stepAtAct(beats, 2)).toBe(0);
    expect(stepAtAct(beats, 3)).toBe(0);
    expect(stepAtAct(beats, 4)).toBe(1);
  });

  it("clamps a step off either end of the track rather than refusing it", () => {
    expect(actAtStep(beats, -5)).toBe(1);
    expect(actAtStep(beats, 99)).toBe(10);
    expect(actAtStep(beats, Number.NaN)).toBe(1);
  });

  it("has nothing to say about a drawing with no beats", () => {
    expect(actAtStep([], 3)).toBe(0);
    expect(stepAtAct([], 3)).toBeNull();
  });

  it("holds the last beat for every later state", () => {
    expect(stepAtAct(beats, 10)).toBe(3);
    expect(stepAtAct(beats, 400)).toBe(3);
  });
});

describe("the marks, set from the playhead", () => {
  it("starts as the whole replay and says so", () => {
    expect(wholeSpan(6)).toEqual({ in: 0, out: 5 });
    expect(spanIsWhole(null, 6)).toBe(true);
    expect(spanIsWhole({ in: 0, out: 5 }, 6)).toBe(true);
    expect(spanIsWhole({ in: 1, out: 5 }, 6)).toBe(false);
  });

  it("moves one end and leaves the other where it was", () => {
    expect(markIn(null, 2, 6)).toEqual({ in: 2, out: 5 });
    expect(markOut({ in: 2, out: 5 }, 4, 6)).toEqual({ in: 2, out: 4 });
    expect(markIn({ in: 2, out: 4 }, 0, 6)).toEqual({ in: 0, out: 4 });
  });

  it("clamps to the ends of the track", () => {
    expect(markIn(null, -3, 6)).toEqual({ in: 0, out: 5 });
    expect(markOut(null, 99, 6)).toEqual({ in: 0, out: 5 });
  });

  it("collapses an INVERTED pair the way `clampSpan` says: out follows in", () => {
    // In pushed past out — the model pulls OUT back, because `in` is what the
    // ground is folded to and moving it would repaint the first frame.
    expect(markIn({ in: 0, out: 2 }, 4, 6)).toEqual({ in: 4, out: 4 });
    // Out pulled before in — the same rule, and this is the case where the
    // person asked for step 1 and got step 3. `spanSaid` is what tells them.
    expect(markOut({ in: 3, out: 5 }, 1, 6)).toEqual({ in: 3, out: 3 });
    expect(spanSteps(markOut({ in: 3, out: 5 }, 1, 6))).toBe(1);
  });

  it("agrees with `clampSpan` on every span it can produce", () => {
    for (let n = 1; n <= 8; n++) {
      for (let k = -2; k <= n + 1; k++) {
        expect(markIn(null, k, n)).toEqual(clampSpan({ in: k, out: n - 1 }, n));
        expect(markOut(null, k, n)).toEqual(clampSpan({ in: 0, out: k }, n));
      }
    }
  });

  it("is `null` throughout when there is nothing to play", () => {
    expect(wholeSpan(0)).toBeNull();
    expect(markIn(null, 0, 0)).toBeNull();
    expect(markOut({ in: 0, out: 0 }, 0, 0)).toBeNull();
    expect(spanCovers(null, 0)).toBe(false);
    expect(spanIsWhole(null, 0)).toBe(true);
    expect(spanSaid(null, 0)).toContain("nothing to play");
  });

  it("covers both ends — the span is CLOSED", () => {
    const span = { in: 2, out: 4 };
    expect(spanCovers(span, 1)).toBe(false);
    expect(spanCovers(span, 2)).toBe(true);
    expect(spanCovers(span, 3)).toBe(true);
    expect(spanCovers(span, 4)).toBe(true);
    expect(spanCovers(span, 5)).toBe(false);
    expect(spanSteps(span)).toBe(3);
  });
});

describe("what the strip says", () => {
  it("reports the whole replay as whole rather than as a cut", () => {
    expect(spanSaid(null, 6)).toBe("the whole replay — 6 steps");
    expect(spanSaid({ in: 0, out: 5 }, 6)).toBe("the whole replay — 6 steps");
    expect(spanSaid({ in: 0, out: 0 }, 1)).toBe("the whole replay — 1 step");
  });

  it("reports a cut by what it FOLDED and what it DROPPED", () => {
    const said = spanSaid({ in: 2, out: 4 }, 8);
    expect(said).toContain("in 2, out 4");
    expect(said).toContain("3 steps");
    expect(said).toContain("2 steps already on the plate");
    expect(said).toContain("3 steps not shown");
  });

  it("says what RESULTED, not what was asked for", () => {
    // Asked for out at 1 with in at 3; got the single step at 3.
    const span = markOut({ in: 3, out: 5 }, 1, 6);
    expect(spanSaid(span, 6)).toContain("in 3, out 3");
    expect(spanSaid(span, 6)).toContain("1 step");
  });
});

/**
 * THE SEAM, which is the only part of this strip that can be pressed while the
 * strip itself is not on screen.
 *
 * The one claim worth a test here is not "the sentence reads well" — it is that
 * A CUT IN FORCE CANNOT BECOME INVISIBLE. The marks belong to the drawing and
 * not to the panel, so they survive the panel being collapsed, and they decide
 * what REPLAY plays and what both animated exports write. The seam's name is the
 * only thing left saying so once the strip is shut, which makes these assertions
 * the difference between a slideout and a trapdoor.
 *
 * The ARROW is not tested and cannot be: which way the chevron points is a path
 * in an SVG inside a React component, `vitest` runs under `environment: "node"`
 * with no DOM, and a test that asserted `open ? "up" : "down"` against a
 * function whose whole body is `open ? "up" : "down"` would prove nothing about
 * the picture on screen. The convention is stated where the chevron is drawn.
 */
describe("what the seam says", () => {
  it("says only what the press will do while the strip is open", () => {
    // Open, with a cut in force and the playhead somewhere in the middle: none
    // of that belongs on the seam, because all of it is legible one line below.
    expect(seamSaid(true, 8, 3, { in: 2, out: 4 })).toBe("hide the timeline");
    expect(seamSaid(true, null, null, null)).toBe("hide the timeline");
  });

  it("carries the playhead's position once the strip is shut", () => {
    expect(seamSaid(false, 8, 3, null)).toBe(
      "show the timeline — the playhead is on step 3 of 7"
    );
    // The GROUND is a rail position and not a step, so it is named rather than
    // numbered — the same distinction `stepAtAct` returns `null` for.
    expect(seamSaid(false, 8, null, null)).toBe(
      "show the timeline — the playhead is before step 0"
    );
  });

  it("announces a CUT that the collapse has taken off the screen", () => {
    expect(seamSaid(false, 8, 3, { in: 2, out: 4 })).toBe(
      "show the timeline — the playhead is on step 3 of 7, cut to in 2, out 4"
    );
  });

  it("does not call an uncut drawing cut", () => {
    // `spanIsWhole`'s own reason for existing: a span equal to the whole replay
    // is what "no marks" resolves to, so a seam that reported it would describe
    // every fresh drawing as trimmed.
    expect(seamSaid(false, 6, 0, { in: 0, out: 5 })).toBe(
      "show the timeline — the playhead is on step 0 of 5"
    );
    expect(seamSaid(false, 6, 0, null)).toBe(
      "show the timeline — the playhead is on step 0 of 5"
    );
  });

  it("reports the span that is IN FORCE, not the one that was asked for", () => {
    // Out dragged before in: `clampSpan` collapses it to the single step at in,
    // and the seam says so — the same deference `spanSaid` and `markIn` make.
    const span = markOut({ in: 3, out: 5 }, 1, 6);
    expect(seamSaid(false, 6, 3, span)).toContain("cut to in 3, out 3");
    // A mark past the end of a shorter frame is clamped to the end, not printed.
    expect(seamSaid(false, 4, 0, { in: 0, out: 40 })).toBe(
      "show the timeline — the playhead is on step 0 of 3"
    );
  });

  it("still names the marks when there is no count to clamp them against", () => {
    // No preview has stood the playhead up, so there are no beats — and the
    // marks are STILL set, because they are the drawing's and not the strip's.
    expect(seamSaid(false, null, null, { in: 2, out: 4 })).toBe(
      "show the timeline — in 2 and out 4 are set"
    );
    // A frame in which no gesture changed a cell: same case, same sentence.
    expect(seamSaid(false, 0, null, { in: 2, out: 4 })).toBe(
      "show the timeline — in 2 and out 4 are set"
    );
    expect(seamSaid(false, null, null, null)).toBe("show the timeline");
    expect(seamSaid(false, 0, null, null)).toBe("show the timeline");
  });
});

describe("the track", () => {
  it("puts the GROUND at the left and the last beat at the right", () => {
    expect(railPercent(GROUND, 5)).toBe(0);
    expect(railPercent(4, 5)).toBe(100);
    // Five beats plus the ground is six stops, so each is a fifth of the rail.
    expect(railPercent(0, 5)).toBe(20);
    expect(railPercent(1, 5)).toBe(40);
  });

  it("gives a one-beat drawing a rail with two ends and nothing between", () => {
    expect(railPercent(GROUND, 1)).toBe(0);
    expect(railPercent(0, 1)).toBe(100);
  });

  it("has no track at all when there is nothing to play", () => {
    expect(railPercent(GROUND, 0)).toBe(0);
    expect(railPercent(0, 0)).toBe(0);
  });

  it("clamps rather than running off the track", () => {
    expect(railPercent(-4, 5)).toBe(0);
    expect(railPercent(40, 5)).toBe(100);
    expect(railPercent(Number.NaN, 5)).toBe(0);
  });

  it("keeps the ground off the span, whatever the span is", () => {
    expect(spanCovers({ in: 0, out: 4 }, GROUND)).toBe(false);
    expect(markIn(null, GROUND, 5)).toEqual({ in: 0, out: 4 });
    expect(markOut(null, GROUND, 5)).toEqual({ in: 0, out: 0 });
  });
});

/**
 * ══ WHAT THIS PASS ADDED ═════════════════════════════════════════════════
 *
 * The strip under the plate now reaches `frames.ts` and `nested.ts`, which were
 * built, tested and called by nothing. Everything below is the part of that
 * wiring that is a function of VALUES rather than of the DOM — which is all of it
 * except the markup, because that was the design constraint: `vitest` runs under
 * `environment: "node"`, so anything that had to be tested had to be a function
 * somewhere a test can call.
 *
 * FOUR CLAIMS, and the first two are the ones that would otherwise rot silently:
 *
 *   EVERY COUNTER REACHES A SENTENCE. `frames.RebaseReport` exists because "a
 *   rebase is not a lossless operation and a report that said 'ok' would be
 *   hiding that" — and a counter that reaches no sentence is the same hiding, one
 *   layer out. The reports below are produced by the REAL model on real journals
 *   rather than hand-written, so a counter that stops being set fails here.
 *
 *   A MODE DISAGREEMENT IS LOUD. A merged frame whose sources were made at
 *   different symmetries carries NO mark at all, deliberately; the replay then
 *   reveals its cells in one lump instead of orbit by orbit, and a person who was
 *   not told would find out by watching.
 *
 *   A NAME SURVIVES WHAT AN INDEX DOES NOT. `syncTree` is the upkeep that makes
 *   that true across the three ways a beat list moves under a stored mark.
 *
 *   ⌘Z IS NEVER AMBIGUOUS. `sameJournal` is the whole of the routing between the
 *   journal's undo stack and `frames.Revisions`, and it is exactly LIFO.
 */

/** A stroke with a recorded symmetry, for the merge's mark arithmetic. */
const marked = (
  layer: LayerId,
  edits: [Address, string | null, string | null][],
  mode: number,
  groups: Address[][]
): Move => ({
  kind: "paint",
  layer,
  stroke: {
    edits: edits.map(([cell, from, to]) => ({ cell, from, to })),
    mark: { mode, groups },
  },
  gesture: NO_GESTURE,
});

describe("the tree the marks are named in", () => {
  it("returns the SAME tree when nothing moved, so a group cannot evaporate", () => {
    const mint = minter(100);
    const flat = syncTree(null, [0, 1, 2], mint).tree;
    const grouped = group(flat, null, 0, 2, stepId(900)) as Timeline;
    const again = syncTree(grouped, [0, 1, 2], mint);
    // Identity, not equality: the ordinary case — a playhead stood up twice on an
    // unchanged drawing — must set no state and rebuild nothing.
    expect(again.tree).toBe(grouped);
    expect(again.rebuilt).toBe(false);
    expect(syncSaid(again)).toBeNull();
  });

  it("APPENDS new gestures at the root and leaves every existing name put", () => {
    const mint = minter(0);
    const was = syncTree(null, [0, 1, 2], mint).tree;
    const names = [0, 1, 2].map((k) => nameAtStep(was, k) as StepId);
    const now = syncTree(was, [0, 1, 2, 3, 4], mint);
    expect(now.rebuilt).toBe(false);
    expect(now.kept).toBe(3);
    expect(now.minted).toBe(2);
    expect(beatCount(now.tree)).toBe(5);
    // "at the root, after everything" is the one insertion site under which even
    // a flat index survives — `test/nested.test.ts` tabulates all five.
    for (let k = 0; k < 3; k++) expect(resolve(now.tree, names[k])).toBe(k);
  });

  it("appends WITHOUT flattening the groups that are already there", () => {
    const mint = minter(0);
    const flat = syncTree(null, [0, 1, 2], mint).tree;
    const grouped = group(flat, null, 0, 2, stepId(900)) as Timeline;
    const now = syncTree(grouped, [0, 1, 2, 3], mint);
    expect(now.rebuilt).toBe(false);
    expect(now.tree[0].kind).toBe("comp");
    expect(beatCount(now.tree)).toBe(4);
  });

  it("REBUILDS on a reframe, and carries each surviving name BY ACT", () => {
    const mint = minter(0);
    // The whole hexagon: five gestures, five beats.
    const whole = syncTree(null, [0, 1, 2, 3, 4], mint).tree;
    const names = [0, 1, 2, 3, 4].map((k) => nameAtStep(whole, k) as StepId);
    // The same drawing framed as a sector, where two gestures landed elsewhere.
    const framed = syncTree(whole, [0, 2, 4], mint);
    expect(framed.rebuilt).toBe(true);
    expect(framed.kept).toBe(3);
    expect(framed.minted).toBe(0);
    // THE CLAIM. The mark set on the gesture that painted act 4 still names act
    // 4, even though its flat index moved from 4 to 2. An index would have
    // silently named act 2's gesture instead.
    expect(resolve(framed.tree, names[4])).toBe(2);
    expect(resolve(framed.tree, names[0])).toBe(0);
    // And the two gestures this frame does not show are gone rather than moved.
    expect(resolve(framed.tree, names[1])).toBeNull();
    expect(syncSaid(framed)).toContain("3 steps kept their names");
  });

  it("says so when a rebuild drops grouping, rather than dropping it quietly", () => {
    const mint = minter(0);
    const flat = syncTree(null, [0, 1, 2], mint).tree;
    const grouped = group(flat, null, 0, 2, stepId(900)) as Timeline;
    const held = insertHold(grouped, stepId(900), 1, stepId(901));
    expect(beatCount(held)).toBe(4);
    const now = syncTree(held, [0, 1], mint);
    expect(now.rebuilt).toBe(true);
    expect(now.tree.every((s) => s.kind === "beat")).toBe(true);
    expect(syncSaid(now)).toContain("any grouping was dropped");
  });

  it("names a rail position, and refuses to name the ground", () => {
    const tree = syncTree(null, [3, 7], minter()).tree;
    expect(nameAtStep(tree, 0)).not.toBeNull();
    expect(nameAtStep(tree, 1)).not.toBeNull();
    expect(nameAtStep(tree, 2)).toBeNull();
    expect(nameAtStep(tree, GROUND)).toBeNull();
    expect(nameAtStep(null, 0)).toBeNull();
  });

  it("holds a beat that names no act — a hold is not a gesture", () => {
    const mint = minter(0);
    const tree = syncTree(null, [0, 1], mint).tree;
    const held = insertHold(tree, null, 1, stepId(950));
    // The hold occupies a beat, so the second gesture's name moves to index 2 —
    // and `syncTree` must NOT then think the tree disagrees with the beat list,
    // because the acts it names are still 0 and 1 in that order.
    expect(resolve(held, stepId(950))).toBe(1);
    expect(syncTree(held, [0, 1], mint).tree).toBe(held);
  });
});

describe("the marks, stored as names", () => {
  const treeOf = (beats: number[]) => syncTree(null, beats, minter(0)).tree;

  it("names a span and resolves it back to the same two steps", () => {
    const tree = treeOf([0, 1, 2, 3]);
    const named = nameSpan(tree, { in: 1, out: 2 });
    expect(named).not.toBeNull();
    expect(resolveSpan(tree, named)).toEqual({ span: { in: 1, out: 2 }, lost: "none" });
  });

  it("SURVIVES a hold inserted before it, where an index would not", () => {
    const tree = treeOf([0, 1, 2, 3]);
    const named = nameSpan(tree, { in: 1, out: 2 });
    const held = insertHold(tree, null, 0, stepId(900));
    // The flat index of both marks moved by one. The names did not.
    expect(resolveSpan(held, named).span).toEqual({ in: 2, out: 3 });
  });

  it("falls back to the WHOLE replay when a name dangles, and reports which", () => {
    const tree = treeOf([0, 1, 2, 3]);
    const named = nameSpan(tree, { in: 1, out: 3 });
    // The frame changed and the gesture behind the out point is not in it.
    const framed = syncTree(tree, [0, 1, 2], minter(500)).tree;
    const back = resolveSpan(framed, named);
    expect(back.span).toBeNull();
    expect(back.lost).toBe("out");
    expect(lostSaid(back.lost)).toContain("the cut is off");
    expect(lostSaid("none")).toBeNull();
  });

  it("says NOTHING is set when nothing is, and everything when there is no tree", () => {
    expect(resolveSpan(null, null)).toEqual({ span: null, lost: "none" });
    const tree = treeOf([0, 1]);
    const named = nameSpan(tree, { in: 0, out: 1 });
    expect(resolveSpan(null, named)).toEqual({ span: null, lost: "both" });
    expect(nameSpan(tree, null)).toBeNull();
    expect(nameSpan(null, { in: 0, out: 1 })).toBeNull();
    // A span the tree cannot name at all is not half named.
    expect(nameSpan(tree, { in: 0, out: 9 })).toBeNull();
  });
});

describe("the journal range a marked span covers", () => {
  it("is WIDER than the two beats — it takes the acts between them too", () => {
    // Beats at acts 0, 3 and 7: acts 1, 2, 4, 5 and 6 have no beat in this frame
    // and are still part of the range, because a merge folds a contiguous slice.
    expect(rangeOfSpan([0, 3, 7], { in: 0, out: 2 })).toEqual({ at: 0, count: 8 });
    expect(rangeOfSpan([0, 3, 7], { in: 1, out: 2 })).toEqual({ at: 3, count: 5 });
  });

  it("refuses a range of fewer than two acts, which is what a merge refuses", () => {
    expect(rangeOfSpan([0, 3, 7], { in: 1, out: 1 })).toBeNull();
    expect(rangeOfSpan([0, 1, 2], { in: 2, out: 2 })).toBeNull();
    expect(rangeOfSpan([], { in: 0, out: 0 })).toBeNull();
    expect(rangeOfSpan([0, 1], null)).toBeNull();
  });

  it("clamps a mark left over from a longer frame rather than running off it", () => {
    expect(rangeOfSpan([0, 1, 2], { in: 0, out: 40 })).toEqual({ at: 0, count: 3 });
    expect(rangeOfSpan([4, 9], { in: -3, out: 1 })).toEqual({ at: 4, count: 6 });
  });

  it("moves a preview off the range a merge destroyed", () => {
    // Below the splice: untouched. Above it: shifted by the acts that went.
    expect(actAfterMerge(2, 4, 3)).toBe(2);
    expect(actAfterMerge(9, 4, 3)).toBe(7);
    expect(actAfterMerge(4, 4, 3)).toBe(4);
    // INSIDE it: there is no state to return to, and the merged act's own is the
    // one the person was looking at.
    expect(actAfterMerge(5, 4, 3)).toBe(5);
    expect(actAfterMerge(6, 4, 3)).toBe(5);
  });
});

/**
 * ONE ⌘Z OVER TWO STACKS.
 *
 * The claim is not that these two functions compare arrays — it is that each is a
 * faithful stand-in for "is the frame edit the next thing this keystroke should
 * reach", in its own direction. Every case below is a sequence a person can
 * actually perform, and the third one is a BUG THAT WAS FOUND HERE: comparing
 * both halves of the journal for undo made ⌘Z skip the frame edit entirely and
 * take back the act beneath it.
 */
describe("which stack ⌘Z is addressing", () => {
  const empty: Journal = { past: [], future: [] };

  /** The journal with its last rung undone — what one ⌘Z leaves behind. */
  const undone = (j: Journal): Journal => ({
    past: j.past.slice(0, -1),
    future: [j.past[j.past.length - 1], ...j.future],
  });

  it("is the same journal when it is the same object", () => {
    const { session, id } = sheet();
    const one = commit(session, [paint(id, [[at(0), null, "#aabbcc"]])]).journal;
    expect(sameCommitted(one, one)).toBe(true);
    expect(sameJournal(one, one)).toBe(true);
    expect(sameJournal(empty, { past: [], future: [] })).toBe(true);
  });

  it("notices a stroke committed after the edit — ⌘Z takes THAT back first", () => {
    const { session, id } = sheet();
    const mark = commit(session, [paint(id, [[at(0), null, "#aabbcc"]])]);
    const drawn = commit(mark, [paint(id, [[at(1), null, "#ddeeff"]])]);
    expect(sameCommitted(mark.journal, drawn.journal)).toBe(false);
  });

  /**
   * THE SEQUENCE THAT FOUND THE BUG. Rewrite a frame, paint, ⌘Z.
   *
   * The undo leaves `past` where the frame edit left it and `future` holding the
   * stroke. Comparing both halves answers false there — so the next ⌘Z would
   * route to the journal and undo the act BENEATH the frame edit, skipping the
   * edit and reaching something older than the thing it should have taken back.
   * An undone act is not standing on top of anything.
   */
  it("comes back TRUE for UNDO once the stroke after it is undone", () => {
    const { session, id } = sheet();
    const mark = commit(session, [paint(id, [[at(0), null, "#aabbcc"]])]);
    const drawn = commit(mark, [paint(id, [[at(1), null, "#ddeeff"]])]);
    const back = undone(drawn.journal);
    expect(sameCommitted(mark.journal, back)).toBe(true);
    // And the both-halves test — which REDO asks — says no here, correctly for
    // its own question: the stroke in the redo branch is the more recent thing
    // to put back.
    expect(sameJournal(mark.journal, back)).toBe(false);
  });

  it("keeps REDO off a branch that was abandoned and then re-reached", () => {
    // Take a frame edit back, paint, take the paint back. `past` is again what
    // the revision undo left — but the stroke is sitting in the redo branch and
    // is the more recent thing to put back, so ⇧⌘Z must not reinstate the frame
    // edit and carry the stroke off with it.
    const { session, id } = sheet();
    const mark = commit(session, [paint(id, [[at(0), null, "#aabbcc"]])]);
    const drawn = commit(mark, [paint(id, [[at(1), null, "#ddeeff"]])]);
    const back = undone(drawn.journal);
    expect(sameCommitted(mark.journal, back)).toBe(true);
    expect(sameJournal(mark.journal, back)).toBe(false);
    // Spend the redo branch and the two agree again.
    expect(sameJournal(mark.journal, { past: back.past, future: [] })).toBe(true);
  });

  it("compares rungs by IDENTITY, not by what they say", () => {
    const { session, id } = sheet();
    const one = commit(session, [paint(id, [[at(0), null, "#aabbcc"]])], "x");
    const two = commit(session, [paint(id, [[at(0), null, "#aabbcc"]])], "x");
    // Two acts that say exactly the same thing, made twice. They are different
    // rungs of different journals and this must not confuse them.
    expect(sameCommitted(one.journal, two.journal)).toBe(false);
    expect(sameJournal(one.journal, two.journal)).toBe(false);
    expect(sameCommitted(one.journal, one.journal)).toBe(true);
  });

  it("says what it will take back, and never says nothing", () => {
    expect(undoSaid("the merge of 5 frames", "painted 3 cells")).toBe(
      "undo takes back the merge of 5 frames"
    );
    expect(undoSaid(null, "painted 3 cells")).toBe("undo takes back painted 3 cells");
    expect(undoSaid(null, null)).toBe("nothing to undo");
  });

  it("says the same for the other direction, in the other direction's words", () => {
    // Two functions rather than one with a flag: the two routings ask different
    // questions of the journal and the two sentences are about different stacks.
    expect(redoSaid("the recolour of frame 3", null)).toBe(
      "redo puts the recolour of frame 3 back"
    );
    expect(redoSaid(null, "painted 3 cells")).toBe("redo puts painted 3 cells back");
    expect(redoSaid(null, null)).toBe("nothing to redo");
  });
});

/**
 * THE SENTENCES, against reports the REAL model produced.
 *
 * Hand-written report objects are in here too, for the clauses a small journal
 * cannot reach, but every headline case is measured: the journal is built, the
 * rewrite is run, and the sentence is asserted against the numbers `frames.ts`
 * actually returned. A counter that stops being set, or a rule that stops firing,
 * fails here rather than going quiet.
 */
describe("what a rebase says it repaired", () => {
  const gold = "#aa8800";
  const red = "#cc2222";
  const blue = "#2244cc";

  it("names the repair a later frame needed — MEASURED, not described", () => {
    const { session, id } = sheet();
    let s = commit(session, [paint(id, [[at(0), null, gold]])]);
    s = commit(s, [paint(id, [[at(0), gold, red]])]);
    const done = editFrame(s, 0, (a) => recolourAct(a, () => blue));
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    // Act 1 recorded `from: gold` and the plate now holds blue, so its record was
    // re-read. Nothing else moved: `to` is intent and intent is kept.
    expect(done.value.report.repaired).toBe(1);
    expect(rebaseSaid(done.value.report)).toBe(
      "2 frames replayed — 1 record re-read from the drawing"
    );
  });

  it("names a DROP and the frame it emptied, together", () => {
    const { session, id } = sheet();
    let s = commit(session, [paint(id, [[at(0), null, gold]])]);
    s = commit(s, [paint(id, [[at(0), gold, red]])]);
    // Rewrite the first frame to the colour the second one paints: the second
    // frame's edit becomes red → red, which is a no-op, so it is dropped and the
    // frame is left painting nothing at all.
    const done = editFrame(s, 0, (a) => recolourAct(a, () => red));
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.value.report.dropped).toBe(1);
    expect(done.value.report.quiet).toBe(1);
    expect(rebaseSaid(done.value.report)).toBe(
      "2 frames replayed — 1 record re-read from the drawing, 1 edit dropped for changing nothing and 1 frame left painting nothing"
    );
  });

  it("says so when there was nothing to repair", () => {
    const { session, id } = sheet();
    let s = commit(session, [paint(id, [[at(0), null, gold]])]);
    s = commit(s, [paint(id, [[at(1), null, gold]])]);
    const done = editFrame(s, 0, (a) => recolourAct(a, () => blue));
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    // Two frames that never touch the same cell: the rebase is exact and says so
    // rather than leaving a reader to wonder whether it looked.
    expect(rebaseSaid(done.value.report)).toBe(
      "2 frames replayed, and nothing had to be repaired"
    );
  });

  it("spells every counter, including the three a two-act journal cannot reach", () => {
    const all: RebaseReport = {
      rebased: 23,
      repaired: 4,
      dropped: 1,
      retargeted: 2,
      orphaned: 1,
      refrozen: 3,
      quiet: 2,
      discardedRedo: 5,
    };
    const said = rebaseSaid(all);
    expect(said).toContain("23 frames replayed");
    expect(said).toContain("4 records re-read from the drawing");
    expect(said).toContain("1 edit dropped for changing nothing");
    expect(said).toContain("2 writes retargeted to follow a wash that moved");
    expect(said).toContain("1 write dropped for a wash that is gone");
    expect(said).toContain("3 layers re-read from the live tree");
    expect(said).toContain("2 frames left painting nothing");
    expect(said).toContain("5 redo steps discarded");
  });

  it("REFUSES loudly, and says the drawing did not move", () => {
    const { session, id } = sheet();
    const s = commit(session, [paint(id, [[at(0), null, gold]])]);
    const done = editFrame(s, 9, (a) => a);
    expect(done.ok).toBe(false);
    if (done.ok) return;
    const said = refusedSaid("the frame edit", done.said);
    expect(said).toContain("there is no frame 9");
    // THE HALF THE MODEL CANNOT KNOW IT NEEDS TO SAY. A refusal is atomic by
    // construction; a person who pressed a button and read a sentence has no
    // other way to tell an atomic refusal from a half-applied one.
    expect(said).toContain("The drawing is exactly as it was");
  });
});

describe("what a merge says it gave up", () => {
  const gold = "#aa8800";

  it("keeps the mark and names the brush when the range agrees", () => {
    const { session, id } = sheet();
    let s = commit(session, [marked(id, [[at(0), null, gold]], 6, [[at(0)]])]);
    s = commit(s, [marked(id, [[at(1), null, gold]], 6, [[at(1)]])]);
    const { report } = mergeActs(s.journal.past, "merged");
    expect(report.marked).toBe(true);
    expect(mergeSaid(report)).toBe(
      "2 frames merged into one — 1 move in the merged frame, 1 paint folded into the stroke before it. The merged mark keeps 2 symmetry groups at the 6-fold brush."
    );
  });

  it("IS LOUD when the modes disagree, and names both", () => {
    const { session, id } = sheet();
    let s = commit(session, [marked(id, [[at(0), null, gold]], 6, [[at(0)]])]);
    s = commit(s, [marked(id, [[at(1), null, gold]], 3, [[at(1)]])]);
    const { report } = mergeActs(s.journal.past, "merged");
    // The model's own decision: no single number is true of the range, so the
    // merged frame carries no mark at all rather than claiming one of them.
    expect(report.marked).toBe(false);
    expect(report.groups).toBe(0);
    expect(report.modes).toEqual([3, 6]);
    const said = mergeSaid(report);
    expect(said).toContain("THE MODES DISAGREE");
    expect(said).toContain("3-fold and 6-fold");
    expect(said).toContain("NO symmetry mark at all");
    // And the CONSEQUENCE, which is the part a person can see happen: an
    // unmarked gesture reveals as one remainder group instead of orbit by orbit.
    expect(said).toContain("in one group rather than orbit by orbit");
  });

  it("does not cry loss over a range that never had a mark", () => {
    const { session, id } = sheet();
    let s = commit(session, [paint(id, [[at(0), null, gold]])]);
    s = commit(s, [paint(id, [[at(1), null, gold]])]);
    const { report } = mergeActs(s.journal.past, "merged");
    const said = mergeSaid(report);
    expect(said).toContain("No gesture in the range recorded a symmetry");
    expect(said).not.toContain("DISAGREE");
  });

  it("reports the FRAMES it took, which is more than the beats it was given", () => {
    const { session, id } = sheet();
    let s = commit(session, [paint(id, [[at(0), null, gold]])]);
    // A rename between the two paints: no beat, and still part of the range.
    const renamed = renameLayer(s, id, "renamed");
    expect(renamed.ok).toBe(true);
    if (renamed.ok) s = renamed.value;
    s = commit(s, [paint(id, [[at(1), null, gold]])]);
    const { beats } = walk(s);
    expect(beats).toEqual([0, 2]);
    const range = rangeOfSpan(beats, { in: 0, out: 1 }) as {
      at: number;
      count: number;
    };
    expect(range).toEqual({ at: 0, count: 3 });
    const done = mergeFrames(s, range.at, range.count);
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.value.merge.frames).toBe(3);
    expect(mergeSaid(done.value.merge)).toContain("3 frames merged into one");
    // And the journal really is one rung shorter by two.
    expect(done.value.session.journal.past.length).toBe(1);
  });

  it("spells a merge that folded nothing", () => {
    const plain: MergeReport = {
      frames: 2,
      moves: 2,
      coalesced: 0,
      groups: 0,
      modes: [],
      marked: false,
    };
    expect(mergeSaid(plain)).toContain("2 moves in the merged frame, 0 paints folded");
  });
});

/**
 * THE TREE, INTO A FILE AND BACK.
 *
 * `artfile.ArtLayer.nest` states the compositions a layer's step sits inside,
 * outermost first. The claim here is that the two halves are inverse: a tree
 * written out as trails and read back names the same runs. The BEAT names are not
 * expected to survive — a file carries no journal and no minted name, so the
 * reader mints its own — which is why every assertion below is about the SHAPE.
 */
describe("the timeline in a file", () => {
  it("writes nothing at all for a tree with no groups", () => {
    const flat = syncTree(null, [0, 1, 2], minter()).tree;
    expect(compTrails(flat)).toEqual([undefined, undefined, undefined]);
    expect(compMark([])).toBeUndefined();
    expect(compTrail(undefined)).toEqual([]);
  });

  it("states one trail per step, and the run is the steps that share it", () => {
    const flat = syncTree(null, [0, 1, 2, 3], minter()).tree;
    const grouped = group(flat, null, 1, 2, stepId(900)) as Timeline;
    expect(compTrails(grouped)).toEqual([undefined, "t900", "t900", undefined]);
  });

  it("states a nested trail outermost first", () => {
    const flat = syncTree(null, [0, 1, 2, 3], minter()).tree;
    const outer = group(flat, null, 0, 3, stepId(900)) as Timeline;
    const inner = group(outer, stepId(900), 1, 2, stepId(901)) as Timeline;
    expect(compTrails(inner)).toEqual([
      "t900",
      "t900 t901",
      "t900 t901",
      undefined,
    ]);
    expect(compTrail("t900 t901")).toEqual([stepId(900), stepId(901)]);
  });

  it("ROUND TRIPS: the trails a tree writes rebuild the same runs", () => {
    const flat = syncTree(null, [0, 1, 2, 3, 4], minter()).tree;
    const outer = group(flat, null, 1, 3, stepId(900)) as Timeline;
    const inner = group(outer, stepId(900), 1, 2, stepId(901)) as Timeline;
    const trails = compTrails(inner);
    const back = treeFromTrails(trails, minter(500));
    expect(compTrails(back)).toEqual(trails);
    expect(beatCount(back)).toBe(beatCount(inner));
    // The acts default to the step's own position, which is what a loaded
    // document knows: a file carries no journal.
    expect(back[0]).toEqual({ kind: "beat", id: stepId(500), act: 0 });
  });

  it("takes the acts a caller supplies over the default", () => {
    const back = treeFromTrails([undefined, "t9"], minter(0), [4, 7]);
    expect(back.map((s) => (s.kind === "beat" ? s.act : "comp"))).toEqual([
      4,
      "comp",
    ]);
  });

  it("repairs a composition a file re-opens, rather than refusing the drawing", () => {
    // Steps 0 and 2 claim the same composition with step 1 at the root between
    // them. No tree this program builds can say that; a hand-edited file can.
    const back = treeFromTrails(["t9", undefined, "t9"], minter(500));
    expect(back.length).toBe(3);
    expect(back[0].kind).toBe("comp");
    expect(back[2].kind).toBe("comp");
    // Two compositions, two names — the second is minted rather than repeated,
    // so nothing in the tree is ambiguous and nothing dangles.
    expect(back[0].id).not.toBe(back[2].id);
    expect(beatCount(back)).toBe(3);
  });
});
