/**
 * REP-9 — the second radix, decided rather than asserted.
 *
 * This file is a verdict in the shape `test/reptile.test.ts` uses and MATH-76
 * before it: exhaustive counts, an oracle that shares no code with the thing
 * under test, and a guard-fire mutation for every gate that claims something. A
 * property asserted without a lethal mutation is not verified, and every number
 * printed in the report was printed by a test here.
 *
 * ── THE ORACLE, and why it is not this codebase ──────────────────────────
 *
 * `src/lib/reptile.ts` builds the same aligned subdivision from barycentric grid
 * points with the radix as a parameter, and decides containment by exact
 * cross-multiplied integer half-plane inequalities written against vertex arrays
 * only. Nothing in `src/` imports it, and `src/lib/figure.ts` RE-DERIVES the
 * rep-9 cut in its own idiom rather than calling it. So when the two agree, that
 * is descent agreeing with geometry across an actual code boundary, which is the
 * whole content of the containment theorem. If `buildRep9Figure` and `reptile`
 * shared a subdivision the agreement would be a tautology.
 *
 * The letter ↔ oracle-index correspondence and the frame vector are themselves
 * DERIVED here, by matching triangles on exact keys — never declared — so a
 * slipped derivation cannot be papered over by a hand-written table.
 *
 * ── What is measured ─────────────────────────────────────────────────────
 *
 *   0. rep-4 is untouched: the paths this change ran through still answer as
 *      they did, and no rep-4 test in this repository was modified.
 *   1. the cut:      590,490 containment tests, 0 mismatches, 0 boundary hits,
 *                    and a one-lattice-unit displacement lethal to both gates.
 *   2. the alphabet: (vertex, grade), both read off the geometry.
 *   3. the charge:   44,280 D₃ tests, 0 mismatches; one letter moved between
 *                    grade classes fires 114 at depth 2 alone.
 *   4. the arms:     9 decompositions, exactly 1 D₃-stable, residual exactly 0,
 *                    and the ⟨m_A⟩ induced action.
 *   5. the law:      the rotation rewrites only the first digit, 729/729.
 *   6. the canvas:   six rep-9 sectors, 6·9^d keys, no collisions.
 *   7. the scale:    one address, one radix, one resolution.
 */
import { describe, expect, it } from "vitest";
import {
  AXES,
  GRADE_CLASSES,
  REP9_ALPHABET,
  REP9_BY_NAME,
  REP9_POSITIVE_CLASS,
  buildFigure,
  buildRep9Figure,
  rep9Charge,
  rep9PrefixCharge,
  type Axis,
  type IVec,
  type Rep9Figure,
} from "../src/lib/figure";
import {
  ARMS,
  armOfWord,
  clipStamp,
  rep9ArmCells,
  rep9ArmCensus,
  rep9ArmMask,
  rep9ArmOf,
  type Arm,
} from "../src/lib/arms";
import {
  HEX_ISOMETRIES,
  buildHexagon,
  buildRep9Hexagon,
  closedFormMap,
  indexMap,
  latKey,
  mutantRotMap,
} from "../src/lib/hexagon";
import {
  EDGE_DIVISION,
  REP9_EDGE_DIVISION,
  REP9_LETTERS,
  cellsAtScale,
  radixAt,
  refines,
  rep9ArmCellsAtScale,
  scaleOfDepth,
  scaleOfRep9Depth,
  scaleOfWord,
} from "../src/lib/scale";
import { ISOMETRIES, type IsometryName } from "../src/lib/conventions";
import {
  ROOT,
  S3,
  alphabet,
  centroid,
  childPermutation,
  containsCentroid,
  d3StableTransversals,
  descend,
  mirrorFixedSets,
  permCompose,
  rotationFrames,
  rotationOrbits,
  s3IndexOf,
  subdivide,
  subdivideFramed,
  triKey,
  type Tri,
} from "../src/lib/reptile";

// ── shared derivations ───────────────────────────────────────────────────

const ISOMETRY_NAMES: readonly IsometryName[] = [
  "id",
  "rot+",
  "rot-",
  "m_A",
  "m_B",
  "m_C",
];

/** A figure cell as an oracle triangle. The only thing the two sides share. */
const triOf = (bary: readonly [IVec, IVec, IVec], den: number): Tri => ({
  v: [bary[0], bary[1], bary[2]] as const,
  den,
});

/**
 * Where an isometry sends each rep-9 cell, decided by EXACT INTEGER KEYS.
 *
 * The same derivation `conventions.triangleIndexMap` performs for rep-4 —
 * permute the three barycentric slots of the centroid key and look the result up
 * — spelled here because that function is typed to `Figure` and this pass does
 * not own `conventions.ts`. `ISOMETRIES` itself is imported, so the six
 * permutations are the shipped ones and not a second opinion about them.
 *
 * Throws on a missing image, which would mean the rep-9 cell set is not
 * D₃-stable and every claim below is void.
 */
function rep9IndexMap(fig: Rep9Figure, name: IsometryName): number[] {
  const byKey = new Map(fig.cells.map((c) => [c.key.join(","), c.i]));
  const p = ISOMETRIES[name];
  return fig.cells.map((c) => {
    const j = byKey.get([c.key[p[0]], c.key[p[1]], c.key[p[2]]].join(","));
    if (j === undefined) {
      throw new Error(`rep9: ${name} does not permute the cells (${c.addr})`);
    }
    return j;
  });
}

/**
 * The correspondence between `figure.ts`'s nine letters and `reptile.ts`'s nine
 * indices, and the frame vector that reproduces the figure's addressing inside
 * the oracle.
 *
 * DERIVED by matching depth-1 triangles on canonical keys and then finding which
 * of the oracle child's three vertices the figure put in role 0. Nothing is
 * declared: if `figure.ts`'s cut had drifted from the aligned subdivision at all,
 * the key lookup below would fail rather than return a plausible mapping.
 */
const CORRESPONDENCE = (() => {
  const kids = subdivide(ROOT, 3);
  const byKey = new Map(kids.map((t, d) => [triKey(t, 3), d]));
  const fig = buildRep9Figure(1);
  /** figure letter index ↦ oracle letter index */
  const repOf = new Array<number>(9).fill(-1);
  /** oracle letter index ↦ frame, as an index into `reptile.S3` */
  const frames = new Array<number>(9).fill(-1);
  for (const c of fig.cells) {
    const d = byKey.get(triKey(triOf(c.bary, fig.scale), 3));
    if (d === undefined) throw new Error(`rep9: cell ${c.addr} is not an oracle child`);
    repOf[c.i] = d;
    const r = kids[d].v.findIndex(
      (p) => p[0] === c.bary[0][0] && p[1] === c.bary[0][1] && p[2] === c.bary[0][2]
    );
    if (r < 0) throw new Error(`rep9: cell ${c.addr}'s role-0 vertex is not a vertex`);
    // frame indices 0, 1, 2 in `reptile.S3` are id, rot+, rot− — the three
    // cyclic rotations — and a cyclic rotation by r is exactly what putting
    // natural vertex r into role 0 is.
    frames[d] = r;
  }
  const nameOf = new Map<number, string>(
    fig.cells.map((c) => [repOf[c.i], c.addr])
  );
  return { repOf, frames, nameOf };
})();

/** Every word of the uniform depth-d oracle figure, under a frame convention. */
function oracleLeaves(depth: number, frames: readonly number[] | null) {
  let cur = [{ word: [] as number[], tri: ROOT }];
  for (let d = 0; d < depth; d++) {
    const next: { word: number[]; tri: Tri }[] = [];
    for (const n of cur) {
      const kids = frames === null
        ? subdivide(n.tri, 3)
        : subdivideFramed(n.tri, 3, frames);
      kids.forEach((t, i) => next.push({ word: [...n.word, i], tri: t }));
    }
    cur = next;
  }
  return cur;
}

/** Grade and vertex per letter, as plain lookup tables for the sums below. */
const GRADE = new Map(REP9_ALPHABET.map((l) => [l.name as string, l.grade as number]));
const VERTEX = new Map(
  REP9_ALPHABET.map((l) => [l.name as string, AXES.indexOf(l.vertex)])
);
const digitSum = (table: ReadonlyMap<string, number>) => (word: string) =>
  [...word].reduce((a, ch) => (a + (table.get(ch) as number)) % 3, 0);

// ═════════════════════════════════════════════════════════════════════════
describe("0 — rep-4 is untouched", () => {
  /**
   * This change ADDS a radix. Every path it ran through — `radixAt`'s body,
   * `armOfWord`'s loop, `indexMap`'s parameter type — had a rep-4 answer before
   * and must have the same one after. The rep-4 suites are the real evidence and
   * none of them was modified; this is the belt to their braces, stated over the
   * three functions that were actually edited.
   */
  it("the two alphabets are disjoint, which is what makes the dispatch total", () => {
    expect(REP9_LETTERS.length).toBe(9);
    expect(new Set(REP9_LETTERS).size).toBe(9);
    for (const ch of "ABCX") expect(REP9_LETTERS.includes(ch)).toBe(false);
    // and nothing in a hexagon address's sector tag collides either
    for (const ch of "s012345:") expect(REP9_LETTERS.includes(ch)).toBe(false);
  });

  it("radixAt still answers EDGE_DIVISION on every character rep-4 can write", () => {
    const fig = buildFigure(4);
    for (const c of fig.cells) {
      for (let i = 0; i < c.addr.length; i++) {
        expect(radixAt(c.addr, i)).toBe(EDGE_DIVISION);
      }
      expect(scaleOfWord(c.addr)).toBe(scaleOfDepth(4));
    }
    // the hexagon's tagged form too: `s`, a digit and `:` are all rep-4 answers
    const hex = buildHexagon(2);
    for (const c of hex.cells) {
      const tagged = `s${c.sector}:${c.addr}`;
      for (let i = 0; i < tagged.length; i++) {
        expect(radixAt(tagged, i)).toBe(EDGE_DIVISION);
      }
      expect(scaleOfWord(c.addr)).toBe(scaleOfDepth(2));
    }
    // out of range, where `charAt` returns "" and a sloppy substring test says yes
    expect(radixAt("A", 5)).toBe(EDGE_DIVISION);
    expect(radixAt("", 0)).toBe(EDGE_DIVISION);
  });

  it("armOfWord answers the rep-4 question exactly as before", () => {
    const f = buildFigure(4);
    for (const c of f.cells) {
      const want = c.ftype === "" ? null : c.ftype;
      expect(armOfWord(c.addr)).toBe(want);
    }
    expect(armOfWord("ABX")).toBe("A");
    expect(armOfWord("XXB")).toBe("B");
    expect(armOfWord("XXXX")).toBeNull();
  });

  it("the widened indexMap returns the same rep-4 permutations", () => {
    const hex = buildHexagon(2);
    for (const g of HEX_ISOMETRIES) {
      expect(indexMap(hex, g)).toEqual(closedFormMap(hex, g));
    }
    // and the planted mutant is still caught, so the widening did not soften it
    expect(
      HEX_ISOMETRIES.some((g) => indexMap(hex, g).join() !== mutantRotMap(hex, g).join())
    ).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("1 — the cut, against the independent geometric oracle", () => {
  /**
   * ANCHOR. Before anything is claimed about the rep-9 figure it has to be shown
   * that its cut IS the aligned rep-9 subdivision, and not a lookalike. Compared
   * as POINT SETS at every depth, because the vertex ORDER differs by the frame
   * and that is not a geometric difference — and then compared ADDRESS FOR
   * ADDRESS under the frame the correspondence derived, which is the stronger
   * statement and the one the addressing rests on.
   */
  it("is the oracle's aligned rep-9 subdivision, as point sets and as addresses", () => {
    for (const depth of [1, 2, 3]) {
      const fig = buildRep9Figure(depth);
      const N = fig.scale;
      expect(N).toBe(3 ** depth);
      expect(fig.cells.length).toBe(9 ** depth);

      const mine = fig.cells.map((c) => triKey(triOf(c.bary, N), N)).sort();
      const theirs = oracleLeaves(depth, null).map((l) => triKey(l.tri, N)).sort();
      expect(mine).toEqual(theirs);

      // address for address, under the derived frames
      const framed = new Map(
        oracleLeaves(depth, CORRESPONDENCE.frames).map((l) => [
          triKey(l.tri, N),
          l.word,
        ])
      );
      for (const c of fig.cells) {
        const word = framed.get(triKey(triOf(c.bary, N), N));
        expect(word).toBeDefined();
        expect((word as number[]).map((d) => CORRESPONDENCE.nameOf.get(d)).join("")).toBe(
          c.addr
        );
      }
    }
  });

  /**
   * THE CONTAINMENT THEOREM, on the shipped construction.
   *
   * theory.md §9's load-bearing clause: the descendants of a node are EXACTLY the
   * fine cells whose barycentric centroid lies inside the node's footprint. The
   * descent side is the address prefix, which `buildRep9Figure`'s recursion
   * produced. The geometry side is `reptile.containsCentroid`, exact
   * cross-multiplied integer half-planes that share no code with it. `onBoundary`
   * is counted separately: a fine centroid landing on a coarse edge is the only
   * way this can fail, and it must never happen.
   *
   *   90 roots (9 at depth 1, 81 at depth 2) × 6,561 fine cells = 590,490 tests
   *
   * — the same 590,490 `docs/rep-tile-findings.md` Q1 reports on a bare rep-9
   * subdivision, now run through the figure that would actually ship.
   */
  it("descent equals centroid-in-footprint: 590,490 tests, 0 mismatches", () => {
    const fine = buildRep9Figure(4);
    const N = fine.scale;
    const keys = fine.cells.map((c) => triKey(triOf(c.bary, N), N));
    const cents = fine.cells.map((c) => centroid(triOf(c.bary, N)));
    expect(new Set(keys).size).toBe(fine.cells.length);

    let tests = 0;
    let mismatches = 0;
    let boundary = 0;
    for (const rootDepth of [1, 2]) {
      const roots = buildRep9Figure(rootDepth);
      const claims = new Array<number>(fine.cells.length).fill(0);
      for (const node of roots.cells) {
        const tri = triOf(node.bary, roots.scale);
        const descendants = new Set(
          fine.cells
            .filter((c) => c.addr.startsWith(node.addr))
            .map((c) => triKey(triOf(c.bary, N), N))
        );
        expect(descendants.size).toBe(9 ** (4 - rootDepth));
        for (let i = 0; i < fine.cells.length; i++) {
          tests++;
          const c = containsCentroid(tri, cents[i]);
          if (c.onBoundary) boundary++;
          if (c.inside !== descendants.has(keys[i])) mismatches++;
          if (c.inside) claims[i]++;
        }
      }
      // the roots at one depth tile the frame: every fine cell claimed once
      expect(claims.every((n) => n === 1)).toBe(true);
    }
    expect(tests).toBe(590490);
    expect(mismatches).toBe(0);
    expect(boundary).toBe(0);
  });

  /**
   * GUARD-FIRE. One node displaced by a single unit of the fine grid — still a
   * triangle, still congruent, still the right size, still the parent of the
   * right addresses — and both gates must go red. This is the smallest possible
   * falsehood and therefore the sharpest test: a gate that survives it is not
   * measuring alignment, it is measuring arithmetic.
   */
  it("one node displaced by one lattice unit breaks both gates", () => {
    const fine = buildRep9Figure(3);
    const N = fine.scale;
    const keys = fine.cells.map((c) => triKey(triOf(c.bary, N), N));
    const cents = fine.cells.map((c) => centroid(triOf(c.bary, N)));
    const roots = buildRep9Figure(2);
    const f = N / roots.scale;

    // restate over the fine grid, then move every vertex one unit along (y − z)
    const move = (p: IVec): IVec => [p[0] * f, p[1] * f + 1, p[2] * f - 1];
    const victim = roots.cells[4];
    const mutant: Tri = {
      v: [move(victim.bary[0]), move(victim.bary[1]), move(victim.bary[2])],
      den: N,
    };

    // (a) geometric agreement: the victim's own descendants — the addresses it
    // is still the prefix of — are no longer the cells its footprint holds
    const truth = new Set(
      fine.cells
        .filter((c) => c.addr.startsWith(victim.addr))
        .map((c) => triKey(triOf(c.bary, N), N))
    );
    expect(truth.size).toBe(9);
    let mismatches = 0;
    for (let i = 0; i < fine.cells.length; i++) {
      if (containsCentroid(mutant, cents[i]).inside !== truth.has(keys[i])) mismatches++;
    }
    expect(mismatches).toBeGreaterThan(0);
    // the same comparison against the UNMUTATED node is clean, so the fire is
    // the displacement's and not the gate's
    let clean = 0;
    const honest = triOf(victim.bary, roots.scale);
    for (let i = 0; i < fine.cells.length; i++) {
      if (containsCentroid(honest, cents[i]).inside !== truth.has(keys[i])) clean++;
    }
    expect(clean).toBe(0);

    // (b) frame accounting: with the victim replaced, some cell loses its owner
    let badClaims = 0;
    const nodes = roots.cells.map((c) =>
      c.i === victim.i ? mutant : triOf(c.bary, roots.scale)
    );
    for (let i = 0; i < fine.cells.length; i++) {
      let claims = 0;
      for (const n of nodes) if (containsCentroid(n, cents[i]).inside) claims++;
      if (claims !== 1) badClaims++;
    }
    expect(badClaims).toBeGreaterThan(0);

    // and the unmutated figure passes both, so the fire is the mutation's
    let cleanBad = 0;
    for (let i = 0; i < fine.cells.length; i++) {
      let claims = 0;
      for (const c of roots.cells) {
        if (containsCentroid(triOf(c.bary, roots.scale), cents[i]).inside) claims++;
      }
      if (claims !== 1) cleanBad++;
    }
    expect(cleanBad).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("2 — the alphabet is named by (vertex, grade), both read off geometry", () => {
  it("nine letters, 6 upright and 3 inverted, spelled by their two coordinates", () => {
    expect(REP9_ALPHABET.length).toBe(9);
    expect(REP9_ALPHABET.filter((l) => !l.inverted).length).toBe(6);
    expect(REP9_ALPHABET.filter((l) => l.inverted).length).toBe(3);
    expect(REP9_ALPHABET.map((l) => l.name).join("")).toBe(REP9_LETTERS);
    // the index IS the coordinate pair, not a serial number
    for (const l of REP9_ALPHABET) {
      expect(l.index).toBe(
        3 * GRADE_CLASSES.indexOf(l.gradeClass) + AXES.indexOf(l.vertex)
      );
    }
    // every (class, vertex) pair occurs exactly once — the two classes are
    // transverse, which is what Σ₉ ≅ grade × vertex means
    const pairs = new Set(REP9_ALPHABET.map((l) => `${l.gradeClass}/${l.vertex}`));
    expect(pairs.size).toBe(9);
  });

  /**
   * P₁ and P₂, against the oracle. The grade classes are the ROTATION'S ORBITS
   * on the alphabet and the vertex classes are the MIRRORS' FIXED SETS — both
   * computed by `reptile` from `childPermutation`, which finds the permutation by
   * transforming each child and looking it up by canonical key rather than by a
   * formula that could agree with the subdivision by construction.
   */
  it("the grade classes ARE the rotation orbits and the vertex classes the mirror fixed sets", () => {
    const norm = (s: readonly number[]) => [...s].sort((a, b) => a - b).join(",");
    const asOracle = (pick: (l: (typeof REP9_ALPHABET)[number]) => boolean) =>
      norm(REP9_ALPHABET.filter(pick).map((l) => CORRESPONDENCE.repOf[l.index]));

    expect(rotationOrbits(3).map(norm).sort()).toEqual(
      GRADE_CLASSES.map((g) => asOracle((l) => l.gradeClass === g)).sort()
    );
    // …and in the right order, mirror by mirror: Fix(m_v) is the vertex-v class
    expect(mirrorFixedSets(3).map(norm)).toEqual(
      AXES.map((v) => asOracle((l) => l.vertex === v))
    );
    // every letter is fixed by exactly one mirror. That is 3k = k², true only at
    // k = 3, and it is the same fact as "there is no hub".
    for (const l of REP9_ALPHABET) {
      const fixing = AXES.filter((v) =>
        mirrorFixedSets(3)[AXES.indexOf(v)].includes(CORRESPONDENCE.repOf[l.index])
      );
      expect(fixing).toEqual([l.vertex]);
    }
  });

  /**
   * THE FRAME RULE, checked as a statement about triangles rather than as the
   * table that produced it: role 0 is the child's unique vertex fixed by the
   * mirror that fixes the child. Geometrically that is the parent's own corner
   * for the three corner children and the parent's CENTROID for the other six.
   */
  it("role 0 is the vertex fixed by the letter's own mirror — corner, then centroid", () => {
    const SWAP: Record<Axis, IVec> = { A: [0, 2, 1], B: [2, 1, 0], C: [1, 0, 2] };
    const fig = buildRep9Figure(1);
    const CORNERS = [
      [3, 0, 0],
      [0, 3, 0],
      [0, 0, 3],
    ];
    for (const c of fig.cells) {
      const letter = REP9_BY_NAME.get(c.addr) as (typeof REP9_ALPHABET)[number];
      const s = SWAP[letter.vertex];
      const fixed = c.bary.map((p, r) =>
        p[s[0]] === p[0] && p[s[1]] === p[1] && p[s[2]] === p[2] ? r : -1
      );
      expect(fixed.filter((r) => r >= 0)).toEqual([0]);
      const role0 = c.bary[0];
      const isCorner = CORNERS.some((q) => q.every((x, k) => x === role0[k]));
      const isCentroid = role0[0] === 1 && role0[1] === 1 && role0[2] === 1;
      expect(isCorner).toBe(letter.gradeClass === "corner");
      expect(isCentroid).toBe(letter.gradeClass !== "corner");
    }
  });

  /**
   * THE DEVIATION, stated as a measurement. `reptile.rotationFrames(3)` returns
   * `[0,0,2,1,1,2,0,1,2]`; the rule above returns something else. Both solve the
   * recurrence F(π d) = r ∘ F(d), which is what makes the rotation law
   * single-digit, because the recurrence pins each rotation orbit only up to
   * post-composition by a constant — 6³ = 216 solutions in all.
   *
   * The disagreement is exactly one constant per orbit, and it is ZERO on the
   * corner orbit, where both conventions are apex in rep-4's own sense.
   */
  it("the derived frames solve the same recurrence as rotationFrames, up to one constant per orbit", () => {
    const mine = CORRESPONDENCE.frames;
    const theirs = rotationFrames(3);
    expect(theirs).toEqual([0, 0, 2, 1, 1, 2, 0, 1, 2]);
    expect(mine).not.toEqual(theirs);

    // (a) mine solves the recurrence, which is the property that matters
    const pi = childPermutation(3, S3[1].perm);
    const r = S3[theirs[pi[0]]].perm; // the rotation's residual, from the oracle
    for (let d = 0; d < 9; d++) {
      expect(S3[mine[pi[d]]].perm).toEqual(permCompose(r, S3[mine[d]].perm));
    }

    // (b) the difference is a constant on each rotation orbit — and the corner
    // orbit's constant is the identity
    const constants = rotationOrbits(3).map((orbit) => {
      const perOrbit = new Set(
        orbit.map((d) => {
          const inv = new Array<number>(3);
          S3[mine[d]].perm.forEach((x, i) => (inv[x] = i));
          return s3IndexOf(permCompose(inv, S3[theirs[d]].perm));
        })
      );
      expect(perOrbit.size).toBe(1);
      return [...perOrbit][0];
    });
    const cornerOrbit = rotationOrbits(3).findIndex((o) =>
      o.includes(CORRESPONDENCE.repOf[(REP9_BY_NAME.get("a") as { index: number }).index])
    );
    expect(constants[cornerOrbit]).toBe(0);
    expect(constants.filter((x) => x !== 0).length).toBe(2);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("3 — the charge is ℤ/3 and exactly D₃-invariant", () => {
  /**
   * The rep-9 charge is the sum of the per-letter grades in ℤ/3, and it is
   * INVARIANT — not equivariant-up-to-a-relabelling as rep-4's V4 charge is under
   * the mirrors, and not up to a twist as the full (ℤ/3)² charge is. Cell for
   * cell, at every depth, over all six symmetries:
   *
   *   6 × (9 + 81 + 729 + 6,561) = 44,280 tests, 0 mismatches
   *
   * — the same 44,280 `docs/rep9-charge.md` reports, now measured on the built
   * figure where the symmetry is an integer key lookup rather than a permutation
   * applied to a word.
   *
   * It survives the mirrors — which act on addresses by a TRANSDUCER and not by a
   * digit rewrite — because every element of S₃ preserves each grade class: the
   * classes are cut out by the multiset {i, j, l}, which a coordinate permutation
   * cannot change. Whatever state the transducer is in, each digit's grade is
   * preserved and the sum with it.
   *
   * The VERTEX sum is measured alongside so the two cannot be confused. It is not
   * invariant and cannot be made so: it needs a basepoint, the rotation
   * translates it, and the mirrors shift it by a word-dependent amount. 29,520 of
   * the same 44,280 tests fail for it.
   */
  it("44,280 tests, 0 grade mismatches — and the vertex sum is not invariant", () => {
    const gradeOf = digitSum(GRADE);
    const vertexOf = digitSum(VERTEX);
    let tests = 0;
    let gradeBad = 0;
    let vertexBad = 0;
    for (const depth of [1, 2, 3, 4]) {
      const fig = buildRep9Figure(depth);
      for (const name of ISOMETRY_NAMES) {
        const image = rep9IndexMap(fig, name);
        for (const c of fig.cells) {
          tests++;
          const there = fig.cells[image[c.i]].addr;
          if (gradeOf(there) !== gradeOf(c.addr)) gradeBad++;
          if (vertexOf(there) !== vertexOf(c.addr)) vertexBad++;
        }
      }
    }
    expect(tests).toBe(44280);
    expect(gradeBad).toBe(0);
    expect(vertexBad).toBe(29520);
  });

  it("the cell's charge IS that sum, and prefixes accumulate it", () => {
    const gradeOf = digitSum(GRADE);
    const fig = buildRep9Figure(3);
    for (const c of fig.cells) {
      expect(c.charge).toBe(gradeOf(c.addr));
      expect(rep9Charge(c.addr)).toBe(c.charge);
      for (let k = 0; k <= c.addr.length; k++) {
        expect(rep9PrefixCharge(c.addr, k)).toBe(gradeOf(c.addr.slice(0, k)));
      }
    }
    expect(() => rep9PrefixCharge("A", 1)).toThrow();
  });

  /**
   * GUARD-FIRE, and it is the smallest possible falsehood: move ONE letter
   * between grade classes. The result is still a total function Σ₉ → ℤ/3, still
   * sums over the word, still gives every cell a charge — and the invariance
   * dies, 114 times at depth 2 alone.
   */
  it("moving one letter between grade classes fires 114 times at depth 2", () => {
    const mutant = new Map(GRADE);
    mutant.set("y", 1); // an inverted letter promoted to the corner class
    const bad = digitSum(mutant);
    const fig = buildRep9Figure(2);
    let fired = 0;
    for (const name of ISOMETRY_NAMES) {
      const image = rep9IndexMap(fig, name);
      for (const c of fig.cells) {
        if (bad(fig.cells[image[c.i]].addr) !== bad(c.addr)) fired++;
      }
    }
    expect(fired).toBe(114);
  });

  /**
   * THE ONE BIT OF FIAT, and the demonstration that it is never serialised.
   *
   * Flipping `REP9_POSITIVE_CLASS` swaps which upright class counts as +1. What
   * it does NOT touch: any address, any triangle, any arm — the sign enters
   * `gradeOfClass` and nothing else, so the geometry and the addressing cannot
   * see it. What it does to the charge is the unique non-trivial automorphism of
   * ℤ/3, x ↦ −x, uniformly over every cell at every depth. That is why the bit
   * can be arbitrary and still harmless: files store addresses, and a reader that
   * disagrees about the sign computes the negated charge, which is the same
   * field under a palette permutation.
   */
  it("the sign bit negates every charge and moves nothing else", () => {
    const flipped = new Map(
      REP9_ALPHABET.map((l) => [
        l.name as string,
        l.gradeClass === "inverted" ? 0 : l.gradeClass === REP9_POSITIVE_CLASS ? 2 : 1,
      ])
    );
    const other = digitSum(flipped);
    for (const depth of [1, 2, 3]) {
      const fig = buildRep9Figure(depth);
      for (const c of fig.cells) {
        expect(other(c.addr)).toBe((3 - c.charge) % 3);
      }
      // and the flipped charge is just as invariant — neither sign is preferred
      let bad = 0;
      for (const name of ISOMETRY_NAMES) {
        const image = rep9IndexMap(fig, name);
        for (const c of fig.cells) {
          if (other(fig.cells[image[c.i]].addr) !== other(c.addr)) bad++;
        }
      }
      expect(bad).toBe(0);
    }
    // the inverted class is 0 under either sign, which is what makes it the
    // basepoint-free part of the construction
    for (const l of REP9_ALPHABET) {
      if (l.gradeClass === "inverted") expect(l.grade).toBe(0);
      else expect(l.grade).not.toBe(0);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("4 — the arms: unique, residual exactly 0, and the induced action", () => {
  /**
   * THE TRANSVERSAL IS FORCED, and `docs/rep-tile-findings.md` Q3 was wrong on
   * both halves. 27 is the count of TRANSVERSALS; the DECOMPOSITION count is 9,
   * because T, πT and π²T name the same three parts; and of those 9, requiring
   * the MIRRORS to permute the parts as well as the rotation leaves exactly one —
   * the mirror fixed sets, which is what `figure.ts` builds. Counted by the
   * oracle, whose enumeration knows nothing about `figure.ts`'s letters.
   */
  it("exactly one D₃-stable decomposition, and the figure's arms are it", () => {
    const stable = d3StableTransversals(3);
    expect(stable.length).toBe(1);
    const norm = (s: readonly number[]) => [...s].sort((a, b) => a - b).join(",");
    const mine = AXES.map((v) =>
      norm(
        REP9_ALPHABET.filter((l) => l.vertex === v).map((l) => CORRESPONDENCE.repOf[l.index])
      )
    );
    expect(stable[0].map(norm).sort()).toEqual([...mine].sort());
  });

  it("three congruent arms, scale²/3 cells each, residual exactly 0", () => {
    const sizes: number[][] = [];
    for (const depth of [1, 2, 3, 4]) {
      const fig = buildRep9Figure(depth);
      const census = rep9ArmCensus(fig);
      expect(census.residual).toBe(0);
      expect(census.even).toBe(true);
      expect(census.sizes.A).toBe(census.predicted);
      expect(census.predicted).toBe(rep9ArmCellsAtScale(fig.scale));
      expect(3 * census.predicted).toBe(census.total);
      sizes.push(ARMS.map((a) => census.sizes[a]));
      for (const a of ARMS) expect(rep9ArmCells(fig, a).length).toBe(census.sizes[a]);
    }
    expect(sizes).toEqual([
      [3, 3, 3],
      [27, 27, 27],
      [243, 243, 243],
      [2187, 2187, 2187],
    ]);
    // the depth-0 figure is the root: one cell, no first digit, and therefore in
    // no arm. Not a hub — a hub would be there at EVERY depth.
    expect(rep9ArmCensus(buildRep9Figure(0)).residual).toBe(1);
  });

  /**
   * The action on the arms is the VERTEX action and nothing else, and it is the
   * SAME TABLE rep-4's arms obey — `test/arms.test.ts` asserts these two tables
   * for `ftype`, and they are reproduced verbatim here for `arm`. The rotation
   * permutes the three cyclically; each median fixes its own and swaps the other
   * two.
   */
  it("the rotation permutes them cyclically and m_D fixes arm D — rep-4's own tables", () => {
    const fig = buildRep9Figure(3);
    const tables: Record<string, Record<Arm, Arm>> = {
      "rot+": { A: "B", B: "C", C: "A" },
      "rot-": { A: "C", B: "A", C: "B" },
      m_A: { A: "A", B: "C", C: "B" },
      m_B: { A: "C", B: "B", C: "A" },
      m_C: { A: "B", B: "A", C: "C" },
    };
    for (const [name, table] of Object.entries(tables)) {
      const image = rep9IndexMap(fig, name as IsometryName);
      for (const c of fig.cells) {
        expect(rep9ArmOf(fig, image[c.i])).toBe(table[c.arm as Arm]);
      }
    }
    // congruence checked as POINT SETS, not by counting: rotate arm A and land
    // on arm B key for key
    const armA = rep9ArmCells(fig, "A");
    const image = rep9IndexMap(fig, "rot+");
    const armB = new Set(rep9ArmCells(fig, "B").map((i) => fig.cells[i].key.join(",")));
    expect(armA.length).toBe(armB.size);
    for (const i of armA) expect(armB.has(fig.cells[image[i]].key.join(","))).toBe(true);
  });

  it("reads an arm off an address, and a suffix never changes it", () => {
    const fig = buildRep9Figure(3);
    for (const c of fig.cells) {
      expect(armOfWord(c.addr)).toBe(c.arm);
      for (const l of REP9_ALPHABET) expect(armOfWord(c.addr + l.name)).toBe(c.arm);
    }
    expect(armOfWord("axy")).toBe("A");
    expect(armOfWord("zub")).toBe("C");
  });

  /**
   * GUARD-FIRE, and it is the sharp one rather than the easy one.
   *
   * Take a RIVAL decomposition: one of the other eight, built as a genuine
   * transversal of the rotation orbits. Every gate a rotation-only argument can
   * raise stays GREEN — the parts are still equal in size and the rotation still
   * permutes them cyclically. What dies is the mirror. That is exactly the
   * condition Q3 never imposed and the reason it concluded nothing was
   * distinguished.
   */
  it("a rival transversal keeps every rotation gate green and fails the mirror", () => {
    const fig = buildRep9Figure(3);
    const rotPerm = childPermutation(3, S3[1].perm);
    // pick a transversal that is NOT the vertex classes: one letter per rotation
    // orbit, chosen so the parts are not the mirror fixed sets
    const pick = [
      REP9_ALPHABET.find((l) => l.gradeClass === "corner" && l.vertex === "A"),
      REP9_ALPHABET.find((l) => l.gradeClass === "edge" && l.vertex === "B"),
      REP9_ALPHABET.find((l) => l.gradeClass === "inverted" && l.vertex === "A"),
    ].map((l) => CORRESPONDENCE.repOf[(l as { index: number }).index]);
    const rivalPart = new Array<number>(9).fill(-1);
    for (const d of pick) {
      rivalPart[d] = 0;
      rivalPart[rotPerm[d]] = 1;
      rivalPart[rotPerm[rotPerm[d]]] = 2;
    }
    expect(rivalPart.every((p) => p >= 0)).toBe(true);
    const partOf = (addr: string) =>
      rivalPart[
        CORRESPONDENCE.repOf[(REP9_BY_NAME.get(addr[0]) as { index: number }).index]
      ];
    expect(new Set(rivalPart.map((p, d) => `${d}:${p}`)).size).toBe(9);
    // it is genuinely a different decomposition from the arms
    const armPart = fig.cells.map((c) => AXES.indexOf(c.arm as Arm));
    expect(fig.cells.map((c) => partOf(c.addr))).not.toEqual(armPart);

    // still equal in size
    const count = [0, 0, 0];
    for (const c of fig.cells) count[partOf(c.addr)]++;
    expect(count).toEqual([243, 243, 243]);
    // still permuted cyclically by BOTH rotations — a rotation-only argument
    // cannot tell the difference
    for (const name of ["rot+", "rot-"] as const) {
      const image = rep9IndexMap(fig, name);
      const moves = new Set(
        fig.cells.map((c) => `${partOf(c.addr)}->${partOf(fig.cells[image[c.i]].addr)}`)
      );
      expect(moves.size).toBe(3);
    }
    // and the mirror kills it, where it does not kill the arms
    const mir = rep9IndexMap(fig, "m_A");
    const rivalMoves = new Set(
      fig.cells.map((c) => `${partOf(c.addr)}->${partOf(fig.cells[mir[c.i]].addr)}`)
    );
    expect(rivalMoves.size).toBeGreaterThan(3);
    const armMoves = new Set(
      fig.cells.map((c) => `${c.arm}->${fig.cells[mir[c.i]].arm}`)
    );
    expect(armMoves.size).toBe(3);
  });

  /**
   * THE INDUCED ACTION, and it is `arms.ts`'s rep-4 table unchanged.
   *
   * The setwise stabiliser of arm A in D₃ is ⟨m_A⟩, of order 2: the rotations
   * carry the arm off itself and of the three mirrors only m_A fixes it. So
   * clipping a symmetry brush to one arm leaves exactly the ⟨m_A⟩ orbit — mode 3
   * paints what mode 1 paints and mode 6 what mode 2 paints, for exactly the
   * reason `arms.ts` gives at rep-4.
   *
   * What has changed is the row that is NOT here: there is no hub to be
   * unreachable while an arm is isolated, so the cost `arms.ts` states in the
   * open is simply not incurred. The last assertion is that statement, measured:
   * with an arm isolated the number of cells reachable from nowhere is zero.
   */
  it("isolating an arm clips the orbit to ⟨m_A⟩ — mode 3 → mode 1, mode 6 → mode 2", () => {
    const fig = buildRep9Figure(3);
    const maps = Object.fromEntries(
      ISOMETRY_NAMES.map((n) => [n, rep9IndexMap(fig, n)])
    ) as Record<IsometryName, number[]>;
    const modes: [number, IsometryName[]][] = [
      [1, ["id"]],
      [2, ["id", "m_A"]],
      [3, ["id", "rot+", "rot-"]],
      [6, [...ISOMETRY_NAMES]],
    ];
    const report: Record<string, string> = {};
    for (const [mode, elements] of modes) {
      const full = new Map<number, number>();
      const clipped = new Map<number, number>();
      for (const c of fig.cells) {
        if (c.arm !== "A") continue;
        const orbit = new Set(elements.map((e) => maps[e][c.i]));
        full.set(orbit.size, (full.get(orbit.size) ?? 0) + 1);
        const inside = [...orbit].filter((j) => fig.cells[j].arm === "A").length;
        clipped.set(inside, (clipped.get(inside) ?? 0) + 1);
      }
      const fmt = (m: Map<number, number>) =>
        [...m].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}×${v}`).join(" ");
      report[`mode${mode}`] = `${fmt(full)} | ${fmt(clipped)}`;
    }
    expect(report).toEqual({
      mode1: "1×243 | 1×243",
      mode2: "1×27 2×216 | 1×27 2×216",
      mode3: "3×243 | 1×243",
      mode6: "3×27 6×216 | 1×27 2×216",
    });

    // NO HUB: the three isolations cover every cell, so nothing is unreachable.
    const covered = new Set<number>();
    for (const arm of ARMS) {
      const keep = rep9ArmMask(fig, arm);
      for (const c of fig.cells) if (keep(c.i)) covered.add(c.i);
    }
    expect(covered.size).toBe(fig.cells.length);
    expect(rep9ArmMask(fig, null)(0)).toBe(true);
  });

  it("the mask clips a stamp to the arm and nowhere else", () => {
    // `clipStamp` is radix-blind — it filters a cell list through a predicate —
    // so the only thing to check here is that the rep-9 predicate is the arm.
    const fig = buildRep9Figure(3);
    const image = rep9IndexMap(fig, "rot+");
    for (const arm of ARMS) {
      const keep = rep9ArmMask(fig, arm);
      const inArm = new Set(rep9ArmCells(fig, arm));
      const stamp = {
        cells: fig.cells.map((c) => c.i),
        keys: fig.cells.map((c) => image[c.i]),
        span: 3,
        groups: null,
      };
      const clipped = clipStamp(stamp, keep);
      expect(clipped.cells).toEqual([...inArm].sort((a, b) => a - b));
      expect(clipped.span).toBe(3);
      for (const i of clipped.cells) expect(rep9ArmOf(fig, i)).toBe(arm);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("5 — the rotation rewrites only the first digit", () => {
  /**
   * The law rep-4 cannot have. `docs/symmetry-findings.md` §A's rep-4 rotation is
   * "rewrite the first NON-X digit", and the exception exists because the frame
   * recurrence F(π d) = r ∘ F(d) closes only where the rotation acts freely — at
   * rep-4 the orbit through X has length one and would ask r = id, which is
   * false. At rep-9 every orbit has length 3 and r³ = id, so the law is
   * exception-free.
   *
   * Measured on the built figure, cell for cell, against the geometry:
   *
   *   framed (what ships)   single-digit 729/729,  uniform rewrite 0/729
   *   ifs (unframed oracle) single-digit   0/729,  uniform rewrite 729/729
   *
   * The two are genuinely different addressings of the same triangles, which is
   * why the second column is the guard-fire for the first: it is the same gate
   * run against the convention that must fail it.
   */
  it("729/729 under the shipped frames, 0/729 under the ifs reading", () => {
    /**
     * The rotation's action on LETTERS, derived from the depth-1 figure by the
     * same key lookup everything else here uses. Derived rather than imported
     * because `conventions.ISOMETRIES["rot+"] = [2,0,1]` and `reptile.S3[1]
     * "rot+" = [1,2,0]` are INVERSE permutations — the two modules give the same
     * name to opposite senses of the rotation. Neither is wrong and neither can
     * see the other (nothing shipped imports `reptile`), but a test that mixes
     * them silently compares a map with its own inverse, which is how this gate
     * first read 0/729. Reading the letter action off the figure removes the
     * question.
     */
    const fig1 = buildRep9Figure(1);
    const img1 = rep9IndexMap(fig1, "rot+");
    const rho = new Map(fig1.cells.map((c) => [c.addr, fig1.cells[img1[c.i]].addr]));
    expect(new Set(rho.values()).size).toBe(9);
    const counts: Record<string, number> = {};
    for (const depth of [2, 3]) {
      const fig = buildRep9Figure(depth);
      const image = rep9IndexMap(fig, "rot+");
      let single = 0;
      let uniform = 0;
      for (const c of fig.cells) {
        const there = fig.cells[image[c.i]].addr;
        if (
          there[0] === rho.get(c.addr[0]) &&
          there.slice(1) === c.addr.slice(1)
        ) {
          single++;
        }
        if ([...c.addr].map((ch) => rho.get(ch)).join("") === there) uniform++;
      }
      counts[`framed${depth}single`] = single;
      counts[`framed${depth}uniform`] = uniform;
    }
    expect(counts).toEqual({
      framed2single: 81,
      framed2uniform: 0,
      framed3single: 729,
      framed3uniform: 0,
    });

    // The ifs reading, on the same triangles, scoring the other way round —
    // entirely inside the oracle's own conventions, so `S3[1]`'s sense and
    // `childPermutation`'s agree by construction.
    const rotPerm = childPermutation(3, S3[1].perm);
    const N = 27;
    const cells = oracleLeaves(3, null);
    const byKey = new Map(cells.map((c, i) => [triKey(c.tri, N), i]));
    let ifsSingle = 0;
    let ifsUniform = 0;
    for (const c of cells) {
      const rotated = {
        v: [
          [c.tri.v[0][1], c.tri.v[0][2], c.tri.v[0][0]],
          [c.tri.v[1][1], c.tri.v[1][2], c.tri.v[1][0]],
          [c.tri.v[2][1], c.tri.v[2][2], c.tri.v[2][0]],
        ] as Tri["v"],
        den: c.tri.den,
      };
      const j = byKey.get(triKey(rotated, N)) as number;
      const w = cells[j].word;
      if (
        w[0] === rotPerm[c.word[0]] &&
        w.slice(1).every((d, k) => d === c.word[k + 1])
      ) {
        ifsSingle++;
      }
      if (w.every((d, k) => d === rotPerm[c.word[k]])) ifsUniform++;
    }
    expect(ifsSingle).toBe(0);
    expect(ifsUniform).toBe(729);
  });

  /**
   * ACROSS THE CONVENTION CHANGE the arm and the grade of every cell are
   * unchanged, and the vertex sum is not. That is what makes the two shipped
   * quantities invariants of the CELL rather than of the addressing: a convention
   * rewrites digits by elements of S₃, and every element of S₃ preserves the
   * grade classes and the vertex classes setwise. The vertex SUM is the component
   * that was never canonical.
   */
  it("the arm and the grade survive the convention; the vertex sum does not", () => {
    const N = 27;
    const fig = buildRep9Figure(3);
    const ifs = new Map(
      oracleLeaves(3, null).map((l) => [
        triKey(l.tri, N),
        l.word.map((d) => CORRESPONDENCE.nameOf.get(d) as string).join(""),
      ])
    );
    const gradeOf = digitSum(GRADE);
    const vertexOf = digitSum(VERTEX);
    let sameGrade = 0;
    let sameVertex = 0;
    let sameArm = 0;
    let sameAddr = 0;
    for (const c of fig.cells) {
      const other = ifs.get(triKey(triOf(c.bary, N), N)) as string;
      if (gradeOf(other) === gradeOf(c.addr)) sameGrade++;
      if (vertexOf(other) === vertexOf(c.addr)) sameVertex++;
      if (armOfWord(other) === c.arm) sameArm++;
      if (other === c.addr) sameAddr++;
    }
    expect(sameGrade).toBe(729);
    expect(sameArm).toBe(729);
    expect(sameVertex).toBeLessThan(729);
    // and the two really are different addressings, or the above says nothing
    expect(sameAddr).toBeLessThan(729);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("6 — six rep-9 sectors assemble the hexagon", () => {
  /**
   * The hexagon construction depends on the 60° apex angle and on the cells being
   * lattice triangles, not on the radix. `buildRep9Hexagon` throws on a repeated
   * exact lattice key, which is the check `buildHexagon` has always made, so a
   * successful build IS the no-collision result — and the count is asserted so
   * that a build which silently produced too few cells could not pass.
   */
  it("6 × 9^d distinct lattice keys, zero collisions, d = 1, 2, 3", () => {
    for (const depth of [1, 2, 3]) {
      const hex = buildRep9Hexagon(depth);
      expect(hex.cells.length).toBe(6 * 9 ** depth);
      expect(hex.byKey.size).toBe(hex.cells.length);
      expect(new Set(hex.cells.map((c) => latKey(c.key))).size).toBe(hex.cells.length);
      expect(hex.scale).toBe(scaleOfRep9Depth(depth));
      expect(hex.base.cells.length).toBe(9 ** depth);
      // the drawn-orientation census balances, as it does at rep-4: odd sectors
      // are rotated by an odd multiple of 60°, which exchanges the two lattice
      // orientations
      const up = hex.cells.filter((c) => c.eps === 0).length;
      expect(up).toBe(hex.cells.length - up);
    }
  });

  /**
   * The D₆ index law carries over unchanged — same derivation, same closed form,
   * and the same planted mutant caught. `indexMap` and `closedFormMap` were
   * WIDENED to the structure they always read rather than reimplemented, so this
   * is the rep-4 derivation being exercised on rep-9 data and not a second
   * opinion about it.
   */
  it("the twelve isometries permute the cells, and the closed form agrees", () => {
    const hex = buildRep9Hexagon(2);
    for (const g of HEX_ISOMETRIES) {
      const m = indexMap(hex, g);
      expect(new Set(m).size).toBe(hex.cells.length);
      expect(m).toEqual(closedFormMap(hex, g));
    }
    // the prose candidate — rot60 carrying a μ — is still wrong at rep-9
    expect(
      HEX_ISOMETRIES.some((g) => indexMap(hex, g).join() !== mutantRotMap(hex, g).join())
    ).toBe(true);
  });

  it("every hexagon cell keeps its base cell's arm, in all six sectors", () => {
    const hex = buildRep9Hexagon(2);
    const perArm: Record<string, number> = { A: 0, B: 0, C: 0 };
    for (const c of hex.cells) {
      expect(c.arm).toBe(hex.base.cells[c.base].arm);
      expect(armOfWord(c.addr)).toBe(c.arm);
      perArm[c.arm as Arm]++;
    }
    expect(perArm).toEqual({ A: 162, B: 162, C: 162 });
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("7 — one address, one radix, one resolution", () => {
  /**
   * THE DEVIATION, decided by the oracle rather than by the brief.
   *
   * The brief for this work said `radixAt` must answer NINE for rep-9 letters. It
   * answers THREE, because `radixAt` returns an EDGE DIVISION — it returns 2 at
   * rep-4, whose child count is 4 — and `scale.ts`'s header is emphatic that the
   * scale is the product of edge divisions and the cell count its square. The
   * question is settled here by descending an actual triangle: `reptile.descend`
   * multiplies the denominator by the edge division at every real cut and knows
   * nothing about this codebase's bookkeeping.
   */
  it("the rep-9 edge division is 3, against the oracle's own denominator", () => {
    expect(REP9_EDGE_DIVISION).toBe(3);
    for (let d = 0; d <= 5; d++) {
      const word = Array.from({ length: d }, () => 0);
      expect(descend(ROOT, REP9_EDGE_DIVISION, word).den).toBe(scaleOfRep9Depth(d));
    }
    // and the child count is its SQUARE, which is where a 9 would have belonged
    expect(alphabet(REP9_EDGE_DIVISION).length).toBe(cellsAtScale(REP9_EDGE_DIVISION));
    expect(cellsAtScale(scaleOfRep9Depth(4))).toBe(9 ** 4);
  });

  it("radixAt answers 3 on rep-9 letters and 2 on everything else", () => {
    for (const ch of REP9_LETTERS) expect(radixAt(ch, 0)).toBe(REP9_EDGE_DIVISION);
    for (const ch of "ABCXs012345:") expect(radixAt(ch, 0)).toBe(EDGE_DIVISION);
  });

  it("a rep-9 address determines its own scale, with no figure in hand", () => {
    for (const depth of [1, 2, 3]) {
      const fig = buildRep9Figure(depth);
      for (const c of fig.cells) {
        expect(scaleOfWord(c.addr)).toBe(fig.scale);
        for (let k = 0; k <= c.addr.length; k++) {
          expect(scaleOfWord(c.addr.slice(0, k))).toBe(scaleOfRep9Depth(k));
        }
      }
      expect(cellsAtScale(fig.scale)).toBe(fig.cells.length);
    }
  });

  /**
   * A MIXED address, which is the case the whole `radixAt` signature exists for:
   * the schedule is read off the letters, so a word that changes radix mid-way
   * still names exactly one resolution. The scales it reaches are the 3-smooth
   * numbers, and the ORDER on them is divisibility rather than `≤` — which is the
   * half of `refines` that could not be exercised until a second radix existed.
   */
  it("a mixed address scales by its own letters, and refines works across radices", () => {
    expect(scaleOfWord("Aa")).toBe(6);
    expect(scaleOfWord("aA")).toBe(6);
    expect(scaleOfWord("AAaa")).toBe(36);
    expect(scaleOfWord("abcABC")).toBe(27 * 8);

    // the same scale by two different schedules — depth cannot tell them apart
    expect(scaleOfWord("Aa")).toBe(scaleOfWord("aA"));
    expect("Aa".length).toBe("aA".length);

    // divisibility, where ordering would lie
    expect(refines(scaleOfDepth(2), scaleOfRep9Depth(2))).toBe(false);
    expect(refines(scaleOfRep9Depth(2), scaleOfDepth(2))).toBe(false);
    expect(scaleOfDepth(2) < scaleOfRep9Depth(2)).toBe(true); // 4 < 9, and false
    expect(refines(3, 27)).toBe(true);
    expect(refines(scaleOfWord("A"), scaleOfWord("Aa"))).toBe(true);
    expect(refines(scaleOfWord("a"), scaleOfWord("Aa"))).toBe(true);
    // 8 and 9 are incomparable: neither figure refines the other at depth 3/2
    expect(refines(8, 9) || refines(9, 8)).toBe(false);
  });

  it("the arm size formula loses the hub's −1 exactly", () => {
    for (const depth of [1, 2, 3, 4]) {
      const scale = scaleOfRep9Depth(depth);
      expect(rep9ArmCellsAtScale(scale)).toBe(cellsAtScale(scale) / 3);
      expect(Number.isInteger(rep9ArmCellsAtScale(scale))).toBe(true);
      // rep-4's, for contrast — the −1 is the hub and it is still there
      const four = scaleOfDepth(depth);
      expect((cellsAtScale(four) - 1) / 3).toBe((4 ** depth - 1) / 3);
    }
  });
});
