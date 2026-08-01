#!/usr/bin/env python3
"""Render the FOURFOLD board views as standalone SVG, matching the app exactly."""
import math, subprocess, sys

ID, S3, S2, S2S3 = 0b00, 0b01, 0b10, 0b11
V = {'A': ID, 'B': S2, 'C': S3, 'X': S2S3}
H = {ID, S2S3}
FILL = {ID: ("#d4a017", "#9c7510"), S3: ("#d6336c", "#9b2350"),
        S2: ("#1f6feb", "#1450a5"), S2S3: ("#7c3aed", "#5a26b0")}
COSET = {True: ("#d4a017", "#9c7510"), False: ("#1f6feb", "#1450a5")}
PHASE = {True: ("#d4a017", "#9c7510"), False: ("#7c3aed", "#5a26b0")}

SIDE, PAD = 1024.0, 26.0
W = SIDE + 2 * PAD
Hh = SIDE * math.sqrt(3) / 2 + 2 * PAD
INK = "#121010"


def build(d):
    out = []

    def rec(PA, PB, PC, addr, chg, nc):
        if len(addr) == d:
            out.append((addr, chg, nc % 2, (PA, PB, PC)))
            return
        MAB = tuple((PA[i] + PB[i]) / 2 for i in range(3))
        MAC = tuple((PA[i] + PC[i]) / 2 for i in range(3))
        MBC = tuple((PB[i] + PC[i]) / 2 for i in range(3))
        rec(PA, MAB, MAC, addr + 'A', chg ^ ID, nc)
        rec(PB, MBC, MAB, addr + 'B', chg ^ S2, nc)
        rec(PC, MAC, MBC, addr + 'C', chg ^ S3, nc)
        rec(MBC, MAC, MAB, addr + 'X', chg ^ S2S3, nc + 1)

    rec((1.0, 0, 0), (0, 1.0, 0), (0, 0, 1.0), '', ID, 0)
    return out


def xy(b):
    apex = (PAD + SIDE / 2, PAD)
    bl = (PAD, PAD + SIDE * math.sqrt(3) / 2)
    br = (PAD + SIDE, PAD + SIDE * math.sqrt(3) / 2)
    return (b[0] * apex[0] + b[1] * bl[0] + b[2] * br[0],
            b[0] * apex[1] + b[1] * bl[1] + b[2] * br[1])


def prefix_charge(addr, k):
    c = ID
    for ch in addr[:k]:
        c ^= V[ch]
    return c


def pid(hex_):
    return "hx" + hex_.replace("#", "")


def panel(d, mode, k=None, ox=0.0, oy=0.0, scale=1.0):
    """One board as an SVG group, plus the set of colours needing a hatch."""
    cells = build(d)
    period = max(7.0, SIDE / (2 ** d) / 3)
    body, hatched = [], set()
    for addr, chg, eps, tri in cells:
        inH = chg in H
        if mode == 'charge':
            base = FILL[chg][eps]
        elif mode == 'coset':
            base = COSET[inH][eps]
        else:
            base = PHASE[prefix_charge(addr, k) in H][eps]
        if not inH:
            hatched.add(base)
            fill = f"url(#{pid(base)})"
        else:
            fill = base
        pts = " ".join(f"{xy(v)[0]:.2f},{xy(v)[1]:.2f}" for v in tri)
        body.append(f'<polygon points="{pts}" fill="{fill}" '
                    f'stroke="#0a0908" stroke-width="{0.5/scale:.2f}"/>')
    g = (f'<g transform="translate({ox},{oy}) scale({scale})">'
         + "".join(body) + '</g>')
    return g, hatched, period


def defs_for(colours, period):
    out = []
    for hexv in sorted(colours):
        out.append(
            f'<pattern id="{pid(hexv)}" width="{period:.2f}" height="{period:.2f}" '
            f'patternUnits="userSpaceOnUse" patternTransform="rotate(45)">'
            f'<rect width="{period:.2f}" height="{period:.2f}" fill="{hexv}"/>'
            f'<line x1="0" y1="0" x2="0" y2="{period:.2f}" stroke="#0a0908" '
            f'stroke-opacity="0.42" stroke-width="{period/2.4:.2f}"/></pattern>')
    return "".join(out)


def single(d, mode, k, path, title):
    g, hatched, period = panel(d, mode, k)
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W:.0f}" '
           f'height="{Hh+54:.0f}" viewBox="0 0 {W:.0f} {Hh+54:.0f}">'
           f'<rect width="{W:.0f}" height="{Hh+54:.0f}" fill="{INK}"/>'
           f'<defs>{defs_for(hatched, period)}</defs>{g}'
           f'<text x="{PAD}" y="{Hh+34:.0f}" font-family="monospace" '
           f'font-size="21" fill="#8a8078" letter-spacing="2.5">{title}</text></svg>')
    open(path + ".svg", "w").write(svg)
    subprocess.run(["/opt/anaconda3/bin/cairosvg", path + ".svg", "-o",
                    path + ".png", "--output-width", "1500"], check=True)
    print("wrote", path + ".png")


def grid(d, levels, path, title):
    """2x2 of the phase field at increasing scale."""
    cols, gap = 2, 34.0
    cw = W
    ch = Hh + 46
    allh = set()
    parts, period = [], None
    for i, k in enumerate(levels):
        ox = (i % cols) * (cw + gap)
        oy = (i // cols) * (ch + gap)
        g, hh, period = panel(d, 'phase', k, ox, oy, 1.0)
        allh |= hh
        parts.append(g)
        parts.append(
            f'<text x="{ox+PAD}" y="{oy+Hh+32:.0f}" font-family="monospace" '
            f'font-size="24" fill="#8a8078" letter-spacing="2.5">'
            f'scale {k} — {4**k} regions</text>')
    tw = cols * cw + gap
    th = 2 * ch + gap + 52
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{tw:.0f}" '
           f'height="{th:.0f}" viewBox="0 0 {tw:.0f} {th:.0f}">'
           f'<rect width="{tw:.0f}" height="{th:.0f}" fill="{INK}"/>'
           f'<defs>{defs_for(allh, period)}</defs>' + "".join(parts) +
           f'<text x="{PAD}" y="{th-16:.0f}" font-family="monospace" '
           f'font-size="26" fill="#ece6dc" letter-spacing="2.5">{title}</text></svg>')
    open(path + ".svg", "w").write(svg)
    subprocess.run(["/opt/anaconda3/bin/cairosvg", path + ".svg", "-o",
                    path + ".png", "--output-width", "1800"], check=True)
    print("wrote", path + ".png")


if __name__ == '__main__':
    single(5, 'charge', None, "view_charge",
           "CHARGE — the four Galois automorphisms, depth 5, 1024 cells")
    single(5, 'coset', None, "view_coset",
           "COSET — H (gold) vs its complement (blue, hatched)")
    grid(5, [1, 2, 3, 5], "view_phase_grid",
         "MIRROR PHASE — gold: region mirrors in phase   purple: H-cosets swapped")
