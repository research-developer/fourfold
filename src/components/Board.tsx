"use client";

import { memo, useCallback, useMemo } from "react";
import {
  AXES,
  H,
  inPhase,
  type Axis,
  type Cell,
  type Figure,
} from "@/lib/figure";
import {
  AXIS_COLOR,
  COSET_FILL,
  FILL,
  PHASE_FILL,
  PLAYER_COLOR,
} from "@/lib/palette";
import type { PlayerId } from "@/lib/game";

/** Load-reveal order: the three rotation orbits, then the hub. */
const WAVE: Record<string, number> = { A: 0, B: 1, C: 2, "": 3 };

export type ColorMode = "charge" | "coset" | "phase";

interface BoardProps {
  figure: Figure;
  selection: ReadonlySet<number>;
  owner: (PlayerId | null)[];
  scoringCells: ReadonlySet<number>;
  showMedians: boolean;
  colorMode: ColorMode;
  /** Prefix length whose mirror phase is shown in "phase" mode. */
  phaseLevel: number;
  onToggle: (i: number) => void;
  /**
   * One cursor shared by pointer and keyboard. Whatever it points at is
   * what carries the white ring and what Space/Enter acts on, so the two
   * input paths can never disagree about the target.
   */
  cursor: number | null;
  onCursor: (i: number | null, viaKeyboard?: boolean) => void;
}

/**
 * Resolve a cell to its fill, and to whether that fill should be hatched.
 *
 * Hatching is not decoration. The game's only rule is "gold/purple pair,
 * blue/red pair" — the two cosets of H. Under deuteranopia #7c3aed and
 * #1f6feb collapse to a measured ΔE of 7.9, i.e. the same colour, and they
 * sit in OPPOSITE cosets. Hue alone therefore cannot carry the rule, and
 * brightness is already spent encoding orientation. So the coset gets a
 * second, non-chromatic channel: cells outside H are hatched, always.
 */
function fillFor(
  cell: Cell,
  mode: ColorMode,
  phaseLevel: number
): { base: string; hatch: boolean } {
  const inH = H.has(cell.charge);
  if (mode === "phase") {
    // Colour by the mirror phase of the sub-triangle this cell sits in,
    // not by the cell's own charge. Hatching still tracks the coset, so
    // the two fields can be read against each other.
    const ph = inPhase(cell.addr, phaseLevel);
    return { base: PHASE_FILL[ph ? "in" : "out"][cell.eps], hatch: !inH };
  }
  const base =
    mode === "coset"
      ? COSET_FILL[inH ? "H" : "notH"][cell.eps]
      : FILL[cell.charge][cell.eps];
  return { base, hatch: !inH };
}

/** Every base colour that can appear hatched, so we can pre-declare patterns. */
function hatchedColours(mode: ColorMode): string[] {
  const out = new Set<string>();
  if (mode === "phase") {
    for (const k of ["in", "out"] as const) {
      out.add(PHASE_FILL[k][0]);
      out.add(PHASE_FILL[k][1]);
    }
  } else if (mode === "coset") {
    out.add(COSET_FILL.notH[0]);
    out.add(COSET_FILL.notH[1]);
  } else {
    for (const ch of [1, 2] as const) {
      out.add(FILL[ch][0]);
      out.add(FILL[ch][1]);
    }
  }
  return [...out];
}

const patternId = (hex: string) => `hx${hex.replace("#", "")}`;

/**
 * The static fill layer. Re-renders only when the selection or ownership
 * changes -- never on cursor movement -- so pointer tracking stays cheap
 * even at depth 5 (1024 polygons).
 */
const CellLayer = memo(function CellLayer({
  figure,
  selection,
  owner,
  scoringCells,
  colorMode,
  phaseLevel,
}: {
  figure: Figure;
  selection: ReadonlySet<number>;
  owner: (PlayerId | null)[];
  scoringCells: ReadonlySet<number>;
  colorMode: ColorMode;
  phaseLevel: number;
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
            const { base, hatch } = fillFor(c, colorMode, phaseLevel);

            let stroke = "#0a0908";
            let strokeWidth = 0.5;
            let dash: string | undefined;
            let opacity = 1;

            if (own !== null) {
              stroke = PLAYER_COLOR[own];
              strokeWidth = 1.5;
              opacity = 0.42;
            } else if (sel) {
              // Both selection states use a light stroke: the old dim grey
              // scored 1.05:1 against purple, i.e. no indicator at all.
              // Provisional vs committed is carried by the dash instead.
              stroke = scoring ? "#ffffff" : "#ece6dc";
              strokeWidth = scoring ? 3 : 2;
              dash = scoring ? undefined : "5 4";
            }

            return (
              <polygon
                key={c.i}
                data-i={c.i}
                className={`cell${own !== null ? " cell--owned" : ""}`}
                points={c.verts.map((v) => `${v[0]},${v[1]}`).join(" ")}
                fill={hatch ? `url(#${patternId(base)})` : base}
                fillOpacity={opacity}
                stroke={stroke}
                strokeWidth={strokeWidth}
                strokeDasharray={dash}
                strokeLinejoin="round"
                // Stroke widths are in viewBox units, so on a 334px phone
                // board every one of them fell below 1 CSS px -- and strokes
                // carry 100% of the dynamic state.
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </g>
      ))}
    </>
  );
});

/**
 * Cursor overlay: rings the three mirror partners of the pointed-at cell,
 * solid where the charges are coherent (a legal pairing) and dashed where
 * they are not. This is the whole lesson of the game, drawn live.
 */
function CursorLayer({
  figure,
  cursor,
}: {
  figure: Figure;
  cursor: number | null;
}) {
  if (cursor === null || cursor >= figure.cells.length) return null;
  const cell = figure.cells[cursor];

  return (
    <g style={{ pointerEvents: "none" }}>
      {AXES.map((ax) => {
        const p = figure.cells[cell.mirror[ax]];
        const ok = cell.coherentAxes.includes(ax);
        // A cell straddling its own median has no partner to point at; the
        // median line already shows where it sits.
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
              vectorEffect="non-scaling-stroke"
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
              vectorEffect="non-scaling-stroke"
            />
          </g>
        );
      })}
      {/* Dark casing under the white ring: gold is bright enough that a
          bare white outline sits at 2.38:1 against it. */}
      <polygon
        points={cell.verts.map((v) => `${v[0]},${v[1]}`).join(" ")}
        fill="none"
        stroke="#0a0908"
        strokeWidth={5.5}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <polygon
        points={cell.verts.map((v) => `${v[0]},${v[1]}`).join(" ")}
        fill="none"
        stroke="#ffffff"
        strokeWidth={3}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
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
  colorMode,
  phaseLevel,
  onToggle,
  cursor,
  onCursor,
}: BoardProps) {
  // One delegated handler for the whole board rather than 4^d closures.
  const readIndex = (e: React.PointerEvent) => {
    const t = e.target as SVGElement;
    const raw = t.getAttribute?.("data-i");
    return raw === null || raw === undefined ? null : Number(raw);
  };

  const handleMove = useCallback(
    (e: React.PointerEvent) => onCursor(readIndex(e)),
    [onCursor]
  );

  /**
   * Selection happens on POINTER DOWN, not on click.
   *
   * A `click` event is dispatched at the nearest common ancestor of the
   * mousedown and mouseup targets. Press inside one triangle, drift a
   * couple of pixels across the shared edge, release, and the click lands
   * on the enclosing <g> — which carries no data-i, so the toggle was
   * silently dropped. At depth 5 the cells are ~30px across and on touch
   * that drift is near-guaranteed.
   */
  const handleDown = useCallback(
    (e: React.PointerEvent) => {
      const i = readIndex(e);
      if (i === null) return;
      onCursor(i);
      onToggle(i);
    },
    [onCursor, onToggle]
  );

  /** Nearest cell in a compass direction, preferring straight ahead. */
  const step = useCallback(
    (from: number, dx: number, dy: number) => {
      const [cx, cy] = figure.cells[from].centroid;
      let best = from;
      let bestScore = Infinity;
      for (const o of figure.cells) {
        if (o.i === from) continue;
        const vx = o.centroid[0] - cx;
        const vy = o.centroid[1] - cy;
        const along = vx * dx + vy * dy;
        if (along <= 0) continue;
        const perp = Math.abs(vx * dy - vy * dx);
        const score = along + perp * 2.5;
        if (score < bestScore) {
          bestScore = score;
          best = o.i;
        }
      }
      return best;
    },
    [figure]
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

  // Pattern period tracks the cell size so the hatch reads at every depth.
  const period = Math.max(7, 1024 / 2 ** figure.depth / 3);

  return (
    <svg
      className="board-svg"
      viewBox={`0 0 ${figure.width} ${figure.height}`}
      role="application"
      aria-label={`Fourfold board, depth ${figure.depth}, ${figure.cells.length} cells. Arrow keys move, space selects, A B or C jumps to the mirror partner across that median, Home goes to the hub.`}
      tabIndex={0}
      onFocus={() => {
        // Land the cursor somewhere visible so Space never acts on a cell
        // the player cannot see.
        if (cursor === null) onCursor(figure.hub, true);
      }}
      onKeyDown={(e) => {
        const n = figure.cells.length;
        const at = cursor === null || cursor >= n ? figure.hub : cursor;
        const k = e.key;
        if (k === "ArrowRight") { e.preventDefault(); onCursor(step(at, 1, 0), true); }
        else if (k === "ArrowLeft") { e.preventDefault(); onCursor(step(at, -1, 0), true); }
        else if (k === "ArrowDown") { e.preventDefault(); onCursor(step(at, 0, 1), true); }
        else if (k === "ArrowUp") { e.preventDefault(); onCursor(step(at, 0, -1), true); }
        else if (k === " " || k === "Enter") { e.preventDefault(); onToggle(at); }
        else if (k === "Home") { e.preventDefault(); onCursor(figure.hub, true); }
        else if (k === "Escape") { onCursor(null); }
        else {
          // Jump straight to a mirror partner — otherwise a keyboard player
          // can see the partner rings but never reach them.
          const ax = k.toUpperCase();
          if (ax === "A" || ax === "B" || ax === "C") {
            e.preventDefault();
            onCursor(figure.cells[at].mirror[ax as Axis], true);
          }
        }
      }}
    >
      <defs>
        {hatchedColours(colorMode).map((hex) => (
          <pattern
            key={hex}
            id={patternId(hex)}
            width={period}
            height={period}
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width={period} height={period} fill={hex} />
            <line
              x1={0}
              y1={0}
              x2={0}
              y2={period}
              stroke="#0a0908"
              strokeOpacity={0.42}
              strokeWidth={period / 2.4}
            />
          </pattern>
        ))}
      </defs>

      <g
        onPointerMove={handleMove}
        onPointerLeave={(e) => {
          // Keep the cursor if the board still holds keyboard focus, or a
          // player who arrows to a cell then moves the mouse away loses the
          // only thing showing them what Space will act on.
          const svg = e.currentTarget.ownerSVGElement;
          if (svg && document.activeElement === svg) return;
          onCursor(null);
        }}
        onPointerDown={handleDown}
      >
        {/* Hit target so pointer-leave fires reliably over the gaps. */}
        <rect width={figure.width} height={figure.height} fill="transparent" />
        <CellLayer
          figure={figure}
          selection={selection}
          owner={owner}
          scoringCells={scoringCells}
          colorMode={colorMode}
          phaseLevel={phaseLevel}
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
            vectorEffect="non-scaling-stroke"
            style={{ pointerEvents: "none" }}
          />
        ))}

      <CursorLayer figure={figure} cursor={cursor} />
    </svg>
  );
}
