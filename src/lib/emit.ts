/**
 * The one serialiser: a composition — or any layer inside it — as SVG text, and
 * that text back again.
 *
 * ── Why there is one function and not four ───────────────────────────────
 *
 * Copy/paste and export/import are the same operation twice. Both turn a
 * drawing into text and text back into a drawing; the only difference is where
 * the text goes, and that is the caller's business. So there is `serialise` and
 * `parse`, SCOPE is a parameter of the first, and the word "clipboard" does not
 * appear in this file. Two code paths would be two chances for a pasted layer
 * and a saved layer to disagree about what a layer is.
 *
 * ── The observation this is built on ────────────────────────────────────
 *
 * Every cell of this figure is CONGRUENT. At one depth the leaves of the V4 cut
 * are unit triangles of the Eisenstein lattice, so there are exactly TWO of
 * them — one pointing up, one pointing down — and a drawing of six thousand
 * cells is those two shapes at six thousand positions. Measured rather than
 * assumed: `test/emit.test.ts` counts the distinct shapes at every depth in
 * both views and gets 2 every time.
 *
 * So the file says each shape ONCE, in `<defs>`, and every cell is a `<use>` of
 * one of them at its own position. Colour is a CSS class, one rule per distinct
 * colour, rather than an attribute repeated per cell. Both are worth real
 * bytes, and the test measures them rather than this comment arguing for them.
 * A hexagon with a third of its cells painted, against what `artworkSvg` writes
 * for the same drawing:
 *
 *              THE DRAWING                 THE WHOLE FILE
 *            raw          gzipped        raw          gzipped
 *   depth 3  81%          64%            93%          75%
 *   depth 4  80%          54%            91%          62%
 *   depth 5  79%  (275k)  52%  (24.5k)   90%  (344k)  67%  (36.4k)
 *
 * Two columns because they answer different questions. THE DRAWING is what this
 * format is worth — the same numbers with the payload comment removed from both
 * files. THE WHOLE FILE includes the payload, and a layered file states its
 * paint twice: once flattened, for a reader that predates layers, and once per
 * layer. That duplication is the price of the stack and it is stated here
 * rather than hidden in the better number.
 *
 * The gzipped saving is the bigger one, which is the opposite of the intuition
 * that repetition compresses so well that structure cannot help. It helps
 * because the repeated thing gets SHORTER, not merely more repetitive. Welding
 * the paint widens the gap further — 65% raw on the drawing, because a weld
 * costs two attributes per CELL in the polygon form and one word per RULE here.
 *
 * ── `x`/`y`, and not `transform` ────────────────────────────────────────
 *
 * `<use x y>` on a `<polygon>` is a translate of the referenced content, and
 * that is what this file relies on. Measured by rewriting THIS emitter's own
 * output into each of the alternatives, depth 5, drawing bytes:
 *
 *                             raw        gzipped
 *   x="…" y="…"               274 615    24 451
 *   transform="translate(…)"  366 775    25 187     +34% raw, +3.0% gzipped
 *   style="--x:…;--y:…"       323 767    25 218     +18% raw, +3.1% gzipped
 *
 * `x`/`y` wins on both counts and is the shortest thing to read; the custom
 * properties would additionally need a `transform` rule to do anything at all.
 * The one thing `<use>` must not do is behave differently from a polygon at the
 * same place — `test/emit.test.ts` resolves the geometry both ways and compares
 * vertex sets, and the same two documents were rendered side by side in a
 * browser: 384 cells, worst positional difference 6·10⁻⁵ of a device pixel,
 * identical computed fill and stroke on every one, and a hit test at every cell
 * centre returning the same colour in both.
 *
 * ── Coordinates: two decimals, and rounded BEFORE the offset ────────────
 *
 * The lattice is exact integers before projection, and a surprising amount
 * survives: on the hexagon every x coordinate is an EXACT INTEGER at every
 * depth this program draws, because the unit is 512/2^d ≥ 16 and a lattice
 * point sits at x = (a + b/2)·unit. The y coordinates are cy − b·unit·√3/2 and
 * are irrational, so they are the only ones that need decimals at all.
 *
 * Two of them, matching `artworkSvg`'s `fmt` and `artfile.GEOMETRY_PRECISION`.
 * NOT a taste: the geometric importer compares a file's coordinates against the
 * canvas's own at exactly two places, so writing three would be writing digits
 * nothing reads and writing one would put a cell 0.05 units from where the
 * importer looks for it. What the two decimals cost is set out on `shapeOf`.
 *
 * The shortest encoding was measured and NOT taken: wrap the drawing in
 * `transform="matrix(u, 0, u/2, −u√3/2, 0, 0)"` and every position becomes a
 * small exact integer — 19 030 bytes gzipped at depth 5, a further 22% off.
 *
 * The reason to reject it is NOT that the matrix is a shear and would draw the
 * hairline 73% heavier along one axis than another. That is true, and it is
 * answered by `vector-effect="non-scaling-stroke"` in about 150 bytes, so it is
 * a solvable objection rather than a decisive one. Two things are decisive:
 *
 *   EXACTNESS DIES. The entry `−u·√3/2` is irrational and has to be written at
 *   finite precision, so every cell's y becomes `b ×` a rounded number and the
 *   error grows with the row index rather than staying bounded. At depth 5 the
 *   unit is 16, the entry is 13.856406…, and writing it to the file's own two
 *   decimals costs 0.0036 per row; `b` reaches 64 there, so the last row lands
 *   0.23 units from where it belongs. That is more than ten times
 *   `artfile.GEOMETRY_PRECISION`, so it destroys the invariant this module is
 *   built on — that the anchor plus the prototype reproduces the number
 *   `artworkSvg` writes EXACTLY — and it does it worse the further down the
 *   picture you look. `test/emit.test.ts` measures the 0.23.
 *
 *   IT BREAKS THIS REPO'S OWN READERS. `artfile.importByGeometry` and
 *   `resolvedShapes` both compare a file's coordinates against the canvas's
 *   own, and neither applies a transform — nothing in this codebase composes a
 *   CTM. Under a matrix every coordinate in the file is in lattice units and
 *   every coordinate they match against is in pixels, so a file this program
 *   wrote would import as zero matched cells from this program.
 *
 * A file that is smaller and draws a different picture is not smaller, and one
 * its own loader cannot read is not a file.
 *
 * ── Six rotations of one sector: measured, and NOT taken ────────────────
 *
 * The hexagon is C₆-symmetric whatever the user drew, so a sector could be
 * written once and instanced six times:
 *
 *   <defs><g id="sec"> …one sector's cells… </g></defs>
 *   <use href="#sec"/>   <use href="#sec" transform="rotate(-60 CX CY)"/>   …
 *
 * Two of the obvious objections do NOT apply, and were checked rather than
 * argued. The six sectors PARTITION the figure, so unlike an orbit — which can
 * be short — nothing double-draws and nothing is left out. And the transform is
 * a true isometry, so there is none of the stroke distortion the matrix above
 * would have caused: Chrome resolves each instance to det = 1, a =
 * 0.49999999999999994, b = −0.8660254037844387. It is also worth real bytes,
 * because the tiling is 95% of a sparse depth-5 file: that file goes to 42% of
 * its raw size and 50% of its gzipped size.
 *
 * IT IS NOT TAKEN, because ROTATING A TWO-DECIMAL COORDINATE DOES NOT LAND ON A
 * TWO-DECIMAL COORDINATE. Cells of the five rotated sectors whose vertices come
 * out a full 0.01 from where the explicit form puts them, using the coordinates
 * and the centre this file can actually state:
 *
 *   depth 3   115 / 320      depth 4   399 / 1280      depth 5   1555 / 5120
 *
 * About 30% at every depth. That is the matrix form's failure again — bounded
 * here rather than growing with the row index, but a cell that lands a quantum
 * away is a cell `importByGeometry` and `resolvedShapes` miss.
 *
 * It can be bought back, and the price is this module's own invariant. The
 * instanced sector has to state its geometry at EIGHT decimals and its rotation
 * centre at full double precision — the centre is (512√3 + 120)/2, and stating
 * it at the two decimals everything else here is stated at is by itself enough
 * to put 127 of 5120 cells in the wrong hundredth at depth 5. With both, a
 * reader that follows `<use>` into a `<g>` does reproduce every cell exactly: 0
 * of 1536 wrong at depth 4. So the file would state one sixth of its geometry
 * at eight decimals and five sixths at two, and inside its own `<defs>` it
 * would have to write full polygons rather than `<use>` of a prototype, the
 * prototypes being stated at two decimals — the format arguing against itself
 * in its own defs block.
 *
 * And it still would not RENDER exactly. Blink keeps a rotation centre as a
 * float32: hand it 503.40500673763256 and `getScreenCTM` reports the rotation
 * taken about 503.40499877929688, which moves 90 of 1536 cells into a different
 * hundredth. Invisible — 1.6·10⁻⁵ of a user unit is thousands of times below a
 * device pixel — but it is a floor no amount of precision in the file can lift.
 *
 * Three more, all measured. The saving is ZERO where a drawing is dense and
 * asymmetric — 96% of raw at depth 5, and 103% of gzipped at depth 3, a LOSS —
 * because the tiling is `shown` minus the painted cells and is therefore
 * C₆-symmetric only when the paint is; "unconditional" is not available. A
 * relieved plate IS C₆-symmetric (1280 of 1280 rotations exact at depth 4), so
 * the one drawing that must fall back to plain polygons is the one a symmetry
 * test fires on, and the fallback would have to be gated on `factored` rather
 * than on symmetry. And `parse` cannot recover which cell a shape belongs to:
 * it pairs the k-th shape in a group with the k-th cell the payload lists, the
 * instanced order is not that order, and THIS MODULE KNOWS NOTHING ABOUT
 * SECTORS — `hexagon.ts` owns the index law — so the split would have to become
 * a new kind of statement in the markup. Today `parse` returns `null` for such
 * a file and `resolvedShapes` reads 0 of its 1536 shapes.
 *
 * A TRANSLATE has none of this. Every hexagon x is an exact integer, so the
 * horizontal offset between two cells of one row is an exact integer at every
 * depth — 6144 of 6144 at depth 5 — and `<use x>` reproduces the coordinate to
 * the bit, with no centre to state and no second precision. Whatever this file
 * factors next should be factored along a row and not around the eye.
 *
 * ── The markup is indented, and that is nearly free ─────────────────────
 *
 * One element per line, two-space indent. It costs 11% of the raw bytes and
 * between 0.7% and 2.3% of the gzipped ones — measured, in the test. A file a
 * person can open and read is worth two parts in a hundred.
 *
 * ── Layers ──────────────────────────────────────────────────────────────
 *
 * A layer is a `<g>`; a sub-layer is a `<g>` inside it, to any depth. Pasting a
 * composition onto a layer grafts it in whole, so the depth grows and nothing
 * is flattened. Serialising a layer means that `<g>` and everything under it,
 * plus ONLY the prototypes and rules that subtree references — a copied layer
 * is small and self-sufficient rather than dragging the document's whole
 * palette with it.
 *
 * Every flag written into the markup is the layer's OWN. `hidden` becomes
 * `display="none"` and `opacity` becomes `opacity="…"`, both of which SVG
 * already composites down the tree, so the rendered file hides or fades the
 * descendants of a hidden or faded group without any of them being written as
 * hidden or faded themselves.
 *
 * That the round trip does not permanently mark the children is a property of
 * the PAYLOAD and not of those attributes: `parse` never reads `display` or
 * `opacity` out of the markup at all — every flag it returns comes from the
 * payload comment, where each layer states its own. The attributes are how the
 * file DRAWS; the payload is what it MEANS.
 *
 * ── What made a gesture, said where a stranger can read it ──────────────
 *
 * A stroke in this program is applied through a SYMMETRY GROUP: one gesture
 * paints a whole orbit at once. That is the fact about a drawing that is hardest
 * to recover afterwards and the cheapest to state, so a layer that was made by
 * one carries three numbers, and they go into the MARKUP as well as into the
 * payload:
 *
 *   data-reveal   the animation step this layer comes up at
 *   data-mode     the brush symmetry the gesture was made under
 *   data-orbit    how many cells the orbit actually held
 *
 * Only `data-reveal` is load bearing for the picture; the stylesheet selects on
 * it — and it is what an in point and an out point are stated against, so a
 * replay cut to part of the drawing is a change to the STYLESHEET and never to
 * these three words. See `EmitAnimation`. The other two are for a reader that
 * is not this program. A `<g>` in Illustrator or Inkscape is a compound path
 * with no indication of what produced it, and these two words make one
 * addressable — every six-fold stroke, every orbit that came out short — which
 * is the whole reason this format writes layers rather than a flattened plate.
 *
 * They are therefore written for a STILL export too. A gesture's symmetry is a
 * fact about the gesture and not about whether anything is being played back,
 * and a file that stated it only while animating would be a file where turning
 * the reveal off silently destroyed the provenance while leaving the drawing
 * pixel for pixel the same.
 *
 * `orbit` IS NOT DERIVABLE FROM `mode`, which is why there are two fields and
 * not one. A seed cell sitting on a mirror line of the group is stabilised, so a
 * 6-fold brush lays down THREE cells and not six: `mode` is what the user chose
 * and `orbit` is what the figure gave back. Anything computing one from the
 * other would report a six-cell compound path with three cells in it, and would
 * do it on exactly the strokes a symmetry-minded reader is most interested in.
 * `test/emit.test.ts` round trips a `mode: 6, orbit: 3` layer for that reason,
 * rather than a matching pair that a derivation would also satisfy.
 *
 * What the two cost, measured in that test on 120 gestures at depth 4: 29 bytes
 * a gesture — 2.7% of the raw file and 0.6% gzipped when it animates, 3.1% and
 * 0.9% when it does not. A few percent raw, and it is left standing rather than
 * shortened, because the shorter spellings are the ones nothing else can read.
 *
 * ── Reading is text and regex only ──────────────────────────────────────
 *
 * A loaded file is UNTRUSTED. `parse` returns `null` for anything it cannot
 * vouch for and throws for nothing; it never hands markup to a DOM parser and
 * never assigns to `innerHTML`, so no code path in a hostile file can execute.
 * The payload in the comment is the authority for everything model-side — which
 * cells, which layers, which ids — and it is validated by `artfile.ts` before a
 * byte of the markup is trusted. The markup supplies the picture.
 */

import {
  attrOf,
  encodeArt,
  extractArt,
  formatRanges,
  parseRanges,
  cellCount,
  LAYER_ID,
  MAX_ART_BYTES,
  MAX_LAYER_DEPTH,
  MAX_LAYERS,
  RESERVED_IDS,
  type ArtAnimation,
  type ArtComposition,
  type ArtLayer,
  type ArtPayload,
} from "./artfile";
import { fmtCoord, type ArtCell, type ArtOverlayGroup } from "./strokes";

// ── the interface this module requires of the layer model ────────────────

/**
 * What a layer has to be for this file to write it down.
 *
 * Deliberately the smallest thing that can be serialised, and deliberately not
 * the thing the editor holds: no selection, no order operations, no parent
 * pointers, nothing that would make the file format an opinion about how layers
 * are edited. A layer model is free to be richer; it only has to be able to
 * produce this and to accept it back.
 *
 * `id` must be an XML name (`artfile.LAYER_ID`) and unique across the whole
 * composition, because it is written straight into `id="…"` so that a reader
 * can match a `<g>` in the markup to an entry in the payload by eye. `rekey`
 * below is what makes that safe when a pasted subtree arrives carrying ids the
 * target already uses.
 *
 * Every flag is the layer's OWN and never the resolved one. A hidden parent
 * hides its descendants when the stack is drawn; it does not make them hidden.
 */
export interface EmitLayer {
  id: string;
  name?: string;
  /** OWN visibility. Absent or false means visible. */
  hidden?: boolean;
  /** OWN lock. Carried through the file; nothing here renders it. */
  locked?: boolean;
  /** OWN alpha in `0…1`. Absent means 1. */
  opacity?: number;
  /** This layer's own paint: model cell index → `#rrggbb`. */
  paint?: ReadonlyMap<number, string>;
  /** Sub-layers, in paint order: later children sit over earlier ones. */
  children?: readonly EmitLayer[];
  /** Animation: the step this layer is revealed at. See `EmitAnimation`. */
  reveal?: number;
  /** The brush symmetry the gesture was made under, when one was recorded. */
  mode?: number;
  /**
   * How many cells the recorded orbit held, when this layer is one.
   *
   * THE REALISED SIZE, which is not always `mode`: a stabilised seed gives a
   * short orbit. Set it from what the gesture actually painted, never from the
   * brush. See the header.
   */
  orbit?: number;
}

/**
 * The timing of a looping reveal.
 *
 * A layer carrying `reveal: k` comes up at `k · stepMs` and stays up for the
 * rest of the cycle. One CSS rule and one `@keyframes` per DISTINCT reveal
 * index — not per layer and not per cell — which is O(gestures) rather than
 * O(cells).
 *
 * One shared `@keyframes` plus a per-layer `animation-delay` is the obvious
 * shape and it CANNOT loop: with an infinite iteration count the delay applies
 * to the first iteration only, so the second cycle plays every layer at once,
 * and with a finite count nothing ever resets. The window a layer is visible
 * for has a different LENGTH for every reveal index, and a delay shifts a
 * window without resizing it. That argument is `replay.ts`'s, and it is
 * reproduced here because it is the reason this looks more expensive than it
 * needs to be.
 */
export interface EmitAnimation {
  /** Milliseconds between reveals. */
  stepMs: number;
  /** Milliseconds the finished plate holds before the loop restarts. */
  holdMs: number;
  /** How long a layer takes to come up. Short — it reads as a stroke landing. */
  fadeMs: number;
  /** How many reveal steps the DRAWING has. The cycle's is `out - in + 1`. */
  steps: number;
  /**
   * The in point and the out point: which reveal steps actually play.
   *
   * CLOSED and inclusive, indices into the same reveal space `EmitLayer.reveal`
   * uses, so `{in: 3, out: 7}` plays five steps and both ends are seen.
   * `replay.InOut` is the same pair in the model and its header carries the
   * argument for closed over half-open; `artfile.ArtAnimation` is where the
   * file states them.
   *
   * HONOURED IN THE STYLESHEET, not by dropping markup. A layer whose reveal
   * falls before the in point is written exactly as it always was and is simply
   * given `opacity: 1` from the first frame — it is the ground, and the ground
   * needs no new mechanism. A layer past the out point keeps its `opacity: 0`
   * and is never named by a keyframe, so it is in the file and not in the
   * picture. Both matter: `data-reveal`, `data-mode` and `data-orbit` are
   * PROVENANCE and are written even for a still export, so a cut must not be
   * allowed to delete the record of what made the gesture — see the header.
   *
   * Absent means the whole drawing plays, and `animationRules` reduces to
   * exactly the bytes it wrote before this existed when they are.
   */
  in?: number;
  /** The last reveal step that plays. Closed with `in`; both or neither. */
  out?: number;
}

/**
 * A layer that reveals BEFORE something it sits inside. See `revealBreak`.
 *
 * Both ends are named because the message a caller writes has to say which two
 * layers disagree — "layer g7 reveals at 4 but the group g2 it sits in reveals
 * at 9" is actionable and "invalid reveal order" is not.
 */
export interface RevealBreak {
  /** The id of the layer whose reveal is too early. */
  readonly layer: string;
  /** The step that layer asks to come up at. */
  readonly reveal: number;
  /** The nearest enclosing layer that comes up later, and the step it does. */
  readonly ancestor: string;
  readonly at: number;
}

/**
 * The first layer that reveals before an ancestor of it does, or `null`.
 *
 * ── MEASURED IN A BROWSER, and it is a silent failure without this ──────
 *
 * SVG composites group opacity MULTIPLICATIVELY, so a nested element is visible
 * only when every ancestor is: the threshold of a product is the product's LATEST
 * threshold, at the MAX. Sampled on a flat 3200 ms cycle with a nested DOM, the
 * half-opacity crossing relative to the cycle:
 *
 *   parent 800 × child 1200        →  1200 ms     (max)
 *   parent 800 × child 1600        →  1601 ms     (max)
 *   three levels, 400/1200/1600    →  1601 ms     (max composes down a chain)
 *   parent 800 × child  400        →   801 ms     (max — NOT 400)
 *
 * THE LAST ROW IS THE DEFECT. A child asking for 400 came up at 801 and nothing
 * anywhere said so: the file animated differently from the model that wrote it,
 * the number was still in the markup as `data-reveal`, and the only way to find
 * out was to sample opacity in a browser. `nested.wellOrdered` predicts exactly
 * this and its header carries the same numbers; this is the emitter's half of
 * it, because the invariant is ultimately about what gets WRITTEN.
 *
 * ── The floor is the running MAX, not the nearest ancestor ──────────────
 *
 * A grandchild at 6 inside a child at 7 inside a parent at 5 satisfies its
 * grandparent and is still clamped, to 7. So the walk carries the greatest
 * reveal seen on the way down. It is monotone by construction — a layer is only
 * allowed past the check when its own reveal is at least the floor, at which
 * point its reveal IS the new floor — so one number suffices and no maximum has
 * to be recomputed.
 *
 * A layer with NO `reveal` neither raises the floor nor breaks it. Both halves
 * are deliberate: an ungated ancestor runs no opacity animation at all, so it
 * clamps nothing; and a child with no reveal is gated entirely by its ancestors
 * and states no time of its own to disagree with them. That is precisely the
 * shape `provenance.gestureLayers` writes — the gesture carries the reveal, the
 * orbits under it carry `mode` and `orbit` and no time — which is why no file
 * this program has ever produced can trip this.
 *
 * EXPORTED, so a UI-facing caller can ASK before it writes. `serialise` and
 * `parse` both refuse a document that fails this, and a panel that would rather
 * clamp a reveal visibly — moving the number where the person can see it move —
 * needs a way to find the pair to clamp without provoking the refusal.
 */
export function revealBreak(layers: readonly EmitLayer[]): RevealBreak | null {
  const walk = (
    list: readonly EmitLayer[],
    floor: { id: string; at: number } | null
  ): RevealBreak | null => {
    for (const l of list) {
      let under = floor;
      if (l.reveal !== undefined) {
        if (floor !== null && l.reveal < floor.at) {
          return { layer: l.id, reveal: l.reveal, ancestor: floor.id, at: floor.at };
        }
        under = { id: l.id, at: l.reveal };
      }
      if (l.children !== undefined) {
        const hit = walk(l.children, under);
        if (hit !== null) return hit;
      }
    }
    return null;
  };
  return walk(layers, null);
}

// ── the document ─────────────────────────────────────────────────────────

/**
 * Everything a file says, in one value.
 *
 * `serialise` writes it and `parse` returns it, and the round trip is on the
 * TEXT: `serialise(parse(t)) === t`. It is not on this object — the file states
 * coordinates to two decimals, so a document that went through it comes back
 * with coordinates rounded to what the file could say. That is the file being
 * honest about its own precision rather than a loss.
 */
export interface EmitDoc {
  width: number;
  height: number;
  /** Model cell index → its polygon, in the document's own pixels. */
  cells: ReadonlyMap<number, ArtCell>;
  /** The cell indices the picture frames, ascending. */
  shown: readonly number[];
  /** Plate colour behind the tiling. */
  background: string;
  /** Fill for cells nobody painted, or `null` to leave them as background. */
  unpainted: string | null;
  tileSeam: string | null;
  paintSeam: string | null;
  seamWidth: number;
  /** Stroke every painted cell in its own fill, closing the sub-pixel seam. */
  weldPaint: boolean;
  title: string;
  layers: readonly EmitLayer[];
  overlay: readonly ArtOverlayGroup[];
  animation: EmitAnimation | null;
  /**
   * The model-side statement of what this drawing IS. Mandatory, because a
   * layer names cells by INDEX and an index is meaningless without the canvas,
   * the depth and the convention that issued it. `comp` is filled in by
   * `serialise` from `layers` and must not be set here.
   */
  payload: Omit<ArtPayload, "comp">;
}

/** Whole composition, or one layer and everything under it. */
export type EmitScope = { readonly layer: string } | undefined;

/**
 * How many distinct cell shapes are worth a `<defs>` entry.
 *
 * Two is the answer for every ordinary drawing — the figure has two cell shapes
 * and that is the whole point of this module. It is a LIMIT rather than an
 * assertion because the relief bakes a per-ring scale into the vertices and
 * genuinely destroys the congruence: at depth 4 a relieved plate has 1130
 * distinct shapes among 1536 cells — and 278 among 384 at depth 3, in both
 * readings — so a prototype per shape would be a bigger file than plain
 * polygons. Those counts are reproduced by `test/emit.test.ts` rather than
 * remembered here; they were 1134 and 282 when this was first written, and a
 * comment that says "measured" has to still measure.
 *
 * Past this limit the emitter writes polygons, which is the honest thing to do
 * about a picture whose cells are not congruent.
 *
 * Eight rather than two so a canvas that ever has a handful of shapes — a mixed
 * depth, a decorated rim — still gets the saving.
 */
export const PROTOTYPE_LIMIT = 8;

const INDENT = "  ";

/**
 * What a colour may look like on its way into the file.
 *
 * `#rrggbb`, `rgba(…)`, a keyword. Anything outside this set becomes `none`
 * rather than being written: a colour is caller data, and caller data that
 * contains a quote or an angle bracket would be a way to write markup through
 * an attribute. Nothing in this program can produce such a colour; the guard is
 * here because "nothing can" is a claim about today's callers.
 */
const COLOUR = /^[#A-Za-z0-9(),.%\s/-]{1,64}$/;

const colourSafe = (c: string): string => (COLOUR.test(c) ? c : "none");

const escapeText = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const escapeAttr = (s: string) => escapeText(s).replace(/"/g, "&quot;");

/** What `escapeAttr` writes, plus the two numeric forms XML also allows. */
const NAMED: Record<string, string> = { quot: '"', gt: ">", lt: "<", amp: "&" };

/**
 * An escaped attribute or text run, back as the characters it stands for.
 *
 * ONE pass, so an entity that appears in the OUTPUT of decoding another one is
 * left alone: `&amp;lt;` is the four characters `&lt;` and not a `<`, which a
 * chain of `.replace` calls gets right only by accident of ordering.
 *
 * The numeric forms are here because they round trip through this module and
 * without them they round trip WRONG rather than not at all. A title written by
 * another tool as `a &#60; b` came back as the literal text `a &#60; b`, and
 * re-serialising it escaped the ampersand: `a &amp;#60; b`, which renders as
 * `a &#60; b`. A saved file that says something different from the file it was
 * loaded from is the one failure this module exists to prevent, and it does not
 * matter that both files are well formed.
 */
const unescapeAttr = (s: string) =>
  s.replace(
    /&(?:(quot|gt|lt|amp)|#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6}));/g,
    (whole, name: string | undefined, dec: string | undefined, hex: string | undefined) => {
      if (name !== undefined) return NAMED[name];
      const code = dec === undefined ? parseInt(hex as string, 16) : Number(dec);
      // A code point no character has, or one no document may contain, is left
      // as the text it was written as rather than guessed at.
      if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return whole;
      return String.fromCodePoint(code);
    }
  );

/** Three decimals for an alpha, exactly as `artworkSvg` writes one. */
const fmtAlpha = (n: number): string => {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? "0" : String(r);
};

// ── prototypes ───────────────────────────────────────────────────────────

interface Placed {
  /** Prototype id, or `null` when this shape is written out in full. */
  proto: string | null;
  /** Where the prototype is placed, already formatted. */
  x: string;
  y: string;
  /** The full `points` text, for the polygon fallback. */
  points: string;
}

/** Two decimals, as a number. The file's own quantum, from `strokes.fmtCoord`. */
const q2 = (n: number): number => {
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
};

/**
 * A cell's shape and where it sits, with the shape stated independently of the
 * position — and, crucially, QUANTISED FIRST.
 *
 * The anchor is the cell's lowest vertex — smallest x, then smallest y — and
 * the shape is the other vertices measured from it, SORTED. Sorting collapses
 * the six ways of writing one triangle into one: a polygon that starts at a
 * different corner, or winds the other way, is the same shape here, and nothing
 * downstream can tell, because a triangle's fill and its stroke do not depend on
 * which corner it was written from.
 *
 * ── Why the rounding happens before the subtraction, and what it costs ────
 *
 * Round the vertex, THEN take the offset, and the anchor and the offset are
 * both exact multiples of the file's own quantum — so `x` plus the prototype's
 * coordinate reproduces the number `artworkSvg` would have written for that
 * vertex EXACTLY, not to within a hundredth. Take the offset first and round
 * afterwards and the two roundings compound: a cell comes out up to 0.01 from
 * where the polygon form puts it, adjacent cells stop sharing an edge, and a
 * geometric import that matches at two decimals — which is what
 * `artfile.GEOMETRY_PRECISION` does — misses.
 *
 * It costs TWO EXTRA PROTOTYPES. The figure has two cell shapes; the row height
 * is `unit·√3/2`, which is irrational, so consecutive rounded rows sit either
 * `⌊h⌋` or `⌈h⌉` hundredths apart and each of the two shapes is written down two
 * ways. Four, at every depth, in both views — measured in `test/emit.test.ts`,
 * along with the claim that the reconstruction is exact. Four `<defs>` lines
 * instead of two is what exactness costs here, and it is worth it.
 */
function shapeOf(cell: ArtCell): { sig: string; ax: number; ay: number } {
  const sorted = cell.verts
    .map((v) => [q2(v[0]), q2(v[1])] as [number, number])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const o = sorted[0];
  return {
    sig: sorted.map((v) => `${fmtCoord(q2(v[0] - o[0]))},${fmtCoord(q2(v[1] - o[1]))}`).join(" "),
    ax: o[0],
    ay: o[1],
  };
}

/**
 * The id a shape gets in `<defs>`.
 *
 * `u` when the odd corner sits ABOVE the line of the other two and `d` when it
 * sits below — which on this figure is the up-pointing and down-pointing
 * triangle, and on any other is still the only two-way distinction a triangle
 * has. The variants are `u2`, `d2`, and so on, in discovery order, so a reader
 * meeting `#u2` knows it is an up triangle and that there is more than one way
 * to write one at two decimals.
 *
 * `taken` IS SEEDED WITH EVERY LAYER ID THE DOCUMENT WILL WRITE, and that is
 * not a nicety. `artfile.RESERVED_IDS` keeps a layer from being called `u`, `d`,
 * `tiling` or `paint`, but this function also mints `u2`, `d2`, `p` and `ux`,
 * and a layer called `u2` is a perfectly legal payload — so the document came
 * out with two `id="u2"`, round tripped happily, and handed a renderer a
 * `<use href="#u2">` with two answers. An enumerable list of forbidden names
 * has to be extended every time this function learns a new one, which is a rule
 * that can fall behind. Reading the ids the document ACTUALLY holds cannot.
 */
function prototypeId(sig: string, taken: ReadonlySet<string>): string {
  const mid = sig.split(" ")[1];
  const dy = Number(mid?.split(",")[1]);
  const stem = Number.isFinite(dy) ? (dy < 0 ? "u" : "d") : "p";
  if (!taken.has(stem)) return stem;
  for (let n = 2; n < 100; n++) if (!taken.has(`${stem}${n}`)) return `${stem}${n}`;
  // Unreachable: `PROTOTYPE_LIMIT` is far below 100, and past it nothing is
  // factored at all.
  return `${stem}x`;
}

/** The full `points` text a cell would be written as, unfactored. */
const pointsOf = (cell: ArtCell): string =>
  cell.verts.map((v) => `${fmtCoord(v[0])},${fmtCoord(v[1])}`).join(" ");

// ── the document's own name ──────────────────────────────────────────────

/**
 * The id this document goes by, and the prefix on everything it puts into a
 * namespace it does not own.
 *
 * ── Why a file needs a name at all ───────────────────────────────────────
 *
 * `<style>` INSIDE AN INLINE SVG IS A DOCUMENT-LEVEL STYLESHEET. It is not
 * scoped to the `<svg>` it sits in, and `@keyframes` is not scoped to anything
 * at all — not even `@scope` scopes an animation name, because animation names
 * are resolved in one global namespace per document. So a file that wrote
 * `.k0`, `.tile`, `[data-reveal]` and `@keyframes r0` was writing NINE generic
 * global selectors into whatever page inlined it. Two of these on one page and
 * the first artwork renders in the second one's palette, because both define
 * `.k0` and the later one wins. Worse, a host page's own `<h1 data-reveal="3">`
 * — a perfectly ordinary thing to write — picked up `opacity: 0`, an infinite
 * iteration count and `animation-name: r3`, so the heading vanished and flashed
 * on a three-second loop for as long as the page was open.
 *
 * Every selector is therefore written under `#ff……`, and every keyframe name
 * carries it as a prefix. A page can inline as many of these as it likes.
 *
 * ── Why a hash and not a counter ─────────────────────────────────────────
 *
 * The id has to be a pure function of the file, because `serialise(parse(t))`
 * must be `t` to the byte and a counter or a clock would break that on the
 * second call. It is taken from the PAYLOAD, which is the document's whole
 * model-side statement of itself, so two files with the same id are two files
 * with the same drawing — and the fixed `ff` stem keeps it a legal CSS id
 * selector, which a bare hex hash starting with a digit would not be.
 *
 * FNV-1a because it is four lines and this is a name, not a checksum: nothing
 * is authenticated by it and nothing is looked up by it.
 */
function rootIdOf(payloadText: string, free: (id: string) => boolean): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < payloadText.length; i++) {
    h ^= payloadText.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const stem = `ff${(h >>> 8).toString(16).padStart(6, "0")}`;
  if (free(stem)) return stem;
  // A layer that happens to be named exactly this. Astronomically unlikely and
  // cheap to answer, and the answer has to be deterministic like everything
  // else here.
  for (let n = 2; n < 1000; n++) if (free(`${stem}-${n}`)) return `${stem}-${n}`;
  // Unreachable: `MAX_LAYERS` is 8192 and this asks 999 distinct questions of a
  // set that would have to contain every one of the answers.
  return `${stem}-x`;
}

/**
 * How wide the payload comment is allowed to get before it wraps.
 *
 * The payload used to be ONE LINE, and at depth 5 that line was 92 056
 * characters. A file this module spends 11% of its raw bytes indenting, on the
 * argument that a person can open it and read it, cannot also ship a line that
 * makes an editor hang — the two claims are the same claim and only one of them
 * was being kept.
 *
 * Nothing about the FORMAT has to change to fix it. `artfile.MARKER_HEAD`
 * already allows any run of whitespace after the version, `extractArt` finds
 * the end of the body with `indexOf("-->")` rather than with a line-anchored
 * pattern, and `JSON.parse` does not care where the whitespace between tokens
 * is. `test/emit.test.ts` checks all three rather than trusting them.
 *
 * ── Why 320 and not 110 ──────────────────────────────────────────────────
 *
 * Because a line break inside the payload is NOT free the way the markup's
 * indentation is, and the difference is large enough to change the answer. The
 * indentation sits between elements, where deflate was going to restart a match
 * anyway; a break inside the payload lands in the middle of the longest, most
 * repetitive run in the file — thousands of `[index,"#rrggbb"],` — and cuts one
 * match into two. Measured, depth 4, gzipped bytes against the same file with
 * every newline removed:
 *
 *   payload on one line   1.022      ← the markup indent alone
 *   wrapped at 110        1.103
 *   wrapped at 200        1.064
 *   wrapped at 320        1.045
 *   wrapped at 500        1.043
 *
 * The cost is per BREAK — about 4.6 gzipped bytes each at depth 4 — and not per
 * byte of whitespace, so aligning the breaks to the repeating unit does not
 * help and dropping the indent barely does; both were tried. Wrapping at 110
 * would have quintupled this module's entire readability tax to buy a payload
 * that is machine data either way, and would have broken the ≤5% ceiling the
 * test holds it to. 320 removes the failure that was actually reported — no
 * editor stalls on a 347-character line, and it wraps to three screen lines
 * rather than to a thousand — and keeps the invariant.
 */
const PAYLOAD_COLUMNS = 320;

/**
 * The payload comment, broken at commas that are not inside a JSON string.
 *
 * Only outside a string: a raw newline inside a JSON string literal is not
 * JSON, so wrapping anywhere else would produce a payload that no longer
 * parses. The scan tracks the same state `artfile.commentSafe` tracks, and for
 * the same reason.
 */
function wrapPayload(line: string): string {
  // Continuations line up under the `<!--` that opened the comment.
  const cont = `\n${INDENT}`;
  let out = "";
  let col = INDENT.length;
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    out += ch;
    col++;
    if (inString) {
      if (ch === "\\") {
        // An escape is two characters and neither can end the string.
        out += line[i + 1] ?? "";
        col++;
        i++;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "," && col >= PAYLOAD_COLUMNS) {
      out += cont;
      col = INDENT.length;
    }
  }
  return out;
}

// ── serialise ────────────────────────────────────────────────────────────

/** Every layer of a tree, parents before children, in paint order. */
function walkLayers(
  layers: readonly EmitLayer[],
  visit: (l: EmitLayer, depth: number) => void,
  depth = 0
): void {
  for (const l of layers) {
    visit(l, depth);
    if (l.children !== undefined) walkLayers(l.children, visit, depth + 1);
  }
}

/** The subtree rooted at `id`, or `null`. */
export function findLayer(
  layers: readonly EmitLayer[],
  id: string
): EmitLayer | null {
  for (const l of layers) {
    if (l.id === id) return l;
    if (l.children === undefined) continue;
    const hit = findLayer(l.children, id);
    if (hit !== null) return hit;
  }
  return null;
}

/**
 * The colouring the stack resolves to, later layers over earlier ones.
 *
 * HIDDEN SUBTREES ARE SKIPPED, because this is what the picture shows and the
 * picture does not show them. Their paint is still written into the payload —
 * hiding a layer must not delete it — so the flattened `cells` list and the
 * layer tree say different things on purpose, and each says the true one.
 */
export function flatten(layers: readonly EmitLayer[]): Map<number, string> {
  const out = new Map<number, string>();
  const rec = (list: readonly EmitLayer[]) => {
    for (const l of list) {
      if (l.hidden === true) continue;
      if (l.paint !== undefined) for (const [i, c] of l.paint) out.set(i, c);
      if (l.children !== undefined) rec(l.children);
    }
  };
  rec(layers);
  return out;
}

/**
 * The composition, or one layer of it, as an SVG document.
 *
 * Throws only for a caller error the program itself can make — an unknown layer
 * id, a cell that has to be drawn and has no geometry, or a child that reveals
 * before something it sits inside. Untrusted input goes the other way, through
 * `parse`, which never throws.
 *
 * ── WHY THE THIRD ONE IS A REFUSAL AND NOT A CLAMP ──────────────────────
 *
 * Because the clamp is the bug. A child revealing before its ancestor is held
 * back to the ancestor's time by the renderer — measured, 400 ms asked for and
 * 801 ms delivered, see `revealBreak` — so the file animates differently from
 * the document that wrote it and the number it disagrees with is sitting in its
 * own markup. Writing it and clamping it silently is the only available way to
 * lose that quietly, and this codebase's rule is that a decline is a counted
 * precondition and never a fallback.
 *
 * CHECKED ON THE SCOPED DOCUMENT, so a layer exported alone is checked as the
 * standalone composition it becomes — which is also the escape hatch: scoping to
 * the offending child drops the ancestor that gated it, and the export succeeds
 * because the thing it was lying about is no longer in the file.
 *
 * NOT GATED ON `doc.animation`, and that is the module's own argument rather
 * than a new one. `data-reveal` is written for a STILL export too, because "a
 * gesture's symmetry is a fact about the gesture and not about whether anything
 * is being played back" — see the header. A still export therefore states the
 * same reveal order, and a document that states an impossible one is not one to
 * write down whether or not this particular export animates it.
 *
 * NO EXISTING FILE BECOMES UNWRITABLE. The two producers in this repo are
 * `provenance.gestureLayers`, which puts the reveal on the GESTURE and leaves
 * the orbits under it with no time of their own, and `composer.emitLayersOf`,
 * which copies `Layer.reveal` one for one — and a `Layer` only ever acquires one
 * by IMPORT, because nothing in the editor mints reveals. `test/emit.test.ts`
 * measures the first of those directly. The one way to build a violating
 * document is to paste an imported low-reveal layer inside an imported
 * high-reveal one, which is exactly the case that used to animate wrongly.
 */
export function serialise(doc: EmitDoc, scope?: EmitScope): string {
  const scoped = scopeOf(doc, scope);

  const broken = revealBreak(scoped.layers);
  if (broken !== null) {
    throw new Error(
      `emit: layer ${broken.layer} reveals at step ${broken.reveal} but ` +
        `${broken.ancestor}, which contains it, reveals at ${broken.at} — a child ` +
        `cannot come up before the group that gates it`
    );
  }

  const shownSet = new Set(scoped.shown);
  const composite = flatten(scoped.layers);

  // Everything the document will draw, so the prototypes and the palette are
  // read off what is actually emitted and a scoped export carries neither a
  // shape nor a rule it does not use.
  const drawn: number[] = [];
  if (scoped.unpainted !== null) {
    for (const i of scoped.shown) if (!composite.has(i)) drawn.push(i);
  }
  const tiling = [...drawn];
  walkLayers(scoped.layers, (l) => {
    if (l.paint === undefined) return;
    for (const i of sortedKeys(l.paint)) if (shownSet.has(i)) drawn.push(i);
  });

  const geom = new Map<number, ArtCell>();
  for (const i of drawn) {
    const c = doc.cells.get(i);
    if (c === undefined) {
      throw new Error(`emit: cell ${i} is drawn but has no geometry`);
    }
    geom.set(i, c);
  }

  // ── prototypes ──
  // Seeded with every id the layer tree will write, so nothing minted below can
  // collide with one. See `prototypeId`.
  const layerIds = idsOf(scoped.layers);
  const protoOf = new Map<string, string>();
  const ids = new Set<string>(layerIds);
  for (const c of geom.values()) {
    const s = shapeOf(c).sig;
    if (protoOf.has(s)) continue;
    if (protoOf.size >= PROTOTYPE_LIMIT) {
      // Past the limit nothing is factored, so the ids stop mattering; the
      // count is still needed to reach the verdict.
      protoOf.set(s, "");
      continue;
    }
    const id = prototypeId(s, ids);
    ids.add(id);
    protoOf.set(s, id);
  }
  const factored = protoOf.size <= PROTOTYPE_LIMIT;
  const placed = new Map<number, Placed>();
  for (const [i, c] of geom) {
    const s = shapeOf(c);
    placed.set(i, {
      proto: factored ? (protoOf.get(s.sig) as string) : null,
      x: fmtCoord(s.ax),
      y: fmtCoord(s.ay),
      points: pointsOf(c),
    });
  }

  // ── palette ──
  const klass = new Map<string, string>();
  walkLayers(scoped.layers, (l) => {
    if (l.paint === undefined) return;
    for (const i of sortedKeys(l.paint)) {
      if (!shownSet.has(i)) continue;
      const c = l.paint.get(i) as string;
      if (!klass.has(c)) klass.set(c, `k${klass.size}`);
    }
  });

  const out: string[] = [];
  const w = fmtCoord(scoped.width);
  const h = fmtCoord(scoped.height);
  const payloadLine = encodeArt({ ...scoped.payload, comp: compositionOf(scoped) });
  const root = rootIdOf(payloadLine, (id) => !layerIds.has(id) && !layerIds.has(`${id}-t`));
  const titleId = `${root}-t`;
  // `role="img"` makes the six thousand `<use>` elements presentational in one
  // word, which is what they are. `aria-labelledby` names the picture off the
  // `<title>` rather than leaving the name to be computed from it: that
  // computation is in the spec and has been unreliable in Safari with
  // VoiceOver, and a file that ends up on someone else's screen is exactly the
  // case where "should work" is not enough. `lang` is on the root because the
  // title and the description below are English sentences.
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"` +
      ` id="${root}" role="img" lang="en" aria-labelledby="${titleId}">`
  );
  // No tag ever appears inside this line, even spelled out: the reader below
  // blanks comments before it tokenises, but a file is also read by eye and by
  // other people's tools, and a comment that looks like markup invites both to
  // guess.
  out.push(
    `${INDENT}<!-- FOURFOLD composition. Every cell is a congruent triangle: the shapes are ` +
      `named once in the defs block and each cell is one use of one of them at its own x and y. ` +
      `Colour is a CSS class, one rule per colour. Layers are nested groups. ` +
      `Self contained: no script, no external reference. -->`
  );
  out.push(`${INDENT}${wrapPayload(payloadLine)}`);
  out.push(`${INDENT}<title id="${titleId}">${escapeText(scoped.title)}</title>`);
  out.push(`${INDENT}<desc>${escapeText(descOf(scoped))}</desc>`);

  if (factored && protoOf.size > 0) {
    out.push(`${INDENT}<defs>`);
    for (const [sig, id] of protoOf) {
      out.push(`${INDENT.repeat(2)}<polygon id="${id}" points="${sig}"/>`);
    }
    out.push(`${INDENT}</defs>`);
  }

  const css = styleRules(scoped, klass, root);
  if (css.length > 0) {
    out.push(`${INDENT}<style>`);
    for (const rule of css) out.push(`${INDENT.repeat(2)}${rule}`);
    out.push(`${INDENT}</style>`);
  }

  out.push(
    `${INDENT}<rect width="${w}" height="${h}" fill="${colourSafe(scoped.background)}"/>`
  );

  const shapeAt = (i: number, cls: string, depth: number): string => {
    const p = placed.get(i) as Placed;
    const attr = cls === "" ? "" : ` class="${cls}"`;
    return p.proto === null
      ? `${INDENT.repeat(depth)}<polygon points="${p.points}"${attr}/>`
      : `${INDENT.repeat(depth)}<use href="#${p.proto}" x="${p.x}" y="${p.y}"${attr}/>`;
  };

  if (scoped.unpainted !== null) {
    out.push(`${INDENT}<g id="tiling" class="tile">`);
    for (const i of tiling) out.push(shapeAt(i, "", 2));
    out.push(`${INDENT}</g>`);
  }

  const seam =
    scoped.weldPaint || scoped.paintSeam === null
      ? ""
      : ` stroke="${colourSafe(scoped.paintSeam)}" stroke-width="${fmtCoord(
          scoped.seamWidth
        )}"`;
  out.push(`${INDENT}<g id="paint"${seam}>`);
  emitLayers(out, scoped.layers, shownSet, klass, shapeAt, 2);
  out.push(`${INDENT}</g>`);

  for (const g of scoped.overlay) {
    if (g.shapes.length === 0) continue;
    out.push(
      `${INDENT}<g class="wash" fill="${colourSafe(g.fill)}" opacity="${fmtAlpha(
        g.opacity
      )}">`
    );
    for (const shape of g.shapes) {
      out.push(
        `${INDENT.repeat(2)}<polygon points="${shape
          .map((v) => `${fmtCoord(v[0])},${fmtCoord(v[1])}`)
          .join(" ")}"/>`
      );
    }
    out.push(`${INDENT}</g>`);
  }

  out.push(`</svg>`);
  return out.join("\n");
}

const sortedKeys = (m: ReadonlyMap<number, string>): number[] =>
  [...m.keys()].sort((a, b) => a - b);

function emitLayers(
  out: string[],
  layers: readonly EmitLayer[],
  shown: ReadonlySet<number>,
  klass: ReadonlyMap<string, string>,
  shapeAt: (i: number, cls: string, depth: number) => string,
  depth: number
): void {
  for (const l of layers) {
    const attrs: string[] = [`id="${l.id}"`];
    if (l.name !== undefined) attrs.push(`data-name="${escapeAttr(l.name)}"`);
    // The layer's OWN flag, as a PRESENTATION ATTRIBUTE and not as
    // `style="display:none"`. The inline style is the highest-specificity form
    // there is and nothing but `!important` can answer it, which makes a
    // perfectly ordinary thing — un-hiding a layer in devtools, or restyling
    // the file from the page that embeds it — need a fight. The attribute sits
    // at the bottom of the cascade where a reader can override it, matches the
    // adjacent `opacity`, which was already written this way, and is six bytes
    // shorter.
    //
    // Nothing reads it back: `parse` takes `hidden` from the payload, where the
    // layer states its own. This is how the file DRAWS.
    if (l.hidden === true) attrs.push(`display="none"`);
    if (l.locked === true) attrs.push(`data-locked="1"`);
    if (l.opacity !== undefined && l.opacity !== 1) {
      attrs.push(`opacity="${fmtAlpha(l.opacity)}"`);
    }
    // The gesture, for a reader that is not this program. See the header.
    //
    // ABSENT, never defaulted and never empty: a `data-mode=""` on every group
    // would be the file claiming a symmetry for the plate itself, and a
    // `data-mode="1"` default would be indistinguishable from a real one-fold
    // stroke. And written whether or not `doc.animation` is set, because a
    // gesture's symmetry is a fact about the gesture rather than about playback.
    //
    // Nothing reads any of the three back out of the markup: `parse` takes them
    // from the payload, like every other flag. These are how the file EXPLAINS
    // itself to somebody else's tool.
    if (l.reveal !== undefined) attrs.push(`data-reveal="${l.reveal}"`);
    if (l.orbit !== undefined) attrs.push(`data-orbit="${l.orbit}"`);
    if (l.mode !== undefined) attrs.push(`data-mode="${l.mode}"`);
    out.push(`${INDENT.repeat(depth)}<g ${attrs.join(" ")}>`);
    if (l.paint !== undefined) {
      for (const i of sortedKeys(l.paint)) {
        if (!shown.has(i)) continue;
        out.push(shapeAt(i, klass.get(l.paint.get(i) as string) as string, depth + 1));
      }
    }
    if (l.children !== undefined) {
      emitLayers(out, l.children, shown, klass, shapeAt, depth + 1);
    }
    out.push(`${INDENT.repeat(depth)}</g>`);
  }
}

/**
 * What the file says it is, for a reader that is not looking at it.
 *
 * A `<title>` names the picture; a `<desc>` is where the sentence that would
 * otherwise only exist in the payload goes. Derived entirely from the document,
 * so it cannot drift from the drawing and so the round trip stays on bytes.
 */
function descOf(doc: EmitDoc): string {
  let layers = 0;
  walkLayers(doc.layers, () => {
    layers++;
  });
  const painted = flatten(doc.layers).size;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  return (
    `A FOURFOLD composition on the ${doc.payload.canvas} at depth ${doc.payload.depth}: ` +
    `${plural(painted, "painted cell")} in ${plural(layers, "layer")}, ` +
    `every cell one of two congruent triangles of the same lattice.`
  );
}

function styleRules(
  doc: EmitDoc,
  klass: ReadonlyMap<string, string>,
  root: string
): string[] {
  // Every selector below is scoped to this document's own id. See `rootIdOf`.
  const at = `#${root} `;
  const rules: string[] = [];
  if (doc.unpainted !== null) {
    const seam =
      doc.tileSeam === null
        ? ""
        : `; stroke: ${colourSafe(doc.tileSeam)}; stroke-width: ${fmtCoord(
            doc.seamWidth
          )}`;
    rules.push(`${at}.tile { fill: ${colourSafe(doc.unpainted)}${seam} }`);
  }
  for (const [colour, k] of klass) {
    // The weld — every painted cell stroked in its own fill, which closes the
    // sub-pixel join a run of same-coloured cells would otherwise show — costs
    // one word per RULE here where the polygon form costs two attributes per
    // CELL. It is where the class form pays best: 63% of the polygon file's raw
    // bytes against 83% for the same file written with fill attributes.
    const weld = doc.weldPaint
      ? `; stroke: ${colourSafe(colour)}; stroke-width: ${fmtCoord(doc.seamWidth * 3)}`
      : "";
    rules.push(`${at}.${k} { fill: ${colourSafe(colour)}${weld} }`);
  }
  if (doc.animation !== null) rules.push(...animationRules(doc, root));
  return rules;
}

/** How much wider than a hairline a weld stroke is. `strokes.WELD_WIDTH`. */
const WELD = 3;

/**
 * The reveal rules, cut to the in and out points when the document states them.
 *
 * ── Why the uncut file is byte for byte the file it always was ──────────
 *
 * `lo` and `hi` default to the ends, so every formula below reduces to the one
 * it replaced: the cycle is `(steps-1 - 0 + 1) · stepMs + holdMs`, which is
 * `steps · stepMs + holdMs`, and a keyframe sits at `(k - 0) · stepMs`, which is
 * `k · stepMs`. Nothing is written that was not written before.
 *
 * The two EXTRA rules are gated on the marks being present rather than on `k`
 * falling outside `lo … hi`, and that is not belt and braces. A document may
 * carry a reveal index past its own `steps` — nothing validates one against the
 * other, deliberately, because `steps` is the drawing's length and a reveal is a
 * layer's own statement — and such a layer animates today. Gating on the marks
 * keeps it animating, so this change cannot alter a file that never asked to be
 * cut.
 *
 * ── Why a cut layer keeps its markup ────────────────────────────────────
 *
 * Neither branch removes a `<g>` or a `data-*`. `data-reveal`, `data-mode` and
 * `data-orbit` are the record of what MADE the gesture and are written even for
 * a still export — see the header — so a file whose out point dropped the last
 * three strokes must still say that those three strokes were six-fold. The cut
 * is what the file DRAWS; the markup is what it MEANS.
 */
function animationRules(doc: EmitDoc, root: string): string[] {
  const a = doc.animation as EmitAnimation;
  // BOTH gated on the pair being whole, and not one defaulted per mark. A
  // half-stated pair — `in` with no `out`, which the payload refuses but an
  // in-memory document can still hold — took `lo = 2, hi = steps - 1` and
  // silently played a four-step cycle out of a six-step drawing that had asked
  // for no cut at all. `test/inout.test.ts` measured that; the pair is whole or
  // it does not exist.
  const bounded = a.in !== undefined && a.out !== undefined;
  const lo = bounded ? (a.in as number) : 0;
  const hi = bounded ? (a.out as number) : a.steps - 1;
  const cycle = Math.max(1, (hi - lo + 1) * a.stepMs + a.holdMs);
  const reveals = new Set<number>();
  walkLayers(doc.layers, (l) => {
    if (l.reveal !== undefined) reveals.add(l.reveal);
  });
  // Scoped, and the keyframe names carry the document id as a PREFIX because
  // `@keyframes` has one global namespace per document and `@scope` does not
  // change that. See `rootIdOf`.
  const at = `#${root} `;
  const rules: string[] = [
    `${at}[data-reveal] { opacity: 0; animation-duration: ${cycle}ms; ` +
      `animation-timing-function: linear; animation-iteration-count: infinite; ` +
      `animation-fill-mode: both }`,
  ];
  const order = [...reveals].sort((x, y) => x - y);
  const before = (k: number) => bounded && k < lo;
  const after = (k: number) => bounded && k > hi;
  for (const k of order) {
    // BEFORE THE IN POINT is the ground: up from the first frame, no animation
    // to run. AFTER THE OUT POINT is not shown at all; the base rule above
    // already left it at zero and this says so where a reader will look for it.
    // Same specificity as that rule and written after it, so both win.
    if (before(k)) {
      rules.push(`${at}[data-reveal="${k}"] { animation: none; opacity: 1 }`);
      continue;
    }
    if (after(k)) {
      rules.push(`${at}[data-reveal="${k}"] { animation: none; opacity: 0 }`);
      continue;
    }
    rules.push(`${at}[data-reveal="${k}"] { animation-name: ${root}-r${k} }`);
  }
  for (const k of order) {
    if (before(k) || after(k)) continue;
    // Rebased on the in point, so a drawing of a hundred gestures cut to five
    // plays a five-step cycle with the first of them lit at zero.
    const on0 = (k - lo) * a.stepMs;
    const on = (100 * on0) / cycle;
    const lit = (100 * Math.min(on0 + Math.max(1, a.fadeMs), cycle)) / cycle;
    // The first step reveals at 0, where `0%, 0%` would be a duplicate selector.
    const dark = on <= 0 ? "0%" : `0%, ${fmtAlpha(on)}%`;
    rules.push(
      `@keyframes ${root}-r${k} { ${dark} { opacity: 0 } ${fmtAlpha(lit)}%, 100% { opacity: 1 } }`
    );
  }
  // The app's own chrome honours this preference; the thing it EXPORTS — the
  // one that ends up on somebody else's screen, with no settings panel and no
  // way to stop it — did not. An infinite loop is exactly what the preference
  // is about, so the finished plate is what a reader who asked for less motion
  // gets: every layer up, nothing moving.
  //
  // "The finished plate" is the plate AT THE OUT POINT when there is one, so
  // the layers the cut drops are held down inside this block too. Without that
  // line the preference would quietly restore three strokes the author had cut
  // — a reduced-motion reader would be the only one seeing a different drawing,
  // which is the one thing an accessibility rule must not do. Same specificity,
  // written after, so it wins.
  const cut = order.filter(after);
  rules.push(
    `@media (prefers-reduced-motion: reduce) { ${at}[data-reveal] ` +
      `{ animation: none; opacity: 1 }` +
      cut.map((k) => ` ${at}[data-reveal="${k}"] { opacity: 0 }`).join("") +
      ` }`
  );
  return rules;
}

/**
 * The document a scope names.
 *
 * A layer scope produces a STANDALONE COMPOSITION — same canvas, same
 * coordinates, one layer in the stack — rather than a fragment, so that pasting
 * it is the same operation as loading it and the round trip is the same round
 * trip. The tiling is dropped, because a copied layer is the layer and not the
 * grid behind it, and `shown` narrows to the cells that subtree paints.
 *
 * `plate` is dropped from the payload: it is the WHOLE model's address plate at
 * every depth, and a subtree does not own it. `relief` and `view` are kept —
 * they describe the pixels the layer was drawn at, which are the pixels being
 * copied.
 */
function scopeOf(doc: EmitDoc, scope: EmitScope): EmitDoc {
  if (scope === undefined) return doc;
  const root = findLayer(doc.layers, scope.layer);
  if (root === null) throw new Error(`emit: no layer ${scope.layer}`);
  const own = flattenAll([root]);
  const shown = doc.shown.filter((i) => own.has(i));
  const visible = flatten([root]);
  const cells: [number, string][] = [];
  for (const i of shown) {
    const c = visible.get(i);
    if (c !== undefined) cells.push([i, c]);
  }
  const payload = { ...doc.payload };
  delete payload.plate;
  return {
    ...doc,
    shown,
    unpainted: null,
    layers: [root],
    overlay: [],
    payload: { ...payload, cells },
  };
}

/** Every cell any layer of the tree paints, hidden ones included. */
function flattenAll(layers: readonly EmitLayer[]): Set<number> {
  const out = new Set<number>();
  walkLayers(layers, (l) => {
    if (l.paint !== undefined) for (const i of l.paint.keys()) out.add(i);
  });
  return out;
}

function compositionOf(doc: EmitDoc): ArtComposition {
  const anim: ArtAnimation | undefined =
    doc.animation === null
      ? undefined
      : {
          stepMs: doc.animation.stepMs,
          holdMs: doc.animation.holdMs,
          fadeMs: doc.animation.fadeMs,
          steps: doc.animation.steps,
          // BOTH OR NEITHER, and last, so a document with no in and out points
          // writes the same four keys in the same order it always wrote them
          // and the bytes are unchanged. `artfile`'s validator builds the same
          // object in the same order, which is what keeps the re-encode exact.
          ...(doc.animation.in === undefined || doc.animation.out === undefined
            ? {}
            : { in: doc.animation.in, out: doc.animation.out }),
        };
  return {
    shown: formatRanges(doc.shown),
    ...(anim === undefined ? {} : { anim }),
    layers: doc.layers.map(toArtLayer),
  };
}

/**
 * Key order here MUST match `artfile`'s validator, because a payload is
 * re-encoded from what the validator returned and the round trip is on bytes.
 */
function toArtLayer(l: EmitLayer): ArtLayer {
  const out: ArtLayer = { id: l.id };
  if (l.name !== undefined) out.name = l.name;
  if (l.hidden === true) out.hidden = true;
  if (l.locked === true) out.locked = true;
  if (l.opacity !== undefined && l.opacity !== 1) out.opacity = l.opacity;
  if (l.reveal !== undefined) out.reveal = l.reveal;
  if (l.mode !== undefined) out.mode = l.mode;
  if (l.orbit !== undefined) out.orbit = l.orbit;
  if (l.paint !== undefined && l.paint.size > 0) {
    out.cells = sortedKeys(l.paint).map(
      (i) => [i, l.paint?.get(i) as string] as [number, string]
    );
  }
  if (l.children !== undefined && l.children.length > 0) {
    out.children = l.children.map(toArtLayer);
  }
  return out;
}

// ── parse ────────────────────────────────────────────────────────────────

/** One `<g>`, `<use>` or `<polygon>` the reader met, with its attribute text. */
interface Token {
  kind: "open" | "close" | "shape";
  tag: string;
  attrs: string;
}

/**
 * Every `<g>`, `<use>` and `<polygon>` in a document, open or close.
 *
 * `(?=[\s/>])` rather than `\b` after the name. A word boundary sits between
 * `g` and `:`, so `<g:x id="ghost">` — an element in some other namespace,
 * which this reader has no business believing anything about — came through as
 * a group with an id, and one of those left unclosed walks the layer stack.
 * The lookahead says what was meant: the tag name ENDS here.
 */
const TOKEN = /<(\/?)(g|use|polygon)(?=[\s/>])([^>]*?)(\/?)>/g;

/**
 * The document with every comment and every CDATA section blanked out.
 *
 * Neither is markup, and anything that reads markup has to agree: this file's
 * own header comment names the elements it uses, and a hostile file could hide
 * an unbalanced `<g>` in one and walk the reader's stack off the end. CDATA is
 * the same hole with a different spelling — `<![CDATA[ <g id="ghost"> ]]>` is
 * character data to every parser and was elements to this one.
 *
 * Replaced with spaces rather than removed so that offsets into the document
 * are unchanged and the two texts stay comparable.
 */
const withoutComments = (text: string): string =>
  text.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g, (m) => " ".repeat(m.length));

/**
 * An SVG document this module wrote, back as the value it was written from.
 *
 * `null` for: anything that is not a string, anything past `MAX_ART_BYTES`, a
 * document with no payload or a payload this build will not vouch for, a
 * document with no layer composition in that payload, markup that nests past
 * `MAX_LAYER_DEPTH`, a `<use>` naming a prototype the file does not define, a
 * layer whose drawn cells do not line up with what the payload says it paints,
 * a layer that reveals before something it sits inside (`revealBreak`), and
 * anything that makes the reader throw. It throws for nothing.
 *
 * The payload is the AUTHORITY for which cells and which layers. The markup
 * supplies the picture: the shapes, the colours, the seams and the frame. So a
 * file whose markup has been tampered with either fails the count checks and is
 * refused, or differs only in pixels the payload does not claim.
 */
export function parse(text: string): EmitDoc | null {
  try {
    return read(text);
  } catch {
    // Unreachable by construction — every branch below returns rather than
    // throws — and kept because "returns null for hostile input" is a promise
    // this module makes to a drop handler, and a promise with an exception
    // escaping through it is not one.
    return null;
  }
}

function read(text: string): EmitDoc | null {
  if (typeof text !== "string") return null;
  if (text.length === 0 || text.length > MAX_ART_BYTES) return null;

  const payload = extractArt(text);
  if (payload === null || payload.comp === undefined) return null;
  const comp = payload.comp;
  // The composition is lifted OUT of the payload and into `layers`, so there is
  // one place a layer lives and the two cannot drift.
  const rest: Omit<ArtPayload, "comp"> & { comp?: ArtComposition } = { ...payload };
  delete rest.comp;

  // Everything below reads MARKUP, so it reads the document with the comments
  // taken out — including the payload comment, which has already been read and
  // whose contents must not be able to look like an element.
  const markup = withoutComments(text);

  // FOUND rather than anchored, and found in the MARKUP rather than in the
  // text. Anchoring at offset zero made this reader refuse every file that had
  // been through a standard SVG toolchain — an XML declaration, a BOM, a
  // DOCTYPE or one leading newline was enough, so a FOURFOLD file opened in
  // Inkscape and saved again would not load. Searching the comment-blanked
  // text rather than the raw text is what keeps that safe: a `<svg` written
  // inside the payload — in a layer's name, say — has already been blanked, so
  // the first one found is the real root and not one somebody smuggled.
  const head = /<svg(?=[\s/>])([^>]*?)\/?>/.exec(markup);
  if (head === null) return null;
  const width = num(attrOf(head[1], "width"));
  const height = num(attrOf(head[1], "height"));
  if (width === null || height === null) return null;

  // `<title>` now carries an id, for `aria-labelledby`.
  const titleAt = /<title(?=[\s>])[^>]*>([\s\S]{0,4096}?)<\/title>/.exec(markup);
  const title = titleAt === null ? "" : unescapeAttr(titleAt[1]);

  // ── prototypes ──
  const protos = readProtos(markup);
  if (protos === null) return null;

  // ── style ──
  const styleAt = /<style(?=[\s>])[^>]*>([\s\S]{0,1048576}?)<\/style>/.exec(markup);
  const style = styleAt === null ? "" : styleAt[1];
  let unpainted: string | null = null;
  let tileSeam: string | null = null;
  let seamWidth = 0;
  const tile = TILE_RULE.exec(style);
  if (tile !== null) {
    unpainted = tile[1];
    if (tile[2] !== undefined) {
      tileSeam = tile[2];
      const w = num(tile[3]);
      if (w === null) return null;
      seamWidth = w;
    }
  }
  const colourOf = new Map<string, string>();
  let weldPaint = false;
  PAINT_RULE.lastIndex = 0;
  for (let m = PAINT_RULE.exec(style); m !== null; m = PAINT_RULE.exec(style)) {
    colourOf.set(m[1], m[2]);
    if (m[3] !== undefined) {
      weldPaint = true;
      const w = num(m[4]);
      if (w === null) return null;
      if (tile === null || tile[2] === undefined) seamWidth = w / WELD;
    }
  }

  const rect = /<rect(?=[\s/>])([^>]*?)\/?>/.exec(markup);
  const fill = rect === null ? null : attrOf(rect[1], "fill");
  const background = fill === null || fill.length > 64 ? "none" : fill;

  // ── the drawing ──
  const body = readBody(markup);
  if (body === null) return null;

  const shown =
    comp.shown === undefined
      ? Array.from({ length: cellCount(payload.canvas, payload.depth) }, (_, i) => i)
      : parseRanges(comp.shown, cellCount(payload.canvas, payload.depth));
  if (shown === null) return null;
  const shownSet = new Set(shown);

  const layers = fromArtLayers(comp.layers);
  // THE WHOLE FILE, REFUSED, on the same rule as every other disagreement here:
  // the payload is the authority, and a payload that states a reveal order the
  // renderer cannot honour is a file that would draw something other than what
  // it says. `artfile.ts` validates each `reveal` as a whole non-negative step
  // in ISOLATION and cannot see this, because it is a relation BETWEEN two
  // layers and the validator walks one at a time. So it is checked here, where
  // the tree exists. `serialise` refuses the same document; see `revealBreak`
  // for the browser measurement that makes it a refusal rather than a clamp.
  if (revealBreak(layers) !== null) return null;
  const composite = flatten(layers);

  const cells = new Map<number, ArtCell>();
  const place = (i: number, s: Shape): boolean => {
    const verts = resolve(s, protos);
    if (verts === null) return false;
    cells.set(i, { verts });
    return true;
  };

  // The tiling, in the order it was written: every framed cell the visible
  // stack does not paint, ascending.
  if (body.tiling !== null) {
    const want: number[] = [];
    for (const i of shown) if (!composite.has(i)) want.push(i);
    if (want.length !== body.tiling.length) return null;
    for (let k = 0; k < want.length; k++) if (!place(want[k], body.tiling[k])) return null;
  } else if (unpainted !== null) {
    // A `.tile` rule with nothing to apply it to. Harmless in a renderer and a
    // disagreement here, so it is refused rather than half-believed.
    return null;
  }

  const paintSeam = body.paintSeam;
  if (body.paintSeamWidth !== null && !weldPaint) seamWidth = body.paintSeamWidth;

  if (!matchLayers(layers, body.layers, shownSet, place)) return null;

  const overlay: ArtOverlayGroup[] = [];
  for (const g of body.overlay) {
    const shapes: [number, number][][] = [];
    for (const s of g.shapes) {
      if (s.points === null) return null;
      const verts = readPoints(s.points);
      if (verts === null) return null;
      shapes.push(verts);
    }
    overlay.push({ fill: g.fill, opacity: g.opacity, shapes });
  }

  const animation: EmitAnimation | null =
    comp.anim === undefined
      ? null
      : {
          stepMs: comp.anim.stepMs,
          holdMs: comp.anim.holdMs,
          fadeMs: comp.anim.fadeMs,
          steps: comp.anim.steps,
          // The validator has already refused a half-stated pair, so these are
          // both present or both absent by the time they get here.
          ...(comp.anim.in === undefined || comp.anim.out === undefined
            ? {}
            : { in: comp.anim.in, out: comp.anim.out }),
        };

  return {
    width,
    height,
    cells,
    shown,
    background,
    unpainted,
    tileSeam,
    paintSeam,
    seamWidth,
    weldPaint,
    title,
    layers,
    overlay,
    animation,
    payload: rest,
  };
}

/**
 * The one spelling of a number this reader accepts.
 *
 * `Number` is not a validator, and every place it was used as one had an
 * answer for something that is not a number at all. `Number("")` is 0, so
 * `width="" height=""` was a canvas 0 by 0 rather than a refusal.
 * `Number("0x10")` is 16 and `Number("6.04e2")` is 604, neither of which is a
 * length SVG would accept in an attribute, so a hostile file could put a cell
 * somewhere no reader of the same file would draw it. `Infinity`, `NaN` and
 * ` 12 ` all had answers too.
 *
 * This is what this module WRITES — `strokes.fmtCoord` and `fmtAlpha` both emit
 * exactly this form and nothing else — so requiring it costs nothing that was
 * ever produced and refuses everything that was not.
 */
const NUMBER = /^-?\d{1,17}(?:\.\d{1,17})?$/;

const num = (raw: string | null): number | null => {
  if (raw === null) return null;
  const t = raw.trim();
  if (!NUMBER.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/**
 * Where a `.tile` and a `.k…` rule are found in the stylesheet.
 *
 * The optional `#id ` in front is the SCOPE `serialise` writes — every selector
 * it emits sits under this document's own id, so that inlining the file cannot
 * restyle the page around it. See `rootIdOf`. Tolerated rather than required,
 * so that a file written before the scope existed still reads.
 */
const SCOPE = String.raw`(?:#[A-Za-z][\w-]{0,31}\s+)?`;
const RULE = String.raw`\s*\{\s*fill:\s*([^;}]+?)\s*(?:;\s*stroke:\s*([^;}]+?)\s*;\s*stroke-width:\s*([^;}\s]+)\s*)?\}`;
const TILE_RULE = new RegExp(`${SCOPE}\\.tile${RULE}`);
const PAINT_RULE = new RegExp(`${SCOPE}\\.(k\\d{1,5})${RULE}`, "g");

/** What a `<defs>` prototype may be called. */
const PROTO_ID = /^[A-Za-z][\w.-]{0,15}$/;

/**
 * Whether a group hides everything under it.
 *
 * Both spellings, because this module writes the attribute and used to write
 * the inline style, and a file from anywhere else may use either.
 */
const DISPLAY_NONE = /(?:^|;)\s*display\s*:\s*none\s*(?:;|$)/i;

const isHidden = (attrs: string): boolean => {
  if (attrOf(attrs, "display") === "none") return true;
  const style = attrOf(attrs, "style");
  return style !== null && DISPLAY_NONE.test(style);
};

/**
 * The shapes `<defs>` names, for both readers below.
 *
 * A DUPLICATE ID IS A REFUSAL. Two `<polygon id="u">` used to mean the second
 * one, because the loop wrote it over the first — while a browser resolves
 * `href="#u"` to the FIRST, so the file this reader loaded and the file a
 * renderer drew were different pictures and neither said so. The document has
 * one answer per id or it is not a document we can vouch for.
 */
function readProtos(markup: string): Map<string, [number, number][]> | null {
  const protos = new Map<string, [number, number][]>();
  const defs = /<defs(?=[\s>])[^>]*>([\s\S]{0,8192}?)<\/defs>/.exec(markup);
  if (defs === null) return protos;
  const re = /<polygon(?=[\s/>])([^>]*?)\/?>/g;
  for (let m = re.exec(defs[1]); m !== null; m = re.exec(defs[1])) {
    const id = attrOf(m[1], "id");
    const points = attrOf(m[1], "points");
    // A shape in `<defs>` with no id is not a prototype; nothing can name it.
    // Neither is one named something this module would never write, or one
    // longer than a triangle needs — both are somebody else's furniture and are
    // stepped over rather than refused, exactly as the pattern this replaced
    // stepped over them. A `<use>` that then names one still fails to resolve.
    if (id === null || points === null) continue;
    if (!PROTO_ID.test(id) || points.length > 256) continue;
    // The one thing that IS a refusal, because it is an ambiguity rather than
    // an unknown.
    if (protos.has(id)) return null;
    const verts = readPoints(points);
    if (verts === null) return null;
    protos.set(id, verts);
  }
  return protos;
}

/** A shape as the markup states it: a placed prototype, or its own points. */
interface Shape {
  proto: string | null;
  x: number;
  y: number;
  points: string | null;
}

function resolve(
  s: Shape,
  protos: ReadonlyMap<string, [number, number][]>
): [number, number][] | null {
  if (s.proto === null) return s.points === null ? null : readPoints(s.points);
  const base = protos.get(s.proto);
  if (base === undefined) return null;
  return base.map((v) => [v[0] + s.x, v[1] + s.y] as [number, number]);
}

function readPoints(raw: string): [number, number][] | null {
  const toks = raw
    .trim()
    .split(/[\s,]+/)
    .filter((t) => t.length > 0);
  if (toks.length < 6 || toks.length % 2 !== 0 || toks.length > 512) return null;
  // `NUMBER` rather than `Number`, for the reason set out there: a vertex at
  // `0x10` is a vertex no renderer of the same file would agree with.
  const nums: number[] = [];
  for (const t of toks) {
    if (!NUMBER.test(t)) return null;
    const n = Number(t);
    if (!Number.isFinite(n)) return null;
    nums.push(n);
  }
  const out: [number, number][] = [];
  for (let i = 0; i < nums.length; i += 2) out.push([nums[i], nums[i + 1]]);
  return out;
}

/** A `<g>` of the layer tree, as the markup states it. */
interface MarkupLayer {
  id: string;
  shapes: Shape[];
  children: MarkupLayer[];
}

interface Body {
  tiling: Shape[] | null;
  paintSeam: string | null;
  paintSeamWidth: number | null;
  layers: MarkupLayer[];
  overlay: { fill: string; opacity: number; shapes: Shape[] }[];
}

/**
 * The three top-level groups, walked with a stack rather than a DOM.
 *
 * One pass of one regex over the document, so a hostile file costs a fixed
 * number of steps per tag rather than backtracking; the depth cap is what stops
 * a file made of a million `<g>`s from becoming a million-deep tree.
 */
function readBody(text: string): Body | null {
  const body: Body = {
    tiling: null,
    paintSeam: null,
    paintSeamWidth: null,
    layers: [],
    overlay: [],
  };
  const stack: MarkupLayer[] = [];
  /** Which top-level group we are inside: none, the tiling, the paint, a wash. */
  let region: "" | "tiling" | "paint" | "wash" = "";
  let wash: { fill: string; opacity: number; shapes: Shape[] } | null = null;
  let depth = 0;

  TOKEN.lastIndex = 0;
  for (let m = TOKEN.exec(text); m !== null; m = TOKEN.exec(text)) {
    const tok: Token = {
      kind: m[1] === "/" ? "close" : m[4] === "/" ? "shape" : "open",
      tag: m[2],
      attrs: m[3],
    };
    if (tok.tag !== "g") {
      // `<use …/>` and `<use …></use>` are the SAME ELEMENT. This reader used
      // to take only the self-closed spelling, which is the one it writes, so a
      // file that had been through a tool preferring the long form lost every
      // cell — and lost them silently, as a count that no longer lined up.
      // `</use>` and `</polygon>` say nothing and are skipped.
      if (tok.kind === "close") continue;
      const shape = shapeToken(tok);
      if (shape === null) return null;
      if (region === "tiling") (body.tiling as Shape[]).push(shape);
      else if (region === "wash" && wash !== null) wash.shapes.push(shape);
      else if (region === "paint" && stack.length > 0) {
        stack[stack.length - 1].shapes.push(shape);
      }
      // A shape outside every group is furniture — the defs' own prototypes —
      // and is not part of the drawing.
      continue;
    }

    if (tok.kind === "close") {
      if (depth === 0) return null;
      depth -= 1;
      if (region === "paint" && stack.length > 0) {
        const done = stack.pop() as MarkupLayer;
        if (stack.length > 0) stack[stack.length - 1].children.push(done);
        else body.layers.push(done);
        if (stack.length === 0 && depth === 0) region = "";
        continue;
      }
      if (depth === 0) {
        if (region === "wash" && wash !== null) {
          body.overlay.push(wash);
          wash = null;
        }
        region = "";
      }
      continue;
    }

    if (tok.kind !== "open") continue;
    depth += 1;
    if (depth > MAX_LAYER_DEPTH + 1) return null;
    if (stack.length > MAX_LAYERS) return null;

    if (depth === 1) {
      const id = attrOf(tok.attrs, "id");
      const cls = attrOf(tok.attrs, "class");
      if (id === "tiling") {
        if (body.tiling !== null) return null;
        body.tiling = [];
        region = "tiling";
        continue;
      }
      if (id === "paint") {
        body.paintSeam = attrOf(tok.attrs, "stroke");
        body.paintSeamWidth = num(attrOf(tok.attrs, "stroke-width"));
        region = "paint";
        continue;
      }
      if (cls === "wash") {
        const fill = attrOf(tok.attrs, "fill");
        const opacity = num(attrOf(tok.attrs, "opacity"));
        if (fill === null || opacity === null) return null;
        wash = { fill, opacity, shapes: [] };
        region = "wash";
        continue;
      }
      region = "";
      continue;
    }

    if (region !== "paint") continue;
    const id = attrOf(tok.attrs, "id");
    if (id === null || !LAYER_ID.test(id) || RESERVED_IDS.has(id)) return null;
    stack.push({ id, shapes: [], children: [] });
  }

  if (depth !== 0 || stack.length !== 0) return null;
  return body;
}

function shapeToken(tok: Token): Shape | null {
  if (tok.tag === "use") {
    const href = attrOf(tok.attrs, "href");
    if (href === null || href[0] !== "#") return null;
    const x = num(attrOf(tok.attrs, "x"));
    const y = num(attrOf(tok.attrs, "y"));
    if (x === null || y === null) return null;
    return { proto: href.slice(1), x, y, points: null };
  }
  if (tok.tag !== "polygon") return null;
  const points = attrOf(tok.attrs, "points");
  if (points === null) return null;
  return { proto: null, x: 0, y: 0, points };
}

function fromArtLayers(list: readonly ArtLayer[]): EmitLayer[] {
  return list.map((l) => {
    const out: EmitLayer = { id: l.id };
    if (l.name !== undefined) out.name = l.name;
    if (l.hidden === true) out.hidden = true;
    if (l.locked === true) out.locked = true;
    if (l.opacity !== undefined) out.opacity = l.opacity;
    if (l.reveal !== undefined) out.reveal = l.reveal;
    if (l.mode !== undefined) out.mode = l.mode;
    if (l.orbit !== undefined) out.orbit = l.orbit;
    if (l.cells !== undefined) out.paint = new Map(l.cells);
    if (l.children !== undefined) out.children = fromArtLayers(l.children);
    return out;
  });
}

/**
 * Pair the payload's layers with the markup's, and take the geometry off the
 * markup.
 *
 * The k-th shape inside a `<g>` is the k-th cell that layer paints AND FRAMES,
 * which is the order `serialise` wrote them in. That is what lets a cell cost
 * an `x` and a `y` and nothing else: the index is stated once, in the payload,
 * rather than repeated on every element. A count that does not line up is a
 * file whose picture and payload disagree, and it is refused rather than
 * half-read.
 */
function matchLayers(
  model: readonly EmitLayer[],
  markup: readonly MarkupLayer[],
  shown: ReadonlySet<number>,
  place: (i: number, s: Shape) => boolean
): boolean {
  if (model.length !== markup.length) return false;
  for (let k = 0; k < model.length; k++) {
    const m = model[k];
    const g = markup[k];
    if (m.id !== g.id) return false;
    const want =
      m.paint === undefined ? [] : sortedKeys(m.paint).filter((i) => shown.has(i));
    if (want.length !== g.shapes.length) return false;
    for (let n = 0; n < want.length; n++) {
      if (!place(want[n], g.shapes[n])) return false;
    }
    if (!matchLayers(m.children ?? [], g.children, shown, place)) return false;
  }
  return true;
}

// ── grafting a parsed subtree ────────────────────────────────────────────

/**
 * The same tree with every id made unique against `taken`.
 *
 * NOT a layer operation — it moves nothing and reorders nothing. It is what
 * makes a PARSED subtree safe to hand to a layer model: a pasted composition
 * arrives carrying the ids it was written with, and those ids are `id="…"` in
 * the target's markup, where two of anything is a document that no longer says
 * what it means. `parse` cannot do this itself, because it does not know what
 * the target already holds; the caller does, and this is the one line it needs.
 *
 * Deterministic: `base`, `base-2`, `base-3`, and the suffix is stripped from an
 * id that already carries one so pasting the same thing four times gives four
 * ids rather than one with four suffixes. An id that cannot be made to fit
 * `LAYER_ID` is replaced outright rather than mangled.
 */
export function rekey(
  layers: readonly EmitLayer[],
  taken: ReadonlySet<string>
): EmitLayer[] {
  const used = new Set(taken);
  let anon = 0;
  const fresh = (id: string): string => {
    const base = /^(.*?)-\d{1,4}$/.exec(id)?.[1] ?? id;
    const seed = LAYER_ID.test(base) && !RESERVED_IDS.has(base) ? base : `layer${anon++}`;
    if (!used.has(seed) && !RESERVED_IDS.has(seed)) {
      used.add(seed);
      return seed;
    }
    for (let n = 2; n < 10000; n++) {
      const c = `${seed}-${n}`;
      if (!used.has(c) && c.length <= 64) {
        used.add(c);
        return c;
      }
    }
    // Unreachable while `taken` is finite and ids are bounded; a thrown error
    // here would be a paste that silently dropped a layer instead.
    throw new Error("emit: cannot find a free layer id");
  };
  const rec = (list: readonly EmitLayer[]): EmitLayer[] =>
    list.map((l) => ({
      ...l,
      id: fresh(l.id),
      ...(l.children === undefined ? {} : { children: rec(l.children) }),
    }));
  return rec(layers);
}

/** Every id a tree uses, for the caller that is about to `rekey` against it. */
export function idsOf(layers: readonly EmitLayer[]): Set<string> {
  const out = new Set<string>();
  walkLayers(layers, (l) => out.add(l.id));
  return out;
}

// ── reading a foreign file's geometry ────────────────────────────────────

/**
 * Every filled shape in a document, with `<use>` resolved against `<defs>`.
 *
 * `artfile.importByGeometry` matches a file cell by cell against the canvas and
 * only looks at `<polygon>` elements carrying a fill of their own — which is
 * exactly right for a file `artworkSvg` wrote and finds NOTHING in one this
 * module wrote, where the shape is a `<use>` and the fill is a class. This is
 * the missing half: it resolves both, so a file in this format still has a
 * geometric fallback when its payload has been stripped.
 *
 * `null` on the same terms as `parse`: too big, or markup it cannot follow.
 */
export function resolvedShapes(
  text: string
): { verts: [number, number][]; fill: string }[] | null {
  if (typeof text !== "string" || text.length > MAX_ART_BYTES) return null;
  const markup = withoutComments(text);
  const protos = readProtos(markup);
  if (protos === null) return null;
  const fills = new Map<string, string>();
  const styleAt = /<style(?=[\s>])[^>]*>([\s\S]{0,1048576}?)<\/style>/.exec(markup);
  if (styleAt !== null) {
    const re = /\.([\w-]{1,32})\s*\{\s*fill:\s*([^;}]+?)\s*[;}]/g;
    for (let m = re.exec(styleAt[1]); m !== null; m = re.exec(styleAt[1])) {
      fills.set(m[1], m[2]);
    }
  }
  const out: { verts: [number, number][]; fill: string }[] = [];
  // A group's own fill cascades to the shapes inside it, which is how the
  // tiling states its colour once. Tracked with a stack, so a nested layer
  // inherits what its ancestors said and nothing more.
  const inherited: (string | null)[] = [null];
  // And so is HIDDENNESS, on the same stack and for a sharper reason. `flatten`
  // skips a hidden subtree because the picture does not show it; this did not,
  // so a hidden layer's cells came back here — and, being written last, won the
  // painter's-algorithm race in `artfile.importByGeometry`. A geometric import
  // of a file with a hidden layer over a visible one recoloured cells to a
  // colour the picture had never shown.
  const dark: boolean[] = [false];
  TOKEN.lastIndex = 0;
  for (let m = TOKEN.exec(markup); m !== null; m = TOKEN.exec(markup)) {
    const close = m[1] === "/";
    const selfClose = m[4] === "/";
    const tag = m[2];
    const attrs = m[3];
    if (tag === "g") {
      if (close) {
        if (inherited.length > 1) {
          inherited.pop();
          dark.pop();
        }
        continue;
      }
      if (selfClose) continue;
      const cls = attrOf(attrs, "class");
      const own =
        attrOf(attrs, "fill") ??
        (cls === null ? null : (fills.get(cls) ?? null));
      inherited.push(own ?? inherited[inherited.length - 1]);
      dark.push(dark[dark.length - 1] || isHidden(attrs));
      continue;
    }
    if (close) continue;
    if (dark[dark.length - 1]) continue;
    const cls = attrOf(attrs, "class");
    const fill =
      attrOf(attrs, "fill") ??
      (cls === null ? null : (fills.get(cls) ?? null)) ??
      inherited[inherited.length - 1];
    if (fill === null) continue;
    const shape = shapeToken({ kind: "shape", tag, attrs });
    if (shape === null) continue;
    // A prototype in `<defs>` carries an id and no fill; it is the shape, not a
    // use of it, and counting it would put a triangle at the origin.
    if (shape.proto === null && attrOf(attrs, "id") !== null) continue;
    const verts = resolve(shape, protos);
    if (verts === null) continue;
    out.push({ verts, fill });
  }
  return out;
}
