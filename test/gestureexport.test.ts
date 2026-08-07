/**
 * THE DRAWING PATH, PRODUCING PROVENANCE — the join `docs/spec-gesture-export.md`
 * asked for, measured end to end.
 *
 * Three things in this repo were built, tested and called by nothing:
 * `provenance.gestureLayers`, `emit.EmitLayer.reveal`/`.mode`/`.orbit` on the
 * WRITE side, and `emit.EmitLayer.nest` together with `timeline.compTrails`.
 * This file is the measurement that they are now joined, and that joining them
 * cost the still export nothing.
 *
 * ── What this file is a test OF, given there is no DOM ──────────────────
 *
 * `vitest` runs under `environment: "node"`, so `draw/page.tsx` cannot be
 * rendered and its `gestureDoc` cannot be called. What CAN be called is every
 * function it composes, in the order it composes them — and the composition is
 * five lines. So `gestureExport` below is that callback WITH THE REACT TAKEN
 * OUT, on the same discipline `test/provenance.test.ts` already uses for
 * `paintAt`/`endStroke` ("this is `draw/page.tsx`'s … with the UI taken out").
 * The journal it walks is built by the REAL machinery — `orbit.ts` for the
 * symmetry, `brush.ts` for the stamp, `plate.ts` for the edits, `layers.ts` for
 * the acts — and never by a hand-written mark or a hand-written `EmitLayer`,
 * because a fixture written by the same hand as the implementation agrees with
 * it about exactly the thing under test.
 *
 * WHAT THAT DOES NOT COVER, stated rather than implied: the wiring itself — that
 * the button calls this and passes these arguments — is React and is not
 * reachable from here. `npx tsc --noEmit` and `npx next build` are what stand
 * behind that half.
 */

import { describe, expect, it } from "vitest";
import { buildHexagon } from "../src/lib/hexagon";
import { buildBandSurface } from "../src/lib/bands";
import {
  hexagonSurface,
  type BrushMode,
  type BrushScope,
  type SymmetrySurface,
} from "../src/lib/orbit";
import { brushStamp, type BrushShape } from "../src/lib/brush";
import {
  addressBook,
  applyPlateEdits,
  planPlateEdits,
  resolvePlate,
  type Address,
  type AddressPlate,
} from "../src/lib/plate";
import { mergeEdits, type CellEdit, type Stroke } from "../src/lib/strokes";
import {
  act,
  addLayer,
  find,
  flatten as flattenComposition,
  fromPlate,
  newSession,
  NO_GESTURE,
  renameLayer,
  type Layer,
  type LayerId,
  type Move,
  type Session,
} from "../src/lib/layers";
import { actStrokes, emitLayersOf, everyComposition } from "../src/lib/composer";
import {
  flatten,
  parse,
  revealBreak,
  serialise,
  type EmitDoc,
  type EmitLayer,
} from "../src/lib/emit";
import {
  gestureAnimation,
  gestureLayers,
  layerBudget,
  provenanceCensus,
} from "../src/lib/provenance";
import {
  beatsOf,
  compTrails,
  minter,
  syncTree,
  treeFromTrails,
} from "../src/lib/timeline";
import {
  flatten as flattenTree,
  group,
  type StepId,
  type Timeline,
} from "../src/lib/nested";
import { boundAnimation, clampSpan, type InOut } from "../src/lib/replay";
import { plateFrame } from "../src/lib/view";
import { MAX_LAYERS } from "../src/lib/artfile";

// ── the studio: a journal made the way the program makes one ─────────────

const DEPTH = 3;
const hex = buildHexagon(DEPTH);
const book = addressBook(hex);
const bands = buildBandSurface(hex);
const surfaceOf = (scope: BrushScope): SymmetrySurface => hexagonSurface(hex, scope);

/** The two fills the page hands the animated path. `TILE` when the grid shows. */
const TILE = "#141110";
const PLATE_BG = "#0a0908";

interface Studio {
  session: Session;
  layer: LayerId;
}

const open = (): Studio => {
  const session = newSession(fromPlate(new Map<Address, string>()));
  return { session, layer: session.composition.layers[0].id };
};

const plain = (mode: BrushMode): BrushShape => ({ mode, band: null });

/**
 * One committed gesture, applied at every seed in turn, as ONE journal act.
 *
 * `draw/page.tsx`'s `paintAt` + `endStroke` with the UI taken out: plan the
 * edits against the target layer's plate AS IT STANDS, push the stamp's groups
 * in the order the brush applied them, merge the edits into the gesture, and
 * commit one `Act` carrying one paint `Move` carrying one `Stroke` with one
 * mark. Several seeds is a DRAG; one seed is a tap; `null` is an erase.
 */
function commit(
  st: Studio,
  scope: BrushScope,
  shape: BrushShape,
  seeds: readonly number[],
  colour: string | null
): void {
  const surface = surfaceOf(scope);
  const layer = find(st.session.composition, st.layer) as Layer;
  let plate: AddressPlate = layer.plate;
  let edits: CellEdit<Address>[] = [];
  const groups: Address[][] = [];
  for (const seed of seeds) {
    const stamp = brushStamp(surface, bands, seed, shape);
    const planned = planPlateEdits(
      plate,
      book,
      stamp.cells.map((c) => book.addr[c]),
      stamp.cells.map(() => colour)
    );
    if (planned.length === 0) continue;
    for (const g of stamp.groups ?? [stamp.cells]) {
      if (g.length === 0) continue;
      groups.push(g.map((c) => book.addr[c]));
    }
    plate = applyPlateEdits(plate, planned, "do");
    edits = mergeEdits(edits, planned);
  }
  if (edits.length === 0) return;
  const stroke: Stroke<Address> =
    groups.length === 0 ? { edits } : { edits, mark: { mode: shape.mode, groups } };
  const move: Move = { kind: "paint", layer: st.layer, stroke, gesture: NO_GESTURE };
  st.session = act(st.session, [move], "stroke");
}

/** The first cell whose orbit under `mode` has exactly `size` members. */
function seedWithOrbit(scope: BrushScope, mode: BrushMode, size: number): number {
  const surface = surfaceOf(scope);
  for (let i = 0; i < surface.cellCount; i++) {
    if (surface.orbit(i, mode).length === size) return i;
  }
  throw new Error(`no cell of ${scope} has a ${size}-cell orbit at mode ${mode}`);
}

// ── the page's two export paths, with the React taken out ────────────────

/** The frame an export is taken in: the whole hexagon, or one sector. */
interface Frame {
  shown?: readonly number[];
  showTiling: boolean;
}

const HEXAGON: Frame = { showTiling: true };

const sectorFrame = (sector: number): Frame => ({
  shown: plateFrame(hex, { mode: "sector", sector }).shown,
  showTiling: true,
});

/**
 * `draw/page.tsx`'s `emitDoc` — the STILL document, whose layers are the
 * EDITOR's. Every field is the page's own expression with the canvas constants
 * substituted; nothing about it changed in this pass, which is what the first
 * test measures.
 */
function stillDoc(st: Studio, frame: Frame = HEXAGON): EmitDoc {
  const pf = plateFrame(hex, { mode: "hexagon", sector: 0 });
  const picture = flattenComposition(st.session.composition, book);
  return {
    width: pf.width,
    height: pf.height,
    cells: new Map(pf.cells.map((c, i) => [i, { verts: c.verts }])),
    shown: frame.shown ?? pf.shown,
    background: PLATE_BG,
    unpainted: frame.showTiling ? TILE : null,
    tileSeam: "rgba(236,230,220,.16)",
    paintSeam: "rgba(0,0,0,.3)",
    weldPaint: false,
    seamWidth: 0.7,
    title: `FOURFOLD — hexagon, depth ${DEPTH}`,
    layers: emitLayersOf(st.session.composition, book),
    overlay: [],
    animation: null,
    payload: {
      version: 1,
      canvas: "hexagon",
      depth: DEPTH,
      convention: "apex",
      cells: [...picture.entries()].sort((a, b) => a[0] - b[0]),
    },
  };
}

interface Gestures {
  doc: EmitDoc;
  /** Which act produced each beat — `timeline.beatsOf`. */
  beats: readonly number[];
  /** The tree the trails were read off, after `syncTree`. */
  tree: Timeline;
  layers: readonly EmitLayer[];
}

/**
 * `draw/page.tsx`'s `gestureDoc`, line for line, with the announce channel and
 * the React state replaced by a return value.
 *
 * The five steps, and every one of them is a decision the spec numbers:
 *
 *   BEATS, not acts. `beatsOf` drops an act that changed no shown cell, which is
 *   the same rule `animationSteps` applies, so the reveals index the list the
 *   file's `steps` counts.
 *   TRAILS off the SYNCED tree, so `compTrails(tree)[k]` is the trail of the
 *   layer that gets `reveal: k`.
 *   THE UNPAINTED FILL, so an erase is a layer that draws rather than a layer
 *   that vanishes.
 *   THE CUT as `in`/`out` rather than as a shorter list.
 *   THE BUDGET, counted before anything is written.
 */
function gestureExport(
  st: Studio,
  opts: {
    frame?: Frame;
    tree?: Timeline | null;
    span?: InOut | null;
    stepMs?: number;
  } = {}
): Gestures | { refused: string } {
  const frame = opts.frame ?? HEXAGON;
  const past = st.session.journal.past;
  const states = everyComposition(st.session.composition, past).map((c) =>
    flattenComposition(c, book)
  );
  const beats = beatsOf(states, frame.shown);
  if (beats.length === 0) return { refused: "nothing to animate" };
  const tree = syncTree(opts.tree ?? null, beats, minter(900)).tree;
  const strokes = actStrokes(past);
  const layers = gestureLayers(
    beats.map((a) => strokes[a]),
    book,
    {
      unpainted: frame.showTiling ? TILE : PLATE_BG,
      trails: compTrails(tree),
    }
  );
  const budget = layerBudget(layers);
  if (budget.said !== null) return { refused: budget.said };
  return {
    doc: {
      ...stillDoc(st, frame),
      layers,
      animation: gestureAnimation(beats.length, opts.stepMs ?? 250, opts.span),
    },
    beats,
    tree,
    layers,
  };
}

/** The gesture export, or a thrown refusal — for the tests that expect one. */
function exported(st: Studio, opts: Parameters<typeof gestureExport>[1] = {}): Gestures {
  const out = gestureExport(st, opts);
  if ("refused" in out) throw new Error(`unexpectedly refused: ${out.refused}`);
  return out;
}

/** A session with four marked gestures, one erase and one structural act. */
function studio(): Studio {
  const st = open();
  commit(st, "hexagon", plain(6), [seedWithOrbit("hexagon", 6, 6)], "#c0392b");
  // A DRAG whose groups disagree in size — `s0:AAA` is pinned on the sector
  // median (orbit 3) and the second seed is free (orbit 6) — which is the one
  // shape `auto` nesting answers with a parent plus children. Requirement 3
  // turns on this gesture existing.
  commit(
    st,
    "sector",
    plain(6),
    [book.index.get("s0:AAA") as number, seedWithOrbit("sector", 6, 6)],
    "#d4a017"
  );
  // Structural: neither of these changes a cell, so neither is a beat.
  st.session = addLayer(st.session, "Second");
  const renamed = renameLayer(st.session, st.layer, "Ground");
  expect(renamed.ok).toBe(true);
  if (renamed.ok) st.session = renamed.value;
  commit(st, "hexagon", plain(12), [book.index.get("s1:AAA") as number], "#7d3c98");
  commit(st, "hexagon", plain(3), [seedWithOrbit("hexagon", 3, 3)], "#2e86c1");
  return st;
}

// ── 1. the still path, pinned on the exact bytes ─────────────────────────

/**
 * REQUIREMENT 1. Not one byte of a still export changes.
 *
 * PINNED IN FULL rather than compared against a re-encode of itself, and the
 * reason is the one `test/artfile.test.ts` gives for the same pin one layer
 * down: a re-encode agrees just as happily if BOTH SIDES gained a key. The two
 * things that could have leaked into a still document from this pass are
 * `EmitLayer.nest`, which now has a writer, and the reveal/mode/orbit trio,
 * which the gesture tree carries — so the assertion is on the literal text and
 * the two absences are then named separately, because a reader of a failure
 * needs to know WHICH of them leaked.
 *
 * Depth 1 and two cells, so the pin is a document a person can read.
 */
describe("the still export is byte identical", () => {
  const smallHex = buildHexagon(1);
  const smallBook = addressBook(smallHex);

  const smallStill = (): string => {
    const session = newSession(
      fromPlate(
        new Map<Address, string>([
          ["s0:A" as Address, "#d4a017"],
          ["s3:C" as Address, "#c0392b"],
        ])
      )
    );
    const pf = plateFrame(smallHex, { mode: "hexagon", sector: 0 });
    const picture = flattenComposition(session.composition, smallBook);
    return serialise({
      width: pf.width,
      height: pf.height,
      cells: new Map(pf.cells.map((c, i) => [i, { verts: c.verts }])),
      shown: pf.shown,
      background: PLATE_BG,
      unpainted: null,
      tileSeam: null,
      paintSeam: null,
      weldPaint: false,
      seamWidth: 0.7,
      title: "FOURFOLD — still",
      layers: emitLayersOf(session.composition, smallBook),
      overlay: [],
      animation: null,
      payload: {
        version: 1,
        canvas: "hexagon",
        depth: 1,
        convention: "apex",
        cells: [...picture.entries()].sort((a, b) => a[0] - b[0]),
      },
    });
  };

  it("writes exactly the payload it wrote before the gesture path existed", () => {
    const payload = /<!-- fourfold:art:1[\s\S]*?-->/.exec(smallStill());
    expect(payload).not.toBeNull();
    expect((payload as RegExpExecArray)[0]).toBe(
      `<!-- fourfold:art:1 {"canvas":"hexagon","depth":1,"convention":"apex",` +
        `"cells":[[0,"#d4a017"],[14,"#c0392b"]],"comp":{"shown":"0\\u002d23",` +
        `"layers":[{"id":"L1","name":"Layer 1","cells":[[0,"#d4a017"],` +
        `[14,"#c0392b"]]}]}} -->`
    );
  });

  it("writes exactly the document it wrote, markup and stylesheet included", () => {
    expect(smallStill()).toBe(
      [
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1144 1006.81" width="1144" height="1006.81" id="ffa3ab9f" role="img" lang="en" aria-labelledby="ffa3ab9f-t">`,
        `  <!-- FOURFOLD composition. Every cell is a congruent triangle: the shapes are named once in the defs block and each cell is one use of one of them at its own x and y. Colour is a CSS class, one rule per colour. Layers are nested groups. Self contained: no script, no external reference. -->`,
        `  <!-- fourfold:art:1 {"canvas":"hexagon","depth":1,"convention":"apex","cells":[[0,"#d4a017"],[14,"#c0392b"]],"comp":{"shown":"0\\u002d23","layers":[{"id":"L1","name":"Layer 1","cells":[[0,"#d4a017"],[14,"#c0392b"]]}]}} -->`,
        `  <title id="ffa3ab9f-t">FOURFOLD — still</title>`,
        `  <desc>A FOURFOLD composition on the hexagon at depth 1: 2 painted cells in 1 layer, every cell one of two congruent triangles of the same lattice.</desc>`,
        `  <defs>`,
        `    <polygon id="u" points="0,0 128,-221.71 256,0"/>`,
        `    <polygon id="d" points="0,0 128,221.7 256,0"/>`,
        `  </defs>`,
        `  <style>`,
        `    #ffa3ab9f .k0 { fill: #d4a017 }`,
        `    #ffa3ab9f .k1 { fill: #c0392b }`,
        `  </style>`,
        `  <rect width="1144" height="1006.81" fill="#0a0908"/>`,
        `  <g id="paint">`,
        `    <g id="L1" data-name="Layer 1">`,
        `      <use href="#u" x="572" y="503.41" class="k0"/>`,
        `      <use href="#d" x="188" y="725.11" class="k1"/>`,
        `    </g>`,
        `  </g>`,
        `</svg>`,
      ].join("\n")
    );
  });

  it("says nothing about gestures, timing or grouping", () => {
    // `"nest"` and `"anim"` are spelled with their quotes, because the format's
    // own header comment contains the word "nested" and the payload is the only
    // place either field could appear. A bare substring test would pass by
    // accident today and fail on a comment edit tomorrow, which is a test that
    // measures the wrong thing in both directions.
    const words = ["data-reveal", "data-mode", "data-orbit", `"nest"`, `"anim"`];
    const text = smallStill();
    for (const word of words) expect(text, word).not.toContain(word);
    // And a real drawing's still export says the same nothing, so the pin above
    // is not passing on the small case alone.
    const big = serialise(stillDoc(studio()));
    for (const word of words) expect(big, word).not.toContain(word);
  });
});

// ── 2. the animated export carries the gesture ───────────────────────────

describe("the gesture export states what made each stroke", () => {
  it("writes data-reveal, data-mode and data-orbit, one group per gesture", () => {
    const out = exported(studio());
    // Four gestures, four beats: the add and the rename changed no cell.
    expect(out.beats).toEqual([0, 1, 4, 5]);
    expect(out.layers.map((l) => l.reveal)).toEqual([0, 1, 2, 3]);
    expect(out.layers.map((l) => l.mode)).toEqual([6, 6, 12, 3]);

    const text = serialise(out.doc);
    expect(text).toMatch(/id="g0"[^>]*data-reveal="0" data-orbit="6" data-mode="6"/);
    // The mixed drag: a parent with no orbit of its own and a child per orbit,
    // each child stating the size that orbit REALISED.
    expect(text).toMatch(/id="g1"[^>]*data-reveal="1" data-mode="6"/);
    expect(text).not.toMatch(/id="g1"[^>]*data-orbit/);
    expect(text).toMatch(/id="g1-o0"[^>]*data-orbit="3" data-mode="6"/);
    // The 12-fold brush on a spine cell: mode 12, orbit 6. The whole reason
    // there are two fields and not one.
    expect(text).toMatch(/id="g2"[^>]*data-orbit="6" data-mode="12"/);
    // And the file animates: one rule per distinct reveal, plus the keyframes.
    expect(text).toContain(`[data-reveal="3"] { animation-name: `);
    expect(text).toContain(`@media (prefers-reduced-motion: reduce)`);
  });

  it("times the reveal off the beats, not off the journal", () => {
    const out = exported(studio(), { stepMs: 150 });
    // SIX acts in the journal, FOUR beats in the animation. `steps` counts what
    // the file holds; a `steps: 6` would leave the loop pausing on two beats
    // that are not there.
    expect(out.doc.payload).toBeDefined();
    expect(out.beats.length).toBe(4);
    expect(out.doc.animation).toEqual({
      stepMs: 150,
      holdMs: 400,
      fadeMs: 50,
      steps: 4,
    });
    // No cut, so neither mark is written — the four keys this function wrote
    // before the pair existed, in the same order.
    expect(Object.keys(out.doc.animation as object)).toEqual([
      "stepMs",
      "holdMs",
      "fadeMs",
      "steps",
    ]);
  });

  it("survives the file with every provenance field intact, and re-serialises to the same bytes", () => {
    const out = exported(studio());
    const text = serialise(out.doc);
    const back = parse(text);
    expect(back).not.toBeNull();
    const strip = (list: readonly EmitLayer[]): unknown =>
      list.map((l) => ({
        id: l.id,
        reveal: l.reveal,
        mode: l.mode,
        orbit: l.orbit,
        nest: l.nest,
        children: l.children === undefined ? undefined : strip(l.children),
      }));
    expect(strip((back as EmitDoc).layers)).toEqual(strip(out.layers));
    expect(serialise(back as EmitDoc)).toBe(text);
  });
});

// ── 3. revealBreak over generated histories ──────────────────────────────

/**
 * REQUIREMENT 3. `serialise` REFUSES a child that reveals before its ancestor —
 * measured in a browser, where the child came up at the ancestor's time and
 * nothing said so — so a producer of nested layers has to be shown never to make
 * one.
 *
 * ASSERTED OVER A GENERATED HISTORY AND NOT A FIXTURE, because the shape that
 * could break it only arises from `auto` nesting, and `auto` only nests when a
 * drag's recorded groups DISAGREE IN SIZE. A fixture would be the author
 * choosing which drags to test; this walks every seed of the sector surface,
 * drags each to a seed of a different orbit size, and checks the whole tree —
 * so the parent-plus-children case is not assumed to have arisen, it is counted.
 */
describe("no gesture tree can reveal a child before its gesture", () => {
  it("holds over every mixed-orbit drag the sector brush can make", () => {
    const surface = surfaceOf("sector");
    /** Seeds whose 6-fold sector orbit is 1, 3 and 6 — the three sizes. */
    const bySize = new Map<number, number[]>();
    for (let i = 0; i < surface.cellCount; i++) {
      const n = surface.orbit(i, 6).length;
      const list = bySize.get(n);
      if (list === undefined) bySize.set(n, [i]);
      else list.push(i);
    }
    expect([...bySize.keys()].sort((a, b) => a - b)).toEqual([1, 3, 6]);

    let nestedGestures = 0;
    let flatGestures = 0;
    let children = 0;
    // Every ordered pair of distinct orbit sizes, at several seeds of each, so
    // the drag's groups are guaranteed to disagree — the `auto` split.
    for (const [sizeA, seedsA] of bySize) {
      for (const [sizeB, seedsB] of bySize) {
        if (sizeA === sizeB) continue;
        for (let k = 0; k < 6; k++) {
          const st = open();
          const a = seedsA[k % seedsA.length];
          const b = seedsB[(k * 7) % seedsB.length];
          commit(st, "sector", plain(6), [a, b], "#d4a017");
          // A second, unmarked gesture on top, and a third that erases part of
          // the first: an ordinary history rather than one drag alone.
          commit(st, "hexagon", plain(2), [seedWithOrbit("hexagon", 2, 2)], "#2e86c1");
          commit(st, "sector", plain(6), [a], null);
          const out = gestureExport(st);
          if ("refused" in out) continue;
          expect(revealBreak(out.layers)).toBeNull();
          // ...and the thing the assertion is about actually happened.
          for (const l of out.layers) {
            if (l.children === undefined) {
              flatGestures += 1;
              continue;
            }
            nestedGestures += 1;
            children += l.children.length;
            // The invariant `revealBreak` is checking, said directly: the
            // gesture carries the time and the orbits under it carry none, so
            // the floor a child would have to clear is never raised by one.
            for (const c of l.children) expect(c.reveal).toBeUndefined();
            expect(l.reveal).toBeDefined();
          }
          // And the document that carries them is written rather than refused.
          expect(() => serialise(out.doc)).not.toThrow();
        }
      }
    }
    // The counts, so "it never broke" is a statement about a real population.
    expect(nestedGestures).toBeGreaterThan(20);
    expect(children).toBeGreaterThanOrEqual(2 * nestedGestures);
    expect(flatGestures).toBeGreaterThan(nestedGestures);
  });

  it("is refused when a child DOES reveal early, so the check above can fail", () => {
    // THE CONTROL. Without it "revealBreak was null" is consistent with the
    // check being unreachable. A hand-built tree of the shape `gestureLayers`
    // declines to produce is refused by the same `serialise` call.
    const out = exported(studio());
    const broken: EmitLayer[] = out.layers.map((l, k) =>
      k === 1 ? { ...l, children: [{ id: "early", reveal: 0, paint: l.children?.[0].paint }] } : l
    );
    expect(revealBreak(broken)).toEqual({
      layer: "early",
      reveal: 0,
      ancestor: "g1",
      at: 1,
    });
    expect(() => serialise({ ...out.doc, layers: broken })).toThrow(/cannot come up before/);
  });
});

// ── 4. erases, and the reconstruction equality ───────────────────────────

/**
 * REQUIREMENT 4. `gestureLayers` drops an erase's edits unless it is given a
 * colour to draw them in, and the animated path HAS one — the fill an unpainted
 * cell wears, which is what `replay.animationSteps` already draws an erase as.
 *
 * The equality this measures was FALSE before `GestureOptions.unpainted`
 * existed, and the test that was cited for it could not have caught that,
 * because every gesture in it was a paint. So the history here erases three
 * different ways: a whole orbit, part of an orbit, and a repaint over an erase.
 */
describe("the stack reconstructs the plate WITH erases in the history", () => {
  const erasing = (): Studio => {
    const st = open();
    const pinned = book.index.get("s0:AAA") as number;
    const free = seedWithOrbit("sector", 6, 6);
    commit(st, "hexagon", plain(6), [seedWithOrbit("hexagon", 6, 6)], "#c0392b");
    commit(st, "sector", plain(6), [pinned, free], "#d4a017");
    commit(st, "hexagon", plain(3), [seedWithOrbit("hexagon", 3, 3)], "#2e86c1");
    // A whole orbit rubbed out.
    commit(st, "sector", plain(6), [pinned], null);
    // Part of another, then painted again over the hole.
    commit(st, "sector", plain(6), [free], null);
    commit(st, "hexagon", plain(2), [seedWithOrbit("hexagon", 2, 2)], "#7d3c98");
    return st;
  };

  it("draws every cell the plate draws, and the erased ones in the tile fill", () => {
    const st = erasing();
    const out = exported(st);
    const drawn = flatten(out.layers);
    const resolved = resolvePlate(
      (find(st.session.composition, st.layer) as Layer).plate,
      book
    );
    // The equality, both directions. Every cell the stack names draws what the
    // plate draws — an erased cell wearing the document's own unpainted fill,
    // which is the colour the tiling under it would have shown anyway.
    for (const [i, colour] of drawn) {
      expect(resolved.get(i) ?? TILE, `cell ${i}`).toBe(colour);
    }
    // ...and every painted cell of the plate is in the stack, so the stack is
    // not merely a subset that happens to agree.
    for (const [i, colour] of resolved) expect(drawn.get(i)).toBe(colour);

    // The erases really are in the history and really did remove cells.
    expect(out.beats.length).toBe(6);
    expect(drawn.size).toBeGreaterThan(resolved.size);
    expect(drawn.size - resolved.size).toBe(
      [...drawn].filter(([i]) => !resolved.has(i)).length
    );
  });

  it("is FALSE without the fill, which is why the option is passed", () => {
    // THE CONTROL for the test above. The same history, the same layers, the
    // option withheld: the erased cells keep the colour their erase took away,
    // so the stack is the record of what each gesture PAINTED and not the
    // picture. Both readings are honest; only one of them is an export.
    const st = erasing();
    const past = st.session.journal.past;
    const states = everyComposition(st.session.composition, past).map((c) =>
      flattenComposition(c, book)
    );
    const beats = beatsOf(states);
    const strokes = actStrokes(past);
    const record = flatten(gestureLayers(beats.map((a) => strokes[a]), book));
    const resolved = resolvePlate(
      (find(st.session.composition, st.layer) as Layer).plate,
      book
    );
    const wrong = [...record].filter(([i, c]) => (resolved.get(i) ?? TILE) !== c);
    expect(wrong.length).toBeGreaterThan(0);
    // And every one of them is an erased cell still wearing its old colour.
    for (const [i] of wrong) expect(resolved.has(i)).toBe(false);
  });

  it("resolves to the same picture the replay's own step list does", () => {
    // The two encoders and this one now agree cell for cell on the last frame,
    // which is the claim `animationSteps` makes about ITS list ("the last group
    // to name a cell is the last gesture that touched it, so the final frame is
    // the final state") carried across to the layer stack.
    const st = erasing();
    const out = exported(st);
    const past = st.session.journal.past;
    const states = everyComposition(st.session.composition, past).map((c) =>
      flattenComposition(c, book)
    );
    const last = states[states.length - 1];
    const drawn = flatten(out.layers);
    for (const [i, colour] of drawn) expect(last.get(i) ?? TILE).toBe(colour);
  });
});

// ── 5. beat space, and what the bound list would have cost ───────────────

/**
 * REQUIREMENT 5, and the one place this file DEPARTS from the spec. The spec
 * says gesture layers must be built from the BOUND step list, `boundAnimation`'s
 * own output. They are built from the whole BEAT list instead, and the cut is
 * written as `EmitAnimation.in`/`.out`.
 *
 * The failure the requirement names is real and is answered: reveals must index
 * BEAT space and not ACT space, or a 6-act, 4-beat drawing writes reveals up to
 * 5 into an animation of 4 steps. That is measured below.
 *
 * The second half — cutting the LIST — is measured here to be the wrong answer
 * for THIS format, which is the one thing `animatedSvg` and the GIF cannot do
 * and this one can. Two costs, both measured: the folded ground stops being
 * paint, so `serialise` puts it in the tiling group and the exported first frame
 * is a different picture from the one REPLAY opens on; and every gesture past
 * the out point loses its `data-mode` and `data-orbit`, which `emit.ts` states
 * as a rule it will not break ("the cut is what the file DRAWS; the markup is
 * what it MEANS").
 */
describe("the reveals index the beat list, and the cut is a pair of marks", () => {
  it("drops the acts that are not beats, so reveal k is step k", () => {
    const st = studio();
    const out = exported(st);
    // SIX acts, FOUR beats. Building from `past` would have produced six layers
    // with reveals 0…5 against an animation of four steps, so the last gesture
    // would ask to come up at step 5 of a 4-step cycle and would never come up.
    expect(st.session.journal.past.length).toBe(6);
    expect(out.beats).toEqual([0, 1, 4, 5]);
    expect(out.layers).toHaveLength(4);
    expect(out.layers.map((l) => l.reveal)).toEqual([0, 1, 2, 3]);
    expect((out.doc.animation as { steps: number }).steps).toBe(4);
    // And the drop rule is `animationSteps`' own, which `timeline.ts` restates
    // and `test/timeline.test.ts` guards: the two counts agree.
    const strokes = actStrokes(st.session.journal.past);
    expect(out.layers.map((l) => l.mode)).toEqual(
      out.beats.map((a) => strokes[a].mark?.mode)
    );
  });

  it("drops a gesture that landed outside the frame, exactly as the replay does", () => {
    const st = open();
    commit(st, "sector", plain(1), [book.index.get("s0:AAA") as number], "#d4a017");
    // A one-fold stroke in sector 3 only: invisible in a sector-0 frame.
    commit(st, "sector", plain(1), [book.index.get("s3:AAA") as number], "#c0392b");
    expect(exported(st).layers).toHaveLength(2);
    const cut = exported(st, { frame: sectorFrame(0) });
    expect(cut.beats).toEqual([0]);
    expect(cut.layers).toHaveLength(1);
    expect((cut.doc.animation as { steps: number }).steps).toBe(1);
  });

  it("writes the cut as in/out and keeps every gesture in the file", () => {
    const out = exported(studio(), { span: { in: 2, out: 3 }, stepMs: 250 });
    expect(out.doc.animation).toEqual({
      stepMs: 250,
      holdMs: 400,
      fadeMs: 83,
      steps: 4,
      in: 2,
      out: 3,
    });
    const text = serialise(out.doc);
    // Before the in point: the ground, up from the first frame.
    expect(text).toContain(`[data-reveal="0"] { animation: none; opacity: 1 }`);
    expect(text).toContain(`[data-reveal="1"] { animation: none; opacity: 1 }`);
    // ...and still stating what made it, which is the rule the alternative
    // would have broken.
    expect(text).toMatch(/id="g0"[^>]*data-orbit="6" data-mode="6"/);
    // The cycle is the CUT's length and not the drawing's: two steps, not four.
    expect(text).toContain(`animation-duration: ${2 * 250 + 400}ms`);
  });

  it("measures what building from the bound list would have cost", () => {
    const st = studio();
    const out = exported(st, { span: { in: 2, out: 3 } });
    const past = st.session.journal.past;
    const states = everyComposition(st.session.composition, past).map((c) =>
      flattenComposition(c, book)
    );
    const beats = beatsOf(states);

    // The bound form, built the way the spec describes: `boundAnimation` cuts,
    // and the layers are the strokes behind the steps that survive.
    const strokes = actStrokes(past);
    const bound = boundAnimation(
      states[0],
      beats.map(() => ({ mode: null, groups: [] })),
      { in: 2, out: 3 }
    );
    expect(bound.steps).toHaveLength(2);
    expect(bound.folded).toBe(2);
    const boundLayers = gestureLayers(
      beats.slice(2, 4).map((a) => strokes[a]),
      book,
      { unpainted: TILE }
    );

    // COST ONE: the ground stops being paint. Every cell the first two gestures
    // laid down is in no layer of the bound form, so `serialise` writes it into
    // the tiling group wearing the unpainted fill.
    const whole = flatten(out.layers);
    const cutOnly = flatten(boundLayers);
    const lost = [...whole.keys()].filter((i) => !cutOnly.has(i));
    // Eight cells: the 6-fold orbit of gesture one plus the two orbits of the
    // mixed drag, less the cells the two later gestures repaint anyway.
    expect(lost).toHaveLength(8);
    const boundText = serialise({
      ...out.doc,
      layers: boundLayers,
      animation: gestureAnimation(2, 250),
    });
    const wholeText = serialise(out.doc);
    // THE PROOF THAT THEY ARE TWO PICTURES, and it is counted rather than
    // eyeballed: every cell the fold dropped moves out of the paint region and
    // into the tiling group, where it is drawn in the unpainted fill. Not by id
    // — `gestureLayers` mints from zero for whatever list it is handed, so both
    // documents have a `g0` and they are different gestures — but by which
    // group each cell's `<use>` ends up in.
    const inGroup = (svg: string, id: string): number => {
      const m = new RegExp(`<g id="${id}"[^>]*>([\\s\\S]*?)</g>`).exec(svg);
      return m === null ? 0 : m[1].split("<use").length - 1;
    };
    expect(inGroup(boundText, "tiling") - inGroup(wholeText, "tiling")).toBe(lost.length);
    expect(boundText.split("<use").length).toBeLessThan(wholeText.split("<use").length);

    // COST TWO: provenance. The cut form cannot say what made the folded
    // gestures, because they are not in it at all.
    expect(provenanceCensus(boundLayers).marked).toBeLessThan(
      provenanceCensus(out.layers).marked
    );
  });

  it("clamps a span left over from a wider frame rather than refusing it", () => {
    // The marks outlive the frame — `resolveSpan` and `clampSpan` both say so —
    // so a cut set on the hexagon and then exported from a sector lands inside
    // the shorter list instead of writing marks the file cannot index.
    const anim = gestureAnimation(3, 250, { in: 9, out: 40 });
    expect(anim.steps).toBe(3);
    expect(anim.in).toBe(2);
    expect(anim.out).toBe(2);
    expect(clampSpan({ in: 9, out: 40 }, 3)).toEqual({ in: 2, out: 2 });
    // A whole span writes neither mark, so nothing that never asked to be cut
    // gains a key.
    expect(gestureAnimation(3, 250, { in: 0, out: 2 })).toEqual(
      gestureAnimation(3, 250)
    );
    expect(gestureAnimation(0, 250, { in: 0, out: 0 })).toEqual({
      stepMs: 250,
      holdMs: 400,
      fadeMs: 83,
      steps: 0,
    });
  });
});

// ── the nest writer, end to end ──────────────────────────────────────────

/**
 * REQUIREMENT 2. `emit.EmitLayer.nest` was a reader with no writer.
 *
 * The round trip is the whole claim: GROUP two beats in the timeline, EXPORT,
 * IMPORT, and rebuild the tree from the trails alone — `treeFromTrails` is what
 * a loaded document has, because a file carries no journal — then RE-EXPORT and
 * get the same bytes.
 */
describe("groups survive a save", () => {
  const grouped = (): { st: Studio; tree: Timeline } => {
    const st = studio();
    const flatTree = syncTree(null, exported(st).beats, minter(900)).tree;
    // The panel's own operation: wrap a run of beats — the second and third of
    // four — in a named composition at the root.
    const wrapped = group(flatTree, null, 1, 2, "t500" as StepId);
    expect(wrapped).not.toBeNull();
    return { st, tree: wrapped as Timeline };
  };

  it("writes no nest field at all when nothing has been grouped", () => {
    const out = exported(studio());
    for (const l of out.layers) expect(l.nest).toBeUndefined();
    const text = serialise(out.doc);
    expect(text).not.toContain(`"nest"`);
    // ...and the document is byte for byte the one it would have written before
    // the field had a writer.
    const same = exported(studio(), { tree: null });
    expect(serialise(same.doc)).toBe(text);
  });

  it("writes the trail of every beat inside a group, and nothing outside one", () => {
    const { st, tree } = grouped();
    const out = exported(st, { tree });
    expect(compTrails(out.tree)).toEqual([undefined, "t500", "t500", undefined]);
    expect(out.layers.map((l) => l.nest)).toEqual([
      undefined,
      "t500",
      "t500",
      undefined,
    ]);
    // The trail is the BEAT's, so the orbits inside a beat state nothing: a
    // composition boundary restated per orbit would be one fact written twice.
    for (const l of out.layers) {
      for (const c of l.children ?? []) expect(c.nest).toBeUndefined();
    }
    expect(serialise(out.doc)).toContain(`"nest":"t500"`);
  });

  it("round trips: group, export, import, rebuild the tree, re-export", () => {
    const { st, tree } = grouped();
    const out = exported(st, { tree });
    const text = serialise(out.doc);

    const back = parse(text);
    expect(back).not.toBeNull();
    const loaded = (back as EmitDoc).layers;
    expect(loaded.map((l) => l.nest)).toEqual(out.layers.map((l) => l.nest));

    // THE READER'S HALF, on the trails alone. A loaded file has no journal, so
    // `treeFromTrails` defaults each beat's act to its own position — which is
    // what a loaded drawing is until somebody draws on it.
    const rebuilt = treeFromTrails(
      loaded.map((l) => l.nest),
      minter(700)
    );
    // The grouping survived: the same run of beats is inside one composition,
    // and the flat order is unchanged, which is the property `nested.ts` is
    // built to keep.
    expect(rebuilt).toHaveLength(3);
    expect(rebuilt[1].kind).toBe("comp");
    expect(flattenTree(rebuilt).order).toHaveLength(4);
    expect(compTrails(rebuilt)).toEqual(compTrails(out.tree));

    // And re-exporting the loaded document is not an edit.
    expect(serialise(back as EmitDoc)).toBe(text);
  });

  it("keeps the beat order when a group is written and read back", () => {
    const { st, tree } = grouped();
    const out = exported(st, { tree });
    const before = flattenTree(out.tree).order.length;
    const rebuilt = treeFromTrails(out.layers.map((l) => l.nest), minter(700));
    expect(flattenTree(rebuilt).order.length).toBe(before);
    // A trail that re-opens a composition already closed is the one malformed
    // shape `treeFromTrails` repairs rather than refuses — no tree this program
    // writes can produce it, and this is the check that ours does not.
    const trails = out.layers.map((l) => l.nest);
    const seen = new Set<string>();
    let closed = false;
    let last: string | undefined;
    for (const t of trails) {
      if (t !== last) {
        if (last !== undefined) seen.add(last);
        if (t !== undefined && seen.has(t)) closed = true;
        last = t;
      }
    }
    expect(closed).toBe(false);
  });
});

// ── 6. the budget ────────────────────────────────────────────────────────

/**
 * REQUIREMENT 6. `artfile.MAX_LAYERS` is 8192 NODES and a payload past it is
 * refused ON LOAD, so a producer that writes one has handed a person a file this
 * program cannot open.
 *
 * The history below is built from real strokes rather than from `EmitLayer`
 * literals, because the claim is that an ordinary drawing can reach the cap —
 * `auto` nesting adds a child per claiming group, and a drag applies the brush
 * once per position it passed through.
 */
describe("a gesture tree too big for a file is declined, not written", () => {
  /**
   * A drag across every orbit of the sector brush, repeated in fresh colours.
   *
   * ONE SEED PER ORBIT, because a second seed landing on an orbit the drag has
   * already painted plans no edits and records no group — which is exactly the
   * `bins`/`stated` distinction `gestureLayers` was fixed for, and it means a
   * drag's node count is bounded by the ORBITS it crossed and not by its length.
   * The depth-3 sector has 90 of them under the 6-fold brush (6 of size 1, 42 of
   * 3, 42 of 6), so a drag over all of them is 1 + 90 nodes and a hundred such
   * gestures is 9100 — past 8192, and inside `layers.HISTORY_LIMIT`'s 256.
   */
  const heavy = (): Studio => {
    const st = open();
    const surface = surfaceOf("sector");
    const seen = new Set<number>();
    const seeds: number[] = [];
    for (let i = 0; i < surface.cellCount; i++) {
      if (seen.has(i)) continue;
      seeds.push(i);
      for (const c of surface.orbit(i, 6)) seen.add(c);
    }
    expect(seeds).toHaveLength(90);
    // A fresh colour each time, so every pass genuinely repaints rather than
    // planning nothing.
    for (let g = 0; g < 100; g++) {
      commit(
        st,
        "sector",
        plain(6),
        seeds,
        `#${(0x333333 + g * 0x000103).toString(16).padStart(6, "0")}`
      );
    }
    return st;
  };

  it("counts the nodes and refuses before a byte is written", () => {
    const st = heavy();
    const out = gestureExport(st);
    expect("refused" in out).toBe(true);
    const said = (out as { refused: string }).refused;
    // WHAT A PERSON SEES: that nothing was written, how far over it is, what the
    // limit is, and the one thing that would bring it under.
    expect(said).toContain("nothing written");
    expect(said).toContain(String(MAX_LAYERS));
    expect(said).toMatch(/Merge frames in the timeline/);
    expect(said).toMatch(/\d{4,} groups/);
  });

  it("counts every node of the tree, parents and children alike", () => {
    const st = heavy();
    const past = st.session.journal.past;
    const states = everyComposition(st.session.composition, past).map((c) =>
      flattenComposition(c, book)
    );
    const strokes = actStrokes(past);
    const layers = gestureLayers(
      beatsOf(states).map((a) => strokes[a]),
      book
    );
    const budget = layerBudget(layers);
    expect(budget.limit).toBe(MAX_LAYERS);
    expect(budget.layers).toBe(provenanceCensus(layers).layers);
    expect(budget.layers).toBeGreaterThan(MAX_LAYERS);
    // The escape hatch the sentence deliberately does NOT name, measured so the
    // reason it is withheld is a choice rather than an oversight: `nest:
    // "never"` does fit, and no control in the editor sets it.
    const flatLayers = gestureLayers(
      beatsOf(states).map((a) => strokes[a]),
      book,
      { nest: "never" }
    );
    expect(layerBudget(flatLayers).said).toBeNull();
    expect(layerBudget(flatLayers).layers).toBe(flatLayers.length);
  });

  it("says nothing at all about an ordinary drawing", () => {
    const out = exported(studio());
    const budget = layerBudget(out.layers);
    expect(budget.said).toBeNull();
    expect(budget.layers).toBe(6);
    // The boundary is inclusive: a tree of exactly `MAX_LAYERS` nodes fits.
    const exact: EmitLayer[] = Array.from({ length: MAX_LAYERS }, (_, k) => ({
      id: `g${k}`,
    }));
    expect(layerBudget(exact).said).toBeNull();
    expect(layerBudget([...exact, { id: "one-too-many" }]).said).not.toBeNull();
  });
});
