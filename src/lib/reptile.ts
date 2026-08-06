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
 * and then two the answer to Q3 forced, decided in the section at the bottom of
 * this file and reported in `docs/rep9-charge.md`:
 *
 *   A   Q3 left Σ₉ a torsor with no basepoint. Is any charge canonical anyway?
 *   B   Q3 left the arms needing a transversal. Does anything pick one?
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

// ═════════════════════════════════════════════════════════════════════════
// THE REP-9 COORDINATES — the basepoint question, and the arms with no hub
// ═════════════════════════════════════════════════════════════════════════
//
// `docs/rep-tile-findings.md` Q3 left rep-9 with a torsor and two holes: no
// canonical charge basepoint, and "the split needs a transversal of the three
// first-digit orbits (27 choices), and none is distinguished".
//
// Everything below exists to decide whether those holes are real. The short
// version, which `test/reptile.test.ts` measures and `docs/rep9-charge.md`
// states: Σ₉ carries TWO canonical parallel classes, not one, and they do
// DIFFERENT JOBS.
//
//   P₁  the rotation's orbits            — every line D₃-INVARIANT  → the CHARGE
//   P₂  the mirrors' fixed sets          — lines permuted like the
//                                          triangle's own vertices   → the ARMS
//
// Both are defined from the geometry alone: no group, no labelling, no search.
// Together they coordinatise the alphabet, Σ₉ ≅ P₁ × P₂, which is why nothing
// below needs to pick a torsor basepoint to say anything.
//
// WHY THIS IS REP-9 STRUCTURE AND NOT GENERAL. P₂ is a partition of the
// alphabet iff the three mirrors' fixed sets are disjoint and cover: each has k
// letters, there are three of them, and 3k = k² only at k = 3. At k = 2 they
// are CONCURRENT — all three contain X — and that common point is exactly the
// hub `arms.ts` excludes. So the hub's disappearance and the arm partition's
// appearance are the same fact about the same three sets, and `armLetterMaps`
// below turns "exclude the hub" from a design choice into a count.

/** Orbits of a permutation of the alphabet: each ascending, ordered by least. */
function orbitsOf(perm: readonly number[]): number[][] {
  const seen = new Array<boolean>(perm.length).fill(false);
  const out: number[][] = [];
  for (let d = 0; d < perm.length; d++) {
    if (seen[d]) continue;
    const orbit: number[] = [];
    let x = d;
    do {
      seen[x] = true;
      orbit.push(x);
      x = perm[x];
    } while (x !== d);
    out.push(orbit.sort((a, b) => a - b));
  }
  return out;
}

/**
 * P₁ — the rotation's orbits on the alphabet.
 *
 * DERIVED from `childPermutation`, so it inherits that function's guarantee:
 * the permutation is found by transforming each child and LOOKING IT UP by
 * canonical key, never by a formula that could agree with the subdivision by
 * construction.
 */
export function rotationOrbits(k: number): number[][] {
  return orbitsOf(childPermutation(k, S3[1].perm));
}

/** P₂ — the fixed sets of the three mirrors, in m_A, m_B, m_C order. */
export function mirrorFixedSets(k: number): number[][] {
  return [3, 4, 5].map((i) => fixedLetters(k, S3[i].perm));
}

/** Do these sets partition 0..n−1? Every element in exactly one. */
export function isPartition(
  parts: readonly (readonly number[])[],
  n: number
): boolean {
  const count = new Array<number>(n).fill(0);
  for (const part of parts) for (const x of part) count[x]++;
  return count.every((c) => c === 1);
}

/**
 * Letters that share a vertex with the parent — the CORNER children.
 *
 * Decided geometrically (does any child vertex coincide with a parent vertex
 * restated over the child's denominator) rather than by reading the index
 * triple, so that the three grade classes below are named by a property of the
 * TRIANGLE and not by a property of the alphabet's ordering convention.
 */
export function cornerLetters(k: number): number[] {
  const corners = [
    [k, 0, 0],
    [0, k, 0],
    [0, 0, k],
  ];
  return subdivide(ROOT, k)
    .map((t, d) =>
      t.v.some((p) => corners.some((c) => c[0] === p[0] && c[1] === p[1] && c[2] === p[2]))
        ? d
        : -1
    )
    .filter((d) => d >= 0);
}

export interface CanonicalCoords {
  /**
   * GRADE, per letter. 0 on the inverted class; ±1 on the two upright classes,
   * with `+1` on the CORNER class by the sign convention named in
   * `docs/rep9-charge.md`. The classes are P₁; only the numbering is chosen.
   */
  readonly grade: readonly number[];
  /** VERTEX, per letter: the c with the letter in Fix(m_c). A = 0, B = 1, C = 2. */
  readonly vertex: readonly number[];
  /** P₁ as [inverted, corner, other]. */
  readonly gradeClasses: readonly (readonly number[])[];
  /** P₂ as [Fix(m_A), Fix(m_B), Fix(m_C)]. */
  readonly vertexClasses: readonly (readonly number[])[];
}

/**
 * The two coordinates, built from geometry with no group and no search.
 *
 * THROWS unless both families partition the alphabet and P₁'s classes are
 * cleanly named — which is the case at k = 3 and, as `test/reptile.test.ts`
 * measures over k = 2..9, at no other radix. The throw is the point: this is
 * not a general construction wearing a rep-9 hat.
 */
export function canonicalCoords(k: number): CanonicalCoords {
  const n = k * k;
  const rot = rotationOrbits(k);
  const mir = mirrorFixedSets(k);
  if (rot.length !== 3 || !isPartition(rot, n)) {
    throw new Error(`reptile: k=${k} has ${rot.length} rotation orbits, not 3`);
  }
  if (!isPartition(mir, n)) {
    throw new Error(`reptile: k=${k} mirror fixed sets do not partition Σ`);
  }
  const inverted = new Set(
    alphabet(k)
      .filter((d) => d.inverted)
      .map((d) => d.index)
  );
  const corner = new Set(cornerLetters(k));
  const invClass = rot.filter((o) => o.every((d) => inverted.has(d)));
  const cornerClass = rot.filter((o) => o.every((d) => corner.has(d)));
  if (invClass.length !== 1 || cornerClass.length !== 1) {
    throw new Error(`reptile: k=${k} rotation orbits are not orientation-pure`);
  }
  const other = rot.filter((o) => o !== invClass[0] && o !== cornerClass[0]);
  if (other.length !== 1) throw new Error(`reptile: k=${k} class naming failed`);
  const grade = new Array<number>(n).fill(-1);
  invClass[0].forEach((d) => (grade[d] = 0));
  cornerClass[0].forEach((d) => (grade[d] = 1));
  other[0].forEach((d) => (grade[d] = 2));
  const vertex = new Array<number>(n).fill(-1);
  mir.forEach((set, c) => set.forEach((d) => (vertex[d] = c)));
  return {
    grade,
    vertex,
    gradeClasses: [invClass[0], cornerClass[0], other[0]],
    vertexClasses: mir,
  };
}

/**
 * The letter ↦ (grade, vertex) labelling as an element of (ℤ/3)².
 *
 * `GROUPS.Z3xZ3` encodes the element (a, b) as a + 3b, so this writes the grade
 * in the first component and the vertex in the second. WRITTEN DOWN, not found:
 * the exhaustive search in `searchLabellings` is then used to confirm it is one
 * of the 1,296 affine labellings rather than to discover it, which is what
 * makes "the structure is forced" a statement and not a lucky pick out of a hat.
 *
 * `sign` is the ONE choice this construction contains: which of the two upright
 * classes counts as +1. Both values are affine; they differ by the unique
 * non-trivial automorphism of ℤ/3 on the grade axis and by nothing else.
 */
export function coordLabelling(k: number, sign: 1 | 2): number[] {
  const { grade, vertex } = canonicalCoords(k);
  return grade.map((g, d) => (g === 0 ? 0 : ((g * sign) % 3)) + 3 * vertex[d]);
}

/** The map a symmetry induces on the group, through a labelling. φ∘π∘φ⁻¹. */
export function inducedMap(
  label: readonly number[],
  childPerm: readonly number[]
): number[] {
  const inv = new Array<number>(label.length);
  label.forEach((v, d) => (inv[v] = d));
  return Array.from({ length: label.length }, (_, x) => label[childPerm[inv[x]]]);
}

/** The translation part of an induced map: its value at the identity. */
export const translationPart = (induced: readonly number[]): number => induced[0];

/**
 * The linear part of an induced affine map: x ↦ f(x) − f(0).
 *
 * Equal to the identity permutation exactly when f is a pure TRANSLATION, which
 * is the property `docs/rep-tile-findings.md` measured on one witness and which
 * `test/reptile.test.ts` now measures on all three affine structures — where it
 * turns out to hold on exactly one of them.
 */
export function linearPart(g: GroupTable, induced: readonly number[]): number[] {
  const inv = g.map((row) => row.indexOf(0));
  return induced.map((x) => g[x][inv[induced[0]]]);
}

/**
 * EVERY affine labelling, not just how many.
 *
 * `searchLabellings` counts and keeps one witness, which was enough to say a
 * torsor exists. Deciding WHICH torsor, and how many inequivalent ones there
 * are, needs the labellings themselves. The sweep is the same 9! and the tests
 * cross-check the two counts against each other, so this cannot silently drift
 * from the function it duplicates.
 */
export function collectAffineLabellings(k: number, groupName: string): number[][] {
  const g = GROUPS[groupName];
  const n = k * k;
  if (g.length !== n) throw new Error(`reptile: ${groupName} is not of order ${n}`);
  const gens = [childPermutation(k, S3[1].perm), childPermutation(k, S3[3].perm)];
  const out: number[][] = [];
  eachPermutation(n, (phi) => {
    for (const pi of gens) {
      if (!isAffine(g, inducedMap(phi, pi))) return;
    }
    out.push([...phi]);
  });
  return out;
}

/**
 * The 12 lines of AG(2,3), pulled back to letters.
 *
 * A triple is a line iff its three labels sum to the identity: the line through
 * a and b is {a, b, 2b−a}, and a + b + (2b−a) = 3b = 0. So this needs no
 * geometry of the plane, only the group table — and it is exactly the invariant
 * that decides when two labellings describe the SAME affine structure, because
 * two labellings share a line set iff they differ by a collineation, and for a
 * prime field the collineations are precisely AGL.
 */
export function planeLines(g: GroupTable, label: readonly number[]): number[][] {
  const n = label.length;
  const out: number[][] = [];
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      for (let c = b + 1; c < n; c++) {
        if (g[g[label[a]][label[b]]][label[c]] === 0) out.push([a, b, c]);
      }
    }
  }
  return out;
}

export interface PlaneStructure {
  /** Canonical key: the sorted line set. Two labellings agree iff keys agree. */
  readonly key: string;
  readonly lines: number[][];
  /** How many of the affine labellings realise this structure. */
  readonly labellings: number;
  /** The rotation's linear part is the identity — i.e. it is a translation. */
  readonly rotationIsTranslation: boolean;
  /** Is the set of inverted letters a line here? (Q1(a), per structure.) */
  readonly invertedIsLine: boolean;
  /** Is every rotation orbit a line here? (Q1(b), per structure.) */
  readonly rotationOrbitsAreLines: boolean;
  /** Are the three mirror fixed sets lines here? Forced, and checked anyway. */
  readonly mirrorSetsAreLines: boolean;
  /** One labelling realising it, for downstream measurement. */
  readonly witness: number[];
}

/**
 * Group affine labellings into affine PLANE STRUCTURES.
 *
 * This is the number the alphabet question turns on. A charge basepoint is
 * derived from an address and can be revised; a letter ↦ child-position
 * assignment written into a file cannot. So what matters is not how many
 * labellings there are (1,296) but how many are genuinely INEQUIVALENT under
 * recolouring — and recolouring is post-composition with AGL(2,3), whose orbits
 * are exactly the classes of equal line set.
 */
export function groupIntoStructures(
  g: GroupTable,
  labellings: readonly (readonly number[])[],
  k: number
): PlaneStructure[] {
  const rot = rotationOrbits(k);
  const mir = mirrorFixedSets(k);
  const inverted = alphabet(k)
    .filter((d) => d.inverted)
    .map((d) => d.index);
  const rotPerm = childPermutation(k, S3[1].perm);
  const byKey = new Map<string, PlaneStructure>();
  for (const label of labellings) {
    const lines = planeLines(g, label);
    const key = lines
      .map((l) => l.join(","))
      .sort()
      .join("|");
    const found = byKey.get(key);
    if (found) {
      byKey.set(key, { ...found, labellings: found.labellings + 1 });
      continue;
    }
    const lineSet = new Set(lines.map((l) => [...l].sort((a, b) => a - b).join(",")));
    const isLine = (s: readonly number[]) =>
      lineSet.has([...s].sort((a, b) => a - b).join(","));
    const linear = linearPart(g, inducedMap(label, rotPerm));
    byKey.set(key, {
      key,
      lines,
      labellings: 1,
      rotationIsTranslation: linear.every((x, i) => x === i),
      invertedIsLine: isLine(inverted),
      rotationOrbitsAreLines: rot.every(isLine),
      mirrorSetsAreLines: mir.every(isLine),
      witness: [...label],
    });
  }
  return [...byKey.values()];
}

// ── the arms: which decompositions are D₃-stable, and why the hub goes ────

/** Composition of two coordinate permutations: (p ∘ q)(i) = p[q[i]]. */
export const permCompose = (p: readonly number[], q: readonly number[]): number[] =>
  q.map((x) => p[x]);

/** Index into `S3` of a coordinate permutation. */
export function s3IndexOf(perm: readonly number[]): number {
  const i = S3.findIndex((s) => s.perm.every((x, j) => x === perm[j]));
  if (i < 0) throw new Error(`reptile: ${perm} is not in S3`);
  return i;
}

/**
 * How D₃ acts on the three VERTEX labels — read off the mirrors themselves.
 *
 * σ carries Fix(m_v) to Fix(σ m_v σ⁻¹), so the action on {A, B, C} is
 * conjugation on the three reflections. Computed from the S₃ table rather than
 * declared, because the whole point of the vertex coordinate is that it is the
 * triangle's own labelling and not a second one invented here.
 *
 * Returns `act[s][v]`: the vertex label σ = S3[s] sends v to.
 */
export function vertexAction(): number[][] {
  const idx = (p: readonly number[]) => s3IndexOf(p);
  const invOf = (p: readonly number[]) => {
    const q = new Array<number>(3);
    p.forEach((x, i) => (q[x] = i));
    return q;
  };
  return S3.map((s) =>
    [3, 4, 5].map((m) => {
      const conj = permCompose(permCompose(s.perm, S3[m].perm), invOf(s.perm));
      return idx(conj) - 3;
    })
  );
}

export interface ArmLetterMaps {
  /** D₃-orbits on the alphabet, with the size of each orbit's stabiliser. */
  readonly orbits: { readonly members: number[]; readonly stabiliser: number }[];
  /** Letters with no equivariant image at all: the hub. Must be excluded. */
  readonly excluded: number[];
  /** How many D₃-equivariant maps Σ ∖ excluded → {A, B, C} exist. */
  readonly maps: number;
}

/**
 * THE ARM DECOMPOSITION, counted instead of chosen.
 *
 * An arm control needs a map f from letters to the three vertex labels with
 * f(σ·d) = σ·f(d) — that is exactly "the rotation permutes the arms cyclically
 * and the mirrors permute them like the medians". Such an f is free on each
 * D₃-orbit subject to one condition: f(d) must be fixed by everything that
 * fixes d. So
 *
 *   Stab(d) = ⟨m_v⟩   →  exactly one choice, f(d) = v
 *   Stab(d) = 1       →  three choices, none distinguished
 *   Stab(d) = D₃      →  NO choice: no vertex label is fixed by all of D₃
 *
 * The last line is `arms.ts`'s excluded hub, derived rather than argued: the
 * hub is not excluded because including it would break disjointness (though it
 * would) but because there is nothing equivariant to map it to.
 *
 * At k = 3 every letter lies in exactly one mirror set, so every stabiliser is
 * a mirror subgroup, so the count is 1 — the decomposition is FORCED. At k = 2
 * it is also 1, with the hub excluded. From k = 4 the free orbits appear and
 * the count is a power of three: that is where the transversal genuinely stops
 * being canonical.
 */
export function armLetterMaps(k: number): ArmLetterMaps {
  const n = k * k;
  const perms = S3.map((s) => childPermutation(k, s.perm));
  const act = vertexAction();
  const seen = new Array<boolean>(n).fill(false);
  const orbits: { members: number[]; stabiliser: number }[] = [];
  const excluded: number[] = [];
  let maps = 1;
  for (let d = 0; d < n; d++) {
    if (seen[d]) continue;
    const members = [...new Set(perms.map((p) => p[d]))].sort((a, b) => a - b);
    members.forEach((m) => (seen[m] = true));
    const stab = perms.map((p, s) => (p[d] === d ? s : -1)).filter((s) => s >= 0);
    const choices = [0, 1, 2].filter((v) => stab.every((s) => act[s][v] === v));
    orbits.push({ members, stabiliser: stab.length });
    if (choices.length === 0) excluded.push(...members);
    else maps *= choices.length;
  }
  return { orbits, excluded, maps };
}

/**
 * Every decomposition of the alphabet into three sets the ROTATION permutes
 * cyclically — i.e. every transversal of the rotation orbits, up to which part
 * you call first.
 *
 * `docs/rep-tile-findings.md` counted these as "27 choices, none
 * distinguished". 27 is the transversal count; the DECOMPOSITION count is 9,
 * because T, πT and π²T name the same decomposition. Either number is a count
 * of rotation-stable candidates, and the point of `armLetterMaps` is that
 * demanding the MIRRORS behave too cuts it to one.
 */
export function rotationTransversals(k: number): number[][][] {
  const rot = rotationOrbits(k);
  const perm = childPermutation(k, S3[1].perm);
  if (rot.some((o) => o.length !== 3)) {
    // A short orbit is a rotation-FIXED letter, and a transversal through it
    // would put that letter in all three parts at once. Refusing is the honest
    // answer: at k = 2 the construction below does not describe a partition,
    // which is precisely why §D has to skip X rather than assign it.
    throw new Error(`reptile: k=${k} rotation does not act freely on Σ`);
  }
  const out: number[][][] = [];
  const build = (i: number, pick: number[]) => {
    if (i === rot.length) {
      const parts = [pick, pick.map((d) => perm[d]), pick.map((d) => perm[perm[d]])];
      out.push(parts.map((p) => [...p].sort((a, b) => a - b)));
      return;
    }
    for (const d of rot[i]) build(i + 1, [...pick, d]);
  };
  build(0, []);
  return out;
}

/**
 * Of those, the ones the MIRRORS also permute — i.e. the ones that give a
 * D₃-equivariant arm label rather than merely a rotation-equivariant one.
 *
 * Distinct decompositions, not distinct transversals: `rotationTransversals`
 * returns each decomposition three times (T, πT and π²T name the same three
 * parts), so this deduplicates before filtering. The count that comes out is
 * the answer to "is the transversal genuinely non-canonical".
 */
export function d3StableTransversals(k: number): number[][][] {
  const perms = S3.map((s) => childPermutation(k, s.perm));
  const norm = (part: readonly number[]) => [...part].sort((a, b) => a - b).join(",");
  const seen = new Set<string>();
  const out: number[][][] = [];
  for (const parts of rotationTransversals(k)) {
    const key = parts.map(norm).sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    const names = new Set(parts.map(norm));
    const stable = perms.every((p) =>
      parts.every((part) => names.has(norm(part.map((d) => p[d]))))
    );
    if (stable) out.push(parts);
  }
  return out;
}

// ── frames: an apex-style convention, and the single-digit rotation law ───

/**
 * Subdivide with a per-child FRAME — a permutation of the child's vertex roles.
 *
 * `subdivide` hands every child the vertex order the formula produces, which is
 * the `ifs` reading. A CONVENTION in `figure.ts`'s sense is a choice, per child,
 * of which of its vertices plays role 0 and in which order the other two follow
 * — and that choice is carried into the subtree, because the next cut is
 * written in the child's own vertex order. This is that, parameterised.
 *
 * The triangles produced are the SAME triangles either way (the tests check it
 * as point sets); only the addressing below them moves.
 */
export function subdivideFramed(
  tri: Tri,
  k: number,
  frames: readonly number[]
): Tri[] {
  return subdivide(tri, k).map((t, d) => {
    const p = S3[frames[d]].perm;
    return { v: [t.v[p[0]], t.v[p[1]], t.v[p[2]]] as const, den: t.den };
  });
}

/**
 * A frame assignment under which the ROTATION REWRITES ONLY THE FIRST DIGIT.
 *
 * `frameResidual` measures the symmetry a descent carries into the subtree: σ
 * maps child d's triple onto child π(d)'s triple, but possibly reordered, and
 * the reordering is what the address below has to absorb. With frames F the
 * residual becomes F(π(d))⁻¹ ∘ r ∘ F(d), so it vanishes for every letter iff
 *
 *     F(π(d)) = r ∘ F(d),     r = the rotation's residual (one 3-cycle, for
 *                                 every letter, at every radix — measured).
 *
 * That recurrence is solvable exactly when π has no fixed letter: walk each
 * π-orbit once, and consistency closing the orbit needs r^(orbit length) = id.
 * At rep-4 the orbit through X has length 1 and asks r = id, which is false —
 * that is `docs/symmetry-findings.md` §A's "first NON-X digit", stated as an
 * obstruction. At rep-9 the rotation acts freely, every orbit has length 3, and
 * r³ = id: the obstruction is gone and the law becomes single-digit with no
 * exception. `docs/rep-tile-findings.md` DERIVED this; here it is constructed,
 * and the test checks it cell-for-cell against the geometry.
 */
export function rotationFrames(k: number): number[] {
  const residual = frameResidual(k, S3[1].perm);
  const r = S3[residual[0]].perm;
  if (residual.some((s) => s !== residual[0])) {
    throw new Error(`reptile: k=${k} rotation residual is not uniform`);
  }
  const perm = childPermutation(k, S3[1].perm);
  const n = k * k;
  const frames = new Array<number>(n).fill(-1);
  for (let d = 0; d < n; d++) {
    if (frames[d] >= 0) continue;
    frames[d] = 0; // identity on the orbit representative
    let x = perm[d];
    let acc: readonly number[] = S3[0].perm;
    while (x !== d) {
      acc = permCompose(r, acc);
      frames[x] = s3IndexOf(acc);
      x = perm[x];
    }
    // closing the orbit must return to the identity, or no convention exists
    if (s3IndexOf(permCompose(r, acc)) !== 0) {
      throw new Error(`reptile: k=${k} has no single-digit rotation convention`);
    }
  }
  return frames;
}
