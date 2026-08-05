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
  focusFrame,
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
import { ARMS, clipStamp, type Isolation } from "@/lib/arms";
import {
  ROOT,
  STEP_LABEL,
  armResolver,
  armStep,
  clipMask,
  enter,
  exit,
  exitTo,
  focusCells,
  focusedArm,
  focusedSector,
  gestureFor,
  gestureIds,
  hexagonDeeper,
  pathLabel,
  samePath,
  scopeFor,
  sectorResolver,
  sectorStep,
  seedMask,
  type FocusPath,
  type FocusResolvers,
  type FocusStep,
} from "@/lib/focus";
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
  planPlateEdits,
  plateEntries,
  plateFromArtPayload,
  plateIntoSector,
  resolvePlate,
  type Address,
  type AddressBook,
  type PlateEdit,
} from "@/lib/plate";
import {
  BAND_FAMILIES,
  buildBandSurface,
  sectorBandFamily,
  type BandFamily,
  type BandSurface,
} from "@/lib/bands";
import {
  applyAffine,
  plateFrame,
  pointsOf,
  wrapSector,
  type Affine,
  type PlateView,
} from "@/lib/view";
import {
  activeProgression,
  BAND_NOTE,
  brushSpan,
  brushStamp,
  defaultDragMode,
  eventCount,
  progressionIndex,
  stampColours,
  TOOLS,
  upcomingBases,
  type DragMode,
  type Tool,
} from "@/lib/brush";
import { buildFigure, type Convention } from "@/lib/figure";
import { buildHexagon, type Hexagon } from "@/lib/hexagon";
import {
  EMPTY_PROPOSAL,
  proposalHolds,
  proposeSeed,
  seedStamp,
  stampGroups,
  unionCells,
  type Proposal,
} from "@/lib/propose";
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
import {
  ALT_REST,
  SHORTCUTS,
  altDeclined,
  altDown,
  altLost,
  altUp,
  shapeAlt,
  type AltState,
} from "@/lib/shortcuts";
import {
  hexagonSurface,
  BRUSH_SCOPES,
  SCOPE_LABEL,
  SCOPE_MODES,
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
  animatedSvg,
  animationCensus,
  animationSteps,
  animationTiming,
  boundAnimation,
  type AnimationStep,
  type InOut,
} from "@/lib/replay";
import {
  actAtStep,
  beatsOf,
  GROUND,
  markIn,
  markOut,
  spanSaid,
  stepAtAct,
  type Beats,
} from "@/lib/timeline";
import { gifSteps } from "@/lib/gif";
import {
  act as journalAct,
  addLayer,
  arrange as arrangeLayer,
  census,
  clearLayer,
  demote,
  effectiveOf,
  emptyComposition,
  find as findLayer,
  flatten as flattenComposition,
  fromPlate,
  gestureOf,
  graft,
  layerId,
  newSession,
  paintInto,
  paintTarget,
  pasteInto,
  promote,
  redo as redoSession,
  removeLayer,
  renameLayer,
  select as selectLayer,
  soleLayer,
  switchesOf,
  toggleLocked,
  toggleVisible,
  undo as undoSession,
  type Composition,
  type Layer,
  type LayerGesture,
  type LayerId,
  type Outcome,
  type Session,
  type Switches,
} from "@/lib/layers";
import {
  actStrokes,
  clampAct,
  emitLayersOf,
  eventsOf,
  everyComposition,
  revertMoves,
  stackFromEmit,
  stepComposition,
} from "@/lib/composer";
import { parse as parseEmit, serialise as serialiseEmit } from "@/lib/emit";
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
  exportName,
  mergeEdits,
  type StrokeMark,
} from "@/lib/strokes";
import BrushDial from "./BrushDial";
import ColourWell from "./ColourWell";
import LayersPanel from "./LayersPanel";
import SectorDial, { SectorGlyph } from "./SectorDial";
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
 * ── One model, two views ────────────────────────────────────────────────
 *
 * There used to be two canvases with two INCOMPATIBLE ADDRESS SPACES — the
 * triangle's `ABX` and the hexagon's `s3:ABX` — so switching between them threw
 * the drawing away, behind a guard, because nothing painted on one named
 * anything on the other. There is one model now: the hexagon, always, addressed
 * `s0:` … `s5:`. The triangle is a VIEW of it.
 *
 * That is not an approximation and it is not a new construction. `buildHexagon`
 * builds every sector by applying an exact integer lattice rotation to
 * `buildFigure(depth, convention)`, and sector 0 applies the identity — so the
 * sector view at depth d is the old triangle canvas cell for cell, address for
 * address, in the same order. `test/view.test.ts` asserts it rather than saying
 * it. The sector's own D₃ is the SECTOR brush scope, which `orbit.ts` already
 * had; a triangle row is a hexagon band clipped to a sector, still 2r+1 cells
 * wide; the arm isolation nests inside a sector instead of replacing it.
 *
 * So CHANGING THE VIEW DESTROYS NOTHING. It frames a different region of one
 * plate. The only destructive control left on the page is NEW.
 *
 * The sector view rotates in the RENDER LAYER only — see `view.ts`. Turning the
 * lattice instead would change every exact integer key, and with it every band,
 * every orbit, every ring and every address in the file.
 *
 * ── What the sector view gains that the standalone triangle could not ────
 *
 * The relief. It was hexagon-only because on a bare triangle the height field
 * H = |band_A| + |band_B| + |band_C| is FLAT — measured, two values at every
 * depth — so there was nothing to curve. A sector of the hexagon carries the
 * HEXAGON's H, whose bands run across the seams, and it takes 2^(d+1) − 1
 * distinct values inside one sector: 31 at depth 4 against the triangle's 2.
 * So the toggle is offered in both views now, and `test/view.test.ts` measures
 * the spread rather than asserting it.
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
 * ONE list now, because there is one model. `artfile.ts` refuses to load a plate
 * deeper than a button here can select, so the two cannot drift — a second copy
 * of these numbers would be a way for a file to become loadable but not
 * selectable.
 *
 * ── What depth 5 costs, measured rather than guessed ────────────────────
 *
 * The old triangle went to depth 5, 1024 cells, and the hexagon stopped at 4.
 * Unified, depth 5 is 6·4^5 = 6144 cells in the model, and the ceiling had to
 * rise to 5 or every depth-5 triangle file ever exported would have become
 * unreadable — see `MAX_DEPTH` in `artfile.ts`.
 *
 * `test/view.test.ts` measures the model at that size: the build is ~2.5 ms, the
 * band and lattice tables ~1.5 ms, the twelve D₆ index maps and their orbit
 * table ~6 ms, a relief frame ~3 ms, and one brush application through the
 * address plate ~0.7 ms. Every one of those is a fraction of a frame and none
 * of them is the reason to hesitate.
 *
 * The DOM is. The board draws one polygon per cell in the tiling layer and one
 * in the transparent hit layer, so a depth-5 HEXAGON view is 12 288 nodes where
 * the old maximum was 3072. The sector view is 2048 — the same as the old
 * triangle at depth 5, exactly, because it is the old triangle at depth 5.
 *
 * So the ceiling is 5 and it is not capped further, on the grounds that the
 * expensive case is one view of one depth, it is reached by a deliberate press,
 * and the layers are memoised so the cost is paid on arrival rather than per
 * stroke. What IS done about it is the frame: the sector view renders only the
 * sector, so the deep end of the program is affordable in the view that most
 * wants it.
 */
const DEPTHS: number[] = Array.from(
  { length: MAX_DEPTH.hexagon - MIN_DEPTH + 1 },
  (_, k) => MIN_DEPTH + k
);

/**
 * A hairline that stays a hairline from 6 cells to 6144 of them.
 *
 * `edge` comes from the view rather than from the depth alone: the sector view
 * doubles the plate to fill the triangle canvas, so its cells are twice the
 * size the same depth draws at in hexagon view and its seam has to be too.
 */
const seamAt = (edge: number) => Math.min(2.4, Math.max(0.4, edge * 0.022));

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

/**
 * How many files one IMPORT will take.
 *
 * A bound rather than a policy: the picker is `multiple` because a person with
 * four layers in four files should not have to press it four times, and a
 * directory dropped by accident should not graft two thousand sub-layers into
 * the drawing before anyone can press undo. Sixteen is the number `layers.ts`
 * measures as interactive at depth 5 — see `flatten` — so this is the same
 * number the composite is budgeted against rather than a second opinion.
 */
const MAX_IMPORT = 16;

/** Zoom stops. Powers of two, so the plate lands on the same pixels each time. */
const ZOOM_MAX = 8;

/**
 * How long the drill-in zoom takes, in milliseconds.
 *
 * SHORT ON PURPOSE. The transition is not decoration: with the plate zoomed and
 * five sixths of it dulled in one frame, there is nothing on screen that says
 * the new picture is a part of the old one, and a person who looks away for the
 * length of a click comes back to what reads as a different drawing. The travel
 * is the sentence "this came from there". 180 ms is long enough to be seen as
 * motion and short enough that nobody waits for it.
 *
 * `prefers-reduced-motion` skips it entirely; see `easeFocus`.
 */
const FOCUS_MS = 180;

/**
 * How long a replay holds each gesture, in milliseconds.
 *
 * The range is set by the two things a replay is for. At the fast end it has to
 * read as a DRAWING happening — 80 ms is about five gestures a second, which is
 * roughly the rate a hand actually works at, and anything quicker stops being
 * legible as separate strokes. At the slow end it has to be usable as a
 * teaching pace: 1200 ms is long enough to say what a gesture did before the
 * next one lands. 250 ms is the default because it replays a fifty-gesture
 * drawing in twelve and a half seconds, which is long enough to follow and
 * short enough to sit through twice.
 *
 * The SAME number is written into the exported animation, so the control is a
 * preview of the file rather than a separate setting that happens to look like
 * one.
 */
const STEP_MS: readonly number[] = [80, 150, 250, 400, 700, 1200] as const;
const STEP_MS_DEFAULT = 250;

/**
 * How long the finished plate holds before the exported animation loops, and
 * how long a gesture takes to come up.
 *
 * BOTH ARE DERIVED from the step length and the number of gestures rather than
 * fixed here, because a fixed 90 ms fade is longer than the fastest 80 ms step
 * — every reveal overlapping the next — and a fixed 1.8 s hold is 63% of a
 * thirteen-gesture loop at 80 ms and 7% of a hundred-gesture loop at 250 ms.
 * `replay.animationTiming` owns the rule, and the SVG and the GIF both read it,
 * so the two exports cannot disagree about how long anything lasts.
 */

/**
 * The widths a GIF may be written at, and why the plate's own is not among them.
 *
 * The hexagon canvas is 1048 pixels across. A GIF is uncompressed pixels behind
 * an LZW stream, so the file goes as the AREA: the same drawing measured here
 * is 21 kB at 320 and 96 kB at 1024, and a 256-gesture plate is 98 kB against
 * 388 kB. So the size is a real choice rather than a detail, and it is offered
 * rather than decided.
 *
 * 512 is the default because it is the size at which a depth-4 cell is still
 * several pixels across — the seam that shows the tiling survives, which is the
 * thing that stops the plate reading as a flat block. Below 320 a depth-5 cell
 * is under a pixel and the drawing becomes its own thumbnail; the export still
 * works and says so, and nobody should have to find that out by trying.
 */
const GIF_WIDTHS: readonly number[] = [320, 512, 768, 1024] as const;
const GIF_WIDTH_DEFAULT = 512;

/** Past this many gestures the scrub ticks stop being a scale and become a fill. */
const TICK_LIMIT = 64;

/** The board's handlers, switched off while a preview is standing. */
const NOTHING = () => {};

/**
 * "No proposal is standing", as one shared array.
 *
 * Module scope rather than a fresh `[]` per render, so the board's `candidate`
 * prop keeps its identity across every render in which nothing is proposed and
 * the ghost layer does not re-render for a pointer that is merely moving. Same
 * reasoning as `propose.EMPTY_PROPOSAL`, one level up the pipe.
 */
const NO_SPECS: readonly PreviewSpec[] = [];

function TransportGlyph({ playing }: { playing: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className={styles.toolGlyph} aria-hidden="true">
      {playing ? (
        <>
          <rect x={4} y={3} width={3.2} height={10} fill="currentColor" />
          <rect x={8.8} y={3} width={3.2} height={10} fill="currentColor" />
        </>
      ) : (
        <polygon points="4,3 13,8 4,13" fill="currentColor" />
      )}
    </svg>
  );
}

/**
 * A preview of a state the drawing is no longer in.
 *
 * REPLAY and HISTORY are ONE state and not two, which is the whole of how they
 * are stopped from fighting: they are the same question — what did the plate
 * look like after gesture n? — asked by a timer and asked by a hand. Opening
 * one while the other stands simply changes `kind`, so there is no moment where
 * two previews disagree about what is on the plate, and every guard in the page
 * has one thing to test rather than two.
 *
 * `plate` is a reconstructed ADDRESS plate, held here rather than derived on
 * every render: stepping it is O(one gesture), and rebuilding it from the base
 * each render would be O(the whole history).
 */
interface Rewind {
  kind: "replay" | "history";
  /** Committed acts applied. 0 is the state the journal began from. */
  index: number;
  /**
   * The whole COMPOSITION at that state, not a plate.
   *
   * It was an `AddressPlate` while the drawing was one, and it has to be a tree
   * now for the reason `layers.ts` gives for never merging plates: a preview
   * built by flattening first would show a lower layer's fine detail punching
   * through an upper layer's wash. Reconstructed by `composer.stepComposition`,
   * which is exact in both directions, and flattened for the board exactly
   * where the live composition is.
   */
  comp: Composition;
  playing: boolean;
  /**
   * The beat list this preview's PLAYHEAD reads — which act produced each
   * animation step, in the frame that was on screen when the preview opened.
   *
   * IT RIDES ON THE PREVIEW rather than beside it, and that is what makes it
   * safe to hold at all. Counting the beats means flattening every state of the
   * journal — measured at ~205 ms for a depth-5 plate with 256 acts, and it does
   * not cache, because `everyComposition` mints fresh compositions on every call
   * — so it cannot be kept warm across strokes. It does not have to be: the
   * brush is switched off while a preview stands (`previewing` gates every
   * write), so the journal this was counted from cannot move underneath it.
   *
   * `frame` is the one thing that CAN change while a preview is up — the depth,
   * the view and the sector are not gated on `previewing` — so it is recorded
   * and compared rather than trusted. A stale frame closes the playhead rather
   * than reporting a step count for a picture nobody is looking at; see
   * `frameKey` and `standPlayhead`.
   */
  beats: Beats;
  frame: string;
}

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

/**
 * `prefers-reduced-motion`, read the same way `(pointer: coarse)` is.
 *
 * A store rather than a one-shot read for the same reason that one is: the
 * setting can change while the page is open — macOS's Reduce Motion is a switch
 * in the accessibility pane, not a boot flag — and a value sampled once would
 * leave the drill-in animating for someone who has just asked it not to.
 *
 * FALSE ON THE SERVER, which is the same lie `coarseOnServer` tells and for the
 * same reason: there is no media query in a render that has no window, and the
 * first client render corrects it before anything can move. Nothing animates
 * during hydration, so the wrong value is never acted on.
 */
const subscribeMotion = (onChange: () => void) => {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
};
const motionNow = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const motionOnServer = () => false;

interface Canvas {
  /** The model. Always the hexagon; the view says which part is drawn. */
  hex: Hexagon;
  view: PlateView;
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
   * The BASE triangle's lattice, for one readout and nothing else.
   *
   * "Row r from the apex" is a triangle fact — `rowOf` returns −1 on the hexagon,
   * which has no apex — and it is the sentence the sector view wants, because a
   * sector IS the base triangle. 4^d cells to build against the model's 6·4^d.
   */
  baseLattice: LatticeView;
  /** Model pixels → the pixels on screen. The identity in hexagon view. */
  toView: Affine;
  fromView: Affine;
  /** The cells this view draws, ascending. */
  shown: number[];
  /** Whether a cell is in the frame. An array lookup, not a search. */
  inView: (i: number) => boolean;
}

const TOOL_LABEL: Record<Tool, string> = {
  paint: "lay the scheme's colours on the orbit",
  erase: "clear the orbit back to bare tiling",
  adjust: "transform the colour already there",
};

/**
 * The console's icon family, drawn here and nowhere else.
 *
 * ONE grid (16×16), ONE stroke weight (1.6), ONE colour (`currentColor`), and
 * every glyph inline in this file. Inline because the page ships under a strict
 * CSP and an icon font or a CDN sprite would be a network origin the drawing
 * program does not otherwise need; `currentColor` because every state the
 * buttons already have — pressed, hover, disabled, focus — is expressed as a
 * text colour, and a glyph that inherits it keeps all four for free rather than
 * needing a second set of rules.
 *
 * 16 rather than 24 so the numbers below are the same numbers a reader sees.
 *
 * THE SIZE, and why the weight moved with it. The strip rendered at 13px, where
 * the family's 1.6-unit stroke lands on 1.3 device pixels — the console's own
 * hairline — and a reviewer read the whole deck as too small to aim at. It is
 * 18px now, which is 92% more glyph area and a 30px row a thumb can find.
 *
 * A stroke measured on the GRID scales with the glyph, so 1.6 at 18px would
 * have been 1.8 device pixels: not "the same weight bigger" but a third
 * heavier, and beside 1px rules the family stopped looking drawn and started
 * looking bold. 1.5 at 18px is 1.69 device pixels — still visibly heavier than
 * the 1.3 it was, because a bigger glyph at the SAME absolute weight reads
 * thinner, and at a 12:1 size-to-stroke ratio, which is where a line-icon
 * family sits before it turns into a logo. Judged against the screenshot, not
 * against the arithmetic.
 *
 * `weight` is the one exception, for the two DRAG glyphs: they are the same
 * triangle told apart by nothing but solid ink against dotted, and a dotted
 * stroke reads lighter than a solid one of the same width, so both had to go up
 * for the dotted one to survive at all.
 */
function Glyph({
  children,
  filled,
  weight = 1.5,
}: {
  children: React.ReactNode;
  /** Some glyphs are solid shapes; those set their own `fill` and clear stroke. */
  filled?: boolean;
  /** Grid units. Only DRAG departs from the family's 1.5. */
  weight?: number;
}) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={styles.icon}
      aria-hidden="true"
      focusable="false"
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"}
      strokeWidth={weight}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

/**
 * The three brushes.
 *
 * The triangle is the figure's own atom, so PAINT is a filled one; ADJUST is a
 * disc half-turned, which is what an adjustment does to a colour that is
 * already down — it does not add and it does not remove.
 *
 * ERASE is an ERASER, and it took a review to get there. It was a dashed
 * triangle struck through, which is a picture of "no triangle" — the negation
 * of the paint glyph rather than the tool that performs it, and next to a
 * filled triangle and a half disc it read as a third statement about triangles.
 * A block eraser is the thing itself: an oblong tilted on the diagonal the rest
 * of the family already leans on, its nib filled because a used rubber is
 * darker than its holder and because fill is a word this family already speaks
 * (PAINT is filled, ADJUST is half filled), resting on the line it is clearing.
 * Nothing here is a metaphor for erasing; it is a drawing of an eraser.
 */
function ToolGlyph({ tool }: { tool: Tool }) {
  if (tool === "paint") {
    return (
      <Glyph filled>
        <polygon points="8,2.5 14.5,13.5 1.5,13.5" />
      </Glyph>
    );
  }
  if (tool === "erase") {
    return (
      <Glyph>
        <polygon points="3.29,9.49 5.55,7.23 8.87,10.56 6.61,12.82" fill="currentColor" stroke="none" />
        <polygon points="9.79,2.99 13.12,6.31 6.61,12.82 3.29,9.49" />
        <line x1={5.55} y1={7.23} x2={8.87} y2={10.56} />
        <line x1={2.6} y1={14.1} x2={13.4} y2={14.1} />
      </Glyph>
    );
  }
  return (
    <Glyph>
      <circle cx={8} cy={8} r={5.7} />
      <path d="M8 2.3 A5.7 5.7 0 0 1 8 13.7 Z" fill="currentColor" stroke="none" />
    </Glyph>
  );
}

/**
 * WHICH cells, as three figures rather than three words.
 *
 * FREE is a hand's line. LINE is a segment between two anchors, drawn on a
 * lattice diagonal rather than square-on, because a lattice row is never
 * horizontal. RING is a HEXAGON and not a circle, and that is not decoration:
 * the ring is a level set of the exact hexagonal norm about the plate's centre,
 * so a circular glyph would be a picture of a shape this program cannot draw.
 */
function ShapeGlyph({ shape }: { shape: ShapeTool }) {
  if (shape === "free") {
    return (
      <Glyph>
        <path d="M2.2 10.6 C 4.4 3.6, 6.4 12.8, 8.6 8.2 S 12.4 3.4, 13.8 7.4" />
      </Glyph>
    );
  }
  if (shape === "line") {
    return (
      <Glyph>
        <line x1={3.6} y1={12.4} x2={12.4} y2={3.6} />
        <circle cx={3.6} cy={12.4} r={2} fill="currentColor" stroke="none" />
        <circle cx={12.4} cy={3.6} r={2} fill="currentColor" stroke="none" />
      </Glyph>
    );
  }
  return (
    <Glyph>
      <polygon points="8,1.8 13.6,5 13.6,11 8,14.2 2.4,11 2.4,5" />
      <circle cx={8} cy={8} r={1.4} fill="currentColor" stroke="none" />
    </Glyph>
  );
}

/**
 * What a DRAG does: one solid stroke, one dotted — and both of them the
 * TRIANGLE, as the second review asked.
 *
 * The geometry is identical and only the ink differs, which is the whole of the
 * distinction: PROPOSE lays the same cells PAINT would and holds them as a
 * ghost until they are tapped. It was a bare diagonal, and a bare diagonal is a
 * mark rather than a thing — the triangle is the figure's own atom, the same
 * outline PAINT fills in, so a dotted one says "these cells, not yet" in the
 * page's own vocabulary instead of in a private one.
 *
 * 1.9 against the family's 1.5. Round caps and a period the 36.28-unit
 * perimeter divides into almost exactly fourteen, so the dots are dots, the
 * seam where the pattern closes does not land as a gap at a corner, and there
 * are enough of them that the eye joins them into a triangle rather than
 * reading a scatter. Eleven dots was the first try and it read as confetti.
 */
function DragGlyph({ mode }: { mode: DragMode }) {
  return (
    <Glyph weight={1.9}>
      <polygon
        points="8,3 14.2,13.2 1.8,13.2"
        strokeDasharray={mode === "propose" ? "0.1 2.49" : undefined}
      />
    </Glyph>
  );
}

/**
 * The action glyphs.
 *
 * UNDO and REDO are the one mirrored pair the strip needs to be read as a pair.
 * REPLAY is a transport — the same play triangle the replay bar's own button
 * uses, so the control and the thing it opens are drawn the same. HISTORY is a
 * CLOCK, and the two sit one above the other on purpose: same ring, and what is
 * inside it is the whole difference. A triangle is a thing that is about to
 * happen; hands are a thing that already has. It was drawn as a scrub first,
 * because a scrub is what the button opens, and at 13px the ticks read as a bar
 * chart — the glyph has to survive the size it is used at, not the size it is
 * designed at. SAVE and LOAD share a tray and differ only in which way the arrow runs,
 * so the pair reads as one idea with a direction rather than as two icons.
 */
type ActionIcon = "undo" | "redo" | "replay" | "history" | "save" | "load";

function ActionGlyph({ name }: { name: ActionIcon }) {
  switch (name) {
    case "undo":
      return (
        <Glyph>
          <path d="M5.8 10.2 A4.2 4.2 0 1 0 10 6 H 4" />
          <polyline points="6.4,3.6 4,6 6.4,8.4" />
        </Glyph>
      );
    case "redo":
      return (
        <Glyph>
          <path d="M10.2 10.2 A4.2 4.2 0 1 1 6 6 H 12" />
          <polyline points="9.6,3.6 12,6 9.6,8.4" />
        </Glyph>
      );
    case "replay":
      return (
        <Glyph>
          <circle cx={8} cy={8} r={5.9} />
          <polygon points="6.5,4.9 11.3,8 6.5,11.1" fill="currentColor" stroke="none" />
        </Glyph>
      );
    case "history":
      return (
        <Glyph>
          <circle cx={8} cy={8} r={5.7} />
          <polyline points="8,4.4 8,8 11.3,8" />
        </Glyph>
      );
    case "save":
      return (
        <Glyph>
          <line x1={8} y1={2.2} x2={8} y2={9.6} />
          <polyline points="5.3,6.9 8,9.6 10.7,6.9" />
          <polyline points="2.6,10.9 2.6,13.6 13.4,13.6 13.4,10.9" />
        </Glyph>
      );
    case "load":
      return (
        <Glyph>
          <line x1={8} y1={9.6} x2={8} y2={2.2} />
          <polyline points="5.3,4.9 8,2.2 10.7,4.9" />
          <polyline points="2.6,10.9 2.6,13.6 13.4,13.6 13.4,10.9" />
        </Glyph>
      );
  }
}

/** The one thing that says "there is a list under this button". */
function MenuCaret() {
  return (
    <svg
      viewBox="0 0 16 16"
      className={styles.caret}
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="3.5,6 8,10.5 12.5,6" />
    </svg>
  );
}

/**
 * A key, drawn as a key.
 *
 * ONE chip, used in both places the program prints a chord: the lines under the
 * plate and the `?` panel's key column. The panel used to print its chords as
 * bare letter-spaced text and the footnote used `<b>`, which is two dialects for
 * one idea and neither of them a keycap — a reader scanning for "which key" had
 * to read the sentence to find out. A `<kbd>` with a doubled bottom border is
 * the whole trick: it reads as a thing that can be pressed at a glance, and it
 * is the SAME chip in both, so the panel and the footnote cannot drift apart.
 */
function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className={styles.kbd}>{children}</kbd>;
}

/**
 * The strip, spelled out in the shortcut panel.
 *
 * An icon that has to be hovered to be understood is a word nobody can read, so
 * every glyph in the plate rule is also printed here beside its name — the same
 * component, so the panel cannot come to describe a strip that no longer exists.
 */
const GLYPH_LEGEND: readonly { icon: React.ReactNode; what: string }[] = [
  { icon: <ToolGlyph tool="paint" />, what: "paint — lay the scheme's colours" },
  { icon: <ToolGlyph tool="erase" />, what: "erase — back to bare tiling" },
  { icon: <ToolGlyph tool="adjust" />, what: "adjust — transform what is there" },
  { icon: <ShapeGlyph shape="free" />, what: "free — every cell the pointer crosses" },
  { icon: <ShapeGlyph shape="line" />, what: "line — drag along a lattice row" },
  { icon: <ShapeGlyph shape="ring" />, what: "ring — a level set of the hex norm" },
  { icon: <DragGlyph mode="paint" />, what: "drag paints continuously" },
  { icon: <DragGlyph mode="propose" />, what: "drag gathers; tap to commit" },
  { icon: <ActionGlyph name="undo" />, what: "undo a whole gesture" },
  { icon: <ActionGlyph name="redo" />, what: "redo it" },
  { icon: <ActionGlyph name="replay" />, what: "replay the drawing being made" },
  { icon: <ActionGlyph name="history" />, what: "history — scrub the earlier states" },
  { icon: <ActionGlyph name="save" />, what: "save — SVG or PNG" },
  { icon: <ActionGlyph name="load" />, what: "load an SVG onto the plate" },
];

/**
 * What ONE focus step calls itself, for a breadcrumb button.
 *
 * `focus.ts` has this function — `stepLabel` — and does not export it; what it
 * exports is `pathLabel`, which joins every step into one string with a
 * separator. That is the right shape for a sentence and the wrong shape for a
 * row of buttons, and splitting the joined string back apart would be parsing a
 * display string, which breaks the moment a gesture step's label contains the
 * separator. So the per-step spelling is written out here, using `STEP_LABEL`
 * and `gestureIds` — both exported — so the words themselves still come from the
 * model. The right fix is for `focus.ts` to export its `stepLabel`; that file is
 * outside this change's lane, so it is flagged rather than edited.
 *
 * The `gesture` case is not reachable from this page yet — nothing here pushes a
 * gesture step — and is written anyway, because the alternative is a breadcrumb
 * that prints a raw comma-separated id list the first time the filmstrip drives
 * this mechanism.
 */
function crumbLabel(step: FocusStep): string {
  if (step.kind !== "gesture") return `${STEP_LABEL[step.kind]} ${step.id}`;
  const ids = gestureIds(step);
  if (ids.length === 0) return "no gestures";
  return ids.length === 1 ? `gesture ${ids[0]}` : `${ids.length} gestures`;
}

export default function DrawPage() {
  /**
   * Which part of the one plate is framed. NOT which plate — there is one.
   *
   * `hexagon` draws all six sectors as the model builds them. `sector` draws one,
   * turned apex-up, which is the triangle this program used to hold as a separate
   * canvas. Switching between them is a change of frame and touches nothing.
   *
   * OPENS ON THE HEXAGON. It opened on a sector, which was the frame the program
   * had when the sector was a separate canvas, and it stopped being the right
   * default the moment the hexagon became the model: a person arriving at a
   * drawing program should be looking at the whole of what they can draw on, and
   * the sector view is a way of getting closer to part of it. Nothing downstream
   * assumed the sector — every reader of this state is a two-branch conditional,
   * and the two that could have been trouble are safe by construction: the brush
   * scope is forced to `sector` only WHILE a sector is framed (`effScope`), and
   * mode 12 is D₆'s, which the hexagon has and `pickView` clips on the way INTO
   * a sector rather than out of it.
   */
  const [viewMode, setViewMode] = useState<"hexagon" | "sector">("hexagon");
  /**
   * Which sector is framed, and — in hexagon view — which one a SECTOR-scoped
   * brush is pointed at. One number for both, because they are the same question
   * asked of the same figure, and two would let the overlay and the frame drift.
   */
  const [sector, setSector] = useState(0);
  const [depth, setDepth] = useState(4);
  /** Drawn at `apex`; only a loaded file can move it. See the header. */
  const [convention, setConvention] = useState<Convention>(CONVENTION);
  const [mode, setMode] = useState<BrushMode>(6);
  /**
   * Whose symmetries the brush uses, in HEXAGON view; see the note on
   * `BrushScope`. The sector view has no choice to make — a framed sector's own
   * D₃ is what the old triangle canvas always had — so it is forced to `sector`
   * there and the control is not shown.
   */
  const [scope, setScope] = useState<BrushScope>("hexagon");
  /**
   * WHICH THING THE HAND IS INSIDE — one stack, from the whole plate inward.
   *
   * This replaces the `isolation` state that used to sit here, and it is the
   * page's whole share of `lib/focus.ts`. `focusedArm(focus)` is the old
   * `Isolation` value, so every consumer of it below is unchanged; what is new is
   * that the same stack can also hold a SECTOR, and later a layer or a gesture,
   * without a fourth piece of state and a fourth control.
   *
   * ── What it is NOT: the frame, and not the roaming brush sector ─────────
   *
   * `viewMode` and `sector` stay exactly where they are, and that is deliberate
   * rather than unfinished. They are different questions:
   *
   *   viewMode  WHICH PART OF THE MODEL IS DRAWN. A reframe — the sector view
   *             turns one sector apex-up at twice the scale and draws nothing
   *             else. Drilling in is the opposite: it zooms and DULLS, so the
   *             rest of the figure is still on screen. Folding the two together
   *             would make "isolate" throw away the picture it is supposed to be
   *             showing you the inside of.
   *
   *   sector    WHICH SECTOR THE POINTER IS OVER, kept stickily by `noteSector`
   *             so a `sector`-scoped brush roams the whole plate with each stroke
   *             staying local to where it started. That is a per-STROKE fact and
   *             it changes on every pointer move; a focus is a standing state a
   *             person chose. Driving the focus from the pointer would zoom and
   *             dim the plate as the hand crossed a seam.
   *
   * So the focus COMPOSES with both rather than replacing either: see `effScope`
   * for how one expression takes the scope buttons and the focus together, and
   * `reframe` for why a frame change drops the focus.
   */
  const [focus, setFocus] = useState<FocusPath>(ROOT);
  const [reliefOn, setReliefOn] = useState(false);
  const [reading, setReading] = useState<Reading>("convex");
  const [schemeName, setSchemeName] = useState<SchemeName>("hexad");
  const [base, setBase] = useState<Swatch>(() => swatchFromHex("#d4a017"));

  /**
   * The tool the user CHOSE, which is not always the tool in force.
   *
   * Holding Option/Alt with nothing pressed is a momentary eraser (see the Alt
   * block further down), and the whole of that feature is the two lines below:
   * `pickedTool` is the selection and `tool` is what the program does with it.
   *
   * ── Why an override and not a save/restore ──────────────────────────────
   *
   * The obvious build is `prev = tool; setTool("erase")` on the way down and
   * `setTool(prev)` on the way up. It was rejected, and not on taste:
   *
   *  · IT CAN GET STUCK. Every path that fails to reach the restore — a missed
   *    keyup, an unmount mid-hold, a throw between the two — leaves a
   *    DESTRUCTIVE tool selected with nothing on screen saying it is temporary,
   *    and the user's own selection destroyed. Here the momentary state is one
   *    boolean whose false is the resting value; losing track of it can only
   *    fail toward the tool the user actually picked.
   *
   *  · IT CLOBBERS A MID-HOLD CHANGE. The brief asks that release restore the
   *    previous tool "including if the user changed tools some other way
   *    mid-hold". A save/restore would write the stale saved value back over
   *    the new choice. This restores it exactly by never overwriting it: click
   *    ADJUST while the eraser is held and `pickedTool` is adjust from that
   *    instant, so the release reveals adjust rather than reinstating paint.
   *    There is no restore step to get wrong, because there is no save.
   *
   * Everything downstream — the paint pipeline, the ghost, the cursor, the HUD
   * flag, the pressed state of the tool buttons, the canvas label — reads
   * `tool` and needs no further change. That is the point of putting the
   * override at the name rather than at forty call sites.
   */
  const [pickedTool, setPickedTool] = useState<Tool>("paint");
  const [eraseHeld, setEraseHeld] = useState(false);
  const tool: Tool = eraseHeld ? "erase" : pickedTool;
  const [adjustName, setAdjustName] = useState<AdjustName>("hue+");
  const [band, setBand] = useState<BandFamily | null>(null);
  const [progName, setProgName] = useState<ProgressionName>("off");
  // Events already spent when the progression was chosen; see progressionIndex.
  const [progOrigin, setProgOrigin] = useState(0);
  /** `null` = follow the pointer type; anything else is the user's own choice. */
  const [dragChoice, setDragChoice] = useState<DragMode | null>(null);
  /**
   * The standing proposal: the seeds a `propose` drag has gathered, in order.
   *
   * It was a single `number | null` — one candidate, replaced by every cell the
   * finger crossed — and that is the limitation this list removes. A propose
   * drag now ACCUMULATES applications exactly as a paint drag does, and the only
   * difference between the two modes is when the plate changes.
   *
   * The shape argument is written out in `propose.ts`: ordered, because
   * `StrokeMark.groups` is defined in stroke order and a progression lays its
   * gradient along that order; distinct, because a duplicate seed is invisible in
   * the ghost and still spends a colouring event at commit. Nothing here holds
   * the CELLS the proposal covers — those are derived from the seeds by the same
   * `brushStamp` the commit will use, so the ghost and the stroke cannot come to
   * disagree.
   */
  const [proposal, setProposal] = useState<Proposal>(EMPTY_PROPOSAL);
  /**
   * The refused commit that is still standing: WHICH proposal, and WHY.
   *
   * Holds the proposal ITSELF rather than a flag, and that is what makes it
   * self-clearing. A refusal is only worth saying while it is still true, and it
   * stops being true the instant the proposal changes — one more seed gathered,
   * the whole thing dropped, a focus change that cleared it, a commit that
   * finally landed. `proposeSeed` hands back the SAME array when nothing changed
   * and a new one when something did, so `blocked.proposal === proposal` is
   * exactly the question "is the standing proposal the one that was refused", and
   * every one of the dozen places that write `setProposal` clears this without
   * knowing it exists. A boolean would have needed all of them to remember.
   *
   * IT HOLDS ITS OWN SENTENCE, and the version that did not was wrong in a way
   * the identity check could not catch. `why` used to live in `announce`, spliced
   * into the standing line at render — but `announce` is the shared channel and
   * moves on its own: with the same proposal still up, one ⌘Z made the live
   * region read "undid painted 12 cells on L1 … — nothing was laid and there is
   * nothing to undo; the proposal still stands", which is a flat contradiction
   * one keystroke from the refusal. The reason is frozen here at the moment of
   * refusal, where it cannot be re-rented. `endStroke` hands back the words for
   * exactly this. See `said`.
   */
  const [blocked, setBlocked] = useState<{
    readonly proposal: Proposal;
    readonly why: string;
  } | null>(null);

  /**
   * The drawing: a TREE of address plates, and the journal of what was done to
   * it.
   *
   * This is the whole of the drawing's state, and it replaced two pieces of it —
   * a single `AddressPlate` and a `History<Address>` beside it. There is ONE
   * journal now, `layers.ts`'s, and it holds paint, adds, deletes, reorders,
   * promotions, pastes and renames as rungs of the same stack, so ⌘Z walks back
   * through whatever was actually done in whatever order it happened. Two
   * stacks would have meant a person pressing undo and having to know which of
   * them they were addressing.
   *
   * The index-keyed map the board renders is derived from this below and is
   * never stored, because an index only means something next to the depth that
   * issued it. See `plate.ts`, and `layers.ts` for why each layer is resolved on
   * its own rather than the plates being merged.
   */
  const [session, setSession] = useState<Session>(() =>
    newSession(emptyComposition())
  );
  const comp = session.composition;
  const past = session.journal.past;
  /**
   * The colouring-event log, DERIVED from the journal rather than kept beside
   * it.
   *
   * It used to be a second `useState` that four call sites pushed to, and the
   * one that forgot — CLEAR, which goes through `run` like every other
   * structural control — added a journal rung with no event rung, so a later
   * undo popped a rung belonging to another gesture and every subsequent
   * progression stroke was the wrong hue. `Act.events` now carries the count,
   * so the two stacks are one stack and cannot be pushed apart. See
   * `layers.Act`.
   */
  const events = useMemo(() => eventsOf(session.journal), [session.journal]);
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
  const [armed, setArmed] = useState<"new" | "revert" | null>(null);
  const disarmAt = useRef<number | null>(null);

  /**
   * The standing preview, or `null` when the plate on screen is the live one.
   *
   * See `Rewind`. Everything that WRITES is gated on this being null, so the
   * non-destructiveness is one test in one place rather than a promise repeated
   * at a dozen call sites.
   */
  const [rewind, setRewind] = useState<Rewind | null>(null);
  /**
   * The in point and the out point — which part of the drawing a replay plays.
   *
   * `null` IS "NO MARKS", and it is the whole replay. That is `clampSpan`'s own
   * reading of an absent span — "so a drawing with no marks set behaves exactly
   * as it did before this existed" — so the resting value here and the resting
   * value in the model are the same value, and nothing has to translate.
   *
   * IN STEP SPACE, not act space: these are indices into `AnimationStep[]`, the
   * same space `emit.EmitLayer.reveal` and `replay.InOut` are in. See
   * `lib/timeline.ts` for the map to the journal's own index and why the two
   * cannot be the same number.
   *
   * OUTLIVES THE PREVIEW, deliberately. A cut is a property of the drawing — it
   * is what the two exports will write — and not of the panel that happens to be
   * open, so closing the preview leaves it standing and the panel keeps
   * reporting it. It can therefore be stale after an edit or a frame change, and
   * that is handled the way the model says to handle it: every reader runs it
   * through `clampSpan` first, which is exactly what `clampSpan` is for.
   *
   * NAMED `playSpan` and not `span`, because this file already has one: the
   * BAND span, how many orbit positions a striped brush lays. Two things called
   * `span` in a 7000-line component is how a colour rail comes to be indexed by
   * an out point.
   */
  const [playSpan, setPlaySpan] = useState<InOut | null>(null);
  const [stepMs, setStepMs] = useState(STEP_MS_DEFAULT);
  const [gifWidth, setGifWidth] = useState(GIF_WIDTH_DEFAULT);
  /**
   * Is a GIF being written, and how far in?
   *
   * Two pieces of state rather than one nullable number, because "not running"
   * and "running, nothing done yet" are different things to a button: the
   * second must already be disabled.
   */
  const [gifBusy, setGifBusy] = useState(false);
  const [gifAt, setGifAt] = useState(0);

  const [helpOpen, setHelpOpen] = useState(false);
  const helpClose = useRef<HTMLButtonElement>(null);
  const helpOpener = useRef<HTMLElement | null>(null);

  /**
   * The save menu: is it open?
   *
   * SVG and PNG used to be two buttons, and two buttons is what they are once
   * the strip is icons — "the artwork, out" is ONE idea with a format on the
   * end of it, and drawing it twice spent two of the six slots the right-hand
   * end of the rule has. So they collapse into a menu button, and the menu is a
   * real one: `aria-haspopup`, `role="menu"`, arrow keys, Escape back to the
   * trigger. A hover-only reveal would have been a control no keyboard and no
   * touchscreen could open.
   */
  const [saveWanted, setSaveWanted] = useState(false);
  const saveWrap = useRef<HTMLDivElement | null>(null);
  const saveBtn = useRef<HTMLButtonElement | null>(null);
  const saveMenu = useRef<HTMLDivElement | null>(null);

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
   * Every pointer currently pressed, anywhere on the window.
   *
   * THE DISCRIMINATOR for Option/Alt, and the only thing it is for. `shortcuts.
   * altDown` asks one question — was a pointer already down when the key went
   * down — and this answers it.
   *
   * ── Why a window listener and not a flag lifted out of `DrawBoard` ──────
   *
   * The board knows perfectly well when a press is live; it keeps `drawing`,
   * `anchor`, `proposing` and `panFrom` for exactly that. Lifting one of them
   * would have made the discriminator "a press on the CANVAS", which is the
   * narrower and arguably more faithful reading — the shape modifier only means
   * anything while a canvas gesture is running.
   *
   * This is the wider one — ANY press, including one on a rail button — and the
   * choice is deliberate, because the two readings differ only in cases where
   * the wider one REFUSES TO ARM a destructive tool: hold a zoom button down,
   * press Alt, and you get the shape modifier's inert branch instead of a live
   * eraser. Erring toward "the eraser did not arm" is free; erring the other way
   * costs the user cells. It also needs no new prop, cannot be desynchronised
   * from the board's four refs, and sees presses that begin outside the canvas
   * entirely.
   *
   * ── A `Set`, and what that does NOT buy ────────────────────────────────
   *
   * This comment used to claim that a `Set` of ids "cannot leave a permanent
   * phantom press behind on a touchscreen", and on a touchscreen that is exactly
   * backwards. Touch pointer ids are minted per contact and a released one is not
   * handed out again, so an id whose `pointerup` never arrives is in this set for
   * the life of the page — and `size > 0` then reads "a pointer is down" forever,
   * which latches the momentary eraser OFF for the whole session. That is the
   * one failure the discriminator can have, and it is the destructive-tool one in
   * the safe direction, which is why it went unnoticed.
   *
   * The `Set` is still the right structure, for reasons the old comment did not
   * give. It is IDEMPOTENT: a repeated `pointerdown` for one id cannot count
   * twice, and a `pointerup` for a pointer whose press we never saw cannot take
   * the census below zero — a counter does both. And a MOUSE keeps one id for the
   * life of the page, so for the mouse a `Set` heals itself: press, lose the
   * release, press again, release, and the id is gone. A counter would sit at one
   * forever after the same sequence. A counter fixes nothing here; what fixes it
   * is `clear` on the two events that mean "the presses this page can see are no
   * longer this page's business", which the census effect below listens for.
   *
   * The board already leans on window-level `pointerup`/`pointercancel` — "a
   * gesture can finish anywhere" — so this adds no assumption that the drawing
   * surface was not already making.
   */
  const pointers = useRef<Set<number>>(new Set());
  /**
   * What the live Option/Alt hold means. See `shortcuts.AltState`.
   *
   * A REF as well as `eraseHeld` state, and the two are not two sources of
   * truth: `applyAlt` is the only writer of either and writes both, the ref is
   * what the window listeners read (they must see the value THIS event, not the
   * one the last render closed over), and the state is what the picture reads.
   * `compRef` beside `session.composition` is the same arrangement for the same
   * reason.
   */
  const altRef = useRef<AltState>(ALT_REST);
  /**
   * The animation frame the drill-in zoom is travelling on, or `null`.
   *
   * THERE IS STILL ONE TRANSFORM AND ONE WRITER OF IT. This does not hold a
   * second zoom; it holds a timer that writes `zoom` and `centre` — the same two
   * pieces of state the zoom stepper, the pan and `reframe` write — a few times
   * on its way to a value. Everything that sets the view cancels it first
   * (`stopEasing`), so the last thing the user asked for is always the thing that
   * wins, and a manual zoom during a drill-in is not a fight between two
   * mechanisms but an interruption of one.
   *
   * The alternative was to DERIVE the transform from the focus path. It was
   * rejected because it makes manual zoom impossible while focused: the stepper
   * would set a value that the next render recomputed away, which is a control
   * that visibly does nothing.
   */
  const easing = useRef<number | null>(null);
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

  /**
   * The live composition, as the pointer sees it.
   *
   * A ref for exactly the reason the plate used to be one: a drag applies the
   * brush several times between two renders, and each application has to plan
   * against what the last one left rather than against the composition React
   * last rendered. Every write below sets this FIRST and then hands the same
   * value to `setSession`, so the ref is the authority mid-gesture and state is
   * the authority everywhere else — and the effect under it puts the two back in
   * step after anything that changes the session from outside a drag.
   */
  const compRef = useRef<Composition>(session.composition);
  useEffect(() => {
    compRef.current = session.composition;
  }, [session]);
  const pending = useRef<PlateEdit[]>([]);
  /**
   * The layer the gesture in progress is landing in.
   *
   * Recorded at the first application and used at the commit, so a gesture that
   * began on one layer finishes on it — clicking a panel row mid-drag cannot
   * split one stroke across two sheets. An ID and not a `layers.Target`,
   * deliberately: a `Target` is proof that the brush may write there NOW, and
   * `paintAt` re-earns that on every application; this is only the name the
   * finished gesture is journalled under.
   */
  const paintingInto = useRef<LayerId | null>(null);
  /**
   * The gesture that layer carried BEFORE this stroke started, for the rung.
   *
   * `layers.applyMove` strips a layer's `mode`/`orbit` when it is painted into,
   * because those two numbers describe the cells that were there and painting
   * changes them. Undo has to write them back, so the rung carries them as its
   * move's `gesture.from` — and it has to be the value from before the FIRST
   * application, because by the time `endStroke` builds the rung the live
   * `paintInto` calls have already stripped it. Captured beside `paintingInto`
   * and cleared with it, so the two can only ever describe the same gesture.
   */
  const paintingWas = useRef<LayerGesture>({});
  /**
   * The sentence this gesture has already said in refusing, or `null`.
   *
   * A drag over a locked layer applies the brush sixty times a second and every
   * one of them refuses; without this the live region would repeat one sentence
   * until the pointer came up, which is how a screen reader is made useless.
   *
   * IT HOLDS THE WORDS AND NOT A FLAG, because `endStroke` has to hand them back
   * to `commitProposal`, which keeps the refused proposal standing and has to be
   * able to say WHY without reading `announce` — a piece of state it cannot see
   * the fresh value of, and which the next unrelated announcement would take
   * over. The words are the layer model's own; see `layers.paintTarget`.
   */
  const refusedRef = useRef<string | null>(null);
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
  /**
   * The symmetry groups the gesture in progress has applied, as addresses.
   *
   * A ref for the same reason `pending` is one: a drag applies the brush many
   * times between two renders, and each application contributes its own orbit.
   * Kept as ADDRESSES rather than indices so the record survives a depth change
   * exactly as the plate does — see `StrokeMark`.
   */
  const pendingGroups = useRef<Address[][]>([]);

  const scheme = SCHEMES[schemeName];
  const adjust = ADJUSTMENTS[adjustName];
  /**
   * The scope the brush is actually under — the FRAME, the BUTTON and the FOCUS,
   * in one expression.
   *
   * The sector view forces it, rather than the control being disabled there: a
   * framed sector's brush is the sector's own D₃ by definition, and the `scope`
   * state is left where the user put it so returning to hexagon view returns to
   * the group they had chosen.
   *
   * ── The three-way button and `scopeFor` are NOT two answers ─────────────
   *
   * `focus.scopeFor(path, repeatAll)` takes a BOOLEAN — "repeat in all six" —
   * and the button here is a three-way. The brief that asked for the focus stack
   * anticipated the buttons being removed and the boolean taking their place;
   * they are staying for now, so the two have to compose rather than contend, and
   * this is the composition:
   *
   *   sector6 pressed   → `repeatAll` is true, and `scopeFor` answers `sector6`
   *                       WHEREVER the focus is. That IS the toggle; there is no
   *                       second spelling of it.
   *   sector pressed    → the roaming brush, named outright. The button says
   *                       "this sector and nothing outside it" and the sector it
   *                       means comes from the pointer (`noteSector`), so the
   *                       focus has nothing to add and must not override it.
   *   hexagon pressed   → `scopeFor` decides, which is the new behaviour: D₆ at
   *                       the root, and the sector's own D₃ once you have drilled
   *                       into a sector. Drilling in is a statement about where
   *                       you are working, and the group follows it.
   *
   * `scopeFor`'s own header is worth reading here: `repeatAll` is honoured AT THE
   * ROOT on purpose, and that is why the `sector6` branch is tested first rather
   * than being conditioned on a sector being focused.
   */
  const effScope: BrushScope =
    viewMode === "sector" || scope === "sector"
      ? "sector"
      : scopeFor(focus, scope === "sector6");
  const modes = SCOPE_MODES[effScope];
  /** A sector is a copy of the base triangle, so a sector brush wears D₃'s face. */
  const glyphKind: CanvasKind = effScope === "hexagon" ? "hexagon" : "triangle";

  // A finger has no hover, so the ghost preview — the thing that teaches what
  // the brush does — is unreachable on touch unless the press itself proposes.
  const coarse = useSyncExternalStore(subscribeCoarse, coarseNow, coarseOnServer);
  const dragMode = dragChoice ?? defaultDragMode(coarse);
  /**
   * Has the reader asked not to be moved about?
   *
   * Read here rather than left entirely to CSS because the drill-in's travel is
   * a JavaScript tween over `zoom` and `centre` — an SVG `viewBox` is not an
   * animatable CSS property in any engine, so `@media (prefers-reduced-motion)`
   * in the stylesheet cannot reach it. The dim layer's fade IS a CSS transition
   * and is switched off in the sheet, which is where that kind of thing belongs;
   * the two together are the whole of the setting's effect here.
   */
  const reduceMotion = useSyncExternalStore(
    subscribeMotion,
    motionNow,
    motionOnServer
  );

  /**
   * The model. One figure, rebuilt only when the cut changes.
   *
   * Split out from the view below on purpose: the band table, the lattice and
   * the orbit tables are facts about the HEXAGON and do not move when the frame
   * does, so switching view must not pay for them again. At depth 5 that is the
   * difference between a frame change costing ~1 ms and costing ~10.
   */
  const hex = useMemo(() => buildHexagon(depth, convention), [depth, convention]);
  const bands = useMemo(() => buildBandSurface(hex), [hex]);
  const lattice = useMemo(() => latticeView(hex), [hex]);
  const baseLattice = useMemo(() => latticeView(hex.base), [hex]);
  const surface = useMemo(() => hexagonSurface(hex, effScope), [hex, effScope]);

  const plateView = useMemo<PlateView>(
    () => ({ mode: viewMode, sector }),
    [viewMode, sector]
  );

  const canvas: Canvas = useMemo(() => {
    const pf = plateFrame(hex, plateView);
    const framed = pf.view.mode === "sector";
    const inFrame = new Uint8Array(hex.cells.length);
    for (const i of pf.shown) inFrame[i] = 1;
    const [A, B, C] = pf.outline;
    return {
      hex,
      view: pf.view,
      geom: {
        width: pf.width,
        height: pf.height,
        outline: pf.outline,
        cells: pf.cells,
        seamWidth: seamAt(pf.edge),
        // Absent in hexagon view, so the board walks its own indices exactly as
        // it always did and nothing is filtered on the common path.
        shown: framed ? pf.shown : undefined,
      },
      frame: framed
        ? { kind: "triangle", corners: [A, B, C] }
        : { kind: "hexagon", centre: hex.centre, radius: hex.radius },
      centroids: pf.cells.map((c) => c.centroid),
      surface,
      bands,
      lattice,
      baseLattice,
      toView: pf.transform,
      fromView: pf.inverse,
      shown: pf.shown,
      inView: (i) => inFrame[i] === 1,
    };
  }, [hex, plateView, surface, bands, lattice, baseLattice]);

  /**
   * The canvas's addresses, and the composition composited onto them.
   *
   * `session` is the state; `paint` is a VIEW of it at the depth on screen,
   * which is what the board draws, what the ghost is computed against and what
   * the export writes. Deriving it rather than storing it is the whole reason a
   * depth change no longer clears the drawing: there is nothing indexed by the
   * old numbering to throw away. `layers.flatten` is memoised on the STACK's
   * identity, so a re-render that changed neither the tree nor the depth costs
   * one lookup — and selecting a row, which shares the stack, costs nothing at
   * all.
   */
  const book = useMemo(() => addressBook(hex), [hex]);
  /**
   * The tree, counted rather than asserted — see `layers.census`.
   *
   * Read by the layers panel's meta line, by the NEW confirm and by the guard
   * that turns the exports off on an empty document, so all three agree about
   * what "empty" means without any of them counting for itself.
   */
  const docCensus = useMemo(() => census(comp), [comp]);
  /**
   * Standing at a state the drawing is no longer in.
   *
   * Derived rather than stored, so there is exactly one thing to test and no
   * second flag that can be left set. Every write on the page is gated on it.
   */
  const previewing = rewind !== null;
  /**
   * The plate the board draws — the LIVE one, or the reconstructed one while a
   * preview stands.
   *
   * The substitution happens here and nowhere else, which is what makes a
   * preview cost one line: the ghost, the readouts, the relief and the board
   * all read `paint`, and none of them has to learn that a preview exists. The
   * live `plate` is untouched by this and by everything downstream of it —
   * `resolvePlate` returns a cached map and mutates nothing — so closing a
   * preview is dropping a reference rather than restoring a backup.
   *
   * A preview also survives a DEPTH change, for the same reason the drawing
   * does: the reconstructed plate is an address plate, so it resolves onto
   * whatever book is on screen.
   */
  const paint = useMemo(
    () => flattenComposition(rewind === null ? comp : rewind.comp, book),
    [comp, rewind, book]
  );

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
   * What a focus step MEANS on this plate.
   *
   * Two kinds are reachable from the canvas — a sector and an arm — and both
   * resolve off fields the hexagon's cells already carry, so nothing here
   * computes a coordinate. Rebuilt with the figure, which is the discipline
   * `focus.setResolver` asks for: a resolver caches, so a new figure needs a new
   * one.
   *
   * `layer` and `gesture` are deliberately absent. `focus.ts` supports both and
   * the layers panel and the filmstrip will supply them; a resolver with no
   * control to drive it would be an untested code path standing in for a feature.
   * A step whose kind has no resolver is treated as holding everything, so
   * nothing here breaks when one arrives.
   */
  const resolvers = useMemo<FocusResolvers>(
    () => ({
      sector: sectorResolver(hex.cells),
      arm: armResolver(hex.cells),
    }),
    [hex]
  );

  /**
   * The arm the focus names, or `null`. The old `isolation` state, DERIVED.
   *
   * Kept under its old name because half a dozen readouts and the arm control
   * itself are written in terms of it, and re-spelling them would have made this
   * change look bigger than it is while testing nothing new.
   */
  const isolation: Isolation = focusedArm(focus);

  /**
   * Which cells the brush's STAMP may keep — arms, and only arms.
   *
   * This was `armMaskOver(hex.cells, isolation)` and it is `clipMask` now, which
   * is the same predicate arrived at from the path instead of from one nullable
   * value: `armResolver` declares `clips: true` and nothing else does, so the
   * mask an arm-less path produces is the constant `true` it always was.
   *
   * THE SECTOR IS NOT IN HERE, and that is the property the whole module turns
   * on. A `sector6` stroke seeded inside a focused sector must still reach all
   * six — that group is defined as one sector's D₃ repeated six times, and a clip
   * to the focused sector would make the toggle a control that does nothing.
   * `focus.ts` states it and `test/focus.test.ts` measures it.
   *
   * One behaviour genuinely changed and is flagged rather than slipped in: the
   * old mask was live only while a sector was FRAMED (`viewMode === "sector"`).
   * An arm can now be focused in the hexagon view too — that is what drilling in
   * with a double-tap does — and the clip applies there, which is the point of
   * being able to drill in at all.
   */
  const keepCell = useMemo(() => clipMask(focus, resolvers), [focus, resolvers]);

  /**
   * Where a pointer may land: inside every MASKING step of the path.
   *
   * Illustrator's isolation mode, and the sentence `focus.seedMask` uses for it:
   * inside the thing, the outside stays visible and stops being selectable. At
   * the root this is the constant `true` — one shared closure, not an allocation
   * per cell — so the common case costs a call and the guards below are free.
   */
  const inFocus = useMemo(() => seedMask(focus, resolvers), [focus, resolvers]);

  /**
   * The cells the focus HOLDS, as a set, or `null` at the root.
   *
   * `holdMask` and not `seedMask`, which is what `focusCells` is built on and
   * what the display wants: a step that does not restrict the hand — a layer, a
   * gesture — is still a thing you can point at on screen, and framing the
   * whole plate for it would be the one answer that is useless.
   *
   * INTERSECTED WITH THE FRAME. In the sector view the geometry only draws one
   * sector, and an arm step alone holds its arm in all six; a set carrying cells
   * that are not on screen would put the dim layer's complement and the zoom box
   * in two different places. `canvas.inView` admits everything in the hexagon
   * view, so this is a no-op on the common path.
   */
  const focusHeld = useMemo<ReadonlySet<number> | null>(() => {
    if (focus.length === 0) return null;
    const held = focusCells(focus, resolvers, hex.cells.length);
    return new Set(held.filter((i) => canvas.inView(i)));
  }, [focus, resolvers, hex, canvas]);

  /** `(4^d − 1)/3` — the size §D predicts for one arm of one sector. */
  const armSize = (4 ** depth - 1) / 3;

  /**
   * Which sectors the axis overlay draws in.
   *
   * `null` is whatever the FRAME is: the whole plate and its six diameters in
   * hexagon view, and — because the sector view hands `symmetryGuides` a
   * triangle frame — that sector's own three medians in sector view, which is
   * exactly the overlay the standalone triangle canvas drew. A SECTOR scope
   * inside the hexagon view names the one sector it acts in, and SECTOR ×6 all
   * six copies, which is what that group actually contains.
   */
  /*
   * Written against `effScope` rather than against the `scope` BUTTON, which is
   * a fix and not a tidy-up. Drilling into a sector takes the brush from D₆ to
   * that sector's D₃ without the button moving, and the axis overlay is a
   * picture of the group the brush is using — reading the button here would have
   * drawn the hexagon's six diameters over a plate whose brush was mirroring
   * about one sector's three medians. The sector NAMED is the focused one when
   * there is one, and otherwise the roaming one the pointer left behind.
   */
  const guideSectors = useMemo(() => {
    if (viewMode === "sector" || effScope === "hexagon") return null;
    if (effScope === "sector6") return [0, 1, 2, 3, 4, 5];
    return [focusedSector(focus) ?? sector];
  }, [viewMode, effScope, focus, sector]);

  const guides = useMemo(
    () =>
      symmetryGuides(
        canvas.frame,
        mode,
        guideSectors,
        viewMode === "hexagon" && effScope === "sector6" ? 6 : 0
      ),
    [canvas, mode, guideSectors, effScope, viewMode]
  );

  /**
   * The most recent seed of the standing proposal, or `null` when none stands.
   *
   * The LAST one, because it is the one the finger was on when it lifted, so it
   * is what the span readout and the relief template should be about. The rest
   * of the proposal is behind it and is not where the hand is.
   */
  const lastSeed = proposal.length === 0 ? null : proposal[proposal.length - 1];

  /**
   * The cell the readouts and the relief take their cue from.
   *
   * Clamped to the canvas, because a cell index outlives the canvas that
   * numbered it by exactly one render when the depth changes.
   */
  const seedCell =
    (hover ?? lastSeed ?? cursor) === null ||
    (hover ?? lastSeed ?? cursor)! >= canvas.geom.cells.length
      ? null
      : (hover ?? lastSeed ?? cursor)!;

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
      if (i === null) return;
      const c = hex.cells[i];
      // In SECTOR view the frame already decides the sector, and following the
      // pointer would be the frame chasing itself: every cell on screen is in
      // the framed sector, so this could only ever be a no-op or a bug.
      if (c !== undefined && viewMode === "hexagon") setSector(c.sector);
    },
    [hex, viewMode]
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
   * A function of the MODEL and not of the view, so it survives a frame change
   * untouched — which is the point. It used to be offered on the hexagon canvas
   * alone, because a standalone triangle has no C6 to read six corresponding
   * cells off and its band-size height field is measurably flat, two values at
   * every depth. A SECTOR of the hexagon has neither problem: the six cells are
   * still there in the model, and the height field it carries is the hexagon's,
   * which takes 2^(d+1) − 1 values inside one sector. See `test/view.test.ts`.
   */
  const reliefSurface = useMemo<ReliefSurface>(() => buildRelief(hex), [hex]);

  /**
   * The template ring: the shell of the cell under the pointer, which is the
   * ring its whole C6 orbit sits on. An INTEGER, so it changes some fifty times
   * across a depth-4 plate rather than once per pointer event — which is the
   * entire reason a 1536-cell display effect is affordable.
   */
  /**
   * Frozen at the RESTING ring while a preview stands.
   *
   * The template ring follows the pointer, and a preview is a picture of a
   * state rather than a brush being aimed — a plate that heaved under the mouse
   * while it was replaying would be reporting a brush nobody is holding. The
   * resting ring is also the one the export bakes, so the preview and the file
   * agree about the shape of the plate.
   */
  const ring =
    seedCell === null || previewing
      ? restShell(reliefSurface)
      : templateShell(reliefSurface, seedCell);

  const frame = useMemo(
    () => (reliefOn ? reliefFrame(reliefSurface, ring, reading) : null),
    [reliefSurface, reliefOn, ring, reading]
  );

  /**
   * The relief, moved into the view's own pixels.
   *
   * `reliefFrame` deforms the model, in the model's coordinates; the sector view
   * then carries the whole plate through one similarity. Composing them is the
   * only honest order — deform, then frame — and the guide bend has to be
   * conjugated the same way, `T ∘ deform ∘ T⁻¹`, or the axes would ride a bulge
   * that is not the one under them. In hexagon view the transform is the
   * identity and the strings are handed straight through, so the common path
   * allocates nothing it did not before.
   */
  const relief = useMemo<ReliefView | null>(() => {
    if (frame === null) return null;
    const scales = frame.scales;
    const bare = (p: readonly [number, number]) =>
      deformPoint(reliefSurface, scales, p);
    if (canvas.view.mode === "hexagon") {
      return {
        points: frame.points,
        centroids: frame.centroids,
        wash: frame.wash,
        bend: bare,
      };
    }
    const m = canvas.toView;
    const inv = canvas.fromView;
    return {
      points: frame.verts.map((v) => pointsOf(v, m)),
      centroids: frame.centroids.map((p) => applyAffine(m, p)),
      wash: frame.wash,
      bend: (p) => applyAffine(m, bare(applyAffine(inv, p))),
    };
  }, [frame, reliefSurface, canvas]);

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

  /** Which canvas the band NOTES describe — a framed sector is the triangle. */
  const bandKind: CanvasKind = viewMode === "sector" ? "triangle" : "hexagon";

  /**
   * The lattice family the chosen letter names IN THIS FRAME.
   *
   * A sector is the base triangle rotated by 60°·s, and a rotation permutes the
   * three lattice line families, so the hexagon family that runs parallel to a
   * framed sector's outer edge depends on the sector. The sector view turns the
   * sector back apex-up, so "band A" there has to go on meaning the rows the
   * triangle has always called A whichever sector is framed — otherwise the
   * letter would name a different direction under an identical picture. The
   * identity in sectors 0 and 3, and in hexagon view. See `sectorBandFamily`.
   */
  const effBand = useMemo(
    () =>
      band === null || viewMode === "hexagon"
        ? band
        : sectorBandFamily(band, sector),
    [band, viewMode, sector]
  );

  const shape = useMemo(() => ({ mode, band: effBand }), [mode, effBand]);

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
   *
   * `colourBase` defaults to the base the NEXT stroke would start from, which is
   * what a hover ghost and a one-seed proposal both want. A multi-seed proposal
   * passes its own, one step of the progression per seed, because that is what
   * the commit will actually lay — see `proposalSpecs`.
   */
  const specFromStamp = useCallback(
    (
      stamp: ReturnType<typeof brushStamp>,
      seed: number,
      colourBase: Swatch = effectiveBase
    ): PreviewSpec => {
      const all = stamp.cells;
      if (tool === "erase") {
        return { cells: all, colours: [], inert: [], seed, erasing: true };
      }
      const colours = stampColours(
        { tool, scheme, base: colourBase, adjust },
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
    (seed: number | null, colourBase?: Swatch): PreviewSpec | null => {
      if (seed === null || seed >= canvas.geom.cells.length) return null;
      // NO GHOST OUTSIDE THE FOCUS, on the same rule as the paint guard: the
      // ghost's whole job is to promise exactly what the stroke will lay, and
      // `paintAt` refuses this seed, so a ghost here would promise a stroke that
      // is not going to happen. It matters most at the moment it is most
      // tempting to skip — hovering across the dulled five sixths of the plate
      // on the way to a control.
      if (!inFocus(seed)) return null;
      // Clipped, so the ghost promises exactly what the stroke will lay. A
      // preview that reached outside the isolated arm would be teaching the
      // wrong brush. `seedStamp` is the same call `paintAt` makes, so the ghost
      // and the stroke are one function apart rather than two copies.
      return specFromStamp(
        seedStamp(canvas.surface, canvas.bands, seed, shape, keepCell),
        seed,
        colourBase
      );
    },
    [canvas, shape, keepCell, inFocus, specFromStamp]
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

  /**
   * The standing proposal, drawn: ONE GHOST PER SEED, in the order proposed.
   *
   * Not one merged ghost, and the reason is the reason the seeds are kept
   * separately at all. A stamp's `span` is per application — the realised orbit
   * size for a plain brush, the number of image bands for a band brush, and both
   * of those vary from seed to seed — so a merged ghost would have to pick one
   * span and would then show hues the commit is not going to lay. Per seed, each
   * ghost is exactly `specFor` of that seed, which is exactly what `paintAt`
   * will do to it.
   *
   * ── The base advances per seed, because the commit's does ───────────────
   *
   * A proposal of five seeds commits as five applications of the brush, and
   * `paintAt` spends one colouring event per application, so the progression
   * steps once per seed and the run comes out as a gradient. The preview has to
   * step with it or it would show five copies of one hue and then lay five
   * different ones — the exact failure `brush.stampColours` exists to prevent
   * from the other side. `liveEvents` is 0 throughout, because a proposal has
   * not touched the plate; the k-th seed is therefore the k-th step.
   *
   * Only the PAINT tool spends events (see `brush.EventLog`), so erase and
   * adjust hold the base still across the whole proposal, which is what they do
   * on a paint drag too.
   *
   * ── Only the free brush proposes ────────────────────────────────────────
   *
   * `line` and `ring` are excluded, and not merely left out. They are ANCHORED
   * gestures: the press names a cell, the drag names a second, and nothing is
   * painted until the release — so they already show a live preview under a
   * pressed finger and already commit as one stroke, which is the whole of what
   * propose mode was invented to give the free brush. There is also nothing to
   * accumulate: a proposal is a run of applications at seeds, and a line is one
   * figure with an anchor and an extent, not a set of seeds. Adding a candidate
   * stage to them would mean a second tap for no preview that the drag did not
   * already give.
   */
  const proposalSpecs = useMemo(() => {
    if (shapeTool !== "free" || dragMode !== "propose") return NO_SPECS;
    if (proposal.length === 0) return NO_SPECS;
    const out: PreviewSpec[] = [];
    proposal.forEach((seed, k) => {
      const at = specFor(
        seed,
        prog.at(base, progressionIndex(events, progOrigin, tool === "paint" ? k : 0))
      );
      if (at !== null) out.push(at);
    });
    return out;
  }, [
    shapeTool,
    dragMode,
    proposal,
    specFor,
    prog,
    base,
    events,
    progOrigin,
    tool,
  ]);

  /**
   * The hover ghost now stands ALONGSIDE the proposal rather than yielding to it.
   *
   * It used to yield, and while the candidate was a single cell that was right:
   * two ghosts would have been two answers to "what will be committed". A
   * proposal is a SET now, and the two ghosts answer different questions — the
   * marching dashes are what stands, the solid ghost is what the next application
   * would add — so suppressing the second one costs the keyboard its preview
   * entirely, since arrowing around with a proposal up would show nothing at the
   * cursor at all. They are already told apart by two channels at once (fill
   * strength and a marching dash; see `DrawBoard.Ghost`), which is what makes
   * showing both legible rather than confusing.
   *
   * An anchored drag still outranks both — it is the thing under the finger.
   */
  const preview = useMemo(
    () =>
      dragSpec !== null
        ? dragSpec.spec
        : shapeTool === "free"
        ? specFor(hover)
        : null,
    [dragSpec, shapeTool, specFor, hover]
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
  const reset = useCallback((next: Composition, why: string) => {
    compRef.current = next;
    pending.current = [];
    pendingEvents.current = 0;
    pendingGroups.current = [];
    // A preview is a window onto a journal that is about to stop existing.
    setRewind(null);
    setLiveEvents(0);
    // The event log is the journal, and `newSession` empties it — so there is
    // no second stack here to remember to clear.
    setSession(newSession(next));
    setProgOrigin(0);
    setHover(null);
    setCursor(null);
    setProposal(EMPTY_PROPOSAL);
    setAnnounce(why);
  }, []);

  const wipe = useCallback(
    (why: string) => {
      // A cleared plate is a new drawing, and a drawing made here is `apex`.
      setConvention(CONVENTION);
      reset(emptyComposition(), why);
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
  const arm = useCallback((what: "new" | "revert", said: string) => {
    if (disarmAt.current !== null) window.clearTimeout(disarmAt.current);
    setArmed(what);
    disarmAt.current = window.setTimeout(() => {
      setArmed(null);
      disarmAt.current = null;
      // The timeout SAYS so. A live region still reading "armed" after the
      // button had quietly gone back to normal was the one state in this guard
      // where the screen and the announcement disagreed.
      setAnnounce("the confirm expired — nothing was changed");
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
    if (previewing) return;
    if (armed !== "new") {
      arm(
        "new",
        `NEW is armed — click it again to wipe ${
          docCensus.addresses
        } painted address${
          docCensus.addresses === 1 ? "" : "es"
        } across ${docCensus.total} layer${
          docCensus.total === 1 ? "" : "s"
        } and the whole undo history, or press Escape`
      );
      return;
    }
    disarm();
    wipe("new plate — every address cleared, and the undo history with it");
  };

  /**
   * Changing the VIEW clears nothing, and that is the whole change.
   *
   * The canvas toggle that used to sit here was destructive for a reason that no
   * longer exists: the triangle and the hexagon were two address spaces, `ABX`
   * against `s3:ABX`, and nothing painted on one named anything on the other. It
   * is one space now. A frame change moves the camera; every address the plate
   * holds is still an address, in every sector, including the five this frame
   * does not draw. So there is no guard, no confirm and no wipe — the plate is
   * not at risk, and a guard that fires when there is no risk teaches people to
   * click through guards.
   *
   * Two things do move, and neither is the drawing. Mode 12 is a subgroup of D₆
   * and of nothing else, so a sector frame — whose brush is the sector's own D₃ —
   * drops to 6, the same rule `pickScope` has always applied. And the zoom is
   * reset, because a window in the hexagon's pixels means nothing in a frame that
   * is twice the scale and turned by 120°.
   */
  /**
   * Drop everything that is an index into the frame that is about to change.
   *
   * The plate is not one of them, and that is the point. The cursor, the hover,
   * a standing candidate and an anchored drag all name cells that may be about
   * to leave the picture, and the zoom window is in the old frame's pixels — a
   * sector frame is twice the scale and turned by 120°, so carrying a window
   * across would land it somewhere nobody asked for.
   */
  // ── drilling in ─────────────────────────────────────────────────────────

  /**
   * Stop the drill-in travel dead.
   *
   * Called by EVERYTHING that writes the view — the stepper, the pan, the
   * reframe, the next drill-in — because a timer still writing `zoom` after the
   * user has asked for a different one is the "two writers" bug the whole
   * arrangement exists to avoid. Idempotent, so callers do not have to know
   * whether one is running.
   */
  const stopEasing = useCallback(() => {
    if (easing.current === null) return;
    cancelAnimationFrame(easing.current);
    easing.current = null;
  }, []);

  // A page unmounted mid-travel would leave a frame callback holding setState.
  useEffect(() => stopEasing, [stopEasing]);

  /**
   * Travel to a zoom and a centre, over `FOCUS_MS`.
   *
   * `prefers-reduced-motion` SKIPS THE TRAVEL AND KEEPS THE DESTINATION, which
   * is the right reading of that setting: the person has asked not to be moved
   * across the screen, not to be denied the zoom. A version that also refused to
   * zoom would have turned an accessibility preference into a missing feature.
   *
   * The `requestAnimationFrame` test is for the same reason the media query is
   * read through a store: this file is rendered on the server as well, and a
   * callback that is never invoked there is still a callback that must not throw
   * if some future path invokes it.
   *
   * The intermediate values are FRACTIONAL, which breaks the "zoom is a power of
   * two" habit the stepper had. Flagged rather than papered over: the readout is
   * rounded for display (see the zoom stepper) and `setZoomTo` still doubles and
   * halves whatever it is handed, so the stops remain a power of two apart from
   * wherever a drill-in left off. Snapping the drill-in to a power of two was the
   * alternative and it is worse — it would frame the focused cells at up to twice
   * or half the size asked for, which is the one thing "fills the canvas" means.
   */
  const easeTo = useCallback(
    (to: { zoom: number; cx: number; cy: number }) => {
      stopEasing();
      const settle = () => {
        setZoom(to.zoom);
        // `null` at 1×, matching `setZoomTo`, so the `view` memo returns the
        // untouched viewBox the board has always drawn at rest.
        setCentre(to.zoom <= 1 ? null : { x: to.cx, y: to.cy });
      };
      if (reduceMotion || typeof requestAnimationFrame !== "function") {
        settle();
        return;
      }
      const z0 = zoom;
      const x0 = centre?.x ?? canvas.geom.width / 2;
      const y0 = centre?.y ?? canvas.geom.height / 2;
      const t0 = performance.now();
      const step = () => {
        const u = Math.min(1, (performance.now() - t0) / FOCUS_MS);
        if (u >= 1) {
          easing.current = null;
          settle();
          return;
        }
        // Ease out, not linear: the picture leaves quickly and arrives slowly,
        // which is what makes a short move readable as a move rather than as a
        // cut. Cubic because it is the cheapest curve that does it.
        const k = 1 - (1 - u) ** 3;
        setZoom(z0 + (to.zoom - z0) * k);
        setCentre({ x: x0 + (to.cx - x0) * k, y: y0 + (to.cy - y0) * k });
        easing.current = requestAnimationFrame(step);
      };
      easing.current = requestAnimationFrame(step);
    },
    [reduceMotion, zoom, centre, canvas, stopEasing]
  );

  /**
   * Go to a focus path: zoom to it, dim around it, and say where you are.
   *
   * ONE FUNCTION for every route in — the canvas double-tap, the two keys, the
   * breadcrumb, the arm buttons and Escape — so there is one place that decides
   * what entering and leaving a focus does and no control can implement half of
   * it. That is the same discipline `pickView` and `pickScope` are written under.
   *
   * Three things happen besides the path itself.
   *
   * THE BRUSH MODE IS CLAMPED. Drilling into a sector can take `effScope` from
   * `hexagon` to `sector`, and mode 12 is D₆'s reflections — a subgroup of D₆ and
   * of nothing else. `pickScope` and `pickView` already apply exactly this rule
   * when they change the scope; this is the third door into the same room.
   *
   * THE PROPOSAL IS DROPPED. A standing proposal is a set of seeds gathered under
   * the group and the mask that were in force when it was gathered; committing it
   * after the focus moved would lay a stroke nobody previewed. `pickScope` and
   * `pickIsolation` have always done this for the same reason.
   *
   * THE VIEW TRAVELS. `focusFrame` over the cells the path HOLDS — `focusCells`
   * is built on `holdMask`, which is the framing mask — intersected with what the
   * frame actually draws. A path that holds NOTHING keeps the frame it has, which
   * is what `focusCells` documents as the answer for a fresh layer, a hidden
   * layer, an erase gesture or a query that matched nothing.
   *
   * THE INTERSECTION WITH `inView` IS LOAD-BEARING and not defensive. A framed
   * sector's `geom.cells` is the WHOLE model, index-aligned — `view.plateFrame`
   * maps every cell so the board can keep using model indices — and the ones in
   * the other five sectors land outside the triangle frame entirely. A box taken
   * over them would zoom to a rectangle containing five sectors that are not
   * drawn. `canvas.inView` admits everything in the hexagon view, so the common
   * path pays one predicate per cell and nothing else.
   *
   * KNOWN IMPRECISION, under the relief only. The box is taken over the FLAT
   * vertices while the board draws the deformed ones. The deformation pins the
   * rim at scale 1 and shrinks inward, so the drawn cells are never outside the
   * flat box — the frame is a little loose rather than cropping, which is the
   * error worth having. Threading the bend through would mean re-deriving the box
   * per template ring, at the pointer's rate, to fix a gap of a few pixels.
   */
  const applyFocus = useCallback(
    (next: FocusPath) => {
      if (samePath(next, focus)) return;
      setFocus(next);
      setProposal(EMPTY_PROPOSAL);

      const nextScope: BrushScope =
        viewMode === "sector" || scope === "sector"
          ? "sector"
          : scopeFor(next, scope === "sector6");
      const m = SCOPE_MODES[nextScope].includes(mode) ? mode : 6;
      if (m !== mode) setMode(m);

      if (next.length === 0) {
        easeTo({
          zoom: 1,
          cx: canvas.geom.width / 2,
          cy: canvas.geom.height / 2,
        });
        setAnnounce(
          `the whole plate — nothing is dimmed and the brush reaches everywhere${
            m === mode ? "" : `. Brush dropped to ${m}-fold`
          }`
        );
        return;
      }

      const held = focusCells(next, resolvers, hex.cells.length).filter((i) =>
        canvas.inView(i)
      );
      const frame = focusFrame(canvas.geom, held, ZOOM_MAX);
      if (frame !== null) easeTo(frame);
      setAnnounce(
        `inside ${pathLabel(next)} — ${held.length} cell${
          held.length === 1 ? "" : "s"
        }${
          frame === null
            ? ", which name nothing to look at, so the frame is unchanged"
            : `, zoomed to fill the frame`
        }. The rest of the plate is dulled and the brush will not reach it. Double-tap a dulled cell, or press O, to step back out${
          m === mode ? "" : `. Brush dropped to ${m}-fold — mode 12 is D₆'s alone`
        }`
      );
    },
    [focus, viewMode, scope, mode, resolvers, hex, canvas, easeTo]
  );

  /** The plate's own nesting rule: root → sector → arm → stop. See `focus.ts`. */
  const deeper = useMemo(() => hexagonDeeper(hex.cells), [hex]);

  /**
   * A clean double-tap on a cell. `gestureFor` decides what it means.
   *
   * The whole decision is one call, and deliberately: "inside" is `seedMask`'s
   * inside, "outside" is its complement, and the two cases are therefore total
   * over the plate with no third case where a tap means neither. The board knows
   * none of this — it reports a cell and this reads the answer off the model.
   *
   * EXIT POPS ONE LEVEL. Not to the root: `focus.exit`'s header gives the reason
   * and it is the reason this page wanted the mechanism at all — "leave this arm
   * but stay in this sector" has to be expressible, and a gesture that dropped to
   * the root would make the middle of a three-level stack unreachable except by
   * re-entering from scratch.
   */
  const onFocusTap = useCallback(
    (i: number) => {
      const act = gestureFor(focus, i, resolvers, deeper);
      if (act === null) {
        // Two ways to get here and both are no-ops: a double-tap at the root on
        // a cell that names nothing, and a double-tap at the bottom of the stack.
        // The second is worth a sentence, because a gesture that does nothing
        // twice in a row reads as a broken control rather than as an edge.
        if (focus.length > 0) {
          setAnnounce(
            `${pathLabel(focus)} — there is nothing further in from here${
              focusedArm(focus) === null
                ? "; the hub belongs to no arm"
                : ""
            }`
          );
        }
        return;
      }
      applyFocus(
        act.act === "exit" ? exit(focus) : enter(focus, act.step)
      );
    },
    [focus, resolvers, deeper, applyFocus]
  );

  /**
   * The keyboard's way IN — the cursor's cell, one level deeper.
   *
   * A REAL SECOND PATH and not a courtesy. Every scope and arm control on this
   * page is a `<button>` with an `aria-label` precisely because a canvas gesture
   * is a mouse-and-finger affordance, and a drill-in that could only be reached
   * by double-tapping the plate would be the first control here that a keyboard
   * cannot work. It reads the CURSOR, falling back to the hover, because those
   * are the two things that already mean "where the hand is".
   *
   * Strictly IN, where the canvas gesture is in-or-out. From the keyboard the
   * direction is chosen by which key was pressed, so inferring it from where the
   * cursor happens to be sitting would make one key do two unrelated things.
   */
  const drillIn = useCallback(() => {
    const at = cursor ?? hover;
    if (at === null) {
      setAnnounce(
        "no cell under the cursor — put it on the plate with the lattice keys or the arrows first"
      );
      return;
    }
    if (!inFocus(at)) {
      setAnnounce(
        `the cursor is outside ${pathLabel(
          focus
        )} — press O to step out, or move it inside first`
      );
      return;
    }
    const step = deeper(at, focus);
    if (step === undefined) {
      setAnnounce(`${pathLabel(focus)} — there is nothing further in from here`);
      return;
    }
    applyFocus(enter(focus, step));
  }, [cursor, hover, inFocus, focus, deeper, applyFocus]);

  /** The keyboard's way OUT, and the tail of the Escape chain. One level. */
  const drillOut = useCallback(() => {
    if (focus.length === 0) return;
    applyFocus(exit(focus));
  }, [focus, applyFocus]);

  const reframe = useCallback(() => {
    stopEasing();
    setZoom(1);
    setCentre(null);
    setHover(null);
    setCursor(null);
    setProposal(EMPTY_PROPOSAL);
    setShapeDrag(null);
    // THE FOCUS GOES TOO, and this is a deviation from what isolation used to do
    // — it survived a sector change. It should not. A focus step names a sector
    // by NUMBER, so carrying `[sector 2, arm A]` across a change of frame would
    // leave the breadcrumb saying "sector 2" while sector 3 is on screen, and the
    // dim layer holding cells the new frame does not draw. The frame change is
    // the bigger gesture and the focus is the thing inside it.
    setFocus(ROOT);
  }, [stopEasing]);

  const pickView = useCallback(
    (next: "hexagon" | "sector") => {
      if (next === viewMode) return;
      const m = next === "sector" && mode === 12 ? 6 : mode;
      setViewMode(next);
      setMode(m);
      reframe();
      setAnnounce(
        next === "sector"
          ? `sector ${sector} framed — ${4 ** depth} of ${cellCount(
              "hexagon",
              depth
            )} cells, apex at the plate's centre. Nothing was cleared; the other five sectors keep their paint${
              m === mode ? "" : `. Brush dropped to ${m}-fold — mode 12 is D₆'s alone`
            }`
          : `the whole plate — all six sectors, ${cellCount(
              "hexagon",
              depth
            )} cells. Nothing was cleared`
      );
    },
    [viewMode, mode, sector, depth, reframe]
  );

  /** Frame a different sector. Also clears nothing; see `pickView`. */
  const pickSector = useCallback(
    (next: number) => {
      const s = wrapSector(next);
      if (s === sector && viewMode === "sector") return;
      setSector(s);
      setViewMode("sector");
      if (mode === 12) setMode(6);
      reframe();
      setAnnounce(
        `sector ${s} framed — ${4 ** depth} cells; the plate is whole and nothing was cleared`
      );
    },
    [sector, viewMode, mode, depth, reframe]
  );

  /**
   * Changing the scope does NOT clear the plate.
   *
   * It changes which group the brush uses and nothing about which cells exist,
   * so every colour already laid still names the cell it was laid on. Mode 12 is
   * the one thing that has to move: it is a subgroup of D6 and of nothing else,
   * so a sector scope that kept it would name a brush that scope does not have.
   * Same rule as `pickView`, for the same reason.
   *
   * Hexagon view only. A framed sector's brush IS the sector's own D₃, so there
   * is no choice left to make there and the control is not drawn.
   */
  const pickScope = (next: BrushScope) => {
    if (next === scope) return;
    const m = SCOPE_MODES[next].includes(mode) ? mode : 6;
    setScope(next);
    setMode(m);
    setProposal(EMPTY_PROPOSAL);
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
      setProposal(EMPTY_PROPOSAL);
      setShapeDrag(null);
      setAnnounce(
        `depth ${d}, ${cellCount("hexagon", d)} cells — every layer carried across, ${
          docCensus.addresses
        } address${docCensus.addresses === 1 ? "" : "es"} held`
      );
    },
    [depth, docCensus]
  );

  /**
   * The arm buttons, now spelled as a focus path.
   *
   * KEPT, and the brief that added the focus stack says to keep them: they are
   * being replaced by a different control later, and removing them in the same
   * pass as the drill-in would leave the arm reachable only by double-tapping,
   * which is a mouse-and-finger gesture.
   *
   * The path is REBUILT rather than pushed onto, and that is the whole of the
   * work here. `[sector s, arm A]` and not `[arm A]`, because an arm step alone
   * holds its arm in ALL SIX sectors — `armOfWord` reads the address, which every
   * sector's copy of a cell shares — and the control says "one third of the
   * framed sector". Pressing B while A is isolated therefore replaces the arm
   * instead of nesting one inside another, which is what `focus.enter`'s header
   * says a caller that can produce a nonsense pair should do.
   *
   * A SECTOR STEP APPEARS EVEN THOUGH THE SECTOR IS ALREADY FRAMED. It has to:
   * the frame is a camera and the focus is a mask, and it is the focus that
   * `holdMask` reads when it decides which cells to dim and which box to zoom to.
   *
   * OFF goes to the ROOT rather than to `[sector s]`. The two look identical in
   * the sector view — the frame draws that sector and nothing else, so a sector
   * focus dims nothing and zooms to what is already on screen — but they read
   * differently, and a button labelled "off" that left a breadcrumb standing
   * would be saying that something is still isolated.
   */
  const pickIsolation = (next: Isolation) => {
    if (next === isolation) return;
    applyFocus(next === null ? ROOT : [sectorStep(sector), armStep(next)]);
  };

  // ── painting ────────────────────────────────────────────────────────────

  /**
   * The layer this gesture lands in, or the sentence saying why it will not.
   *
   * `paintTarget` refuses LOUDLY on a locked or hidden target and names the
   * layer in the refusal — and it tells "L2 is locked" apart from "L2 is inside
   * a locked layer", which is the difference between a switch you can see on the
   * row in front of you and one you have to go and find. The page says exactly
   * what it is handed rather than composing a sentence of its own, so the panel
   * and the brush cannot drift apart about what is going on.
   */
  const paintAt = useCallback(
    (i: number) => {
      // A preview is not a canvas. Gated here as well as at the board's
      // handlers, because the keyboard reaches this function by three routes.
      if (previewing) return;
      // OUTSIDE THE FOCUS IS INERT — Illustrator's isolation rule, and the
      // sentence `focus.seedMask` is written in. At the root this predicate is
      // the constant `true`, so this line costs one call on the common path.
      //
      // SILENT, unlike the locked-layer refusal below, and that is a choice
      // rather than an omission. A refusal announced here would fire on every
      // application of a drag — sixty a second — and the two cases are not
      // alike: a locked layer looks exactly like an unlocked one, whereas the
      // cells this refuses are the ones visibly dulled on screen, and the
      // sentence that says so was already said when the focus was entered.
      if (!inFocus(i)) return;
      const target = paintTarget(compRef.current);
      if (!target.ok) {
        // Once per gesture, not once per application: a drag over a locked
        // layer would otherwise repeat the same sentence sixty times a second.
        if (refusedRef.current === null) {
          refusedRef.current = target.said;
          setAnnounce(target.said);
        }
        return;
      }
      // The CHECKED target, re-asked on every application — a layer can be
      // locked or hidden from the panel while the pointer is down. `paintInto`
      // takes this rather than a bare id, so painting somewhere the brush may
      // not is not expressible; see `layers.Target`.
      const into = target.value;
      // The same call the ghost makes — see `specFor` — so what is previewed and
      // what is laid are one function apart. A proposal's commit reaches this
      // line once per seed, each with its own stamp and therefore its own
      // `span`; see `commitProposal`.
      const stamp = seedStamp(canvas.surface, canvas.bands, i, shape, keepCell);
      if (stamp.cells.length === 0) return;
      // Recomputed per application rather than taken from `effectiveBase`, so a
      // drag lays a gradient along its own path instead of one flat colour.
      const n = progressionIndex(events, progOrigin, pendingEvents.current);
      // The colours are decided against the drawing AS SHOWN — the adjustment
      // brush transforms the colour a cell is DISPLAYING, which under a stack
      // is the composite and not the target layer's own paint. Memoised on the
      // stack's identity, so this is a lookup on every application after the
      // first.
      const view = flattenComposition(compRef.current, book);
      const colours = stampColours(
        { tool, scheme, base: prog.at(base, n), adjust },
        view,
        stamp
      );
      // Planned against the TARGET LAYER'S OWN plate, though, and not against
      // the composite: an edit carries the colour it replaced, so planning
      // against the picture would record a neighbouring layer's colour as this
      // layer's `from` and undo would write it into the wrong sheet.
      const own = target.value.layer.plate;
      const edits = planPlateEdits(
        own,
        book,
        stamp.cells.map((c) => book.addr[c]),
        colours
      );
      if (edits.length === 0) return;
      if (tool === "paint") {
        pendingEvents.current += 1;
        setLiveEvents(pendingEvents.current);
      }
      // The symmetry this application used, recorded before the indices are
      // forgotten. `groups` is null for a plain orbit — where there is no
      // grouping, not a grouping of one — so the orbit itself is the group,
      // which is exactly the shape the animated export wants. APPENDED, never
      // merged: a gesture that applied the brush N times has N groups in the
      // order it applied them, which is what `StrokeMark.groups` is and what
      // `provenance.gestureLayers` reads to nest a mixed-orbit gesture.
      for (const g of stampGroups(stamp)) {
        pendingGroups.current.push(g.map((c) => book.addr[c]));
      }
      // The gesture belongs to the layer it STARTED on, and `endStroke`
      // journals against that id rather than against wherever it ended.
      //
      // The layer's OWN recorded gesture is taken at the same moment, and only
      // at the first application: `paintInto` strips it, so every later
      // application would read the stripped value and the rung would have nothing
      // for undo to write back. Read BEFORE the paint, for the same reason.
      if (paintingInto.current === null) paintingWas.current = gestureOf(into.layer);
      paintingInto.current = into.layer.id;
      compRef.current = paintInto(compRef.current, into, edits);
      pending.current = mergeEdits(pending.current, edits);
      setSession((s) => ({ ...s, composition: compRef.current }));
    },
    [
      previewing,
      inFocus,
      canvas,
      book,
      keepCell,
      shape,
      tool,
      scheme,
      adjust,
      prog,
      base,
      events,
      progOrigin,
    ]
  );

  /**
   * Close the gesture, and say whether it JOURNALLED.
   *
   * The answer is the whole reason this returns anything. Three of the four ways
   * out of here push no rung — a refusal the layer model already announced, a
   * gesture whose edits were all no-ops, and a gesture that never named a layer
   * — and from the outside they used to be indistinguishable from a commit.
   * `commitProposal` is the caller that cannot live with that: it must not throw
   * away N gathered seeds on the strength of a call that did nothing.
   * `journalled` true means one rung was pushed and one undo takes it back;
   * false means the plate is exactly as it was and there is nothing to undo.
   * Every path says which, because a caller that guessed would be guessing about
   * the journal.
   *
   * `said` is the sentence this call leaves standing — the layer model's own
   * words for a refusal, the brush's for a gesture that moved nothing, the whole
   * commit line for one that landed. Returned rather than left in `announce`
   * because a caller that keeps its proposal has to be able to REPEAT the reason
   * later, and `announce` is a shared channel that the next undo or tool change
   * will have taken over by then. See `blocked`.
   */
  const endStroke = useCallback(
    (how: "stroke" | "commit" = "stroke"): { journalled: boolean; said: string } => {
      const edits = pending.current;
      const used = pendingEvents.current;
      const groups = pendingGroups.current;
      const into = paintingInto.current;
      const was = paintingWas.current;
      const refused = refusedRef.current;
      pending.current = [];
      pendingEvents.current = 0;
      pendingGroups.current = [];
      paintingInto.current = null;
      paintingWas.current = {};
      refusedRef.current = null;
      setLiveEvents(0);
      // The refusal has already been said, in the layer model's own words. A
      // second sentence here would either repeat it or, worse, contradict it
      // with "nothing changed" — which is true and useless.
      if (refused !== null && edits.length === 0) {
        return { journalled: false, said: refused };
      }
      if (edits.length === 0 || into === null) {
        // Not silence. A gesture that changed nothing is the most confusing
        // thing an adjustment brush can do, and the reason is always the same
        // one worth teaching: there was no colour under it to transform.
        const nothing =
          tool === "adjust"
            ? "nothing adjusted — the brush found no paint under it"
            : "nothing changed";
        setAnnounce(nothing);
        return { journalled: false, said: nothing };
      }
      const mark: StrokeMark<Address> | undefined =
        groups.length === 0 ? undefined : { mode, groups };
      const stroke = mark === undefined ? { edits } : { edits, mark };
      const name = findLayer(compRef.current, into)?.name ?? "the layer";
      // The edits are ALREADY applied — `paintAt` wrote them into the ref as the
      // pointer moved, each one through a freshly checked `layers.Target` — so
      // this journals the same move rather than applying anything again. The
      // gesture belongs to the layer it STARTED on, and that is `into`.
      // The events ride IN the rung, so they cannot be pushed apart from the
      // stroke — that is what makes the progression index recoverable, and it
      // is now a property of the type rather than of this line. See `layers.Act`.
      setSession((s) =>
        journalAct(
          { ...s, composition: compRef.current },
          [{ kind: "paint", layer: into, stroke, gesture: { from: was } }],
          `painted ${edits.length} cells on ${name}`,
          used
        )
      );
      const verb =
        tool === "erase" ? "erased" : tool === "adjust" ? adjustName : "painted";
      const landed = `${how === "commit" ? "committed — " : ""}${verb} ${
        edits.length
      } cell${edits.length === 1 ? "" : "s"} on ${name} with the ${mode}-fold brush${
        band === null ? "" : `, band ${band}`
      }${isolation === null ? "" : `, arm ${isolation}`} — ${
        flattenComposition(compRef.current, book).size
      } on the plate`;
      setAnnounce(landed);
      return { journalled: true, said: landed };
    },
    [tool, adjustName, mode, band, isolation, book]
  );

  /**
   * ONE undo, over paint and over the shape of the tree alike.
   *
   * `layers.undo` walks the journal that `endStroke`, the panel and the presets
   * all push to, so ⌘Z takes back whatever was actually done last — a stroke, a
   * new layer, a reorder, a paste — in the order it happened. The alternative,
   * a paint stack beside a layer stack, would have made the same keystroke mean
   * two things depending on which the person had in mind.
   *
   * The EVENT LOG only moves for an act that painted. It shadows the journal so
   * the progression index is recoverable, and a reorder spends no colour, so
   * popping it for a structural act would slide every future stroke's hue.
   */
  const doUndo = useCallback(() => {
    if (previewing) {
      setAnnounce("a preview is standing — close it before undoing");
      return;
    }
    const step = undoSession(session);
    if (step.act === null) {
      setAnnounce("nothing to undo");
      return;
    }
    compRef.current = step.session.composition;
    setSession(step.session);
    // Nothing to do for the event log: it IS the journal, so it moved with it.
    // This used to be a guarded `setEvents(undoEvents(events))`, and the guard
    // was the bug — an act nobody counted popped somebody else's rung.
    setAnnounce(
      `undid ${step.act.note} — ${
        flattenComposition(step.session.composition, book).size
      } cells on the plate`
    );
  }, [previewing, session, book]);

  const doRedo = useCallback(() => {
    if (previewing) {
      setAnnounce("a preview is standing — close it before redoing");
      return;
    }
    const step = redoSession(session);
    if (step.act === null) {
      setAnnounce("nothing to redo");
      return;
    }
    compRef.current = step.session.composition;
    setSession(step.session);
    setAnnounce(
      `redid ${step.act.note} — ${
        flattenComposition(step.session.composition, book).size
      } cells on the plate`
    );
  }, [previewing, session, book]);

  // ── the past, previewed ─────────────────────────────────────────────────

  /** How many acts the journal holds. The scrub's upper stop. */
  const steps = past.length;

  /**
   * WHICH PICTURE the beats were counted for.
   *
   * `animationSteps` drops a gesture that changed nothing IN THIS FRAME, so the
   * beat list is a fact about the journal AND about what is on screen: the same
   * drawing framed as sector 3 has fewer beats than the whole hexagon, and a
   * depth change re-resolves every address. The depth, the view and the sector
   * are NOT gated on `previewing` — `pickDepth`, `pickView` and `pickSector` all
   * run while a preview stands — so this is compared rather than assumed.
   *
   * The book's own id already carries the kind and the depth; the frame adds
   * which sector is on screen. `showTiling` is deliberately absent: it decides
   * the fill an erase is drawn IN, and `changedCells` never looks at it.
   */
  const frameKey = `${book.id}|${canvas.view.mode}|${
    canvas.view.mode === "sector" ? canvas.view.sector : "-"
  }`;

  /**
   * The beat list for the frame on screen — one entry per animation step,
   * holding the act that produced it.
   *
   * THE EXPENSIVE CALL IN THIS FILE, and it is deliberately not a `useMemo`.
   * Measured at depth 5 with 256 acts: `everyComposition` 17 ms, flattening its
   * 257 states 172 ms, and the walk itself 16 ms — about 205 ms, none of which
   * caches, because `everyComposition` mints fresh compositions every time and
   * `layers.flatten`'s memo is keyed on their identity. A `useMemo` on `[comp,
   * past]` would therefore pay all of it again on every committed stroke, which
   * is a fifth of a second of hitch on every press of the brush.
   *
   * So it is called ONCE, by `standPlayhead`, at the moment a person asks for a
   * playhead — and the answer is then valid for as long as it is up, because the
   * brush is off while a preview stands.
   *
   * Nothing here is new: these are the first three lines of `animationModel`,
   * without the baked frame and the polygons, which the playhead does not need.
   */
  const frameBeats = useCallback((): number[] => {
    const shown = canvas.view.mode === "sector" ? canvas.shown : undefined;
    return beatsOf(
      everyComposition(comp, past).map((c) => flattenComposition(c, book)),
      shown
    );
  }, [comp, past, canvas, book]);

  /**
   * Open a preview, or move an open one to the other instrument.
   *
   * REPLAY opens at the BEGINNING and starts playing, because that is the whole
   * of what it is for. HISTORY opens at the LIVE state, because a scrub that
   * jumped the drawing somewhere the moment it was opened would be an edit
   * disguised as a control.
   *
   * Everything that names a cell of the live plate is dropped on the way in: a
   * standing candidate is a promise about a plate that is no longer on screen,
   * and committing it would paint onto a state nobody is looking at.
   *
   * ── The beats are counted HERE, and the cost is on purpose ─────────────
   *
   * `frameBeats()` runs on the way in, so the playhead in the layers panel is
   * live for every way of opening a preview — P, M, the two deck buttons and the
   * panel's own PLAYHEAD — rather than for one of them. It costs up to ~205 ms
   * on the largest drawing this program will hold (see `frameBeats`), spent once
   * on a deliberate press that is about to show an animation, which is the one
   * place in this file where a fifth of a second is not a hitch. Every
   * alternative that avoided it made the panel and the preview disagree about
   * whether there was a playhead.
   */
  const openRewind = useCallback(
    (kind: "replay" | "history") => {
      if (steps === 0) {
        setAnnounce(
          `nothing to ${kind === "replay" ? "replay" : "scrub"} — no gesture has been committed yet`
        );
        return;
      }
      disarm();
      setShapeDrag(null);
      setProposal(EMPTY_PROPOSAL);
      setHover(null);
      const index = kind === "replay" ? 0 : steps;
      setRewind({
        kind,
        index,
        comp: stepComposition(compRef.current, past, steps, index),
        playing: kind === "replay",
        beats: frameBeats(),
        frame: frameKey,
      });
      setAnnounce(
        kind === "replay"
          ? `replay — ${steps} gesture${steps === 1 ? "" : "s"} at ${stepMs} ms each; the plate is a preview and nothing is being changed`
          : `history — ${steps} gesture${steps === 1 ? "" : "s"}; drag the scrub to preview an earlier state. Nothing is changed until REVERT`
      );
    },
    [steps, past, disarm, stepMs, frameBeats, frameKey]
  );

  const closeRewind = useCallback((why: string) => {
    setRewind(null);
    setAnnounce(why);
  }, []);

  /**
   * Move the preview to state `to`.
   *
   * Stepped FROM WHERE IT STANDS rather than rebuilt from the base, so a
   * play-step costs one gesture's edits and a scrub costs only the gestures it
   * crosses. See `stateAt`.
   */
  const seekRewind = useCallback(
    (to: number, say = true) => {
      setRewind((r) => {
        if (r === null) return r;
        const n = Math.min(Math.max(0, Math.round(to)), steps);
        if (n === r.index) return r;
        return { ...r, index: n, comp: stepComposition(r.comp, past, r.index, n) };
      });
      if (say) {
        const n = Math.min(Math.max(0, Math.round(to)), steps);
        setAnnounce(
          n === steps
            ? `state ${n} of ${steps} — the live drawing`
            : `state ${n} of ${steps} — ${steps - n} gesture${
                steps - n === 1 ? "" : "s"
              } after this`
        );
      }
    },
    [steps, past]
  );

  const togglePlay = useCallback(() => {
    setRewind((r) => {
      if (r === null) return r;
      // Playing from the end is a replay from the top, which is what the button
      // plainly means at that point and what a second press of P should do.
      if (!r.playing && r.index >= steps) {
        return {
          ...r,
          index: 0,
          comp: stepComposition(r.comp, past, r.index, 0),
          playing: true,
        };
      }
      return { ...r, playing: !r.playing };
    });
  }, [steps, past]);

  /**
   * The clock.
   *
   * One `setTimeout` per step rather than one interval for the whole run: the
   * step is a state change, so the effect re-runs anyway, and a timeout that is
   * created and cleared per step cannot drift out of step with an index that
   * was moved by hand — dragging the scrub mid-play simply continues from where
   * it was dropped.
   */
  useEffect(() => {
    // Nothing is set here synchronously. The clock only ever schedules, and the
    // LAST step is the one that stops it — a replay that had to notice it had
    // finished on a later render would be a second place the end is decided.
    if (rewind === null || !rewind.playing || rewind.index >= steps) return;
    const id = window.setTimeout(() => {
      const n = Math.min(rewind.index + 1, steps);
      setRewind({
        ...rewind,
        index: n,
        comp: stepComposition(rewind.comp, past, rewind.index, n),
        playing: n < steps,
      });
      if (n >= steps) {
        setAnnounce(
          `replay finished — ${steps} gesture${
            steps === 1 ? "" : "s"
          } played back; the drawing is exactly as it was`
        );
      }
    }, stepMs);
    return () => window.clearTimeout(id);
  }, [rewind, steps, past, stepMs]);

  // ── the playhead ────────────────────────────────────────────────────────

  /**
   * THE PLAYHEAD IS NOT A SECOND SCRUB. It is the SAME position, read in the
   * space the animation is actually written in.
   *
   * There is one preview in this program and one index in it — `rewind.index`,
   * a count of committed ACTS — and everything below leaves that as the
   * authority for what is on the plate. What the panel shows is that same
   * position mapped through `rewind.beats` into STEP space, and what the two
   * marks are stored in is step space, because that is the space `replay.InOut`,
   * `boundAnimation` and `emit.EmitLayer.reveal` all live in.
   *
   * Building a second position would have meant two things that can disagree
   * about what the plate is showing. Building the playhead in ACT space instead
   * would have been simpler and wrong: `animationSteps` drops a gesture that
   * changed nothing in this frame, so an act index is not an animation step,
   * marks made on it would name beats the replay does not have, and they would
   * name different ones the moment the view changed. `lib/timeline.ts` carries
   * the argument in full.
   *
   * THE OLD SCRUB STAYS, in the rewind bar, in act space. It is not the same
   * reading and it should not be: it can stand on a rename or a reorder, which
   * the animation has no beat for, and REVERT counts in exactly those acts.
   */
  /**
   * Is there a beat list, and was it counted for the picture that is on screen?
   *
   * Both halves matter. No preview means no beats at all — they are only ever
   * counted on the way into one. A STALE frame means beats that describe a
   * different picture, and reporting their count beside a plate they were not
   * counted from is the one lie this strip could tell, so a frame change closes
   * the playhead and offers to count again.
   */
  const playFresh = rewind !== null && rewind.frame === frameKey;
  const playSteps = playFresh ? rewind.beats.length : 0;
  const playAt = playFresh ? stepAtAct(rewind.beats, rewind.index) : null;

  /**
   * Stand the playhead up — the panel's own way in.
   *
   * Three cases, and the third is the one worth having: a preview is already up
   * but the FRAME has moved under it (a depth change, a flip to sector view),
   * so the beats were counted for a picture nobody is looking at. Recount in
   * place rather than reopening, which would jump the plate.
   */
  const standPlayhead = useCallback(() => {
    if (steps === 0) {
      setAnnounce("no playhead — no gesture has been committed yet");
      return;
    }
    if (rewind === null) {
      // HISTORY rather than REPLAY: it opens at the live state, so standing the
      // playhead up does not jump the picture. `openRewind` argues that split.
      openRewind("history");
      return;
    }
    const beats = frameBeats();
    setRewind((r) => (r === null ? r : { ...r, beats, frame: frameKey }));
    setAnnounce(
      `playhead — ${beats.length} animation step${
        beats.length === 1 ? "" : "s"
      } in this frame, over ${steps} committed gesture${steps === 1 ? "" : "s"}`
    );
  }, [steps, rewind, openRewind, frameBeats, frameKey]);

  /**
   * Move the playhead to a rail position, and the one preview with it.
   *
   * `GROUND` is a rail position and not a step — it is the plate the animation
   * opens on, which in act space is state 0 — so it is the one value that does
   * not go through `actAtStep`.
   */
  const seekPlayhead = useCallback(
    (to: number) => {
      if (rewind === null) return;
      const beats = rewind.beats;
      const step = Math.min(Math.max(GROUND, Math.round(to)), beats.length - 1);
      seekRewind(step <= GROUND ? 0 : actAtStep(beats, step), false);
      setAnnounce(
        step <= GROUND
          ? `before step 0 — the plate the replay opens on, ${beats.length} step${
              beats.length === 1 ? "" : "s"
            } to come`
          : `step ${step} of ${beats.length - 1}`
      );
    },
    [rewind, seekRewind]
  );

  /**
   * Set a mark where the playhead stands.
   *
   * `timeline.markIn`/`markOut` route every edit through `replay.clampSpan`, so
   * the panel cannot form a span the payload writer would refuse and an inverted
   * pair collapses the way the model says it does. The announcement reports the
   * span that RESULTED rather than the one that was asked for, which is the only
   * way a person learns that setting an out point before their own in point gave
   * them a one-step replay.
   */
  const setMark = useCallback(
    (end: "in" | "out") => {
      if (rewind === null || playAt === null || playSteps === 0) return;
      const next =
        end === "in"
          ? markIn(playSpan, playAt, playSteps)
          : markOut(playSpan, playAt, playSteps);
      setPlaySpan(next);
      setAnnounce(`${end} point at step ${playAt} — ${spanSaid(next, playSteps)}`);
    },
    [rewind, playAt, playSteps, playSpan]
  );

  const clearMarks = useCallback(() => {
    setPlaySpan(null);
    setAnnounce(
      "in and out points cleared — the replay and both animated exports play the whole drawing"
    );
  }, []);

  /**
   * What reverting to the previewed state would cost, computed against the LIVE
   * journal so the number in the button is the number the button will do.
   *
   * The moves are the inverses of every act between, latest first — see
   * `composer.revertMoves` for why a symmetric difference of two plates is not
   * available once the drawing is a tree.
   */
  const revert = useMemo(() => {
    if (rewind === null) return null;
    const moves = revertMoves(past, steps, rewind.index);
    if (moves.length === 0) return null;
    let changed = 0;
    for (const m of moves) if (m.kind === "paint") changed += m.stroke.edits.length;
    return {
      moves,
      rolledBack: steps - clampAct(rewind.index, steps),
      discardedRedo: session.journal.future.length,
      changed,
    };
  }, [rewind, past, steps, session]);

  /**
   * REVERT: one more gesture, not a truncation.
   *
   * The edits that take the live plate back to the previewed state are pushed
   * as an ordinary undoable stroke, so NEW remains the only control on the page
   * that destroys anything and ⌘Z puts every rolled-back gesture back at once.
   * It spends ZERO colouring events, on the same rule an erase or a preset
   * does: the progression's argument is a sum over the log, the log gains a
   * rung, and undoing the revert pops it — nothing drifts.
   *
   * The one thing that IS lost is the redo branch, because pushing any gesture
   * clears it. So the guard fires exactly when there is a redo branch to lose,
   * and not otherwise: an armed button that appears when nothing is at stake is
   * how people learn to click through guards.
   */
  const doRevert = () => {
    if (rewind === null || revert === null) {
      setAnnounce("the drawing already stands at that state — nothing to revert");
      return;
    }
    if (revert.discardedRedo > 0 && armed !== "revert") {
      arm(
        "revert",
        `REVERT is armed — click again to roll back ${revert.rolledBack} gesture${
          revert.rolledBack === 1 ? "" : "s"
        }, which also discards ${revert.discardedRedo} redo step${
          revert.discardedRedo === 1 ? "" : "s"
        } for good, or press Escape`
      );
      return;
    }
    disarm();
    const at = rewind.index;
    const next = journalAct(session, revert.moves, `reverted to state ${at}`);
    compRef.current = next.composition;
    setSession(next);
    setRewind(null);
    setAnnounce(
      `reverted to state ${at} — ${revert.rolledBack} act${
        revert.rolledBack === 1 ? "" : "s"
      } rolled back over ${revert.changed} cell${
        revert.changed === 1 ? "" : "s"
      } as ONE undoable step; ⌘Z brings them all back${
        revert.discardedRedo === 0
          ? ""
          : `. ${revert.discardedRedo} redo step${
              revert.discardedRedo === 1 ? "" : "s"
            } discarded`
      }`
    );
  };

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
      nothing: string,
      /**
       * The symmetry the gesture used, when it had one. A preset does not: it
       * is a statement about the whole figure rather than an orbit, and saying
       * otherwise would put a symmetry in the animated file that the gesture
       * never claimed.
       */
      mark?: StrokeMark<Address>
    ) => {
      // The same refusal the brush gets, said in the same words: a preset is a
      // gesture and it lands in the selected layer like any other.
      const target = paintTarget(compRef.current);
      if (!target.ok) {
        setAnnounce(target.said);
        return;
      }
      const into = target.value.layer;
      const edits = planPlateEdits(
        into.plate,
        book,
        cells.map((c) => book.addr[c]),
        colours
      );
      if (edits.length === 0) {
        setAnnounce(nothing);
        return;
      }
      const stroke = mark === undefined ? { edits } : { edits, mark };
      // `journalAct` APPLIES as well as records, and the effect on `compRef`
      // puts the ref back in step on the next render — so there is exactly one
      // place the composition is written and no chance of the two disagreeing.
      // `gesture.from` is read here rather than captured earlier because this
      // route applies nothing before journalling: the layer still carries
      // whatever gesture the paint is about to invalidate.
      setSession((s) =>
        journalAct(
          { ...s, composition: compRef.current },
          [
            {
              kind: "paint",
              layer: into.id,
              stroke,
              gesture: { from: gestureOf(into) },
            },
          ],
          said(edits.length),
          spent
        )
      );
      setAnnounce(said(edits.length));
    },
    [book]
  );

  // ── the layers panel ────────────────────────────────────────────────────

  /**
   * An operation that may decline, applied or said.
   *
   * Every structural control funnels through here, so a refusal is surfaced in
   * the layer model's OWN words — "L2 is locked" and "L2 is inside a locked
   * layer" are different sentences and the difference is the whole point of
   * them. The page never composes its own version of a refusal it was handed.
   */
  const run = useCallback((out: Outcome<Session>, said?: string) => {
    if (!out.ok) {
      setAnnounce(out.said);
      return;
    }
    compRef.current = out.value.composition;
    setSession(out.value);
    const note = out.value.journal.past[out.value.journal.past.length - 1]?.note;
    setAnnounce(said ?? note ?? "done");
  }, []);

  /** A control that always succeeds. `addLayer` is the only one. */
  const runSession = useCallback((next: Session, said: string) => {
    compRef.current = next.composition;
    setSession(next);
    setAnnounce(said);
  }, []);

  /**
   * SELECT, VISIBLE and LOCKED are not journalled, and that is `layers.ts`'s
   * decision rather than this page's: toggling a switch destroys nothing, its
   * inverse is the same button, and the button is on screen showing its own
   * state. Undo exists for work you cannot trivially put back.
   *
   * They take and return a `Composition` rather than a `Session` for exactly
   * that reason — the signature says which kind of operation it is — so these
   * three keep the journal untouched by construction.
   */
  const pickLayer = useCallback((id: LayerId | null) => {
    setSession((s) => ({ ...s, composition: selectLayer(s.composition, id) }));
  }, []);

  /**
   * The switch is flipped against `compRef`, and the sentence is composed
   * OUTSIDE the state updater.
   *
   * It was inside one, and that is a real defect rather than a style point: an
   * updater must be pure, React is free to call it twice, and it is not
   * guaranteed to run before the next line — so the live region announced the
   * PREVIOUS action, one press behind, for the whole of a session. Caught by
   * driving the page rather than by reading it.
   */
  const flipVisible = useCallback((id: LayerId) => {
    const composition = toggleVisible(compRef.current, id);
    compRef.current = composition;
    const l = findLayer(composition, id);
    const eff = l === null ? null : effectiveOf(composition, id);
    const own = switchesOf(composition, id);
    setAnnounce(
      l === null
        ? "that layer is not in the drawing"
        : `${l.name} ${own.visible ? "shown" : "hidden"}${
            eff !== null && own.visible && !eff.shown
              ? " — still not on the plate, because it is inside a hidden layer"
              : ""
          }`
    );
    setSession((s) => ({ ...s, composition }));
  }, []);

  const flipLocked = useCallback((id: LayerId) => {
    const composition = toggleLocked(compRef.current, id);
    compRef.current = composition;
    const l = findLayer(composition, id);
    const eff = l === null ? null : effectiveOf(composition, id);
    const own = switchesOf(composition, id);
    setAnnounce(
      l === null
        ? "that layer is not in the drawing"
        : `${l.name} ${own.locked ? "locked" : "unlocked"}${
            eff !== null && !own.locked && !eff.editable
              ? " — still not editable, because it is inside a locked layer"
              : ""
          }`
    );
    setSession((s) => ({ ...s, composition }));
  }, []);

  /**
   * The anchored figure, committed.
   *
   * One application, so ONE colouring event — a line is a gesture, not a run of
   * them, and undoing it must take the progression back by exactly one step.
   */
  const commitShape = useCallback(() => {
    const d = shapeDrag;
    setShapeDrag(null);
    if (d === null || previewing) return;
    const built = shapeStampFor(d.anchor, d.at, d.alt);
    if (built === null || built.stamp.cells.length === 0) {
      setAnnounce("nothing changed — the figure reached no cell the brush may touch");
      return;
    }
    const n = progressionIndex(events, progOrigin, 0);
    const shown = flattenComposition(compRef.current, book);
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
        : "nothing changed",
      // A line is a source row and its images under the subgroup; a ring is one
      // orbit-indexed set. Both arrive as a stamp, so both carry their grouping
      // into the history with nothing here having to know which is which.
      {
        mode,
        groups: (built.stamp.groups ?? [built.stamp.cells])
          .filter((g) => g.length > 0)
          .map((g) => g.map((c) => book.addr[c])),
      }
    );
  }, [
    shapeDrag,
    previewing,
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
      if (previewing) return;
      // The whole plate, in every sector — a preset is a statement about the
      // FIGURE and the figure is the hexagon. Each sector receives the same
      // canonical colouring, so a framed sector then shows exactly the drawing
      // the standalone triangle canvas used to show. `presets.ts` asserts the
      // gasket count per sector while it does it.
      const colours = presetColours(name, hex, effectiveBase.hex);
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
    [previewing, hex, effectiveBase, layStroke]
  );

  // ── propose and commit ──────────────────────────────────────────────────

  /**
   * One more application onto the standing proposal. NOTHING TOUCHES THE PLATE.
   *
   * The board calls this on the press and again on every cell a propose-mode
   * drag enters, which is the same event stream `paintAt` gets in paint mode —
   * that symmetry is the feature. `proposeSeed` drops a repeat of a seed already
   * held and hands back the same array, so a finger resting on a cell boundary
   * does not even cause a render; see `propose.ts` for why a duplicate would be
   * worse than useless.
   *
   * The hover ghost is cleared because during a drag the pointer IS the gesture,
   * and a stale hover from before the press would be a second ghost claiming to
   * be somewhere the finger is not.
   */
  const propose = useCallback(
    (i: number) => {
      if (previewing) return;
      // The same guard `paintAt` carries, and it has to be here as well rather
      // than only at the commit: a proposal is a promise about what a commit
      // will lay, so gathering a seed the brush may not use would show a ghost
      // that commits to nothing.
      if (!inFocus(i)) return;
      noteSector(i);
      setProposal((p) => proposeSeed(p, i));
      setCursor(i);
      setHover(null);
    },
    [previewing, inFocus, noteSector]
  );

  /**
   * A commit was asked for and laid nothing. Say why, and keep the work.
   *
   * ONE DOOR for every way that can happen — a locked target, a brush that would
   * change no cell, a tap the browser took away — so the sentence and the "still
   * standing" clause can never come apart. The proposal is deliberately NOT
   * cleared here: that is the whole of the fix, and `commitProposal`'s header
   * says what clearing it used to cost.
   */
  const blockProposal = useCallback(
    (why: string) => {
      // There is no such thing as a blocked EMPTY proposal, and the guard is not
      // only tidiness: `EMPTY_PROPOSAL` is one shared constant, so storing it
      // here would make `blocked === proposal` true for every empty proposal
      // afterwards — the identity trick the whole arrangement rests on, defeated
      // by the one value that is not unique.
      if (proposal.length === 0) return;
      setBlocked({ proposal, why });
      // `said` renders `blocked.why` while the proposal stands, so this is not
      // what the user hears now — it is what `announce` should hold once the
      // proposal is gone, so the last thing said stays true after a drop.
      setAnnounce(why);
    },
    [proposal]
  );

  /**
   * The whole proposal, laid down as ONE RUNG OF THE JOURNAL.
   *
   * This is the decision the whole feature turns on, so it is worth saying
   * plainly what makes it hold. `paintAt` journals NOTHING: it applies the brush
   * into `compRef` and accumulates the gesture in refs — the merged edits, the
   * colouring events spent, and one `StrokeMark` group per application.
   * `endStroke` is the only function on this page that pushes a paint rung, and
   * it is called exactly ONCE here, after the loop. So a five-seed proposal is
   * one rung and one undo takes back all five, rather than five rungs and a
   * lottery about how many presses of ⌘Z put the plate back.
   *
   * The loop is also what keeps the record honest in the other two ways. Each
   * seed gets its own `brushStamp`, so each keeps its own `span` and its own
   * scheme positions — merging the seeds into one stamp would collapse those and
   * repaint the proposal in hues the ghost never showed. And each pushes its own
   * entry into `pendingGroups`, in the order applied, which is exactly what
   * `StrokeMark.groups` is defined to be and what `provenance.gestureLayers`
   * reads to decide whether the gesture is one layer or a parent with a child per
   * orbit. No merged super-group is invented anywhere.
   *
   * Seeds whose applications change nothing simply contribute nothing: `paintAt`
   * returns before spending an event or pushing a group when the stamp is empty
   * or the edits are all no-ops, and `endStroke` declines to journal a gesture
   * with no edits at all. So a proposal entirely over cells the brush cannot
   * touch commits nothing and says so, rather than pushing an empty rung.
   *
   * ── A COMMIT THAT LAID NOTHING DOES NOT SPEND THE PROPOSAL ──────────────
   *
   * This used to clear the proposal unconditionally, and on a locked target layer
   * that was the worst outcome available: `paintAt` refuses all N seeds, the live
   * region says "L2 is locked", and the N gathered applications are gone — with
   * no rung, so ⌘Z cannot bring them back either. The user unlocks the layer and
   * finds there is nothing left to commit.
   *
   * So the proposal is spent ONLY on the strength of `endStroke`'s answer, and
   * `dropProposal`'s discipline applies to every other outcome: say plainly that
   * the plate is unchanged and that the work is still standing, rather than
   * leaving the user to infer it from a sentence about a lock. `blockProposal`
   * is that sentence; see `said` for why it cannot simply go into `announce`.
   *
   * ── AND IT IS GATED THE SAME WAY THE BUTTON IS ─────────────────────────
   *
   * `proposalCommits === 0` disables the COMMIT button — an adjustment proposal
   * over bare tiling really would change nothing — but the button is one of three
   * doors into this function. The other two are a tap on the ghost and Enter on a
   * held seed, and until now neither was gated at all, so the gesture routes did
   * something the visible control refused to do: spend the proposal on a commit
   * that laid nothing. The gate is here, at the one place all three arrive, which
   * is also the only place it cannot be forgotten by a fourth caller.
   */
  const commitProposal = useCallback(() => {
    if (proposal.length === 0 || previewing) return;
    // The same number `proposalCommits` reports and the button is disabled on,
    // recomputed rather than shared because that memo is declared below this
    // callback. It is a union over a handful of orbits, once per commit.
    if (unionCells(proposalSpecs.map((s) => s.cells)).length === 0) {
      blockProposal(
        tool === "adjust"
          ? "nothing to commit — the brush found no paint under any of these applications"
          : "nothing to commit — the brush would change no cell here"
      );
      return;
    }
    for (const seed of proposal) paintAt(seed);
    const end = endStroke("commit");
    if (end.journalled) {
      setProposal(EMPTY_PROPOSAL);
      setBlocked(null);
      return;
    }
    // `endStroke` hands back the words it left standing — the layer model's own
    // for a refusal, the brush's for a gesture that moved nothing. This adds the
    // half they cannot know: the proposal is still there.
    blockProposal(end.said);
  }, [proposal, proposalSpecs, previewing, tool, paintAt, endStroke, blockProposal]);

  /**
   * The browser took the commit tap away before the finger came up.
   *
   * `DrawBoard.proposeRelease` lists the four ordinary ways that happens — palm
   * rejection, an OS edge gesture, a second contact starting a pinch, a
   * long-press menu — and every one of them is a thing a hand does on a phone,
   * which is the platform propose mode exists for. The proposal is untouched, so
   * the only failure available here is silence: a tap on the ghost that lays
   * nothing and says nothing reads as a control that stopped working.
   */
  const commitCancelled = useCallback(() => {
    blockProposal(
      "the commit tap was cancelled — the browser took the pointer before your finger came up"
    );
  }, [blockProposal]);

  /**
   * Drop it. No plate change, no rung, nothing to undo — which is the sentence
   * the live region says, because "dropped" alone leaves open whether the work
   * went somewhere recoverable.
   */
  const dropProposal = useCallback(() => {
    if (proposal.length === 0) return;
    const n = proposal.length;
    setProposal(EMPTY_PROPOSAL);
    setAnnounce(
      `proposal dropped — ${n} application${
        n === 1 ? "" : "s"
      } discarded; the plate is unchanged and there is nothing to undo`
    );
  }, [proposal]);

  const pickDragMode = (next: DragMode) => {
    if (next === dragMode) return;
    setDragChoice(next);
    setProposal(EMPTY_PROPOSAL);
    setAnnounce(
      next === "propose"
        ? "drag gathers a proposal; tap it or press Enter to commit it as one gesture"
        : "drag paints continuously"
    );
  };

  /**
   * Choose a tool. Writes the SELECTION, never the momentary override.
   *
   * Compared against `pickedTool` rather than against `tool`, and the difference
   * is reachable: with the momentary eraser held, `tool` is already "erase", so
   * comparing against it would make clicking the ERASE button a no-op — the one
   * click whose whole meaning is "make this one stick". Against the selection it
   * does what it says, and the release then reveals erase instead of undoing it.
   */
  const pickTool = useCallback(
    (next: Tool) => {
      if (next === pickedTool) return;
      setPickedTool(next);
      setAnnounce(
        eraseHeld && next !== "erase"
          ? `${next} tool — ${TOOL_LABEL[next]}; erase is held, so it takes over when Option is released`
          : `${next} tool — ${TOOL_LABEL[next]}`
      );
    },
    [pickedTool, eraseHeld]
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
          : `band ${next} — ${BAND_NOTE[bandKind][next]}; ${brushSpan(
              canvas.surface,
              canvas.bands,
              {
                mode,
                band:
                  viewMode === "sector" ? sectorBandFamily(next, sector) : next,
              },
              // Probed at a cell of the FRAME. The whole-plate groups give one
              // answer at every cell; the sector scope does not — see
              // `brushSpan` — so a readout taken at cell 0 would be about
              // sector 0 whichever sector is on screen.
              canvas.shown[0] ?? 0
            )} rows under the ${mode}-fold brush`
      );
    },
    [band, bandKind, viewMode, sector, canvas, mode]
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
      // The HOVER ghost follows the cursor in both drag modes now. It used to
      // move the candidate in propose mode, which was right while a proposal was
      // one cell — arrowing moved the one thing that could be committed. A
      // proposal is a set that only grows by an explicit Enter, so arrowing must
      // not add to it; what the cursor wants is the ghost of the application
      // Enter WOULD add, and that is exactly the hover ghost.
      setHover(next);
      if (said !== null) setAnnounce(said);
    },
    [noteSector]
  );

  const onArrow = useCallback(
    (dir: Direction) => {
      // Clipped to the FRAME, so an arrow key cannot walk the cursor into a
      // sector nobody can see. In hexagon view `inView` admits everything and
      // this is the walk it always was.
      const next = stepCursor(canvas.centroids, cursor, dir, canvas.inView);
      if (next < 0) return;
      putCursor(next, null);
    },
    [canvas, cursor, putCursor]
  );

  /**
   * Where the cursor sits, in the words the FRAME has for it.
   *
   * A framed sector is the base triangle, so it has an apex and rows counted
   * from it — read off the base figure's own lattice at the cell's base index,
   * which is the same number the standalone triangle canvas used to report.
   */
  const placeOf = useCallback(
    (i: number) => {
      const ring = canvas.lattice.ringOf(i);
      const c = canvas.hex.cells[i];
      if (canvas.view.mode === "hexagon") return `sector ${c.sector}, ring ${ring}`;
      return `row ${canvas.baseLattice.rowOf(c.base)} from the apex, ring ${ring}`;
    },
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
        const start = stepCursor(canvas.centroids, null, "up", canvas.inView);
        if (start < 0) return;
        putCursor(start, `cursor at cell ${start} — ${placeOf(start)}`);
        return;
      }
      const next = canvas.lattice.step(cursor, dir);
      if (next < 0) {
        setAnnounce(`${dir} — the plate ends here; the cursor did not move`);
        return;
      }
      // A ring step is a lattice step and the lattice runs straight across the
      // sector seams — that is what makes a hexagon band a genuine row. In a
      // framed sector it would therefore walk the cursor out of the picture, so
      // the frame stops it and SAYS so, on the same rule as the plate's edge: a
      // cursor that reappears somewhere invisible has told the user a lie about
      // the figure. Switch to the whole plate and the same key crosses freely.
      if (!canvas.inView(next)) {
        setAnnounce(
          `${dir} — sector ${sector} ends here; the cell beyond it is on the plate but not in this frame`
        );
        return;
      }
      putCursor(next, `${dir} — cell ${next}, ${placeOf(next)}`);
    },
    [canvas, cursor, putCursor, placeOf, sector]
  );

  const onRadial = useCallback(
    (way: Radial) => {
      if (cursor === null) {
        const start = stepCursor(canvas.centroids, null, "up", canvas.inView);
        if (start < 0) return;
        putCursor(start, `cursor at cell ${start} — ${placeOf(start)}`);
        return;
      }
      const next = canvas.lattice.radial(cursor, way);
      if (next >= 0 && !canvas.inView(next)) {
        // MEASURED, having first been written down the other way twice and
        // caught both times by `test/view.test.ts`. A radial step translates by
        // a multiple of rot^s(1,1) — the sector median's DIRECTION, applied to
        // every cell of the sector and not only to the ones on the median — and
        // near the apex the wedge is narrow enough that the step carries a cell
        // clean out of it. Only `in` ever does; at depth 2 it is 42 of the 96
        // cells. So the frame guards it, on the same rule as the ring keys.
        setAnnounce(
          `inward — the cell inward from here is in sector ${
            canvas.hex.cells[next].sector
          }, on the plate but outside this frame; the cursor did not move`
        );
        return;
      }
      if (next < 0) {
        setAnnounce(
          `${way === "out" ? "outward" : "inward"} — the ${
            canvas.view.mode === "sector"
              ? way === "out"
                ? "sector's outer edge"
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
    if (previewing) return;
    if (cursor === null) {
      const start = stepCursor(canvas.centroids, null, "up", canvas.inView);
      if (start < 0) return;
      noteSector(start);
      setCursor(start);
      // The first Enter only lands the cursor and its ghost — in both modes now,
      // because in propose mode Enter is the ADD gesture and adding a seed the
      // user has not yet seen a ghost of would be proposing blind.
      setHover(start);
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
      // Enter on a cell the proposal ALREADY holds commits the whole set; Enter
      // anywhere else adds that cell to it. That is the one-candidate rule
      // generalised rather than replaced — pressing Enter twice on one cell
      // still proposes then commits — and it gives the keyboard the same two
      // gestures the pointer has, where a tap inside the standing ghost commits
      // and a tap outside it proposes.
      if (proposalHolds(proposal, cursor)) commitProposal();
      else propose(cursor);
      return;
    }
    paintAt(cursor);
    endStroke();
  }, [
    previewing,
    noteSector,
    cursor,
    canvas,
    dragMode,
    proposal,
    commitProposal,
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
      setProposal(EMPTY_PROPOSAL);
      setAnnounce(
        next === "free"
          ? "free brush — every cell the pointer crosses is an application"
          : next === "line"
          ? "line — press, drag along a lattice row and release; the row snaps to one of the three band families, and Option centres it on the anchor"
          : `ring — press, drag outward and release; the ring is a level set of the exact hexagonal norm about the plate's centre${
              viewMode === "sector" ? ", cut by the framed sector" : ""
            }, and Option centres the annulus on the anchor`
      );
    },
    [viewMode]
  );

  const openHelp = useCallback(() => {
    helpOpener.current = document.activeElement as HTMLElement | null;
    // `?` is reachable from inside the save menu — it is the one key the menu
    // does not swallow — and a menu left standing behind the scrim would be a
    // panel over the artwork with nothing pointing at it.
    setSaveWanted(false);
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

  /**
   * Both exports write the LIVE plate, so both are off while a preview stands
   * and off on an empty plate.
   *
   * Which means the menu can be open when its own trigger goes dead — opening a
   * replay from the keyboard will do it — and the menu has to go with it, or it
   * is two items floating over the artwork that no longer do anything. So the
   * open state is DERIVED rather than synchronised: `saveWanted` is what the
   * user asked for and `saveOpen` is what is true, and there is no effect that
   * has to notice the difference and correct it a render later.
   */
  const saveOff = paint.size === 0 || previewing;
  const saveOpen = saveWanted && !saveOff;

  /**
   * Close the save menu, and put the focus back where it was taken from.
   *
   * `refocus` is false for the one path where the pointer has already moved the
   * focus somewhere else — a click outside — because pulling it back to a
   * button the user has just clicked away from is a keyboard trap with good
   * manners.
   */
  const closeSaveMenu = useCallback((refocus = true) => {
    setSaveWanted(false);
    if (refocus) saveBtn.current?.focus();
  }, []);

  /** The menu opens with its first item under the finger, mouse or keyboard. */
  useEffect(() => {
    if (!saveOpen) return;
    saveMenu.current?.querySelector("button")?.focus();
  }, [saveOpen]);

  /** A click anywhere else dismisses it, which is the one thing every menu does. */
  useEffect(() => {
    if (!saveOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!saveWrap.current?.contains(e.target as Node)) setSaveWanted(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [saveOpen]);

  /**
   * Roving focus inside the menu.
   *
   * Two items, so this is short — but it is the difference between a menu and a
   * pair of buttons in a box, and `role="menu"` promises it.
   */
  const onMenuKey = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const items = Array.from(
        saveMenu.current?.querySelectorAll("button") ?? []
      );
      const at = items.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const step = e.key === "ArrowDown" ? 1 : -1;
        items[(at + step + items.length) % items.length]?.focus();
        return;
      }
      if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        (e.key === "Home" ? items[0] : items[items.length - 1])?.focus();
        return;
      }
      // Tab leaves, and a menu that stayed open behind the focus would be a
      // panel floating over the artwork with nothing pointing at it.
      if (e.key === "Tab") closeSaveMenu(false);
    },
    [closeSaveMenu]
  );

  /** Down-arrow opens it, which is what `aria-haspopup` tells a reader it will. */
  const onSaveKey = useCallback((e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setSaveWanted(true);
    }
  }, []);

  /**
   * The manual zoom. Still the only public way to set the factor by hand, and
   * still the only place the clamp lives.
   *
   * It CANCELS a drill-in travel first, which is what keeps the "one writer"
   * claim true: the tween and the stepper write the same state, so the last
   * thing asked for has to be the thing that survives. A drill-in that a person
   * zooms out of mid-flight stays where they put it, and the focus — the
   * dimming, the breadcrumb, the inert outside — is untouched by that. THE ZOOM
   * AND THE FOCUS ARE DELIBERATELY NOT LOCKED TOGETHER: the owner asked for
   * isolate to zoom, not for zoom to become unavailable while isolated.
   *
   * The readout is rounded where it is displayed rather than here, because a
   * drill-in lands on whatever factor makes the focused cells fill the frame and
   * rounding the STATE would move the picture off the thing it just framed.
   */
  const setZoomTo = useCallback(
    (z: number) => {
      stopEasing();
      const next = Math.min(ZOOM_MAX, Math.max(1, z));
      setZoom(next);
      if (next === 1) setCentre(null);
      setAnnounce(
        next === 1
          ? "zoom 1× — the whole figure"
          : `zoom ${Math.round(next * 10) / 10}× — hold Space and drag to pan`
      );
    },
    [stopEasing]
  );

  /**
   * A pan, in canvas units. The clamp lives in the `view` memo, so a drag that
   * pushes past the rim simply stops rather than being refused mid-gesture.
   */
  const onPan = useCallback(
    (dx: number, dy: number) => {
      // A hand on the plate outranks a travel that is still arriving; without
      // this the tween would keep writing the centre out from under the drag.
      stopEasing();
      panned.current = true;
      setCentre((c) => ({
        x: (c?.x ?? canvas.geom.width / 2) - dx,
        y: (c?.y ?? canvas.geom.height / 2) - dy,
      }));
    },
    [canvas, stopEasing]
  );

  // ── Option / Alt: the momentary eraser ──────────────────────────────────
  //
  // THE CONFLICT. Option was already taken. `shapeStampFor` reads an `alt` flag
  // and expands a line or a ring symmetrically about its anchor, `DrawBoard`
  // reads it off the pointer event on every move so that letting go mid-drag
  // un-expands the figure under the finger, and the window key handler has a
  // bare `if (e.altKey) return` so that a stray Option can never fire a letter.
  // All three of those stay.
  //
  // THE RULE, in the owner's words: "The erase should only work if you press
  // opt/alt with no mouse down or drag. So if all you do is click and hold for
  // even a fraction of a second and then hold option, it sets the centroid and
  // scales symmetrically. Hold opt/alt the split second before clicking and it
  // erases."
  //
  // So the meaning is fixed by ORDER, decided once, at the keydown, from
  // `pointers`. `shortcuts.altDown` is that decision and it is pure, which is
  // the only reason any of this is testable at all — vitest runs `environment:
  // "node"` here, so nothing that needs a DOM can be asserted.
  //
  // WHAT IS NOT DONE HERE, and why. The hold is not cancelled when a press
  // starts or ends; it lasts until the key comes up, "including across a
  // subsequent press and drag", so a single Option hold can erase several
  // gestures. And it is not converted into a tool CHANGE — see `pickedTool`.

  /**
   * The one writer of the Alt state, ref and render alike.
   *
   * Announces only on the edge that matters — whether the eraser is in force —
   * so a hold that latches "modifier" says nothing HERE. That is right for the
   * modifier it is named for: the shape modifier has a visible effect on the
   * figure under the finger and has never announced itself, whereas arming a
   * destructive brush from a key with no on-screen control is exactly the thing a
   * live region is for.
   *
   * It is NOT right for the inert `brushOff` hold, which also latches "modifier"
   * and has no figure and no effect to be its own announcement. That decline is
   * said at the keydown, where the reason is still in hand; `shortcuts.
   * altDeclined` is the predicate and the note there is the argument. This edge
   * test is deliberately left alone rather than taught about a third case: it
   * asks one question about a destructive tool and answers it the same way from
   * everywhere, which is the property the whole arrangement rests on.
   */
  const applyAlt = useCallback(
    (next: AltState) => {
      const was = altRef.current;
      altRef.current = next;
      if (was.erasing === next.erasing) return;
      setEraseHeld(next.erasing);
      setAnnounce(
        next.erasing
          ? `erase held — ${shapeTool} shape, ${mode}-fold brush; release Option for the ${pickedTool} tool`
          : `erase released — ${pickedTool} tool`
      );
    },
    [shapeTool, mode, pickedTool]
  );

  /**
   * The pointer census, and the last line of defence against a stuck eraser.
   *
   * CAPTURE PHASE, on the window, so this counts a press whatever else the page
   * does with it — a control that stops propagation, a menu that swallows the
   * click, the canvas releasing pointer capture on the way down.
   *
   * The second half is the guard. `PointerEvent.altKey` is the OS's own answer
   * to "is Option held", taken at the instant of the press, so a press that
   * arrives with it FALSE while this page believes the eraser is armed is proof
   * the page is wrong — a keyup that went to another window, most likely. The
   * hold is dropped, and the press is swallowed rather than let through.
   *
   * Swallowing it is the deliberate part. React attaches its own listeners at
   * the root container, which is inside the window, so `stopPropagation` here
   * means the board never sees this press at all: no stroke, no proposal, no
   * tap toward a double-tap. It costs one ignored click in a state that should
   * not be reachable, and it buys an absolute statement — NO ERASE GESTURE CAN
   * BEGIN UNLESS THE POINTER EVENT ITSELF REPORTS OPTION HELD. Without it the
   * disarm would still be correct but a render late, because `paintAt` reads
   * `tool` from the closure it was built with, and this press would erase.
   *
   * THE CENSUS OWNS ITS OWN RECOVERY, in the same effect and not in the keyboard
   * one, because a census that depends on somebody else's listener for its only
   * way out of a wrong answer is a census with a bug waiting in the next edit.
   * Press and hold on a rail button, Alt-Tab away, let go over there: the
   * `pointerup` is delivered to the other window and never to this one, the id
   * stays in the set, and every later `altDown` reads "a pointer is already down"
   * and refuses to arm the momentary eraser — for the rest of the session. The
   * hold that leaks is exactly the hold `blur` fires for, so `blur` is where the
   * set is emptied, with `visibilitychange` behind it for the same reason
   * `applyAlt(altLost())` has both: a page can be hidden without its window
   * losing focus. Emptying is safe rather than merely convenient — a press that
   * really is still down will announce itself again on its next `pointermove`
   * only if it is on the canvas, but its `pointerup` still arrives and
   * `delete` of an absent id is a no-op, so the worst case is one keydown read as
   * "nothing pressed" while the page is not even in front of the user.
   */
  useEffect(() => {
    const down = (e: PointerEvent) => {
      pointers.current.add(e.pointerId);
      if (e.altKey || altRef.current.hold === null) return;
      const armed = altRef.current.erasing;
      applyAlt(altLost());
      if (armed) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const up = (e: PointerEvent) => {
      pointers.current.delete(e.pointerId);
    };
    const forget = () => {
      pointers.current.clear();
    };
    const onHidden = () => {
      if (document.visibilityState === "hidden") forget();
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    window.addEventListener("blur", forget);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
      window.removeEventListener("blur", forget);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, [applyAlt]);

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
      // BEFORE EVERY GUARD BELOW, including the ones that return.
      //
      // If this page believes Option is held and a keystroke arrives saying it
      // is not, it is not — and dropping that belief must not depend on where
      // the focus happens to be or on which of the six early returns this key
      // takes. This is the cheap half of the stuck-modifier defence and it
      // fires on the very next key the user presses; `blur` is the half that
      // fires without them pressing anything.
      if (!e.altKey && altRef.current.hold !== null) applyAlt(altLost());

      const el = document.activeElement;
      // A RANGE is not a text field. It has to swallow the arrows and Home/End,
      // which it does natively, but Escape has to keep closing the preview the
      // slider belongs to — otherwise the one control most likely to have focus
      // while a preview stands is the one place Escape stops working. So it is
      // let through as far as Escape, ⌘Z and `?`, and stopped after them.
      const onRange = el instanceof HTMLInputElement && el.type === "range";
      if (
        (el instanceof HTMLInputElement && !onRange) ||
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
        // Before the confirm and before the preview: the menu is the innermost
        // thing that is open, and Escape unwinds from the inside out.
        if (saveOpen) {
          closeSaveMenu();
          return;
        }
        if (armed !== null) {
          disarm("cancelled — nothing was changed");
          return;
        }
        // Before the proposal and the anchored drag, and it cannot collide
        // with either: both are dropped when a preview opens and neither can be
        // started while one stands.
        if (rewind !== null) {
          closeRewind(
            `${rewind.kind} closed — the drawing is exactly as it was, ${
              flattenComposition(compRef.current, book).size
            } cells on the plate`
          );
          return;
        }
        if (shapeDrag !== null) {
          setShapeDrag(null);
          setAnnounce(`${shapeTool} cancelled`);
          return;
        }
        if (proposal.length > 0) {
          dropProposal();
          return;
        }
        // LAST, and it is the outermost thing there is. Escape unwinds from the
        // inside out — menu, confirm, preview, anchored drag, proposal — and the
        // focus is the only one of them that is not a transient: it is where you
        // ARE rather than something you are part-way through, so nothing should
        // be able to reach it while anything else is standing. One level per
        // press, exactly as the double-tap does; see `focus.exit`.
        drillOut();
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
      // OPTION / ALT DOWN — the one place the meaning of this hold is decided.
      //
      // Reached only after the text-field guard above, which is why holding
      // Option while the hex input has focus arms nothing: a destructive brush
      // that arms while you are typing a colour would be indefensible, and the
      // release still disarms because `onUp` handles Alt outside every guard.
      //
      // `brushOff` covers the three states in which the plate is not editable.
      // A hold latched there stays inert for its whole life rather than going
      // live the moment the panel closes under a finger that never let go.
      //
      // AND IT SAYS SO. `applyAlt` announces on the `erasing` edge, and this
      // decline has none — it substitutes the shape modifier, so nothing changes
      // and nothing was said. That is right for the `pointerDown` decline, where
      // the figure under the finger is the announcement, and wrong here, where
      // there is no figure and no visible effect at all: a key that does nothing
      // and says nothing is indistinguishable from a key that was not received.
      // `altDeclined` carries the distinction; the sentence names WHICH of the
      // three, because "close it and try again" is only actionable if the user
      // knows what to close.
      if (e.key === "Alt") {
        const ctx = {
          pointerDown: pointers.current.size > 0,
          brushOff: previewing || helpOpen || saveOpen,
        };
        const declined = altDeclined(altRef.current, ctx);
        applyAlt(altDown(altRef.current, ctx));
        if (declined) {
          setAnnounce(
            `erase not armed — ${
              previewing
                ? "a preview is standing"
                : helpOpen
                ? "the help panel is open"
                : "the save menu is open"
            }, so the plate cannot be edited. Release Option and press it again once the plate is back`
          );
        }
        return;
      }
      // Option is the shape modifier, read off the pointer event, and — since
      // this change — the momentary eraser as well. Neither is a shortcut
      // prefix, so a stray Alt must not fire a letter.
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
      // An open menu swallows the drawing keys for the same reason the panel
      // does: the focus is inside it, and `P` while a menu item is focused must
      // not start a replay behind it.
      if (saveOpen) return;
      // Past here every key is a drawing key, and the scrub owns them all while
      // it has focus.
      if (onRange) return;

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
          pickReading(reading === "convex" ? "concave" : "convex");
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
        // The SELECTION cycles, not the tool in force. Unreachable while the
        // momentary eraser is held — `if (e.altKey) return` above sees to that
        // — so the two are provably equal wherever this line runs; written
        // against `pickedTool` anyway, because a reader should not have to
        // prove that to know the cycle cannot be knocked out of step by a
        // modifier.
        pickTool(TOOLS[(TOOLS.indexOf(pickedTool) + 1) % TOOLS.length]);
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
        pickRelief(!reliefOn);
        return;
      }
      // DRILL IN and DRILL OUT, on the two letters nearest their own words.
      //
      // The keyboard path exists because every other control that narrows what
      // the brush may touch — the three scope buttons, the four arm buttons — is
      // a real button with a real label, and a drill-in reachable only by
      // double-tapping the canvas would be the first one here that a keyboard
      // cannot work. The breadcrumb is the other half: it is the way OUT that a
      // Tab key can find, and it names every level rather than only the last.
      //
      // NOW LISTED IN THE HELP PANEL, under a group of their own — the gap the
      // previous note here asked to have closed. `lib/shortcuts.ts` says why
      // "focus" is not a sub-heading of "view". They are also still named in
      // the breadcrumb's title text and in the sentence the focus announces,
      // which is how they were discoverable before the panel caught up.
      if (k === "i") {
        drillIn();
        return;
      }
      if (k === "o") {
        if (focus.length === 0) {
          setAnnounce("the whole plate — there is nothing to step out of");
        } else drillOut();
        return;
      }
      // The two previews. P is the transport — open it, and then play/pause it
      // — and M is the scrub. Opening either while the other stands moves the
      // ONE preview across rather than raising a second one.
      if (k === "p") {
        if (rewind !== null && rewind.kind === "replay") togglePlay();
        else openRewind("replay");
        return;
      }
      if (k === "m") {
        if (rewind !== null && rewind.kind === "history") {
          closeRewind("history closed — the drawing is exactly as it was");
        } else openRewind("history");
        return;
      }
      // The view, on the keys nearest the depth pair: V flips the frame, and
      // the two bracket-neighbours step the sector round the plate. Neither is
      // destructive, so neither asks.
      if (k === "v") {
        pickView(viewMode === "sector" ? "hexagon" : "sector");
        return;
      }
      if (e.key === "," || e.key === ".") {
        pickSector(sector + (e.key === "." ? 1 : -1));
        return;
      }
      if (e.key === "[") {
        if (depth <= DEPTHS[0]) setAnnounce(`depth ${depth} is the shallowest`);
        else pickDepth(depth - 1);
        return;
      }
      if (e.key === "]") {
        if (depth >= DEPTHS[DEPTHS.length - 1]) {
          setAnnounce(`depth ${depth} is the deepest`);
        } else pickDepth(depth + 1);
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
      // ALT FIRST, above every guard in this function, and unconditionally.
      //
      // The arm is refused in a text field; the DISARM never is. A release that
      // could be swallowed by wherever the focus drifted to is a release that
      // sometimes leaves a destructive brush on, and "sometimes" is the whole
      // failure mode. There is no state to inspect and no branch: `altUp` is
      // the resting state from anywhere.
      if (e.key === "Alt") {
        applyAlt(altUp());
        return;
      }
      // The same evidence the keydown path uses, on the way up as well. A
      // chord ending on a non-Alt key while we still believe Option is held
      // says otherwise.
      if (!e.altKey && altRef.current.hold !== null) applyAlt(altLost());

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

    /**
     * A window that loses focus mid-hold would keep Space down forever — and,
     * since this change, a destructive brush on forever.
     *
     * THIS IS THE PRIMARY GUARD, not a fallback. Alt-Tab is the ordinary way to
     * leave a browser window and it is done WITH THE KEY DOWN: the OS moves the
     * focus, the keyup is delivered to whatever the user landed on, and this
     * page is never told. Come back and the hand is holding nothing while the
     * page believes otherwise. `blur` fires on the way out, before any of that
     * can matter, so the eraser is already gone when the window is returned to.
     */
    const onBlur = () => {
      setSpaceHeld(false);
      applyAlt(altLost());
    };

    /**
     * And the same on a tab switch.
     *
     * `blur` covers ⌘Tab and Alt-Tab on every browser measured, and covers
     * ⌘Shift-[ / Ctrl-Tab too — so this is belt and braces rather than a case
     * that was seen to leak. It is here because the failure it guards against
     * is a DESTRUCTIVE tool left armed with nothing holding it, which is worth
     * two listeners, and because `visibilitychange` catches the one shape of
     * focus loss `blur` is not specified to: a page hidden without the window
     * itself losing focus.
     */
    const onHide = () => {
      if (document.visibilityState === "hidden") applyAlt(altLost());
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [
    doUndo,
    doRedo,
    dropProposal,
    proposal,
    focus,
    drillIn,
    drillOut,
    helpOpen,
    closeHelp,
    openHelp,
    saveOpen,
    closeSaveMenu,
    armed,
    disarm,
    rewind,
    openRewind,
    closeRewind,
    togglePlay,
    book,
    shapeDrag,
    shapeTool,
    pickShapeTool,
    modes,
    canvas,
    reading,
    reliefOn,
    band,
    pickedTool,
    applyAlt,
    previewing,
    viewMode,
    sector,
    pickView,
    pickSector,
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
  /**
   * The polygons a file is written from, and the wash over them.
   *
   * Lifted out of `svgText` VERBATIM so the animated export can be written from
   * the same shapes: two exporters that each computed the relief bake would be
   * two chances to curve the picture about a different centre, and the still and
   * the animation would then disagree about where a cell is. Nothing here
   * changed — the still writes exactly the bytes it always did.
   */
  const bakedFrame = useCallback(() => {
    const baked = reliefOn
      ? reliefFrame(reliefSurface, restShell(reliefSurface), reading)
      : null;
    const m = canvas.toView;
    // `canvas.geom.cells` is already in the view's pixels; the relief deforms
    // the MODEL, so a baked frame has to be carried through the same transform
    // before it can stand in for them. Deform, then frame — the other order
    // would curve the picture about the wrong centre.
    const cells =
      baked === null
        ? canvas.geom.cells
        : baked.verts.map((verts) => ({
            verts: verts.map((v) => applyAffine(m, v)),
          }));
    const overlay: ArtOverlayGroup[] =
      baked === null
        ? []
        : baked.wash.map((w) => ({
            fill: w.fill,
            opacity: w.alpha,
            shapes: w.cells.filter(canvas.inView).map((i) => cells[i].verts),
          }));
    return { baked, cells, overlay };
  }, [canvas, reliefSurface, reliefOn, reading]);

  /**
   * The payload's ADDRESS statement, which only a one-layer document may make.
   *
   * `payloadFromPaint`'s `plate` field says the drawing at every depth it was
   * painted at, and a reader that predates layers PREFERS it to the flattened
   * cell list. One layer can say it exactly. A stack cannot: the union of the
   * plates is precisely the merge `layers.ts` refuses — a lower layer's fine
   * detail would punch back through an upper layer's wash on the next load — so
   * a stack says nothing here and the legacy reader falls back to `cells`, which
   * is the true composite at the exported depth. Less, and true, rather than
   * more and wrong.
   */
  const legacyAddresses = useMemo(() => {
    const sole = soleLayer(comp);
    return sole === null ? undefined : plateEntries(sole.plate, book);
  }, [comp, book]);

  const fileTitle = useCallback(
    (relief: boolean) =>
      `FOURFOLD — ${
        canvas.view.mode === "sector" ? `sector ${canvas.view.sector}` : "hexagon"
      }, depth ${depth}, ${mode}-fold brush, ${schemeName}${
        band === null ? "" : `, band ${band}`
      }${relief ? `, ${reading} relief` : ""}`,
    [canvas, depth, mode, schemeName, band, reading]
  );

  /**
   * THE DOCUMENT, with its layers intact — what `emit.ts` writes and reads.
   *
   * ONE of these, and it is what the layers panel COPIES, PASTES, EXPORTS and
   * IMPORTS, scoped by a parameter for a single row. Two builders would have
   * been two chances for a copied layer and a saved layer to disagree about
   * what a layer is; see the header of `emit.ts`, which makes the same argument
   * about its own `serialise`.
   *
   * The payload still carries the FLATTENED picture as `cells`, so a reader that
   * predates layers sees the drawing rather than nothing, and `emit.serialise`
   * adds the layer tree beside it.
   */
  const emitDoc = useCallback(() => {
    const { baked, cells, overlay } = bakedFrame();
    const geom = new Map(cells.map((c, i) => [i, c] as const));
    const shown =
      canvas.view.mode === "sector"
        ? canvas.shown
        : Array.from({ length: cells.length }, (_, i) => i);
    const picture = flattenComposition(comp, book);
    return {
      width: canvas.geom.width,
      height: canvas.geom.height,
      cells: geom,
      shown,
      background: PLATE_BG,
      unpainted: showTiling ? TILE : null,
      tileSeam: SEAM,
      paintSeam: PAINT_SEAM,
      weldPaint: weld,
      seamWidth: canvas.geom.seamWidth,
      title: fileTitle(baked !== null),
      layers: emitLayersOf(comp, book),
      overlay,
      animation: null,
      payload: payloadFromPaint(
        "hexagon",
        depth,
        convention,
        picture,
        baked === null ? undefined : { on: true, reading },
        legacyAddresses,
        canvas.view.mode === "sector" ? { sector: canvas.view.sector } : undefined
      ),
    };
  }, [
    bakedFrame,
    canvas,
    comp,
    book,
    showTiling,
    weld,
    depth,
    convention,
    reading,
    fileTitle,
    legacyAddresses,
  ]);

  /**
   * The still, saved.
   *
   * TWO WRITERS, and which one runs is decided by `layers.soleLayer` rather than
   * by a preference. A document that has not grown a stack is a single childless
   * layer, and for it this writes the bytes it has ALWAYS written — same
   * function, same payload, byte for byte — so every file this program has ever
   * produced and every test that reads one is untouched. A document that HAS
   * grown a stack cannot be said by that format at all, so it goes through
   * `emit.serialise`, which states the layers and carries the flattened picture
   * beside them for a reader that predates them.
   */
  const svgText = useCallback(() => {
    const sole = soleLayer(comp);
    if (sole === null) return serialiseEmit(emitDoc());
    const { baked, cells, overlay } = bakedFrame();
    return artworkSvg({
      width: canvas.geom.width,
      height: canvas.geom.height,
      cells,
      // The polygons are the FRAME. The payload below is the whole plate, in
      // every sector — a file exported from a sector view that carried only the
      // sector would quietly destroy five sixths of a drawing the moment it was
      // reloaded, which is the failure this change exists to remove.
      shown: canvas.view.mode === "sector" ? canvas.shown : undefined,
      // The polygons are the plate AS SHOWN, at this depth; the payload below
      // carries the addresses so a load gets back the depths this view cannot
      // draw. A viewer that only looks at the picture sees exactly the screen.
      paint: resolvePlate(sole.plate, book),
      background: PLATE_BG,
      unpainted: showTiling ? TILE : null,
      tileSeam: SEAM,
      paintSeam: PAINT_SEAM,
      weldPaint: weld,
      seamWidth: canvas.geom.seamWidth,
      title: fileTitle(baked !== null),
      // What makes the file loadable: the plate stated as cells rather than
      // inferred from shapes. See `artfile.ts`.
      payload: payloadFromPaint(
        "hexagon",
        depth,
        convention,
        resolvePlate(sole.plate, book),
        baked === null ? undefined : { on: true, reading },
        // `undefined` — so the field is omitted and the bytes are unchanged —
        // whenever every painted address is at the exported depth, which is
        // every drawing that never left the depth it was started at.
        plateEntries(sole.plate, book),
        // Likewise omitted in hexagon view, which is the whole plate and needs
        // nothing said about it.
        canvas.view.mode === "sector" ? { sector: canvas.view.sector } : undefined
      ),
      overlay,
    });
  }, [
    comp,
    emitDoc,
    bakedFrame,
    canvas,
    book,
    showTiling,
    weld,
    depth,
    convention,
    reading,
    fileTitle,
  ]);

  /**
   * COPY AND EXPORT ARE ONE OPERATION. So are PASTE AND IMPORT.
   *
   * `emit.serialise` takes the scope as a PARAMETER, so "the whole document" and
   * "this row and everything under it" are the same call with a different
   * argument — and the clipboard and the file are the same call with a different
   * destination. There is exactly one producer below and exactly one consumer,
   * and the transports are four lines each at the bottom of this section. Two
   * serialisation paths would have been two chances for a pasted layer and a
   * saved layer to disagree about what a layer is; see the header of `emit.ts`,
   * which makes the argument this code is the other half of.
   */
  const svgOfScope = useCallback(
    (layer?: LayerId) =>
      serialiseEmit(emitDoc(), layer === undefined ? undefined : { layer }),
    [emitDoc]
  );

  /**
   * Text back into ONE layer, ready to be grafted.
   *
   * A document with several top-level layers becomes ONE node holding them all —
   * `layers.graft`, which is what makes "paste a composition onto a layer" mean
   * what the panel says it means: what lands is a single child whose own
   * children are that document's layers, intact to any depth. A document that
   * IS one layer arrives as that layer, so copying a row and pasting it onto
   * another gives a sub-layer and not a wrapper around one.
   *
   * A file with no layer tree — every drawing this program wrote before layers
   * existed — is read by `artfile` instead and arrives as a single layer, so
   * IMPORT accepts an old drawing rather than refusing it on a technicality.
   */
  const nodeFromSvg = useCallback(
    (
      text: string,
      label: string
      // The switches travel BESIDE the node, keyed by the ids `stackFromEmit`
      // minted, because a `Layer` does not carry them — see `layers.Switches`.
      // `pasteInto` takes this map and `reid` re-keys it onto the fresh ids, so
      // a hidden layer imported arrives hidden.
    ): { node: Layer; switches: ReadonlyMap<LayerId, Switches> } | null => {
      const doc = parseEmit(text);
      if (doc !== null && doc.layers.length > 0) {
        // The FILE'S own book: a layer names cells by index, and an index means
        // nothing without the depth that issued it.
        const fileBook = addressBook(
          buildHexagon(doc.payload.depth, doc.payload.convention)
        );
        const built = stackFromEmit(doc.layers, fileBook, 1);
        return {
          node:
            built.stack.length === 1
              ? built.stack[0]
              : graft(built.stack, label, built.nextId).layer,
          switches: built.switches,
        };
      }
      const legacy = extractArt(text);
      if (legacy === null) return null;
      const plate =
        legacy.canvas === "triangle"
          ? plateIntoSector(
              plateFromArtPayload(
                legacy,
                addressBook(buildFigure(legacy.depth, legacy.convention))
              ),
              0
            )
          : plateFromArtPayload(
              legacy,
              addressBook(buildHexagon(legacy.depth, legacy.convention))
            );
      // A drawing made before layers existed hid and locked nothing.
      return {
        node: { id: layerId(0), name: label, plate, children: [] },
        switches: new Map(),
      };
    },
    []
  );

  /**
   * Graft one or more documents onto a row, as one session.
   *
   * Threaded through a local rather than through `setSession` per file, so
   * importing four SVGs is four rungs of one journal rather than four renders
   * that each read a stale composition. `pasteInto` mints fresh ids for every
   * pasted subtree from the document's own counter, so the same clipboard
   * pasted twice gives two independent trees and no id can appear twice.
   */
  const graftTexts = useCallback(
    (texts: readonly { text: string; label: string }[], into: LayerId | null) => {
      let out: Session = {
        ...session,
        composition: selectLayer(session.composition, into),
      };
      let taken = 0;
      let refused: string | null = null;
      for (const { text, label } of texts) {
        const arriving = nodeFromSvg(text, label);
        if (arriving === null) {
          refused = refused ?? `${label} is not a drawing this program can read`;
          continue;
        }
        // Re-seated on the ORIGINAL target before each graft. `pasteInto`
        // selects what it just pasted, which is right for one paste and wrong
        // for four: importing four files put the second inside the first,
        // the third inside the second and so on, building a chain nobody
        // asked for. Four files onto one row means four siblings.
        const step = pasteInto(
          { ...out, composition: selectLayer(out.composition, into) },
          arriving.node,
          arriving.switches
        );
        if (!step.ok) {
          refused = refused ?? step.said;
          continue;
        }
        out = step.value;
        taken += 1;
      }
      if (taken === 0) {
        setAnnounce(refused ?? "nothing was pasted");
        return;
      }
      compRef.current = out.composition;
      setSession(out);
      const host = into === null ? null : findLayer(session.composition, into);
      setAnnounce(
        `pasted ${taken} layer${taken === 1 ? "" : "s"} ${
          host === null ? "on top of the drawing" : `into ${host.name}`
        }${refused === null ? "" : ` — ${refused}`}`
      );
    },
    [session, nodeFromSvg]
  );

  /**
   * The clipboard, written in BOTH flavours where the browser allows it.
   *
   * `image/svg+xml` so another drawing program takes the picture, `text/plain`
   * so a text editor takes the markup — one blob, two labels, and the panel's
   * paste reads either. Chromium refuses a `ClipboardItem` carrying a type
   * outside its own short list, and SVG is outside it, so a refusal falls back
   * to plain text rather than failing: the round trip inside this program still
   * works, because the markup IS the document.
   *
   * A REFUSED CLIPBOARD SAYS SO. The permission can be denied outright, and a
   * paste that quietly did nothing would be indistinguishable from a paste of an
   * empty clipboard — so the sentence names the refusal and points at the two
   * controls that need no permission at all.
   */
  const toClipboard = useCallback(async (text: string, said: string) => {
    const blob = () => new Blob([text], { type: "image/svg+xml" });
    try {
      if (typeof ClipboardItem === "function" && navigator.clipboard?.write) {
        try {
          await navigator.clipboard.write([
            new ClipboardItem({
              "image/svg+xml": blob(),
              "text/plain": new Blob([text], { type: "text/plain" }),
            }),
          ]);
          setAnnounce(`${said} — as SVG and as text`);
          return;
        } catch {
          // Falls through to plain text: see above.
        }
      }
      await navigator.clipboard.writeText(text);
      setAnnounce(`${said} — as text; this browser would not take the SVG flavour`);
    } catch {
      setAnnounce(
        "the browser refused the clipboard — allow clipboard access for this page, or use EXPORT, which needs no permission"
      );
    }
  }, []);

  /**
   * The clipboard, read TEXT FIRST — which is the opposite of the obvious order
   * and the whole reason paste works.
   *
   * MEASURED, because it is not guessable: Chromium SANITISES the
   * `image/svg+xml` flavour on the way out of the clipboard. It reparses the
   * markup, re-serialises it, and STRIPS EVERY COMMENT — which is where the
   * `fourfold:art:1` payload lives, and the payload is the authority for which
   * cells and which layers. Copying a one-layer document and reading the two
   * flavours back gives 63 531 bytes with the payload as `text/plain` and
   * 63 327 bytes WITHOUT it as `image/svg+xml`. Preferring the richer type — the
   * obvious thing, and what this did first — silently produced a paste that
   * refused every document this program had just written.
   *
   * So the SVG flavour is still WRITTEN, because that is what makes the copy
   * useful in another drawing program, and it is read only if there is no plain
   * text at all.
   */
  const fromClipboard = useCallback(async (): Promise<string | null> => {
    try {
      if (navigator.clipboard?.read) {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          for (const type of ["text/plain", "image/svg+xml"]) {
            if (!item.types.includes(type)) continue;
            return await (await item.getType(type)).text();
          }
        }
      }
      return await navigator.clipboard.readText();
    } catch {
      setAnnounce(
        "the browser refused the clipboard — allow clipboard access for this page, or use IMPORT, which needs no permission"
      );
      return null;
    }
  }, []);

  const copyScope = useCallback(
    (layer?: LayerId) => {
      const name =
        layer === undefined ? null : (findLayer(comp, layer)?.name ?? null);
      void toClipboard(
        svgOfScope(layer),
        layer === undefined
          ? `copied the whole composition — ${docCensus.total} layer${
              docCensus.total === 1 ? "" : "s"
            }`
          : `copied ${name ?? "the layer"}`
      );
    },
    [comp, svgOfScope, toClipboard, docCensus]
  );

  const pasteScope = useCallback(
    (into: LayerId | null) => {
      void (async () => {
        const text = await fromClipboard();
        if (text === null) return;
        graftTexts([{ text, label: "Pasted" }], into);
      })();
    },
    [fromClipboard, graftTexts]
  );

  /**
   * The file's name. A framed sector still says `triangle`, because that is what
   * it is and what every file this program has ever written called it.
   */
  const nameFor = useCallback(
    (ext: "svg" | "png" | "gif", suffix = "") =>
      exportName({
        kind: (canvas.view.mode === "sector" ? "triangle" : "hexagon") + suffix,
        depth,
        mode,
        scheme: schemeName,
        at: new Date(),
        ext,
      }),
    [canvas, depth, mode, schemeName]
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

  /** EXPORT is COPY with a file for a destination. Same text, same call. */
  const exportComposition = useCallback(() => {
    const name = nameFor("svg", "-layers");
    download(
      new Blob([svgOfScope()], { type: "image/svg+xml;charset=utf-8" }),
      name
    );
    setAnnounce(
      `exported ${name} — ${docCensus.total} layer${
        docCensus.total === 1 ? "" : "s"
      }, ${docCensus.addresses} address${
        docCensus.addresses === 1 ? "" : "es"
      }; import it back or drop it on the canvas`
    );
  }, [nameFor, svgOfScope, docCensus]);

  /** IMPORT is PASTE with files for a source. Several at once, one journal. */
  const importFiles = useCallback(
    (picked: FileList) => {
      void (async () => {
        const list = Array.from(picked).slice(0, MAX_IMPORT);
        const read: { text: string; label: string }[] = [];
        for (const file of list) {
          if (file.size > MAX_ART_BYTES) continue;
          try {
            read.push({
              text: await file.text(),
              label: file.name.replace(/\.svg$/i, ""),
            });
          } catch {
            // A file the browser will not hand over is reported by the count
            // below rather than by a sentence of its own: the person picked
            // several and wants to know how many landed.
          }
        }
        if (read.length === 0) {
          setAnnounce("nothing to import — those files could not be read");
          return;
        }
        graftTexts(read, comp.selected);
      })();
    },
    [graftTexts, comp.selected]
  );

  const exportSvg = () => {
    const name = nameFor("svg");
    download(new Blob([svgText()], { type: "image/svg+xml;charset=utf-8" }), name);
    setAnnounce(`exported ${name}`);
  };

  /**
   * The replay, as a standalone looping SVG.
   *
   * A SEPARATE output. The still above is untouched by everything here — same
   * function, same spec, same bytes — because an animation that quietly changed
   * what SVG meant would have cost the one export people already rely on.
   *
   * `grouping` decides whether the per-step markup is written per ORBIT or per
   * CELL. Both files work; the second exists so the saving the grouped form buys
   * can be measured on the real drawing rather than argued about. See
   * `replay.ts`, and `test/replay.test.ts`, which measures it.
   */
  /**
   * The replay AS DATA — the frames, the polygons and the wash — computed once.
   *
   * Lifted out so the animated SVG and the animated GIF are written from ONE
   * walk of the journal rather than two. Two callers each doing their own walk
   * would be two chances to disagree about which gesture landed where, and the
   * disagreement would be invisible until somebody put the two files side by
   * side. Nothing here is new: it is the first half of `animationText`, moved.
   */
  const animationModel = useCallback(() => {
    if (past.length === 0) return null;
    const { baked, cells, overlay } = bakedFrame();
    const shown = canvas.view.mode === "sector" ? canvas.shown : undefined;
    // One forward walk of the whole JOURNAL, composited onto this depth. The
    // preview steps one act at a time; a file needs all of them at once. An
    // act that only moved a layer changed no cell, and `animationSteps`
    // already drops a step that changed nothing in frame, so a reorder costs
    // the animation neither a rule nor a beat.
    const states = everyComposition(comp, past).map((c) =>
      flattenComposition(c, book)
    );
    const frames: AnimationStep[] = animationSteps(
      states,
      actStrokes(past),
      book,
      // An erase is drawn in the fill an unpainted cell wears, so a step can
      // TAKE colour away without any element ever having to be removed.
      showTiling ? TILE : PLATE_BG,
      shown
    );
    if (frames.length === 0) return null;
    /**
     * THE CUT, APPLIED ONCE, HERE.
     *
     * `boundAnimation` is the one place the marks are read — its header says so
     * and gives the reason: two encoders reading two marks would be two chances
     * to be off by one, and two encoders reading one value is none. So the SVG
     * and the GIF are each handed a `ground` and a `steps` that have already
     * been cut, and neither of them learns what an in point is.
     *
     * `states[0]` is the plate the journal began from, which is what `ground`
     * has always been; the fold of everything before the in point INTO it is
     * `boundAnimation`'s own work. The marks are clamped there too, so a span
     * left over from a longer drawing or a wider frame lands inside this one
     * rather than being refused — the UI-facing rule, see `clampSpan`.
     */
    const cut = boundAnimation(states[0], frames, playSpan);
    return {
      baked,
      cells,
      overlay,
      shown,
      states,
      /** Every beat the drawing has. What the census and the timing count. */
      frames,
      cut,
    };
  }, [comp, past, bakedFrame, canvas, book, showTiling, playSpan]);

  const animationText = useCallback(
    (grouping: "orbit" | "cell") => {
      const model = animationModel();
      if (model === null) return null;
      const { baked, cells, overlay, shown, states, cut } = model;
      // THE CENSUS COUNTS WHAT THE FILE HOLDS, so it counts the CUT steps and
      // not the drawing's. It is what the announcement reports as "23 gestures,
      // one CSS rule per gesture", and a rule is written per step that plays.
      return {
        census: animationCensus(cut.steps),
        text: animatedSvg({
          width: canvas.geom.width,
          height: canvas.geom.height,
          cells,
          shown,
          background: PLATE_BG,
          unpainted: showTiling ? TILE : null,
          tileSeam: SEAM,
          paintSeam: PAINT_SEAM,
          weldPaint: weld,
          seamWidth: canvas.geom.seamWidth,
          overlay,
          title: `FOURFOLD replay — ${
            canvas.view.mode === "sector"
              ? `sector ${canvas.view.sector}`
              : "hexagon"
          }, depth ${depth}, ${cut.steps.length} gesture${
            cut.steps.length === 1 ? "" : "s"
          } at ${stepMs} ms${
            // The title says the drawing was CUT rather than leaving a reader to
            // wonder why a 60-gesture plate exported an 8-gesture loop.
            cut.folded === 0 && cut.dropped === 0
              ? ""
              : ` — in ${cut.span?.in ?? 0}, out ${cut.span?.out ?? 0}`
          }`,
          // The same payload the still carries, so a replay is also a drawing:
          // dropping one back on the plate restores the finished plate exactly.
          payload: payloadFromPaint(
            "hexagon",
            depth,
            convention,
            states[states.length - 1],
            baked === null ? undefined : { on: true, reading },
            legacyAddresses,
            canvas.view.mode === "sector"
              ? { sector: canvas.view.sector }
              : undefined
          ),
          // THE CUT PAIR, SPREAD TOGETHER. `boundAnimation` returns a `ground`
          // with the prefix already folded in and a `steps` already truncated,
          // and they only mean what they say as a pair — a folded ground with
          // the uncut steps would draw the front of the drawing twice.
          ground: cut.ground,
          steps: cut.steps,
          stepMs,
          // Derived from THIS replay's step length and gesture count — see
          // `replay.animationTiming`, which says in as many words that the count
          // is the BOUNDED one: a hundred-gesture drawing cut to five plays a
          // five-step cycle, and a hold scaled to the hundred would be four
          // fifths of a loop spent on a still frame.
          ...animationTiming(stepMs, cut.steps.length),
          grouping,
        }),
      };
    },
    [
      animationModel,
      legacyAddresses,
      canvas,
      showTiling,
      weld,
      depth,
      convention,
      reading,
      stepMs,
    ]
  );

  const exportAnimation = () => {
    const built = animationText("orbit");
    if (built === null) {
      setAnnounce("nothing to animate — no committed gesture changed a cell in this frame");
      return;
    }
    const name = nameFor("svg", "-replay");
    const bytes = new Blob([built.text], {
      type: "image/svg+xml;charset=utf-8",
    });
    download(bytes, name);
    const { steps: n, groups, cells, orbitGroups } = built.census;
    setAnnounce(
      `exported ${name} — ${n} gesture${n === 1 ? "" : "s"}, ${groups} symmetry group${
        groups === 1 ? "" : "s"
      } (${orbitGroups} recorded orbits) over ${cells} cell${
        cells === 1 ? "" : "s"
      }, one CSS rule per gesture; ${Math.round(bytes.size / 1024)} kB`
    );
  };

  /**
   * The same replay, as a GIF.
   *
   * Written from `animationModel` — the SAME frames the SVG is written from —
   * so the two files are two encodings of one thing rather than two readings of
   * the drawing. What differs is what the format can hold: no fade, because a
   * fade in a GIF is frames and every intermediate opacity is a new colour, and
   * no antialiasing, because the palette is exact and coverage would spend it
   * on edge ramps. See `lib/gif.ts`.
   *
   * Driven a slice at a time off a `MessageChannel` rather than run straight
   * through. A depth-5 plate at 1024 px is nearly two seconds of arithmetic and
   * a frozen page for two seconds is a page that looks broken; a `setTimeout`
   * would be throttled to once a second the moment the tab went to the
   * background, and a worker would need `worker-src blob:`, which this app does
   * not grant. A message port is neither throttled nor a new origin.
   */
  const exportGif = useCallback(() => {
    if (gifBusy) return;
    const model = animationModel();
    if (model === null) {
      setAnnounce("nothing to animate — no committed gesture changed a cell in this frame");
      return;
    }
    const { cells, overlay, shown, cut } = model;
    const run = gifSteps({
      viewWidth: canvas.geom.width,
      viewHeight: canvas.geom.height,
      width: gifWidth,
      cells,
      shown,
      background: PLATE_BG,
      unpainted: showTiling ? TILE : null,
      tileSeam: SEAM,
      paintSeam: PAINT_SEAM,
      weldPaint: weld,
      seamWidth: canvas.geom.seamWidth,
      overlay,
      // THE SAME CUT PAIR the SVG is handed, from the same `boundAnimation`
      // call — which is the whole reason that call lives in `animationModel`
      // and not in either encoder. See its header.
      ground: cut.ground,
      steps: cut.steps,
      stepMs,
      // The SAME hold the SVG gets, so the two encodings of one replay loop at
      // the same rate. A GIF carries no fade — see the note above.
      holdMs: animationTiming(stepMs, cut.steps.length).holdMs,
    });
    setGifBusy(true);
    setGifAt(0);
    setAnnounce(
      `writing a GIF — ${cut.steps.length} frame${
        cut.steps.length === 1 ? "" : "s"
      } at ${gifWidth} px`
    );

    const channel = new MessageChannel();
    // A slice is bounded by TIME rather than by a step count, because one
    // gesture at depth 2 and one at depth 5 are three orders of magnitude
    // apart. Twelve milliseconds leaves a sixty-hertz frame its budget.
    const SLICE_MS = 12;
    channel.port1.onmessage = () => {
      const until = performance.now() + SLICE_MS;
      for (;;) {
        const next = run.next();
        if (next.done === true) {
          channel.port1.close();
          channel.port2.close();
          const r = next.value;
          setGifBusy(false);
          setGifAt(1);
          const name = nameFor("gif", "-replay");
          download(new Blob([r.bytes], { type: "image/gif" }), name);
          setAnnounce(
            `exported ${name} — ${r.frames} frame${r.frames === 1 ? "" : "s"}, ` +
              `${r.width}×${r.height}, ${(r.cycleMs / 1000).toFixed(1)} s a loop, ` +
              (r.exact
                ? `${r.palette} colour${r.palette === 1 ? "" : "s"}, exact — no quantisation; `
                : `${r.distinct} colours reduced to ${r.palette}, the most a GIF can hold; `) +
              `${Math.round(r.bytes.length / 1024)} kB`
          );
          return;
        }
        if (performance.now() >= until) {
          setGifAt(next.value.done / next.value.total);
          channel.port2.postMessage(0);
          return;
        }
      }
    };
    channel.port2.postMessage(0);
  }, [
    gifBusy,
    gifWidth,
    animationModel,
    canvas,
    showTiling,
    weld,
    stepMs,
    nameFor,
  ]);

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
        setDepth(payload.depth);
        setConvention(payload.convention);
        // The relief is display state and not paint, but a file that declares
        // it has to be able to come back looking like itself — and re-export to
        // the same bytes. A file that says nothing means the relief is off,
        // which is what every file written before the field existed meant.
        setReliefOn(payload.relief?.on ?? false);
        if (payload.relief !== undefined) setReading(payload.relief.reading);

        // The file's OWN canvas, not the one on screen: the addresses in the
        // payload are words of the depth it declares, and the book that turns
        // its `cells` indices into addresses has to be that canvas's book.
        //
        // ── A `triangle` file is not a foreign file. It is sector 0. ────────
        //
        // Every drawing exported before the hexagon became the model says
        // `canvas: "triangle"` and carries a plate keyed by bare words. Those
        // words are this model's words with a sector tag missing: `buildHexagon`
        // builds sector 0 by applying the identity rotation to the base figure,
        // so the triangle's cell i IS the hexagon's cell i and the triangle's
        // `"ABX"` IS `"s0:ABX"`. The migration is therefore a rename — no cell
        // is matched by geometry, nothing is resolved to a depth, and a plate
        // painted across four depths arrives with all four. The view is then set
        // to that sector, so a person who saved a triangle opens a triangle.
        const old = payload.canvas === "triangle";
        const fileBook = old
          ? null
          : addressBook(buildHexagon(payload.depth, payload.convention));
        const loaded = old
          ? plateIntoSector(
              plateFromArtPayload(
                payload,
                addressBook(buildFigure(payload.depth, payload.convention))
              ),
              0
            )
          : plateFromArtPayload(payload, fileBook as AddressBook);

        // THE LAYERS, when the file states any.
        //
        // Read back through the same `emit.parse` the panel's IMPORT uses —
        // there is one reader, and a dropped file and a pasted clipboard take
        // the identical path through it. A file with no layer tree, which is
        // every file written before this one, becomes the single layer
        // `fromPlate` has always made of it, so nothing about loading an old
        // drawing changed.
        const parsed = payload.comp === undefined ? null : parseEmit(text);
        const stack =
          parsed === null || fileBook === null || parsed.layers.length === 0
            ? null
            : stackFromEmit(parsed.layers, fileBook, 1);
        const restored: Composition =
          stack === null
            ? fromPlate(loaded)
            : {
                layers: stack.stack,
                selected: stack.stack[stack.stack.length - 1]?.id ?? null,
                nextId: stack.nextId,
                // The file's `hidden`/`locked`, keyed by the ids just minted.
                // They come back beside the stack rather than inside it — a
                // `Layer` does not carry them; see `layers.Switches`.
                switches: stack.switches,
              };

        const framed = old ? 0 : payload.view?.sector;
        if (framed === undefined) {
          setViewMode("hexagon");
        } else {
          setViewMode("sector");
          setSector(framed);
          // Mode 12 is D₆'s and nothing else's; a framed sector's brush is the
          // sector's own D₃. Same rule as `pickView`.
          if (mode === 12) setMode(6);
        }

        reset(
          restored,
          `loaded ${loaded.size} address${loaded.size === 1 ? "" : "es"}${
            stack === null
              ? ""
              : ` across ${census(restored).total} layer${
                  census(restored).total === 1 ? "" : "s"
                }`
          } — ${
            old
              ? `a triangle file, migrated into sector 0 of the plate`
              : framed === undefined
              ? "the whole plate"
              : `sector ${framed} framed`
          }, depth ${payload.depth}, ${payload.convention}${
            payload.plate === undefined ? "" : ", addressed"
          } · history reset to the loaded drawing`
        );
        return;
      }

      if (!/<svg[\s>]/i.test(text)) {
        refuse("that file is not an SVG this program can read");
        return;
      }

      // Matched against the cells AS DRAWN, so a foreign file is compared with
      // the picture on screen rather than with the model's own pixels — which
      // the sector view moves.
      const got = importByGeometry(text, hex, canvas.geom.cells);
      if (got.matched.size === 0) {
        refuse(
          got.total === 0
            ? "no filled shapes in that file — nothing to import"
            : `none of the ${got.total} shapes in that file line up with this frame — try the depth and view it was drawn at`
        );
        return;
      }
      setLoadError(null);
      // Matched against the canvas AS IT STANDS, so the addresses are this
      // depth's addresses. A foreign file has no depths but this one.
      const imported = new Map<Address, string>();
      for (const [i, s] of got.matched) imported.set(book.addr[i], s.hex);
      reset(
        fromPlate(imported),
        `imported ${got.matched.size} of ${got.total} cells — this file was not made here${
          got.unmatched === 0 ? "" : `, ${got.unmatched} shapes matched no cell`
        }`
      );
    },
    [refuse, reset, canvas, hex, book, mode]
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
    if (previewing) {
      refuse("a preview is standing — close it before loading a drawing");
      return;
    }
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

  /** Cells in the FRAME, and cells on the plate. They differ in sector view. */
  const total = canvas.shown.length;
  const modelTotal = hex.cells.length;
  /**
   * What a standing proposal comes to, in cells.
   *
   * The UNION over the applications, not the sum of them: two seeds of one orbit
   * share every cell, and a proposal that reported 12 where the plate would
   * change 6 would be counting the gesture rather than the drawing. `commits` is
   * the cells that would actually take colour — which for the adjustment brush
   * already excludes the inert ones, exactly as the one-cell candidate's count
   * did — and `reach` adds back what the brush merely touches.
   */
  const proposalCommits = useMemo(
    () => unionCells(proposalSpecs.map((s) => s.cells)).length,
    [proposalSpecs]
  );
  const proposalReach = useMemo(
    () => unionCells(proposalSpecs.flatMap((s) => [s.cells, s.inert])).length,
    [proposalSpecs]
  );
  const standing = proposalSpecs.length > 0;
  const reach = standing
    ? proposalReach
    : preview === null
    ? null
    : preview.cells.length + preview.inert.length;
  /**
   * What the live region says.
   *
   * A standing proposal speaks for itself, DERIVED rather than pushed into
   * `announce` from an effect — the proposal changes when the brush changes as
   * much as when the finger moves, and a derived string cannot fall out of step
   * with the ghost the way a stored one can. `announce` carries everything else:
   * strokes, undo, exports, tool changes, and the commit that clears the
   * proposal.
   *
   * It names the count of APPLICATIONS as well as of cells, because those are
   * now two different numbers and the first one is the one that decides how many
   * steps of the progression the commit will spend. It also says "one gesture",
   * which is the promise the commit has to keep: one rung, one undo.
   *
   * ── A REFUSED COMMIT HAS TO GET PAST THE STANDING SENTENCE ─────────────
   *
   * The standing branch MASKS `announce`, which is right while nothing has gone
   * wrong and wrong the moment something has: a commit that was refused says why
   * — "L2 is locked", in the layer model's own words — and now that a refused
   * commit keeps its proposal, that sentence would be spoken to nobody. So a
   * refusal that is still about THIS proposal leads, and the standing sentence
   * follows it unchanged rather than being replaced, because what stands and how
   * to act on it did not stop being true.
   *
   * THE REASON IS READ OFF `blocked` AND NOT OFF `announce`. Splicing the live
   * `announce` into this template was the first attempt and it rented a channel
   * that moves: `doUndo` does not clear the proposal, so ⌘Z after a refusal
   * spliced "undid painted 12 cells" into "…nothing was laid and there is
   * nothing to undo", a contradiction inside one aria-live sentence. `blocked`
   * freezes the words with the proposal they are about, and both fall away
   * together the moment that proposal changes.
   */
  const standingSaid = !standing
    ? ""
    : `${proposalSpecs.length} application${
        proposalSpecs.length === 1 ? "" : "s"
      } proposed, last at cell ${
        proposalSpecs[proposalSpecs.length - 1].seed
      } — ${proposalReach} cell${
        proposalReach === 1 ? "" : "s"
      } under the ${tool} brush; tap the ghost or press Enter to commit them as one gesture, Escape to drop`;
  const said =
    dragSpec !== null
      ? `${dragSpec.said} — release to lay it, Escape to cancel`
      : !standing
      ? announce
      : blocked?.proposal === proposal
      ? `${blocked.why} — nothing was laid and there is nothing to undo; the proposal still stands. ${standingSaid}`
      : standingSaid;

  const schemeGradient = `linear-gradient(90deg, ${tape
    .map((s, k) => `${s.hex} ${(100 * k) / Math.max(tape.length - 1, 1)}%`)
    .join(", ")})`;

  /**
   * Measured, not assumed: hexagon bands are not uniform, and a band CLIPPED to
   * a sector is a different set from the band it was clipped out of.
   *
   * In hexagon view `inView` admits everything and this is exactly `bandSizes`.
   * In sector view it reports what the brush will actually lay, which is the
   * triangle's own 1, 3, 5, … 2r+1 — the claim `bands.ts` checks at build time
   * for the standalone triangle, holding here for a clipped sector.
   */
  const bandStat = useMemo(() => {
    if (effBand === null) return null;
    const sizes = canvas.bands
      .bands(effBand)
      .map((ix) => canvas.bands.band(ix).filter(canvas.inView).length)
      .filter((n) => n > 0);
    if (sizes.length === 0) return null;
    return {
      count: sizes.length,
      min: Math.min(...sizes),
      max: Math.max(...sizes),
    };
  }, [canvas, effBand]);

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
          {/* ONE model, framed two ways. The control is a picture of the
              figure rather than a pair of words, because the thing that has to
              be legible at a glance is that the other five sectors are still
              there — this used to be a toggle between two canvases and it threw
              the drawing away. See the header, and `view.ts`. */}
          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>View</h2>
              <span className={styles.sectionMeta}>{modelTotal} cells</span>
            </div>
            <div className={styles.seg} role="group" aria-label="what is framed">
              {(["hexagon", "sector"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  className={styles.segBtn}
                  aria-pressed={viewMode === v}
                  aria-label={
                    v === "hexagon"
                      ? "frame the whole plate — all six sectors; nothing is cleared"
                      : `frame one sector — the triangle, ${4 ** depth} cells; nothing is cleared`
                  }
                  onClick={() => pickView(v)}
                >
                  <span className={styles.viewFace}>
                    <SectorGlyph
                      sector={v === "hexagon" ? null : sector}
                      active={viewMode === v}
                    />
                    {v}
                  </span>
                </button>
              ))}
            </div>
            {viewMode === "sector" && (
              <SectorDial
                sector={sector}
                onPick={pickSector}
                perSector={4 ** depth}
              />
            )}
            <p className={styles.viewMeta}>
              <span>
                {viewMode === "sector" ? `sector ${sector}` : "all six"}
              </span>
              <span>
                <b>{total}</b> drawn of {modelTotal}
              </span>
            </p>
            <div
              className={`${styles.seg} ${styles.depthRow}`}
              role="group"
              aria-label="subdivision depth"
            >
              {DEPTHS.map((d) => (
                <button
                  key={d}
                  type="button"
                  className={`${styles.segBtn} ${styles.depthBtn}`}
                  aria-pressed={depth === d}
                  aria-label={`depth ${d} — ${cellCount("hexagon", d)} cells on the plate, ${
                    4 ** d
                  } in a sector`}
                  onClick={() => pickDepth(d)}
                >
                  {d}
                </button>
              ))}
            </div>
            <p className={styles.hint}>
              {viewMode === "sector" ? (
                <>
                  <b>Sector {sector} is the triangle.</b> Not a likeness of it —
                  the plate is built by rotating the depth-{depth} figure into
                  six sectors, so this is that figure, cell for cell, turned
                  apex-up for reading. Switching frame <i>destroys nothing</i>:
                  one address space, <code>s0:</code>…<code>s5:</code>, all the
                  way through.
                </>
              ) : (
                <>
                  <b>All six sectors.</b> Six copies of the depth-{depth} figure
                  sharing an apex at the centre, tiling the hexagon with no
                  overlap and no gap. Frame one and you are looking at the
                  triangle; the paint in the other five stays exactly where it is.
                </>
              )}
            </p>
          </section>

          {/* WHICH SHEET the brush lands on — so it belongs in the STRUCTURE
              column, under the two controls that say what the brush IS and what
              is framed. The address tree says WHERE paint sits; the layer tree
              says WHICH SHEET it sits on, and they are orthogonal. */}
          <LayersPanel
            session={session}
            book={book}
            frozen={previewing}
            /* The playhead rides IN this panel, on the owner's own reading of
               the Flash arrangement: a time ruler over the track stack, with the
               vertical list underneath it exactly as it was. `LayersPanel`'s
               header argues the placement and says what a filmstrip would add
               later; nothing here draws one. */
            timeline={{
              steps: playFresh ? playSteps : null,
              at: playAt,
              span: playSpan,
              acts: steps,
              onOpen: standPlayhead,
              onSeek: seekPlayhead,
              onMarkIn: () => setMark("in"),
              onMarkOut: () => setMark("out"),
              onClearMarks: clearMarks,
            }}
            onSelect={pickLayer}
            onToggleVisible={flipVisible}
            onToggleLocked={flipLocked}
            onRename={(id, name) => run(renameLayer(session, id, name))}
            onAdd={() => runSession(addLayer(session), "added a layer")}
            onDelete={() => run(removeLayer(session))}
            onClear={() => run(clearLayer(session))}
            onArrange={(dir) => run(arrangeLayer(session, dir))}
            onPromote={() => run(promote(session))}
            onDemote={() => run(demote(session))}
            onCopy={copyScope}
            onPaste={pasteScope}
            onExport={exportComposition}
            onImport={importFiles}
          />
          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>Brush symmetry</h2>
              {/* The group the brush IS under, which is `effScope` and the
                  focused arm — not the scope BUTTON. Drilling into a sector
                  changes the group without the button moving, and a readout
                  that named the button would say D₆ over a plate whose brush is
                  one sector's D₃. Also shorter than what stood here, because
                  the sector view no longer needs a branch of its own: it forces
                  `effScope` to `sector`, so it falls out of the same three
                  cases. */}
              <span className={styles.sectionMeta}>
                {isolation !== null
                  ? `arm ${isolation} · ⟨m_${isolation}⟩`
                  : effScope === "hexagon"
                  ? "D₆ subgroups"
                  : effScope === "sector"
                  ? `sector ${focusedSector(focus) ?? sector} · D₃`
                  : "C₆ × D₃"}
              </span>
            </div>
            {/* One level further in than the SCOPE segment, and in the same
                slot, because it is the same question — which part of the plate
                may the brush reach — asked of the part that is already framed.
                The nesting is hexagon, then sector, then arm. */}
            {viewMode === "sector" && (
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
                    aria-label="isolation off — paint the whole framed sector"
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
                      aria-label={`isolate arm ${a} — the ftype-${a} arm, one third of the framed sector`}
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
                      sector minus its hub, and the rotation permutes them
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
            {viewMode === "hexagon" && (
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
                {/* The hint describes `effScope` for the same reason the meta
                    does. The one case worth saying out loud is the new one: the
                    button says hexagon and the FOCUS has made the brush local,
                    which is a state the button cannot show. */}
                {scope === "hexagon" && effScope === "sector" && (
                  <p className={styles.hint}>
                    <b>Drilled into sector {focusedSector(focus)}.</b> The scope
                    button still says <i>hexagon</i>, and it will be D₆ again the
                    moment you step back out — but inside a sector the brush is
                    that sector&rsquo;s own D₃. Press <b>O</b> or Escape to leave.
                  </p>
                )}
                <p className={styles.hint}>
                  {effScope === "hexagon" ? (
                    <>
                      <b>D₆ — the whole plate.</b> Its three spine mirrors each
                      reflect <i>two opposite sectors at once</i>.
                    </>
                  ) : effScope === "sector" ? (
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
                  aria-label={`band family ${f} — ${BAND_NOTE[bandKind][f]}`}
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
                  <b>{BAND_NOTE[bandKind][band]}.</b> The {mode}-fold brush carries it
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

            {/* Offered in BOTH views now, which it could not be while the
                triangle was a canvas of its own: the six-point construction
                reads six corresponding cells off a C6 orbit that a standalone
                triangle does not have, and its band-size height field is
                measurably flat — two values at every depth. A framed sector has
                the whole model behind it, so it carries the hexagon's height
                field and 2^(d+1) − 1 rings run through it. Measured in
                `test/view.test.ts`. */}
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
                  follows, six-fold symmetric in every frame because the remap is
                  a function of the ring alone. Height is the{" "}
                  <b>sum of a cell&rsquo;s three band sizes</b> — three integers,
                  one addition, <i>no division</i>. The one divide in the whole
                  effect is one per ring, at pixel emission.
                  {viewMode === "sector" && (
                    <>
                      {" "}
                      The template ring is the <i>plate&rsquo;s</i>, so in a
                      framed sector it curves about the apex —{" "}
                      <b>{2 ** (depth + 1) - 1} rings</b> cross this sector, where
                      a standalone triangle had a height field with two values in
                      it.
                    </>
                  )}
                </p>
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
              <span className={styles.sectionMeta}>{modelTotal} cells</span>
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
                6·3<sup>{depth}</sup>
              </code>{" "}
              addresses with <i>no X</i> in the colour you are holding, and leaves
              the other {modelTotal - 6 * 3 ** depth} bare. A preset fills{" "}
              <i>every</i> sector, so a framed one then shows exactly{" "}
              <code>
                3<sup>{depth}</sup>
              </code>{" "}
              — the canonical figure, per sector.
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
              {/* THE STATUS LINE IS NOT HERE ANY MORE.
                  It was the top row of this rule, above the icons, and a second
                  review moved it below the canvas to sit beside the symmetry
                  legend — see `.baseline`. Two bands of small caps saying what
                  is true of the drawing, one above the artwork and one below it,
                  were one band's worth of fact split by the artwork itself; the
                  rule keeps the CONTROLS and the strip under the plate keeps the
                  READINGS. What that buys is measured: the plate rule lost a
                  22px row and a 10px gap, which is most of what the deck's
                  bigger icons cost, so the canvas came out ahead.

                  The tool chip went with it — and then went entirely. It was
                  `PAINT` in a bordered box, restating the pressed button three
                  centimetres to its right for the harmless default; for the two
                  tools where the state actually matters the page already floats
                  a loud chip in that tool's hue ON THE ARTWORK, which is where a
                  warning about a destructive brush belongs. */}

              {/* The control deck: TWO ROWS, and every row is read the same way
                  — what the hand is holding on the left, what has been done to
                  the drawing on the right.

                  It was one flat strip of eleven words, and the words were the
                  problem: `tool` and `shape` are the same question asked twice
                  and they were sitting a hundred pixels apart, while `svg` and
                  `png` were two buttons for one idea. Two rows of icons say the
                  same thing in a third of the width, which is what buys the
                  right-hand end enough room to keep MEMORY, FILE and the two
                  meta controls apart from each other instead of packed into one
                  run where `new` ends up beside `load`.

                  The keys — tool, shape, drag — stay, and they are the reason
                  the icons are allowed to be icons: no group in this deck is
                  ever unlabelled, so a glyph never has to carry a name on its
                  own. */}
              <div className={styles.deck}>
                {/* DRAG, on the far left and stacked, because it is the one
                    control here that qualifies the OTHER two rather than
                    standing beside them: it says what a press-and-drag does
                    with whichever tool and whichever shape is in the hand. Two
                    rows of one, so the deck opens on a column and the eye has
                    something to start from. */}
                <div className={styles.deckDrag}>
                  <span className={styles.benchKey} id="drag-key">
                    drag
                  </span>
                  <div
                    className={`${styles.seg} ${styles.stackSeg}`}
                    role="group"
                    aria-labelledby="drag-key"
                  >
                    {(["paint", "propose"] as DragMode[]).map((d) => (
                      <button
                        key={d}
                        type="button"
                        className={`${styles.segBtn} ${styles.iconSegBtn}`}
                        aria-pressed={dragMode === d}
                        title={
                          d === "paint"
                            ? "drag paints continuously"
                            : "drag gathers a proposal — tap it to commit the lot"
                        }
                        aria-label={
                          d === "paint"
                            ? "drag lays colour continuously"
                            : "drag gathers a proposal; tap it to commit every application as one gesture"
                        }
                        onClick={() => pickDragMode(d)}
                      >
                        <DragGlyph mode={d} />
                      </button>
                    ))}
                  </div>
                </div>

                {/* WHAT colour on top, WHICH cells underneath. Two questions,
                    two controls, and stacking them is what finally says they
                    are two: LINE composes with ERASE without either of them
                    knowing the other exists, and a reader who has them one
                    above the other can see that they multiply. */}
                <div className={styles.deckRows}>
                  <span className={styles.benchKey} id="tool-key">
                    tool
                  </span>
                  <div
                    className={`${styles.seg} ${styles.iconSeg} ${styles.toolSeg}`}
                    role="group"
                    aria-labelledby="tool-key"
                  >
                    {TOOLS.map((t) => (
                      <button
                        key={t}
                        type="button"
                        className={`${styles.segBtn} ${styles.iconSegBtn}`}
                        aria-pressed={tool === t}
                        title={`${t} — ${TOOL_LABEL[t]}`}
                        aria-label={`${t} tool — ${TOOL_LABEL[t]}`}
                        onClick={() => pickTool(t)}
                      >
                        <ToolGlyph tool={t} />
                      </button>
                    ))}
                  </div>

                  <span className={styles.benchKey} id="shape-key">
                    shape
                  </span>
                  <div
                    className={`${styles.seg} ${styles.iconSeg}`}
                    role="group"
                    aria-labelledby="shape-key"
                  >
                    {(["free", "line", "ring"] as ShapeTool[]).map((s) => (
                      <button
                        key={s}
                        type="button"
                        className={`${styles.segBtn} ${styles.iconSegBtn}`}
                        aria-pressed={shapeTool === s}
                        title={
                          s === "free"
                            ? "free — every cell the pointer crosses"
                            : s === "line"
                            ? "line — drag along a lattice row"
                            : "ring — drag outward; a level set of the hexagonal norm"
                        }
                        aria-label={
                          s === "free"
                            ? "free brush — every cell the pointer crosses"
                            : s === "line"
                            ? "line — press and drag along a lattice row; it snaps to one of the three band families"
                            : "ring — press and drag outward; the ring is a level set of the exact hexagonal norm"
                        }
                        onClick={() => pickShapeTool(s)}
                      >
                        <ShapeGlyph shape={s} />
                      </button>
                    ))}
                  </div>
                </div>

                {/* ZOOM HAS LEFT THE DECK for the canvas's own bottom-left
                    corner — see `.canvasZoom`, where the three buttons now are
                    and where the reasoning for the move lives. It is the same
                    journey UNDO and REDO made to the top-left in an earlier
                    round, for the same reason and against the same three
                    pointer hazards: a control you use WHILE looking at the
                    artwork does not belong at the far end of a deck above it.

                    Nothing else in this group moved and no key changed: `+`,
                    `−` and `0` are still bound in the window handler and still
                    listed under "view" in `lib/shortcuts.ts`. */}

                {/* MEMORY, now one column of two: the two controls that only
                    LOOK at the drawing.

                    It was two columns of four — what changes the drawing beside
                    what only watches it. UNDO and REDO have left the deck for
                    the canvas itself (see `.canvasHud`), because they are the
                    two buttons in this program that get pressed mid-gesture and
                    the deck is the far end of a pointer's journey from the
                    artwork. What is left is the pair that opens a preview, and
                    a preview is a thing you go and get rather than something you
                    reach for without looking. */}
                <div className={styles.deckMemory} role="group" aria-label="memory">
                  <button
                    type="button"
                    className={`${styles.iconBtn} ${
                      rewind?.kind === "replay" ? styles.rewindOn : ""
                    }`}
                    onClick={() =>
                      rewind?.kind === "replay"
                        ? closeRewind("replay closed — the drawing is exactly as it was")
                        : openRewind("replay")
                    }
                    disabled={steps === 0}
                    aria-pressed={rewind?.kind === "replay"}
                    title="replay the drawing being made (P) — nothing is changed"
                    aria-label={`replay the drawing, ${steps} gesture${
                      steps === 1 ? "" : "s"
                    } — a preview; nothing is changed`}
                  >
                    <ActionGlyph name="replay" />
                  </button>
                  <button
                    type="button"
                    className={`${styles.iconBtn} ${
                      rewind?.kind === "history" ? styles.rewindOn : ""
                    }`}
                    onClick={() =>
                      rewind?.kind === "history"
                        ? closeRewind("history closed — the drawing is exactly as it was")
                        : openRewind("history")
                    }
                    disabled={steps === 0}
                    aria-pressed={rewind?.kind === "history"}
                    title="history — scrub this drawing's earlier states (M)"
                    aria-label={`history — scrub the ${steps} earlier state${
                      steps === 1 ? "" : "s"
                    } of this drawing; a preview, nothing is changed`}
                  >
                    <ActionGlyph name="history" />
                  </button>
                </div>

                {/* FILE: the artwork out, and the artwork in. Two rows of one,
                    mirrored glyphs, one tray between them. */}
                <div className={styles.deckFile}>
                  <div className={styles.saveWrap} ref={saveWrap}>
                    <button
                      ref={saveBtn}
                      type="button"
                      className={`${styles.iconBtn} ${styles.saveBtn}`}
                      onClick={() => setSaveWanted((o) => !o)}
                      onKeyDown={onSaveKey}
                      disabled={saveOff}
                      aria-haspopup="menu"
                      aria-expanded={saveOpen}
                      aria-controls="save-menu"
                      title="save the artwork — SVG or PNG"
                      aria-label="save the artwork — choose SVG or PNG"
                    >
                      <ActionGlyph name="save" />
                      <MenuCaret />
                    </button>
                    {saveOpen && (
                      <div
                        id="save-menu"
                        ref={saveMenu}
                        role="menu"
                        aria-label="save format"
                        className={styles.menu}
                        onKeyDown={onMenuKey}
                      >
                        <button
                          type="button"
                          role="menuitem"
                          className={styles.menuItem}
                          onClick={() => {
                            closeSaveMenu();
                            exportSvg();
                          }}
                        >
                          <span className={styles.menuKey}>svg</span>
                          <span className={styles.menuWhat}>
                            vector — carries the plate back
                          </span>
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className={styles.menuItem}
                          onClick={() => {
                            closeSaveMenu();
                            exportPng();
                          }}
                        >
                          <span className={styles.menuKey}>png</span>
                          <span className={styles.menuWhat}>
                            raster — twice the plate&apos;s size
                          </span>
                        </button>
                      </div>
                    )}
                  </div>
                  {/* Never disabled except under a preview: loading is
                      otherwise the one action that is always available,
                      including on an empty plate, which is the state a person
                      who has just arrived with a file is in. */}
                  <button
                    type="button"
                    className={styles.iconBtn}
                    onClick={openPicker}
                    disabled={previewing}
                    title="load an SVG onto the plate — or drop one on the canvas"
                    aria-label="load an SVG drawing back onto the plate — or drop one on the canvas"
                  >
                    <ActionGlyph name="load" />
                  </button>
                </div>

                <input
                  ref={fileInput}
                  type="file"
                  accept=".svg,image/svg+xml"
                  className={styles.fileInput}
                  onChange={onPicked}
                  tabIndex={-1}
                  aria-hidden="true"
                />

                {/* The two that are not about this drawing at all: the one that
                    explains the program, and the one that ends the drawing.
                    Kept behind a rule and a wider gap, because a wipe adjacent
                    to an export is a wipe somebody will hit reaching for it. */}
                <div className={styles.deckMeta}>
                  <button
                    type="button"
                    className={styles.helpBtn}
                    onClick={() => (helpOpen ? closeHelp() : openHelp())}
                    aria-expanded={helpOpen}
                    title="keyboard shortcuts and what every glyph means (?)"
                    aria-label="keyboard shortcuts"
                  >
                    ?
                  </button>
                  {/* The one control that wipes, and the only one. Warm, apart
                      from the neutral chrome, and it asks twice — and it stays
                      a WORD while everything beside it became a glyph, because
                      the one button that cannot be misread is the one that
                      empties the plate. */}
                  <button
                    type="button"
                    className={`${styles.newBtn} ${
                      armed === "new" ? styles.armedBtn : ""
                    }`}
                    onClick={doNew}
                    disabled={previewing}
                    onBlur={() => {
                      if (armed === "new") disarm();
                    }}
                    title={
                      armed === "new"
                        ? "click again to wipe the plate"
                        : "new plate — wipes everything, and asks first"
                    }
                    aria-label={
                      armed === "new"
                        ? "confirm — wipe the plate and the whole undo history"
                        : "new plate — wipes everything, and asks first"
                    }
                  >
                    {armed === "new" ? "sure?" : "new"}
                    {armed === "new" && (
                      <span
                        className={styles.armFuse}
                        style={{ animationDuration: `${CONFIRM_MS}ms` }}
                        aria-hidden="true"
                      />
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* The adjustment palette keeps a strip of its own, because it is
                the one bench control that is a GRID and the one that is absent
                most of the time. Folding it into the header row would make the
                header jump by a row the moment the tool changed; here it opens
                below the rule it belongs under, and costs canvas height only
                while the adjust brush is actually in the hand.

                ON `pickedTool`, NOT `tool`, and this is the one place in the
                page where that distinction had to be made by hand. Everything
                else reads the tool IN FORCE, which is what the momentary
                eraser is for. This is layout: gated on `tool` it would unmount
                the moment Option went down and remount when it came up, so
                holding a key to erase would shunt the canvas up and down by a
                row under the pointer — the exact jump the paragraph above says
                this strip was moved out of the header to avoid. It is also the
                honest reading: the strip says WHICH adjustment is selected,
                the selection has not changed, and a momentary brush is not a
                reason to hide a control the user will have back in a second. */}
            {pickedTool === "adjust" && (
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

            {/* The preview bench.
                ONE scale, two instruments. REPLAY drives it with a transport
                and HISTORY with a hand, and they share the scrub because they
                are asking the same question of the same axis — which is also
                why they cannot fight: there is one `rewind` and one index.
                It rides on a strip of its own, like the adjustment grid, so it
                costs canvas height only while a preview is actually standing. */}
            {rewind !== null && (
              <div className={styles.rewindBar} data-kind={rewind.kind}>
                <div className={styles.rewindHead}>
                  <span className={styles.rewindTag}>{rewind.kind}</span>
                  <span className={styles.rewindCount}>
                    <b>{rewind.index}</b>
                    <span aria-hidden="true">/</span>
                    {steps}
                  </span>
                  <span className={styles.rewindSaid}>
                    {rewind.index === steps
                      ? "the live drawing"
                      : `${steps - rewind.index} gesture${
                          steps - rewind.index === 1 ? "" : "s"
                        } after this`}
                  </span>
                  <button
                    type="button"
                    className={styles.rewindClose}
                    onClick={() =>
                      closeRewind(
                        `${rewind.kind} closed — the drawing is exactly as it was`
                      )
                    }
                    aria-label="close the preview and return to the live drawing"
                  >
                    close
                  </button>
                </div>

                <div className={styles.rewindRow}>
                  {rewind.kind === "replay" && (
                    <span
                      className={styles.transport}
                      role="group"
                      aria-label="replay transport"
                    >
                      <button
                        type="button"
                        onClick={() => seekRewind(0)}
                        disabled={rewind.index === 0}
                        aria-label="back to the first state"
                      >
                        ⏮
                      </button>
                      <button
                        type="button"
                        onClick={() => seekRewind(rewind.index - 1)}
                        disabled={rewind.index === 0}
                        aria-label="one gesture back"
                      >
                        ‹
                      </button>
                      <button
                        type="button"
                        className={styles.playBtn}
                        onClick={togglePlay}
                        aria-pressed={rewind.playing}
                        aria-label={rewind.playing ? "pause the replay" : "play the replay"}
                      >
                        <TransportGlyph playing={rewind.playing} />
                        {rewind.playing ? "pause" : "play"}
                      </button>
                      <button
                        type="button"
                        onClick={() => seekRewind(rewind.index + 1)}
                        disabled={rewind.index === steps}
                        aria-label="one gesture on"
                      >
                        ›
                      </button>
                    </span>
                  )}

                  {/* The scale. A real range input, so the arrows, Home and End
                      work without a line of code, and the ticks are one per
                      gesture — an engraved scale rather than a progress bar. */}
                  <span
                    className={styles.scrubWrap}
                    style={
                      {
                        "--scrub-at": `${(100 * rewind.index) / Math.max(steps, 1)}%`,
                        "--scrub-tick": `${100 / Math.max(steps, 1)}%`,
                      } as React.CSSProperties
                    }
                  >
                    {steps <= TICK_LIMIT && (
                      <span className={styles.scrubTicks} aria-hidden="true" />
                    )}
                    <input
                      type="range"
                      className={styles.scrub}
                      min={0}
                      max={steps}
                      step={1}
                      value={rewind.index}
                      onChange={(e) => seekRewind(Number(e.target.value))}
                      aria-label={
                        rewind.kind === "replay"
                          ? "replay position, in committed gestures"
                          : "history position, in committed gestures"
                      }
                      aria-valuetext={
                        rewind.index === steps
                          ? `state ${steps} of ${steps} — the live drawing`
                          : `state ${rewind.index} of ${steps} — ${
                              steps - rewind.index
                            } gesture${
                              steps - rewind.index === 1 ? "" : "s"
                            } after this`
                      }
                    />
                  </span>

                  {rewind.kind === "replay" && (
                    <>
                      <label className={styles.rewindField}>
                        <span className={styles.benchKey}>step</span>
                        <select
                          className={styles.rewindSelect}
                          value={stepMs}
                          onChange={(e) => {
                            const ms = Number(e.target.value);
                            setStepMs(ms);
                            setAnnounce(
                              `replay at ${ms} ms a gesture — ${(
                                (steps * ms) /
                                1000
                              ).toFixed(1)} s for the whole drawing; the exported animation uses the same figure`
                            );
                          }}
                          aria-label="delay between replay steps"
                        >
                          {STEP_MS.map((ms) => (
                            <option key={ms} value={ms}>
                              {ms} ms
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        className={styles.rewindAction}
                        onClick={exportAnimation}
                        aria-label="save the replay as an animated SVG — one CSS animation per gesture, one group per orbit"
                      >
                        save svg animation
                      </button>

                      <label className={styles.rewindField}>
                        <span className={styles.benchKey}>gif</span>
                        <select
                          className={styles.rewindSelect}
                          value={gifWidth}
                          disabled={gifBusy}
                          onChange={(e) => {
                            const px = Number(e.target.value);
                            setGifWidth(px);
                            setAnnounce(
                              `GIF width ${px} px — ${px}×${Math.round(
                                (px * canvas.geom.height) / canvas.geom.width
                              )}, ${steps} frame${steps === 1 ? "" : "s"}`
                            );
                          }}
                          aria-label="width of the exported GIF, in pixels"
                        >
                          {GIF_WIDTHS.map((px) => (
                            <option key={px} value={px}>
                              {px} px
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        className={styles.rewindAction}
                        onClick={exportGif}
                        disabled={gifBusy}
                        aria-busy={gifBusy}
                        aria-label={
                          gifBusy
                            ? `writing the GIF — ${Math.round(gifAt * 100)} per cent done`
                            : `save the replay as an animated GIF — ${gifWidth} pixels wide, one frame per gesture, palette taken from the drawing`
                        }
                      >
                        {gifBusy ? `gif — ${Math.round(gifAt * 100)}%` : "save gif"}
                        {gifBusy && (
                          <span
                            className={styles.gifFuse}
                            style={{ width: `${Math.round(gifAt * 100)}%` }}
                            aria-hidden="true"
                          />
                        )}
                      </button>
                    </>
                  )}

                  {rewind.kind === "history" && (
                    <button
                      type="button"
                      className={`${styles.revertBtn} ${
                        armed === "revert" ? styles.armedBtn : ""
                      }`}
                      onClick={doRevert}
                      onBlur={() => {
                        if (armed === "revert") disarm();
                      }}
                      disabled={revert === null}
                      aria-label={
                        revert === null
                          ? "the drawing already stands at this state — nothing to revert"
                          : armed === "revert"
                          ? `confirm — roll back ${revert.rolledBack} gestures and discard ${revert.discardedRedo} redo steps`
                          : `revert to state ${rewind.index} — rolls back ${revert.rolledBack} gesture${
                              revert.rolledBack === 1 ? "" : "s"
                            } as one undoable step`
                      }
                    >
                      {armed === "revert" ? "revert — sure?" : "revert"}
                      {armed === "revert" && (
                        <span
                          className={styles.armFuse}
                          style={{ animationDuration: `${CONFIRM_MS}ms` }}
                          aria-hidden="true"
                        />
                      )}
                    </button>
                  )}
                </div>

                <p className={styles.rewindNote}>
                  {rewind.kind === "replay" ? (
                    <>
                      A <b>preview</b>. The plate, the history and the undo stack
                      are untouched — closing this leaves the drawing exactly as
                      it was. The exported animation is a{" "}
                      <b>separate file</b>: one <code>&lt;g&gt;</code> per orbit
                      carrying <i>one</i> CSS animation, not one per cell. The{" "}
                      <b>GIF</b> is the same replay at the same step, one frame
                      per gesture, with the palette taken from the drawing
                      rather than quantised — so the colours are exact unless
                      the relief is on, which puts a composition past the 256 a
                      GIF can hold.
                    </>
                  ) : revert === null ? (
                    <>
                      A <b>preview</b>. Scrub to an earlier state and{" "}
                      <b>revert</b> becomes available; nothing on the plate moves
                      until you press it.
                    </>
                  ) : (
                    <>
                      <b>
                        Revert rolls back {revert.rolledBack} gesture
                        {revert.rolledBack === 1 ? "" : "s"}
                      </b>{" "}
                      over {revert.changed} cell
                      {revert.changed === 1 ? "" : "s"} — as <i>one more entry</i>{" "}
                      in the history, not a truncation, so <b>⌘Z brings them all
                      back</b>.{" "}
                      {revert.discardedRedo === 0 ? (
                        <>Nothing is discarded.</>
                      ) : (
                        <>
                          It <b>does</b> discard {revert.discardedRedo} redo step
                          {revert.discardedRedo === 1 ? "" : "s"} for good, which
                          is why it asks twice.
                        </>
                      )}
                    </>
                  )}
                </p>
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

            {/* WHERE YOU ARE, and every way back out.
                Shown only when the path is non-empty, because at the root it
                would be one crumb saying "the whole plate" beside a picture of
                the whole plate.

                PER-CRUMB, not `focus.pathLabel`. That function joins the whole
                path into one string with a separator, and each level has to be
                its own button here — `exitTo(focus, k)` per crumb is what makes
                "leave this arm but stay in this sector" reachable in one click
                from three levels down, which is the same thing `focus.exit`'s
                header argues the double-tap must not give up. `pathLabel` is
                still used, for the sentence the live region says, so the two
                cannot come to describe different places.

                IN NORMAL FLOW, above the plate, rather than floated on the
                artwork beside undo. A floating strip over a drawing surface
                needs the whole `pointer-events` dance the HUD carries, and it
                would sit over the very cells a person is about to double-tap to
                get back out. */}
            {focus.length > 0 && (
              <nav
                className={styles.crumbs}
                aria-label={`focus — ${pathLabel(focus)}`}
              >
                <button
                  type="button"
                  className={styles.crumb}
                  aria-label="leave the focus — back to the whole plate, nothing dimmed"
                  title="back to the whole plate (Escape steps out one level)"
                  onClick={() => applyFocus(ROOT)}
                >
                  plate
                </button>
                {focus.map((step, k) => (
                  <span key={`${step.kind}-${step.id}-${k}`} className={styles.crumbRow}>
                    <span className={styles.crumbSep} aria-hidden="true">
                      ›
                    </span>
                    <button
                      type="button"
                      className={styles.crumb}
                      // The DEEPEST crumb is where you already are. It stays a
                      // real button rather than becoming text, because `exitTo`
                      // at the full depth is the identity and a control that
                      // quietly turns into a label as you drill in is a control
                      // whose Tab order changes shape under the hand.
                      aria-current={k === focus.length - 1 ? "true" : undefined}
                      aria-label={`focus on ${crumbLabel(step)} — ${
                        k === focus.length - 1
                          ? "where you are now"
                          : "step back out to here"
                      }`}
                      title={
                        k === focus.length - 1
                          ? "where you are — press O or Escape to step out, I to go further in"
                          : `back out to ${crumbLabel(step)}`
                      }
                      onClick={() => applyFocus(exitTo(focus, k + 1))}
                    >
                      {crumbLabel(step)}
                    </button>
                  </span>
                ))}
              </nav>
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
                // The ghost, the standing proposal and the cursor are all
                // promises about a plate that is not the one on screen, so a
                // preview drops all three. The STATE is kept — the cursor comes
                // back where it was left when the preview closes.
                preview={previewing ? null : preview}
                candidate={previewing ? NO_SPECS : proposalSpecs}
                cursor={previewing ? null : cursor}
                guides={guides}
                showGuides={showGuides}
                showTiling={showTiling}
                weld={weld}
                dragBehaviour={dragMode}
                shape={shapeTool}
                panning={spaceHeld}
                view={view}
                // NOT dropped while a preview stands, unlike the ghost and the
                // cursor beside it. Those are promises about a plate that is not
                // on screen; this is where the hand IS, and it is as true of a
                // preview as of the live drawing — the preview is the same
                // addresses, reconstructed.
                focused={focusHeld}
                className={styles.canvas}
                candidateClass={styles.marching}
                dimClass={styles.dimFade}
                label={`${
                  rewind === null
                    ? "drawing plate"
                    : `${rewind.kind} preview — state ${rewind.index} of ${steps}, read only —`
                } framed on ${
                  viewMode === "sector" ? `sector ${sector}` : "all six sectors"
                }, depth ${depth}, ${total} cells drawn of ${modelTotal}, ${mode}-fold symmetry brush, ${tool} tool, ${shapeTool} shape${
                  band === null ? "" : `, band ${band}`
                }. Q W E A D Z X C step the cursor on the lattice, W and X move a ring outward and inward, arrow keys walk it by screen direction, Enter ${
                  shapeTool === "free"
                    ? dragMode === "propose"
                      ? "adds an application to the proposal, and commits the whole proposal when pressed on one it already holds"
                      : "paints"
                    : "anchors then lays the figure"
                }. Press question mark for every shortcut.`}
                onHover={previewing ? NOTHING : onHover}
                onPaint={previewing ? NOTHING : paintAt}
                onStrokeEnd={previewing ? NOTHING : endStroke}
                onPropose={previewing ? NOTHING : propose}
                onCommit={previewing ? NOTHING : commitProposal}
                onCommitCancelled={previewing ? NOTHING : commitCancelled}
                onArrow={previewing ? NOTHING : onArrow}
                onShapeDrag={
                  previewing
                    ? NOTHING
                    : (anchor, at, alt) => {
                        // The anchor is a seed like any other, so the focus
                        // refuses it in the same place and on the same rule —
                        // an anchored figure may not START outside the thing you
                        // are inside. Where it REACHES is `clipToRegion`'s
                        // business and it already confines a shape to the
                        // anchor's own region of the symmetry surface.
                        if (!inFocus(anchor)) return;
                        // THE CROSSING GUARD, and the only place the two
                        // meanings of Option could have met.
                        //
                        // The board reads `e.altKey` off every pointer event
                        // and hands it up here as "expand about the anchor".
                        // While the momentary eraser is held that flag is true
                        // on every event of the gesture — so an unmasked line
                        // drag would come out BOTH erasing and symmetric: two
                        // modifiers from one press of one key, one of which
                        // nobody asked for. `shapeAlt` drops it while the
                        // eraser is in force. Read from the ref rather than
                        // from `eraseHeld`, because this is an event handler
                        // and the ref is this instant rather than the last
                        // render's.
                        setShapeDrag({
                          anchor,
                          at,
                          alt: shapeAlt(altRef.current, alt),
                        });
                      }
                }
                onShapeEnd={previewing ? NOTHING : commitShape}
                onPan={onPan}
                // NOT gated on `previewing`: drilling in changes nothing about
                // the drawing, and a person standing in a replay is exactly the
                // person who wants to look closely at one arm of it.
                onFocusTap={onFocusTap}
              />
              {/* The canvas HUD: UNDO, REDO, and the flag that says what the
                  brush is — top left, ON the artwork, in one row.

                  WHY HERE. Undo is the control a drawing program's hand reaches
                  for most and never looks at, and it was 700px away at the far
                  end of a deck above the plate. On the canvas it is where the
                  pointer already is.

                  WHY IT DOES NOT EAT THE DRAWING. The row is `pointer-events:
                  none` and only the two buttons take them back, so the strip
                  between and around them is transparent to the brush. And while
                  a press is live on the canvas the buttons drop out too — the
                  stylesheet turns the whole HUD inert on `:has(.canvas:active)`
                  — so a stroke dragged straight across undo keeps painting the
                  cells underneath instead of skipping them. That mattered
                  because the board releases pointer capture on press, so it only
                  sees moves over its own element.

                  The flag rides in the same row rather than under the buttons:
                  it is the same kind of statement, it was already at this
                  corner, and one 30px band of furniture is cheaper than two.
                  The preview flag outranks the tool flag, because while a
                  preview stands the brush is switched off and naming it would
                  describe a control that is not connected. */}
              <div className={styles.canvasHud}>
                <button
                  type="button"
                  className={`${styles.iconBtn} ${styles.hudBtn}`}
                  onClick={doUndo}
                  disabled={past.length === 0 || previewing}
                  title="undo the last gesture (⌘Z)"
                  aria-label="undo the last gesture"
                >
                  <ActionGlyph name="undo" />
                </button>
                <button
                  type="button"
                  className={`${styles.iconBtn} ${styles.hudBtn}`}
                  onClick={doRedo}
                  disabled={session.journal.future.length === 0 || previewing}
                  title="redo the last undone gesture (⌘⇧Z)"
                  aria-label="redo the last undone gesture"
                >
                  <ActionGlyph name="redo" />
                </button>
                {rewind !== null ? (
                  <span className={styles.previewFlag} aria-hidden="true">
                    {rewind.kind} · {rewind.index}/{steps}
                  </span>
                ) : (
                  /* The momentary eraser reuses this flag rather than raising a
                     second indicator, because it IS the tool flag: `tool` is
                     already "erase" while Option is held, so the chip, its
                     hue, the `cell` cursor on the canvas, the pressed state of
                     the ERASE button and the canvas label all say so with no
                     further work. What it adds is the word HELD and a brighter
                     rule, so a brush that will go away on its own is not
                     mistaken for one that has been chosen — the difference
                     matters, because one of them means "put the key down". */
                  tool !== "paint" && (
                    <span
                      className={styles.modeFlag}
                      data-tool={tool}
                      data-held={eraseHeld ? "on" : undefined}
                      aria-hidden="true"
                    >
                      {eraseHeld ? "erase · held" : tool}
                    </span>
                  )
                )}
              </div>

              {/* ZOOM, ON THE ARTWORK, at the bottom left.
                  Asked for in as many words, and it is the right corner: zoom
                  is a fact about the WINDOW you are looking through, so it
                  belongs on the window rather than 700px away at the end of a
                  deck. It is the same move undo and redo made to the opposite
                  corner, and it inherits all three of the pointer hazards that
                  move documented — `.canvasZoom` in the stylesheet carries them
                  one by one, including the one that bites hardest here: `−` is
                  disabled at 1×, which is the DEFAULT state of every fresh
                  drawing, and a disabled button that still hit-tests is a hole
                  in the drawing surface that swallows a stroke and gives nothing
                  back. Chrome dispatches nothing at all for a press that lands
                  on one — not even to its ancestors — so `pointer-events: none`
                  while disabled is the only fix.

                  BOTTOM LEFT and not bottom right: the candidate bar owns the
                  top right and its COMMIT has to stay findable, undo and redo
                  own the top left, and the empty-plate hint is centred. The
                  fourth corner was the one still free.

                  The middle button is the readout AND the reset, exactly as it
                  was in the deck, so the factor is always on screen and 1× is
                  always one click away. */}
              <div
                className={styles.canvasZoom}
                role="group"
                aria-label="zoom the view"
              >
                <span className={styles.zoomStepper}>
                  <button
                    type="button"
                    onClick={() => setZoomTo(zoom / 2)}
                    disabled={zoom <= 1}
                    title="zoom out — show more of the figure (−)"
                    aria-label="zoom out"
                  >
                    −
                  </button>
                  <button
                    type="button"
                    className={styles.zoomNow}
                    onClick={() => setZoomTo(1)}
                    disabled={zoom === 1}
                    title="fit the whole figure (0)"
                    // ROUNDED FOR DISPLAY ONLY. The stepper's own factors are
                    // powers of two and print exactly; a drill-in lands on
                    // whatever makes the focused cells fill the frame, and
                    // "3.4641016151377544×" is a number nobody asked to read.
                    // The state itself is left alone — see `setZoomTo`.
                    aria-label={`zoom ${
                      Math.round(zoom * 10) / 10
                    } times — click to fit the whole figure`}
                  >
                    {Math.round(zoom * 10) / 10}×
                  </button>
                  <button
                    type="button"
                    onClick={() => setZoomTo(zoom * 2)}
                    disabled={zoom >= ZOOM_MAX}
                    title="zoom in — hold Space and drag to pan (+)"
                    aria-label="zoom in"
                  >
                    +
                  </button>
                </span>
              </div>

              {/* Commit rides ON the plate, opposite the tool flag.
                  It used to sit in the tool strip, and from there it was a
                  control that ARRIVED: a standing candidate pushed the strip to
                  a third line and moved the canvas 44px down — measured —
                  under the very finger that had just proposed. Floated over the
                  corner it costs no layout height at all, so nothing moves when
                  a proposal appears, and it is beside the ghost it acts on. */}
              {standing && (
                <div className={styles.candidateBar}>
                  {/* The key names the count of APPLICATIONS, because that is
                      what the drag gathered and what the mark will record — the
                      button below already names the cells. One number each,
                      rather than one control saying both. */}
                  <span className={styles.benchKey}>
                    proposal · {proposalSpecs.length}
                  </span>
                  <div className={styles.commitRow}>
                    {/* Disabled at zero rather than hidden. An adjustment
                        proposal over bare tiling really would do nothing, and
                        a greyed COMMIT beside the dashed inert outlines says
                        that better than a button that shrugs. */}
                    <button
                      type="button"
                      className={styles.commitBtn}
                      onClick={commitProposal}
                      disabled={proposalCommits === 0}
                      aria-label={
                        proposalCommits === 0
                          ? "nothing to commit — the brush would change no cell here"
                          : `commit the standing proposal — ${proposalSpecs.length} application${
                              proposalSpecs.length === 1 ? "" : "s"
                            } over ${proposalCommits} cells, as one undoable gesture`
                      }
                    >
                      commit {proposalCommits}
                    </button>
                    <button
                      type="button"
                      onClick={dropProposal}
                      aria-label="drop the standing proposal — nothing is painted"
                    >
                      drop
                    </button>
                  </div>
                </div>
              )}
              {paint.size === 0 && !standing && !dropping && !previewing && (
                <p className={styles.emptyHint}>
                  {dragMode === "propose"
                    ? "drag to gather a proposal — tap it to commit"
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

            {/* THE BASELINE: what is true of the drawing, and what is true of
                its symmetry, side by side under the artwork.

                The status used to be the top row of the plate rule and the
                legend the strip under the canvas, and the reviewer's note was
                simply that they are the same kind of sentence and were being
                read in two different places. They are one band now — one row on
                a desktop, two on a phone.

                One ROW is not one LINE, and the difference is measured: at
                1512 the plate is 766px wide and these two readings come to
                about 1330px of small caps between them. The legend alone
                already wrapped to two lines there. So the band is two COLUMNS
                that each wrap inside their own, divided by a hairline —
                genuinely beside each other, which is what was asked, without
                ellipsising a fact to prove it. */}
            <div className={styles.baseline}>
              <div className={styles.readout}>
                <span>
                  {viewMode === "sector" ? `sector ${sector}` : "hexagon"} · d
                  {depth} · <b>{total} cells</b>
                  {viewMode === "sector" && <> of {modelTotal}</>}
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
                    <b>
                      {dragMode === "propose"
                        ? "drag to gather"
                        : "hover to preview"}
                    </b>
                  ) : (
                    <b>reach {reach}</b>
                  )}
                </span>
                <span>
                  {schemeName} · <b>{paint.size} painted</b>
                </span>
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
          </div>

          {/* The keyboard contract, as LINES.
              It was one paragraph of four sentences with the key names bolded
              inside the prose, and the reviewer's complaint was that it had to
              be read rather than scanned: the letters that matter were the same
              size, the same font and nearly the same colour as the sentence
              carrying them. One idea per row now, every key a `<kbd>` chip — the
              same chip the `?` panel prints its chords in — and the chips are
              the column the eye lands in. Every fact from the paragraph is still
              here, in the same order; only the shape changed. */}
          <ul className={styles.keyLines}>
            {/* Two rows run the FULL width rather than sharing the two-column
                grid: the eight lattice keys and the drag sentence are the only
                two entries whose chips are wider than a column's chip gutter,
                and squeezed into one they pushed their own prose into a 150px
                ravine five lines deep. */}
            <li data-span="1">
              <span className={styles.keyChips}>
                <Kbd>Q</Kbd>
                <Kbd>W</Kbd>
                <Kbd>E</Kbd>
                <Kbd>A</Kbd>
                <Kbd>D</Kbd>
                <Kbd>Z</Kbd>
                <Kbd>X</Kbd>
                <Kbd>C</Kbd>
              </span>
              <span>
                walk the cursor on the exact lattice — the six ring keys are the
                six same-orientation steps, at 0°, 60°, 120°, 180°, 240° and
                300°
              </span>
            </li>
            <li>
              <span className={styles.keyChips}>
                <Kbd>W</Kbd>
                <Kbd>X</Kbd>
              </span>
              <span>cross the radial axis — outward, and inward</span>
            </li>
            <li>
              <span className={styles.keyChips}>
                <Kbd>V</Kbd>
              </span>
              <span>flips the frame — the whole plate, or one sector; nothing is cleared</span>
            </li>
            <li>
              <span className={styles.keyChips}>
                <Kbd>,</Kbd>
                <Kbd>.</Kbd>
              </span>
              <span>step the framed sector round the plate; nothing is cleared</span>
            </li>
            <li>
              <span className={styles.keyChips}>
                <Kbd>?</Kbd>
              </span>
              <span>every shortcut</span>
            </li>
            {dragMode === "propose" ? (
              <li data-span="1">
                <span className={styles.keyChips}>
                  <Kbd>drag</Kbd>
                  <Kbd>tap</Kbd>
                  <Kbd>Enter</Kbd>
                  <Kbd>Esc</Kbd>
                </span>
                <span>
                  drag gathers a proposal, one application per cell it crosses
                  and nothing on the plate; tap the ghost, or press Enter on a
                  cell it already holds, to commit the whole thing as one
                  undoable gesture; Esc drops it
                </span>
              </li>
            ) : (
              <li data-span="1">
                <span className={styles.keyChips}>
                  <Kbd>drag</Kbd>
                  <Kbd>Enter</Kbd>
                </span>
                <span>
                  drag paints continuously; Enter paints at the cursor
                </span>
              </li>
            )}
          </ul>

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
            <b>2r+1</b> cells — checked when the figure is built, and still true
            of a hexagon band <i>clipped to a sector</i>, which is what makes the
            sector view the triangle rather than a picture of it. Hexagon bands
            are <b>not</b> uniform and each meets exactly three sectors. There is{" "}
            <b>one plate</b>: the hexagon, addressed <code>s0:</code>…
            <code>s5:</code>, and the triangle is a frame on it, so changing the
            view clears nothing and only the depth ever changes which cells
            exist — and the address plate carries the drawing through that too.
            An exported SVG carries the plate back with it, in a comment: canvas,
            depth, convention, the painted cells and the frame, so <b>load</b> is
            an exact restore rather than a reading of the picture, and a file
            written before this — <code>canvas: &quot;triangle&quot;</code> —
            migrates into sector 0 word for word. A file without that comment is
            matched shape by shape against the frame instead, and the match rate
            is <i>reported</i> rather than assumed — see{" "}
            <code>src/lib/artfile.ts</code> and <code>src/lib/view.ts</code>.
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
                        {/* One chip per ROW rather than per letter: several of
                            these chords are alternatives (`⌘Z / Ctrl Z`) or
                            ranges (`Shift 1 … 7`), and splitting those into
                            separate caps would print keys that are not pressed
                            together as though they were. The chip is the same
                            one the lines under the plate use. */}
                        <dt className={styles.helpKeys}>
                          <Kbd>{row.keys}</Kbd>
                        </dt>
                        <dd className={styles.helpWhat}>{row.what}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
            </div>
            {/* The strip, spelled out. An icon whose name is only in a tooltip
                is a word that cannot be read on a touchscreen, so every glyph
                in the plate rule is printed here beside what it does — and it
                is the SAME component, so this cannot come to describe a strip
                that no longer exists. */}
            <section className={`${styles.helpGroup} ${styles.glyphSection}`}>
              <h3 className={styles.helpGroupTitle}>the strip</h3>
              <ul className={styles.glyphList}>
                {GLYPH_LEGEND.map((g) => (
                  <li key={g.what} className={styles.glyphRow}>
                    <span className={styles.glyphCell}>{g.icon}</span>
                    {g.what}
                  </li>
                ))}
              </ul>
            </section>

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
