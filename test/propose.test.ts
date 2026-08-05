/**
 * The standing proposal: what a `propose` drag gathers, and what committing it
 * is obliged to produce.
 *
 * `propose` mode used to hold ONE candidate — every cell the finger crossed
 * replaced the last — so a drag in the mode that exists FOR TOUCH could lay one
 * application while a drag in the mode that exists for a mouse could lay a
 * hundred. It gathers now, and gathering brings three obligations that a naive
 * implementation gets wrong in three different ways. This file is those three,
 * measured rather than asserted in prose:
 *
 *   ONE RUNG. A five-seed proposal commits as a single gesture, so ONE undo puts
 *   the plate back exactly as it was. Five rungs would make undo a lottery.
 *
 *   PER-SEED SPANS. `brush.BrushStamp.span` is how many positions of the colour
 *   scheme ONE application is indexed over, and it is a fact about the seed: an
 *   orbit's span is its realised size, a band brush's span is its number of
 *   image bands, and both differ from seed to seed. Merging the seeds into one
 *   stamp collapses them to a single number and repaints the proposal in hues
 *   the ghost never showed. The band test below is chosen because it is the case
 *   where the two answers are visibly different colours rather than the same
 *   colours in a different order.
 *
 *   AN HONEST MARK. N applications is N entries in `strokes.StrokeMark.groups`,
 *   in the order applied — not one merged super-group. `provenance.gestureLayers`
 *   reads exactly that to decide whether a gesture is one addressable layer or a
 *   parent with one child per orbit, and a merged group would make every
 *   mixed-orbit proposal indistinguishable from a uniform one.
 *
 * Everything here runs the REAL machinery — `orbit.ts` for the symmetry,
 * `brush.ts` for the stamp and the colours, `plate.ts` for the edits,
 * `strokes.ts` for the history. The commit harness is `draw/page.tsx`'s
 * `paintAt` × N followed by ONE `endStroke`, with the UI taken out, which is the
 * same idiom `test/provenance.test.ts` uses and for the same reason: a fixture
 * written by the same hand as the implementation would agree with it about
 * exactly the thing under test.
 *
 * ZERO FLOAT decides anything here. Colours are compared as `#rrggbb` strings,
 * which is what the plate actually stores.
 */

import { describe, expect, it } from "vitest";
import { clipStamp } from "../src/lib/arms";
import { buildBandSurface } from "../src/lib/bands";
import {
  brushStamp,
  stampColours,
  type BrushShape,
  type ColourPlan,
} from "../src/lib/brush";
import { buildHexagon } from "../src/lib/hexagon";
import {
  hexagonSurface,
  type BrushMode,
  type BrushScope,
  type SymmetrySurface,
} from "../src/lib/orbit";
import {
  addressBook,
  applyPlateEdits,
  planPlateEdits,
  resolvePlate,
  type Address,
  type AddressPlate,
} from "../src/lib/plate";
import { gestureLayers } from "../src/lib/provenance";
import {
  EMPTY_PROPOSAL,
  proposalHolds,
  proposalStamps,
  proposeSeed,
  seedStamp,
  stampGroups,
  unionCells,
} from "../src/lib/propose";
import { ADJUSTMENTS } from "../src/lib/adjust";
import { SCHEMES, swatchFromHex, type Swatch } from "../src/lib/schemes";
import {
  commit,
  mergeEdits,
  undo,
  EMPTY_HISTORY,
  type CellEdit,
  type History,
  type Stroke,
  type StrokeMark,
} from "../src/lib/strokes";

// ── the harness ──────────────────────────────────────────────────────────

const DEPTH = 3;
const hex = buildHexagon(DEPTH);
const book = addressBook(hex);
const bands = buildBandSurface(hex);
const surfaceOf = (scope: BrushScope): SymmetrySurface => hexagonSurface(hex, scope);
const ALL = () => true;

const BASE = swatchFromHex("#d4a017");

const plainPlan = (scheme: keyof typeof SCHEMES, base: Swatch): ColourPlan => ({
  tool: "paint",
  scheme: SCHEMES[scheme],
  base,
  adjust: ADJUSTMENTS["hue+"],
});

interface Session {
  plate: AddressPlate;
  history: History<Address>;
}

const fresh = (): Session => ({
  plate: new Map<Address, string>(),
  history: EMPTY_HISTORY,
});

/**
 * A proposal, committed — `paintAt` once per seed and `endStroke` ONCE.
 *
 * This is the page's `commitProposal` with React taken out, and the structure is
 * the claim: the loop accumulates into `edits` and `groups`, and exactly one
 * `commit` runs afterwards. Each seed builds its OWN stamp through the shared
 * `proposalStamps`, so each keeps its own `span`, and `stampColours` is asked
 * once per seed — which is what makes the colouring test below a test of the
 * production path rather than of this function.
 *
 * `planAt` supplies the seed's colour plan, so a caller can either hold the base
 * still (no progression) or advance it per application, exactly as the page's
 * `pendingEvents` does.
 */
function commitProposal(
  s: Session,
  scope: BrushScope,
  shape: BrushShape,
  seeds: readonly number[],
  planAt: (k: number) => ColourPlan
): void {
  const surface = surfaceOf(scope);
  const stamps = proposalStamps(surface, bands, seeds, shape, ALL);
  let edits: CellEdit<Address>[] = [];
  const groups: Address[][] = [];
  stamps.forEach((stamp, k) => {
    if (stamp.cells.length === 0) return;
    // Against the plate AS IT STANDS, application by application — the same
    // order the page applies them in, so a later seed sees an earlier seed's
    // paint exactly as it would on the real plate.
    const shown = resolvePlate(s.plate, book);
    const colours = stampColours(planAt(k), shown, stamp);
    const planned = planPlateEdits(
      s.plate,
      book,
      stamp.cells.map((c) => book.addr[c]),
      colours
    );
    if (planned.length === 0) return;
    for (const g of stampGroups(stamp)) groups.push(g.map((c) => book.addr[c]));
    s.plate = applyPlateEdits(s.plate, planned, "do");
    edits = mergeEdits(edits, planned);
  });
  if (edits.length === 0) return;
  const mark: StrokeMark<Address> | undefined =
    groups.length === 0 ? undefined : { mode: shape.mode, groups };
  const stroke: Stroke<Address> = mark === undefined ? { edits } : { edits, mark };
  // ONE rung. Not one per seed.
  s.history = commit(s.history, stroke);
}

const plain = (mode: BrushMode): BrushShape => ({ mode, band: null });

/** The first cell whose orbit under `mode` has exactly `size` members. */
function seedWithOrbit(scope: BrushScope, mode: BrushMode, size: number): number {
  const surface = surfaceOf(scope);
  for (let i = 0; i < surface.cellCount; i++) {
    if (surface.orbit(i, mode).length === size) return i;
  }
  throw new Error(`no cell of ${scope} has a ${size}-cell orbit at mode ${mode}`);
}

// ── the list algebra ─────────────────────────────────────────────────────

describe("a proposal is an ordered list of distinct seeds", () => {
  it("appends in the order touched", () => {
    let p = EMPTY_PROPOSAL;
    for (const i of [40, 7, 900, 3]) p = proposeSeed(p, i);
    expect([...p]).toEqual([40, 7, 900, 3]);
  });

  it("re-touching a held seed is a no-op that keeps its POSITION", () => {
    let p = EMPTY_PROPOSAL;
    for (const i of [40, 7, 900]) p = proposeSeed(p, i);
    const again = proposeSeed(p, 40);
    // The same array, not an equal one. React bails out of a state update that
    // sets the identical value, so a finger resting on a cell boundary — which
    // reports A, B, A, B for as long as it rests there — costs no render at all.
    expect(again).toBe(p);
    expect([...again]).toEqual([40, 7, 900]);
  });

  it("holds is about SEEDS, not about the cells the ghost covers", () => {
    const surface = surfaceOf("hexagon");
    const seed = seedWithOrbit("hexagon", 6, 6);
    const orbit = surface.orbit(seed, 6);
    const mate = orbit.find((c) => c !== seed) as number;
    const p = proposeSeed(EMPTY_PROPOSAL, seed);
    expect(proposalHolds(p, seed)).toBe(true);
    // The orbit-mate is COVERED and is not a seed, so touching it proposes it on
    // its own — exactly as a paint drag applies the brush there. That is the
    // rule stated in `propose.ts`, and it is what "the same as the regular paint
    // tool" has to mean.
    expect(proposalHolds(p, mate)).toBe(false);
  });

  it("unionCells counts the drawing, not the gesture", () => {
    const surface = surfaceOf("hexagon");
    const seed = seedWithOrbit("hexagon", 6, 6);
    const orbit = surface.orbit(seed, 6);
    const mate = orbit.find((c) => c !== seed) as number;
    const stamps = proposalStamps(surface, bands, [seed, mate], plain(6), ALL);
    // Two applications of six cells each, and the SAME six cells: the union is
    // 6, not 12. A readout that summed the applications would tell the user the
    // commit changes twice what it changes.
    expect(stamps.map((s) => s.cells.length)).toEqual([6, 6]);
    expect(unionCells(stamps.map((s) => s.cells)).length).toBe(6);
    expect(unionCells(stamps.map((s) => s.cells))).toEqual([...orbit].sort((a, b) => a - b));
  });
});

// ── ONE RUNG ─────────────────────────────────────────────────────────────

describe("a proposal commits as ONE rung of the journal", () => {
  it("five seeds, one rung, and ONE undo restores the plate exactly", () => {
    const s = fresh();
    // Something already on the plate, so "restored" means restored and not
    // merely emptied — the strongest form of the claim.
    const before = new Map<Address, string>();
    for (const a of [book.addr[0], book.addr[5], book.addr[64]]) {
      before.set(a, "#123456");
    }
    s.plate = new Map(before);

    const seeds = [12, 40, 77, 201, 355];
    commitProposal(s, "hexagon", plain(6), seeds, () => plainPlan("hexad", BASE));

    // ONE rung for five applications. This is the whole reviewer point: five
    // rungs would mean five presses of undo to take back one gesture, and no
    // way for the user to know it was five.
    expect(s.history.past.length).toBe(1);
    const rung = s.history.past[0];
    expect(rung.mark?.groups.length).toBe(5);

    const after = resolvePlate(s.plate, book);
    expect(after.size).toBeGreaterThan(before.size);

    const step = undo(s.history);
    expect(step.stroke).not.toBeNull();
    s.plate = applyPlateEdits(s.plate, (step.stroke as Stroke<Address>).edits, "undo");
    s.history = step.history;

    // Back to exactly what was there — the same addresses holding the same
    // colours, not merely the same count.
    expect([...s.plate.entries()].sort()).toEqual([...before.entries()].sort());
    expect(s.history.past.length).toBe(0);
  });

  it("the same five seeds committed one rung EACH need five undos", () => {
    // The wrong implementation, run deliberately, so the test above is measuring
    // a difference rather than a tautology.
    const s = fresh();
    const seeds = [12, 40, 77, 201, 355];
    for (const seed of seeds) {
      commitProposal(s, "hexagon", plain(6), [seed], () => plainPlan("hexad", BASE));
    }
    expect(s.history.past.length).toBe(5);
  });

  it("a proposal that changes nothing pushes no rung at all", () => {
    const s = fresh();
    const seeds = [12, 40];
    commitProposal(s, "hexagon", plain(6), seeds, () => plainPlan("hexad", BASE));
    expect(s.history.past.length).toBe(1);
    // The same proposal again lays the identical colours, so every edit is a
    // no-op, `planPlateEdits` returns nothing, and there is no rung. A drop is
    // the same story with the loop never run: no plate change, no rung.
    commitProposal(s, "hexagon", plain(6), seeds, () => plainPlan("hexad", BASE));
    expect(s.history.past.length).toBe(1);
  });
});

// ── PER-SEED SPANS: the colouring test ───────────────────────────────────

describe("each seed keeps its own span, so each keeps its own hues", () => {
  /**
   * The band brush ON THE SECTOR SCOPE is the sharp case, and the qualification
   * was MEASURED rather than assumed — the first draft of this test used the
   * whole-plate 6-fold band brush and could not fail.
   *
   * The trap is arithmetic. `schemes.position` folds a key twice, into [0, span)
   * and then into [0, offsets), so a merged stamp — second seed's keys running
   * on past the first's, spans added — gives the second seed key k + s where the
   * honest one gives k. Those two agree modulo the hexad's six offsets EXACTLY
   * WHEN s is a multiple of 6, and every whole-plate band span at depth 3
   * happens to be one: measured across both canvases, `hexagon` bands span 1, 2,
   * 3, 6, 6 at modes 1, 2, 3, 6, 12, and only the 6s are reachable with the
   * 6-fold brush the UI defaults to. So a merged implementation would have
   * produced the right colours by accident there.
   *
   * A sector-scoped 6-fold brush spans THREE image bands — the local group is
   * the sector's own D₃ and m_A carries a family-A band to itself — and 3 is not
   * a multiple of 6. Merge two of those and the span becomes 6: the hexad walks
   * the whole wheel where each seed alone uses only 0°, 60°, 120°. Different
   * colours, not the same colours in a different order.
   */
  const BAND: BrushShape = { mode: 6, band: "A" };
  const BAND_SCOPE: BrushScope = "sector";

  it("MEASURES that a band span is not the cell count and not the mode", () => {
    const surface = surfaceOf(BAND_SCOPE);
    const one = clipStamp(brushStamp(surface, bands, 40, BAND), ALL);
    expect(one.span).toBe(3);
    expect(one.cells.length).toBeGreaterThan(one.span);
    // And on the whole plate the same brush spans six, which is why the scope
    // matters here: the number is a fact about the group, not about the letter.
    expect(clipStamp(brushStamp(surfaceOf("hexagon"), bands, 40, BAND), ALL).span).toBe(6);
  });

  it("MEASURES that the span can differ from SEED to SEED", () => {
    // The strongest form of "span is per seed": on the sector scope a 2-fold
    // band brush spans one row in some sectors and two in others, because ⟨m_A⟩
    // fixes a family-A band and swaps B with C, and a sector is a rotated copy
    // so which family the letter names rotates with it. `brush.brushSpan` states
    // this; here it is, in two seeds of one canvas.
    const surface = surfaceOf("sector");
    const spans = new Map<number, number>();
    for (let i = 0; i < surface.cellCount; i++) {
      const span = brushStamp(surface, bands, i, { mode: 2, band: "A" }).span;
      if (!spans.has(span)) spans.set(span, i);
    }
    expect([...spans.keys()].sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it("a two-seed band proposal paints each seed the hues it would get alone", () => {
    const surface = surfaceOf(BAND_SCOPE);
    const seeds = [40, 77];
    const plan = plainPlan("hexad", BASE);

    // What the proposal lays.
    const s = fresh();
    commitProposal(s, BAND_SCOPE, BAND, seeds, () => plan);
    const together = resolvePlate(s.plate, book);

    // What each seed lays on its own, applied in the same order onto the same
    // starting plate. Identical, cell for cell — which is only true if the
    // second application was indexed over ITS OWN span.
    const solo = fresh();
    for (const seed of seeds) {
      commitProposal(solo, BAND_SCOPE, BAND, [seed], () => plan);
    }
    const apart = resolvePlate(solo.plate, book);

    expect([...together.entries()].sort()).toEqual([...apart.entries()].sort());

    // And the merged-span alternative is a DIFFERENT picture, so the equality
    // above is discriminating rather than vacuous. Build the one stamp a merge
    // would produce — every cell of both applications, keys running on and the
    // spans added — and colour it.
    const a = clipStamp(brushStamp(surface, bands, seeds[0], BAND), ALL);
    const b = clipStamp(brushStamp(surface, bands, seeds[1], BAND), ALL);
    const merged = {
      cells: [...a.cells, ...b.cells],
      keys: [...a.keys, ...b.keys.map((k) => k + a.span)],
      span: a.span + b.span,
      groups: [...(a.groups ?? []), ...(b.groups ?? [])],
    };
    const mergedColours = stampColours(plan, new Map(), merged);
    const perSeed = [
      ...stampColours(plan, new Map(), a),
      ...stampColours(plan, new Map(), b),
    ];
    expect(mergedColours).not.toEqual(perSeed);
    // Named, so the failure mode is legible: the merged span walks the whole
    // hexad, the honest one uses three of its six offsets.
    expect(new Set(perSeed).size).toBe(3);
    expect(new Set(mergedColours).size).toBe(6);
  });

  it("a pinned seed beside a free one keeps its SHORT span", () => {
    // Mode 12 on the whole plate pins the cells on the sector-spine mirrors:
    // orbits of 6 where a free cell has 12. The analogous scheme is the one that
    // reads `span` directly — its lightness fan is over the span, not over the
    // offsets — so a merged span shows up as the wrong LIGHTNESS even where the
    // hue happens to survive the fold.
    const pinned = seedWithOrbit("hexagon", 12, 6);
    const free = seedWithOrbit("hexagon", 12, 12);
    const surface = surfaceOf("hexagon");
    const a = clipStamp(brushStamp(surface, bands, pinned, plain(12)), ALL);
    const b = clipStamp(brushStamp(surface, bands, free, plain(12)), ALL);
    expect(a.span).toBe(6);
    expect(b.span).toBe(12);

    const plan = plainPlan("analogous", BASE);
    const honest = stampColours(plan, new Map(), a);
    const merged = stampColours(plan, new Map(), {
      ...a,
      keys: a.keys,
      span: a.span + b.span,
    });
    // The same cells, the same keys, one different span — and a different
    // picture. That is the whole of what "span must stay per seed" buys.
    expect(merged).not.toEqual(honest);
  });

  it("a progression steps once per APPLICATION, so a proposal is a gradient", () => {
    // `brush.EventLog`: a gesture spends one colouring event per distinct cell
    // it starts an application at. A proposal of three seeds is three
    // applications, so the base has to advance three times — and the preview has
    // to advance with it or the ghost promises a colour the stroke will not lay.
    const s = fresh();
    const seeds = [12, 40, 77];
    const bases = seeds.map((_, k) =>
      swatchFromHex(SCHEMES.hexad.at(BASE, k, 6).hex)
    );
    commitProposal(s, "hexagon", plain(6), seeds, (k) =>
      plainPlan("solid", bases[k])
    );
    const plate = resolvePlate(s.plate, book);
    const surface = surfaceOf("hexagon");
    // Each application is solid in its own base, so the three orbits come out in
    // three different colours — the gradient a paint drag lays along its path.
    const seen = seeds.map((seed) => plate.get(surface.orbit(seed, 6)[0]));
    expect(new Set(seen).size).toBe(3);
  });
});

// ── THE MARK ─────────────────────────────────────────────────────────────

describe("a proposal records an honest mark", () => {
  it("three seeds, three groups, in the order applied", () => {
    const s = fresh();
    const seeds = [12, 40, 77];
    commitProposal(s, "hexagon", plain(6), seeds, () => plainPlan("hexad", BASE));
    const mark = s.history.past[0].mark as StrokeMark<Address>;

    expect(mark.mode).toBe(6);
    expect(mark.groups.length).toBe(3);
    // Group k is the orbit of seed k, as addresses, in the order the brush
    // applied them. No merged super-group anywhere.
    const surface = surfaceOf("hexagon");
    seeds.forEach((seed, k) => {
      const orbit = surface.orbit(seed, 6).map((c) => book.addr[c]);
      expect([...mark.groups[k]].sort()).toEqual([...orbit].sort());
    });
    // And the seeds' own addresses appear one per group, in order — which is
    // what makes the record a statement about the DRAG rather than about a set.
    seeds.forEach((seed, k) => {
      expect(mark.groups[k]).toContain(book.addr[seed]);
    });
  });

  it("a uniform proposal is ONE layer; a mixed one is a parent with children", () => {
    // `provenance.gestureLayers`'s `auto` rule, and a multi-seed proposal is
    // precisely the case it was written for: one layer when every group has the
    // same size, parent-plus-one-child-per-group when they differ.
    const uniform = fresh();
    commitProposal(uniform, "hexagon", plain(6), [12, 40, 77], () =>
      plainPlan("hexad", BASE)
    );
    const flat = gestureLayers(uniform.history, book);
    expect(flat.length).toBe(1);
    expect(flat[0].children).toBeUndefined();
    expect(flat[0].mode).toBe(6);
    expect(flat[0].orbit).toBe(6);

    const mixed = fresh();
    const pinned = seedWithOrbit("hexagon", 12, 6);
    const free = seedWithOrbit("hexagon", 12, 12);
    commitProposal(mixed, "hexagon", plain(12), [pinned, free], () =>
      plainPlan("hexad", BASE)
    );
    const tree = gestureLayers(mixed.history, book);
    expect(tree.length).toBe(1);
    expect(tree[0].mode).toBe(12);
    // No `orbit` on the parent: the two groups disagree, and stating either
    // number would be a lie about the other.
    expect(tree[0].orbit).toBeUndefined();
    expect(tree[0].children?.length).toBe(2);
    expect(tree[0].children?.map((c) => c.orbit)).toEqual([6, 12]);
  });

  it("stampGroups is the orbit itself for a plain brush, and drops the empty", () => {
    const surface = surfaceOf("hexagon");
    const orbit = clipStamp(brushStamp(surface, bands, 40, plain(6)), ALL);
    // `groups` is null for a plain orbit — there is no grouping, not a grouping
    // of one — so the orbit itself is the group.
    expect(orbit.groups).toBeNull();
    expect(stampGroups(orbit)).toEqual([orbit.cells]);

    // Clipped to nothing, a band's image groups all empty out. They must not be
    // recorded: `gestureLayers` numbers its children off this list and an empty
    // entry would give a child the size of the wrong orbit. `clipStamp` keeps
    // the emptied groups deliberately — `keys` indexes into the cell list by
    // position, so compacting them there would re-point every later key — which
    // is exactly why the filter has to happen HERE and not there.
    const band = seedStamp(surface, bands, 40, { mode: 6, band: "A" }, () => false);
    expect(band.groups?.length).toBe(6);
    expect(band.groups?.every((g) => g.length === 0)).toBe(true);
    expect(stampGroups(band)).toEqual([]);
  });
});
