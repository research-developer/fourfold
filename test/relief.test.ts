import { describe, expect, it } from "vitest";
import { encodeArt, extractArt, payloadFromPaint } from "../src/lib/artfile";
import { buildBandSurface } from "../src/lib/bands";
import { buildFigure } from "../src/lib/figure";
import { ISOMETRY_NAMES, triangleIndexMap } from "../src/lib/conventions";
import {
  buildHexagon,
  HEX_ISOMETRIES,
  indexMap,
  type Hexagon,
} from "../src/lib/hexagon";
import {
  bandHeight,
  buildRelief,
  READINGS,
  reliefFrame,
  remapRadius,
  restShell,
  shell,
  shellScales,
  templateShell,
  type Reading,
} from "../src/lib/relief";
import { artworkSvg } from "../src/lib/strokes";

/**
 * The relief.
 *
 * Two things are claimed and both are measured here rather than argued. The
 * height field — the sum of a cell's three band sizes — is exactly D6-invariant
 * and needs no division; and the deformation built on it is six-fold symmetric
 * in every frame, at every cursor position, because it is a function of a
 * D6-invariant integer alone.
 */

const DEPTHS = [1, 2, 3];

const heights = (hex: Hexagon) => {
  const bands = buildBandSurface(hex);
  return hex.cells.map((c) => bandHeight(bands, c.i));
};

// ── the height field ─────────────────────────────────────────────────────

describe("the band-size height field", () => {
  for (const d of DEPTHS) {
    it(`hexagon d=${d}: exactly D6-invariant, at every cell, all twelve elements`, () => {
      const hex = buildHexagon(d, "apex");
      const H = heights(hex);
      for (const g of HEX_ISOMETRIES) {
        const m = indexMap(hex, g);
        for (const c of hex.cells) {
          expect([g.name, c.i, H[m[c.i]]]).toEqual([g.name, c.i, H[c.i]]);
        }
      }
    });
  }

  for (const d of DEPTHS) {
    it(`triangle d=${d}: D3-invariant, and FLAT — exactly two values`, () => {
      const fig = buildFigure(d, "apex");
      const bands = buildBandSurface(fig);
      const H = fig.cells.map((c) => bandHeight(bands, c.i));
      for (const name of ISOMETRY_NAMES) {
        const m = triangleIndexMap(fig, name);
        for (const c of fig.cells) {
          expect([name, c.i, H[m[c.i]]]).toEqual([name, c.i, H[c.i]]);
        }
      }
      // The three band indices of a triangle cell sum to a constant, so only the
      // orientation moves the total. Measured, and it is why the relief is not
      // offered on this canvas.
      const distinct = [...new Set(H)].sort((a, b) => a - b);
      // 4·2^d ∓ 1 — measured. Two values and no more: the field is flat here.
      expect([d, distinct]).toEqual([d, [4 * 2 ** d - 1, 4 * 2 ** d + 1]]);
    });
  }

  it("on the hexagon it is a strictly DECREASING bijection of the shell", () => {
    for (const d of [1, 2, 3, 4]) {
      const hex = buildHexagon(d, "apex");
      const H = heights(hex);
      const byShell = new Map<number, Set<number>>();
      for (const c of hex.cells) {
        const s = shell(c.key);
        const at = byShell.get(s) ?? new Set<number>();
        at.add(H[c.i]);
        byShell.set(s, at);
      }
      const shells = [...byShell.keys()].sort((a, b) => a - b);
      // One height per ring — so the two fields cut the plate into the same
      // rings, which is what licenses `shell` as the field's coordinate on the
      // lattice VERTICES a band cannot reach.
      for (const s of shells) expect([d, s, byShell.get(s)!.size]).toEqual([d, s, 1]);
      const seq = shells.map((s) => [...byShell.get(s)!][0]);
      for (let k = 1; k < seq.length; k++) {
        expect([d, k, seq[k] < seq[k - 1]]).toEqual([d, k, true]);
      }
      // 2^(d+1) − 1 rings, falling by exactly two from 3(4·2^d − 1).
      expect([d, shells.length]).toEqual([d, 2 ** (d + 1) - 1]);
      expect([d, seq[0]]).toEqual([d, 3 * (4 * 2 ** d - 1)]);
      expect([d, seq[0] - seq[1]]).toEqual([d, 2]);
    }
  });

  it("the shell itself is D6-invariant on the lattice", () => {
    for (const g of HEX_ISOMETRIES) {
      for (let a = -9; a <= 9; a++) {
        for (let b = -9; b <= 9; b++) {
          expect([g.name, a, b, shell(g.apply([a, b]))]).toEqual([
            g.name,
            a,
            b,
            shell([a, b]),
          ]);
        }
      }
    }
  });
});

// ── the remap is integers until the last moment ──────────────────────────

describe("the remap carries integers and divides once", () => {
  it("every (n, d) is a pair of integers, and stays far under 2^53", () => {
    let biggest = 0;
    for (const d of [1, 2, 3, 4]) {
      const M = 3 * 2 ** d;
      for (const reading of READINGS) {
        for (let S = 0; S <= M; S++) {
          for (let s = 0; s <= M; s++) {
            const r = remapRadius(s, S, M, reading);
            expect(Number.isInteger(r.n)).toBe(true);
            expect(Number.isInteger(r.d)).toBe(true);
            biggest = Math.max(biggest, Math.abs(r.n), Math.abs(r.d));
          }
        }
      }
    }
    // Measured, not assumed: the whole field fits in a couple of dozen bits, so
    // nothing here needs a BigInt and no product can lose a digit.
    expect(biggest).toBeLessThan(2 ** 20);
  });

  it("the two branches agree at the template ring — cross-multiplied, not divided", () => {
    for (const d of [1, 2, 3, 4]) {
      const M = 3 * 2 ** d;
      for (const reading of READINGS) {
        for (let S = 1; S < M; S++) {
          // r'(S) from the inner branch and from the outer branch's limit.
          const inner = remapRadius(S, S, M, reading);
          const outer = remapRadius(S + 1, S, M, reading);
          const step = remapRadius(S + 1, S + 1, M, reading);
          expect(Number.isInteger(step.n)).toBe(true);
          // Monotone, as an inequality between two INTEGERS: a·d' < a'·d, never
          // a/d < a'/d'.
          expect([d, reading, S, inner.n * outer.d < outer.n * inner.d]).toEqual([
            d,
            reading,
            S,
            true,
          ]);
        }
      }
    }
  });

  it("the centre and the rim are pinned, so the plate curves without resizing", () => {
    for (const d of [1, 2, 3, 4]) {
      const M = 3 * 2 ** d;
      for (const reading of READINGS) {
        for (let S = 1; S < M; S++) {
          const at0 = remapRadius(0, S, M, reading);
          expect([d, reading, S, at0.n]).toEqual([d, reading, S, 0]);
          const atM = remapRadius(M, S, M, reading);
          // r'(M) == M, as integers: n == M·d.
          expect([d, reading, S, atM.n]).toEqual([d, reading, S, M * atM.d]);
          const scales = shellScales(S, M, reading);
          expect([d, reading, S, scales[M]]).toEqual([d, reading, S, 1]);
        }
      }
    }
  });

  it("convex pushes the template ring out and concave pulls it in", () => {
    const M = 48;
    for (let S = 1; S < M; S++) {
      const out = remapRadius(S, S, M, "convex");
      const inn = remapRadius(S, S, M, "concave");
      expect([S, out.n > S * out.d]).toEqual([S, true]);
      expect([S, inn.n < S * inn.d]).toEqual([S, true]);
    }
  });

  it("a template outside the figure is the identity", () => {
    for (const reading of READINGS) {
      for (const S of [0, 48]) {
        const scales = shellScales(S, 48, reading);
        for (let s = 0; s <= 48; s++) {
          expect([reading, S, s, scales[s]]).toEqual([reading, S, s, 1]);
        }
      }
    }
  });
});

// ── six-fold symmetry, in the rendered picture ───────────────────────────

/** A 60° lattice rotation, in SVG pixel space (y grows downward). */
const spin60 = (
  p: readonly [number, number],
  c: readonly [number, number]
): [number, number] => {
  const dx = p[0] - c[0];
  const dy = p[1] - c[1];
  const co = Math.cos(Math.PI / 3);
  const si = Math.sin(Math.PI / 3);
  return [c[0] + dx * co + dy * si, c[1] - dx * si + dy * co];
};

/** Reflection across the e1 axis is a flip of the screen's y. */
const flipY = (
  p: readonly [number, number],
  c: readonly [number, number]
): [number, number] => [p[0], 2 * c[1] - p[1]];

describe("the deformed plate is six-fold symmetric in every frame", () => {
  for (const d of [2, 3]) {
    it(`d=${d}: rotation and reflection carry deformed cells to deformed cells`, () => {
      const hex = buildHexagon(d, "apex");
      const surface = buildRelief(hex);
      const rot = indexMap(hex, HEX_ISOMETRIES.find((g) => g.name === "r60")!);
      const mir = indexMap(hex, HEX_ISOMETRIES.find((g) => g.name === "m0")!);
      // EVERY ring the cursor can name, both readings, every cell — not a
      // sample. Six-fold symmetry is the claim the whole effect rests on, and a
      // spot check would not be a check of it.
      for (const ring of surface.ringValues) {
        for (const reading of READINGS) {
          const frame = reliefFrame(surface, ring, reading);
          for (let probe = 0; probe < hex.cells.length; probe++) {
            const here = frame.centroids[probe];
            for (const [name, map, act] of [
              ["r60", rot, spin60],
              ["m0", mir, flipY],
            ] as const) {
              const want = act(here, hex.centre);
              const got = frame.centroids[map[probe]];
              expect([
                ring,
                reading,
                name,
                probe,
                Math.abs(got[0] - want[0]) < 1e-6 &&
                  Math.abs(got[1] - want[1]) < 1e-6,
              ]).toEqual([ring, reading, name, probe, true]);
            }
          }
        }
      }
    });
  }

  it("the six corresponding cells are one ring, so any of them is the same template", () => {
    const hex = buildHexagon(3, "apex");
    const surface = buildRelief(hex);
    const rot = indexMap(hex, HEX_ISOMETRIES.find((g) => g.name === "r60")!);
    for (const c of hex.cells) {
      let j = c.i;
      for (let k = 0; k < 6; k++) {
        expect([c.i, k, templateShell(surface, j)]).toEqual([
          c.i,
          k,
          templateShell(surface, c.i),
        ]);
        j = rot[j];
      }
      expect([c.i, j]).toEqual([c.i, c.i]);
    }
  });

  it("the rim never moves, whatever the cursor is doing", () => {
    const hex = buildHexagon(3, "apex");
    const surface = buildRelief(hex);
    const flat = reliefFrame(surface, 0, "convex");
    for (const ring of [3, 12, 24, restShell(surface)]) {
      for (const reading of READINGS) {
        const frame = reliefFrame(surface, ring, reading);
        for (let i = 0; i < surface.cells.length; i++) {
          for (let k = 0; k < surface.cells[i].s.length; k++) {
            if (surface.cells[i].s[k] !== surface.maxShell) continue;
            const a = frame.verts[i][k];
            const b = flat.verts[i][k];
            expect([ring, reading, i, k, Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9]).toEqual(
              [ring, reading, i, k, true]
            );
          }
        }
      }
    }
  });

  it("convex and concave really are different pictures", () => {
    const hex = buildHexagon(2, "apex");
    const surface = buildRelief(hex);
    const ring = restShell(surface);
    const a = reliefFrame(surface, ring, "convex");
    const b = reliefFrame(surface, ring, "concave");
    let moved = 0;
    for (let i = 0; i < a.centroids.length; i++) {
      if (Math.hypot(a.centroids[i][0] - b.centroids[i][0], a.centroids[i][1] - b.centroids[i][1]) > 1) {
        moved++;
      }
    }
    expect(moved).toBe(hex.cells.length);
  });

  it("a bigger template ring is a different picture again", () => {
    const hex = buildHexagon(3, "apex");
    const surface = buildRelief(hex);
    const seen = new Set<string>();
    for (const ring of surface.ringValues) {
      seen.add(reliefFrame(surface, ring, "convex").points.join("|"));
    }
    expect(seen.size).toBe(surface.ringValues.length);
  });
});

// ── the file ─────────────────────────────────────────────────────────────

describe("relief in the art payload", () => {
  const plate = new Map([[0, "#112233"]]);

  it("a payload with no relief writes exactly the bytes it always did", () => {
    const p = payloadFromPaint("hexagon", 2, "apex", plate);
    expect(p.relief).toBeUndefined();
    expect(encodeArt(p)).not.toContain("relief");
  });

  it("a declared relief round-trips", () => {
    for (const reading of READINGS) {
      const p = payloadFromPaint("hexagon", 2, "apex", plate, { on: true, reading });
      const back = extractArt(`<svg>${encodeArt(p)}</svg>`);
      expect([reading, back?.relief]).toEqual([reading, { on: true, reading }]);
    }
  });

  it("a file written before the field existed still loads", () => {
    const old =
      '<!-- fourfold:art:1 {"canvas":"hexagon","depth":2,"convention":"apex","cells":[[0,"#112233"]]} -->';
    const back = extractArt(`<svg>${old}</svg>`);
    expect(back?.cells).toEqual([[0, "#112233"]]);
    expect(back?.relief).toBeUndefined();
  });

  it("a malformed relief is refused, like every other malformed field", () => {
    for (const bad of ['"on"', '{"on":1,"reading":"convex"}', '{"on":true,"reading":"cube"}', "[]"]) {
      const line = `<!-- fourfold:art:1 {"canvas":"hexagon","depth":2,"convention":"apex","cells":[],"relief":${bad}} -->`;
      expect([bad, extractArt(`<svg>${line}</svg>`)]).toEqual([bad, null]);
    }
  });

  it("the export bakes the resting ring, so it does not depend on the pointer", () => {
    const hex = buildHexagon(2, "apex");
    const surface = buildRelief(hex);
    const bake = (reading: Reading) => {
      const frame = reliefFrame(surface, restShell(surface), reading);
      return artworkSvg({
        width: hex.width,
        height: hex.height,
        cells: frame.verts.map((verts) => ({ verts })),
        paint: new Map([[3, "#d4a017"]]),
        background: "#0a0908",
        unpainted: "#201c19",
        tileSeam: null,
        paintSeam: null,
        seamWidth: 1,
        title: "t",
        payload: payloadFromPaint("hexagon", 2, "apex", new Map([[3, "#d4a017"]]), {
          on: true,
          reading,
        }),
        overlay: frame.wash.map((w) => ({
          fill: w.fill,
          opacity: w.alpha,
          shapes: w.cells.map((i) => frame.verts[i]),
        })),
      });
    };
    // Same inputs, same bytes — twice, and from two independent builds of the
    // surface, which is what a round trip through a file actually is.
    expect(bake("convex")).toBe(bake("convex"));
    expect(bake("convex")).not.toBe(bake("concave"));
    const again = buildRelief(buildHexagon(2, "apex"));
    expect(reliefFrame(again, restShell(again), "convex").points).toEqual(
      reliefFrame(surface, restShell(surface), "convex").points
    );
  });

  it("the wash rides on the group, so an import cannot mistake it for paint", () => {
    const hex = buildHexagon(1, "apex");
    const surface = buildRelief(hex);
    const frame = reliefFrame(surface, restShell(surface), "convex");
    const svg = artworkSvg({
      width: hex.width,
      height: hex.height,
      cells: frame.verts.map((verts) => ({ verts })),
      paint: new Map(),
      background: "#0a0908",
      unpainted: null,
      tileSeam: null,
      paintSeam: null,
      seamWidth: 1,
      title: "t",
      overlay: frame.wash.map((w) => ({
        fill: w.fill,
        opacity: w.alpha,
        shapes: w.cells.map((i) => frame.verts[i]),
      })),
    });
    // No polygon carries a fill of its own; `importByGeometry` needs one.
    expect(/<polygon[^>]*fill=/.test(svg)).toBe(false);
    expect(/<g fill="#(000|fff)" opacity=/.test(svg)).toBe(true);
  });
});
