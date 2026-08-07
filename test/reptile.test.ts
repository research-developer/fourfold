/**
 * Rep-tile refinement: does theory.md §9 survive k ≠ 2, and does it survive
 * MIXED radix?
 *
 * This file is a verdict, not a feature test. It is written in the shape
 * MATH-76 uses: exhaustive counts, an independent geometric oracle, and a
 * guard-fire mutation for every gate that claims something. Nothing here is
 * asserted from analogy — where a number appears in the report it was printed
 * by one of these tests.
 *
 * The four questions, and where each is decided:
 *
 *   Q1  "the 4 is incidental"            → describe("Q1 …")
 *   Q2  mixed radix — the real gate      → describe("Q2 …")
 *   Q3  the charge group at rep-9        → describe("Q3 …")
 *   Q4  rings                            → describe("Q4 …")
 */
import { describe, expect, it } from "vitest";
import {
  GROUPS,
  ROOT,
  S3,
  affineBijections,
  alphabet,
  armLetterMaps,
  bestRelabelling,
  buildTree,
  canonicalCoords,
  centroid,
  childPermutation,
  collectAffineLabellings,
  containsCentroid,
  coordLabelling,
  cornerLetters,
  d3StableTransversals,
  downCount,
  eachPermutation,
  fixedLetters,
  frameResidual,
  groupIntoStructures,
  inducedMap,
  isAffine,
  isAutomorphism,
  isPartition,
  linearPart,
  mirrorFixedSets,
  permuteTri,
  planeLines,
  rotationFrames,
  rotationOrbits,
  rotationTransversals,
  searchLabellings,
  shiftNode,
  subdivide,
  subdivideFramed,
  triKey,
  upCount,
  wordCharge,
  type PlaneStructure,
  type Tree,
  type Tri,
} from "../src/lib/reptile";
import { buildFigure } from "../src/lib/figure";
import { baryToLat, latKey, rotK } from "../src/lib/hexagon";

interface Leaf {
  readonly word: readonly number[];
  readonly tri: Tri;
}

/** Every cell of the uniform depth-`depth` rep-k² figure, with its address. */
function leaves(k: number, depth: number): Leaf[] {
  let cur: Leaf[] = [{ word: [], tri: ROOT }];
  for (let d = 0; d < depth; d++) {
    const next: Leaf[] = [];
    for (const n of cur) {
      subdivide(n.tri, k).forEach((t, i) => next.push({ word: [...n.word, i], tri: t }));
    }
    cur = next;
  }
  return cur;
}

/** The same, with a per-child FRAME — i.e. under a stated role convention. */
function framedLeaves(k: number, depth: number, frames: readonly number[]): Leaf[] {
  let cur: Leaf[] = [{ word: [], tri: ROOT }];
  for (let d = 0; d < depth; d++) {
    const next: Leaf[] = [];
    for (const n of cur) {
      subdivideFramed(n.tri, k, frames).forEach((t, i) =>
        next.push({ word: [...n.word, i], tri: t })
      );
    }
    cur = next;
  }
  return cur;
}

/**
 * Where a symmetry sends each cell, decided by the GEOMETRY: the triangle is
 * transformed and then looked up by canonical key. Every claim below about
 * addresses is checked through this, never by applying a permutation to a word
 * and asserting the result is what the same permutation produces.
 */
function symmetryImages(cells: readonly Leaf[], N: number, permIndex: number): number[] {
  const byKey = new Map(cells.map((c, i) => [triKey(c.tri, N), i]));
  return cells.map((c) => {
    const j = byKey.get(triKey(permuteTri(c.tri, S3[permIndex].perm), N));
    if (j === undefined) throw new Error("no image cell");
    return j;
  });
}

const isPrefix = (p: readonly number[], w: readonly number[]) =>
  p.every((d, i) => w[i] === d);

/**
 * The 9! sweep, run ONCE for the whole file. `searchLabellings` runs its own and
 * the tests cross-check the two counts against each other, so this cache cannot
 * make a wrong number look right — it only stops the sweep happening six times.
 */
let affineCache: number[][] | null = null;
const affineLabellings = (): number[][] => {
  affineCache ??= collectAffineLabellings(3, "Z3xZ3");
  return affineCache;
};
let structureCache: PlaneStructure[] | null = null;
const structures = (): PlaneStructure[] => {
  structureCache ??= groupIntoStructures(GROUPS.Z3xZ3, affineLabellings(), 3);
  return structureCache;
};

/**
 * Descent side of a mixed tree: for every node, the set of common-refinement
 * cells reached by continuing the tree's OWN radices to the bottom and then
 * refining each leaf by whatever factor it still owes. Returns keys, so the
 * comparison with the geometric side is on point sets and not on objects.
 */
function descentSets(tree: Tree, N: number): Map<number, Set<string>> {
  const perLeaf = new Map<number, string[]>();
  for (const li of tree.leaves) {
    const tri = tree.nodes[li].tri;
    const f = N / tri.den;
    perLeaf.set(
      li,
      (f === 1 ? [tri] : subdivide(tri, f)).map((t) => triKey(t, N))
    );
  }
  const out = new Map<number, Set<string>>();
  const gather = (i: number): Set<string> => {
    const node = tree.nodes[i];
    const set = new Set<string>();
    if (node.radix === 1) {
      for (const key of perLeaf.get(i) ?? []) set.add(key);
    } else {
      for (const c of node.children) for (const key of gather(c)) set.add(key);
    }
    out.set(i, set);
    return set;
  };
  gather(0);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
describe("Q1 — the containment theorem is about descent, not about four", () => {
  /**
   * ANCHOR. Before anything is claimed about k = 3 it has to be shown that the
   * generic cut IS this codebase's cut at k = 2 — otherwise the rep-9 result
   * would be about some other lattice. Compared as point sets at every depth,
   * because the vertex ORDER differs by a cyclic rotation on the inverted
   * child and that is not a geometric difference.
   */
  it("the k = 2 instance of the generic cut is figure.ts's `ifs` convention", () => {
    for (const depth of [1, 2, 3]) {
      const N = 2 ** depth;
      const mine = leaves(2, depth)
        .map((l) => triKey(l.tri, N))
        .sort();
      const theirs = buildFigure(depth, "ifs")
        .cells.map((c) => triKey({ v: c.bary, den: N }, N))
        .sort();
      expect(mine).toEqual(theirs);
      expect(mine.length).toBe(4 ** depth);
    }
  });

  /** The children law, exhaustive, at three radices. */
  it("k² distinct children, k^(2δ) descendants, every child round-trips", () => {
    for (const [k, depth] of [
      [2, 6],
      [3, 4],
      [4, 3],
    ] as const) {
      expect(alphabet(k).length).toBe(k * k);
      expect(upCount(k) + downCount(k)).toBe(k * k);
      const seen = new Set<string>();
      const walk = (tri: Tri, d: number) => {
        if (d === depth) return;
        const kids = subdivide(tri, k);
        expect(kids.length).toBe(k * k);
        const keys = kids.map((t) => triKey(t, k ** depth));
        expect(new Set(keys).size).toBe(k * k);
        for (const key of keys) {
          // no cell claimed by two parents: a key may only be minted once
          expect(seen.has(key)).toBe(false);
          seen.add(key);
        }
        for (const kid of kids) walk(kid, d + 1);
      };
      walk(ROOT, 0);
      // 4^δ / 9^δ / 16^δ exact, δ = 1..depth
      for (let delta = 1; delta <= depth; delta++) {
        expect(leaves(k, delta).length).toBe((k * k) ** delta);
      }
    }
  });

  /**
   * MATH-76's own gate, reproduced on this lattice at k = 2, then run again at
   * k = 3. The geometric side is decided by `containsCentroid` — exact
   * cross-multiplied half-plane inequalities that share no code with the
   * subdivision. `onBoundary` is counted separately: a fine centroid landing on
   * a coarse edge is the only way this can fail, and it must never happen.
   *
   *   k = 2, d = 6, 16 depth-2 roots × 4,096 fine cells =  65,536 tests
   *   k = 2, d = 6, all 20 roots      × 4,096 fine cells =  81,920 tests
   *   k = 3, d = 4, 90 roots (9 + 81) × 6,561 fine cells = 590,490 tests
   */
  it("descent equals centroid-in-footprint: 65,536 + 590,490 tests, 0 mismatches", () => {
    const report: Record<string, number> = {};
    for (const [k, depth] of [
      [2, 6],
      [3, 4],
    ] as const) {
      const N = k ** depth;
      const fine = leaves(k, depth);
      const keys = fine.map((f) => triKey(f.tri, N));
      const cents = fine.map((f) => centroid(f.tri));
      expect(new Set(keys).size).toBe(fine.length);
      let tests = 0;
      let mismatches = 0;
      let boundary = 0;
      for (const rootDepth of [1, 2]) {
        const claims = new Array<number>(fine.length).fill(0);
        for (const node of leaves(k, rootDepth)) {
          const descendants = new Set(
            fine.filter((f) => isPrefix(node.word, f.word)).map((f) => triKey(f.tri, N))
          );
          expect(descendants.size).toBe((k * k) ** (depth - rootDepth));
          for (let i = 0; i < fine.length; i++) {
            tests++;
            const c = containsCentroid(node.tri, cents[i]);
            if (c.onBoundary) boundary++;
            if (c.inside !== descendants.has(keys[i])) mismatches++;
            if (c.inside) claims[i]++;
          }
        }
        // the roots at one depth tile the frame: every fine cell claimed once
        expect(claims.every((n) => n === 1)).toBe(true);
      }
      report[`k${k}`] = tests;
      expect(mismatches).toBe(0);
      expect(boundary).toBe(0);
    }
    expect(report).toEqual({ k2: 81920, k3: 590490 });
  });

  /**
   * The canvas survives. `hexagon.ts` assembles six copies of the base triangle
   * around a shared apex and refuses to build if two cells collide on an exact
   * lattice key. That construction depends on the 60° apex angle and on the
   * cells being lattice triangles — not on the radix — so the same collision
   * check is run here on a rep-9 figure: 6 × 9^d distinct keys, no collisions.
   *
   * This is the load-bearing fact for "would rep-9 fit FOURFOLD": the hexagon
   * canvas, the D₆ index law and the exact key lookup all carry over unchanged.
   */
  it("six rep-9 sectors tile the hexagon with no key collision", () => {
    for (const depth of [1, 2, 3]) {
      const cells = leaves(3, depth);
      const keys = new Set<string>();
      for (let s = 0; s < 6; s++) {
        for (const c of cells) {
          const pts = c.tri.v.map((b) => rotK(baryToLat(b), s));
          const key = latKey([
            pts[0][0] + pts[1][0] + pts[2][0],
            pts[0][1] + pts[1][1] + pts[2][1],
          ]);
          expect(keys.has(key)).toBe(false);
          keys.add(key);
        }
      }
      expect(keys.size).toBe(6 * 9 ** depth);
    }
  });

  /**
   * GUARD-FIRE. One child displaced by a single unit of the refinement grid —
   * still congruent, still the right size, still in the right parent's child
   * list — and both the geometric agreement and the frame accounting must go
   * red. Run at BOTH radices so the rep-9 gate is known to be as sharp as the
   * rep-4 one.
   */
  it("one child displaced by one lattice unit breaks both gates, at k = 2 and k = 3", () => {
    for (const k of [2, 3]) {
      const tree = buildTree((path) => (path.length < 2 ? k : 1));
      const N = tree.refinement;
      expect(N).toBe(k * k);
      const fine = subdivide(ROOT, N);
      const keys = fine.map((t) => triKey(t, N));
      const cents = fine.map(centroid);
      const victim = tree.leaves[1];
      const mutant = shiftNode(tree, victim, N);
      const sets = descentSets(mutant, N);
      // (a) frame accounting: the leaves no longer claim every cell once
      let badClaims = 0;
      for (let i = 0; i < fine.length; i++) {
        let claims = 0;
        for (const li of mutant.leaves) {
          if (containsCentroid(mutant.nodes[li].tri, cents[i]).inside) claims++;
        }
        if (claims !== 1) badClaims++;
      }
      expect(badClaims).toBeGreaterThan(0);
      // (b) geometric agreement: the victim's PARENT is untouched, so its
      // descendant set — which now contains a displaced child — no longer
      // equals the set its own footprint holds
      const parent = mutant.nodes[mutant.nodes[victim].parent];
      const descent = sets.get(parent.index) as Set<string>;
      let mismatches = 0;
      for (let i = 0; i < fine.length; i++) {
        if (containsCentroid(parent.tri, cents[i]).inside !== descent.has(keys[i])) mismatches++;
      }
      expect(mismatches).toBeGreaterThan(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe("Q2 — mixed radix: the real gate", () => {
  /**
   * The condition, stated as a computation. Refinements COMPOSE by multiplying
   * edge divisions, and they commute: rep-4 then rep-9, rep-9 then rep-4 and a
   * single rep-36 cut all produce the SAME 36 triangles. This is what makes a
   * common refinement grid exist, and it is checked as point-set equality
   * rather than argued.
   */
  it("refinement composes and commutes: rep-4 ∘ rep-9 = rep-9 ∘ rep-4 = rep-36", () => {
    for (const [a, b] of [
      [2, 3],
      [3, 2],
      [2, 2],
      [3, 3],
      [2, 6],
      [4, 3],
    ] as const) {
      const twoStep = subdivide(ROOT, a)
        .flatMap((t) => subdivide(t, b))
        .map((t) => triKey(t, a * b))
        .sort();
      const oneStep = subdivide(ROOT, a * b)
        .map((t) => triKey(t, a * b))
        .sort();
      expect(twoStep).toEqual(oneStep);
      expect(twoStep.length).toBe((a * b) ** 2);
    }
  });

  /**
   * THE ANSWER TO Q2. Three trees whose radix is a function of the node:
   *
   *   MIX-A  rep-4 root; children rep-9, rep-4, rep-9, LEAF.
   *          Mixed radix AND mixed depth at once — a depth-1 leaf beside
   *          depth-2 leaves of two different scales. N = 12.
   *   MIX-B  rep-4 root; children rep-9, rep-16, rep-9, rep-4. N = 24.
   *   MIX-C  rep-9 root, then rep-4 or rep-9 by the parent digit's parity,
   *          three levels. 354 leaves at the SAME DEPTH and three different
   *          scales (12, 18, 27). N = 108.
   *
   * For each: every node's descendant set (descent, through the tree's own
   * radices) equals its centroid-in-footprint set (geometry, independent
   * oracle), the leaves partition the common refinement exactly once, and no
   * centroid ever lands on a node boundary.
   */
  it("mixed-radix descent equals geometry, and the leaves partition the frame", () => {
    const schedules: [string, (p: readonly number[]) => number, number][] = [
      ["MIX-A", (p) => (p.length === 0 ? 2 : p.length === 1 ? [3, 2, 3, 1][p[0]] : 1), 12],
      ["MIX-B", (p) => (p.length === 0 ? 2 : p.length === 1 ? ([3, 4, 3, 2][p[0]] ?? 1) : 1), 24],
      [
        "MIX-C",
        (p) => (p.length >= 3 ? 1 : p.length === 0 ? 3 : p[p.length - 1] % 2 === 0 ? 2 : 3),
        108,
      ],
    ];
    const totals: Record<string, number> = {};
    for (const [name, radixAt, expectedN] of schedules) {
      const tree = buildTree(radixAt);
      const N = tree.refinement;
      expect(N).toBe(expectedN);
      const fine = subdivide(ROOT, N);
      const keys = fine.map((t) => triKey(t, N));
      const cents = fine.map(centroid);
      const sets = descentSets(tree, N);
      let tests = 0;
      let mismatches = 0;
      let boundary = 0;
      const claims = new Array<number>(fine.length).fill(0);
      for (const node of tree.nodes) {
        const want = sets.get(node.index) ?? new Set<string>();
        // a node holds exactly (N/den)² cells of the common refinement — the
        // mixed-radix form of §9's 4^δ, with the scale doing what depth did
        expect(want.size).toBe((N / node.tri.den) ** 2);
        for (let i = 0; i < fine.length; i++) {
          tests++;
          const c = containsCentroid(node.tri, cents[i]);
          if (c.onBoundary) boundary++;
          if (c.inside !== want.has(keys[i])) mismatches++;
          if (c.inside && node.radix === 1) claims[i]++;
        }
      }
      expect(mismatches).toBe(0);
      expect(boundary).toBe(0);
      expect(claims.every((n) => n === 1)).toBe(true);
      totals[name] = tests;
    }
    expect(totals).toEqual({ "MIX-A": 3888, "MIX-B": 24768, "MIX-C": 4898880 });
  });

  /**
   * The seam is the interesting place: a fine cell whose neighbour across an
   * edge belongs to a leaf of a DIFFERENT scale. If mixed radix could crack,
   * it would crack here. Counted, and every seam cell is claimed exactly once
   * by construction of the partition above.
   */
  it("seams between different-radix leaves are counted, and hold", () => {
    const tree = buildTree((p) =>
      p.length === 0 ? 2 : p.length === 1 ? ([3, 4, 3, 2][p[0]] ?? 1) : 1
    );
    const N = tree.refinement;
    const fine = subdivide(ROOT, N);
    const cents = fine.map(centroid);
    const owner = fine.map((_, i) => {
      const found = tree.leaves.filter(
        (li) => containsCentroid(tree.nodes[li].tri, cents[i]).inside
      );
      expect(found.length).toBe(1);
      return found[0];
    });
    const edges = new Map<string, number[]>();
    fine.forEach((t, i) => {
      const vs = t.v.map((p) => p.join(":"));
      for (let a = 0; a < 3; a++) {
        const key = [vs[a], vs[(a + 1) % 3]].sort().join("|");
        edges.set(key, [...(edges.get(key) ?? []), i]);
      }
    });
    const seam = new Set<number>();
    for (const cells of edges.values()) {
      if (cells.length !== 2) continue;
      const [a, b] = cells;
      const da = tree.nodes[owner[a]].tri.den;
      const db = tree.nodes[owner[b]].tri.den;
      if (owner[a] !== owner[b] && da !== db) {
        seam.add(a);
        seam.add(b);
      }
    }
    expect(seam.size).toBe(69);
  });

  /**
   * THE COST, and the reason this is not a free generalisation: under mixed
   * radix DEPTH NO LONGER DETERMINES RESOLUTION. MIX-C's 354 leaves are all at
   * depth 3 and come in three different scales. Anything that keys a buffer,
   * a quality field or a band by depth — as MATH-76's foveation does — is
   * keying on the wrong number the moment two radices meet.
   */
  it("depth stops being resolution: same depth, three different scales", () => {
    const tree = buildTree((p) =>
      p.length >= 3 ? 1 : p.length === 0 ? 3 : p[p.length - 1] % 2 === 0 ? 2 : 3
    );
    const depths = new Set(tree.leaves.map((i) => tree.nodes[i].path.length));
    const scales = new Set(tree.leaves.map((i) => tree.nodes[i].tri.den));
    expect([...depths]).toEqual([3]);
    expect([...scales].sort((a, b) => a - b)).toEqual([12, 18, 27]);
    // and the resolution order that DOES survive is divisibility of the scale
    for (const s of scales) expect(tree.refinement % s).toBe(0);
  });

  /** GUARD-FIRE on the mixed tree, same displacement as Q1. */
  it("a one-unit displacement inside a mixed tree breaks the partition", () => {
    const tree = buildTree((p) =>
      p.length === 0 ? 2 : p.length === 1 ? ([3, 4, 3, 2][p[0]] ?? 1) : 1
    );
    const N = tree.refinement;
    const fine = subdivide(ROOT, N);
    const cents = fine.map(centroid);
    const mutant = shiftNode(tree, tree.leaves[1], N);
    let bad = 0;
    for (let i = 0; i < fine.length; i++) {
      let claims = 0;
      for (const li of mutant.leaves) {
        if (containsCentroid(mutant.nodes[li].tri, cents[i]).inside) claims++;
      }
      if (claims !== 1) bad++;
    }
    expect(bad).toBe(7);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe("Q3 — the charge group, or the obstruction", () => {
  /**
   * THE OBSTRUCTION, in one line of geometry. A group automorphism fixes the
   * identity, so a charge group needs a letter fixed by the rotation. There is
   * one iff 3 ∤ k — and rep-9 is the first radix that fails.
   *
   * The reflections are never the problem: each fixes exactly k letters.
   */
  it("a rotation-fixed letter exists iff 3 ∤ k", () => {
    const rows = [2, 3, 4, 5, 6, 7, 8, 9].map((k) => ({
      k,
      children: k * k,
      rotFixed: fixedLetters(k, S3[1].perm).length,
      mirrorFixed: fixedLetters(k, S3[3].perm).length,
    }));
    for (const r of rows) {
      expect(r.rotFixed).toBe(r.k % 3 === 0 ? 0 : 1);
      expect(r.mirrorFixed).toBe(r.k);
    }
    // and the fixed letter, when it exists, is the hub: fixed by ALL of D₃
    for (const k of [2, 4, 5, 7, 8]) {
      const common = S3.map((s) => new Set(fixedLetters(k, s.perm))).reduce((a, b) =>
        new Set([...a].filter((x) => b.has(x)))
      );
      expect(common.size).toBe(1);
    }
    for (const k of [3, 6, 9]) {
      const common = S3.map((s) => new Set(fixedLetters(k, s.perm))).reduce((a, b) =>
        new Set([...a].filter((x) => b.has(x)))
      );
      expect(common.size).toBe(0);
    }
  });

  /**
   * EXHAUSTIVE, and this is the refutation. There are exactly two groups of
   * order 9. Over both of them and all 9! = 362,880 labellings of the rep-9
   * alphabet — 725,760 candidates — NOT ONE makes the D₃ action a group
   * automorphism. rep-9 has no charge group in the sense `figure.ts` means.
   *
   * The same search at rep-4 finds 6 labellings, and every one of them sends
   * the inverted centre X to the identity: the geometrically natural charge
   * basepoint is X, not A. (figure.ts uses A ↦ 1, which differs by a fixed
   * translation — harmless, because V4 is elementary abelian, but it is why
   * the codebase's rotation is not a charge automorphism either.)
   */
  it("no group law on Σ₉ makes D₃ act by automorphisms — 725,760 candidates", () => {
    const nine = {
      Z3xZ3: searchLabellings(3, "Z3xZ3"),
      Z9: searchLabellings(3, "Z9"),
    };
    expect(nine.Z3xZ3.automorphic).toBe(0);
    expect(nine.Z9.automorphic).toBe(0);

    const four = { V4: searchLabellings(2, "V4"), Z4: searchLabellings(2, "Z4") };
    expect(four.V4.automorphic).toBe(6);
    expect(four.Z4.automorphic).toBe(0);

    // every surviving rep-4 labelling puts the inverted centre at the identity
    const g = GROUPS.V4;
    const gens = [childPermutation(2, S3[1].perm), childPermutation(2, S3[3].perm)];
    let checked = 0;
    eachPermutation(4, (phi) => {
      const inv = new Array<number>(4);
      phi.forEach((v, d) => (inv[v] = d));
      const ok = gens.every((pi) =>
        isAutomorphism(
          g,
          Array.from({ length: 4 }, (_, x) => phi[pi[inv[x]]])
        )
      );
      if (ok) {
        expect(phi[3]).toBe(0); // digit 3 is X, the inverted centre
        checked++;
      }
    });
    expect(checked).toBe(6);
  });

  /**
   * WHAT DOES EXIST. Drop "automorphism" to "affine map" — that is, keep the
   * group acting but give up the basepoint — and rep-9 comes back: 1,296
   * labellings survive, and ℤ/9 still admits none. So (ℤ/3)² IS forced, and
   * the owner's instinct was right about the group and wrong about its role:
   * Σ₉ is a (ℤ/3)²-TORSOR, not a (ℤ/3)²-valued charge.
   *
   * 1,296 = 3 × 432 = 3 × |AGL(2,3)|: three genuinely distinct torsor
   * structures, each with the full affine group acting freely on its class.
   * At rep-4 the same count is 24 = 1 × |AGL(2,2)| = 4!, so at rep-4 "affine"
   * is vacuous — every relabelling of four charges is affine — and the
   * informative number there is the automorphism count 6.
   */
  it("Σ₉ is a (ℤ/3)² torsor: 1,296 affine labellings, ℤ/9 none", () => {
    expect(searchLabellings(3, "Z3xZ3").affine).toBe(1296);
    expect(searchLabellings(3, "Z9").affine).toBe(0);
    expect(searchLabellings(2, "V4").affine).toBe(24);
    expect(searchLabellings(2, "Z4").affine).toBe(0);
    expect(affineBijections(GROUPS.Z3xZ3).length).toBe(432);
    expect(affineBijections(GROUPS.V4).length).toBe(24);
    expect(1296 / 432).toBe(3);
  });

  /**
   * The rotation is a PURE TRANSLATION of the torsor — linear part exactly the
   * identity — which has a consequence worth stating on its own: the rotation
   * twist c(ρw) − c(w) is a single global constant n·t at depth n, taking ONE
   * value over the whole figure, versus rep-4's four twist classes (which is
   * docs/symmetry-findings.md §B's three ftype classes plus the hub).
   *
   * So rep-9's rotation is not messier than rep-4's. It is cleaner, and the
   * price is paid entirely on the basepoint.
   */
  it("the rotation is a translation; its twist is one constant per depth", () => {
    const g = GROUPS.Z3xZ3;
    const phi = searchLabellings(3, "Z3xZ3").witness;
    expect(phi).not.toBeNull();
    const label = phi as number[];
    const inv = new Array<number>(9);
    label.forEach((v, d) => (inv[v] = d));
    const induced = Array.from(
      { length: 9 },
      (_, x) => label[childPermutation(3, S3[1].perm)[inv[x]]]
    );
    const invs = g.map((row) => row.indexOf(0));
    const linear = induced.map((x) => g[x][invs[induced[0]]]);
    expect(linear).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]); // identity: a translation
    expect(isAffine(g, induced)).toBe(true);
    expect(isAutomorphism(g, induced)).toBe(false);

    const twistsAt = (k: number, groupName: string, lab: number[], depth: number) => {
      const gg = GROUPS[groupName];
      const gi = gg.map((row) => row.indexOf(0));
      const cells = leaves(k, depth);
      const N = k ** depth;
      const byKey = new Map(cells.map((c, i) => [triKey(c.tri, N), i]));
      const out = new Set<number>();
      for (const c of cells) {
        const j = byKey.get(triKey(permuteTri(c.tri, S3[1].perm), N));
        expect(j).toBeDefined();
        const a = wordCharge(gg, lab, c.word);
        const b = wordCharge(gg, lab, cells[j as number].word);
        out.add(gg[b][gi[a]]);
      }
      return out;
    };
    // rep-9: one twist value at every depth, and it is n·t (t = 2 here)
    expect([...twistsAt(3, "Z3xZ3", label, 1)]).toEqual([2]);
    expect([...twistsAt(3, "Z3xZ3", label, 2)]).toEqual([1]);
    expect([...twistsAt(3, "Z3xZ3", label, 3)]).toEqual([0]);
    expect([...twistsAt(3, "Z3xZ3", label, 4)]).toEqual([2]);
    // rep-4 for contrast: four twist classes at every depth
    const four = [3, 2, 1, 0]; // X ↦ identity, the automorphic labelling
    for (const d of [1, 2, 3, 4]) expect(twistsAt(2, "V4", four, d).size).toBe(4);
  });

  /**
   * The charge FIELD, measured exactly as `hexagon.ts`'s `hexIsometryReport`
   * measures it: for each symmetry, the best relabelling of the palette and how
   * many cells it carries, exhaustive over relabellings.
   *
   * Rotations are EXACT at every depth and every radix. Mirrors are partial and
   * DECAY with depth at both radices:
   *
   *   rep-4  13/16 .8125 → 43/64 .6719 → 148/256 .5781 → 511/1024 .4990
   *   rep-9  54/81 .6667 → 405/729 .5556 → 3645/6561 .5556 → 26244/59049 .4444
   *
   * REFUTED IN PASSING, and recorded because it was written here first: the
   * comment in an earlier draft of this file claimed rep-9 "settles at exactly
   * 5/9" on the strength of depths 3 and 4 agreeing. Depth 5 is 4/9. Two equal
   * terms are not a limit. Both radices decay; neither is measured to a floor.
   *
   * So §G's "the reflections are messier" is a property of the FIGURE, not of
   * the radix, and rep-9 is not worse than rep-4 here.
   */
  it("charge-field equivariance: rep-9 matches rep-4's shape", () => {
    const table: Record<string, Record<string, string>> = {};
    for (const [k, name, label] of [
      [2, "V4", [3, 2, 1, 0]],
      [3, "Z3xZ3", searchLabellings(3, "Z3xZ3").witness as number[]],
    ] as const) {
      const g = GROUPS[name];
      const maps = affineBijections(g);
      for (const depth of [2, 3, 4, 5]) {
        const cells = leaves(k, depth);
        const N = k ** depth;
        const byKey = new Map(cells.map((c, i) => [triKey(c.tri, N), i]));
        const row: Record<string, string> = {};
        for (const s of S3) {
          const pairs = cells.map((c) => {
            const j = byKey.get(triKey(permuteTri(c.tri, s.perm), N)) as number;
            return [wordCharge(g, label, c.word), wordCharge(g, label, cells[j].word)] as const;
          });
          const r = bestRelabelling(g, pairs, maps);
          row[s.name] = `${r.matches}/${r.total}`;
        }
        table[`k${k}d${depth}`] = row;
      }
    }
    // rotations exact everywhere
    for (const key of Object.keys(table)) {
      const row = table[key];
      expect(row["rot+"]).toBe(row.id);
      expect(row["rot-"]).toBe(row.id);
      expect(row.m_A).toBe(row.m_B);
      expect(row.m_A).toBe(row.m_C);
    }
    expect([table.k2d2.m_A, table.k2d3.m_A, table.k2d4.m_A, table.k2d5.m_A]).toEqual([
      "13/16",
      "43/64",
      "148/256",
      "511/1024",
    ]);
    expect([table.k3d2.m_A, table.k3d3.m_A, table.k3d4.m_A, table.k3d5.m_A]).toEqual([
      "54/81",
      "405/729",
      "3645/6561",
      "26244/59049",
    ]);
    // the depth-5 term is what refutes "settles at 5/9": 26244/59049 = 4/9
    expect(26244 * 9).toBe(59049 * 4);
  });

  /**
   * (c) — how the symmetries move addresses. The answer is radix-independent
   * and it generalises §A: D₃ acts by a TRANSDUCER whose state is an element
   * of S₃, changing only when the descent passes through an INVERTED child.
   *
   *   rotations   state never changes  ⇒ a uniform digit rewrite at every level
   *   reflections m_A → m_B → m_C on each inverted digit
   *
   * At rep-4 in the `apex` convention this is what appears as "rotate the first
   * non-X digit": there the rotation's residual is absorbed into the corner
   * children's frames and X is the one child that cannot absorb it, because a
   * frame fixed by a 3-cycle would have to be an ordered triple equal to its
   * own rotation. At rep-9 no child is rotation-fixed, so every child CAN
   * absorb it — the apex-style single-digit rotation law exists at rep-9 with
   * no hub exception at all.
   */
  it("the address law is a transducer keyed on orientation, at every radix", () => {
    for (const k of [2, 3, 4, 5]) {
      const inverted = alphabet(k).map((d) => d.inverted);
      for (const [si, s] of S3.entries()) {
        const res = frameResidual(k, s.perm);
        const onUp = new Set(res.filter((_, d) => !inverted[d]));
        const onDown = new Set(res.filter((_, d) => inverted[d]));
        expect(onUp.size).toBe(1);
        if (onDown.size > 0) expect(onDown.size).toBe(1);
        const up = [...onUp][0];
        const down = onDown.size ? [...onDown][0] : up;
        // rotations: the state survives an inverted child; mirrors advance
        if (si <= 2) expect(down).toBe(up);
        else expect(down).not.toBe(up);
      }
      // and the rotation being a uniform digit rewrite is checkable directly
      const depth = k <= 3 ? 3 : 2;
      const N = k ** depth;
      const cells = leaves(k, depth);
      const byKey = new Map(cells.map((c, i) => [triKey(c.tri, N), i]));
      const pi = childPermutation(k, S3[1].perm);
      for (const c of cells) {
        const j = byKey.get(triKey(permuteTri(c.tri, S3[1].perm), N)) as number;
        expect(cells[j].word).toEqual(c.word.map((d) => pi[d]));
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe("Q4 — rings, and the senary numeral", () => {
  /**
   * CONFIRMED, with the boundary sharpened. Subdivision is a SCALING by an
   * integer edge division, so every coordinate stays an integer over a product
   * of radices. Nothing in this module divides, no √ appears, and the geometric
   * oracle decides in ℤ. The single √3 the figure needs lives in the
   * projection to pixels (`figure.ts` toXY, `hexagon.ts` latticeToPixel) and is
   * untouched by the radix.
   */
  it("every coordinate is an integer over a product of edge divisions", () => {
    const tree = buildTree((p) =>
      p.length >= 3 ? 1 : p.length === 0 ? 3 : p[p.length - 1] % 2 === 0 ? 2 : 3
    );
    const smooth = (n: number) => {
      let m = n;
      for (const p of [2, 3]) while (m % p === 0) m /= p;
      return m === 1;
    };
    for (const node of tree.nodes) {
      expect(smooth(node.tri.den)).toBe(true);
      let product = 1;
      let cur = node;
      while (cur.parent >= 0) {
        product *= tree.nodes[cur.parent].radix;
        cur = tree.nodes[cur.parent];
      }
      expect(node.tri.den).toBe(product);
      for (const v of node.tri.v) {
        for (const x of v) expect(Number.isInteger(x)).toBe(true);
        expect(v[0] + v[1] + v[2]).toBe(node.tri.den);
      }
    }
  });

  /**
   * The cost law. The denominator after a descent is EXACTLY the product of
   * the edge divisions, whatever order they were applied in, so bits of
   * denominator = Σ log₂ kᵢ = log₂(edge division reached). Exactness costs the
   * same per unit of resolution at every radix; rep-9 is not more expensive
   * than rep-4, it just arrives in bigger steps.
   *
   * What DOES change: rep-4's denominators are powers of two (the shifts
   * `figure.ts` relies on with `2 ** depth` and `(p+q)/2`); mixed denominators
   * are only 3-smooth. That is a real edit to the exact-arithmetic invariant —
   * and note this module needs no division at all, because it multiplies the
   * denominator up instead of halving coordinates down.
   */
  it("the denominator is the product of edge divisions, schedule-independent", () => {
    for (const schedule of [
      [2, 2, 3],
      [3, 2, 2],
      [2, 3, 2],
      [12],
      [4, 3],
      [3, 4],
    ]) {
      let tri = ROOT;
      for (const k of schedule) tri = subdivide(tri, k)[0];
      expect(tri.den).toBe(schedule.reduce((a, b) => a * b, 1));
    }
    // same product ⇒ the same fine grid, whatever the schedule
    const grids = [
      [2, 2, 3],
      [3, 2, 2],
      [12],
    ].map((schedule) => {
      let tris = [ROOT];
      for (const k of schedule) tris = tris.flatMap((t) => subdivide(t, k));
      return tris.map((t) => triKey(t, 12)).sort();
    });
    expect(grids[1]).toEqual(grids[0]);
    expect(grids[2]).toEqual(grids[0]);
    expect(grids[0].length).toBe(144);
  });

  /**
   * Where a new ring WOULD come from — and it is not the radix, it is the
   * child COUNT. The aligned family divides the edge by an integer k and
   * produces k² children, so the admissible child counts are exactly the
   * perfect squares. A rep-3 cut (three children) would need edge ratio 1/√3
   * and a 30° turn: an irrational scaling, ℤ[√3] in the coordinates, and
   * §11's Niven boundary reappearing in the SUBDIVISION rather than in the
   * polygon anchors. rep-9 is a scaling by 3 and stays in ℤ.
   */
  it("admissible child counts are exactly the perfect squares", () => {
    const admissible: number[] = [];
    for (let m = 2; m <= 40; m++) {
      const k = Math.round(Math.sqrt(m));
      if (k * k === m) {
        expect(subdivide(ROOT, k).length).toBe(m);
        admissible.push(m);
      }
    }
    expect(admissible).toEqual([4, 9, 16, 25, 36]);
    // 36 = 4 × 9 is a single admissible cut AND the composite of the two,
    // which is why the "one senary digit per level" reading is a coincidence
    // of notation: the numeral lives on the EDGE division (6 = 2 × 3), and
    // the child count is its square.
    expect(subdivide(ROOT, 6).length).toBe(36);
    expect(upCount(6)).toBe(21);
    expect(downCount(6)).toBe(15);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// The rep-9 follow-on. Q3 above left two holes — no canonical charge
// basepoint, and "the split needs a transversal … and none is distinguished".
// Everything below decides whether those holes are real. Both are, in part,
// and both are smaller than Q3 believed.
// ─────────────────────────────────────────────────────────────────────────

describe("rep-9 A — is there a canonical basepoint, or must one be chosen?", () => {
  /**
   * THE STRUCTURE EVERYTHING ELSE RESTS ON, and it is two objects rather than
   * the one the brief expected.
   *
   *   P₁ = the rotation's orbits           {0,3,5} {1,2,4} {6,7,8}
   *   P₂ = the mirrors' fixed sets         {0,4,6} {2,3,7} {1,5,8}
   *
   * Each is a partition of Σ₉ into three 3-sets, and every line of one meets
   * every line of the other exactly once. So they COORDINATISE the alphabet
   * with no group, no labelling and no search: Σ₉ ≅ P₁ × P₂.
   *
   * P₂ partitioning is a rep-9 accident and the test says so: three mirrors fix
   * k letters each, and 3k = k² only at k = 3. At every other radix tested the
   * three sets OVERLAP, and what they overlap in is the D₃-fixed letter — the
   * hub. So "rep-9 has no hub" and "rep-9 has an arm partition" are one fact
   * about one family of three sets, seen from two sides.
   */
  it("Σ₉ carries two canonical parallel classes — and P₂ partitions only at k = 3", () => {
    expect(rotationOrbits(3)).toEqual([
      [0, 3, 5],
      [1, 2, 4],
      [6, 7, 8],
    ]);
    expect(mirrorFixedSets(3)).toEqual([
      [0, 4, 6],
      [2, 3, 7],
      [1, 5, 8],
    ]);
    expect(isPartition(rotationOrbits(3), 9)).toBe(true);
    expect(isPartition(mirrorFixedSets(3), 9)).toBe(true);
    // transverse: each rotation orbit meets each mirror set in exactly one letter
    for (const orbit of rotationOrbits(3)) {
      for (const line of mirrorFixedSets(3)) {
        expect(orbit.filter((d) => line.includes(d)).length).toBe(1);
      }
    }
    // and the accident, over the whole sweep k = 2..9
    const report: Record<number, { partitions: boolean; common: number }> = {};
    for (const k of [2, 3, 4, 5, 6, 7, 8, 9]) {
      const sets = mirrorFixedSets(k);
      expect(sets.every((s) => s.length === k)).toBe(true);
      report[k] = {
        partitions: isPartition(sets, k * k),
        common: sets.reduce((a, b) => a.filter((x) => b.includes(x))).length,
      };
    }
    expect(report).toEqual({
      2: { partitions: false, common: 1 },
      3: { partitions: true, common: 0 },
      4: { partitions: false, common: 1 },
      5: { partitions: false, common: 1 },
      6: { partitions: false, common: 0 },
      7: { partitions: false, common: 1 },
      8: { partitions: false, common: 1 },
      9: { partitions: false, common: 0 },
    });
  });

  /**
   * (a) AND (b) ARE THE SAME QUESTION. The three inverted letters are not
   * merely A line: they are one of the rotation's own orbits, decided here by
   * set equality and not by a labelling. So the parallel class of the inverted
   * line IS the rotation-orbit partition, the two leads cannot compete, and
   * confirming one confirms the other.
   *
   * The other two classes are just as nameable — the CORNER letters are the
   * three that share a vertex with the parent (decided geometrically in
   * `cornerLetters`), the remaining three are the uprights that do not. So P₁'s
   * three lines are individually distinguishable and one of them, the inverted
   * one, is the analogue of rep-4's X.
   */
  it("the inverted letters ARE a rotation orbit — (a) and (b) are one partition", () => {
    const inverted = alphabet(3)
      .filter((d) => d.inverted)
      .map((d) => d.index);
    expect(inverted).toEqual([6, 7, 8]);
    expect(rotationOrbits(3)).toContainEqual(inverted);
    expect(cornerLetters(3)).toEqual([0, 3, 5]);
    expect(rotationOrbits(3)).toContainEqual(cornerLetters(3));
    const c = canonicalCoords(3);
    expect(c.gradeClasses).toEqual([
      [6, 7, 8],
      [0, 3, 5],
      [1, 2, 4],
    ]);
    expect([...c.grade]).toEqual([1, 2, 2, 1, 2, 1, 0, 0, 0]);
    expect([...c.vertex]).toEqual([0, 2, 1, 1, 0, 2, 0, 1, 2]);
    // the coordinates exist at k = 3 and refuse to exist anywhere else
    for (const k of [2, 4, 5, 6, 7]) expect(() => canonicalCoords(k)).toThrow();
  });

  /**
   * WHERE THE BRIEF'S LEAD (a) IS ONLY THREE-QUARTERS RIGHT, and the correction
   * matters. "Is the inverted set a line" is not a question about Σ₉; it is a
   * question about Σ₉ TOGETHER WITH an affine structure, and there are three.
   *
   * The 1,296 affine labellings fall into exactly 3 classes of 432 under
   * recolouring — AGL(2,3), whose orbits are the classes of equal LINE SET. In
   * one of them the inverted set is a line and every rotation orbit is a line;
   * in the other two it is not. The one where it is, is exactly the one where
   * the rotation is a pure translation.
   *
   * That sharpens `docs/rep-tile-findings.md`, which recorded "the rotation's
   * linear part is exactly the identity [PROVEN]" from a single witness. It is
   * a property of ONE of the three structures, not of the torsor; in the other
   * two the linear part is a transvection and the rotation twist takes three
   * values per depth instead of one. So the structure is not free — it is
   * selected by a property already measured and already wanted.
   *
   * The mirror sets are lines in ALL THREE, which is forced: the fixed set of
   * an affine map is an affine subspace, and a 3-element affine subspace of
   * AG(2,3) is a line. Checked rather than assumed.
   */
  it("the inverted set is a line in exactly 1 of the 3 structures — the translation one", () => {
    expect(affineLabellings().length).toBe(1296);
    expect(searchLabellings(3, "Z3xZ3").affine).toBe(affineLabellings().length);
    const all = structures();
    expect(all.length).toBe(3);
    expect(all.map((s) => s.labellings)).toEqual([432, 432, 432]);
    expect(all.every((s) => s.mirrorSetsAreLines)).toBe(true);
    const translation = all.filter((s) => s.rotationIsTranslation);
    expect(translation.length).toBe(1);
    expect(translation[0].invertedIsLine).toBe(true);
    expect(translation[0].rotationOrbitsAreLines).toBe(true);
    for (const s of all.filter((x) => !x.rotationIsTranslation)) {
      expect(s.invertedIsLine).toBe(false);
      expect(s.rotationOrbitsAreLines).toBe(false);
      // a transvection: unipotent, order 3, no fixed letter
      expect(
        linearPart(GROUPS.Z3xZ3, inducedMap(s.witness, childPermutation(3, S3[1].perm)))
      ).toEqual([0, 4, 8, 3, 7, 2, 6, 1, 5]);
    }
    // and the price of the two rejected structures, measured
    const g = GROUPS.Z3xZ3;
    const inv = g.map((row) => row.indexOf(0));
    const twistClasses = (label: readonly number[], depth: number) => {
      const cells = leaves(3, depth);
      const image = symmetryImages(cells, 3 ** depth, 1);
      const out = new Set<number>();
      cells.forEach((c, i) => {
        const a = wordCharge(g, label, c.word);
        const b = wordCharge(g, label, cells[image[i]].word);
        out.add(g[b][inv[a]]);
      });
      return out.size;
    };
    for (const depth of [1, 2, 3]) {
      expect(twistClasses(translation[0].witness, depth)).toBe(1);
      for (const s of all.filter((x) => !x.rotationIsTranslation)) {
        expect(twistClasses(s.witness, depth)).toBe(3);
      }
    }
  });

  /**
   * LAYER 2 — the labelling, which a canonical partition does NOT fix. A charge
   * is a value, and turning a fibration into a value needs a functional (φ and
   * 2φ share every fibre and disagree on every value) and, on a torsor, an
   * offset. The chain of counts, each an observed filter over the 1,296:
   *
   *   1,296  affine labellings
   *     144  with the basepoint at letter 6 — the inverted letter fixed by m_A,
   *          which is what "inverted ∧ on the A median" picks out, the direct
   *          analogue of rep-4's forced X ↦ identity
   *       4  with each canonical class on its own factor: the grade classes as
   *          cosets of one axis, the vertex classes as cosets of the other
   *       2  with rot⁺ translating by +1 rather than −1 on the vertex axis
   *
   * The surviving two are `coordLabelling(3, 1)` and `coordLabelling(3, 2)` —
   * constructed from geometry with no search — and they differ by the unique
   * non-trivial automorphism of ℤ/3 on the GRADE axis and by nothing else.
   * That is the named equivalence: the charge is canonical up to which of the
   * two upright classes counts as +1.
   *
   * Note the step that does NOT appear: no filter for the structure. Putting
   * both canonical classes on the coordinate axes already forces it.
   */
  it("the canonical labelling is written down, not searched: 1,296 → 144 → 4 → 2", () => {
    const labs = affineLabellings();
    const coords = canonicalCoords(3);
    const gradeAxis = [0, 1, 2]; // (ℤ/3)² elements with vertex component 0
    const vertexAxis = [0, 3, 6]; // … and with grade component 0
    expect(labs.filter((l) => l[6] === 0).length).toBe(144);
    const axed = labs.filter(
      (l) =>
        l[6] === 0 &&
        coords.vertexClasses[0].every((d) => gradeAxis.includes(l[d])) &&
        coords.gradeClasses[0].every((d) => vertexAxis.includes(l[d]))
    );
    expect(axed.length).toBe(4);
    // no structure filter was applied and yet all four are in the good one
    const key = structures().find((s) => s.rotationIsTranslation)?.key;
    for (const l of axed) {
      expect(groupIntoStructures(GROUPS.Z3xZ3, [l], 3)[0].key).toBe(key);
    }
    const rot = childPermutation(3, S3[1].perm);
    const t0 = inducedMap(coordLabelling(3, 1), rot)[0];
    const oriented = axed.filter((l) => inducedMap(l, rot)[0] === t0);
    expect(oriented.length).toBe(2);
    expect(oriented.map((l) => l.join(","))).toEqual(
      expect.arrayContaining([coordLabelling(3, 1).join(","), coordLabelling(3, 2).join(",")])
    );
    // and the pair differ by negating the grade coordinate, nothing else
    const one = coordLabelling(3, 1);
    const two = coordLabelling(3, 2);
    one.forEach((e, d) => {
      expect(two[d] % 3).toBe((3 - (e % 3)) % 3);
      expect(Math.floor(two[d] / 3)).toBe(Math.floor(e / 3));
    });
  });

  /**
   * WHY THERE ARE EXACTLY TWO CANONICAL FUNCTIONALS AND NOT FOUR. AG(2,3) has
   * four parallel classes; each is a fibration of Σ₉ and so a candidate ℤ/3
   * charge up to scalar and offset. Under D₃:
   *
   *   P₁ rotation orbits    every line fixed by all six symmetries → the GRADE
   *   P₂ mirror fixed sets  class fixed; each line fixed by exactly its own
   *                         mirror, permuted by the rotations → the VERTEX
   *   the two diagonals     SWAPPED with each other by every mirror
   *
   * A charge built on a diagonal would therefore be carried onto a different
   * charge by a reflection of the figure, so neither diagonal can be named. Two
   * of four survive, and they are precisely the two the geometry already gave.
   */
  it("exactly 2 of the 4 fibrations are D₃-canonical; the mirrors swap the other 2", () => {
    const lines = planeLines(GROUPS.Z3xZ3, coordLabelling(3, 1));
    expect(lines.length).toBe(12);
    const norm = (l: readonly number[]) => [...l].sort((a, b) => a - b).join(",");
    const classes: number[][][] = [];
    for (const l of lines) {
      const cl = classes.find((c) => c.every((m) => m.every((x) => !l.includes(x))));
      if (cl) cl.push(l);
      else classes.push([l]);
    }
    expect(classes.length).toBe(4);
    const perms = S3.map((s) => childPermutation(3, s.perm));
    const keyOf = (c: number[][]) => c.map(norm).sort().join("|");
    /** For each class: where each symmetry sends it, and how many of its own
     *  three lines that symmetry fixes individually. */
    const profile = classes.map((c, self) => ({
      lines: c.map(norm).sort(),
      self,
      goesTo: perms.map((p) =>
        classes.findIndex((c2) => keyOf(c2) === keyOf(c.map((l) => l.map((d) => p[d]))))
      ),
      linesFixed: perms.map(
        (p) => c.filter((l) => norm(l.map((d) => p[d])) === norm(l)).length
      ),
    }));
    const rotClass = profile.filter((p) => p.lines.includes("0,3,5"));
    const mirClass = profile.filter((p) => p.lines.includes("0,4,6"));
    expect(rotClass.length).toBe(1);
    expect(mirClass.length).toBe(1);
    // P₁: fixed as a class, and every line fixed by every symmetry — an invariant
    expect(rotClass[0].goesTo.every((x) => x === rotClass[0].self)).toBe(true);
    expect(rotClass[0].linesFixed).toEqual([3, 3, 3, 3, 3, 3]);
    // P₂: fixed as a class, lines permuted by the rotations, one fixed per mirror
    expect(mirClass[0].goesTo.every((x) => x === mirClass[0].self)).toBe(true);
    expect(mirClass[0].linesFixed).toEqual([3, 0, 0, 1, 1, 1]);
    // the diagonals: kept by id and the rotations, EXCHANGED by every mirror
    const diagonals = profile.filter((p) => p !== rotClass[0] && p !== mirClass[0]);
    expect(diagonals.length).toBe(2);
    expect(diagonals[0].goesTo).toEqual([
      diagonals[0].self, diagonals[0].self, diagonals[0].self,
      diagonals[1].self, diagonals[1].self, diagonals[1].self,
    ]);
    expect(diagonals[1].goesTo).toEqual([
      diagonals[1].self, diagonals[1].self, diagonals[1].self,
      diagonals[0].self, diagonals[0].self, diagonals[0].self,
    ]);
  });

  /**
   * THE ANSWER TO "can a rep-9 charge be defined from the digit word alone".
   *
   * The GRADE can: sum the per-letter grades, where a letter's grade is 0 if it
   * is inverted and ±1 by which upright class it is in. That needs no group, no
   * basepoint and no structure — only the sign convention above — and it is
   * EXACTLY D₃-invariant, cell for cell, at every depth: 44,280 tests, zero
   * mismatches. Not equivariant-up-to-a-relabelling as the full charge is;
   * invariant.
   *
   * The reason it survives the mirrors, which act by a TRANSDUCER and not by a
   * digit rewrite, is that every element of S₃ preserves each grade class — the
   * classes are cut out by the multiset {i, j, l}, which a coordinate
   * permutation cannot change. So whatever state the transducer is in, each
   * digit's grade is preserved and the sum with it.
   *
   * The vertex sum does NOT survive: the mirrors send it to c − v with c fixed
   * by the transducer state, so the shift is word-dependent. That is where the
   * full charge's mirror decay (54/81, 405/729, 3645/6561) comes from, and it
   * is measured here beside the grade so the two cannot be confused.
   */
  it("the grade is exactly D₃-invariant at every depth; the full charge is not", () => {
    const { grade, vertex } = canonicalCoords(3);
    const sum = (t: readonly number[]) => (w: readonly number[]) =>
      w.reduce((a, d) => (a + t[d]) % 3, 0);
    const gradeOf = sum(grade);
    const vertexOf = sum(vertex);
    const g = GROUPS.Z3xZ3;
    const label = coordLabelling(3, 1);
    const maps = affineBijections(g);
    let tests = 0;
    let gradeBad = 0;
    let vertexBad = 0;
    const mirror: string[] = [];
    for (const depth of [1, 2, 3, 4]) {
      const cells = leaves(3, depth);
      const N = 3 ** depth;
      for (const [si] of S3.entries()) {
        const image = symmetryImages(cells, N, si);
        cells.forEach((c, i) => {
          tests++;
          if (gradeOf(cells[image[i]].word) !== gradeOf(c.word)) gradeBad++;
          if (vertexOf(cells[image[i]].word) !== vertexOf(c.word)) vertexBad++;
        });
      }
      if (depth >= 2) {
        const image = symmetryImages(cells, N, 3);
        const pairs = cells.map(
          (c, i) =>
            [
              wordCharge(g, label, c.word),
              wordCharge(g, label, cells[image[i]].word),
            ] as const
        );
        mirror.push(`${bestRelabelling(g, pairs, maps).matches}/${cells.length}`);
      }
    }
    expect(tests).toBe(44280);
    expect(gradeBad).toBe(0);
    expect(vertexBad).toBe(36 + 324 + 1458 + 26244);
    // the full charge under m_A, for contrast — the numbers Q3 already reported
    expect(mirror).toEqual(["54/81", "405/729", "3645/6561"]);

    // GUARD-FIRE. Move one letter between grade classes — the smallest possible
    // falsehood, still a total function Σ₉ → ℤ/3 — and the invariance dies.
    const mutant = [...grade];
    mutant[7] = 1;
    const bad = sum(mutant);
    const cells = leaves(3, 2);
    let fired = 0;
    for (const [si] of S3.entries()) {
      const image = symmetryImages(cells, 9, si);
      cells.forEach((c, i) => {
        if (bad(cells[image[i]].word) !== bad(c.word)) fired++;
      });
    }
    expect(fired).toBe(126);
  });
});

describe("rep-9 B — what replaces the arm decomposition with no hub?", () => {
  /**
   * THE BRIEF'S OBVIOUS CANDIDATE IS REFUTED, and the refutation is the point.
   *
   * The rotation orbits cannot be the arms: the rotation FIXES each of them.
   * They are the fibres of an invariant, and an invariant is a charge, not a
   * decomposition into parts something permutes. The arms have to come from the
   * OTHER canonical parallel class, which is transverse to this one — and the
   * two jobs are exactly what P₁ and P₂ divide between them.
   */
  it("the rotation orbits do NOT give arms — the rotation fixes each of them", () => {
    const perms = S3.map((s) => childPermutation(3, s.perm));
    const norm = (l: readonly number[]) => [...l].sort((a, b) => a - b).join(",");
    for (const orbit of rotationOrbits(3)) {
      for (const p of perms) expect(norm(orbit.map((d) => p[d]))).toBe(norm(orbit));
    }
    // geometrically, at depth 3: the region under one rotation orbit is carried
    // onto ITSELF, so no labelling of those three regions can be cyclic
    const cells = leaves(3, 3);
    const image = symmetryImages(cells, 27, 1);
    const classOf = new Map<number, number>();
    rotationOrbits(3).forEach((o, c) => o.forEach((d) => classOf.set(d, c)));
    cells.forEach((c, i) => {
      expect(classOf.get(cells[image[i]].word[0])).toBe(classOf.get(c.word[0]));
    });
  });

  /**
   * THE TRANSVERSAL IS FORCED, and Q3's "27 choices, none distinguished" was
   * wrong on both halves.
   *
   * 27 is the count of TRANSVERSALS; the count of DECOMPOSITIONS is 9, since T,
   * πT and π²T name the same three parts. And of those 9, requiring the
   * MIRRORS to permute the parts as well as the rotation leaves exactly one —
   * the mirror fixed sets. The rotation alone cannot see the difference, which
   * is why Q3 found none: it was asking a question the rotation cannot answer.
   */
  it("9 decompositions, exactly 1 D₃-stable, and it is P₂", () => {
    expect(rotationTransversals(3).length).toBe(27);
    const norm = (p: readonly number[]) => [...p].sort((a, b) => a - b).join(",");
    const distinct = new Set(
      rotationTransversals(3).map((parts) => parts.map(norm).sort().join("|"))
    );
    expect(distinct.size).toBe(9);
    const stable = d3StableTransversals(3);
    expect(stable.length).toBe(1);
    expect(stable[0].map(norm).sort()).toEqual(mirrorFixedSets(3).map(norm).sort());
    // at k = 2 the construction is not even well posed: X is rotation-fixed, so
    // a "transversal" would place it in all three parts at once. That refusal is
    // §D's skip rule, seen from underneath.
    expect(() => rotationTransversals(2)).toThrow();
  });

  /**
   * WHY THE HUB IS EXCLUDED — derived, where `arms.ts` argued it.
   *
   * An arm label is a D₃-equivariant map from letters to the three vertices.
   * Such a map is free on each D₃-orbit subject to one condition: the value has
   * to be fixed by everything that fixes the letter. A letter with a mirror
   * stabiliser has exactly one admissible value; a letter with trivial
   * stabiliser has three; and the letter fixed by ALL of D₃ has NONE, because no
   * vertex is fixed by all of D₃. The hub is not excluded to protect
   * disjointness. It is excluded because there is nothing to map it to.
   *
   * The count of equivariant maps is 1 at k = 2 and k = 3 and at no other radix
   * tested — the free orbits appear from k = 4 and each contributes a factor of
   * three. So a canonical arm control exists at exactly two radices, and rep-9
   * is the one of them with nothing left over.
   */
  it("the hub's exclusion is forced by equivariance; the arm map is unique only at k = 2, 3", () => {
    const report: Record<number, { maps: number; excluded: number[] }> = {};
    for (const k of [2, 3, 4, 5, 6, 7]) {
      const a = armLetterMaps(k);
      report[k] = { maps: a.maps, excluded: a.excluded };
    }
    expect(report).toEqual({
      2: { maps: 1, excluded: [3] }, // X, the rep-4 hub
      3: { maps: 1, excluded: [] }, // nothing to exclude
      4: { maps: 3, excluded: [4] },
      5: { maps: 9, excluded: [19] },
      6: { maps: 27, excluded: [] },
      7: { maps: 243, excluded: [12] },
    });
    // the excluded letter is exactly the D₃-fixed one Q3 tabulated
    expect(armLetterMaps(2).excluded).toEqual(fixedLetters(2, S3[1].perm));
    // and the two counts are computed by genuinely different routes — orbit
    // stabilisers here, brute-force transversal enumeration there — so their
    // agreement is a cross-check and not a restatement
    expect(d3StableTransversals(3).length).toBe(armLetterMaps(3).maps);
    expect(d3StableTransversals(6).length).toBe(armLetterMaps(6).maps);
  });

  /**
   * THE DECOMPOSITION ITSELF, measured against the geometry.
   *
   * arm(w) = the vertex class of the FIRST digit. Three parts, 9^d/3 cells each,
   * RESIDUAL EXACTLY ZERO at every depth — against rep-4's (4^d − 1)/3 per arm
   * plus one hub. The rotation permutes them cyclically A → C → B and each
   * mirror fixes its own and swaps the other two, which is the vertex action and
   * nothing else. Congruence is checked as POINT SETS, not by counting: the
   * rotated image of arm A is arm C key for key.
   *
   * The label is stable under extension — a suffix cannot change the first digit
   * — which is the property `arms.ts` needs for isolation and the address-keyed
   * plate to compose without either knowing about the other.
   */
  it("three congruent arms, 9^d/3 cells each, residual exactly 0", () => {
    const { vertex } = canonicalCoords(3);
    const sizes: number[][] = [];
    for (const depth of [1, 2, 3, 4]) {
      const cells = leaves(3, depth);
      const N = 3 ** depth;
      const armOf = (w: readonly number[]) => vertex[w[0]];
      const count = [0, 0, 0];
      for (const c of cells) count[armOf(c.word)]++;
      expect(count.reduce((a, b) => a + b, 0)).toBe(cells.length); // residual 0
      sizes.push(count);
      const rot = symmetryImages(cells, N, 1);
      const mir = symmetryImages(cells, N, 3);
      const rotMoves = new Set<string>();
      const mirMoves = new Set<string>();
      cells.forEach((c, i) => {
        rotMoves.add(`${armOf(c.word)}->${armOf(cells[rot[i]].word)}`);
        mirMoves.add(`${armOf(c.word)}->${armOf(cells[mir[i]].word)}`);
      });
      expect([...rotMoves].sort()).toEqual(["0->2", "1->0", "2->1"]);
      expect([...mirMoves].sort()).toEqual(["0->0", "1->2", "2->1"]);
    }
    expect(sizes).toEqual([
      [3, 3, 3],
      [27, 27, 27],
      [243, 243, 243],
      [2187, 2187, 2187],
    ]);
    // congruent as POINT SETS: rotate arm A and land on arm C exactly
    const cells = leaves(3, 3);
    const armA = cells.filter((c) => vertex[c.word[0]] === 0);
    const armC = new Set(
      cells.filter((c) => vertex[c.word[0]] === 2).map((c) => triKey(c.tri, 27))
    );
    const rotated = armA.map((c) => triKey(permuteTri(c.tri, S3[1].perm), 27));
    expect(rotated.length).toBe(armC.size);
    expect(rotated.every((k) => armC.has(k))).toBe(true);

    // GUARD-FIRE, and it is the sharp one rather than the easy one. Take one of
    // the other eight decompositions — {0,1,6}, its rotation images {2,5,8} and
    // {3,4,7}. It is a genuine transversal of the rotation orbits, so the parts
    // stay EQUAL IN SIZE and the rotation still permutes them cyclically: every
    // gate a rotation-only argument can raise stays green. What dies is the
    // mirror, which is exactly the condition Q3 never imposed and the reason it
    // concluded nothing was distinguished.
    const rival = [0, 1, 6];
    const rotPerm = childPermutation(3, S3[1].perm);
    const rivalArm = new Array<number>(9).fill(-1);
    rival.forEach((d) => {
      rivalArm[d] = 0;
      rivalArm[rotPerm[d]] = 1;
      rivalArm[rotPerm[rotPerm[d]]] = 2;
    });
    expect(rivalArm.every((a) => a >= 0)).toBe(true);
    const rivalCount = [0, 0, 0];
    for (const c of cells) rivalCount[rivalArm[c.word[0]]]++;
    expect(rivalCount).toEqual([243, 243, 243]); // still equal
    const rotImage = symmetryImages(cells, 27, 1);
    const mirImage = symmetryImages(cells, 27, 3);
    const rivalRot = new Set(
      cells.map((c, i) => `${rivalArm[c.word[0]]}->${rivalArm[cells[rotImage[i]].word[0]]}`)
    );
    expect([...rivalRot].sort()).toEqual(["0->1", "1->2", "2->0"]); // still cyclic
    const rivalMir = new Set(
      cells.map((c, i) => `${rivalArm[c.word[0]]}->${rivalArm[cells[mirImage[i]].word[0]]}`)
    );
    expect(rivalMir.size).toBeGreaterThan(3); // not a permutation of the parts
  });

  /**
   * THE INDUCED ACTION, and it is `arms.ts`'s table unchanged.
   *
   * The setwise stabiliser of arm A in D₃ is ⟨m_A⟩ of order 2: the rotations
   * carry the arm off itself, and of the three mirrors only m_A fixes it. So
   * clipping a symmetry brush to one arm leaves exactly the ⟨m_A⟩ orbit —
   *
   *   mode 1 → 1     mode 2 → unchanged     mode 3 → 1     mode 6 → mode 2
   *
   * measured at depth 3 over all 243 cells of arm A. Mode 3 paints what mode 1
   * paints and mode 6 paints what mode 2 paints, exactly as at rep-4, and for
   * exactly the same reason. What has changed is that there is no hub to be
   * unreachable while an arm is isolated.
   */
  it("isolating an arm clips the orbit to ⟨m_A⟩ — mode 3 → mode 1, mode 6 → mode 2", () => {
    const { vertex } = canonicalCoords(3);
    const cells = leaves(3, 3);
    const image = S3.map((_, si) => symmetryImages(cells, 27, si));
    const modes: [number, number[]][] = [
      [1, [0]],
      [2, [0, 3]],
      [3, [0, 1, 2]],
      [6, [0, 1, 2, 3, 4, 5]],
    ];
    const report: Record<string, string> = {};
    for (const [mode, elements] of modes) {
      const full = new Map<number, number>();
      const clipped = new Map<number, number>();
      cells.forEach((c, i) => {
        if (vertex[c.word[0]] !== 0) return;
        const orbit = new Set(elements.map((e) => image[e][i]));
        full.set(orbit.size, (full.get(orbit.size) ?? 0) + 1);
        const inside = [...orbit].filter((j) => vertex[cells[j].word[0]] === 0).length;
        clipped.set(inside, (clipped.get(inside) ?? 0) + 1);
      });
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
  });

  /**
   * THE DOWNSTREAM CONSTRAINT: does a single-digit rotation law cost the arms?
   *
   * It does not, and the reason is that they live at different levels. Under the
   * `ifs`-style frames the rotation is a UNIFORM digit rewrite; under the frames
   * `rotationFrames` solves for it rewrites ONLY THE FIRST DIGIT — 729 of 729
   * cells at depth 3, and 0 of 729 the other way round, so the two conventions
   * are genuinely different addressings of the same triangles. The construction
   * is the one rep-4 cannot have: the recurrence F(π d) = r ∘ F(d) closes iff
   * the rotation acts freely, and at rep-4 the orbit through X has length one.
   *
   * Across that convention change, at depth 3:
   *
   *   the ARM of every cell is unchanged   729/729  — it reads the first digit,
   *                                                  which no convention moves
   *   the GRADE of every cell is unchanged 729/729  — a convention rewrites
   *                                                  digits by elements of S₃,
   *                                                  and S₃ preserves the grade
   *                                                  classes
   *   the VERTEX SUM is not               243/729   — the part that was never
   *                                                  canonical anyway
   *
   * So the two demands are simultaneously satisfiable, and more than that: the
   * arm decomposition and the grade charge are invariants of the CELL, immune to
   * both the symmetry applied and the addressing convention chosen. There is no
   * trade to price.
   */
  it("the single-digit rotation law and the arm decomposition hold at once", () => {
    const frames = rotationFrames(3);
    expect(frames).toEqual([0, 0, 2, 1, 1, 2, 0, 1, 2]);
    expect(() => rotationFrames(2)).toThrow();
    const rot = childPermutation(3, S3[1].perm);
    const counts: Record<string, number> = {};
    for (const depth of [2, 3]) {
      const N = 3 ** depth;
      for (const [name, cells] of [
        ["framed", framedLeaves(3, depth, frames)],
        ["ifs", leaves(3, depth)],
      ] as const) {
        const image = symmetryImages(cells, N, 1);
        let single = 0;
        let uniform = 0;
        cells.forEach((c, i) => {
          const w = cells[image[i]].word;
          if (w[0] === rot[c.word[0]] && w.slice(1).every((d, j) => d === c.word[j + 1])) single++;
          if (w.every((d, j) => d === rot[c.word[j]])) uniform++;
        });
        counts[`${name}${depth}single`] = single;
        counts[`${name}${depth}uniform`] = uniform;
      }
    }
    expect(counts).toEqual({
      framed2single: 81,
      framed2uniform: 0,
      framed3single: 729,
      framed3uniform: 0,
      ifs2single: 0,
      ifs2uniform: 81,
      ifs3single: 0,
      ifs3uniform: 729,
    });

    // and what the convention change does to the three quantities
    const { grade, vertex } = canonicalCoords(3);
    const sum = (t: readonly number[]) => (w: readonly number[]) =>
      w.reduce((a, d) => (a + t[d]) % 3, 0);
    const gradeOf = sum(grade);
    const vertexOf = sum(vertex);
    const ifs = leaves(3, 3);
    const byKey = new Map(ifs.map((c) => [triKey(c.tri, 27), c.word]));
    let sameGrade = 0;
    let sameVertex = 0;
    let sameArm = 0;
    for (const c of framedLeaves(3, 3, frames)) {
      const other = byKey.get(triKey(c.tri, 27)) as number[];
      if (gradeOf(c.word) === gradeOf(other)) sameGrade++;
      if (vertexOf(c.word) === vertexOf(other)) sameVertex++;
      if (vertex[c.word[0]] === vertex[other[0]]) sameArm++;
    }
    expect([sameGrade, sameVertex, sameArm]).toEqual([729, 243, 729]);
  });
});
