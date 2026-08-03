/**
 * Band brushes: a stroke one cell deep and a whole row wide.
 *
 * The symmetry brush in `orbit.ts` answers "which cells are the same cell?".
 * This module answers a different question — "which cells are in the same
 * ROW?" — and the answer is a thick line: a full band of the tiling, from one
 * edge of the figure to the other, aligned to the lattice rather than to the
 * pointer. Painting a band is how you fill a row and lose its internal seams in
 * one gesture, and how you draw a line parallel to a median without drawing it
 * freehand.
 *
 * A triangular lattice has exactly THREE line families, one per edge direction,
 * and every band is a level set of one exact integer coordinate. There is no
 * fourth direction and no half-step: the three families are the whole story.
 *
 * ZERO FLOAT IN THIS FILE. Band membership is integer arithmetic on the exact
 * keys the figure already carries — `Cell.key` (barycentric, three vertices
 * summed) and `HexCell.key` (Eisenstein, three vertices summed). Nothing here
 * compares a pixel, and there is no tolerance to tune. `div3` is the only
 * arithmetic in the module and it is exact by construction; see its note.
 *
 * ── The key is three times the corner, plus the orientation ──────────────
 *
 * Both canvases store a cell as the SUM of its three vertices, so the key is
 * three times the centroid and stays an integer. Write a cell's lattice corner
 * as (p, q) — the vertex nearest the origin of the unit rhombus the cell sits
 * in. Then, in the Eisenstein basis,
 *
 *   upright   (p,q), (p+1,q), (p,q+1)          key = (3p+1, 3q+1)
 *   inverted  (p+1,q), (p,q+1), (p+1,q+1)      key = (3p+2, 3q+2)
 *
 * so every key coordinate is ≡ 1 (mod 3) on an upright cell and ≡ 2 (mod 3) on
 * an inverted one, and NEVER ≡ 0. That is the fact the whole module turns on:
 *
 *   floor(key_a / 3) = p   in both cases.
 *
 * The cell spans a ∈ [p, p+1] whichever way up it is — an upright cell reads
 * its a-values as p, p+1, p and an inverted one as p+1, p, p+1 — so `p` names
 * the STRIP the cell occupies, and two cells share a strip exactly when their
 * floor-divided key coordinates agree. Same derivation for b, and for the
 * third direction a+b, where the sum of the key coordinates is ≡ 2 (mod 3)
 * upright and ≡ 1 (mod 3) inverted and floor(·/3) again names the strip.
 *
 * The barycentric case is the same statement in the other basis. A triangle
 * cell's key is (3α+1, 3β+1, 3γ+1) upright and (3α+2, 3β+2, 3γ+2) inverted for
 * the corner (α, β, γ), so floor(key_α / 3) names the α-strip, and level sets
 * of α are the lines parallel to edge BC.
 *
 * ── "Parallel to a median" is not on offer, and cannot be ────────────────
 *
 * The ask this module answers named medians. A triangular lattice does not have
 * a median direction: with edge BC horizontal the three edge directions are 0°,
 * 60° and 120°, and the three medians run at 90°, 30° and 150°. Every band is
 * therefore PERPENDICULAR to one median and meets the other two at 30°, and no
 * band of any depth is parallel to any median — a row of cells one deep simply
 * does not run that way. What the ask reaches for is available under the other
 * descriptions in it: "aligned to the bottom" is family A near line 0, "aligned
 * to the apex" is family A near line 2^d − 1, and "aligned to the centre" is the
 * band through the hub. A line ALONG a median is a different object — it is the
 * fixed set of the mirror m_A, which `orbit.ts` already provides as a mode-2
 * brush, and which `bandOrbit` composes with a band.
 *
 * ── Which family is which ────────────────────────────────────────────────
 *
 * Triangle:  A = constant α (parallel to BC, stacked apex → base)
 *            B = constant β (parallel to CA)
 *            C = constant γ (parallel to AB)
 *
 * Hexagon:   A = constant a+b,  B = constant a,  C = constant b
 *
 * That hexagon assignment is NOT the order the three expressions are usually
 * written in, and it is deliberate. `baryToLat` puts a barycentric vertex
 * (x, y, z) at lattice (y, z), so inside sector 0 the hexagon's a IS the
 * triangle's β and its b IS the triangle's γ, which makes a + b = β + γ =
 * scale − α the triangle's α family. Pairing them this way means family "A"
 * denotes the same direction on both canvases, so a UI that keeps a family
 * selected while the user switches canvas does not silently rotate the brush by
 * 60°. The three expressions are the three the brief names; only the labelling
 * is chosen.
 *
 * On the hexagon a band CROSSES SECTOR SEAMS, and that is the point: the
 * Eisenstein lattice is uniform across the whole figure, so a row is a genuine
 * row of the hexagon rather than six wedge-local rows that happen to meet.
 *
 * ── What is asserted here and what is measured in the tests ──────────────
 *
 * The partition is STRUCTURAL, not checked: each cell contributes its index to
 * exactly one bucket per family, so "every cell is in exactly one band" cannot
 * fail without the loop below failing. `test/bands.test.ts` checks it anyway,
 * from the outside, because a structural argument about code that was rewritten
 * is worth exactly as much as the last person to read it.
 *
 * The triangle's 2r+1 law IS checked at build time, because it is a real claim
 * about the figure rather than a property of this loop: if the r-th band from
 * the apex ever holds a number of cells other than 2r+1, either the figure or
 * this derivation is wrong and the caller should hear about it immediately.
 *
 * The hexagon's band sizes are NOT asserted anywhere. They are not uniform —
 * see `bandSizeCensus` and the tests, which report them — and a model that
 * assumed they were would be asserting something false.
 */

import { buildFigure, type Convention, type Figure } from "./figure";
import { buildHexagon, type Hexagon } from "./hexagon";
import { subgroupMaps, type BrushMode, type CanvasKind, type SymmetrySurface } from "./orbit";

export type BandFamily = "A" | "B" | "C";

export const BAND_FAMILIES: readonly BandFamily[] = ["A", "B", "C"] as const;

/**
 * The family a 60° rotation carries each family to: A ↦ C ↦ B ↦ A.
 *
 * The three families are the three EDGE directions, and a 60° rotation permutes
 * them cyclically — there is no fourth direction for one to escape into. Which
 * way round the cycle runs is not obvious and is not guessed: with
 * `rot(a, b) = (−b, a + b)`, family B is the level set of `a` and its lines run
 * along e₂; e₂ ↦ e₂ − e₁, which is family A's direction; so B ↦ A, and the cycle
 * closes as A ↦ C ↦ B. `test/view.test.ts` measures it against the partitions
 * themselves rather than resting on that sentence.
 */
const ROTATED_FAMILY: Readonly<Record<BandFamily, BandFamily>> = {
  A: "C",
  C: "B",
  B: "A",
};

/**
 * Which HEXAGON family names, inside sector `s`, the direction the base
 * triangle's family `f` names.
 *
 * Sector s is `R^s` of the base triangle, so the base triangle's family-f rows
 * arrive in sector s rotated by 60°·s — and a rotation permutes the families.
 * The sector VIEW turns the sector back apex-up, so a user who picks "band A"
 * there means the base triangle's family A, the rows parallel to the sector's
 * outer edge, whichever sector is framed. Without this the letter would name a
 * different direction in four of the six sectors while the picture looked
 * identical, which is a control that lies.
 *
 * Depends on `s mod 3` only, because `R³` is the point reflection and a line
 * direction is unsigned. Sectors 0 and 3 are therefore the identity, which is
 * why the standalone triangle and sector 0 have always agreed about the letters.
 */
export function sectorBandFamily(f: BandFamily, sector: number): BandFamily {
  let out = f;
  const n = ((sector % 3) + 3) % 3;
  for (let k = 0; k < n; k++) out = ROTATED_FAMILY[out];
  return out;
}

export interface BandIndex {
  family: BandFamily;
  /** Signed integer band coordinate, exact. */
  line: number;
}

export interface BandSurface {
  kind: CanvasKind;
  cellCount: number;
  families: BandFamily[];
  /** Which band a cell lies in, per family. */
  bandOf(i: number, family: BandFamily): BandIndex;
  /** Every cell in that band, ascending. */
  band(index: BandIndex): number[];
  /** Convenience: the band through cell i. */
  bandThrough(i: number, family: BandFamily): number[];
  /** All bands of a family, apex-to-base order where that is meaningful. */
  bands(family: BandFamily): BandIndex[];
}

// ── exact integer arithmetic ─────────────────────────────────────────────

/**
 * Floor division by three, exact for integers of either sign.
 *
 * `Math.floor(x / 3)` would be a float division followed by a rounding step,
 * which is the one thing this file does not do. Here `r` is the mathematical
 * remainder in {0, 1, 2} — JavaScript's `%` returns a NEGATIVE remainder for
 * negative x, and hexagon lattice coordinates ARE negative in half the sectors,
 * so the double fold is load-bearing rather than defensive. `x − r` is then an
 * exact multiple of 3 well inside 2^53, and IEEE division returns an exactly
 * representable quotient exactly, so the result is the integer and not an
 * approximation of it.
 */
function div3(x: number): number {
  const r = ((x % 3) + 3) % 3;
  return (x - r) / 3;
}

// ── building ─────────────────────────────────────────────────────────────

function isHexagon(canvas: Figure | Hexagon): canvas is Hexagon {
  return "base" in canvas;
}

export function buildBandSurface(canvas: Figure | Hexagon): BandSurface {
  const hex = isHexagon(canvas);
  const kind: CanvasKind = hex ? "hexagon" : "triangle";
  const cellCount = canvas.cells.length;

  const lines: Record<BandFamily, number[]> = {
    A: new Array<number>(cellCount),
    B: new Array<number>(cellCount),
    C: new Array<number>(cellCount),
  };

  if (isHexagon(canvas)) {
    for (const c of canvas.cells) {
      lines.A[c.i] = div3(c.key[0] + c.key[1]);
      lines.B[c.i] = div3(c.key[0]);
      lines.C[c.i] = div3(c.key[1]);
    }
  } else {
    for (const c of canvas.cells) {
      lines.A[c.i] = div3(c.key[0]);
      lines.B[c.i] = div3(c.key[1]);
      lines.C[c.i] = div3(c.key[2]);
    }
  }

  // One bucket per (family, line). Cells are visited in index order, so every
  // bucket comes out ascending without a sort, and every cell lands in exactly
  // one bucket per family because the loop pushes it once.
  const table: Record<BandFamily, Map<number, number[]>> = {
    A: new Map(),
    B: new Map(),
    C: new Map(),
  };
  for (const f of BAND_FAMILIES) {
    const bucket = table[f];
    const line = lines[f];
    for (let i = 0; i < cellCount; i++) {
      const l = line[i];
      const arr = bucket.get(l);
      if (arr === undefined) bucket.set(l, [i]);
      else arr.push(i);
    }
  }

  // Apex-to-base on the triangle means DESCENDING line: the α-strip nearest
  // vertex A is α = scale − 1, and the strip along edge BC is α = 0. The
  // hexagon has no apex, so ascending line is the only order it can offer, and
  // it runs corner-to-corner across the figure.
  const order = {} as Record<BandFamily, number[]>;
  for (const f of BAND_FAMILIES) {
    const ls = [...table[f].keys()].sort((a, b) => a - b);
    order[f] = hex ? ls : ls.reverse();
  }

  if (!hex) {
    for (const f of BAND_FAMILIES) {
      order[f].forEach((l, r) => {
        const got = table[f].get(l)!.length;
        if (got !== 2 * r + 1) {
          throw new Error(
            `bands: triangle family ${f}, band ${r} steps from the apex ` +
              `(line ${l}) holds ${got} cells, not ${2 * r + 1}`
          );
        }
      });
    }
  }

  const checkFamily = (family: BandFamily) => {
    if (table[family] === undefined) {
      throw new Error(`bands: no family ${family} on this surface`);
    }
  };

  // Defined as closures rather than methods so a caller may destructure them —
  // `const { band } = surface` is exactly how a React component will reach for
  // this, and a `this`-dependent method would break silently at that point.
  const bandOf = (i: number, family: BandFamily): BandIndex => {
    checkFamily(family);
    if (!Number.isInteger(i) || i < 0 || i >= cellCount) {
      throw new Error(`bands: cell ${i} is not on this ${kind}`);
    }
    return { family, line: lines[family][i] };
  };

  const band = (index: BandIndex): number[] => {
    checkFamily(index.family);
    const arr = table[index.family].get(index.line);
    if (arr === undefined) {
      throw new Error(
        `bands: ${kind} family ${index.family} has no band on line ${index.line}`
      );
    }
    // A copy. The bucket is shared with every other caller, and one splice in
    // place would corrupt the band for all of them.
    return [...arr];
  };

  return {
    kind,
    cellCount,
    families: [...BAND_FAMILIES],
    bandOf,
    band,
    bandThrough: (i, family) => band(bandOf(i, family)),
    bands: (family) => {
      checkFamily(family);
      return order[family].map((line) => ({ family, line }));
    },
  };
}

/** Build the canvas and its band surface in one step, mirroring `buildSurface`. */
export function buildBands(
  kind: CanvasKind,
  depth: number,
  convention: Convention = "apex"
): BandSurface {
  return buildBandSurface(
    kind === "triangle" ? buildFigure(depth, convention) : buildHexagon(depth, convention)
  );
}

// ── bands under symmetry ─────────────────────────────────────────────────

/**
 * The band through cell `i`, unioned with the orbit of that band under the
 * brush subgroup.
 *
 * Composing the two brushes is not the same as choosing between them. A band
 * alone is a row; a band carried by a 3-fold brush is a triangle of three rows
 * meeting at the hub, and by a 6-fold brush a star. That is the figure the user
 * is actually reaching for when they ask for a line "aligned to a median" on a
 * symmetric canvas, and it costs one union to offer.
 *
 * The result is the orbit of a SET, so it is closed under the subgroup even
 * though the band itself generally is not: some members of the band's image lie
 * in other bands of the same family, and that is correct — a mirror carries a
 * row to a row, but not to its own row.
 *
 * This is the union, which is what a STROKE needs — the set of cells it
 * touches. It is not what a colour scheme needs; see `bandOrbitGrouped`, whose
 * flattened union is this exact array.
 */
export function bandOrbit(
  surface: SymmetrySurface,
  bandSurface: BandSurface,
  i: number,
  family: BandFamily,
  mode: BrushMode
): number[] {
  sameCanvas("bandOrbit", surface, bandSurface);
  const out = new Set<number>();
  for (const j of sourceBand(surface, bandSurface, i, family)) {
    for (const k of surface.orbit(j, mode)) out.add(k);
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * The band through cell `i`, CLIPPED to the region the surface's group acts in.
 *
 * A band is a whole-canvas object — the Eisenstein lattice runs straight across
 * every sector seam, which is the point of `bands.ts` — and a group that acts
 * inside one sector cannot carry the parts of the row that lie outside it. Hand
 * the unclipped row to a sector-scoped brush and the stroke paints the entire
 * width of the hexagon under a brush advertised as local: the scope would be a
 * label on the orbit and a lie about the band.
 *
 * On every surface whose group acts on the whole canvas `regionOf` is 0
 * everywhere, the filter keeps everything, and this is `bandThrough` with one
 * extra pass. There is no tolerance and no geometry here: `regionOf` is an
 * integer read out of a table.
 */
function sourceBand(
  surface: SymmetrySurface,
  bandSurface: BandSurface,
  i: number,
  family: BandFamily
): number[] {
  const region = surface.regionOf(i);
  return bandSurface
    .bandThrough(i, family)
    .filter((j) => surface.regionOf(j) === region);
}

function sameCanvas(
  who: string,
  surface: SymmetrySurface,
  bandSurface: BandSurface
): void {
  if (surface.cellCount !== bandSurface.cellCount) {
    throw new Error(
      `${who}: surface holds ${surface.cellCount} cells and the band surface ` +
        `holds ${bandSurface.cellCount}; they are not the same canvas`
    );
  }
}

/**
 * The same orbit, kept as the SET OF BANDS it actually is.
 *
 * `bandOrbit` returns the union and is right to: what a stroke touches is a set
 * of cells. But the union has forgotten the one fact a colour scheme wants. An
 * isometry carries a lattice line to a lattice line — that is what an isometry
 * IS, on a lattice — so the image of a band under a group element is another
 * band, and the orbit of a band is a set of bands. Six rows under a 6-fold
 * brush are six well-defined image bands. Flatten them and a scheme indexed by
 * position in the cell list paints speckle; keep them and it paints rows.
 *
 * Exact, and there is nothing here to tune. Each image is `{ g(j) : j ∈ band }`
 * for one element g of the subgroup, computed by index lookup on the
 * permutations `subgroupMaps` hands over. No coordinate is compared and no
 * tolerance exists to get wrong.
 *
 * ── Two things that had to be MEASURED, not assumed ─────────────────────
 *
 * A band may be FIXED by an element: on the triangle m_A fixes α and swaps β
 * with γ, so it carries every family-A band to itself. Its image is therefore
 * the source band again, and counting it twice would hand two hues to one row.
 * Deduplication is by cell-set identity, which is exact — an image is a whole
 * band, so two images are equal or they are not, with nothing in between to
 * judge. The consequence is worth stating plainly and is measured in the tests:
 * on the triangle a 6-fold brush on a band yields THREE image bands, not six,
 * because D3 = C3 ∪ C3·m_A and m_A adds no new image. Six rows is what the
 * HEXAGON gives, where the six rotations move every band.
 *
 * Two image bands may also CROSS. They are lines, and two lines of DIFFERENT
 * families meet, so one cell can belong to two image bands at once. Whether
 * that happens at all depends on the subgroup: r180 carries a hexagon row to a
 * PARALLEL row, so mode 2 on the hexagon produces no crossing anywhere, while
 * mode 6 puts six rows into three parallel pairs and the remaining twelve pairs
 * cross once each. Where it does happen it is a genuine ambiguity about which
 * hue the cell takes, resolved by rule rather than by luck: the LOWER group
 * index wins, so the source band keeps every cell it holds and each later image
 * yields to every earlier one. See `brushStamp` in `brush.ts`, which applies
 * the rule, and `test/bandcolour.test.ts`, which measures the whole census.
 *
 * ── Order ───────────────────────────────────────────────────────────────
 *
 * Deterministic and identity-first: the source band is emitted first, then each
 * distinct image in subgroup-element order. The source is placed first
 * EXPLICITLY rather than by trusting the element lists to begin with the
 * identity — they do, but a colour that depends on the order of a constant
 * table should not have to be read out of that table to be believed.
 *
 * The flattened, sorted union of the result equals `bandOrbit` exactly. That
 * equality is the whole warrant for this function: it changes the grouping and
 * nothing else. `test/bands.test.ts` checks it on both canvases, all three
 * families, every mode, at depths 1–3.
 */
export function bandOrbitGrouped(
  surface: SymmetrySurface,
  bandSurface: BandSurface,
  i: number,
  family: BandFamily,
  mode: BrushMode
): number[][] {
  sameCanvas("bandOrbitGrouped", surface, bandSurface);
  const source = sourceBand(surface, bandSurface, i, family);
  const out: number[][] = [source];
  const seen = new Set<string>([source.join(",")]);

  for (const m of subgroupMaps(surface, mode)) {
    // Ascending and deduplicated, so the signature below is a canonical name
    // for the SET and not for the order the element happened to produce it in.
    const image = [...new Set(source.map((j) => m[j]))].sort((a, b) => a - b);
    const sig = image.join(",");
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(image);
  }
  return out;
}

// ── measurements ─────────────────────────────────────────────────────────

/** Band sizes in `bands(family)` order — apex-first on the triangle. */
export function bandSizes(bs: BandSurface, family: BandFamily): number[] {
  return bs.bands(family).map((ix) => bs.band(ix).length);
}

/**
 * How many bands of each size the family produces, size → count.
 *
 * Reported rather than asserted, on the same principle as `orbitSizeCensus`:
 * on the triangle the distribution is forced (one band of each odd size), but
 * on the hexagon it is a fact about the figure and is measured in the tests.
 */
export function bandSizeCensus(
  bs: BandSurface,
  family: BandFamily
): Map<number, number> {
  const out = new Map<number, number>();
  for (const n of bandSizes(bs, family)) out.set(n, (out.get(n) ?? 0) + 1);
  return new Map([...out].sort((a, b) => a[0] - b[0]));
}
