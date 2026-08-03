/**
 * Six-point relief: the plate bulges or dishes about the ring the cursor is on.
 *
 * The construction is the user's. Put the cursor on a cell and take the six
 * CORRESPONDING cells — its C6 orbit, one per sector. Rotation preserves
 * distance from the centre, so those six sit at one exact lattice radius and the
 * lines between them close into a hexagonal ring. That ring is the TEMPLATE, and
 * the relief is what you get by applying it to every cell of the figure rather
 * than only to the six it was read off: the ring is pushed out (or pulled in),
 * everything inside follows, everything outside is compressed against the rim,
 * and the plate reads as a curved surface.
 *
 * SIX-POINT, not three. Every one of the six directions is a vanishing point and
 * none of them is privileged — which is the whole difference from a cube corner,
 * where you choose three faces and the other three are the back of the solid.
 * The deformation is a function of the D6-invariant shell alone, so the figure is
 * six-fold symmetric in every frame, at every cursor position. That is not a
 * property to be checked afterwards; there is no term in the field that could
 * break it.
 *
 * ── The height, with no division at all ─────────────────────────────────
 *
 * The height a cell sits at is the SUM OF ITS THREE BAND SIZES — see
 * `bandHeight`, which is where that is derived and where the measurements are.
 * Three integers and one addition: no average, no ratio, no LCM. It is exactly
 * D6-invariant because the three lattice line families are permuted by every
 * element of D6, so the multiset of sizes through a cell survives.
 *
 * A band cannot reach a lattice VERTEX, and the deformation moves vertices, so
 * the geometry needs the same field extended off the cells. It has one, and the
 * two are not two: on the hexagon `bandHeight` is a strictly decreasing
 * BIJECTION of the shell index below, at every depth — same rings, same order,
 * opposite sense. So `shell` is the band-size field written in a coordinate that
 * reaches the whole lattice, and using it is not a second construction.
 *
 * ── The shell ───────────────────────────────────────────────────────────
 *
 * The hexagonal ring index of an Eisenstein point (a, b) is
 *
 *     shell(a, b) = max(|a|, |b|, |a + b|)
 *
 * an exact integer, invariant under all of D6: rot sends (a, b) to (−b, a+b),
 * whose triple of absolute values is {|b|, |a+b|, |a|}, and refl sends it to
 * (a+b, −b), whose triple is {|a+b|, |b|, |a|}. Both are the same multiset, so
 * the max survives. It is also positively homogeneous of degree 1, which is what
 * makes it a RADIUS and not merely a label — and its level sets are exactly the
 * concentric hexagons of the figure. In particular the level set at the rim IS
 * the outline, so the outline is pinned and the plate curves without resizing.
 *
 * Cell keys are three times the centroid, vertex keys are not, so everything
 * below is stated in KEY UNITS: a vertex at lattice v contributes shell 3·|v|.
 * That keeps a cell's own shell and its vertices' shells on one integer scale
 * with no division to reconcile them.
 *
 * ── The division question ───────────────────────────────────────────────
 *
 * Every DECISION here is an integer one. The remapped radius of shell s is
 * carried as a homogeneous pair (n, d) of integers — never as a quotient — and
 * the piecewise branch is chosen by comparing two integers, not two ratios. The
 * normalisation between rings, which is the thing that looks like it needs an
 * average, is the denominator d: it is carried, not computed. There is exactly
 * ONE division in the whole relief, `n / (d · s)` in `shellScales`, and it
 * happens once per RING — some fifty of them for a depth-4 hexagon, against
 * 4608 vertex coordinates — at the moment the integers become pixels. Same rule
 * as `latticeToPixel` in `hexagon.ts`, and for the same reason.
 *
 * The integers stay small: at depth 4 the rim is shell 48 and the largest
 * intermediate is under 2^18, so no product comes near 2^53 and nothing needs a
 * BigInt. `test/relief.test.ts` bounds them rather than assuming it.
 *
 * ── What does NOT move ──────────────────────────────────────────────────
 *
 * The model. `HexCell.key`, `verts`, `centroid`, the paint map, the orbit
 * tables, the band tables and the exported payload are untouched, and the SVG
 * round trip is untouched with them. The relief is a function applied at the
 * point where a cell becomes a polygon on a screen, and turning it off restores
 * the identical file.
 */

import { BAND_FAMILIES, type BandSurface } from "./bands";
import {
  baryToLat,
  rotK,
  type Hexagon,
  type Lat,
} from "./hexagon";

export type Reading = "convex" | "concave";

export const READINGS: readonly Reading[] = ["convex", "concave"] as const;

export const READING_LABEL: Readonly<Record<Reading, string>> = {
  convex: "the template ring pushes out — the plate bulges toward you",
  concave: "the template ring pulls in — the plate dishes away",
};

/**
 * The height field, with no division anywhere: the SUM OF THE THREE BAND SIZES
 * through a cell.
 *
 *     H(cell) = |band_A(cell)| + |band_B(cell)| + |band_C(cell)|
 *
 * A cell lies in one band of each of the three lattice line families. A 60°
 * rotation permutes those three directions, and so does a reflection, so the
 * MULTISET of the three sizes through a cell is preserved and their sum is
 * exactly D6-invariant. Not approximately, and not by tuning: there is no term
 * in it that a symmetry could move. `test/relief.test.ts` checks it against all
 * twelve index maps at every cell rather than taking the argument's word.
 *
 * The point of it is that it needs no average and no ratio. `bands.ts` already
 * measured the closed forms — 2r+1 on the triangle, a tent 4S−1−2u on the
 * hexagon — so band size is already the radial coordinate, and weighting by it
 * is weighting by radius with nothing formed as a quotient. Three integers, one
 * addition.
 *
 * MEASURED, and it decides the design:
 *
 *   hexagon   H is a strictly DECREASING bijection of `shell` at every depth
 *             1–4. Same rings, same order, reversed sense: H is largest at the
 *             centre. So the band-size field and the hexagonal ring index are
 *             the same field, and `shell` — which extends to lattice VERTICES,
 *             where a band cannot reach because a vertex is in no band — may be
 *             used as its geometric coordinate without inventing a second one.
 *             H = 3(4S−1) at the middle and falls by exactly 2 per ring, giving
 *             2^(d+1) − 1 rings: 3 at depth 1, 7 at depth 2, 15 at 3, 31 at 4.
 *
 *   triangle  H takes exactly TWO values at every depth (7/9, 15/17, 31/33),
 *             because the three band indices of a triangle cell sum to a
 *             constant and only the orientation moves it. It is D3-invariant and
 *             it is FLAT. The field carries no height on that canvas, which is
 *             one of the reasons the relief is offered on the hexagon alone.
 */
export function bandHeight(bands: BandSurface, cell: number): number {
  let h = 0;
  for (const f of BAND_FAMILIES) h += bands.band(bands.bandOf(cell, f)).length;
  return h;
}

/** The hexagonal ring index. Exact, integer, D6-invariant. See the header. */
export function shell(v: Lat): number {
  const a = v[0] < 0 ? -v[0] : v[0];
  const b = v[1] < 0 ? -v[1] : v[1];
  const s = v[0] + v[1];
  const c = s < 0 ? -s : s;
  return a > b ? (a > c ? a : c) : b > c ? b : c;
}

// ── the remap, as integers ───────────────────────────────────────────────

/**
 * How far the template ring travels, as a fraction of its own distance to the
 * rim: `STRENGTH_N / STRENGTH_D`.
 *
 * A half, and the reason is an asymmetry that only showed up on screen. The
 * displacement is ADDITIVE but the eye reads it multiplicatively, so at a whole
 * one a template ring near the centre moved out by a factor of 1.8 and IN by a
 * factor of 6 — the convex reading was a gentle bulge and the concave one
 * collapsed the middle of the drawing to a point. At a half the same ring goes
 * out by 1.4 and in by 1.7, which are the same effect seen from two sides, and
 * both are plainly visible at every ring. Measured on a 504-cell plate at depth
 * 4, not reasoned about.
 */
export const STRENGTH_N = 1;
export const STRENGTH_D = 2;

/** A radius carried as an exact integer fraction. Never divided until emission. */
export interface Ratio {
  n: number;
  d: number;
}

/**
 * Where the template ring itself lands, exactly.
 *
 *   convex   T = S + A·S·(M − S) / (B·M)
 *   concave  T = S − A·S·(M − S) / (B·M)
 *
 * for template shell S, rim shell M. The (M − S) factor is what pins the rim
 * and the centre: the displacement vanishes at both ends, so the plate curves
 * rather than growing, and the outline never moves by a pixel. At A = B = 1 the
 * map is monotone for every S — convex has T = S(2M − S)/M, whose derivative
 * 2(M − S)/M is non-negative and which reaches M only at S = M; concave has
 * T = S²/M, which is increasing and below S throughout. A remap that was not
 * monotone would fold the plate through itself.
 */
export function templateRadius(S: number, M: number, reading: Reading): Ratio {
  const drift = STRENGTH_N * (M - S);
  const base = STRENGTH_D * M;
  return {
    n: S * (reading === "convex" ? base + drift : base - drift),
    d: base,
  };
}

/**
 * The remapped radius of shell `s`, as an exact integer fraction.
 *
 * Two linear pieces joined at the template ring: everything inside it is scaled
 * so that the ring lands at T, everything outside is scaled so that the ring
 * lands at T and the rim stays at M. The branch is chosen by comparing two
 * integers — `s <= S` — and never by comparing two ratios.
 *
 *   s ≤ S    r' = s·T/S              = (s·Tn) / (S·Td)
 *   s > S    r' = T + (s−S)·(M−T)/(M−S)
 *                                    = (Tn·(M−S) + (s−S)·(M·Td − Tn)) / (Td·(M−S))
 *
 * The two agree at s = S, which is the continuity the plate needs and which
 * `test/relief.test.ts` checks as an identity on integers rather than to within
 * a tolerance.
 */
export function remapRadius(
  s: number,
  S: number,
  M: number,
  reading: Reading
): Ratio {
  if (S <= 0 || S >= M) return { n: s, d: 1 };
  const t = templateRadius(S, M, reading);
  if (s <= S) return { n: s * t.n, d: S * t.d };
  return {
    n: t.n * (M - S) + (s - S) * (M * t.d - t.n),
    d: t.d * (M - S),
  };
}

/**
 * The per-ring scale factors, and the ONLY division in this module.
 *
 * `scale[s]` multiplies a vertex's offset from the centre. It is r'(s)/s, so the
 * ring at shell s lands where the remap says it should, and every point of that
 * ring moves by the same factor — which is what keeps the six-fold symmetry
 * exact: the scale cannot depend on the direction because `s` does not.
 *
 * One divide per ring, roughly fifty of them, standing in for one divide per
 * vertex coordinate, of which there are 4608 at depth 4. That is the "carry the
 * denominator, do not compute the quotient" rule paying for itself.
 */
export function shellScales(S: number, M: number, reading: Reading): Float64Array {
  const out = new Float64Array(M + 1);
  // The centre vertex is the origin; any factor sends it to itself, and 1 is the
  // one that does not make the array look like it means something.
  out[0] = 1;
  for (let s = 1; s <= M; s++) {
    const r = remapRadius(s, S, M, reading);
    out[s] = r.n / (r.d * s);
  }
  return out;
}

// ── the display surface ──────────────────────────────────────────────────

export type Pt = readonly [number, number];

interface ReliefCell {
  /** Vertex offsets from the plate centre, in canvas units. */
  d: Pt[];
  /** Each vertex's shell, in key units, aligned to `d`. */
  s: number[];
  /** The cell's own shell, in key units. */
  shell: number;
}

export interface ReliefSurface {
  centre: Pt;
  /** The rim's shell — three times the figure's scale. */
  maxShell: number;
  cells: ReliefCell[];
  /** Distinct cell shells, ascending. Used to group the wash. */
  ringValues: number[];
}

/**
 * Everything the relief needs about a hexagon, precomputed once per figure.
 *
 * The per-vertex lattice points are recovered the way `buildHexagon` made them —
 * `rotK(baryToLat(bary), sector)` — rather than by reading them off the cell,
 * because `HexCell` does not carry them and adding a field to it would change a
 * structure six other modules and a golden file depend on. Recomputing is exact
 * and costs one pass.
 */
export function buildRelief(hex: Hexagon): ReliefSurface {
  const [cx, cy] = hex.centre;
  const rings = new Set<number>();
  const cells = hex.cells.map((c) => {
    const bary = hex.base.cells[c.base].bary;
    const s = bary.map((b) => 3 * shell(rotK(baryToLat(b), c.sector)));
    const own = shell(c.key);
    rings.add(own);
    return {
      d: c.verts.map((v) => [v[0] - cx, v[1] - cy] as Pt),
      s,
      shell: own,
    };
  });
  return {
    centre: hex.centre,
    maxShell: 3 * 2 ** hex.depth,
    cells,
    ringValues: [...rings].sort((a, b) => a - b),
  };
}

/**
 * The template ring the cursor names: the shell of the cell under it.
 *
 * Its C6 orbit is six cells at this one shell — that is the ring the user drew
 * — and every cell of the orbit gives the same answer, so the relief does not
 * depend on WHICH of the six the pointer happens to be over. Exactly the
 * property that makes it a template rather than a highlight.
 */
export function templateShell(surface: ReliefSurface, cell: number): number {
  const c = surface.cells[cell];
  return c === undefined ? restShell(surface) : c.shell;
}

/**
 * The template with nobody pointing at the plate — and the one the export bakes.
 *
 * Half the rim, which is where the displacement is largest, so the resting plate
 * shows the effect rather than hiding it. Fixed rather than sampled, because an
 * export taken from wherever the cursor happened to be would make
 * paint → export → clear → load → re-export depend on the pointer, and the round
 * trip would stop being byte-identical for a reason with nothing to do with the
 * drawing. What you see when you are not pointing at the plate is what the file
 * gets.
 */
export function restShell(surface: ReliefSurface): number {
  return surface.maxShell >> 1;
}

export interface ReliefFrame {
  /**
   * The deformed vertices per cell, for the exporter — which formats its own
   * coordinates and cannot be handed a finished string.
   */
  verts: Pt[][];
  /** `points` attribute text per cell, aligned to the figure's cells. */
  points: string[];
  /** Deformed centroids, for the seed ring and anything else that needs one. */
  centroids: Pt[];
  /** Cell index lists grouped by the wash they take, ready to emit as one `<g>`. */
  wash: { fill: string; alpha: number; cells: number[] }[];
  /** The ring the frame was built for. */
  shell: number;
  scales: Float64Array;
}

/** Two decimals, matching what `artworkSvg` writes, so board and file agree. */
const fmt = (n: number): string => {
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? "0" : String(r);
};

/**
 * The tone, and why the geometry alone was not enough.
 *
 * Measured first: a piecewise-linear remap magnifies the whole inside of the
 * template ring by ONE constant factor, so the inner region is a plane parallel
 * to the screen — a frustum, not a dome. Rendered with tone taken from the local
 * stretch it therefore came out as a fisheye lens over a flat plate, which is
 * what it geometrically is, and not as a solid. The screenshots said so plainly.
 *
 * So the tone is taken from the HEIGHT rather than from the geometry: the
 * band-size field, which is the radial coordinate, shaded as a bowl. It has to
 * be radially symmetric — a directional light would break the six-fold symmetry
 * that is the whole point — so the light is on the view axis and the shading is
 * a pure function of the ring, which is exactly the constraint the construction
 * was under anyway.
 *
 *   BOWL      lifts the near half and sinks the far half. Convex is bright in
 *             the middle, concave dark in the middle; the quadratic falloff is
 *             what makes it read as curved rather than as a spotlight.
 *   COMPRESS  darkens whatever the remap crowded. It reinforces the bowl in BOTH
 *             readings without being told to: convex compresses the rim, concave
 *             compresses the centre, and both are the part turning away.
 */
export const BOWL = 0.46;
export const COMPRESS = 0.3;

/**
 * The relief at one template ring: deformed polygons, and the tone that goes
 * with them.
 *
 * Recomputed only when the RING changes, not when the pointer does. The ring is
 * an integer, and a pointer crossing a depth-4 hexagon passes through some fifty
 * of them, so a sweep costs fifty of these rather than one per pointer event —
 * which is what makes a display effect on 1536 cells affordable at all.
 */
export function reliefFrame(
  surface: ReliefSurface,
  ring: number,
  reading: Reading
): ReliefFrame {
  const M = surface.maxShell;
  const scales = shellScales(ring, M, reading);
  const [cx, cy] = surface.centre;

  const verts = new Array<Pt[]>(surface.cells.length);
  const points = new Array<string>(surface.cells.length);
  const centroids = new Array<Pt>(surface.cells.length);
  for (let i = 0; i < surface.cells.length; i++) {
    const c = surface.cells[i];
    const v = new Array<Pt>(c.d.length);
    let out = "";
    let sx = 0;
    let sy = 0;
    for (let k = 0; k < c.d.length; k++) {
      const f = scales[c.s[k]];
      const x = cx + c.d[k][0] * f;
      const y = cy + c.d[k][1] * f;
      v[k] = [x, y];
      sx += x;
      sy += y;
      out += (k === 0 ? "" : " ") + fmt(x) + "," + fmt(y);
    }
    verts[i] = v;
    points[i] = out;
    centroids[i] = [sx / c.d.length, sy / c.d.length];
  }

  // The wash is a function of the ring alone, so one group per ring covers the
  // whole plate and the file gains a few dozen elements rather than 1536.
  const byBand = new Map<string, number[]>();
  for (let i = 0; i < surface.cells.length; i++) {
    const w = washAt(surface.cells[i].shell, scales, M, reading);
    if (w.alpha <= 0.002) continue;
    const key = `${w.fill} ${Math.round(w.alpha * 250) / 250}`;
    const bucket = byBand.get(key);
    if (bucket === undefined) byBand.set(key, [i]);
    else bucket.push(i);
  }
  const wash = [...byBand].sort().map(([key, cells]) => {
    const [fill, alpha] = key.split(" ");
    return { fill, alpha: Number(alpha), cells };
  });

  return { verts, points, centroids, wash, shell: ring, scales };
}

/**
 * The tone at one ring: a bowl, plus a darkening of whatever was crowded.
 *
 * `q` is the ring's normalised radius — the one place besides `shellScales`
 * where an integer becomes a float, and for the same reason: it is being turned
 * into a pixel. Everything upstream of it is exact.
 */
function washAt(
  s: number,
  scales: Float64Array,
  M: number,
  reading: Reading
): { fill: string; alpha: number } {
  const q = s / M;
  const bowl = 1 - q * q;
  let lit = 0;
  let dark = 0;
  if (reading === "convex") lit = BOWL * bowl;
  else dark = BOWL * bowl;

  // Local stretch: how far apart this ring and the next now sit, against the one
  // unit they sat at before. Below one is compression, and compression is a
  // surface turning away.
  if (s > 0 && s < M) {
    const stretch = scales[s + 1] * (s + 1) - scales[s] * s;
    if (stretch < 1) dark += COMPRESS * (1 - stretch);
  }

  const net = lit - dark;
  const alpha = net < 0 ? -net : net;
  return { fill: net >= 0 ? "#fff" : "#000", alpha: alpha > 1 ? 1 : alpha };
}

/**
 * Where an arbitrary canvas point lands under the same remap.
 *
 * Needed for the axis overlay, which is drawn in pixels rather than in cells.
 * The inverse of `latticeToPixel` recovers fractional lattice coordinates, the
 * shell function is positively homogeneous so it extends to them unchanged, and
 * the scale is read off the ring table with a linear blend between the two
 * integer rings the point falls between.
 *
 * Float throughout, and legitimately so: this decides where to draw a guide, not
 * which cell a stroke touches.
 */
export function deformPoint(
  surface: ReliefSurface,
  scales: Float64Array,
  p: Pt
): Pt {
  const [cx, cy] = surface.centre;
  const dx = p[0] - cx;
  const dy = p[1] - cy;
  const M = surface.maxShell;
  // Pixels per lattice step: the rim is at lattice distance M/3 and at
  // `cornerOffset` pixels, and `latticeToPixel` is linear, so one recovers the
  // other. Inverting it gives fractional (a, b), and `shell` is positively
  // homogeneous so it extends to them without change.
  const unit = (3 * cornerOffset(surface)) / M;
  if (unit === 0) return p;
  const b = (-dy * 2) / (Math.sqrt(3) * unit);
  const a = dx / unit - b / 2;
  const t = 3 * shell([a, b]);
  if (t <= 0) return p;
  if (t >= M) return [cx + dx * scales[M], cy + dy * scales[M]];
  const lo = Math.floor(t);
  const f = scales[lo] + (scales[lo + 1] - scales[lo]) * (t - lo);
  return [cx + dx * f, cy + dy * f];
}

/** Pixel distance from the centre to a hexagon CORNER, cached per surface. */
const RIM = new WeakMap<ReliefSurface, number>();

function cornerOffset(surface: ReliefSurface): number {
  const cached = RIM.get(surface);
  if (cached !== undefined) return cached;
  let best = 0;
  for (const c of surface.cells) {
    for (let k = 0; k < c.d.length; k++) {
      if (c.s[k] !== surface.maxShell) continue;
      const r = Math.hypot(c.d[k][0], c.d[k][1]);
      if (r > best) best = r;
    }
  }
  RIM.set(surface, best);
  return best;
}
