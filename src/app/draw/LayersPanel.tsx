"use client";

import { useEffect, useRef, useState } from "react";
import {
  canArrange,
  hasSelection,
  type Arrange,
  type LayerId,
  type Session,
} from "@/lib/layers";
import { layerCells, panelRows, type PanelRow } from "@/lib/composer";
import type { AddressBook } from "@/lib/plate";
import type { InOut } from "@/lib/replay";
import {
  railPercent,
  seamSaid,
  spanCovers,
  spanIsWhole,
  spanSaid,
} from "@/lib/timeline";
import styles from "./draw.module.css";

/**
 * THE LAYERS PANEL: the drawing's tree, one row a layer, to any depth.
 *
 * ── Reading DOWN this list is reading DOWN through the drawing ───────────
 *
 * The row order is `composer.panelRows` and it is the stacking order exactly:
 * the top row is the layer nearest the viewer and the bottom row is
 * `layers[0]`. That includes a layer's children, which are listed ABOVE their
 * parent because they paint over it — a deviation from the group-header
 * convention, argued in full on `panelRows`.
 *
 * DEPTH IS COUNTED, NOT MEASURED. Every ancestor level draws a vertical
 * hairline down the left of the row, so a row three deep carries three lines
 * and a person reads the number rather than estimating an indent. The line
 * stops at the last row of its block, so a subtree is a bracket with an end
 * rather than an indent that trails off, and the guide for a level whose
 * siblings are exhausted is simply absent. That is what makes arbitrary depth
 * legible without a disclosure triangle, an expansion state or a scrollbar of
 * indentation.
 *
 * ── OWN state on the buttons, INHERITED state on the row ────────────────
 *
 * `layers.ts` names the two apart — `visible`/`locked` against
 * `shown`/`editable` — so they cannot be confused in code, and this panel keeps
 * them apart on screen for the same reason. The eye and the padlock show the
 * layer's OWN switch and toggle its own switch, always, so pressing one is
 * exactly invertible. The ROW shows the inherited answer: a visible layer
 * inside a hidden parent is dimmed and says so, and its own eye still reads
 * open, because that is what un-hiding the parent will restore. A panel that
 * wrote the inherited answer onto the switch would lose that, permanently.
 *
 * ── Copy and paste, export and import ───────────────────────────────────
 *
 * ONE operation each, with two transports. The row's COPY and the panel's COPY
 * are `emit.serialise` with and without a scope; the panel's EXPORT is the same
 * text going to a file instead of the clipboard; PASTE and IMPORT are
 * `emit.parse` from one or the other. Nothing in this file serialises anything —
 * see `page.tsx`, where the four transports are four short functions around one
 * producer and one consumer.
 *
 * ── Disabled means `disabled` ───────────────────────────────────────────
 *
 * Every control that cannot act carries the real attribute, so it is skipped by
 * the Tab order and refused by the pointer, rather than being painted grey and
 * left clickable. The two that depend on a selection — CLEAR and the arrange
 * pair — ask `layers.ts` itself (`hasSelection`, `canArrange`) rather than
 * testing for null here, so the panel and the model cannot disagree about when
 * a control is live.
 *
 * ── THE PLAYHEAD IS NO LONGER IN THIS PANEL ─────────────────────────────
 *
 * It was, for one pass: a time ruler at the top of this section, over the track
 * stack, on the owner's own reading of the Flash arrangement. The owner then
 * asked for it "in the top of the bottom toolbar", so it rides in the band under
 * the plate now, as a slideout with a centred seam. `page.tsx` mounts it there
 * and `Timeline`'s own header below carries the argument and the measurements.
 *
 * Not one row of this list moved when it left, exactly as not one row moved when
 * it arrived: the strip was always furniture ABOVE the list rather than a fourth
 * column inside rows that are 26px tall, which is what made both moves cheap.
 *
 * WHY THE CODE IS STILL IN THIS FILE — the honest answer, and not a design. This
 * pass was given a five-file lane and a new component file was not in it, so
 * `Timeline` stayed where it was written and became a named export, which is why
 * `page.tsx` imports it from a module called `LayersPanel`. It shares this
 * file's 24-unit glyph family and nothing else with the panel. The right home is
 * a `Timeline.tsx` of its own and getting it there is a move, not a rewrite.
 */

/**
 * The glyph family, on the 24-unit grid the deck's icons use, at 14px.
 *
 * Smaller than the deck's 18px because a panel row is 26px where a deck row is
 * 30, and the ratio of glyph to target is what a hand reads rather than the
 * absolute size. The stroke is the deck's 1.5 grid units for the same reason
 * the deck chose it: a 12:1 size-to-stroke ratio is where a line-icon family
 * stops looking like signage.
 */
const GRID = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor" };

function Glyph({ d, extra }: { d: string; extra?: React.ReactNode }) {
  return (
    <svg
      {...GRID}
      className={styles.layerIcon}
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
      {extra}
    </svg>
  );
}

/** The eye keeps its PUPIL: a bare lens at 14px reads as a leaf, not an eye. */
const EYE_OPEN = "M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12Z";
const EYE_PUPIL = <circle cx="12" cy="12" r="2.6" />;
const EYE_SHUT =
  "M3 4l18 16M4.6 8.2C3 9.7 2 12 2 12s3.6 6 10 6c2 0 3.7-.6 5.1-1.4M9.6 6.3A11 11 0 0 1 12 6c6.4 0 10 6 10 6a19 19 0 0 1-2.6 3.2";
const LOCK_SHUT = "M6 11h12v9H6zM9 11V7.5a3 3 0 0 1 6 0V11";
const LOCK_OPEN = "M6 11h12v9H6zM9 11V7.5a3 3 0 0 1 5.7-1.3";
/**
 * COPY is two sheets, PASTE is a board with an arrow INTO it.
 *
 * They were two rectangles apiece and at 14px they were the same icon twice,
 * which on a row that carries both side by side is the one confusion this strip
 * cannot afford. The arrow is what tells them apart at a glance: copy takes a
 * sheet away, paste brings one down.
 */
const COPY = "M9 3h9v13H9zM6 7v14h9";
const PASTE = "M9 3h6v2.5H9zM15 4h3v17H6V4h3M12 10v6M9.5 13.5 12 16l2.5-2.5";
const PLUS = "M12 5v14M5 12h14";
const TRASH = "M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14";
const BROOM = "M6 21l5-7M18 3l-7 9 5 4 4-6zM8 14l4 3";
const UP = "M12 19V5M6 11l6-6 6 6";
const DOWN = "M12 5v14M6 13l6 6 6-6";
const OUTDENT = "M10 6h11M10 12h11M10 18h11M7 9l-3 3 3 3";
const INDENT = "M10 6h11M10 12h11M10 18h11M4 9l3 3-3 3";
const OUT = "M12 16V4M8 8l4-4 4 4M4 15v5h16v-5";
const IN = "M12 4v12M8 12l4 4 4-4M4 15v5h16v-5";

/**
 * The timeline's own four glyphs.
 *
 * The two MARKS are the editor's brackets and they point the way the cut goes:
 * the in point keeps what is to its right, the out point keeps what is to its
 * left, so the bracket's opening faces the part that plays. That is the only
 * thing that tells them apart at 14px, and it is the same convention every
 * transport in the world already draws.
 */
const MARK_IN = "M15 4H9v16h6M9 12h9";
const MARK_OUT = "M9 4h6v16H9M15 12H6";
const CUT_OFF = "M6 6l12 12M18 6L6 18";
const STEP_BACK = "M14 5l-7 7 7 7";
const STEP_ON = "M10 5l7 7-7 7";

/**
 * The seam's two arrows, and the ONE rule that says which is drawn.
 *
 * THE CHEVRON POINTS THE WAY THE PANEL WILL TRAVEL, not the way it currently
 * lies. The seam is the top edge of the slideout and the panel hangs BELOW it,
 * so:
 *
 *   SHUT  → the press drops the panel out from under the seam → chevron DOWN.
 *   OPEN  → the press retracts it back up into the seam       → chevron UP.
 *
 * The alternative convention — the arrow describing where the panel is — was
 * rejected for a specific reason rather than on taste: on a control whose whole
 * job is to move something, an arrow reads as an instruction, and a shut panel
 * marked with an UP arrow ("the panel is up there, out of sight") is a button
 * that appears to promise the opposite of what it does. `aria-expanded` carries
 * the STATE, which is what a state belongs on; the picture carries the ACTION.
 *
 * Deliberately shallow — a 5-of-24 rise across 14 of the grid's units, so the
 * mark is under 3px tall at the 14px this family renders at. A full-height
 * chevron in an 18px tab reads as a button with an icon in it; this reads as a
 * crease in a rule, which is the whole of what a seam is meant to look like.
 */
const CHEVRON_DOWN = "M5 10l7 5 7-5";
const CHEVRON_UP = "M5 14l7-5 7 5";

/**
 * What the strip needs to draw a playhead, and the five things it can ask for.
 *
 * `steps === null` IS THE ORDINARY RESTING STATE and not an error: counting the
 * beats means flattening the whole journal, which is measured at ~205 ms for a
 * depth-5 plate with 256 acts, and paying that on every stroke to keep a rail
 * warm would be a hitch on every press of the brush. So the count is taken ONCE
 * when a preview opens, and the strip sits UNCOUNTED — marks still legible,
 * still clearable — until it is. `page.tsx` carries the argument in full at
 * `openRewind`.
 *
 * UNCOUNTED IS NOT COLLAPSED, and the slideout made the difference worth
 * spelling out. `steps === null` is a fact about the DRAWING — nobody has asked
 * for a beat count — and it is what the PLAYHEAD button in the strip acts on.
 * `open` is a fact about the FURNITURE — whether the strip is on screen — and
 * only the seam touches it. Neither drives the other: a preview opening does not
 * force a collapsed strip open, because a person who folded it away asked for
 * that and a control that unfolds itself is a control that is fighting them.
 */
export interface TimelineView {
  /** How many reveal steps this frame has, or `null` while they are uncounted. */
  steps: number | null;
  /**
   * Where the playhead stands, or `null` for the state before the first beat.
   *
   * `null` is the animation's GROUND — the plate the first frame shows — and it
   * is a picture rather than a beat. See `timeline.stepAtAct`.
   */
  at: number | null;
  /** The in and out marks, in step space. `null` is "the whole replay". */
  span: InOut | null;
  /** Committed acts in the journal — what OPEN would have to walk. */
  acts: number;
  /** Count the beats and stand the playhead up. Opens the one preview. */
  onOpen: () => void;
  onSeek: (step: number) => void;
  onMarkIn: () => void;
  onMarkOut: () => void;
  onClearMarks: () => void;
}

export interface LayersPanelProps {
  session: Session;
  book: AddressBook;
  /** A preview is standing: every write is off, and the reason is said above. */
  frozen: boolean;
  onSelect: (id: LayerId | null) => void;
  onToggleVisible: (id: LayerId) => void;
  onToggleLocked: (id: LayerId) => void;
  onRename: (id: LayerId, name: string) => void;
  onAdd: () => void;
  onDelete: () => void;
  onClear: () => void;
  onArrange: (dir: Arrange) => void;
  onPromote: () => void;
  onDemote: () => void;
  /** `undefined` is the whole composition; an id is that row and its subtree. */
  onCopy: (layer?: LayerId) => void;
  /** `null` pastes on top of the drawing, an id pastes into that row. */
  onPaste: (into: LayerId | null) => void;
  onExport: () => void;
  onImport: (files: FileList) => void;
}

export default function LayersPanel({
  session,
  book,
  frozen,
  onSelect,
  onToggleVisible,
  onToggleLocked,
  onRename,
  onAdd,
  onDelete,
  onClear,
  onArrange,
  onPromote,
  onDemote,
  onCopy,
  onPaste,
  onExport,
  onImport,
}: LayersPanelProps) {
  const comp = session.composition;
  const rows = panelRows(comp);
  const selected = comp.selected;
  const live = hasSelection(comp) && !frozen;
  const files = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<LayerId | null>(null);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing !== null) field.current?.select();
  }, [editing]);

  const commitName = (id: LayerId, value: string) => {
    setEditing(null);
    onRename(id, value);
  };

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>Layers</h2>
        <span className={styles.sectionMeta}>
          {rows.length} sheet{rows.length === 1 ? "" : "s"}
        </span>
      </div>

      <ol className={styles.layerList} aria-label="layers, topmost first">
        {rows.map((row) => (
          <Row
            key={row.layer.id}
            row={row}
            book={book}
            selected={row.layer.id === selected}
            frozen={frozen}
            editing={editing === row.layer.id}
            field={field}
            onSelect={onSelect}
            onToggleVisible={onToggleVisible}
            onToggleLocked={onToggleLocked}
            onEdit={setEditing}
            onCommit={commitName}
            onCopy={onCopy}
            onPaste={onPaste}
          />
        ))}
        {rows.length === 0 && (
          <li className={styles.layerEmpty}>
            no layers — press <b>NEW LAYER</b> to start a sheet
          </li>
        )}
      </ol>

      {/* THE SHEET: what exists. Add one, throw one away, empty one, move one.
          Kept apart from the row below it, which is about moving a drawing in
          and out of this program rather than about the tree. */}
      <div className={styles.layerBar} role="group" aria-label="layer controls">
        <button
          type="button"
          className={styles.layerBtn}
          onClick={onAdd}
          disabled={frozen}
          title="new layer — above the selection, beside it"
          aria-label="new layer, above the selected one and beside it"
        >
          <Glyph d={PLUS} />
        </button>
        <button
          type="button"
          className={styles.layerBtn}
          onClick={onDelete}
          disabled={!live}
          title="delete the selected layer and everything under it — undoable"
          aria-label="delete the selected layer and everything under it; undoable"
        >
          <Glyph d={TRASH} />
        </button>
        <button
          type="button"
          className={styles.layerBtn}
          onClick={onClear}
          disabled={!live}
          title="clear the selected layer's paint, and every layer under it"
          aria-label="clear the paint from the selected layer and every layer under it; undoable"
        >
          <Glyph d={BROOM} />
        </button>
        <span className={styles.layerGap} aria-hidden="true" />
        <button
          type="button"
          className={styles.layerBtn}
          onClick={() => onArrange("up")}
          disabled={frozen || !canArrange(comp, "up")}
          title="move the layer up — towards the viewer, among its own siblings"
          aria-label="move the selected layer up, towards the viewer, among its own siblings"
        >
          <Glyph d={UP} />
        </button>
        <button
          type="button"
          className={styles.layerBtn}
          onClick={() => onArrange("down")}
          disabled={frozen || !canArrange(comp, "down")}
          title="move the layer down — away from the viewer, among its own siblings"
          aria-label="move the selected layer down, away from the viewer, among its own siblings"
        >
          <Glyph d={DOWN} />
        </button>
        <button
          type="button"
          className={styles.layerBtn}
          onClick={onPromote}
          disabled={!live}
          title="out of its parent — one level shallower"
          aria-label="move the selected layer out of its parent, one level shallower"
        >
          <Glyph d={OUTDENT} />
        </button>
        <button
          type="button"
          className={styles.layerBtn}
          onClick={onDemote}
          disabled={!live}
          title="into the layer below it — one level deeper"
          aria-label="move the selected layer into the layer below it, one level deeper"
        >
          <Glyph d={INDENT} />
        </button>
      </div>

      {/* THE DOCUMENT: the same drawing, leaving and arriving. The clipboard
          and the file are the same two operations with a different destination,
          which is why they are one group of four and not two groups of two. */}
      <div className={styles.layerBar} role="group" aria-label="composition in and out">
        <button
          type="button"
          className={styles.layerBtn}
          onClick={() => onCopy()}
          title="copy the whole composition to the clipboard — SVG and text"
          aria-label="copy the whole composition to the clipboard, as SVG and as text"
        >
          <Glyph d={COPY} />
        </button>
        <button
          type="button"
          className={styles.layerBtn}
          onClick={() => onPaste(selected)}
          disabled={frozen}
          title={
            selected === null
              ? "paste the clipboard on top of the drawing"
              : "paste the clipboard into the selected layer, as one sub-layer"
          }
          aria-label={
            selected === null
              ? "paste the clipboard on top of the drawing"
              : "paste the clipboard into the selected layer, grafted as one sub-layer keeping its own children"
          }
        >
          <Glyph d={PASTE} />
        </button>
        <span className={styles.layerGap} aria-hidden="true" />
        <button
          type="button"
          className={styles.layerBtn}
          onClick={onExport}
          title="export the composition as one SVG, layers and all"
          aria-label="export the composition as one SVG file, with its layers"
        >
          <Glyph d={OUT} />
        </button>
        <button
          type="button"
          className={styles.layerBtn}
          onClick={() => files.current?.click()}
          disabled={frozen}
          title="import one or more SVGs, each grafted onto the selection"
          aria-label="import one or more SVG files, each grafted onto the selected layer"
        >
          <Glyph d={IN} />
        </button>
        <input
          ref={files}
          type="file"
          accept=".svg,image/svg+xml"
          multiple
          className={styles.fileInput}
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            const picked = e.target.files;
            // Cleared so picking the SAME files again still fires a change.
            if (picked !== null && picked.length > 0) onImport(picked);
            e.target.value = "";
          }}
        />
      </div>

      <p className={styles.hint}>
        <b>Top of this list is top of the drawing.</b> The topmost <i>shown</i>{" "}
        layer wins each cell, and nothing blends — the stack occludes. A
        layer&rsquo;s sub-layers are listed <i>above</i>{" "}
        it because they paint over its own paint. The eye and the padlock are
        each layer&rsquo;s{" "}
        <b>own</b> switch; a row inside a hidden or locked parent says so and
        keeps its switch where you left it.
      </p>
    </section>
  );
}

/**
 * The id the seam's `aria-controls` names. One strip on the page, so a constant
 * rather than a `useId`: the value has to be written into two attributes on two
 * elements and a generated one would be one more thing to thread.
 */
const PANEL_ID = "timeline-panel";

/**
 * THE PLAYHEAD, and the two marks that are set from it — a slideout at the top
 * of the band under the plate.
 *
 * ── Where it sits, and what the move cost ───────────────────────────────
 *
 * The owner asked for it "in the top of the bottom toolbar". The band under the
 * artwork is `.baseline` — measured, that band is a pair of READINGS (what is
 * true of the drawing, what is true of its symmetry) and carries no control at
 * all, so "toolbar" is the owner's word for where it is rather than for what is
 * in it. It is nonetheless the only band there is under the canvas, so this is
 * the top of it, and this strip is now the first thing in that band that can be
 * pressed. See `.baseBar` in the stylesheet.
 *
 * WHAT THE RAIL GAINED, measured in a browser on the built page rather than
 * estimated: the plate is 766px wide at 1512 and 344px at 390, and the track
 * inside this strip comes out at 692px and 250px. In the right-hand rail, where
 * the panel was 240–290px wide, the same arithmetic gives 166–216px. That is the
 * one thing the move plainly improves: at the 256-gesture history limit a beat
 * is 2.7px of track at 1512 where it was under a pixel, so the playhead can now
 * be dropped on a chosen beat with a mouse on a desktop.
 *
 * WHAT IT COST. The rail gave this strip a column that was always on screen and
 * always the same width; the band under the plate is shared with two readings
 * that wrap, and on a phone it is below the fold on a tall drawing. That is what
 * the seam is for, and it is why the seam and not the strip is what stays put.
 *
 * ── Why the marks are SET FROM the playhead and not dragged ─────────────
 *
 * `replay.InOut` is two indices into the beat list, and the obvious control for
 * two indices on a track is two draggable handles. MEASURED, that is still not a
 * control here even at the new width: 692px of rail over 257 stops is 2.7px a
 * beat at 1512, and 250px over 257 stops is 0.97px at 390 — under a finger by
 * more than an order of magnitude. Two handles would be two things nobody can
 * put on a chosen beat rather than one.
 *
 * So the playhead is the only thing that moves, and it is an `<input
 * type="range">` — which means Left/Right step it by exactly one beat, Home and
 * End go to the ends, and Page Up/Down jump, all without a line of code and all
 * exact at any density. The marks are then set WHERE THE PLAYHEAD STANDS, which
 * is the transport idiom every editor uses (I and O in Premiere, Resolve and
 * QuickTime alike) and which inherits the playhead's precision exactly.
 *
 * NO GLOBAL CHORD, and that is a finding rather than an omission: the two chord
 * pairs a person would reach for are `I`/`O` and `[`/`]`, and BOTH are already
 * bound in `lib/shortcuts.ts` — the first to drilling in and stepping out of a
 * focus, the second to plate depth. Neither is worth taking for this, so the
 * marks are buttons, reached by Tab from the rail they act on.
 *
 * ── Why the strip is UNCOUNTED until a preview opens ────────────────────
 *
 * Counting the beats means flattening every state of the journal, measured at
 * ~205 ms for a depth-5 plate with 256 acts, and the result cannot be cached
 * across calls because `everyComposition` mints fresh compositions every time.
 * Paying that per stroke to keep a rail warm would put a fifth of a second into
 * every press of the brush. So the count is taken once, when the preview opens,
 * and it stays valid for as long as it is up — the brush is switched off while a
 * preview stands, so the journal cannot move under it. `page.tsx` carries the
 * argument at `openRewind`.
 *
 * The marks survive both the count being absent AND the strip being collapsed,
 * because they are a property of the DRAWING rather than of the preview or of
 * the furniture. That is exactly why the seam has to announce them — see
 * `timeline.seamSaid`, which is the one part of this control that is testable
 * with no DOM and is tested.
 *
 * ── THE SEAM, and why it is above the panel rather than below it ────────
 *
 * TWO REASONS, both about the hand. The seam is the edge the panel comes out
 * of, so a chevron on it points at where the panel will go, which is the whole
 * of the convention (see `CHEVRON_DOWN`). And it does not move when it is
 * pressed: everything that changes height is BELOW it, so the second press of a
 * double toggle lands where the first one did. A seam under the panel would
 * travel the panel's own height on every press, which on a control this thin is
 * the difference between hitting it and hitting the readout under it.
 *
 * LOW PROFILE AGAINST A REAL TARGET — the one design constraint the owner
 * named, and it is resolved by separating the PAINT from the BOX. The painted
 * tab is 56 × 18px at every width, which is a crease in the band's own hairline
 * rather than a button bar; the `<button>` around it is transparent and its
 * padding is what makes the target, so it is 84 × 24px on a mouse and 96 × 44px
 * on a coarse pointer. Nothing overflows the button's own box, which is why this
 * needs none of the `pointer-events` defences `.canvasZoom` carries: it is in
 * normal flow under the canvas and cannot reach it. `.timelineSeam` measures it.
 *
 * ── THE FILMSTRIP IS STILL DEFERRED ─────────────────────────────────────
 *
 * And the move made it cheaper rather than more expensive: a filmstrip is this
 * axis repeated once per row, reading the same `--tl-in`/`--tl-out`/`--tl-at`
 * properties, and a band under the plate has three times the width to repeat it
 * across. Nothing here draws a frame cell, and nothing should until it is asked
 * for.
 */
export function Timeline({
  view,
  open,
  onToggle,
}: {
  view: TimelineView;
  /** Is the strip on screen? Furniture, and nothing else reads it. */
  open: boolean;
  onToggle: () => void;
}) {
  const { steps, at, span, acts } = view;
  const live = steps !== null && steps > 0;
  // `at` is a beat; the rail also has the GROUND at its left end, which is the
  // plate the animation opens on and the position REPLAY opens at. See
  // `timeline.GROUND` for why the rail is one stop longer than the beat list.
  const pos = at ?? -1;
  const cut = live && !spanIsWhole(span, steps);
  const said = live ? spanSaid(span, steps) : null;

  /**
   * THE MARKS ARE BOUNDARIES, so the in point is drawn at the stop BEFORE its
   * own beat.
   *
   * A beat occupies the stretch of rail between the stop before it and its own,
   * because that is the interval the playhead crosses while the step comes up.
   * So the region a cut plays runs from the stop before the IN beat to the OUT
   * beat's own — which is what makes the un-cut case fill the whole rail, and
   * what makes an in point read as "playback starts here" rather than as "this
   * one beat is marked".
   *
   * Drawn the other way, at `railPercent(in)`, the whole replay came out as a
   * band that started one stop in from the left and looked like a cut on a
   * drawing nobody had cut.
   */
  const bandFrom = railPercent((span?.in ?? 0) - 1, steps ?? 0);
  const bandTo = railPercent(span?.out ?? (steps ?? 1) - 1, steps ?? 0);

  return (
    <>
      {/* THE SEAM. A hairline across the band with a chevron tab crimped into
          the middle of it — the band's own top rule, drawn by this row's two
          pseudo-elements, so the slideout adds a control without adding a line.
          The tab is 56 × 18 of paint inside an 84 × 24 button (96 × 44 on a
          coarse pointer); `.timelineSeam` carries the numbers and the reason.

          The ROW is not the button. A full-width strip that toggles on any
          press would be the button bar this was asked not to be, and it would
          swallow a press meant for the readout below it — so the hairlines are
          inert pseudo-elements and only the centred tab acts. */}
      <div className={styles.timelineSeam}>
        <button
          type="button"
          className={styles.seamBtn}
          aria-expanded={open}
          aria-controls={PANEL_ID}
          onClick={onToggle}
          title={open ? "hide the timeline" : "show the timeline"}
          // The full sentence, and it is NOT the title: while the strip is shut
          // this name is the only thing that says a cut is in force, and a cut
          // silently changes what REPLAY plays and what both animated exports
          // write. `timeline.seamSaid` builds it and `test/timeline.test.ts`
          // holds it to that.
          aria-label={seamSaid(open, steps, at, span)}
        >
          <span className={styles.seamTab} aria-hidden="true">
            {/* The chevron points where the panel WILL GO, not where it is.
                See `CHEVRON_DOWN` for why that is the convention and what
                `aria-expanded` is left to say instead. */}
            <Glyph d={open ? CHEVRON_UP : CHEVRON_DOWN} />
          </span>
        </button>
      </div>

      {/* The slide. Height and visibility only — the strip inside it is exactly
          the strip that was in the rail, unchanged. `visibility` is what takes
          the rail, the marks and the PLAYHEAD button out of the Tab order while
          it is shut; `max-height` alone would leave four focusable controls in a
          zero-height box, which is a keyboard trap that scrolls a clipped
          container. `.timelineSlide` carries the timing and the reduced-motion
          exemption. */}
      <div
        id={PANEL_ID}
        className={styles.timelineSlide}
        data-open={open ? "on" : "off"}
      >
        <div
          className={styles.timeline}
          data-live={live ? "on" : undefined}
          style={
            {
              "--tl-at": `${railPercent(pos, steps ?? 0)}%`,
              "--tl-in": `${bandFrom}%`,
              "--tl-out": `${bandTo}%`,
            } as React.CSSProperties
          }
        >
          <div className={styles.timelineHead}>
            <span className={styles.timelineKey}>timeline</span>
            <span className={styles.timelineNow}>
              {live ? (
                at === null ? (
                  "before step 0"
                ) : (
                  <>
                    step <b>{at}</b> / {steps - 1}
                  </>
                )
              ) : steps === 0 ? (
                "no step in this frame"
              ) : (
                `${acts} gesture${acts === 1 ? "" : "s"}`
              )}
            </span>
          </div>

          <div className={styles.timelineRow}>
            {live ? (
              <>
                <button
                  type="button"
                  className={styles.timelineBtn}
                  onClick={() => view.onSeek(pos - 1)}
                  disabled={pos <= -1}
                  title="one step back"
                  aria-label="move the playhead one step back"
                >
                  <Glyph d={STEP_BACK} />
                </button>

                {/* The rail. A real range input, so the whole keyboard works on it
                    without a handler; the marks and the band between them are drawn
                    UNDER it from `--tl-in`/`--tl-out` and take no pointer events, so
                    the only thing on this track that can be grabbed is the thumb. */}
                <span className={styles.timelineRail}>
                  <span className={styles.timelineBand} aria-hidden="true" />
                  {cut && (
                    <>
                      <span className={styles.timelineMarkIn} aria-hidden="true" />
                      <span className={styles.timelineMarkOut} aria-hidden="true" />
                    </>
                  )}
                  <input
                    type="range"
                    className={styles.timelineScrub}
                    min={-1}
                    max={steps - 1}
                    step={1}
                    value={pos}
                    onChange={(e) => view.onSeek(Number(e.target.value))}
                    aria-label="playhead — the animation step the plate is showing"
                    aria-valuetext={
                      at === null
                        ? `before step 0 — the plate the replay opens on, ${steps} step${
                            steps === 1 ? "" : "s"
                          } to come`
                        : `step ${at} of ${steps - 1}${
                            // GATED ON `cut`, not on `spanCovers` alone. With no
                            // marks set `span` is null and `spanCovers` is false for
                            // every step — correctly, since a null span covers
                            // nothing — so an ungated test announced every beat of
                            // an uncut drawing as "outside the in and out points".
                            // There are no in and out points to be outside of until
                            // there is a cut.
                            !cut || spanCovers(span, at)
                              ? ""
                              : " — outside the in and out points"
                          }`
                    }
                  />
                </span>

                <button
                  type="button"
                  className={styles.timelineBtn}
                  onClick={() => view.onSeek(pos + 1)}
                  disabled={pos >= steps - 1}
                  title="one step on"
                  aria-label="move the playhead one step on"
                >
                  <Glyph d={STEP_ON} />
                </button>
              </>
            ) : (
              <button
                type="button"
                className={styles.timelineOpen}
                onClick={view.onOpen}
                disabled={acts === 0}
                title={
                  acts === 0
                    ? "nothing to play — no gesture has been committed yet"
                    : "stand the playhead up — counts this frame's steps and opens the preview"
                }
                aria-label={
                  acts === 0
                    ? "no playhead — no gesture has been committed yet"
                    : `open the timeline — count this frame's animation steps over ${acts} committed gesture${
                        acts === 1 ? "" : "s"
                      } and stand the playhead up as a preview`
                }
              >
                playhead
              </button>
            )}
          </div>

          {/* THE MARKS. Beside the rail rather than on it, for the reason in the
              header: at this width a mark cannot be dragged onto a chosen beat, so
              it is set where the playhead already stands. */}
          <div className={styles.timelineMarks} role="group" aria-label="in and out points">
            <button
              type="button"
              className={styles.timelineBtn}
              onClick={view.onMarkIn}
              disabled={!live || at === null}
              title="in point here — everything before it is already on the plate"
              aria-label="set the in point at the playhead; every earlier step is folded into the first frame"
            >
              <Glyph d={MARK_IN} />
            </button>
            <button
              type="button"
              className={styles.timelineBtn}
              onClick={view.onMarkOut}
              disabled={!live || at === null}
              title="out point here — nothing after it is shown"
              aria-label="set the out point at the playhead; no later step is shown at all"
            >
              <Glyph d={MARK_OUT} />
            </button>
            <button
              type="button"
              className={styles.timelineBtn}
              onClick={view.onClearMarks}
              disabled={span === null}
              title="clear the cut — play the whole drawing again"
              aria-label="clear the in and out points; the replay plays the whole drawing again"
            >
              <Glyph d={CUT_OFF} />
            </button>
            <span className={styles.timelineSaid} data-cut={cut ? "on" : undefined}>
              {said ?? (span === null ? "whole" : `in ${span.in}, out ${span.out}`)}
            </span>
          </div>
        </div>
      </div>
    </>
  );
}

function Row({
  row,
  book,
  selected,
  frozen,
  editing,
  field,
  onSelect,
  onToggleVisible,
  onToggleLocked,
  onEdit,
  onCommit,
  onCopy,
  onPaste,
}: {
  row: PanelRow;
  book: AddressBook;
  selected: boolean;
  frozen: boolean;
  editing: boolean;
  field: React.RefObject<HTMLInputElement | null>;
  onSelect: (id: LayerId | null) => void;
  onToggleVisible: (id: LayerId) => void;
  onToggleLocked: (id: LayerId) => void;
  onEdit: (id: LayerId | null) => void;
  onCommit: (id: LayerId, name: string) => void;
  onCopy: (layer?: LayerId) => void;
  onPaste: (into: LayerId | null) => void;
}) {
  const { layer, depth, own, effective, group, spine } = row;
  const cells = layerCells(layer, book);
  const swatches = [...new Set(layer.plate.values())].sort().slice(0, 6);
  /**
   * The INHERITED refusal, in the layer model's own words — and the glyph that
   * goes with it, decided HERE rather than beside the badge.
   *
   * The two were computed apart and immediately disagreed: a layer hidden by its
   * own switch AND sitting inside a locked parent said "inside a locked layer"
   * while drawing a crossed-out eye. One value, so the sentence and the picture
   * cannot come from different questions.
   */
  const inherited: { said: string; glyph: string } | null =
    !effective.shown && own.visible
      ? { said: "inside a hidden layer", glyph: EYE_SHUT }
      : !effective.editable && !own.locked
      ? { said: "inside a locked layer", glyph: LOCK_SHUT }
      : null;

  return (
    <li
      className={`${styles.layerRow} ${selected ? styles.layerRowOn : ""} ${
        effective.shown ? "" : styles.layerRowOff
      }`}
      data-depth={depth}
    >
      {/* One hairline per ancestor level. See the header: the count IS the
          depth, and a level whose siblings are exhausted draws nothing, so a
          subtree closes instead of trailing away. */}
      <span className={styles.layerGuides} aria-hidden="true">
        {spine.map((run, k) => (
          <span
            key={k}
            className={`${styles.layerGuide} ${run ? "" : styles.layerGuideEnd}`}
          />
        ))}
        {depth > 0 && <span className={styles.layerTick} />}
      </span>

      {/* The layer's OWN colours, ascending — see `layers.coloursOf`. A row
          that says what is on it is a row you do not have to hide the others to
          identify, which at depth is most of the panel's job. */}
      <span
        className={styles.layerInk}
        aria-hidden="true"
        data-empty={swatches.length === 0 ? "" : undefined}
      >
        {swatches.map((hex) => (
          <span key={hex} style={{ background: hex }} />
        ))}
      </span>

      {editing ? (
        <input
          ref={field}
          className={styles.layerName}
          defaultValue={layer.name}
          aria-label={`rename ${layer.name}`}
          onBlur={(e) => onCommit(layer.id, e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onCommit(layer.id, e.currentTarget.value);
            }
            if (e.key === "Escape") {
              e.preventDefault();
              onEdit(null);
            }
            e.stopPropagation();
          }}
        />
      ) : (
        <button
          type="button"
          className={styles.layerPick}
          aria-pressed={selected}
          onClick={() => onSelect(selected ? null : layer.id)}
          onDoubleClick={() => onEdit(layer.id)}
          onKeyDown={(e) => {
            if (e.key === "F2") {
              e.preventDefault();
              onEdit(layer.id);
            }
          }}
          title={`${layer.name} — ${cells} cell${cells === 1 ? "" : "s"} of its own${
            group
              ? `, ${layer.children.length} sub-layer${
                  layer.children.length === 1 ? "" : "s"
                }`
              : ""
          }${inherited === null ? "" : `, ${inherited.said}`}. Double-click or F2 to rename`}
          aria-label={`${layer.name}, ${
            depth === 0 ? "top level" : `nested ${depth} deep`
          }, ${cells} cell${cells === 1 ? "" : "s"}${
            group ? `, ${layer.children.length} sub-layers` : ""
          }${inherited === null ? "" : `, ${inherited.said}`}${
            own.visible ? "" : ", hidden"
          }${own.locked ? ", locked" : ""}${selected ? " — selected" : ""}`}
        >
          <span className={styles.layerLabel}>{layer.name}</span>
          {/* THE INHERITED STATE IS A BADGE, not a sentence.
              It was the sentence — "inside a locked layer", in the slot the
              cell count uses — and at the width a rail column actually has it
              squeezed every name down to one letter and an ellipsis. A row
              whose name is unreadable is worse than a row that says less. So
              the badge is the parent's own glyph, ghosted, and the sentence is
              on the tooltip and in the accessible name, where it is read in
              full and costs no width at all. */}
          {inherited !== null && (
            <span className={styles.layerFrom} aria-hidden="true">
              <Glyph d={inherited.glyph} />
            </span>
          )}
          <span className={styles.layerStat}>{cells === 0 ? "—" : cells}</span>
        </button>
      )}

      <span className={styles.layerActs}>
        <button
          type="button"
          className={styles.layerAct}
          aria-pressed={own.locked}
          onClick={() => onToggleLocked(layer.id)}
          title={
            own.locked
              ? `unlock ${layer.name}`
              : `lock ${layer.name} — the brush will refuse it`
          }
          aria-label={`${own.locked ? "unlock" : "lock"} ${layer.name}${
            !effective.editable && !own.locked
              ? " — it is also inside a locked layer"
              : ""
          }`}
        >
          <Glyph d={own.locked ? LOCK_SHUT : LOCK_OPEN} />
        </button>
        <button
          type="button"
          className={styles.layerAct}
          aria-pressed={!own.visible}
          onClick={() => onToggleVisible(layer.id)}
          title={own.visible ? `hide ${layer.name}` : `show ${layer.name}`}
          aria-label={`${own.visible ? "hide" : "show"} ${layer.name}${
            !effective.shown && own.visible
              ? " — it is also inside a hidden layer"
              : ""
          }`}
        >
          <Glyph
            d={own.visible ? EYE_OPEN : EYE_SHUT}
            extra={own.visible ? EYE_PUPIL : undefined}
          />
        </button>
        <button
          type="button"
          className={styles.layerAct}
          onClick={() => onCopy(layer.id)}
          title={`copy ${layer.name} and everything under it`}
          aria-label={`copy ${layer.name} and everything under it to the clipboard`}
        >
          <Glyph d={COPY} />
        </button>
        <button
          type="button"
          className={styles.layerAct}
          onClick={() => onPaste(layer.id)}
          disabled={frozen}
          title={`paste into ${layer.name}, as one sub-layer`}
          aria-label={`paste the clipboard into ${layer.name}, grafted as one sub-layer keeping its own children`}
        >
          <Glyph d={PASTE} />
        </button>
      </span>
    </li>
  );
}
