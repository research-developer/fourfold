"use client";

import { memo, useCallback, useEffect, useRef, type ReactElement } from "react";
import type { Direction, Guides } from "@/lib/guides";
import type { PaintMap } from "@/lib/strokes";

/**
 * The drawing surface.
 *
 * Four things had to be true at once here, and they pull against each other:
 *
 *   1. A drag paints. On touch as well as with a mouse, and without the page
 *      scrolling out from under the finger.
 *   2. Depth-4 hexagon is 1536 cells, and the pointer moves at ~120 Hz.
 *   3. The hover preview and the keyboard cursor change on nearly every one of
 *      those events.
 *   4. The tiling underneath never changes at all.
 *
 * So the board is stacked in layers by RATE OF CHANGE, and each layer is a
 * memoised component with only the props it truly depends on. The static
 * tiling and the transparent hit layer render once per figure and are never
 * touched again; the paint layer renders once per stroke step; only the
 * preview, the cursor and the axis overlay follow the pointer, and those are at
 * most a dozen elements each.
 *
 * ── Why the hit layer carries no handlers ────────────────────────────────
 *
 * Putting `onPointerEnter` on 1536 polygons means rebuilding 1536 closures
 * every render, which defeats the memoisation the layer exists for. Instead
 * every polygon carries `data-i` and ONE set of handlers sits on the <svg>.
 * The hit layer is painted last, so it is always the topmost element under the
 * pointer, and `event.target` names the cell directly.
 *
 * ── The touch capture that has to be given back ──────────────────────────
 *
 * A touch pointer is IMPLICITLY captured by the element that received
 * pointerdown, so every subsequent pointermove reports that same element as its
 * target and a drag paints exactly one cell forever. Releasing the capture on
 * pointerdown is the fix, and it is the entire reason drag-to-paint works on a
 * phone.
 */

export interface BoardCell {
  readonly verts: readonly (readonly [number, number])[];
  readonly centroid: readonly [number, number];
}

export interface BoardGeometry {
  width: number;
  height: number;
  /** The figure's outer boundary, as a closed polygon. */
  outline: readonly (readonly [number, number])[];
  cells: readonly BoardCell[];
  /** Hairline width in canvas units, chosen for the depth. */
  seamWidth: number;
}

export interface PreviewSpec {
  /** The orbit that would be painted. */
  cells: readonly number[];
  /** Its colours, aligned to `cells`. */
  colours: readonly string[];
  /** The cell actually under the pointer. */
  seed: number;
  /** True when the brush would erase rather than paint. */
  erasing: boolean;
}

interface Props {
  geom: BoardGeometry;
  paint: PaintMap;
  preview: PreviewSpec | null;
  cursor: number | null;
  guides: Guides;
  showGuides: boolean;
  showTiling: boolean;
  label: string;
  /** Supplied by the page, which owns the CSS module the class lives in. */
  className: string;
  onHover: (i: number | null) => void;
  onPaint: (i: number) => void;
  onStrokeEnd: () => void;
  onArrow: (dir: Direction) => void;
  onCursorPaint: () => void;
}

/**
 * Plate and tile.
 *
 * The tile is OPAQUE and slightly lighter than the plate at every radius, not a
 * translucent white over the vignette. Two reasons: the unpainted tiling has to
 * lift off the plate uniformly rather than fading out at the rim where the
 * vignette darkens, and the exported SVG has to be able to name the same colour
 * without reproducing a gradient it does not carry.
 */
const PLATE = "#0d0b0a";
const PLATE_LIT = "#171412";
export const TILE = "#201c19";
export const SEAM = "rgba(236,230,220,.16)";
export const PAINT_SEAM = "rgba(10,9,8,.34)";

const points = (c: { readonly verts: readonly (readonly [number, number])[] }) =>
  c.verts.map((v) => `${v[0]},${v[1]}`).join(" ");

/** The tiling. Renders once per figure and then never again. */
const TileLayer = memo(function TileLayer({
  geom,
  show,
}: {
  geom: BoardGeometry;
  show: boolean;
}) {
  if (!show) return null;
  return (
    <g fill={TILE} stroke={SEAM} strokeWidth={geom.seamWidth} pointerEvents="none">
      {geom.cells.map((c, i) => (
        <polygon key={i} points={points(c)} />
      ))}
    </g>
  );
});

/** Only the painted cells. Re-renders once per stroke step. */
const PaintLayer = memo(function PaintLayer({
  geom,
  paint,
}: {
  geom: BoardGeometry;
  paint: PaintMap;
}) {
  const out: ReactElement[] = [];
  for (const [i, colour] of paint) {
    const cell = geom.cells[i];
    if (cell === undefined) continue;
    out.push(<polygon key={i} points={points(cell)} fill={colour} />);
  }
  return (
    <g stroke={PAINT_SEAM} strokeWidth={geom.seamWidth} pointerEvents="none">
      {out}
    </g>
  );
});

/** Transparent, topmost, and the only thing the pointer ever hits. */
const HitLayer = memo(function HitLayer({ geom }: { geom: BoardGeometry }) {
  return (
    <g fill="transparent">
      {geom.cells.map((c, i) => (
        <polygon key={i} data-i={i} points={points(c)} />
      ))}
    </g>
  );
});

const FAMILY_COLOUR: Record<string, string> = {
  m_A: "#67e8f9",
  m_B: "#4ade80",
  m_C: "#f59e0b",
};

const polar = (
  cx: number,
  cy: number,
  r: number,
  deg: number
): [number, number] => {
  const t = (deg * Math.PI) / 180;
  // SVG y grows downward, so a positive mathematical angle turns anticlockwise
  // on screen only if the y term is subtracted.
  return [cx + r * Math.cos(t), cy - r * Math.sin(t)];
};

const arcPath = (cx: number, cy: number, r: number, a0: number, a1: number) => {
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 0 ${x1} ${y1}`;
};

/**
 * The axis overlay.
 *
 * Mirrors are drawn twice — a wide, faint pass under a narrow, bright one — so
 * a hairline stays visible over saturated paint without being a heavy line over
 * bare plate. Rotational subgroups get arcs and a centre mark instead, because
 * they HAVE no mirror: see the note at the top of `guides.ts`.
 */
const GuideLayer = memo(function GuideLayer({
  guides,
  show,
}: {
  guides: Guides;
  show: boolean;
}) {
  if (!show) return null;
  const rot = guides.rotation;
  const gap = rot ? Math.min(22, 120 / rot.order) : 0;
  // A rotation drawn beside mirrors is the second thing being said. Alone it is
  // the ONLY thing being said, and has to carry the overlay by itself.
  const quiet = guides.mirrors.length > 0;

  return (
    <g pointerEvents="none">
      {guides.mirrors.map((m) => {
        const colour =
          FAMILY_COLOUR[m.id] ?? (m.family === "spine" ? "#67e8f9" : "#f59e0b");
        const dashed = m.family === "boundary";
        return (
          <g key={m.id}>
            <line
              x1={m.x1}
              y1={m.y1}
              x2={m.x2}
              y2={m.y2}
              stroke={colour}
              strokeWidth={7}
              opacity={0.13}
              strokeLinecap="round"
            />
            <line
              x1={m.x1}
              y1={m.y1}
              x2={m.x2}
              y2={m.y2}
              stroke={colour}
              strokeWidth={2.1}
              // The dashed boundaries cross the whole figure corner to corner
              // and read louder than the shorter spines at equal opacity.
              opacity={dashed ? 0.58 : 0.8}
              strokeDasharray={dashed ? "9 7" : undefined}
              strokeLinecap="round"
            />
          </g>
        );
      })}

      {rot && (
        <g stroke="#a78bfa" fill="none">
          <circle
            cx={rot.cx}
            cy={rot.cy}
            r={rot.radius}
            strokeWidth={1}
            opacity={0.2}
            strokeDasharray="3 6"
          />
          {Array.from({ length: rot.order }, (_, k) => {
            const step = 360 / rot.order;
            const a0 = k * step + gap / 2;
            const a1 = (k + 1) * step - gap / 2;
            const [hx, hy] = polar(rot.cx, rot.cy, rot.radius, a1);
            const t = (a1 * Math.PI) / 180;
            // Tangent of the anticlockwise sweep, in screen coordinates.
            const tx = -Math.sin(t);
            const ty = -Math.cos(t);
            const nx = -ty;
            const ny = tx;
            const s = Math.max(7, rot.radius * (quiet ? 0.05 : 0.07));
            return (
              <g key={k}>
                <path
                  d={arcPath(rot.cx, rot.cy, rot.radius, a0, a1)}
                  strokeWidth={quiet ? 2 : 3.6}
                  opacity={quiet ? 0.5 : 0.92}
                  strokeLinecap="round"
                />
                <polygon
                  points={`${hx + tx * s},${hy + ty * s} ${hx - nx * s * 0.55},${
                    hy - ny * s * 0.55
                  } ${hx + nx * s * 0.55},${hy + ny * s * 0.55}`}
                  fill="#a78bfa"
                  stroke="none"
                  opacity={quiet ? 0.6 : 0.95}
                />
              </g>
            );
          })}
          <circle
            cx={rot.cx}
            cy={rot.cy}
            r={quiet ? 5 : 7}
            strokeWidth={quiet ? 2 : 2.6}
            opacity={0.92}
          />
          <circle
            cx={rot.cx}
            cy={rot.cy}
            r={2}
            fill="#a78bfa"
            stroke="none"
            opacity={0.92}
          />
        </g>
      )}
    </g>
  );
});

export default function DrawBoard({
  geom,
  paint,
  preview,
  cursor,
  guides,
  showGuides,
  showTiling,
  label,
  className,
  onHover,
  onPaint,
  onStrokeEnd,
  onArrow,
  onCursorPaint,
}: Props) {
  const drawing = useRef(false);
  const last = useRef<number | null>(null);

  const indexOf = (target: EventTarget | null): number | null => {
    const raw = (target as SVGElement | null)?.dataset?.i;
    if (raw === undefined) return null;
    const i = Number(raw);
    return Number.isInteger(i) ? i : null;
  };

  const end = useCallback(() => {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    onStrokeEnd();
  }, [onStrokeEnd]);

  // A gesture can finish anywhere — off the plate, off the window, or by the
  // browser cancelling the pointer. Every one of those has to close the stroke,
  // or the next click silently joins the previous undo step.
  useEffect(() => {
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [end]);

  const down = (e: React.PointerEvent<SVGSVGElement>) => {
    const i = indexOf(e.target);
    if (i === null) return;
    const el = e.target as Element;
    if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
    drawing.current = true;
    last.current = i;
    onHover(i);
    onPaint(i);
  };

  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const i = indexOf(e.target);
    if (!drawing.current) {
      onHover(i);
      return;
    }
    if (i === null || i === last.current) return;
    last.current = i;
    onHover(i);
    onPaint(i);
  };

  const key = (e: React.KeyboardEvent<SVGSVGElement>) => {
    const dir: Record<string, Direction> = {
      ArrowUp: "up",
      ArrowDown: "down",
      ArrowLeft: "left",
      ArrowRight: "right",
    };
    const d = dir[e.key];
    if (d !== undefined) {
      e.preventDefault();
      onArrow(d);
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onCursorPaint();
    }
  };

  const cursorCell = cursor === null ? null : geom.cells[cursor];

  return (
    <svg
      viewBox={`0 0 ${geom.width} ${geom.height}`}
      className={className}
      role="application"
      aria-label={label}
      tabIndex={0}
      onPointerDown={down}
      onPointerMove={move}
      onPointerLeave={() => onHover(null)}
      onKeyDown={key}
    >
      <defs>
        <radialGradient id="draw-vignette" cx="50%" cy="42%" r="72%">
          <stop offset="0%" stopColor={PLATE_LIT} />
          <stop offset="100%" stopColor={PLATE} />
        </radialGradient>
      </defs>

      <rect width={geom.width} height={geom.height} fill="url(#draw-vignette)" />

      <TileLayer geom={geom} show={showTiling} />
      <PaintLayer geom={geom} paint={paint} />

      <polygon
        points={geom.outline.map((v) => `${v[0]},${v[1]}`).join(" ")}
        fill="none"
        stroke="rgba(236,230,220,.22)"
        strokeWidth={1.4}
        pointerEvents="none"
      />

      <GuideLayer guides={guides} show={showGuides} />

      {/* The ghost: the orbit that WOULD be painted, in the colours it would
          take. Fill at a third and a full-strength edge, so it reads over both
          bare plate and finished paint. */}
      {preview && (
        <g pointerEvents="none">
          {preview.cells.map((i, k) => {
            const cell = geom.cells[i];
            if (cell === undefined) return null;
            const colour = preview.erasing
              ? "#ece6dc"
              : preview.colours[k] ?? "#ece6dc";
            return (
              <g key={i}>
                {/* An ink halo first. The ghost has to be legible both on bare
                    plate and on paint of any hue the user chose, and a single
                    stroke cannot do both — over a similar colour it vanishes. */}
                <polygon
                  points={points(cell)}
                  fill="none"
                  stroke="rgba(10,9,8,.85)"
                  strokeWidth={5}
                  strokeLinejoin="round"
                />
                <polygon
                  points={points(cell)}
                  fill={preview.erasing ? "none" : colour}
                  fillOpacity={0.55}
                  stroke={colour}
                  strokeWidth={2.6}
                  strokeDasharray={preview.erasing ? "5 4" : undefined}
                  strokeLinejoin="round"
                />
              </g>
            );
          })}
          {geom.cells[preview.seed] && (
            <circle
              cx={geom.cells[preview.seed].centroid[0]}
              cy={geom.cells[preview.seed].centroid[1]}
              r={Math.max(3, geom.seamWidth * 5)}
              fill="none"
              stroke="#ece6dc"
              strokeWidth={2}
              opacity={0.9}
            />
          )}
        </g>
      )}

      {cursorCell && (
        <polygon
          points={points(cursorCell)}
          fill="none"
          stroke="#a3e635"
          strokeWidth={3}
          strokeLinejoin="round"
          pointerEvents="none"
        />
      )}

      <HitLayer geom={geom} />
    </svg>
  );
}
