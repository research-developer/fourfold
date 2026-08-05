/**
 * The focus stack, measured against the machinery it generalises.
 *
 * Every gesture in here is made by the REAL brush — `orbit.ts` for the symmetry,
 * `brush.ts` for the stamp, `plate.ts` for the edits, `provenance.ts` for the
 * layers — and never by a hand-written fixture. That is the same rule
 * `test/provenance.test.ts` and `test/arms.test.ts` are written under, and for
 * the same reason: the things these tests exist to catch are a focus that
 * silently changes the GROUP a stroke is made in and a clip that silently
 * changes the CELLS it lands on, and a fixture written by the same hand as the
 * implementation would agree with it about exactly those.
 */

import { describe, expect, it } from "vitest";
import { armCells, armMask, armOf, clipStamp, ARMS, type Arm } from "../src/lib/arms";
import { buildBandSurface } from "../src/lib/bands";
import { brushStamp, type BrushShape } from "../src/lib/brush";
import { buildFigure } from "../src/lib/figure";
import { buildHexagon } from "../src/lib/hexagon";
import {
  addLayer,
  effectiveOf,
  find,
  fromPlate,
  newSession,
  setVisible,
  type Composition,
  type LayerId,
} from "../src/lib/layers";
import {
  hexagonSurface,
  triangleSurface,
  TRIANGLE_MODES,
  SCOPE_MODES,
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
import { byMode, gestureLayers, unmarked } from "../src/lib/provenance";
import { mergeEdits, type CellEdit, type Stroke, type StrokeMark } from "../src/lib/strokes";
import type { EmitLayer } from "../src/lib/emit";
import {
  ROOT,
  armResolver,
  armStep,
  clipMask,
  enter,
  exit,
  exitTo,
  focusCells,
  focusedArm,
  focusedGestures,
  focusedSector,
  gestureFor,
  gestureIds,
  gestureResolver,
  gestureStep,
  hexagonDeeper,
  holdMask,
  isAncestor,
  layerResolver,
  layerStep,
  pathLabel,
  pinnedGestures,
  samePath,
  scopeFor,
  sectorResolver,
  sectorStep,
  seedMask,
  setResolver,
  tip,
  type FocusResolvers,
} from "../src/lib/focus";

// ── the canvases ─────────────────────────────────────────────────────────

const DEPTH = 3;
const hex = buildHexagon(DEPTH);
const book = addressBook(hex);
const hexBands = buildBandSurface(hex);
const surfaceOf = (scope: BrushScope): SymmetrySurface => hexagonSurface(hex, scope);
const deeper = hexagonDeeper(hex.cells);

const sectorOnly: FocusResolvers = { sector: sectorResolver(hex.cells) };

/** The first cell of a sector, so a seed is chosen by the figure and not by luck. */
const cellIn = (sector: number): number =>
  hex.cells.find((c) => c.sector === sector)!.i;

// ── the harness: gestures made the way the program makes them ────────────

interface Session {
  plate: AddressPlate;
  past: Stroke<Address>[];
}

const fresh = (): Session => ({ plate: new Map<Address, string>(), past: [] });

/**
 * One committed gesture. `draw/page.tsx`'s `paintAt` + `endStroke` with the UI
 * taken out, and the same harness `test/provenance.test.ts` uses.
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
    const stamp = brushStamp(surface, hexBands, seed, shape);
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

const plain = (mode: BrushMode): BrushShape => ({ mode, band: null });

/** The first cell whose orbit under `mode` has exactly `size` members. */
function seedWithOrbit(scope: BrushScope, mode: BrushMode, size: number): number {
  const surface = surfaceOf(scope);
  for (let i = 0; i < surface.cellCount; i++) {
    if (surface.orbit(i, mode).length === size) return i;
  }
  throw new Error(`no cell of ${scope} has a ${size}-cell orbit at mode ${mode}`);
}

/** What a layer contributes to the board: its own cells, or none when hidden. */
function layerCells(comp: Composition, id: string): number[] {
  const layer = find(comp, id as LayerId);
  if (layer === null) return [];
  const eff = effectiveOf(comp, id as LayerId);
  if (eff === null || !eff.shown) return [];
  return [...resolvePlate(layer.plate, book).keys()];
}

// ── the algebra ──────────────────────────────────────────────────────────

describe("the focus stack is an algebra", () => {
  it("enters, and re-entering the step you are in is the identity", () => {
    const p1 = enter(ROOT, sectorStep(2));
    expect(p1).toEqual([sectorStep(2)]);
    const p2 = enter(p1, armStep("A"));
    expect(p2).toHaveLength(2);
    // The SAME path object back, not a copy: a double-tap on the thing you are
    // already inside must not make React think the focus changed.
    expect(enter(p2, armStep("A"))).toBe(p2);
    expect(enter(p1, sectorStep(2))).toBe(p1);
    // A different id at the same kind is a genuine move, not an identity.
    expect(enter(p1, sectorStep(3))).toHaveLength(2);
  });

  it("exits one level, and the root is its own parent", () => {
    const p = [sectorStep(2), armStep("B")];
    expect(exit(p)).toEqual([sectorStep(2)]);
    expect(exit(exit(p))).toEqual(ROOT);
    // Total at the root, and the same object back so a stray double-tap on the
    // whole plate is not a state change.
    expect(exit(ROOT)).toBe(ROOT);
  });

  it("exitTo clamps rather than throwing, at both ends", () => {
    const p = [sectorStep(2), armStep("B")];
    expect(exitTo(p, 0)).toEqual(ROOT);
    expect(exitTo(p, -4)).toEqual(ROOT);
    expect(exitTo(p, 1)).toEqual([sectorStep(2)]);
    expect(exitTo(p, 2)).toBe(p);
    expect(exitTo(p, 99)).toBe(p);
    expect(exitTo(ROOT, 3)).toEqual(ROOT);
    // A breadcrumb rendered from a stale path is a race the UI can lose, and
    // losing it must not be a thrown error or a NaN-shaped path.
    expect(exitTo(p, Number.NaN)).toEqual(ROOT);
  });

  it("decides ancestry and equality", () => {
    const s2 = [sectorStep(2)];
    const s2a = [sectorStep(2), armStep("A")];
    const s3 = [sectorStep(3)];
    expect(isAncestor(ROOT, s2a)).toBe(true);
    expect(isAncestor(s2, s2a)).toBe(true);
    expect(isAncestor(s2a, s2a)).toBe(true);
    expect(isAncestor(s2a, s2)).toBe(false);
    expect(isAncestor(s3, s2a)).toBe(false);
    expect(samePath(s2a, [sectorStep(2), armStep("A")])).toBe(true);
    expect(samePath(s2a, s2)).toBe(false);
    expect(samePath(ROOT, [])).toBe(true);
  });

  it("reads the tip and the deepest step of a kind", () => {
    const p = [layerStep("L2"), sectorStep(4), armStep("C")];
    expect(tip(p)).toEqual(armStep("C"));
    expect(tip(ROOT)).toBeUndefined();
    expect(focusedSector(p)).toBe(4);
    expect(focusedArm(p)).toBe("C");
    expect(focusedSector(ROOT)).toBeNull();
    expect(focusedArm([sectorStep(1)])).toBeNull();
  });

  it("labels the path", () => {
    expect(pathLabel(ROOT)).toBe("the whole plate");
    expect(pathLabel([sectorStep(2)])).toBe("sector 2");
    expect(pathLabel([sectorStep(2), armStep("A")])).toBe("sector 2 · arm A");
    expect(pathLabel([gestureStep(["g3"])])).toBe("gesture g3");
    expect(pathLabel([gestureStep(["g3", "g1", "g0"])])).toBe("3 gestures");
    expect(pathLabel([gestureStep([])])).toBe("no gestures");
  });
});

// ── BUG A ────────────────────────────────────────────────────────────────

describe("BUG A — a layer is a write target, not a region", () => {
  /**
   * The bug, in one sentence: a layer that paints no cells holds no cells, so a
   * masking layer step made `seedMask` false everywhere, so EVERY double-tap
   * read as landing outside the focus and answered `exit`. You could never stay
   * inside a layer you had just created.
   *
   * These two cases fail against a layer resolver that masks; the fix is
   * `masks: false`, and the region resolver below shows the distinction is real
   * rather than a blanket loosening.
   */
  it("lets you drill in from a layer you just made, which paints nothing", () => {
    const s = addLayer(
      newSession(fromPlate(new Map([[book.addr[10], "#c0392b"]]))),
      "fresh"
    );
    const id = s.composition.selected as LayerId;
    expect(layerCells(s.composition, id)).toEqual([]);

    const resolvers: FocusResolvers = {
      sector: sectorResolver(hex.cells),
      layer: layerResolver((k) => layerCells(s.composition, k)),
    };
    const path = [layerStep(id)];
    expect(gestureFor(path, 10, resolvers, deeper)).toEqual({
      act: "enter",
      step: sectorStep(hex.cells[10].sector),
    });
    // Every cell of the plate, not merely the one that happens to be painted.
    for (const i of [0, 10, 200, hex.cells.length - 1]) {
      expect(gestureFor(path, i, resolvers, deeper)).toEqual({
        act: "enter",
        step: sectorStep(hex.cells[i].sector),
      });
    }
  });

  it("lets you drill in from a hidden layer, which contributes nothing", () => {
    const base = fromPlate(new Map([[book.addr[10], "#c0392b"]]));
    const id = base.selected as LayerId;
    const comp = setVisible(base, id, false);
    expect(layerCells(comp, id)).toEqual([]);

    const resolvers: FocusResolvers = {
      sector: sectorResolver(hex.cells),
      layer: layerResolver((k) => layerCells(comp, k)),
    };
    expect(gestureFor([layerStep(id)], 10, resolvers, deeper)).toEqual({
      act: "enter",
      step: sectorStep(hex.cells[10].sector),
    });
  });

  it("still HOLDS the cells it paints, so the display can frame them", () => {
    // `masks: false` must not mean "holds everything". A layer answering true
    // everywhere would make "highlight what I selected" light the whole plate.
    const painted = [book.addr[10], book.addr[11]] as Address[];
    const comp = fromPlate(new Map(painted.map((a) => [a, "#c0392b"])));
    const id = comp.selected as LayerId;
    const resolvers: FocusResolvers = {
      layer: layerResolver((k) => layerCells(comp, k)),
    };
    const path = [layerStep(id)];
    expect(focusCells(path, resolvers, hex.cells.length)).toEqual([10, 11]);
    // …and the hand is free anyway.
    const seed = seedMask(path, resolvers);
    expect(hex.cells.every((c) => seed(c.i))).toBe(true);
  });

  it("a REGION stated as a set still masks — the loosening is not blanket", () => {
    const resolvers: FocusResolvers = { layer: setResolver(() => [10, 11]) };
    const seed = seedMask([layerStep("R")], resolvers);
    expect(seed(10)).toBe(true);
    expect(seed(12)).toBe(false);
  });

  it("a non-masking focus can never be exited by a tap — that is the design", () => {
    // There is no "outside" a sheet you are writing on, so leaving a layer is a
    // panel act (`exit`/`exitTo`), never a canvas gesture. Stated as a test so
    // that a future change which makes it exit is caught rather than welcomed.
    const comp = fromPlate(new Map([[book.addr[10], "#c0392b"]]));
    const id = comp.selected as LayerId;
    const resolvers: FocusResolvers = {
      layer: layerResolver((k) => layerCells(comp, k)),
    };
    const path = [layerStep(id)];
    for (const i of [0, 10, 300]) {
      expect(gestureFor(path, i, resolvers, deeper)).not.toEqual({ act: "exit" });
    }
    expect(exit(path)).toEqual(ROOT);
  });
});

// ── BUG B ────────────────────────────────────────────────────────────────

describe("BUG B — repeatAll names a group, and the root has one", () => {
  it("honours repeatAll at the root", () => {
    // `page.tsx`'s `noteSector` sets the active sector from the cell UNDER THE
    // POINTER, so a sector6 brush at the root has a sector to repeat: the
    // seed's own. One stroke lands in all six at once — see the property below.
    expect(scopeFor(ROOT, true)).toBe("sector6");
    expect(scopeFor(ROOT, false)).toBe("hexagon");
  });

  it("gives the whole three-way answer", () => {
    expect(scopeFor([sectorStep(2)], false)).toBe("sector");
    expect(scopeFor([sectorStep(2)], true)).toBe("sector6");
    // An arm never changes the group; it changes which cells survive.
    expect(scopeFor([sectorStep(2), armStep("A")], false)).toBe("sector");
    expect(scopeFor([sectorStep(2), armStep("A")], true)).toBe("sector6");
    expect(scopeFor([armStep("A")], false)).toBe("hexagon");
    // A layer or a gesture on the path is not a sector and must not read as one.
    expect(scopeFor([layerStep("L2")], false)).toBe("hexagon");
    expect(scopeFor([gestureStep(["g0"])], false)).toBe("hexagon");
    expect(scopeFor([layerStep("L2"), sectorStep(1)], false)).toBe("sector");
  });

  it("MEASURED: turning repeatAll on at the root costs mode 12", () => {
    // C6 × D3 does not contain D6's reflections, so the caller must clamp. This
    // is a fact about the groups; it is asserted so the comment cannot drift.
    expect(SCOPE_MODES[scopeFor(ROOT, false)]).toContain(12);
    expect(SCOPE_MODES[scopeFor(ROOT, true)]).not.toContain(12);
  });
});

// ── the seed/clip split ──────────────────────────────────────────────────

describe("the seed/clip split is what keeps sector6 meaningful", () => {
  it("PROPERTY: a sector6 stroke inside an isolated sector reaches all six", () => {
    const path = [sectorStep(2)];
    const scope = scopeFor(path, true);
    expect(scope).toBe("sector6");

    const surface = surfaceOf(scope);
    const clip = clipMask(path, sectorOnly);
    const seeds = hex.cells.filter((c) => c.sector === 2).slice(0, 12);
    expect(seeds.length).toBeGreaterThan(0);

    for (const seed of seeds) {
      for (const mode of [1, 2, 3, 6] as BrushMode[]) {
        const stamp = brushStamp(surface, hexBands, seed.i, plain(mode));
        const clipped = clipStamp(stamp, clip);
        // Nothing is trimmed: a sector does not clip.
        expect(clipped.cells).toEqual(stamp.cells);
        const touched = new Set(clipped.cells.map((i) => hex.cells[i].sector));
        expect([...touched].sort()).toEqual([0, 1, 2, 3, 4, 5]);
      }
    }
  });

  it("MEASURED: what clipping the sector would have cost", () => {
    // The counterfactual, so the header's claim is a number rather than a
    // worry: intersect the same stamp with the sector and sector6 collapses
    // onto sector — the toggle becomes a control that does nothing.
    const path = [sectorStep(2)];
    const surface = surfaceOf("sector6");
    const hold = holdMask(path, sectorOnly);
    // A seed the local D3 does not pin, so the arithmetic is the clean one:
    // |C6 × D3| = 36, and the sector's own D3 gives 6 of them.
    const seed = hex.cells.find(
      (c) => c.sector === 2 && surfaceOf("sector").orbit(c.i, 6).length === 6
    )!.i;
    const stamp = brushStamp(surface, hexBands, seed, plain(6));
    const wrong = clipStamp(stamp, hold);
    expect(stamp.cells).toHaveLength(36);
    expect(wrong.cells).toHaveLength(6);
    expect(wrong.cells).toEqual(surfaceOf("sector").orbit(seed, 6));
  });

  it("but the SEED is confined: the pointer may not leave the sector", () => {
    const path = [sectorStep(2)];
    const seed = seedMask(path, sectorOnly);
    for (const c of hex.cells) expect(seed(c.i)).toBe(c.sector === 2);
    // And a tap outside is the exit gesture, one level.
    expect(gestureFor(path, cellIn(3), sectorOnly, deeper)).toEqual({ act: "exit" });
    // Inside, it drills to the arm the cell is in.
    const inArm = hex.cells.find((c) => c.sector === 2 && c.addr.replace(/X/g, "") !== "")!;
    expect(gestureFor(path, inArm.i, sectorOnly, deeper)).toEqual({
      act: "enter",
      step: armStep(inArm.addr.replace(/X/g, "")[0] as Arm),
    });
  });

  it("the root is free, and holds everything", () => {
    const seed = seedMask(ROOT, sectorOnly);
    expect(hex.cells.every((c) => seed(c.i))).toBe(true);
    expect(focusCells(ROOT, sectorOnly, hex.cells.length)).toHaveLength(
      hex.cells.length
    );
    // Nothing to exit from, and nothing outside to tap.
    expect(gestureFor(ROOT, 0, sectorOnly, deeper)).toEqual({
      act: "enter",
      step: sectorStep(hex.cells[0].sector),
    });
  });
});

// ── arms, through the focus rather than through `armMask` ────────────────

describe("an arm focus clips exactly as arms.ts documents", () => {
  const f = buildFigure(4);
  const armOnly: FocusResolvers = { arm: armResolver(f.cells) };
  const surface = triangleSurface(f);
  const bands = buildBandSurface(f);

  it("is the same predicate as armMask, cell for cell", () => {
    // The generalisation must not be a second notion of an arm. This is the
    // claim `arms.armMaskOver` makes in its own comment, checked.
    for (const arm of ARMS) {
      const viaFocus = clipMask([armStep(arm)], armOnly);
      const viaArms = armMask(f, arm);
      for (const c of f.cells) expect(viaFocus(c.i)).toBe(viaArms(c.i));
      expect(viaFocus(f.hub)).toBe(false);
    }
  });

  it("MEASURED: inside an arm mode 3 collapses to mode 1 and mode 6 to mode 2", () => {
    // Built from the real machinery, exactly as `test/arms.test.ts` builds it,
    // so it would catch the MODEL changing and not merely this module.
    const sizes = (arm: Arm, mode: BrushMode) => {
      const keep = clipMask([armStep(arm)], armOnly);
      const out = new Set<number>();
      for (const seed of armCells(f, arm)) {
        out.add(
          clipStamp(brushStamp(surface, bands, seed, plain(mode)), keep).cells.length
        );
      }
      return [...out].sort((a, b) => a - b);
    };
    expect(sizes("A", 1)).toEqual([1]);
    expect(sizes("A", 3)).toEqual([1]);
    // Arm A's setwise stabiliser IS ⟨m_A⟩, which is mode 2, so mode 2 survives
    // untouched there — 2 cells generically, 1 where m_A pins the cell.
    expect(sizes("A", 2)).toEqual([1, 2]);
    expect(sizes("A", 6)).toEqual([1, 2]);
    for (const arm of ["B", "C"] as Arm[]) {
      expect(sizes(arm, 3)).toEqual([1]);
      expect(sizes(arm, 6)).toEqual([1, 2]);
      expect(sizes(arm, 2)).toEqual([1]);
    }
  });

  it("clipping is exactly the intersection with the arm, never more", () => {
    const g = buildFigure(3);
    const small: FocusResolvers = { arm: armResolver(g.cells) };
    const s = triangleSurface(g);
    const b = buildBandSurface(g);
    for (const arm of ARMS) {
      const keep = clipMask([armStep(arm)], small);
      const inArm = new Set(armCells(g, arm));
      for (const c of g.cells) {
        for (const mode of TRIANGLE_MODES) {
          const full = brushStamp(s, b, c.i, plain(mode));
          expect(clipStamp(full, keep).cells).toEqual(
            full.cells.filter((i) => inArm.has(i))
          );
        }
      }
    }
  });

  it("an arm both masks and clips, and a sector only masks", () => {
    const both: FocusResolvers = {
      arm: armResolver(f.cells),
      sector: sectorResolver(f.cells.map(() => ({ sector: 0 }))),
    };
    const path = [sectorStep(0), armStep("A")];
    const seed = seedMask(path, both);
    const clip = clipMask(path, both);
    const inA = new Set(armCells(f, "A"));
    for (const c of f.cells) {
      expect(seed(c.i)).toBe(inA.has(c.i));
      expect(clip(c.i)).toBe(inA.has(c.i));
    }
    expect(armOf(f, f.hub)).toBeNull();
    expect(seed(f.hub)).toBe(false);
  });
});

// ── gestures as a focusable thing ────────────────────────────────────────

describe("a gesture focus", () => {
  /** Three plain gestures and one erase, all through the real brush. */
  function history(): { layers: EmitLayer[]; s: Session } {
    const s = fresh();
    commit(s, "hexagon", plain(6), [seedWithOrbit("hexagon", 6, 6)], "#c0392b");
    commit(s, "hexagon", plain(3), [seedWithOrbit("hexagon", 3, 3)], "#2e86c1");
    commit(s, "hexagon", plain(6), [seedWithOrbit("hexagon", 6, 6) + 1], "#1e8449");
    return { layers: gestureLayers(s.past, book), s };
  }

  it("spells a SET as one canonical step", () => {
    const a = gestureStep(["g2", "g0", "g1"]);
    const b = gestureStep(["g1", "g2", "g0", "g0"]);
    expect(a).toEqual(b);
    expect(gestureIds(a)).toEqual(["g0", "g1", "g2"]);
    // Canonicity is what makes the whole algebra work on selections for free.
    expect(samePath([a], [b])).toBe(true);
    expect(enter([a], b)).toEqual([a]);
    expect(focusedGestures([sectorStep(1), a])).toEqual(["g0", "g1", "g2"]);
    expect(focusedGestures(ROOT)).toEqual([]);
    expect(gestureIds(sectorStep(2))).toEqual([]);
    expect(gestureIds(gestureStep([]))).toEqual([]);
  });

  it("isolates ONE gesture: exactly the cells that gesture painted", () => {
    const { layers } = history();
    const resolvers: FocusResolvers = { gesture: gestureResolver(layers) };
    const one = layers[1];
    const cells = focusCells([gestureStep([one.id])], resolvers, hex.cells.length);
    expect(cells).toEqual([...(one.paint as ReadonlyMap<number, string>).keys()].sort((a, b) => a - b));
    expect(cells).toHaveLength(3);
  });

  it("isolates a SET — 'every 6-fold gesture' — via provenance's own query", () => {
    const { layers } = history();
    const resolvers: FocusResolvers = { gesture: gestureResolver(layers) };
    // The selection is `provenance.byMode`, unchanged and not reimplemented.
    const ids = byMode(layers, 6);
    expect([...ids].sort()).toEqual(["g0", "g2"]);
    const step = gestureStep(ids);
    const cells = focusCells([step], resolvers, hex.cells.length);
    const want = new Set<number>();
    for (const id of ids) {
      const l = layers.find((x) => x.id === id) as EmitLayer;
      for (const i of (l.paint as ReadonlyMap<number, string>).keys()) want.add(i);
    }
    expect(cells).toEqual([...want].sort((a, b) => a - b));
    expect(cells).toHaveLength(12);
    expect(pathLabel([step])).toBe("2 gestures");
  });

  it("refines: a gesture step inside another intersects to the subset", () => {
    const { layers } = history();
    const resolvers: FocusResolvers = { gesture: gestureResolver(layers) };
    const all = gestureStep(byMode(layers, 6));
    const one = gestureStep(["g2"]);
    expect(focusCells([all, one], resolvers, hex.cells.length)).toEqual(
      focusCells([one], resolvers, hex.cells.length)
    );
  });

  it("holds a nested gesture's WHOLE subtree, orbits included", () => {
    // A drag whose applications had different orbit sizes is emitted as a
    // parent with one child per orbit, and the parent then carries only the
    // residual. Reading `paint` alone would make it hold a fraction of itself.
    const s = fresh();
    const pinned = book.index.get("s0:AAA") as number;
    const free = seedWithOrbit("sector", 6, 6);
    commit(s, "sector", plain(6), [pinned, free], "#d4a017");
    const layers = gestureLayers(s.past, book);
    expect(layers[0].children).toHaveLength(2);

    const resolvers: FocusResolvers = { gesture: gestureResolver(layers) };
    const whole = focusCells([gestureStep(["g0"])], resolvers, hex.cells.length);
    const kids = layers[0].children as readonly EmitLayer[];
    const union = new Set<number>();
    for (const k of kids) {
      for (const i of (k.paint as ReadonlyMap<number, string>).keys()) union.add(i);
    }
    expect(whole).toEqual([...union].sort((a, b) => a - b));
    expect(whole).toHaveLength(9);
    // And one orbit inside it is addressable on its own.
    expect(
      focusCells([gestureStep([kids[0].id])], resolvers, hex.cells.length)
    ).toHaveLength(3);
  });

  it("DOES NOT MASK: the hand stays free, and an ERASE proves why", () => {
    // An erase is a real gesture with a real mark and NO paint — `provenance`
    // has no spelling for absence. A masking gesture step would make the whole
    // plate inert exactly when you selected the stroke you wanted to look at:
    // BUG A again, in a new costume.
    const s = fresh();
    commit(s, "hexagon", plain(6), [seedWithOrbit("hexagon", 6, 6)], "#c0392b");
    commit(s, "hexagon", plain(6), [seedWithOrbit("hexagon", 6, 6)], null);
    const layers = gestureLayers(s.past, book);
    const erase = layers[1];
    expect(erase.mode).toBe(6);
    expect(erase.paint).toBeUndefined();

    const resolvers: FocusResolvers = { gesture: gestureResolver(layers) };
    const path = [gestureStep([erase.id])];
    expect(focusCells(path, resolvers, hex.cells.length)).toEqual([]);
    const seed = seedMask(path, resolvers);
    expect(hex.cells.every((c) => seed(c.i))).toBe(true);
    // …so a double-tap still drills in rather than throwing you out.
    expect(gestureFor(path, 10, resolvers, deeper)).toEqual({
      act: "enter",
      step: sectorStep(hex.cells[10].sector),
    });
  });

  it("DOES NOT CLIP: a stamp inside a gesture focus is untrimmed", () => {
    // A gesture's cells are a union of orbits of the group it was made under,
    // at the seeds it was made at. Intersecting a fresh stamp with that leaves
    // cells no subgroup selects, so there is no induced action to name — unlike
    // the arm, whose stabiliser ⟨m_D⟩ makes the clip an honest statement.
    const { layers } = history();
    const resolvers: FocusResolvers = { gesture: gestureResolver(layers) };
    const path = [gestureStep(byMode(layers, 6))];
    const surface = surfaceOf("hexagon");
    const clip = clipMask(path, resolvers);
    for (const seed of [0, 5, 100, 383]) {
      const stamp = brushStamp(surface, hexBands, seed, plain(6));
      expect(clipStamp(stamp, clip).cells).toEqual(stamp.cells);
    }
  });

  it("composes with a sector focus, each doing its own job", () => {
    const { layers } = history();
    const resolvers: FocusResolvers = {
      sector: sectorResolver(hex.cells),
      gesture: gestureResolver(layers),
    };
    const path = [sectorStep(2), gestureStep(byMode(layers, 6))];
    // The hold is the intersection…
    const held = focusCells(path, resolvers, hex.cells.length);
    expect(held.every((i) => hex.cells[i].sector === 2)).toBe(true);
    expect(held.length).toBeGreaterThan(0);
    // …and the seed is the sector alone, because the gesture does not mask.
    const seed = seedMask(path, resolvers);
    for (const c of hex.cells) expect(seed(c.i)).toBe(c.sector === 2);
  });

  it("an unmarked gesture is selectable too", () => {
    const s = fresh();
    commit(s, "hexagon", plain(6), [seedWithOrbit("hexagon", 6, 6)], "#c0392b");
    s.past.push({ edits: [{ cell: book.addr[0], from: null, to: "#000000" }] });
    const layers = gestureLayers(s.past, book);
    expect([...unmarked(layers)]).toEqual(["g1"]);
    const resolvers: FocusResolvers = { gesture: gestureResolver(layers) };
    expect(
      focusCells([gestureStep(unmarked(layers))], resolvers, hex.cells.length)
    ).toEqual([0]);
  });
});

// ── the caution ──────────────────────────────────────────────────────────

describe("PINNED is not honest about band gestures, and says so", () => {
  it("MEASURED: sector6 hides a pinned seed from the identity order", () => {
    // Under C6 × D3 the group order is 6·mode, so a genuinely pinned seed can
    // have orbit > mode. `pinnedGestures` therefore REQUIRES `orderOf`.
    const s = fresh();
    const surface = surfaceOf("sector6");
    let seed = -1;
    for (let i = 0; i < surface.cellCount; i++) {
      if (surface.orbit(i, 3).length < surface.order(3)) {
        seed = i;
        break;
      }
    }
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(surface.order(3)).toBe(18);
    expect(surface.orbit(seed, 3)).toHaveLength(6);

    commit(s, "sector6", plain(3), [seed], "#d4a017");
    const layers = gestureLayers(s.past, book);
    expect(layers[0].mode).toBe(3);
    expect(layers[0].orbit).toBe(6);

    // The identity order misses it — 6 is not < 3 — and the true order finds it.
    expect(pinnedGestures(layers, (m) => m).has("g0")).toBe(false);
    expect(pinnedGestures(layers, (m) => 6 * m).has("g0")).toBe(true);
  });

  it("MEASURED: a band gesture reads as pinned when nothing is pinned", () => {
    // The limitation stated on `pinnedGestures`, constructed rather than
    // described. `brushStamp` records the IMAGE BANDS when a band is in play,
    // `StrokeMark` does not say which of the two it holds, and a short band is
    // indistinguishable from a short orbit in the record.
    const s = fresh();
    const surface = surfaceOf("sector");
    const seed = seedWithOrbit("sector", 6, 6);
    // Nothing is pinned: the seed's orbit is the full subgroup.
    expect(surface.orbit(seed, 6)).toHaveLength(6);

    commit(s, "sector", { mode: 6, band: "A" }, [seed], "#7d3c98");
    const layers = gestureLayers(s.past, book);
    const flagged = pinnedGestures(layers, (m) => m);

    // Some recorded group is shorter than the mode — a short BAND, not a short
    // orbit — so the query reports a gesture whose seed has a trivial stabiliser.
    const groups = (s.past[0].mark as StrokeMark<Address>).groups;
    expect(Math.min(...groups.map((g) => g.length))).toBeLessThan(6);
    expect(flagged.size).toBeGreaterThan(0);
    // Nothing in the record could have told them apart: `orbit` here is the size
    // of the recorded GROUP, and the group is a band.
    for (const id of flagged) {
      const l = (layers[0].children ?? layers).find((x) => x.id === id) as EmitLayer;
      expect(l.orbit).toBeLessThan(6);
    }
  });
});
