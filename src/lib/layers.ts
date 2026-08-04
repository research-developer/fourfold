/**
 * LAYERS: the drawing as an ordered TREE of plates, and the one flatten that
 * turns the tree back into a board.
 *
 * Until now there was one plate — `Map<Address, hex>` — and the board was
 * `resolvePlate` of it. A layer stack adds an axis the address space does not
 * have. The address tree says WHERE paint sits (a word over `{A,B,C,X}`, nesting
 * by prefix); the layer tree says WHICH SHEET it sits on, and sheets occlude one
 * another in order. Those are orthogonal, and keeping them orthogonal is the
 * whole of the discipline here: nothing below changes an address, and nothing
 * below reads one except to hand it to `plate.ts`.
 *
 * ZERO FLOAT, and in fact zero arithmetic beyond array indices and a depth
 * counter. A layer is an identity, two switches, a plate and an ordered list of
 * layers. Every operation is a pure function returning a new `Composition`.
 *
 * ── One recursive type, used at every level ──────────────────────────────
 *
 * `Stack` is `readonly Layer[]`, and it is BOTH the composition's top-level list
 * AND every layer's `children`. That is deliberate and it is the reason this
 * file is not three files: `flatten`, `insertAt`, `removeAt`, `walk` and `graft`
 * are each written once, against a stack, and therefore work at depth 1 and at
 * depth 12 without knowing which they are in.
 *
 * `Composition` is NOT literally a `Layer`, and the reason is worth stating
 * because unifying them is the obvious next step. A composition carries two
 * things a layer must never carry: the SELECTION, which is a fact about the
 * person and not about the drawing, and `nextId`, which is the document's id
 * counter. Giving those to a layer would mean every grafted subtree arrived
 * carrying a stale selection and a second id counter to reconcile. Synthesising
 * a hidden root `Layer` instead would put a node in the tree that must never be
 * selected, renamed, hidden, locked or deleted — five wrong states, all
 * representable, none of them prevented by the type. So the RECURSION is shared
 * (that is `Stack`) and the DOCUMENT-level facts are not.
 *
 * ── What the viewer sees: topmost visible wins, and nothing blends ───────
 *
 * Paint order is a depth-first PRE-ORDER over the stack: a layer's own plate
 * goes down first, then its children in array order over the top of it, then the
 * next sibling. `layers[0]` is the BOTTOM. So the last thing pre-order reaches
 * is the thing the viewer sees, and `flatten` walks that order backwards taking
 * the first colour it finds for each cell.
 *
 * A layer's own plate sitting UNDERNEATH its own children is a decision and not
 * a derivation. A layer holds paint and children at once (see the graft rule
 * below), so something has to say where its paint sits relative to them, and
 * "underneath" is the only answer that matches the gesture that creates the
 * situation: you paste something ONTO a layer, and what you dropped is on top of
 * what was there.
 *
 * NO BLENDING, and no per-layer opacity. Every colour in this program is
 * `#rrggbb` — `artfile.ts` will not accept anything else, `stampColours` never
 * produces anything else, and the adjustment brush works by reading the colour a
 * cell is DISPLAYING and transforming it. An alpha would make the flattened
 * board hold colours no scheme ever named, so the adjust tool would start
 * inventing hues, the exporter would have to write a fourth channel, and the
 * round trip promise would break. The stack occludes; it does not mix.
 *
 * LOCKED LAYERS STILL COMPOSITE. Lock is an EDIT guard and has nothing to do
 * with display — `flatten` does not read it. Hiding is the display switch, and
 * they are separate controls because they answer separate questions ("may I
 * change this?" against "may I see this?"). Confirmed by reading, and asserted
 * in `test/layers.test.ts` rather than left as a comment.
 *
 * ── Why each layer is resolved SEPARATELY and the plates are not merged ──
 *
 * The cheap shape is to merge every layer's plate into one `AddressPlate` and
 * call `resolvePlate` once. It is wrong, and the counterexample is two lines:
 *
 *   bottom layer paints `s0:AB` gold — one cell at depth 2
 *   top layer paints `s0:A` red — a wash over all four of them
 *
 * Merged, the plate is `{s0:AB → gold, s0:A → red}` and `resolvePlate`'s first
 * rule — EXACT beats ANCESTOR — hands `s0:AB` back as gold. The bottom layer's
 * detail punches a hole through the top layer's wash. That rule is correct
 * WITHIN a plate, where a deeper address is later work by the same hand; across
 * layers it is a category error, because layer order must dominate address
 * depth or the stack means nothing.
 *
 * The same merge also turns cross-layer disagreement into `resolvePlate`'s
 * CONFLICT: two layers painting different colours under one coarse cell would
 * make that cell render UNPAINTED at the shallower depth, so hiding the top
 * layer would make a colour appear. Also indefensible.
 *
 * So: resolve each layer's plate on its own, then composite the resolved index
 * maps. The cost is N resolutions instead of one, it was measured rather than
 * estimated, and the measurement is in `test/layers.test.ts` — see the note on
 * `flatten` for what N stays interactive.
 *
 * ── Own switches and EFFECTIVE ones are different things ─────────────────
 *
 * A layer carries `visible` and `locked`: its OWN switches, exactly as the panel
 * shows them. What rendering and hit-testing need is the INHERITED answer — a
 * hidden parent hides every descendant whatever their own switches say, and a
 * locked parent locks them. Those are computed, never stored, and they are
 * returned as `Effective { shown, editable }`.
 *
 * The field names differ on purpose. `visible`/`locked` live on a `Layer` and
 * `shown`/`editable` live on an `Effective`, so the two structs are not mutually
 * assignable and `tsc` catches the substitution. Naming both pairs
 * `visible`/`locked` would have made them structurally identical and the
 * classic bug in this design — writing an inherited answer back into a layer, or
 * reading a layer's own switch where the inherited one was meant — would have
 * type-checked. It cannot here.
 *
 * Keeping the own switch is what makes unhiding a parent restore EXACTLY what
 * was showing before: nothing was overwritten on the way down.
 *
 * ── The graft: paste is not a merge ─────────────────────────────────────
 *
 * Pasting a whole composition onto a layer makes it ONE new child of that layer,
 * with its own children intact all the way down. Nothing is flattened, nothing
 * is spliced, no depth limit is imposed. `graft` turns a `Stack` into a single
 * `Layer` and is the only place that conversion happens.
 *
 * Paste is BY VALUE: `reid` deep-copies the subtree with fresh ids, so pasting
 * the same clipboard twice gives two independent subtrees and no id can appear
 * twice in one document. Plates are shared by reference and never copied, which
 * is safe because an `AddressPlate` is a `ReadonlyMap` and every writer here
 * builds a new one.
 *
 * ── What is undoable, and what is deliberately not ──────────────────────
 *
 * The house rule established over several PRs is that NEW is the only control
 * that destroys anything. So everything that changes a plate or the shape of the
 * tree is journalled: paint, clear, add, delete, reorder, promote, demote,
 * paste, rename.
 *
 * TWO THINGS ARE NOT, and both are the same argument `page.tsx` already makes
 * for a depth change ("Undo takes back a change to the DRAWING, and this changes
 * none"):
 *
 *   VISIBLE and LOCKED. Toggling one destroys nothing. Its inverse is the same
 *   button, the button is on screen, and the button shows its own state. Undo
 *   exists for work you cannot trivially put back, and a switch you can see is
 *   not that. Putting them in the journal is actively harmful: hide a layer to
 *   see under it, paint three strokes, press undo four times expecting the paint
 *   back, and the fourth press unhides a layer instead. The counter-argument —
 *   that Illustrator does undo visibility — is real and lost to this one.
 *
 *   SELECTION. It is a fact about the person, not the drawing. Ops set it
 *   sensibly; `undo` and `redo` leave it alone unless it has come to name a
 *   layer that is no longer there, in which case it goes empty.
 *
 * Because neither is journalled, they are typed apart: an operation that
 * journals takes and returns a `Session`, and one that does not takes and
 * returns a `Composition`. The signature says which kind it is.
 *
 * ── Selection is an IDENTITY, and paths are how you locate ──────────────
 *
 * `selected` is a `LayerId | null`, not a `Path`. A `Path` — the child index at
 * each level, outermost first — is the addressing type every structural
 * operation is written against, and `pathOf` derives one on demand. But a path
 * is invalidated by any insertion or removal ABOVE it in the same parent, so a
 * stored path would have to be repaired by every op and would silently name a
 * different layer on the one it forgot. An id survives every reorder, every
 * graft and every promotion, and the only event that can invalidate it is the
 * selected layer itself being removed — which is exactly when the selection
 * should go empty anyway.
 *
 * DEVIATION, flagged rather than quietly taken: the brief asked for the
 * selection to be modelled as a path. It is modelled as an identity, with `Path`
 * first-class and used everywhere structural. The intent — that a selection must
 * address arbitrary depth and not a top-level index — is met, and met by
 * something that cannot go stale.
 */

import {
  applyPlateEdits,
  plateFromArtPayload,
  resolvePlate,
  type Address,
  type AddressBook,
  type AddressPlate,
  type PlateEdit,
} from "./plate";
import {
  clearStroke,
  HISTORY_LIMIT,
  type EditDirection,
  type Stroke,
} from "./strokes";
import type { ArtPayload } from "./artfile";

// ── the tree ─────────────────────────────────────────────────────────────

/**
 * A layer's identity, minted from the document's own counter.
 *
 * Branded, so it cannot be confused with an `Address` — both are strings, both
 * appear in the same signatures here, and `paint(comp, address, …)` where a
 * `LayerId` was meant would otherwise type-check and then quietly find no
 * layer. The brand is a phantom property that nothing can construct except
 * `layerId` below, which is the only mint in the program.
 */
declare const LAYER_ID: unique symbol;
export type LayerId = string & { readonly [LAYER_ID]: true };

/** `L1`, `L2`, … The number is the counter's value, so ids never repeat. */
export const layerId = (n: number): LayerId => `L${n}` as LayerId;

/** The counter's value inside an id, or `null` for anything not minted here. */
export function idNumber(id: LayerId): number | null {
  if (!id.startsWith("L")) return null;
  const n = Number(id.slice(1));
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/**
 * One layer: a name, two switches, a plate of its own, and a stack of children.
 *
 * `plate` and `children` coexist, which is what makes "paste onto a layer" mean
 * what the product says it means — the target keeps its identity and its paint
 * and gains a child. See the header for where its own paint sits.
 *
 * `visible` and `locked` are this layer's OWN switches. The inherited answers
 * are `Effective`, and they are never stored here.
 */
export interface Layer {
  readonly id: LayerId;
  readonly name: string;
  readonly visible: boolean;
  readonly locked: boolean;
  readonly plate: AddressPlate;
  readonly children: Stack;
}

/**
 * An ordered list of layers, BOTTOM FIRST.
 *
 * `layers[0]` is painted first and everything after it may cover it, which is
 * SVG document order — so a serialiser walks this array forwards, emits one
 * group per layer in order, and gets the composition right with no reversal.
 * That is the single fact another agent's code depends on most, so it is stated
 * here and asserted in the tests.
 *
 * The same type is a composition's `layers` and a layer's `children`. See the
 * header.
 */
export type Stack = readonly Layer[];

/**
 * Where a layer sits: the child index at each level, outermost first.
 *
 * `[2]` is the third top-level layer; `[2, 0, 1]` is the second child of the
 * first child of it. `[]` addresses the stack itself and is therefore never a
 * layer — `at(comp, [])` is `null`, deliberately, so "the whole document" cannot
 * be mistaken for a row in the panel.
 */
export type Path = readonly number[];

export interface Composition {
  readonly layers: Stack;
  /** The selected layer, or `null` for the empty selection. See the header. */
  readonly selected: LayerId | null;
  /** The id counter. Monotone; see `act` for why undo never rolls it back. */
  readonly nextId: number;
}

/**
 * The INHERITED answers, computed from a layer and every ancestor above it.
 *
 * Named `shown`/`editable` and not `visible`/`locked` so that this struct and a
 * `Layer` are not mutually assignable. See the header.
 */
export interface Effective {
  /** Every ancestor visible, and this layer visible. What `flatten` obeys. */
  readonly shown: boolean;
  /** No ancestor locked, and this layer unlocked. What the brush obeys. */
  readonly editable: boolean;
}

/** The name a migrated drawing and a fresh one both get. See `fromPlate`. */
export const FIRST_LAYER_NAME = "Layer 1";

/** What a pasted subtree's own name becomes. Illustrator's convention. */
export const pastedName = (name: string): string => `${name} copy`;

// ── building ─────────────────────────────────────────────────────────────

/** An empty layer with the given id and name. Never a group; children come later. */
function bare(id: LayerId, name: string): Layer {
  return {
    id,
    name,
    visible: true,
    locked: false,
    plate: new Map<Address, string>(),
    children: [],
  };
}

/**
 * A composition holding one layer over the plate the program used to hold.
 *
 * THIS IS THE MIGRATION, and the reason it is one line is the point of it: a
 * drawing made before layers existed and a fresh drawing made after are the SAME
 * OBJECT — one visible, unlocked, childless layer named "Layer 1", holding the
 * plate byte for byte. Nothing is resolved, summarised, split or renamed on the
 * way in, so a plate carrying paint at four depths arrives with all four, and
 * `soleLayer` can hand it straight back for a byte-identical re-export.
 */
export function fromPlate(
  plate: AddressPlate,
  name: string = FIRST_LAYER_NAME
): Composition {
  const id = layerId(1);
  return {
    layers: [{ ...bare(id, name), plate }],
    selected: id,
    nextId: 2,
  };
}

/** A fresh document: one empty layer, selected. What NEW produces. */
export const emptyComposition = (): Composition => fromPlate(new Map());

/**
 * A composition from a loaded `fourfold:art:1` payload.
 *
 * The payload's plate is read by `plate.ts`, which already knows how to take a
 * file that carries an address plate and one that predates the field, so every
 * `.svg` this program has ever written loads as a single layer. `book` must be
 * the book of the payload's OWN canvas and depth, exactly as
 * `plateFromArtPayload` requires.
 */
export function fromArtPayload(
  payload: ArtPayload,
  book: AddressBook
): Composition {
  return fromPlate(plateFromArtPayload(payload, book));
}

/**
 * The composition's whole stack as ONE layer, for the clipboard.
 *
 * The graft is the paste primitive: copy a document, drop it on a layer, and
 * what lands is a single child whose children are that document's layers with
 * their own children intact. The grafted layer holds no paint of its own,
 * because a stack has none — the paint is in the layers it carries.
 *
 * Returns the layer and the counter it consumed, rather than a `Composition`,
 * because the clipboard is not a document and giving it a selection would mean
 * pasting could move the selection to a layer from another document.
 */
export function graft(
  stack: Stack,
  name: string,
  nextId: number
): { layer: Layer; nextId: number } {
  return {
    layer: { ...bare(layerId(nextId), name), children: stack },
    nextId: nextId + 1,
  };
}

/**
 * The subtree, deep-copied with fresh ids.
 *
 * Plates are carried by REFERENCE and never copied: an `AddressPlate` is a
 * `ReadonlyMap` and every writer in this file and in `plate.ts` builds a new
 * one, so two layers sharing a plate object can never observe each other. That
 * is what makes pasting a depth-5 document cost a few dozen small objects
 * instead of tens of thousands of map entries.
 */
export function reid(
  layer: Layer,
  nextId: number
): { layer: Layer; nextId: number } {
  let n = nextId;
  const id = layerId(n);
  n += 1;
  const children: Layer[] = [];
  for (const c of layer.children) {
    const done = reid(c, n);
    children.push(done.layer);
    n = done.nextId;
  }
  return { layer: { ...layer, id, children }, nextId: n };
}

// ── walking ──────────────────────────────────────────────────────────────

/** The layer at a path, or `null`. `[]` is the stack and not a layer. */
export function at(comp: Composition, path: Path): Layer | null {
  if (path.length === 0) return null;
  let stack: Stack = comp.layers;
  let found: Layer | null = null;
  for (const k of path) {
    const next: Layer | undefined = stack[k];
    if (next === undefined) return null;
    found = next;
    stack = next.children;
  }
  return found;
}

/** Where a layer sits, or `null` when the document does not hold it. */
export function pathOf(comp: Composition, id: LayerId): Path | null {
  const walkStack = (stack: Stack, prefix: number[]): Path | null => {
    for (let k = 0; k < stack.length; k++) {
      const layer = stack[k];
      if (layer.id === id) return [...prefix, k];
      const deeper = walkStack(layer.children, [...prefix, k]);
      if (deeper !== null) return deeper;
    }
    return null;
  };
  return walkStack(comp.layers, []);
}

/** The layer with this id, or `null`. */
export function find(comp: Composition, id: LayerId): Layer | null {
  const path = pathOf(comp, id);
  return path === null ? null : at(comp, path);
}

/** The stack a path's parent holds — `comp.layers` for a top-level path. */
function parentStack(comp: Composition, path: Path): Stack | null {
  if (path.length === 0) return null;
  if (path.length === 1) return comp.layers;
  const parent = at(comp, path.slice(0, -1));
  return parent === null ? null : parent.children;
}

/** True when `outer` addresses `inner` or an ancestor of it. Exact, integer. */
export function coversPath(outer: Path, inner: Path): boolean {
  if (outer.length > inner.length) return false;
  for (let k = 0; k < outer.length; k++) if (outer[k] !== inner[k]) return false;
  return true;
}

/**
 * Every layer, in PAINT ORDER — depth-first pre-order, bottom of the stack
 * first, a layer before its own children.
 *
 * This is the order a serialiser emits and the order `flatten` reverses. It is
 * also the order the panel reads top-to-bottom if the panel reverses it, which
 * is the panel's business.
 */
export function walk(comp: Composition): Visit[] {
  const out: Visit[] = [];
  const go = (
    stack: Stack,
    prefix: number[],
    ancestorShown: boolean,
    ancestorLocked: boolean
  ): void => {
    for (let k = 0; k < stack.length; k++) {
      const layer = stack[k];
      const path = [...prefix, k];
      const effective: Effective = {
        shown: ancestorShown && layer.visible,
        editable: !ancestorLocked && !layer.locked,
      };
      out.push({ layer, path, depth: prefix.length, effective });
      go(layer.children, path, effective.shown, ancestorLocked || layer.locked);
    }
  };
  go(comp.layers, [], true, false);
  return out;
}

export interface Visit {
  readonly layer: Layer;
  readonly path: Path;
  /** 0 for a top-level layer. `path.length - 1`, carried so readers need not. */
  readonly depth: number;
  readonly effective: Effective;
}

/**
 * The inherited answers for one layer, or `null` when it is not in the document.
 *
 * A walk rather than a lookup, because the answer depends on every ancestor and
 * this file stores none of it. Cheap: the tree is a handful of layers deep.
 */
export function effectiveOf(comp: Composition, id: LayerId): Effective | null {
  const path = pathOf(comp, id);
  if (path === null) return null;
  let shown = true;
  let anyLocked = false;
  let stack: Stack = comp.layers;
  for (const k of path) {
    const layer = stack[k];
    shown = shown && layer.visible;
    anyLocked = anyLocked || layer.locked;
    stack = layer.children;
  }
  return { shown, editable: !anyLocked };
}

// ── flattening ───────────────────────────────────────────────────────────

/**
 * The flatten cache, keyed by the STACK's identity.
 *
 * Keyed on `comp.layers` rather than on the composition, and that is not an
 * accident: `select` returns a new `Composition` that keeps the same `layers`
 * array, so clicking a row in the panel does not throw away a composite of six
 * thousand cells. Every operation that does change the drawing builds a new
 * stack, so identity is an exact generation counter with no version number to
 * forget to bump — the same argument `plate.ts` makes for its own `VIEWS` map.
 *
 * The inner key is the address book's `id`, so two depths a user is toggling
 * between are both resident.
 */
const FLAT = new WeakMap<Stack, Map<string, ReadonlyMap<number, string>>>();

/**
 * The board: cell index → colour, at this book's depth, with the whole stack
 * composited.
 *
 * Topmost SHOWN layer wins per cell. Hidden layers and their whole subtrees are
 * skipped; locked ones are not, because lock is an edit guard (see the header).
 * The returned map is the CACHED one and must not be mutated.
 *
 * ── What it costs, MEASURED ─────────────────────────────────────────────
 *
 * `test/layers.test.ts` measures this at depth 5 — 6144 cells — for stacks that
 * are wide (N siblings), deep (N nested one per level) and mixed, over three
 * fills. The figures below are one machine's and the run prints its own; the
 * SHAPE of the answer is what the design was written around.
 *
 *   0.65 ms PER PAINTED LAYER, cold. Linear in N and INDEPENDENT OF THE SHAPE
 *   OF THE TREE — a chain of 16 and a row of 16 came out at 10.1 ms and
 *   10.0 ms, because both resolve 16 plates and the recursion is free next to
 *   that. Arbitrary nesting therefore costs nothing to composite.
 *
 *   The cost is per LAYER and not per address: `resolvePlate` sweeps the whole
 *   address list whatever the plate holds, so a layer with 878 addresses and one
 *   with 6144 cost the same 0.5–0.7 ms.
 *
 *   0.00 ms warm. Asked twice with nothing changed, the answer is the cached
 *   map — which is what makes a re-render free at every N.
 *
 *   0.7 ms after ONE layer is repainted, FLAT IN N — 0.69 ms at N=16 and
 *   0.78 ms at N=32. `resolvePlate` is memoised on plate identity, so a drag
 *   re-resolves exactly the layer under the brush and then composites. A
 *   reorder, a visibility toggle and an undo cost the same, because they build a
 *   new stack out of plates the cache already holds.
 *
 *   0.5 ms flat when a fully painted layer sits near the top, at any N, because
 *   the walk stops the moment every cell of the model is decided. Twelve sparse
 *   layers cost 7.79 ms uncapped and 0.53 ms under one full wash — a factor of
 *   15, which is why the short-circuit is in `composite` and not an optimisation
 *   to add later.
 *
 * SO: the only cost that grows with N is the cold one, and cold happens once per
 * file load. At 0.65 ms a layer, sixteen layers is 10 ms — one frame, with room
 * — and everything a person then does costs 0.7 ms whatever N is. SIXTEEN is the
 * number called interactive at depth 5. Twenty-four still fits a frame; at
 * thirty-two the load is 21 ms, which is one visible hitch on opening a file and
 * nothing after it.
 *
 * WHAT THE BRIEF GOT WRONG, stated because it changes the reading: 0.107 ms is
 * not a depth-5 resolution. `test/view.test.ts` reports 0.6 ms on this machine
 * for the same call, and that measurement resolves a plate of about 120
 * addresses — so 0.107 ms is a faster machine AND the sparse end of the range.
 * Per-layer cost at depth 5 is 0.5–0.7 ms, and N× that is what to budget.
 */
export function flatten(
  comp: Composition,
  book: AddressBook
): ReadonlyMap<number, string> {
  let perBook = FLAT.get(comp.layers);
  if (perBook === undefined) {
    perBook = new Map();
    FLAT.set(comp.layers, perBook);
  }
  const hit = perBook.get(book.id);
  if (hit !== undefined) return hit;
  const built = new Map<number, string>();
  composite(comp.layers, book, built, book.addr.length);
  perBook.set(book.id, built);
  return built;
}

/**
 * Reverse pre-order, taking the first colour found for each cell.
 *
 * The reverse of "self, then children in order" is "children in REVERSE order,
 * each reversed, then self" — so the deepest, last child is reached first and is
 * therefore the topmost thing on the board. Writing it as a reversal rather than
 * building the forward order and walking it backwards saves an array the size of
 * the tree on every render.
 *
 * Returns true once every cell of the model is decided, which lets a full wash
 * near the top of the stack cut off everything under it.
 */
function composite(
  stack: Stack,
  book: AddressBook,
  out: Map<number, string>,
  full: number
): boolean {
  for (let k = stack.length - 1; k >= 0; k--) {
    const layer = stack[k];
    // A hidden layer prunes its whole subtree: its children inherit the hiding
    // whatever their own switches say, so there is nothing below to look at.
    if (!layer.visible) continue;
    if (composite(layer.children, book, out, full)) return true;
    if (layer.plate.size !== 0) {
      for (const [i, hex] of resolvePlate(layer.plate, book)) {
        if (!out.has(i)) out.set(i, hex);
      }
      if (out.size >= full) return true;
    }
  }
  return false;
}

/**
 * The composite as an ADDRESS plate at the book's depth, for the file.
 *
 * The legacy `fourfold:art:1` payload states a drawing as one plate, and a
 * reader that predates layers has to see the PICTURE. This is that picture: the
 * flattened board, keyed back onto the addresses of the exported depth.
 *
 * It is deliberately NOT the union of the layers' plates. A union would re-open
 * the merge the header rejects, and an old reader would render a drawing nobody
 * made. What it loses instead is off-depth paint, which an old reader never had
 * a way to show and which the layer field carries in full.
 *
 * When the document is a single layer, prefer `soleLayer` — that plate is the
 * one the file has always carried, so the bytes do not move.
 */
export function flattenAddresses(
  comp: Composition,
  book: AddressBook
): AddressPlate {
  const out = new Map<Address, string>();
  for (const [i, hex] of flatten(comp, book)) out.set(book.addr[i], hex);
  return out;
}

/**
 * The one layer this document is, or `null` when it is more than one.
 *
 * Non-null exactly when the composition is a single childless top-level layer —
 * which is what every drawing made before layers existed becomes, and what a
 * fresh document is. A serialiser uses it to keep writing the file it always
 * wrote, byte for byte, for the documents that have not grown a stack.
 */
export function soleLayer(comp: Composition): Layer | null {
  if (comp.layers.length !== 1) return null;
  const only = comp.layers[0];
  return only.children.length === 0 ? only : null;
}

// ── the journal ──────────────────────────────────────────────────────────

/** Whether a placement puts a layer in or takes it out. Flipped by undo. */
export type Place = "insert" | "remove";

/**
 * The four things that can happen to the drawing, and nothing else.
 *
 * Every named operation below is built out of these, which is why undo is one
 * function rather than one per control. A reorder is a `remove` and an `insert`;
 * a paste onto a layer is one `insert`; a clear is one `paint` per plate it
 * empties.
 *
 * `paint` carries a whole `Stroke<Address>` — the same value `strokes.ts` has
 * always held — so the gesture's `mark` rides along untouched. Nothing here
 * reads it; `replay.ts` does.
 */
export type Move =
  | { readonly kind: "paint"; readonly layer: LayerId; readonly stroke: Stroke<Address> }
  | { readonly kind: "rename"; readonly layer: LayerId; readonly from: string; readonly to: string }
  | { readonly kind: "place"; readonly op: Place; readonly at: Path; readonly node: Layer };

/**
 * One undo rung: a list of moves and the sentence that describes them.
 *
 * A LIST because several controls are honestly compound — a reorder is two
 * placements, a clear of a subtree is one paint per plate — and a rung that took
 * back half of one would be worse than no rung at all. Undo applies the inverses
 * in reverse order, which is what makes a compound act exactly invertible.
 */
export interface Act {
  readonly moves: readonly Move[];
  /** What the panel says it did, and says it undid. */
  readonly note: string;
}

export interface Journal {
  readonly past: readonly Act[];
  readonly future: readonly Act[];
}

export const EMPTY_JOURNAL: Journal = { past: [], future: [] };

/** The drawing and its past. What the page holds. */
export interface Session {
  readonly composition: Composition;
  readonly journal: Journal;
}

export const newSession = (composition: Composition): Session => ({
  composition,
  journal: EMPTY_JOURNAL,
});

/** A session from the plate the program used to hold. The migration, in full. */
export const sessionFromPlate = (plate: AddressPlate): Session =>
  newSession(fromPlate(plate));

// ── applying a move ──────────────────────────────────────────────────────

/** A stack with `node` inserted at `path`. Recursive, so depth is not a case. */
function insertAt(stack: Stack, path: Path, node: Layer): Stack {
  const [k, ...rest] = path;
  if (rest.length === 0) {
    if (k < 0 || k > stack.length) {
      throw new Error(`layers: cannot insert at index ${k} of ${stack.length}`);
    }
    return [...stack.slice(0, k), node, ...stack.slice(k)];
  }
  const parent = stack[k];
  if (parent === undefined) {
    throw new Error(`layers: no layer at index ${k} to insert beneath`);
  }
  return [
    ...stack.slice(0, k),
    { ...parent, children: insertAt(parent.children, rest, node) },
    ...stack.slice(k + 1),
  ];
}

/** A stack with the layer at `path` taken out. */
function removeAt(stack: Stack, path: Path): Stack {
  const [k, ...rest] = path;
  const here = stack[k];
  if (here === undefined) {
    throw new Error(`layers: no layer at index ${k} of ${stack.length}`);
  }
  if (rest.length === 0) return [...stack.slice(0, k), ...stack.slice(k + 1)];
  return [
    ...stack.slice(0, k),
    { ...here, children: removeAt(here.children, rest) },
    ...stack.slice(k + 1),
  ];
}

/** A stack with one layer replaced by `f` of it. Identity when the id is absent. */
function mapLayer(stack: Stack, id: LayerId, f: (l: Layer) => Layer): Stack {
  let moved = false;
  const out = stack.map((layer) => {
    if (layer.id === id) {
      moved = true;
      return f(layer);
    }
    const children = mapLayer(layer.children, id, f);
    if (children === layer.children) return layer;
    moved = true;
    return { ...layer, children };
  });
  return moved ? out : stack;
}

/** `insert` under `do` is `remove` under `undo`, and the other way about. */
const flip = (op: Place, direction: EditDirection): Place =>
  direction === "do" ? op : op === "insert" ? "remove" : "insert";

/**
 * One move, forwards or backwards. The whole of undo, twice.
 *
 * THROWS when a move names a layer or a slot that is not there. That is
 * unreachable while the journal is walked linearly — you cannot undo a paint
 * inside a layer without first undoing the placement that removed it — and it is
 * left loud rather than silent because a journal that has come apart is the one
 * failure a drawing program cannot recover from, exactly as `addressBook`
 * refuses two cells with one address.
 */
export function applyMove(
  comp: Composition,
  move: Move,
  direction: EditDirection
): Composition {
  switch (move.kind) {
    case "paint": {
      let hit = false;
      const layers = mapLayer(comp.layers, move.layer, (l) => {
        hit = true;
        return {
          ...l,
          plate: applyPlateEdits(l.plate, move.stroke.edits, direction),
        };
      });
      if (!hit) throw new Error(`layers: no layer ${move.layer} to paint into`);
      return { ...comp, layers };
    }
    case "rename": {
      const name = direction === "do" ? move.to : move.from;
      let hit = false;
      const layers = mapLayer(comp.layers, move.layer, (l) => {
        hit = true;
        return { ...l, name };
      });
      if (!hit) throw new Error(`layers: no layer ${move.layer} to rename`);
      return { ...comp, layers };
    }
    case "place": {
      const op = flip(move.op, direction);
      const layers =
        op === "insert"
          ? insertAt(comp.layers, move.at, move.node)
          : removeAt(comp.layers, move.at);
      return { ...comp, layers };
    }
  }
}

/** Every move of an act, in order for `do` and reversed for `undo`. */
function applyAct(
  comp: Composition,
  act: Act,
  direction: EditDirection
): Composition {
  let out = comp;
  if (direction === "do") {
    for (const m of act.moves) out = applyMove(out, m, "do");
  } else {
    for (let k = act.moves.length - 1; k >= 0; k--) {
      out = applyMove(out, act.moves[k], "undo");
    }
  }
  return reseat(out);
}

/**
 * The selection, brought back inside the document.
 *
 * The only invariant `selected` has is that it names a layer that exists or is
 * `null`, and this is the one place it is restored. Called after every act and
 * after every undo and redo, so an operation cannot leave a selection pointing
 * at something it removed.
 */
function reseat(comp: Composition): Composition {
  if (comp.selected === null) return comp;
  return find(comp, comp.selected) === null ? { ...comp, selected: null } : comp;
}

/**
 * Push an act and apply it.
 *
 * The redo branch is discarded, which is the standard linear-history rule and
 * exactly what `strokes.commit` does. `HISTORY_LIMIT` is imported rather than
 * restated so the two stacks trim at the same depth; the oldest rung is dropped,
 * never the newest.
 *
 * `nextId` is NEVER rolled back by an undo, and that is deliberate. A `place`
 * move carries the layer it made, ids and all, so redo re-inserts the SAME ids
 * and nothing collides. Rolling the counter back would mean a layer added after
 * an undo could mint an id a rung in the journal still names.
 */
export function act(session: Session, moves: readonly Move[], note: string): Session {
  if (moves.length === 0) return session;
  const entry: Act = { moves, note };
  const past = [...session.journal.past, entry];
  return {
    composition: applyAct(session.composition, entry, "do"),
    journal: {
      past:
        past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past,
      future: [],
    },
  };
}

export interface SessionStep {
  readonly session: Session;
  /** The act that moved, or `null` when there was nothing to move. */
  readonly act: Act | null;
}

export function undo(session: Session): SessionStep {
  const { past, future } = session.journal;
  if (past.length === 0) return { session, act: null };
  const entry = past[past.length - 1];
  return {
    session: {
      composition: applyAct(session.composition, entry, "undo"),
      journal: { past: past.slice(0, -1), future: [entry, ...future] },
    },
    act: entry,
  };
}

export function redo(session: Session): SessionStep {
  const { past, future } = session.journal;
  if (future.length === 0) return { session, act: null };
  const [entry, ...rest] = future;
  return {
    session: {
      composition: applyAct(session.composition, entry, "do"),
      journal: { past: [...past, entry], future: rest },
    },
    act: entry,
  };
}

// ── refusals ─────────────────────────────────────────────────────────────

/**
 * Why an operation declined.
 *
 * A VALUE and not a thrown error, because every one of these is an ordinary
 * thing for a person to try — pressing a greyed control, painting on a locked
 * layer — and the page answers them in its live region rather than in a stack
 * trace. `said` is a plain sentence so the reason and the wording cannot drift
 * apart; a caller is free to write its own.
 */
export type Refusal =
  | "no-selection"
  | "locked"
  | "hidden"
  | "empty"
  | "at-the-end"
  | "no-parent"
  | "no-neighbour"
  | "into-itself"
  | "unknown-layer"
  | "blank-name";

export interface Refused {
  readonly ok: false;
  readonly why: Refusal;
  readonly said: string;
}

export type Outcome<T> = { readonly ok: true; readonly value: T } | Refused;

const no = (why: Refusal, said: string): Refused => ({ ok: false, why, said });
const yes = <T>(value: T): Outcome<T> => ({ ok: true, value });

// ── selection ────────────────────────────────────────────────────────────

/**
 * Select a layer, or nothing.
 *
 * An id the document does not hold selects NOTHING rather than being ignored:
 * there is exactly one empty selection and a request that names no layer is it.
 * Returns a composition sharing the same `layers` array, so selecting does not
 * cost a recomposite — see `FLAT`.
 */
export function select(comp: Composition, id: LayerId | null): Composition {
  if (id === null) return comp.selected === null ? comp : { ...comp, selected: null };
  const wanted = find(comp, id) === null ? null : id;
  return comp.selected === wanted ? comp : { ...comp, selected: wanted };
}

/** The selected layer, or `null`. The panel's "disabled when none selected". */
export function selectedLayer(comp: Composition): Layer | null {
  return comp.selected === null ? null : find(comp, comp.selected);
}

/** True when a control that needs a selection should be live. */
export const hasSelection = (comp: Composition): boolean =>
  selectedLayer(comp) !== null;

// ── where paint goes ─────────────────────────────────────────────────────

export interface Target {
  readonly layer: Layer;
  readonly path: Path;
}

/**
 * The layer a stroke would land in, or why it would not.
 *
 * REFUSES LOUDLY, and both refusals were chosen against the alternatives:
 *
 *   LOCKED — painting anyway defeats the lock, and there is nothing else the
 *   control could mean. Auto-selecting a different layer is worse than either,
 *   because the paint then lands somewhere real that the person did not choose,
 *   and they find out later.
 *
 *   HIDDEN — painting into a hidden layer works perfectly and shows nothing.
 *   A brush that fires and leaves the canvas unmoved is the single most
 *   confusing thing a drawing program can do; it is the same failure the page
 *   already speaks about when the adjustment brush finds no paint under it, and
 *   it gets the same treatment: say so.
 *
 * Both answers are INHERITED — a layer inside a hidden or locked parent is
 * hidden or locked — and the sentence names the layer so the panel can point at
 * the right row. Exposed as well as used, so the page can grey the brush before
 * the gesture starts rather than after.
 */
export function paintTarget(comp: Composition): Outcome<Target> {
  const layer = selectedLayer(comp);
  if (layer === null) {
    return no("no-selection", "no layer is selected — choose one to paint into");
  }
  const path = pathOf(comp, layer.id);
  if (path === null) {
    return no("unknown-layer", "the selected layer is no longer in the drawing");
  }
  const eff = effectiveOf(comp, layer.id);
  if (eff === null) {
    return no("unknown-layer", "the selected layer is no longer in the drawing");
  }
  if (!eff.editable) {
    return no(
      "locked",
      layer.locked
        ? `${layer.name} is locked — unlock it to paint into it`
        : `${layer.name} is inside a locked layer — unlock the parent to paint into it`
    );
  }
  if (!eff.shown) {
    return no(
      "hidden",
      layer.visible
        ? `${layer.name} is inside a hidden layer — show the parent to paint into it`
        : `${layer.name} is hidden — show it to paint into it`
    );
  }
  return yes({ layer, path });
}

/**
 * Paint into one layer WITHOUT journalling it.
 *
 * The live half of a drag: `page.tsx` applies edit after edit as the pointer
 * moves and commits ONE gesture at the end, exactly as it does today with a
 * plate ref. This is that apply. The commit is `commitPaint`.
 */
export function paintInto(
  comp: Composition,
  id: LayerId,
  edits: readonly PlateEdit[]
): Composition {
  if (edits.length === 0) return comp;
  return applyMove(comp, { kind: "paint", layer: id, stroke: { edits: [...edits] } }, "do");
}

/**
 * Commit a finished gesture into the selected layer.
 *
 * Re-checks the target rather than trusting the caller, so a layer locked
 * mid-drag cannot receive the commit.
 *
 * THE DRAG CONTRACT, spelled out because a caller will get this wrong otherwise:
 * apply each application live with `paintInto` as the pointer moves, accumulate
 * the gesture with `strokes.mergeEdits` exactly as `page.tsx` already does, and
 * hand the merged stroke here at the end. The edits are applied a SECOND time by
 * this call and that is harmless, because `applyEdits` writes `to` outright
 * rather than transforming what it finds — re-applying an edit that has already
 * landed is the identity. So there is no "journal without applying" door to
 * leave open, and no way for the two to fall out of step.
 */
export function commitPaint(
  session: Session,
  stroke: Stroke<Address>,
  note?: string
): Outcome<Session> {
  const target = paintTarget(session.composition);
  if (!target.ok) return target;
  if (stroke.edits.length === 0) return no("empty", "nothing changed");
  const layer = target.value.layer;
  return yes(
    act(
      session,
      [{ kind: "paint", layer: layer.id, stroke }],
      note ?? `painted ${stroke.edits.length} cells on ${layer.name}`
    )
  );
}

// ── the panel's controls ─────────────────────────────────────────────────

/**
 * A new empty layer, above the selection and beside it.
 *
 * BESIDE and not inside: a new layer joins the selected layer's own stack at the
 * position just above it, which is what every layers panel does and what makes
 * repeated presses build a stack rather than a chain. With nothing selected it
 * goes on top of the document.
 *
 * Never refuses. Adding a layer is always possible, including to an empty
 * document, which is the state a person reaches by deleting the last one.
 */
export function addLayer(session: Session, name?: string): Session {
  const comp = session.composition;
  const id = layerId(comp.nextId);
  const node = bare(id, name ?? `Layer ${comp.nextId}`);
  const here = comp.selected === null ? null : pathOf(comp, comp.selected);
  const path: Path =
    here === null ? [comp.layers.length] : [...here.slice(0, -1), here[here.length - 1] + 1];
  const next = act(
    { ...session, composition: { ...comp, nextId: comp.nextId + 1 } },
    [{ kind: "place", op: "insert", at: path, node }],
    `added ${node.name}`
  );
  return { ...next, composition: select(next.composition, id) };
}

/**
 * Delete the selected layer, with everything under it.
 *
 * UNDOABLE, and that is the house rule rather than a nicety: NEW is the only
 * control that destroys anything, so a delete has to be one rung of the journal
 * and the rung has to carry the whole subtree. It does — the `place` move holds
 * the layer value, children, plates and all — so undo puts back the exact tree,
 * at the exact index, with every id it had.
 *
 * The selection moves to the layer that takes its place, then to the one below
 * it, then to the parent, then empty. Something sensible stays selected wherever
 * possible, because the panel's other controls all need a selection.
 */
export function removeLayer(session: Session): Outcome<Session> {
  const comp = session.composition;
  const layer = selectedLayer(comp);
  if (layer === null) {
    return no("no-selection", "no layer is selected — choose one to delete");
  }
  const path = pathOf(comp, layer.id);
  if (path === null) {
    return no("unknown-layer", "the selected layer is no longer in the drawing");
  }
  const siblings = parentStack(comp, path);
  const k = path[path.length - 1];
  const nextSelected: LayerId | null =
    siblings === null
      ? null
      : (siblings[k + 1] ?? siblings[k - 1])?.id ??
        (path.length > 1 ? (at(comp, path.slice(0, -1))?.id ?? null) : null);
  const next = act(
    session,
    [{ kind: "place", op: "remove", at: path, node: layer }],
    `deleted ${layer.name}`
  );
  return yes({ ...next, composition: select(next.composition, nextSelected) });
}

/**
 * Empty the selected layer's plate AND every plate under it, as one act.
 *
 * The subtree and not just the row, because the row's other two controls — hide
 * and lock — already mean the subtree. Three controls on one line that disagreed
 * about what "this layer" is would be three different ideas wearing one costume.
 *
 * Recoverable, by the same house rule as delete: it is one rung carrying one
 * `clearStroke` per plate it empties, and `clearStroke` is `strokes.ts`'s own,
 * so every edit remembers the colour that was there.
 *
 * Refuses on a LOCKED layer, because clearing is editing and that is what the
 * lock is for. Does NOT refuse on a hidden one, and the difference from painting
 * is where the person is looking: a brush stroke is aimed at the picture and the
 * picture has to answer, while this is a button on a named row whose cell count
 * goes to zero in front of them.
 */
export function clearLayer(session: Session): Outcome<Session> {
  const comp = session.composition;
  const layer = selectedLayer(comp);
  if (layer === null) {
    return no("no-selection", "no layer is selected — choose one to clear");
  }
  const eff = effectiveOf(comp, layer.id);
  if (eff !== null && !eff.editable) {
    return no(
      "locked",
      layer.locked
        ? `${layer.name} is locked — unlock it to clear it`
        : `${layer.name} is inside a locked layer — unlock the parent to clear it`
    );
  }
  const moves: Move[] = [];
  let cells = 0;
  const go = (l: Layer): void => {
    if (l.plate.size !== 0) {
      const stroke = clearStroke(l.plate);
      cells += stroke.edits.length;
      moves.push({ kind: "paint", layer: l.id, stroke });
    }
    for (const c of l.children) go(c);
  };
  go(layer);
  if (moves.length === 0) {
    return no("empty", `${layer.name} holds no paint — there is nothing to clear`);
  }
  return yes(act(session, moves, `cleared ${cells} addresses from ${layer.name}`));
}

/**
 * Rename the selected layer.
 *
 * UNDOABLE, unlike the two switches, and the difference is that a rename
 * destroys something: the old name is gone and nobody remembers it. A hidden
 * layer's old state is on the button in front of you; a renamed layer's is not.
 *
 * Trimmed, and a blank name is refused rather than accepted — a row with no name
 * is a row you cannot talk about.
 */
export function renameLayer(
  session: Session,
  id: LayerId,
  name: string
): Outcome<Session> {
  const layer = find(session.composition, id);
  if (layer === null) return no("unknown-layer", "that layer is not in the drawing");
  const to = name.trim();
  if (to.length === 0) return no("blank-name", "a layer needs a name");
  if (to === layer.name) return no("empty", `${layer.name} already has that name`);
  return yes(
    act(
      session,
      [{ kind: "rename", layer: id, from: layer.name, to }],
      `renamed ${layer.name} to ${to}`
    )
  );
}

// ── the switches ─────────────────────────────────────────────────────────

/**
 * Set a layer's OWN visibility. Not journalled; see the header.
 *
 * Descendants keep their own switches untouched, so unhiding restores exactly
 * what was showing before. That is the whole reason `Effective` is computed and
 * never stored.
 */
export function setVisible(
  comp: Composition,
  id: LayerId,
  visible: boolean
): Composition {
  const layers = mapLayer(comp.layers, id, (l) =>
    l.visible === visible ? l : { ...l, visible }
  );
  return layers === comp.layers ? comp : { ...comp, layers };
}

/** Set a layer's OWN lock. Not journalled; see the header. */
export function setLocked(
  comp: Composition,
  id: LayerId,
  locked: boolean
): Composition {
  const layers = mapLayer(comp.layers, id, (l) =>
    l.locked === locked ? l : { ...l, locked }
  );
  return layers === comp.layers ? comp : { ...comp, layers };
}

export const toggleVisible = (comp: Composition, id: LayerId): Composition => {
  const l = find(comp, id);
  return l === null ? comp : setVisible(comp, id, !l.visible);
};

export const toggleLocked = (comp: Composition, id: LayerId): Composition => {
  const l = find(comp, id);
  return l === null ? comp : setLocked(comp, id, !l.locked);
};

// ── arranging ────────────────────────────────────────────────────────────

/** `up` is towards the top of the stack — the end of the array. See `Stack`. */
export type Arrange = "up" | "down";

/**
 * Move the selected layer one place among ITS OWN SIBLINGS. Never reparents.
 *
 * The contract is total and trivially invertible: up then down is the identity,
 * the layer stays where it was in the tree, and the button is greyed at the ends
 * rather than doing something else there. An arrange control that sometimes
 * jumped a layer out of its parent is the version of this people click once and
 * then cannot find their work — so promotion and demotion get their own names,
 * `promote` and `demote`, and the panel binds them to their own controls if it
 * wants them.
 *
 * DECISION, stated because the brief left it open: sibling-only for up/down,
 * with explicit outdent/indent alongside. Two predictable controls and two more
 * that say what they do, rather than two controls whose meaning depends on where
 * the layer happens to be sitting.
 */
export function arrange(session: Session, dir: Arrange): Outcome<Session> {
  const comp = session.composition;
  const layer = selectedLayer(comp);
  if (layer === null) {
    return no("no-selection", `no layer is selected — choose one to move ${dir}`);
  }
  const path = pathOf(comp, layer.id);
  const siblings = path === null ? null : parentStack(comp, path);
  if (path === null || siblings === null) {
    return no("unknown-layer", "the selected layer is no longer in the drawing");
  }
  const k = path[path.length - 1];
  const to = dir === "up" ? k + 1 : k - 1;
  if (to < 0 || to >= siblings.length) {
    return no(
      "at-the-end",
      `${layer.name} is already at the ${dir === "up" ? "top" : "bottom"} of its stack`
    );
  }
  const parent = path.slice(0, -1);
  return yes(
    act(
      session,
      [
        { kind: "place", op: "remove", at: path, node: layer },
        { kind: "place", op: "insert", at: [...parent, to], node: layer },
      ],
      `moved ${layer.name} ${dir}`
    )
  );
}

/** True when `arrange` in this direction would move something. For greying. */
export function canArrange(comp: Composition, dir: Arrange): boolean {
  const layer = selectedLayer(comp);
  if (layer === null) return false;
  const path = pathOf(comp, layer.id);
  const siblings = path === null ? null : parentStack(comp, path);
  if (path === null || siblings === null) return false;
  const to = dir === "up" ? path[path.length - 1] + 1 : path[path.length - 1] - 1;
  return to >= 0 && to < siblings.length;
}

/**
 * Take the selected layer OUT of its parent, to sit just above it.
 *
 * The outdent half of the pair `arrange` deliberately does not do. Refuses at
 * the top level, where there is no parent to come out of.
 */
export function promote(session: Session): Outcome<Session> {
  const comp = session.composition;
  const layer = selectedLayer(comp);
  if (layer === null) return no("no-selection", "no layer is selected");
  const path = pathOf(comp, layer.id);
  if (path === null) {
    return no("unknown-layer", "the selected layer is no longer in the drawing");
  }
  if (path.length < 2) {
    return no("no-parent", `${layer.name} is already at the top level`);
  }
  const parentPath = path.slice(0, -1);
  const to: Path = [...parentPath.slice(0, -1), parentPath[parentPath.length - 1] + 1];
  return yes(
    act(
      session,
      [
        { kind: "place", op: "remove", at: path, node: layer },
        { kind: "place", op: "insert", at: to, node: layer },
      ],
      `moved ${layer.name} out of its parent`
    )
  );
}

/**
 * Put the selected layer INSIDE the sibling below it, as that sibling's topmost
 * child.
 *
 * The indent half. Downwards rather than upwards because the layer is moving
 * under something — it becomes part of the thing it was sitting on — and because
 * the sibling below is the one it was already occluding.
 */
export function demote(session: Session): Outcome<Session> {
  const comp = session.composition;
  const layer = selectedLayer(comp);
  if (layer === null) return no("no-selection", "no layer is selected");
  const path = pathOf(comp, layer.id);
  const siblings = path === null ? null : parentStack(comp, path);
  if (path === null || siblings === null) {
    return no("unknown-layer", "the selected layer is no longer in the drawing");
  }
  const k = path[path.length - 1];
  const host = siblings[k - 1];
  if (host === undefined) {
    return no("no-neighbour", `${layer.name} has nothing below it to move into`);
  }
  // The host keeps its index once this layer is gone, because the host is BELOW
  // it. Working that out here rather than after the removal is why the two
  // moves can be written down in one go.
  const hostPath: Path = [...path.slice(0, -1), k - 1];
  return yes(
    act(
      session,
      [
        { kind: "place", op: "remove", at: path, node: layer },
        {
          kind: "place",
          op: "insert",
          at: [...hostPath, host.children.length],
          node: layer,
        },
      ],
      `moved ${layer.name} into ${host.name}`
    )
  );
}

/**
 * Move a layer anywhere: out of its parent, into another, up or down.
 *
 * The general form the three above are special cases of, exposed because a panel
 * with drag-and-drop needs it.
 *
 * The destination is a PARENT IDENTITY and an index, not a path, and that is the
 * whole reason this signature is not `(id, to: Path)`. A path is measured
 * against a tree, and the tree changes between the removal and the insertion —
 * so a path destination has to say which of the two trees it means, and every
 * answer to that is a trap. Whether "index 2" means "where L5 is now" or "where
 * it will be" is unanswerable, and the version that guesses makes moving a layer
 * one place a silent no-op. An identity does not move, so the parent never needs
 * correcting, and `index` is read against the destination stack once the layer
 * has been taken out of it — which is also how `arrange`, `promote` and `demote`
 * above compute their own. `parent: null` is the top level.
 *
 * REFUSES to move a layer inside itself or inside its own descendant. On
 * immutable trees that would not build a cycle; it would detach the subtree and
 * then insert it into a stack that no longer exists, silently losing everything
 * under it. The test is exact integer prefix comparison on paths taken BEFORE
 * the removal, the same shape `plate.ts` uses for address ancestry.
 */
export function moveLayer(
  session: Session,
  id: LayerId,
  parent: LayerId | null,
  index: number
): Outcome<Session> {
  const comp = session.composition;
  const layer = find(comp, id);
  const from = pathOf(comp, id);
  if (layer === null || from === null) {
    return no("unknown-layer", "that layer is not in the drawing");
  }
  if (parent === id) {
    return no("into-itself", `${layer.name} cannot be moved inside itself`);
  }
  if (parent !== null) {
    const host = pathOf(comp, parent);
    if (host === null) return no("unknown-layer", "that parent is not in the drawing");
    if (coversPath(from, host)) {
      return no("into-itself", `${layer.name} cannot be moved inside itself`);
    }
  }
  // The removal first, so the destination is read off the tree the insertion
  // will actually meet — which is exactly the order `applyAct` replays them in.
  const taken = applyMove(
    comp,
    { kind: "place", op: "remove", at: from, node: layer },
    "do"
  );
  const hostPath = parent === null ? [] : pathOf(taken, parent);
  if (hostPath === null) return no("unknown-layer", "that parent is not in the drawing");
  const host = parent === null ? taken.layers : (at(taken, hostPath)?.children ?? []);
  const k = index < 0 ? 0 : index > host.length ? host.length : index;
  return yes(
    act(
      session,
      [
        { kind: "place", op: "remove", at: from, node: layer },
        { kind: "place", op: "insert", at: [...hostPath, k], node: layer },
      ],
      `moved ${layer.name}`
    )
  );
}

// ── copy and paste ───────────────────────────────────────────────────────

/**
 * The subtree to put on the clipboard, AS STORED.
 *
 * No copy is made here and none is needed: every value in this file is
 * immutable, so the clipboard holding the same object the document holds cannot
 * let one change the other. The fresh ids are minted at PASTE time, which is
 * what lets one copy be pasted many times and give a different subtree each
 * time.
 */
export function copyLayer(comp: Composition, id: LayerId): Layer | null {
  return find(comp, id);
}

/**
 * The whole document as one layer, for the clipboard.
 *
 * This is what makes "paste a composition onto a layer" one operation rather
 * than a special case: a document copied is a layer, a layer pasted is a child,
 * and the depth of what arrives is whatever it was.
 */
export function copyComposition(comp: Composition, name = "Composition"): Layer {
  return graft(comp.layers, name, comp.nextId).layer;
}

/**
 * Paste a subtree ONTO the selected layer, as its topmost child.
 *
 * The graft, in full: what lands is ONE new child whose own children are intact
 * all the way down. Nothing is flattened, nothing is spliced, and no depth limit
 * is imposed — a composition pasted onto a layer that is itself three deep sits
 * at four and works exactly as it did at one.
 *
 * With NOTHING selected it goes on top of the document, which is the only other
 * place it could sensibly go and is what a person means when they paste into an
 * empty panel.
 *
 * Refuses on a locked target, because gaining a child is a change to that layer.
 * Ids are minted fresh for the whole subtree, so pasting twice gives two
 * independent trees; plates are shared by reference and never copied.
 */
export function pasteInto(session: Session, node: Layer): Outcome<Session> {
  const comp = session.composition;
  const host = selectedLayer(comp);
  if (host !== null) {
    const eff = effectiveOf(comp, host.id);
    if (eff !== null && !eff.editable) {
      return no("locked", `${host.name} is locked — unlock it to paste into it`);
    }
  }
  const fresh = reid({ ...node, name: pastedName(node.name) }, comp.nextId);
  const hostPath = host === null ? null : pathOf(comp, host.id);
  const path: Path =
    host === null || hostPath === null
      ? [comp.layers.length]
      : [...hostPath, host.children.length];
  const next = act(
    { ...session, composition: { ...comp, nextId: fresh.nextId } },
    [{ kind: "place", op: "insert", at: path, node: fresh.layer }],
    host === null
      ? `pasted ${fresh.layer.name} on top of the drawing`
      : `pasted ${fresh.layer.name} into ${host.name}`
  );
  return yes({ ...next, composition: select(next.composition, fresh.layer.id) });
}

// ── what a serialiser walks ──────────────────────────────────────────────

/**
 * ONE LAYER, AS A SERIALISER NEEDS IT. Documented as an interface between
 * agents, so read this before changing any field.
 *
 * `slices` returns these in PAINT ORDER — depth-first pre-order, `layers[0]`
 * first, a layer before its own children — which is SVG document order. Emit
 * them in the order given, nesting a layer's children inside its own group, and
 * later elements paint over earlier ones exactly as `flatten` composites them.
 * There is no reversal to remember anywhere.
 *
 *   node        the layer itself, as stored. Immutable; do not copy it.
 *   path        where it sits. `path.length - 1` is `depth`.
 *   depth       0 for a top-level layer. Carried so a writer can indent.
 *   effective   the INHERITED answers. `shown` is what to obey; a layer's own
 *               `visible` is what the panel shows, and they are different when
 *               an ancestor is hidden. Do not read `node.visible` to decide
 *               whether to draw.
 *   colours     every distinct `#rrggbb` in this layer's OWN plate, ascending.
 *               Its children have their own slices with their own colours; use
 *               `subtreeColours` for the union.
 *   addresses   how many addresses this layer's own plate holds, at every depth
 *               it was painted at. NOT the number of cells it draws.
 *
 * To turn a slice into polygons: `resolvePlate(slice.node.plate, book)` gives
 * cell index → colour at the render depth, which is the same map `artworkSvg`
 * already takes as `paint`. Each layer resolves ON ITS OWN — see the header for
 * why merging the plates first is wrong.
 */
export interface LayerSlice {
  readonly node: Layer;
  readonly path: Path;
  readonly depth: number;
  readonly effective: Effective;
  readonly colours: readonly string[];
  readonly addresses: number;
}

/** Every layer as a slice, in paint order. The serialiser's entry point. */
export function slices(comp: Composition): readonly LayerSlice[] {
  return walk(comp).map((v) => ({
    node: v.layer,
    path: v.path,
    depth: v.depth,
    effective: v.effective,
    colours: coloursOf(v.layer),
    addresses: v.layer.plate.size,
  }));
}

/** One layer as a slice, or `null`. */
export function slice(comp: Composition, id: LayerId): LayerSlice | null {
  return slices(comp).find((s) => s.node.id === id) ?? null;
}

/**
 * The distinct colours in ONE layer's own plate, ascending.
 *
 * Sorted so the answer is a function of the plate and not of the order a Map
 * happened to be built in — the same argument `plateEntries` makes about the
 * exported address list. Two identical layers must produce identical files.
 */
export function coloursOf(layer: Layer): readonly string[] {
  return [...new Set(layer.plate.values())].sort();
}

/** The distinct colours in a layer AND everything under it, ascending. */
export function subtreeColours(layer: Layer): readonly string[] {
  const seen = new Set<string>();
  const go = (l: Layer): void => {
    for (const hex of l.plate.values()) seen.add(hex);
    for (const c of l.children) go(c);
  };
  go(layer);
  return [...seen].sort();
}

/** Every colour anywhere in the document, ascending. The file's palette. */
export function paletteOf(comp: Composition): readonly string[] {
  const seen = new Set<string>();
  for (const v of walk(comp)) for (const hex of v.layer.plate.values()) seen.add(hex);
  return [...seen].sort();
}

// ── measurements ─────────────────────────────────────────────────────────

export interface LayerCensus {
  /** Layers anywhere in the tree. */
  total: number;
  /** Layers at the top level. */
  top: number;
  /** The deepest nesting reached. 1 for a flat stack, 0 for no layers. */
  deepest: number;
  /** Layers holding at least one address of their own. */
  painted: number;
  /** Layers whose EFFECTIVE answer is shown. */
  shown: number;
  /** Layers whose EFFECTIVE answer is editable. */
  editable: number;
  /** Addresses across every plate. Not cells drawn; see `flatten` for those. */
  addresses: number;
  /** Ids appearing more than once. Empty, or the drawing has come apart. */
  duplicateIds: LayerId[];
}

/**
 * The tree, counted rather than asserted.
 *
 * Reported in the register of `armCensus` and `depthCensus`: the composition is
 * the authority, and a test that disagrees with it should be believed over a
 * comment. `duplicateIds` is the one entry that should always be empty — ids are
 * minted from a monotone counter and `reid` re-mints a whole pasted subtree — so
 * it is measured rather than trusted.
 */
export function census(comp: Composition): LayerCensus {
  const seen = new Set<string>();
  const dupes = new Set<LayerId>();
  let painted = 0;
  let shown = 0;
  let editable = 0;
  let addresses = 0;
  let deepest = 0;
  const visits = walk(comp);
  for (const v of visits) {
    if (seen.has(v.layer.id)) dupes.add(v.layer.id);
    seen.add(v.layer.id);
    if (v.layer.plate.size > 0) painted += 1;
    if (v.effective.shown) shown += 1;
    if (v.effective.editable) editable += 1;
    addresses += v.layer.plate.size;
    deepest = Math.max(deepest, v.path.length);
  }
  return {
    total: visits.length,
    top: comp.layers.length,
    deepest,
    painted,
    shown,
    editable,
    addresses,
    duplicateIds: [...dupes],
  };
}
