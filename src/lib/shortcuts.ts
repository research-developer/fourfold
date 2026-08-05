/**
 * The keyboard contract, written once.
 *
 * The overlay reads this, and so does the footnote under the plate. Two hand-kept
 * lists of the same bindings is how a help panel comes to describe a program
 * that no longer exists, so there is one list and the panel is a rendering of it.
 *
 * The TABLE binds nothing. It is a description; `page.tsx` owns the handler, and
 * the one thing this file cannot check is that the two agree. What it CAN do is
 * refuse to hold two rows for one chord, which `test/shortcuts.test.ts` checks —
 * a collision is the failure mode a growing shortcut set actually has.
 *
 * ── One exception, and it is deliberate: the Alt state machine ───────────
 *
 * Below the table is `altDown`/`altUp`/`altLost`/`shapeAlt` — the rule that
 * decides what one press of Option/Alt MEANS. That is logic, not description,
 * and the header used to say this file held none.
 *
 * It is here rather than in a module of its own because it is the keyboard
 * contract for the one key whose meaning is not a constant, and because the
 * alternative was to leave it inside `page.tsx` where `environment: "node"`
 * (no jsdom) puts it permanently out of reach of a test. A modifier that can
 * silently latch a DESTRUCTIVE tool is the last thing in this program that
 * should be covered only by structure. `test/momentary.test.ts` is what that
 * buys, and it is the whole reason the split exists.
 */

export interface ShortcutRow {
  /** The chord as it is shown, e.g. `Shift 1…7`. */
  keys: string;
  what: string;
  /**
   * The canonical chord, for the collision check: modifiers in a fixed order
   * followed by the lower-case key, or a `…` range for the numeric rows.
   */
  chord: string;
}

export interface ShortcutGroup {
  title: string;
  rows: ShortcutRow[];
}

export const SHORTCUTS: readonly ShortcutGroup[] = [
  {
    title: "move on the lattice",
    rows: [
      { chord: "q", keys: "Q", what: "north-west one cell" },
      { chord: "e", keys: "E", what: "north-east one cell" },
      { chord: "a", keys: "A", what: "west one cell" },
      { chord: "d", keys: "D", what: "east one cell" },
      { chord: "z", keys: "Z", what: "south-west one cell" },
      { chord: "c", keys: "C", what: "south-east one cell" },
      { chord: "w", keys: "W", what: "outward one ring — away from the centre" },
      { chord: "x", keys: "X", what: "inward one ring — toward the centre" },
      { chord: "arrows", keys: "← ↑ → ↓", what: "walk the cursor by screen direction" },
      { chord: "enter", keys: "Enter", what: "paint at the cursor" },
    ],
  },
  {
    title: "brush",
    rows: [
      { chord: "1…5", keys: "1 … 5", what: "brush symmetry — the modes this canvas has" },
      { chord: "shift+1…7", keys: "Shift 1 … 7", what: "colour scheme" },
      { chord: "b", keys: "B", what: "band family — off, A, B, C" },
      { chord: "t", keys: "T", what: "tool — paint, erase, adjust" },
      { chord: "f", keys: "F", what: "shape — free, line, ring" },
      // ONE key, two meanings, and the row has to say which is which or it is
      // describing half a binding. Which meaning you get is fixed by the order
      // you do it in — see `altDown` below, which is the rule itself.
      {
        chord: "alt",
        keys: "Option / Alt",
        what: "hold it BEFORE pressing: erase while held, with the shape and symmetry in hand",
      },
      {
        chord: "alt-during",
        keys: "Option / Alt (mid-drag)",
        what: "press it AFTER the drag has started: expand the shape about the anchor",
      },
    ],
  },
  {
    title: "plate",
    rows: [
      { chord: "[", keys: "[", what: "shallower — the plate is carried across" },
      { chord: "]", keys: "]", what: "deeper — the plate is carried across" },
      { chord: "g", keys: "G", what: "symmetry axes" },
      { chord: "h", keys: "H", what: "the tiling under the paint" },
      { chord: "l", keys: "L", what: "weld — no seam inside a filled row" },
      { chord: "r", keys: "R", what: "relief — the ring under the pointer curves the plate" },
      { chord: "shift+r", keys: "Shift R", what: "flip the relief convex / concave" },
    ],
  },
  // A GROUP OF ITS OWN, rather than two more rows under "view".
  //
  // Drilling in is not a camera move. It zooms, so it looks like one, but what
  // it actually changes is WHERE YOU ARE — the outside goes inert, the brush
  // stops reaching it, and the breadcrumb names the stack. `lib/focus.ts` is
  // explicit that the focus is "where you ARE rather than something you are
  // part-way through", and filing that under the same heading as `+` and `−`
  // would teach it as a zoom you can undo by zooming out. You cannot; the zoom
  // and the focus are deliberately not locked together (see `setZoomTo`).
  //
  // Both keys shipped with the drill-in change and were missing from this table
  // until now, because that change was made under a file lane this file was
  // outside of. The comment at the `i` branch in `page.tsx` says so and asks
  // for exactly this.
  {
    title: "focus",
    rows: [
      {
        chord: "i",
        keys: "I",
        what: "drill in one level at the cursor — the rest of the plate goes inert",
      },
      { chord: "o", keys: "O", what: "step out one level" },
    ],
  },
  {
    title: "view",
    rows: [
      {
        chord: "v",
        keys: "V",
        what: "frame the whole plate, or one sector — nothing is cleared either way",
      },
      { chord: ",", keys: ", / .", what: "step the framed sector round the plate" },
      { chord: "space", keys: "Space (hold)", what: "drag the plate to pan; tap it to paint at the cursor" },
      { chord: "=", keys: "+ / =", what: "zoom in" },
      { chord: "-", keys: "−", what: "zoom out" },
      { chord: "0", keys: "0", what: "fit the whole figure again" },
    ],
  },
  {
    title: "memory",
    rows: [
      { chord: "mod+z", keys: "⌘Z / Ctrl Z", what: "undo a whole gesture" },
      { chord: "mod+shift+z", keys: "⌘⇧Z / Ctrl ⇧Z", what: "redo" },
      {
        chord: "p",
        keys: "P",
        what: "replay — play the drawing back gesture by gesture; again to pause",
      },
      {
        chord: "m",
        keys: "M",
        what: "history — scrub the drawing's earlier states; nothing is changed",
      },
      {
        // The row listed four of the five things Escape does. It unwinds from
        // the inside out and the LAST thing it reaches is the focus — one level
        // per press, exactly as `O` does — so a reader who took this row at its
        // word would think an isolated arm had no keyboard way out but `O`.
        chord: "escape",
        keys: "Esc",
        what: "close a preview, drop a candidate, cancel a confirm, close this panel — then step out one level",
      },
      { chord: "?", keys: "?", what: "this panel" },
    ],
  },
];

/** Every chord in the table, flattened. For the collision check. */
export function allChords(): string[] {
  return SHORTCUTS.flatMap((g) => g.rows.map((r) => r.chord));
}

// ── Option / Alt: one key, two meanings, decided once per hold ─────────────

/**
 * What the LIVE hold of Option/Alt means, or `null` when the key is not down.
 *
 * `"erase"`     the key went down with no pointer pressed, so this hold is the
 *               momentary eraser. It stays that way until the key comes up —
 *               across a press, a drag and a release, and across several of
 *               them — because the owner's rule is that the meaning is fixed by
 *               which came first, not by what happens next.
 *
 * `"modifier"`  the key went down with a pointer ALREADY pressed, so it is the
 *               shape modifier this program has always had: expand the line or
 *               ring about its anchor. Also the value for a hold that is inert
 *               — see `brushOff` — because "not the eraser" is the only thing
 *               the rest of the program needs to know about those.
 */
export type AltHold = "erase" | "modifier" | null;

export interface AltState {
  hold: AltHold;
  /**
   * Is the momentary eraser in force RIGHT NOW?
   *
   * Redundant with `hold === "erase"`, and kept anyway: this is the one field
   * the render reads, and a UI that asks a question about a destructive tool
   * should not have to know that a second value of `hold` also means "no".
   */
  erasing: boolean;
}

/** Alt is not down. The only state this machine starts in, and rests in. */
export const ALT_REST: AltState = { hold: null, erasing: false };

export interface AltContext {
  /**
   * Is any pointer already pressed at the instant of the keydown?
   *
   * THE DISCRIMINATOR, and the whole of it. Option was already the shape
   * modifier (`page.tsx` reads `e.altKey` off the pointer event and has done
   * since lines and rings existed), so a momentary eraser on the same key can
   * only be told apart from it by ORDER. The owner's rule, verbatim: "if all
   * you do is click and hold for even a fraction of a second and then hold
   * option, it sets the centroid and scales symmetrically. Hold opt/alt the
   * split second before clicking and it erases."
   */
  pointerDown: boolean;
  /**
   * Is the brush switched off — a rewind preview standing, the help panel or
   * the save menu open?
   *
   * Arming a destructive tool behind a modal is arming it where the user cannot
   * see the plate it would eat. The hold is latched `"modifier"` instead, so it
   * is inert for its whole life rather than becoming live the moment the panel
   * closes under a finger that is still holding the key.
   */
  brushOff: boolean;
}

/**
 * Option/Alt went down.
 *
 * LATCHED, and that is the load-bearing property: once a hold has a meaning it
 * keeps it until the key comes up. Two things are riding on that.
 *
 *  1. A user who presses Alt, then clicks, must not have the meaning flip under
 *     their own hand the moment the click lands. The pointer state is read once,
 *     here, and never asked again.
 *
 *  2. Key REPEAT. Holding a modifier alone generates no repeats on macOS but
 *     does on some Windows and Linux setups, and every repeat arrives as a
 *     fresh keydown with `altKey` already true. Re-deciding on one of those
 *     would read "a pointer is down" — because by then the user has pressed —
 *     and silently demote a live eraser to the shape modifier mid-gesture.
 *     Returning the state unchanged when `hold !== null` makes repeats free.
 */
export function altDown(state: AltState, ctx: AltContext): AltState {
  if (state.hold !== null) return state;
  if (ctx.pointerDown || ctx.brushOff) return { hold: "modifier", erasing: false };
  return { hold: "erase", erasing: true };
}

/**
 * Option/Alt came up. Always the resting state, from anywhere.
 *
 * There is no branch here on purpose. The single most important property of a
 * momentary DESTRUCTIVE tool is that every way out leads to the same place, so
 * `altUp` and `altLost` are the same function with two names — one for the
 * keyboard's own report, one for every case where the keyboard never reports.
 */
export function altUp(): AltState {
  return ALT_REST;
}

/**
 * The key was lost rather than released: window blur, the tab hidden, or a
 * keystroke that arrived with `altKey` false while we still believed it was
 * down.
 *
 * THE CLASSIC STUCK-MODIFIER BUG lives exactly here. Alt-Tab moves the OS focus
 * away with the key down; the keyup is delivered to whatever the user landed
 * on, never to this page; and the page comes back believing a destructive brush
 * is armed while the hand holds nothing. The browser will not tell you — so the
 * rule is that ANY evidence Alt is not held is enough to drop the hold, and
 * every source of that evidence funnels here.
 */
export function altLost(): AltState {
  return ALT_REST;
}

/**
 * Does this pointer event's Alt mean "expand the shape about the anchor"?
 *
 * THE CROSSING GUARD, and without it the two meanings would meet in the one
 * place they can. `DrawBoard` reads `e.altKey` off the pointer event and hands
 * it up as the shape's symmetric flag — it has to, because releasing Option
 * mid-drag must turn a symmetric figure back into a one-sided one under the
 * finger. But while the momentary eraser is held, `altKey` is true on EVERY
 * pointer event of the gesture, so an untouched shape drag would come out both
 * erasing and symmetric: two modifiers from one press of one key, only one of
 * which was asked for.
 *
 * So the eraser masks it. Holding Alt and then dragging a line erases along a
 * one-sided line, which is what "the erase tool for the shape currently
 * selected" means; pressing first and then Alt gets the symmetric line and the
 * tool the user actually chose. Neither hold can produce the other's effect,
 * and `test/momentary.test.ts` asserts that as a property over both orders.
 */
export function shapeAlt(state: AltState, eventAlt: boolean): boolean {
  return eventAlt && !state.erasing;
}
