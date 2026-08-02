"use client";

import { memo, useMemo } from "react";
import { H, type Charge } from "@/lib/figure";
import { FILL } from "@/lib/palette";
import {
  HEX_ISOMETRIES,
  indexMap,
  type Hexagon,
  type HexIsometry,
} from "@/lib/hexagon";

interface Props {
  hex: Hexagon;
  focus: number | null;
  onFocus: (i: number | null) => void;
  showMedians: boolean;
  /** Cells the other convention labels differently. */
  changed: ReadonlySet<number>;
  markChanged: boolean;
}

const patternId = (hex: string) => `hxp${hex.replace("#", "")}`;

/** Hatching carries the coset, exactly as on the triangle board. */
const isHatched = (charge: Charge) => !H.has(charge);

const CellLayer = memo(function CellLayer({
  hex,
  changed,
  markChanged,
}: {
  hex: Hexagon;
  changed: ReadonlySet<number>;
  markChanged: boolean;
}) {
  const hatchColours = useMemo(() => {
    const out = new Set<string>();
    for (const ch of [1, 2] as const) {
      out.add(FILL[ch][0]);
      out.add(FILL[ch][1]);
    }
    return [...out];
  }, []);

  return (
    <>
      <defs>
        {hatchColours.map((c) => (
          <pattern
            key={c}
            id={patternId(c)}
            patternUnits="userSpaceOnUse"
            width="7"
            height="7"
            patternTransform="rotate(45)"
          >
            <rect width="7" height="7" fill={c} />
            <line
              x1="0"
              y1="0"
              x2="0"
              y2="7"
              stroke="rgba(0,0,0,.42)"
              strokeWidth="2.4"
            />
          </pattern>
        ))}
      </defs>
      <g>
        {hex.cells.map((c) => {
          const base = FILL[c.charge][c.eps];
          return (
            <polygon
              key={c.i}
              points={c.verts.map((v) => `${v[0]},${v[1]}`).join(" ")}
              fill={isHatched(c.charge) ? `url(#${patternId(base)})` : base}
              stroke={
                markChanged && changed.has(c.i)
                  ? "rgba(236,230,220,.85)"
                  : "rgba(10,9,8,.5)"
              }
              strokeWidth={markChanged && changed.has(c.i) ? 1.4 : 0.35}
            />
          );
        })}
      </g>
    </>
  );
});

/** The six mirrors, used for the hover readout. */
export const HEX_MIRRORS: HexIsometry[] = HEX_ISOMETRIES.filter((g) => g.flip);

export default function HexBoard({
  hex,
  focus,
  onFocus,
  showMedians,
  changed,
  markChanged,
}: Props) {
  const [cx, cy] = hex.centre;
  const R = hex.radius;

  /** Index maps for the six mirrors, so hover can follow a cell across seams. */
  const mirrorMaps = useMemo(
    () => HEX_MIRRORS.map((g) => ({ g, map: indexMap(hex, g) })),
    [hex]
  );

  const focused = focus === null ? null : hex.cells[focus];

  /**
   * The six mirror lines as full diameters. Even k lie on sector boundaries,
   * odd k on sector spines — each spine being the apex median of two opposite
   * sectors, collinear through the centre.
   */
  const lines = ([0, 1, 2, 3, 4, 5] as const).map((k) => {
    const t = (Math.PI / 180) * 30 * k;
    const dx = Math.cos(t) * R;
    const dy = Math.sin(t) * R;
    return {
      k,
      spine: k % 2 === 1,
      x1: cx - dx,
      y1: cy + dy,
      x2: cx + dx,
      y2: cy - dy,
    };
  });

  return (
    <svg
      viewBox={`0 0 ${hex.width} ${hex.height}`}
      role="img"
      aria-label={`Hexagon of six V4 sectors, depth ${hex.depth}, ${hex.convention} convention, ${hex.cells.length} cells`}
      style={{ display: "block", width: "100%", height: "auto" }}
      onPointerLeave={() => onFocus(null)}
    >
      <CellLayer hex={hex} changed={changed} markChanged={markChanged} />

      {showMedians &&
        lines.map((l) => (
          <line
            key={l.k}
            x1={l.x1}
            y1={l.y1}
            x2={l.x2}
            y2={l.y2}
            stroke={l.spine ? "#67e8f9" : "#f59e0b"}
            strokeWidth={l.spine ? 2.2 : 1.6}
            strokeDasharray={l.spine ? undefined : "7 6"}
            opacity={l.spine ? 0.6 : 0.5}
          />
        ))}

      {/* Mirror partners across sector seams. Solid = charge-coherent. */}
      {focused &&
        mirrorMaps.map(({ g, map }) => {
          const j = map[focused.i];
          if (j === focused.i) return null;
          const p = focused.centroid;
          const q = hex.cells[j].centroid;
          const ok = H.has(focused.charge) === H.has(hex.cells[j].charge);
          return (
            <g key={g.name}>
              <line
                x1={p[0]}
                y1={p[1]}
                x2={q[0]}
                y2={q[1]}
                stroke={g.k % 2 === 1 ? "#67e8f9" : "#f59e0b"}
                strokeWidth={ok ? 2.6 : 1.6}
                strokeDasharray={ok ? undefined : "5 4"}
                opacity={ok ? 0.9 : 0.55}
              />
              <circle
                cx={q[0]}
                cy={q[1]}
                r={4.5}
                fill="none"
                stroke={g.k % 2 === 1 ? "#67e8f9" : "#f59e0b"}
                strokeWidth={2}
              />
            </g>
          );
        })}

      {focused && (
        <circle
          cx={focused.centroid[0]}
          cy={focused.centroid[1]}
          r={5.5}
          fill="none"
          stroke="#ece6dc"
          strokeWidth={2.4}
        />
      )}

      <g>
        {hex.cells.map((c) => (
          <polygon
            key={c.i}
            points={c.verts.map((v) => `${v[0]},${v[1]}`).join(" ")}
            fill="transparent"
            style={{ cursor: "pointer" }}
            onPointerEnter={() => onFocus(c.i)}
            onClick={() => onFocus(c.i)}
          />
        ))}
      </g>
    </svg>
  );
}
