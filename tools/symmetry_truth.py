#!/usr/bin/env python3
"""Ground-truth symmetry analysis of the V4 XOR Sierpinski figure.

Establishes exactly which geometric isometries lift to color relations,
which cells participate, and what the invariants are. Everything here is
exhaustive enumeration -- no sampling, no float geometry beyond exact
dyadic barycentric coordinates.
"""
from itertools import permutations
from collections import Counter, defaultdict
from fractions import Fraction as F
import json, sys

# V4 as 2-bit ints, matching equilat_v4.py exactly
ID, S2, S3, S2S3 = 0b00, 0b10, 0b01, 0b11
V = {'A': ID, 'B': S2, 'C': S3, 'X': S2S3}
CNAME = {ID: 'gold', S2: 'blue', S3: 'red', S2S3: 'purple'}
ORDER = [ID, S2, S3, S2S3]


def build(d):
    """All 4^d leaves: address -> {centroid (exact), charge, eps}."""
    cells = {}

    def rec(PA, PB, PC, addr, chg, ncent):
        if len(addr) == d:
            cen = tuple((PA[i] + PB[i] + PC[i]) / 3 for i in range(3))
            cells[addr] = dict(centroid=cen, charge=chg, eps=ncent % 2)
            return
        MAB = tuple((PA[i] + PB[i]) / 2 for i in range(3))
        MAC = tuple((PA[i] + PC[i]) / 2 for i in range(3))
        MBC = tuple((PB[i] + PC[i]) / 2 for i in range(3))
        rec(PA,  MAB, MAC, addr + 'A', chg ^ ID,   ncent)
        rec(PB,  MBC, MAB, addr + 'B', chg ^ S2,   ncent)
        rec(PC,  MAC, MBC, addr + 'C', chg ^ S3,   ncent)
        rec(MBC, MAC, MAB, addr + 'X', chg ^ S2S3, ncent + 1)

    one, zero = F(1), F(0)
    rec((one, zero, zero), (zero, one, zero), (zero, zero, one), '', ID, 0)
    return cells


# Isometries as permutations of barycentric coords: new[i] = old[p[i]]
ISOM = {
    'id':   (0, 1, 2),
    'r_A':  (0, 2, 1),   # reflection fixing vertex A (the vertical median)
    'r_B':  (2, 1, 0),   # reflection fixing vertex B
    'r_C':  (1, 0, 2),   # reflection fixing vertex C
    'rot+': (2, 0, 1),   # 120 degree rotation
    'rot-': (1, 2, 0),   # 240 degree rotation
}


def induced_map(cells, perm):
    """Geometric isometry -> permutation of addresses, via centroids."""
    by_cen = {c['centroid']: a for a, c in cells.items()}
    out = {}
    for a, c in cells.items():
        cen = c['centroid']
        img = (cen[perm[0]], cen[perm[1]], cen[perm[2]])
        out[a] = by_cen[img]
    return out


def ftype(addr):
    """First non-X digit -- the 'odometer head'. None for the all-X hub."""
    for ch in addr:
        if ch != 'X':
            return ch
    return None


def analyse(d, verbose=True):
    cells = build(d)
    n = len(cells)
    R = {}
    print(f"\n{'='*72}\nDEPTH {d}   ({n} leaves)\n{'='*72}")

    # ---- 0. sanity: bright/dark <-> up/down is exactly eps -------------
    # (eps is by construction the parity of X's; confirm charge formula too)
    for a, c in cells.items():
        assert c['eps'] == a.count('X') % 2
        bit_s2 = (a.count('B') + a.count('X')) % 2
        bit_s3 = (a.count('C') + a.count('X')) % 2
        assert c['charge'] == (bit_s2 << 1) | bit_s3
    print("[ok] charge = (#B+#X mod 2, #C+#X mod 2); eps = #X mod 2  -- verified on all leaves")

    # ---- 1. per-isometry: best color permutation & match count --------
    print(f"\n--- 1. Which isometries lift to a color relation? ---")
    for name, perm in ISOM.items():
        m = induced_map(cells, perm)
        best, best_pi = -1, None
        for pi in permutations(ORDER):
            pmap = dict(zip(ORDER, pi))
            k = sum(1 for a in cells
                    if cells[m[a]]['charge'] == pmap[cells[a]['charge']])
            if k > best:
                best, best_pi = k, pmap
        # orientation check
        eps_ok = all(cells[m[a]]['eps'] == cells[a]['eps'] for a in cells)
        pi_desc = ", ".join(f"{CNAME[g]}->{CNAME[best_pi[g]]}" for g in ORDER)
        print(f"  {name:5s}  best match {best:5d}/{n}  ({100*best/n:5.1f}%)  "
              f"eps preserved: {eps_ok}")
        print(f"         via  {pi_desc}")
        R[name] = dict(best=best, map=m)

    # ---- 2. the twist: c(sigma w) * c(w) grouped by ftype --------------
    print(f"\n--- 2. The twist  t(w) = c(sigma w) XOR c(w),  by first non-X digit ---")
    for name in ['r_A', 'r_B', 'r_C', 'rot+', 'rot-']:
        m = R[name]['map']
        tab = defaultdict(Counter)
        for a in cells:
            t = cells[m[a]]['charge'] ^ cells[a]['charge']
            tab[ftype(a)][t] += 1
        print(f"  {name}:")
        for ft in ['A', 'B', 'C', None]:
            if ft in tab:
                items = ", ".join(f"{CNAME[t]}x{k}" for t, k in
                                  sorted(tab[ft].items()))
                lbl = ft if ft else 'hub(all-X)'
                print(f"     ftype {lbl:10s} -> twist {{{items}}}")

    # ---- 3. ftype class sizes -----------------------------------------
    fc = Counter(ftype(a) for a in cells)
    print(f"\n--- 3. ftype (first non-X digit) class sizes ---")
    print(f"  A:{fc['A']}  B:{fc['B']}  C:{fc['C']}  hub:{fc[None]}   "
          f"-> (4^d-1)/3 = {(4**d-1)//3}")

    # ---- 4. the three characters (Walsh-Hadamard / quadratic subfields)
    print(f"\n--- 4. The three nontrivial characters of V4 ---")
    chars = {
        'chi_sqrt6 (kernel {gold,purple})': lambda g: 1 if g in (ID, S2S3) else -1,
        'chi_sqrt3 (kernel {gold,blue})':   lambda g: 1 if g in (ID, S2) else -1,
        'chi_sqrt2 (kernel {gold,red})':    lambda g: 1 if g in (ID, S3) else -1,
    }
    for cname, chi in chars.items():
        # which isometries preserve this character?
        ok = []
        for name in ['r_A', 'r_B', 'r_C', 'rot+', 'rot-']:
            m = R[name]['map']
            k = sum(1 for a in cells
                    if chi(cells[m[a]]['charge']) == chi(cells[a]['charge']))
            ok.append(f"{name}:{k}/{n}")
        print(f"  {cname:36s}  {'  '.join(ok)}")

    # ---- 5. reflection joint color tables ------------------------------
    print(f"\n--- 5. Joint color table  (c(w), c(r_a w))  -- fraction of leaves ---")
    for name in ['r_A', 'r_B', 'r_C']:
        m = R[name]['map']
        jt = Counter((cells[a]['charge'], cells[m[a]]['charge']) for a in cells)
        print(f"  {name}:")
        hdr = "        " + "".join(f"{CNAME[g]:>9s}" for g in ORDER)
        print(hdr)
        for g in ORDER:
            row = f"  {CNAME[g]:>6s} " + "".join(
                f"{jt.get((g,h),0):9d}" for h in ORDER)
            print(row)

    # ---- 6. user's claims ---------------------------------------------
    print(f"\n--- 6. Checking the stated observations ---")
    gold = {a for a in cells if cells[a]['charge'] == ID}
    for name in ['r_A', 'r_B', 'r_C']:
        m = R[name]['map']
        inv = all(m[a] in gold for a in gold)
        print(f"  gold set invariant under {name}? {inv}")
    # which colors are FIXED (self-paired) by each reflection
    for name in ['r_A', 'r_B', 'r_C']:
        m = R[name]['map']
        fixed = [g for g in ORDER
                 if all(cells[m[a]]['charge'] == g
                        for a in cells if cells[a]['charge'] == g)]
        print(f"  {name}: colors mapping to themselves everywhere: "
              f"{[CNAME[g] for g in fixed]}")
    return cells, R


if __name__ == '__main__':
    for d in (3, 4, 5, 6):
        analyse(d)
