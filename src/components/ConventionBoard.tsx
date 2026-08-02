"use client";

import { memo, useMemo } from "react";
import { AXES, H, type Axis, type Cell, type Figure } from "@/lib/figure";
import { AXIS_COLOR, FILL } from "@/lib/palette";

interface Props {
  figure: Figure;
  /** The cell whose mirror partners are drawn, if any. */
  focus: number | null;
  onFocus: (i: number | null) => void;
  showMedians: boolean;
  /** Cells whose charge differs from the other convention at the same place. */
  changed: ReadonlySet<number>;
  markChanged: boolean;
}

const patternId = (hex: string) => `cx${hex.replace("#", "")}`;

/**
 * Hatching carries the coset, exactly as it does on the game board.
 *
 * Under deuteranopia the purple and blue fills collapse to a measured ΔE of
 * 7.9 -- the same colour -- while sitting in OPPOSITE cosets of H. Hue alone
 * therefore cannot carry the distinction the whole page is about, and
 * brightness is already spent on orientation. So cells outside H are hatched,
 * always, in every mode.
 */
function hatched(cell: Cell): boolean {
  return !H.has(cell.charge);
}

const CellLayer = memo(function CellLayer({
  figure,
  changed,
  markChanged,
}: {
  figure: Figure;
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
        {hatchColours.map((hex) => (
          <pattern
            key={hex}
            id={patternId(hex)}
            patternUnits="userSpaceOnUse"
            width="7"
            height="7"
            patternTransform="rotate(45)"
          >
            <rect width="7" height="7" fill={hex} />
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
        {figure.cells.map((c) => {
          const base = FILL[c.charge][c.eps];
          const fill = hatched(c) ? `url(#${patternId(base)})` : base;
          return (
            <polygon
              key={c.i}
              points={c.verts.map((v) => `${v[0]},${v[1]}`).join(" ")}
              fill={fill}
              stroke={
                markChanged && changed.has(c.i)
                  ? "rgba(236,230,220,.85)"
                  : "rgba(10,9,8,.55)"
              }
              strokeWidth={markChanged && changed.has(c.i) ? 1.6 : 0.4}
            />
          );
        })}
      </g>
    </>
  );
});

export default function ConventionBoard({
  figure,
  focus,
  onFocus,
  showMedians,
  changed,
  markChanged,
}: Props) {
  const [A, B, C] = figure.corners;
  const mid = (p: readonly [number, number], q: readonly [number, number]) =>
    [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2] as const;

  const medians: Record<Axis, readonly [readonly [number, number], readonly [number, number]]> = {
    A: [A, mid(B, C)],
    B: [B, mid(A, C)],
    C: [C, mid(A, B)],
  };

  const focused = focus === null ? null : figure.cells[focus];

  return (
    <svg
      viewBox={`0 0 ${figure.width} ${figure.height}`}
      role="img"
      aria-label={`V4 XOR Sierpinski figure, depth ${figure.depth}, ${figure.convention} convention`}
      style={{ display: "block", width: "100%", height: "auto" }}
      onPointerLeave={() => onFocus(null)}
    >
      <CellLayer figure={figure} changed={changed} markChanged={markChanged} />

      {showMedians &&
        AXES.map((ax) => {
          const [p, q] = medians[ax];
          return (
            <line
              key={ax}
              x1={p[0]}
              y1={p[1]}
              x2={q[0]}
              y2={q[1]}
              stroke={AXIS_COLOR[ax]}
              strokeWidth={2}
              opacity={0.5}
            />
          );
        })}

      {/*
        The teaching layer. A solid link means the two cells are coherent --
        the mirror carries the colouring there. A dashed link means it does
        not. In the apex convention the two diagonals are mostly dashed; in
        the ifs convention every link is solid, at every cell.
      */}
      {focused &&
        AXES.map((ax) => {
          const j = focused.mirror[ax];
          if (j === focused.i) return null;
          const p = figured(figure, focused.i);
          const q = figured(figure, j);
          const ok = focused.coherentAxes.includes(ax);
          return (
            <g key={ax}>
              <line
                x1={p[0]}
                y1={p[1]}
                x2={q[0]}
                y2={q[1]}
                stroke={AXIS_COLOR[ax]}
                strokeWidth={ok ? 3.2 : 2}
                strokeDasharray={ok ? undefined : "6 5"}
                opacity={ok ? 0.95 : 0.6}
              />
              <circle
                cx={q[0]}
                cy={q[1]}
                r={5.5}
                fill="none"
                stroke={AXIS_COLOR[ax]}
                strokeWidth={2.4}
                strokeDasharray={ok ? undefined : "3 3"}
              />
            </g>
          );
        })}

      {focused && (
        <circle
          cx={focused.centroid[0]}
          cy={focused.centroid[1]}
          r={6.5}
          fill="none"
          stroke="#ece6dc"
          strokeWidth={2.6}
        />
      )}

      {/* Hit layer last so it takes the pointer regardless of paint order. */}
      <g>
        {figure.cells.map((c) => (
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

function figured(figure: Figure, i: number): readonly [number, number] {
  return figure.cells[i].centroid;
}
