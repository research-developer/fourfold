/**
 * BYTE IDENTITY ACROSS THE DEPTH→SCALE REFACTOR.
 *
 * The refactor this file guards replaces DEPTH as the carrier of resolution
 * with SCALE, at fixed radix 4, where `scale = 2^depth` is a bijection and the
 * change is therefore a no-op BY CONSTRUCTION. "By construction" is an argument,
 * not a measurement, so this file measures it instead: three export paths, run
 * end to end, and their bytes compared against constants pinned from the tree as
 * it stood at `bca3e84` — before a line of the refactor was written.
 *
 * ── Why a PIN and not a re-encode ────────────────────────────────────────
 *
 * The obvious test — export twice and compare — is worthless here. Both halves
 * would run the same post-refactor code, so it would pass on any consistent
 * wrong answer, including "every scale is now 1". The expected values below were
 * produced by the code BEFORE the change and are literals in this file, so the
 * only way to satisfy them is to emit the same bytes the old code emitted.
 *
 * A SHA-256 over the UTF-8 bytes, plus the byte length, plus a readable head
 * slice. The digest is what makes the assertion total — one byte anywhere moves
 * it — and the length and the head are what make a failure diagnosable, because
 * a digest alone tells you only that something moved.
 *
 * ── The three paths, and why these three ─────────────────────────────────
 *
 * They are the three documents this program writes, and they descend through the
 * geometry by three different routes:
 *
 *   STILL      `emit.serialise` over the EDITOR's layers. Reaches the geometry
 *              through `view.plateFrame`, which is site 5 of the refactor.
 *   ANIMATED   `replay.animatedSvg` over the journal's steps. A separate
 *              serialiser sharing no bytes with the still, and the only one that
 *              writes a timing.
 *   GESTURE    `emit.serialise` over the HISTORY's layers — `provenance.
 *              gestureLayers` — which is the path that carries an address
 *              through `plate.ts`'s prefix resolution, i.e. the one that would
 *              break if the resolution comparison had been changed wrongly.
 *
 * All three carry an `ArtPayload`, so `artfile.cellCount` — site 7, and the one
 * place a DEPTH crosses into the model from the FILE — is exercised by every one
 * of them, and the payload's `depth` field is inside the pinned bytes. That is
 * the file-format half of the acceptance test: if the refactor had written a
 * scale where a depth belonged, these digests would move.
 *
 * ── The scene ────────────────────────────────────────────────────────────
 *
 * Built by the real machinery on the discipline `test/gestureexport.test.ts`
 * sets out — `orbit.ts` for the symmetry, `brush.ts` for the stamp, `plate.ts`
 * for the edits, `layers.ts` for the acts — and never by a hand-written mark,
 * because a fixture written by the same hand as the implementation agrees with
 * it about exactly the thing under test. The gestures are chosen to span the
 * cases that matter to a plate: several orbit sizes, a drag whose groups
 * disagree in size, and an erase, which is the one edit that makes a step draw
 * rather than vanish.
 */

import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
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
  plateEntries,
  type Address,
  type AddressPlate,
} from "../src/lib/plate";
import { mergeEdits, type CellEdit, type Stroke } from "../src/lib/strokes";
import {
  act,
  find,
  flatten as flattenComposition,
  fromPlate,
  newSession,
  NO_GESTURE,
  soleLayer,
  type Layer,
  type LayerId,
  type Move,
  type Session,
} from "../src/lib/layers";
import { actStrokes, emitLayersOf, everyComposition } from "../src/lib/composer";
import { serialise, type EmitDoc } from "../src/lib/emit";
import { gestureAnimation, gestureLayers } from "../src/lib/provenance";
import { beatsOf, compTrails, minter, syncTree } from "../src/lib/timeline";
import {
  animatedSvg,
  animationSteps,
  animationTiming,
  boundAnimation,
} from "../src/lib/replay";
import { plateFrame } from "../src/lib/view";
import { payloadFromPaint } from "../src/lib/artfile";

// ── the scene ────────────────────────────────────────────────────────────

const DEPTH = 3;
const STEP_MS = 250;
const hex = buildHexagon(DEPTH);
const book = addressBook(hex);
const bands = buildBandSurface(hex);
const surfaceOf = (scope: BrushScope): SymmetrySurface => hexagonSurface(hex, scope);

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

/** `draw/page.tsx`'s `paintAt` + `endStroke`, with the UI taken out. */
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

/**
 * Four gestures and an erase, deterministic in every choice.
 *
 * Every seed is found by a PROPERTY — "the first cell whose orbit has six
 * members" — rather than written as an index, so the scene does not silently
 * become a different scene if the cell order ever changes for a reason that has
 * nothing to do with this refactor. If the order did change, the seeds would
 * move together and the digests would fail loudly, which is the correct outcome:
 * the pin is on the BYTES, and the bytes are what the user gets.
 */
function studio(): Studio {
  const st = open();
  commit(st, "hexagon", plain(6), [seedWithOrbit("hexagon", 6, 6)], "#c0392b");
  // A DRAG whose groups disagree in size: `s0:AAA` is pinned on the sector
  // median (orbit 3) and the second seed is free (orbit 6). Two group sizes in
  // one gesture is what makes the gesture export nest rather than flatten.
  commit(
    st,
    "sector",
    plain(6),
    [book.index.get("s0:AAA") as number, seedWithOrbit("sector", 6, 6)],
    "#2980b9"
  );
  commit(st, "hexagon", plain(12), [book.index.get("s1:AAA") as number], "#f1c40f");
  // The ERASE, last, over the first gesture's orbit: the one edit that makes a
  // step DRAW (in the unpainted fill) rather than remove an element, so the
  // animated path's additive invariant is inside the pinned bytes.
  commit(st, "hexagon", plain(6), [seedWithOrbit("hexagon", 6, 6)], null);
  return st;
}

// ── the three exports, each the page's own expression ────────────────────

/**
 * `draw/page.tsx`'s `emitDoc` — the STILL document, the EDITOR's layers.
 *
 * THE PAYLOAD IS BUILT BY `payloadFromPaint`, not written out by hand, and that
 * is not cosmetic. A hand-built payload skips `artfile.cellCount` — the second
 * of the two depth→scale boundaries — and skips `plate.plateEntries`, which
 * decides whether the `plate` field is written at all by comparing an address's
 * resolution against the book's. Both were changed by this refactor, and a pin
 * that did not reach them would be pinning the wrong document.
 *
 * Found by guard-fire rather than by reading: perturbing `scaleOfDepth` left the
 * hand-built version GREEN while the other two paths went red. The still
 * picture's geometry turns out to be genuinely scale-invariant — `buildFigure`
 * multiplies barycentrics up by `scale` and `toXY` divides them back down, so a
 * uniform change of scale cancels in the pixels — so the payload is where a
 * still export can actually be made to lie, and the pin has to reach it.
 */
function stillDoc(st: Studio): EmitDoc {
  const pf = plateFrame(hex, { mode: "hexagon", sector: 0 });
  const picture = flattenComposition(st.session.composition, book);
  const sole = soleLayer(st.session.composition);
  return {
    width: pf.width,
    height: pf.height,
    cells: new Map(pf.cells.map((c, i) => [i, { verts: c.verts }])),
    shown: pf.shown,
    background: PLATE_BG,
    unpainted: TILE,
    tileSeam: "rgba(236,230,220,.16)",
    paintSeam: "rgba(0,0,0,.3)",
    weldPaint: false,
    seamWidth: 0.7,
    title: `FOURFOLD — hexagon, depth ${DEPTH}`,
    layers: emitLayersOf(st.session.composition, book),
    overlay: [],
    animation: null,
    payload: payloadFromPaint(
      "hexagon",
      DEPTH,
      "apex",
      picture,
      undefined,
      sole === null ? undefined : plateEntries(sole.plate, book)
    ),
  };
}

/** `draw/page.tsx`'s `animationModel` + `animationText`, with the React out. */
function animatedText(st: Studio): string {
  const past = st.session.journal.past;
  const pf = plateFrame(hex, { mode: "hexagon", sector: 0 });
  const states = everyComposition(st.session.composition, past).map((c) =>
    flattenComposition(c, book)
  );
  const frames = animationSteps(states, actStrokes(past), book, TILE, undefined);
  const cut = boundAnimation(states[0], frames, null);
  const timing = animationTiming(STEP_MS, cut.steps.length);
  return animatedSvg({
    width: pf.width,
    height: pf.height,
    cells: pf.cells.map((c) => ({ verts: c.verts })),
    background: PLATE_BG,
    unpainted: TILE,
    tileSeam: "rgba(236,230,220,.16)",
    paintSeam: "rgba(0,0,0,.3)",
    weldPaint: false,
    seamWidth: 0.7,
    title: `FOURFOLD replay — hexagon, depth ${DEPTH}, ${cut.steps.length} gestures at ${STEP_MS} ms`,
    payload: payloadFromPaint(
      "hexagon",
      DEPTH,
      "apex",
      states[states.length - 1]
    ),
    ground: cut.ground,
    steps: cut.steps,
    stepMs: STEP_MS,
    holdMs: timing.holdMs,
    fadeMs: timing.fadeMs,
    grouping: "orbit",
  });
}

/** `draw/page.tsx`'s `gestureDoc` — the LAYERED GESTURE document. */
function gestureText(st: Studio): string {
  const past = st.session.journal.past;
  const states = everyComposition(st.session.composition, past).map((c) =>
    flattenComposition(c, book)
  );
  const beats = beatsOf(states, undefined);
  const tree = syncTree(null, beats, minter(900)).tree;
  const strokes = actStrokes(past);
  const layers = gestureLayers(
    beats.map((a) => strokes[a]),
    book,
    { unpainted: TILE, trails: compTrails(tree) }
  );
  return serialise({
    ...stillDoc(st),
    layers,
    animation: gestureAnimation(beats.length, STEP_MS, null),
  });
}

// ── the pin ──────────────────────────────────────────────────────────────

const sha256 = (s: string): string =>
  createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");

const bytes = (s: string): number => Buffer.byteLength(s, "utf8");

/**
 * Pinned at `bca3e84`, the commit before the depth→scale refactor.
 *
 * To re-pin deliberately — which should happen only when an export's CONTENT is
 * meant to change — run this file and copy the received values. Re-pinning to
 * make a red test green is the failure this file exists to prevent.
 */
interface Pin {
  readonly bytes: number;
  readonly sha256: string;
  readonly head: string;
}

const STILL_PIN: Pin = {
  bytes: 17228,
  sha256: "eeb6b871e4e8aeb9a14334b5af22b0bbc45b9fe8ee4f0181562a87f30dc1ad7e",
  head:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1144 1006.81" ' +
    'width="1144" height="1006.81" id="ff377ffe" role="img',
};

const ANIMATED_PIN: Pin = {
  bytes: 22959,
  sha256: "6732b363faace457376a783e62ef3e7400381ec1e61375d62e80d2bc022e3aa2",
  head:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1144 1006.81" ' +
    'width="1144" height="1006.81" role="img"><!-- fourfol',
};

const GESTURE_PIN: Pin = {
  bytes: 20449,
  sha256: "ec555b5569115202b985ade6dfbfc25d793451000b43b5bfe2b17f620246e47e",
  head:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1144 1006.81" ' +
    'width="1144" height="1006.81" id="fff24880" role="img',
};

const assertPinned = (text: string, pin: Pin): void => {
  expect({
    bytes: bytes(text),
    sha256: sha256(text),
    head: text.slice(0, 120),
  }).toEqual(pin);
};

describe("byte identity across the depth→scale refactor", () => {
  const st = studio();

  it("the still export is byte-identical to the pin", () => {
    assertPinned(serialise(stillDoc(st)), STILL_PIN);
  });

  it("the animated export is byte-identical to the pin", () => {
    assertPinned(animatedText(st), ANIMATED_PIN);
  });

  it("the layered gesture export is byte-identical to the pin", () => {
    assertPinned(gestureText(st), GESTURE_PIN);
  });
});
