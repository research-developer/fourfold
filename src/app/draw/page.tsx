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
  type ShapeTool,
  type ViewWindow,
} from "@/components/DrawBoard";
import { ADJUSTMENTS, ADJUST_NAMES, type AdjustName } from "@/lib/adjust";
import {
  ARMS,
  armCensus,
  armMask,
  clipStamp,
  type Isolation,
} from "@/lib/arms";
import {
  cellCount,
  extractArt,
  importByGeometry,
  MAX_ART_BYTES,
  MAX_DEPTH,
  MIN_DEPTH,
  payloadFromPaint,
} from "@/lib/artfile";
import {
  addressBook,
  applyPlateEdits,
  planPlateEdits,
  plateEntries,
  plateFromArtPayload,
  resolvePlate,
  type Address,
  type AddressPlate,
  type PlateEdit,
} from "@/lib/plate";
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
  clipToRegion,
  imageStamp,
  latticeView,
  lineCells,
  orbitStamp,
  ringCells,
  RING_DIRS,
  RING_KEY,
  type LatticeView,
  type Radial,
  type RingDir,
} from "@/lib/lattice";
import {
  presetColours,
  PRESETS,
  PRESET_NAMES,
  type PresetName,
} from "@/lib/presets";
import { SHORTCUTS } from "@/lib/shortcuts";
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
  artworkSvg,
  commit,
  EMPTY_HISTORY,
  exportName,
  mergeEdits,
  redo,
  undo,
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
 * How long an armed destructive button stays armed.
 *
 * Long enough to be a deliberate second click and short enough that a person
 * who walked away does not come back to a loaded gun. It is also the animation
 * duration of the countdown bar under the button, so the two cannot drift: the
 * bar is told this number.
 */
const CONFIRM_MS = 4000;

/** Zoom stops. Powers of two, so the plate lands on the same pixels each time. */
const ZOOM_MAX = 8;

/**
 * The seven schemes and the five brush slots, as the number row addresses them.
 *
 * `event.code` rather than `event.key`, because Shift+1 reports `!` on a US
 * layout, `"` on a UK one and `&` on AZERTY — the printed digit is not something
 * a shortcut can be keyed on once a modifier is involved. The physical key is.
 */
const DIGIT = ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7"];

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
   * The exact lattice: neighbour steps for the keyboard, and the two figures a
   * line and a ring are. Built alongside the others because it is a function of
   * the same figure and is invalidated at the same moment. See `lattice.ts`.
   */
  lattice: LatticeView;
  /**
   * The built figure itself, kept so a load can match a foreign file's polygons
   * against the cells' own vertices. `geom.cells` is the same geometry already
   * flattened for the board, but the importer's signature is stated in terms of
   * the figure, which is the thing that knows how it was numbered.
   */
  fig: Figure | Hexagon;
  /** The hexagon, when this is one. `null` on the triangle. */
  hex: Hexagon | null;
  /** The triangle, when this is one. `null` on the hexagon. */
  tri: Figure | null;
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
  /**
   * The triangle's answer to the hexagon's scope: one ftype ARM at a time.
   *
   * `null` is off. Only the triangle offers it — a hexagon sector already IS a
   * triangle, and stacking an arm inside a sector would be a control whose two
   * halves nobody can hold in mind at once.
   */
  const [isolation, setIsolation] = useState<Isolation>(null);
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

  /**
   * The drawing, keyed by ADDRESS and held at every depth it was painted at.
   *
   * This is the whole of the drawing's state. The index-keyed map the board
   * renders is derived from it below and is never stored, because an index only
   * means something next to the depth that issued it. See `plate.ts`.
   */
  const [plate, setPlate] = useState<AddressPlate>(new Map());
  const [history, setHistory] = useState<History<Address>>(EMPTY_HISTORY);
  const [events, setEvents] = useState<EventLog>(EMPTY_EVENTS);
  const [hover, setHover] = useState<number | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [showGuides, setShowGuides] = useState(true);
  const [showTiling, setShowTiling] = useState(true);
  const [weld, setWeld] = useState(false);
  const [announce, setAnnounce] = useState("");

  /**
   * The anchored tool, beside the paint/erase/adjust one rather than inside it.
   *
   * They are two different questions and folding them into one control would
   * have made six buttons for four ideas. `tool` says what colour a cell ends
   * up; `shape` says which cells. So LINE composes with ERASE — a straight
   * rubbing-out — for free, and neither control has to know the other exists.
   */
  const [shapeTool, setShapeTool] = useState<ShapeTool>("free");
  /** The anchored gesture in progress: where it started, where it is, and Alt. */
  const [shapeDrag, setShapeDrag] = useState<{
    anchor: number;
    at: number;
    alt: boolean;
  } | null>(null);

  /**
   * The one destructive control that is armed, or `null`.
   *
   * Confirm-in-place rather than a dialog: a modal would take the focus off the
   * canvas to ask a question the button could ask where it stands, and
   * `window.confirm` cannot be styled, cannot be dismissed by Escape in every
   * browser, and blocks the paint loop. The armed button REPLACES itself, so the
   * second click lands on the same pixels as the first — which is the property
   * that makes it a guard and not a lottery.
   */
  const [armed, setArmed] = useState<"new" | CanvasKind | null>(null);
  const disarmAt = useRef<number | null>(null);

  const [helpOpen, setHelpOpen] = useState(false);
  const helpClose = useRef<HTMLButtonElement>(null);
  const helpOpener = useRef<HTMLElement | null>(null);

  /**
   * The view: a zoom factor and a centre, both display-only.
   *
   * Space-to-pan was asked for, and on a board that always scaled its whole
   * figure to fit there was nothing to pan — the honest options were a no-op or
   * a zoom, and a no-op modifier is worse than no modifier. So the board gained
   * a `viewBox` window. Nothing in the model moves: the plate, the orbits, the
   * addresses and the exported file are identical at every zoom, and the hit
   * layer scales with everything else, so a click still lands where it looks.
   */
  const [zoom, setZoom] = useState(1);
  const [centre, setCentre] = useState<{ x: number; y: number } | null>(null);
  /** Space is down. A ref as well, because the key handler reads it. */
  const [spaceHeld, setSpaceHeld] = useState(false);
  const panned = useRef(false);
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

  const plateRef = useRef<AddressPlate>(new Map());
  const pending = useRef<PlateEdit[]>([]);
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
        lattice: latticeView(f),
        fig: f,
        hex: null,
        tri: f,
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
      lattice: latticeView(h),
      fig: h,
      hex: h,
      tri: null,
    };
  }, [kind, depth, convention, scope]);

  /**
   * The canvas's addresses, and the plate resolved onto them.
   *
   * `plate` is the state; `paint` is a VIEW of it at the depth on screen, which
   * is what the board draws, what the ghost is computed against and what the
   * export writes. Deriving it rather than storing it is the whole reason a
   * depth change no longer clears the drawing: there is nothing indexed by the
   * old numbering to throw away. `resolvePlate` is memoised on plate identity,
   * so this costs one lookup on a re-render that changed neither.
   */
  const book = useMemo(() => addressBook(canvas.fig), [canvas]);
  const paint = useMemo(() => resolvePlate(plate, book), [plate, book]);

  /**
   * The window the board draws, clamped so the figure never leaves the frame.
   *
   * `null` at zoom 1, which is the state the board has always been in, so the
   * common case emits exactly the `viewBox` it always did. The clamp is what
   * stops a pan from sliding the plate off the edge and leaving bare page: the
   * window's centre is held within the half-window inset of the figure, so the
   * figure always covers the frame.
   */
  const view = useMemo<ViewWindow | null>(() => {
    if (zoom <= 1) return null;
    const w = canvas.geom.width / zoom;
    const h = canvas.geom.height / zoom;
    const cx = centre?.x ?? canvas.geom.width / 2;
    const cy = centre?.y ?? canvas.geom.height / 2;
    const clamp = (v: number, half: number, whole: number) =>
      Math.min(Math.max(v, half), whole - half);
    return {
      x: clamp(cx, w / 2, canvas.geom.width) - w / 2,
      y: clamp(cy, h / 2, canvas.geom.height) - h / 2,
      w,
      h,
    };
  }, [zoom, centre, canvas]);

  /**
   * Which cells the brush may touch — the ISOLATE control, triangle only.
   *
   * The hexagon already has a scope; the triangle's answer is the three ftype
   * arms, which are a genuine partition of the board minus the hub rather than a
   * mask. See `arms.ts`, including why the hub is excluded and what clipping
   * costs the 3- and 6-fold brushes.
   */
  const keepCell = useMemo(
    () => (canvas.tri === null ? () => true : armMask(canvas.tri, isolation)),
    [canvas, isolation]
  );

  /** `(4^d − 1)/3` — the size §D predicts, read off the figure rather than retyped. */
  const armSize = useMemo(
    () => (canvas.tri === null ? 0 : armCensus(canvas.tri).predicted),
    [canvas]
  );

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
  const specFromStamp = useCallback(
    (stamp: ReturnType<typeof brushStamp>, seed: number): PreviewSpec => {
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
    // The plate is read from STATE here, not from `plateRef`: this runs during
    // render, and the adjust ghost is a function of the plate as rendered.
    [tool, scheme, effectiveBase, adjust, paint]
  );

  /** The free brush at a seed: one stamp, clipped to the isolated arm. */
  const specFor = useCallback(
    (seed: number | null): PreviewSpec | null => {
      if (seed === null || seed >= canvas.geom.cells.length) return null;
      // Clipped, so the ghost promises exactly what the stroke will lay. A
      // preview that reached outside the isolated arm would be teaching the
      // wrong brush.
      return specFromStamp(
        clipStamp(
          brushStamp(canvas.surface, canvas.bands, seed, shape),
          keepCell
        ),
        seed
      );
    },
    [canvas, shape, keepCell, specFromStamp]
  );

  /**
   * The anchored figure, as a brush stamp.
   *
   * Both tools reach the plate through the SAME stamp/colour/plan pipeline the
   * free brush uses, so a line honours the band setting, the isolated arm, the
   * sector scope, the eraser and the adjustment brush without any of them
   * learning that a line exists. What differs is only which cells the source is
   * and how the scheme is indexed over the images — see `lattice.ts`.
   */
  const shapeStampFor = useCallback(
    (anchor: number, at: number, alt: boolean) => {
      const n = canvas.geom.cells.length;
      if (anchor >= n || at >= n) return null;
      if (shapeTool === "line") {
        const line = lineCells(canvas.lattice, canvas.bands, anchor, at, alt);
        const src = clipToRegion(canvas.surface, anchor, line.cells).filter(
          keepCell
        );
        return {
          stamp: clipStamp(imageStamp(canvas.surface, mode, src), keepCell),
          said: `line · band ${line.family} · ${line.cells.length} cell${
            line.cells.length === 1 ? "" : "s"
          }${alt ? " · symmetric about the anchor" : ""}`,
        };
      }
      const spec = ringCells(
        canvas.lattice,
        canvas.lattice.ringOf(anchor),
        canvas.lattice.ringOf(at),
        alt
      );
      const src = clipToRegion(canvas.surface, anchor, spec.cells).filter(
        keepCell
      );
      return {
        // Orbit position, not image index: a figure-centred ring is fixed by the
        // whole group, so grouping by image would collapse it onto one hue.
        stamp: clipStamp(orbitStamp(canvas.surface, mode, src), keepCell),
        said: `ring ${spec.from}${spec.to === spec.from ? "" : `…${spec.to}`} · ${
          spec.cells.length
        } cell${spec.cells.length === 1 ? "" : "s"}${
          spec.clipped ? " · clipped by the triangle's edges" : ""
        }${alt ? " · symmetric about the anchor ring" : ""}`,
      };
    },
    [canvas, shapeTool, mode, keepCell]
  );

  const dragSpec = useMemo(() => {
    if (shapeDrag === null) return null;
    const built = shapeStampFor(shapeDrag.anchor, shapeDrag.at, shapeDrag.alt);
    if (built === null) return null;
    return {
      spec: specFromStamp(built.stamp, shapeDrag.anchor),
      said: built.said,
    };
  }, [shapeDrag, shapeStampFor, specFromStamp]);

  const candidateSpec = useMemo(
    () =>
      shapeTool === "free" && dragMode === "propose" ? specFor(candidate) : null,
    [shapeTool, dragMode, specFor, candidate]
  );

  // A hover ghost and a standing proposal at once is two answers to one
  // question. The proposal wins: it is the one that can be committed. An
  // anchored drag outranks both — it is the thing under the finger.
  const preview = useMemo(
    () =>
      dragSpec !== null
        ? dragSpec.spec
        : candidateSpec === null && shapeTool === "free"
        ? specFor(hover)
        : null,
    [dragSpec, candidateSpec, shapeTool, specFor, hover]
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
   *
   * A DEPTH CHANGE is no longer one of those moments, and that is the point of
   * the address plate: the cells did not change underneath anybody, they were
   * only cut finer or coarser, and every stroke in the history still names the
   * addresses it named. See `pickDepth`.
   */
  const reset = useCallback((next: AddressPlate, why: string) => {
    plateRef.current = next;
    pending.current = [];
    pendingEvents.current = 0;
    setLiveEvents(0);
    setPlate(plateRef.current);
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

  /**
   * Arm a destructive control, and disarm it again after a few seconds.
   *
   * The timer is what makes confirm-in-place safe to leave lying around: an
   * armed NEW that stayed armed would be a landmine under the pointer for the
   * rest of the session. Escape and a blur disarm it too, so the three ways a
   * person abandons an action all work.
   */
  const arm = useCallback((what: "new" | CanvasKind, said: string) => {
    if (disarmAt.current !== null) window.clearTimeout(disarmAt.current);
    setArmed(what);
    disarmAt.current = window.setTimeout(() => {
      setArmed(null);
      disarmAt.current = null;
      // The timeout SAYS so. A live region still reading "armed" after the
      // button had quietly gone back to normal was the one state in this guard
      // where the screen and the announcement disagreed.
      setAnnounce("the confirm expired — nothing was cleared");
    }, CONFIRM_MS);
    setAnnounce(said);
  }, []);

  const disarm = useCallback((why?: string) => {
    if (disarmAt.current !== null) {
      window.clearTimeout(disarmAt.current);
      disarmAt.current = null;
    }
    setArmed((a) => {
      if (a !== null && why !== undefined) setAnnounce(why);
      return null;
    });
  }, []);

  useEffect(
    () => () => {
      if (disarmAt.current !== null) window.clearTimeout(disarmAt.current);
    },
    []
  );

  /**
   * NEW: the one control that wipes, and the only one.
   *
   * CLEAR used to sit beside undo and redo and did most of this, undoably. It
   * has gone, and the reason is the one the user gave: a plate can be destroyed
   * by exactly one button, that button is coloured like a warning, and it asks
   * twice. Two controls that both empty the plate — one undoable, one not — is
   * two answers to "how do I start again", and the safer one was the one nobody
   * could tell apart from the other.
   */
  const doNew = () => {
    if (armed !== "new") {
      arm(
        "new",
        `NEW is armed — click it again to wipe ${
          plateRef.current.size
        } painted address${
          plateRef.current.size === 1 ? "" : "es"
        } and the whole undo history, or press Escape`
      );
      return;
    }
    disarm();
    wipe("new plate — every address cleared, and the undo history with it");
  };

  /**
   * The canvas still clears, and the depth no longer does.
   *
   * The difference is what the address space IS. A depth change refines or
   * coarsens the same words, so every address a stroke named is still an
   * address. A canvas change swaps the alphabet — the hexagon's addresses carry
   * a sector tag and the triangle's do not — so nothing painted on one names
   * anything on the other, and carrying the plate across would be inventing a
   * correspondence the geometry does not have.
   *
   * So it stays destructive, and it goes behind the SAME guard as NEW: on a
   * plate with paint on it the shape button arms first and switches second. On
   * an empty plate there is nothing to lose and it switches immediately, because
   * a guard that fires when there is no risk teaches people to click through
   * guards.
   */
  const pickKind = (next: CanvasKind) => {
    if (next === kind) return;
    if (plateRef.current.size > 0 && armed !== next) {
      arm(
        next,
        `switching to the ${next} would clear ${plateRef.current.size} painted address${
          plateRef.current.size === 1 ? "" : "es"
        } — the two canvases do not share addresses. Click again to confirm, or press Escape`
      );
      return;
    }
    disarm();
    const d = Math.min(depth, Math.max(...DEPTHS[next]));
    const m = next === "triangle" && mode === 12 ? 6 : mode;
    setKind(next);
    setDepth(d);
    setMode(m);
    setZoom(1);
    setCentre(null);
    // An arm is a triangle object; the hexagon has scopes instead.
    if (next !== "triangle") setIsolation(null);
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

  const pickRelief = useCallback(
    (on: boolean) => {
      setReliefOn(on);
      setAnnounce(
        on
          ? `relief on — ${READING_LABEL[reading]}; the ring under the pointer is the template`
          : "relief off — the plate is flat again"
      );
    },
    [reading]
  );

  const pickReading = useCallback(
    (next: Reading) => {
      if (next === reading) return;
      setReading(next);
      setAnnounce(`relief ${next} — ${READING_LABEL[next]}`);
    },
    [reading]
  );

  /**
   * Changing the depth KEEPS the drawing, and keeps the undo stack with it.
   *
   * It used to clear both, and the reason was sound while the plate was keyed by
   * cell index: index 4 is a different triangle at every depth, so both the paint
   * and the history were statements about a numbering that had just stopped
   * existing. Keyed by address neither is. Going deeper, a cell with no paint of
   * its own inherits its nearest painted ancestor exactly; going shallower, a
   * parent shows what its painted descendants agree on and shows nothing where
   * they disagree — and the deeper addresses stay in the plate either way, so
   * coming back restores it cell for cell.
   *
   * The depth change is NOT an undoable event and is deliberately outside the
   * history. Undo takes back a change to the DRAWING, and this changes none: the
   * plate is the same object before and after, and there is nothing to put back.
   * Making it a rung would mean the undo stack held two kinds of thing, and a
   * user pressing undo after a stroke would get their zoom level back instead of
   * their paint. The cursor and any standing candidate are dropped, because those
   * really are indices into the numbering that just changed.
   */
  const pickDepth = useCallback(
    (d: number) => {
      if (d === depth) return;
      setDepth(d);
      setHover(null);
      setCursor(null);
      setCandidate(null);
      setShapeDrag(null);
      setAnnounce(
        `depth ${d}, ${cellCount(kind, d)} cells — plate carried across, ${
          plateRef.current.size
        } address${plateRef.current.size === 1 ? "" : "es"} held`
      );
    },
    [depth, kind]
  );

  const pickIsolation = (next: Isolation) => {
    if (next === isolation) return;
    setIsolation(next);
    setCandidate(null);
    setAnnounce(
      next === null
        ? "isolation off — the whole triangle"
        : `isolated to arm ${next} — the ftype-${next} triskelion arm, ${armSize} cells; the hub belongs to no arm and is out of reach`
    );
  };

  // ── painting ────────────────────────────────────────────────────────────

  const paintAt = useCallback(
    (i: number) => {
      const stamp = clipStamp(
        brushStamp(canvas.surface, canvas.bands, i, shape),
        keepCell
      );
      if (stamp.cells.length === 0) return;
      // Recomputed per application rather than taken from `effectiveBase`, so a
      // drag lays a gradient along its own path instead of one flat colour.
      const n = progressionIndex(events, progOrigin, pendingEvents.current);
      // The colours are decided against the plate AS SHOWN — the adjustment
      // brush transforms the colour a cell is displaying, including one it is
      // displaying because an ancestor holds it. Memoised on plate identity, so
      // this is a lookup on every application after the first.
      const view = resolvePlate(plateRef.current, book);
      const colours = stampColours(
        { tool, scheme, base: prog.at(base, n), adjust },
        view,
        stamp
      );
      const edits = planPlateEdits(
        plateRef.current,
        book,
        stamp.cells.map((c) => book.addr[c]),
        colours
      );
      if (edits.length === 0) return;
      if (tool === "paint") {
        pendingEvents.current += 1;
        setLiveEvents(pendingEvents.current);
      }
      plateRef.current = applyPlateEdits(plateRef.current, edits, "do");
      pending.current = mergeEdits(pending.current, edits);
      setPlate(plateRef.current);
    },
    [canvas, book, keepCell, shape, tool, scheme, adjust, prog, base, events, progOrigin]
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
        } with the ${mode}-fold brush${band === null ? "" : `, band ${band}`}${
          isolation === null ? "" : `, arm ${isolation}`
        } — ${resolvePlate(plateRef.current, book).size} on the plate`
      );
    },
    [tool, adjustName, mode, band, isolation, book]
  );

  const applyStroke = useCallback(
    (edits: readonly PlateEdit[], direction: "do" | "undo", said: string) => {
      plateRef.current = applyPlateEdits(plateRef.current, edits, direction);
      setPlate(plateRef.current);
      setAnnounce(
        `${said} — ${resolvePlate(plateRef.current, book).size} cells on the plate`
      );
    },
    [book]
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

  /**
   * Lay a whole plate down as ONE gesture.
   *
   * Both the presets and the anchored tools arrive here. Nothing about it is
   * special: the edits are planned against the address plate exactly as a brush
   * stroke's are, so a preset survives a depth change, an undo takes the whole
   * figure back in one press, and the event log gains the rung that keeps it
   * shadowing the history.
   */
  const layStroke = useCallback(
    (
      cells: readonly number[],
      colours: readonly (string | null)[],
      spent: number,
      said: (n: number) => string,
      nothing: string
    ) => {
      const edits = planPlateEdits(
        plateRef.current,
        book,
        cells.map((c) => book.addr[c]),
        colours
      );
      if (edits.length === 0) {
        setAnnounce(nothing);
        return;
      }
      plateRef.current = applyPlateEdits(plateRef.current, edits, "do");
      setPlate(plateRef.current);
      setHistory((h) => commit(h, { edits }));
      setEvents((e) => pushEvents(e, spent));
      setAnnounce(said(edits.length));
    },
    [book]
  );

  /**
   * The anchored figure, committed.
   *
   * One application, so ONE colouring event — a line is a gesture, not a run of
   * them, and undoing it must take the progression back by exactly one step.
   */
  const commitShape = useCallback(() => {
    const d = shapeDrag;
    setShapeDrag(null);
    if (d === null) return;
    const built = shapeStampFor(d.anchor, d.at, d.alt);
    if (built === null || built.stamp.cells.length === 0) {
      setAnnounce("nothing changed — the figure reached no cell the brush may touch");
      return;
    }
    const n = progressionIndex(events, progOrigin, 0);
    const shown = resolvePlate(plateRef.current, book);
    const colours = stampColours(
      { tool, scheme, base: prog.at(base, n), adjust },
      shown,
      built.stamp
    );
    const verb =
      tool === "erase" ? "erased" : tool === "adjust" ? adjustName : "painted";
    layStroke(
      built.stamp.cells,
      colours,
      tool === "paint" ? 1 : 0,
      (k) =>
        `${built.said} — ${k} cell${k === 1 ? "" : "s"} ${verb} with the ${mode}-fold brush`,
      tool === "adjust"
        ? "nothing adjusted — the figure found no paint under it"
        : "nothing changed"
    );
  }, [
    shapeDrag,
    shapeStampFor,
    events,
    progOrigin,
    book,
    tool,
    scheme,
    prog,
    base,
    adjust,
    adjustName,
    mode,
    layStroke,
  ]);

  /**
   * A preset: the figure's own structure, laid down as one undoable stroke.
   *
   * Every address of the current depth is named, so the preset REPLACES whatever
   * was there rather than sitting on top of it — and because it goes through the
   * address plate, changing the depth afterwards refines or summarises it exactly
   * like any other paint. See `presets.ts` for where each colour comes from.
   */
  const applyPreset = useCallback(
    (name: PresetName) => {
      const colours = presetColours(name, canvas.fig, effectiveBase.hex);
      layStroke(
        colours.map((_, i) => i),
        colours,
        0,
        (k) =>
          `${PRESETS[name].label} — ${PRESETS[name].note}; ${k} cell${
            k === 1 ? "" : "s"
          } changed, one undoable stroke`,
        `${PRESETS[name].label} — the plate already shows it`
      );
    },
    [canvas, effectiveBase, layStroke]
  );

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

  const pickTool = useCallback(
    (next: Tool) => {
      if (next === tool) return;
      setTool(next);
      setAnnounce(`${next} tool — ${TOOL_LABEL[next]}`);
    },
    [tool]
  );

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
  const pickBand = useCallback(
    (next: BandFamily | null) => {
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
    },
    [band, kind, canvas, mode]
  );

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

  /** Where the cursor is, put somewhere, with the ghost following it. */
  const putCursor = useCallback(
    (next: number, said: string | null) => {
      noteSector(next);
      setCursor(next);
      // A standing anchored figure follows the cursor, so the whole line/ring
      // gesture is reachable from the keyboard: Enter anchors, the cluster
      // stretches, Enter lays it.
      setShapeDrag((d) => (d === null ? null : { ...d, at: next }));
      if (shapeTool === "free" && dragMode === "propose") setCandidate(next);
      else setHover(next);
      if (said !== null) setAnnounce(said);
    },
    [dragMode, noteSector, shapeTool]
  );

  const onArrow = useCallback(
    (dir: Direction) => {
      const next = stepCursor(canvas.centroids, cursor, dir);
      if (next < 0) return;
      putCursor(next, null);
    },
    [canvas, cursor, putCursor]
  );

  /** Where the cursor sits, in the words the canvas has for it. */
  const placeOf = useCallback(
    (i: number) =>
      canvas.kind === "triangle"
        ? `row ${canvas.lattice.rowOf(i)} from the apex, ring ${canvas.lattice.ringOf(i)}`
        : `sector ${canvas.hex?.cells[i].sector ?? 0}, ring ${canvas.lattice.ringOf(i)}`,
    [canvas]
  );

  /**
   * One step on the exact lattice, in one of the six directions the cluster
   * names. Off the canvas is SAID rather than wrapped: a cursor that reappears
   * on the far side has told the user something false about the figure.
   */
  const onRing = useCallback(
    (dir: RingDir) => {
      if (cursor === null) {
        const start = stepCursor(canvas.centroids, null, "up");
        if (start < 0) return;
        putCursor(start, `cursor at cell ${start} — ${placeOf(start)}`);
        return;
      }
      const next = canvas.lattice.step(cursor, dir);
      if (next < 0) {
        setAnnounce(`${dir} — the canvas ends here; the cursor did not move`);
        return;
      }
      putCursor(next, `${dir} — cell ${next}, ${placeOf(next)}`);
    },
    [canvas, cursor, putCursor, placeOf]
  );

  const onRadial = useCallback(
    (way: Radial) => {
      if (cursor === null) {
        const start = stepCursor(canvas.centroids, null, "up");
        if (start < 0) return;
        putCursor(start, `cursor at cell ${start} — ${placeOf(start)}`);
        return;
      }
      const next = canvas.lattice.radial(cursor, way);
      if (next < 0) {
        setAnnounce(
          `${way === "out" ? "outward" : "inward"} — the ${
            canvas.kind === "triangle"
              ? way === "out"
                ? "base"
                : "apex"
              : way === "out"
              ? "rim"
              : "centre"
          } is here; the cursor did not move`
        );
        return;
      }
      putCursor(
        next,
        `${way === "out" ? "outward" : "inward"} — cell ${next}, ${placeOf(next)}`
      );
    },
    [canvas, cursor, putCursor, placeOf]
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
    if (shapeTool !== "free") {
      if (shapeDrag === null) {
        setShapeDrag({ anchor: cursor, at: cursor, alt: false });
        setAnnounce(
          `${shapeTool} anchored at cell ${cursor} — move with Q W E A D Z X C and press Enter again to lay it, Escape to cancel`
        );
        return;
      }
      commitShape();
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
    shapeTool,
    shapeDrag,
    commitShape,
  ]);

  const pickShapeTool = useCallback(
    (next: ShapeTool) => {
      setShapeTool(next);
      setShapeDrag(null);
      setCandidate(null);
      setAnnounce(
        next === "free"
          ? "free brush — every cell the pointer crosses is an application"
          : next === "line"
          ? "line — press, drag along a lattice row and release; the row snaps to one of the three band families, and Option centres it on the anchor"
          : `ring — press, drag outward and release; the ring is a level set of the exact hexagonal norm about the ${
              kind === "triangle" ? "centroid, clipped by the three edges" : "centre"
            }, and Option centres the annulus on the anchor`
      );
    },
    [kind]
  );

  const openHelp = useCallback(() => {
    helpOpener.current = document.activeElement as HTMLElement | null;
    setHelpOpen(true);
  }, []);

  const closeHelp = useCallback(() => {
    setHelpOpen(false);
    // Focus goes back where it came from, or the panel has stranded the
    // keyboard at the top of the document.
    helpOpener.current?.focus?.();
  }, []);

  useEffect(() => {
    if (helpOpen) helpClose.current?.focus();
  }, [helpOpen]);

  const setZoomTo = useCallback(
    (z: number) => {
      const next = Math.min(ZOOM_MAX, Math.max(1, z));
      setZoom(next);
      if (next === 1) setCentre(null);
      setAnnounce(
        next === 1
          ? "zoom 1× — the whole figure"
          : `zoom ${next}× — hold Space and drag to pan`
      );
    },
    []
  );

  /**
   * A pan, in canvas units. The clamp lives in the `view` memo, so a drag that
   * pushes past the rim simply stops rather than being refused mid-gesture.
   */
  const onPan = useCallback(
    (dx: number, dy: number) => {
      panned.current = true;
      setCentre((c) => ({
        x: (c?.x ?? canvas.geom.width / 2) - dx,
        y: (c?.y ?? canvas.geom.height / 2) - dy,
      }));
    },
    [canvas]
  );

  /**
   * Every shortcut, in one listener on the window.
   *
   * On the window rather than on the canvas, so a shortcut works while the hand
   * is on a rail control — which is where it is most of the time. The arrows and
   * Enter stay on the board, because those are about the CURSOR and the board is
   * the thing that owns a cursor; putting them here as well would fire them
   * twice when the canvas has focus.
   *
   * Three guards, and each one is a bug that was reachable without it: a text
   * field swallows everything, because the hex input has to be typeable; a
   * focused button keeps Space and Enter, because that is how a button is
   * pressed without a mouse; and the help panel swallows everything but its own
   * two keys, because a panel that is over the plate must not let the plate be
   * edited underneath it.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable)
      ) {
        return;
      }
      const onControl =
        el instanceof HTMLButtonElement ||
        el instanceof HTMLAnchorElement ||
        el instanceof HTMLSelectElement;
      if (onControl && (e.key === " " || e.key === "Enter")) return;

      if (e.key === "Escape") {
        if (helpOpen) {
          closeHelp();
          return;
        }
        if (armed !== null) {
          disarm("cancelled — nothing was cleared");
          return;
        }
        if (shapeDrag !== null) {
          setShapeDrag(null);
          setAnnounce(`${shapeTool} cancelled`);
          return;
        }
        dropCandidate();
        return;
      }

      if (e.metaKey || e.ctrlKey) {
        if (e.key.toLowerCase() === "z") {
          e.preventDefault();
          if (e.shiftKey) doRedo();
          else doUndo();
        }
        return;
      }
      // Option is the shape modifier, read off the pointer event. It is never a
      // shortcut prefix, so a stray Alt must not fire a letter.
      if (e.altKey) return;

      // `?` is Shift and the slash key on a US layout, and browsers disagree
      // about whether the shifted `key` arrives as `?` or as `/` — Playwright's
      // synthetic Shift+/ reports `/`, a real keyboard reports `?`. Accepting
      // both, and the physical key as well, is what makes this reachable
      // everywhere rather than only where it happened to be tested.
      if (e.key === "?" || (e.shiftKey && e.code === "Slash")) {
        e.preventDefault();
        if (helpOpen) closeHelp();
        else openHelp();
        return;
      }
      if (helpOpen) return;

      if (e.key === " ") {
        e.preventDefault();
        if (e.repeat) return;
        panned.current = false;
        setSpaceHeld(true);
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        onCursorPaint();
        return;
      }

      const digit = DIGIT.indexOf(e.code);

      if (e.shiftKey) {
        if (digit >= 0 && digit < SCHEME_NAMES.length) {
          e.preventDefault();
          const name = SCHEME_NAMES[digit];
          setSchemeName(name);
          setAnnounce(`scheme ${name} — ${SCHEMES[name].label}`);
        } else if (e.key.toLowerCase() === "r") {
          e.preventDefault();
          if (canvas.hex === null) {
            setAnnounce("the relief is a hexagon effect; this canvas is flat");
          } else {
            pickReading(reading === "convex" ? "concave" : "convex");
          }
        }
        return;
      }

      if (digit >= 0) {
        if (digit < modes.length) {
          e.preventDefault();
          setMode(modes[digit]);
          setAnnounce(`brush ${modes[digit]}-fold`);
        } else {
          setAnnounce(`this canvas has ${modes.length} brush modes`);
        }
        return;
      }

      const k = e.key.toLowerCase();

      for (const dir of RING_DIRS) {
        if (k === RING_KEY[dir]) {
          e.preventDefault();
          onRing(dir);
          return;
        }
      }
      if (k === "w" || k === "x") {
        e.preventDefault();
        onRadial(k === "w" ? "out" : "in");
        return;
      }

      if (k === "b") {
        const order: (BandFamily | null)[] = [null, "A", "B", "C"];
        pickBand(order[(order.indexOf(band) + 1) % order.length]);
        return;
      }
      if (k === "t") {
        pickTool(TOOLS[(TOOLS.indexOf(tool) + 1) % TOOLS.length]);
        return;
      }
      if (k === "f") {
        const order: ShapeTool[] = ["free", "line", "ring"];
        pickShapeTool(order[(order.indexOf(shapeTool) + 1) % order.length]);
        return;
      }
      if (k === "g") {
        setShowGuides((v) => {
          setAnnounce(v ? "symmetry axes off" : "symmetry axes on");
          return !v;
        });
        return;
      }
      if (k === "h") {
        setShowTiling((v) => {
          setAnnounce(v ? "tiling hidden" : "tiling shown under the paint");
          return !v;
        });
        return;
      }
      if (k === "l") {
        setWeld((v) => {
          setAnnounce(v ? "weld off — every cell keeps its seam" : "weld on — no seam inside a filled row");
          return !v;
        });
        return;
      }
      if (k === "r") {
        if (canvas.hex === null) {
          setAnnounce("the relief is a hexagon effect; this canvas is flat");
          return;
        }
        pickRelief(!reliefOn);
        return;
      }
      if (e.key === "[") {
        const d = DEPTHS[kind];
        if (depth <= d[0]) setAnnounce(`depth ${depth} is the shallowest`);
        else pickDepth(depth - 1);
        return;
      }
      if (e.key === "]") {
        const d = DEPTHS[kind];
        if (depth >= d[d.length - 1]) setAnnounce(`depth ${depth} is the deepest`);
        else pickDepth(depth + 1);
        return;
      }
      if (e.key === "+" || e.key === "=") {
        setZoomTo(zoom * 2);
        return;
      }
      if (e.key === "-" || e.key === "_") {
        setZoomTo(zoom / 2);
        return;
      }
      if (e.key === "0") setZoomTo(1);
    };

    /**
     * Space, on the way UP.
     *
     * The brief asked for Space to paint at the cursor AND to be hold-to-pan,
     * and those cannot both happen on the way down. They can both happen if the
     * key paints on RELEASE and only when the pan never started, which is what a
     * hold-to-pan modifier means anyway: tap it and nothing was dragged, so the
     * tap was the paint. Nothing was given up.
     */
    const onUp = (e: KeyboardEvent) => {
      if (e.key !== " ") return;
      const el = document.activeElement;
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLButtonElement ||
        el instanceof HTMLAnchorElement
      ) {
        setSpaceHeld(false);
        return;
      }
      setSpaceHeld(false);
      if (helpOpen) return;
      if (!panned.current) onCursorPaint();
      panned.current = false;
    };

    // A window that loses focus mid-hold would keep Space down forever.
    const onBlur = () => setSpaceHeld(false);

    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [
    doUndo,
    doRedo,
    dropCandidate,
    helpOpen,
    closeHelp,
    openHelp,
    armed,
    disarm,
    shapeDrag,
    shapeTool,
    pickShapeTool,
    modes,
    canvas,
    reading,
    reliefOn,
    band,
    tool,
    kind,
    depth,
    zoom,
    setZoomTo,
    onRing,
    onRadial,
    onCursorPaint,
    pickBand,
    pickTool,
    pickRelief,
    pickReading,
    pickDepth,
  ]);

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
      // The polygons are the plate AS SHOWN, at this depth; the payload below
      // carries the addresses so a load gets back the depths this view cannot
      // draw. A viewer that only looks at the picture sees exactly the screen.
      paint: resolvePlate(plateRef.current, book),
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
        resolvePlate(plateRef.current, book),
        baked === null ? undefined : { on: true, reading },
        // `undefined` — so the field is omitted and the bytes are unchanged —
        // whenever every painted address is at the exported depth, which is
        // every drawing that never left the depth it was started at.
        plateEntries(plateRef.current, book)
      ),
      overlay,
    });
  }, [
    canvas,
    book,
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
        // The file's OWN canvas, not the one on screen: the addresses in the
        // payload are words of the depth it declares, and the book that turns
        // its `cells` indices into addresses has to be that canvas's book.
        const loaded = plateFromArtPayload(
          payload,
          addressBook(
            payload.canvas === "triangle"
              ? buildFigure(payload.depth, payload.convention)
              : buildHexagon(payload.depth, payload.convention)
          )
        );
        reset(
          loaded,
          `loaded ${loaded.size} cell${loaded.size === 1 ? "" : "s"} — ${
            payload.canvas
          }, depth ${payload.depth}, ${payload.convention}${
            payload.plate === undefined ? "" : ", addressed"
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
      // Matched against the canvas AS IT STANDS, so the addresses are this
      // depth's addresses. A foreign file has no depths but this one.
      const imported = new Map<Address, string>();
      for (const [i, s] of got.matched) imported.set(book.addr[i], s.hex);
      reset(
        imported,
        `imported ${got.matched.size} of ${got.total} cells — this file was not made here${
          got.unmatched === 0 ? "" : `, ${got.unmatched} shapes matched no cell`
        }`
      );
    },
    [refuse, reset, canvas, book, kind, mode]
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
    dragSpec !== null
      ? `${dragSpec.said} — release to lay it, Escape to cancel`
      : candidateSpec === null
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
                  className={`${styles.segBtn} ${
                    armed === k ? styles.armedBtn : ""
                  }`}
                  aria-pressed={kind === k}
                  aria-label={
                    armed === k
                      ? `confirm — switching to the ${k} clears the plate`
                      : `canvas ${k}${
                          kind === k || paint.size === 0
                            ? ""
                            : " — this clears the plate, and asks first"
                        }`
                  }
                  onClick={() => pickKind(k)}
                  onBlur={() => {
                    if (armed === k) disarm();
                  }}
                >
                  {armed === k ? "sure?" : k}
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
                {kind === "triangle"
                  ? isolation === null
                    ? "D₃ subgroups"
                    : `arm ${isolation} · ⟨m_${isolation}⟩`
                  : scope === "hexagon"
                  ? "D₆ subgroups"
                  : scope === "sector"
                  ? `sector ${sector} · D₃`
                  : "C₆ × D₃"}
              </span>
            </div>
            {/* The triangle's answer to the hexagon's SCOPE. Placed in the same
                slot as the scope segment, because it is the same question — which
                part of the plate is the brush allowed to reach — asked of a
                figure whose parts are not sectors. */}
            {kind === "triangle" && (
              <>
                <div
                  className={`${styles.seg} ${styles.scopeSeg}`}
                  role="group"
                  aria-label="isolate one ftype arm"
                >
                  <button
                    type="button"
                    className={styles.segBtn}
                    aria-pressed={isolation === null}
                    aria-label="isolation off — paint the whole triangle"
                    onClick={() => pickIsolation(null)}
                  >
                    off
                  </button>
                  {ARMS.map((a) => (
                    <button
                      key={a}
                      type="button"
                      className={styles.segBtn}
                      aria-pressed={isolation === a}
                      aria-label={`isolate arm ${a} — the ftype-${a} arm, one third of the board`}
                      onClick={() => pickIsolation(a)}
                    >
                      {a}
                    </button>
                  ))}
                </div>
                <p className={styles.hint}>
                  {isolation === null ? (
                    <>
                      <b>Isolate one arm.</b> The three <i>ftype</i> arms{" "}
                      <code>S_D = {"{ Xʲ D u }"}</code> are congruent, tile the
                      board minus the hub, and the rotation permutes them
                      cyclically — a genuine partition, not a mask.
                    </>
                  ) : (
                    <>
                      <b>
                        Arm {isolation} — {armSize} cells
                      </b>{" "}
                      of {total}, (4<sup>d</sup>−1)/3. The hub <code>Xᵈ</code> is
                      in <i>no</i> arm and is out of reach until this is off. Only{" "}
                      <b>m_{isolation}</b> fixes the arm, so a clipped 3-fold brush
                      paints one cell and a 6-fold brush two — the induced action,
                      not a broken one.
                    </>
                  )}
                </p>
              </>
            )}
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

          {/* The figure's own structure, offered as a drawing. Every colour here
              is read out of `palette.ts` at a charge the model computed; nothing
              is placed by hand. Applying one is an ordinary stroke, so undo takes
              it back in one press and a depth change carries it across. */}
          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>Presets</h2>
              <span className={styles.sectionMeta}>{total} cells</span>
            </div>
            <div className={styles.presetGrid} role="group" aria-label="preset plates">
              {PRESET_NAMES.map((name) => (
                <button
                  key={name}
                  type="button"
                  className={styles.presetBtn}
                  aria-label={`${PRESETS[name].label} — ${PRESETS[name].note}`}
                  onClick={() => applyPreset(name)}
                >
                  {PRESETS[name].label}
                </button>
              ))}
            </div>
            <p className={styles.hint}>
              <b>V₄ apex</b> and <b>V₄ ifs</b> are the same tiling under the two
              conventions — identical at depth 1, and different from depth 2, where
              the recursion starts handing the four children out in a different
              order. <b>Coset</b> collapses the four charges onto the H /
              not-H partition. <b>Gasket</b> paints the{" "}
              <code>
                {kind === "hexagon" ? "6·" : ""}3<sup>{depth}</sup>
              </code>{" "}
              addresses with <i>no X</i> in the colour you are holding, and leaves
              the other {total - (kind === "hexagon" ? 6 : 1) * 3 ** depth} bare.
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

                {/* WHICH cells, beside WHAT colour. Two questions, two
                    controls: LINE composes with ERASE without either of them
                    knowing the other exists. */}
                <div className={styles.benchGroup}>
                  <span className={styles.benchKey} id="shape-key">
                    shape
                  </span>
                  <div
                    className={`${styles.seg} ${styles.dragSeg}`}
                    role="group"
                    aria-labelledby="shape-key"
                  >
                    {(["free", "line", "ring"] as ShapeTool[]).map((s) => (
                      <button
                        key={s}
                        type="button"
                        className={styles.segBtn}
                        aria-pressed={shapeTool === s}
                        aria-label={
                          s === "free"
                            ? "free brush — every cell the pointer crosses"
                            : s === "line"
                            ? "line — press and drag along a lattice row; it snaps to one of the three band families"
                            : "ring — press and drag outward; the ring is a level set of the exact hexagonal norm"
                        }
                        onClick={() => pickShapeTool(s)}
                      >
                        {s}
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
                {/* Zoom, so Space-to-pan has something to pan. Buttons rather
                    than keys alone: a modifier nobody can reach without a
                    keyboard is a feature half the users do not have. */}
                <span className={styles.zoomGroup} role="group" aria-label="zoom">
                  <button
                    type="button"
                    onClick={() => setZoomTo(zoom / 2)}
                    disabled={zoom <= 1}
                    aria-label="zoom out"
                  >
                    −
                  </button>
                  <button
                    type="button"
                    onClick={() => setZoomTo(1)}
                    disabled={zoom === 1}
                    aria-label={`zoom ${zoom} times — click to fit the whole figure`}
                  >
                    {zoom}×
                  </button>
                  <button
                    type="button"
                    onClick={() => setZoomTo(zoom * 2)}
                    disabled={zoom >= ZOOM_MAX}
                    aria-label="zoom in"
                  >
                    +
                  </button>
                </span>
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
                <button
                  type="button"
                  onClick={() => (helpOpen ? closeHelp() : openHelp())}
                  aria-expanded={helpOpen}
                  aria-label="keyboard shortcuts"
                >
                  ?
                </button>
                {/* The one control that wipes, and the only one. Warm, apart
                    from the neutral chrome, and it asks twice. */}
                <button
                  type="button"
                  className={`${styles.newBtn} ${
                    armed === "new" ? styles.armedBtn : ""
                  }`}
                  onClick={doNew}
                  onBlur={() => {
                    if (armed === "new") disarm();
                  }}
                  aria-label={
                    armed === "new"
                      ? "confirm — wipe the plate and the whole undo history"
                      : "new plate — wipes everything, and asks first"
                  }
                >
                  {armed === "new" ? "new — sure?" : "new"}
                  {armed === "new" && (
                    <span
                      className={styles.armFuse}
                      style={{ animationDuration: `${CONFIRM_MS}ms` }}
                      aria-hidden="true"
                    />
                  )}
                </button>
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
                shape={shapeTool}
                panning={spaceHeld}
                view={view}
                className={styles.canvas}
                candidateClass={styles.marching}
                label={`${kind} drawing canvas, depth ${depth}, ${total} cells, ${mode}-fold symmetry brush, ${tool} tool, ${shapeTool} shape${
                  band === null ? "" : `, band ${band}`
                }. Q W E A D Z X C step the cursor on the lattice, W and X move a ring outward and inward, arrow keys walk it by screen direction, Enter ${
                  shapeTool === "free"
                    ? dragMode === "propose"
                      ? "proposes then commits"
                      : "paints"
                    : "anchors then lays the figure"
                }. Press question mark for every shortcut.`}
                onHover={onHover}
                onPaint={paintAt}
                onStrokeEnd={endStroke}
                onPropose={propose}
                onCommit={commitCandidate}
                onArrow={onArrow}
                onShapeDrag={(anchor, at, alt) => setShapeDrag({ anchor, at, alt })}
                onShapeEnd={commitShape}
                onPan={onPan}
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
            <b>Q W E / A D / Z X C</b> walk the cursor on the exact lattice — the
            six ring keys are the six same-orientation steps, at 0°, 60°, 120°,
            180°, 240° and 300°, and <b>W</b> / <b>X</b> cross the radial axis.
            Press <b>?</b> for every shortcut.{" "}
            {dragMode === "propose" ? (
              <>
                Drag moves a candidate; <b>tap it</b> or press <b>Enter</b> to
                commit it, <b>Esc</b> to drop it.
              </>
            ) : (
              <>
                Drag paints continuously; <b>Enter</b> paints at the cursor.
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

      {/* The shortcut panel.
          A panel and not a page: it is over the plate, it is dismissed by Escape
          and by its own button, focus moves into it on open and back to whatever
          opened it on close. The rows come from `shortcuts.ts`, which is the same
          table the collision test reads — a help panel maintained by hand beside
          the handler is how a program comes to be described by a document about
          a program that no longer exists. */}
      {helpOpen && (
        <div
          className={styles.helpScrim}
          role="dialog"
          aria-modal="true"
          aria-labelledby="help-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeHelp();
          }}
        >
          <div className={styles.helpPanel}>
            <div className={styles.helpHead}>
              <h2 className={styles.helpTitle} id="help-title">
                Keys
              </h2>
              <button
                ref={helpClose}
                type="button"
                className={styles.helpClose}
                onClick={closeHelp}
                aria-label="close the shortcut panel"
              >
                close
              </button>
            </div>
            <div className={styles.helpCols}>
              {SHORTCUTS.map((group) => (
                <section key={group.title} className={styles.helpGroup}>
                  <h3 className={styles.helpGroupTitle}>{group.title}</h3>
                  <dl className={styles.helpList}>
                    {group.rows.map((row) => (
                      <div key={row.chord} className={styles.helpRow}>
                        <dt className={styles.helpKeys}>{row.keys}</dt>
                        <dd className={styles.helpWhat}>{row.what}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
            </div>
            <p className={styles.helpFoot}>
              The six ring keys are the six <b>same-orientation</b> lattice steps
              — one cell edge each, at 0°, 60°, 120°, 180°, 240° and 300°, and
              identical whichever way up the cell is. The three <i>edge</i>{" "}
              neighbours are not those: an upright cell reaches 30°, 150° and 270°
              and an inverted one 90°, 210° and 330°, so the two orientations have
              disjoint edge sets and a cluster mapped to them would mean two
              different things under one finger. <b>W</b> and <b>X</b> are what
              cross between the two, so the eight together reach every cell.
            </p>
          </div>
        </div>
      )}

      <p className="sr-only" role="status" aria-live="polite">
        {said}
      </p>
    </main>
  );
}
