/**
 * Drilling in, measured where there is arithmetic to measure.
 *
 * ── What this file can and cannot reach, stated first ───────────────────
 *
 * Vitest runs this suite in a `node` environment with NO jsdom (see
 * `vitest.config.ts`). There is no document, so `draw/page.tsx` cannot be
 * rendered and nothing here presses a button, dispatches a pointer event or
 * inspects a rendered tree. Everything the page does with the focus — the
 * breadcrumb, the dim layer, the Escape chain, the two keys, the guards on
 * `paintAt` and `propose` — is verified by STRUCTURE and by reading, not by
 * this file, and the report that accompanied this change says so plainly.
 *
 * What IS reachable is the arithmetic, and it was deliberately put where it
 * could be reached: `focusFrame` and `isDoubleTap` are pure functions exported
 * from `DrawBoard.tsx` rather than closures inside the component, precisely so
 * that the two decisions with a right and a wrong answer — where the camera goes,
 * and whether two presses are one gesture — are measurable without a DOM.
 *
 * ── The house rule this file is written under ───────────────────────────
 *
 * The geometry is the REAL geometry: `buildHexagon` then `plateFrame`, the same
 * two calls `page.tsx` makes, and the focused cells come from `focusCells` with
 * the same `sectorResolver` and `armResolver` the page builds. Nothing is a
 * hand-written fixture. That is the rule `test/focus.test.ts` and
 * `test/arms.test.ts` are written under and for the same reason: a fixture
 * written by the same hand as the implementation agrees with it about exactly
 * the things a test exists to catch.
 */

import { describe, expect, it } from "vitest";
import {
  DOUBLE_TAP_MS,
  focusFrame,
  isDoubleTap,
  type BoardGeometry,
} from "../src/components/DrawBoard";
import { buildHexagon } from "../src/lib/hexagon";
import { plateFrame } from "../src/lib/view";
import {
  ROOT,
  armResolver,
  armStep,
  enter,
  focusCells,
  gestureFor,
  hexagonDeeper,
  sectorResolver,
  sectorStep,
  seedMask,
  type FocusPath,
  type FocusResolvers,
} from "../src/lib/focus";

/** The zoom ceiling the page uses. Repeated rather than imported — see below. */
const ZOOM_MAX = 8;

const DEPTH = 3;

/**
 * The board geometry for the whole plate, exactly as `page.tsx` assembles it.
 *
 * `seamWidth` and `outline` are not read by `focusFrame`; they are here so the
 * value is a real `BoardGeometry` rather than a partial one cast into place,
 * which would let a future field be forgotten silently.
 */
function plate(depth = DEPTH): {
  hex: ReturnType<typeof buildHexagon>;
  geom: BoardGeometry;
  resolvers: FocusResolvers;
} {
  const hex = buildHexagon(depth);
  const pf = plateFrame(hex, { mode: "hexagon", sector: 0 });
  return {
    hex,
    geom: {
      width: pf.width,
      height: pf.height,
      outline: pf.outline,
      cells: pf.cells,
      seamWidth: pf.edge / 16,
    },
    resolvers: {
      sector: sectorResolver(hex.cells),
      arm: armResolver(hex.cells),
    },
  };
}

const held = (
  path: FocusPath,
  resolvers: FocusResolvers,
  count: number
): number[] => focusCells(path, resolvers, count);

/** The window a `{zoom, cx, cy}` names, in canvas units. Mirrors `view`. */
const windowOf = (
  geom: BoardGeometry,
  f: { zoom: number; cx: number; cy: number }
) => {
  const w = geom.width / f.zoom;
  const h = geom.height / f.zoom;
  return { x0: f.cx - w / 2, x1: f.cx + w / 2, y0: f.cy - h / 2, y1: f.cy + h / 2 };
};

describe("focusFrame — where the camera goes", () => {
  it("has nothing to say about an empty focus", () => {
    const { geom } = plate();
    // `focusCells` documents that it MAY be empty — a fresh layer, a hidden
    // layer, an erase gesture, a query that matched nothing — and the documented
    // answer is to keep the frame you have. `null` is that answer.
    expect(focusFrame(geom, [], ZOOM_MAX)).toBeNull();
  });

  it("has nothing to say about cells that are not on this geometry", () => {
    const { geom } = plate();
    // The page hands over MODEL indices and a framed sector's geometry carries
    // only the ones it draws, so this is an ordinary state rather than a bug —
    // and it must not throw, and must not return a box built from `undefined`.
    expect(focusFrame(geom, [999999, -1], ZOOM_MAX)).toBeNull();
  });

  it("frames the whole plate at 1x, dead centre", () => {
    const { geom, hex } = plate();
    const all = hex.cells.map((c) => c.i);
    const f = focusFrame(geom, all, ZOOM_MAX);
    expect(f).not.toBeNull();
    // The box IS the figure, so the requested fit is under 1 once the margin is
    // added, and the clamp holds it at 1 — which is the state the board has
    // always been in and the `viewBox` it has always emitted.
    expect(f!.zoom).toBe(1);
    expect(f!.cx).toBeCloseTo(geom.width / 2, 6);
    expect(f!.cy).toBeCloseTo(geom.height / 2, 6);
  });

  it("zooms further the deeper the focus goes: plate < sector < arm", () => {
    const { geom, hex, resolvers } = plate();
    const n = hex.cells.length;

    const sector = [sectorStep(2)];
    const arm = enter(sector, armStep("A"));

    const whole = focusFrame(geom, hex.cells.map((c) => c.i), ZOOM_MAX)!;
    const inSector = focusFrame(geom, held(sector, resolvers, n), ZOOM_MAX)!;
    const inArm = focusFrame(geom, held(arm, resolvers, n), ZOOM_MAX)!;

    expect(inSector.zoom).toBeGreaterThan(whole.zoom);
    expect(inArm.zoom).toBeGreaterThan(inSector.zoom);
    // And every one of them is a legal zoom for the stepper to carry on from.
    for (const f of [whole, inSector, inArm]) {
      expect(f.zoom).toBeGreaterThanOrEqual(1);
      expect(f.zoom).toBeLessThanOrEqual(ZOOM_MAX);
    }
  });

  it("puts every focused cell inside the window, at every level", () => {
    // THE CLAIM THE GESTURE MAKES. "Zooms in so the triangle fills the canvas"
    // is worth nothing if it also crops it, and cropping is exactly what a box
    // taken over CENTROIDS would do — see the note on `focusFrame`. So this walks
    // vertices, which is the thing that can catch it.
    const { geom, hex, resolvers } = plate();
    const n = hex.cells.length;

    const paths: FocusPath[] = [];
    for (let s = 0; s < 6; s++) {
      paths.push([sectorStep(s)]);
      for (const a of ["A", "B", "C"] as const) {
        paths.push([sectorStep(s), armStep(a)]);
      }
    }

    for (const path of paths) {
      const cells = held(path, resolvers, n);
      expect(cells.length).toBeGreaterThan(0);
      const f = focusFrame(geom, cells, ZOOM_MAX);
      expect(f, `${path.map((s) => s.id).join("/")} framed nothing`).not.toBeNull();
      const win = windowOf(geom, f!);
      for (const i of cells) {
        for (const [x, y] of geom.cells[i].verts) {
          // A hair of tolerance for the float the view layer works in — the
          // model is exact, the pixels it is drawn at are not.
          expect(x).toBeGreaterThanOrEqual(win.x0 - 1e-6);
          expect(x).toBeLessThanOrEqual(win.x1 + 1e-6);
          expect(y).toBeGreaterThanOrEqual(win.y0 - 1e-6);
          expect(y).toBeLessThanOrEqual(win.y1 + 1e-6);
        }
      }
    }
  });

  it("leaves a margin — the focus does not touch the frame's edge", () => {
    const { geom, hex, resolvers } = plate();
    const path = [sectorStep(0)];
    const cells = held(path, resolvers, hex.cells.length);
    const f = focusFrame(geom, cells, ZOOM_MAX)!;
    // Only meaningful while the clamp is not in force; a clamped frame is
    // larger than asked for and its margin is not this function's answer.
    expect(f.zoom).toBeLessThan(ZOOM_MAX);
    const win = windowOf(geom, f);
    let minX = Infinity;
    let maxX = -Infinity;
    for (const i of cells) {
      for (const [x] of geom.cells[i].verts) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
    // Strictly inside on both sides, so the outer ring of the focused thing is
    // not sitting on the edge of the picture.
    expect(minX).toBeGreaterThan(win.x0);
    expect(maxX).toBeLessThan(win.x1);
  });

  it("obeys the ceiling on a focus small enough to want more", () => {
    // One cell. `bw` and `bh` are both tiny but non-zero, so the requested fit
    // is enormous and the clamp is the only thing standing between the user and
    // a viewBox the size of a triangle.
    const { geom } = plate();
    const f = focusFrame(geom, [0], ZOOM_MAX)!;
    expect(f.zoom).toBe(ZOOM_MAX);
  });

  it("keeps the margin proportional, so depth does not change the gap", () => {
    // A pixel inset would be a different visual gap at every depth. The same
    // sector framed at two depths must therefore land on the SAME zoom, because
    // a sector is the same fraction of the plate however finely it is cut.
    const shallow = plate(2);
    const deep = plate(4);
    const a = focusFrame(
      shallow.geom,
      held([sectorStep(1)], shallow.resolvers, shallow.hex.cells.length),
      ZOOM_MAX
    )!;
    const b = focusFrame(
      deep.geom,
      held([sectorStep(1)], deep.resolvers, deep.hex.cells.length),
      ZOOM_MAX
    )!;
    expect(a.zoom).toBeCloseTo(b.zoom, 6);
  });
});

describe("what the dim layer shows and what a tap on it does", () => {
  it("dims exactly the cells a double-tap would exit from", () => {
    /**
     * THE INVARIANT THE WHOLE GESTURE RESTS ON, and it is not a tautology.
     *
     * The board dims the complement of `focusCells`, which is built on
     * `holdMask`. `gestureFor` decides exit against `seedMask`. Those are two
     * different masks — `focus.ts` splits them on purpose and gives the bug that
     * forced the split — so "the cells that look inert" and "the cells that step
     * you back out" agreeing is a fact about SECTORS AND ARMS specifically, both
     * of which mask, and not a fact about the mechanism.
     *
     * It would be FALSE for a layer or a gesture step, which hold cells without
     * masking: those dim something and exit nowhere, which `focus.ts` states
     * outright. The page pushes neither today; when the panel and the filmstrip
     * do, this test is the one that will say what changed.
     */
    const { hex, resolvers } = plate();
    const n = hex.cells.length;
    const deeper = hexagonDeeper(hex.cells);

    for (const path of [[sectorStep(4)], [sectorStep(4), armStep("B")]]) {
      const inside = new Set(held(path, resolvers, n));
      const mask = seedMask(path, resolvers);
      for (let i = 0; i < n; i++) {
        const dimmed = !inside.has(i);
        const exits = gestureFor(path, i, resolvers, deeper)?.act === "exit";
        expect(exits, `cell ${i} dimmed=${dimmed} exits=${exits}`).toBe(dimmed);
        expect(mask(i)).toBe(!dimmed);
      }
    }
  });

  it("dims nothing at the root, and no tap there can exit", () => {
    const { hex, resolvers } = plate();
    const n = hex.cells.length;
    const deeper = hexagonDeeper(hex.cells);
    // `focusCells(ROOT)` is every cell, which is why the page passes `null`
    // rather than this set — there is no focus, not a focus that admits
    // everything. Either way nothing is outside, so nothing can step out.
    expect(held(ROOT, resolvers, n)).toHaveLength(n);
    for (let i = 0; i < n; i++) {
      expect(gestureFor(ROOT, i, resolvers, deeper)?.act).not.toBe("exit");
    }
  });
});

describe("isDoubleTap — the guard on the gesture", () => {
  it("is false with nothing to pair with", () => {
    expect(isDoubleTap(null, 7, 100)).toBe(false);
  });

  it("is false across two different cells, however quick", () => {
    // TAP_SLOP covers the hand's wobble WITHIN one press and deliberately does
    // not smear across cells: on a plate whose cells are the things being
    // addressed, two taps a cell apart are two taps.
    expect(isDoubleTap({ cell: 7, t: 100 }, 8, 101)).toBe(false);
  });

  it("is true on the same cell inside the window, and false outside it", () => {
    const prev = { cell: 7, t: 1000 };
    expect(isDoubleTap(prev, 7, 1000)).toBe(true);
    expect(isDoubleTap(prev, 7, 1000 + DOUBLE_TAP_MS - 1)).toBe(true);
    // The boundary is inclusive, and stated rather than left to be discovered.
    expect(isDoubleTap(prev, 7, 1000 + DOUBLE_TAP_MS)).toBe(true);
    expect(isDoubleTap(prev, 7, 1000 + DOUBLE_TAP_MS + 1)).toBe(false);
  });

  it("refuses a clock that appears to run backwards", () => {
    // Two listeners feed this — a press on the element, a release on the window
    // — and a negative delta must not read as an instant double-tap. Without the
    // `dt >= 0` test this is `true`, because a negative number is `<= 400`.
    expect(isDoubleTap({ cell: 7, t: 1000 }, 7, 900)).toBe(false);
  });

  it("takes a narrower window when it is given one", () => {
    expect(isDoubleTap({ cell: 1, t: 0 }, 1, 200, 100)).toBe(false);
    expect(isDoubleTap({ cell: 1, t: 0 }, 1, 90, 100)).toBe(true);
  });
});
