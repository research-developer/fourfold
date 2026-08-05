"use client";

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ReactElement,
} from "react";
import type { Direction, Guides, RotationGuide } from "@/lib/guides";
import { WELD_WIDTH, type PaintMap } from "@/lib/strokes";

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
 *
 * ── Two drag behaviours, and why the second one exists ───────────────────
 *
 * A finger has no hover. The ghost preview — the thing that TEACHES what a
 * symmetry brush is about to do — is therefore unreachable on a phone, where it
 * is needed most, because the first contact with the plate is already a stroke.
 *
 * `propose` mode makes the press itself the hover: a drag GATHERS applications
 * and commits nothing, lifting the finger leaves them standing, and a tap on
 * them lays the paint. Two consequences fall out for free. The proposal survives
 * a change of brush, scheme or colour, so the settings can be auditioned against
 * a real proposal before anything is committed; and a mis-aimed first touch
 * costs nothing, which on a 390px screen is the difference between a drawing
 * tool and a guessing game.
 *
 * The commit gesture is a TAP ON THE PROPOSAL, not a tap anywhere, so the "add
 * to it" and "keep it" gestures never contend: pressing inside the standing
 * proposal arms a commit and pressing outside it adds. Dragging away from an
 * armed press disarms it, because that is a drag and not a tap.
 *
 * ── A drag gathers, it does not replace ─────────────────────────────────
 *
 * It used to replace: every cell the finger crossed became THE candidate and the
 * one before it was forgotten, so the mode that exists for touch could lay
 * exactly one application per gesture while the mode that exists for a mouse
 * could lay a hundred. `onPropose` is now called on the press and on every cell
 * the drag enters — the same event stream `onPaint` gets in paint mode, which is
 * the whole point — and the page accumulates them. See `lib/propose.ts` for the
 * accumulation rule, and `page.tsx`'s `commitProposal` for why the whole run
 * commits as ONE rung of the journal.
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
  /**
   * The cell indices this view draws, ascending. Absent means all of them.
   *
   * The board is handed the WHOLE model and told which part of it is framed,
   * rather than a shortened array, because every index it reports back — a hover,
   * a paint, a cursor — is an index on the model, and renumbering them at the
   * edge of the render layer would mean a second address space for the page to
   * translate. So the array stays whole and the layers walk this list.
   */
  shown?: readonly number[];
}

export interface PreviewSpec {
  /** The cells that would take colour. */
  cells: readonly number[];
  /** Their colours, aligned to `cells`. */
  colours: readonly string[];
  /**
   * Cells under the brush that would NOT change — an adjustment landing on a
   * cell nobody has painted yet. Outlined and not filled, because "the brush
   * reaches here and will do nothing" is a fact worth showing rather than an
   * absence worth hiding.
   */
  inert: readonly number[];
  /** The cell actually under the pointer. */
  seed: number;
  /** True when the brush would erase rather than paint. */
  erasing: boolean;
}

/** True when the spec's brush reaches cell `i` at all, inert or not. */
export const previewCovers = (spec: PreviewSpec, i: number): boolean =>
  spec.cells.includes(i) || spec.inert.includes(i);

export type DragBehaviour = "paint" | "propose";

/**
 * What a press-drag-release lays down.
 *
 * `free` is the brush: every cell the pointer crosses is an application. The
 * other two are ANCHORED — the press names a cell and the drag names a second,
 * and nothing is painted until the release, so the whole figure is a single
 * gesture and a single rung of the undo stack. See `lattice.ts` for what each
 * one is on the lattice.
 */
export type ShapeTool = "free" | "line" | "ring";

/**
 * The visible window, in canvas units.
 *
 * `null` is the whole figure, which is what the board always showed. Anything
 * else is a zoom: the SVG's own `viewBox` is narrowed, so every layer, every
 * guide and — crucially — the transparent hit layer scale together and a click
 * still lands on the cell under the finger. Nothing about the model moves, so an
 * export taken while zoomed is the same file as one taken while not.
 */
export interface ViewWindow {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The relief, as the board needs it: the plate's polygons already deformed.
 *
 * Everything here is a DISPLAY substitution — the same cells, in the same order,
 * with the same indices, drawn somewhere else. The board never learns what the
 * deformation is; it is handed the answer, which is what keeps a lens out of the
 * component that owns hit-testing and undo.
 *
 * It arrives whole and changes ONLY when the template ring changes. That is the
 * cheapness: a pointer sweeping a depth-4 hexagon crosses some fifty rings, so
 * the 1536 polygons are rewritten fifty times over a whole sweep rather than
 * once per pointer event. In between, this object is referentially identical and
 * the memoised tiling and hit layers do not re-render at all.
 */
export interface ReliefView {
  /** `points` text per cell, aligned to `geom.cells`. */
  points: readonly string[];
  centroids: readonly (readonly [number, number])[];
  /** Cells grouped by the tone they take, darkest last. */
  wash: readonly { fill: string; alpha: number; cells: readonly number[] }[];
  /** The same remap applied to a loose canvas point, for the axis overlay. */
  bend: (p: readonly [number, number]) => readonly [number, number];
}

interface Props {
  geom: BoardGeometry;
  /** `null` when the relief is off, which is also the exported-file default. */
  relief: ReliefView | null;
  paint: PaintMap;
  preview: PreviewSpec | null;
  /**
   * The standing proposal in `propose` mode, ONE ENTRY PER APPLICATION the drag
   * gathered, in the order it gathered them. Empty when nothing stands.
   *
   * A list and not a single spec, because a propose drag accumulates: see
   * `lib/propose.ts` for why the seeds are kept apart rather than merged, and
   * `Ghost` below for what one entry looks like. A tap anywhere inside ANY of
   * them commits the whole thing.
   */
  candidate: readonly PreviewSpec[];
  cursor: number | null;
  guides: Guides;
  showGuides: boolean;
  showTiling: boolean;
  /** Stroke painted cells in their own fill, so a filled row is one shape. */
  weld: boolean;
  dragBehaviour: DragBehaviour;
  /** The anchored tool in hand. `free` is the ordinary brush. */
  shape: ShapeTool;
  /**
   * Space is held, so the pointer drags the PLATE rather than paint.
   *
   * A modifier and not a mode: it is reported by the page, which owns the key
   * state, and it overrides every other gesture while it is true. Only useful
   * while `view` is narrowed — see the note in `page.tsx` on why zoom had to
   * arrive with it.
   */
  panning: boolean;
  /** `null` shows the whole figure, exactly as the board always did. */
  view: ViewWindow | null;
  label: string;
  /** Supplied by the page, which owns the CSS module the class lives in. */
  className: string;
  /** Ditto: the marching-ants animation on the candidate outline. */
  candidateClass: string;
  onHover: (i: number | null) => void;
  onPaint: (i: number) => void;
  onStrokeEnd: () => void;
  onPropose: (i: number) => void;
  onCommit: () => void;
  onArrow: (dir: Direction) => void;
  /**
   * The anchored drag moved. `anchor` never changes during one gesture, `at` is
   * the cell under the pointer now, and `alt` is Option/Alt as it stands at this
   * instant — read off every event rather than once at the press, so letting go
   * of the modifier mid-drag changes the figure under the finger.
   */
  onShapeDrag: (anchor: number, at: number, alt: boolean) => void;
  /** The anchored drag ended. The page turns the standing figure into a stroke. */
  onShapeEnd: () => void;
  /** A pan, in CANVAS units — the board converts, the page only translates. */
  onPan: (dx: number, dy: number) => void;
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

const line = (p: readonly [number, number]) => `${p[0]},${p[1]}`;

/**
 * The tiling. Renders once per figure — and, with the relief on, once per ring
 * the pointer crosses, which is what `pts` changing identity means.
 */
const TileLayer = memo(function TileLayer({
  geom,
  pts,
  order,
  show,
}: {
  geom: BoardGeometry;
  pts: readonly string[];
  order: readonly number[];
  show: boolean;
}) {
  if (!show) return null;
  return (
    <g
      data-layer="tiling"
      fill={TILE}
      stroke={SEAM}
      strokeWidth={geom.seamWidth}
      pointerEvents="none"
    >
      {order.map((i) => (
        <polygon key={i} points={pts[i]} />
      ))}
    </g>
  );
});

/**
 * The relief's tone, one group per ring rather than one element per cell.
 *
 * Flat black at an alpha, which is an ordinary multiply — see the note in
 * `relief.ts` on why no blend mode appears anywhere. The fill sits on the GROUP,
 * so `importByGeometry` cannot mistake a wash for paint when the file is read
 * back by something that has not found the payload.
 */
const WashLayer = memo(function WashLayer({
  pts,
  wash,
  visible,
}: {
  pts: readonly string[];
  wash: readonly { fill: string; alpha: number; cells: readonly number[] }[];
  visible: ReadonlySet<number> | null;
}) {
  return (
    <g data-layer="relief" pointerEvents="none">
      {wash.map((band) => (
        <g
          key={`${band.fill}-${band.alpha}`}
          fill={band.fill}
          opacity={band.alpha}
        >
          {band.cells.map((i) =>
            visible !== null && !visible.has(i) ? null : (
              <polygon key={i} points={pts[i]} />
            )
          )}
        </g>
      ))}
    </g>
  );
});

/**
 * Only the painted cells. Re-renders once per stroke step.
 *
 * `weld` is what makes a band read as one thick line instead of a run of
 * triangles. Turning the seam OFF is not enough on its own: two polygons that
 * share an edge each cover about half of the boundary pixels, and the plate
 * shows through the rest as a dark hairline at every cell. Stroking each cell in
 * its own fill closes the join at the source, and cells of different colours
 * still meet cleanly because each side of the join is painted in its own colour.
 * `artworkSvg`'s `weldPaint` does the identical thing in the exported file.
 */
const PaintLayer = memo(function PaintLayer({
  geom,
  pts,
  paint,
  visible,
  weld,
}: {
  geom: BoardGeometry;
  pts: readonly string[];
  paint: PaintMap;
  visible: ReadonlySet<number> | null;
  weld: boolean;
}) {
  const out: ReactElement[] = [];
  for (const [i, colour] of paint) {
    const p = pts[i];
    if (p === undefined) continue;
    // Paint in an unframed sector is still ON the plate — it is simply not in
    // this picture. Skipped rather than dropped from the model, which is the
    // difference between a view and a canvas.
    if (visible !== null && !visible.has(i)) continue;
    out.push(
      <polygon
        key={i}
        points={p}
        fill={colour}
        stroke={weld ? colour : undefined}
      />
    );
  }
  return (
    <g
      data-layer="paint"
      stroke={weld ? undefined : PAINT_SEAM}
      strokeWidth={weld ? geom.seamWidth * WELD_WIDTH : geom.seamWidth}
      pointerEvents="none"
    >
      {out}
    </g>
  );
});

/**
 * Transparent, topmost, and the only thing the pointer ever hits.
 *
 * It carries the SAME deformed points as everything else, so a click lands on
 * the cell that is under the finger rather than on the cell that would have been
 * there with the relief off. A lens the pointer does not go through is a lens
 * that has broken the drawing program.
 */
const HitLayer = memo(function HitLayer({
  pts,
  order,
}: {
  pts: readonly string[];
  order: readonly number[];
}) {
  return (
    <g data-layer="hit" fill="transparent">
      {order.map((i) => (
        <polygon key={i} data-i={i} points={pts[i]} />
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
const RotationMark = memo(function RotationMark({
  rot,
  quiet,
}: {
  rot: RotationGuide;
  quiet: boolean;
}) {
  const gap = Math.min(22, 120 / rot.order);
  return (
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
  );
});

/** How many segments a bent mirror is drawn with. Twelve is smooth at any depth. */
const BEND_STEPS = 12;

const GuideLayer = memo(function GuideLayer({
  guides,
  show,
  bend,
}: {
  guides: Guides;
  show: boolean;
  bend: ((p: readonly [number, number]) => readonly [number, number]) | null;
}) {
  if (!show) return null;
  // A rotation drawn beside mirrors is the second thing being said. Alone it is
  // the ONLY thing being said, and has to carry the overlay by itself.
  const quiet = guides.mirrors.length > 0;

  return (
    <g pointerEvents="none">
      {guides.mirrors.map((m) => {
        const colour =
          FAMILY_COLOUR[m.id] ?? (m.family === "spine" ? "#67e8f9" : "#f59e0b");
        const dashed = m.family === "boundary";
        // Under the relief a mirror is still the SAME set of cells, so it has to
        // ride the deformation with them. Drawn as a polyline through the bent
        // points rather than as a chord, which would cut across the bulge and
        // put the axis somewhere the brush does not mirror about.
        const pts =
          bend === null
            ? `${m.x1},${m.y1} ${m.x2},${m.y2}`
            : Array.from({ length: BEND_STEPS + 1 }, (_, k) => {
                const t = k / BEND_STEPS;
                return line(
                  bend([m.x1 + (m.x2 - m.x1) * t, m.y1 + (m.y2 - m.y1) * t])
                );
              }).join(" ");
        return (
          <g key={`${m.id}-${m.sector ?? ""}`}>
            <polyline
              points={pts}
              fill="none"
              stroke={colour}
              strokeWidth={7}
              opacity={0.13}
              strokeLinecap="round"
            />
            <polyline
              points={pts}
              fill="none"
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

      {guides.rotation && (
        <RotationMark rot={guides.rotation} quiet={quiet} />
      )}
      {guides.local.map((r, k) => (
        <RotationMark key={k} rot={r} quiet />
      ))}
    </g>
  );
});

/**
 * The ghost: the cells that WOULD be touched, in the colours they would take.
 *
 * Fill at a third under a full-strength edge, over an ink halo. The halo is not
 * decoration — the ghost has to be legible both on bare plate and on paint of
 * any hue the user chose, and a single stroke cannot do both: over a similar
 * colour it vanishes.
 *
 * `standing` is the propose-mode candidate rather than a hover. It reads
 * DIFFERENTLY on purpose, and by two channels at once, because "this is not
 * committed yet" has to survive both a colour-blind viewer and a monochrome
 * screenshot: the fill drops to a quarter and the outline becomes a marching
 * dash. Colour alone would have said it to nobody.
 */
const Ghost = memo(function Ghost({
  geom,
  pts,
  centroids,
  spec,
  standing,
  dashClass,
}: {
  geom: BoardGeometry;
  pts: readonly string[];
  centroids: readonly (readonly [number, number])[];
  spec: PreviewSpec;
  standing: boolean;
  dashClass: string;
}) {
  const seed = centroids[spec.seed];
  return (
    <g pointerEvents="none">
      {spec.cells.map((i, k) => {
        const p = pts[i];
        if (p === undefined) return null;
        const colour = spec.erasing ? "#ece6dc" : spec.colours[k] ?? "#ece6dc";
        return (
          <g key={i}>
            <polygon
              points={p}
              fill="none"
              stroke="rgba(10,9,8,.85)"
              strokeWidth={5}
              strokeLinejoin="round"
            />
            <polygon
              className={standing ? dashClass : undefined}
              points={p}
              fill={spec.erasing ? "none" : colour}
              fillOpacity={standing ? 0.26 : 0.55}
              stroke={colour}
              strokeWidth={standing ? 2.2 : 2.6}
              strokeDasharray={
                standing ? "7 5" : spec.erasing ? "5 4" : undefined
              }
              strokeLinejoin="round"
            />
          </g>
        );
      })}

      {/* Reached, and nothing to do here. */}
      {spec.inert.map((i) => {
        const p = pts[i];
        if (p === undefined) return null;
        return (
          <polygon
            key={`inert-${i}`}
            points={p}
            fill="none"
            stroke="rgba(236,230,220,.42)"
            strokeWidth={1.2}
            strokeDasharray="2 5"
            strokeLinejoin="round"
          />
        );
      })}

      {seed && (
        <circle
          cx={seed[0]}
          cy={seed[1]}
          r={Math.max(3, geom.seamWidth * 5)}
          fill="none"
          stroke="#ece6dc"
          strokeWidth={standing ? 2.6 : 2}
          opacity={0.9}
        />
      )}
    </g>
  );
});

export default function DrawBoard({
  geom,
  relief,
  paint,
  preview,
  candidate,
  cursor,
  guides,
  showGuides,
  showTiling,
  weld,
  dragBehaviour,
  shape,
  panning,
  view,
  label,
  className,
  candidateClass,
  onHover,
  onPaint,
  onStrokeEnd,
  onPropose,
  onCommit,
  onArrow,
  onShapeDrag,
  onShapeEnd,
  onPan,
}: Props) {
  /**
   * The plate's polygons, from whichever source is in force.
   *
   * One array, shared by every layer, so a point string is built once and not
   * once per layer. With the relief off it is memoised on the figure and is
   * therefore built once ever; with it on it arrives whole from the page and
   * changes only when the template ring does.
   */
  const flat = useMemo(() => geom.cells.map(points), [geom]);
  const pts = relief === null ? flat : relief.points;
  const flatCentroids = useMemo(() => geom.cells.map((c) => c.centroid), [geom]);
  const centroids = relief === null ? flatCentroids : relief.centroids;

  /**
   * The framed cells, as a list to walk and a set to test.
   *
   * Both are memoised on the geometry, so the layers below stay memoised: a set
   * rebuilt every render would defeat the whole layer split. `null` for the
   * unframed case, which is cheaper than a set holding every index and is also
   * the honest statement — there is no frame, not a frame that admits everything.
   */
  const order = useMemo(
    () => geom.shown ?? geom.cells.map((_, i) => i),
    [geom]
  );
  const visible = useMemo(
    () => (geom.shown === undefined ? null : new Set(geom.shown)),
    [geom]
  );

  const drawing = useRef(false);
  const proposing = useRef(false);
  /** A press that landed inside the standing candidate: a tap here commits. */
  const armed = useRef(false);
  const moved = useRef(false);
  const last = useRef<number | null>(null);
  /** The cell an anchored gesture started at, or `null` when none is running. */
  const anchor = useRef<number | null>(null);
  /** The last client point of a pan drag, or `null` when none is running. */
  const panFrom = useRef<{ x: number; y: number } | null>(null);
  const svg = useRef<SVGSVGElement | null>(null);

  const indexOf = (target: EventTarget | null): number | null => {
    const raw = (target as SVGElement | null)?.dataset?.i;
    if (raw === undefined) return null;
    const i = Number(raw);
    return Number.isInteger(i) ? i : null;
  };

  const end = useCallback(() => {
    if (panFrom.current !== null) {
      panFrom.current = null;
      return;
    }
    if (anchor.current !== null) {
      anchor.current = null;
      onShapeEnd();
      return;
    }
    if (proposing.current) {
      const commitNow = armed.current && !moved.current;
      proposing.current = false;
      armed.current = false;
      moved.current = false;
      last.current = null;
      if (commitNow) onCommit();
      return;
    }
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    onStrokeEnd();
  }, [onStrokeEnd, onCommit, onShapeEnd]);

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

  /**
   * Client pixels to canvas units.
   *
   * FLOAT, and legitimately: this converts a mouse delta into a scroll offset.
   * It never chooses a cell — the hit layer does that, by `data-i`, and it does
   * it under whatever `viewBox` is in force without knowing there is one.
   */
  const toUnits = (dx: number, dy: number): [number, number] => {
    const el = svg.current;
    if (el === null) return [0, 0];
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return [0, 0];
    const w = view === null ? geom.width : view.w;
    const h = view === null ? geom.height : view.h;
    return [(dx * w) / rect.width, (dy * h) / rect.height];
  };

  const down = (e: React.PointerEvent<SVGSVGElement>) => {
    // Space wins over everything. A pan that only worked when the press landed
    // on a cell would fail exactly at the rim, where a pan is most wanted.
    if (panning) {
      panFrom.current = { x: e.clientX, y: e.clientY };
      e.currentTarget.setPointerCapture?.(e.pointerId);
      return;
    }

    const i = indexOf(e.target);
    if (i === null) return;
    const el = e.target as Element;
    if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);

    if (shape !== "free") {
      anchor.current = i;
      onShapeDrag(i, i, e.altKey);
      return;
    }

    if (dragBehaviour === "propose") {
      proposing.current = true;
      moved.current = false;
      last.current = i;
      // Inside the standing proposal this press is a commit, and must NOT also
      // add to it: the plate would gain an application under the finger and then
      // be painted somewhere the user did not aim. ANY of the gathered
      // applications counts — the whole ghost is one tap target, because the
      // whole ghost is one gesture.
      const onCandidate = candidate.some((c) => previewCovers(c, i));
      armed.current = onCandidate;
      if (!onCandidate) onPropose(i);
      return;
    }

    drawing.current = true;
    last.current = i;
    onHover(i);
    onPaint(i);
  };

  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    if (panFrom.current !== null) {
      const [dx, dy] = toUnits(
        e.clientX - panFrom.current.x,
        e.clientY - panFrom.current.y
      );
      panFrom.current = { x: e.clientX, y: e.clientY };
      onPan(dx, dy);
      return;
    }

    const i = indexOf(e.target);

    if (anchor.current !== null) {
      // `alt` is read HERE and not at the press: releasing Option mid-drag has
      // to turn a symmetric figure back into a one-sided one under the finger,
      // or the modifier is a mode with no indicator.
      if (i !== null) onShapeDrag(anchor.current, i, e.altKey);
      return;
    }

    if (shape !== "free" && !panning) {
      onHover(i);
      return;
    }

    if (dragBehaviour === "propose") {
      if (!proposing.current) {
        onHover(i);
        return;
      }
      if (i === null || i === last.current) return;
      last.current = i;
      moved.current = true;
      // Dragged off the tap it started as, so it is a drag: re-propose.
      armed.current = false;
      onPropose(i);
      return;
    }

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
    // The ARROWS only. Enter and Space have both moved to the page's window
    // listener, and for the same reason: they have to work while the hand is on
    // a rail control, or the anchored tools have no keyboard path at all —
    // measured, by pressing Enter with the body focused and watching nothing
    // happen. The arrows stay because they are a walk by SCREEN direction and
    // the plate is the thing that has a screen; binding ↑ and ↓ globally would
    // also take the page's own scrolling away.
  };

  const cursorPoints = cursor === null ? undefined : pts[cursor];

  return (
    <svg
      ref={svg}
      viewBox={
        view === null
          ? `0 0 ${geom.width} ${geom.height}`
          : `${view.x} ${view.y} ${view.w} ${view.h}`
      }
      className={className}
      data-gesture={panning ? "pan" : shape === "free" ? undefined : shape}
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

      <TileLayer geom={geom} pts={pts} order={order} show={showTiling} />
      <PaintLayer
        geom={geom}
        pts={pts}
        paint={paint}
        visible={visible}
        weld={weld}
      />
      {relief && (
        <WashLayer pts={pts} wash={relief.wash} visible={visible} />
      )}

      {/* The outline never moves under the relief: the rim is one level set of
          the ring index, so its scale factor is pinned at 1 and the plate
          curves inside a boundary that stays exactly where it was. */}
      <polygon
        points={geom.outline.map((v) => `${v[0]},${v[1]}`).join(" ")}
        fill="none"
        stroke="rgba(236,230,220,.22)"
        strokeWidth={1.4}
        pointerEvents="none"
      />

      <GuideLayer
        guides={guides}
        show={showGuides}
        bend={relief === null ? null : relief.bend}
      />

      {preview && (
        <Ghost
          geom={geom}
          pts={pts}
          centroids={centroids}
          spec={preview}
          standing={false}
          dashClass={candidateClass}
        />
      )}
      {/* ONE GHOST PER APPLICATION, keyed by its seed — which is unique inside a
          proposal, because `propose.proposeSeed` refuses a repeat. Drawn as a
          run of `standing` ghosts rather than as one merged outline, for the
          reason `lib/propose.ts` gives: an application's colours are indexed
          over ITS OWN span, so merging them would show hues the commit is not
          going to lay.

          WHAT THIS COSTS, stated rather than optimised away. `Ghost` is
          memoised, but the page rebuilds the whole spec list each time the drag
          gathers one more application, so every standing ghost re-renders on
          every new seed — O(seeds × orbit) polygons per pointer move. That is
          inside a budget this component already spends: a PAINT drag re-renders
          `PaintLayer` over the entire plate on every application, which at depth
          4 is 1536 polygons, and a proposal a finger could plausibly gather is
          well under that. If it is ever measured to matter, the fix is an
          identity cache in the page keyed by seed, so an unchanged spec keeps
          its object and this `memo` bails out. It has not been measured, so it
          has not been written. */}
      {candidate.map((spec) => (
        <Ghost
          key={spec.seed}
          geom={geom}
          pts={pts}
          centroids={centroids}
          spec={spec}
          standing
          dashClass={candidateClass}
        />
      ))}

      {cursorPoints !== undefined && (
        <polygon
          points={cursorPoints}
          fill="none"
          stroke="#a3e635"
          strokeWidth={3}
          strokeLinejoin="round"
          pointerEvents="none"
        />
      )}

      <HitLayer pts={pts} order={order} />
    </svg>
  );
}
