"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import DrawBoard, {
  PAINT_SEAM,
  SEAM,
  TILE,
  type BoardGeometry,
  type PreviewSpec,
  type ReliefView,
} from "@/components/DrawBoard";
import { ADJUSTMENTS, ADJUST_NAMES, type AdjustName } from "@/lib/adjust";
import {
  cellCount,
  extractArt,
  importByGeometry,
  MAX_ART_BYTES,
  MAX_DEPTH,
  MIN_DEPTH,
  paintFromPayload,
  payloadFromPaint,
} from "@/lib/artfile";
import {
  BAND_FAMILIES,
  bandSizes,
  buildBandSurface,
  type BandFamily,
  type BandSurface,
} from "@/lib/bands";
import {
  activeProgression,
  BAND_NOTE,
  brushSpan,
  brushStamp,
  defaultDragMode,
  EMPTY_EVENTS,
  eventCount,
  progressionIndex,
  pushEvents,
  redoEvents,
  stampColours,
  TOOLS,
  undoEvents,
  upcomingBases,
  type DragMode,
  type EventLog,
  type Tool,
} from "@/lib/brush";
import { buildFigure, type Convention, type Figure } from "@/lib/figure";
import { buildHexagon, type Hexagon } from "@/lib/hexagon";
import {
  hexagonSurface,
  triangleSurface,
  BRUSH_SCOPES,
  SCOPE_LABEL,
  SCOPE_MODES,
  TRIANGLE_MODES,
  type BrushMode,
  type BrushScope,
  type CanvasKind,
  type SymmetrySurface,
} from "@/lib/orbit";
import {
  buildRelief,
  deformPoint,
  READINGS,
  READING_LABEL,
  reliefFrame,
  restShell,
  templateShell,
  type Reading,
  type ReliefSurface,
} from "@/lib/relief";
import { PROGRESSION_NAMES, type ProgressionName } from "@/lib/progression";
import {
  SCHEMES,
  SCHEME_NAMES,
  swatchFromHex,
  type SchemeName,
  type Swatch,
} from "@/lib/schemes";
import {
  stepCursor,
  symmetryGuides,
  type CanvasFrame,
  type Direction,
  type Pt,
} from "@/lib/guides";
import type { ArtOverlayGroup } from "@/lib/strokes";
import {
  applyEdits,
  artworkSvg,
  clearStroke,
  commit,
  EMPTY_HISTORY,
  exportName,
  mergeEdits,
  planEdits,
  redo,
  undo,
  type CellEdit,
  type History,
} from "@/lib/strokes";
import BrushDial from "./BrushDial";
import ColourWell from "./ColourWell";
import styles from "./draw.module.css";

/**
 * A drawing program whose brush is a symmetry.
 *
 * Clicking a cell paints its whole ORBIT under the subgroup the brush names,
 * and the k-th cell of that orbit takes the k-th hue of the colour scheme. So
 * the drawing's colour structure is not decoration laid over its symmetry — it
 * is a reading of that symmetry. A 6-orbit painted with the triad comes out
 * with a 3-fold colour period, which is exactly the relation C3 < C6.
 *
 * ── Convention ──────────────────────────────────────────────────────────
 *
 * Drawn at `apex`, and the choice does not matter while drawing. The apex/ifs
 * question is about which V4 charge a triangle is LABELLED with; the drawing
 * program never reads a charge. Orbits agree as sets of triangles under both
 * conventions — see the header of `orbit.ts` — so a plate drawn here would look
 * identical either way. Exposing the toggle would be a control with no visible
 * effect, which is worse than no control, so there is no control.
 *
 * It is nonetheless STATE and not a constant, because a loaded file may declare
 * one. The two conventions cut the same triangles but, from depth 2, hand them
 * out in a different ORDER, so cell 4 is a different triangle under each. A
 * payload that says `ifs` and is read as `apex` restores a permuted plate — a
 * drawing that was never made. Loading therefore adopts the file's convention,
 * and this program's own exports go on saying `apex`.
 *
 * ── What re-renders ─────────────────────────────────────────────────────
 *
 * `paint` is a Map held both in state (for React) and in a ref (for the paint
 * loop). The ref exists because a drag applies several edits between two
 * renders, and each one needs to see the result of the last; reading `paint`
 * from state inside the handler would plan every edit against a stale canvas
 * and lose all but the final cell of a fast stroke.
 *
 * ── Three tools, one stroke ─────────────────────────────────────────────
 *
 * Paint, erase and adjust are the same code path. `brushCells` says which cells,
 * `brushColours` says what colour each of them ends up, and `planEdits` turns
 * the pair into an ordinary undoable gesture — so the eraser honours the brush
 * symmetry and the band setting for free, and the adjustment brush cannot
 * accidentally behave as a fill. See the header of `brush.ts`.
 *
 * ── The two counters, and why neither of them is an accumulator ─────────
 *
 * `history` holds what was drawn; `events` holds how many COLOURING events each
 * gesture spent. They are pushed, popped and trimmed together, one rung for one,
 * so the progression's argument n is recovered by summing rather than
 * remembered — which is what makes undo restore the exact prior colours instead
 * of colours one step further round the wheel. `progression.ts` explains why a
 * mutable would not survive the first undo; `brush.ts` holds the log.
 */

const CONVENTION: Convention = "apex";

/**
 * The depths on offer, taken from the loader's ceiling rather than written out.
 *
 * Triangle depth 5 is 1024 cells; hexagon depth 4 is 1536, six sectors of 4^4.
 * Both stay under the point where a full re-render is felt, and the layer split
 * in DrawBoard means only the paint layer is ever redrawn. `artfile.ts` refuses
 * to load a plate deeper than a button here can select, so the two lists are
 * the same list — a second copy of these numbers would be a way for a file to
 * become loadable but not selectable.
 */
const DEPTHS: Record<CanvasKind, number[]> = {
  triangle: Array.from(
    { length: MAX_DEPTH.triangle - MIN_DEPTH + 1 },
    (_, k) => MIN_DEPTH + k
  ),
  hexagon: Array.from(
    { length: MAX_DEPTH.hexagon - MIN_DEPTH + 1 },
    (_, k) => MIN_DEPTH + k
  ),
};

/** Canvas units per cell edge — the triangle is drawn at twice the hexagon's. */
const edgeAt = (kind: CanvasKind, depth: number) =>
  (kind === "triangle" ? 1024 : 512) / 2 ** depth;

/** A hairline that stays a hairline from 4 cells to 1536 of them. */
const seamAt = (kind: CanvasKind, depth: number) =>
  Math.min(2.4, Math.max(0.4, edgeAt(kind, depth) * 0.022));

/**
 * The export's plate is FLAT, where the board's is a radial gradient.
 *
 * The vignette is there to seat the figure in the console; a file that leaves
 * the browser has no console around it, and a gradient in the corner of an
 * exported plate reads as a stain. Tiles and seams do carry over verbatim, so
 * the shape of the drawing is identical.
 */
const PLATE_BG = "#0a0908";

/** How far ahead the drift strip looks. Six reads as a phrase, not a table. */
const DRIFT_AHEAD = 6;

/**
 * Does this pointer hover?
 *
 * Subscribed rather than sampled once, and read through `useSyncExternalStore`
 * rather than measured in an effect, for two reasons. The server has no
 * `matchMedia`, so the snapshot has to be able to say "assume fine" and then be
 * corrected on the client without the two renders disagreeing about the DOM;
 * and a hybrid machine can gain or lose a touchscreen mid-session, at which
 * point the default ought to follow.
 */
const subscribeCoarse = (onChange: () => void) => {
  const mq = window.matchMedia("(pointer: coarse)");
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
};
const coarseNow = () => window.matchMedia("(pointer: coarse)").matches;
const coarseOnServer = () => false;

interface Canvas {
  kind: CanvasKind;
  geom: BoardGeometry;
  frame: CanvasFrame;
  centroids: Pt[];
  surface: SymmetrySurface;
  bands: BandSurface;
  /**
   * The built figure itself, kept so a load can match a foreign file's polygons
   * against the cells' own vertices. `geom.cells` is the same geometry already
   * flattened for the board, but the importer's signature is stated in terms of
   * the figure, which is the thing that knows how it was numbered.
   */
  fig: Figure | Hexagon;
  /** The hexagon, when this is one. `null` on the triangle. */
  hex: Hexagon | null;
}

const TOOL_LABEL: Record<Tool, string> = {
  paint: "lay the scheme's colours on the orbit",
  erase: "clear the orbit back to bare tiling",
  adjust: "transform the colour already there",
};

function ToolGlyph({ tool }: { tool: Tool }) {
  return (
    <svg viewBox="0 0 16 16" className={styles.toolGlyph} aria-hidden="true">
      {tool === "paint" && <polygon points="8,2 15,14 1,14" fill="currentColor" />}
      {tool === "erase" && (
        <>
          <polygon
            points="8,2 15,14 1,14"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            strokeDasharray="3 2.4"
          />
          <line
            x1={3}
            y1={13}
            x2={13}
            y2={3}
            stroke="currentColor"
            strokeWidth={1.6}
          />
        </>
      )}
      {tool === "adjust" && (
        <>
          <circle
            cx={8}
            cy={8}
            r={6}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
          />
          <path d="M8 2 A6 6 0 0 1 8 14 Z" fill="currentColor" />
        </>
      )}
    </svg>
  );
}

export default function DrawPage() {
  const [kind, setKind] = useState<CanvasKind>("triangle");
  const [depth, setDepth] = useState(4);
  /** Drawn at `apex`; only a loaded file can move it. See the header. */
  const [convention, setConvention] = useState<Convention>(CONVENTION);
  const [mode, setMode] = useState<BrushMode>(6);
  /**
   * Whose symmetries the brush uses. Only the hexagon has more than one answer;
   * see the note on `BrushScope`. A triangle IS a sector, so scoping it to one
   * would be the identity dressed as a control.
   */
  const [scope, setScope] = useState<BrushScope>("hexagon");
  /** The sector the pointer was last in — what a SECTOR brush is scoped to. */
  const [sector, setSector] = useState(0);
  const [reliefOn, setReliefOn] = useState(false);
  const [reading, setReading] = useState<Reading>("convex");
  const [schemeName, setSchemeName] = useState<SchemeName>("hexad");
  const [base, setBase] = useState<Swatch>(() => swatchFromHex("#d4a017"));

  const [tool, setTool] = useState<Tool>("paint");
  const [adjustName, setAdjustName] = useState<AdjustName>("hue+");
  const [band, setBand] = useState<BandFamily | null>(null);
  const [progName, setProgName] = useState<ProgressionName>("off");
  // Events already spent when the progression was chosen; see progressionIndex.
  const [progOrigin, setProgOrigin] = useState(0);
  /** `null` = follow the pointer type; anything else is the user's own choice. */
  const [dragChoice, setDragChoice] = useState<DragMode | null>(null);
  const [candidate, setCandidate] = useState<number | null>(null);

  const [paint, setPaint] = useState<ReadonlyMap<number, string>>(new Map());
  const [history, setHistory] = useState<History>(EMPTY_HISTORY);
  const [events, setEvents] = useState<EventLog>(EMPTY_EVENTS);
  const [hover, setHover] = useState<number | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [showGuides, setShowGuides] = useState(true);
  const [showTiling, setShowTiling] = useState(true);
  const [weld, setWeld] = useState(false);
  const [announce, setAnnounce] = useState("");
  /**
   * Why the last load did not happen.
   *
   * Held rather than only announced, because a refusal that exists for one
   * screen-reader utterance and nowhere on the screen is indistinguishable from
   * a button that does nothing. It sits beside the plate until it is dismissed
   * or until a load succeeds. Never an `alert`: a modal would take the focus
   * off the canvas to say something the canvas could have said itself.
   */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  /**
   * Nesting depth of the drag currently over the plate.
   *
   * `dragleave` fires when the pointer crosses onto a CHILD of the drop target,
   * so a naive enter/leave pair blinks the drop state on and off as the file is
   * dragged across the polygons. Counting entries against leaves is the fix
   * that does not depend on knowing which children exist.
   */
  const dragDepth = useRef(0);

  const paintRef = useRef<ReadonlyMap<number, string>>(new Map());
  const pending = useRef<CellEdit[]>([]);
  /**
   * Colouring events spent by the gesture in progress.
   *
   * A ref because a drag can apply several times between two renders and each
   * application has to see the count the last one left — the same reason
   * `paintRef` exists — and mirrored into `liveEvents` because the drift strip
   * and the ghost are rendered from it.
   */
  const pendingEvents = useRef(0);
  const [liveEvents, setLiveEvents] = useState(0);

  const scheme = SCHEMES[schemeName];
  const adjust = ADJUSTMENTS[adjustName];
  const modes = kind === "triangle" ? TRIANGLE_MODES : SCOPE_MODES[scope];
  /** A sector is a copy of the base triangle, so a sector brush wears D₃'s face. */
  const glyphKind: CanvasKind =
    kind === "hexagon" && scope !== "hexagon" ? "triangle" : kind;

  // A finger has no hover, so the ghost preview — the thing that teaches what
  // the brush does — is unreachable on touch unless the press itself proposes.
  const coarse = useSyncExternalStore(subscribeCoarse, coarseNow, coarseOnServer);
  const dragMode = dragChoice ?? defaultDragMode(coarse);

  const canvas: Canvas = useMemo(() => {
    const seamWidth = seamAt(kind, depth);
    if (kind === "triangle") {
      const f = buildFigure(depth, convention);
      return {
        kind,
        geom: {
          width: f.width,
          height: f.height,
          outline: f.corners,
          cells: f.cells,
          seamWidth,
        },
        frame: { kind: "triangle", corners: f.corners },
        centroids: f.cells.map((c) => c.centroid),
        surface: triangleSurface(f),
        bands: buildBandSurface(f),
        fig: f,
        hex: null,
      };
    }
    const h = buildHexagon(depth, convention);
    return {
      kind,
      geom: {
        width: h.width,
        height: h.height,
        outline: h.corners,
        cells: h.cells,
        seamWidth,
      },
      frame: { kind: "hexagon", centre: h.centre, radius: h.radius },
      centroids: h.cells.map((c) => c.centroid),
      surface: hexagonSurface(h, scope),
      bands: buildBandSurface(h),
      fig: h,
      hex: h,
    };
  }, [kind, depth, convention, scope]);

  /**
   * Which sectors the axis overlay draws in.
   *
   * `null` is the whole plate and its six diameters. A single sector draws that
   * sector's three medians and nothing else, because a sector brush mirrors
   * about them and about no diameter — see `symmetryGuides`. SECTOR ×6 draws all
   * six copies, which is what the group actually contains.
   */
  const guideSectors = useMemo(() => {
    if (kind !== "hexagon" || scope === "hexagon") return null;
    return scope === "sector" ? [sector] : [0, 1, 2, 3, 4, 5];
  }, [kind, scope, sector]);

  const guides = useMemo(
    () =>
      symmetryGuides(
        canvas.frame,
        mode,
        guideSectors,
        scope === "sector6" ? 6 : 0
      ),
    [canvas, mode, guideSectors, scope]
  );

  /**
   * The cell the readouts and the relief take their cue from.
   *
   * Clamped to the canvas, because a cell index outlives the canvas that
   * numbered it by exactly one render when the depth changes.
   */
  const seedCell =
    (hover ?? candidate ?? cursor) === null ||
    (hover ?? candidate ?? cursor)! >= canvas.geom.cells.length
      ? null
      : (hover ?? candidate ?? cursor)!;

  /**
   * Remember which sector a cell was in.
   *
   * Called from the gestures rather than derived from `seedCell`, and STICKY on
   * purpose: the sector overlay must not vanish the moment the pointer leaves
   * the plate to reach a control, or the guides flicker off every time the brush
   * is changed. `setSector` with the value it already holds is a no-op, so a
   * drag inside one sector costs nothing.
   */
  const noteSector = useCallback(
    (i: number | null) => {
      const h = canvas.hex;
      if (h === null || i === null) return;
      const c = h.cells[i];
      if (c !== undefined) setSector(c.sector);
    },
    [canvas]
  );

  const onHover = useCallback(
    (i: number | null) => {
      noteSector(i);
      setHover(i);
    },
    [noteSector]
  );

  // ── the relief ──────────────────────────────────────────────────────────

  /**
   * The relief's static half: vertex offsets and their exact ring indices.
   *
   * Hexagon only. The six-point construction reads six corresponding cells off
   * a C6 orbit, and a triangle has no C6; the band-size height field is FLAT
   * there as well — two values at every depth, measured — so there is nothing
   * for the toggle to do and it is not offered.
   */
  const reliefSurface = useMemo<ReliefSurface | null>(
    () => (canvas.hex === null ? null : buildRelief(canvas.hex)),
    [canvas]
  );

  /**
   * The template ring: the shell of the cell under the pointer, which is the
   * ring its whole C6 orbit sits on. An INTEGER, so it changes some fifty times
   * across a depth-4 plate rather than once per pointer event — which is the
   * entire reason a 1536-cell display effect is affordable.
   */
  const ring =
    reliefSurface === null
      ? 0
      : seedCell === null
      ? restShell(reliefSurface)
      : templateShell(reliefSurface, seedCell);

  const frame = useMemo(
    () =>
      reliefSurface === null || !reliefOn
        ? null
        : reliefFrame(reliefSurface, ring, reading),
    [reliefSurface, reliefOn, ring, reading]
  );

  const relief = useMemo<ReliefView | null>(() => {
    if (frame === null || reliefSurface === null) return null;
    return {
      points: frame.points,
      centroids: frame.centroids,
      wash: frame.wash,
      bend: (p) => deformPoint(reliefSurface, frame.scales, p),
    };
  }, [frame, reliefSurface]);

  // ── the colour the next stroke will start from ──────────────────────────

  const prog = useMemo(
    () => activeProgression(progName, scheme.offsets.length),
    [progName, scheme]
  );

  const spent = eventCount(events);
  const driftIndex = progressionIndex(events, progOrigin, liveEvents);
  const effectiveBase = useMemo(
    () => prog.at(base, driftIndex),
    [prog, base, driftIndex]
  );
  const upcoming = useMemo(
    () => upcomingBases(prog, base, driftIndex, DRIFT_AHEAD),
    [prog, base, driftIndex]
  );

  const shape = useMemo(() => ({ mode, band }), [mode, band]);

  /**
   * How many scheme positions this brush uses — and it is NOT always the mode.
   *
   * With a band the brush paints a set of rows, and the count of rows is the
   * subgroup order divided by the band's stabiliser: three rows for a 6-fold
   * brush on the triangle, because m_A carries a family-A band to itself, and
   * six on the hexagon. Reading it from the brush rather than assuming `mode`
   * is what keeps the tape from advertising six hues the stroke will not lay.
   */
  const span = useMemo(
    () => brushSpan(canvas.surface, canvas.bands, shape, seedCell ?? 0),
    [canvas, shape, seedCell]
  );

  /** The scheme's colours in stroke order, as the current brush would lay them. */
  const tape = useMemo(
    () =>
      Array.from({ length: span }, (_, k) =>
        scheme.at(effectiveBase, k, span)
      ),
    [scheme, effectiveBase, span]
  );

  /**
   * What the brush would do at `seed`, as the board draws it.
   *
   * One function for the hover ghost and for the standing candidate, so the two
   * cannot come to disagree about what a stroke is. Cells an ADJUSTMENT would
   * not move are split out as `inert` rather than dropped: "the brush reaches
   * here and will do nothing" is the rule that stops it behaving as a fill, and
   * it is worth seeing.
   */
  const specFor = useCallback(
    (seed: number | null): PreviewSpec | null => {
      if (seed === null || seed >= canvas.geom.cells.length) return null;
      const stamp = brushStamp(canvas.surface, canvas.bands, seed, shape);
      const all = stamp.cells;
      if (tool === "erase") {
        return { cells: all, colours: [], inert: [], seed, erasing: true };
      }
      const colours = stampColours(
        { tool, scheme, base: effectiveBase, adjust },
        paint,
        stamp
      );
      if (tool === "paint") {
        return {
          cells: all,
          colours: colours.map((c) => c ?? "#ece6dc"),
          inert: [],
          seed,
          erasing: false,
        };
      }
      const cells: number[] = [];
      const hex: string[] = [];
      const inert: number[] = [];
      all.forEach((c, k) => {
        const to = colours[k];
        if (to === null || to === (paint.get(c) ?? null)) inert.push(c);
        else {
          cells.push(c);
          hex.push(to);
        }
      });
      return { cells, colours: hex, inert, seed, erasing: false };
    },
    // The plate is read from STATE here, not from `paintRef`: this runs during
    // render, and the adjust ghost is a function of the plate as rendered.
    [canvas, shape, tool, scheme, effectiveBase, adjust, paint]
  );

  const candidateSpec = useMemo(
    () => (dragMode === "propose" ? specFor(candidate) : null),
    [dragMode, specFor, candidate]
  );

  // A hover ghost and a standing proposal at once is two answers to one
  // question. The proposal wins: it is the one that can be committed.
  const preview = useMemo(
    () => (candidateSpec === null ? specFor(hover) : null),
    [candidateSpec, specFor, hover]
  );

  // ── the canvas is a different set of cells now ──────────────────────────

  /**
   * Put a plate on the canvas and forget everything behind it.
   *
   * One code path for "the cells changed underneath you" and for "this file is
   * the drawing now", because both leave a history whose strokes were recorded
   * against a plate that no longer exists. Undoing into that plate would restore
   * colours to cells that mean something else, so the stacks are emptied rather
   * than carried: after this the loaded plate is the single restorable state,
   * and undo says there is nothing to undo, which is true.
   */
  const reset = useCallback((plate: Map<number, string>, why: string) => {
    paintRef.current = plate;
    pending.current = [];
    pendingEvents.current = 0;
    setLiveEvents(0);
    setPaint(paintRef.current);
    setHistory(EMPTY_HISTORY);
    setEvents(EMPTY_EVENTS);
    setProgOrigin(0);
    setHover(null);
    setCursor(null);
    setCandidate(null);
    setAnnounce(why);
  }, []);

  const wipe = useCallback(
    (why: string) => {
      // A cleared plate is a new drawing, and a drawing made here is `apex`.
      setConvention(CONVENTION);
      reset(new Map(), why);
    },
    [reset]
  );

  const pickKind = (next: CanvasKind) => {
    if (next === kind) return;
    const d = Math.min(depth, Math.max(...DEPTHS[next]));
    const m = next === "triangle" && mode === 12 ? 6 : mode;
    setKind(next);
    setDepth(d);
    setMode(m);
    wipe(`canvas set to ${next}, depth ${d}, ${cellCount(next, d)} cells — plate cleared`);
  };

  /**
   * Changing the scope does NOT clear the plate.
   *
   * It changes which group the brush uses and nothing about which cells exist,
   * so every colour already laid still names the cell it was laid on. Mode 12 is
   * the one thing that has to move: it is a subgroup of D6 and of nothing else,
   * so a sector scope that kept it would name a brush that scope does not have.
   * Same rule as `pickKind`, for the same reason.
   */
  const pickScope = (next: BrushScope) => {
    if (next === scope) return;
    const m = SCOPE_MODES[next].includes(mode) ? mode : 6;
    setScope(next);
    setMode(m);
    setCandidate(null);
    setAnnounce(
      `brush scope ${next} — ${SCOPE_LABEL[next]}${
        m === mode ? "" : `; brush dropped to ${m}-fold`
      }`
    );
  };

  const pickRelief = (on: boolean) => {
    setReliefOn(on);
    setAnnounce(
      on
        ? `relief on — ${READING_LABEL[reading]}; the ring under the pointer is the template`
        : "relief off — the plate is flat again"
    );
  };

  const pickReading = (next: Reading) => {
    if (next === reading) return;
    setReading(next);
    setAnnounce(`relief ${next} — ${READING_LABEL[next]}`);
  };

  const pickDepth = (d: number) => {
    if (d === depth) return;
    setDepth(d);
    wipe(`depth ${d}, ${cellCount(kind, d)} cells — plate cleared`);
  };

  // ── painting ────────────────────────────────────────────────────────────

  const paintAt = useCallback(
    (i: number) => {
      const stamp = brushStamp(canvas.surface, canvas.bands, i, shape);
      // Recomputed per application rather than taken from `effectiveBase`, so a
      // drag lays a gradient along its own path instead of one flat colour.
      const n = progressionIndex(events, progOrigin, pendingEvents.current);
      const colours = stampColours(
        { tool, scheme, base: prog.at(base, n), adjust },
        paintRef.current,
        stamp
      );
      const edits = planEdits(paintRef.current, stamp.cells, colours);
      if (edits.length === 0) return;
      if (tool === "paint") {
        pendingEvents.current += 1;
        setLiveEvents(pendingEvents.current);
      }
      paintRef.current = applyEdits(paintRef.current, edits, "do");
      pending.current = mergeEdits(pending.current, edits);
      setPaint(paintRef.current);
    },
    [canvas, shape, tool, scheme, adjust, prog, base, events, progOrigin]
  );

  const endStroke = useCallback(
    (how: "stroke" | "commit" = "stroke") => {
      const edits = pending.current;
      const used = pendingEvents.current;
      pending.current = [];
      pendingEvents.current = 0;
      setLiveEvents(0);
      if (edits.length === 0) {
        // Not silence. A gesture that changed nothing is the most confusing
        // thing an adjustment brush can do, and the reason is always the same
        // one worth teaching: there was no colour under it to transform.
        setAnnounce(
          tool === "adjust"
            ? "nothing adjusted — the brush found no paint under it"
            : "nothing changed"
        );
        return;
      }
      setHistory((h) => commit(h, { edits }));
      // Pushed together with the stroke and never apart from it: the two stacks
      // being the same height is what makes the progression index recoverable.
      setEvents((e) => pushEvents(e, used));
      const verb =
        tool === "erase" ? "erased" : tool === "adjust" ? adjustName : "painted";
      setAnnounce(
        `${how === "commit" ? "committed — " : ""}${verb} ${edits.length} cell${
          edits.length === 1 ? "" : "s"
        } with the ${mode}-fold brush${band === null ? "" : `, band ${band}`} — ${
          paintRef.current.size
        } on the plate`
      );
    },
    [tool, adjustName, mode, band]
  );

  const applyStroke = useCallback(
    (edits: readonly CellEdit[], direction: "do" | "undo", said: string) => {
      paintRef.current = applyEdits(paintRef.current, edits, direction);
      setPaint(paintRef.current);
      setAnnounce(`${said} — ${paintRef.current.size} cells on the plate`);
    },
    []
  );

  const doUndo = useCallback(() => {
    const step = undo(history);
    if (step.stroke === null) {
      setAnnounce("nothing to undo");
      return;
    }
    setHistory(step.history);
    setEvents(undoEvents(events));
    applyStroke(step.stroke.edits, "undo", `undid ${step.stroke.edits.length} cells`);
  }, [history, events, applyStroke]);

  const doRedo = useCallback(() => {
    const step = redo(history);
    if (step.stroke === null) {
      setAnnounce("nothing to redo");
      return;
    }
    setHistory(step.history);
    setEvents(redoEvents(events));
    applyStroke(step.stroke.edits, "do", `redid ${step.stroke.edits.length} cells`);
  }, [history, events, applyStroke]);

  const doClear = useCallback(() => {
    const stroke = clearStroke(paintRef.current);
    if (stroke.edits.length === 0) {
      setAnnounce("the plate is already empty");
      return;
    }
    setHistory((h) => commit(h, stroke));
    // A clear is a gesture and spends no colouring events, but it still takes a
    // rung, or the log stops shadowing the history.
    setEvents((e) => pushEvents(e, 0));
    applyStroke(stroke.edits, "do", `cleared ${stroke.edits.length} cells`);
  }, [applyStroke]);

  // ── propose and commit ──────────────────────────────────────────────────

  const propose = useCallback(
    (i: number) => {
      noteSector(i);
      setCandidate(i);
      setCursor(i);
      setHover(null);
    },
    [noteSector]
  );

  const commitCandidate = useCallback(() => {
    if (candidate === null) return;
    paintAt(candidate);
    endStroke("commit");
    setCandidate(null);
  }, [candidate, paintAt, endStroke]);

  const dropCandidate = useCallback(() => {
    if (candidate === null) return;
    setCandidate(null);
    setAnnounce("candidate dropped");
  }, [candidate]);

  const pickDragMode = (next: DragMode) => {
    if (next === dragMode) return;
    setDragChoice(next);
    setCandidate(null);
    setAnnounce(
      next === "propose"
        ? "drag proposes a candidate; tap it to commit"
        : "drag paints continuously"
    );
  };

  const pickTool = (next: Tool) => {
    if (next === tool) return;
    setTool(next);
    setAnnounce(`${next} tool — ${TOOL_LABEL[next]}`);
  };

  /**
   * Selecting a band does exactly one thing: select a band.
   *
   * It used to also switch WELD on the first time, and the reasoning was sound
   * — a row with a seam at every join reads as a run of triangles rather than
   * as one line — but the mechanism was not. Weld is a property of how the
   * WHOLE PLATE renders, on screen and in the exported file, including cells
   * painted long before any band was chosen; a brush control cannot own it
   * without silently restyling work the band never touched. And a control that
   * moves another control leaves the panel describing a state the user did not
   * ask for, which is the one thing a panel must never do.
   *
   * So the toggle is strictly manual, and the teaching moved into the text: the
   * hint under this control names weld and says what it is for. A default is
   * fine; a default that reaches across the panel to set itself is not.
   */
  const pickBand = (next: BandFamily | null) => {
    if (next === band) return;
    setBand(next);
    setAnnounce(
      next === null
        ? "band brush off"
        : `band ${next} — ${BAND_NOTE[kind][next]}; ${brushSpan(
            canvas.surface,
            canvas.bands,
            { mode, band: next }
          )} rows under the ${mode}-fold brush`
    );
  };

  const pickProgression = (next: ProgressionName) => {
    if (next === progName) return;
    setProgName(next);
    // Rebased so the drift starts from the colour the plate is at, rather than
    // jumping to wherever the counter had wandered while it was switched off.
    setProgOrigin(spent);
    setAnnounce(
      next === "off"
        ? "progression off — the base colour holds"
        : `progression ${next} — ${activeProgression(
            next,
            scheme.offsets.length
          ).label}`
    );
  };

  // ── keyboard ────────────────────────────────────────────────────────────

  const onArrow = useCallback(
    (dir: Direction) => {
      const next = stepCursor(canvas.centroids, cursor, dir);
      if (next < 0) return;
      noteSector(next);
      setCursor(next);
      if (dragMode === "propose") setCandidate(next);
      else setHover(next);
    },
    [canvas, cursor, dragMode, noteSector]
  );

  const onCursorPaint = useCallback(() => {
    if (cursor === null) {
      const start = stepCursor(canvas.centroids, null, "up");
      if (start < 0) return;
      noteSector(start);
      setCursor(start);
      if (dragMode === "propose") setCandidate(start);
      else setHover(start);
      return;
    }
    if (dragMode === "propose") {
      if (candidate === cursor) commitCandidate();
      else propose(cursor);
      return;
    }
    paintAt(cursor);
    endStroke();
  }, [
    noteSector,
    cursor,
    canvas,
    dragMode,
    candidate,
    commitCandidate,
    propose,
    paintAt,
    endStroke,
  ]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The hex field is a text input; undo there belongs to the browser.
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      if (e.key === "Escape") {
        dropCandidate();
        return;
      }
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      e.preventDefault();
      if (e.shiftKey) doRedo();
      else doUndo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doUndo, doRedo, dropCandidate]);

  // ── export ──────────────────────────────────────────────────────────────

  /**
   * The file.
   *
   * The relief is baked at the RESTING ring, never at the one under the pointer.
   * Two reasons, and the second is the load-bearing one: the resting ring is
   * what the plate shows when nobody is pointing at it, so the file matches the
   * screen it was taken from; and it makes the export a pure function of the
   * drawing, so paint → export → clear → load → re-export is byte-identical
   * instead of depending on where the mouse happened to be.
   */
  const svgText = useCallback(() => {
    const baked =
      reliefSurface === null || !reliefOn
        ? null
        : reliefFrame(reliefSurface, restShell(reliefSurface), reading);
    const cells =
      baked === null
        ? canvas.geom.cells
        : baked.verts.map((verts) => ({ verts }));
    const overlay: ArtOverlayGroup[] =
      baked === null
        ? []
        : baked.wash.map((w) => ({
            fill: w.fill,
            opacity: w.alpha,
            shapes: w.cells.map((i) => baked.verts[i]),
          }));
    return artworkSvg({
      width: canvas.geom.width,
      height: canvas.geom.height,
      cells,
      paint: paintRef.current,
      background: PLATE_BG,
      unpainted: showTiling ? TILE : null,
      tileSeam: SEAM,
      paintSeam: PAINT_SEAM,
      weldPaint: weld,
      seamWidth: canvas.geom.seamWidth,
      title: `FOURFOLD — ${kind}, depth ${depth}, ${mode}-fold brush, ${schemeName}${
        band === null ? "" : `, band ${band}`
      }${baked === null ? "" : `, ${reading} relief`}`,
      // What makes the file loadable: the plate stated as cells rather than
      // inferred from shapes. See `artfile.ts`.
      payload: payloadFromPaint(
        kind,
        depth,
        convention,
        paintRef.current,
        baked === null ? undefined : { on: true, reading }
      ),
      overlay,
    });
  }, [
    canvas,
    showTiling,
    weld,
    kind,
    depth,
    convention,
    mode,
    schemeName,
    band,
    reliefSurface,
    reliefOn,
    reading,
  ]);

  const nameFor = useCallback(
    (ext: "svg" | "png") =>
      exportName({ kind, depth, mode, scheme: schemeName, at: new Date(), ext }),
    [kind, depth, mode, schemeName]
  );

  const download = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoked late rather than immediately: some browsers have not finished
    // reading the URL when click() returns.
    window.setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const exportSvg = () => {
    const name = nameFor("svg");
    download(new Blob([svgText()], { type: "image/svg+xml;charset=utf-8" }), name);
    setAnnounce(`exported ${name}`);
  };

  const exportPng = () => {
    const url = URL.createObjectURL(
      new Blob([svgText()], { type: "image/svg+xml;charset=utf-8" })
    );
    const img = new Image();
    img.onload = () => {
      const scale = 2;
      const c = document.createElement("canvas");
      c.width = Math.round(canvas.geom.width * scale);
      c.height = Math.round(canvas.geom.height * scale);
      const ctx = c.getContext("2d");
      URL.revokeObjectURL(url);
      if (ctx === null) {
        setAnnounce("PNG export failed — no 2d context");
        return;
      }
      ctx.drawImage(img, 0, 0, c.width, c.height);
      c.toBlob((blob) => {
        if (blob === null) {
          setAnnounce("PNG export failed");
          return;
        }
        const name = nameFor("png");
        download(blob, name);
        setAnnounce(`exported ${name}`);
      }, "image/png");
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setAnnounce("PNG export failed — the plate could not be rasterised");
    };
    img.src = url;
  };

  // ── load ────────────────────────────────────────────────────────────────

  const refuse = useCallback((why: string) => {
    setLoadError(why);
    setAnnounce(`load failed — ${why}`);
  }, []);

  /**
   * Read an SVG back onto the plate.
   *
   * Two outcomes, and they are told apart rather than blended. A file carrying
   * this program's payload is an EXACT restore: the canvas, the depth and the
   * convention become the file's, and the plate is its cells. A file without one
   * can still be matched shape by shape against the canvas as it stands, and
   * that outcome is reported with its match rate, because "142 of 384" is the
   * difference between a drawing and a fragment and the user is the only one who
   * can decide whether the fragment is what they wanted.
   *
   * Nothing here hands markup to the DOM. The file is text, and `artfile.ts`
   * reads it as text; a drawing dropped from a download folder is untrusted
   * input and is never given a chance to run.
   */
  const loadFile = useCallback(
    async (file: File) => {
      const named = /\.svg$/i.test(file.name);
      const typed = file.type === "" || /svg/i.test(file.type);
      if (!named && !typed) {
        refuse(`${file.name || "that file"} is not an SVG`);
        return;
      }
      if (file.size > MAX_ART_BYTES) {
        refuse(
          `that file is ${Math.round(file.size / 1024 / 1024)} MB — the limit is ${
            MAX_ART_BYTES / 1024 / 1024
          } MB`
        );
        return;
      }

      let text: string;
      try {
        text = await file.text();
      } catch {
        refuse("that file could not be read");
        return;
      }

      const payload = extractArt(text);
      if (payload !== null) {
        setLoadError(null);
        setKind(payload.canvas);
        setDepth(payload.depth);
        setConvention(payload.convention);
        // Mode 12 is a hexagon subgroup; carrying it onto a triangle would name
        // a brush that canvas does not have. Same rule as `pickKind`.
        if (payload.canvas === "triangle" && mode === 12) setMode(6);
        // The relief is display state and not paint, but a file that declares
        // it has to be able to come back looking like itself — and re-export to
        // the same bytes. A file that says nothing means the relief is off,
        // which is what every file written before the field existed meant.
        setReliefOn(payload.relief?.on ?? false);
        if (payload.relief !== undefined) setReading(payload.relief.reading);
        reset(
          paintFromPayload(payload),
          `loaded ${payload.cells.length} cell${
            payload.cells.length === 1 ? "" : "s"
          } — ${payload.canvas}, depth ${payload.depth}, ${
            payload.convention
          } · history reset to the loaded plate`
        );
        return;
      }

      if (!/<svg[\s>]/i.test(text)) {
        refuse("that file is not an SVG this program can read");
        return;
      }

      const got = importByGeometry(text, canvas.fig);
      if (got.matched.size === 0) {
        refuse(
          got.total === 0
            ? "no filled shapes in that file — nothing to import"
            : `none of the ${got.total} shapes in that file line up with this canvas — try the ${kind} depth it was drawn at`
        );
        return;
      }
      setLoadError(null);
      const plate = new Map<number, string>();
      for (const [i, s] of got.matched) plate.set(i, s.hex);
      reset(
        plate,
        `imported ${got.matched.size} of ${got.total} cells — this file was not made here${
          got.unmatched === 0 ? "" : `, ${got.unmatched} shapes matched no cell`
        }`
      );
    },
    [refuse, reset, canvas, kind, mode]
  );

  const openPicker = () => {
    setLoadError(null);
    fileInput.current?.click();
  };

  const onPicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Cleared so that picking the SAME file twice still fires a change event —
    // otherwise a failed load cannot be retried without choosing something else.
    e.target.value = "";
    if (file) void loadFile(file);
  };

  const onDropFile = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDropping(false);
    const file = e.dataTransfer.files?.[0];
    if (file === undefined) {
      refuse("nothing was dropped that this program could read");
      return;
    }
    void loadFile(file);
  };

  const onDragEnter = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDropping(true);
  };

  const onDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    // Without this the browser navigates to the file and the drawing is gone.
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const onDragLeave = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDropping(false);
  };

  // ── readouts ────────────────────────────────────────────────────────────

  const total = canvas.geom.cells.length;
  const live = candidateSpec ?? preview;
  const reach = live === null ? null : live.cells.length + live.inert.length;
  /**
   * What the live region says.
   *
   * A standing candidate speaks for itself, DERIVED rather than pushed into
   * `announce` from an effect — the proposal changes when the brush changes as
   * much as when the finger moves, and a derived string cannot fall out of step
   * with the ghost the way a stored one can. `announce` carries everything else:
   * strokes, undo, exports, tool changes, and the commit that clears the
   * candidate.
   */
  const said =
    candidateSpec === null
      ? announce
      : `candidate proposed at cell ${candidateSpec.seed} — ${
          candidateSpec.cells.length + candidateSpec.inert.length
        } cells under the ${tool} brush; tap it or press Enter to commit, Escape to drop`;

  const schemeGradient = `linear-gradient(90deg, ${tape
    .map((s, k) => `${s.hex} ${(100 * k) / Math.max(tape.length - 1, 1)}%`)
    .join(", ")})`;

  /** Measured, not assumed: hexagon bands are not uniform. */
  const bandStat = useMemo(() => {
    if (band === null) return null;
    const sizes = bandSizes(canvas.bands, band);
    return {
      count: sizes.length,
      min: Math.min(...sizes),
      max: Math.max(...sizes),
    };
  }, [canvas, band]);

  const legend = useMemo(() => {
    const items: { key: string; label: string; colour: string; dashed: boolean; dot: boolean }[] =
      [];
    // Deduplicated by isometry NAME, because a sector-scoped overlay draws the
    // same three medians once per sector and the legend is a key to the
    // families, not a census of the lines.
    const named = new Set<string>();
    for (const m of guides.mirrors) {
      if (m.family !== "median" || named.has(m.id)) continue;
      named.add(m.id);
      items.push({
        key: m.id,
        label: m.label.replace("—", "·").replace(/ · sector \d+$/, ""),
        colour: { m_A: "#67e8f9", m_B: "#4ade80", m_C: "#f59e0b" }[m.id] ?? "#67e8f9",
        dashed: false,
        dot: false,
      });
    }
    if (guides.mirrors.some((m) => m.family === "spine")) {
      items.push({
        key: "spine",
        label: "spine mirrors · 30° 90° 150° · to edge midpoints",
        colour: "#67e8f9",
        dashed: false,
        dot: false,
      });
    }
    if (guides.mirrors.some((m) => m.family === "boundary")) {
      items.push({
        key: "boundary",
        label: "sector boundaries · 0° 60° 120° · to corners",
        colour: "#f59e0b",
        dashed: true,
        dot: false,
      });
    }
    if (guides.rotation) {
      items.push({
        key: "rot",
        // The "no mirror" clause is only TRUE of a rotation-only subgroup, and
        // it is the whole point of the overlay that it never says a false thing
        // about the group in use.
        label:
          guides.mirrors.length === 0
            ? `C${guides.rotation.order} rotation · no mirror in this subgroup`
            : `C${guides.rotation.order} rotation · centre and orbit arcs`,
        colour: "#a78bfa",
        dashed: false,
        dot: true,
      });
    }
    return items;
  }, [guides]);

  return (
    <main className={styles.page}>
      <header className={styles.head}>
        <div>
          <div className={styles.brandLine}>
            <span className={styles.eyebrow}>Fourfold</span>
            <h1 className={styles.title}>Symmetry Draw</h1>
          </div>
          <div className={styles.schemeRule} style={{ background: schemeGradient }} />
        </div>
        <p className={styles.headNote}>
          Paint one cell and the brush paints its whole <b>orbit</b>. Orbit
          position <b>k</b> takes the scheme&rsquo;s <b>k</b>-th hue, so the
          colour structure of the drawing <i>is</i> its symmetry structure.
        </p>
        <Link href="/" className={styles.backLink}>
          ← the game
        </Link>
      </header>

      <div className={styles.stage}>
        <aside className={styles.rail}>
          {/* Two columns on a wide screen, one stacked flow everywhere else —
              see `.railCol`. The split is STRUCTURE (what the brush is, and what
              is drawn) against COLOUR (what it lays down). */}
          <div className={styles.railCol}>
          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>Canvas</h2>
              <span className={styles.sectionMeta}>{total} cells</span>
            </div>
            <div className={styles.seg} role="group" aria-label="canvas shape">
              {(["triangle", "hexagon"] as CanvasKind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  className={styles.segBtn}
                  aria-pressed={kind === k}
                  onClick={() => pickKind(k)}
                >
                  {k}
                </button>
              ))}
            </div>
            <div
              className={`${styles.seg} ${styles.depthRow}`}
              role="group"
              aria-label="subdivision depth"
            >
              {DEPTHS[kind].map((d) => (
                <button
                  key={d}
                  type="button"
                  className={`${styles.segBtn} ${styles.depthBtn}`}
                  aria-pressed={depth === d}
                  aria-label={`depth ${d} — ${cellCount(kind, d)} cells`}
                  onClick={() => pickDepth(d)}
                >
                  {d}
                </button>
              ))}
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>Brush symmetry</h2>
              <span className={styles.sectionMeta}>
                {kind === "triangle" || scope === "hexagon"
                  ? `${kind === "triangle" ? "D₃" : "D₆"} subgroups`
                  : scope === "sector"
                  ? `sector ${sector} · D₃`
                  : "C₆ × D₃"}
              </span>
            </div>
            {kind === "hexagon" && (
              <>
                <div
                  className={`${styles.seg} ${styles.scopeSeg}`}
                  role="group"
                  aria-label="brush scope"
                >
                  {BRUSH_SCOPES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={styles.segBtn}
                      aria-pressed={scope === s}
                      aria-label={`brush scope ${s} — ${SCOPE_LABEL[s]}`}
                      onClick={() => pickScope(s)}
                    >
                      {s === "sector6" ? "sector ×6" : s}
                    </button>
                  ))}
                </div>
                <p className={styles.hint}>
                  {scope === "hexagon" ? (
                    <>
                      <b>D₆ — the whole plate.</b> Its three spine mirrors each
                      reflect <i>two opposite sectors at once</i>.
                    </>
                  ) : scope === "sector" ? (
                    <>
                      <b>The sector&rsquo;s own D₃</b>, in sector{" "}
                      <b>{sector}</b> alone — three medians and a 120° turn
                      about <i>its</i> centroid. None of the twelve isometries of
                      the hexagon does this: reflecting one sector and leaving
                      its opposite alone is not an isometry at all.
                    </>
                  ) : (
                    <>
                      <b>C₆ × D₃, order {6 * mode}.</b> The local orbit, repeated
                      in all six sectors. It meets D₆ only in the rotations.
                    </>
                  )}
                </p>
              </>
            )}
            <BrushDial
              kind={glyphKind}
              modes={modes}
              mode={mode}
              onPick={setMode}
            />
            <p className={styles.hint}>
              {mode === 1 ? (
                <>
                  <b>Trivial.</b> One cell per click.
                </>
              ) : guides.mirrors.length === 0 ? (
                <>
                  <b>C{guides.rotation?.order ?? mode} — rotations only.</b> No
                  mirror line, so none is drawn.
                </>
              ) : guides.rotation ?? guides.local[0] ? (
                <>
                  <b>
                    {glyphKind === "triangle" ? "D₃" : "D₆"} —{" "}
                    {guides.mirrors.length} mirrors and C
                    {(guides.rotation ?? guides.local[0]).order}.
                  </b>{" "}
                  A cell on a mirror is <i>pinned</i>; its orbit comes out short.
                </>
              ) : (
                <>
                  <b>One mirror — m_A</b>, the vertical median.
                </>
              )}
            </p>

            <div className={styles.subHead}>
              <span className={styles.subTitle}>band — a whole row</span>
              <span className={styles.sectionMeta}>
                {bandStat === null
                  ? "off"
                  : `${span} × ${bandStat.min}…${bandStat.max} cells`}
              </span>
            </div>
            <div className={styles.seg} role="group" aria-label="band family">
              <button
                type="button"
                className={styles.segBtn}
                aria-pressed={band === null}
                aria-label="band brush off — paint the orbit alone"
                onClick={() => pickBand(null)}
              >
                off
              </button>
              {BAND_FAMILIES.map((f) => (
                <button
                  key={f}
                  type="button"
                  className={styles.segBtn}
                  aria-pressed={band === f}
                  aria-label={`band family ${f} — ${BAND_NOTE[kind][f]}`}
                  onClick={() => pickBand(f)}
                >
                  {f}
                </button>
              ))}
            </div>
            <p className={styles.hint}>
              {band === null ? (
                <>
                  One cell deep, edge to edge, <b>carried by the brush</b> — and
                  each image row takes one hue of the scheme.
                </>
              ) : (
                <>
                  <b>{BAND_NOTE[kind][band]}.</b> The {mode}-fold brush carries it
                  to <b>{span}</b> {span === 1 ? "row" : "rows"}
                  {span < mode && (
                    <>
                      {" "}
                      — fewer than {mode}, because the row is <i>fixed</i> by part
                      of the subgroup
                    </>
                  )}
                  . Turn on <b>weld</b> below to close the seams inside a row.
                </>
              )}
            </p>

            {/* The tape belongs with the BRUSH, not with the palette: its
                length is `span` — how many orbit positions or image rows this
                brush actually has — and only its hues come from the scheme. Put
                under the band control, "6 rows → 6 hues" is legible at the
                moment the band is chosen rather than a column away. */}
            <div className={styles.subHead}>
              <span className={styles.subTitle}>
                {band === null ? "orbit colours" : "row colours"}
              </span>
              <span className={styles.sectionMeta}>
                {reach === null ? `k = 0…${span - 1}` : `reach ${reach}`}
              </span>
            </div>
            <div className={styles.tapeWrap}>
              <div className={styles.tape} aria-hidden="true">
                {tape.map((s, k) => (
                  <span
                    key={`${schemeName}-${span}-${k}-${s.hex}`}
                    className={styles.tapeCell}
                    style={{ background: s.hex, animationDelay: `${k * 45}ms` }}
                  >
                    <span className={styles.tapeIndex}>{k}</span>
                  </span>
                ))}
              </div>
            </div>
            <p className={styles.hint}>
              {scheme.offsets.length < span ? (
                <>
                  <b>{scheme.offsets.length}</b>{" "}
                  {scheme.offsets.length === 1 ? "hue" : "hues"} over{" "}
                  <b>{span}</b> positions — a {scheme.offsets.length}-fold colour
                  period in a {span}-fold shape.
                </>
              ) : band === null ? (
                <>Every position gets its own hue; a pinned cell takes fewer.</>
              ) : (
                <>
                  One hue per <b>row</b>, not per cell. Where two rows cross, the
                  cell keeps the <i>earlier</i> row&rsquo;s colour.
                </>
              )}
            </p>
          </section>

          <section className={styles.section}>
            <label className={styles.checkRow}>
              <input
                type="checkbox"
                checked={showGuides}
                onChange={(e) => setShowGuides(e.target.checked)}
              />
              symmetry axes of the active subgroup
            </label>
            <label className={styles.checkRow}>
              <input
                type="checkbox"
                checked={showTiling}
                onChange={(e) => setShowTiling(e.target.checked)}
              />
              show the tiling under the paint
            </label>
            <label className={styles.checkRow}>
              <input
                type="checkbox"
                checked={weld}
                onChange={(e) => setWeld(e.target.checked)}
              />
              weld painted cells — no seam inside a filled row
            </label>

            {/* Hexagon only. The six-point construction reads six corresponding
                cells off a C6 orbit, and a triangle has none — and the band-size
                height field is measurably flat there, two values at every depth,
                so there would be nothing to curve. */}
            {kind === "hexagon" && (
              <>
                <label className={styles.checkRow}>
                  <input
                    type="checkbox"
                    checked={reliefOn}
                    onChange={(e) => pickRelief(e.target.checked)}
                  />
                  relief — the ring under the pointer curves the plate
                </label>
                {reliefOn && (
                  <>
                    <div
                      className={`${styles.seg} ${styles.scopeSeg}`}
                      role="group"
                      aria-label="relief reading"
                    >
                      {READINGS.map((r) => (
                        <button
                          key={r}
                          type="button"
                          className={styles.segBtn}
                          aria-pressed={reading === r}
                          aria-label={`${r} — ${READING_LABEL[r]}`}
                          onClick={() => pickReading(r)}
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                    <p className={styles.hint}>
                      The six cells your brush corresponds to sit on one exact
                      lattice ring — <b>ring {ring}</b> of {3 * 2 ** depth}. That
                      ring is the <b>template</b>: it moves, and the whole plate
                      follows, six-fold symmetric in every frame because the
                      remap is a function of the ring alone. Height is the{" "}
                      <b>sum of a cell&rsquo;s three band sizes</b> — three
                      integers, one addition, <i>no division</i>. The one divide
                      in the whole effect is one per ring, at pixel emission.
                    </p>
                  </>
                )}
              </>
            )}
          </section>
          </div>

          <div className={styles.railCol}>
          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>Colour</h2>
              <span className={styles.sectionMeta}>
                {Math.round(effectiveBase.h)}°
              </span>
            </div>
            <ColourWell base={base} onChange={setBase} />

            <div className={styles.subHead}>
              <span className={styles.subTitle}>scheme</span>
              <span className={styles.sectionMeta}>
                {scheme.offsets.length} hue{scheme.offsets.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className={styles.schemeGrid} role="group" aria-label="colour scheme">
              {SCHEME_NAMES.map((name) => {
                const s = SCHEMES[name];
                return (
                  <button
                    key={name}
                    type="button"
                    className={styles.schemeBtn}
                    aria-pressed={schemeName === name}
                    aria-label={s.label}
                    onClick={() => setSchemeName(name)}
                  >
                    <span className={styles.schemeSwatches} aria-hidden="true">
                      {s.offsets.map((_, k) => (
                        <span
                          key={k}
                          className={styles.chip}
                          style={{
                            background: s.at(effectiveBase, k, s.offsets.length).hex,
                          }}
                        />
                      ))}
                    </span>
                    <span className={styles.schemeName}>{name}</span>
                  </button>
                );
              })}
            </div>

          </section>

          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>Progression</h2>
              <span className={styles.sectionMeta}>
                {progName === "off" ? "held" : `event ${driftIndex}`}
              </span>
            </div>
            <div className={styles.progList} role="group" aria-label="colour progression">
              {PROGRESSION_NAMES.map((name) => (
                <button
                  key={name}
                  type="button"
                  className={styles.progBtn}
                  aria-pressed={progName === name}
                  aria-label={activeProgression(name, scheme.offsets.length).label}
                  onClick={() => pickProgression(name)}
                >
                  {name}
                </button>
              ))}
            </div>
            <div className={styles.driftWrap}>
              <div className={styles.drift} aria-hidden="true">
                {upcoming.map((s, k) => (
                  <span
                    key={`${progName}-${driftIndex}-${k}`}
                    className={styles.driftCell}
                    style={{ background: s.hex, opacity: 1 - k * 0.12 }}
                  />
                ))}
              </div>
              <span className={styles.driftKey} aria-hidden="true">
                now → {DRIFT_AHEAD - 1} ahead
              </span>
            </div>
            <p className={styles.hint}>
              {progName === "off" ? (
                <>
                  The base holds still. Turn one on and the plate records the{" "}
                  <b>order</b> it was made in.
                </>
              ) : (
                <>
                  One <b>event</b> per application; the base is a pure function of
                  the count, so <b>undo restores the exact colours</b>.
                </>
              )}
            </p>
          </section>

          </div>

          <div className={styles.railFade} aria-hidden="true" />
        </aside>

        <div
          className={styles.plateCol}
          style={
            {
              "--d-aspect": String(canvas.geom.width / canvas.geom.height),
            } as React.CSSProperties
          }
        >
          <div className={styles.plate}>
            <div className={styles.plateRule} data-tool={tool}>
              <span className={styles.readout}>
                {/* The tool leads the status line, in its own colour. A brush
                    that destroys or transforms must never be a state the reader
                    has to infer from a control they are not looking at. */}
                <span className={styles.toolStatus}>{tool}</span>
                <span>
                  {kind} · d{depth} · <b>{total} cells</b>
                </span>
                <span>
                  brush <b>{mode}-fold</b>
                  {band !== null && (
                    <>
                      {" "}
                      · band <b>{band}</b>
                    </>
                  )}{" "}
                  ·{" "}
                  {reach === null ? (
                    <b>{dragMode === "propose" ? "drag to propose" : "hover to preview"}</b>
                  ) : (
                    <b>reach {reach}</b>
                  )}
                </span>
                <span>
                  {schemeName} · <b>{paint.size} painted</b>
                </span>
              </span>

              {/* The tool bench, IN the plate header rather than on a band of
                  its own beneath it. It was a separate strip and it cost 73px
                  of canvas height at 1512×950 — measured — while this row was
                  already wrapping and had the width to carry it for free. The
                  reasoning that put the tools here in the first place is
                  unchanged: they act on the ARTWORK, and the hand that has just
                  finished a stroke is already at the plate. */}
              <div className={styles.bench}>
                <div className={styles.benchGroup}>
                  <span className={styles.benchKey} id="tool-key">
                    tool
                  </span>
                  <div
                    className={`${styles.seg} ${styles.toolSeg}`}
                    role="group"
                    aria-labelledby="tool-key"
                  >
                    {TOOLS.map((t) => (
                      <button
                        key={t}
                        type="button"
                        className={`${styles.segBtn} ${styles.toolBtn}`}
                        aria-pressed={tool === t}
                        aria-label={`${t} tool — ${TOOL_LABEL[t]}`}
                        onClick={() => pickTool(t)}
                      >
                        <ToolGlyph tool={t} />
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                <div className={styles.benchGroup}>
                  <span className={styles.benchKey} id="drag-key">
                    drag
                  </span>
                  <div
                    className={`${styles.seg} ${styles.dragSeg}`}
                    role="group"
                    aria-labelledby="drag-key"
                  >
                    {(["paint", "propose"] as DragMode[]).map((d) => (
                      <button
                        key={d}
                        type="button"
                        className={styles.segBtn}
                        aria-pressed={dragMode === d}
                        aria-label={
                          d === "paint"
                            ? "drag lays colour continuously"
                            : "drag proposes a candidate; tap it to commit"
                        }
                        onClick={() => pickDragMode(d)}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </div>

              </div>

              <span className={styles.tools}>
                <button
                  type="button"
                  onClick={doUndo}
                  disabled={history.past.length === 0}
                  aria-label="undo the last gesture"
                >
                  undo
                </button>
                <button
                  type="button"
                  onClick={doRedo}
                  disabled={history.future.length === 0}
                  aria-label="redo the last undone gesture"
                >
                  redo
                </button>
                <button
                  type="button"
                  onClick={doClear}
                  disabled={paint.size === 0}
                  aria-label="clear the plate"
                >
                  clear
                </button>
                <button
                  type="button"
                  onClick={exportSvg}
                  disabled={paint.size === 0}
                  aria-label="export the artwork as SVG"
                >
                  svg
                </button>
                <button
                  type="button"
                  onClick={exportPng}
                  disabled={paint.size === 0}
                  aria-label="export the artwork as PNG"
                >
                  png
                </button>
                {/* Never disabled: loading is the one action that is always
                    available, including on an empty plate, which is the state
                    a person who has just arrived with a file is in. */}
                <button
                  type="button"
                  onClick={openPicker}
                  aria-label="load an SVG drawing back onto the plate — or drop one on the canvas"
                >
                  load
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".svg,image/svg+xml"
                  className={styles.fileInput}
                  onChange={onPicked}
                  tabIndex={-1}
                  aria-hidden="true"
                />
              </span>
            </div>

            {/* The adjustment palette keeps a strip of its own, because it is
                the one bench control that is a GRID and the one that is absent
                most of the time. Folding it into the header row would make the
                header jump by a row the moment the tool changed; here it opens
                below the rule it belongs under, and costs canvas height only
                while the adjust brush is actually in the hand. */}
            {tool === "adjust" && (
              <div className={styles.adjustBar}>
                <span className={styles.benchKey} id="adjust-key">
                  adjustment
                </span>
                <div
                  className={styles.adjustGrid}
                  role="group"
                  aria-labelledby="adjust-key"
                >
                  {ADJUST_NAMES.map((name) => (
                    <button
                      key={name}
                      type="button"
                      className={styles.adjustBtn}
                      aria-pressed={adjustName === name}
                      aria-label={ADJUSTMENTS[name].label}
                      onClick={() => setAdjustName(name)}
                    >
                      <span
                        className={styles.adjustChip}
                        aria-hidden="true"
                        style={{
                          background: ADJUSTMENTS[name].apply(effectiveBase).hex,
                        }}
                      />
                      {name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {loadError !== null && (
              <p className={styles.loadError} role="alert">
                <span>{loadError}</span>
                <button
                  type="button"
                  onClick={() => setLoadError(null)}
                  aria-label="dismiss the load error"
                >
                  dismiss
                </button>
              </p>
            )}

            <div
              className={styles.canvasHold}
              data-tool={tool}
              data-drop={dropping ? "on" : undefined}
              onDragEnter={onDragEnter}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDropFile}
            >
              <DrawBoard
                geom={canvas.geom}
                relief={relief}
                paint={paint}
                preview={preview}
                candidate={candidateSpec}
                cursor={cursor}
                guides={guides}
                showGuides={showGuides}
                showTiling={showTiling}
                weld={weld}
                dragBehaviour={dragMode}
                className={styles.canvas}
                candidateClass={styles.marching}
                label={`${kind} drawing canvas, depth ${depth}, ${total} cells, ${mode}-fold symmetry brush, ${tool} tool${
                  band === null ? "" : `, band ${band}`
                }. Arrow keys move the cursor, Enter or Space ${
                  dragMode === "propose" ? "proposes then commits" : "paints"
                }.`}
                onHover={onHover}
                onPaint={paintAt}
                onStrokeEnd={endStroke}
                onPropose={propose}
                onCommit={commitCandidate}
                onArrow={onArrow}
                onCursorPaint={onCursorPaint}
              />
              {tool !== "paint" && (
                <span className={styles.modeFlag} data-tool={tool} aria-hidden="true">
                  {tool}
                </span>
              )}
              {/* Commit rides ON the plate, opposite the tool flag.
                  It used to sit in the tool strip, and from there it was a
                  control that ARRIVED: a standing candidate pushed the strip to
                  a third line and moved the canvas 44px down — measured —
                  under the very finger that had just proposed. Floated over the
                  corner it costs no layout height at all, so nothing moves when
                  a proposal appears, and it is beside the ghost it acts on. */}
              {candidateSpec !== null && (
                <div className={styles.candidateBar}>
                  <span className={styles.benchKey}>candidate</span>
                  <div className={styles.commitRow}>
                    {/* Disabled at zero rather than hidden. An adjustment
                        candidate over bare tiling really would do nothing, and
                        a greyed COMMIT beside the dashed inert outlines says
                        that better than a button that shrugs. */}
                    <button
                      type="button"
                      className={styles.commitBtn}
                      onClick={commitCandidate}
                      disabled={candidateSpec.cells.length === 0}
                      aria-label={
                        candidateSpec.cells.length === 0
                          ? "nothing to commit — the brush would change no cell here"
                          : `commit the standing candidate — ${candidateSpec.cells.length} cells`
                      }
                    >
                      commit {candidateSpec.cells.length}
                    </button>
                    <button
                      type="button"
                      onClick={dropCandidate}
                      aria-label="drop the standing candidate"
                    >
                      drop
                    </button>
                  </div>
                </div>
              )}
              {paint.size === 0 && candidateSpec === null && !dropping && (
                <p className={styles.emptyHint}>
                  {dragMode === "propose"
                    ? "drag to propose — tap the ghost to commit"
                    : "click or drag to paint — every stroke is an orbit"}
                </p>
              )}
              {/* The drop target is a state of the plate, not a separate
                  surface: an overlay that appears only while a file is over it,
                  so the canvas never gains furniture it does not need. */}
              {dropping && (
                <p className={styles.dropNote} aria-hidden="true">
                  drop the SVG to load it
                </p>
              )}
            </div>

            <div className={styles.legend}>
              {legend.length === 0 ? (
                <span className={styles.legendItem}>
                  trivial subgroup · no axis, no rotation
                </span>
              ) : (
                legend.map((l) => (
                  <span key={l.key} className={styles.legendItem}>
                    {l.dot ? (
                      <span
                        className={styles.legendDot}
                        style={{ borderColor: l.colour }}
                        aria-hidden="true"
                      />
                    ) : (
                      <span
                        className={styles.legendSwatch}
                        style={{
                          borderTopColor: l.colour,
                          borderTopStyle: l.dashed ? "dashed" : "solid",
                        }}
                        aria-hidden="true"
                      />
                    )}
                    {l.label}
                  </span>
                ))
              )}
            </div>
          </div>

          <p className={styles.keys}>
            <b>⌘Z / Ctrl+Z</b> undoes a whole gesture, not a cell. Arrow keys move
            a cursor on the plate.{" "}
            {dragMode === "propose" ? (
              <>
                Drag moves a candidate; <b>tap it</b> or press <b>Enter</b> to
                commit it, <b>Esc</b> to drop it.
              </>
            ) : (
              <>
                Drag paints continuously; <b>Enter</b> or <b>Space</b> paints at the
                cursor.
              </>
            )}
          </p>

          <p className={styles.foot}>
            Orbits are computed in <code>src/lib/orbit.ts</code> by exact integer
            key lookup — no tolerance, no floating-point comparison decides which
            cells a stroke touches; bands in <code>src/lib/bands.ts</code> the
            same way, by floor-dividing an exact lattice key by three. On the
            hexagon <b>nothing is pinned by a rotation</b>, because no cell sits
            on the centre, so modes 2, 3 and 6 paint a full orbit everywhere;
            only mode 12 has short orbits, from the three spine mirrors. On the
            triangle the all-X hub is fixed by every isometry and is a singleton
            in every mode, and the r-th band from the apex holds exactly{" "}
            <b>2r+1</b> cells — checked when the figure is built. Hexagon bands
            are <b>not</b> uniform and each meets exactly three sectors. Changing
            the canvas or the depth changes which cells exist, so the plate is
            cleared rather than reinterpreted. An exported SVG carries the plate
            back with it, in a comment: canvas, depth, convention and the painted
            cells, so <b>load</b> is an exact restore rather than a reading of
            the picture. A file without that comment is matched shape by shape
            against this canvas instead, and the match rate is <i>reported</i>{" "}
            rather than assumed — see <code>src/lib/artfile.ts</code>.
          </p>
        </div>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {said}
      </p>
    </main>
  );
}
