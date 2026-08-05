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
  gestureOf,
  layerId,
  newSession,
  NO_GESTURE,
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
  // These layers are made by this file and carry no gesture, so the move both
  // starts and ends with none. A claim, not an omission — see `MoveGesture`.
  gesture: NO_GESTURE,
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
      gesture: NO_GESTURE,
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

/**
 * GESTURE PROVENANCE SURVIVES THE EDITOR, and it did not.
 *
 * The format has carried `reveal`, `mode` and `orbit` from the start: `emit.ts`
 * writes them as `data-*` on every layer group, still exports included, and
 * `artfile.ts` validates them on the way back in. What was missing was the
 * middle: `layers.Layer` had no slot for the three, so `stackFromEmit` read a
 * file's paint, name, switches and children and dropped the provenance on the
 * floor, and `emitLayersOf` had nothing to write back. Open a provenance-
 * carrying SVG, save it again, and every stroke's symmetry was gone — no error,
 * no warning, a file that still looked pixel-for-pixel identical.
 *
 * The measurement that opened this, before the fix:
 *
 *   AssertionError: expected undefined to be 2 // Object.is equality
 *     expect(out[0].reveal).toBe(2);
 *
 * These tests hold the three claims that made it worth fixing rather than
 * defaulting: the round trip closes, ABSENT stays absent so nothing that was
 * saved before this existed changes by a byte, and `orbit` is never reconciled
 * with `mode`.
 */
describe("gesture provenance, through the file", () => {
  /**
   * A document with no gesture anywhere — the ordinary drawing.
   *
   * Written as `EmitLayer` literals rather than built from a `Composition`, so
   * it states what the file said BEFORE any of this existed and can be compared
   * against what the round trip produces now.
   */
  const plainFile = (): readonly EmitLayer[] => [
    { id: "ground", name: "Ground", paint: new Map([[0, "#111111"]]) },
    {
      id: "over",
      name: "Over",
      locked: true,
      paint: new Map([[1, "#222222"]]),
      children: [{ id: "kid", name: "Kid", hidden: true, paint: new Map([[2, "#333333"]]) }],
    },
  ];

  /** A file whose every layer was made by a gesture, nested three deep. */
  const gestureFile = (): readonly EmitLayer[] => [
    {
      id: "g1",
      name: "Six-fold stroke",
      reveal: 2,
      mode: 6,
      orbit: 3,
      paint: new Map([[0, "#111111"]]),
      children: [
        {
          id: "g2",
          name: "Three-fold stroke",
          reveal: 5,
          mode: 3,
          orbit: 3,
          paint: new Map([[1, "#222222"]]),
          children: [
            { id: "g3", name: "Twelve", reveal: 9, mode: 12, orbit: 12 },
          ],
        },
      ],
    },
  ];

  /** A composition around an imported stack, so it can be emitted again. */
  const compFrom = (list: readonly EmitLayer[], from = 1): Composition => {
    const built = stackFromEmitAt(list, from);
    return {
      layers: built.stack,
      selected: null,
      nextId: built.nextId,
      switches: built.switches,
    };
  };

  /** Which of the three keys a layer actually HOLDS. Not which are defined. */
  const gestureKeys = (o: object): string[] =>
    ["reveal", "mode", "orbit"].filter((k) => Object.hasOwn(o, k));

  it("carries reveal, mode and orbit out and back", () => {
    const out = emitLayersOf(compFrom(gestureFile()), BOOK);
    expect(out[0].reveal).toBe(2);
    expect(out[0].mode).toBe(6);
    expect(out[0].orbit).toBe(3);
  });

  it("carries a layer's OWN gesture at every nesting depth", () => {
    const out = emitLayersOf(compFrom(gestureFile()), BOOK);
    const mid = out[0].children?.[0];
    const deep = mid?.children?.[0];
    expect(mid?.reveal).toBe(5);
    expect(mid?.mode).toBe(3);
    expect(mid?.orbit).toBe(3);
    // Three deep, and a layer holding no paint of its own still keeps it — a
    // group grafted in by a paste is exactly that shape.
    expect(deep?.reveal).toBe(9);
    expect(deep?.mode).toBe(12);
    expect(deep?.orbit).toBe(12);
    expect(deep?.paint).toBeUndefined();
  });

  it("survives a SECOND trip through the file, unchanged", () => {
    // The loss this closes was found by saving a loaded file. One trip is not
    // enough to see it: the damage lands on import and shows on the next export.
    const once = emitLayersOf(compFrom(gestureFile()), BOOK);
    const twice = emitLayersOf(compFrom(once, 500), BOOK);
    const strip = (list: readonly EmitLayer[]): unknown =>
      list.map((l) => ({
        reveal: l.reveal,
        mode: l.mode,
        orbit: l.orbit,
        children: l.children === undefined ? undefined : strip(l.children),
      }));
    expect(strip(twice)).toEqual(strip(once));
  });

  it("never derives orbit from mode, and never reconciles the two", () => {
    // A seed on a mirror line is STABILISED: a 6-fold brush lays down three
    // cells. This pair is the ordinary case, and a derivation would report a
    // six-cell compound path holding three — on exactly the strokes a
    // symmetry-minded reader most wants to find.
    const out = emitLayersOf(compFrom([{ id: "s", mode: 6, orbit: 3 }]), BOOK);
    expect(out[0].mode).toBe(6);
    expect(out[0].orbit).toBe(3);
    expect(out[0].mode).not.toBe(out[0].orbit);
  });

  it("keeps a half-stated gesture half-stated, in both directions", () => {
    // `mode` with no `orbit` must not gain one, and `orbit` with no `mode` must
    // not gain one either. Filling either in would be the format answering a
    // question it was never told the answer to.
    const modeOnly = emitLayersOf(compFrom([{ id: "a", mode: 6 }]), BOOK);
    expect(modeOnly[0].mode).toBe(6);
    expect(gestureKeys(modeOnly[0])).toEqual(["mode"]);

    const orbitOnly = emitLayersOf(compFrom([{ id: "b", orbit: 4 }]), BOOK);
    expect(orbitOnly[0].orbit).toBe(4);
    expect(gestureKeys(orbitOnly[0])).toEqual(["orbit"]);

    // An animated export of a drawing made before symmetry was recorded says
    // `reveal` and nothing else. It stays that way.
    const revealOnly = emitLayersOf(compFrom([{ id: "c", reveal: 0 }]), BOOK);
    expect(revealOnly[0].reveal).toBe(0);
    expect(gestureKeys(revealOnly[0])).toEqual(["reveal"]);
  });

  it("keeps reveal 0 and orbit 0, because absent is not the same as zero", () => {
    // `0` is the FIRST animation step and a falsy number. Any writer testing
    // truthiness rather than `!== undefined` drops the first stroke of every
    // animated file, which is the one failure that looks like a rendering bug.
    const out = emitLayersOf(compFrom([{ id: "z", reveal: 0, mode: 1, orbit: 0 }]), BOOK);
    expect(out[0].reveal).toBe(0);
    expect(out[0].mode).toBe(1);
    expect(out[0].orbit).toBe(0);
    expect(gestureKeys(out[0])).toEqual(["reveal", "mode", "orbit"]);
  });

  it("leaves all three ABSENT on a layer nobody recorded a gesture for", () => {
    const out = emitLayersOf(compFrom(plainFile()), BOOK);
    // OWN KEYS, not values: `{ mode: undefined }` would pass a `toBeUndefined`
    // check and still change `Object.keys`, and any writer that tests for the
    // key rather than the value would start emitting `data-mode=""`.
    expect(gestureKeys(out[0])).toEqual([]);
    expect(gestureKeys(out[1])).toEqual([]);
    expect(gestureKeys(out[1].children?.[0] ?? {})).toEqual([]);
    // And on the model side too — an imported layer must not carry three
    // `undefined`s in from a file that stated nothing.
    const stack = stackFromEmitAt(plainFile(), 1).stack;
    expect(gestureKeys(stack[0])).toEqual([]);
    expect(gestureKeys(stack[1].children[0])).toEqual([]);
  });

  it("does not resolve a gesture under an ancestor", () => {
    // The rule `hidden`, `locked` and `opacity` already follow: a layer states
    // its OWN. A child inside a six-fold parent was not made by a six-fold
    // gesture, and writing the inherited answer would permanently mark it.
    const out = emitLayersOf(
      compFrom([
        { id: "p", mode: 6, orbit: 6, children: [{ id: "c", name: "plain" }] },
      ]),
      BOOK
    );
    expect(out[0].mode).toBe(6);
    expect(gestureKeys(out[0].children?.[0] ?? {})).toEqual([]);
  });

  it("writes a gesture-free document byte for byte as it always did", () => {
    // The strongest form of "absent by default": not a key check but the actual
    // file. The reference list is what the emitter was handed BEFORE `Layer`
    // grew the three fields, stated by hand; the other is what the round trip
    // produces now. If provenance ever leaks a default, these diverge.
    const reference = plainFile();
    const roundTripped = emitLayersOf(compFrom(reference), BOOK);
    // The ids are re-minted on import by design, so compare a document whose
    // layers carry the reference's ids and the round trip's everything else.
    const relabel = (
      list: readonly EmitLayer[],
      like: readonly EmitLayer[]
    ): readonly EmitLayer[] =>
      list.map((l, k) => ({
        ...l,
        id: like[k].id,
        children:
          l.children === undefined
            ? undefined
            : relabel(l.children, like[k].children ?? []),
      }));
    expect(serialise(svgDoc(relabel(roundTripped, reference)))).toBe(
      serialise(svgDoc(reference))
    );
  });

  it("writes data-reveal, data-mode and data-orbit into the markup", () => {
    // The whole point of the field: a `<g>` a stranger's editor can address.
    // Measured on the real serialiser rather than trusted.
    const svg = serialise(svgDoc(emitLayersOf(compFrom(gestureFile()), BOOK)));
    expect(svg).toContain('data-reveal="2"');
    expect(svg).toContain('data-mode="6"');
    expect(svg).toContain('data-orbit="3"');
    // ...and none of the three anywhere in a drawing that recorded none.
    const plain = serialise(svgDoc(emitLayersOf(compFrom(plainFile()), BOOK)));
    expect(plain).not.toContain("data-reveal");
    expect(plain).not.toContain("data-mode");
    expect(plain).not.toContain("data-orbit");
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
          gesture: NO_GESTURE,
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
import { serialise, type EmitDoc, type EmitLayer } from "../src/lib/emit";
import { plateFrame } from "../src/lib/view";
import type { ArtCell } from "../src/lib/strokes";

const stackFrom = (list: readonly EmitLayer[]): readonly Layer[] =>
  stackFromEmit(list, BOOK, 1).stack;

const stackFromEmitAt = (list: readonly EmitLayer[], from: number) =>
  stackFromEmit(list, BOOK, from);

/**
 * A whole `EmitDoc` around a layer list, on the same figure as `BOOK`.
 *
 * Here so the provenance tests can measure the BYTES rather than the interface
 * — "absent by default" is a claim about the file, and the only way to check a
 * claim about a file is to write one. Everything except `layers` is fixed, so
 * two documents differ exactly where their layers do.
 */
function svgDoc(layers: readonly EmitLayer[]): EmitDoc {
  const hex = buildHexagon(2, "apex");
  const pf = plateFrame(hex, { mode: "hexagon", sector: 0 });
  const cells = new Map<number, ArtCell>();
  pf.cells.forEach((c, i) => cells.set(i, { verts: c.verts }));
  return {
    width: pf.width,
    height: pf.height,
    cells,
    shown: pf.shown,
    background: "#0a0908",
    unpainted: "#141110",
    tileSeam: null,
    paintSeam: null,
    seamWidth: 0.7,
    weldPaint: false,
    title: "provenance",
    layers,
    overlay: [],
    animation: null,
    // Held EMPTY and identical across every document this builds: `serialise`
    // fills `comp` in from `layers`, which is the part under test, and a
    // flattened `cells` list would only add a second copy of the same paint.
    payload: {
      version: 1,
      canvas: "hexagon",
      depth: 2,
      convention: "apex",
      cells: [],
    },
  };
}

// ── the gesture, across the one control that journals its inverses ───────

/**
 * REVERT runs INVERSES FORWARD, which is the one direction a paint's gesture
 * strip is not automatically reversible in.
 *
 * `applyMove`'s paint case strips a layer's `mode`/`orbit` going `"do"`, because
 * a paint invalidates them, and writes them back going `"undo"` from what the
 * rung remembers. Undo and the scrub both walk backwards, so both restore. REVERT
 * does not: `revertMoves` builds the inverses through `invertMove` and `doRevert`
 * journals them as one ORDINARY FORWARD act, so every one of them is applied
 * `"do"` — and a `do` that could only ever strip made REVERT the one control that
 * destroys provenance, permanently, in flat contradiction of the sentence it
 * speaks while doing it ("⌘Z brings them all back").
 *
 * That is what `Move.gesture` is for and why it is a `{ from, to }` pair rather
 * than a single remembered value: `invertMove` swaps the two exactly as it swaps
 * every `CellEdit`, so there is no direction in which the gesture and the cells
 * can disagree about which way they are going.
 */
describe("a reverted paint gives the gesture back", () => {
  const GOLD = "#d4a017";
  const RED = "#c0392b";

  /** A document imported from a file whose one layer states a gesture. */
  const imported = (): Session => {
    const { stack } = stackFromEmit(
      [
        {
          id: "g0",
          name: "six fold on a mirror",
          reveal: 4,
          mode: 6,
          orbit: 3,
          paint: new Map([[0, GOLD]]),
        },
      ],
      BOOK,
      1
    );
    return newSession({
      layers: stack,
      selected: stack[0].id,
      nextId: 2,
      switches: new Map(),
    });
  };

  it("survives REVERT, and the undo of the revert", () => {
    const s0 = imported();
    const id = s0.composition.layers[0].id;
    expect(gestureOf(find(s0.composition, id) as Layer)).toEqual({
      reveal: 4,
      mode: 6,
      orbit: 3,
    });

    // Paint into it. The symmetry goes, because it described the cells that were
    // there and those are no longer the cells that are there.
    const painted = act(
      s0,
      [
        {
          kind: "paint",
          layer: id,
          stroke: { edits: [{ cell: "s0:AB" as Address, from: null, to: RED }] },
          gesture: { from: gestureOf(find(s0.composition, id) as Layer) },
        },
      ],
      "painted"
    );
    expect(gestureOf(find(painted.composition, id) as Layer)).toEqual({ reveal: 4 });

    // REVERT to the state before the paint. The cells come back...
    const moves = revertMoves(painted.journal.past, painted.journal.past.length, 0);
    const reverted = act(painted, moves, "reverted");
    expect(find(reverted.composition, id)?.plate.has("s0:AB" as Address)).toBe(false);
    // ...and so does the claim about them. This is the assertion that was false.
    expect(gestureOf(find(reverted.composition, id) as Layer)).toEqual({
      reveal: 4,
      mode: 6,
      orbit: 3,
    });

    // And ⌘Z on the revert rung is the sentence the control speaks: everything
    // back, including the strip the paint performed.
    const back = undo(reverted);
    expect(find(back.session.composition, id)?.plate.get("s0:AB" as Address)).toBe(RED);
    expect(gestureOf(find(back.session.composition, id) as Layer)).toEqual({ reveal: 4 });
  });

  it("agrees with the scrub preview it is the commit of", () => {
    // `stepComposition` walks backwards with `applyMove(…, "undo")` and REVERT
    // walks the inverses forwards. They are two routes to one state and the
    // preview is what the user is looking at when they press the button, so a
    // disagreement between them is the drawing changing at the moment of commit.
    const s0 = imported();
    const id = s0.composition.layers[0].id;
    const painted = act(
      s0,
      [
        {
          kind: "paint",
          layer: id,
          stroke: { edits: [{ cell: "s0:AB" as Address, from: null, to: RED }] },
          gesture: { from: gestureOf(find(s0.composition, id) as Layer) },
        },
      ],
      "painted"
    );
    const past = painted.journal.past;
    for (let k = 0; k <= past.length; k++) {
      const preview = stepComposition(painted.composition, past, past.length, k);
      const committed = act(painted, revertMoves(past, past.length, k), "reverted");
      expect(
        gestureOf(find(committed.composition, id) as Layer),
        `state ${k}`
      ).toEqual(gestureOf(find(preview, id) as Layer));
    }
  });

  it("inverts twice to the move it started as", () => {
    // The property that makes the pair safe: `invertMove` is an involution on
    // the gesture exactly as it is on the edits, so no sequence of inversions
    // can leave the two describing opposite directions.
    const move: Move = {
      kind: "paint",
      layer: layerId(1),
      stroke: { edits: [{ cell: "s0:AB" as Address, from: null, to: RED }] },
      gesture: { from: { reveal: 4, mode: 6, orbit: 3 } },
    };
    expect(invertMove(invertMove(move))).toEqual(move);
    // ...and one inversion really does turn the strip into a restore.
    const back = invertMove(move);
    expect(back.kind).toBe("paint");
    if (back.kind !== "paint") return;
    expect(back.gesture.to).toEqual({ reveal: 4, mode: 6, orbit: 3 });
    expect(back.gesture.from).toBeUndefined();
  });
});
