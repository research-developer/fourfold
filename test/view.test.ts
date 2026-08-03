/**
 * The hexagon is the model; the triangle is a VIEW of one sector of it.
 *
 * Four things had to be true for that to be a reframing rather than a rewrite,
 * and none of them is taken on trust here. Each is measured against the figures
 * themselves:
 *
 *   1  sector 0 IS `buildFigure(d, conv)` — cell for cell, address for address,
 *      and pixel for pixel once the display transform is applied;
 *   2  the triangle's D₃ survives as the SECTOR brush scope, orbit for orbit;
 *   3  a hexagon band clipped to a sector is a triangle row — still 2r+1;
 *   4  the relief's height field, flat on a standalone triangle, is NOT flat on
 *      a sector of the hexagon.
 *
 * Plus the two things a reframing can still break: an old `canvas: "triangle"`
 * file has to keep loading, and a file saved and reloaded has to re-export to
 * the same bytes.
 *
 * The depth cost is REPORTED rather than asserted. A threshold on a timing in a
 * test suite is a flake; the numbers are printed so the choice of ceiling in
 * `artfile.ts` and `page.tsx` can be checked against them.
 */

import { describe, expect, it } from "vitest";
import {
  BAND_FAMILIES,
  bandSizes,
  buildBandSurface,
  sectorBandFamily,
} from "../src/lib/bands";
import { brushStamp } from "../src/lib/brush";
import { buildFigure, CONVENTIONS, TRIANGLE_FRAME } from "../src/lib/figure";
import { stepCursor } from "../src/lib/guides";
import { buildHexagon } from "../src/lib/hexagon";
import { latticeView } from "../src/lib/lattice";
import { hexagonSurface, triangleSurface, type BrushMode } from "../src/lib/orbit";
import {
  addressBook,
  applyPlateEdits,
  planPlateEdits,
  plateEntries,
  plateFromArtPayload,
  plateIntoSector,
  resolvePlate,
  type AddressPlate,
} from "../src/lib/plate";
import { gasketCells, presetColours } from "../src/lib/presets";
import { bandHeight, buildRelief, reliefFrame, restShell } from "../src/lib/relief";
import { artworkSvg } from "../src/lib/strokes";
import {
  affineScale,
  applyAffine,
  invertAffine,
  isSimilarity,
  plateFrame,
  sectorTransform,
  SECTORS,
  wrapSector,
} from "../src/lib/view";
import { extractArt, payloadFromPaint, MAX_DEPTH } from "../src/lib/artfile";

const TRI_MODES: BrushMode[] = [1, 2, 3, 6];
const GOLD = "#d4a017";

// ── 1. sector 0 is the triangle ──────────────────────────────────────────

describe("claim 1 — sector 0 IS the base triangle", () => {
  it("same cells, same order, same addresses, at every depth and convention", () => {
    for (const conv of CONVENTIONS) {
      for (const d of [1, 2, 3, 4, 5]) {
        const tri = buildFigure(d, conv);
        const hex = buildHexagon(d, conv);
        expect(hex.cells.length).toBe(6 * tri.cells.length);
        for (let i = 0; i < tri.cells.length; i++) {
          const t = tri.cells[i];
          const h = hex.cells[i];
          // The index itself, not merely the set: `buildHexagon` walks sector 0
          // first and in the base figure's own order, which is what makes a
          // triangle file's cell indices migrate without renumbering.
          expect([h.sector, h.base, h.addr, h.charge, h.eps, h.baseEps]).toEqual([
            0,
            i,
            t.addr,
            t.charge,
            t.eps,
            t.eps,
          ]);
        }
      }
    }
  });

  it("and the same triangles on screen, once the display transform is applied", () => {
    for (const conv of CONVENTIONS) {
      for (const d of [1, 2, 3, 4]) {
        const tri = buildFigure(d, conv);
        const hex = buildHexagon(d, conv);
        const m = sectorTransform(hex, 0);
        let worst = 0;
        for (let i = 0; i < tri.cells.length; i++) {
          const want = tri.cells[i].verts;
          const got = hex.cells[i].verts.map((v) => applyAffine(m, v));
          for (let k = 0; k < 3; k++) {
            worst = Math.max(
              worst,
              Math.abs(got[k][0] - want[k][0]),
              Math.abs(got[k][1] - want[k][1])
            );
          }
        }
        // Two float paths to the same point — `toXY` through barycentrics and
        // `latticeToPixel` through Eisenstein, then a solved affine — so this is
        // an agreement rather than an identity. A thousandth of a pixel on a
        // 1144-unit canvas is four orders below the two decimals the exporter
        // writes at.
        expect([conv, d, worst < 1e-6]).toEqual([conv, d, true]);
      }
    }
  });

  it("the display transform is a similarity: rotate, and double", () => {
    for (const d of [1, 3, 5]) {
      const hex = buildHexagon(d);
      for (const s of SECTORS) {
        const m = sectorTransform(hex, s);
        expect([s, isSimilarity(m)]).toEqual([s, true]);
        // The hexagon is drawn at circumradius 512 and the triangle at side
        // 1024, so a sector's edge doubles. No flip: the two triangles are
        // labelled the same way round, and a mirrored view would silently
        // reverse every chiral drawing.
        expect(Math.abs(affineScale(m) - 2)).toBeLessThan(1e-9);
        const inv = invertAffine(m);
        const p: [number, number] = [123.5, 456.25];
        const back = applyAffine(inv, applyAffine(m, p));
        expect(Math.hypot(back[0] - p[0], back[1] - p[1])).toBeLessThan(1e-9);
      }
    }
  });

  it("every sector frames onto the same triangle canvas", () => {
    const hex = buildHexagon(3);
    for (const s of SECTORS) {
      const pf = plateFrame(hex, { mode: "sector", sector: s });
      expect([pf.width, pf.height]).toEqual([
        TRIANGLE_FRAME.width,
        TRIANGLE_FRAME.height,
      ]);
      expect(pf.shown.length).toBe(4 ** 3);
      expect(pf.cells.length).toBe(hex.cells.length);
      for (const i of pf.shown) expect(hex.cells[i].sector).toBe(s);
      // The frame's apex is the hexagon's centre carried to the triangle's apex.
      const apex = applyAffine(pf.transform, hex.centre);
      expect(Math.hypot(apex[0] - TRIANGLE_FRAME.corners[0][0], apex[1] - TRIANGLE_FRAME.corners[0][1]))
        .toBeLessThan(1e-9);
    }
  });

  it("hexagon view is the identity and draws everything", () => {
    const hex = buildHexagon(2);
    const pf = plateFrame(hex, { mode: "hexagon", sector: 4 });
    expect(pf.shown.length).toBe(hex.cells.length);
    expect([pf.width, pf.height]).toEqual([hex.width, hex.height]);
    for (let i = 0; i < hex.cells.length; i++) {
      expect(pf.cells[i].verts).toEqual(
        hex.cells[i].verts.map((v) => [v[0], v[1]])
      );
    }
  });
});

// ── 2. the triangle's D3 survives as SECTOR scope ────────────────────────

describe("claim 2 — the sector scope IS the triangle's own D₃", () => {
  it("orbit for orbit, in every sector, at every mode", () => {
    for (const d of [1, 2, 3]) {
      const hex = buildHexagon(d);
      const tri = buildFigure(d);
      const local = hexagonSurface(hex, "sector");
      const flat = triangleSurface(tri);
      const n = tri.cells.length;
      for (const mode of TRI_MODES) {
        for (const s of SECTORS) {
          for (let c = 0; c < n; c++) {
            const i = hex.cells.findIndex((x) => x.sector === s && x.base === c);
            const got = local.orbit(i, mode).map((j) => {
              // Never leaves the sector — which is the claim, so it is checked
              // rather than assumed before the base indices are compared.
              expect(hex.cells[j].sector).toBe(s);
              return hex.cells[j].base;
            });
            expect(got.sort((a, b) => a - b)).toEqual(flat.orbit(c, mode));
          }
        }
      }
    }
  });

  it("mode 12 is not on offer there, because it is D₆'s and nothing else's", () => {
    const hex = buildHexagon(2);
    expect(hexagonSurface(hex, "sector").modes).toEqual(TRI_MODES);
    expect(hexagonSurface(hex, "hexagon").modes).toEqual([1, 2, 3, 6, 12]);
  });
});

// ── 3. bands coincide ────────────────────────────────────────────────────

describe("claim 3 — a hexagon band clipped to a sector is a triangle row", () => {
  it("2r+1, every sector, every family, depths 1–4", () => {
    for (const d of [1, 2, 3, 4]) {
      const hex = buildHexagon(d);
      const bands = buildBandSurface(hex);
      const want = Array.from({ length: 2 ** d }, (_, r) => 2 * r + 1);
      for (const s of SECTORS) {
        for (const f of BAND_FAMILIES) {
          const sizes = bands
            .bands(f)
            .map((ix) => bands.band(ix).filter((i) => hex.cells[i].sector === s).length)
            .filter((n) => n > 0);
          expect([d, s, f, [...sizes].sort((a, b) => a - b)]).toEqual([
            d,
            s,
            f,
            want,
          ]);
        }
      }
    }
  });

  it("and it is the SAME row the base triangle draws, under `sectorBandFamily`", () => {
    for (const d of [1, 2, 3]) {
      const hex = buildHexagon(d);
      const tri = buildFigure(d);
      const bands = buildBandSurface(hex);
      const triBands = buildBandSurface(tri);
      for (const s of SECTORS) {
        for (const f of BAND_FAMILIES) {
          const g = sectorBandFamily(f, s);
          // The two partitions of the sector must agree: one row of the base
          // triangle is exactly one row of the hexagon, clipped.
          const seen = new Map<number, number>();
          for (const c of hex.cells) {
            if (c.sector !== s) continue;
            const hl = bands.bandOf(c.i, g).line;
            const tl = triBands.bandOf(c.base, f).line;
            const had = seen.get(hl);
            if (had === undefined) seen.set(hl, tl);
            else expect([s, f, hl, had]).toEqual([s, f, hl, tl]);
          }
          expect(seen.size).toBe(2 ** d);
        }
      }
    }
  });

  it("sectors 0 and 3 are the identity — which is why the letters never moved", () => {
    for (const f of BAND_FAMILIES) {
      expect(sectorBandFamily(f, 0)).toBe(f);
      expect(sectorBandFamily(f, 3)).toBe(f);
      // A 3-cycle: three rotations return every family to itself.
      expect(sectorBandFamily(sectorBandFamily(sectorBandFamily(f, 1), 1), 1)).toBe(f);
    }
    expect(BAND_FAMILIES.map((f) => sectorBandFamily(f, 1))).toEqual(["C", "A", "B"]);
    expect(BAND_FAMILIES.map((f) => sectorBandFamily(f, 2))).toEqual(["B", "C", "A"]);
  });

  it("the unclipped hexagon bands are unchanged — nothing about the model moved", () => {
    const bands = buildBandSurface(buildHexagon(2));
    for (const f of BAND_FAMILIES) {
      const sizes = bandSizes(bands, f);
      expect(sizes.reduce((a, b) => a + b, 0)).toBe(6 * 4 ** 2);
    }
  });
});

// ── 4. the relief is real in a sector ────────────────────────────────────

describe("claim 4 — H is flat on a triangle and NOT flat on a sector", () => {
  it("2 values on the standalone triangle, 2^(d+1)−1 inside one sector", () => {
    for (const d of [1, 2, 3, 4]) {
      const hex = buildHexagon(d);
      const bands = buildBandSurface(hex);
      const tri = buildFigure(d);
      const triBands = buildBandSurface(tri);

      const flat = new Set<number>();
      for (const c of tri.cells) flat.add(bandHeight(triBands, c.i));
      expect([d, flat.size]).toEqual([d, 2]);

      for (const s of SECTORS) {
        const inSector = new Set<number>();
        for (const c of hex.cells) {
          if (c.sector === s) inSector.add(bandHeight(bands, c.i));
        }
        // Every ring of the plate crosses every sector, so a framed sector sees
        // the whole range of the height field rather than a slice of it.
        expect([d, s, inSector.size]).toEqual([d, s, 2 ** (d + 1) - 1]);
      }
    }
  });

  it("so a relief frame moves a sector's cells, and moves them six-fold alike", () => {
    const hex = buildHexagon(3);
    const relief = buildRelief(hex);
    const frame = reliefFrame(relief, restShell(relief), "convex");
    let moved = 0;
    for (const c of hex.cells) {
      if (c.sector !== 0) continue;
      for (let k = 0; k < 3; k++) {
        if (
          Math.abs(frame.verts[c.i][k][0] - c.verts[k][0]) > 1e-6 ||
          Math.abs(frame.verts[c.i][k][1] - c.verts[k][1]) > 1e-6
        ) {
          moved++;
          break;
        }
      }
    }
    // Not "some cells move" — nearly all of them do; the pinned ones are the rim
    // and the ring the template sits on.
    expect(moved).toBeGreaterThan(0.5 * 4 ** 3);
  });
});

// ── the preset, per sector ───────────────────────────────────────────────

describe("presets fill every sector, so a framed one is the canonical figure", () => {
  it("the gasket is 3^d PER SECTOR", () => {
    for (const d of [1, 2, 3, 4]) {
      const hex = buildHexagon(d);
      const per = new Map<number, number>();
      for (const i of gasketCells(hex)) {
        const s = hex.cells[i].sector;
        per.set(s, (per.get(s) ?? 0) + 1);
      }
      expect([...SECTORS].map((s) => per.get(s))).toEqual(
        SECTORS.map(() => 3 ** d)
      );
    }
  });

  it("and a charge preset paints a sector exactly as the triangle preset would", () => {
    for (const d of [1, 2, 3]) {
      const hex = buildHexagon(d);
      const tri = buildFigure(d);
      const onHex = presetColours("charge-apex", hex, GOLD);
      const onTri = presetColours("charge-apex", tri, GOLD);
      for (let i = 0; i < tri.cells.length; i++) expect(onHex[i]).toBe(onTri[i]);
    }
  });
});

// ── old files still load ─────────────────────────────────────────────────

describe("a triangle file migrates into sector 0", () => {
  /** A file as `main` wrote it before the hexagon became the model. */
  const triangleFile = (d: number, paint: Map<number, string>): string => {
    const tri = buildFigure(d, "apex");
    return artworkSvg({
      width: tri.width,
      height: tri.height,
      cells: tri.cells,
      paint,
      background: "#0a0908",
      unpainted: "#201c19",
      tileSeam: "rgba(236,230,220,.16)",
      paintSeam: "rgba(10,9,8,.34)",
      seamWidth: 1,
      title: "old",
      payload: payloadFromPaint("triangle", d, "apex", paint),
    });
  };

  it("word for word, at every depth the old canvas could reach", () => {
    for (const d of [1, 2, 3, 4, 5]) {
      const tri = buildFigure(d, "apex");
      const paint = new Map<number, string>();
      for (let i = 0; i < tri.cells.length; i += 3) paint.set(i, GOLD);

      const payload = extractArt(triangleFile(d, paint));
      expect(payload).not.toBeNull();
      expect(payload!.canvas).toBe("triangle");
      expect(payload!.depth).toBe(d);

      const triBook = addressBook(tri);
      const migrated = plateIntoSector(
        plateFromArtPayload(payload!, triBook),
        0
      );
      expect(migrated.size).toBe(paint.size);

      // The migrated plate resolves onto the hexagon exactly where the original
      // resolved onto the triangle, cell index for cell index — because sector
      // 0's indices ARE the triangle's.
      const hex = buildHexagon(d, "apex");
      const shown = resolvePlate(migrated, addressBook(hex));
      expect(shown.size).toBe(paint.size);
      for (const [i, hexColour] of paint) expect(shown.get(i)).toBe(hexColour);
      for (const [i] of shown) expect(hex.cells[i].sector).toBe(0);
    }
  });

  it("carries a multi-depth plate across without resolving it", () => {
    // The case a naive migration loses: paint made at depth 2 and then detailed
    // at depth 4 lives at two address lengths at once.
    const plate: AddressPlate = new Map([
      ["AB", GOLD],
      ["ABAA", "#0f7b6c"],
      ["X", "#ffffff"],
    ]);
    const moved = plateIntoSector(plate, 0);
    expect([...moved.entries()].sort()).toEqual([
      ["s0:AB", GOLD],
      ["s0:ABAA", "#0f7b6c"],
      ["s0:X", "#ffffff"],
    ]);
    // Prefixing still means ancestry after the rename, which is the whole reason
    // the tag is a fixed three characters outside {A,B,C,X}.
    expect("s0:ABAA".startsWith("s0:AB")).toBe(true);
  });

  it("the depth-5 triangle file the old ceiling would have stranded", () => {
    // MAX_DEPTH.hexagon had to reach 5 for this to be re-exportable at all.
    expect(MAX_DEPTH.hexagon).toBeGreaterThanOrEqual(5);
    const back = extractArt(triangleFile(5, new Map([[1000, GOLD]])));
    expect(back?.depth).toBe(5);
    const migrated = plateIntoSector(
      plateFromArtPayload(back!, addressBook(buildFigure(5, "apex"))),
      0
    );
    const hex = buildHexagon(5, "apex");
    expect(resolvePlate(migrated, addressBook(hex)).get(1000)).toBe(GOLD);
  });
});

// ── the round trip, under the new model ──────────────────────────────────

/** Exactly what `page.tsx` writes, for a plate and a frame. */
function exportPlate(
  depth: number,
  plate: AddressPlate,
  sector: number | null
): string {
  const hex = buildHexagon(depth, "apex");
  const book = addressBook(hex);
  const pf = plateFrame(
    hex,
    sector === null
      ? { mode: "hexagon", sector: 0 }
      : { mode: "sector", sector }
  );
  return artworkSvg({
    width: pf.width,
    height: pf.height,
    cells: pf.cells,
    shown: sector === null ? undefined : pf.shown,
    paint: resolvePlate(plate, book),
    background: "#0a0908",
    unpainted: "#201c19",
    tileSeam: "rgba(236,230,220,.16)",
    paintSeam: "rgba(10,9,8,.34)",
    seamWidth: 1,
    title: "t",
    payload: payloadFromPaint(
      "hexagon",
      depth,
      "apex",
      resolvePlate(plate, book),
      undefined,
      plateEntries(plate, book),
      sector === null ? undefined : { sector }
    ),
  });
}

describe("save → load → save is byte-identical", () => {
  const painted = (depth: number): AddressPlate => {
    const hex = buildHexagon(depth, "apex");
    const book = addressBook(hex);
    const bands = buildBandSurface(hex);
    const surface = hexagonSurface(hex, "hexagon");
    let plate: AddressPlate = new Map();
    for (const seed of [0, 37, 512, 900]) {
      const stamp = brushStamp(surface, bands, seed % hex.cells.length, {
        mode: 6,
        band: null,
      });
      plate = applyPlateEdits(
        plate,
        planPlateEdits(
          plate,
          book,
          stamp.cells.map((c) => book.addr[c]),
          stamp.cells.map(() => GOLD)
        ),
        "do"
      );
    }
    return plate;
  };

  for (const sector of [null, 0, 2, 5] as const) {
    it(`${sector === null ? "hexagon view" : `sector ${sector}`}`, () => {
      const depth = 3;
      const plate = painted(depth);
      const first = exportPlate(depth, plate, sector);

      const payload = extractArt(first);
      expect(payload).not.toBeNull();
      expect(payload!.canvas).toBe("hexagon");
      expect(payload!.view?.sector).toBe(sector === null ? undefined : sector);

      const hex = buildHexagon(payload!.depth, payload!.convention);
      const reloaded = plateFromArtPayload(payload!, addressBook(hex));
      const second = exportPlate(
        payload!.depth,
        reloaded,
        payload!.view?.sector ?? null
      );
      expect(second).toBe(first);
    });
  }

  it("the frame changes the picture and NOT the payload", () => {
    const depth = 2;
    const plate = painted(depth);
    const whole = extractArt(exportPlate(depth, plate, null))!;
    const framed = extractArt(exportPlate(depth, plate, 4))!;
    // The plate is whole in both. A sector export that carried only its own
    // sector would destroy five sixths of the drawing on reload.
    expect(framed.cells).toEqual(whole.cells);
    expect(framed.plate).toEqual(whole.plate);
    expect(framed.view).toEqual({ sector: 4 });
    expect(whole.view).toBeUndefined();
  });

  it("a hexagon-view export is unchanged by this work — no `view` field at all", () => {
    const svg = exportPlate(2, new Map([["s0:AA", GOLD]]), null);
    expect(svg).not.toContain('"view"');
  });

  it("a `view` on a triangle payload is refused, not ignored", () => {
    const good = payloadFromPaint("triangle", 2, "apex", new Map([[0, GOLD]]));
    const body = JSON.stringify({ ...good, view: { sector: 1 } });
    expect(
      extractArt(`<svg><!-- fourfold:art:1 ${body} --></svg>`)
    ).toBeNull();
    for (const bad of [{ sector: 6 }, { sector: -1 }, { sector: 1.5 }, {}, 3]) {
      const hexPayload = payloadFromPaint("hexagon", 2, "apex", new Map([[0, GOLD]]));
      const text = JSON.stringify({ ...hexPayload, view: bad });
      expect(extractArt(`<svg><!-- fourfold:art:1 ${text} --></svg>`)).toBeNull();
    }
  });
});

// ── the frame confines the keyboard ──────────────────────────────────────

describe("the frame stops the cursor leaving it", () => {
  it("an arrow walk inside a framed sector never lands outside it", () => {
    const hex = buildHexagon(3);
    for (const s of [0, 1, 4]) {
      const pf = plateFrame(hex, { mode: "sector", sector: s });
      const inFrame = new Set(pf.shown);
      const allowed = (i: number) => inFrame.has(i);
      const centroids = pf.cells.map((c) => c.centroid);
      let at = stepCursor(centroids, null, "up", allowed);
      expect(allowed(at)).toBe(true);
      for (const dir of ["up", "down", "left", "right", "left", "up"] as const) {
        at = stepCursor(centroids, at, dir, allowed);
        expect([s, dir, allowed(at)]).toEqual([s, dir, true]);
      }
    }
  });

  it("and the unrestricted walk is exactly what it always was", () => {
    const hex = buildHexagon(2);
    const centroids = hex.cells.map((c) => c.centroid);
    expect(stepCursor(centroids, null, "up")).toBe(
      stepCursor(centroids, null, "up", () => true)
    );
    expect(stepCursor(centroids, 10, "left")).toBe(
      stepCursor(centroids, 10, "left", () => true)
    );
  });

  /**
   * The INWARD key needs the same guard the ring keys do, and this test exists
   * because the opposite was written down first and the measurement refused it
   * twice.
   *
   * The guess was that a radial step runs along the sector's own median and so
   * cannot leave the sector. It is not the median that matters, it is the
   * DIRECTION: `radial` translates by a multiple of rot^s(1,1), which is the
   * median's direction applied to every cell of the sector whether or not that
   * cell sits on the median. Near the apex the sector is narrow, so a cell one
   * or two steps in from the point is carried straight out of the wedge. The
   * second guess — that it happens once per sector, straight across to s+3 —
   * was also wrong: at depth 2 there are 42 such steps, and they land in four
   * different sectors.
   *
   * What IS true, and is what the guard rests on: only `in` ever leaves, `out`
   * never does, and it happens often enough that a frame without the check would
   * strand the cursor on an invisible cell as a matter of routine.
   */
  it("an inward step can leave its sector; an outward step never does", () => {
    for (const d of [1, 2, 3]) {
      const hex = buildHexagon(d);
      const view = latticeView(hex);
      let inward = 0;
      let outward = 0;
      for (const c of hex.cells) {
        for (const way of ["out", "in"] as const) {
          const j = view.radial(c.i, way);
          if (j < 0 || hex.cells[j].sector === c.sector) continue;
          if (way === "in") inward++;
          else outward++;
        }
      }
      expect([d, outward]).toEqual([d, 0]);
      expect(inward).toBeGreaterThan(0);
      console.log(
        `d${d}: ${inward} inward steps cross a sector seam, of ${hex.cells.length} cells`
      );
    }
  });
});

// ── small guards ─────────────────────────────────────────────────────────

describe("the view helpers are total", () => {
  it("wraps a sector index both ways", () => {
    expect([-1, 0, 5, 6, 13].map(wrapSector)).toEqual([5, 0, 5, 0, 1]);
  });

  it("refuses a degenerate transform rather than returning nonsense", () => {
    expect(() =>
      invertAffine({ a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 })
    ).toThrow(/singular/);
  });

  it("the triangle frame is the one `buildFigure` reports, at every depth", () => {
    for (const d of [0, 1, 5]) {
      const f = buildFigure(d);
      expect([f.width, f.height]).toEqual([
        TRIANGLE_FRAME.width,
        TRIANGLE_FRAME.height,
      ]);
      expect(f.corners).toEqual(TRIANGLE_FRAME.corners);
    }
  });
});

// ── what depth 5 costs ───────────────────────────────────────────────────

describe("depth cost, reported", () => {
  it("builds, frames, reliefs and paints the deepest plate", () => {
    const ms = (f: () => void): string => {
      const t0 = performance.now();
      f();
      return (performance.now() - t0).toFixed(1);
    };
    for (const d of [3, 4, 5]) {
      let hex = buildHexagon(d);
      const build = ms(() => {
        hex = buildHexagon(d);
      });
      const bands = buildBandSurface(hex);
      const tables = ms(() => {
        buildBandSurface(hex);
        latticeView(hex);
      });
      const surface = hexagonSurface(hex, "hexagon");
      const orbits = ms(() => {
        const s = hexagonSurface(hex, "hexagon");
        s.orbit(0, 12);
      });
      const relief = buildRelief(hex);
      const reliefMs = ms(() => reliefFrame(relief, restShell(relief), "convex"));
      const hexFrame = ms(() => plateFrame(hex, { mode: "hexagon", sector: 0 }));
      const secFrame = ms(() => plateFrame(hex, { mode: "sector", sector: 3 }));
      const book = addressBook(hex);
      let plate: AddressPlate = new Map();
      const paint20 = ms(() => {
        for (let k = 0; k < 20; k++) {
          const stamp = brushStamp(surface, bands, (k * 7) % hex.cells.length, {
            mode: 6,
            band: null,
          });
          plate = applyPlateEdits(
            plate,
            planPlateEdits(
              plate,
              book,
              stamp.cells.map((c) => book.addr[c]),
              stamp.cells.map(() => GOLD)
            ),
            "do"
          );
        }
      });
      const resolve = ms(() => resolvePlate(plate, book));
      console.log(
        `d${d}  ${hex.cells.length} cells (sector ${4 ** d})  ` +
          `build ${build}ms  tables ${tables}ms  D6 maps+orbits ${orbits}ms  ` +
          `relief frame ${reliefMs}ms  frame hex ${hexFrame}ms / sector ${secFrame}ms  ` +
          `20 brush applications ${paint20}ms  resolve ${resolve}ms  ` +
          `DOM polygons: hexagon view ${2 * hex.cells.length}, sector view ${2 * 4 ** d}`
      );
    }
    expect(buildHexagon(5).cells.length).toBe(6144);
  });
});
