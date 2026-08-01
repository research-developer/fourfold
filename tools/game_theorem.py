#!/usr/bin/env python3
"""Verify the ftype theorem that the game's scoring rests on, and emit a
golden fixture the TypeScript implementation must reproduce exactly.

THEOREM (to verify).  Let H = {gold, purple} = {1, s2s3} be the subgroup of
V4 fixing sqrt6, and say a mirror pair (w, r_a w) is COHERENT when c(w) and
c(r_a w) lie in the same coset of H (i.e. both in {gold,purple} or both in
{blue,red}).  Let ftype(w) be the first non-X digit of w (None for the hub
X^d).  Then:

    a = A  ->  every leaf is coherent
    a = B  ->  coherent  <=>  ftype(w) = B  or  w = X^d
    a = C  ->  coherent  <=>  ftype(w) = C  or  w = X^d
"""
from fractions import Fraction as F
from collections import Counter
import json, math, sys
from pathlib import Path

GOLDEN_DIR = Path(__file__).resolve().parent.parent / "test" / "golden"

ID, S2, S3, S2S3 = 0b00, 0b10, 0b01, 0b11
V = {'A': ID, 'B': S2, 'C': S3, 'X': S2S3}
CNAME = {ID: 'gold', S2: 'blue', S3: 'red', S2S3: 'purple'}
H = {ID, S2S3}

SIDE, PADDING = 1024.0, 60.0


def build(d):
    cells = {}

    def rec(PA, PB, PC, addr, chg, ncent):
        if len(addr) == d:
            cen = tuple((PA[i] + PB[i] + PC[i]) / 3 for i in range(3))
            cells[addr] = dict(centroid=cen, charge=chg, eps=ncent % 2,
                               tri=(PA, PB, PC))
            return
        MAB = tuple((PA[i] + PB[i]) / 2 for i in range(3))
        MAC = tuple((PA[i] + PC[i]) / 2 for i in range(3))
        MBC = tuple((PB[i] + PC[i]) / 2 for i in range(3))
        rec(PA,  MAB, MAC, addr + 'A', chg ^ ID,    ncent)
        rec(PB,  MBC, MAB, addr + 'B', chg ^ S2,    ncent)
        rec(PC,  MAC, MBC, addr + 'C', chg ^ S3,    ncent)
        rec(MBC, MAC, MAB, addr + 'X', chg ^ S2S3,  ncent + 1)

    o, z = F(1), F(0)
    rec((o, z, z), (z, o, z), (z, z, o), '', ID, 0)
    return cells


PERM = {'A': (0, 2, 1), 'B': (2, 1, 0), 'C': (1, 0, 2)}


def mirror_map(cells, axis):
    p = PERM[axis]
    by_cen = {c['centroid']: a for a, c in cells.items()}
    return {a: by_cen[(c['centroid'][p[0]], c['centroid'][p[1]],
                       c['centroid'][p[2]])] for a, c in cells.items()}


def ftype(addr):
    for ch in addr:
        if ch != 'X':
            return ch
    return None


def coherent(g1, g2):
    return (g1 in H) == (g2 in H)


def bary_to_xy(b):
    """Barycentric -> SVG px, matching equilat_v4.py's apex/bl/br layout."""
    apex = (PADDING + SIDE / 2, PADDING)
    bl = (PADDING, PADDING + SIDE * math.sqrt(3) / 2)
    br = (PADDING + SIDE, PADDING + SIDE * math.sqrt(3) / 2)
    a, bb, c = float(b[0]), float(b[1]), float(b[2])
    return (round(a * apex[0] + bb * bl[0] + c * br[0], 4),
            round(a * apex[1] + bb * bl[1] + c * br[1], 4))


def verify(d):
    cells = build(d)
    mm = {ax: mirror_map(cells, ax) for ax in 'ABC'}
    hub = 'X' * d
    ok = True
    stats = {}
    for ax in 'ABC':
        m = mm[ax]
        good = set()
        for a, c in cells.items():
            if coherent(c['charge'], cells[m[a]]['charge']):
                good.add(a)
        if ax == 'A':
            predicted = set(cells)
        else:
            predicted = {a for a in cells if ftype(a) == ax} | {hub}
        match = (good == predicted)
        ok &= match
        stats[ax] = (len(good), len(cells), match)
        print(f"  axis m_{ax}: coherent {len(good):5d}/{len(cells)}  "
              f"predicted-set match: {match}")
        # mirror map must be an involution and preserve orientation
        assert all(m[m[a]] == a for a in cells), f"m_{ax} not an involution"
        assert all(cells[m[a]]['eps'] == cells[a]['eps'] for a in cells)

    # ftype classes closed under the right mirrors
    for a in cells:
        if a == hub:
            continue
        assert ftype(mm['B'][a]) == ('B' if ftype(a) == 'B'
                                     else {'A': 'C', 'C': 'A'}[ftype(a)])
        assert ftype(mm['A'][a]) == {'A': 'A', 'B': 'C', 'C': 'B'}[ftype(a)]
    print(f"  ftype classes closed under each mirror: True")
    return ok, cells, mm


def emit(d, cells, mm, path):
    hub = 'X' * d
    idx = {a: i for i, a in enumerate(sorted(cells))}
    out = []
    for a in sorted(cells):
        c = cells[a]
        verts = [bary_to_xy(v) for v in c['tri']]
        partners, axes = {}, []
        for ax in 'ABC':
            p = mm[ax][a]
            coh = coherent(c['charge'], cells[p]['charge'])
            partners[ax] = idx[p]
            if coh:
                axes.append(ax)
        out.append(dict(i=idx[a], addr=a, charge=c['charge'], eps=c['eps'],
                        ftype=ftype(a) or '', verts=verts,
                        mirror=partners, coherentAxes=axes,
                        centroid=bary_to_xy(c['centroid'])))
    payload = dict(depth=d, count=len(out), hub=idx[hub], cells=out)
    with open(path, 'w') as f:
        json.dump(payload, f, separators=(',', ':'))
    print(f"  wrote {path} ({len(out)} cells)")


if __name__ == '__main__':
    allok = True
    for d in (2, 3, 4, 5, 6):
        print(f"\ndepth {d}:")
        ok, cells, mm = verify(d)
        allok &= ok
        if d <= 4:
            emit(d, cells, mm, str(GOLDEN_DIR / f"golden_d{d}.json"))
    print(f"\nTHEOREM VERIFIED AT ALL DEPTHS: {allok}")
    sys.exit(0 if allok else 1)
