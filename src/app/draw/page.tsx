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
} from "@/components/DrawBoard";
import { ADJUSTMENTS, ADJUST_NAMES, type AdjustName } from "@/lib/adjust";
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
  brushCells,
  brushColours,
  defaultDragMode,
  EMPTY_EVENTS,
  eventCount,
  progressionIndex,
  pushEvents,
  redoEvents,
  TOOLS,
  undoEvents,
  upcomingBases,
  type DragMode,
  type EventLog,
  type Tool,
} from "@/lib/brush";
import { buildFigure, type Convention } from "@/lib/figure";
import { buildHexagon } from "@/lib/hexagon";
import {
  hexagonSurface,
  triangleSurface,
  HEXAGON_MODES,
  TRIANGLE_MODES,
  type BrushMode,
  type CanvasKind,
  type SymmetrySurface,
} from "@/lib/orbit";
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
 * Fixed at `apex`, and the choice does not matter here. The apex/ifs question
 * is about which V4 charge a triangle is LABELLED with; the drawing program
 * never reads a charge. Orbits agree as sets of triangles under both
 * conventions — see the header of `orbit.ts` — so a plate drawn here would look
 * identical either way. Exposing the toggle would be a control with no visible
 * effect, which is worse than no control.
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

const DEPTHS: Record<CanvasKind, number[]> = {
  // Triangle depth 5 is 1024 cells; hexagon depth 4 is 1536, six sectors of
  // 4^4. Both stay under the point where a full re-render is felt, and the
  // layer split in DrawBoard means only the paint layer is ever redrawn.
  triangle: [1, 2, 3, 4, 5],
  hexagon: [1, 2, 3, 4],
};

const cellCount = (kind: CanvasKind, depth: number) =>
  (kind === "hexagon" ? 6 : 1) * 4 ** depth;

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
  const [mode, setMode] = useState<BrushMode>(6);
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
  const modes = kind === "triangle" ? TRIANGLE_MODES : HEXAGON_MODES;

  // A finger has no hover, so the ghost preview — the thing that teaches what
  // the brush does — is unreachable on touch unless the press itself proposes.
  const coarse = useSyncExternalStore(subscribeCoarse, coarseNow, coarseOnServer);
  const dragMode = dragChoice ?? defaultDragMode(coarse);

  const canvas: Canvas = useMemo(() => {
    const seamWidth = seamAt(kind, depth);
    if (kind === "triangle") {
      const f = buildFigure(depth, CONVENTION);
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
      };
    }
    const h = buildHexagon(depth, CONVENTION);
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
      surface: hexagonSurface(h),
      bands: buildBandSurface(h),
    };
  }, [kind, depth]);

  const guides = useMemo(
    () => symmetryGuides(canvas.frame, mode),
    [canvas, mode]
  );

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

  /** The scheme's colours in orbit order, as the current brush would lay them. */
  const tape = useMemo(
    () =>
      Array.from({ length: mode }, (_, k) =>
        scheme.at(effectiveBase, k, mode)
      ),
    [scheme, effectiveBase, mode]
  );

  const shape = useMemo(() => ({ mode, band }), [mode, band]);

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
      const all = brushCells(canvas.surface, canvas.bands, seed, shape);
      if (tool === "erase") {
        return { cells: all, colours: [], inert: [], seed, erasing: true };
      }
      const colours = brushColours(
        { tool, scheme, base: effectiveBase, adjust },
        paint,
        all
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

  const wipe = useCallback((why: string) => {
    paintRef.current = new Map();
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

  const pickKind = (next: CanvasKind) => {
    if (next === kind) return;
    const d = Math.min(depth, Math.max(...DEPTHS[next]));
    const m = next === "triangle" && mode === 12 ? 6 : mode;
    setKind(next);
    setDepth(d);
    setMode(m);
    wipe(`canvas set to ${next}, depth ${d}, ${cellCount(next, d)} cells — plate cleared`);
  };

  const pickDepth = (d: number) => {
    if (d === depth) return;
    setDepth(d);
    wipe(`depth ${d}, ${cellCount(kind, d)} cells — plate cleared`);
  };

  // ── painting ────────────────────────────────────────────────────────────

  const paintAt = useCallback(
    (i: number) => {
      const cells = brushCells(canvas.surface, canvas.bands, i, shape);
      // Recomputed per application rather than taken from `effectiveBase`, so a
      // drag lays a gradient along its own path instead of one flat colour.
      const n = progressionIndex(events, progOrigin, pendingEvents.current);
      const colours = brushColours(
        { tool, scheme, base: prog.at(base, n), adjust },
        paintRef.current,
        cells
      );
      const edits = planEdits(paintRef.current, cells, colours);
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
      setCandidate(i);
      setCursor(i);
      setHover(null);
    },
    []
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

  const pickBand = (next: BandFamily | null) => {
    if (next === band) return;
    setBand(next);
    // A row of cells with a seam at every join reads as a run of triangles, not
    // as one thick line, so selecting a band welds the paint. The toggle stays
    // available: this is a default, not a lock.
    if (next !== null && !weld) {
      setWeld(true);
      setAnnounce(
        `band ${next} — ${BAND_NOTE[kind][next]}; painted cells welded so a row reads as one line`
      );
      return;
    }
    setAnnounce(
      next === null ? "band brush off" : `band ${next} — ${BAND_NOTE[kind][next]}`
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
      setCursor(next);
      if (dragMode === "propose") setCandidate(next);
      else setHover(next);
    },
    [canvas, cursor, dragMode]
  );

  const onCursorPaint = useCallback(() => {
    if (cursor === null) {
      const start = stepCursor(canvas.centroids, null, "up");
      if (start < 0) return;
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

  const svgText = useCallback(
    () =>
      artworkSvg({
        width: canvas.geom.width,
        height: canvas.geom.height,
        cells: canvas.geom.cells,
        paint: paintRef.current,
        background: PLATE_BG,
        unpainted: showTiling ? TILE : null,
        tileSeam: SEAM,
        paintSeam: PAINT_SEAM,
        weldPaint: weld,
        seamWidth: canvas.geom.seamWidth,
        title: `FOURFOLD — ${kind}, depth ${depth}, ${mode}-fold brush, ${schemeName}${
          band === null ? "" : `, band ${band}`
        }`,
      }),
    [canvas, showTiling, weld, kind, depth, mode, schemeName, band]
  );

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
    for (const m of guides.mirrors) {
      if (m.family === "median") {
        items.push({
          key: m.id,
          label: m.label.replace("—", "·"),
          colour: { m_A: "#67e8f9", m_B: "#4ade80", m_C: "#f59e0b" }[m.id] ?? "#67e8f9",
          dashed: false,
          dot: false,
        });
      }
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
                {kind === "triangle" ? "D₃" : "D₆"} subgroups
              </span>
            </div>
            <BrushDial kind={kind} modes={modes} mode={mode} onPick={setMode} />
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
              ) : guides.rotation ? (
                <>
                  <b>
                    {kind === "triangle" ? "D₃" : "D₆"} — {guides.mirrors.length}{" "}
                    mirrors and C{guides.rotation.order}.
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
                  : `${bandStat.count} rows · ${bandStat.min}…${bandStat.max}`}
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
                  One cell deep, edge to edge, <b>carried by the brush</b> — a row
                  under the 6-fold brush is six rows.
                </>
              ) : (
                <>
                  <b>{BAND_NOTE[kind][band]}.</b> Lattice edges run 0°/60°/120° and
                  medians 30°/90°/150°, so a band is always <i>perpendicular</i> to
                  a median; there is no median-parallel row.
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

            <div className={styles.subHead}>
              <span className={styles.subTitle}>orbit colours</span>
              <span className={styles.sectionMeta}>
                {reach === null ? `k = 0…${mode - 1}` : `reach ${reach}`}
              </span>
            </div>
            <div className={styles.tapeWrap}>
              <div className={styles.tape} aria-hidden="true">
                {tape.map((s, k) => (
                  <span
                    key={`${schemeName}-${mode}-${k}-${s.hex}`}
                    className={styles.tapeCell}
                    style={{ background: s.hex, animationDelay: `${k * 45}ms` }}
                  >
                    <span className={styles.tapeIndex}>{k}</span>
                  </span>
                ))}
              </div>
            </div>
            <p className={styles.hint}>
              {scheme.offsets.length < mode ? (
                <>
                  <b>{scheme.offsets.length}</b>{" "}
                  {scheme.offsets.length === 1 ? "hue" : "hues"} over{" "}
                  <b>{mode}</b> positions —
                  a {scheme.offsets.length}-fold colour period in a {mode}-fold
                  shape.
                </>
              ) : (
                <>Every position gets its own hue; a pinned cell takes fewer.</>
              )}
            </p>
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
              </span>
            </div>

            {/* The tools act on the artwork and live with it, not in the rail —
                and the plate has the horizontal room the rail does not have the
                vertical room for. */}
            <div className={styles.bench} data-tool={tool}>
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

              {tool === "adjust" && (
                <div className={`${styles.benchGroup} ${styles.benchWide}`}>
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

              {candidateSpec !== null && (
                <div className={`${styles.benchGroup} ${styles.benchEnd}`}>
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
            </div>

            <div className={styles.canvasHold} data-tool={tool}>
              <DrawBoard
                geom={canvas.geom}
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
                onHover={setHover}
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
              {paint.size === 0 && candidateSpec === null && (
                <p className={styles.emptyHint}>
                  {dragMode === "propose"
                    ? "drag to propose — tap the ghost to commit"
                    : "click or drag to paint — every stroke is an orbit"}
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
            cleared rather than reinterpreted.
          </p>
        </div>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {said}
      </p>
    </main>
  );
}
