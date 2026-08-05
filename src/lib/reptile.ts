/**
 * Rep-tile refinement on the Eisenstein lattice: is the quadtree-containment
 * theorem about the number FOUR, or about descent agreeing with geometry?
 *
 * SCOPE. This module is a MEASUREMENT INSTRUMENT, not a feature. Nothing in
 * `src/app` imports it. It exists so that `test/reptile.test.ts` can decide
 * four questions by exhaustive computation instead of by analogy:
 *
 *   Q1  does fold-re theory.md §9's containment theorem survive k = 9?
 *   Q2  does it survive MIXED radix — a rep-4 node beside a rep-9 node?
 *   Q3  does the rep-9 alphabet carry a charge group the way Σ₄ carries V₄?
 *   Q4  does rep-9 drag in a new ring?
 *
 * ── The subdivision, stated once ─────────────────────────────────────────
 *
 * A triangle with vertices P₀ P₁ P₂ (integer barycentrics over `den`) has, for
 * every integer k ≥ 2, an ALIGNED refinement into k² similar triangles. Write
 *
 *     G(i, j, l) = i·P₀ + j·P₁ + l·P₂        (integer, over k·den)
 *
 * for the grid point at barycentric weights (i, j, l)/k. Then
 *
 *     UP    child (i,j,l), i+j+l = k−1:  G(i+1,j,l), G(i,j+1,l), G(i,j,l+1)
 *     DOWN  child (i,j,l), i+j+l = k−2:  G(i+1,j+1,l), G(i,j+1,l+1), G(i+1,j,l+1)
 *
 * giving k(k+1)/2 upright and k(k−1)/2 inverted children, k² in all. At k = 2
 * this is `figure.ts`'s `ifs` convention verbatim — three corners plus the
 * inverted centre — which `test/reptile.test.ts` checks against `buildFigure`
 * rather than asserting. So this module does not invent a lattice; it is the
 * shipped one with the 2 taken out of the recursion and made a parameter.
 *
 * WHY THE FORMULA IS WRITTEN IN THE PARENT'S OWN VERTICES and never in screen
 * coordinates: it is then blind to whether the parent is upright or inverted
 * (an inverted parent's "up" children are inverted on screen and vice versa),
 * and it is equivariant under permuting the parent's vertex roles, which is
 * what makes the S₃ symmetry analysis of Q3 a relabelling of (i,j,l) rather
 * than a geometric special case. `figure.ts` gets the same blindness by
 * recursing on the vertex triple; this is that, generalised.
 *
 * WHY THE RADIX IS k AND NOT k²: the number of children is the square of the
 * EDGE division. Refinements compose by multiplying edge divisions — rep-4
 * then rep-9 is edge 2 then edge 3, i.e. edge 6, i.e. 36 children — so the
 * edge division is the thing that behaves like a numeral digit. Throughout
 * this module `k` is ALWAYS the edge division and `k²` the child count.
 *
 * ── Exactness ────────────────────────────────────────────────────────────
 *
 * Every coordinate here is an integer numerator over an integer denominator
 * that is a product of edge divisions. No float appears in this file at all —
 * not even a projection, because nothing here draws. The one geometric
 * decision (is this centroid inside that footprint) is taken by
 * cross-multiplied integer half-plane tests in `containsCentroid`, which is
 * written against vertex arrays only and calls nothing from the subdivision
 * side. That independence is the point of the whole exercise: the theorem
 * being tested is precisely that DESCENT and GEOMETRY agree, so the two sides
 * must not share code.
 */

/** Integer barycentric numerators over a denominator; they sum to it. */
export type Bary = readonly [number, number, number];

/** A triangle: three barycentric vertices sharing one denominator. */
export interface Tri {
  readonly v: readonly [Bary, Bary, Bary];
  /** Edge-division product from the root. Vertices are numerators over this. */
  readonly den: number;
}

/** The whole figure, before any cut. */
export const ROOT: Tri = {
  v: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  den: 1,
};

/**
 * Doubles hold integers exactly to 2^53. Every product this module forms is
 * bounded by (2·den_max²)², so the guard is cheap insurance against a silent
 * precision failure turning into a false GREEN. It has never fired; it is here
 * because a measurement instrument that can lie is worthless.
 */
function safe(x: number): number {
  if (!Number.isSafeInteger(x)) {
    throw new Error(`reptile: integer overflow (${x}) — the measurement is void`);
  }
  return x;
}

// ── the alphabet ─────────────────────────────────────────────────────────

export interface RepDigit {
  /** Barycentric index of the child within the parent's k-grid. */
  readonly i: number;
  readonly j: number;
  readonly l: number;
  /** true for the k(k−1)/2 children that point the other way to the parent. */
  readonly inverted: boolean;
  /** Position in the canonical order. */
  readonly index: number;
  /** Single character where the alphabet fits in base 36; else "d<index>". */
  readonly name: string;
}

const NAME36 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * The k² children in a fixed order: uprights first (i descending, then j
 * descending), then the inverted ones the same way.
 *
 * At k = 2 that order is (1,0,0), (0,1,0), (0,0,1), (0,0,0)-inverted — which
 * is `figure.ts`'s A, B, C, X. The order is a CONVENTION and nothing in the
 * mathematics depends on it, but it has to be fixed for addresses to mean
 * anything, and matching the shipped one costs nothing.
 */
export function alphabet(k: number): readonly RepDigit[] {
  if (!Number.isInteger(k) || k < 2) throw new Error(`reptile: bad radix ${k}`);
  const out: RepDigit[] = [];
  const push = (i: number, j: number, l: number, inverted: boolean) => {
    const index = out.length;
    out.push({ i, j, l, inverted, index, name: NAME36[index] ?? `d${index}` });
  };
  for (let i = k - 1; i >= 0; i--) {
    for (let j = k - 1 - i; j >= 0; j--) push(i, j, k - 1 - i - j, false);
  }
  for (let i = k - 2; i >= 0; i--) {
    for (let j = k - 2 - i; j >= 0; j--) push(i, j, k - 2 - i - j, true);
  }
  return out;
}

export const upCount = (k: number) => (k * (k + 1)) / 2;
export const downCount = (k: number) => (k * (k - 1)) / 2;

// ── the cut ──────────────────────────────────────────────────────────────

/** G(i,j,l) = i·P₀ + j·P₁ + l·P₂, an integer point over k·den. */
function gridPoint(tri: Tri, i: number, j: number, l: number): Bary {
  const [p, q, r] = tri.v;
  return [
    safe(i * p[0] + j * q[0] + l * r[0]),
    safe(i * p[1] + j * q[1] + l * r[1]),
    safe(i * p[2] + j * q[2] + l * r[2]),
  ];
}

/**
 * The k² children, in `alphabet(k)` order. One call is one level of descent;
 * `subdivide(subdivide(T, a), b)` and `subdivide(T, a·b)` produce the same set
 * of triangles, which is the associativity the mixed-radix case rests on and
 * which the tests check rather than assume.
 */
export function subdivide(tri: Tri, k: number): Tri[] {
  const den = safe(tri.den * k);
  return alphabet(k).map(({ i, j, l, inverted }) =>
    inverted
      ? {
          v: [
            gridPoint(tri, i + 1, j + 1, l),
            gridPoint(tri, i, j + 1, l + 1),
            gridPoint(tri, i + 1, j, l + 1),
          ] as const,
          den,
        }
      : {
          v: [
            gridPoint(tri, i + 1, j, l),
            gridPoint(tri, i, j + 1, l),
            gridPoint(tri, i, j, l + 1),
          ] as const,
          den,
        }
  );
}

/** Descend a fixed-radix address from a triangle. */
export function descend(tri: Tri, k: number, word: readonly number[]): Tri {
  let t = tri;
  for (const d of word) t = subdivide(t, k)[d];
  return t;
}

// ── identity of a triangle, independent of how it was reached ────────────

/**
 * Canonical key at a stated denominator: vertices rescaled, then SORTED, so
 * two triangles reached by different descents (or by different radix orders)
 * compare equal iff they are the same point set. Sorting is what makes the key
 * blind to vertex ORDER, which differs between descents and must not be
 * allowed to look like a geometric difference.
 */
export function triKey(tri: Tri, den: number): string {
  if (den % tri.den !== 0) {
    throw new Error(`reptile: ${den} is not a refinement of ${tri.den}`);
  }
  const f = den / tri.den;
  return tri.v
    .map((p) => `${safe(p[0] * f)}:${safe(p[1] * f)}:${safe(p[2] * f)}`)
    .sort()
    .join("|");
}

/** Centroid as an exact rational barycentric point (numerator over 3·den). */
export function centroid(tri: Tri): { readonly num: Bary; readonly den: number } {
  const [p, q, r] = tri.v;
  return {
    num: [p[0] + q[0] + r[0], p[1] + q[1] + r[1], p[2] + q[2] + r[2]],
    den: safe(tri.den * 3),
  };
}

// ── THE INDEPENDENT GEOMETRIC ORACLE ─────────────────────────────────────
//
// Everything above this line descends. Everything below decides containment
// from coordinates alone. The two sides share the Tri type and nothing else:
// no midpoint, no grid point, no alphabet, no denominator arithmetic beyond
// the cross-multiplication that puts two rationals over a common integer.

/**
 * Barycentric (x, y, z)/d ↦ the Eisenstein lattice point (y, z)/d, the same
 * basis change `hexagon.ts` documents: with the apex at the origin, B at
 * scale·e1 and C at scale·e2, a vertex with barycentrics (x, y, z) sits at
 * (y, z). Written out here rather than imported so the oracle depends on the
 * lattice and not on any module that also builds children.
 */
function lat(b: Bary): readonly [number, number] {
  return [b[1], b[2]];
}

function cross(
  o: readonly [number, number],
  a: readonly [number, number],
  b: readonly [number, number]
): number {
  return safe(safe((a[0] - o[0]) * (b[1] - o[1])) - safe((a[1] - o[1]) * (b[0] - o[0])));
}

export interface Containment {
  /** Strictly inside the footprint. */
  readonly inside: boolean;
  /** Exactly on an edge or vertex of the footprint — a partition hazard. */
  readonly onBoundary: boolean;
}

/**
 * Is a rational barycentric point strictly inside a triangle?
 *
 * Both operands are put over the common denominator `p.den · node.den` by
 * cross-multiplication — no division, no rounding, no tolerance — and the
 * decision is the sign agreement of three integer cross products. `onBoundary`
 * is reported SEPARATELY rather than folded into `inside`, because a fine
 * cell's centroid landing on a coarse node's edge is exactly the failure mode
 * that would break a mixed-radix partition, and a boolean would hide it.
 */
export function containsCentroid(
  node: Tri,
  p: { readonly num: Bary; readonly den: number }
): Containment {
  const P: readonly [number, number] = [
    safe(p.num[1] * node.den),
    safe(p.num[2] * node.den),
  ];
  const V = node.v.map((w) => {
    const q = lat(w);
    return [safe(q[0] * p.den), safe(q[1] * p.den)] as const;
  });
  const c0 = cross(V[0], V[1], P);
  const c1 = cross(V[1], V[2], P);
  const c2 = cross(V[2], V[0], P);
  const onBoundary = c0 === 0 || c1 === 0 || c2 === 0;
  const allPos = c0 > 0 && c1 > 0 && c2 > 0;
  const allNeg = c0 < 0 && c1 < 0 && c2 < 0;
  return { inside: allPos || allNeg, onBoundary };
}

// ── mixed-radix trees ────────────────────────────────────────────────────

export interface TreeNode {
  readonly index: number;
  readonly parent: number;
  /** Digit word from the root; each digit is read against that node's radix. */
  readonly path: readonly number[];
  readonly tri: Tri;
  /** Edge division applied AT this node; 1 marks a leaf. */
  readonly radix: number;
  readonly children: number[];
}

export interface Tree {
  readonly nodes: TreeNode[];
  readonly leaves: number[];
  /** lcm of all leaf denominators: the coarsest grid every leaf refines. */
  readonly refinement: number;
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
const lcm = (a: number, b: number) => safe((a / gcd(a, b)) * b);

/**
 * Build a tree whose radix is a FUNCTION OF THE NODE — the whole point of the
 * mixed-radix question. `radixAt` returns the edge division to apply, or 1 to
 * stop. The tree records each node's denominator, and `refinement` is the lcm
 * of the leaves': the grid against which "the fine lattice" has to be defined
 * once depth stops determining cell size.
 */
export function buildTree(
  radixAt: (path: readonly number[], tri: Tri) => number
): Tree {
  const nodes: TreeNode[] = [];
  const leaves: number[] = [];
  const add = (parent: number, path: readonly number[], tri: Tri): number => {
    const index = nodes.length;
    const radix = radixAt(path, tri);
    const node: TreeNode = { index, parent, path, tri, radix, children: [] };
    nodes.push(node);
    if (radix === 1) {
      leaves.push(index);
      return index;
    }
    const kids = subdivide(tri, radix);
    kids.forEach((child, d) => {
      node.children.push(add(index, [...path, d], child));
    });
    return index;
  };
  add(-1, [], ROOT);
  return {
    nodes,
    leaves,
    refinement: leaves.reduce((acc, i) => lcm(acc, nodes[i].tri.den), 1),
  };
}

/**
 * GUARD-FIRE. Displace one child of one node by a single unit of the common
 * refinement grid, keeping everything else intact. The displaced node is still
 * a triangle, still the right size, still a child of the right parent by the
 * tree structure — it just is not where the geometry says. Every gate in the
 * test file is run against this mutant and must go red; a gate that survives
 * it is not measuring what it claims to.
 */
export function shiftNode(tree: Tree, nodeIndex: number, refinement: number): Tree {
  const nodes = tree.nodes.map((n) => {
    if (n.index !== nodeIndex) return n;
    const f = refinement / n.tri.den;
    if (!Number.isInteger(f)) throw new Error("reptile: mutant needs a refinement");
    // Restate the triangle over the refinement grid, then move every vertex one
    // unit along (y − z). The triangle stays congruent and stays on the grid —
    // only its position lies, which is the smallest possible falsehood and
    // therefore the sharpest test of a gate.
    const move = (p: Bary): Bary => [p[0] * f, p[1] * f + 1, p[2] * f - 1];
    const tri: Tri = {
      v: [move(n.tri.v[0]), move(n.tri.v[1]), move(n.tri.v[2])],
      den: refinement,
    };
    return { ...n, tri };
  });
  return { ...tree, nodes };
}

// ── symmetry: the S₃ that acts on every radix at once ────────────────────

/** Permute the three barycentric coordinates of a point. */
export function permuteBary(b: Bary, perm: readonly number[]): Bary {
  return [b[perm[0]], b[perm[1]], b[perm[2]]];
}

export function permuteTri(tri: Tri, perm: readonly number[]): Tri {
  return {
    v: [
      permuteBary(tri.v[0], perm),
      permuteBary(tri.v[1], perm),
      permuteBary(tri.v[2], perm),
    ],
    den: tri.den,
  };
}

/** The six symmetries of the triangle, as coordinate permutations. */
export const S3: readonly { readonly name: string; readonly perm: readonly number[] }[] = [
  { name: "id", perm: [0, 1, 2] },
  { name: "rot+", perm: [1, 2, 0] },
  { name: "rot-", perm: [2, 0, 1] },
  { name: "m_A", perm: [0, 2, 1] },
  { name: "m_B", perm: [2, 1, 0] },
  { name: "m_C", perm: [1, 0, 2] },
];

/**
 * How a symmetry permutes the alphabet — DERIVED, not declared. The child
 * triangle is transformed and then LOOKED UP among the children by canonical
 * key, so if the subdivision formula and the symmetry disagreed anywhere the
 * lookup would fail rather than quietly return a plausible permutation.
 */
export function childPermutation(k: number, perm: readonly number[]): number[] {
  const kids = subdivide(ROOT, k);
  const byKey = new Map<string, number>();
  kids.forEach((t, d) => byKey.set(triKey(t, k), d));
  return kids.map((t, d) => {
    const image = byKey.get(triKey(permuteTri(t, perm), k));
    if (image === undefined) {
      throw new Error(`reptile: k=${k} is not symmetric under ${perm} at child ${d}`);
    }
    return image;
  });
}

/** Letters fixed by a symmetry. A charge identity, if one exists, is here. */
export function fixedLetters(k: number, perm: readonly number[]): number[] {
  const p = childPermutation(k, perm);
  return p.map((image, d) => (image === d ? d : -1)).filter((d) => d >= 0);
}

/**
 * The FRAME RESIDUAL — why a symmetry is not always a uniform digit rewrite.
 *
 * A symmetry σ carries child d onto child π(d) as a POINT SET, but the image's
 * vertex order need not be the canonical order of child π(d). Since the next
 * level of descent is written in the child's own vertex order, the discrepancy
 * is the symmetry that the descent carries INTO the subtree. This function
 * returns it, as an index into `S3`, for every letter.
 *
 * Measured law (asserted in the tests for k = 2..5): the residual depends only
 * on σ and on whether the child is INVERTED — never on which child, and never
 * on k. Rotations keep their residual through inverted children (rotation
 * commutes with the point reflection); reflections advance m_A → m_B → m_C.
 * That is the general form of docs/symmetry-findings.md §A's odometer and §G's
 * "the reflections are messier", and it is radix-independent.
 */
export function frameResidual(k: number, perm: readonly number[]): number[] {
  const kids = subdivide(ROOT, k);
  const byKey = new Map<string, number>();
  kids.forEach((t, d) => byKey.set(triKey(t, k), d));
  return kids.map((t, d) => {
    const image = permuteTri(t, perm);
    const target = kids[byKey.get(triKey(image, k)) ?? -1];
    if (target === undefined) throw new Error(`reptile: no image for child ${d}`);
    const order = image.v.map((p) =>
      target.v.findIndex((q) => q[0] === p[0] && q[1] === p[1] && q[2] === p[2])
    );
    const s = S3.findIndex((g) => g.perm.every((x, i) => x === order[i]));
    if (s < 0) throw new Error(`reptile: residual ${order} is not in S3`);
    return s;
  });
}

// ── group machinery for Q3 ───────────────────────────────────────────────

/** Multiplication table with 0 as the identity. */
export type GroupTable = readonly (readonly number[])[];

const table = (n: number, op: (a: number, b: number) => number): GroupTable =>
  Array.from({ length: n }, (_, a) => Array.from({ length: n }, (_, b) => op(a, b)));

/**
 * Both groups of order 4 and both of order 9. There are exactly two of each up
 * to isomorphism, so a search over these four tables and every labelling is a
 * search over EVERY candidate charge group for rep-4 and rep-9 — which is what
 * makes Q3's negative answer a proof and not a failure to find one.
 */
export const GROUPS: Readonly<Record<string, GroupTable>> = {
  Z4: table(4, (a, b) => (a + b) % 4),
  V4: table(4, (a, b) => a ^ b),
  Z9: table(9, (a, b) => (a + b) % 9),
  Z3xZ3: table(9, (a, b) => ((a % 3) + (b % 3)) % 3 + 3 * ((((a / 3) | 0) + ((b / 3) | 0)) % 3)),
};

function inverses(g: GroupTable): number[] {
  return g.map((row) => row.indexOf(0));
}

/** map is an automorphism iff it respects the table everywhere. Exhaustive. */
export function isAutomorphism(g: GroupTable, map: readonly number[]): boolean {
  for (let a = 0; a < g.length; a++) {
    for (let b = 0; b < g.length; b++) {
      if (map[g[a][b]] !== g[map[a]][map[b]]) return false;
    }
  }
  return true;
}

/**
 * map is AFFINE iff x ↦ map(x) − map(0) is an automorphism.
 *
 * For an abelian group this is the right general definition and it specialises
 * correctly to both candidates: Aut((ℤ/3)²) = GL(2,3) and Aut(ℤ/9) = (ℤ/9)*,
 * so "affine" means x ↦ Mx + t and x ↦ ux + t respectively. The distinction
 * from `isAutomorphism` is the whole of Q3: an automorphism must fix the
 * identity, an affine map need not, and rep-9's rotation fixes no letter.
 */
export function isAffine(g: GroupTable, map: readonly number[]): boolean {
  const inv = inverses(g);
  const t = inv[map[0]];
  return isAutomorphism(
    g,
    map.map((x) => g[x][t])
  );
}

/** Every permutation of 0..n−1, via Heap's algorithm. n ≤ 9 here. */
export function eachPermutation(n: number, visit: (p: readonly number[]) => void): void {
  const a = Array.from({ length: n }, (_, i) => i);
  const c = new Array<number>(n).fill(0);
  visit(a);
  let i = 0;
  while (i < n) {
    if (c[i] < i) {
      const swap = i % 2 === 0 ? 0 : c[i];
      [a[swap], a[i]] = [a[i], a[swap]];
      visit(a);
      c[i]++;
      i = 0;
    } else {
      c[i] = 0;
      i++;
    }
  }
}

export interface LabellingSearch {
  /** Labellings under which every symmetry acts as a group AUTOMORPHISM. */
  readonly automorphic: number;
  /** Labellings under which every symmetry acts as an AFFINE map. */
  readonly affine: number;
  /** One surviving affine labelling, for the charge measurement. */
  readonly witness: number[] | null;
}

/**
 * EXHAUSTIVE over all (k²)! labellings of the alphabet by a group of order k².
 *
 * A labelling φ: Σ → G induces, for each symmetry g, the map φ∘π_g∘φ⁻¹ on G.
 * We count the labellings for which those induced maps are automorphisms (what
 * `figure.ts`'s charge needs: a monoid homomorphism Σ* → G whose D₃-action is
 * by automorphisms) and, separately, affine maps (what a TORSOR needs).
 *
 * Only the two generators rot+ and m_A are tested: automorphisms and affine
 * maps are each closed under composition, so a generating pair decides the
 * whole group. Checking all six would be the same answer at three times the
 * cost, and the tests assert the generated closure separately.
 */
export function searchLabellings(k: number, groupName: string): LabellingSearch {
  const g = GROUPS[groupName];
  const n = k * k;
  if (g.length !== n) throw new Error(`reptile: ${groupName} is not of order ${n}`);
  const gens = [
    childPermutation(k, S3[1].perm),
    childPermutation(k, S3[3].perm),
  ];
  let automorphic = 0;
  let affine = 0;
  let witness: number[] | null = null;
  const phiInv = new Array<number>(n);
  const induced = new Array<number>(n);
  eachPermutation(n, (phi) => {
    for (let d = 0; d < n; d++) phiInv[phi[d]] = d;
    let allAuto = true;
    let allAffine = true;
    for (const pi of gens) {
      for (let x = 0; x < n; x++) induced[x] = phi[pi[phiInv[x]]];
      if (allAuto && !isAutomorphism(g, induced)) allAuto = false;
      if (allAffine && !isAffine(g, induced)) allAffine = false;
      if (!allAffine) break;
    }
    if (allAuto) automorphic++;
    if (allAffine) {
      affine++;
      if (witness === null) witness = [...phi];
    }
  });
  return { automorphic, affine, witness };
}

/**
 * Every affine bijection of a group, precomputed once.
 *
 * This is the palette-relabelling set for the equivariance measurement, the
 * exact analogue of `hexagon.ts`'s exhaustive sweep over all 24 permutations
 * of V4. Two numbers worth keeping: |AGL(2,2)| = 24 = 4!, so at rep-4 EVERY
 * relabelling of the four charges is affine and the affine condition carries
 * no information; |AGL(2,3)| = 432 out of 9! = 362,880, so at rep-9 it is a
 * genuine constraint and the measurement means something.
 */
export function affineBijections(g: GroupTable): number[][] {
  const out: number[][] = [];
  eachPermutation(g.length, (p) => {
    if (isAffine(g, p)) out.push([...p]);
  });
  return out;
}

/**
 * Best affine relabelling of the charge palette, and how many cells it carries.
 *
 * `pairs` are (charge before, charge after) over every cell of the figure under
 * one symmetry. Exhaustive over the relabellings — nothing is assumed about
 * which one should win.
 */
export function bestRelabelling(
  g: GroupTable,
  pairs: readonly (readonly [number, number])[],
  maps: readonly (readonly number[])[]
): { matches: number; total: number; exact: boolean } {
  // Score through a contingency table rather than by rescanning the cells for
  // every candidate: |G|² counters filled once, then |maps|·|G| additions. The
  // answer is identical and depth 5 (59,049 cells × 432 candidates) becomes
  // affordable, which is what caught the "settles at 5/9" claim being false.
  const n = g.length;
  const count = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (const [a, b] of pairs) count[a][b]++;
  let best = 0;
  for (const map of maps) {
    let hits = 0;
    for (let a = 0; a < n; a++) hits += count[a][map[a]];
    if (hits > best) best = hits;
  }
  return { matches: best, total: pairs.length, exact: best === pairs.length };
}

/**
 * Charge of an address word under a labelling: the group product of the digit
 * labels. Well defined without a bracketing convention only because every
 * candidate group here is abelian — which is itself a requirement on any
 * charge, since the digits of an address are read in a fixed order but the
 * charge is meant to be a property of the CELL.
 */
export function wordCharge(
  g: GroupTable,
  label: readonly number[],
  word: readonly number[]
): number {
  let c = 0;
  for (const d of word) c = g[c][label[d]];
  return c;
}
