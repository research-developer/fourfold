#!/usr/bin/env python3
"""Controlled experiment: same square, same V4, same 4-letter alphabet.
The ONLY variable is whether one quadrant's own subdivision is point-reflected.
"""
from itertools import permutations
from fractions import Fraction as F

V4 = [0b00, 0b01, 0b10, 0b11]
# quadrant slots in fixed geometric order: SW, SE, NW, NE
CH = {0: 0b00, 1: 0b10, 2: 0b01, 3: 0b11}
# a 180-degree turn of a square swaps SW<->NE and SE<->NW
ROT180 = {0: 3, 1: 2, 2: 1, 3: 0}
IDENT = {0: 0, 1: 1, 2: 2, 3: 3}

def build(d, twisted_slot=None):
    """Leaves keyed by exact (x,y) centre; value = accumulated V4 charge."""
    cells = {}
    def rec(x, y, s, depth, chg, frame):
        if depth == d:
            cells[(x + s / 2, y + s / 2)] = chg
            return
        h = s / 2
        # geometric position of each slot, before the frame is applied
        pos = {0: (x, y), 1: (x + h, y), 2: (x, y + h), 3: (x + h, y + h)}
        for slot in range(4):
            g = frame[slot]                    # which geometric cell it lands in
            nx, ny = pos[g]
            nframe = frame
            if twisted_slot is not None and slot == twisted_slot:
                # this child's own subdivision is turned through 180 degrees
                nframe = {k: frame[ROT180[k]] for k in range(4)}
            rec(nx, ny, h, depth + 1, chg ^ CH[slot], nframe)
    rec(F(0), F(0), F(1), 0, 0, IDENT)
    return cells

ISOM = {
    'id':     lambda x, y: (x, y),
    'rot90':  lambda x, y: (y, 1 - x),
    'rot180': lambda x, y: (1 - x, 1 - y),
    'mir_x':  lambda x, y: (1 - x, y),
    'diag':   lambda x, y: (y, x),
}

def scan(d, twisted_slot):
    cells = build(d, twisted_slot)
    n = len(cells)
    out = {}
    for name, f in ISOM.items():
        img = {}
        ok = True
        for (x, y) in cells:
            t = f(x, y)
            if t not in cells:
                ok = False
                break
            img[(x, y)] = t
        if not ok:
            out[name] = (0, n)
            continue
        best = max(
            sum(1 for p in cells if cells[img[p]] == dict(zip(V4, pi))[cells[p]])
            for pi in permutations(V4)
        )
        out[name] = (best, n)
    return out

for label, slot in [("PLAIN quadtree (all four children translates)", None),
                    ("TWISTED quadtree (one child point-reflected)", 3)]:
    print(f"\n{label}")
    print("-" * len(label))
    print("      " + "".join(f"{k:>9s}" for k in ISOM))
    for d in range(1, 6):
        r = scan(d, slot)
        print(f"  d{d}  " + "".join(f"{100*r[k][0]/r[k][1]:>8.1f}%" for k in ISOM))
