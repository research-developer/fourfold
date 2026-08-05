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
  bestRelabelling,
  buildTree,
  centroid,
  childPermutation,
  containsCentroid,
  downCount,
  eachPermutation,
  fixedLetters,
  frameResidual,
  isAffine,
  isAutomorphism,
  permuteTri,
  searchLabellings,
  shiftNode,
  subdivide,
  triKey,
  upCount,
  wordCharge,
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

const isPrefix = (p: readonly number[], w: readonly number[]) =>
  p.every((d, i) => w[i] === d);

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
