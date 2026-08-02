"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DrawBoard, {
  PAINT_SEAM,
  SEAM,
  TILE,
  type BoardGeometry,
  type PreviewSpec,
} from "@/components/DrawBoard";
import { buildFigure, type Convention } from "@/lib/figure";
import { buildHexagon } from "@/lib/hexagon";
import {
  hexagonSurface,
  triangleSurface,
  HEXAGON_MODES,
  TRIANGLE_MODES,
  type BrushMode,
  type CanvasKind,
} from "@/lib/orbit";
import {
  paintOrbit,
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

interface Canvas {
  kind: CanvasKind;
  geom: BoardGeometry;
  frame: CanvasFrame;
  centroids: Pt[];
  orbit: (i: number, mode: BrushMode) => number[];
}

export default function DrawPage() {
  const [kind, setKind] = useState<CanvasKind>("triangle");
  const [depth, setDepth] = useState(4);
  const [mode, setMode] = useState<BrushMode>(6);
  const [schemeName, setSchemeName] = useState<SchemeName>("hexad");
  const [base, setBase] = useState<Swatch>(() => swatchFromHex("#d4a017"));
  const [erasing, setErasing] = useState(false);

  const [paint, setPaint] = useState<ReadonlyMap<number, string>>(new Map());
  const [history, setHistory] = useState<History>(EMPTY_HISTORY);
  const [hover, setHover] = useState<number | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [showGuides, setShowGuides] = useState(true);
  const [showTiling, setShowTiling] = useState(true);
  const [announce, setAnnounce] = useState("");

  const paintRef = useRef<ReadonlyMap<number, string>>(new Map());
  const pending = useRef<CellEdit[]>([]);

  const scheme = SCHEMES[schemeName];
  const modes = kind === "triangle" ? TRIANGLE_MODES : HEXAGON_MODES;

  const canvas: Canvas = useMemo(() => {
    const seamWidth = seamAt(kind, depth);
    if (kind === "triangle") {
      const f = buildFigure(depth, CONVENTION);
      const surface = triangleSurface(f);
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
        orbit: (i, m) => surface.orbit(i, m),
      };
    }
    const h = buildHexagon(depth, CONVENTION);
    const surface = hexagonSurface(h);
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
      orbit: (i, m) => surface.orbit(i, m),
    };
  }, [kind, depth]);

  const guides = useMemo(
    () => symmetryGuides(canvas.frame, mode),
    [canvas, mode]
  );

  /** The scheme's colours in orbit order, as the current brush would lay them. */
  const tape = useMemo(
    () => Array.from({ length: mode }, (_, k) => scheme.at(base, k, mode)),
    [scheme, base, mode]
  );

  const preview: PreviewSpec | null = useMemo(() => {
    if (hover === null || hover >= canvas.geom.cells.length) return null;
    const cells = canvas.orbit(hover, mode);
    return {
      cells,
      colours: erasing ? [] : paintOrbit(scheme, base, cells).map((s) => s.hex),
      seed: hover,
      erasing,
    };
  }, [hover, canvas, mode, scheme, base, erasing]);

  // ── the canvas is a different set of cells now ──────────────────────────

  const wipe = useCallback((why: string) => {
    paintRef.current = new Map();
    pending.current = [];
    setPaint(paintRef.current);
    setHistory(EMPTY_HISTORY);
    setHover(null);
    setCursor(null);
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
      const cells = canvas.orbit(i, mode);
      const colours: (string | null)[] = erasing
        ? cells.map(() => null)
        : paintOrbit(scheme, base, cells).map((s) => s.hex);
      const edits = planEdits(paintRef.current, cells, colours);
      if (edits.length === 0) return;
      paintRef.current = applyEdits(paintRef.current, edits, "do");
      pending.current = mergeEdits(pending.current, edits);
      setPaint(paintRef.current);
    },
    [canvas, mode, erasing, scheme, base]
  );

  const endStroke = useCallback(() => {
    const edits = pending.current;
    pending.current = [];
    if (edits.length === 0) return;
    setHistory((h) => commit(h, { edits }));
    setAnnounce(
      `${erasing ? "erased" : "painted"} ${edits.length} cell${
        edits.length === 1 ? "" : "s"
      } with the ${mode}-fold brush — ${paintRef.current.size} on the plate`
    );
  }, [erasing, mode]);

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
    applyStroke(step.stroke.edits, "undo", `undid ${step.stroke.edits.length} cells`);
  }, [history, applyStroke]);

  const doRedo = useCallback(() => {
    const step = redo(history);
    if (step.stroke === null) {
      setAnnounce("nothing to redo");
      return;
    }
    setHistory(step.history);
    applyStroke(step.stroke.edits, "do", `redid ${step.stroke.edits.length} cells`);
  }, [history, applyStroke]);

  const doClear = useCallback(() => {
    const stroke = clearStroke(paintRef.current);
    if (stroke.edits.length === 0) {
      setAnnounce("the plate is already empty");
      return;
    }
    setHistory((h) => commit(h, stroke));
    applyStroke(stroke.edits, "do", `cleared ${stroke.edits.length} cells`);
  }, [applyStroke]);

  // ── keyboard ────────────────────────────────────────────────────────────

  const onArrow = useCallback(
    (dir: Direction) => {
      const next = stepCursor(canvas.centroids, cursor, dir);
      if (next < 0) return;
      setCursor(next);
      setHover(next);
    },
    [canvas, cursor]
  );

  const onCursorPaint = useCallback(() => {
    if (cursor === null) {
      const start = stepCursor(canvas.centroids, null, "up");
      if (start < 0) return;
      setCursor(start);
      setHover(start);
      return;
    }
    paintAt(cursor);
    endStroke();
  }, [cursor, canvas, paintAt, endStroke]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The hex field is a text input; undo there belongs to the browser.
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      e.preventDefault();
      if (e.shiftKey) doRedo();
      else doUndo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doUndo, doRedo]);

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
        seamWidth: canvas.geom.seamWidth,
        title: `FOURFOLD — ${kind}, depth ${depth}, ${mode}-fold brush, ${schemeName}`,
      }),
    [canvas, showTiling, kind, depth, mode, schemeName]
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
  const orbitSize = preview?.cells.length ?? null;
  const schemeGradient = `linear-gradient(90deg, ${tape
    .map((s, k) => `${s.hex} ${(100 * k) / Math.max(tape.length - 1, 1)}%`)
    .join(", ")})`;

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
                  <b>Trivial.</b> One cell per click — the brush the others have
                  to be different from.
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
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>Base colour</h2>
              <span className={styles.sectionMeta}>{Math.round(base.h)}°</span>
            </div>
            <ColourWell base={base} onChange={setBase} />
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>Scheme</h2>
              <span className={styles.sectionMeta}>
                {scheme.offsets.length} hue{scheme.offsets.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className={styles.schemeList} role="group" aria-label="colour scheme">
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
                          style={{ background: s.at(base, k, s.offsets.length).hex }}
                        />
                      ))}
                    </span>
                    <span className={styles.schemeName}>{name}</span>
                    <span className={styles.schemeCount}>{s.offsets.length}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>Orbit colours</h2>
              <span className={styles.sectionMeta}>
                {orbitSize === null ? `k = 0…${mode - 1}` : `orbit ${orbitSize}`}
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
                  <b>{scheme.offsets.length}</b> hues over <b>{mode}</b> positions,
                  so the list wraps — a {scheme.offsets.length}-fold colour period
                  inside a {mode}-fold shape.
                </>
              ) : (
                <>
                  Every position gets its own hue. Orbits come out shorter than{" "}
                  {mode} where a mirror pins a cell.
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
                checked={erasing}
                onChange={(e) => setErasing(e.target.checked)}
              />
              erase instead of paint
            </label>
          </section>

          <section className={styles.section}>
            <p className={styles.hint}>
              <b>⌘Z / Ctrl+Z</b> undoes a whole gesture, not a cell. Drag to
              paint continuously. Arrow keys move a cursor on the plate; Enter or
              Space paints there.
            </p>
          </section>
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
            <div className={styles.plateRule}>
              <span className={styles.readout}>
                <span>
                  {kind} · d{depth} · <b>{total} cells</b>
                </span>
                <span>
                  brush <b>{mode}-fold</b> ·{" "}
                  {orbitSize === null ? (
                    <b>hover to preview</b>
                  ) : (
                    <b>
                      orbit {orbitSize}
                      {orbitSize < mode ? " · pinned" : ""}
                    </b>
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

            <div className={styles.canvasHold}>
              <DrawBoard
                geom={canvas.geom}
                paint={paint}
                preview={preview}
                cursor={cursor}
                guides={guides}
                showGuides={showGuides}
                showTiling={showTiling}
                className={styles.canvas}
                label={`${kind} drawing canvas, depth ${depth}, ${total} cells, ${mode}-fold symmetry brush. Arrow keys move the cursor, Enter or Space paints.`}
                onHover={setHover}
                onPaint={paintAt}
                onStrokeEnd={endStroke}
                onArrow={onArrow}
                onCursorPaint={onCursorPaint}
              />
              {paint.size === 0 && (
                <p className={styles.emptyHint}>
                  click or drag to paint — every stroke is an orbit
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

          <p className={styles.foot}>
            Orbits are computed in <code>src/lib/orbit.ts</code> by exact integer
            key lookup — no tolerance, no floating-point comparison decides which
            cells a stroke touches. On the hexagon <b>nothing is pinned by a
            rotation</b>, because no cell sits on the centre, so modes 2, 3 and 6
            paint a full orbit everywhere; only mode 12 has short orbits, from the
            three spine mirrors. On the triangle the all-X hub is fixed by every
            isometry and is a singleton in every mode. Changing the canvas or the
            depth changes which cells exist, so the plate is cleared rather than
            reinterpreted.
          </p>
        </div>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>
    </main>
  );
}
