import { describe, expect, it } from "vitest";
import {
  ALT_REST,
  altDeclined,
  altDown,
  altLost,
  altUp,
  shapeAlt,
  type AltState,
} from "../src/lib/shortcuts";

/**
 * The momentary eraser, as a state machine.
 *
 * WHAT THESE TESTS CAN AND CANNOT REACH. vitest runs `environment: "node"` in
 * this repo and there is no jsdom, so nothing here presses a key or a mouse
 * button — the listeners in `app/draw/page.tsx` are covered by structure only.
 * What IS covered is the whole of the decision they exist to make: which of the
 * two meanings a press of Option carries, when it can change, and what a shape
 * drag is allowed to do with `e.altKey` while it is held. That is where the bug
 * would be, which is why it was moved out of the page and into a pure function.
 *
 * The sequences below are written as the user performs them, because the whole
 * rule is about ORDER and a test that set up states directly would be asserting
 * the implementation rather than the behaviour.
 */

/** No pointer pressed, plate live. The ordinary case. */
const FREE = { pointerDown: false, brushOff: false };
/** A pointer already pressed — the shape modifier's case. */
const PRESSED = { pointerDown: true, brushOff: false };

describe("which meaning one press of Option carries", () => {
  it("arms the eraser when nothing is pressed", () => {
    const s = altDown(ALT_REST, FREE);
    expect(s.hold).toBe("erase");
    expect(s.erasing).toBe(true);
  });

  it("is the shape modifier when a pointer is already down", () => {
    const s = altDown(ALT_REST, PRESSED);
    expect(s.hold).toBe("modifier");
    expect(s.erasing).toBe(false);
  });

  it("refuses to arm while the brush is switched off", () => {
    for (const ctx of [
      { pointerDown: false, brushOff: true },
      { pointerDown: true, brushOff: true },
    ]) {
      const s = altDown(ALT_REST, ctx);
      expect(s.hold).toBe("modifier");
      expect(s.erasing).toBe(false);
    }
  });

  it("keeps `erasing` and `hold` in step in every reachable state", () => {
    const states: AltState[] = [
      ALT_REST,
      altDown(ALT_REST, FREE),
      altDown(ALT_REST, PRESSED),
      altDown(ALT_REST, { pointerDown: false, brushOff: true }),
      altUp(),
      altLost(),
    ];
    for (const s of states) expect(s.erasing).toBe(s.hold === "erase");
  });
});

describe("the decision is latched for the life of the hold", () => {
  /**
   * The reason the latch exists, stated as the thing it prevents: a user who
   * holds Option and THEN presses must not have the meaning flip under their
   * own hand, and on the platforms where a held modifier repeats, every repeat
   * arrives as a fresh keydown with a pointer now down.
   */
  it("does not demote a live eraser when the user then presses", () => {
    let s = altDown(ALT_REST, FREE);
    expect(s.erasing).toBe(true);
    // The press lands; key repeat delivers another keydown behind it.
    s = altDown(s, PRESSED);
    expect(s.hold).toBe("erase");
    expect(s.erasing).toBe(true);
  });

  it("does not promote the shape modifier to an eraser when the press ends", () => {
    let s = altDown(ALT_REST, PRESSED);
    // Finger up, repeats still arriving.
    s = altDown(s, FREE);
    s = altDown(s, FREE);
    expect(s.hold).toBe("modifier");
    expect(s.erasing).toBe(false);
  });

  it("does not go live when the preview that blocked it closes", () => {
    let s = altDown(ALT_REST, { pointerDown: false, brushOff: true });
    s = altDown(s, FREE);
    expect(s.erasing).toBe(false);
  });
});

describe("the two orders, end to end", () => {
  it("Option first: the eraser survives a whole press, drag and release", () => {
    const s = altDown(ALT_REST, FREE);
    // Press. Drag. Release. None of those is an event this machine takes —
    // that is the assertion: only a keyup can end the hold.
    expect(s.erasing).toBe(true);
    // And a SECOND gesture under the same hold still erases.
    expect(altDown(s, PRESSED).erasing).toBe(true);
    expect(altDown(s, FREE).erasing).toBe(true);
  });

  it("press first: Option is the shape modifier and never the eraser", () => {
    let s = altDown(ALT_REST, PRESSED);
    expect(s.erasing).toBe(false);
    // Released mid-drag and pressed again while the finger is still down.
    s = altUp();
    s = altDown(s, PRESSED);
    expect(s.erasing).toBe(false);
  });

  /**
   * The property that matters more than any single path, and the one the whole
   * arrangement is built around: THERE IS NO STATE FROM WHICH AN EXIT LEAVES
   * THE ERASER ON. Both exits are constant functions, so this is checkable by
   * exhaustion rather than by argument — which is why they are constant.
   */
  it("returns to rest from every state, however the hold ends", () => {
    const every: AltState[] = [
      ALT_REST,
      altDown(ALT_REST, FREE),
      altDown(ALT_REST, PRESSED),
      altDown(ALT_REST, { pointerDown: false, brushOff: true }),
    ];
    for (const s of every) {
      // The key came up; the window blurred; the tab was hidden; a keystroke
      // arrived saying Option was never held. One destination.
      expect(altUp()).toEqual(ALT_REST);
      expect(altLost()).toEqual(ALT_REST);
      expect(altUp().erasing).toBe(false);
      expect(altLost().erasing).toBe(false);
      // And the exits do not read the state they are leaving, so no reachable
      // state — including one this test did not think of — can survive them.
      expect(altUp()).toEqual(altLost());
      expect(s.erasing).toBe(s.hold === "erase");
    }
  });

  it("re-arms cleanly after a release", () => {
    let s = altDown(ALT_REST, FREE);
    s = altUp();
    expect(s.erasing).toBe(false);
    s = altDown(s, FREE);
    expect(s.erasing).toBe(true);
  });
});

describe("the crossing guard: a shape drag cannot get both meanings", () => {
  it("drops the symmetric flag while the eraser is held", () => {
    const s = altDown(ALT_REST, FREE);
    // `e.altKey` is true on every pointer event of the gesture, because the key
    // really is held — that is exactly the trap.
    expect(shapeAlt(s, true)).toBe(false);
  });

  it("passes it through for the modifier hold", () => {
    const s = altDown(ALT_REST, PRESSED);
    expect(shapeAlt(s, true)).toBe(true);
    expect(shapeAlt(s, false)).toBe(false);
  });

  it("never expands a shape and erases from one hold", () => {
    for (const ctx of [FREE, PRESSED, { pointerDown: false, brushOff: true }]) {
      const s = altDown(ALT_REST, ctx);
      expect(s.erasing && shapeAlt(s, true)).toBe(false);
    }
  });

  it("asks nothing of a pointer event that does not report Option", () => {
    for (const s of [ALT_REST, altDown(ALT_REST, FREE), altDown(ALT_REST, PRESSED)]) {
      expect(shapeAlt(s, false)).toBe(false);
    }
  });
});

/**
 * A DECLINE IS A COUNTED PRECONDITION, NOT A SILENCE.
 *
 * `altDown` refuses two ways and both come out as `"modifier"`, so the shape of
 * the return value cannot tell them apart — which is how the `brushOff` refusal
 * came to say nothing at all. The two are not alike: the `pointerDown` refusal
 * really IS the shape modifier and the figure changing under the finger is its
 * announcement, whereas with a preview, the help panel or the save menu over the
 * plate there is no figure and no effect, and the only evidence the key was
 * received is a sentence. This is the predicate that tells them apart; the
 * sentence itself is `page.tsx`'s and cannot be reached without a DOM.
 */
describe("the refusal that has to be said out loud", () => {
  it("is the brush-off refusal and not the pointer one", () => {
    expect(altDeclined(ALT_REST, { pointerDown: false, brushOff: true })).toBe(true);
    expect(altDeclined(ALT_REST, { pointerDown: true, brushOff: true })).toBe(true);
    // A press already down is the shape modifier doing its job, not a decline.
    expect(altDeclined(ALT_REST, PRESSED)).toBe(false);
    expect(altDeclined(ALT_REST, FREE)).toBe(false);
  });

  it("is false for a key REPEAT, on the same latch `altDown` uses", () => {
    // A held modifier repeats on some platforms and every repeat is a fresh
    // keydown. A decline announced sixty times is a decline nobody can read.
    let s = altDown(ALT_REST, { pointerDown: false, brushOff: true });
    expect(s.hold).toBe("modifier");
    for (let k = 0; k < 3; k++) {
      expect(altDeclined(s, { pointerDown: false, brushOff: true })).toBe(false);
      s = altDown(s, { pointerDown: false, brushOff: true });
    }
    // The hold is still the inert one it latched as.
    expect(s.hold).toBe("modifier");
    expect(s.erasing).toBe(false);
  });

  it("agrees with `altDown` about every case: it is true exactly when the eraser was refused with nothing to show", () => {
    for (const pointerDown of [false, true]) {
      for (const brushOff of [false, true]) {
        const ctx = { pointerDown, brushOff };
        const next = altDown(ALT_REST, ctx);
        // Declining implies the eraser did not arm...
        if (altDeclined(ALT_REST, ctx)) expect(next.erasing).toBe(false);
        // ...and the one refusal it does NOT name is the one with a visible
        // effect of its own.
        if (!next.erasing && !altDeclined(ALT_REST, ctx)) expect(pointerDown).toBe(true);
      }
    }
  });
});
