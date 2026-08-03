"use client";

import { SECTORS } from "@/lib/view";
import styles from "./draw.module.css";

/**
 * Which sector the plate is framed on.
 *
 * The glyph is the FIGURE, not an icon of it. Six wedges, drawn where the model
 * actually puts them — sector s spans 60°·s to 60°·(s+1), anticlockwise from
 * east, exactly as `buildHexagon` lays out its corners — with the framed one
 * lit and the other five still drawn. That is the whole argument of this change
 * made visible: choosing a sector does not destroy the rest of the plate, it
 * picks which part of one figure you are looking at, and a control that showed
 * a lone triangle would be saying the opposite.
 *
 * Same idiom as `BrushDial`, deliberately: a button whose face is computed from
 * the same geometry as the thing it selects cannot drift away from it.
 */

/** Circumradius of the glyph hexagon, in its own viewBox units. */
const R = 40;

/** Corner k of the hexagon, in SVG pixels — y negated so 60°·k runs anticlockwise. */
const corner = (k: number): [number, number] => {
  const t = (Math.PI / 180) * 60 * (((k % 6) + 6) % 6);
  return [R * Math.cos(t), -R * Math.sin(t)];
};

const wedge = (s: number): string => {
  const b = corner(s);
  const c = corner(s + 1);
  return `0,0 ${b[0]},${b[1]} ${c[0]},${c[1]}`;
};

const OUTLINE = SECTORS.map((k) => corner(k).join(",")).join(" ");

export function SectorGlyph({
  /** The framed sector, or `null` for the whole plate. */
  sector,
  active,
}: {
  sector: number | null;
  active: boolean;
}) {
  const lit = active ? "#ece6dc" : "#8a8078";
  return (
    <svg viewBox="-50 -50 100 100" className={styles.sectorGlyph} aria-hidden="true">
      {/* The five that are not framed. Drawn, always — they are still the
          plate, and still hold whatever paint they held. */}
      {SECTORS.map((s) => {
        const framed = sector === null || sector === s;
        return (
          <polygon
            key={s}
            points={wedge(s)}
            fill={framed ? lit : "#171413"}
            fillOpacity={sector === null ? (active ? 0.8 : 0.34) : 1}
            stroke="#2b2724"
            strokeWidth={1.5}
            strokeLinejoin="round"
          />
        );
      })}
      <polygon
        points={OUTLINE}
        fill="none"
        stroke={active ? "#ece6dc" : "#5a534b"}
        strokeWidth={2.4}
        strokeLinejoin="round"
        opacity={active ? 0.9 : 0.55}
      />
      {/* The shared apex-eye: every sector's vertex A is this point, which is
          why a framed sector reads as a triangle with its apex at the centre. */}
      <circle r={3.2} fill="#0a0908" stroke={lit} strokeWidth={1.6} />
    </svg>
  );
}

interface Props {
  sector: number;
  onPick: (s: number) => void;
  /** Cells in one sector, for the label. */
  perSector: number;
}

export default function SectorDial({ sector, onPick, perSector }: Props) {
  return (
    <div className={styles.sectorDial} role="group" aria-label="framed sector">
      {SECTORS.map((s) => (
        <button
          key={s}
          type="button"
          className={styles.sectorBtn}
          aria-pressed={sector === s}
          aria-label={`frame sector ${s} — ${perSector} cells, apex at the plate's centre; nothing is cleared`}
          onClick={() => onPick(s)}
        >
          <SectorGlyph sector={s} active={sector === s} />
          <span className={styles.sectorNum}>{s}</span>
        </button>
      ))}
    </div>
  );
}
