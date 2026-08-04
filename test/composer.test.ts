/**
 * The bridge between the layer tree, the file and the panel.
 *
 * Three claims, and they are the three the panel and the previews turn on:
 *
 *   STEPPING THE JOURNAL IS EXACT IN BOTH DIRECTIONS. A scrub that walks back
 *   over a paint, an add, a reorder and a paste, and then forward again, has to
 *   arrive at the same tree — not the same picture, the same TREE, ids and all —
 *   or the preview is showing a drawing nobody made.
 *
 *   A COMPOSITION SURVIVES THE FILE. What comes back has the layer's OWN
 *   switches, its own paint, its own children and its own nesting, and the flags
 *   are never the inherited ones — a hidden parent must not permanently mark its
 *   children hidden.
 *
 *   THE PANEL'S ORDER IS THE STACKING ORDER, with no exception at a group. Read
 *   the rows top to bottom and you are reading down through the drawing.
 */

import { describe, expect, it } from "vitest";
import { buildHexagon } from "../src/lib/hexagon";
import { addressBook, type Address, type AddressBook } from "../src/lib/plate";
import { progressionIndex } from "../src/lib/brush";
import { HISTORY_LIMIT } from "../src/lib/strokes";
import {
  act,
  addLayer,
  arrange,
  clearLayer,
  emptyComposition,
  find,
  flatten,
  fromPlate,
  layerId,
  newSession,
  OPEN,
  pasteInto,
  redo,
  removeLayer,
  switchesOf,
  undo,
  type Composition,
  type Layer,
  type Move,
  type Session,
} from "../src/lib/layers";
import {
  actCells,
  actPaints,
  actStrokes,
  clampAct,
  emitLayersOf,
  eventsOf,
  everyComposition,
  idsIn,
  invertMove,
  layerCells,
  panelRows,
  revertMoves,
  stackAddresses,
  stepComposition,
  subtreePlate,
  type PanelRow,
} from "../src/lib/composer";

const BOOK: AddressBook = addressBook(buildHexagon(2, "apex"));

const plate = (...pairs: [string, string][]) =>
  new Map<Address, string>(pairs.map(([a, c]) => [a as Address, c]));

const paint = (layer: string, cell: string, from: string | null, to: string | null): Move => ({
  kind: "paint",
  layer: layerId(Number(layer.slice(1))),
  stroke: { edits: [{ cell: cell as Address, from, to }] },
});

/** The shape of a tree, as a string, so two trees can be compared by eye. */
function shape(comp: Composition): string {
  // The switches are read off the COMPOSITION — they are not on the layer any
  // more, and `layers.Switches` says why.
  const go = (list: readonly Layer[]): string =>
    list
      .map(
        (l) => {
          const own = switchesOf(comp, l.id);
          return (
          `${l.id}:${l.name}${own.visible ? "" : "-hid"}${own.locked ? "-lock" : ""}` +
          `{${[...l.plate.entries()].sort().map(([a, c]) => `${a}=${c}`).join(",")}}` +
          (l.children.length === 0 ? "" : `(${go(l.children)})`)
          );
        }
      )
      .join(" ");
  return go(comp.layers);
}

/** A session with a paint, an add, a paint, a reorder and a delete on it. */
function busy(): Session {
  let s = newSession(fromPlate(plate(["s0:AA", "#111111"])));
  const first = s.composition.layers[0].id;
  s = act(s, [paint("L1", "s0:AB", null, "#222222")], "painted L1");
  s = addLayer(s, "Second");
  const second = s.composition.layers[1].id;
  s = act(s, [paint(String(second), "s1:BB", null, "#333333")], "painted L2");
  const moved = arrange(s, "down");
  if (moved.ok) s = moved.value;
  s = addLayer(s, "Third");
  const gone = removeLayer(s);
  if (gone.ok) s = gone.value;
  expect(find(s.composition, first)).not.toBeNull();
  return s;
}

describe("stepping the journal", () => {
  it("walks back to the base and forward again to the same tree", () => {
    const s = busy();
    const live = shape(s.composition);
    const past = s.journal.past;
    expect(past.length).toBeGreaterThan(3);
    const base = stepComposition(s.composition, past, past.length, 0);
    const again = stepComposition(base, past, 0, past.length);
    expect(shape(again)).toBe(live);
  });

  it("is the identity over a round trip through any intermediate state", () => {
    const s = busy();
    const past = s.journal.past;
    const live = shape(s.composition);
    for (let k = 0; k <= past.length; k++) {
      const there = stepComposition(s.composition, past, past.length, k);
      const back = stepComposition(there, past, k, past.length);
      expect(shape(back)).toBe(live);
    }
  });

  it("reaches the same state from either side", () => {
    const s = busy();
    const past = s.journal.past;
    const base = stepComposition(s.composition, past, past.length, 0);
    for (let k = 0; k <= past.length; k++) {
      const down = stepComposition(s.composition, past, past.length, k);
      const up = stepComposition(base, past, 0, k);
      expect(shape(up)).toBe(shape(down));
    }
  });

  it("clamps an index outside the journal to its ends", () => {
    const s = busy();
    const past = s.journal.past;
    expect(clampAct(-4, past.length)).toBe(0);
    expect(clampAct(999, past.length)).toBe(past.length);
    expect(clampAct(Number.NaN, past.length)).toBe(past.length);
    expect(shape(stepComposition(s.composition, past, past.length, -3))).toBe(
      shape(stepComposition(s.composition, past, past.length, 0))
    );
  });

  it("gives one composition per state, oldest first", () => {
    const s = busy();
    const every = everyComposition(s.composition, s.journal.past);
    expect(every.length).toBe(s.journal.past.length + 1);
    expect(shape(every[0])).toBe(
      shape(stepComposition(s.composition, s.journal.past, s.journal.past.length, 0))
    );
    expect(shape(every[every.length - 1])).toBe(shape(s.composition));
  });
});

describe("reverting", () => {
  it("lands exactly on the state it names", () => {
    const s = busy();
    const past = s.journal.past;
    for (let k = 0; k < past.length; k++) {
      const want = shape(stepComposition(s.composition, past, past.length, k));
      const moves = revertMoves(past, past.length, k);
      const reverted = act(s, moves, "revert");
      expect(shape(reverted.composition)).toBe(want);
    }
  });

  it("is ONE rung, and undoing it puts every act back at once", () => {
    const s = busy();
    const live = shape(s.composition);
    const moves = revertMoves(s.journal.past, s.journal.past.length, 0);
    const reverted = act(s, moves, "revert");
    expect(reverted.journal.past.length).toBe(s.journal.past.length + 1);
    // `undo` of that one rung is the whole drawing back.
    const back = stepComposition(
      reverted.composition,
      reverted.journal.past,
      reverted.journal.past.length,
      reverted.journal.past.length - 1
    );
    expect(shape(back)).toBe(live);
  });

  it("is empty when the drawing already stands there", () => {
    const s = busy();
    expect(revertMoves(s.journal.past, s.journal.past.length, s.journal.past.length))
      .toHaveLength(0);
  });

  it("inverts a move, and inverting twice is the identity", () => {
    const m = paint("L1", "s0:AA", "#111111", "#222222");
    const back = invertMove(m);
    expect(back.kind).toBe("paint");
    if (back.kind === "paint") {
      expect(back.stroke.edits[0]).toEqual({
        cell: "s0:AA",
        from: "#222222",
        to: "#111111",
      });
    }
    expect(invertMove(back)).toEqual(m);
  });

  it("inverts a placement and a rename", () => {
    const node: Layer = {
      id: layerId(9),
      name: "N",
      plate: new Map(),
      children: [],
    };
    const place: Move = { kind: "place", op: "insert", at: [0], node };
    const flipped = invertMove(place);
    expect(flipped).toEqual({ kind: "place", op: "remove", at: [0], node });
    expect(invertMove(flipped)).toEqual(place);
    const rename: Move = { kind: "rename", layer: layerId(1), from: "a", to: "b" };
    expect(invertMove(rename)).toEqual({
      kind: "rename",
      layer: layerId(1),
      from: "b",
      to: "a",
    });
  });
});

describe("the journal, as gestures", () => {
  it("gives one stroke per act, holding every paint move it carries", () => {
    const s = act(
      newSession(emptyComposition()),
      [
        paint("L1", "s0:AA", null, "#111111"),
        paint("L1", "s0:AB", null, "#222222"),
      ],
      "two moves, one act"
    );
    const strokes = actStrokes(s.journal.past);
    expect(strokes).toHaveLength(1);
    expect(strokes[0].edits).toHaveLength(2);
  });

  it("gives an EMPTY stroke for a structural act", () => {
    const s = addLayer(newSession(emptyComposition()), "Second");
    const strokes = actStrokes(s.journal.past);
    expect(strokes).toHaveLength(1);
    expect(strokes[0].edits).toHaveLength(0);
    expect(actPaints(s.journal.past[0])).toBe(false);
    expect(actCells(s.journal.past[0])).toBe(0);
  });

  it("keeps the first mark an act carries and invents none", () => {
    const withMark: Move = {
      kind: "paint",
      layer: layerId(1),
      stroke: {
        edits: [{ cell: "s0:AA" as Address, from: null, to: "#111111" }],
        mark: { mode: 6, groups: [["s0:AA" as Address]] },
      },
    };
    const s = act(newSession(emptyComposition()), [withMark], "marked");
    expect(actStrokes(s.journal.past)[0].mark?.mode).toBe(6);
    const plain = act(newSession(emptyComposition()), [paint("L1", "s0:AA", null, "#1")], "x");
    expect(actStrokes(plain.journal.past)[0].mark).toBeUndefined();
  });

  it("counts the cells an act moved, across every layer it touched", () => {
    const s = act(
      newSession(emptyComposition()),
      [paint("L1", "s0:AA", null, "#111111"), paint("L1", "s0:AB", null, "#222222")],
      "two"
    );
    expect(actCells(s.journal.past[0])).toBe(2);
    expect(actPaints(s.journal.past[0])).toBe(true);
  });
});

describe("the composition, through the file", () => {
  /** A nested document: a hidden parent over a locked child over paint. */
  function nested(): Composition {
    const inner: Layer = {
      id: layerId(3),
      name: "Inner",
      plate: plate(["s2:AA", "#333333"]),
      children: [],
    };
    const outer: Layer = {
      id: layerId(2),
      name: "Outer",
      plate: plate(["s1:BB", "#222222"]),
      children: [inner],
    };
    const ground: Layer = {
      id: layerId(1),
      name: "Ground",
      plate: plate(["s0:AA", "#111111"]),
      children: [],
    };
    return {
      layers: [ground, outer],
      selected: ground.id,
      nextId: 4,
      // The two switches, on the composition where they belong.
      switches: new Map([
        [outer.id, { visible: false, locked: false }],
        [inner.id, { visible: true, locked: true }],
      ]),
    };
  }

  it("carries every OWN switch out and back, and no inherited one", () => {
    const comp = nested();
    const out = emitLayersOf(comp, BOOK);
    expect(out).toHaveLength(2);
    expect(out[1].hidden).toBe(true);
    // The CHILD of a hidden parent is not marked hidden — that is the whole
    // reason `Effective` is computed and never stored.
    const child = out[1].children?.[0];
    expect(child?.hidden).toBeUndefined();
    expect(child?.locked).toBe(true);

    // The switches come back BESIDE the stack, keyed by the ids just minted.
    const built = stackFromEmitAt(out, 1);
    const own = (l: Layer) => built.switches.get(l.id) ?? OPEN;
    const back = built.stack;
    expect(own(back[0]).visible).toBe(true);
    expect(own(back[1]).visible).toBe(false);
    expect(own(back[1].children[0]).visible).toBe(true);
    expect(own(back[1].children[0]).locked).toBe(true);
  });

  it("carries names, nesting and paint out and back", () => {
    const comp = nested();
    const back = stackFrom(emitLayersOf(comp, BOOK));
    expect(back.map((l) => l.name)).toEqual(["Ground", "Outer"]);
    expect(back[1].children.map((l) => l.name)).toEqual(["Inner"]);
    expect([...back[0].plate.values()]).toEqual(["#111111"]);
    expect([...back[1].children[0].plate.values()]).toEqual(["#333333"]);
  });

  it("composites to the same picture after the round trip", () => {
    const comp = nested();
    const before = flatten(comp, BOOK);
    const built = stackFromEmitAt(emitLayersOf(comp, BOOK), 1);
    const after = flatten(
      { layers: built.stack, selected: null, nextId: 99, switches: built.switches },
      BOOK
    );
    expect([...after.entries()].sort()).toEqual([...before.entries()].sort());
  });

  it("mints ids from the counter it is given and never the file's", () => {
    const comp = nested();
    const built = stackFromEmitAt(emitLayersOf(comp, BOOK), 40);
    const ids = [...idsIn(built.stack)];
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(Number(id.slice(1))).toBeGreaterThanOrEqual(40);
    expect(built.nextId).toBe(43);
  });

  it("names a layer after the file's id when the file gives no name", () => {
    const built = stackFromEmitAt([{ id: "sheet_a" }], 1);
    expect(built.stack[0].name).toBe("sheet_a");
  });

  it("drops a cell index the current canvas does not have", () => {
    const built = stackFromEmitAt(
      [{ id: "a", paint: new Map([[999999, "#111111"]]) }],
      1
    );
    expect(built.stack[0].plate.size).toBe(0);
  });

  it("pasted twice, from one copy, gives two independent subtrees", () => {
    const comp = nested();
    const node = stackFrom(emitLayersOf(comp, BOOK));
    const one: Layer = {
      id: layerId(0),
      name: "Doc",
      plate: new Map(),
      children: node,
    };
    let s = newSession(emptyComposition());
    const a = pasteInto(s, one);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    s = a.value;
    const b = pasteInto(s, one);
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    s = b.value;
    const ids = idsIn(s.composition.layers);
    let n = 0;
    const count = (list: readonly Layer[]): void => {
      for (const l of list) {
        n += 1;
        count(l.children);
      }
    };
    count(s.composition.layers);
    expect(ids.size).toBe(n);
  });
});

describe("counting a subtree", () => {
  it("counts a layer's own cells at the book's depth", () => {
    const l: Layer = {
      id: layerId(1),
      name: "L",
      // One coarse address, which resolves onto four cells at depth 2.
      plate: plate(["s0:A", "#111111"]),
      children: [],
    };
    expect(l.plate.size).toBe(1);
    expect(layerCells(l, BOOK)).toBe(4);
    const empty: Layer = { ...l, plate: new Map() };
    expect(layerCells(empty, BOOK)).toBe(0);
  });

  it("sums the addresses of a whole tree, and flattens its plate in order", () => {
    const inner: Layer = {
      id: layerId(2),
      name: "in",
      plate: plate(["s0:AA", "#222222"]),
      children: [],
    };
    const outer: Layer = {
      id: layerId(1),
      name: "out",
      plate: plate(["s0:AA", "#111111"], ["s0:AB", "#111111"]),
      children: [inner],
    };
    expect(stackAddresses([outer])).toBe(3);
    // The child paints over the parent, so its colour is the one that survives.
    expect(subtreePlate(outer).get("s0:AA" as Address)).toBe("#222222");
    expect(subtreePlate(outer).size).toBe(2);
  });
});

describe("the panel's rows", () => {
  /**
   *   ground                       layers[0], the bottom
   *   mid ── kid                   layers[1] with one child
   *   top                          layers[2], nearest the viewer
   */
  function tree(): Composition {
    const bare = (n: number, name: string, children: Layer[] = []): Layer => ({
      id: layerId(n),
      name,
      plate: new Map(),
      children,
    });
    return {
      layers: [bare(1, "ground"), bare(2, "mid", [bare(3, "kid")]), bare(4, "top")],
      selected: null,
      nextId: 5,
      switches: new Map(),
    };
  }

  const names = (rows: readonly PanelRow[]) => rows.map((r) => r.layer.name);

  it("lists the top of the drawing first", () => {
    expect(names(panelRows(tree()))).toEqual(["top", "kid", "mid", "ground"]);
  });

  it("lists a layer's children ABOVE it, because they paint over it", () => {
    const rows = panelRows(tree());
    expect(rows.findIndex((r) => r.layer.name === "kid")).toBeLessThan(
      rows.findIndex((r) => r.layer.name === "mid")
    );
  });

  it("is the paint order, exactly reversed", () => {
    // `slices` is paint order — bottom first, a layer BEFORE its children — so
    // the panel's list must be that array read backwards, with no exception.
    const comp = tree();
    const painted: string[] = [];
    const walk = (list: readonly Layer[]): void => {
      for (const l of list) {
        painted.push(l.name);
        walk(l.children);
      }
    };
    walk(comp.layers);
    expect(names(panelRows(comp))).toEqual([...painted].reverse());
  });

  it("indents by containment and marks which rows hold children", () => {
    const rows = panelRows(tree());
    const at = (n: string) => rows.find((r) => r.layer.name === n) as PanelRow;
    expect(at("top").depth).toBe(0);
    expect(at("mid").depth).toBe(0);
    expect(at("kid").depth).toBe(1);
    expect(at("mid").group).toBe(true);
    expect(at("kid").group).toBe(false);
  });

  it("gives the INHERITED answers, not the layer's own switches", () => {
    const comp = tree();
    const hidden: Composition = {
      ...comp,
      switches: new Map([[comp.layers[1].id, { visible: false, locked: true }]]),
    };
    const rows = panelRows(hidden);
    const kid = rows.find((r) => r.layer.name === "kid") as PanelRow;
    // Its OWN switches are untouched; the inherited answers are both false.
    expect(kid.own.visible).toBe(true);
    expect(kid.own.locked).toBe(false);
    expect(kid.effective.shown).toBe(false);
    expect(kid.effective.editable).toBe(false);
    const top = rows.find((r) => r.layer.name === "top") as PanelRow;
    expect(top.effective.shown).toBe(true);
  });

  it("draws a guide only while the block it brackets continues", () => {
    // `mid` is `layers[1]`, so there IS a sibling below it (`ground`) and its
    // child's guide runs on; make it `layers[0]` and the guide has to stop.
    const comp = tree();
    const rows = panelRows(comp);
    const kid = rows.find((r) => r.layer.name === "kid") as PanelRow;
    expect(kid.spine).toEqual([true]);

    const bottom: Composition = {
      ...comp,
      layers: [comp.layers[1], comp.layers[0], comp.layers[2]],
    };
    const kid2 = panelRows(bottom).find((r) => r.layer.name === "kid") as PanelRow;
    expect(kid2.spine).toEqual([false]);
  });

  it("has one row per layer, at any depth, and no duplicates", () => {
    let s = newSession(emptyComposition());
    for (let k = 0; k < 5; k++) s = addLayer(s, `L${k}`);
    const rows = panelRows(s.composition);
    expect(rows.length).toBe(s.composition.layers.length);
    expect(new Set(rows.map((r) => r.layer.id)).size).toBe(rows.length);
  });

  it("is empty for an empty document", () => {
    // The state a person reaches by deleting the last layer, which the panel
    // has to render as an empty list rather than as a crash.
    const s = newSession(emptyComposition());
    const gone = removeLayer(s);
    expect(gone.ok).toBe(true);
    if (!gone.ok) return;
    expect(gone.value.composition.layers).toHaveLength(0);
    expect(panelRows(gone.value.composition)).toHaveLength(0);
  });
});

// ── the colour progression's counter ─────────────────────────────────────

/**
 * ONE STACK, NOT TWO.
 *
 * The colouring-event count used to live in a second stack beside the journal,
 * pushed by whichever call site remembered. Three did — a stroke pushed what it
 * spent, a revert pushed zero, a preset pushed what it spent — and CLEAR did
 * not, because the page calls `clearLayer` through the same `run` every
 * structural control uses. So a clear added a journal rung with no matching
 * event rung, and the next undo popped a rung belonging to a DIFFERENT gesture.
 * Measured before the fix: two journal rungs against one event rung, and a
 * progression index of 3 that undoing the clear took to 0 — every later stroke
 * silently the wrong hue, and unrecoverable without NEW.
 *
 * `Act.events` carries the count now, so the log is a PROJECTION of the journal
 * and the two cannot be pushed apart. These tests measure that they never are.
 */
describe("the event log is the journal", () => {
  const RED = "#c0392b";
  const GOLD = "#d4a017";

  /** A session holding one painted layer, selected. */
  const painted = (): Session => {
    const s = newSession(fromPlate(plate(["s0:AA", RED])));
    return s;
  };

  /** One paint act spending `events` colouring events. */
  const stroke = (s: Session, cell: string, events: number): Session =>
    act(
      s,
      [
        {
          kind: "paint",
          layer: s.composition.layers[0].id,
          stroke: { edits: [{ cell: cell as Address, from: null, to: GOLD }] },
        },
      ],
      "painted",
      events
    );

  it("gives every journalled act exactly one event rung, CLEAR included", () => {
    let s = stroke(painted(), "s0:AB", 3);
    const cleared = clearLayer(s);
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    s = cleared.value;
    // Two acts, two rungs. This is the count that used to come out 2 against 1.
    expect(s.journal.past).toHaveLength(2);
    expect(eventsOf(s.journal).past).toHaveLength(2);
  });

  it("spends nothing on a clear, so undoing one does not move the index", () => {
    let s = stroke(painted(), "s0:AB", 3);
    const before = progressionIndex(eventsOf(s.journal), 0);
    expect(before).toBe(3);

    const cleared = clearLayer(s);
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    s = cleared.value;
    // A clear spends no colour, so the index does not move when it lands...
    expect(progressionIndex(eventsOf(s.journal), 0)).toBe(before);
    // ...nor when it is taken back. It used to fall to 0 here, for good.
    expect(progressionIndex(eventsOf(undo(s).session.journal), 0)).toBe(before);
  });

  it("moves the count with the gesture through undo and redo", () => {
    const s = stroke(stroke(painted(), "s0:AB", 3), "s0:AC", 2);
    expect(progressionIndex(eventsOf(s.journal), 0)).toBe(5);
    const back = undo(s);
    expect(progressionIndex(eventsOf(back.session.journal), 0)).toBe(3);
    expect(eventsOf(back.session.journal).future).toEqual([2]);
    const again = redo(back.session);
    expect(progressionIndex(eventsOf(again.session.journal), 0)).toBe(5);
  });

  it("counts nothing for every structural act, by default", () => {
    let s = addLayer(newSession(emptyComposition()));
    s = addLayer(s);
    const moved = arrange(s, "down");
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(eventsOf(moved.value.journal).past.every((n) => n === 0)).toBe(true);
    expect(progressionIndex(eventsOf(moved.value.journal), 0)).toBe(0);
  });

  it("trims both stacks together, because there is only one", () => {
    let s = newSession(fromPlate(plate(["s0:AA", RED])));
    for (let k = 0; k < HISTORY_LIMIT + 4; k++) s = stroke(s, "s0:AB", 1);
    expect(s.journal.past).toHaveLength(HISTORY_LIMIT);
    expect(eventsOf(s.journal).past).toHaveLength(HISTORY_LIMIT);
  });
});

// ── helpers that keep the tests readable ─────────────────────────────────

import { stackFromEmit } from "../src/lib/composer";
import type { EmitLayer } from "../src/lib/emit";

const stackFrom = (list: readonly EmitLayer[]): readonly Layer[] =>
  stackFromEmit(list, BOOK, 1).stack;

const stackFromEmitAt = (list: readonly EmitLayer[], from: number) =>
  stackFromEmit(list, BOOK, from);
