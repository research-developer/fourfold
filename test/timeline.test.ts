/**
 * THE PLAYHEAD's arithmetic: the map between the journal's index space and the
 * animation's, and the two marks that are set from it.
 *
 * Four claims, and they are the four the strip in the layers panel turns on:
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
  type LayerId,
  type Move,
  type Session,
} from "../src/lib/layers";
import { actStrokes, everyComposition } from "../src/lib/composer";
import { animationSteps, clampSpan, spanSteps } from "../src/lib/replay";
import {
  actAtStep,
  beatsOf,
  GROUND,
  markIn,
  markOut,
  railPercent,
  spanCovers,
  spanIsWhole,
  spanSaid,
  stepAtAct,
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
