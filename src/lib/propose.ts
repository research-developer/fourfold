/**
 * The standing proposal: what a `propose` drag has gathered, and has not done.
 *
 * `brush.DragMode` explains why `propose` exists at all — a finger has no hover,
 * so on touch the press itself has to be the ghost. What it did NOT say, because
 * until now it was not true, is what a DRAG in that mode is. It moved a single
 * candidate: every cell the finger crossed replaced the last one, and lifting off
 * left exactly one application standing. A propose-mode drag therefore could not
 * do the one thing a paint-mode drag does, which is lay down a run.
 *
 * This module is the run. A proposal is the ORDERED LIST OF SEEDS a drag has
 * touched, each of which is one future application of the brush, and none of
 * which has touched the plate. Commit applies them all as a single gesture; drop
 * throws the list away and the journal never hears about it.
 *
 * PURE. No React, no DOM, no clock. Every cell index in and out of here came from
 * `orbit.ts` or `bands.ts` by exact integer key lookup; nothing in this file does
 * arithmetic on a coordinate or decides a colour.
 *
 * ── Why an ordered list of seeds, and not a set of cells ─────────────────
 *
 * Three candidate shapes were available and two of them are lossy.
 *
 *   A SET OF COVERED CELLS — "the cells the ghost is showing" — is the shape the
 *   preview looks like, and it is the one that cannot be committed. It has thrown
 *   away which application put each cell there, so it cannot say what symmetry
 *   group each cell belonged to (`strokes.StrokeMark.groups`), it cannot say
 *   which scheme position each cell takes (`brush.BrushStamp.span`, which is
 *   PER APPLICATION and not per gesture), and it cannot say how many colouring
 *   events the gesture spends. All three are facts about the seeds.
 *
 *   AN UNORDERED SET OF SEEDS loses less but still loses the one thing the record
 *   is required to carry. `StrokeMark.groups` is defined as "one entry per orbit
 *   or image band the gesture applied, IN STROKE ORDER", and a progression lays a
 *   gradient along that same order — `brush.EventLog`, "a gesture spends one event
 *   per distinct cell it starts an application at, so a drag lays a gradient along
 *   its own path". Reorder the seeds and both the provenance and the colours move.
 *
 *   AN ORDERED LIST OF DISTINCT SEEDS is what is left, and it is exactly the
 *   sequence of `paintAt` calls a paint-mode drag would have made. That is the
 *   design target: the two drag modes should differ in WHEN the plate changes and
 *   in nothing else.
 *
 * A `Set` would have given order and distinctness in one object — JS sets iterate
 * in insertion order — and it is not used because every consumer here wants an
 * indexable list: the preview maps seed k to the k-th progression step, the mark
 * needs `groups[k]`, and `proposalStamps` is a `map`. An array is the shape they
 * all want and membership is a scan over a list a finger could plausibly have
 * drawn, which is tens of entries, not thousands.
 *
 * ── Re-touching a seed is a no-op, deliberately ─────────────────────────
 *
 * `proposeSeed` returns the list UNCHANGED — the same reference, so React does
 * not even re-render — when the seed is already in it. Two reasons, and the first
 * is the load-bearing one:
 *
 *   THE GHOST WOULD STOP PROMISING WHAT THE STROKE LAYS. A second copy of a seed
 *   draws nothing new (same cells, same colours, one on top of the other) but it
 *   is a second application at commit, so it spends a second colouring event and
 *   slides every later seed's hue. The preview would then show N hues and the
 *   commit would lay N + duplicates. `brush.stampColours` exists precisely so
 *   that "the ghost cannot promise a colour the stroke will not lay", and a
 *   duplicate seed breaks that from the other end.
 *
 *   AND A JITTERING FINGER IS NOT A GESTURE. The board reports a move whenever
 *   the cell under the pointer CHANGES, which is not the same as "a new cell":
 *   an unsteady finger on the boundary between two cells reports A, B, A, B for
 *   as long as it rests there. With this rule that costs nothing at all.
 *
 * The position is kept on first touch rather than moved to the end, which follows
 * from the same argument: seed k previews the progression's k-th step, so moving
 * a seed would change the colour the user has already been shown.
 *
 * NOTE WHAT THIS DOES NOT DEDUPE. A cell that is merely COVERED by an existing
 * seed's orbit — an image of it under the subgroup — is not a seed, and touching
 * it proposes it on its own. That is not an oversight; it is the paint-drag
 * behaviour being mirrored exactly. `paintAt` applies the brush at every distinct
 * cell a paint drag enters, including at the orbit-mates of cells it has already
 * painted, and with a progression running those repeat applications are visibly
 * different strokes. A propose drag that silently skipped them would be a
 * different tool wearing the same name.
 */

import type { BandSurface } from "./bands";
import { brushStamp, type BrushShape, type BrushStamp } from "./brush";
import { clipStamp } from "./arms";
import type { SymmetrySurface } from "./orbit";

/**
 * The seeds a `propose` drag has gathered, in the order it gathered them.
 *
 * `readonly number[]` rather than a branded type: it is handed straight to React
 * state and straight to `.map`, and a wrapper would buy nothing that the two
 * constructors below do not already guarantee. Distinctness is an invariant of
 * `proposeSeed`, which is the only way to grow one.
 */
export type Proposal = readonly number[];

/**
 * `readonly` and shared, so "no proposal" is one reference everywhere.
 *
 * Every reset path in the page assigns this exact value, which makes "did the
 * proposal change?" a pointer comparison for React and makes an accidental
 * `[]`-per-render — the classic way to defeat a `useMemo` — impossible to write
 * by reaching for the constant.
 */
export const EMPTY_PROPOSAL: Proposal = [];

/** Whether this seed is already standing. Not "is this cell covered". */
export function proposalHolds(p: Proposal, i: number): boolean {
  return p.includes(i);
}

/**
 * One more application, appended — or the list back untouched.
 *
 * Returning the SAME reference for a seed already held is the whole of the
 * jitter defence: React bails out of a state update that sets the identical
 * value, so a finger resting on a cell boundary costs one comparison per event
 * and no render at all. See the header for why a duplicate would be worse than
 * useless.
 */
export function proposeSeed(p: Proposal, i: number): Proposal {
  return p.includes(i) ? p : [...p, i];
}

/**
 * The brush at one seed, clipped to the cells the mask keeps.
 *
 * Extracted so the three places that need "what would one application do here"
 * — the live paint path, the proposal's preview, and the proposal's commit —
 * are one function rather than three copies that agree on the day they are
 * written. `clipStamp` deliberately leaves `span` alone; see `arms.ts` for why
 * confining a stroke to one arm must not renumber its colours.
 */
export function seedStamp(
  surface: SymmetrySurface,
  bands: BandSurface,
  seed: number,
  shape: BrushShape,
  keep: (i: number) => boolean
): BrushStamp {
  return clipStamp(brushStamp(surface, bands, seed, shape), keep);
}

/**
 * The whole proposal as the applications it will become, in order.
 *
 * ONE STAMP PER SEED, and that is the point rather than an implementation
 * detail. A stamp carries `span` — how many positions of the colour scheme this
 * application is indexed over — and span is a fact about the SEED, not about the
 * gesture: an orbit's span is its own realised size, so a seed pinned on a mirror
 * spans 3 where a free one spans 6, and a band brush's span is the number of
 * image bands, which the sector scope makes vary from seed to seed
 * (`brush.brushSpan`). Merging the seeds into one stamp would replace all of
 * those with a single number and every hue derived from it would be wrong — the
 * hexad over a 3-band stamp is 0°, 60°, 120°, and over a merged 6-band stamp it
 * is the whole wheel. `test/propose.test.ts` measures exactly that difference
 * rather than describing it.
 */
export function proposalStamps(
  surface: SymmetrySurface,
  bands: BandSurface,
  seeds: Proposal,
  shape: BrushShape,
  keep: (i: number) => boolean
): BrushStamp[] {
  return seeds.map((seed) => seedStamp(surface, bands, seed, shape, keep));
}

/**
 * The symmetry groups ONE application contributes to a `strokes.StrokeMark`.
 *
 * `groups` is `null` for a plain orbit — where there is no grouping, not a
 * grouping of one — so the orbit itself is the group. Empty groups are dropped:
 * a band clipped entirely out of an isolated arm claimed no cell, and
 * `provenance.gestureLayers` numbers its children off this list, so an empty
 * entry would give a child the size of the wrong orbit.
 *
 * Extracted for the same reason `seedStamp` is: the paint path and the proposal
 * both build a mark, and they have to build the same one.
 */
export function stampGroups(stamp: BrushStamp): number[][] {
  return (stamp.groups ?? [stamp.cells]).filter((g) => g.length > 0);
}

/**
 * The distinct cells a family of lists covers, ascending.
 *
 * The readouts want it — "reach 42" over a proposal is the count of cells the
 * whole thing touches, not the sum of the applications, which double-counts
 * every cell two overlapping orbits share. Ascending because every other cell
 * list in this program is, so a caller can compare two of them directly.
 */
export function unionCells(lists: readonly (readonly number[])[]): number[] {
  const seen = new Set<number>();
  for (const list of lists) for (const i of list) seen.add(i);
  return [...seen].sort((a, b) => a - b);
}
