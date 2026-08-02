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


# ── the hexagon canvas ──────────────────────────────────────────────────
#
# Six copies of the depth-d triangle sharing their apex at a common centre.
# Six 60-degree apex angles close the circle exactly, so the sectors tile a
# regular hexagon of 6*4^d cells.
#
# Work in the Eisenstein basis e1 = (1,0), e2 = (1/2, sqrt3/2), where a 60
# degree rotation is an INTEGER matrix. Placing the base triangle with apex at
# the origin, B at scale*e1 and C at scale*e2 makes the barycentric-to-lattice
# map trivial: a vertex (x,y,z) with x+y+z = scale sits at (y, z).
#
# This is the Python twin of src/lib/hexagon.ts. Cell ORDER must match it
# exactly -- sector outermost, base cells in recursion order -- because the
# committed fixtures are compared index by index.


def lat_rot(v):
    """Rotation by +60 degrees. Exact, integer, order 6."""
    return (-v[1], v[0] + v[1])


def lat_refl(v):
    """Reflection across the e1 axis. Exact, integer, an involution."""
    return (v[0] + v[1], -v[1])


def lat_rot_k(v, k):
    for _ in range(k % 6):
        v = lat_rot(v)
    return v


def bary_to_lat(v):
    return (v[1], v[2])


# R^k for k = 0..5, then R^k . M for k = 0..5. The mirror line of R^k . M lies
# at 30k degrees, so even k are the sector-boundary diameters and odd k the
# sector-spine diameters.
HEX_ISOM = (
    [(f"r{60*k}" if k else "r0", False, k) for k in range(6)]
    + [(f"m{30*k}", True, k) for k in range(6)]
)


def hex_apply(v, flip, k):
    return lat_rot_k(lat_refl(v) if flip else v, k)


def build_cells(depth, conv):
    """Base-triangle cells in recursion order: (bary verts, charge, eps)."""
    scale = 2 ** depth
    out = []

    def walk(PA, PB, PC, charge, ncent, k):
        if k == depth:
            out.append(((PA, PB, PC), charge, ncent % 2))
            return
        for (a, b, c, v) in children(PA, PB, PC, conv):
            walk(a, b, c, charge ^ v, ncent + (1 if v == S2S3 else 0), k + 1)

    walk((scale, 0, 0), (0, scale, 0), (0, 0, scale), ID, 0, 0)
    return out


def build_hexagon(depth, conv):
    """-> (cells, by_key). Cell = (sector, base_index, charge, eps_drawn, key)."""
    base = build_cells(depth, conv)
    cells, by_key = [], {}
    for s in range(6):
        for bi, (verts, charge, eps) in enumerate(base):
            lat = [lat_rot_k(bary_to_lat(v), s) for v in verts]
            key = (sum(p[0] for p in lat), sum(p[1] for p in lat))
            assert key not in by_key, f"hexagon: duplicate key {key}"
            by_key[key] = len(cells)
            cells.append((s, bi, charge, eps ^ (s & 1), key))
    return cells, by_key


def hex_lift(depth, conv):
    """Per isometry: best over all 24 relabellings of V4, every cell checked."""
    cells, by_key = build_hexagon(depth, conv)
    n = len(cells)
    rows = {}
    for name, flip, k in HEX_ISOM:
        image = []
        for (_s, _b, _c, _e, key) in cells:
            j = by_key.get(hex_apply(key, flip, k))
            assert j is not None, f"{name}: hexagon not invariant"
            image.append(j)
        best = -1
        for perm in permutations([ID, S3, S2, S2S3]):
            pi = {g: perm[i] for i, g in enumerate([ID, S3, S2, S2S3])}
            hits = sum(1 for i in range(n) if cells[image[i]][2] == pi[cells[i][2]])
            best = max(best, hits)
        rows[name] = (best, n)
    return rows


def hex_census(depth, conv):
    cells, _ = build_hexagon(depth, conv)
    up = sum(1 for c in cells if c[3] == 0)
    return {"up": up, "down": len(cells) - up, "total": len(cells)}


def tri_census(depth, conv):
    base = build_cells(depth, conv)
    up = sum(1 for (_v, _c, e) in base if e == 0)
    return {"up": up, "down": len(base) - up, "total": len(base)}


def emit_fixtures(out_dir):
    """Write the parity fixtures the TypeScript gates compare against."""
    import json
    import os

    for depth in (1, 2, 3):
        payload = {"depth": depth, "conventions": {}}
        for conv in ("apex", "ifs"):
            rows = hex_lift(depth, conv)
            payload["conventions"][conv] = {
                "lift": {k: {"matches": v[0], "total": v[1]} for k, v in rows.items()},
                "hexCensus": hex_census(depth, conv),
                "triangleCensus": tri_census(depth, conv),
            }
        path = os.path.join(out_dir, f"hex_d{depth}.json")
        with open(path, "w") as f:
            json.dump(payload, f, indent=2, sort_keys=True)
            f.write("\n")
        print(f"wrote {path}")


if __name__ == "__main__":
    import sys

    if "--emit" in sys.argv:
        emit_fixtures(sys.argv[sys.argv.index("--emit") + 1])
        sys.exit(0)

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
