/**
 * Preset plates: the figure's own structure, laid down as a drawing.
 *
 * Every colour here comes out of the model. Nothing is hand-placed and nothing
 * is approximated — a preset is a total function from the canvas's cells to the
 * palette `palette.ts` already publishes, and the drawing program applies it as
 * one ordinary undoable stroke through the address plate, so it survives a depth
 * change like any other paint.
 *
 * ZERO FLOAT. Charges are XOR words, orientations are parities, and the one
 * place two canvases have to be matched against each other is done by exact
 * integer key lookup.
 *
 * ── Why the two convention presets are not the same picture ──────────────
 *
 * A cell's charge is the XOR of its address's digit charges and its orientation
 * is the parity of the X's in that address, so BOTH are functions of the address
 * alone — and `plate.ts` notes that the address list is identical under the two
 * conventions. Read naively, that says the apex and ifs plates are the same
 * drawing, and they are not.
 *
 * What differs is which TRIANGLE an address denotes. `apex` gives every corner
 * child the parent's corner as its role-A vertex; `ifs` gives it the image of A
 * under the homothety. The four children are the same four triangles either way,
 * but from depth 2 the recursion hands them out in a different order, so the
 * word "AB" names a different triangle under each convention.
 *
 * So a convention preset is computed on the figure built at the convention it
 * NAMES, and matched onto the canvas on screen by exact integer key — the
 * barycentric centroid key on the triangle, the Eisenstein key on the hexagon.
 * The two figures cut the same triangles, so the match is a bijection and it
 * either succeeds everywhere or throws. Side by side, apex and ifs are two
 * genuinely different colourings of one tiling, which is the whole point of
 * offering both.
 *
 * ── The gasket ──────────────────────────────────────────────────────────
 *
 * The Sierpiński gasket in this figure is not an approximation of one: it is
 * exactly the cells whose address contains no X. Keeping the three corner
 * children and discarding the inverted centre, recursively, is the definition of
 * the gasket, and it is also the definition of "no X in the word". So the count
 * is 3^d of the 4^d cells — asserted here rather than trusted — and every one of
 * those cells is UPRIGHT, because orientation is the parity of the X count and a
 * word with no X has none. That is why the gasket reads as a clean self-similar
 * figure rather than as a speckle of two orientations.
 */

import { COSET_FILL, FILL } from "./palette";
import {
  buildFigure,
  H,
  type Charge,
  type Convention,
  type Figure,
} from "./figure";
import { buildHexagon, type Hexagon } from "./hexagon";
import { STEM, wordOf, type Address } from "./plate";
import { gasketAtDepth } from "./scale";
import type { CanvasKind } from "./orbit";

export type PresetName =
  | "charge-apex"
  | "charge-ifs"
  | "coset"
  | "sierpinski";

export const PRESET_NAMES: readonly PresetName[] = [
  "charge-apex",
  "charge-ifs",
  "coset",
  "sierpinski",
] as const;

export interface PresetInfo {
  name: PresetName;
  /** What the control says. */
  label: string;
  /** What the live region says, and what the hint under the control says. */
  note: string;
}

export const PRESETS: Readonly<Record<PresetName, PresetInfo>> = {
  "charge-apex": {
    name: "charge-apex",
    label: "V₄ apex",
    note:
      "every cell in its V₄ charge under the apex convention, bright upright and dark inverted — the canonical figure",
  },
  "charge-ifs": {
    name: "charge-ifs",
    label: "V₄ ifs",
    note:
      "the same charges under the ifs convention, which hands the same triangles out in a different order from depth 2 — the convention difference, drawn",
  },
  coset: {
    name: "coset",
    label: "coset",
    note:
      "two colours: H = {gold, purple} against its complementary coset {blue, red} — the one distinction every scoring rule uses",
  },
  sierpinski: {
    name: "sierpinski",
    label: "gasket",
    note:
      "the Sierpiński gasket — exactly the addresses with no X, three corner children kept and the inverted centre discarded, all the way down",
  },
};

const isHexagon = (canvas: Figure | Hexagon): canvas is Hexagon =>
  "base" in canvas;

const keyOf = (canvas: Figure | Hexagon, i: number): string =>
  isHexagon(canvas) ? canvas.cells[i].key.join(",") : canvas.cells[i].key.join(",");

/**
 * The figure the named convention would draw, indexed by exact key.
 *
 * Built fresh rather than derived from the canvas, because the canvas may be at
 * the OTHER convention and the whole content of these two presets is that the
 * two disagree. `buildFigure` and `buildHexagon` are pure and memo-free, and a
 * preset is a once-per-click operation, so the cost is a single pass.
 */
function conventionTable(
  canvas: Figure | Hexagon,
  convention: Convention
): { charge: Charge; eps: 0 | 1 }[] {
  const other = isHexagon(canvas)
    ? buildHexagon(canvas.depth, convention)
    : buildFigure(canvas.depth, convention);
  const byKey = new Map<string, { charge: Charge; eps: 0 | 1 }>();
  for (let i = 0; i < other.cells.length; i++) {
    byKey.set(keyOf(other, i), {
      charge: other.cells[i].charge,
      eps: other.cells[i].eps,
    });
  }
  return canvas.cells.map((_, i) => {
    const hit = byKey.get(keyOf(canvas, i));
    if (hit === undefined) {
      // Unreachable: the two conventions cut the same triangles, so the key sets
      // are equal. Kept because a miss would silently paint a permuted plate —
      // a drawing that was never made — which is the exact failure the header of
      // `page.tsx` refuses to let a LOAD commit.
      throw new Error(
        `presets: ${convention} has no cell at key ${keyOf(canvas, i)}`
      );
    }
    return hit;
  });
}

/** The addresses of the canvas, index-aligned. The same list `plate.ts` builds. */
function addressesOf(canvas: Figure | Hexagon): Address[] {
  return isHexagon(canvas)
    ? canvas.cells.map((c) => `s${c.sector}:${c.addr}`)
    : canvas.cells.map((c) => c.addr);
}

/**
 * The gasket, as cell indices.
 *
 * `3^d` on the triangle and `6·3^d` on the hexagon, where each sector is a copy
 * of the triangle and the gasket is taken per sector — the six copies meet only
 * at the shared apex, which no gasket cell occupies, so the union really is six
 * gaskets and not one figure with a seam.
 *
 * The count is ASSERTED. It is a claim about the figure rather than about this
 * loop, and if it ever stopped holding, either `buildFigure` or the reading of
 * the gasket as "no X in the word" is wrong and the caller should hear about it
 * before a plate is painted from it.
 */
export function gasketCells(canvas: Figure | Hexagon): number[] {
  const kind: CanvasKind = isHexagon(canvas) ? "hexagon" : "triangle";
  const stem = STEM[kind];
  const addr = addressesOf(canvas);
  const out: number[] = [];
  for (let i = 0; i < addr.length; i++) {
    if (!wordOf(addr[i], stem).includes("X")) out.push(i);
  }
  // NOT A SCALE, and the one count in this refactor that could not become one.
  // The gasket is the product of the UPRIGHT child counts, k(k+1)/2 per cut, and
  // that is not recoverable from the edge divisions alone once k varies — see
  // `scale.gasketAtDepth`. So this legitimately still takes a depth: depth
  // remains the NUMBER OF CUTS, which is a real quantity; what it stopped being
  // is a resolution.
  const want = (kind === "hexagon" ? 6 : 1) * gasketAtDepth(canvas.depth);
  if (out.length !== want) {
    throw new Error(
      `presets: the gasket on this ${kind} at depth ${canvas.depth} holds ` +
        `${out.length} cells, not ${want} = ${kind === "hexagon" ? "6·" : ""}3^${canvas.depth}`
    );
  }
  return out;
}

/**
 * The colour every cell of the canvas takes under a preset, index-aligned.
 *
 * `null` is bare — the gasket is the only preset that leaves anything bare, and
 * it leaves 4^d − 3^d cells that way, which is what makes the figure visible.
 *
 * `ink` is the colour the gasket is laid in. It is the only value here that does
 * not come out of `palette.ts`, and deliberately: the gasket's content is its
 * SHAPE, so it takes whatever colour the user has in hand and composes with the
 * colour controls instead of overriding them.
 */
export function presetColours(
  name: PresetName,
  canvas: Figure | Hexagon,
  ink: string
): (string | null)[] {
  if (name === "sierpinski") {
    const out = new Array<string | null>(canvas.cells.length).fill(null);
    for (const i of gasketCells(canvas)) out[i] = ink;
    return out;
  }

  if (name === "coset") {
    // The canvas's OWN charges: the coset view is a statement about the plate on
    // screen, and both conventions agree about it anyway — H-membership is a
    // function of the address, and the address list does not move.
    return canvas.cells.map(
      (c) => COSET_FILL[H.has(c.charge) ? "H" : "notH"][c.eps]
    );
  }

  const table = conventionTable(
    canvas,
    name === "charge-apex" ? "apex" : "ifs"
  );
  return table.map((t) => FILL[t.charge][t.eps]);
}

/**
 * How many cells a preset paints, and how many it leaves bare.
 *
 * Reported rather than asserted — except for the gasket, whose count IS the
 * claim and is checked in `gasketCells`.
 */
export function presetCensus(
  name: PresetName,
  canvas: Figure | Hexagon
): { painted: number; bare: number } {
  const colours = presetColours(name, canvas, "#000000");
  let painted = 0;
  for (const c of colours) if (c !== null) painted++;
  return { painted, bare: colours.length - painted };
}
