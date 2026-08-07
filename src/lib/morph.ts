/**
 * MORPH — the flow dial, eased, as exact integer state.
 *
 * Increment 3 of `docs/spec-curvature.md`: *eased flow under G1–G3*. The dial no
 * longer jumps. Changing it launches a transition along a FINITE table of exact
 * rationals, every intermediate tick is a model state with integer coordinates,
 * and both ends of the transition are STRUCTURAL identities rather than
 * agreements — arrival renders through increment 2's ordinary static path as if
 * the ease had never existed, and a return to zero lands on L3's `null` field.
 *
 * The disciplines are `fold-re`'s, adopted verbatim from its `docs/theory.md`
 * §12.1 (MATH-77) and restated in the spec as G1–G3:
 *
 *   G1  a morph is a NORMALIZED POSITION — one live base value plus a sparse
 *       overlay map {target, t}, the getter composing them with base weight
 *       1 − Σt. Two transitions may run at once and neither owns the value.
 *   G2  the easing ladder is a FINITE TABLE OF EXACT RATIONALS with endpoints
 *       exactly 0 and 1 — the dozenal smoothstep over 144.
 *   G3  EXACT-ZERO TERMINATION is the reclamation rule. A departing overlay
 *       walks t to exactly 0 in bounded ticks and the entry is DELETED.
 *
 * ── WHAT THIS MODULE IS, AND WHAT IT REFUSES TO BE ───────────────────────
 *
 * Pure arithmetic. Every operation is `(registry, event) → registry`; nothing
 * here holds state, reads a clock, or counts a tick. The PAGE owns the state and
 * owns the timer; this module owns the numbers, which is why the whole of the
 * easing can be driven from a test with no DOM, no `requestAnimationFrame` and
 * no elapsed time — and is, exhaustively, in `test/morph.test.ts`.
 *
 * Ticks are COUNTED, never sampled. A dropped frame stretches the cadence; it
 * never skips a rung, because a rung is an index into a table and not a function
 * of `performance.now()`. That is the whole reason the ladder is a table.
 *
 * ── NO DIVISION, AND NO `Math.` — THE SAME DISCIPLINE `curvature.ts` KEEPS ──
 *
 * The composed dial is an exact rational and it is carried as one: a numerator
 * and a denominator, both integers, never divided. `test/morph.test.ts` reads
 * this file's own source and asserts it, exactly as `test/curvature.test.ts`
 * does for the module below it.
 *
 * The one place division would have crept in is §12.1's PROPORTIONAL CLAMP, and
 * it is worth stating what happened there because the brief expected a different
 * answer. When Σt would exceed 1 the clamp zeroes the base weight and rescales
 * the overlays by 1/Σt, preserving their ratios exactly. On integers over a
 * FIXED denominator that rescaling does not exist — `Σ tᵢ·targetᵢ / Σ tᵢ` is not
 * an integer over 144, or over any other constant. So the clamp is landed by
 * moving the DENOMINATOR instead of the numerators:
 *
 *   > unclamped: weights (144 − Σw, w₁ … wₙ) over den = 144
 *   > clamped:   weights (0,       w₁ … wₙ) over den = Σw
 *
 * In both cases the weights sum to EXACTLY `den`, which is "the weights sum to
 * exactly 1" with the fraction cleared, and in the clamped case the overlay
 * numerators are UNTOUCHED, so their ratios are preserved not approximately but
 * literally. The cost is that the dial's denominator is no longer a constant,
 * which is why `curvature.CurvatureField` carries its own `scale` from this
 * increment on.
 *
 * ── AND THE CLAMP IS UNREACHABLE FROM THIS DIAL ──────────────────────────
 *
 * Measured after building it, and it is a fact about the ladder rather than
 * about the driver's speed [PROVEN, `test/morph.test.ts`]:
 *
 *   1. At most ONE overlay is ever rising — `retarget` makes every other one
 *      departing in the same breath.
 *   2. A tick moves the rising one up by 1 and every departing one down by 1, so
 *      Σ steps changes by `1 − (number departing)` and never increases past the
 *      rising overlay's own step. Starting from an empty registry, **Σ steps ≤ 12
 *      at every reachable state**.
 *   3. Over the finite domain "multisets of steps summing to at most 12" — which
 *      is enumerable, and is enumerated — `Σ stop(sᵢ) ≤ 144` always, with
 *      equality exactly on the mirror pairs `stop(a) + stop(12 − a) = 144`.
 *
 * So `Σw ≤ 144` on every state the dial can reach and the clamp never fires in
 * the app. It is implemented anyway, and tested by driving the registry directly
 * past what the driver can build, because a normalisation rule that is only
 * correct on the states one control happens to produce is not a normalisation
 * rule.
 */

import { MAX_FLOW, type Flow, type MicroDial } from "./curvature";

// ═════════════════════════════════════════════════════════════════════════
// THE GUARD — `curvature.ts`'s, restated
// ═════════════════════════════════════════════════════════════════════════

function exact(x: number): number {
  if (!Number.isSafeInteger(x)) {
    throw new Error(`morph: exact integer range exceeded (${x})`);
  }
  return x;
}

function checkDial(dial: number): Flow {
  if (!Number.isSafeInteger(dial) || dial < 0 || dial > MAX_FLOW) {
    throw new Error(
      `morph: dial ${dial} is not an integer in 0…${MAX_FLOW} (144ths)`
    );
  }
  return dial;
}

// ═════════════════════════════════════════════════════════════════════════
// THE LADDER — G2, derived rather than tabulated
// ═════════════════════════════════════════════════════════════════════════

/**
 * The rising half of the dozenal smoothstep's increments, and the ONLY numbers
 * in this module that are written down.
 *
 * An arithmetic progression of difference 4 — the discrete derivative of a
 * quadratic, which is what makes the ladder piecewise-quadratic rather than
 * merely monotone. Everything else about the ladder is computed from these six.
 */
const RISE: readonly number[] = [2, 6, 10, 14, 18, 22];

/** The twelve increments: `RISE`, then `RISE` mirrored. */
export const LADDER_INCREMENTS: readonly number[] = [
  ...RISE,
  ...[...RISE].reverse(),
];

/**
 * The thirteen stops, cumulative — `[0, 2, 8, 18, 32, 50, 72, 94, 112, 126,
 * 136, 142, 144]`, integers over denominator 144 and never floats.
 *
 * DERIVED from the increments, so the table cannot drift from the definition it
 * is a memo for; the test checks it three further ways that the derivation
 * cannot make true by construction — the sum is exactly 144, the endpoints are
 * exactly 0 and 144, and the closed form `stop(s) = 2s²` holds on the rising
 * half with the falling half its exact mirror.
 */
export const LADDER_STOPS: readonly number[] = (() => {
  const out: number[] = [0];
  let acc = 0;
  for (const d of LADDER_INCREMENTS) {
    acc += d;
    out.push(exact(acc));
  }
  return out;
})();

/** Twelve ticks, thirteen stops. §12.1's own bound on a departure. */
export const LADDER_TICKS = LADDER_INCREMENTS.length;

/**
 * The ladder's denominator — the last stop, and therefore 144.
 *
 * `curvature.REFINE` by IDENTITY rather than by coincidence: G2 names the
 * dozenal smoothstep's 144 and increment 2 adopted it as the dial's denominator
 * for exactly that reason, so the ease needs no second denominator and no
 * conversion between two of them. Derived here and tied to `REFINE` in the test
 * rather than imported, so the tie is an assertion someone can see fail instead
 * of a dependency that hides it.
 */
export const LADDER_DEN = LADDER_STOPS[LADDER_TICKS];

/** The weight at a rung, exact, in 144ths. Range-checked: a rung is an index. */
export function stopAt(step: number): number {
  if (!Number.isSafeInteger(step) || step < 0 || step > LADDER_TICKS) {
    throw new Error(
      `morph: step ${step} is not a rung of the ladder (0…${LADDER_TICKS})`
    );
  }
  return LADDER_STOPS[step];
}

/**
 * THE LADDER A FLOAT IMPLEMENTATION WRITES, KEPT AS A COUNTEREXAMPLE.
 *
 * `Math.round(144 · (3u² − 2u³))` at `u = s/12` — the cubic Hermite smoothstep,
 * sampled and rounded to the nearest 144th, which is what an implementation that
 * had not read G2 reaches for, since `3t² − 2t³` is *the* smoothstep everyone
 * knows and 144 is right there in the spec.
 *
 * Stated as DATA rather than computed, so this module keeps its no-`Math.`
 * discipline; `test/morph.test.ts` recomputes it with `Math` and asserts the
 * table is exactly what the floats give, so the counterexample is the real thing
 * and not a straw man. Exported ONLY for that test, exactly as
 * `curvature.V4_FULL_COBOUNDARY` and `hexagon.mutantRotMap` are.
 *
 * ── WHAT IT COSTS, AND WHY THE OBVIOUS TESTS DO NOT CATCH IT ────────────
 *
 * Its endpoints are exactly 0 and 144. Its increments sum to exactly 144 (they
 * telescope, so they cannot do otherwise). It is strictly monotone. It arrives
 * on the target exactly. **Every headline property of G2 passes**, which is the
 * point of keeping it.
 *
 * What fails is the MIRROR: `3(s/12)² − 2(s/12)³ = (18s² − s³)/864`, so at
 * s = 3 and s = 9 the value in 144ths is 22½ and 121½ — half-integers, which is
 * fold-re's own reason for shipping the Hermite over 864 instead of rounding it
 * in. Round-half-up sends them to 23 and 122, and `23 + 122 = 145`. The ease-in
 * and the ease-out are then different curves, which is a defect a reader sees
 * and no endpoint test does.
 */
export const MUTANT_ROUNDED_HERMITE: readonly number[] = [
  0, 3, 11, 23, 37, 54, 72, 90, 107, 122, 133, 141, 144,
];

// ═════════════════════════════════════════════════════════════════════════
// THE REGISTRY — G1, sparse and pure
// ═════════════════════════════════════════════════════════════════════════

/**
 * One transition in flight. `t = LADDER_STOPS[step] / 144`, never computed.
 *
 * `rising` is the direction, and it is the whole of §12.1's asymmetry: a new
 * target is BORN at step 0 and walks up; a superseded one keeps the step it had
 * and walks down, reaching exactly 0 in exactly that many ticks — which is the
 * bounded-termination claim, with the bound being the starting step rather than
 * a constant.
 */
export interface Overlay {
  readonly target: Flow;
  readonly step: number;
  readonly rising: boolean;
}

/**
 * The live value and the overlays over it.
 *
 * `base` is the SETTLED dial and is the page's `flow`: when `overlays` is empty
 * the state is exactly increment 2's state, which is how "rest is the un-eased
 * path" is made structural rather than checked.
 *
 * INVARIANT, maintained by every operation here: no overlay's target equals
 * `base`, because `base` changes only when the registry empties.
 */
export interface Morph {
  readonly base: Flow;
  readonly overlays: readonly Overlay[];
}

/** A settled dial: no overlays, nothing in flight, increment 2's own state. */
export const restMorph = (dial: Flow): Morph => ({
  base: checkDial(dial),
  overlays: [],
});

/** Is a transition in flight? The page's branch between the two builders. */
export const isEasing = (m: Morph): boolean => m.overlays.length > 0;

/**
 * The dial the USER last asked for — the rising overlay's target, or the base.
 *
 * The slider reads this rather than `base`, because a thumb that snapped back to
 * the settled value while the picture eased towards the asked-for one would be a
 * control fighting its own animation.
 */
export function morphTarget(m: Morph): Flow {
  for (const o of m.overlays) if (o.rising) return o.target;
  return m.base;
}

/**
 * The composed weights, as integers over a common denominator.
 *
 * `base + Σ overlays === den` EXACTLY, in both branches — §12.1's "the weights
 * sum to exactly 1" with the fraction cleared. See the header for why the clamp
 * moves the denominator instead of the numerators.
 */
export interface MorphWeights {
  readonly base: number;
  readonly overlays: readonly number[];
  readonly den: number;
  /** Did the proportional clamp fire? Unreachable from the dial; see header. */
  readonly clamped: boolean;
}

export function weightsOf(m: Morph): MorphWeights {
  const overlays = m.overlays.map((o) => stopAt(o.step));
  let sum = 0;
  for (const w of overlays) sum = exact(sum + w);
  return sum > LADDER_DEN
    ? { base: 0, overlays, den: sum, clamped: true }
    : { base: LADDER_DEN - sum, overlays, den: LADDER_DEN, clamped: false };
}

/**
 * THE COMPOSED DIAL, exact: `num/den` in 144ths of the apex.
 *
 *   `num = base·(144 − Σw) + Σ targetᵢ·wᵢ`,  `den = 144`
 *
 * an exact integer, and with no overlays it is `144·base` — the identity the
 * static path is recovered through.
 *
 * THE BOUND IS A GUARD AND NOT A HOPE. Every value composed here is a convex
 * combination of dials in 0…MAX_FLOW with weights summing to `den`, so
 * `num ≤ den·MAX_FLOW` is forced — and `curvature.buildEasedCurvature` refuses
 * anything above it, so the containment `docs/warp-findings.md` Q3 measured
 * holds at every intermediate tick and not only at the two ends.
 */
export function effectiveDial(m: Morph): MicroDial {
  const w = weightsOf(m);
  let num = exact(m.base * w.base);
  m.overlays.forEach((o, i) => {
    num = exact(num + o.target * w.overlays[i]);
  });
  if (num < 0 || num > exact(w.den * MAX_FLOW)) {
    throw new Error(
      `morph: composed dial ${num}/${w.den} leaves 0…${MAX_FLOW} (144ths)`
    );
  }
  return { num, den: w.den };
}

// ═════════════════════════════════════════════════════════════════════════
// THE EVENTS — three, and all of them total
// ═════════════════════════════════════════════════════════════════════════

/**
 * RETARGET. The dial was moved; the picture starts going there.
 *
 * §12.1's semantics, on one value:
 *
 *   - every overlay in flight becomes DEPARTING, keeping the step it had, so it
 *     walks down to exactly 0 and is reclaimed;
 *   - an overlay already at step 0 is deleted OUTRIGHT rather than kept to be
 *     deleted next tick — G3's reclamation rule is about the value being exactly
 *     zero, and it already is;
 *   - the new target ARRIVES from step 0 — unless an overlay already carries it,
 *     which is revived in place rather than duplicated (a drag that returns to a
 *     value it has just left should not pay twice for it);
 *   - and if the new target IS the base, nothing is installed at all. The
 *     departures alone carry the value home, which is what makes a return to
 *     zero land on `base = 0` with an empty registry — L3's identity, structural.
 */
export function retarget(m: Morph, next: Flow): Morph {
  checkDial(next);
  if (m.overlays.length === 0 && m.base === next) return m;
  const departing = m.overlays
    .filter((o) => o.step > 0)
    .map((o) => (o.rising ? { ...o, rising: false } : o));
  if (next === m.base) return { base: m.base, overlays: departing };
  const at = departing.findIndex((o) => o.target === next);
  if (at >= 0) {
    return {
      base: m.base,
      overlays: departing.map((o, i) => (i === at ? { ...o, rising: true } : o)),
    };
  }
  return {
    base: m.base,
    overlays: [...departing, { target: next, step: 0, rising: true }],
  };
}

/**
 * ONE TICK. One rung, for everything in flight.
 *
 * Arrival is ABSORPTION and it is the point of the whole increment: when the
 * only overlay left is the rising one and it has reached the top of the ladder,
 * its weight is 144 and the base's is 0, so the composed dial is already exactly
 * `144·target` — and the registry is emptied and `base` set to that target. The
 * next render therefore goes through `buildCurvature`, the static path, and the
 * arrival is bit-identical to the un-eased render of the target state because it
 * IS the un-eased render of the target state.
 *
 * A rising overlay that reaches the top while others are still departing WAITS
 * there. It cannot absorb — the composed value is not yet the target — and
 * holding it costs nothing, since the departures are bounded by their own steps.
 */
export function tick(m: Morph): Morph {
  if (m.overlays.length === 0) return m;
  const next: Overlay[] = [];
  for (const o of m.overlays) {
    if (o.rising) {
      next.push(o.step === LADDER_TICKS ? o : { ...o, step: o.step + 1 });
    } else if (o.step > 1) {
      next.push({ ...o, step: o.step - 1 });
    }
    // step 1 departing → step 0 → EXACTLY zero → deleted, never stored. G3.
  }
  if (next.length === 1 && next[0].rising && next[0].step === LADDER_TICKS) {
    return { base: next[0].target, overlays: [] };
  }
  return { base: m.base, overlays: next };
}

/**
 * SETTLE. Land on a dial NOW, with no travel — and the registry is emptied.
 *
 * Two callers, both with a reason that is about correctness rather than speed:
 *
 *   `prefers-reduced-motion` — the reader has asked not to be moved, and here
 *   the destination drawing is identical either way, so instant landing denies
 *   them nothing. (`easeTo` makes the same call for the drill-in travel.)
 *
 *   RELIEF ON — the relief and the curve do not compose at ANY amplitude (a
 *   control point is not a lattice vertex), so a graceful ease-out would be a
 *   sequence of frames in which they compose. The exclusion is at the source, so
 *   the cancellation is instant.
 */
export const settle = (m: Morph, dial: Flow): Morph =>
  m.overlays.length === 0 && m.base === dial ? m : restMorph(dial);
