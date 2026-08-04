/**
 * The layer tree, measured against the plate it composites.
 *
 * The claims this file pins down are the ones the design turns on rather than
 * the ones that are easy to write: that layer order beats address depth, that a
 * hidden parent hides a visible child WITHOUT touching the child's own switch,
 * that lock guards editing and not display, that up-then-down is the identity,
 * that nothing but NEW destroys anything, and that a drawing made before layers
 * existed is indistinguishable from a fresh one-layer document.
 *
 * The cost of flattening at depth 5 is REPORTED rather than asserted, in the
 * register of `test/view.test.ts`: the numbers are a property of the machine and
 * the shape of the answer is what matters.
 */

import { describe, expect, it } from "vitest";
import { buildHexagon } from "../src/lib/hexagon";
import {
  addressBook,
  applyPlateEdits,
  planPlateEdits,
  resolvePlate,
  type Address,
  type AddressBook,
  type AddressPlate,
} from "../src/lib/plate";
import { encodeArt, extractArt, type ArtPayload } from "../src/lib/artfile";
import { HISTORY_LIMIT } from "../src/lib/strokes";
import {
  act,
  addLayer,
  arrange,
  at,
  canArrange,
  census,
  clearLayer,
  commitPaint,
  copyComposition,
  copyLayer,
  coloursOf,
  demote,
  effectiveOf,
  emptyComposition,
  find,
  flatten,
  flattenAddresses,
  fromArtPayload,
  fromPlate,
  graft,
  layerId,
  moveLayer,
  newSession,
  paintInto,
  paintTarget,
  paletteOf,
  pasteInto,
  pathOf,
  promote,
  redo,
  removeLayer,
  renameLayer,
  select,
  selectedLayer,
  setLocked,
  setVisible,
  slices,
  soleLayer,
  subtreeColours,
  toggleVisible,
  undo,
  walk,
  type Composition,
  type Layer,
  type LayerId,
  type Session,
} from "../src/lib/layers";

const GOLD = "#d4a017";
const RED = "#c0392b";
const BLUE = "#2b6cc0";
const GREEN = "#2f8f4e";

const book2 = addressBook(buildHexagon(2));
const book1 = addressBook(buildHexagon(1));

/** A layer, written out, so a composition can be stated rather than built. */
const L = (
  n: number,
  entries: [Address, string][] = [],
  extra: Partial<Omit<Layer, "id">> = {}
): Layer => ({
  id: layerId(n),
  name: `L${n}`,
  visible: true,
  locked: false,
  plate: new Map(entries),
  children: [],
  ...extra,
});

const C = (layers: Layer[], selected: LayerId | null = null): Composition => ({
  layers,
  selected,
  nextId: 1000,
});

/** The board as a sorted list, so two composites compare exactly. */
const board = (m: ReadonlyMap<number, string>) =>
  [...m.entries()].sort((a, b) => a[0] - b[0]);

/** A tree as plain data, so undo can be checked against the thing it restored. */
interface Shape {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  plate: [string, string][];
  children: Shape[];
}
const shape = (l: Layer): Shape => ({
  id: l.id,
  name: l.name,
  visible: l.visible,
  locked: l.locked,
  plate: [...l.plate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)),
  children: l.children.map(shape),
});
const shapes = (c: Composition): Shape[] => c.layers.map(shape);

/** The cell index of an address on a book, for reading the board back. */
const cell = (book: AddressBook, a: Address): number => {
  const i = book.index.get(a);
  if (i === undefined) throw new Error(`no cell for ${a}`);
  return i;
};

// ── composition order ────────────────────────────────────────────────────

describe("what the viewer sees", () => {
  it("gives a cell to the topmost SHOWN layer that paints it", () => {
    const comp = C([
      L(1, [["s0:AA", GOLD]]),
      L(2, [["s0:AA", RED]]),
      L(3, [["s0:AB", BLUE]]),
    ]);
    const flat = flatten(comp, book2);
    expect(flat.get(cell(book2, "s0:AA"))).toBe(RED);
    expect(flat.get(cell(book2, "s0:AB"))).toBe(BLUE);
  });

  it("`layers[0]` is the BOTTOM — the serialiser walks the array forwards", () => {
    const comp = C([L(1, [["s0:AA", GOLD]]), L(2, [["s0:AA", RED]])]);
    expect(flatten(comp, book2).get(cell(book2, "s0:AA"))).toBe(RED);
    const swapped = C([L(2, [["s0:AA", RED]]), L(1, [["s0:AA", GOLD]])]);
    expect(flatten(swapped, book2).get(cell(book2, "s0:AA"))).toBe(GOLD);
  });

  it("a layer's own paint sits UNDER its own children", () => {
    const comp = C([
      L(1, [["s0:AA", GOLD]], { children: [L(2, [["s0:AA", RED]])] }),
    ]);
    expect(flatten(comp, book2).get(cell(book2, "s0:AA"))).toBe(RED);
  });

  it("children composite in array order, later over earlier", () => {
    const comp = C([
      L(1, [], {
        children: [L(2, [["s0:AA", GOLD]]), L(3, [["s0:AA", BLUE]])],
      }),
    ]);
    expect(flatten(comp, book2).get(cell(book2, "s0:AA"))).toBe(BLUE);
  });

  /**
   * The counterexample the header is built on. Merging the plates and resolving
   * once lets a LOWER layer's fine detail punch through an UPPER layer's coarse
   * wash, because `resolvePlate`'s EXACT-beats-ANCESTOR rule is a statement about
   * one plate and not about a stack.
   */
  it("an upper wash covers a lower detail — layer order beats address depth", () => {
    const comp = C([L(1, [["s0:AB", GOLD]]), L(2, [["s0:A", RED]])]);
    const flat = flatten(comp, book2);
    for (const g of ["A", "B", "C", "X"]) {
      expect(flat.get(cell(book2, `s0:A${g}`))).toBe(RED);
    }

    // And the merge that would have been cheaper gets it wrong, here, measurably.
    const merged: AddressPlate = new Map([
      ["s0:AB", GOLD],
      ["s0:A", RED],
    ]);
    expect(resolvePlate(merged, book2).get(cell(book2, "s0:AB"))).toBe(GOLD);
  });

  /**
   * The second half of the same argument. Two layers disagreeing under one
   * coarse cell is OCCLUSION, not `resolvePlate`'s CONFLICT — a merge would make
   * the cell render unpainted, so hiding the top layer would make a colour
   * appear.
   */
  it("cross-layer disagreement occludes, it does not conflict away", () => {
    const lower = L(1, [
      ["s0:AA", GOLD],
      ["s0:AB", GOLD],
      ["s0:AC", GOLD],
      ["s0:AX", GOLD],
    ]);
    const upper = L(2, [["s0:AB", RED]]);
    expect(flatten(C([lower, upper]), book1).get(cell(book1, "s0:A"))).toBe(RED);

    const merged: AddressPlate = new Map([
      ["s0:AA", GOLD],
      ["s0:AB", RED],
      ["s0:AC", GOLD],
      ["s0:AX", GOLD],
    ]);
    expect(resolvePlate(merged, book1).has(cell(book1, "s0:A"))).toBe(false);
  });

  it("nothing blends — every composited colour came from some layer", () => {
    const comp = C([L(1, [["s0:AA", GOLD]]), L(2, [["s0:AB", RED]])]);
    const laid = new Set([GOLD, RED]);
    for (const [, hex] of flatten(comp, book2)) expect(laid.has(hex)).toBe(true);
  });

  it("is memoised on the stack's identity, so selecting costs nothing", () => {
    const comp = C([L(1, [["s0:AA", GOLD]])], layerId(1));
    const first = flatten(comp, book2);
    expect(flatten(comp, book2)).toBe(first);
    const reselected = select(comp, null);
    expect(reselected.layers).toBe(comp.layers);
    expect(flatten(reselected, book2)).toBe(first);
  });
});

// ── visibility ───────────────────────────────────────────────────────────

describe("visibility", () => {
  it("a hidden layer does not composite", () => {
    const comp = C([
      L(1, [["s0:AA", GOLD]]),
      L(2, [["s0:AA", RED]], { visible: false }),
    ]);
    expect(flatten(comp, book2).get(cell(book2, "s0:AA"))).toBe(GOLD);
  });

  it("a hidden parent hides a VISIBLE child", () => {
    const comp = C([
      L(1, [["s0:AA", GOLD]]),
      L(2, [], { visible: false, children: [L(3, [["s0:AA", RED]])] }),
    ]);
    expect(flatten(comp, book2).get(cell(book2, "s0:AA"))).toBe(GOLD);
    // The child's OWN switch was not touched on the way down.
    expect(find(comp, layerId(3))?.visible).toBe(true);
  });

  it("unhiding a parent restores exactly what was showing before", () => {
    const before = C([
      L(1, [], {
        children: [L(2, [["s0:AA", GOLD]]), L(3, [["s0:AB", RED]], { visible: false })],
      }),
    ]);
    const shownBefore = board(flatten(before, book2));
    const hidden = setVisible(before, layerId(1), false);
    expect(flatten(hidden, book2).size).toBe(0);
    const back = setVisible(hidden, layerId(1), true);
    expect(board(flatten(back, book2))).toEqual(shownBefore);
    expect(shapes(back)).toEqual(shapes(before));
  });

  it("own and effective are different answers, and are named apart", () => {
    const comp = C([
      L(1, [], { visible: false, children: [L(2, [], { locked: true })] }),
    ]);
    expect(find(comp, layerId(2))?.visible).toBe(true);
    expect(effectiveOf(comp, layerId(2))).toEqual({ shown: false, editable: false });
    expect(effectiveOf(comp, layerId(1))).toEqual({ shown: false, editable: true });
  });

  it("toggling is not journalled — it changes no address", () => {
    const s = newSession(C([L(1, [["s0:AA", GOLD]])], layerId(1)));
    const flipped = toggleVisible(s.composition, layerId(1));
    expect(flipped.layers[0].visible).toBe(false);
    expect(s.journal.past).toHaveLength(0);
  });
});

// ── lock ─────────────────────────────────────────────────────────────────

describe("lock guards editing, never display", () => {
  it("a locked layer still composites", () => {
    const open = C([L(1, [["s0:AA", GOLD]])]);
    const shut = C([L(1, [["s0:AA", GOLD]], { locked: true })]);
    expect(board(flatten(shut, book2))).toEqual(board(flatten(open, book2)));
  });

  it("refuses paint into a locked layer, and says which", () => {
    const comp = C([L(1, [], { locked: true })], layerId(1));
    const target = paintTarget(comp);
    expect(target.ok).toBe(false);
    if (!target.ok) {
      expect(target.why).toBe("locked");
      expect(target.said).toMatch(/locked/);
    }
  });

  it("a locked PARENT locks the child, with its own sentence", () => {
    const comp = C([L(1, [], { locked: true, children: [L(2)] })], layerId(2));
    const target = paintTarget(comp);
    expect(target.ok).toBe(false);
    if (!target.ok) {
      expect(target.why).toBe("locked");
      expect(target.said).toMatch(/inside a locked layer/);
    }
  });

  it("refuses paint into a hidden layer rather than painting invisibly", () => {
    const comp = C([L(1, [], { visible: false })], layerId(1));
    const target = paintTarget(comp);
    expect(target.ok).toBe(false);
    if (!target.ok) expect(target.why).toBe("hidden");
  });

  it("refuses with no selection at all", () => {
    const target = paintTarget(C([L(1)]));
    expect(target.ok).toBe(false);
    if (!target.ok) expect(target.why).toBe("no-selection");
  });

  it("accepts an unlocked, shown layer and names it", () => {
    const comp = C([L(1, [], { children: [L(2)] })], layerId(2));
    const target = paintTarget(comp);
    expect(target.ok).toBe(true);
    if (target.ok) expect(target.value.path).toEqual([0, 0]);
  });

  it("refuses to clear a locked layer", () => {
    const s = newSession(C([L(1, [["s0:AA", GOLD]], { locked: true })], layerId(1)));
    const out = clearLayer(s);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.why).toBe("locked");
  });

  it("refuses to paste into a locked layer", () => {
    const s = newSession(C([L(1, [], { locked: true })], layerId(1)));
    const out = pasteInto(s, L(9, [["s0:AA", RED]]));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.why).toBe("locked");
  });
});

// ── painting ─────────────────────────────────────────────────────────────

describe("painting reaches exactly one layer", () => {
  const lay = (
    plate: AddressPlate,
    addrs: Address[],
    colour: string
  ) => planPlateEdits(plate, book2, addrs, addrs.map(() => colour));

  it("lands in the selected layer and nowhere else", () => {
    let comp = C([L(1), L(2)], layerId(2));
    comp = paintInto(comp, layerId(2), lay(new Map(), ["s0:AA"], RED));
    expect(find(comp, layerId(1))?.plate.size).toBe(0);
    expect(find(comp, layerId(2))?.plate.get("s0:AA")).toBe(RED);
  });

  it("commits as one undoable rung, and undo puts the plate back", () => {
    const start = newSession(C([L(1)], layerId(1)));
    const edits = lay(new Map(), ["s0:AA", "s0:AB"], RED);
    const out = commitPaint(start, { edits });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(find(out.value.composition, layerId(1))?.plate.size).toBe(2);
    const back = undo(out.value);
    expect(find(back.session.composition, layerId(1))?.plate.size).toBe(0);
    const again = redo(back.session);
    expect(find(again.session.composition, layerId(1))?.plate.size).toBe(2);
  });

  it("re-applies a live gesture harmlessly, which is the drag contract", () => {
    const start = newSession(C([L(1)], layerId(1)));
    const edits = lay(new Map(), ["s0:AA", "s0:AB"], RED);
    // The drag: applied live, application by application.
    const live = paintInto(start.composition, layerId(1), edits);
    // The commit: the same edits again, against the composition they landed on.
    const out = commitPaint({ ...start, composition: live }, { edits });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect([...(find(out.value.composition, layerId(1))?.plate ?? new Map())]).toEqual(
      [...(find(live, layerId(1))?.plate ?? new Map())]
    );
    // And one press still takes the whole gesture back to where it started.
    expect(find(undo(out.value).session.composition, layerId(1))?.plate.size).toBe(0);
  });

  it("declines to commit into a layer that was locked mid-gesture", () => {
    const start = newSession(C([L(1)], layerId(1)));
    const locked = {
      ...start,
      composition: setLocked(start.composition, layerId(1), true),
    };
    const out = commitPaint(locked, { edits: lay(new Map(), ["s0:AA"], RED) });
    expect(out.ok).toBe(false);
  });

  it("carries a stroke's mark through untouched, for the replay", () => {
    const start = newSession(C([L(1)], layerId(1)));
    const out = commitPaint(start, {
      edits: lay(new Map(), ["s0:AA"], RED),
      mark: { mode: 6, groups: [["s0:AA"]] },
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const move = out.value.journal.past[0].moves[0];
    expect(move.kind).toBe("paint");
    if (move.kind === "paint") expect(move.stroke.mark?.mode).toBe(6);
  });
});

// ── the tree: reordering, promotion, legality ────────────────────────────

describe("arranging respects the tree", () => {
  const tree = () =>
    newSession(
      C(
        [
          L(1, [["s0:AA", GOLD]]),
          L(2, [], { children: [L(3), L(4)] }),
          L(5),
        ],
        layerId(1)
      )
    );

  it("moves among siblings and never reparents", () => {
    const s = tree();
    const out = arrange(s, "up");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.composition.layers.map((l) => l.id)).toEqual([
      layerId(2),
      layerId(1),
      layerId(5),
    ]);
    expect(pathOf(out.value.composition, layerId(1))).toHaveLength(1);
  });

  it("moves a CHILD among its own siblings, not into the top level", () => {
    const s = { ...tree(), composition: select(tree().composition, layerId(3)) };
    const out = arrange(s, "up");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(pathOf(out.value.composition, layerId(3))).toEqual([1, 1]);
    expect(pathOf(out.value.composition, layerId(4))).toEqual([1, 0]);
  });

  it("up then down is the identity", () => {
    const s = tree();
    const up = arrange(s, "up");
    expect(up.ok).toBe(true);
    if (!up.ok) return;
    const down = arrange(up.value, "down");
    expect(down.ok).toBe(true);
    if (!down.ok) return;
    expect(shapes(down.value.composition)).toEqual(shapes(s.composition));
  });

  it("refuses at the ends, and `canArrange` agrees with it", () => {
    const s = { ...tree(), composition: select(tree().composition, layerId(1)) };
    expect(canArrange(s.composition, "down")).toBe(false);
    const out = arrange(s, "down");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.why).toBe("at-the-end");
    expect(canArrange(s.composition, "up")).toBe(true);
  });

  it("refuses with no selection, which is what greys the control", () => {
    const s = newSession(C([L(1)]));
    expect(canArrange(s.composition, "up")).toBe(false);
    const out = arrange(s, "up");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.why).toBe("no-selection");
  });

  it("promote takes a layer out of its parent, to sit just above it", () => {
    const s = { ...tree(), composition: select(tree().composition, layerId(4)) };
    const out = promote(s);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.composition.layers.map((l) => l.id)).toEqual([
      layerId(1),
      layerId(2),
      layerId(4),
      layerId(5),
    ]);
    expect(pathOf(out.value.composition, layerId(3))).toEqual([1, 0]);
  });

  it("promote refuses at the top level", () => {
    const s = tree();
    const out = promote(s);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.why).toBe("no-parent");
  });

  it("demote puts a layer inside the sibling below it", () => {
    const s = { ...tree(), composition: select(tree().composition, layerId(5)) };
    const out = demote(s);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(pathOf(out.value.composition, layerId(5))).toEqual([1, 2]);
    expect(out.value.composition.layers).toHaveLength(2);
  });

  it("demote refuses with nothing below", () => {
    const s = { ...tree(), composition: select(tree().composition, layerId(1)) };
    const out = demote(s);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.why).toBe("no-neighbour");
  });

  it("REFUSES to move a layer inside itself, at any depth", () => {
    const s = tree();
    const self = moveLayer(s, layerId(2), layerId(2), 0);
    expect(self.ok).toBe(false);
    if (!self.ok) expect(self.why).toBe("into-itself");
    const inner = moveLayer(s, layerId(2), layerId(3), 0);
    expect(inner.ok).toBe(false);
    if (!inner.ok) expect(inner.why).toBe("into-itself");
  });

  it("moves to the top level by index, read after the layer is taken out", () => {
    const s = tree();
    const out = moveLayer(s, layerId(1), null, 2);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.composition.layers.map((l) => l.id)).toEqual([
      layerId(2),
      layerId(5),
      layerId(1),
    ]);
  });

  it("moves INTO another layer, which a path destination could not say cleanly", () => {
    const s = tree();
    const out = moveLayer(s, layerId(1), layerId(2), 1);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(pathOf(out.value.composition, layerId(1))).toEqual([0, 1]);
    expect(out.value.composition.layers).toHaveLength(2);
  });

  it("clamps an index past the end rather than throwing at a panel", () => {
    const s = tree();
    const out = moveLayer(s, layerId(1), null, 99);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(pathOf(out.value.composition, layerId(1))).toEqual([2]);
  });

  it("keeps nesting arbitrarily deep", () => {
    let comp = C([L(1)], layerId(1));
    let s = newSession(comp);
    for (let k = 2; k <= 8; k++) {
      const out = pasteInto(s, L(100 + k));
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      s = out.value;
    }
    comp = s.composition;
    expect(census(comp).deepest).toBe(8);
    expect(census(comp).duplicateIds).toEqual([]);
  });
});

// ── recoverability: nothing but NEW destroys anything ────────────────────

describe("delete and clear are recoverable", () => {
  const painted = (): Session =>
    newSession(
      C(
        [
          L(1, [["s0:AA", GOLD]]),
          L(2, [["s0:AB", RED]], {
            children: [L(3, [["s0:AC", BLUE]]), L(4, [["s0:AX", GREEN]])],
          }),
        ],
        layerId(2)
      )
    );

  it("undo restores a deleted subtree exactly — ids, names, switches, plates", () => {
    const s = painted();
    const was = shapes(s.composition);
    const gone = removeLayer(s);
    expect(gone.ok).toBe(true);
    if (!gone.ok) return;
    expect(gone.value.composition.layers).toHaveLength(1);
    expect(census(gone.value.composition).total).toBe(1);
    const back = undo(gone.value);
    expect(shapes(back.session.composition)).toEqual(was);
  });

  it("redo deletes it again", () => {
    const s = painted();
    const gone = removeLayer(s);
    expect(gone.ok).toBe(true);
    if (!gone.ok) return;
    const back = undo(gone.value);
    const again = redo(back.session);
    expect(again.session.composition.layers).toHaveLength(1);
  });

  it("delete moves the selection somewhere sensible, never nowhere by accident", () => {
    const s = painted();
    const gone = removeLayer(s);
    expect(gone.ok).toBe(true);
    if (!gone.ok) return;
    expect(gone.value.composition.selected).toBe(layerId(1));
  });

  it("deleting the last layer leaves an empty composition and an empty selection", () => {
    const s = newSession(C([L(1)], layerId(1)));
    const gone = removeLayer(s);
    expect(gone.ok).toBe(true);
    if (!gone.ok) return;
    expect(gone.value.composition.layers).toHaveLength(0);
    expect(gone.value.composition.selected).toBe(null);
    expect(shapes(undo(gone.value).session.composition)).toEqual(shapes(s.composition));
  });

  it("clear empties the whole SUBTREE, because hide and lock already mean it", () => {
    const s = painted();
    const out = clearLayer(s);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(census(out.value.composition).addresses).toBe(1);
    expect(find(out.value.composition, layerId(1))?.plate.size).toBe(1);
    expect(find(out.value.composition, layerId(3))?.plate.size).toBe(0);
  });

  it("undo puts every cleared address back with its own colour", () => {
    const s = painted();
    const was = shapes(s.composition);
    const out = clearLayer(s);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(shapes(undo(out.value).session.composition)).toEqual(was);
  });

  it("clear says so rather than making an empty rung", () => {
    const s = newSession(C([L(1)], layerId(1)));
    const out = clearLayer(s);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.why).toBe("empty");
  });

  it("rename is undoable, because a name is destroyed and a switch is not", () => {
    const s = newSession(C([L(1)], layerId(1)));
    const out = renameLayer(s, layerId(1), "  Sky  ");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(find(out.value.composition, layerId(1))?.name).toBe("Sky");
    expect(find(undo(out.value).session.composition, layerId(1))?.name).toBe("L1");
    expect(renameLayer(out.value, layerId(1), "   ").ok).toBe(false);
  });

  it("an act is all-or-nothing under undo, however compound", () => {
    const s = painted();
    const before = shapes(s.composition);
    const moved = arrange({ ...s, composition: select(s.composition, layerId(1)) }, "up");
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    // Two placements in one rung; one press takes back both.
    expect(moved.value.journal.past[0].moves).toHaveLength(2);
    expect(shapes(undo(moved.value).session.composition)).toEqual(before);
  });

  it("pushing an act discards the redo branch, as a linear history must", () => {
    const s = painted();
    const gone = removeLayer(s);
    expect(gone.ok).toBe(true);
    if (!gone.ok) return;
    const back = undo(gone.value);
    expect(back.session.journal.future).toHaveLength(1);
    const fresh = addLayer(back.session);
    expect(fresh.journal.future).toHaveLength(0);
  });

  it("trims at the same depth `strokes.ts` does, dropping the oldest rung", () => {
    let s = newSession(fromPlate(new Map()));
    for (let k = 0; k < HISTORY_LIMIT + 4; k++) s = addLayer(s);
    expect(s.journal.past).toHaveLength(HISTORY_LIMIT);
    expect(s.journal.past[s.journal.past.length - 1].note).toMatch(/added/);
  });

  it("undo on an empty journal moves nothing and says so", () => {
    const s = newSession(C([L(1)]));
    expect(undo(s).act).toBe(null);
    expect(redo(s).act).toBe(null);
    expect(undo(s).session).toBe(s);
  });

  it("`nextId` never rolls back, so a redo cannot collide with a new layer", () => {
    const s = newSession(fromPlate(new Map()));
    const added = addLayer(s);
    const idAfter = added.composition.nextId;
    const back = undo(added);
    expect(back.session.composition.nextId).toBe(idAfter);
    const again = addLayer(back.session);
    expect(census(again.composition).duplicateIds).toEqual([]);
  });
});

// ── selection ────────────────────────────────────────────────────────────

describe("the selection can be empty, and is an identity", () => {
  it("starts empty when nothing was chosen", () => {
    expect(selectedLayer(C([L(1)]))).toBe(null);
  });

  it("an id the document does not hold selects nothing", () => {
    const comp = select(C([L(1)]), layerId(99));
    expect(comp.selected).toBe(null);
  });

  it("survives a reorder, where a stored path would not", () => {
    const s = newSession(C([L(1), L(2), L(3)], layerId(1)));
    const out = arrange(s, "up");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.composition.selected).toBe(layerId(1));
    expect(pathOf(out.value.composition, layerId(1))).toEqual([1]);
  });

  it("goes empty rather than dangling when its layer is undone away", () => {
    const s = newSession(fromPlate(new Map()));
    const added = addLayer(s);
    expect(added.composition.selected).not.toBe(null);
    const back = undo(added);
    expect(find(back.session.composition, added.composition.selected as LayerId)).toBe(
      null
    );
    expect(back.session.composition.selected).toBe(null);
  });

  it("a new layer joins the selection's own stack, beside it and above", () => {
    const s = newSession(C([L(1), L(2, [], { children: [L(3)] })], layerId(3)));
    const added = addLayer(s);
    const path = pathOf(added.composition, added.composition.selected as LayerId);
    expect(path).toEqual([1, 1]);
  });

  it("a new layer with nothing selected goes on top of the document", () => {
    const s = newSession(C([L(1), L(2)]));
    const added = addLayer(s);
    expect(pathOf(added.composition, added.composition.selected as LayerId)).toEqual([2]);
  });
});

// ── copy, paste, graft ───────────────────────────────────────────────────

describe("paste is a graft and never a flatten", () => {
  const doc = () =>
    C(
      [
        L(1, [["s0:AA", GOLD]]),
        L(2, [], { children: [L(3, [["s0:AB", RED]])] }),
      ],
      layerId(1)
    );

  it("a whole composition pasted onto a layer keeps its own sub-layers", () => {
    const source = doc();
    const clip = copyComposition(source, "Sky");
    const s = newSession(C([L(9)], layerId(9)));
    const out = pasteInto(s, clip);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const c = out.value.composition;
    // host → grafted root → the source's two layers → the inner child.
    expect(census(c).deepest).toBe(4);
    expect(census(c).total).toBe(5);
  });

  it("mints fresh ids for the whole subtree, so two pastes are independent", () => {
    const clip = copyComposition(doc(), "Sky");
    let s = newSession(C([L(9)], layerId(9)));
    for (let k = 0; k < 2; k++) {
      const out = pasteInto(s, clip);
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      s = out.value;
    }
    expect(census(s.composition).duplicateIds).toEqual([]);
    expect(census(s.composition).total).toBe(9);
  });

  it("shares plates by reference rather than copying them", () => {
    const source = doc();
    const original = find(source, layerId(1));
    const clip = copyComposition(source, "Sky");
    const s = newSession(C([L(9)], layerId(9)));
    const out = pasteInto(s, clip);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const plates = walk(out.value.composition)
      .map((v) => v.layer.plate)
      .filter((p) => p.size > 0);
    expect(plates).toContain(original?.plate);
  });

  it("composites the pasted subtree over its host's own paint", () => {
    const s = newSession(C([L(9, [["s0:AA", BLUE]])], layerId(9)));
    const out = pasteInto(s, L(1, [["s0:AA", GOLD]]));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(flatten(out.value.composition, book2).get(cell(book2, "s0:AA"))).toBe(GOLD);
  });

  it("pastes on top of the document when nothing is selected", () => {
    const s = newSession(C([L(9)]));
    const out = pasteInto(s, L(1, [["s0:AA", GOLD]]));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.composition.layers).toHaveLength(2);
    expect(census(out.value.composition).deepest).toBe(1);
  });

  it("undoing a paste removes the whole graft in one press", () => {
    const s = newSession(doc());
    const before = shapes(s.composition);
    const out = pasteInto(s, copyComposition(doc(), "Sky"));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(shapes(undo(out.value).session.composition)).toEqual(before);
  });

  it("copies the layer as stored, which the clipboard may hold safely", () => {
    const source = doc();
    expect(copyLayer(source, layerId(2))).toBe(source.layers[1]);
    expect(copyLayer(source, layerId(99))).toBe(null);
  });

  it("graft turns a stack into one layer that holds no paint of its own", () => {
    const made = graft(doc().layers, "Sky", 50);
    expect(made.layer.plate.size).toBe(0);
    expect(made.layer.children).toHaveLength(2);
    expect(made.nextId).toBe(51);
  });
});

// ── migration ────────────────────────────────────────────────────────────

describe("migration from a single plate", () => {
  const plate: AddressPlate = new Map([
    ["s0:AA", GOLD],
    ["s0:AB", RED],
    // Off-depth paint, which no index-keyed file could ever have named.
    ["s1:A", BLUE],
  ]);

  it("becomes one layer holding the plate byte for byte", () => {
    const comp = fromPlate(plate);
    expect(comp.layers).toHaveLength(1);
    expect(comp.layers[0].children).toHaveLength(0);
    expect(comp.layers[0].plate).toBe(plate);
    expect(comp.layers[0].name).toBe("Layer 1");
    expect(comp.layers[0].visible).toBe(true);
    expect(comp.layers[0].locked).toBe(false);
    expect(comp.selected).toBe(comp.layers[0].id);
  });

  it("composites to exactly what the plate resolved to before layers existed", () => {
    expect(board(flatten(fromPlate(plate), book2))).toEqual(
      board(resolvePlate(plate, book2))
    );
  });

  it("hands the plate straight back, so a one-layer file does not move its bytes", () => {
    const only = soleLayer(fromPlate(plate));
    expect(only?.plate).toBe(plate);
  });

  it("a fresh document and a migrated empty plate are the same object", () => {
    expect(shapes(emptyComposition())).toEqual(shapes(fromPlate(new Map())));
  });

  it("`soleLayer` is null the moment the document grows a stack", () => {
    const s = addLayer(newSession(fromPlate(plate)));
    expect(soleLayer(s.composition)).toBe(null);
    const grown = pasteInto(newSession(fromPlate(plate)), L(9));
    expect(grown.ok).toBe(true);
    if (!grown.ok) return;
    expect(soleLayer(grown.value.composition)).toBe(null);
  });

  it("loads an old index-keyed `fourfold:art:1` payload as one layer", () => {
    // A file written before the address plate existed: `cells` only.
    const legacy: ArtPayload = {
      version: 1,
      canvas: "hexagon",
      depth: 2,
      convention: "apex",
      cells: [
        [0, GOLD],
        [5, RED],
      ],
    };
    const read = extractArt(encodeArt(legacy));
    expect(read).not.toBe(null);
    if (read === null) return;
    const comp = fromArtPayload(read, book2);
    expect(comp.layers).toHaveLength(1);
    const flat = flatten(comp, book2);
    expect(flat.get(0)).toBe(GOLD);
    expect(flat.get(5)).toBe(RED);
  });

  it("loads a payload that carries an address plate, at every depth it holds", () => {
    const withPlate: ArtPayload = {
      version: 1,
      canvas: "hexagon",
      depth: 2,
      convention: "apex",
      cells: [],
      plate: [
        ["s0:AA", GOLD],
        ["s1:A", BLUE],
      ],
    };
    const read = extractArt(encodeArt(withPlate));
    expect(read).not.toBe(null);
    if (read === null) return;
    const comp = fromArtPayload(read, book2);
    expect(comp.layers[0].plate.size).toBe(2);
    expect(flatten(comp, book2).get(cell(book2, "s1:AA"))).toBe(BLUE);
  });

  it("`flattenAddresses` states the composite as the picture, not as a union", () => {
    // The merge would leave `s0:AB` gold under a red wash; the composite does not.
    const comp = C([L(1, [["s0:AB", GOLD]]), L(2, [["s0:A", RED]])]);
    const flat = flattenAddresses(comp, book2);
    expect(flat.get("s0:AB")).toBe(RED);
    expect(flat.has("s0:A")).toBe(false);
    for (const [a, hex] of flat) {
      expect(a.length).toBe(book2.stem + book2.depth);
      expect(hex).toBe(RED);
    }
  });
});

// ── what the serialiser walks ────────────────────────────────────────────

describe("the serialiser's interface", () => {
  const doc = () =>
    C([
      L(1, [["s0:AA", GOLD]]),
      L(2, [["s0:AB", RED]], {
        visible: false,
        children: [L(3, [["s0:AC", BLUE]]), L(4)],
      }),
    ]);

  it("hands slices back in PAINT ORDER — bottom first, a layer before its children", () => {
    expect(slices(doc()).map((s) => s.node.id)).toEqual([
      layerId(1),
      layerId(2),
      layerId(3),
      layerId(4),
    ]);
    expect(slices(doc()).map((s) => s.depth)).toEqual([0, 0, 1, 1]);
  });

  it("carries the EFFECTIVE answer, not the layer's own switch", () => {
    const child = slices(doc()).find((s) => s.node.id === layerId(3));
    expect(child?.node.visible).toBe(true);
    expect(child?.effective.shown).toBe(false);
  });

  it("names each layer's own colours, sorted so two identical layers agree", () => {
    const one = slices(doc())[0];
    expect(one.colours).toEqual([GOLD]);
    expect(one.addresses).toBe(1);
    expect(coloursOf(doc().layers[1])).toEqual([RED]);
    expect(subtreeColours(doc().layers[1])).toEqual([BLUE, RED].sort());
    expect(paletteOf(doc())).toEqual([GOLD, RED, BLUE].sort());
  });

  it("resolves each slice on its own, which is what a writer emits", () => {
    for (const s of slices(doc())) {
      const paint = resolvePlate(s.node.plate, book2);
      for (const [, hex] of paint) expect(s.colours).toContain(hex);
    }
  });

  it("counts the tree rather than asserting it", () => {
    const c = census(doc());
    expect(c).toMatchObject({
      total: 4,
      top: 2,
      deepest: 2,
      painted: 3,
      shown: 1,
      editable: 4,
      addresses: 3,
      duplicateIds: [],
    });
  });
});

// ── what a stack of layers costs at depth 5 ──────────────────────────────

/**
 * REPORTED, not asserted.
 *
 * The brief asked: "resolvePlate runs per layer per render — with N layers that
 * is N×. Measure it and say what N stays interactive." Three shapes and three
 * fills are measured, because arbitrary nesting makes the shape a variable and
 * OCCLUSION makes the fill one.
 *
 *   shapes    N siblings, a chain of N nested one per level, and a mixed tree of
 *             four chains — the same N plates arranged three ways.
 *
 *   overlap   every layer paints the SAME sparse address set. Nothing is ever
 *             fully covered, so the walk never stops early. This is the honest
 *             linear case and the one to read the scaling off.
 *   spread    each layer paints a different sparse set, so a few of them
 *             together cover the model and the walk stops. Realistic, and it is
 *             why the `spread` column stops growing.
 *   full      every layer paints all 6144 cells. The topmost decides everything
 *             and the rest are never touched at all.
 *
 * Three timings per cell:
 *
 *   cold      no plate in this stack has ever been resolved. One load of a file.
 *   warm      the same stack asked twice. Every re-render that changed nothing.
 *   stroke    one layer repainted, the rest untouched. Every frame of a drag,
 *             and also what a reorder or a visibility toggle costs, since those
 *             build a new stack out of plates the cache already holds.
 */
describe("flatten cost at depth 5, reported", () => {
  it("composites wide, deep and mixed stacks of the deepest plate", () => {
    const hex = buildHexagon(5);
    const book = addressBook(hex);
    const ms = (f: () => void): string => {
      const t0 = performance.now();
      f();
      return (performance.now() - t0).toFixed(2);
    };

    type Fill = "overlap" | "spread" | "full";

    /** A FRESH plate object every time, so the resolution cache starts cold. */
    const makePlate = (fill: Fill, seed: number): AddressPlate => {
      const out = new Map<Address, string>();
      const stride = fill === "full" ? 1 : 7;
      const start = fill === "spread" ? seed % stride : 0;
      for (let i = start; i < book.addr.length; i += stride) {
        out.set(book.addr[i], i % 2 === 0 ? GOLD : RED);
      }
      return out;
    };

    const wide = (n: number, fill: Fill): Composition =>
      C(Array.from({ length: n }, (_, k) => L(k + 1, [], { plate: makePlate(fill, k) })));

    const deep = (n: number, fill: Fill): Composition => {
      let node = L(n, [], { plate: makePlate(fill, n - 1) });
      for (let k = n - 1; k >= 1; k--) {
        node = L(k, [], { plate: makePlate(fill, k - 1), children: [node] });
      }
      return C([node]);
    };

    /** Four top-level layers, each carrying a chain of the rest. */
    const mixed = (n: number, fill: Fill): Composition => {
      const tops: Layer[] = [];
      let made = 0;
      for (let t = 0; t < 4 && made < n; t++) {
        const chain: Layer[] = [];
        for (let k = 0; k < Math.ceil(n / 4) && made < n; k++) {
          made += 1;
          chain.push(L(made, [], { plate: makePlate(fill, made) }));
        }
        let node = chain[chain.length - 1];
        for (let k = chain.length - 2; k >= 0; k--) {
          node = { ...chain[k], children: [node] };
        }
        tops.push(node);
      }
      return C(tops);
    };

    for (const fill of ["overlap", "spread", "full"] as const) {
      for (const n of [1, 2, 4, 8, 16, 32]) {
        const line: string[] = [];
        let cells = 0;
        for (const [what, build] of [
          ["wide", wide],
          ["deep", deep],
          ["mixed", mixed],
        ] as const) {
          const comp = build(n, fill);
          const cold = ms(() => {
            cells = flatten(comp, book).size;
          });
          const warm = ms(() => {
            flatten(comp, book);
          });
          // ONE layer repainted: a new stack, a new plate for the bottom layer,
          // and N−1 plates the resolution cache already holds.
          const repainted: Composition = {
            ...comp,
            layers: [
              { ...comp.layers[0], plate: makePlate(fill, 99) },
              ...comp.layers.slice(1),
            ],
          };
          const stroke = ms(() => {
            flatten(repainted, book);
          });
          line.push(`${what} ${cold}/${warm}/${stroke}`);
        }
        console.log(
          `d5 ${fill.padEnd(7)} N=${String(n).padStart(2)}  ` +
            `${line.join("  ")}  ms cold/warm/stroke   (${cells} of 6144 cells shown)`
        );
      }
    }
    expect(flatten(wide(4, "full"), book).size).toBe(6144);
  });

  it("stops the walk once every cell is decided, so a top wash is free", () => {
    const hex = buildHexagon(5);
    const book = addressBook(hex);
    const full = new Map<Address, string>();
    for (const a of book.addr) full.set(a, GOLD);
    const sparse = new Map<Address, string>();
    for (let i = 0; i < book.addr.length; i += 7) sparse.set(book.addr[i], RED);

    const ms = (f: () => void): number => {
      const t0 = performance.now();
      f();
      return performance.now() - t0;
    };
    // Twelve sparse layers under one full one. The full layer is reached FIRST
    // by the reverse walk, so nothing under it is resolved at all.
    const under = Array.from({ length: 12 }, (_, k) =>
      L(k + 1, [], { plate: new Map(sparse) })
    );
    const capped = C([...under, L(99, [], { plate: full })]);
    const open = C([...under.map((l) => ({ ...l })), L(98, [], { plate: new Map() })]);
    const cappedMs = ms(() => {
      flatten(capped, book);
    });
    const openMs = ms(() => {
      flatten(open, book);
    });
    console.log(
      `d5 occlusion: 12 sparse layers under a full wash ${cappedMs.toFixed(2)}ms, ` +
        `uncapped ${openMs.toFixed(2)}ms`
    );
    expect(flatten(capped, book).size).toBe(6144);
    for (const [, hex6] of flatten(capped, book)) expect(hex6).toBe(GOLD);
  });
});

// ── the module is total ──────────────────────────────────────────────────

describe("the operations are total", () => {
  it("`at` refuses to call the whole stack a layer", () => {
    expect(at(C([L(1)]), [])).toBe(null);
    expect(at(C([L(1)]), [9])).toBe(null);
    expect(at(C([L(1)]), [0, 0])).toBe(null);
  });

  it("`pathOf` and `find` say null rather than guessing", () => {
    expect(pathOf(C([L(1)]), layerId(9))).toBe(null);
    expect(find(C([L(1)]), layerId(9))).toBe(null);
    expect(effectiveOf(C([L(1)]), layerId(9))).toBe(null);
  });

  it("an act with no moves is not a rung", () => {
    const s = newSession(C([L(1)]));
    expect(act(s, [], "nothing")).toBe(s);
  });

  it("a paint into a layer that is not there is loud, not silent", () => {
    const s = C([L(1)]);
    expect(() => paintInto(s, layerId(9), [{ cell: "s0:AA", from: null, to: RED }])).toThrow(
      /no layer/
    );
  });

  it("holds an empty document without special-casing it", () => {
    const empty = C([]);
    expect(flatten(empty, book2).size).toBe(0);
    expect(slices(empty)).toEqual([]);
    expect(census(empty).deepest).toBe(0);
    expect(paintTarget(empty).ok).toBe(false);
    expect(canArrange(empty, "up")).toBe(false);
  });

  it("applies plate edits through `plate.ts` and nothing else", () => {
    const start: AddressPlate = new Map([["s0:AA", GOLD]]);
    const edits = planPlateEdits(start, book2, ["s0:AA"], [null]);
    const comp = paintInto(C([L(1, [], { plate: start })]), layerId(1), edits);
    const direct = applyPlateEdits(start, edits, "do");
    expect([...(find(comp, layerId(1))?.plate ?? new Map())]).toEqual([...direct]);
  });
});
