/**
 * MORPH — increment 3 of `docs/spec-curvature.md`, decided by computation.
 *
 * The increment's claim is that the flow dial can be EASED without any tick of
 * the ease being an approximation: every intermediate state is an exact model
 * state on an integer lattice, and both endpoints are structural identities
 * rather than agreements. So the questions this file answers are arithmetic:
 *
 *   THE LADDER    is it the exact dozenal smoothstep, and would a float
 *                 implementation be caught?
 *   THE REGISTRY  do the weights sum to exactly one at every tick, does a
 *                 departure reach exactly zero in exactly its starting step's
 *                 ticks, and is the entry deleted?
 *   THE FIELD     is an eased tick the STATIC field one refinement down, and
 *                 does `wallsContained` hold at every tick rather than only at
 *                 the two ends?
 *
 * Labels follow the house convention: [PROVEN] is exhaustive computation against
 * an independent oracle with a mutation shown lethal; [MEASURED] is a number
 * this run produced.
 *
 * ── WHAT THE BUILDING CORRECTED ──────────────────────────────────────────
 *
 * Two things, both recorded below where they are measured.
 *
 * **The obvious guard-fire does not fire.** The brief expected a float-sampled
 * ladder to be caught by "endpoints or sum or arrival-identity". None of the
 * three catches it — a rounded cubic Hermite has endpoints exactly 0 and 144,
 * increments that telescope to exactly 144, and an exact arrival. What catches
 * it is the MIRROR, at the two half-integer samples the rounding has to break.
 *
 * **The proportional clamp is unreachable from this dial.** Not because the
 * driver is slow: the ladder conserves the total step count, and over the finite
 * domain that leaves — multisets of steps summing to at most twelve — the stops
 * never sum past 144. Both halves are enumerated here.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { buildHexagon, buildRep9Hexagon } from "../src/lib/hexagon";
import {
  buildCurvature,
  buildEasedCurvature,
  controlPoints,
  MAX_FLOW,
  REFINE,
  V4_H_WALL,
  wallsContained,
  Z3_GRADE_WALL,
  type CurvatureField,
  type EdgeLaw,
} from "../src/lib/curvature";
import {
  effectiveDial,
  isEasing,
  LADDER_DEN,
  LADDER_INCREMENTS,
  LADDER_STOPS,
  LADDER_TICKS,
  morphTarget,
  MUTANT_ROUNDED_HERMITE,
  restMorph,
  retarget,
  settle,
  stopAt,
  tick,
  weightsOf,
  type Morph,
} from "../src/lib/morph";
import {
  buildVertexTable,
  type CanvasSpec,
  type DerivedVertexTable,
} from "../src/lib/vertices";

// ── the canvases, built by the SHIPPED constructors ──────────────────────

interface Canvas {
  readonly name: string;
  readonly table: DerivedVertexTable;
  readonly charges: readonly number[];
  readonly law: EdgeLaw;
}

const rep4 = (depth: number): Canvas => {
  const spec: CanvasSpec = { radix: 4, depth, sectors: 6 };
  return {
    name: `rep-4 d${depth}`,
    table: buildVertexTable(spec),
    charges: buildHexagon(depth).cells.map((c) => c.charge),
    law: V4_H_WALL,
  };
};

const rep9 = (depth: number): Canvas => {
  const spec: CanvasSpec = { radix: 9, depth, sectors: 6 };
  return {
    name: `rep-9 d${depth}`,
    table: buildVertexTable(spec),
    charges: buildRep9Hexagon(depth).cells.map((c) => c.charge),
    law: Z3_GRADE_WALL,
  };
};

const CANVASES = (): Canvas[] => [rep4(1), rep4(2), rep4(3), rep9(1), rep9(2)];

/** Run a morph to rest, counting the ticks. Never time — always a count. */
function run(m: Morph, limit = 200): { morph: Morph; ticks: number } {
  let cur = m;
  let ticks = 0;
  while (isEasing(cur) && ticks < limit) {
    cur = tick(cur);
    ticks++;
  }
  return { morph: cur, ticks };
}

// ═════════════════════════════════════════════════════════════════════════
describe("G2 — the ladder is a finite table of exact rationals", () => {
  /**
   * DERIVED, NOT TABULATED. The six increments are the only numbers written
   * down; the stops are their running sum and the falling half is the rising
   * half reversed. What the derivation cannot make true by construction is
   * checked here: the total, the endpoints, and strict monotonicity.
   */
  it("twelve ticks, thirteen stops, summing to exactly 144 [PROVEN]", () => {
    expect(LADDER_INCREMENTS).toEqual([2, 6, 10, 14, 18, 22, 22, 18, 14, 10, 6, 2]);
    expect(LADDER_STOPS).toEqual([
      0, 2, 8, 18, 32, 50, 72, 94, 112, 126, 136, 142, 144,
    ]);
    expect([LADDER_TICKS, LADDER_STOPS.length]).toEqual([12, 13]);
    expect(LADDER_INCREMENTS.reduce((a, b) => a + b, 0)).toBe(144);
    // the endpoints are EXACT — G2's whole condition, and G3's precondition
    expect([LADDER_STOPS[0], LADDER_STOPS[LADDER_TICKS], LADDER_DEN]).toEqual([
      0, 144, 144,
    ]);
    // and it is the dial's own denominator, not a second one
    expect(LADDER_DEN).toBe(REFINE);
    for (let s = 0; s < LADDER_TICKS; s++) {
      expect([s, LADDER_STOPS[s] < LADDER_STOPS[s + 1]]).toEqual([s, true]);
    }
  });

  /**
   * ★ THE INDEPENDENT ORACLE. The increments are an arithmetic progression of
   * difference 4 — the discrete derivative of a quadratic — so the rising half
   * has the closed form `stop(s) = 2s²` and the falling half is its mirror:
   * `stop(s) = 144 − 2(12 − s)²`. That is what "piecewise-quadratic dozenal
   * smoothstep" means, computed rather than trusted, and the two halves must
   * meet at s = 6 with 2·36 = 72.
   *
   * The closed forms are stated the way `vertices.ts` states its own: the
   * derivation is the authority, the table is a memo, and the closed form is a
   * third opinion neither of them can bend.
   */
  it("the closed form: 2s² rising, its mirror falling, meeting at 72 [PROVEN]", () => {
    for (let s = 0; s <= 6; s++) expect([s, stopAt(s)]).toEqual([s, 2 * s * s]);
    for (let s = 6; s <= 12; s++) {
      expect([s, stopAt(s)]).toEqual([s, 144 - 2 * (12 - s) * (12 - s)]);
    }
    // the mirror, which is what makes ease-in and ease-out the same curve
    for (let s = 0; s <= 12; s++) {
      expect([s, stopAt(s) + stopAt(12 - s)]).toEqual([s, 144]);
    }
  });

  it("a rung is an index, and the guard says so", () => {
    expect(() => stopAt(-1)).toThrow(/rung/);
    expect(() => stopAt(13)).toThrow(/rung/);
    expect(() => stopAt(1.5)).toThrow(/rung/);
  });

  /**
   * ★ GUARD-FIRE — the ladder a float implementation writes, and it is NOT the
   * one the brief predicted would be caught.
   *
   * `MUTANT_ROUNDED_HERMITE` is `Math.round(144·(3u² − 2u³))` at twelfths, the
   * smoothstep everyone knows, sampled and rounded into the spec's denominator.
   * It is recomputed here WITH `Math` so the counterexample is the real thing —
   * the module states it as data only to keep its own no-`Math.` discipline.
   *
   * What passes on it, recorded because it is the finding: **endpoints exactly
   * 0 and 144, increments summing to exactly 144, strictly monotone, and an
   * exact arrival at the target.** Every headline property of G2. A suite that
   * checked those would ship the float ladder.
   *
   * What fails is the MIRROR, and it fails at exactly the two samples the
   * function lands on a half-integer — `(18s² − s³)/6` at s = 3 and s = 9 is
   * 22½ and 121½, which is fold-re's own reason for shipping the Hermite over
   * 864 rather than rounding it into 144. Round-half-up sends them to 23 and
   * 122, and 23 + 122 = 145.
   */
  it("guard-fire: the rounded Hermite passes every headline test and breaks the mirror [PROVEN]", () => {
    // the mutant is what floats really give — not a straw man
    const floaty = Array.from({ length: 13 }, (_, s) => {
      const u = s / 12;
      return Math.round(144 * (3 * u * u - 2 * u * u * u));
    });
    expect(floaty).toEqual([...MUTANT_ROUNDED_HERMITE]);

    // ── everything the obvious tests check, GREEN on the mutant ──
    const inc = MUTANT_ROUNDED_HERMITE.slice(1).map(
      (v, i) => v - MUTANT_ROUNDED_HERMITE[i]
    );
    expect(inc.reduce((a, b) => a + b, 0)).toBe(144); // the sum: fine
    expect([
      MUTANT_ROUNDED_HERMITE[0],
      MUTANT_ROUNDED_HERMITE[12],
    ]).toEqual([0, 144]); // the endpoints: fine
    expect(inc.every((d) => d > 0)).toBe(true); // monotone: fine
    expect(MUTANT_ROUNDED_HERMITE.length).toBe(LADDER_STOPS.length); // 12 ticks: fine

    // ── and the two assertions that are lethal ──
    const brokenMirror: number[] = [];
    for (let s = 0; s <= 12; s++) {
      if (MUTANT_ROUNDED_HERMITE[s] + MUTANT_ROUNDED_HERMITE[12 - s] !== 144) {
        brokenMirror.push(s);
      }
    }
    expect(brokenMirror).toEqual([3, 9]);
    // and it is not the piecewise quadratic it would have to be
    const offQuadratic: number[] = [];
    for (let s = 0; s <= 6; s++) {
      if (MUTANT_ROUNDED_HERMITE[s] !== 2 * s * s) offQuadratic.push(s);
    }
    expect(offQuadratic).toEqual([1, 2, 3, 4, 5]);
    // it disagrees with the shipped ladder at 10 of the 11 interior stops
    let differ = 0;
    for (let s = 1; s < 12; s++) {
      if (MUTANT_ROUNDED_HERMITE[s] !== LADDER_STOPS[s]) differ++;
    }
    expect(differ).toBe(10);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("G1 — the registry is a normalized position", () => {
  /**
   * THE WEIGHTS SUM TO EXACTLY ONE, and on integers that sentence is
   * `base + Σ overlays === den`. Checked at every tick of a full transition
   * rather than at the ends, because "exactly 1" at the ends and 0.9999 in the
   * middle is precisely the failure the exact ladder exists to make impossible.
   */
  it("base + Σ overlays === den at every tick, and no overlays means 144·base [PROVEN]", () => {
    const rows: [number, number, number][] = [];
    for (const start of [0, 12, 36, MAX_FLOW]) {
      for (const to of [0, 1, 24, MAX_FLOW]) {
        let m = retarget(restMorph(start), to);
        let checked = 0;
        for (let i = 0; i <= LADDER_TICKS + 1; i++) {
          const w = weightsOf(m);
          const sum = w.overlays.reduce((a, b) => a + b, w.base);
          expect([start, to, i, sum, w.den]).toEqual([start, to, i, w.den, w.den]);
          const d = effectiveDial(m);
          expect(d.den).toBe(w.den);
          if (!isEasing(m)) {
            // at rest the composed dial IS the integer dial, exactly
            expect([start, to, i, d.num, d.den]).toEqual([
              start,
              to,
              i,
              REFINE * m.base,
              REFINE,
            ]);
          }
          checked++;
          m = tick(m);
        }
        rows.push([start, to, checked]);
      }
    }
    expect(rows.length).toBe(16);
    expect(rows.every((r) => r[2] === LADDER_TICKS + 2)).toBe(true);
  });

  /**
   * ★ ARRIVAL IN EXACTLY THE LADDER'S TICK COUNT, and the registry EMPTY after
   * it — the acceptance line, over every reachable pair of dials.
   *
   * Exhaustive: all 49 × 49 ordered pairs of dial positions. A fresh transition
   * between two different dials takes exactly 12 ticks; retargeting to where you
   * already are takes none at all.
   */
  it("every 0…48 → 0…48 transition arrives in exactly 12 ticks, registry empty [PROVEN]", () => {
    let moves = 0;
    let stays = 0;
    for (let from = 0; from <= MAX_FLOW; from++) {
      for (let to = 0; to <= MAX_FLOW; to++) {
        const started = retarget(restMorph(from), to);
        const { morph, ticks } = run(started);
        expect([from, to, morph.base, morph.overlays.length]).toEqual([
          from,
          to,
          to,
          0,
        ]);
        if (from === to) {
          expect([from, to, ticks]).toEqual([from, to, 0]);
          stays++;
        } else {
          expect([from, to, ticks]).toEqual([from, to, LADDER_TICKS]);
          moves++;
        }
      }
    }
    expect([moves, stays]).toEqual([49 * 48, 49]);
  });

  /**
   * ★★ G3 — A DEPARTURE REACHES EXACTLY ZERO IN EXACTLY ITS STARTING STEP'S
   * TICKS, AND THE ENTRY IS DELETED.
   *
   * fold-re's own observation (§12.1: "36 departures, every one reaching 0 in
   * exactly the starting step's tick count, worst 12") reproduced on this dial,
   * over every rung a departure can begin from. The deletion is checked as a
   * deletion — the overlay is not present holding a zero, it is gone — because
   * "exact zero is the reclamation rule" is a statement about memory.
   */
  it("a departing overlay is deleted at exactly its starting step's tick [PROVEN]", () => {
    const rows: [number, number][] = [];
    for (let step = 1; step <= LADDER_TICKS; step++) {
      // a registry with one overlay caught at `step` and superseded
      let m: Morph = {
        base: 0,
        overlays: [{ target: 24, step, rising: true }],
      };
      m = retarget(m, 0); // back to base: the overlay departs, nothing installed
      expect(m.overlays.map((o) => [o.step, o.rising])).toEqual([[step, false]]);
      let ticks = 0;
      while (m.overlays.length > 0) {
        m = tick(m);
        ticks++;
        expect(ticks).toBeLessThanOrEqual(LADDER_TICKS);
      }
      // deleted, not held at zero
      expect([step, m.overlays.length, m.base]).toEqual([step, 0, 0]);
      rows.push([step, ticks]);
    }
    // the tick count IS the starting step, and the worst case is the ladder's
    expect(rows).toEqual([
      [1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6],
      [7, 7], [8, 8], [9, 9], [10, 10], [11, 11], [12, 12],
    ]);
  });

  /**
   * A RETARGET MID-FLIGHT: the new target is born at zero and walks up, the old
   * one keeps the step it had and walks down. Neither owns the value — G1's
   * whole point — and the dial passes through neither of them.
   */
  it("mid-flight retarget: one rising, the rest departing, and it still settles [PROVEN]", () => {
    let m = retarget(restMorph(0), MAX_FLOW);
    for (let i = 0; i < 5; i++) m = tick(m); // caught at step 5
    expect(m.overlays.map((o) => [o.target, o.step, o.rising])).toEqual([
      [MAX_FLOW, 5, true],
    ]);
    const mid = effectiveDial(m);
    // 0·(144 − 50) + 48·50 = 2400 over 144: strictly between the two dials
    expect([mid.num, mid.den]).toEqual([2400, 144]);

    m = retarget(m, 12);
    expect(m.overlays.map((o) => [o.target, o.step, o.rising])).toEqual([
      [MAX_FLOW, 5, false],
      [12, 0, true],
    ]);
    // exactly one rising, always
    let worstOverlays = 0;
    let ticks = 0;
    while (isEasing(m)) {
      expect(m.overlays.filter((o) => o.rising).length).toBeLessThanOrEqual(1);
      worstOverlays = Math.max(worstOverlays, m.overlays.length);
      m = tick(m);
      ticks++;
    }
    expect([m.base, m.overlays.length, ticks, worstOverlays]).toEqual([
      12, 0, LADDER_TICKS, 2,
    ]);
  });

  /**
   * A drag that returns to a value still in flight REVIVES it rather than
   * installing a second overlay for the same target — otherwise a slider being
   * scrubbed would accumulate duplicates that all say the same thing.
   */
  it("retargeting back to a departing target revives it in place [PROVEN]", () => {
    let m = retarget(restMorph(0), 36);
    for (let i = 0; i < 4; i++) m = tick(m);
    m = retarget(m, 12);
    for (let i = 0; i < 2; i++) m = tick(m);
    expect(m.overlays.map((o) => [o.target, o.rising])).toEqual([
      [36, false],
      [12, true],
    ]);
    m = retarget(m, 36);
    expect(m.overlays.map((o) => [o.target, o.rising])).toEqual([
      [36, true],
      [12, false],
    ]);
    expect(run(m).morph).toEqual(restMorph(36));
  });

  /** An overlay already at exactly zero is reclaimed at once, not next tick. */
  it("a step-0 overlay superseded is deleted outright — G3 [PROVEN]", () => {
    const m = retarget(retarget(restMorph(0), 24), 36);
    expect(m.overlays.map((o) => [o.target, o.step, o.rising])).toEqual([
      [36, 0, true],
    ]);
  });

  /** The slider reads the ASKED-FOR dial, not the settled one. */
  it("morphTarget follows the rising overlay, and the base at rest [PROVEN]", () => {
    expect(morphTarget(restMorph(7))).toBe(7);
    const m = retarget(restMorph(7), 30);
    expect(morphTarget(m)).toBe(30);
    expect(morphTarget(retarget(m, 7))).toBe(7);
    expect(morphTarget(run(m).morph)).toBe(30);
  });

  /** `settle` is the instant land: reduced motion, and the relief exclusion. */
  it("settle empties the registry and lands on the dial [PROVEN]", () => {
    let m = retarget(restMorph(0), MAX_FLOW);
    for (let i = 0; i < 7; i++) m = tick(m);
    expect(isEasing(m)).toBe(true);
    expect(settle(m, 0)).toEqual(restMorph(0));
    expect(settle(m, MAX_FLOW)).toEqual(restMorph(MAX_FLOW));
    // idempotent at rest, and the SAME object, so React does not re-render
    const rest = restMorph(12);
    expect(settle(rest, 12)).toBe(rest);
    expect(retarget(rest, 12)).toBe(rest);
  });

  it("the dial guard fires on anything that is not a rung of 0…48", () => {
    expect(() => restMorph(-1)).toThrow(/dial/);
    expect(() => restMorph(MAX_FLOW + 1)).toThrow(/dial/);
    expect(() => restMorph(1.5)).toThrow(/dial/);
    expect(() => retarget(restMorph(0), MAX_FLOW + 1)).toThrow(/dial/);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("the proportional clamp — implemented, and unreachable", () => {
  /**
   * §12.1's clamp zeroes the base weight and preserves the overlay ratios
   * exactly. On integers over a FIXED denominator that rescaling does not
   * exist, so it is landed by moving the DENOMINATOR: the overlay numerators
   * are untouched — which is what "ratios preserved exactly" means when there is
   * no rounding to hide in — and the base weight goes to exactly 0.
   *
   * Driven directly, past anything the dial can build.
   */
  it("the clamp zeroes the base and leaves the overlay numerators alone [PROVEN]", () => {
    const m: Morph = {
      base: 12,
      overlays: [
        { target: MAX_FLOW, step: 12, rising: true }, // weight 144
        { target: 24, step: 6, rising: false }, // weight 72
      ],
    };
    const w = weightsOf(m);
    expect([w.clamped, w.base, [...w.overlays], w.den]).toEqual([
      true,
      0,
      [144, 72],
      216,
    ]);
    // the weights still sum to exactly `den` — "sum to 1" with the fraction cleared
    expect(w.overlays.reduce((a, b) => a + b, w.base)).toBe(w.den);
    // and the ratio 144 : 72 is 2 : 1 EXACTLY, before and after
    expect(w.overlays[0]).toBe(2 * w.overlays[1]);
    // the composed dial: ⅔·48 + ⅓·24 = 40, and it is that on the nose
    const d = effectiveDial(m);
    expect([d.num, d.den]).toEqual([8640, 216]);
    expect(d.num).toBe(40 * d.den);
  });

  /**
   * ★ AND IT NEVER FIRES FROM THE DIAL. Two halves, both finite.
   *
   * (a) The ladder CONSERVES the step count: a tick raises the one rising
   * overlay by 1 and lowers every departing one by 1, so Σ steps never exceeds
   * the rising overlay's own step, which is at most 12. Measured over every
   * retarget cadence from 1 to 15 ticks against a sweep of targets.
   *
   * (b) Over the finite domain that leaves — multisets of steps summing to at
   * most 12 — `Σ stop(sᵢ) ≤ 144` always, enumerated exhaustively. Equality is
   * exactly the mirror pairs.
   */
  it("Σ steps ≤ 12 on every state the dial can reach [MEASURED]", () => {
    let worstSteps = 0;
    let worstStops = 0;
    let worstOverlays = 0;
    let clamped = 0;
    let states = 0;
    const targets = [0, 1, 5, 12, 24, 36, 47, MAX_FLOW];
    const visit = (m: Morph) => {
      const w = weightsOf(m);
      const steps = m.overlays.reduce((a, o) => a + o.step, 0);
      const stops = w.overlays.reduce((a, b) => a + b, 0);
      // THE INVARIANT, at every single state rather than at the maximum
      expect(steps).toBeLessThanOrEqual(LADDER_TICKS);
      expect(stops).toBeLessThanOrEqual(LADDER_DEN);
      expect(m.overlays.filter((o) => o.rising).length).toBeLessThanOrEqual(1);
      effectiveDial(m); // and the K-bound guard, at every state
      if (steps > worstSteps) worstSteps = steps;
      if (stops > worstStops) worstStops = stops;
      if (m.overlays.length > worstOverlays) worstOverlays = m.overlays.length;
      if (w.clamped) clamped++;
      states++;
    };
    // every regular cadence from one retarget per tick to one per fifteen
    for (let cadence = 1; cadence <= 15; cadence++) {
      let m = restMorph(0);
      for (let t = 0; t < 180; t++) {
        if (t % cadence === 0) {
          m = retarget(m, targets[(t + cadence) % targets.length]);
        }
        visit(m);
        m = tick(m);
      }
    }
    // and an irregular one, since a real drag is not periodic: a deterministic
    // LCG picking both the gap and the target
    let seed = 1;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
    let m = restMorph(0);
    for (let t = 0; t < 4000; t++) {
      if (next() % 5 === 0) m = retarget(m, next() % (MAX_FLOW + 1));
      visit(m);
      m = tick(m);
    }
    // 6,700 reachable states. The worst Σ steps observed is 11, one below the
    // bound — a rising overlay that reaches 12 is ABSORBED in the same tick, so
    // the top rung is never a state. Up to FIVE overlays alive at once under
    // the irregular script, and the clamp fires on none of them.
    expect([states, worstSteps, worstStops, worstOverlays, clamped]).toEqual([
      6700, 11, 142, 5, 0,
    ]);
  });

  it("Σ stop(sᵢ) ≤ 144 for every multiset of steps summing to ≤ 12 [PROVEN]", () => {
    let worst = 0;
    let tight = 0;
    let seen = 0;
    // every partition of every n ≤ 12 into parts 1…12, generated in
    // non-increasing order so each multiset is visited once
    const walk = (left: number, cap: number, stops: number) => {
      seen++;
      if (stops > worst) worst = stops;
      if (stops === 144) tight++;
      for (let part = Math.min(cap, left); part >= 1; part--) {
        walk(left - part, part, stops + stopAt(part));
      }
    };
    walk(LADDER_TICKS, LADDER_TICKS, 0);
    // 272 = Σ p(n) for n = 0…12 — every multiset, the empty one included
    expect([seen, worst]).toEqual([272, 144]);
    // and equality is exactly the mirror pairs plus the single full rung:
    // {12}, {11,1}, {10,2}, {9,3}, {8,4}, {7,5}, {6,6}
    expect(tight).toBe(7);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("the eased field — a tick is a model state, not a rendering of one", () => {
  /**
   * ★ THE LINEARITY IDENTITY, which is the whole reason the ease is exact.
   *
   * `cp = scale·P + flow·(A − P)` is linear in the pair `(scale, flow)`, so at
   * `num = den·k` the eased control points are exactly `den` times the static
   * ones at dial `k` — the same integers, one refinement apart. Not a rounding
   * that agrees: an identity, checked on every wall of every canvas at several
   * dials and several denominators.
   */
  it("eased cps at num = den·k are exactly den × the static ones [PROVEN]", () => {
    const rows: [string, number, number][] = [];
    for (const c of CANVASES()) {
      let checked = 0;
      for (const k of [1, 12, 36, MAX_FLOW]) {
        const flat = buildCurvature(c.table, c.charges, c.law, k);
        if (flat === null) throw new Error("expected a field");
        for (const den of [REFINE, 216, 288]) {
          const eased = buildEasedCurvature(c.table, c.charges, c.law, {
            num: den * k,
            den,
          });
          if (eased === null) throw new Error("expected a field");
          expect([c.name, k, den, eased.scale]).toEqual([
            c.name,
            k,
            den,
            REFINE * den,
          ]);
          expect(eased.walls.length).toBe(flat.walls.length);
          for (let i = 0; i < flat.walls.length; i++) {
            const a = flat.walls[i];
            const b = eased.walls[i];
            for (const e of [0, 1] as const) {
              expect(b.cp[e]).toEqual([den * a.cp[e][0], den * a.cp[e][1]]);
            }
            checked++;
          }
          // the anchors scale with them, so the whole picture is one dilation
          for (let v = 0; v < c.table.vertices.length; v++) {
            expect(eased.refined.vertices[v]).toEqual([
              den * flat.refined.vertices[v][0],
              den * flat.refined.vertices[v][1],
            ]);
          }
        }
      }
      rows.push([c.name, c.table.cells.length, checked]);
    }
    expect(rows).toEqual([
      ["rep-4 d1", 24, 144],
      ["rep-4 d2", 96, 720],
      ["rep-4 d3", 384, 3168],
      ["rep-9 d1", 54, 648],
      ["rep-9 d2", 486, 7776],
    ]);
  });

  /**
   * ★ D1, MEASURED: THE WALL SET IS DIAL-INDEPENDENT.
   *
   * `wallsOf` reads the charges and the law; the dial reaches exactly one
   * expression, the `controlPoints` call. So the ease never rebuilds
   * combinatorics — the edges, the sides, the apex indices and the census are
   * the same objects' worth of information at every tick, and only two points
   * per wall move. Checked over the dial's whole integer range and over eased
   * micro-dials at three denominators.
   */
  it("the wall set, the sides and the census are the same at every dial [PROVEN]", () => {
    const shape = (f: CurvatureField) => ({
      keys: [...f.wallByEdge.keys()].sort(),
      sides: f.walls.map((w) => [w.p, w.q, w.apex, w.into, w.from].join(",")),
      census: [f.census.interior, f.census.walls, f.census.flat, f.census.sinks],
    });
    const rows: [string, number, number][] = [];
    for (const c of CANVASES()) {
      const base = buildCurvature(c.table, c.charges, c.law, 1);
      if (base === null) throw new Error("expected a field");
      const want = shape(base);
      let compared = 0;
      for (let k = 1; k <= MAX_FLOW; k++) {
        const f = buildCurvature(c.table, c.charges, c.law, k);
        if (f === null) throw new Error("expected a field");
        expect([c.name, k, shape(f)]).toEqual([c.name, k, want]);
        compared++;
      }
      for (const den of [REFINE, 216, 288]) {
        for (const num of [1, 17, den * 7 + 3, den * MAX_FLOW]) {
          const f = buildEasedCurvature(c.table, c.charges, c.law, { num, den });
          if (f === null) throw new Error("expected a field");
          expect([c.name, den, num, shape(f)]).toEqual([c.name, den, num, want]);
          compared++;
        }
      }
      rows.push([c.name, base.walls.length, compared]);
    }
    expect(rows).toEqual([
      ["rep-4 d1", 12, 60],
      ["rep-4 d2", 60, 60],
      ["rep-4 d3", 264, 60],
      ["rep-9 d1", 54, 60],
      ["rep-9 d2", 648, 60],
    ]);
  });

  /**
   * ★★ D6 — CONTAINMENT AT EVERY TICK, not only at the two ends.
   *
   * Every composed dial is a convex combination of dials at or below the
   * ceiling, so it is itself at or below the ceiling, so `docs/warp-findings.md`
   * Q3's measured-safe sagitta holds all the way across. Driven for real: a full
   * 0 → 48 transition and a mid-flight retarget, `wallsContained` at every tick,
   * every coordinate an exact integer.
   */
  it("wallsContained holds at every tick of a transition and a retarget [PROVEN]", () => {
    const rows: [string, string, number, number][] = [];
    for (const c of [rep4(2), rep9(1)]) {
      for (const script of ["straight", "retarget"] as const) {
        let m = retarget(restMorph(0), MAX_FLOW);
        let ticks = 0;
        let built = 0;
        while (isEasing(m)) {
          if (script === "retarget" && ticks === 5) m = retarget(m, 12);
          const d = effectiveDial(m);
          const f = buildEasedCurvature(c.table, c.charges, c.law, d);
          if (f !== null) {
            expect([c.name, script, ticks, wallsContained(f)]).toEqual([
              c.name,
              script,
              ticks,
              true,
            ]);
            for (const w of f.walls) {
              for (const p of [...w.cp[0], ...w.cp[1]]) {
                expect(Number.isSafeInteger(p)).toBe(true);
              }
            }
            built++;
          }
          m = tick(m);
          ticks++;
        }
        expect(m.overlays.length).toBe(0);
        rows.push([c.name, script, ticks, built]);
      }
    }
    // the straight run is the ladder's 12 ticks with the first rendering the
    // figure it is leaving (weight exactly 0 → no field at all); the retarget
    // costs 5 more, being caught at step 5 and restarted.
    expect(rows).toEqual([
      ["rep-4 d2", "straight", 12, 11],
      ["rep-4 d2", "retarget", 17, 16],
      ["rep-9 d1", "straight", 12, 11],
      ["rep-9 d1", "retarget", 17, 16],
    ]);
  });

  /**
   * L3 AT BOTH ENDS OF THE EASE, structurally.
   *
   * The first tick of a 0 → k ease has the overlay at weight exactly 0, so the
   * composed dial is 0 and the eased builder returns `null` — the figure the
   * ease is leaving, through the branch that existed before curvature did. And
   * an ease home to 0 empties the registry onto `base = 0`, where the STATIC
   * builder returns `null` for the same reason.
   */
  it("the ease begins and ends on null fields, never on straight curves [PROVEN]", () => {
    const c = rep4(2);
    const up = retarget(restMorph(0), MAX_FLOW);
    expect(effectiveDial(up)).toEqual({ num: 0, den: REFINE });
    expect(
      buildEasedCurvature(c.table, c.charges, c.law, effectiveDial(up))
    ).toBe(null);

    let m = retarget(restMorph(MAX_FLOW), 0);
    const seen: number[] = [];
    while (isEasing(m)) {
      seen.push(effectiveDial(m).num);
      m = tick(m);
    }
    expect(m).toEqual(restMorph(0));
    expect(buildCurvature(c.table, c.charges, c.law, m.base)).toBe(null);
    // and the walk down is the ladder's own mirror, strictly decreasing
    expect(seen).toEqual(
      LADDER_STOPS.slice(0, LADDER_TICKS).map((w) => MAX_FLOW * (144 - w))
    );
  });

  /**
   * ARRIVAL IS THE UN-EASED RENDER, and it is the same code path rather than a
   * new one that agrees: the registry empties, `base` is the target, and the
   * page's branch is on `isEasing`. Here the two fields are compared object for
   * object to show there is nothing left for the ease to have changed.
   */
  it("the arrived field is the static field, wall for wall [PROVEN]", () => {
    for (const c of [rep4(2), rep9(1)]) {
      for (const to of [1, 24, MAX_FLOW]) {
        const { morph } = run(retarget(restMorph(0), to));
        expect(isEasing(morph)).toBe(false);
        const arrived = buildCurvature(c.table, c.charges, c.law, morph.base);
        const direct = buildCurvature(c.table, c.charges, c.law, to);
        expect([c.name, to, arrived]).toEqual([c.name, to, direct]);
        expect(arrived?.scale).toBe(REFINE);
      }
    }
  });

  /**
   * ★ THE K-BOUND GUARD FIRES, driven directly past the ceiling the way
   * `test/curvature.test.ts` drives `controlPoints` past it.
   */
  it("guard-fire: the micro-dial guard rejects anything past the ceiling", () => {
    const c = rep4(1);
    const call = (num: number, den: number) =>
      buildEasedCurvature(c.table, c.charges, c.law, { num, den });
    expect(() => call(REFINE * MAX_FLOW + 1, REFINE)).toThrow(/micro-dial/);
    expect(() => call(-1, REFINE)).toThrow(/micro-dial/);
    expect(() => call(1.5, REFINE)).toThrow(/micro-dial/);
    expect(() => call(1, REFINE - 1)).toThrow(/denominator/);
    expect(() => call(1, 1.5)).toThrow(/denominator/);
    // at the ceiling exactly it builds, and it is the static field ×144
    expect(call(REFINE * MAX_FLOW, REFINE)?.walls.length).toBe(12);
    // and the composed side of the same guard: a target past the ceiling
    expect(() =>
      effectiveDial({
        base: 0,
        overlays: [{ target: 2 * MAX_FLOW, step: LADDER_TICKS, rising: true }],
      })
    ).toThrow(/composed dial/);
    // the primitive itself is still unguarded, as increment 2 left it
    expect(
      controlPoints([0, 0], [1, 0], [0, 1], 4 * REFINE, REFINE)[0]
    ).toEqual([0, 576]);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("the module boundary and the float boundary", () => {
  /**
   * NO `Math.` AND NO DIVISION IN THE MORPH EITHER — the same assertion
   * `test/curvature.test.ts` makes of the module below it, read off this one's
   * own source. Comments, string literals and import paths are stripped first.
   *
   * The mutant ladder is the reason this is worth restating: the honest way to
   * write a smoothstep IS `Math.round(144 * f(u))`, and the module refuses even
   * to hold the counterexample as code.
   */
  it("the module's own source carries no division and no Math [PROVEN]", () => {
    const code = readFileSync(
      new URL("../src/lib/morph.ts", import.meta.url),
      "utf8"
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "")
      .replace(/"[^"]*"/g, '""')
      .replace(/`[^`]*`/g, "``");
    expect(/\bMath\./.test(code)).toBe(false);
    expect(code.includes("/")).toBe(false);
  });

  /**
   * L2, ONE MODULE FURTHER OUT. The morph is display-side: it holds a dial and
   * a ladder and no coordinate at all, and it is named by the page and by
   * nothing else. No mask, plate, brush, orbit, arm, focus or export module may
   * see it, for exactly the reason none of them may see `curvature.ts`.
   */
  const files = (dir: string): string[] => {
    const out: string[] = [];
    for (const e of readdirSync(new URL(`../${dir}`, import.meta.url), {
      withFileTypes: true,
    })) {
      if (e.isDirectory()) out.push(...files(`${dir}/${e.name}`));
      else if (/\.tsx?$/.test(e.name)) out.push(`${dir}/${e.name}`);
    }
    return out;
  };

  it("only the page names the morph [PROVEN]", () => {
    const importers = files("src")
      .filter((p) => !p.endsWith("/morph.ts"))
      .filter((p) =>
        /from\s+"(@\/lib\/morph|\.\/morph|\.\.\/lib\/morph)"/.test(
          readFileSync(new URL(`../${p}`, import.meta.url), "utf8")
        )
      )
      .sort();
    expect(importers).toEqual(["src/app/draw/page.tsx"]);
  });

  it("and it names nothing but the dial it eases [PROVEN]", () => {
    const src = readFileSync(
      new URL("../src/lib/morph.ts", import.meta.url),
      "utf8"
    );
    const imports = [...src.matchAll(/from\s+"\.\/([\w-]+)"/g)]
      .map((m) => m[1])
      .sort();
    expect(imports).toEqual(["curvature"]);
    for (const forbidden of [
      "plate",
      "brush",
      "orbit",
      "arms",
      "focus",
      "strokes",
      "lattice",
      "emit",
      "artfile",
      "layers",
      "frames",
      "timeline",
      "relief",
      "vertices",
      "hexagon",
    ]) {
      expect([forbidden, src.includes(`"./${forbidden}"`)]).toEqual([
        forbidden,
        false,
      ]);
    }
  });
});
