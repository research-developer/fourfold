/**
 * The non-painting geometry the drawing program needs: what to draw OVER the
 * canvas so the active subgroup is visible, and how a keyboard walks the cells
 * when there is no pointer.
 *
 * FLOAT IS FINE HERE. Everything in this file is a display coordinate. No
 * number computed here ever chooses a cell to paint — `orbit.ts` does that, by
 * exact integer key lookup — and the one function that DOES return a cell index
 * (`stepCursor`) picks it from a list of candidates it was handed, so the worst
 * a rounding difference can do is move the keyboard cursor to a neighbour.
 *
 * ── Draw the subgroup you are actually using ─────────────────────────────
 *
 * The overlay's whole job is to be honest, so it never draws a line that is not
 * in the active subgroup. That constraint has a consequence people expect to be
 * a bug, and it is not:
 *
 *   HEXAGON MODES 2, 3 AND 6 HAVE NO MIRROR LINES AT ALL. They are C2, C3 and
 *   C6 — rotations only. The six diameters everyone associates with a hexagon
 *   belong to D6, which is mode 12 and nothing below it. Drawing them under a
 *   rotational brush would show the user a symmetry their strokes do not have.
 *
 *   TRIANGLE MODE 3 IS THE SAME STORY. A3 is the rotations; its brush paints
 *   three cells 120° apart and reflects nothing.
 *
 * So rotational modes get a rotation CENTRE and orbit arcs instead of axes, and
 * `symmetryGuides` returns an empty mirror list for them. Mode 1 gets nothing:
 * the trivial group has no picture.
 *
 * ── The length trap, fixed once already ──────────────────────────────────
 *
 * On the hexagon the six mirrors are NOT the same length. The three sector
 * BOUNDARIES run corner to corner, so they reach the circumradius R. The three
 * sector SPINES run edge-midpoint to edge-midpoint, so they reach only the
 * inradius R·√3/2 ≈ 0.866 R. Drawing both at R makes the spines stick out past
 * the outline by 13% of the radius, which is small enough to look like an
 * antialiasing artefact and is not. `HexBoard.tsx` carries the same correction.
 */

import type { BrushMode, CanvasKind } from "./orbit";

// ── what to draw over the canvas ─────────────────────────────────────────

/**
 * Which family a mirror belongs to. The families are what get colour-coded, and
 * they are genuinely different objects rather than three copies of one:
 *
 *   median    a triangle median — apex to opposite edge midpoint
 *   spine     a hexagon diameter through two opposite sector spines (30/90/150)
 *   boundary  a hexagon diameter along two opposite sector seams (0/60/120)
 */
export type GuideFamily = "median" | "spine" | "boundary";

export interface MirrorGuide {
  /** The isometry's name in the model: `m_A`, `m30`, and so on. */
  id: string;
  family: GuideFamily;
  label: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /**
   * Which sector this median belongs to, for a SECTOR-scoped brush.
   *
   * Absent for a whole-plate mirror, which is a diameter and belongs to no
   * sector in particular. Present, the same `id` occurs once per sector the
   * scope covers — the local m_A of sector 2 and of sector 5 are two different
   * lines and two different maps, and neither is an isometry of the hexagon.
   */
  sector?: number;
}

export interface RotationGuide {
  cx: number;
  cy: number;
  /** Order of the rotation subgroup — 2, 3 or 6. */
  order: number;
  /** Radius of the indicator ring, in canvas units. */
  radius: number;
}

export interface Guides {
  mirrors: MirrorGuide[];
  /** The rotation the group performs about the CANVAS centre, if any. */
  rotation: RotationGuide | null;
  /**
   * Rotation centres that are not the canvas centre.
   *
   * Empty on every whole-plate group, and that is not an accident of this
   * implementation — a rotation of the hexagon about anything but its centre is
   * not a symmetry of the hexagon. A sector's own 120° turn is about the
   * SECTOR's centroid, so it can only ever appear here.
   */
  local: RotationGuide[];
}

export type Pt = readonly [number, number];

export interface TriangleFrame {
  kind: "triangle";
  /** Apex, bottom-left, bottom-right, in canvas pixels. */
  corners: readonly [Pt, Pt, Pt];
}

export interface HexagonFrame {
  kind: "hexagon";
  centre: Pt;
  /** Circumradius in canvas units — the distance to a CORNER. */
  radius: number;
}

export type CanvasFrame = TriangleFrame | HexagonFrame;

/**
 * Where the rotation ring sits, as a fraction of the figure's inradius.
 *
 * Two values, because the ring competes for the same space as the mirrors. In a
 * rotation-only subgroup the ring IS the overlay and can be generous; in a
 * dihedral one it is the second thing being said, and drawn at 0.62 it crosses
 * every median at a shallow angle and reads as a fourth axis.
 */
const RING_ALONE = 0.62;
const RING_WITH_MIRRORS = 0.34;

const mid = (p: Pt, q: Pt): Pt => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];

const TRIANGLE_MIRRORS = [
  { id: "m_A", axis: 0, label: "m_A — vertical median" },
  { id: "m_B", axis: 1, label: "m_B — left diagonal median" },
  { id: "m_C", axis: 2, label: "m_C — right diagonal median" },
] as const;

function triangleGuides(
  frame: TriangleFrame,
  mode: BrushMode,
  sector?: number
): Guides {
  const [A, B, C] = frame.corners;
  const opposite: Pt[] = [mid(B, C), mid(A, C), mid(A, B)];
  const cx = (A[0] + B[0] + C[0]) / 3;
  const cy = (A[1] + B[1] + C[1]) / 3;

  // Only ⟨m_A⟩ at order 2 — the median that survives in both conventions as an
  // exact V4 symmetry, matching `TRIANGLE_SUBGROUPS`. m_B and m_C generate
  // conjugate subgroups and are NOT in the mode-2 brush, so they are not drawn.
  const wanted =
    mode === 2 ? TRIANGLE_MIRRORS.slice(0, 1) : mode === 6 ? TRIANGLE_MIRRORS : [];

  const inradius = Math.hypot(opposite[0][0] - cx, opposite[0][1] - cy);
  const ring = inradius * (wanted.length > 0 ? RING_WITH_MIRRORS : RING_ALONE);

  return {
    mirrors: wanted.map((m) => {
      const p = frame.corners[m.axis];
      const q = opposite[m.axis];
      return {
        id: m.id,
        family: "median" as const,
        label: sector === undefined ? m.label : `${m.label} · sector ${sector}`,
        x1: p[0],
        y1: p[1],
        x2: q[0],
        y2: q[1],
        ...(sector === undefined ? {} : { sector }),
      };
    }),
    // D3 contains A3, so mode 6 shows the rotation centre as well as the three
    // medians: a 6-fold brush really does both things.
    rotation:
      mode === 3 || mode === 6 ? { cx, cy, order: 3, radius: ring } : null,
    local: [],
  };
}

const HEX_MIRROR_IDS = ["m0", "m30", "m60", "m90", "m120", "m150"] as const;

function hexagonGuides(frame: HexagonFrame, mode: BrushMode): Guides {
  const [cx, cy] = frame.centre;
  const R = frame.radius;
  const inradius = (R * Math.sqrt(3)) / 2;

  const mirrors: MirrorGuide[] =
    mode === 12
      ? HEX_MIRROR_IDS.map((id, k) => {
          const spine = k % 2 === 1;
          const len = spine ? inradius : R;
          const t = (Math.PI / 180) * 30 * k;
          const dx = Math.cos(t) * len;
          const dy = Math.sin(t) * len;
          return {
            id,
            family: spine ? ("spine" as const) : ("boundary" as const),
            label: `${id} — ${30 * k}° sector ${spine ? "spine" : "boundary"}`,
            // SVG y grows downward, so the mathematical +y end is cy − dy.
            x1: cx - dx,
            y1: cy + dy,
            x2: cx + dx,
            y2: cy - dy,
          };
        })
      : [];

  // C2 < C3 < C6 < D6: every mode above the trivial one rotates, and mode 12's
  // rotational part is the full C6.
  const order = mode === 1 ? 0 : mode === 12 ? 6 : mode;
  const ring =
    inradius * (mirrors.length > 0 ? RING_WITH_MIRRORS : RING_ALONE);

  return {
    mirrors,
    rotation: order === 0 ? null : { cx, cy, order, radius: ring },
    local: [],
  };
}

// ── the sector overlays ──────────────────────────────────────────────────

/**
 * The corners of the hexagon, in the model's own order: corner k at 30°·2k,
 * anticlockwise from +x. `buildHexagon` places them at `rotK([scale, 0], k)`,
 * and `latticeToPixel` sends that to (cx + R·cos 60k, cy − R·sin 60k).
 */
const hexCorner = (frame: HexagonFrame, k: number): Pt => {
  const t = (Math.PI / 180) * 60 * (((k % 6) + 6) % 6);
  return [
    frame.centre[0] + frame.radius * Math.cos(t),
    frame.centre[1] - frame.radius * Math.sin(t),
  ];
};

/**
 * Sector s as a triangle frame, with the roles the model gives it.
 *
 * Vertex A is the hexagon CENTRE — the shared apex-eye — because the base
 * figure's A sits at barycentric (scale, 0, 0), which `baryToLat` sends to the
 * lattice origin. B and C are corners s and s+1, from (0, scale, 0) ↦ (scale, 0)
 * and (0, 0, scale) ↦ (0, scale), each rotated by 60°·s. So the sector's own m_A
 * is its spine and m_B, m_C are the two medians that meet the seams — which is
 * what makes `triangleGuides` the right thing to call here rather than a second
 * derivation of the same three lines.
 */
export function sectorFrame(frame: HexagonFrame, sector: number): TriangleFrame {
  return {
    kind: "triangle",
    corners: [frame.centre, hexCorner(frame, sector), hexCorner(frame, sector + 1)],
  };
}

/**
 * The overlay for the active subgroup — mirrors it really has, nothing more.
 *
 * `sectors` restricts the drawing to the sector-local D3 of the sectors named,
 * which is what a SECTOR-scoped brush actually does. It changes the overlay
 * completely rather than filtering it, and it has to: the hexagon's own spine
 * mirrors reflect two opposite sectors at once, so drawing one of them under a
 * sector brush would promise a symmetry the stroke does not have. What replaces
 * them is that sector's three medians and its own 120° turn about its own
 * centroid — lines and a centre that appear in NO element of D6.
 *
 * `spin` is the order of the rotation about the canvas centre that the scope
 * adds on top; 6 for SECTOR ×6, 0 for a single sector.
 */
export function symmetryGuides(
  frame: CanvasFrame,
  mode: BrushMode,
  sectors: readonly number[] | null = null,
  spin = 0
): Guides {
  if (frame.kind === "triangle") return triangleGuides(frame, mode);
  if (sectors === null) return hexagonGuides(frame, mode);

  const mirrors: MirrorGuide[] = [];
  const local: RotationGuide[] = [];
  for (const s of sectors) {
    const g = triangleGuides(sectorFrame(frame, s), mode, s);
    mirrors.push(...g.mirrors);
    if (g.rotation !== null) local.push(g.rotation);
  }
  const inradius = (frame.radius * Math.sqrt(3)) / 2;
  return {
    mirrors,
    rotation:
      spin > 1
        ? {
            cx: frame.centre[0],
            cy: frame.centre[1],
            order: spin,
            radius: inradius * (mirrors.length > 0 ? RING_WITH_MIRRORS : RING_ALONE),
          }
        : null,
    local,
  };
}

// ── the subgroup, as a glyph ─────────────────────────────────────────────

/**
 * A subgroup written the way a brush button should show it: how far it rotates,
 * and where its mirrors lie. Angles are degrees counter-clockwise from +x in
 * ordinary mathematical orientation, so 90° is the vertical median.
 *
 * The equilateral triangle's three medians sit 60° apart at 30°, 90° and 150° —
 * NOT 120° apart. A mirror line and its opposite ray are the same line, so the
 * three medians of a 3-fold figure fill a half-turn, not a full one.
 */
export interface SubgroupShape {
  /** Order of the rotational part: 1, 2, 3 or 6. */
  rotation: number;
  /** Mirror line angles in degrees; empty for a rotation-only subgroup. */
  mirrors: number[];
}

const TRIANGLE_SHAPES: Record<1 | 2 | 3 | 6, SubgroupShape> = {
  1: { rotation: 1, mirrors: [] },
  2: { rotation: 1, mirrors: [90] },
  3: { rotation: 3, mirrors: [] },
  6: { rotation: 3, mirrors: [30, 90, 150] },
};

const HEXAGON_SHAPES: Record<BrushMode, SubgroupShape> = {
  1: { rotation: 1, mirrors: [] },
  2: { rotation: 2, mirrors: [] },
  3: { rotation: 3, mirrors: [] },
  6: { rotation: 6, mirrors: [] },
  12: { rotation: 6, mirrors: [0, 30, 60, 90, 120, 150] },
};

export function subgroupShape(kind: CanvasKind, mode: BrushMode): SubgroupShape {
  if (kind === "hexagon") return HEXAGON_SHAPES[mode];
  if (mode === 12) throw new Error("triangle: there is no 12-fold brush on D3");
  return TRIANGLE_SHAPES[mode];
}

/** |H| = |rotations| × 2 when there are mirrors, and × 1 when there are not. */
export function subgroupOrder(shape: SubgroupShape): number {
  return shape.rotation * (shape.mirrors.length > 0 ? 2 : 1);
}

const ROUND = 1e4;
const key = (p: Pt) => `${Math.round(p[0] * ROUND)},${Math.round(p[1] * ROUND)}`;

/**
 * The orbit of one point under the subgroup, for drawing the button glyph.
 *
 * This is not a schematic redrawn by hand — it is the actual orbit, computed
 * from the actual group elements, so a button cannot disagree with the brush it
 * selects. Feed it a GENERIC point (off every mirror and away from the centre)
 * and the orbit has full length |H|; feed it a point on a mirror and it comes
 * out short, which is the same stabiliser story the canvas tells.
 *
 * Elements are enumerated as R^k and R^k·M, which is all of D_n when M is any
 * one of its mirrors — hence only `mirrors[0]` is consulted, and the remaining
 * mirror angles in the shape are there for drawing the lines.
 */
export function glyphOrbit(shape: SubgroupShape, p: Pt): Pt[] {
  const seeds: Pt[] = [p];
  if (shape.mirrors.length > 0) {
    const t = (Math.PI / 180) * 2 * shape.mirrors[0];
    const c = Math.cos(t);
    const s = Math.sin(t);
    seeds.push([p[0] * c + p[1] * s, p[0] * s - p[1] * c]);
  }

  const seen = new Set<string>();
  const out: Pt[] = [];
  for (const seed of seeds) {
    for (let k = 0; k < shape.rotation; k++) {
      const t = (2 * Math.PI * k) / shape.rotation;
      const c = Math.cos(t);
      const s = Math.sin(t);
      const q: Pt = [seed[0] * c - seed[1] * s, seed[0] * s + seed[1] * c];
      const kk = key(q);
      if (seen.has(kk)) continue;
      seen.add(kk);
      out.push(q);
    }
  }
  return out;
}

// ── moving without a pointer ─────────────────────────────────────────────

export type Direction = "up" | "down" | "left" | "right";

/** Screen-space direction vectors. SVG y grows downward, so "up" is −y. */
const STEP: Record<Direction, Pt> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

/**
 * How much a candidate is punished for being off-axis, per unit of distance.
 *
 * At 1 the cursor slides diagonally, because on a triangular tiling the nearest
 * cell in ANY forward half-plane is usually a diagonal one. At 3 the cursor
 * walks in the direction the key names and only drifts when there is nothing
 * ahead — which is the behaviour an arrow key promises.
 */
const LATERAL = 3;

/**
 * The cell an arrow key moves to, or `from` unchanged when the canvas ends.
 *
 * Chosen by centroid geometry rather than by index arithmetic, deliberately.
 * Index order is recursion order — cell i+1 is the next leaf of a depth-first
 * walk, which can be on the far side of the figure — so "next index" is not a
 * direction anyone can see. Centroids are what the eye is using.
 *
 * With no cursor yet, the walk starts at the cell nearest the centre of the
 * figure, so the first arrow press lands somewhere visible instead of at
 * whichever corner happens to be index 0.
 */
export function stepCursor(
  centroids: readonly Pt[],
  from: number | null,
  dir: Direction
): number {
  if (centroids.length === 0) return -1;
  if (from === null || from < 0 || from >= centroids.length) {
    let sx = 0;
    let sy = 0;
    for (const c of centroids) {
      sx += c[0];
      sy += c[1];
    }
    const mx = sx / centroids.length;
    const my = sy / centroids.length;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < centroids.length; i++) {
      const d = Math.hypot(centroids[i][0] - mx, centroids[i][1] - my);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  const [ux, uy] = STEP[dir];
  const p = centroids[from];
  let best = from;
  let bestCost = Infinity;
  for (let i = 0; i < centroids.length; i++) {
    if (i === from) continue;
    const dx = centroids[i][0] - p[0];
    const dy = centroids[i][1] - p[1];
    const along = dx * ux + dy * uy;
    if (along <= 1e-9) continue;
    const lateral = Math.hypot(dx - along * ux, dy - along * uy);
    const cost = along + LATERAL * lateral;
    if (cost < bestCost) {
      bestCost = cost;
      best = i;
    }
  }
  return best;
}
