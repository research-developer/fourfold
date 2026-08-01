"use client";

import { memo, useCallback, useMemo, useState } from "react";
import { AXES, type Axis, type Cell, type Figure } from "@/lib/figure";
import { AXIS_COLOR, FILL, PLAYER_COLOR } from "@/lib/palette";
import type { PlayerId } from "@/lib/game";

/** Load-reveal order: the three rotation orbits, then the hub. */
const WAVE: Record<string, number> = { A: 0, B: 1, C: 2, "": 3 };

interface BoardProps {
  figure: Figure;
  selection: ReadonlySet<number>;
  owner: (PlayerId | null)[];
  scoringCells: ReadonlySet<number>;
  showMedians: boolean;
  onToggle: (i: number) => void;
  onHover: (i: number | null) => void;
  hovered: number | null;
}

/**
 * The static fill layer. Re-renders only when the selection or ownership
 * changes -- never on hover -- so pointer tracking stays cheap even at
 * depth 5 (1024 polygons).
 */
const CellLayer = memo(function CellLayer({
  figure,
  selection,
  owner,
  scoringCells,
}: {
  figure: Figure;
  selection: ReadonlySet<number>;
  owner: (PlayerId | null)[];
  scoringCells: ReadonlySet<number>;
}) {
  const waves = useMemo(() => {
    const g: Cell[][] = [[], [], [], []];
    for (const c of figure.cells) g[WAVE[c.ftype]].push(c);
    return g;
  }, [figure]);

  return (
    <>
      {waves.map((group, w) => (
        <g key={w} className={`wave wave--${w}`}>
          {group.map((c) => {
            const own = owner[c.i];
            const sel = selection.has(c.i);
            const scoring = scoringCells.has(c.i);
            const fill = FILL[c.charge][c.eps];

            let stroke = "#0a0908";
            let strokeWidth = 0.6;
            let opacity = 1;

            if (own !== null) {
              stroke = PLAYER_COLOR[own];
              strokeWidth = 1.6;
              opacity = 0.42;
            } else if (sel) {
              stroke = scoring ? "#ffffff" : "#6b625a";
              strokeWidth = scoring ? 3.2 : 2;
            }

            return (
              <polygon
                key={c.i}
                data-i={c.i}
                className={`cell${own !== null ? " cell--owned" : ""}`}
                points={c.verts.map((v) => `${v[0]},${v[1]}`).join(" ")}
                fill={fill}
                fillOpacity={opacity}
                stroke={stroke}
                strokeWidth={strokeWidth}
                strokeLinejoin="round"
              />
            );
          })}
        </g>
      ))}
    </>
  );
});

/**
 * Hover overlay: rings the three mirror partners of the pointed-at cell,
 * solid where the charges are coherent (a legal pairing) and dashed where
 * they are not. This is the whole lesson of the game, drawn live.
 */
function HoverLayer({
  figure,
  hovered,
}: {
  figure: Figure;
  hovered: number | null;
}) {
  if (hovered === null) return null;
  const cell = figure.cells[hovered];

  return (
    <g style={{ pointerEvents: "none" }}>
      {AXES.map((ax) => {
        const p = figure.cells[cell.mirror[ax]];
        const ok = cell.coherentAxes.includes(ax);
        if (p.i === cell.i) return null;
        return (
          <g key={ax}>
            <line
              x1={cell.centroid[0]}
              y1={cell.centroid[1]}
              x2={p.centroid[0]}
              y2={p.centroid[1]}
              stroke={AXIS_COLOR[ax]}
              strokeWidth={ok ? 1.8 : 1}
              strokeDasharray={ok ? undefined : "4 5"}
              opacity={ok ? 0.85 : 0.3}
            />
            <polygon
              className={ok ? "partner-ring" : undefined}
              points={p.verts.map((v) => `${v[0]},${v[1]}`).join(" ")}
              fill="none"
              stroke={AXIS_COLOR[ax]}
              strokeWidth={ok ? 3.4 : 1.4}
              strokeDasharray={ok ? undefined : "3 4"}
              opacity={ok ? 1 : 0.45}
              strokeLinejoin="round"
            />
          </g>
        );
      })}
      <polygon
        points={cell.verts.map((v) => `${v[0]},${v[1]}`).join(" ")}
        fill="none"
        stroke="#ffffff"
        strokeWidth={3}
        strokeLinejoin="round"
      />
    </g>
  );
}

export default function Board({
  figure,
  selection,
  owner,
  scoringCells,
  showMedians,
  onToggle,
  onHover,
  hovered,
}: BoardProps) {
  const [focusIdx, setFocusIdx] = useState(0);

  // One delegated handler for the whole board rather than 4^d closures.
  const readIndex = (e: React.PointerEvent | React.MouseEvent) => {
    const t = e.target as SVGElement;
    const raw = t.getAttribute?.("data-i");
    return raw === null || raw === undefined ? null : Number(raw);
  };

  const handleMove = useCallback(
    (e: React.PointerEvent) => {
      const i = readIndex(e);
      onHover(i);
    },
    [onHover]
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const i = readIndex(e);
      if (i !== null) {
        onToggle(i);
        setFocusIdx(i);
      }
    },
    [onToggle]
  );

  const medians = useMemo(() => {
    const [a, b, c] = figure.corners;
    const mid = (
      p: [number, number],
      q: [number, number]
    ): [number, number] => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    return [
      { ax: "A" as Axis, from: a, to: mid(b, c) },
      { ax: "B" as Axis, from: b, to: mid(a, c) },
      { ax: "C" as Axis, from: c, to: mid(a, b) },
    ];
  }, [figure]);

  return (
    <svg
      className="board-svg"
      viewBox={`0 0 ${figure.width} ${figure.height}`}
      role="application"
      aria-label={`Fourfold board, depth ${figure.depth}, ${figure.cells.length} cells. Use arrow keys to move and space to select.`}
      tabIndex={0}
      onKeyDown={(e) => {
        const n = figure.cells.length;
        if (e.key === "ArrowRight" || e.key === "ArrowDown") {
          e.preventDefault();
          const next = (focusIdx + 1) % n;
          setFocusIdx(next);
          onHover(next);
        } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
          e.preventDefault();
          const next = (focusIdx - 1 + n) % n;
          setFocusIdx(next);
          onHover(next);
        } else if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          onToggle(focusIdx);
        }
      }}
    >
      <g
        onPointerMove={handleMove}
        onPointerLeave={() => onHover(null)}
        onClick={handleClick}
      >
        {/* Hit target so pointer-leave fires reliably over the gaps. */}
        <rect width={figure.width} height={figure.height} fill="transparent" />
        <CellLayer
          figure={figure}
          selection={selection}
          owner={owner}
          scoringCells={scoringCells}
        />
      </g>

      {showMedians &&
        medians.map((m) => (
          <line
            key={m.ax}
            x1={m.from[0]}
            y1={m.from[1]}
            x2={m.to[0]}
            y2={m.to[1]}
            stroke={AXIS_COLOR[m.ax]}
            strokeWidth={2}
            strokeDasharray="9 8"
            opacity={0.5}
            style={{ pointerEvents: "none" }}
          />
        ))}

      <HoverLayer figure={figure} hovered={hovered} />
    </svg>
  );
}
