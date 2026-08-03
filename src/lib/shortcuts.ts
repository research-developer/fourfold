/**
 * The keyboard contract, written once.
 *
 * The overlay reads this, and so does the footnote under the plate. Two hand-kept
 * lists of the same bindings is how a help panel comes to describe a program
 * that no longer exists, so there is one list and the panel is a rendering of it.
 *
 * Nothing here binds anything. It is a description; `page.tsx` owns the handler,
 * and the one thing this file cannot check is that the two agree. What it CAN do
 * is refuse to hold two rows for one chord, which `test/shortcuts.test.ts`
 * checks — a collision is the failure mode a growing shortcut set actually has.
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
      { chord: "alt", keys: "Option / Alt", what: "while dragging a shape: expand about the anchor" },
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
      { chord: "r", keys: "R", what: "relief — hexagon only" },
      { chord: "shift+r", keys: "Shift R", what: "flip the relief convex / concave" },
    ],
  },
  {
    title: "view",
    rows: [
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
      { chord: "escape", keys: "Esc", what: "drop a candidate, cancel a confirm, close this panel" },
      { chord: "?", keys: "?", what: "this panel" },
    ],
  },
];

/** Every chord in the table, flattened. For the collision check. */
export function allChords(): string[] {
  return SHORTCUTS.flatMap((g) => g.rows.map((r) => r.chord));
}
