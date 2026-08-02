/**
 * The symmetry identifier, extracted.
 *
 * FOURFOLD's scoring rule turns out not to be about triangles, or about the
 * Klein four-group, or about Galois theory. Read `analyseClaim` closely and it
 * touches exactly two things on a cell: its **charge** and its **mirror
 * partner per axis**. Everything else the game's `Cell` carries -- vertices,
 * centroid, address, orientation, ftype -- is rendering or diagnostics.
 *
 * So the identifier generalises to any structure that can produce
 *
 *     { charge: number, mirror: Record<Axis, number> }
 *
 * per site: a labelling into some finite set, plus one involution per axis.
 * What must NOT be baked in is the mathematics that happens to hold for the
 * V4 XOR Sierpinski figure in the apex convention, because none of it
 * survives a change of carrier:
 *
 *   - which label pairs count as coherent (here: same coset of the subgroup
 *     fixing sqrt6 -- a different subgroup gives a different game);
 *   - what each axis is worth (here: 1/3/3, and that weighting IS the apex
 *     convention -- the vertical median is cheap precisely because it always
 *     works, which is false in the ifs convention where all six isometries
 *     are exact);
 *   - how many axes there are.
 *
 * All three are parameters of `makeIdentifier`. `game.ts` is now just one
 * configuration of it, and `app/conventions` is another.
 *
 * Pure and dependency-free: no React, no DOM, no framework import. It runs
 * unchanged in a Next route, a worker, a test, or a single-file demo.
 */

/**
 * The only thing the identifier needs to know about a site.
 *
 * `L` is the label type. It defaults to `number` because that is what a group
 * element usually compresses to, but nothing here does arithmetic on it -- a
 * carrier is free to label sites with strings, tuples, or anything else, so
 * long as `coherent` can compare two of them.
 */
export interface SymmetrySite<A extends string, L = number> {
  readonly charge: L;
  readonly mirror: Readonly<Record<A, number>>;
}

export interface IdentifierSpec<A extends string, L = number> {
  readonly axes: readonly A[];
  /** Do these two labels pair? Must be symmetric and reflexive. */
  readonly coherent: (a: L, b: L) => boolean;
  /** Points per site per satisfied axis. */
  readonly axisValue: Readonly<Record<A, number>>;
  /** Fewest scoring sites a claim needs to stand. */
  readonly minClaim: number;
  /** Most sites a claim may select -- the anti-landgrab cap. */
  readonly maxClaim: number;
}

export interface SiteVerdict<A extends string> {
  /** Axes on which this site's partner is present in the claim AND coherent. */
  axes: A[];
  points: number;
}

export interface ClaimReport<A extends string> {
  /** Only sites that actually score. */
  verdicts: Map<number, SiteVerdict<A>>;
  /** Selected sites that score nothing. */
  dead: number[];
  points: number;
  valid: boolean;
  reason: string;
  /** Axes the claim genuinely witnesses, in spec order. */
  axes: A[];
}

/**
 * Build an identifier for one carrier.
 *
 * The returned function is pure: it takes the sites and a selection and
 * returns the verdict without touching any state, so a UI can call it on
 * every hover to render a live preview.
 */
export function makeIdentifier<A extends string, L = number>(
  spec: IdentifierSpec<A, L>
) {
  const { axes, coherent, axisValue, minClaim, maxClaim } = spec;

  return function identify(
    sites: readonly SymmetrySite<A, L>[],
    selection: ReadonlySet<number>
  ): ClaimReport<A> {
    const verdicts = new Map<number, SiteVerdict<A>>();
    const dead: number[] = [];
    let points = 0;

    /**
     * Pass 1 -- which axes does this claim actually *witness*?
     *
     * An axis is witnessed only by a GENUINE pair: two distinct sites that
     * are each other's mirror image and whose labels are coherent. Sites that
     * straddle their own axis (mirror[ax] === self) are excluded here,
     * because otherwise they witness an axis by doing nothing -- a site on
     * the axis is trivially its own partner and trivially coherent with
     * itself, so three unrelated on-axis sites would score the highest-value
     * axis three times over while demonstrating no symmetry at all.
     *
     * This two-pass shape is load-bearing. Collapsing it reopens that hole.
     */
    const witnessed = new Set<A>();
    for (const i of selection) {
      const site = sites[i];
      for (const ax of axes) {
        const j = site.mirror[ax];
        if (j === i) continue;
        if (!selection.has(j)) continue;
        if (!coherent(site.charge, sites[j].charge)) continue;
        witnessed.add(ax);
      }
    }

    // Pass 2 -- score. A site on an axis may JOIN a symmetry but cannot
    // CONSTITUTE one, so it collects an axis only once a real pair has
    // established it.
    for (const i of selection) {
      const site = sites[i];
      const hit: A[] = [];
      for (const ax of axes) {
        const j = site.mirror[ax];
        if (j === i) {
          if (witnessed.has(ax)) hit.push(ax);
          continue;
        }
        if (!selection.has(j)) continue;
        if (!coherent(site.charge, sites[j].charge)) continue;
        hit.push(ax);
      }
      if (hit.length === 0) {
        dead.push(i);
        continue;
      }
      const p = hit.reduce((s, ax) => s + axisValue[ax], 0);
      verdicts.set(i, { axes: hit, points: p });
      points += p;
    }

    const n = verdicts.size;
    let reason: string;
    let valid: boolean;
    if (selection.size === 0) {
      valid = false;
      reason = "Nothing selected.";
    } else if (selection.size > maxClaim) {
      valid = false;
      reason = `A symmetry is a motif, not a landgrab — at most ${maxClaim} cells (this has ${selection.size}).`;
    } else if (n < minClaim) {
      valid = false;
      reason = `A symmetry needs ${minClaim} scoring cells — this has ${n}.`;
    } else {
      valid = true;
      reason = `${n} cells in symmetry${
        dead.length ? `, ${dead.length} unpaired (no points)` : ""
      }.`;
    }

    const used = new Set<A>();
    for (const v of verdicts.values()) for (const ax of v.axes) used.add(ax);

    return {
      verdicts,
      dead,
      points,
      valid,
      reason,
      axes: axes.filter((a) => used.has(a)),
    };
  };
}
