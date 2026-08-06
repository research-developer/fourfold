/**
 * The lattice, as the keyboard and the shape tools need it: neighbour steps, a
 * radial axis, a ring index, and the two exact figures a line and a circle are.
 *
 * `orbit.ts` answers "which cells are the same cell?"; `bands.ts` answers "which
 * cells are the same row?". Neither answers "which cell is one step EAST of this
 * one?", and a keyboard has to. Screen pixels would answer it — `guides.ts`
 * already does that for the arrow keys, by centroid geometry — but a pixel
 * answer drifts with the depth and cannot be stated as a fact about the figure.
 * This module answers it on the lattice instead.
 *
 * ZERO FLOAT IN THIS FILE. Every step is an exact integer delta on the key the
 * figure already carries, every ring is an integer, and every membership test is
 * an integer comparison. Nothing here compares a coordinate to a tolerance.
 *
 * ── One lattice, two canvases ────────────────────────────────────────────
 *
 * Both canvases are the same triangular lattice seen through different bases,
 * and `hexagon.ts` already contains the bridge. `baryToLat` sends a barycentric
 * vertex (x, y, z) to the Eisenstein point (y, z), so a TRIANGLE cell's key
 * (k₀, k₁, k₂) is the Eisenstein key (k₁, k₂) with k₀ = 3·scale − k₁ − k₂ along
 * for the ride, and a HEXAGON cell's key already IS Eisenstein. So everything
 * below is stated once, in (a, b).
 *
 * ── Up and down cells do NOT have the same neighbours ────────────────────
 *
 * A cell key is three times its centroid (`bands.ts` derives this), so
 *
 *     upright   key ≡ (1, 1)  (mod 3)
 *     inverted  key ≡ (2, 2)  (mod 3)
 *
 * and the three EDGE neighbours are
 *
 *     from upright    (+1,+1)   (−2,+1)   (+1,−2)
 *     from inverted   (−1,−1)   (+2,−1)   (−1,+2)
 *
 * — the second list is the negative of the first, so the two orientations reach
 * DISJOINT sets of directions. On screen the upright triad sits at 30°, 150°,
 * 270° and the inverted triad at 90°, 210°, 330°. There is no cell-to-cell edge
 * step due east on either. A keyboard cluster mapped to the edge steps would
 * therefore mean something different under the finger depending on which way up
 * the cell was, which is not a keyboard anybody can learn.
 *
 * ── So the ring keys move on the SAME-ORIENTATION sublattice ─────────────
 *
 * Take instead the six shortest translations between cells of the same
 * orientation. In key units they are 3·u for the six Eisenstein units u, they
 * are all the same length — exactly one cell edge — and on screen they sit at
 * 0°, 60°, 120°, 180°, 240° and 300°. That is precisely the E / NE / NW / W /
 * SW / SE cluster a keyboard wants, it is IDENTICAL for both orientations, and
 * it is exact. `test/lattice.test.ts` measures the screen angle of every one of
 * them on both canvases rather than taking this paragraph's word.
 *
 * The cost is stated rather than hidden: the six ring keys preserve orientation,
 * so on their own they reach only half the cells. The RADIAL keys are what cross
 * over — every radial step flips the orientation — so the cluster as a whole
 * still reaches every cell of the canvas, which `test/lattice.test.ts` checks by
 * flood fill.
 *
 * ── The triangle canvas is the hexagon's lattice, turned 120° ────────────
 *
 * `toXY` puts vertex A at the top and B, C along the bottom, so on the triangle
 * canvas e₁ points at 240° and e₂ at 300°; `latticeToPixel` puts e₁ at 0° and e₂
 * at 60°. The two differ by exactly two sixths of a turn, so the triangle's
 * direction table is the hexagon's under `rotK(·, 2)` — derived, not retyped,
 * and measured in the tests.
 *
 * ── The radial axis ─────────────────────────────────────────────────────
 *
 * "Outward" is away from the LATTICE ORIGIN, which is the hexagon's centre and
 * the triangle's apex — in both cases the point the figure was built around.
 * Within one sector the outward ray is rot^s applied to the (1,1) diagonal, and
 * the step alternates in length because the two orientations sit at different
 * heights inside their row:
 *
 *     base-upright cell    outward = 1·u      inward = 2·u
 *     base-inverted cell   outward = 2·u      inward = 1·u        u = rot^s(1,1)
 *
 * Both flip the orientation, and both hold the angular position EXACTLY: the
 * move is along the sector's own median, so the horizontal coordinate does not
 * change by a pixel. `baseEps` rather than `eps` because rotating a sector by an
 * odd multiple of 60° swaps the two orientations, and it is the base cell's
 * orientation that says which of the two step lengths applies.
 *
 * On the HEXAGON a radial step strictly increases the ring index below; on the
 * TRIANGLE it moves exactly one band of family A, apex to base. Those are the
 * two figures' own radial coordinates and they are not the same coordinate — see
 * the note on `ringOf`.
 *
 * ── The ring ────────────────────────────────────────────────────────────
 *
 * `ringOf` is `shell` — the hexagonal norm `max(|a|, |b|, |a+b|)` that
 * `relief.ts` already derives and already uses as the hexagon's ring index —
 * measured from the FIGURE'S CENTRE rather than from the lattice origin.
 *
 *   hexagon   the centre IS the origin, so this is exactly `relief.ts`'s shell.
 *             Level sets are the concentric hexagons of the figure, closed, and
 *             invariant under all twelve isometries.
 *
 *   triangle  the centre is the centroid, at key (scale, scale, scale). Written
 *             out, `shell(key − centre) = max |kᵢ − scale|`, which is symmetric
 *             in the three barycentric coordinates and therefore invariant under
 *             all of D₃. Its level sets are still hexagons — the same norm — but
 *             the triangle CLIPS them, so a triangle ring is a hexagon with its
 *             far corners cut off, and near the rim it survives only as three
 *             arcs. That is the honest analogue of a circle here, and it is why
 *             `ringCells` reports whether the ring it returned is clipped.
 *
 * The triangle's radial KEYS and its ring INDEX are therefore about different
 * centres — the apex and the centroid — and that is not a slip. A ray from the
 * centroid is not a lattice direction on a D₃ figure: the six directions that
 * are lattice rays point at the corners and the edge midpoints, and no two of
 * them are related by the group. The apex axis is the one radial coordinate the
 * triangle actually has, and it is the one `bands.ts` already orders apex-first.
 */

import type { BrushStamp } from "./brush";
import { BAND_FAMILIES, type BandFamily, type BandSurface } from "./bands";
import type { Figure } from "./figure";
import { rotK, type Hexagon, type Lat } from "./hexagon";
import {
  subgroupMaps,
  type BrushMode,
  type CanvasKind,
  type SymmetrySurface,
} from "./orbit";
import { shell } from "./relief";

// ── the six ring directions ──────────────────────────────────────────────

/** The six screen directions the ring keys name, anticlockwise from east. */
export type RingDir = "E" | "NE" | "NW" | "W" | "SW" | "SE";

export const RING_DIRS: readonly RingDir[] = [
  "E",
  "NE",
  "NW",
  "W",
  "SW",
  "SE",
] as const;

/** Which key each direction is bound to. One table, read by the UI and the help. */
export const RING_KEY: Readonly<Record<RingDir, string>> = {
  E: "d",
  NE: "e",
  NW: "q",
  W: "a",
  SW: "z",
  SE: "c",
};

/**
 * The six Eisenstein units, named by the screen direction they point in ON THE
 * HEXAGON — where `latticeToPixel` sends e₁ due east and e₂ to 60°.
 *
 * A same-orientation step is three of these in key units; see the header.
 */
const HEX_UNIT: Readonly<Record<RingDir, Lat>> = {
  E: [1, 0],
  NE: [0, 1],
  NW: [-1, 1],
  W: [-1, 0],
  SW: [0, -1],
  SE: [1, -1],
};

/** The same six on the TRIANGLE canvas, whose basis is turned by 120°. */
const TRI_UNIT: Readonly<Record<RingDir, Lat>> = Object.fromEntries(
  RING_DIRS.map((d) => [d, rotK(HEX_UNIT[d], 2)])
) as Record<RingDir, Lat>;

/** The unit step for a direction on a canvas. Exact, integer, orientation-free. */
export function ringUnit(kind: CanvasKind, dir: RingDir): Lat {
  return kind === "triangle" ? TRI_UNIT[dir] : HEX_UNIT[dir];
}

export const OPPOSITE: Readonly<Record<RingDir, RingDir>> = {
  E: "W",
  W: "E",
  NE: "SW",
  SW: "NE",
  NW: "SE",
  SE: "NW",
};

// ── the view ─────────────────────────────────────────────────────────────

export type Radial = "out" | "in";

export interface LatticeView {
  kind: CanvasKind;
  depth: number;
  /**
   * The canvas's resolution, carried so `functionals` below reads it instead of
   * raising a depth. A BUFFER CARRYING SCALE, which is the half of the
   * depth→scale change that is not about the figure: `docs/rep-tile-findings.md`
   * names "a buffer keyed by depth would be comparing incomparable things" as
   * where the work is, and a lattice view is one such buffer.
   */
  scale: number;
  cellCount: number;
  /** The cell's exact Eisenstein key — three times its centroid. */
  keyOf(i: number): Lat;
  /** The cell at a key, or −1 when the key is off the canvas. */
  at(key: Lat): number;
  /** One ring step, or −1 at the edge of the canvas. */
  step(i: number, dir: RingDir): number;
  /** One radial step, or −1 at the edge of the canvas. */
  radial(i: number, way: Radial): number;
  /** The exact ring index about the figure's own centre. See the header. */
  ringOf(i: number): number;
  /** Every ring index that holds at least one cell, ascending. */
  ringValues: readonly number[];
  /** Every cell of a ring, ascending. Empty for a ring nothing sits on. */
  ring(r: number): number[];
  /** The band index of a cell from the apex, triangle only; −1 on the hexagon. */
  rowOf(i: number): number;
}

const isHexagon = (canvas: Figure | Hexagon): canvas is Hexagon =>
  "base" in canvas;

const latKey = (v: Lat) => `${v[0]},${v[1]}`;

/**
 * Floor division by three, exact for integers of either sign.
 *
 * The same function `bands.ts` derives and for the same reason: hexagon lattice
 * coordinates are negative in half the sectors and JavaScript's `%` returns a
 * negative remainder there, so the double fold is load-bearing. Copied rather
 * than imported because `bands.ts` keeps it private, and a second three-line
 * exact function is cheaper than widening that module's surface.
 */
function div3(x: number): number {
  const r = ((x % 3) + 3) % 3;
  return (x - r) / 3;
}

export function latticeView(canvas: Figure | Hexagon): LatticeView {
  const hex = isHexagon(canvas);
  const kind: CanvasKind = hex ? "hexagon" : "triangle";
  const scale = canvas.scale;
  const n = canvas.cells.length;

  const keys = new Array<Lat>(n);
  const sectors = new Int8Array(n);
  const baseEps = new Uint8Array(n);
  const index = new Map<string, number>();

  if (isHexagon(canvas)) {
    for (const c of canvas.cells) {
      keys[c.i] = c.key;
      sectors[c.i] = c.sector;
      baseEps[c.i] = c.baseEps;
      index.set(latKey(c.key), c.i);
    }
  } else {
    for (const c of canvas.cells) {
      const k: Lat = [c.key[1], c.key[2]];
      keys[c.i] = k;
      sectors[c.i] = 0;
      baseEps[c.i] = c.eps;
      index.set(latKey(k), c.i);
    }
  }

  /** The figure's centre, in key units. The origin on the hexagon. */
  const centre: Lat = hex ? [0, 0] : [scale, scale];

  const at = (k: Lat): number => index.get(latKey(k)) ?? -1;

  const ringAt = (i: number): number =>
    shell([keys[i][0] - centre[0], keys[i][1] - centre[1]]);

  const rings = new Array<number>(n);
  const byRing = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = ringAt(i);
    rings[i] = r;
    const list = byRing.get(r);
    if (list === undefined) byRing.set(r, [i]);
    else list.push(i);
  }
  const ringValues = [...byRing.keys()].sort((a, b) => a - b);

  const guard = (i: number) => {
    if (!Number.isInteger(i) || i < 0 || i >= n) {
      throw new Error(`lattice: cell ${i} is not on this ${kind}`);
    }
  };

  return {
    kind,
    depth: canvas.depth,
    scale,
    cellCount: n,
    keyOf(i) {
      guard(i);
      return keys[i];
    },
    at,
    step(i, dir) {
      guard(i);
      const u = ringUnit(kind, dir);
      return at([keys[i][0] + 3 * u[0], keys[i][1] + 3 * u[1]]);
    },
    radial(i, way) {
      guard(i);
      // rot^s(1,1) is the sector's own outward median; the step length is 1 or 2
      // according to the BASE orientation, and the two swap between out and in.
      const u = rotK([1, 1], sectors[i]);
      const outward = baseEps[i] === 0 ? 1 : 2;
      const f = way === "out" ? outward : -(3 - outward);
      return at([keys[i][0] + f * u[0], keys[i][1] + f * u[1]]);
    },
    ringOf(i) {
      guard(i);
      return rings[i];
    },
    ringValues,
    ring: (r) => [...(byRing.get(r) ?? [])],
    rowOf(i) {
      guard(i);
      if (hex) return -1;
      // The A-band index, counted from the APEX, which is what `bands.ts` calls
      // apex-first order: the strip along edge BC is α = 0 and the one at the
      // apex is α = scale − 1, so the row number is scale − 1 − α.
      const k0 = 3 * scale - keys[i][0] - keys[i][1];
      return scale - 1 - div3(k0);
    },
  };
}

// ── the line ─────────────────────────────────────────────────────────────

/**
 * The three barycentric-style functionals, one per band family, in key units.
 *
 * They sum to a constant on each canvas — 3·scale on the triangle, 0 on the
 * hexagon — so the three of them are one coordinate system with one relation,
 * exactly as barycentrics are. Family i's bands are the level sets of the i-th
 * after floor-division by three, which is `bands.ts`'s own definition up to a
 * relabelling of the line numbers on the hexagon (`div3(−t)` and `div3(t)` cut
 * the same partition, in the opposite order).
 */
function functionals(view: LatticeView, i: number): [number, number, number] {
  const [a, b] = view.keyOf(i);
  if (view.kind === "hexagon") return [-(a + b), a, b];
  // The three sum to 3·scale on the triangle — a constant in the canvas's own
  // resolution, which is what makes them one coordinate system. Read off the
  // view rather than raised from its depth.
  return [3 * view.scale - a - b, a, b];
}

const FAMILY_AT: Readonly<Record<BandFamily, 0 | 1 | 2>> = { A: 0, B: 1, C: 2 };

/**
 * Where a cell sits ALONG a band of the given family, as an exact integer.
 *
 * The difference of the other two functionals. It is injective on a band —
 * consecutive cells of a row alternate orientation and the two orientations land
 * on different residues mod 6 — so it is a total order on the row, which is what
 * a segment needs. `test/lattice.test.ts` checks the injectivity on both
 * canvases at every depth it can afford rather than resting on that sentence.
 */
export function alongBand(
  view: LatticeView,
  i: number,
  family: BandFamily
): number {
  const f = functionals(view, i);
  const k = FAMILY_AT[family];
  return f[(k + 2) % 3] - f[(k + 1) % 3];
}

/**
 * Which of the three lattice line directions the drag most nearly named.
 *
 * A triangular lattice has EXACTLY three line directions, so a segment between
 * two cells that share no band is not a lattice object at all — drawing one
 * would mean rasterising, and every rasterisation rule is a tolerance dressed as
 * a choice. So LINE snaps: the family kept is the one whose band coordinate
 * changed LEAST between the anchor and the release, which is the direction the
 * drag was most nearly along. Ties go to the family the drag travelled furthest
 * in, and then to A, B, C order, so the answer is a function of the two cells
 * and not of the path between them.
 */
export function lineFamily(
  bands: BandSurface,
  anchor: number,
  target: number
): BandFamily {
  let best: BandFamily = "A";
  let bestOff = Number.MAX_SAFE_INTEGER;
  let bestRun = -1;
  for (const f of BAND_FAMILIES) {
    const off = Math.abs(
      bands.bandOf(target, f).line - bands.bandOf(anchor, f).line
    );
    let run = 0;
    for (const g of BAND_FAMILIES) {
      if (g === f) continue;
      const d = Math.abs(
        bands.bandOf(target, g).line - bands.bandOf(anchor, g).line
      );
      if (d > run) run = d;
    }
    if (off < bestOff || (off === bestOff && run > bestRun)) {
      best = f;
      bestOff = off;
      bestRun = run;
    }
  }
  return best;
}

export interface LineSpec {
  family: BandFamily;
  cells: number[];
  /** How far the segment reaches along the band, in `alongBand` units. */
  reach: number;
}

/**
 * The lattice segment a drag names: a run of one exact band.
 *
 * The band is `bands.ts`'s own band through the anchor, so a LINE is literally a
 * piece of the row a band brush would paint — the two tools cannot come to
 * disagree about what a row is. The run is cut by comparing `alongBand`
 * integers, never by comparing positions.
 *
 * `symmetric` is the Option/Alt reading: the segment is centred ON the anchor
 * and reaches the same distance both ways, rather than running from it.
 */
export function lineCells(
  view: LatticeView,
  bands: BandSurface,
  anchor: number,
  target: number,
  symmetric = false
): LineSpec {
  const family = lineFamily(bands, anchor, target);
  const t0 = alongBand(view, anchor, family);
  // The target's own coordinate, even when it is off the band: it is the exact
  // projection of the release point onto the line, and integer.
  const t1 = alongBand(view, target, family);
  const reach = Math.abs(t1 - t0);
  const lo = symmetric ? t0 - reach : Math.min(t0, t1);
  const hi = symmetric ? t0 + reach : Math.max(t0, t1);
  const cells = bands
    .bandThrough(anchor, family)
    .filter((c) => {
      const t = alongBand(view, c, family);
      return t >= lo && t <= hi;
    })
    .sort((a, b) => a - b);
  return { family, cells, reach };
}

// ── the ring ─────────────────────────────────────────────────────────────

export interface RingSpec {
  /** The ring indices painted, inclusive. */
  from: number;
  to: number;
  cells: number[];
  /**
   * True when the ring meets the figure's boundary, so it is an arc set rather
   * than a closed ring. Always false on the hexagon, where the level sets of the
   * shell are the figure's own concentric hexagons; often true on the triangle,
   * which cuts the same hexagons at its three edges.
   */
  clipped: boolean;
}

/**
 * The cells between two ring indices, inclusive.
 *
 * A press names a ring and the drag names another, so an unmoved press paints
 * ONE ring and a drag outward paints the annulus between them. `symmetric` is
 * the Option/Alt reading, exactly as it is for a line: the annulus is centred on
 * the anchor's ring and reaches the same number of rings each way.
 */
export function ringCells(
  view: LatticeView,
  anchorRing: number,
  targetRing: number,
  symmetric = false
): RingSpec {
  const reach = Math.abs(targetRing - anchorRing);
  const from = symmetric ? anchorRing - reach : Math.min(anchorRing, targetRing);
  const to = symmetric ? anchorRing + reach : Math.max(anchorRing, targetRing);
  const cells: number[] = [];
  for (let i = 0; i < view.cellCount; i++) {
    const r = view.ringOf(i);
    if (r >= from && r <= to) cells.push(i);
  }
  return { from, to, cells, clipped: view.kind === "triangle" };
}

// ── composing a shape with the brush ─────────────────────────────────────

/**
 * A shape carried by the subgroup, coloured by WHICH IMAGE a cell landed in.
 *
 * Exactly the rule `bands.ts` derives for a band, applied to any cell set: an
 * isometry carries a lattice line to a lattice line, so the image of a LINE
 * under a group element is another line, and a line under a 6-fold brush is six
 * lines each taking one hue. Images are deduplicated by cell-set identity, which
 * is exact, and a cell in two images keeps the LOWEST group index — the source
 * is group 0, so it keeps everything it holds and each later image yields to
 * every earlier one.
 */
export function imageStamp(
  surface: SymmetrySurface,
  mode: BrushMode,
  source: readonly number[]
): BrushStamp {
  const src = [...new Set(source)].sort((a, b) => a - b);
  if (src.length === 0) return { cells: [], keys: [], span: 1, groups: [] };
  const groups: number[][] = [src];
  const seen = new Set<string>([src.join(",")]);
  for (const m of subgroupMaps(surface, mode)) {
    const image = [...new Set(src.map((j) => m[j]))].sort((a, b) => a - b);
    const sig = image.join(",");
    if (seen.has(sig)) continue;
    seen.add(sig);
    groups.push(image);
  }
  const key = new Map<number, number>();
  groups.forEach((g, k) => {
    for (const c of g) if (!key.has(c)) key.set(c, k);
  });
  const cells = [...key.keys()].sort((a, b) => a - b);
  return {
    cells,
    keys: cells.map((c) => key.get(c) as number),
    span: groups.length,
    groups,
  };
}

/**
 * A shape carried by the subgroup, coloured by ORBIT POSITION.
 *
 * The other honest reading, and the right one for a RING. A figure-centred ring
 * is fixed by the whole group — that is what makes it a ring — so every image of
 * it is itself and `imageStamp` would collapse the whole ring onto one hue.
 * Position within the orbit does not collapse: a ring under a 6-fold brush comes
 * out with a six-fold colour period running round it, which is the program's
 * founding rule (orbit position indexes the wheel) applied to a set that happens
 * to be invariant.
 *
 * The span is the SUBGROUP ORDER rather than the orbit length, for the same
 * reason `brushSpan` reports it: a cell with a non-trivial stabiliser has a short
 * orbit and takes fewer hues, and the scheme is still being read over the
 * subgroup.
 */
export function orbitStamp(
  surface: SymmetrySurface,
  mode: BrushMode,
  source: readonly number[]
): BrushStamp {
  const key = new Map<number, number>();
  for (const c of source) {
    const o = surface.orbit(c, mode);
    for (let k = 0; k < o.length; k++) if (!key.has(o[k])) key.set(o[k], k);
  }
  const cells = [...key.keys()].sort((a, b) => a - b);
  return {
    cells,
    keys: cells.map((c) => key.get(c) as number),
    span: surface.order(mode),
    groups: null,
  };
}

/**
 * A shape's source cells, confined to the region the surface's group acts in.
 *
 * The same clip `bands.ts` applies to a band and for the same reason: a line or
 * a ring is a whole-canvas object, and handing an unclipped one to a
 * sector-scoped brush would paint the whole hexagon under a brush advertised as
 * local. `regionOf` is an integer read out of a table; there is no geometry here.
 */
export function clipToRegion(
  surface: SymmetrySurface,
  seed: number,
  source: readonly number[]
): number[] {
  const region = surface.regionOf(seed);
  return source.filter((j) => surface.regionOf(j) === region);
}
