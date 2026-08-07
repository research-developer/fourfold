# Ring-LNS ↔ fourfold: does their substrate fit our geometry?

**Verdict: ADAPT.** The spine fits and the assignment in the brief is right. Three
of their nine operations solve a problem fourfold's descent does not have, one of
those three is actively wrong for us, and one operation fourfold needs has no
counterpart at all. Their encoding already dissolves the norm-width wall §R found
— but the code they ship does not use it.

Labels follow the house convention: **[PROVEN]** exhaustive computation against an
independent oracle; **[MEASURED]** a number this run produced; **[DERIVED]**
follows from a PROVEN fact by an argument stated here; **[CONJECTURED]** not
decided here; **[ANALOGY]** structural resemblance, not a proof.

**Their code was not modified and not ported.** Everything below either runs their
functions from outside their tree or cites them. The one thing rebuilt on our side
is a float-free replacement for a float loop predicate, and it is marked.

---

## 1. Their verification reproduces. Exit 0. One recorded number does not survive scrutiny.

`python3 verify_ring_lns.py` in
`rationall-dev/demos/geometric-world-model/ring_lns/` — **exit 0**, 34.4 s
[MEASURED]. Their tree stays clean: the log it writes is `*.log`, gitignored at
`.gitignore:80`, and `git status` reports nothing.

All eight summary ops exact on **both** rings against the sympy surd oracle —
`split_law`, `round_trip`, `mul`, `add_same_scale`, `add_exact`, `normalize`,
`unit_pow`, `reconstruct` [reproduced]. The splitting law matches an independent
quadratic-residue test on all 16 primes, both rings.

`unit_pow` reproduces exactly: ε^16384 at k = 14, norm +1 at every step, dut ≡
oracle, channels fixed-width [reproduced].

> **Read `unit_pow`'s fixed-width claim correctly.** The lanes checked at
> `verify_ring_lns.py:337` belong to `unit_pow(...)`, whose mantissa is literally
> `(1, 0)`. They are fixed-width because the value is a pure unit parked on the
> exponent axis — which is exactly what the design is *for*, and is the honest
> reading. It is **not** evidence that the channels hold a wide mantissa narrowly.
> The 31129-bit coordinate at k = 14 is `unit_pow_materialised`'s integer pair,
> which never enters a channel. [MEASURED]

### ★ The recorded 1.892 is a seed artifact, not a constant

Their script is seeded (`random.Random(0x5BADC0DE)`, line 403), so **1.892
reproduces exactly from their script** — but it is not a stable estimate of the
quantity it is cited as. Re-running the same estimator with a different seed gives
**1.861** [MEASURED].

The estimator is a least-squares fit of *max-over-trials* mantissa bit-length
against gap, over gap 0..20 only. Max-over-trials of a bit-length is a noisy,
low-biased statistic, and the range is short. Both 1.892 and 1.861 sit below the
true value.

**Recommendation:** the README cites 1.892 as an artifact. It should cite the
*law* — log₂(2+√3) = 1.899969 — and quote the sample as a sample. §2 confirms the
law to five decimals.

---

## 2. Two independent measurements of log₂(2+√3). They agree.

| source | method | result |
|---|---|---|
| **reference** | log₂(2+√3) | **1.899969** |
| rationall (theirs, as recorded) | add_exact fit, gap 0..20, seed `0x5BADC0DE` | 1.892 |
| rationall (theirs, reseeded) | same estimator, different seed | 1.861 |
| **rationall (ring-aligned, mine)** | `eps_pow` + `mul`, gap 0..600 | **1.899990** |
| **rationall (mine)** | bits(ε^k), k 0..2000 | **1.899997** |
| **fourfold (§R)** | bits(ε̄^k): nine +2s then a +1, period 10 | **19/10 = 1.9** |

**[PROVEN] The two repos measured the same constant.** fourfold's 19-bits-per-10
and rationall's width-growth slope are both log₂(2+√3), and they were arrived at
through completely different objects — fourfold by counting bit increments of
ε̄^k in TypeScript, rationall by regressing CRT-reconstructed mantissa widths of
cross-scale sums in Python against a sympy oracle.

Convergence is monotone in the fitting range, which is what identifies the short
range as the source of their low bias [MEASURED]:

```
ring-aligned fit, gap 0..20  = 1.918182     bits(eps^k), k 0..28   = 1.888670
ring-aligned fit, gap 0..60  = 1.901639     bits(eps^k), k 0..60   = 1.897197
ring-aligned fit, gap 0..200 = 1.900260     bits(eps^k), k 0..200  = 1.899735
ring-aligned fit, gap 0..600 = 1.899990     bits(eps^k), k 0..2000 = 1.899997
```

**One correction to fourfold's own §R** [MEASURED]. The increment pattern is
`[1,1,2,2,2,2,2,2,2,1 | 2,2,2,2,2,2,2,2,2,1 | …]`. The steady-state decade is
nine +2s and one +1 = **19**, as `warp-findings.md` says. The **first** decade
sums to **17**, because ε^0 and ε^1 are both tiny. The law is right; it is
asymptotic, not exact from k = 1.

**A second correction, pre-existing.** `docs/warp-findings.md:201` states
`safeIntegerDepth(ε̄) = 29`. The shipped tests assert **28** at both
`test/warp.test.ts:1045` and `:1142`, and 28 is what the function returns. The
doc is off by one.

---

## 3. The axis question: `2^a·3^b` fits — in the mantissa, and nowhere else.

**The brief's conjecture is CONFIRMED, and it is stronger than stated.** Putting a
descent scale on their exponent axis is not merely costly. It is impossible.

### 3.1 The separation is a norm fact, not a matter of degree [PROVEN]

Their exponent axis is ⟨ε⟩, the unit group. A unit has norm ±1. A descent scale is
`2^a·3^b`, and N(2^a·3^b) = (2^a·3^b)² — which is ±1 only at a = b = 0.

```
2^1*3^0 = 2      N = 4          unit=False
2^0*3^1 = 3      N = 9          unit=False
2^5*3^0 = 32     N = 1024       unit=False
2^0*3^5 = 243    N = 59049      unit=False
```

`{k ∈ [−64, 64] : ε^k = 2}` is **empty**, and no power of ε is ever a rational
integer at all (the √3 coordinate never vanishes) [PROVEN, k = 1..28 in
`test/warp.test.ts`; k = 1..64 against their `eps_pow`]. `log_ε 2 = 0.526324` is
irrational, so no integer exponent can ever name a scale.

**2 is not a power of ε, and the two exponent axes are not the same axis.**

### 3.2 It fits the mantissa with room to spare [MEASURED]

Their default ℤ[√3] channel set (16 primes, 5..61) gives a CRT modulus of **75
bits**, signed window ±2^74.

| scale | bits | fits |
|---|---|---|
| 32 — rep-4 at `MAX_DEPTH` | 6 | yes |
| 243 — rep-9 at depth 5 | 8 | yes |
| 2^20·3^20 | 52 | yes |

The whole shipped scale axis is **3 lanes × 3 bits**, against a 75-bit window.
There is no width pressure on the scale, exactly as the brief says.

The mantissa is a *ring* element and a scale is a *rational* integer, so the √3
coordinate sits idle. That is not waste: §R is precisely where √3 enters (the
FlowAngle apex), and warp.ts deliberately factors √3 out of the descent so the
lattice work stays rational. **Descent → rational lane; curvature → √3 lane and
the exponent.** The two-coordinate mantissa is the right shape for both.

### 3.3 Forcing it onto the ε axis roughly doubles the width [PROVEN]

Their `normalize` will happily pull ε^k out of a rational integer. The magnitude
lands in [1, |ε|) as promised. The **width** does not — measured by running their
`normalize` directly:

| scale | mantissa in | bits | mantissa out | bits | exp |
|---|---|---|---|---|---|
| 4 | (4, 0) | 3 | (8, −4) | 4 | 1 |
| 32 | (32, 0) | 6 | (224, −128) | **8** | 2 |
| 243 | (243, 0) | 8 | (23571, −13608) | **15** | 4 |
| 7776 | (7776, 0) | 13 | (10505376, −6065280) | **24** | 6 |
| 60466176 | (60466176, 0) | 26 | (823759860344832, −475597977117696) | **50** | 13 |

Because ε̄^k = A_k − B_k√3 with A_k, B_k growing at 1.9 bits/level, and normalize
picks k ≈ bits(v)/1.9:

> bits(v·ε̄^k) ≈ bits(v) + 1.9k ≈ **2·bits(v)** [DERIVED, confirmed by the table]

and a one-coordinate rational integer becomes a two-coordinate ring element. The
value is preserved — this is a rewriting, not a rounding — but every column gets
worse. `epsAxisCost` in `warp.ts` reproduces the table to the coordinate.

### 3.4 The proposed form composes cleanly [PROVEN]

`value = (2^a·3^b) · ε^j` — scale in the mantissa, curvature on the exponent.
Their `mul` multiplies mantissas and adds exponents, so the axes compose
independently and neither leaks:

```
X = 72·ε^-7 ,  Y = 12·ε^-5   →   X.mul(Y) = 864·ε^-12
mantissa (864, 0) = 2^5·3^3 — still a rational integer, √3 lane still idle
```

Checked over a = 0..5, b = 0..4, j = −6..6 in `test/warp.test.ts`: the product's
√3 coordinate is zero in every case and the two-axis value equals the ring product
of the two values. **The fit is clean, as the brief predicted.**

### 3.5 ★ Where the brief needs qualifying: comparison, not composition

**This is the one place the hypothesis is wrong, and it is worth the correction.**

The brief says the scale "fits in the mantissa and needs no exponent axis." That
is right for **multiplication**. It is wrong for the operation `scale.ts` actually
exports as its resolution primitive:

```ts
export const refines = (coarse: number, fine: number): boolean => fine % coarse === 0;
```

`refines` is **divisibility**, and divisibility is the single thing an RNS
mantissa is worst at — it needs the integer back, i.e. a full CRT out of the
channels, for a question that is supposed to be a cheap comparison in the middle
of a descent.

Carried as the **exponent pair** (a, b) over {2, 3}, the same test is componentwise
≤: two integer comparisons, no reconstruction.

> **[PROVEN]** `smoothRefines((a,b), (a',b')) ≡ refines(2^a·3^b, 2^a'·3^b')` on
> all **6561** 3-smooth pairs with a, b ≤ 8 — exhaustive over that square,
> including the incomparable case `scale.ts` exists to admit: 18 = (1,2) and
> 27 = (0,3) refine each other in neither direction.

So the scale wants **two forms**, and which one is right depends on the operation:

| operation | right form | cost |
|---|---|---|
| compose a descent | mantissa (RNS) | one per-channel multiply, carry-free |
| refine-comparison | exponent pair (a, b) | two integer comparisons |

**That is a third axis** — or rather two more exponent axes, over the primes 2 and
3, alongside ε. The brief's "the scale needs no exponent axis" is refuted for
comparison, confirmed for composition. `smoothScaleOf`/`smoothRefines`/
`smoothCompose` in `warp.ts` are the instrument, and the exponent pair tracks
`scaleOfWord` digit for digit along real addresses [PROVEN].

---

## 4. Op-by-op: what fourfold's descent needs, and what they have

| fourfold needs | their op | verdict |
|---|---|---|
| **compose** — 3×3 integer matrix product (`composeWeights`) | `mul` + `add_same_scale`, per entry | **COVERED as primitives.** 27 muls + 18 adds per level, all per-channel and carry-free. The matrix layer is ours and should stay ours. |
| **scale multiply** by k ∈ {2,3} | `mul` | **COVERED**, mantissa-only, exp untouched. |
| **exact divide** by k — prefix resolution upward | — | **MISSING, but constructible.** 2 and 3 are *ramified* for √3 (disc 12) and deliberately excluded from their channel set, so both are coprime to every modulus. Per-channel modular inverse gives exact division whenever the quotient is integral — which a prefix walk always knows. ~10 lines, no new theory. |
| **refines** — divisibility | — | **MISSING and MISPLACED.** See §3.5: belongs on an exponent pair, not in the mantissa. |
| **containment sign** — `rSign(qOrient2(…))` | — | **MISSING in-channel.** Sign detection in RNS requires the balanced representative, i.e. their `_crt_pair`. They pay this boundary in `normalize` and `add_bucketed`, both of which call `mantissa_ring()` then `to_float`. **fourfold cannot adopt those two as written** — see §4.1. |
| **curvature compose** ε̄^k (§R) | `mul` (exp add), `unit_pow` | **COVERED, and this is the strongest fit in the whole comparison.** Exactly the axis their design is built for. |
| **norm / Galois check** | `Ring.norm` | present, but computed outside the channels. See §5. |
| — | `add_exact` | **NOT NEEDED.** fourfold's descent performs no cross-scale ring addition. |
| — | `normalize` | **ACTIVELY WRONG for fourfold.** It is precisely the operation that moves a scale onto the axis §3.3 shows it must not go on. |
| — | `add_bucketed` | **UNUSABLE.** 25.2–35.7 % mean rounding on ℤ[√3] [reproduced]. fourfold's containment test is an exact sign; a 30 %-lossy add cannot appear anywhere near it. (Correctly *not* counted among their eight exact ops.) |

**Score: two of fourfold's five descent needs are covered outright, one is
constructible from what they have, and two have no counterpart.** Their three
cross-scale-addition ops answer a question the descent does not ask.

### 4.1 A float-discipline incompatibility, and a fix

Their `normalize` loop predicate is `abs(ring.to_float(m)) >= eps_mag`, and
`add_bucketed` picks its bucket with `round(math.log(abs(mag), eps_mag))`. Both are
documented as *"a decision, never fed back into the pipeline"*, which is a
defensible discipline — but it is **not fourfold's**. `src/lib/warp.ts` contains no
`Math.` call on a pipeline value and no float coordinate anywhere.

Adopting their `normalize` as written would introduce a float decision into the
one module that has none.

**It is not necessary.** The same decision is exactly decidable on ℤ: for a
positive rational integer v and ε^k = A + B√3 with A, B > 0,

> A + B√3 ≤ v ⟺ v − A ≥ 0 **and** 3B² ≤ (v − A)²

`epsAxisDepth` in `warp.ts` implements that and reproduces their `normalize`'s
chosen k on every row of §3.3's table [PROVEN]. **Offered back to them** as a
float-free replacement for the loop predicate.

---

## 5. ★ The norm-width wall: their code hits it. Their *encoding* does not.

§R found the norm needs 2·W where the product needs W — the check is wider than
the thing it checks, giving out at k = 14 against the product's k = 28.

### Their shipped check is outside the channels [MEASURED]

`verify_ring_lns.py:322` computes `ring.norm(z)` on the **materialised integer
pair** from `unit_pow_materialised`. That is schoolbook `a² − 3b²` on a full-width
element:

| k | coordinate bits | schoolbook a² bits |
|---|---|---|
| 8 | 486 | 971 |
| 12 | 7 782 | 15 563 |
| **14** | **31 129** | **62 257** |

Exactly fourfold's 2W wall, paid in Python bigint instead of hitting a guard.

### But their encoding solves it, and the fix is ~15 lines of theirs [PROVEN]

The norm is computable **per channel**, at fixed width, from the lane alone:

- **split** — the two lanes are x under the two embeddings, and the Galois
  conjugate swaps them, so `N ≡ lane0 · lane1 (mod p)`.
- **inert** — the lane is (a, b) = x mod p in basis {1, g}, so `N ≡ a² − 3b² (mod p)`.

Then CRT the residues with their own `_crt_pair`. Run against their code, using
only `channel_encode` and `_crt_pair`:

| k | coordinate bits | in-channel N | widest intermediate | agrees with `ring.norm` |
|---|---|---|---|---|
| 0 | 2 | +1 | 10 bits | ✓ |
| 8 | 486 | +1 | 12 bits | ✓ |
| 12 | 7 782 | +1 | 13 bits | ✓ |
| **14** | **31 129** | **+1** | **13 bits** | ✓ |

**In-channel norm ≡ ring norm for k = 0..14. The widest intermediate is bounded by
p² ≤ 3721 (12 bits) and is INDEPENDENT of k** — 13 bits where the schoolbook path
needs 62 257.

### Why it works, and it is the general lesson

```
|coord(ε^16384)| needs 31129 bits — the 75-bit CRT window cannot hold the ELEMENT.
        N(ε^16384) = 1          —  1 bit, so the NORM fits with 74 bits to spare.
```

> **[DERIVED] RNS pays the width of the ANSWER, not the width of the
> intermediate.** The norm of a unit is ±1 at every power, however wide the
> element. The 2W blow-up is a property of schoolbook `a² − 3b²`, not of the norm.
> Any residue arithmetic whose output is bounded computes it at output width.

fourfold's finding stands as stated — it is a true fact about schoolbook
arithmetic, and `test/warp.test.ts` now establishes the asymmetry it rests on
(ε̄^28: 53-bit coordinates, 106-bit schoolbook square, 1-bit answer). **But the
conclusion "the norm forces 2W lanes" does not survive contact with RNS.** It
forces 2W only if you compute it schoolbook.

**They have not noticed this.** Their design contains the solution and their
verification does not use it.

---

## 6. Verdict — **ADAPT**, and the first honest increment

### Adopt

1. **The two-axis spine**, with the brief's assignment: **scale in the mantissa,
   ε-exponent reserved for curvature.** Confirmed by norm (§3.1), by width (§3.3),
   and by composition (§3.4).
2. **The in-channel norm** (§5). This is the highest-value item in the comparison
   and it is on *their* side of the fence.

### Adapt

3. **Add a scale-exponent pair** (a, b) over {2, 3} for refinement comparison
   (§3.5). Composition stays in the mantissa; comparison moves off it.
4. **Replace the float loop predicate** in `normalize` with the exact integer
   comparison (§4.1), if `normalize` is kept at all.

### Leave alone

5. **`add_exact`, `add_bucketed`, `normalize`.** They solve cross-scale ring
   addition, which fourfold's descent does not do. `add_bucketed` is 25–36 %
   lossy on ℤ[√3] and can never touch an exact containment test. `normalize` moves
   the scale onto the wrong axis by construction.
6. **Their ℤ[φ] work.** φ is the better ring on *their* axis (0.656 vs 1.892
   bits/Δexp, 2.9× narrower) — but fourfold's geometry is ℤ[√3]: `hexagon.ts`'s
   basis is √3/2 and §R's apex is ε̄ = tan(π/12). **[PROVEN, §R]** √5 ∉ ℚ(√3), so
   ℤ[φ] is not reachable from our carrier without a bigger tower. Their φ result is
   not portable to us and should not be cited as if it were. [ANALOGY only]

### The first honest increment

**On their side, and it is small:** add `norm_in_channels(channels, lanes)` to
`ring_lns.py` — the two-line split/inert formula above plus their existing
`_crt_pair` — and assert in `verify_ring_lns.py` that it equals `ring.norm(z)` for
k = 0..14 with a bounded intermediate. That converts §5's measurement into a
checked-in claim in the repo that owns it, and it retires the one place their
verification quietly does schoolbook arithmetic on a 31 129-bit number.

**On fourfold's side: nothing yet, and that is the honest answer.** The scale axis
is 3 lanes × 3 bits across the entire shipped range (§3.2). There is no width
pressure to relieve, so adopting an RNS mantissa today would buy nothing and cost a
dependency. The increment that *would* justify it is carrying curvature per cell —
§R's ε̄^k at k ≈ 28 — because that is the only measured place in fourfold where
width actually grows. **Until curvature ships, this is a design decision recorded,
not a change to make.** [CONJECTURED: that ε̄^k per-cell is where the substrate
starts paying for itself. Not decided here.]

---

## Reproduction

```bash
# theirs, unmodified, from their directory
cd rationall-dev/demos/geometric-world-model/ring_lns && python3 verify_ring_lns.py   # exit 0

# ours
cd fourfold && npx vitest run test/warp.test.ts     # 37 tests, §L is the last 6
```

§L of `test/warp.test.ts` locks every fourfold-side claim above. The
rationall-side measurements (§1's reseed, §2's wide-range fits, §3.3's normalize
table, §5's in-channel norm) were produced by a probe that imports their module
read-only and duplicates none of their arithmetic.
