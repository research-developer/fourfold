#!/usr/bin/env python3
"""Where, and at what scale, does the V4 XOR Sierpinski figure carry symmetry?

Three questions, all answered by exhaustive enumeration:

  Q1  As a function of SUBTREE DEPTH j, how large is the exact colour
      symmetry group of a j-deep sub-triangle?  (By covariance every
      sub-triangle spanning j levels is the depth-j figure with its palette
      left-translated, and translation cannot change the ORDER of the
      symmetry group -- so this one number describes every region at that
      scale.)

  Q2  Which colour map realises the mirror inside a given sub-triangle?
      Predicted twist: t(u) = c(u) * phi(c(u)).

  Q3  Are the three ftype arms balanced across the two H-cosets, or is
      there a parity wobble?  (The twist tables showed 683/682 splits.)
"""
from itertools import permutations
from collections import Counter
from fractions import Fraction as F

ID, S3, S2, S2S3 = 0b00, 0b01, 0b10, 0b11
V = {'A': ID, 'B': S2, 'C': S3, 'X': S2S3}
CNAME = {ID: 'gold', S3: 'red', S2: 'blue', S2S3: 'purple'}
ORDER = [ID, S2, S3, S2S3]
H = {ID, S2S3}
PHI = {ID: ID, S2: S3, S3: S2, S2S3: S2S3}   # the mirror's automorphism

ISOM = {
    'id':   (0, 1, 2),
    'r_A':  (0, 2, 1),
    'r_B':  (2, 1, 0),
    'r_C':  (1, 0, 2),
    'rot+': (2, 0, 1),
    'rot-': (1, 2, 0),
}


def build(d):
    cells = {}

    def rec(PA, PB, PC, addr, chg, nc):
        if len(addr) == d:
            cells[addr] = (tuple((PA[i] + PB[i] + PC[i]) / 3 for i in range(3)),
                           chg, nc % 2)
            return
        MAB = tuple((PA[i] + PB[i]) / 2 for i in range(3))
        MAC = tuple((PA[i] + PC[i]) / 2 for i in range(3))
        MBC = tuple((PB[i] + PC[i]) / 2 for i in range(3))
        rec(PA, MAB, MAC, addr + 'A', chg ^ ID,   nc)
        rec(PB, MBC, MAB, addr + 'B', chg ^ S2,   nc)
        rec(PC, MAC, MBC, addr + 'C', chg ^ S3,   nc)
        rec(MBC, MAC, MAB, addr + 'X', chg ^ S2S3, nc + 1)

    o, z = F(1), F(0)
    rec((o, z, z), (z, o, z), (z, z, o), '', ID, 0)
    return cells


def sym_group(d):
    """Which isometries admit a colour permutation matching EVERY leaf."""
    cells = build(d)
    by_cen = {c[0]: a for a, c in cells.items()}
    exact = {}
    for name, p in ISOM.items():
        img = {}
        for a, (cen, _, _) in cells.items():
            img[a] = by_cen[(cen[p[0]], cen[p[1]], cen[p[2]])]
        for pi in permutations(ORDER):
            pm = dict(zip(ORDER, pi))
            if all(cells[img[a]][1] == pm[cells[a][1]] for a in cells):
                exact[name] = pm
                break
    return exact, len(cells)


print("=" * 74)
print("Q1  Exact colour-symmetry group of a j-deep sub-triangle")
print("=" * 74)
print(f"{'j':>2}  {'leaves':>7}  {'|group|':>7}  isometries that lift exactly")
print("-" * 74)
for j in range(0, 7):
    exact, n = sym_group(j)
    names = " ".join(sorted(exact, key=lambda s: list(ISOM).index(s)))
    print(f"{j:>2}  {n:>7}  {len(exact):>7}  {names}")

print()
print("=" * 74)
print("Q2  Which colour map realises the mirror inside a sub-triangle?")
print("=" * 74)
print("predicted twist t(u) = c(u) XOR phi(c(u)); mirror map = L_t . phi")
for g in ORDER:
    t = g ^ PHI[g]
    print(f"   prefix charge {CNAME[g]:<7} -> twist {CNAME[t]:<7}"
          f"   {'same map as the whole figure' if t == ID else 'H-cosets swapped: gold<->purple, blue<->red'}")

# verify on real sub-triangles
print("\n   verifying on every sub-triangle of the depth-6 figure:")
d = 6
cells = build(d)
bad = 0
checked = Counter()
for k in range(1, d):
    for u in {a[:k] for a in cells}:
        cu = ID
        for ch in u:
            cu ^= V[ch]
        sub = {a[k:]: cells[a][1] for a in cells if a.startswith(u)}
        # mirror inside the subtree acts on suffixes by the B<->C swap
        swap = str.maketrans('BC', 'CB')
        t_expected = cu ^ PHI[cu]
        for w, val in sub.items():
            if sub[w.translate(swap)] != (t_expected ^ PHI[val]):
                bad += 1
        checked[t_expected] += 1
print(f"   sub-triangles checked: {sum(checked.values())}   mismatches: {bad}")
print(f"   with twist gold (same map): {checked[ID]}"
      f"   with twist purple (cosets swapped): {checked[S2S3]}")

print()
print("=" * 74)
print("Q3  Are the ftype arms balanced across the two H-cosets?")
print("=" * 74)
print(f"{'d':>2}  {'arm':>4}  {'in H':>7}  {'outside H':>9}  {'diff':>5}")
print("-" * 74)


def ftype(a):
    for ch in a:
        if ch != 'X':
            return ch
    return None


for d in range(1, 9):
    cs = build(d) if d <= 7 else None
    if cs is None:
        break
    tab = {}
    for a, (_, chg, _) in cs.items():
        f = ftype(a)
        key = f if f else 'hub'
        inh = chg in H
        tab.setdefault(key, [0, 0])[0 if inh else 1] += 1
    for key in ['A', 'B', 'C', 'hub']:
        if key in tab:
            a_, b_ = tab[key]
            print(f"{d:>2}  {key:>4}  {a_:>7}  {b_:>9}  {a_-b_:>+5}")
    print()
