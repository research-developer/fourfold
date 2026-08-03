/**
 * The VIEW: which part of the one hexagon is on screen, and where it is drawn.
 *
 * There is one model — the hexagon, addressed `s0:` … `s5:` — and there are two
 * ways to frame it. HEXAGON shows all six sectors as the plate was built.
 * SECTOR shows one, turned so it reads apex-up, which is the classic triangle.
 *
 * ── Why a sector really is the triangle, and not a likeness of it ────────
 *
 * `buildHexagon` builds every sector by applying `rotK(·, s)` to the cells of
 * `buildFigure(depth, convention)`, so sector 0 IS the base figure: same
 * addresses, same charges, same orientations, same order. `test/view.test.ts`
 * asserts that cell for cell rather than asserting it here. Sector s is the same
 * figure rotated by an exact integer lattice matrix. So framing a sector is not
 * an approximation of the old triangle canvas — it is that canvas, seen from a
 * different place on the page.
 *
 * ── The transform is DISPLAY ONLY, and that is the whole discipline ──────
 *
 * Nothing below is ever consulted to decide which cell a stroke touches. Every
 * index still comes from `orbit.ts` and `bands.ts` by exact integer key lookup
 * on the Eisenstein lattice, and the lattice does not move: rotating it would
 * silently change `key`, and with it every band, every ring, every orbit and
 * every address in the file. What moves is the picture. `sectorTransform`
 * returns a similarity — a rotation and a doubling — applied to pixels at the
 * moment a cell becomes a polygon, exactly as `latticeToPixel` is.
 *
 * FLOAT LIVES HERE, legitimately and only here: this module converts exact
 * integers that have already chosen the cells into the pixels that draw them.
 *
 * ── Where the triangle lands ────────────────────────────────────────────
 *
 * Sector s has its apex A at the hexagon's centre — the shared apex-eye — and
 * its other two corners at hexagon corners s and s+1. The old triangle canvas
 * puts A at the top and B, C along the bottom. Those are two congruent labelled
 * triangles, so there is exactly one affine map carrying one onto the other, and
 * it is solved for rather than typed in: hand it the three corners each way and
 * the sector arithmetic can never disagree with `buildHexagon`'s.
 *
 * It comes out a SIMILARITY, which is a claim worth checking rather than
 * assuming — a shear here would put the paint somewhere the pointer is not.
 * `isSimilarity` states the test and `test/view.test.ts` runs it on all six
 * sectors at every depth: the matrix is `[[a, −b], [b, a]]`, a rotation by
 * −120° − 60°·s composed with a scale of exactly 2, because the hexagon is drawn
 * at circumradius 512 and the triangle at side 1024.
 */

import { TRIANGLE_FRAME } from "./figure";
import type { Hexagon } from "./hexagon";

export type Pt = readonly [number, number];

/** Which part of the plate is framed. `sector` is meaningless when `mode` is not. */
export type ViewMode = "hexagon" | "sector";

export interface PlateView {
  mode: ViewMode;
  /** 0…5. Carried in both modes so switching back returns to the same sector. */
  sector: number;
}

export const SECTORS: readonly number[] = [0, 1, 2, 3, 4, 5] as const;

export const wrapSector = (s: number): number => ((s % 6) + 6) % 6;

// ── the affine map ───────────────────────────────────────────────────────

/**
 * `(x, y) ↦ (a·x + b·y + e, c·x + d·y + f)`.
 *
 * Written out rather than held as an SVG `transform` string because the exporter
 * formats its own coordinates and the relief hands over deformed VERTICES, not
 * markup. One representation, used by the board, the file and the guides alike.
 */
export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export const applyAffine = (m: Affine, p: Pt): [number, number] => [
  m.a * p[0] + m.b * p[1] + m.e,
  m.c * p[0] + m.d * p[1] + m.f,
];

/**
 * The inverse map. Throws on a singular matrix, which cannot arise from three
 * corners of a non-degenerate triangle and would mean the hexagon had collapsed.
 */
export function invertAffine(m: Affine): Affine {
  const det = m.a * m.d - m.b * m.c;
  if (det === 0) throw new Error("view: the display transform is singular");
  return {
    a: m.d / det,
    b: -m.b / det,
    c: -m.c / det,
    d: m.a / det,
    e: (m.b * m.f - m.d * m.e) / det,
    f: (m.c * m.e - m.a * m.f) / det,
  };
}

/**
 * The unique affine map carrying the labelled triangle `src` onto `dst`.
 *
 * Solved from the two edge vectors out of the first corner, which is the whole
 * of the derivation: `M·u₁ = v₁` and `M·u₂ = v₂` determine `M`, and the
 * translation then follows from the corner itself.
 */
export function affineFromTriangles(
  src: readonly [Pt, Pt, Pt],
  dst: readonly [Pt, Pt, Pt]
): Affine {
  const u1: Pt = [src[1][0] - src[0][0], src[1][1] - src[0][1]];
  const u2: Pt = [src[2][0] - src[0][0], src[2][1] - src[0][1]];
  const v1: Pt = [dst[1][0] - dst[0][0], dst[1][1] - dst[0][1]];
  const v2: Pt = [dst[2][0] - dst[0][0], dst[2][1] - dst[0][1]];

  const det = u1[0] * u2[1] - u2[0] * u1[1];
  if (det === 0) throw new Error("view: degenerate source triangle");
  // [u1 u2]^{-1}, column-major in the same convention as above.
  const i00 = u2[1] / det;
  const i01 = -u2[0] / det;
  const i10 = -u1[1] / det;
  const i11 = u1[0] / det;

  const a = v1[0] * i00 + v2[0] * i10;
  const b = v1[0] * i01 + v2[0] * i11;
  const c = v1[1] * i00 + v2[1] * i10;
  const d = v1[1] * i01 + v2[1] * i11;
  return {
    a,
    b,
    c,
    d,
    e: dst[0][0] - (a * src[0][0] + b * src[0][1]),
    f: dst[0][1] - (c * src[0][0] + d * src[0][1]),
  };
}

/**
 * True when the map is a rotation and a uniform scale — no shear, no flip.
 *
 * `[[a, −b], [b, a]]`. Checked with a relative tolerance because the corners
 * arrive through `Math.sqrt(3)`; the claim is geometric and exact, the arithmetic
 * that states it is not, and this is a display transform rather than an index.
 */
export function isSimilarity(m: Affine, tol = 1e-9): boolean {
  const size = Math.abs(m.a) + Math.abs(m.b) + Math.abs(m.c) + Math.abs(m.d);
  if (size === 0) return false;
  return (
    Math.abs(m.a - m.d) / size < tol && Math.abs(m.b + m.c) / size < tol
  );
}

/** How much the map scales lengths. `2` for every sector; see the header. */
export const affineScale = (m: Affine): number => Math.hypot(m.a, m.c);

// ── the sector frame ─────────────────────────────────────────────────────

/**
 * The three corners of sector `s`, in the hexagon's own pixels.
 *
 * A is the CENTRE. The base figure's vertex A sits at barycentric (scale, 0, 0),
 * which `baryToLat` sends to the lattice origin, and the origin is the hexagon's
 * centre — so the six sectors share their apex and the sector view's apex is the
 * hexagon's eye. B and C are hexagon corners s and s+1, in the order
 * `buildHexagon` lays them out. This is the same triangle `guides.sectorFrame`
 * names, and both read it off `hex.corners` rather than re-deriving it.
 */
export function sectorCorners(hex: Hexagon, sector: number): [Pt, Pt, Pt] {
  const s = wrapSector(sector);
  return [hex.centre, hex.corners[s], hex.corners[(s + 1) % 6]];
}

/** The display map for sector `s`: hexagon pixels → triangle-canvas pixels. */
export function sectorTransform(hex: Hexagon, sector: number): Affine {
  return affineFromTriangles(sectorCorners(hex, sector), TRIANGLE_FRAME.corners);
}

/** A cell as the board draws it. The same shape `DrawBoard` already takes. */
export interface ViewCell {
  verts: [number, number][];
  centroid: [number, number];
}

export interface PlateFrame {
  view: PlateView;
  width: number;
  height: number;
  /** The figure's outer boundary, closed. */
  outline: [number, number][];
  /** Every cell of the MODEL, index-aligned, in display pixels. */
  cells: ViewCell[];
  /**
   * The cells this view actually draws, ascending — all of them in hexagon view,
   * one sector's in sector view.
   *
   * A LIST rather than a filtered cell array, because the plate, the history,
   * the orbits and the file all name cells by their index on the hexagon. A view
   * that renumbered them would be a second address space, which is the exact
   * thing this change exists to remove.
   */
  shown: number[];
  /** Model pixels → display pixels. The identity in hexagon view. */
  transform: Affine;
  inverse: Affine;
  /** Canvas units per cell edge, for the hairline. */
  edge: number;
}

const mapCell = (
  verts: readonly (readonly [number, number])[],
  m: Affine
): ViewCell => {
  const out = verts.map((v) => applyAffine(m, v)) as [number, number][];
  let sx = 0;
  let sy = 0;
  for (const v of out) {
    sx += v[0];
    sy += v[1];
  }
  return { verts: out, centroid: [sx / out.length, sy / out.length] };
};

/**
 * The plate as this view draws it.
 *
 * Hexagon view is the identity and costs one pass to copy; sector view applies
 * the similarity to every cell of the model, including the five sectors it does
 * not show. Transforming the invisible ones keeps `cells` index-aligned with the
 * model, which is what lets the ghost, the cursor and the exporter go on
 * indexing it directly — and the cost is 18k multiplies at the deepest depth,
 * once per view change, against the 12k DOM nodes it saves per render by NOT
 * drawing them.
 */
export function plateFrame(hex: Hexagon, view: PlateView): PlateFrame {
  const scale = 2 ** hex.depth;
  if (view.mode === "hexagon") {
    return {
      view,
      width: hex.width,
      height: hex.height,
      outline: hex.corners.map((p) => [p[0], p[1]] as [number, number]),
      cells: hex.cells.map((c) => ({
        verts: c.verts.map((v) => [v[0], v[1]] as [number, number]),
        centroid: [c.centroid[0], c.centroid[1]],
      })),
      shown: hex.cells.map((c) => c.i),
      transform: IDENTITY,
      inverse: IDENTITY,
      edge: hex.radius / scale,
    };
  }

  const s = wrapSector(view.sector);
  const m = sectorTransform(hex, s);
  const shown: number[] = [];
  for (const c of hex.cells) if (c.sector === s) shown.push(c.i);
  return {
    view: { mode: "sector", sector: s },
    width: TRIANGLE_FRAME.width,
    height: TRIANGLE_FRAME.height,
    outline: TRIANGLE_FRAME.corners.map((p) => [p[0], p[1]] as [number, number]),
    cells: hex.cells.map((c) => mapCell(c.verts, m)),
    shown,
    transform: m,
    inverse: invertAffine(m),
    edge: (hex.radius * affineScale(m)) / scale,
  };
}

/**
 * Two decimals, and it MUST match `artworkSvg`'s own `fmt`.
 *
 * The relief hands over deformed vertices; the sector view then moves them, and
 * the board and the file have to round the result the same way or a drawing
 * exported under the relief would not re-import onto the cells it came from.
 * `artfile.GEOMETRY_PRECISION` states the same two, for the same reason.
 */
export const fmtUnit = (n: number): string => {
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? "0" : String(r);
};

/** A polygon's `points` attribute, in display pixels. */
export const pointsOf = (
  verts: readonly (readonly [number, number])[],
  m: Affine
): string =>
  verts
    .map((v) => {
      const p = applyAffine(m, v);
      return `${fmtUnit(p[0])},${fmtUnit(p[1])}`;
    })
    .join(" ");
