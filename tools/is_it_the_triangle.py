#!/usr/bin/env python3
"""Is the rotation obstruction about triangles, or about something else?

Three subdivision schemes, each labelled by a group of the same size as its
child set, each searched exhaustively over (isometry x colour permutation):

  1. TRIANGLE, 4 children (3 upright corners + 1 INVERTED centre), V4 labels
     -- the figure under study.
  2. SQUARE quadtree, 4 children (all translates, none reflected), V4 labels
     -- same alphabet size, same group, no orientation-reversing child.
  3. SIERPINSKI GASKET, 3 children (all upright), Z/3 labels
     -- the centre child removed entirely.

If the obstruction is "about triangles", 3 should misbehave like 1.
If it is about the INVERTED child, only 1 should misbehave.
"""
from itertools import permutations
from collections import Counter
from fractions import Fraction as F

# ---------------------------------------------------------------- triangle
ID, S3, S2, S2S3 = 0b00, 0b01, 0b10, 0b11
TRI_V = {'A': ID, 'B': S2, 'C': S3, 'X': S2S3}
V4 = [ID, S2, S3, S2S3]
TRI_ISOM = {'id': (0, 1, 2), 'r_A': (0, 2, 1), 'r_B': (2, 1, 0),
            'r_C': (1, 0, 2), 'rot+': (2, 0, 1), 'rot-': (1, 2, 0)}


def tri_build(d, with_centre=True):
    cells = {}

    def rec(PA, PB, PC, addr, chg):
        if len(addr) == d:
            cells[addr] = (tuple((PA[i] + PB[i] + PC[i]) / 3 for i in range(3)), chg)
            return
        MAB = tuple((PA[i] + PB[i]) / 2 for i in range(3))
        MAC = tuple((PA[i] + PC[i]) / 2 for i in range(3))
        MBC = tuple((PB[i] + PC[i]) / 2 for i in range(3))
        if with_centre:
            rec(PA, MAB, MAC, addr + 'A', chg ^ TRI_V['A'])
            rec(PB, MBC, MAB, addr + 'B', chg ^ TRI_V['B'])
            rec(PC, MAC, MBC, addr + 'C', chg ^ TRI_V['C'])
            rec(MBC, MAC, MAB, addr + 'X', chg ^ TRI_V['X'])
        else:
            # Sierpinski gasket: centre discarded, charges in Z/3 by SUM.
            rec(PA, MAB, MAC, addr + 'A', (chg + 0) % 3)
            rec(PB, MBC, MAB, addr + 'B', (chg + 1) % 3)
            rec(PC, MAC, MBC, addr + 'C', (chg + 2) % 3)

    o, z = F(1), F(0)
    rec((o, z, z), (z, o, z), (z, z, o), '', 0)
    return cells


def tri_scan(d, with_centre, labels):
    cells = tri_build(d, with_centre)
    by_cen = {c[0]: a for a, c in cells.items()}
    n = len(cells)
    out = {}
    for name, p in TRI_ISOM.items():
        img = {a: by_cen[(cen[p[0]], cen[p[1]], cen[p[2]])]
               for a, (cen, _) in cells.items()}
        best = max(
            sum(1 for a in cells if cells[img[a]][1] == dict(zip(labels, pi))[cells[a][1]])
            for pi in permutations(labels)
        )
        out[name] = (best, n)
    return out


# ------------------------------------------------------------------ square
SQ_ISOM = {
    'id':    lambda i, j, N: (i, j),
    'rot90': lambda i, j, N: (j, N - 1 - i),
    'rot180': lambda i, j, N: (N - 1 - i, N - 1 - j),
    'rot270': lambda i, j, N: (N - 1 - j, i),
    'mir_x': lambda i, j, N: (N - 1 - i, j),
    'mir_y': lambda i, j, N: (i, N - 1 - j),
    'diag':  lambda i, j, N: (j, i),
    'anti':  lambda i, j, N: (N - 1 - j, N - 1 - i),
}


def sq_scan(d):
    """Quadtree on a square. Digit = (bit of i, bit of j); charge = XOR."""
    N = 2 ** d
    def charge(i, j):
        return ((bin(i).count('1') % 2) << 1) | (bin(j).count('1') % 2)
    cells = {(i, j): charge(i, j) for i in range(N) for j in range(N)}
    n = len(cells)
    out = {}
    for name, f in SQ_ISOM.items():
        best = max(
            sum(1 for (i, j), g in cells.items()
                if cells[f(i, j, N)] == dict(zip(V4, pi))[g])
            for pi in permutations(V4)
        )
        out[name] = (best, n)
    return out


def show(title, rows, order):
    print(f"\n{title}")
    print("-" * len(title))
    hdr = "  " + "".join(f"{k:>9s}" for k in order)
    print(hdr)
    for d, res in rows:
        line = f"d{d}"
        for k in order:
            b, n = res[k]
            line += f"{100*b/n:>8.1f}%"
        print(line)


print("=" * 78)
print("Does the obstruction follow the TRIANGLE, or the INVERTED CHILD?")
print("=" * 78)

rows = [(d, tri_scan(d, True, V4)) for d in range(1, 6)]
show("1. TRIANGLE, 4 children (3 upright + 1 inverted centre), V4",
     rows, list(TRI_ISOM))

rows = [(d, sq_scan(d)) for d in range(1, 6)]
show("2. SQUARE quadtree, 4 children (all translates, none reflected), V4",
     rows, list(SQ_ISOM))

rows = [(d, tri_scan(d, False, [0, 1, 2])) for d in range(1, 7)]
show("3. SIERPINSKI GASKET, 3 children (all upright), Z/3",
     rows, list(TRI_ISOM))

print("""
Reading: 100% means that isometry lifts to an EXACT colour symmetry.
Anything less means no relabelling of the colours can track it.
""")
