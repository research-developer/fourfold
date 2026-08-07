/**
 * Importing an SVG as a layer — with its sublayers, its own flags, and its
 * provenance — and refusing one that cannot be trusted.
 *
 * The claim under test is narrow and load-bearing: a composition that leaves
 * this program as a file and comes back is the SAME COMPOSITION, not a picture
 * of it. Sublayers are still sublayers, a hidden parent is still the only thing
 * hidden, and a subtree pasted onto a document that already holds its ids is
 * renamed rather than merged.
 *
 * Everything here goes through `emit.serialise` / `emit.parse`, which is the
 * path a dropped file actually takes, rather than through the payload validator
 * on its own — a file is refused or accepted as a WHOLE, and the two halves of
 * it (payload and markup) have to agree before anything is loaded.
 */

import { describe, expect, it } from "vitest";
import {
  ART_MARKER,
  MAX_LAYERS,
  MAX_LAYER_DEPTH,
  RESERVED_IDS,
} from "../src/lib/artfile";
import {
  findLayer,
  flatten,
  idsOf,
  opaquelyCovered,
  parse,
  parseWhy,
  refusalSaid,
  rekey,
  serialise,
  type EmitDoc,
  type EmitLayer,
  type EmitRefusal,
} from "../src/lib/emit";
import { buildHexagon } from "../src/lib/hexagon";
import { plateFrame } from "../src/lib/view";
import { addressBook } from "../src/lib/plate";
import { emitLayersOf } from "../src/lib/composer";
import {
  layerId,
  setOpacity,
  strata,
  type Composition,
  type Stratum,
} from "../src/lib/layers";
import { artworkSvg } from "../src/lib/strokes";

// ── fixtures ─────────────────────────────────────────────────────────────

const DEPTH = 2;
const hex = buildHexagon(DEPTH);
const frame = plateFrame(hex, { mode: "hexagon", sector: 0 });
const BOOK = addressBook(hex);
const GEOMETRY = new Map(frame.cells.map((c, i) => [i, { verts: c.verts }]));

const PALETTE = ["#d4a017", "#c0392b", "#2e86c1", "#7d3c98", "#1e8449"];

/** A few cells of the frame, spaced so no two layers fight over one. */
function paintOf(every: number, offset: number): Map<number, string> {
  const out = new Map<number, string>();
  for (let k = offset; k < frame.shown.length; k += every) {
    out.set(frame.shown[k], PALETTE[(k * 3) % PALETTE.length]);
  }
  return out;
}

function docOf(layers: readonly EmitLayer[]): EmitDoc {
  return {
    width: frame.width,
    height: frame.height,
    cells: GEOMETRY,
    shown: frame.shown,
    background: "#0a0908",
    unpainted: "#141110",
    tileSeam: "rgba(236,230,220,.16)",
    paintSeam: "rgba(0,0,0,.3)",
    seamWidth: 0.7,
    weldPaint: false,
    title: "FOURFOLD — import",
    layers,
    overlay: [],
    animation: { stepMs: 150, holdMs: 400, fadeMs: 50, steps: 3 },
    payload: {
      version: 1,
      canvas: "hexagon",
      depth: DEPTH,
      convention: "apex",
      cells: [...flatten(layers).entries()].sort((a, b) => a[0] - b[0]),
    },
  };
}

/**
 * Three levels, with every flag the format carries set somewhere in the tree.
 *
 * Deliberately not symmetrical: each flag sits on exactly one layer, so a round
 * trip that moved a flag from one layer to another — or resolved it down the
 * tree — fails rather than accidentally agreeing.
 */
const nested = (): EmitLayer[] => [
  {
    id: "ground",
    name: "ground",
    paint: paintOf(5, 0),
    reveal: 0,
    mode: 6,
    orbit: 6,
  },
  {
    id: "root",
    name: "a pasted composition",
    locked: true,
    paint: paintOf(7, 1),
    reveal: 1,
    mode: 12,
    orbit: 6,
    children: [
      {
        id: "kid",
        name: "one gesture",
        opacity: 0.42,
        paint: paintOf(11, 2),
        reveal: 2,
        mode: 6,
        orbit: 3,
        children: [
          { id: "gkid", name: "one orbit", paint: paintOf(13, 3), mode: 6, orbit: 3 },
          { id: "gkid2", name: "another", hidden: true, paint: paintOf(17, 4) },
        ],
      },
    ],
  },
];

/** The whole tree, flag by flag, in a form `toEqual` can compare. */
const shapeOf = (list: readonly EmitLayer[]): unknown =>
  list.map((l) => ({
    id: l.id,
    name: l.name,
    hidden: l.hidden,
    locked: l.locked,
    opacity: l.opacity,
    reveal: l.reveal,
    mode: l.mode,
    orbit: l.orbit,
    paint: [...(l.paint ?? [])].sort((a, b) => a[0] - b[0]),
    children: l.children === undefined ? undefined : shapeOf(l.children),
  }));

// ── the tree survives the file ───────────────────────────────────────────

describe("an SVG imports as a layer with its sublayers", () => {
  it("brings a three-level tree back with its shape and every own flag", () => {
    const before = nested();
    const back = parse(serialise(docOf(before)));
    expect(back).not.toBeNull();
    expect(shapeOf((back as EmitDoc).layers)).toEqual(shapeOf(before));
  });

  it("keeps the nesting rather than flattening it", () => {
    const back = parse(serialise(docOf(nested()))) as EmitDoc;
    const root = findLayer(back.layers, "root") as EmitLayer;
    expect(root.children).toHaveLength(1);
    const kid = root.children?.[0] as EmitLayer;
    expect(kid.id).toBe("kid");
    expect(kid.children?.map((c) => c.id)).toEqual(["gkid", "gkid2"]);
    // Order is paint order and is part of the meaning, so it is asserted rather
    // than assumed: a set of the same ids would pass a weaker test.
    expect(back.layers.map((l) => l.id)).toEqual(["ground", "root"]);
  });

  it("carries the provenance fields down every level", () => {
    const back = parse(serialise(docOf(nested()))) as EmitDoc;
    const kid = findLayer(back.layers, "kid") as EmitLayer;
    expect({ reveal: kid.reveal, mode: kid.mode, orbit: kid.orbit }).toEqual({
      reveal: 2,
      mode: 6,
      orbit: 3,
    });
    const gkid = findLayer(back.layers, "gkid") as EmitLayer;
    // A layer may state a symmetry and no reveal: an orbit inside a gesture is
    // revealed by the gesture, not on its own.
    expect(gkid.reveal).toBeUndefined();
    expect({ mode: gkid.mode, orbit: gkid.orbit }).toEqual({ mode: 6, orbit: 3 });
  });

  it("re-exports to the same bytes, so an import is not an edit", () => {
    const text = serialise(docOf(nested()));
    const back = parse(text) as EmitDoc;
    expect(serialise(back)).toBe(text);
  });
});

// ── own flags, never resolved ones ───────────────────────────────────────

describe("a hidden parent does not poison its children", () => {
  it("leaves every child's OWN hidden flag alone through a round trip", () => {
    const open = nested();
    const shut = nested();
    (shut[1] as { hidden?: boolean }).hidden = true;

    const back = parse(serialise(docOf(shut))) as EmitDoc;
    const root = findLayer(back.layers, "root") as EmitLayer;
    expect(root.hidden).toBe(true);
    // The children said nothing about their own visibility and still say
    // nothing. Writing the RESOLVED flag would have marked all three hidden,
    // and no amount of un-hiding the parent would bring them back.
    expect(findLayer(back.layers, "kid")?.hidden).toBeUndefined();
    expect(findLayer(back.layers, "gkid")?.hidden).toBeUndefined();
    // Except the one that really was hidden on its own, which stays hidden.
    expect(findLayer(back.layers, "gkid2")?.hidden).toBe(true);

    // The proof that nothing was lost: un-hide the parent in the imported
    // document and the picture is the picture the un-hidden original drew.
    const reopened = back.layers.map((l) =>
      l.id === "root" ? { ...l, hidden: undefined } : l
    );
    expect([...flatten(reopened)].sort()).toEqual([...flatten(open)].sort());
  });

  it("hides in the markup without hiding in the payload", () => {
    const shut = nested();
    (shut[1] as { hidden?: boolean }).hidden = true;
    const text = serialise(docOf(shut));
    // One `display="none"`, on the parent. The renderer hides the subtree; the
    // file does not.
    expect(text.match(/display="none"/g)).toHaveLength(2); // root, and gkid2
    expect(text).toMatch(/id="root"[^>]*display="none"/);
    expect(text).not.toMatch(/id="kid"[^>]*display="none"/);
    // And the hidden subtree's paint is still in the file, or hiding a layer
    // would be deleting it.
    const back = parse(text) as EmitDoc;
    expect(findLayer(back.layers, "kid")?.paint?.size).toBe(
      (shut[1].children?.[0].paint as Map<number, string>).size
    );
  });

  it("keeps a locked layer's lock and an opacity that is not 1", () => {
    const back = parse(serialise(docOf(nested()))) as EmitDoc;
    expect(findLayer(back.layers, "root")?.locked).toBe(true);
    expect(findLayer(back.layers, "kid")?.opacity).toBe(0.42);
    // Unset stays unset rather than becoming a default that then round trips as
    // an explicit one.
    expect(findLayer(back.layers, "ground")?.locked).toBeUndefined();
    expect(findLayer(back.layers, "ground")?.opacity).toBeUndefined();
  });
});

// ── grafting a parsed subtree ────────────────────────────────────────────

/** The copy flow: export one layer on its own, then read it back. */
function copyOut(doc: EmitDoc, layer: string): EmitLayer[] {
  const back = parse(serialise(doc, { layer }));
  expect(back).not.toBeNull();
  return (back as EmitDoc).layers as EmitLayer[];
}

describe("rekey makes a pasted subtree safe to graft", () => {
  it("renames every colliding id and moves nothing", () => {
    const doc = docOf(nested());
    const copied = copyOut(doc, "root");
    expect(copied.map((l) => l.id)).toEqual(["root"]);

    const taken = idsOf(doc.layers);
    const fresh = rekey(copied, taken);

    // Every id is new, and the old ones are untouched in the target.
    const minted = idsOf(fresh);
    for (const id of minted) expect(taken.has(id)).toBe(false);
    expect(minted.size).toBe(idsOf(copied).size);

    // Nothing else moved: same order, same nesting, same names, same paint.
    const strip = (list: readonly EmitLayer[]): unknown =>
      list.map((l) => ({
        name: l.name,
        mode: l.mode,
        orbit: l.orbit,
        paint: [...(l.paint ?? [])].sort((a, b) => a[0] - b[0]),
        children: l.children === undefined ? undefined : strip(l.children),
      }));
    expect(strip(fresh)).toEqual(strip(copied));
  });

  it("numbers the suffixes base, base-2, base-3 — the claim in the comment", () => {
    const one: EmitLayer[] = [{ id: "band" }];
    expect(rekey(one, new Set())[0].id).toBe("band");
    expect(rekey(one, new Set(["band"]))[0].id).toBe("band-2");
    expect(rekey(one, new Set(["band", "band-2"]))[0].id).toBe("band-3");
    expect(rekey(one, new Set(["band", "band-2", "band-3"]))[0].id).toBe("band-4");
    // Deterministic: the same subtree against the same target gives the same
    // ids, which is what makes a paste reproducible rather than merely unique.
    expect(rekey(one, new Set(["band"]))[0].id).toBe(
      rekey(one, new Set(["band"]))[0].id
    );
  });

  it("does not stack suffixes when the same subtree is pasted four times", () => {
    const source: EmitLayer[] = [{ id: "band", children: [{ id: "row" }] }];
    let taken = new Set<string>();
    const got: string[][] = [];
    for (let n = 0; n < 4; n++) {
      const fresh = rekey(source, taken);
      got.push([...idsOf(fresh)]);
      taken = new Set([...taken, ...idsOf(fresh)]);
    }
    expect(got).toEqual([
      ["band", "row"],
      ["band-2", "row-2"],
      ["band-3", "row-3"],
      ["band-4", "row-4"],
    ]);
    // The suffix is STRIPPED before a new one is chosen, so nothing ever
    // becomes `band-2-2`. That is the property the comment claims, and it is
    // what keeps an id bounded under repeated pasting.
    for (const ids of got) for (const id of ids) expect(id).not.toMatch(/-\d+-\d+$/);
  });

  it("replaces an id the markup could never carry, rather than mangling it", () => {
    const bad: EmitLayer[] = [{ id: "9 not a name" }, { id: "paint" }];
    const fresh = rekey(bad, new Set());
    for (const l of fresh) {
      expect(l.id).toMatch(/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/);
      expect(RESERVED_IDS.has(l.id)).toBe(false);
    }
    expect(fresh[0].id).not.toBe(fresh[1].id);
  });

  it("grafts the renamed subtree into the target, and the file still loads", () => {
    const doc = docOf(nested());
    const copied = copyOut(doc, "root");
    const fresh = rekey(copied, idsOf(doc.layers));

    // Pasted ONTO a layer: the target's own child list grows by the subtree,
    // which is the operation that makes a composition nest by one.
    const grafted: EmitLayer[] = [
      { ...doc.layers[0], children: [...(doc.layers[0].children ?? []), ...fresh] },
      doc.layers[1],
    ];
    const text = serialise(docOf(grafted));
    const back = parse(text);
    expect(back).not.toBeNull();
    expect(shapeOf((back as EmitDoc).layers)).toEqual(shapeOf(grafted));
    // Four levels now, and every id in the document is still distinct.
    const ids = idsOf((back as EmitDoc).layers);
    let count = 0;
    const walk = (list: readonly EmitLayer[]) => {
      for (const l of list) {
        count += 1;
        if (l.children !== undefined) walk(l.children);
      }
    };
    walk((back as EmitDoc).layers);
    expect(ids.size).toBe(count);
  });
});

// ── the limits are refusals ──────────────────────────────────────────────

/** A chain `n` layers deep, painting one cell at the bottom. */
function chain(n: number): EmitLayer[] {
  let node: EmitLayer = {
    id: `d${n}`,
    paint: new Map([[frame.shown[0], PALETTE[0]]]),
  };
  for (let k = n - 1; k >= 1; k--) node = { id: `d${k}`, children: [node] };
  return [node];
}

describe("depth and count are refused loudly, not truncated", () => {
  it("carries a tree exactly MAX_LAYER_DEPTH deep", () => {
    const deep = chain(MAX_LAYER_DEPTH);
    const back = parse(serialise(docOf(deep)));
    expect(back).not.toBeNull();
    let node = (back as EmitDoc).layers[0];
    let depth = 1;
    while (node.children !== undefined && node.children.length > 0) {
      node = node.children[0];
      depth += 1;
    }
    expect(depth).toBe(MAX_LAYER_DEPTH);
    expect(node.paint?.size).toBe(1);
  });

  it("refuses one level deeper, whole", () => {
    const text = serialise(docOf(chain(MAX_LAYER_DEPTH + 1)));
    // The document was WRITTEN — the limit is on what may be read back, because
    // the reader is what recurses over untrusted input.
    expect(text).toContain(`id="d${MAX_LAYER_DEPTH + 1}"`);
    expect(parse(text)).toBeNull();
  });

  it("carries exactly MAX_LAYERS layers, and refuses one more", () => {
    const flat = (n: number): EmitLayer[] =>
      Array.from({ length: n }, (_, k) => ({ id: `L${k}` }));

    const ok = parse(serialise(docOf(flat(MAX_LAYERS))));
    expect(ok).not.toBeNull();
    expect((ok as EmitDoc).layers).toHaveLength(MAX_LAYERS);

    expect(parse(serialise(docOf(flat(MAX_LAYERS + 1))))).toBeNull();
  });
});

// ── a hostile file is refused whole ──────────────────────────────────────

/**
 * The payload, unwrapped and edited, put back into the document.
 *
 * `wrapPayload` breaks the JSON across lines at commas OUTSIDE strings, so
 * removing every newline-and-indent run is safe and gives one line to edit. The
 * markup is left exactly as it was, which is the point: these are files whose
 * two halves have been made to disagree.
 */
function tamper(text: string, edit: (json: string) => string): string {
  const at = new RegExp(`<!--\\s*${ART_MARKER}:1\\s+([\\s\\S]*?)-->`).exec(text);
  if (at === null) throw new Error("no payload to tamper with");
  const flat = at[1].replace(/\n\s*/g, "").trim();
  return text.replace(at[0], `<!-- ${ART_MARKER}:1 ${edit(flat)} -->`);
}

describe("a malformed or hostile file is refused rather than half-read", () => {
  const clean = () => serialise(docOf(nested()));

  it("still reads a file the harness has only unwrapped, so the refusals below are real", () => {
    // The control. Without it every assertion in this block could be passing
    // because `tamper` breaks the document, not because the edit does.
    const back = parse(tamper(clean(), (j) => j));
    expect(back).not.toBeNull();
    expect(shapeOf((back as EmitDoc).layers)).toEqual(shapeOf(nested()));
  });

  const hostile: [string, (t: string) => string][] = [
    ["no payload at all", (t) => t.replace(/<!--[\s\S]*?-->/g, "")],
    [
      // The PAYLOAD's own close, not the first `-->` in the file: the human
      // comment above it closes first, and deleting that one merely nests the
      // payload inside it, which every reader here still handles correctly.
      "a payload that never closes",
      (t) => {
        const at = t.indexOf(ART_MARKER);
        return t.slice(0, at) + t.slice(at).replace("-->", "");
      },
    ],
    [
      "a version this build does not speak",
      (t) => t.replace(`${ART_MARKER}:1`, `${ART_MARKER}:2`),
    ],
    ["a payload that is not JSON", (t) => tamper(t, (j) => j.slice(0, j.length - 12))],
    [
      "a layer named after the document's own furniture",
      (t) => tamper(t, (j) => j.replace('"id":"kid"', '"id":"paint"')),
    ],
    [
      "two layers with one id",
      (t) => tamper(t, (j) => j.replace('"id":"gkid2"', '"id":"gkid"')),
    ],
    [
      "an opacity outside 0…1",
      (t) => tamper(t, (j) => j.replace('"opacity":0.42', '"opacity":42')),
    ],
    [
      "a negative brush mode",
      (t) => tamper(t, (j) => j.replace('"mode":12', '"mode":-12')),
    ],
    [
      "a reveal that is not a whole step",
      (t) => tamper(t, (j) => j.replace('"reveal":1', '"reveal":1.5')),
    ],
    [
      "a cell index the canvas cannot hold",
      (t) => tamper(t, (j) => j.replace('"cells":[[', '"cells":[[99999,"#ffffff"],[')),
    ],
    [
      // Inside the PAINT region, so the count that fails is a layer's own and
      // not the tiling's — the picture and the payload disagree about how many
      // cells one layer holds, which is the check that makes the payload the
      // authority and the markup its witness.
      "markup with a cell taken out of a layer",
      (t) => {
        const at = t.indexOf('<g id="paint"');
        return t.slice(0, at) + t.slice(at).replace(/\n\s*<use [^\n]*\/>/, "");
      },
    ],
    [
      "markup with a cell taken out of the tiling",
      (t) => t.replace(/\n\s*<use [^\n]*\/>/, ""),
    ],
    [
      "markup with a group the payload does not know about",
      (t) => t.replace('<g id="ground"', '<g id="ghost"></g><g id="ground"'),
    ],
    ["a group left open", (t) => t.replace("</svg>", '<g id="dangling"></svg>')],
  ];

  for (const [what, wreck] of hostile) {
    it(`refuses ${what}`, () => {
      const bad = wreck(clean());
      expect(bad).not.toBe(clean());
      expect(() => parse(bad)).not.toThrow();
      expect(parse(bad)).toBeNull();
    });
  }

  it("refuses what is not a document at all, and never throws", () => {
    const rubbish: unknown[] = [
      "",
      "<svg></svg>",
      "not markup",
      "<!-- fourfold:art:1 -->",
      null,
      undefined,
      42,
      {},
    ];
    for (const r of rubbish) {
      expect(() => parse(r as string)).not.toThrow();
      expect(parse(r as string)).toBeNull();
    }
  });
});

// ── the review findings ──────────────────────────────────────────────────

/**
 * A REFUSED COMPOSITION MUST BE TOLD APART FROM AN OLD DRAWING.
 *
 * `parse` had fifteen ways to answer `null` and its caller treated all fifteen as
 * the one that means "no layer tree" — so a file that DID carry a history and was
 * refused arrived as a single flat layer holding the finished plate, announced as
 * a successful paste. `parseWhy` is the split, and `"no-composition"` is the only
 * member a caller may fall back on.
 */
describe("a refusal names its reason", () => {
  it("a file with a composition the reader will not vouch for is not `no-composition`", () => {
    // The Inkscape round trip in miniature: the markup's tiling no longer agrees
    // with what the payload leaves unpainted, which is one of the count checks a
    // foreign editor trips by rewriting the <defs>/<use> structure.
    const text = serialise(docOf(nested()));
    const broken = text.replace(/<g id="tiling"[\s\S]*?<\/g>/, '<g id="tiling"></g>');
    const got = parseWhy(broken);
    expect(got.ok).toBe(false);
    if (got.ok) return;
    // THE WHOLE POINT: not the one reason the legacy fallback is allowed for.
    expect(got.why).not.toBe("no-composition");
    expect(got.why).toBe("tiling-count");
    // And it is a sentence a person can act on rather than a field name.
    expect(refusalSaid(got.why)).toMatch(/tiles/);
  });

  it("a payload with no composition IS `no-composition`, and that one may fall back", () => {
    // What every drawing written before layers existed looks like: one flat
    // polygon document with a payload that states cells and no `comp`.
    const n = Math.max(...frame.shown) + 1;
    const flat = Array.from({ length: n }, (_, i) => GEOMETRY.get(i) ?? { verts: [] });
    const text = artworkSvg({
      width: frame.width,
      height: frame.height,
      cells: flat,
      shown: frame.shown,
      paint: new Map([[frame.shown[0], "#c0392b"]]),
      background: "#0a0908",
      unpainted: "#141110",
      tileSeam: "rgba(236,230,220,.16)",
      paintSeam: "rgba(0,0,0,.3)",
      weldPaint: false,
      seamWidth: 0.7,
      title: "FOURFOLD",
      payload: {
        version: 1,
        canvas: "hexagon",
        depth: DEPTH,
        convention: "apex",
        cells: [[frame.shown[0], "#c0392b"]],
      },
    });
    const got = parseWhy(text);
    expect(got.ok).toBe(false);
    if (got.ok) return;
    expect(got.why).toBe("no-composition");
  });

  it("`parse` still answers exactly what it always did", () => {
    const text = serialise(docOf(nested()));
    expect(parse(text)).not.toBeNull();
    const broken = text.replace(/<g id="tiling"[\s\S]*?<\/g>/, '<g id="tiling"></g>');
    expect(parse(broken)).toBeNull();
    expect(parse("")).toBeNull();
  });

  it("every refusal has a sentence, and none of them names a field", () => {
    const every: EmitRefusal[] = [
      "not-text", "no-payload", "no-composition", "not-svg", "prototypes",
      "style", "shown", "reveal-order", "markup", "tiling-count", "tile-rule",
      "shape", "layer-shapes", "overlay", "threw",
    ];
    for (const why of every) {
      const said = refusalSaid(why);
      expect(said.length).toBeGreaterThan(10);
      expect(said).not.toMatch(/undefined|null/);
    }
  });
});

/**
 * A TILE GOES BEHIND A FADED CELL, because the board puts one there.
 *
 * `serialise` asked `flatten` which cells the stack covered, and `flatten` has
 * never read `opacity`. So a cell under a half-transparent layer counted as
 * covered, got no tile, and composited onto the page background in the file where
 * it composites onto the tile on screen.
 */
describe("a faded layer does not eat the tile under it", () => {
  const cell = 0;
  const clear = (): EmitLayer[] => [{ id: "a", paint: new Map([[cell, "#c0392b"]]) }];
  const faded = (): EmitLayer[] => [
    { id: "a", opacity: 0.5, paint: new Map([[cell, "#c0392b"]]) },
  ];

  const tiles = (text: string): number =>
    (/<g id="tiling"[^>]*>([\s\S]*?)<\/g>/.exec(text)?.[1].match(/<use|<polygon/g) ?? [])
      .length;

  it("an opaque layer covers its cell and a faded one does not", () => {
    const opaque = tiles(serialise(docOf(clear())));
    const dim = tiles(serialise(docOf(faded())));
    // One more tile: the cell the faded layer paints now gets one too.
    expect(dim).toBe(opaque + 1);
    expect(dim).toBe(frame.shown.length);
  });

  it("the faded file still reads back, so writer and reader ask one question", () => {
    const text = serialise(docOf(faded()));
    const back = parse(text);
    expect(back).not.toBeNull();
    expect(serialise(back as EmitDoc)).toBe(text);
  });

  it("a fade on a PARENT reaches its children — alpha is inherited", () => {
    const two = [
      {
        id: "p",
        opacity: 0.5,
        children: [{ id: "c", paint: new Map([[cell, "#c0392b"]]) }],
      },
    ];
    // The child is opaque in itself and faded on the page, so it covers nothing.
    expect(opaquelyCovered(two).size).toBe(0);
    expect(tiles(serialise(docOf(two)))).toBe(frame.shown.length);
  });

  it("with no alpha anywhere it is `flatten`'s answer, key for key", () => {
    const layers = nested().map((l) => strip(l));
    expect([...opaquelyCovered(layers)].sort((a, b) => a - b)).toEqual(
      [...flatten(layers).keys()].sort((a, b) => a - b)
    );
  });

  /** The same tree with every alpha and every `hidden` taken off. */
  function strip(l: EmitLayer): EmitLayer {
    const out: EmitLayer = { ...l };
    delete out.opacity;
    delete out.hidden;
    if (l.children !== undefined) out.children = l.children.map(strip);
    return out;
  }
});

/**
 * A FADED LAYER'S ALPHA MUST NOT BE ON THE PROPERTY THE ANIMATION ANIMATES.
 *
 * `opacity="…"` is a presentation attribute and `#root [data-reveal] { opacity: 0
 * }` is a CSS declaration on the same element, so the alpha was overridden for
 * the whole animation and left there by `animation-fill-mode: both`.
 */
describe("a layer alpha survives an animated document", () => {
  it("keeps compositing `opacity`, and the reveal rule states the alpha", () => {
    const text = serialise(docOf(nested()));
    // The alpha is a COMPOSITING operation, so it stays on `opacity` — see
    // `emitLayers` for the Chromium measurement that sent `fill-opacity` back.
    expect(/<g id="kid"[^>]*\sopacity="0\.42"/.test(text)).toBe(true);
    expect(text).not.toMatch(/fill-opacity=/);
    // The one element carrying the alpha also carries a reveal — the hazard.
    expect(/<g id="kid"[^>]*data-reveal/.test(text)).toBe(true);
    // The generic rule still animates to 1 …
    expect(text).toMatch(/\[data-reveal="2"\] \{ animation-name: [\w-]+-r2 \}/);
    // … and the faded layer is pointed at its OWN keyframe, which ends at 0.42.
    expect(text).toMatch(/#kid \{ animation-name: [\w-]+-r2a420 \}/);
    expect(text).toMatch(/@keyframes [\w-]+-r2a420 \{[^}]*\}[^{]*\{ opacity: 0\.42 \}/);
    // Reduced motion must show the same picture minus the motion, not a flat one.
    expect(text).toMatch(/#kid \{ opacity: 0\.42 \}/);
  });

  it("an unfaded animated document emits not one extra rule", () => {
    const plain = nested().map(function drop(l): EmitLayer {
      const out: EmitLayer = { ...l };
      delete out.opacity;
      if (l.children !== undefined) out.children = l.children.map(drop);
      return out;
    });
    const text = serialise(docOf(plain));
    expect(text).not.toMatch(/opacity="0\./);
    // No alpha-suffixed keyframe, and nothing pointing at one — the suffix is
    // the only thing either the rule or the block gains, so its absence is the
    // whole claim. `test/byteidentity.test.ts` is the stronger check.
    expect(text).not.toMatch(/-r\d+a\d+/);
  });
});

/**
 * LOAD → SAVE MUST NOT REWRITE A LEGAL ALPHA.
 *
 * The validator range-checked and never quantised, while the markup writer
 * rounded to three decimals — one file, two alphas — and the model canonicalises
 * on load, so the re-saved file differed from the one that was opened.
 */
describe("an alpha is quantised on the way in, not on the way back out", () => {
  const withAlpha = (a: number): EmitLayer[] => [
    { id: "a", opacity: a, paint: new Map([[0, "#c0392b"]]) },
  ];

  it("the payload and the markup state the same number", () => {
    const text = serialise(docOf(withAlpha(0.1234567)));
    expect(text).toMatch(/\sopacity="0\.123"/);
    // The payload used to carry the unrounded value beside that attribute.
    expect(text).not.toMatch(/0\.1234567/);
  });

  it("a file that survives the reader re-serialises to itself", () => {
    const text = serialise(docOf(withAlpha(0.1234567)));
    const back = parse(text) as EmitDoc;
    expect(back).not.toBeNull();
    expect(serialise(back)).toBe(text);
    expect(findLayer(back.layers, "a")?.opacity).toBe(0.123);
  });
});

/**
 * THE BOARD AND THE FILE COMPOSITE A NESTED FADE THE SAME WAY.
 *
 * `DrawBoard` renders `strata` as nested `<g opacity>`, where a group's alpha is
 * a COMPOSITING operation and nesting MULTIPLIES — its header carries the
 * Chromium measurement and calls the flat alternative "cheaper, obvious, and
 * wrong". `emit.serialise` must therefore write the identical nesting, and for
 * one revision of this branch it did not: the alpha had been moved to
 * `fill-opacity` to escape the reveal stylesheet, and `fill-opacity` is an
 * INHERITED property — a child's declaration REPLACES the parent's.
 *
 * Re-measured in Chromium, red over white, at the moment of the fix:
 *
 *   two groups at 0.5, disjoint    nested `opacity` (255,191,191)
 *                                  nested `fill-opacity` (255,127,127)
 *   one cell, faded parent + child nested `opacity` (255,126,126)
 *                                  nested `fill-opacity` (255,114,63)
 *
 * The second pair is `DrawBoard`'s own measurement, reproduced. A browser cannot
 * run under `environment: "node"`, so what is asserted here is the STRUCTURE the
 * measurement turns on: same tree, same own-alphas, on the compositing property.
 * Get those right and the pixels follow; get them wrong and no assertion about
 * the pixels would have been written in the first place.
 */
describe("a nested fade composites the same on the board and in the file", () => {
  /** `<g id=… opacity=…>` nesting, as a tree of own-alphas. */
  const markupTree = (text: string): unknown => {
    const paint = /<g id="paint"[^>]*>([\s\S]*)<\/g>\s*<\/svg>/.exec(text);
    const body = paint === null ? "" : paint[1];
    const re = /<g id="([\w.-]+)"([^>]*)>|<\/g>/g;
    const root: { id: string; opacity: number; children: unknown[] }[] = [];
    const stack: { id: string; opacity: number; children: unknown[] }[] = [];
    for (let m = re.exec(body); m !== null; m = re.exec(body)) {
      if (m[1] === undefined) {
        if (stack.length > 0) stack.pop();
        continue;
      }
      const a = /\sopacity="([\d.]+)"/.exec(m[2]);
      const node = { id: m[1], opacity: a === null ? 1 : Number(a[1]), children: [] };
      if (stack.length === 0) root.push(node);
      else stack[stack.length - 1].children.push(node);
      stack.push(node);
    }
    return root;
  };

  /** The same tree off `layers.strata`, which is what the board renders. */
  const strataTree = (list: readonly Stratum[]): unknown =>
    list.map((s) => ({
      id: String(s.id),
      opacity: s.opacity,
      children: strataTree(s.children),
    }));

  it("the two trees of own-alphas are the same tree", () => {
    // A faded parent with a faded child — the shape `fill-opacity` got wrong,
    // and the shape this suite's own `nested()` fixture already has.
    //
    // BOTH HOLD PAINT, and that is not incidental: `layers.strata` prunes a
    // layer with no plate of its own, because an empty group draws nothing and a
    // group opacity costs an offscreen buffer. A paintless child would have made
    // the two trees differ for a reason that has nothing to do with compositing.
    const parent = layerId(1);
    const child = layerId(2);
    let comp: Composition = {
      layers: [
        {
          id: parent,
          name: "parent",
          plate: new Map([["s0:AA", "#c0392b"]]),
          children: [
            { id: child, name: "child", plate: new Map([["s0:BA", "#2e86c1"]]), children: [] },
          ],
        },
      ],
      selected: parent,
      nextId: 3,
      switches: new Map(),
    };
    comp = setOpacity(comp, parent, 0.5);
    comp = setOpacity(comp, child, 0.5);

    const board = strata(comp, BOOK);
    expect(board).not.toBeNull();
    const text = serialise(docOf(emitLayersOf(comp, BOOK) as EmitLayer[]));

    expect(markupTree(text)).toEqual(strataTree(board as readonly Stratum[]));
    // AND ON THE COMPOSITING PROPERTY. `fill-opacity` would satisfy the tree
    // comparison above and still draw a different picture, so the property is
    // asserted separately — it is the whole of what the measurement decided.
    expect(text).not.toMatch(/fill-opacity=/);
    expect(text).toMatch(/<g id="[\w.-]+"[^>]* opacity="0\.5">/);
    // Nested, not flattened: the child's group sits INSIDE the parent's.
    expect(text).toMatch(/<g id="L1"[^>]*opacity="0\.5">[\s\S]*<g id="L2"[^>]*opacity="0\.5">/);
  });
});
