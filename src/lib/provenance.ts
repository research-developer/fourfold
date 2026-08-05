/**
 * The history, read as the provenance index it already is.
 *
 * A gesture in this program is not a cell and not a shape. It is a SYMMETRY
 * APPLIED AT A PLACE: one press paints an orbit, one drag paints a run of them,
 * and `strokes.StrokeMark` records exactly that — the brush mode the hand was
 * holding, and the group of addresses each application carried the seed to. The
 * undo stack therefore already holds, for every committed gesture, the two facts
 * that make a compound path a compound path: WHICH cells belong together, and
 * WHY they belong together. Nothing has to be inferred from the picture.
 *
 * This module turns that record into `emit.EmitLayer`s, because that is the one
 * shape in this codebase which is both addressable in the editor and writable to
 * a file: `serialise` gives every layer an `id`, a `data-mode` and a
 * `data-orbit`, and `parse` gives them back. So "select every 6-fold gesture" is
 * a query over layer ids in the editor AND a selector over `<g>` elements in the
 * exported file, and the two cannot drift, because they are the same tree.
 *
 * PURE. No DOM, no React, no I/O, no clock. Every function here is a function of
 * its arguments, which is what lets the whole module be tested against the real
 * `orbit.ts` machinery rather than against a fixture.
 *
 * ── `orbit` is NOT `mode`, and that is the whole reason it is stored ─────
 *
 * The mode names a SUBGROUP; the orbit is what that subgroup does to one
 * particular cell, and |orbit| = |H| / |Stab| divides |H| rather than equalling
 * it. A seed sitting on a mirror is stabilised and its orbit is short. Measured
 * on the depth-3 hexagon, and reproduced in `test/provenance.test.ts` so the
 * numbers keep having to be true:
 *
 *   whole plate, D6   modes 1, 2, 3, 6 are FREE — every orbit is the full size.
 *                     Mode 12 is not: 8 orbits of 6 and 28 of 12, the short ones
 *                     being the cells on the three sector-spine mirrors.
 *   one sector, D3    mode 6 gives 6 orbits of 1 (the sector hubs), 42 of 3 (the
 *                     m_A median) and 42 of 6. So a 6-fold brush really does
 *                     paint three cells, and sometimes one.
 *
 * A layer that stated `orbit: mode` would therefore be wrong at 132 of the 384
 * seeds of a sector-scoped mode-6 canvas — 6·1 + 42·3 — and wrong in the
 * direction that matters: the pinned gestures are the ones a user goes for,
 * because a stroke that painted three cells when they expected six is the stroke
 * they did not mean to make. `shortOrbits` below is that query.
 *
 * ── What `orbit` does NOT promise ───────────────────────────────────────
 *
 * Two honest limits, stated here rather than discovered later.
 *
 *   A BAND GESTURE'S GROUPS ARE BANDS. When a band family is in play,
 *   `brushStamp` records the IMAGE BANDS rather than the orbit — see
 *   `brush.BrushStamp` — and `StrokeMark` does not say which of the two it
 *   holds. So `orbit` is "the size of the recorded symmetry group", which is the
 *   orbit for a plain brush and the band for a band brush. A band is normally
 *   far longer than the mode, so `shortOrbits` is not confused by one in
 *   practice; a very short band on a shallow canvas would read as pinned, and
 *   there is nothing in the recorded mark that could tell them apart.
 *
 *   `mode` IS NOT ALWAYS THE GROUP ORDER. On the `sector6` brush scope the group
 *   is C6 × D3 of order 6·mode, so at depth 3 mode 3 has orbits of 18 and one of
 *   6 — genuinely pinned, and yet 6 > 3, so the `orbit < mode` test misses it.
 *   The mark records the mode and not the scope, so this module cannot recover
 *   the order by itself. `shortOrbits` therefore takes the order as a parameter,
 *   defaulting to the identity, and a caller that knows the scope passes
 *   `(m) => 6 * m`. Measured in the test alongside everything else.
 *
 * ── ZERO FLOAT ─────────────────────────────────────────────────────────
 *
 * Nothing here does arithmetic on a coordinate. Cells arrive as indices already
 * chosen by exact integer key lookup upstream; addresses are words and ancestry
 * is string prefixing. The only numbers this module computes are counts.
 */

import { MAX_LAYERS, LAYER_ID } from "./artfile";
import type { EmitAnimation, EmitLayer } from "./emit";
import {
  addressDepth,
  ancestorAt,
  type Address,
  type AddressBook,
} from "./plate";
import { animationTiming, markLookup } from "./replay";
import type { History, Stroke } from "./strokes";

/** What this module needs of an address book: the two directions, and the stem. */
export type ProvenanceBook = Pick<
  AddressBook,
  "addr" | "index" | "stem" | "depth"
>;

/**
 * Where a gesture's cells go when the gesture applied its brush more than once.
 *
 * ── The decision, and why ────────────────────────────────────────────────
 *
 * A drag records MANY groups — one per application that changed something — and
 * they are not interchangeable: a drag that crosses a mirror has applications of
 * different orbit sizes in it. `EmitLayer.orbit` is ONE NUMBER, so a flat layer
 * for such a gesture has to pick one of them, and every choice is a lie about
 * the others. That is the argument, and it is a measurement rather than a taste:
 * `test/provenance.test.ts` drags a sector-scoped 6-fold brush from `s0:AAA`
 * (orbit 3, pinned on the median) to a generic cell (orbit 6) and gets both
 * sizes inside one gesture.
 *
 * `auto` is therefore: ONE LAYER when every recorded group has the same size,
 * because then the one number is true of all of them and a tree would add nodes
 * without adding an answer to any question this module can ask; a PARENT WITH
 * ONE CHILD PER GROUP when the sizes disagree, because that is the smallest
 * structure that can state both.
 *
 * The invariant it buys is worth naming: EVERY LAYER THAT STATES AN `orbit`
 * STATES ONE THAT IS TRUE OF EVERY GROUP UNDER IT. A parent whose children
 * disagree states `mode` and no `orbit`, and says so rather than averaging.
 *
 * ── Why `auto` and not always nesting ───────────────────────────────────
 *
 * Node count, and it is a portability limit rather than a preference.
 * `artfile.MAX_LAYERS` is 8192 nodes for the whole composition and a file past
 * it is REFUSED on load, not truncated. `HISTORY_LIMIT` is 256 gestures and a
 * single drag across a depth-5 plate can apply the brush hundreds of times, so
 * one child per application would put an ordinary session over the cap and make
 * the file unloadable — the exact opposite of the portability this module is
 * for. Under `auto` a uniform drag is one node however long it is.
 *
 * `always` is the escape hatch for a caller that genuinely wants every orbit
 * separately addressable and knows its history is short. It still emits a flat
 * layer for a gesture with a single group, because the child would hold exactly
 * what the parent holds. `never` is the flat form throughout, and states `orbit`
 * only when it can do so truthfully.
 */
export type GestureNesting = "auto" | "always" | "never";

export interface GestureOptions {
  /**
   * The stem of every layer id: `g0`, `g1`, and `g0-o1` for a sub-orbit.
   *
   * Sanitised rather than trusted, because an id that is not an XML name is a
   * document `parse` refuses and a caller who passed one would find out at load
   * time. A prefix that cannot produce a legal id falls back to `g`.
   */
  prefix?: string;
  nest?: GestureNesting;
  /**
   * Whether a layer carries `reveal`. Default true: the index in the history IS
   * the order the drawing was made, which is what an animated export replays.
   *
   * Children never carry one. A child sits inside its gesture's `<g>`, which is
   * already the element the reveal animation is on, so a second `data-reveal`
   * would be an identical animation applied twice — more bytes, same picture.
   */
  reveal?: boolean;
  /**
   * The colour to DRAW an erase in, or absent to leave erases unpainted.
   *
   * An erase sets a cell to nothing and `EmitLayer.paint` is a map of colours
   * with no spelling for absence, so by default an erase contributes no entry
   * and the stack shows the colour the gesture removed. That is the honest
   * rendering of "what this gesture PAINTED" and it is the wrong rendering of
   * "what the drawing looks like": a stack of layers is drawn one over the next
   * and nothing later can take a shape away.
   *
   * Supplying the document's own unpainted fill makes every layer ADDITIVE, so
   * the last layer to name a cell decides its colour and the stack draws the
   * plate. `replay.animationSteps` takes the same argument for the same reason
   * and says so in the same words — "an ERASE is drawn in the unpainted fill
   * rather than removed" — and this is that rule for the still export.
   *
   * Off by default, because it changes what a layer CLAIMS: with it, a layer
   * carries cells whose colour the gesture did not choose, and a reader counting
   * painted cells per gesture would count them. The caller that wants a faithful
   * picture asks for one; the caller that wants a faithful record does not.
   */
  unpainted?: string;
}

const DEFAULT_PREFIX = "g";

/**
 * A prefix that can actually produce an id `serialise` will write.
 *
 * The probe is the id this prefix would MINT — `g0`, `sym0` — and not the prefix
 * itself, because that is the string the file has to carry and `LAYER_ID` is the
 * rule it has to satisfy.
 *
 * IT DOES NOT TEST `RESERVED_IDS`, and used to. That test could not fail: every
 * id this function can produce ends in a digit and no reserved id does — the set
 * is `u`, `d`, `tiling`, `paint`. A check that cannot fail is worse than no check,
 * because it reads as a guarantee that something is being enforced. The reserved
 * ids are enforced where it is possible for them to collide, at `artfile`'s
 * validator and at `emit.prototypeId`, which is also where `artfile`'s own note
 * says uniqueness lives.
 */
function prefixOf(raw: string | undefined): string {
  if (raw === undefined || raw.length === 0 || raw.length > 32) return DEFAULT_PREFIX;
  if (!LAYER_ID.test(`${raw}0`)) return DEFAULT_PREFIX;
  return raw;
}

/**
 * Which cells of THIS book an address names.
 *
 * A gesture is recorded at whatever depth it was made at, and the book is at
 * whatever depth is being written out; the two need not agree, and `plate.ts`
 * already fixes the meaning of the mismatch. This is the same three rules, for
 * one address at a time:
 *
 *   same depth   the cell itself.
 *   deeper       the cell that CONTAINS it — its ancestor at the book's depth.
 *                A finer gesture than the picture can show still shows, coarsely,
 *                which is what "shallowing is a summary rather than a loss"
 *                means in `plate.ts`.
 *   shallower    every cell it COVERS. A coarse gesture is a region, and drawing
 *                it as one cell would put the paint somewhere it never was.
 *
 * The shallow case is the only one that needs a table, so the table is built at
 * most once per call and only when a shallow address actually turns up. Most
 * histories never build it.
 */
function addressResolver(book: ProvenanceBook): (a: Address) => readonly number[] {
  let covered: Map<Address, number[]> | null = null;
  const buildCovered = (): Map<Address, number[]> => {
    const out = new Map<Address, number[]>();
    for (let i = 0; i < book.addr.length; i++) {
      const a = book.addr[i];
      for (let k = 1; k < book.depth; k++) {
        const p = ancestorAt(a, book.stem, k);
        const list = out.get(p);
        if (list === undefined) out.set(p, [i]);
        else list.push(i);
      }
    }
    return out;
  };
  return (a) => {
    const d = addressDepth(a, book.stem);
    if (d === book.depth) {
      const i = book.index.get(a);
      return i === undefined ? [] : [i];
    }
    if (d > book.depth) {
      const i = book.index.get(ancestorAt(a, book.stem, book.depth));
      return i === undefined ? [] : [i];
    }
    if (covered === null) covered = buildCovered();
    return covered.get(a) ?? [];
  };
}

/**
 * The committed gestures of a history, one `EmitLayer` each.
 *
 * `history` may be the `History` itself or just its `past`. Only the past is
 * read: the future is a redo branch, and a drawing that has not been redone into
 * does not contain it. Handing the whole history in is allowed because that is
 * what a caller holds, and taking `past` is allowed because that is what the
 * animated export already walks.
 *
 * Each layer states, in the file as well as in the editor:
 *
 *   reveal   its index in the history, so an animated export plays the drawing
 *            back in the order it was drawn. Index, not timestamp: the history
 *            has an order and no clock, and inventing one would be a fact about
 *            the export rather than about the drawing.
 *   mode     the recorded brush symmetry, and NOTHING when the stroke carried no
 *            mark. A preset, a revert and a loaded file are all real gestures
 *            with no symmetry to claim, and a layer that answered `mode: 1` for
 *            them would be indistinguishable from a genuine one-fold stroke —
 *            which is a different statement, and a false one.
 *   orbit    the size of the recorded group, which is the REALISED orbit and not
 *            the mode. See the header.
 *   paint    the cells this gesture SET, resolved to the book's depth.
 *
 * ── Erases paint nothing, and are still gestures ────────────────────────
 *
 * An edit to `null` is a cell made unpainted, and `EmitLayer.paint` is a map of
 * colours with no spelling for absence, so by default an erase contributes no
 * entry. Such a gesture still becomes a layer, still carries its `mode` and its
 * `orbit`, and still holds its place in the reveal order — it happened, and the
 * provenance of a removal is provenance. What it does not do is invent a colour
 * to represent itself with. `GestureOptions.unpainted` is how a caller asks it
 * to, and the paragraph below is why that option had to exist.
 *
 * ── The tree is a rendering of the history, not a second copy of the plate ──
 *
 * Within a gesture, a deeper edit wins over a shallower one for the same cell.
 * That is not a rule invented here: `mergeEdits` orders a stroke's edits by
 * address, a descendant sorts after the ancestor it extends, and the later write
 * lands — which is exactly the precedence `plate.resolvePlate` gives them, EXACT
 * over ANCESTOR. Across gestures, a later gesture sits later in the stack and
 * `emit.flatten` takes the last writer.
 *
 * SO THE STACK RESOLVES TO THE PLATE — WITH ONE EXCEPTION, AND IT USED TO BE
 * WRITTEN HERE AS THOUGH THERE WERE NONE. An ERASE removes a colour and a layer
 * stack has no way to remove anything: paint a 3-cell orbit and erase the same
 * seed, and `flatten` reports three painted cells where `resolvePlate` reports
 * none. The old sentence claimed the equality outright and cited a test that
 * could not have caught it, because every gesture in that test was a paint.
 *
 * Both halves are now stated and both are measured in `test/provenance.test.ts`:
 * with `unpainted` supplied the stack DRAWS the plate, cell for cell, an erased
 * cell carrying the document's own unpainted fill exactly as `replay.ts` draws
 * it; without it the stack is the record of what each gesture PAINTED, an
 * erased cell keeps the colour its erase took away, and the inequality is
 * asserted rather than described.
 */
export function gestureLayers(
  history: History<Address> | readonly Stroke<Address>[],
  book: ProvenanceBook,
  options: GestureOptions = {}
): EmitLayer[] {
  const past: readonly Stroke<Address>[] = Array.isArray(history)
    ? (history as readonly Stroke<Address>[])
    : (history as History<Address>).past;
  const prefix = prefixOf(options.prefix);
  const nest: GestureNesting = options.nest ?? "auto";
  const withReveal = options.reveal ?? true;
  const unpainted = options.unpainted;
  const cellsOf = addressResolver(book);

  const out: EmitLayer[] = [];
  past.forEach((stroke, k) => {
    const mark = stroke.mark;
    const id = `${prefix}${k}`;

    // What the gesture set, at this book's depth. `to === null` is an erase and
    // has no colour to record — unless the caller supplied one to draw it in,
    // which is what makes the stack additive. See `GestureOptions.unpainted`.
    const painted = new Map<number, string>();
    for (const e of stroke.edits) {
      const to = e.to ?? unpainted;
      if (to === undefined) continue;
      for (const i of cellsOf(e.cell)) painted.set(i, to);
    }

    // Which recorded group each painted cell belongs to. `markLookup` is
    // `replay.ts`'s, deliberately: it is the bridge from an address-keyed mark
    // to an index-keyed picture, it already handles a cell inheriting the group
    // of its nearest recorded ancestor, and a second implementation of it here
    // would be a second thing to keep in step. It answers −1 for an unmarked
    // stroke and for a cell no group claims.
    const groupOf = markLookup(mark, book);
    const bins = new Map<number, Map<number, string>>();
    const residual = new Map<number, string>();
    for (const [i, colour] of painted) {
      const g = groupOf(i);
      if (g < 0) {
        residual.set(i, colour);
        continue;
      }
      const bin = bins.get(g);
      if (bin === undefined) bins.set(g, new Map([[i, colour]]));
      else bin.set(i, colour);
    }

    // The sizes are read off the RECORDED groups rather than off the bins: a
    // group whose cells were all no-ops still happened, and its size is still a
    // fact about the symmetry.
    //
    // NOT filtered. An empty group cannot claim a cell, so it contributes no
    // size and no child — but the list must stay index-aligned with the one
    // `markLookup` numbered, or a child would state the size of the wrong orbit.
    // The recorder never pushes an empty group; this is what makes that a
    // convenience rather than a requirement.
    const groups = mark?.groups ?? [];
    const sizes = new Set<number>();
    let stated = 0;
    for (const g of groups) {
      if (g.length === 0) continue;
      sizes.add(g.length);
      stated += 1;
    }
    const uniform = sizes.size === 1 ? ([...sizes][0] as number) : null;
    // `bins.size > 1`, and the `> 0` it replaced was the bug. `stated` counts the
    // RECORDED groups and `bins` counts the ones that actually claimed a painted
    // cell, and the two differ whenever a group's cells were all no-ops — a
    // second seed landing on an orbit the first already painted, which is what
    // half of a propose-mode drag is. At `> 0` a gesture with two recorded groups
    // and one claiming bin produced a parent holding nothing and ONE child
    // holding everything: exactly the redundant node the `always` rule declines
    // to emit for a single group, on exactly the same argument — "the child would
    // hold what the parent holds". It cost a node against the `MAX_LAYERS` budget
    // that `auto` exists to protect and gave nothing back.
    //
    // The `orbit` a flat layer states is still `uniform`, read off every RECORDED
    // group, and is deliberately not re-read off the one surviving bin. The
    // invariant in the header is a statement about the GESTURE — "true of every
    // group under it" — and a gesture whose groups were 1 and 3 is not a
    // one-orbit gesture just because the 3 painted nothing this time.
    const split =
      stated > 1 &&
      bins.size > 1 &&
      (nest === "always" || (nest === "auto" && uniform === null));

    const layer: EmitLayer = { id };
    if (withReveal) layer.reveal = k;
    if (mark !== undefined) layer.mode = mark.mode;
    if (!split && uniform !== null) layer.orbit = uniform;
    layer.name = nameOf(k, mark?.mode, split ? null : uniform, split ? bins.size : 0);

    if (!split) {
      if (painted.size > 0) layer.paint = painted;
      out.push(layer);
      return;
    }

    // Nested. The parent keeps only what no group claimed — the plate's own
    // clearing and splitting writes, which are consequences of the gesture and
    // not part of any orbit — and the groups become children in the order the
    // brush applied them. The two sets are disjoint by construction, so the
    // parent painting before its children cannot cover them.
    if (residual.size > 0) layer.paint = residual;
    const children: EmitLayer[] = [];
    const order = [...bins.keys()].sort((a, b) => a - b);
    order.forEach((g, n) => {
      const paint = bins.get(g) as Map<number, string>;
      const child: EmitLayer = {
        id: `${id}-o${n}`,
        // THE DRAWN COUNT, and it is not `groups[g].length`. That length counts
        // ADDRESSES in the mark, at the depth the gesture was made; this counts
        // the cells of THIS BOOK the child actually paints, and `addressResolver`
        // makes the two differ whenever the depths differ — a shallow address
        // covers four cells at the next depth down, so a name reading "1 cells"
        // used to sit on a layer holding four `<use>` elements. Names are written
        // for a reader that is not this program, which is the whole argument for
        // spending 8% of the file on them; a count that disagrees with what the
        // reader can see spends it on a lie. `orbit` below still states the
        // symmetry's own number, so the two facts are both present and neither
        // is pretending to be the other.
        name: `orbit ${n + 1} of ${order.length} · ${plural(paint.size, "cell")}`,
        paint,
      };
      if (mark !== undefined) child.mode = mark.mode;
      child.orbit = groups[g].length;
      children.push(child);
    });
    layer.children = children;
    out.push(layer);
  });
  return out;
}

/**
 * What a layer calls itself.
 *
 * A file is read by people as well as by this program, and `g7` on its own is an
 * id rather than provenance. The sentence says what the gesture WAS, in the same
 * words the panel would use.
 *
 * MEASURED, not waved through. Forty gestures on a depth-3 hexagon cost 3437
 * bytes for their names — 86 a gesture, because the name is written twice, as
 * `data-name` in the markup and again in the payload — which is 8% of that
 * 42.6 kB document. Gzipped it is 329 bytes, 8 a gesture and a tenth of the raw
 * cost, because every name is built from the same handful of words. Depth 3 is
 * the small end, so 8% is the worst case rather than the typical one.
 *
 * Worth it at that price: the alternative is a file whose provenance can only be
 * read by the program that wrote it. `test/provenance.test.ts` measures it.
 */
function nameOf(
  k: number,
  mode: number | undefined,
  orbit: number | null,
  parts: number
): string {
  const head = `gesture ${k + 1}`;
  if (mode === undefined) return `${head} · no recorded symmetry`;
  if (parts > 0) return `${head} · ${mode}-fold · ${plural(parts, "orbit")}`;
  if (orbit === null) return `${head} · ${mode}-fold`;
  return `${head} · ${mode}-fold · orbit ${orbit}`;
}

/**
 * `1 cell`, `2 cells`. Written out here rather than imported, because the one
 * other copy in this codebase is a local inside `emit.describeDoc` and exporting
 * it would make a sentence-building detail part of that module's interface.
 */
const plural = (n: number, word: string): string =>
  `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * The timing an animated export of `steps` gesture layers wants.
 *
 * Derived rather than chosen, so the `steps` in the file cannot disagree with
 * the number of reveals the layers actually carry — a mismatch that shows up as
 * a replay that pauses on nothing, or that restarts before it has finished.
 * The fade and the hold come from `replay.animationTiming`, which is where the
 * argument for scaling both with the step length is written down.
 *
 * Clamped to what `artfile`'s validator accepts, so a document built from this
 * is a document that loads back.
 */
export function gestureAnimation(steps: number, stepMs: number): EmitAnimation {
  const n = Math.min(MAX_LAYERS, Math.max(0, Math.floor(steps) || 0));
  const step = Math.max(1, Math.min(3_600_000, Math.floor(stepMs) || 1));
  const t = animationTiming(step, n);
  return { stepMs: step, holdMs: t.holdMs, fadeMs: t.fadeMs, steps: n };
}

// ── selection by symmetry: the compound-path query ───────────────────────

/**
 * The ids of every layer of the tree the predicate accepts.
 *
 * ID-BASED and not index-based, which is the difference between a selection that
 * survives an edit and one that silently means something else after a layer is
 * moved. Recursive over `children`, and total: a predicate is asked about every
 * layer, a tree with nothing to match returns an empty set, and nothing here
 * throws.
 *
 * A parent matching does NOT pull its children in. Selecting a gesture and
 * selecting the orbits inside it are different selections, and a caller that
 * wants the subtree has `emit.findLayer` and `emit.idsOf` for it.
 */
export function select(
  layers: readonly EmitLayer[],
  pred: (layer: EmitLayer) => boolean
): Set<string> {
  const out = new Set<string>();
  const walk = (list: readonly EmitLayer[]) => {
    for (const l of list) {
      if (pred(l)) out.add(l.id);
      if (l.children !== undefined) walk(l.children);
    }
  };
  walk(layers);
  return out;
}

/** Every layer made under a given brush symmetry. */
export function byMode(layers: readonly EmitLayer[], mode: number): Set<string> {
  return select(layers, (l) => l.mode === mode);
}

/**
 * The pinned ones: every layer whose realised orbit is SHORT for its mode.
 *
 * This is the "find the ones I might not want" query, and it is the reason
 * `orbit` is stored next to `mode` rather than derived from it. A short orbit
 * means the seed had a non-trivial stabiliser — it sat on a mirror, or on the
 * hub — so the brush painted fewer cells than the symmetry names, which is
 * exactly the stroke that looks wrong on the plate and cannot be found by
 * looking at the colours.
 *
 * `orderOf` exists because `mode` is not always the group's ORDER: on the
 * `sector6` scope the group is C6 × D3 of order 6·mode, so a genuinely pinned
 * cell there can have an orbit LONGER than its mode and go unfound. The mark
 * does not record the scope, so this cannot be recovered here; a caller that
 * knows it passes the order. The default is the identity, which is right for
 * every whole-plate and sector-local brush.
 *
 * A layer that states no `mode`, or no `orbit`, is not a candidate: it has made
 * no claim that could be short. So a tree with no marks anywhere answers with
 * the empty set rather than with an error or with everything.
 */
export function shortOrbits(
  layers: readonly EmitLayer[],
  orderOf: (mode: number) => number = (m) => m
): Set<string> {
  return select(
    layers,
    (l) =>
      l.mode !== undefined && l.orbit !== undefined && l.orbit < orderOf(l.mode)
  );
}

/**
 * Every layer with no recorded symmetry at all.
 *
 * Defined on the FIELD and not on some notion of what a gesture layer is: a
 * layer states a mode or it does not. So this finds the unmarked gestures — a
 * preset, a revert, a loaded file — and it also finds an ordinary hand-built
 * layer that was never a gesture, which is the correct answer to "which of these
 * carries no symmetry I can address". On a tree with no marks anywhere it
 * returns every id, which is likewise the true answer to that question.
 */
export function unmarked(layers: readonly EmitLayer[]): Set<string> {
  return select(layers, (l) => l.mode === undefined);
}

/** Every id in the tree that is not in `ids`. The complement of any query. */
export function complement(
  layers: readonly EmitLayer[],
  ids: ReadonlySet<string>
): Set<string> {
  return select(layers, (l) => !ids.has(l.id));
}

// ── measurements ─────────────────────────────────────────────────────────

export interface ProvenanceCensus {
  /** Every layer of the tree, parents and children alike. */
  layers: number;
  /** Of those, how many state a mode. */
  marked: number;
  /** Of those, how many state an orbit shorter than their mode. */
  short: number;
  /** How many layers each mode holds, ascending by mode. */
  modes: Map<number, number>;
  /** How many layers each realised orbit size holds, ascending by size. */
  orbits: Map<number, number>;
}

/**
 * What the tree says about itself, in numbers.
 *
 * For the panel — "34 layers, 31 marked, 4 pinned" is the sentence that makes a
 * composition's provenance legible before anything is selected — and for the
 * tests, which assert against measurements rather than against a description of
 * them. Nothing here decides anything; it counts.
 */
export function provenanceCensus(
  layers: readonly EmitLayer[],
  orderOf: (mode: number) => number = (m) => m
): ProvenanceCensus {
  const modes = new Map<number, number>();
  const orbits = new Map<number, number>();
  let count = 0;
  let marked = 0;
  let short = 0;
  const walk = (list: readonly EmitLayer[]) => {
    for (const l of list) {
      count += 1;
      if (l.mode !== undefined) {
        marked += 1;
        modes.set(l.mode, (modes.get(l.mode) ?? 0) + 1);
        if (l.orbit !== undefined && l.orbit < orderOf(l.mode)) short += 1;
      }
      if (l.orbit !== undefined) orbits.set(l.orbit, (orbits.get(l.orbit) ?? 0) + 1);
      if (l.children !== undefined) walk(l.children);
    }
  };
  walk(layers);
  return {
    layers: count,
    marked,
    short,
    modes: new Map([...modes].sort((a, b) => a[0] - b[0])),
    orbits: new Map([...orbits].sort((a, b) => a[0] - b[0])),
  };
}
