/**
 * Drilling in: one stack for "which thing am I working inside".
 *
 * The program already had TWO ways to narrow what you are working on, invented
 * separately and shaped differently:
 *
 *   viewMode  "hexagon" | "sector"   framing — which cells are on screen
 *   Isolation  Arm | null            masking — which cells the brush may touch
 *
 * They nest — hexagon, then sector, then arm — and `arms.ts` says so in as many
 * words at `armMaskOver`: *"That is what makes the isolation control nest —
 * hexagon, then sector, then arm — without a second notion of an arm."* The
 * nesting was designed for. It was never WRITTEN DOWN as one object, so each
 * level got its own state, its own control, and its own set of places to forget
 * it, and a third level could not be added without a third of everything.
 *
 * This module is that object. A `FocusPath` is the path from the whole figure to
 * the thing you are inside, and every question the UI asks — what is dimmed,
 * where may I click, what does double-tapping here do, what group is the brush
 * using — is a function of it.
 *
 * ── Kind-agnostic on purpose, because layers and gestures are coming ────
 *
 * Nothing below knows what a sector IS. A step is a `kind` and an `id`, and the
 * meaning of a kind arrives as a `FocusResolver` the caller supplies. That is
 * not speculative generality: the request that prompted this module said the
 * mechanism would later address individual LAYERS, and the request that
 * prompted the second pass said it would address individual GESTURES so a
 * filmstrip or the layers panel could drive it. Neither is a region of the
 * plate. A design that hard-coded "a focus step is a set of cells" would have
 * had to be rewritten to hold either.
 *
 * So the algebra here (push, pop, ancestry, truncation) is total and pure, and
 * the only domain knowledge is in the resolvers, which live beside the thing
 * they resolve.
 *
 * ── THREE masks, not one, and not two ───────────────────────────────────
 *
 * The obvious implementation is one mask: "the cells I am focused on", used for
 * everything. The first version of this file had two. It needs three, and each
 * split was forced by a case that the merged version got visibly wrong.
 *
 *   holdMask   WHICH CELLS THE PATH NAMES. For the display: dimming, framing,
 *              zooming, "flash the thing I just selected". Every step with a
 *              resolver contributes, whether or not it restricts the pointer,
 *              because a thing you are inside is a thing you can point at on
 *              screen even when it is not a place you may click.
 *
 *   seedMask   WHERE A POINTER MAY LAND. Only steps that declare `masks`
 *              (the default) narrow it. This is what isolation means to the
 *              hand: inside the thing, the outside is inert. Illustrator's
 *              isolation mode is exactly this — the rest of the artwork stays
 *              visible and stops being selectable.
 *
 *   clipMask   WHAT TRIMS THE STAMP after the brush has computed its orbit.
 *              ARMS ONLY, and that is not an omission. `arms.ts` chose orbit
 *              clipping deliberately and measured what it costs (inside an
 *              isolated arm, mode 3 paints what mode 1 paints and mode 6 what
 *              mode 2 paints — the induced action of the stabiliser ⟨m_D⟩).
 *              Sectors do not appear here because the sector SCOPE already
 *              confines its own orbit: `orbit.ts` gives that surface one region
 *              per sector, so confinement is exact before this module is asked.
 *
 * ── The case that proves seed ≠ clip: `sector6` ─────────────────────────
 *
 * `sector6` is the group C6 × D3 — one sector's D3, repeated in ALL SIX sectors
 * (`orbit.ts`). Its entire purpose is that a stroke made in one sector lands in
 * the other five as well. If the focus mask clipped paint to the focused sector,
 * a `sector6` brush inside an isolated sector would paint exactly what `sector`
 * paints, and the toggle that selects it would be a control that does nothing.
 *
 * Adding a sector to `clipMask` would therefore be redundant at best and, at
 * `sector6`, actively wrong. `test/focus.test.ts` asserts it as a PROPERTY — a
 * `sector6` stroke seeded inside an isolated sector reaches all six sectors —
 * rather than as this paragraph.
 *
 * ── The case that proves hold ≠ seed: a layer is a WRITE TARGET ─────────
 *
 * This was a real bug in the first version of this file and it broke drilling in
 * completely, so it is written down rather than quietly fixed.
 *
 * A layer holds the cells it paints. A FRESH layer paints none, and a HIDDEN
 * layer contributes none. Under a single mask, `seedMask` on the path `[layer
 * L]` was therefore FALSE AT EVERY CELL, so `gestureFor` read every double-tap
 * as landing outside the focus and answered `exit`. You could never stay inside
 * a layer you had just created — which is precisely the layer you need to be
 * inside — and you could never work inside a hidden one at all.
 *
 * The diagnosis is not "empty is a special case". It is that A LAYER IS NOT A
 * REGION. It is a sheet you write ON; the plate underneath it is the whole
 * plate, and where the hand may go is a fact about the plate. So a layer step
 * declares `masks: false` and takes no part in `seedMask` — while still
 * answering `holds` honestly, so `holdMask` can dim or frame the cells the layer
 * actually carries. The same reasoning applies verbatim to a gesture, and to
 * anything else that is addressable without being somewhere.
 *
 * THE CONSEQUENCE, stated rather than discovered: a step that does not mask
 * cannot be LEFT by a canvas gesture, because there is no "outside it" to tap.
 * `gestureFor` on `[layer L]` never answers `exit`, whatever cell is tapped.
 * That is correct and not a gap — you leave a layer by selecting another one in
 * the panel, or by clicking the breadcrumb, which is `exit`/`exitTo` called
 * directly. A double-tap on the canvas is a question about the PLATE, and the
 * plate has nothing to say about which sheet you are drawing on.
 *
 * ── What double-tapping outside does ────────────────────────────────────
 *
 * `exit` pops ONE level, not all of them. Illustrator's isolation mode goes up
 * one container per double-click outside, and the reason is that the alternative
 * cannot express "leave this arm but stay in this sector" — a gesture that
 * dropped you to the root would make a three-level stack a two-level one in
 * practice, because the middle level would be unreachable except by re-entering
 * from scratch.
 */

import { armOfWord, type Arm } from "./arms";
import type { EmitLayer } from "./emit";
import type { BrushScope } from "./orbit";
import { shortOrbits } from "./provenance";

// ── the step, and the path ───────────────────────────────────────────────

/**
 * What kind of thing a focus step names.
 *
 * A string union rather than an open string, because an unknown kind is a bug
 * and should not typecheck. Extending it is the one edit a new focusable thing
 * requires here — everything else it needs lives in its own resolver.
 */
export type FocusKind = "sector" | "arm" | "layer" | "gesture";

/**
 * One step of the path: a kind, and which one.
 *
 * `id` is a STRING for every kind, including sectors, whose natural spelling is
 * an integer 0..5. Two reasons, both practical rather than tidy. A path is
 * compared, keyed and round-tripped as data, and a heterogeneous id type turns
 * every one of those into a discriminated union at the use site. And the file
 * format already spells layer ids as strings (`artfile.LAYER_ID`), so a mixed
 * scheme would need converting exactly at the boundary where layers arrive —
 * which is the boundary this module exists to make uneventful.
 *
 * A `gesture` step's id names a SET; see `gestureStep`. That is the one kind
 * whose id is not simply the id of a thing, and it is canonical, so the whole
 * algebra below keeps working on it unchanged.
 *
 * The constructors below are the only things that should be writing this
 * literal.
 */
export interface FocusStep {
  kind: FocusKind;
  id: string;
}

/**
 * The path from the whole figure to what you are inside. Empty is the root.
 *
 * Readonly, and every operation returns a new one. The path is React state and
 * an in-place push would be a mutation the renderer cannot see.
 */
export type FocusPath = readonly FocusStep[];

export const ROOT: FocusPath = [];

export const sectorStep = (s: number): FocusStep => ({
  kind: "sector",
  id: String(s),
});

export const armStep = (a: Arm): FocusStep => ({ kind: "arm", id: a });

export const layerStep = (id: string): FocusStep => ({ kind: "layer", id });

/**
 * The separator inside a gesture step's id.
 *
 * A comma, because `artfile.LAYER_ID` is `/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/` —
 * no comma can occur in a layer id, so the spelling is unambiguous and parsing
 * is a `split` rather than an escaping scheme.
 */
const GESTURE_SEP = ",";

/**
 * A focus on a SET of gestures, as ONE step.
 *
 * ── Why a set is one step and not many ──────────────────────────────────
 *
 * The motivating request is "show me every 6-fold gesture", and that is a set of
 * gestures rather than a chain of them. A path is a chain of CONTAINMENT — each
 * step is inside the one before — and six unrelated 6-fold strokes are not
 * inside one another, so pushing one step per gesture would spell a selection as
 * a nesting and every one of `enter`/`exit`/`isAncestor` would then mean
 * something false about it. One step, holding the whole selection, is the
 * smallest thing that says what was actually selected.
 *
 * A single gesture is the one-element case and gets no special spelling, which
 * is what lets a filmstrip (one gesture at a time) and the layers panel (a
 * query returning many) drive the same mechanism with no second code path.
 *
 * ── Canonical, and why that matters more than it looks ──────────────────
 *
 * Sorted and deduplicated, so two selections holding the same gestures produce
 * the SAME STRING. Everything in the algebra below compares steps by `kind` and
 * `id` alone, so canonicity is what makes it all keep working on sets for free:
 * re-selecting the same set is `enter`'s identity case rather than a second
 * copy of it, `samePath` decides selection equality, and `isAncestor` decides
 * whether a breadcrumb still names where you are. None of those needed a line of
 * new code.
 *
 * NESTING A GESTURE STEP INSIDE ANOTHER IS MEANINGFUL, unlike nesting two
 * sectors: `[gesture {g0,g1,g2}, gesture {g1}]` is drilling from a selection
 * into part of it, and `holdMask` intersects the steps, so it names exactly
 * `{g1}`. Nothing here polices which kinds may repeat, because the algebra
 * cannot know: repetition is refinement for gestures and for layers, and
 * nonsense for sectors and arms. See `enter`.
 *
 * THE EMPTY SET IS LEGAL and names no cells. A query that matched nothing is a
 * real answer, and a focus that reported it by throwing, or by silently
 * becoming the root, would be a control that lied about its own result.
 */
export function gestureStep(ids: Iterable<string>): FocusStep {
  const seen = new Set<string>();
  for (const id of ids) if (id.length > 0) seen.add(id);
  return { kind: "gesture", id: [...seen].sort().join(GESTURE_SEP) };
}

/** The gesture ids a step names, canonical order. Empty for an empty set. */
export function gestureIds(step: FocusStep): string[] {
  if (step.kind !== "gesture" || step.id.length === 0) return [];
  return step.id.split(GESTURE_SEP);
}

// ── the algebra ──────────────────────────────────────────────────────────

export const sameStep = (a: FocusStep, b: FocusStep): boolean =>
  a.kind === b.kind && a.id === b.id;

export function samePath(a: FocusPath, b: FocusPath): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!sameStep(a[i], b[i])) return false;
  return true;
}

/**
 * Drill in one level.
 *
 * Re-entering the step you are already inside is the IDENTITY rather than a
 * second copy of it. A double-tap on the thing you are already in is an ordinary
 * thing for a hand to do — the gesture that entered it is the same gesture — and
 * a path holding `[s2, s2]` would be a state no resolver can mean anything by.
 *
 * TWO STEPS OF THE SAME KIND ARE NOT REFUSED, and that is deliberate rather than
 * an oversight. `[layer L1, layer L2]` is a layer inside a layer and
 * `[gesture S, gesture T]` is a selection refined to part of itself; both are
 * things a panel will ask for. `[sector 2, sector 3]` is nonsense, and this
 * function cannot tell the two apart because only a resolver knows whether its
 * kind nests. What the nonsense costs is bounded: the masks intersect, so a pair
 * of disjoint sectors names no cells, every tap reads as outside, and the first
 * double-tap pops back out of it. A caller that can produce the state should
 * prefer `exitTo` and re-enter.
 */
export function enter(path: FocusPath, step: FocusStep): FocusPath {
  const top = path[path.length - 1];
  if (top !== undefined && sameStep(top, step)) return path;
  return [...path, step];
}

/** Up one container. The root is its own parent, so this is total. */
export function exit(path: FocusPath): FocusPath {
  return path.length === 0 ? path : path.slice(0, -1);
}

/**
 * Up to a given depth — what clicking a crumb in the path display does.
 *
 * Clamped rather than checked: a depth past the end is the path unchanged, and a
 * negative depth is the root. A breadcrumb rendered from a stale path is a race
 * the UI can lose, and losing it should not be a thrown error.
 *
 * `NaN` is the root too, and it is tested rather than left to fall out of
 * `slice`. It DID fall out correctly — `slice(0, NaN)` is `[]` — but by way of
 * two comparisons that are both false, which is an accident rather than the
 * clamp this comment claims, and the next person to reorder the branches would
 * have silently changed the answer.
 */
export function exitTo(path: FocusPath, depth: number): FocusPath {
  if (!Number.isFinite(depth) || depth <= 0) return ROOT;
  return depth >= path.length ? path : path.slice(0, depth);
}

/** The deepest step, or `undefined` at the root. */
export const tip = (path: FocusPath): FocusStep | undefined =>
  path[path.length - 1];

/** The deepest step of a given kind, or `undefined`. */
export function stepOfKind(
  path: FocusPath,
  kind: FocusKind
): FocusStep | undefined {
  for (let i = path.length - 1; i >= 0; i--) {
    if (path[i].kind === kind) return path[i];
  }
  return undefined;
}

/** Whether `a` is `b` or an ancestor of it. The root is an ancestor of all. */
export function isAncestor(a: FocusPath, b: FocusPath): boolean {
  if (a.length > b.length) return false;
  for (let i = 0; i < a.length; i++) if (!sameStep(a[i], b[i])) return false;
  return true;
}

// ── resolvers: where the domain meaning lives ────────────────────────────

/**
 * What a kind MEANS, as far as the plate is concerned.
 *
 * `holds` answers "is cell i inside the thing this step names". That is the only
 * question this module asks of a domain, which is why a layer and a gesture both
 * fit: each holds some cells, and nothing here needs to know how it decides.
 *
 * `masks` — DEFAULT TRUE — marks a kind that restricts where the pointer may
 * land. False for a kind that is a WRITE TARGET or a RECORD rather than a place:
 * a layer, a gesture. See the header for the bug that taught this, and for why
 * the answer is not "treat an empty one as holding everything".
 *
 * `clips` — DEFAULT FALSE — marks a kind whose focus also trims the brush STAMP.
 * Arms do, sectors do not, and the difference is what keeps `sector6` meaningful.
 *
 * THE THREE ARE INDEPENDENT and every combination is reachable. An arm holds,
 * masks and clips; a sector holds and masks; a layer and a gesture hold only.
 * `clips` without `masks` is not currently used and is not forbidden — it would
 * be a region that trims paint without confining the hand, which is exactly what
 * a "paint only inside the selection" tool would want.
 */
export interface FocusResolver {
  holds(step: FocusStep, cell: number): boolean;
  masks?: boolean;
  clips?: boolean;
}

export type FocusResolvers = Partial<Record<FocusKind, FocusResolver>>;

/**
 * Sectors, resolved off the cell list the hexagon already carries.
 *
 * Takes `readonly {sector: number}[]` rather than a `Hexagon`, so the resolver
 * is testable against a hand-built list and cannot accidentally reach for
 * geometry. Nothing here computes a coordinate.
 */
export function sectorResolver(
  cells: readonly { sector: number }[]
): FocusResolver {
  return {
    holds: (step, i) => {
      const c = cells[i];
      return c !== undefined && String(c.sector) === step.id;
    },
  };
}

/**
 * Arms, resolved off the address word — `armOfWord`, unchanged.
 *
 * `clips: true` is the one place the arm's orbit-clipping rule is stated as
 * data rather than as a branch. It is deliberate and its cost is measured in
 * `arms.ts`; see the header note above before changing it.
 *
 * The hub (`X^d`) is in NO arm and is therefore held by no arm step, which is
 * `arms.ts`'s chosen behaviour rather than an edge case that slipped through:
 * with an arm isolated the hub cannot be painted, because the hub is not in any
 * arm, and the partition is what the exactness claim rests on.
 */
export function armResolver(
  cells: readonly { addr: string }[]
): FocusResolver {
  return {
    holds: (step, i) => {
      const c = cells[i];
      return c !== undefined && armOfWord(c.addr) === step.id;
    },
    clips: true,
  };
}

/**
 * A REGION stated outright, as a set of cells per id.
 *
 * Masks like any other region, because a region is a place. `layerResolver`
 * below is this with the masking taken off, and the two are kept apart rather
 * than merged: "a set of cells I may work inside" and "a sheet I am writing on"
 * are different things that happen to be spelled the same way, and the whole of
 * BUG A was the second being treated as the first.
 *
 * THE CACHE IS A SNAPSHOT. `cellsOf` is asked once per id and the answer is
 * kept for the life of this resolver, so a caller must build a NEW resolver when
 * the underlying cells change — which is the same discipline `arms.armMaskOver`
 * already imposes, and the natural one for a value rebuilt per render.
 */
export function setResolver(
  cellsOf: (id: string) => Iterable<number> | undefined
): FocusResolver {
  const cache = new Map<string, Set<number>>();
  return {
    holds: (step, i) => {
      let set = cache.get(step.id);
      if (set === undefined) {
        const raw = cellsOf(step.id);
        set = raw === undefined ? new Set<number>() : new Set(raw);
        cache.set(step.id, set);
      }
      return set.has(i);
    },
  };
}

/**
 * A LAYER: the cells it paints, and no restriction on the hand.
 *
 * `masks: false` is the fix to BUG A and the header carries the argument. In
 * one line: a fresh layer paints nothing and a hidden layer contributes nothing,
 * so a masking layer step makes the whole plate inert and every double-tap reads
 * as "outside" — you could not stay inside the layer you had just made.
 *
 * `holds` is still the honest answer — the cells this layer actually carries —
 * because `holdMask` wants it for dimming and framing. Answering `true`
 * everywhere instead would have been the cheaper fix and is the wrong one: it
 * would make "highlight the layer I selected" light up the whole plate, and it
 * would re-create the bug the moment somebody wired `holds` into a new mask.
 */
export function layerResolver(
  cellsOf: (id: string) => Iterable<number> | undefined
): FocusResolver {
  return { ...setResolver(cellsOf), masks: false };
}

/**
 * A GESTURE, or a set of them, resolved off the provenance tree.
 *
 * `provenance.gestureLayers` already turns a history into addressable layers
 * carrying `reveal`, `mode`, `orbit` and the cells the gesture painted, and
 * `select` / `byMode` / `shortOrbits` / `unmarked` / `complement` already answer
 * "which gestures". None of that is re-derived here. This turns a SELECTION into
 * a FOCUS, which is the only part that was missing.
 *
 * A layer's cells are its own paint UNIONED WITH ITS DESCENDANTS'. A gesture
 * whose applications had different orbit sizes is emitted as a parent with one
 * child per orbit and the parent then carries only the residual, so reading
 * `paint` alone would make a nested gesture hold a fraction of itself. Both an
 * id naming the parent and an id naming one child are answerable, and they
 * answer differently, which is what makes "isolate this orbit inside this
 * gesture" expressible without a second mechanism.
 *
 * ── `masks: false`, and this is NOT the same call as the arm's ──────────
 *
 * ISOLATING A GESTURE TO INSPECT IT IS NOT ISOLATING AN ARM TO PAINT IN IT.
 *
 * A gesture's cells are the RECORD OF A PAST EVENT, not a region of the plate.
 * If the pointer were confined to them, the only stroke you could make inside a
 * gesture focus would be one that repainted cells that gesture already painted —
 * a focus you cannot draw in. Worse, it is BUG A again in a new costume, and
 * this time it has a case that is not merely empty by accident: an ERASE is a
 * real gesture with a real mark, and `provenance.ts` states outright that it
 * contributes no `paint` entry because there is no spelling for absence. So an
 * erase gesture holds ZERO cells, and a masking gesture step would make the
 * whole plate inert exactly when you selected the stroke you most wanted to
 * look at. `test/focus.test.ts` measures that case.
 *
 * ── `clips: false`, and this is the decision that could have broken things ──
 *
 * `arms.ts` clips because an arm is a genuine part of a PARTITION whose setwise
 * stabiliser ⟨m_D⟩ is nameable, so the clipped brush is the INDUCED ACTION of a
 * real subgroup — mode 3 collapses onto mode 1, mode 6 onto mode 2, and that is
 * an honest answer to "what symmetry survives when I look at one arm".
 *
 * A gesture's cell set has no such story. It is a union of orbits OF THE GROUP
 * IT WAS MADE UNDER, at the seeds it was made at, and the group you are holding
 * now is very likely a different one. Intersecting a fresh stamp with it leaves
 * cells that no subgroup selects, so the survivors are not the orbit of
 * anything: the brush would paint an arbitrary-looking subset and there would be
 * no sentence to write in this comment saying what it was. That is precisely the
 * "brush that looks broken" `arms.ts` warns against, WITHOUT the compensating
 * exactness claim that makes the arm's version worth its cost.
 *
 * So a gesture focus changes what is ADDRESSED and what is SHOWN, and changes
 * nothing about what the brush does. `test/focus.test.ts` asserts both halves.
 */
export function gestureResolver(layers: readonly EmitLayer[]): FocusResolver {
  // id → every cell of that layer's SUBTREE. One pass, built eagerly, because
  // the tree is O(gestures) and a focus is asked about O(cells) per render.
  const cells = new Map<string, Set<number>>();
  const walk = (list: readonly EmitLayer[]): Set<number> => {
    const here = new Set<number>();
    for (const l of list) {
      const mine = new Set<number>();
      if (l.paint !== undefined) for (const i of l.paint.keys()) mine.add(i);
      if (l.children !== undefined) for (const i of walk(l.children)) mine.add(i);
      cells.set(l.id, mine);
      for (const i of mine) here.add(i);
    }
    return here;
  };
  walk(layers);

  // The union a whole step names, memoised on the step's canonical id — which
  // is why `gestureStep` sorts: two spellings of one selection would otherwise
  // each build and keep their own copy of the same set.
  const union = new Map<string, Set<number>>();
  return {
    holds: (step, i) => {
      let set = union.get(step.id);
      if (set === undefined) {
        set = new Set<number>();
        for (const id of gestureIds(step)) {
          const one = cells.get(id);
          if (one !== undefined) for (const c of one) set.add(c);
        }
        union.set(step.id, set);
      }
      return set.has(i);
    },
    masks: false,
  };
}

/**
 * The PINNED gestures, as a focus step — and the one honest caveat in this file.
 *
 * This is `provenance.shortOrbits` and nothing else; the query is not
 * reimplemented. What is different is the SIGNATURE: `orderOf` is REQUIRED here
 * and defaulted to the identity there.
 *
 * ── Why the parameter is made compulsory ────────────────────────────────
 *
 * `mode` is not always the group's ORDER. Under the `sector6` scope the group is
 * C6 × D3 of order 6·mode, so at depth 3 a mode-3 brush has orbits of 18 and one
 * of 6 — genuinely pinned, and yet 6 > 3, so `orbit < mode` MISSES it. A
 * `StrokeMark` records the mode and not the scope, so nothing downstream can
 * recover the order by itself. Defaulting to the identity is right for every
 * whole-plate and sector-local brush and silently wrong for `sector6`, and a
 * silent wrong answer at the point where a control says "show me the pinned
 * strokes" is worse than making the caller state which scope it was drawing in.
 * `test/focus.test.ts` measures the miss.
 *
 * ── WHAT THIS CANNOT ANSWER, and does not pretend to ────────────────────
 *
 * A BAND GESTURE'S RECORDED GROUPS ARE BANDS, NOT ORBITS. `brush.brushStamp`
 * records the IMAGE BANDS when a band family is in play, `StrokeMark` does not
 * say which of the two it is holding, and `EmitLayer.orbit` is therefore "the
 * size of the recorded group" rather than "the size of the orbit". A short band
 * — and short bands exist; the corner rows of a triangle are one and two cells
 * long — reads as `orbit < mode` and is reported as pinned when the seed has a
 * trivial stabiliser and nothing is pinned at all. `test/focus.test.ts`
 * CONSTRUCTS that false positive from the real machinery rather than describing
 * it, and asserts that the seed's true orbit is full size.
 *
 * It is not fixable from here. The fact needed to tell a band gesture from a
 * plain one is not in the record, so the choices were: refuse to answer at all,
 * refuse per gesture (impossible — there is nothing to test), or answer and say
 * plainly what the answer includes. The third is taken, and this paragraph is
 * the saying. A caller that must not show false positives has to record the
 * band family on the mark first; nothing here should paper over it by, say,
 * dropping results below some length, which would trade a visible wrong answer
 * for an invisible missing one.
 */
export function pinnedGestures(
  layers: readonly EmitLayer[],
  orderOf: (mode: number) => number
): Set<string> {
  return shortOrbits(layers, orderOf);
}

// ── the three masks ──────────────────────────────────────────────────────

const ALWAYS = (): boolean => true;

/**
 * The steps of a path that have a resolver AND satisfy `want`.
 *
 * One helper for all three masks, so the three cannot drift apart in how they
 * treat a missing resolver — which is the case with the least obvious right
 * answer and therefore the one most likely to be decided twice.
 */
function activeSteps(
  path: FocusPath,
  resolvers: FocusResolvers,
  want: (r: FocusResolver) => boolean
): (readonly [FocusStep, FocusResolver])[] {
  const out: (readonly [FocusStep, FocusResolver])[] = [];
  for (const step of path) {
    const r = resolvers[step.kind];
    if (r !== undefined && want(r)) out.push([step, r] as const);
  }
  return out;
}

function maskOf(
  steps: readonly (readonly [FocusStep, FocusResolver])[]
): (cell: number) => boolean {
  if (steps.length === 0) return ALWAYS;
  return (cell) => {
    for (const [step, r] of steps) if (!r.holds(step, cell)) return false;
    return true;
  };
}

/**
 * WHICH CELLS THE PATH NAMES — every step with a resolver, masking or not.
 *
 * For the display: dim what is outside, frame what is inside, flash the thing
 * the panel just selected. It is the only mask a non-masking step reaches, and
 * therefore the only way "highlight this gesture" can be asked.
 *
 * A step whose kind has no resolver is treated as holding everything rather than
 * nothing. That choice is the difference between a missing resolver showing the
 * plate un-narrowed — visibly wrong, and diagnosable in one glance — and it
 * showing an empty board, which reads as the drawing having been lost.
 */
export function holdMask(
  path: FocusPath,
  resolvers: FocusResolvers
): (cell: number) => boolean {
  return maskOf(activeSteps(path, resolvers, ALWAYS));
}

/**
 * Where a pointer may land: inside every step of the path THAT MASKS.
 *
 * A layer and a gesture do not; see `FocusResolver` and the header. The root
 * returns the constant `true` as one shared closure, so the common case costs a
 * call and not an allocation per cell — and so does a path made only of
 * non-masking steps, which is the ordinary state while a layer is selected.
 * Those two cases are the SAME case here, which is the point: `maskOf` of no
 * steps is `ALWAYS`, so "nothing narrows the hand" has one spelling and not two.
 */
export function seedMask(
  path: FocusPath,
  resolvers: FocusResolvers
): (cell: number) => boolean {
  return maskOf(activeSteps(path, resolvers, (r) => r.masks !== false));
}

/**
 * What trims the stamp: only the steps whose kind declares `clips`.
 *
 * Today that is arms alone. The header explains why sectors must NOT be here and
 * why gestures must not either, and `test/focus.test.ts` asserts both as
 * properties rather than as comments — a `sector6` stroke inside an isolated
 * sector still reaches all six, and a stamp inside a gesture focus is untrimmed.
 */
export function clipMask(
  path: FocusPath,
  resolvers: FocusResolvers
): (cell: number) => boolean {
  return maskOf(activeSteps(path, resolvers, (r) => r.clips === true));
}

/**
 * Every cell the path HOLDS, ascending — for framing, dimming and zoom.
 *
 * DEVIATION from the first version of this file, flagged rather than slipped in:
 * this used to be built on `seedMask`, so a gesture or a layer focus would have
 * answered with the whole plate — the one answer that is useless for framing.
 * It is built on `holdMask` now. For a path of sectors and arms the two are
 * identical, so nothing that existed changes.
 *
 * MAY BE EMPTY, and a caller must expect it: a fresh layer, a hidden layer, an
 * erase gesture and a query that matched nothing all name no cells. Empty means
 * "this focus names nothing to look at" — keep the frame you have rather than
 * zooming to a degenerate box.
 */
export function focusCells(
  path: FocusPath,
  resolvers: FocusResolvers,
  count: number
): number[] {
  const inside = holdMask(path, resolvers);
  const out: number[] = [];
  for (let i = 0; i < count; i++) if (inside(i)) out.push(i);
  return out;
}

// ── what the brush does about it ─────────────────────────────────────────

/**
 * The scope the brush should use, given where you are and one toggle.
 *
 * The toggle is the `sector6` control: "repeat in all six". It is a property of
 * the BRUSH rather than a fourth entry in a scope list, which is what makes
 * removing the three scope buttons possible without stranding the group —
 * selecting a side on the canvas is the gesture that used to be the `sector`
 * button, and this toggle is the one that used to be `sector6`.
 *
 * ── `repeatAll` IS HONOURED AT THE ROOT, and the first version was wrong ──
 *
 * That version returned `"hexagon"` whenever no sector was on the focus path and
 * carried a comment justifying it: "there is no sector to repeat". There is.
 * `draw/page.tsx`'s `noteSector` sets the active sector from the cell UNDER THE
 * POINTER in hexagon view, and does it stickily on purpose so the guides do not
 * flicker off when the hand leaves the plate. The sector a `sector6` brush
 * repeats is the SEED'S OWN sector, which `orbit.ts` reads off the cell — the
 * scope never asks the focus which sector it is in, and could not, since the
 * group acts in all six at once.
 *
 * So the old rule deleted the program's best demonstration of itself: at the
 * root, one stroke with `sector6` lands in all six sectors simultaneously, which
 * is the most legible picture of C6 × D3 this program can produce, and it was
 * unreachable unless you first drilled into a sector — where the isolation
 * makes the same stroke look like five copies you are not allowed to touch.
 *
 * ── The three-way answer, and why it is that way round ──────────────────
 *
 *   repeatAll                    → `sector6`   C6 × D3, wherever you are.
 *   no sector focused, no repeat → `hexagon`   D6, the whole plate's own group.
 *   sector focused, no repeat    → `sector`    that sector's D3, and nothing out.
 *
 * `repeatAll` is tested FIRST because it names a group outright and the focus
 * does not contradict it: inside a sector, `sector6` is "this sector's D3, six
 * times", and at the root it is the same group seeded from wherever you click.
 * The focus decides CONFINEMENT — where the hand may go — and `seedMask` already
 * enforces that independently, which is exactly the seed/clip split this module
 * is built on. Deciding the group from the confinement is what conflated them.
 *
 * `hexagon` rather than `sector` at the root is the other half: with no sector
 * singled out, "one sector and nothing outside it" names no sector, while D6 is
 * the group the whole plate actually has.
 *
 * ARMS DO NOT CHANGE THE SCOPE, and that is `arms.ts`'s rule, not a shortcut
 * here: an arm narrows which cells survive (`clipMask`), and the group the brush
 * computes its orbit in is still the sector's. The induced action is what you
 * see, and it is measured in `test/arms.test.ts`.
 *
 * ONE CONSEQUENCE FOR THE CALLER: `orbit.SCOPE_MODES` gives `sector6` the modes
 * `[1, 2, 3, 6]` and `hexagon` also `12`, so turning `repeatAll` on at the root
 * takes mode 12 away. The caller must clamp — `draw/page.tsx` already does, at
 * its scope setter — because mode 12 is D6's reflections and C6 × D3 does not
 * contain them. That is a fact about the groups and not a limitation to route
 * around.
 */
export function scopeFor(path: FocusPath, repeatAll: boolean): BrushScope {
  if (repeatAll) return "sector6";
  return stepOfKind(path, "sector") === undefined ? "hexagon" : "sector";
}

/** The focused sector, or `null` at the root. */
export function focusedSector(path: FocusPath): number | null {
  const s = stepOfKind(path, "sector");
  if (s === undefined) return null;
  const n = Number(s.id);
  return Number.isInteger(n) ? n : null;
}

/** The focused arm, or `null`. */
export function focusedArm(path: FocusPath): Arm | null {
  const a = stepOfKind(path, "arm");
  if (a === undefined) return null;
  return a.id === "A" || a.id === "B" || a.id === "C" ? a.id : null;
}

/** The focused gesture selection, or the empty array. */
export function focusedGestures(path: FocusPath): string[] {
  const g = stepOfKind(path, "gesture");
  return g === undefined ? [] : gestureIds(g);
}

// ── what a tap means ─────────────────────────────────────────────────────

/** What a double-tap resolved to. `null` is "nothing to do". */
export type FocusGesture =
  | { act: "enter"; step: FocusStep }
  | { act: "exit" }
  | null;

/**
 * What a double-tap on a cell means, given where you are.
 *
 * Illustrator's rule, and the whole of it: a double-tap INSIDE the current focus
 * drills one level further in; a double-tap OUTSIDE steps one level out. That is
 * why the two cases are decided by the same predicate rather than by hit-testing
 * two different things — "outside" is precisely "not held by the path I am on",
 * so the gesture is total over the plate and there is no third case where a tap
 * lands somewhere that means neither.
 *
 * "OUTSIDE" IS `seedMask`'S OUTSIDE, not `holdMask`'S. The question a tap asks
 * is "may my hand be here", and a step that does not restrict the hand cannot
 * answer it. That is what makes a fresh or hidden layer work (BUG A), and it is
 * why a path of only non-masking steps never answers `exit`: there is nowhere
 * outside a sheet you are writing on. See the header.
 *
 * `deeper` supplies the step to drill INTO, because only the caller knows what
 * the next level down is: at the root a cell names its sector, inside a sector it
 * names its arm, and inside an arm there is nothing further and it returns
 * `undefined`. Returning `undefined` yields `null` — a double-tap at the bottom
 * of the stack is a no-op rather than an exit, since exiting on it would make the
 * deepest level impossible to double-tap inside of without leaving it.
 *
 * THERE IS EXACTLY ONE NO-OP, and it is that one. The exit branch used to carry a
 * second — `path.length === 0 ? null : exit` — which could not fire: a mask built
 * from no steps is `ALWAYS` (see `maskOf`), so at the root every cell is inside
 * and `!inside` is unreachable. It is the same fact the paragraph above states in
 * its general form, that a path of only non-masking steps never answers `exit`,
 * and a guard that restates an invariant it cannot enforce reads as though
 * something were being checked. Falling into the exit branch is itself the proof
 * that some step masks, and therefore that the path is not empty.
 */
export function gestureFor(
  path: FocusPath,
  cell: number,
  resolvers: FocusResolvers,
  deeper: (cell: number, path: FocusPath) => FocusStep | undefined
): FocusGesture {
  const inside = seedMask(path, resolvers)(cell);
  if (!inside) return { act: "exit" };
  const step = deeper(cell, path);
  return step === undefined ? null : { act: "enter", step };
}

/**
 * The next level down for the hexagon's own stack: root → sector → arm → stop.
 *
 * Written here rather than in the page because it IS the plate's nesting rule,
 * and a rule stated in a component is a rule the tests cannot reach.
 *
 * LAYER AND GESTURE STEPS ARE INVISIBLE TO IT, which is the same statement as
 * their not masking: they are entered from the panel and the filmstrip, so a
 * path carrying one still offers the sector under the finger as the next level
 * down. That is what makes "select a layer, then drill into a sector of it"
 * work with no code of its own.
 */
export function hexagonDeeper(
  cells: readonly { sector: number; addr: string }[]
): (cell: number, path: FocusPath) => FocusStep | undefined {
  return (cell, path) => {
    const c = cells[cell];
    if (c === undefined) return undefined;
    if (stepOfKind(path, "sector") === undefined) return sectorStep(c.sector);
    if (stepOfKind(path, "arm") === undefined) {
      const arm = armOfWord(c.addr);
      // The hub is in no arm, so there is nothing to enter. Returning undefined
      // makes that a no-op rather than an exit -- double-tapping the one cell at
      // the centre should not throw you out of the sector you are working in.
      return arm === null ? undefined : armStep(arm);
    }
    return undefined;
  };
}

// ── saying where you are ─────────────────────────────────────────────────

export const STEP_LABEL: Readonly<Record<FocusKind, string>> = {
  sector: "sector",
  arm: "arm",
  layer: "layer",
  gesture: "gesture",
};

/**
 * What one step calls itself.
 *
 * A gesture step is the only one whose id is not the name of a thing, so it is
 * the only one that needs a case: `gesture g3` for one, `4 gestures` for a
 * selection, `no gestures` for a query that matched nothing. Spelling a set as
 * `gesture g0,g3,g7,g9` would put an id list in a breadcrumb, which is unreadable
 * at four and impossible at forty.
 */
function stepLabel(step: FocusStep): string {
  if (step.kind !== "gesture") return `${STEP_LABEL[step.kind]} ${step.id}`;
  const ids = gestureIds(step);
  if (ids.length === 0) return "no gestures";
  return ids.length === 1 ? `gesture ${ids[0]}` : `${ids.length} gestures`;
}

/** A breadcrumb: `the whole plate`, `sector 2`, `sector 2 · arm A`. */
export function pathLabel(path: FocusPath): string {
  if (path.length === 0) return "the whole plate";
  return path.map(stepLabel).join(" · ");
}
