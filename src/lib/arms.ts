/**
 * The three ftype arms of the triangle, and isolating one of them.
 *
 * The hexagon's brush has a SCOPE — whole plate, one sector, one sector six
 * times — because the hexagon is six copies of a thing and "one of them" is an
 * obvious object. The triangle has no sectors, and the natural guess, cutting it
 * into three corner children, is wrong: the fourth child, the inverted centre,
 * belongs to none of them, and the same is true of ITS centre, and so on down.
 *
 * The decomposition that does work is already proved. `docs/symmetry-findings.md`
 * Part 2 §D:
 *
 *     S_D = { X^j · D · u }        for D in {A, B, C}
 *
 * — the union over j of the D-corner of the j-th nested centre. A chain of
 * shrinking triangles spiralling into the centroid. The three arms are
 * congruent, they tile the board minus the hub, and the rotation permutes them
 * cyclically (§A: rot⁺ rewrites the FIRST NON-X DIGIT and leaves the rest of the
 * address alone). Each holds (4^d − 1)/3 cells; the hub X^d is the remaining 1.
 *
 * So an arm is not a mask drawn over the figure. It is a genuine part of a
 * partition, and membership is one field the figure already carries: `ftype`,
 * the first non-X digit. Nothing here computes geometry.
 *
 * ZERO FLOAT, and in fact zero arithmetic: an arm is a character.
 *
 * ── The hub belongs to no arm, and is EXCLUDED ──────────────────────────
 *
 * X^d is fixed by every isometry of the triangle and is the one cell with no
 * ftype. Three options were on the table and the choice is not cosmetic:
 *
 *   include it in every arm — destroys the property this whole module rests on.
 *     The arms would stop being disjoint, so "isolate one side" would let paint
 *     land in a cell reachable from all three isolations, and the exactness
 *     claim would become a mask-hack claim.
 *
 *   give it a fourth state — a control with four positions, one of which selects
 *     a single cell out of 4^d. At depth 4 that is one button for 1/256 of the
 *     plate, and it is the one cell whose orbit is a singleton under EVERY mode,
 *     so the symmetry brush has nothing to say about it either.
 *
 *   exclude it — chosen. The partition survives, the control means exactly what
 *     it says, and the hub stays reachable the moment isolation is switched off.
 *     The cost is stated rather than hidden: with an arm isolated the hub cannot
 *     be painted, because the hub is not in any arm.
 *
 * ── Isolation CLIPS the orbit, and what that costs ──────────────────────
 *
 * The sector scope clips bands rather than suppressing strokes that leave the
 * sector, and the same rule is right here for the same reason: a brush that
 * silently declines to fire is a brush that looks broken. But the cost is bigger
 * than it is for sectors and is worth stating in the open, because it was
 * MEASURED rather than assumed.
 *
 * The setwise stabiliser of arm D in D3 is ⟨m_D⟩, of order 2 — the rotations
 * permute the three arms cyclically, so they carry arm A off itself, and of the
 * three medians only m_D fixes arm D (m_A swaps the digits B and C, so it fixes
 * ftype A and exchanges ftypes B and C). Clipping therefore leaves exactly the
 * orbit under ⟨m_D⟩:
 *
 *     mode 1  → 1 cell    unchanged
 *     mode 2  → 2 cells   unchanged in arm A, because ⟨m_A⟩ IS mode 2
 *     mode 3  → 1 cell    the rotations all leave the arm
 *     mode 6  → 2 cells   D3 clipped to arm D is ⟨m_D⟩
 *
 * So inside an isolated arm mode 3 paints what mode 1 paints and mode 6 paints
 * what mode 2 paints — as SETS of cells; the colours still come from the full
 * orbit's scheme positions, so a clipped 6-fold stroke lays two of the six hues
 * and not the first two of a two-hue reading. That is not a degenerate brush, it
 * is the induced action, and it is the honest answer to "what symmetry survives
 * when I look at one arm": the mirror that fixes the arm, and nothing else.
 *
 * `test/arms.test.ts` measures all of the above rather than asserting it.
 */

import { AXES, type Axis, type Figure } from "./figure";
import type { BrushStamp } from "./brush";

/** An arm is named by the ftype it collects: the first non-X digit. */
export type Arm = Axis;

export const ARMS: readonly Arm[] = AXES;

/** The isolation setting. `null` is off — the whole triangle. */
export type Isolation = Arm | null;

const isArm = (s: string): s is Arm => s === "A" || s === "B" || s === "C";

/**
 * Which arm a cell is in, or `null` for the hub.
 *
 * Read straight off `Cell.ftype`, which `buildFigure` computes as the first
 * non-X digit and which is therefore never `"X"` — the type says `Digit` because
 * that is where the letters come from, and this narrows it to the three that can
 * actually occur.
 */
export function armOf(figure: Figure, i: number): Arm | null {
  const c = figure.cells[i];
  if (c === undefined) throw new Error(`arms: cell ${i} is not on this triangle`);
  return isArm(c.ftype) ? c.ftype : null;
}

/**
 * The arm an ADDRESS is in — the same question asked of a word rather than an
 * index, which is what the address-keyed plate needs.
 *
 * Note that it is stable under extension: every descendant of a cell in arm D is
 * in arm D, because a suffix cannot change the first non-X digit. That is why
 * isolation and the depth-persistent plate compose without either knowing about
 * the other.
 */
export function armOfWord(word: string): Arm | null {
  for (const ch of word) if (ch !== "X") return isArm(ch) ? ch : null;
  return null;
}

/** Every cell of an arm, ascending. */
export function armCells(figure: Figure, arm: Arm): number[] {
  const out: number[] = [];
  for (const c of figure.cells) if (c.ftype === arm) out.push(c.i);
  return out;
}

/**
 * A predicate the brush can be clipped through.
 *
 * `null` isolation is the constant `true`, so a caller has one code path and the
 * off state costs one closure call per cell rather than a branch at every site.
 */
export function armMask(
  figure: Figure,
  isolation: Isolation
): (i: number) => boolean {
  return armMaskOver(figure.cells, isolation);
}

/**
 * The same mask over any cell list that carries an ADDRESS WORD.
 *
 * The hexagon's cells do: every one of them is a copy of a base triangle cell
 * and keeps its `addr`, so `armOfWord` answers the same question there that
 * `ftype` answers on the triangle. That is what makes the isolation control nest
 * — hexagon, then sector, then arm — without a second notion of an arm.
 *
 * Note what is NOT needed here: the sector. A sector-scoped brush already cannot
 * leave the sector it started in (`orbit.ts` gives that surface a region per
 * sector), and only the framed sector's cells are on screen to be clicked, so
 * confinement to one sector is already exact and this mask has one job.
 */
export function armMaskOver(
  cells: readonly { addr: string }[],
  isolation: Isolation
): (i: number) => boolean {
  if (isolation === null) return () => true;
  const inArm = new Uint8Array(cells.length);
  for (let i = 0; i < cells.length; i++) {
    if (armOfWord(cells[i].addr) === isolation) inArm[i] = 1;
  }
  return (i) => inArm[i] === 1;
}

/**
 * The brush stamp, confined to the cells the mask keeps.
 *
 * `cells` and `keys` are filtered TOGETHER, so every surviving cell keeps the
 * scheme position it had in the unclipped stroke. `span` is left alone on
 * purpose: it counts the positions the SUBGROUP has, and clipping the stroke to
 * one arm does not make the subgroup smaller. Renumbering the survivors would
 * mean the same stroke laid different colours depending on where it landed, and
 * the colours of a symmetry brush are supposed to be a reading of the symmetry.
 *
 * Band groups are filtered member by member and NOT dropped when they empty,
 * because `keys` indexes into this list by position and a compacted list would
 * silently re-point every key after the gap.
 */
export function clipStamp(
  stamp: BrushStamp,
  keep: (i: number) => boolean
): BrushStamp {
  const cells: number[] = [];
  const keys: number[] = [];
  stamp.cells.forEach((c, k) => {
    if (!keep(c)) return;
    cells.push(c);
    keys.push(stamp.keys[k]);
  });
  return {
    cells,
    keys,
    span: stamp.span,
    groups: stamp.groups === null ? null : stamp.groups.map((g) => g.filter(keep)),
  };
}

// ── measurements ─────────────────────────────────────────────────────────

export interface ArmCensus {
  /** Cells per arm, in `ARMS` order. */
  sizes: Record<Arm, number>;
  /** The hub, which is in no arm. Always 1. */
  hub: number;
  total: number;
  /** True when the three arms are the same size — the §D congruence claim. */
  even: boolean;
  /** `(4^d − 1)/3`, the size §D predicts. */
  predicted: number;
}

/**
 * The partition, counted rather than assumed.
 *
 * §D says the three arms are congruent and tile the board minus the hub. Both
 * halves are checkable in one pass and neither is taken on trust here: the
 * figure is the authority, and if it ever stopped agreeing with the document the
 * measurement is what should win.
 */
export function armCensus(figure: Figure): ArmCensus {
  const sizes: Record<Arm, number> = { A: 0, B: 0, C: 0 };
  let hub = 0;
  for (const c of figure.cells) {
    if (isArm(c.ftype)) sizes[c.ftype]++;
    else hub++;
  }
  return {
    sizes,
    hub,
    total: figure.cells.length,
    even: sizes.A === sizes.B && sizes.B === sizes.C,
    predicted: (4 ** figure.depth - 1) / 3,
  };
}
