/**
 * COMPOSER: the three joins between `layers.ts`, `emit.ts` and the page.
 *
 * Neither of the two modules this sits between knows the other exists, and that
 * is deliberate — `layers.ts` holds a tree of ADDRESS plates and a journal of
 * moves, `emit.ts` writes a tree of CELL-INDEX paint and reads it back, and
 * neither should have to learn the other's vocabulary. This is the translation,
 * in one place, so there is one answer to each of the three questions rather
 * than one per caller:
 *
 *   1. WHAT DID THE DRAWING LOOK LIKE `k` GESTURES AGO?  `layers.ts` journals
 *      acts, not plates, so the preview machinery that used to walk a plate
 *      backwards through `replay.stateAt` now walks a COMPOSITION backwards
 *      through `stepComposition`. Same shape, same exactness — every move
 *      carries what it replaced — and the same "step from where you stand"
 *      cost, so a scrub pays for the acts it crosses and nothing else.
 *
 *   2. HOW DOES A COMPOSITION BECOME A FILE, AND BACK?  `emitLayersOf` and
 *      `stackFromEmit`. ONE pair, used by the clipboard and by the file picker
 *      alike: see the header of `emit.ts` for why copy/paste and export/import
 *      are the same operation, and see `LayersPanel` for the two transports
 *      that are the only difference between them.
 *
 *   3. WHAT IS A JOURNAL OF ACTS, SEEN AS A LIST OF GESTURES?  `actStrokes`.
 *      The animated export and the replay scrub were written against
 *      `Stroke<Address>[]` and there is no reason to rewrite them: an act's
 *      paint moves merge into one gesture, and a structural act — an add, a
 *      reorder — is a gesture that changed no cell, which is exactly what it is.
 *
 * ZERO FLOAT and zero arithmetic beyond array indices, on the same rule as the
 * two modules either side.
 *
 * ── The one lossy edge, stated rather than hidden ────────────────────────
 *
 * A `Layer` holds an ADDRESS plate, which can carry paint at several depths at
 * once; an `ArtLayer` holds `[cell index, colour]` at ONE depth. So
 * `emitLayersOf` resolves each layer onto the book it is given and a layer's
 * off-depth paint arrives back at the exported depth, refined. The whole
 * drawing's addresses still survive verbatim — `payloadFromPaint` carries the
 * flattened address plate — so the PICTURE round-trips exactly and only the
 * per-layer statement of it is quantised. That is the file format's shape, not
 * a decision taken here, and it is why `stackFromEmit` takes a book at all.
 */

import {
  alphaOf,
  applyMove,
  canonicalAlpha,
  layerId,
  OPEN,
  switchesOf,
  type Act,
  type Composition,
  type Effective,
  type Journal,
  type Layer,
  type LayerId,
  type Move,
  type Stack,
  type Switches,
} from "./layers";
import type { EventLog } from "./brush";
import {
  resolvePlate,
  type Address,
  type AddressBook,
  type AddressPlate,
} from "./plate";
import type { CellEdit, Stroke } from "./strokes";
import type { EmitLayer } from "./emit";

// ── walking the journal ──────────────────────────────────────────────────

/**
 * A move that undoes this one.
 *
 * Used only by `revertMoves`, which needs the inverses as ORDINARY forward
 * moves so a revert can be one more rung of the journal rather than a
 * truncation of it — the house rule that NEW is the only control that destroys
 * anything. `applyMove` already knows how to run a move backwards; that is not
 * enough here, because the rung this builds is replayed forwards by `redo`.
 */
export function invertMove(move: Move): Move {
  switch (move.kind) {
    case "paint":
      return {
        kind: "paint",
        layer: move.layer,
        stroke: {
          edits: move.stroke.edits.map(
            (e): CellEdit<Address> => ({ cell: e.cell, from: e.to, to: e.from })
          ),
        },
        // SWAPPED, on the same line of reasoning as the edits above and in the
        // same breath, which is the whole reason `layers.MoveGesture` is a
        // `{ from, to }` pair. The inverse of a paint that stripped a gesture is
        // a move that RESTORES it going forwards, and forwards is the only
        // direction these are ever applied in: `revertMoves` hands them to
        // `layers.act`, which is an ordinary journal rung. Left out, REVERT
        // dropped `mode` and `orbit` for good and said "⌘Z brings them all back"
        // while doing it.
        gesture: { from: move.gesture.to, to: move.gesture.from },
      };
    case "rename":
      return { kind: "rename", layer: move.layer, from: move.to, to: move.from };
    case "place":
      return {
        kind: "place",
        op: move.op === "insert" ? "remove" : "insert",
        at: move.at,
        node: move.node,
      };
  }
}

/** `0…length`, with anything unusable reading as the live end. `replay`'s rule. */
export function clampAct(n: number, length: number): number {
  if (!Number.isFinite(n)) return length;
  const k = Math.round(n);
  return k < 0 ? 0 : k > length ? length : k;
}

/**
 * The composition after `to` acts, given the one after `from` of them.
 *
 * Both indices count COMMITTED acts, so `0` is the state the journal began from
 * and `past.length` is the live composition. Exact in both directions — a place
 * move carries the whole subtree it moved and a paint move carries the colour
 * that was there — so scrubbing back and forth over a range returns the same
 * tree every time.
 */
export function stepComposition(
  comp: Composition,
  past: readonly Act[],
  from: number,
  to: number
): Composition {
  let at = clampAct(from, past.length);
  const want = clampAct(to, past.length);
  let out = comp;
  while (at > want) {
    const moves = past[at - 1].moves;
    for (let k = moves.length - 1; k >= 0; k--) out = applyMove(out, moves[k], "undo");
    at -= 1;
  }
  while (at < want) {
    for (const m of past[at].moves) out = applyMove(out, m, "do");
    at += 1;
  }
  return out;
}

/**
 * Every composition the journal can show, oldest first. `past.length + 1` of
 * them.
 *
 * One backward walk to the base and then one forward walk, so the whole
 * sequence costs two passes rather than one per state. The animated export
 * wants all of them at once; the scrub wants one and uses `stepComposition`.
 */
export function everyComposition(
  live: Composition,
  past: readonly Act[]
): readonly Composition[] {
  const out: Composition[] = [stepComposition(live, past, past.length, 0)];
  for (let k = 0; k < past.length; k++) {
    out.push(stepComposition(out[k], past, k, k + 1));
  }
  return out;
}

/**
 * The moves that take the live composition back to state `to`, as ONE act.
 *
 * Every act between, inverted, latest first. NOT the symmetric difference
 * `replay.revertTo` takes of two plates, and the difference is forced rather
 * than chosen: a composition is a tree and two trees have no cell-by-cell
 * difference to take — a layer added and deleted between the two states leaves
 * no trace in either, but the acts that did it are still the only exact
 * description of the path. Running the inverses is that description.
 *
 * Empty when the drawing already stands there.
 */
export function revertMoves(
  past: readonly Act[],
  from: number,
  to: number
): readonly Move[] {
  const at = clampAct(from, past.length);
  const want = clampAct(to, past.length);
  const out: Move[] = [];
  for (let k = at - 1; k >= want; k--) {
    const moves = past[k].moves;
    for (let j = moves.length - 1; j >= 0; j--) out.push(invertMove(moves[j]));
  }
  return out;
}

/** How many cell edits an act carries, across every layer it touched. */
export function actCells(act: Act): number {
  let n = 0;
  for (const m of act.moves) if (m.kind === "paint") n += m.stroke.edits.length;
  return n;
}

/** True when an act changed paint. False for a pure add, reorder or rename. */
export const actPaints = (act: Act): boolean =>
  act.moves.some((m) => m.kind === "paint");

/**
 * The colour progression's event log, READ OFF THE JOURNAL.
 *
 * There is no second stack to keep in step any more — `Act.events` is the whole
 * record, so this is a projection rather than a copy, and it cannot be pushed
 * apart from the history it shadows. Undo and redo move both because they move
 * one; `HISTORY_LIMIT` trims both because it trims one; and an act that nobody
 * remembered to count spends zero rather than nothing, which is the case
 * (`clearLayer`) that used to slide every later stroke's hue.
 *
 * Derived on demand rather than stored, on exactly the argument `Effective`
 * makes in `layers.ts`: a value computed from the authority cannot disagree
 * with it.
 */
export function eventsOf(journal: Journal): EventLog {
  return {
    past: journal.past.map((a) => a.events),
    future: journal.future.map((a) => a.events),
  };
}

/**
 * The journal as the list of GESTURES the replay was written against.
 *
 * One stroke per act, holding every paint move's edits in order. An act that
 * touched several layers — a clear of a subtree is one paint move per plate —
 * becomes ONE gesture, which is what it was: the person pressed one button.
 *
 * The MARK is the first one an act carries, because a gesture is made under one
 * brush symmetry and a compound act has none of its own. A structural act
 * yields an empty stroke, and `replay.animationSteps` already drops a step that
 * changed no cell in frame, so nothing downstream has to learn about layers.
 */
export function actStrokes(past: readonly Act[]): Stroke<Address>[] {
  return past.map((a) => {
    const edits: CellEdit<Address>[] = [];
    let mark: Stroke<Address>["mark"];
    for (const m of a.moves) {
      if (m.kind !== "paint") continue;
      for (const e of m.stroke.edits) edits.push(e);
      if (mark === undefined && m.stroke.mark !== undefined) mark = m.stroke.mark;
    }
    return mark === undefined ? { edits } : { edits, mark };
  });
}

// ── the file, and the clipboard ──────────────────────────────────────────

/**
 * The composition as the layer tree a file is written from.
 *
 * `hidden`, `locked` and `opacity` are the layer's OWN switches and never the
 * inherited ones — `emit.ts` says so in its own header, and writing the
 * resolved answer here would permanently mark every child of a hidden parent
 * hidden, and would burn the PRODUCT of a chain of alphas into each link of it.
 * Absent rather than `false`/`1` for all three, so an ordinary layer costs no
 * attributes.
 *
 * THE ALPHA IS A DISPLAY FACT AND THE FILE HAS ALWAYS HAD SOMEWHERE TO PUT IT:
 * `emit.EmitLayer.opacity` predates this, `serialise` writes it as an SVG group
 * opacity, `toArtLayer` puts it in the payload and `artfile.ts` validates the
 * range. The one thing missing was a model that could state it, which is
 * `layers.Switches.opacity` — so this line is the whole of the export side.
 * `layers.ts`'s header carries the argument for why an alpha may be a display
 * property and may not be a colour.
 *
 * A layer that holds no paint of its own still gets a `<g>`: it may be a group,
 * and a group with children and no paint is exactly what a pasted composition
 * grafts in as.
 *
 * ── The gesture, written where a stranger can read it ───────────────────
 *
 * `reveal`, `mode` and `orbit` are copied straight off the layer, ONE FOR ONE
 * and with no arithmetic anywhere, so that `emit.ts` can put them into the
 * markup as `data-reveal`, `data-mode` and `data-orbit` — which is what makes a
 * `<g>` in Illustrator an addressable stroke with its symmetry attached rather
 * than an anonymous compound path. The fields are the layer's OWN, on the same
 * rule as the switches: nothing is resolved under an ancestor.
 *
 * ABSENT STAYS ABSENT, and it is written as three `!== undefined` tests rather
 * than a spread of the layer, because the whole point is that a layer nobody
 * recorded a gesture for produces the file it produced before this existed —
 * `emit.ts` writes no attribute for an absent field, `artfile.ts` writes no key,
 * and the bytes do not move. Spreading `{ ...l }` here would carry `plate` and
 * `children` into an `EmitLayer` as well, so the explicit form is also the
 * correct one.
 *
 * NOTHING IS DERIVED. `orbit` is not filled in from `mode`, `mode` is not
 * defaulted to 1, and neither is checked against the other — a stabilised seed
 * gives `mode: 6, orbit: 3` and that is the ordinary case. See
 * `layers.LayerGesture`.
 */
export function emitLayersOf(
  comp: Composition,
  book: AddressBook
): readonly EmitLayer[] {
  const one = (l: Layer): EmitLayer => {
    const out: EmitLayer = { id: l.id, name: l.name };
    // The layer's OWN switches, read off the composition — they are not on the
    // layer, and `layers.Switches` says why.
    const own = switchesOf(comp, l.id);
    if (!own.visible) out.hidden = true;
    if (own.locked) out.locked = true;
    // Key order matches `emit.toArtLayer`, which is the order the payload is
    // re-encoded in and therefore the order the byte-for-byte round trip needs.
    const alpha = alphaOf(own);
    if (alpha !== 1) out.opacity = alpha;
    // The gesture, read off the LAYER — it is on the node and the switches are
    // not, and `layers.LayerGesture` argues that split.
    if (l.reveal !== undefined) out.reveal = l.reveal;
    if (l.mode !== undefined) out.mode = l.mode;
    if (l.orbit !== undefined) out.orbit = l.orbit;
    if (l.plate.size !== 0) out.paint = resolvePlate(l.plate, book);
    if (l.children.length !== 0) out.children = l.children.map(one);
    return out;
  };
  return comp.layers.map(one);
}

/**
 * A parsed layer tree as a stack of `Layer`, with ids minted from `nextId`.
 *
 * The file's own ids are DROPPED rather than carried, and that is the whole
 * safety of import: a `LayerId` is minted by one counter in one document, and a
 * file that arrived carrying `L2` would collide with the `L2` already on the
 * plate. `emit.rekey` solves the same problem on the file side, for a subtree
 * being written into a document that already has ids; this solves it on the
 * model side, where `layers.reid` will mint them AGAIN at paste time. Minting
 * twice is free and it means neither path can forget.
 *
 * `name` falls back to the file's id, because a layer with no name is a row you
 * cannot talk about.
 *
 * ── THE GESTURE COMES IN, and it used to be dropped here ────────────────
 *
 * `reveal`, `mode` and `orbit` are carried onto the `Layer`. They were not, and
 * the loss was SILENT AND TOTAL: `emit.ts` has always written the three, `parse`
 * has always read them back, and `artfile.ts` has always validated them — the
 * format round-tripped provenance perfectly at every nesting depth — but a
 * `Layer` had no slot for them, so this function read `paint`, `hidden`,
 * `locked`, `name` and `children` and let the rest fall on the floor. Open a
 * provenance-carrying SVG and save it again and the symmetry of every stroke was
 * gone, with no error, no warning, and a file that still looked identical.
 * Measured before the fix: `stackFromEmit` of a `{ reveal: 2, mode: 6, orbit: 3 }`
 * layer and `emitLayersOf` straight back out gave `undefined` for all three.
 *
 * Copied ONE FOR ONE, with the same `!== undefined` tests the writer uses, so a
 * file that says nothing yields a layer that says nothing rather than a layer
 * carrying three `undefined`s. Nothing is derived and nothing is cross-checked:
 * `mode: 6, orbit: 3` is a stabilised seed and arrives as it left.
 *
 * UNLIKE THE SWITCHES, these do not come back beside the stack. The switches
 * have to, because a `Layer` does not hold them; the gesture is ON the layer, so
 * it rides in the returned tree. `layers.LayerGesture` argues that placement.
 */
export function stackFromEmit(
  list: readonly EmitLayer[],
  book: AddressBook,
  nextId: number
): { stack: Stack; nextId: number; switches: ReadonlyMap<LayerId, Switches> } {
  let n = nextId;
  // Returned ALONGSIDE the stack rather than written into it: a `Layer` does
  // not hold its switches (see `layers.Switches`), so the file's `hidden` and
  // `locked` come back keyed by the ids minted here, and the caller carries
  // them into the document — `pasteInto` takes exactly this map as `from`.
  // A file that hides nothing yields an empty map.
  const switches = new Map<LayerId, Switches>();
  const one = (l: EmitLayer): Layer => {
    const id = layerId(n);
    n += 1;
    const plate = new Map<Address, string>();
    if (l.paint !== undefined) {
      for (const [i, hex] of l.paint) {
        const addr = book.addr[i];
        if (addr !== undefined) plate.set(addr, hex);
      }
    }
    // THE ALPHA COMES IN, and it used to be dropped here — the same silent,
    // total loss the gesture suffered, and flagged as a decision rather than an
    // oversight while `Layer` had nowhere to put it. `emit.ts` has always
    // written `opacity`, `artfile.ts` has always validated it in `0…1` and
    // `fromArtLayers` has always read it back, so a faded file round-tripped
    // through this function came out fully opaque with no error and no warning.
    // Measured before the fix: `stackFromEmit` of an `{ opacity: 0.42 }` layer
    // and `emitLayersOf` straight back gave `undefined`.
    //
    // CANONICALISED THROUGH `layers.canonicalAlpha` rather than trusted. A file
    // reaching here has passed `artfile`'s range check, but a clipboard
    // `EmitLayer` is an ordinary object from anywhere in the program and this is
    // the model's edge: the alternative to clamping is an `opacity="42"` in the
    // next file this document writes.
    const alpha = l.opacity === undefined ? 1 : canonicalAlpha(l.opacity);
    if (l.hidden === true || l.locked === true || alpha !== 1) {
      switches.set(id, {
        visible: l.hidden !== true,
        locked: l.locked === true,
        // Absent stays absent, so a file that fades nothing yields entries
        // shaped exactly as they were before this existed.
        ...(alpha === 1 ? {} : { opacity: alpha }),
      });
    }
    // The children are read AFTER this layer's own id is minted, so the ids
    // ascend in paint order and a file reads the way the panel does.
    const children = l.children === undefined ? [] : l.children.map(one);
    // Spread rather than assigned, so a field the file does not state is a key
    // the layer does not have. `{ reveal: l.reveal }` with `l.reveal` undefined
    // would make every imported layer carry all three keys, and "absent" would
    // stop being a shape anything can test for.
    return {
      id,
      name: l.name ?? l.id,
      plate,
      children,
      ...(l.reveal === undefined ? {} : { reveal: l.reveal }),
      ...(l.mode === undefined ? {} : { mode: l.mode }),
      ...(l.orbit === undefined ? {} : { orbit: l.orbit }),
    };
  };
  const stack = list.map(one);
  return { stack, nextId: n, switches };
}

/**
 * The plate a layer would have on its own, at this book's depth.
 *
 * The panel's per-row cell count, and the one number that tells a person
 * whether a row is empty before they press CLEAR on it.
 */
export const layerCells = (layer: Layer, book: AddressBook): number =>
  layer.plate.size === 0 ? 0 : resolvePlate(layer.plate, book).size;

/** Every id in a stack and everything under it. For a duplicate check. */
export function idsIn(stack: Stack): Set<LayerId> {
  const out = new Set<LayerId>();
  const go = (s: Stack): void => {
    for (const l of s) {
      out.add(l.id);
      go(l.children);
    }
  };
  go(stack);
  return out;
}

/** A stack's whole address plate, flattened bottom-up. Used by the panel's meta. */
export function stackAddresses(stack: Stack): number {
  let n = 0;
  const go = (s: Stack): void => {
    for (const l of s) {
      n += l.plate.size;
      go(l.children);
    }
  };
  go(stack);
  return n;
}

// ── what the panel reads ─────────────────────────────────────────────────

export interface PanelRow {
  readonly layer: Layer;
  /** 0 for a top-level layer. How far the row is indented. */
  readonly depth: number;
  /**
   * This layer's OWN switches and its own alpha.
   *
   * `own.visible` and `own.locked` ARE what the row's controls show and set — the
   * eye and the padlock. `own.opacity` IS NOT, and this used to say it was: there
   * is no alpha control in `LayersPanel`, and `layers.setOpacity` has no caller
   * anywhere in `src/`. The only way an alpha enters a `Composition` is
   * `stackFromEmit` below, reading one out of a file. So a fade that arrives in an
   * imported drawing is, today, PERMANENT AND UNCLEARABLE from the panel.
   *
   * It is carried here anyway and that is right rather than aspirational: the row
   * is what the panel READS, the value is real, it must survive a round trip, and
   * a row that dropped it would make the panel a second opinion about the
   * document. What was wrong was the sentence promising a control.
   *
   * `own.opacity` is absent for a layer nobody faded and means 1; `layers.alphaOf`
   * is the reader that says so once.
   *
   * Different from `effective`, which is the inherited answer: a visible layer
   * inside a hidden parent has `own.visible` true and `effective.shown` false,
   * and the row says both things. THERE IS DELIBERATELY NO INHERITED ALPHA
   * beside `effective.shown` — a nested fade multiplies, and the product is a
   * fact about the RENDER that SVG and `layers.strata` each work out for
   * themselves. Storing it on a row would be a third place for it to be wrong.
   * Read off the composition because a `Layer` does not carry any of them; see
   * `layers.Switches`.
   */
  readonly own: Switches;
  readonly effective: Effective;
  /** True when this row holds sub-layers, listed ABOVE it. */
  readonly group: boolean;
  /**
   * One flag per ancestor level, outermost first: does that ancestor have a
   * sibling still to come BELOW this row?
   *
   * What the indent guides are drawn from. A guide is a claim that the block
   * continues, so the last row of a nested block must not carry one — otherwise
   * every subtree in the panel looks open-ended and the depth stops being
   * countable, which is the whole job of the guides.
   */
  readonly spine: readonly boolean[];
}

/**
 * The stack as ROWS, TOP OF THE DRAWING FIRST.
 *
 * `layers.slices` returns paint order — `layers[0]` first, a layer before its
 * own children — which is SVG document order and exactly wrong for a panel,
 * where the row a person reads first should be the thing they are looking at.
 * So this reverses it, and reverses it COMPLETELY:
 *
 *   siblings run last-to-first, because `layers[0]` is the BOTTOM; and
 *   A LAYER'S CHILDREN ARE LISTED ABOVE IT, because they paint over it.
 *
 * The second half is a DEVIATION from what every other layers panel does, and
 * it is deliberate. The convention is a group header with its contents indented
 * underneath, which works because a group in those programs is a container and
 * not a position in the stack. Here a layer holds paint AND children at once —
 * that is what makes "paste onto a layer" mean what it means — and its own
 * paint sits UNDERNEATH its children. A header row above its contents would
 * therefore be a picture of the stack that is upside down at every group, and a
 * panel whose top-to-bottom order is only sometimes the stacking order is worse
 * than one that is unfamiliar. Read down this list and you are reading down
 * through the drawing, with no exception anywhere: the row nearest the top is
 * the layer nearest the viewer.
 *
 * `effective` is the INHERITED answer, computed here so the panel can show a
 * layer's OWN switch on its buttons and the inherited one in its state — the
 * two are different things and `layers.ts` names them apart so they cannot be
 * confused.
 */
export function panelRows(comp: Composition): readonly PanelRow[] {
  const out: PanelRow[] = [];
  const go = (
    stack: Stack,
    depth: number,
    spine: readonly boolean[],
    ancestorShown: boolean,
    ancestorLocked: boolean
  ): void => {
    for (let k = stack.length - 1; k >= 0; k--) {
      const layer = stack[k];
      const own = comp.switches.get(layer.id) ?? OPEN;
      const effective: Effective = {
        shown: ancestorShown && own.visible,
        editable: !ancestorLocked && !own.locked,
      };
      // `k > 0` — there is a sibling BELOW this one, so the guide for this
      // level continues past the rows of this subtree.
      go(
        layer.children,
        depth + 1,
        [...spine, k > 0],
        effective.shown,
        ancestorLocked || own.locked
      );
      out.push({
        layer,
        depth,
        own,
        effective,
        group: layer.children.length > 0,
        spine,
      });
    }
  };
  go(comp.layers, 0, [], true, false);
  return out;
}

/** The plate a whole subtree paints, later layers over earlier. Panel preview. */
export function subtreePlate(layer: Layer): AddressPlate {
  const out = new Map<Address, string>();
  const go = (l: Layer): void => {
    for (const [a, hex] of l.plate) out.set(a, hex);
    for (const c of l.children) go(c);
  };
  go(layer);
  return out;
}
