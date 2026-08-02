"""Which subgroup of Aut(V4) is geometrically realised, per child-role convention.

The figure's four children are the SAME four triangles in both conventions --
three upright corners and one inverted centre. What differs is which vertex of
each child plays role A, role B and role C, because that ordering is what the
recursion carries down and therefore what decides the digit at every deeper
level.

    apex : every corner child keeps the PARENT's corner as its role-A vertex.
           This is what equilat_v4.py and src/lib/figure.ts implement.
    ifs  : each corner child's roles are the images of (A,B,C) under the
           homothety that produces it -- the standard IFS reading.

The centre child is (M_BC, M_AC, M_AB) in both, and is inverted in both. So
this script isolates the role convention as a variable with the inverted child
held fixed.

Method: exhaustive. Every leaf, every triangle isometry (the six coordinate
permutations of barycentrics), every one of the 24 permutations of V4. No
sampling, no tolerance -- cells are located by exact integer centroid key.

Run:  python3 tools/conventions.py
"""

from itertools import permutations

ID, S3, S2, S2S3 = 0b00, 0b01, 0b10, 0b11
NAME = {ID: "1", S2: "s2", S3: "s3", S2S3: "s2s3"}

# The six isometries of the triangle, as permutations of barycentric slots.
ISOM = {
    "id":    (0, 1, 2),
    "rot+":  (2, 0, 1),
    "rot-":  (1, 2, 0),
    "mir_A": (0, 2, 1),
    "mir_B": (2, 1, 0),
    "mir_C": (1, 0, 2),
}


def half(p, q):
    return ((p[0] + q[0]) // 2, (p[1] + q[1]) // 2, (p[2] + q[2]) // 2)


def children(PA, PB, PC, conv):
    """The four children as (roleA, roleB, roleC, charge)."""
    MAB, MAC, MBC = half(PA, PB), half(PA, PC), half(PB, PC)
    if conv == "apex":
        return [
            (PA, MAB, MAC, ID),
            (PB, MBC, MAB, S2),
            (PC, MAC, MBC, S3),
            (MBC, MAC, MAB, S2S3),
        ]
    if conv == "ifs":
        return [
            (PA, MAB, MAC, ID),
            (MAB, PB, MBC, S2),
            (MAC, MBC, PC, S3),
            (MBC, MAC, MAB, S2S3),
        ]
    raise ValueError(conv)


def build(depth, conv):
    """-> {centroid_key: (charge, eps)} plus the raw triangle set."""
    scale = 2 ** depth
    out, tris = {}, set()

    def walk(PA, PB, PC, charge, ncent, k):
        if k == depth:
            key = tuple(a + b + c for a, b, c in zip(PA, PB, PC))
            assert key not in out, "duplicate cell"
            out[key] = (charge, ncent % 2)
            tris.add(frozenset((PA, PB, PC)))
            return
        for (a, b, c, v) in children(PA, PB, PC, conv):
            walk(a, b, c, charge ^ v, ncent + (1 if v == S2S3 else 0), k + 1)

    walk((scale, 0, 0), (0, scale, 0), (0, 0, scale), ID, 0, 0)
    return out, tris


def realised(depth, conv):
    """For each isometry, the best V4 permutation and how many cells it matches."""
    cells, _ = build(depth, conv)
    n = len(cells)
    rows = {}
    for iname, p in ISOM.items():
        # The isometry must permute the CELL SET, or the question is malformed.
        moved = {}
        for key in cells:
            img = (key[p[0]], key[p[1]], key[p[2]])
            assert img in cells, f"{iname}: geometry not invariant"
            moved[key] = img
        best, best_perm = -1, None
        for perm in permutations([ID, S3, S2, S2S3]):
            pi = {g: perm[i] for i, g in enumerate([ID, S3, S2, S2S3])}
            hits = sum(1 for k, img in moved.items()
                       if cells[img][0] == pi[cells[k][0]])
            if hits > best:
                best, best_perm = hits, pi
        rows[iname] = (best, n, best_perm)
    return rows


def char_preserved(depth, conv, kernel):
    """How many cells have their m_A mirror in the same coset of `kernel`."""
    cells, _ = build(depth, conv)
    p = ISOM["mir_A"]
    hit = 0
    for key, (c, _e) in cells.items():
        img = (key[p[0]], key[p[1]], key[p[2]])
        if (c in kernel) == (cells[img][0] in kernel):
            hit += 1
    return hit, len(cells)


if __name__ == "__main__":
    print("Geometry identical across conventions (same triangle set):")
    for d in range(2, 7):
        _, ta = build(d, "apex")
        _, ti = build(d, "ifs")
        print(f"  d={d}: {ta == ti}  ({len(ta)} triangles)")

    for conv in ("apex", "ifs"):
        print(f"\n=== {conv} convention ===")
        for d in range(2, 7):
            rows = realised(d, conv)
            exact = [k for k, (h, n, _) in rows.items() if h == n]
            summary = "  ".join(
                f"{k} {h}/{n}" for k, (h, n, _) in rows.items()
            )
            print(f"  d={d}: {summary}")
            print(f"        exact: {exact}  (order {len(exact)})")
        # Which V4 permutation the rotation realises, at one depth.
        rows = realised(4, conv)
        h, n, pi = rows["rot+"]
        if h == n:
            print("  rot+ realises: " +
                  ", ".join(f"{NAME[g]}->{NAME[pi[g]]}" for g in
                            [ID, S2, S3, S2S3]))

    print("\nCharacter preservation under m_A (the section E table):")
    for conv in ("apex", "ifs"):
        for label, ker in (("chi_sqrt6", {ID, S2S3}),
                           ("chi_sqrt3", {ID, S2}),
                           ("chi_sqrt2", {ID, S3})):
            hit, tot = char_preserved(6, conv, ker)
            print(f"  {conv:4} d=6 {label}: {hit}/{tot}")
