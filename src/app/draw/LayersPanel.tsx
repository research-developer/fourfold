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
