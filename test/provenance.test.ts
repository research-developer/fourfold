/**
 * The history, read back as provenance.
 *
 * Every gesture in here is made by the REAL machinery — `orbit.ts` for the
 * symmetry, `brush.ts` for the stamp, `plate.ts` for the edits — and never by a
 * hand-written mark. That is deliberate: the one thing these tests exist to
 * catch is a layer that says `orbit: mode` when the geometry says otherwise, and
 * a fixture written by the same hand that wrote the implementation would agree
 * with it about exactly that.
 */

import { describe, expect, it } from "vitest";
import { gzipSync } from "node:zlib";
import { buildHexagon } from "../src/lib/hexagon";
import {
  hexagonSurface,
  orbitSizeCensus,
  type BrushMode,
  type BrushScope,
  type SymmetrySurface,
} from "../src/lib/orbit";
import { brushStamp, type BrushShape } from "../src/lib/brush";
import { buildBandSurface } from "../src/lib/bands";
import {
  addressBook,
  applyPlateEdits,
  planPlateEdits,
  resolvePlate,
  type Address,
  type AddressPlate,
} from "../src/lib/plate";
import {
  clearStroke,
  mergeEdits,
  type CellEdit,
  type Stroke,
  type StrokeMark,
} from "../src/lib/strokes";
import { flatten, parse, serialise, type EmitDoc, type EmitLayer } from "../src/lib/emit";
import { plateFrame } from "../src/lib/view";
import {
  byMode,
  complement,
  gestureAnimation,
  gestureLayers,
  provenanceCensus,
  select,
  shortOrbits,
  unmarked,
} from "../src/lib/provenance";

// ── the harness: gestures made the way the program makes them ────────────

const DEPTH = 3;
const hex = buildHexagon(DEPTH);
const book = addressBook(hex);
const bands = buildBandSurface(hex);
const surfaceOf = (scope: BrushScope): SymmetrySurface => hexagonSurface(hex, scope);

interface Session {
  plate: AddressPlate;
  past: Stroke<Address>[];
}

const fresh = (): Session => ({ plate: new Map<Address, string>(), past: [] });

/**
 * One committed gesture, applied at every seed in turn.
 *
 * This is `draw/page.tsx`'s `paintAt` + `endStroke` with the UI taken out: plan
 * the edits against the plate AS IT STANDS, push the stamp's groups in the order
 * the brush applied them, merge the edits into the gesture, and commit one
 * stroke carrying one mark. Several seeds is a DRAG; one seed is a tap.
 */
function commit(
  s: Session,
  scope: BrushScope,
  shape: BrushShape,
  seeds: readonly number[],
  colour: string | null
): void {
  const surface = surfaceOf(scope);
  let edits: CellEdit<Address>[] = [];
  const groups: Address[][] = [];
  for (const seed of seeds) {
    const stamp = brushStamp(surface, bands, seed, shape);
    const planned = planPlateEdits(
      s.plate,
      book,
      stamp.cells.map((c) => book.addr[c]),
      stamp.cells.map(() => colour)
    );
    if (planned.length === 0) continue;
    for (const g of stamp.groups ?? [stamp.cells]) {
      if (g.length === 0) continue;
      groups.push(g.map((c) => book.addr[c]));
    }
    s.plate = applyPlateEdits(s.plate, planned, "do");
    edits = mergeEdits(edits, planned);
  }
  if (edits.length === 0) return;
  const mark: StrokeMark<Address> | undefined =
    groups.length === 0 ? undefined : { mode: shape.mode, groups };
  s.past.push(mark === undefined ? { edits } : { edits, mark });
}

/** A gesture with no mark at all — what CLEAR, a preset and a load produce. */
function commitUnmarked(s: Session): void {
  const stroke = clearStroke(s.plate);
  if (stroke.edits.length === 0) return;
  s.plate = applyPlateEdits(s.plate, stroke.edits, "do");
  s.past.push(stroke);
}

const plain = (mode: BrushMode): BrushShape => ({ mode, band: null });

const PALETTE = ["#d4a017", "#c0392b", "#2e86c1", "#7d3c98", "#1e8449", "#e67e22"];

/** The first cell whose orbit under `mode` has exactly `size` members. */
function seedWithOrbit(scope: BrushScope, mode: BrushMode, size: number): number {
  const surface = surfaceOf(scope);
  for (let i = 0; i < surface.cellCount; i++) {
    if (surface.orbit(i, mode).length === size) return i;
  }
  throw new Error(`no cell of ${scope} has a ${size}-cell orbit at mode ${mode}`);
}

// ── the measurement the whole module rests on ────────────────────────────

describe("the realised orbit is not the mode", () => {
  it("measures which brushes pin a seed, on the depth-3 hexagon", () => {
    const census = (scope: BrushScope, mode: BrushMode) =>
      [...orbitSizeCensus(surfaceOf(scope), mode)];

    // The whole plate is FREE below mode 12: no cell of the hexagon sits on a
    // centre of rotation, so every rotational orbit is the full subgroup.
    expect(census("hexagon", 6)).toEqual([[6, 64]]);
    // Mode 12 brings in the reflections, and the sector-spine mirrors pin the
    // cells whose word is over {A, X} — 2^3 per sector, 8 orbits of 6.
    expect(census("hexagon", 12)).toEqual([
      [6, 8],
      [12, 28],
    ]);
    // A sector's own D3 is the triangle's group, where the median pins 2^3 cells
    // per sector and the hub is a singleton in every mode.
    expect(census("sector", 6)).toEqual([
      [1, 6],
      [3, 42],
      [6, 42],
    ]);
    // 6·1 + 42·3 + 42·6 = 384 = 6·4^3: the orbits partition the plate.
    expect(6 * 1 + 42 * 3 + 42 * 6).toBe(surfaceOf("sector").cellCount);
    // And 6·1 + 42·3 = 132 of those 384 seeds produce a SHORT orbit, which is
    // how often a layer stating `orbit: mode` would be lying. The number is in
    // the module header; it is asserted here so it keeps having to be true.
    const sector = surfaceOf("sector");
    let short = 0;
    for (let i = 0; i < sector.cellCount; i++) {
      if (sector.orbit(i, 6).length < 6) short += 1;
    }
    expect(short).toBe(132);
  });
});

describe("gestureLayers", () => {
  it("gives one layer per committed gesture, in the order they were drawn", () => {
    const s = fresh();
    commit(s, "hexagon", plain(6), [seedWithOrbit("hexagon", 6, 6)], "#c0392b");
    commit(s, "hexagon", plain(3), [seedWithOrbit("hexagon", 3, 3)], "#2e86c1");
    commit(s, "hexagon", plain(2), [seedWithOrbit("hexagon", 2, 2)], "#1e8449");

    const layers = gestureLayers(s.past, book);
    expect(layers).toHaveLength(3);
    expect(layers.map((l) => l.reveal)).toEqual([0, 1, 2]);
    expect(layers.map((l) => l.mode)).toEqual([6, 3, 2]);
    expect(layers.map((l) => l.id)).toEqual(["g0", "g1", "g2"]);
    // Free orbits: the realised size is the mode, and the layer paints exactly
    // as many cells as the brush carried the seed to.
    expect(layers.map((l) => l.orbit)).toEqual([6, 3, 2]);
    expect(layers.map((l) => l.paint?.size)).toEqual([6, 3, 2]);
  });

  it("states the SHORT orbit of a pinned seed, not the mode", () => {
    // The case the naive implementation gets wrong. `s0:AAA` lies on the
    // sector's m_A median, so its D3 stabiliser is {id, m_A} and its orbit is
    // 6/2 = 3 — a 6-fold brush that paints three cells.
    const seed = book.index.get("s0:AAA") as number;
    expect(surfaceOf("sector").orbit(seed, 6)).toHaveLength(3);

    const s = fresh();
    commit(s, "sector", plain(6), [seed], "#d4a017");
    const [layer] = gestureLayers(s.past, book);

    expect(layer.mode).toBe(6);
    expect(layer.orbit).toBe(3);
    expect(layer.orbit).not.toBe(layer.mode);
    expect(layer.paint?.size).toBe(3);
  });

  it("states the short orbit of a spine cell under the 12-fold brush", () => {
    const seed = book.index.get("s0:AAA") as number;
    expect(surfaceOf("hexagon").orbit(seed, 12)).toHaveLength(6);

    const s = fresh();
    commit(s, "hexagon", plain(12), [seed], "#7d3c98");
    const [layer] = gestureLayers(s.past, book);
    expect(layer.mode).toBe(12);
    expect(layer.orbit).toBe(6);
  });

  it("pins the hub as a singleton orbit under a 6-fold brush", () => {
    const seed = book.index.get("s0:XXX") as number;
    expect(surfaceOf("sector").orbit(seed, 6)).toEqual([seed]);

    const s = fresh();
    commit(s, "sector", plain(6), [seed], "#e67e22");
    const [layer] = gestureLayers(s.past, book);
    expect(layer.orbit).toBe(1);
    expect(layer.paint?.size).toBe(1);
  });

  it("keeps a uniform drag flat, and says how big its orbits were", () => {
    const surface = surfaceOf("hexagon");
    const seeds: number[] = [];
    for (let i = 0; seeds.length < 12 && i < surface.cellCount; i++) {
      if (surface.orbit(i, 6).length === 6 && !seeds.includes(i)) seeds.push(i);
    }
    const s = fresh();
    commit(s, "hexagon", plain(6), seeds, "#c0392b");
    expect(s.past).toHaveLength(1);
    expect((s.past[0].mark as StrokeMark<Address>).groups.length).toBeGreaterThan(1);

    const layers = gestureLayers(s.past, book);
    expect(layers).toHaveLength(1);
    // ONE node for a drag of any length: the node budget argument in the module
    // header, stated as a measurement.
    expect(layers[0].children).toBeUndefined();
    expect(layers[0].orbit).toBe(6);
    expect(layers[0].paint?.size).toBe(6 * seeds.length);
  });

  it("splits a drag that crossed a mirror, because one number cannot state it", () => {
    const pinned = book.index.get("s0:AAA") as number;
    const free = seedWithOrbit("sector", 6, 6);
    const s = fresh();
    commit(s, "sector", plain(6), [pinned, free], "#d4a017");

    const mark = s.past[0].mark as StrokeMark<Address>;
    expect(mark.groups.map((g) => g.length)).toEqual([3, 6]);

    const [gesture] = gestureLayers(s.past, book);
    // The parent states the symmetry it was made under and DECLINES to state an
    // orbit, because its two orbits disagree and averaging them would be a lie.
    expect(gesture.mode).toBe(6);
    expect(gesture.orbit).toBeUndefined();
    expect(gesture.children).toHaveLength(2);
    expect(gesture.children?.map((c) => c.orbit)).toEqual([3, 6]);
    expect(gesture.children?.map((c) => c.mode)).toEqual([6, 6]);
    expect(gesture.children?.map((c) => c.paint?.size)).toEqual([3, 6]);
    expect(gesture.children?.map((c) => c.id)).toEqual(["g0-o0", "g0-o1"]);
    // Children carry no reveal of their own: they sit inside the gesture's own
    // group, which is the element the reveal animation is already on.
    expect(gesture.children?.every((c) => c.reveal === undefined)).toBe(true);
    // Nothing is lost by the split — the parent holds only what no orbit claimed.
    const painted = new Map<number, string>();
    for (const c of gesture.children ?? []) {
      for (const [i, hex] of c.paint ?? []) painted.set(i, hex);
    }
    for (const [i, hex] of gesture.paint ?? []) painted.set(i, hex);
    expect(painted.size).toBe(9);
  });

  it("nests every orbit on demand, and flattens every orbit on demand", () => {
    const s = fresh();
    const surface = surfaceOf("hexagon");
    const seeds = [
      seedWithOrbit("hexagon", 6, 6),
      surface.orbit(seedWithOrbit("hexagon", 6, 6), 6)[0] + 1,
    ];
    commit(s, "hexagon", plain(6), seeds, "#2e86c1");
    expect((s.past[0].mark as StrokeMark<Address>).groups).toHaveLength(2);

    expect(gestureLayers(s.past, book, { nest: "auto" })[0].children).toBeUndefined();
    const always = gestureLayers(s.past, book, { nest: "always" })[0];
    expect(always.children).toHaveLength(2);
    expect(always.orbit).toBeUndefined();
    expect(always.children?.map((c) => c.orbit)).toEqual([6, 6]);

    const never = gestureLayers(s.past, book, { nest: "never" })[0];
    expect(never.children).toBeUndefined();
    expect(never.orbit).toBe(6);

    // `never` on a gesture whose orbits disagree states no orbit rather than
    // picking one: the flat form loses the distinction, and says so.
    const mixed = fresh();
    commit(mixed, "sector", plain(6), [book.index.get("s0:AAA") as number, seedWithOrbit("sector", 6, 6)], "#eeeeee");
    const flatMixed = gestureLayers(mixed.past, book, { nest: "never" })[0];
    expect(flatMixed.mode).toBe(6);
    expect(flatMixed.orbit).toBeUndefined();
  });

  it("says plainly when a gesture had no symmetry to claim", () => {
    const s = fresh();
    commit(s, "hexagon", plain(6), [seedWithOrbit("hexagon", 6, 6)], "#c0392b");
    commitUnmarked(s);
    expect(s.past).toHaveLength(2);
    expect(s.past[1].mark).toBeUndefined();

    const layers = gestureLayers(s.past, book);
    expect(layers[1].mode).toBeUndefined();
    expect(layers[1].orbit).toBeUndefined();
    expect(layers[1].name).toContain("no recorded symmetry");
    // A CLEAR sets every cell to null, so it paints nothing — and is still a
    // gesture, with its own place in the reveal order.
    expect(layers[1].reveal).toBe(1);
    expect(layers[1].paint).toBeUndefined();
  });

  it("records the symmetry of an erase, which paints nothing", () => {
    const seed = book.index.get("s0:AAA") as number;
    const s = fresh();
    commit(s, "sector", plain(6), [seed], "#d4a017");
    commit(s, "sector", plain(6), [seed], null);
    const layers = gestureLayers(s.past, book);
    expect(layers).toHaveLength(2);
    expect(layers[1].mode).toBe(6);
    expect(layers[1].orbit).toBe(3);
    expect(layers[1].paint).toBeUndefined();
  });

  it("is total on an empty history and on a history it cannot read", () => {
    expect(gestureLayers([], book)).toEqual([]);
    expect(gestureLayers({ past: [], future: [] }, book)).toEqual([]);
    // A mark naming addresses this book has never heard of claims no cell, and
    // the gesture still becomes a layer that states what it was made under.
    const stroke: Stroke<Address> = {
      edits: [{ cell: "s0:ABC", from: null, to: "#ffffff" }],
      mark: { mode: 6, groups: [["z9:QQQ"]] },
    };
    const [layer] = gestureLayers([stroke], book);
    expect(layer.mode).toBe(6);
    expect(layer.orbit).toBe(1);
    expect(layer.paint?.size).toBe(1);
  });

  it("takes the past of a History and ignores the redo branch", () => {
    const s = fresh();
    commit(s, "hexagon", plain(6), [seedWithOrbit("hexagon", 6, 6)], "#c0392b");
    const undone = s.past[0];
    expect(gestureLayers({ past: s.past, future: [undone] }, book)).toHaveLength(1);
  });

  it("mints ids that are unique across the whole tree and legal in a file", () => {
    const s = fresh();
    commit(s, "sector", plain(6), [book.index.get("s0:AAA") as number, seedWithOrbit("sector", 6, 6)], "#d4a017");
    commit(s, "hexagon", plain(3), [seedWithOrbit("hexagon", 3, 3)], "#2e86c1");
    const layers = gestureLayers(s.past, book, { nest: "always" });
    const ids = select(layers, () => true);
    let count = 0;
    const walk = (list: readonly EmitLayer[]) => {
      for (const l of list) {
        count += 1;
        expect(l.id).toMatch(/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/);
        if (l.children !== undefined) walk(l.children);
      }
    };
    walk(layers);
    expect(ids.size).toBe(count);

    // A prefix that could not produce an XML name falls back rather than
    // producing a document `parse` would refuse.
    expect(gestureLayers(s.past, book, { prefix: "9!" })[0].id).toBe("g0");
    expect(gestureLayers(s.past, book, { prefix: "sym" })[0].id).toBe("sym0");
  });

  it("resolves a gesture made at a shallower depth onto the cells it covers", () => {
    // A depth-2 address covers four depth-3 cells. The layer paints all four,
    // because the gesture really did colour that region.
    const stroke: Stroke<Address> = {
      edits: [{ cell: "s0:AB", from: null, to: "#123456" }],
      mark: { mode: 1, groups: [["s0:AB"]] },
    };
    const [layer] = gestureLayers([stroke], book);
    expect(layer.paint?.size).toBe(4);
    for (const i of layer.paint?.keys() ?? []) {
      expect(book.addr[i].startsWith("s0:AB")).toBe(true);
    }
  });

  it("reconstructs the plate: flattening the gestures is the drawing", () => {
    const s = fresh();
    commit(s, "hexagon", plain(6), [seedWithOrbit("hexagon", 6, 6)], "#c0392b");
    commit(s, "sector", plain(6), [book.index.get("s0:AAA") as number], "#d4a017");
    commit(s, "hexagon", plain(12), [book.index.get("s2:BCX") as number], "#7d3c98");
    commit(s, "hexagon", plain(3), [seedWithOrbit("hexagon", 3, 3)], "#2e86c1");

    const drawn = flatten(gestureLayers(s.past, book, { nest: "always" }));
    const resolved = resolvePlate(s.plate, book);
    expect(drawn.size).toBe(resolved.size);
    for (const [i, hex] of resolved) expect(drawn.get(i)).toBe(hex);
  });
});

// ── the compound-path query ──────────────────────────────────────────────

describe("selection by symmetry", () => {
  const built = (): EmitLayer[] => {
    const s = fresh();
    commit(s, "hexagon", plain(6), [seedWithOrbit("hexagon", 6, 6)], "#c0392b");
    commit(s, "sector", plain(6), [book.index.get("s0:AAA") as number], "#d4a017");
    commit(s, "hexagon", plain(12), [book.index.get("s1:AAA") as number], "#7d3c98");
    commit(s, "hexagon", plain(3), [seedWithOrbit("hexagon", 3, 3)], "#2e86c1");
    commitUnmarked(s);
    return gestureLayers(s.past, book);
  };

  it("finds every gesture of a mode", () => {
    const layers = built();
    expect([...byMode(layers, 6)]).toEqual(["g0", "g1"]);
    expect([...byMode(layers, 12)]).toEqual(["g2"]);
    expect([...byMode(layers, 3)]).toEqual(["g3"]);
    expect([...byMode(layers, 1)]).toEqual([]);
  });

  it("finds the pinned ones — the whole point of storing orbit separately", () => {
    const layers = built();
    // g1 is the 6-fold brush on the median (orbit 3); g2 is the 12-fold brush on
    // a spine cell (orbit 6). g0 and g3 are free and are NOT short.
    expect([...shortOrbits(layers)]).toEqual(["g1", "g2"]);
    expect(shortOrbits(layers).has("g0")).toBe(false);
  });

  it("finds every gesture with no recorded symmetry", () => {
    const layers = built();
    expect([...unmarked(layers)]).toEqual(["g4"]);
  });

  it("complements any query, over the whole tree", () => {
    const layers = built();
    const short = shortOrbits(layers);
    const rest = complement(layers, short);
    expect([...rest]).toEqual(["g0", "g3", "g4"]);
    expect(complement(layers, complement(layers, short))).toEqual(short);
    expect(complement(layers, select(layers, () => true)).size).toBe(0);
  });

  it("reaches into children, by id and not by index", () => {
    const s = fresh();
    commit(s, "sector", plain(6), [book.index.get("s0:AAA") as number, seedWithOrbit("sector", 6, 6)], "#d4a017");
    const layers = gestureLayers(s.past, book);
    // The gesture as a whole is 6-fold; only one of its two orbits is short.
    expect([...byMode(layers, 6)]).toEqual(["g0", "g0-o0", "g0-o1"]);
    expect([...shortOrbits(layers)]).toEqual(["g0-o0"]);
  });

  it("is total on a tree with no marks anywhere", () => {
    const bare: EmitLayer[] = [
      { id: "a", children: [{ id: "b" }] },
      { id: "c" },
    ];
    expect(byMode(bare, 6).size).toBe(0);
    expect(shortOrbits(bare).size).toBe(0);
    // Every layer of a mark-free tree carries no symmetry, which is the true
    // answer to the question rather than an error.
    expect([...unmarked(bare)]).toEqual(["a", "b", "c"]);
    expect([...complement(bare, new Set(["b"]))]).toEqual(["a", "c"]);
    expect(byMode([], 6).size).toBe(0);
  });

  it("takes the group ORDER when the mode understates it — the sector6 scope", () => {
    // C6 × D3: the group `mode` names has order 6·mode, so a pinned cell can
    // have an orbit LONGER than its mode and still be pinned. The default test
    // misses it, and cannot do otherwise — the mark does not record the scope.
    const surface = surfaceOf("sector6");
    expect(surface.order(3)).toBe(18);
    const seed = book.index.get("s0:XXX") as number;
    expect(surface.orbit(seed, 3)).toHaveLength(6);

    const s = fresh();
    commit(s, "sector6", plain(3), [seed], "#e67e22");
    const layers = gestureLayers(s.past, book);
    expect(layers[0].orbit).toBe(6);
    expect(shortOrbits(layers).size).toBe(0);
    expect([...shortOrbits(layers, (m) => 6 * m)]).toEqual(["g0"]);
  });

  it("counts what the tree says about itself", () => {
    const layers = built();
    const census = provenanceCensus(layers);
    expect(census.layers).toBe(5);
    expect(census.marked).toBe(4);
    expect(census.short).toBe(2);
    expect([...census.modes]).toEqual([
      [3, 1],
      [6, 2],
      [12, 1],
    ]);
    expect([...census.orbits]).toEqual([
      [3, 2],
      [6, 2],
    ]);
  });
});

// ── the file ─────────────────────────────────────────────────────────────

/** A document carrying these layers, at the geometry the board draws. */
function docOf(layers: readonly EmitLayer[]): EmitDoc {
  const pf = plateFrame(hex, { mode: "hexagon", sector: 0 });
  const cells = new Map(pf.cells.map((c, i) => [i, { verts: c.verts }]));
  return {
    width: pf.width,
    height: pf.height,
    cells,
    shown: pf.shown,
    background: "#0a0908",
    unpainted: "#141110",
    tileSeam: "rgba(236,230,220,.16)",
    paintSeam: "rgba(0,0,0,.3)",
    seamWidth: 0.7,
    weldPaint: false,
    title: `FOURFOLD — provenance, depth ${DEPTH}`,
    layers,
    overlay: [],
    animation: gestureAnimation(layers.length, 150),
    payload: {
      version: 1,
      canvas: "hexagon",
      depth: DEPTH,
      convention: "apex",
      cells: [...flatten(layers).entries()].sort((a, b) => a[0] - b[0]),
    },
  };
}

describe("provenance survives the file", () => {
  const session = (): Session => {
    const s = fresh();
    commit(s, "hexagon", plain(6), [seedWithOrbit("hexagon", 6, 6)], "#c0392b");
    commit(s, "sector", plain(6), [book.index.get("s0:AAA") as number, seedWithOrbit("sector", 6, 6)], "#d4a017");
    commit(s, "hexagon", plain(12), [book.index.get("s1:AAA") as number], "#7d3c98");
    commitUnmarked(s);
    return s;
  };

  it("round trips the nested form with every provenance field intact", () => {
    const before = gestureLayers(session().past, book);
    expect(before[1].children).toHaveLength(2);

    const text = serialise(docOf(before));
    const back = parse(text);
    expect(back).not.toBeNull();
    const after = (back as EmitDoc).layers;

    const strip = (list: readonly EmitLayer[]): unknown =>
      list.map((l) => ({
        id: l.id,
        name: l.name,
        reveal: l.reveal,
        mode: l.mode,
        orbit: l.orbit,
        paint: [...(l.paint ?? [])].sort((a, b) => a[0] - b[0]),
        children: l.children === undefined ? undefined : strip(l.children),
      }));
    expect(strip(after)).toEqual(strip(before));
  });

  it("writes the symmetry into the markup, where a reader can select on it", () => {
    const layers = gestureLayers(session().past, book);
    const text = serialise(docOf(layers));
    // The claim the module is for: a 6-fold gesture is one addressable group in
    // the file, and its realised orbit is stated on it.
    expect(text).toContain(`id="g0" data-name="gesture 1 · 6-fold · orbit 6"`);
    expect(text).toMatch(/id="g1-o0"[^>]*data-orbit="3"/);
    expect(text).toMatch(/id="g2"[^>]*data-orbit="6" data-mode="12"/);
    // The unmarked gesture claims nothing.
    expect(text).toMatch(/id="g3"[^>]*data-reveal="3">/);
    expect(text).not.toMatch(/id="g3"[^>]*data-mode/);
  });

  it("re-serialises to the same bytes, so a load-and-save is not an edit", () => {
    const text = serialise(docOf(gestureLayers(session().past, book)));
    const back = parse(text);
    expect(back).not.toBeNull();
    expect(serialise(back as EmitDoc)).toBe(text);
  });

  it("says what naming every gesture costs, rather than assuming it is free", () => {
    // Forty gestures, each a free 6-fold orbit, which is an ordinary session.
    const s = fresh();
    const surface = surfaceOf("hexagon");
    let made = 0;
    for (let i = 0; made < 40 && i < surface.cellCount; i++) {
      if (surface.orbit(i, 6).length !== 6) continue;
      commit(s, "hexagon", plain(6), [i], PALETTE[made % PALETTE.length]);
      if (s.past.length > made) made = s.past.length;
    }
    expect(s.past).toHaveLength(40);

    const named = gestureLayers(s.past, book);
    const nameless = named.map((l) => ({ ...l, name: undefined }));
    const withNames = serialise(docOf(named));
    const without = serialise(docOf(nameless));
    expect(withNames).toContain("data-name");
    expect(without).not.toContain("data-name");

    const raw = withNames.length - without.length;
    const zip =
      gzipSync(Buffer.from(withNames, "utf8"), { level: 9 }).length -
      gzipSync(Buffer.from(without, "utf8"), { level: 9 }).length;
    // The numbers `provenance.ts`'s `nameOf` quotes. 86 bytes a gesture raw —
    // the name is written twice, as `data-name` in the markup and again in the
    // payload — which is 8% of this 42.6 kB document, and a depth-3 plate is the
    // SMALL end. Gzipped it is 8 bytes a gesture, a tenth of the raw cost,
    // because every name is built from the same handful of words.
    expect(raw / 40).toBeGreaterThan(70);
    expect(raw / 40).toBeLessThan(110);
    expect(raw / withNames.length).toBeLessThan(0.1);
    expect(zip).toBeLessThan(raw / 5);
    expect(zip / gzipSync(Buffer.from(withNames, "utf8"), { level: 9 }).length).toBeLessThan(0.08);
  });

  it("times the reveal off the layers it actually wrote", () => {
    const layers = gestureLayers(session().past, book);
    const anim = gestureAnimation(layers.length, 150);
    expect(anim.steps).toBe(layers.length);
    expect(anim.stepMs).toBe(150);
    // `replay.animationTiming`'s rule: a third of the step, capped at 90 ms.
    expect(anim.fadeMs).toBe(50);
    expect(anim.holdMs).toBeGreaterThanOrEqual(400);
    // Clamped into what `artfile`'s validator accepts, whatever it is handed.
    expect(gestureAnimation(-3, 0)).toEqual({
      stepMs: 1,
      holdMs: 400,
      fadeMs: 1,
      steps: 0,
    });
  });
});
