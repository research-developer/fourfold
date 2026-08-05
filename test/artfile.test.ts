import { describe, expect, it } from "vitest";
import {
  ART_MARKER,
  ART_VERSION,
  cellCount,
  encodeArt,
  extractArt,
  GEOMETRY_PRECISION,
  importByGeometry,
  MAX_DEPTH,
  MAX_LAYERS,
  normalizeHex,
  paintFromPayload,
  payloadFromPaint,
  payloadFromPlate,
  plateFromPayload,
  type ArtPayload,
} from "../src/lib/artfile";
import { buildFigure, type Convention } from "../src/lib/figure";
import { buildHexagon } from "../src/lib/hexagon";
import type { CanvasKind } from "../src/lib/orbit";
import {
  SCHEMES,
  SCHEME_NAMES,
  swatch,
  swatchFromHex,
  type Swatch,
} from "../src/lib/schemes";
import { artworkSvg, type ArtCell } from "../src/lib/strokes";

// ── fixtures ─────────────────────────────────────────────────────────────

const BASE: Swatch = swatchFromHex("#d4a017");

/**
 * Every colour the program can lay, in one plate.
 *
 * Walking the schemes rather than inventing hex strings is the point: the round
 * trip has to survive the colours the drawing program ACTUALLY produces,
 * including the analogous scheme's lightness fan, which is the one that does
 * not simply rotate a hue.
 */
function schemePlate(canvas: CanvasKind, depth: number): Map<number, string> {
  const n = cellCount(canvas, depth);
  const out = new Map<number, string>();
  let i = 0;
  for (const name of SCHEME_NAMES) {
    const s = SCHEMES[name];
    for (let k = 0; k < s.offsets.length && i < n; k++, i++) {
      out.set(i, s.at(BASE, k, s.offsets.length).hex);
    }
  }
  // A colour off the far end of the wheel and the two achromatic extremes, so
  // the `#000000` / `#ffffff` spellings are exercised too.
  for (const hex of ["#000000", "#ffffff", swatch(359.9, 1, 0.5).hex]) {
    if (i < n) out.set(i++, hex);
  }
  return out;
}

function geomCells(canvas: CanvasKind, depth: number, convention: Convention) {
  return canvas === "triangle"
    ? buildFigure(depth, convention)
    : buildHexagon(depth, convention);
}

function exportSvg(
  canvas: CanvasKind,
  depth: number,
  convention: Convention,
  paint: ReadonlyMap<number, string>,
  opts: { payload?: boolean; tiling?: boolean } = {}
): string {
  const fig = geomCells(canvas, depth, convention);
  return artworkSvg({
    width: fig.width,
    height: fig.height,
    cells: fig.cells as readonly ArtCell[],
    paint,
    background: "#0a0908",
    unpainted: opts.tiling === false ? null : "#201c19",
    tileSeam: "rgba(236,230,220,.16)",
    paintSeam: "rgba(10,9,8,.34)",
    seamWidth: 1.2,
    title: "FOURFOLD — test plate",
    payload:
      opts.payload === false
        ? undefined
        : payloadFromPaint(canvas, depth, convention, paint),
  });
}

const stripMarker = (svg: string) =>
  svg.replace(new RegExp(`<!--\\s*${ART_MARKER}:\\d+[\\s\\S]*?-->`), "");

// ── the round trip ───────────────────────────────────────────────────────

describe("export → extract → plate", () => {
  const cases: [CanvasKind, number][] = [
    ["triangle", 1],
    ["triangle", 3],
    ["triangle", 5],
    ["hexagon", 1],
    ["hexagon", 2],
    ["hexagon", 4],
  ];

  for (const [canvas, depth] of cases) {
    for (const convention of ["apex", "ifs"] as Convention[]) {
      it(`restores the plate exactly — ${canvas} d${depth} ${convention}`, () => {
        const paint = schemePlate(canvas, depth);
        const svg = exportSvg(canvas, depth, convention, paint);

        const back = extractArt(svg);
        expect(back).not.toBeNull();
        expect(back?.canvas).toBe(canvas);
        expect(back?.depth).toBe(depth);
        expect(back?.convention).toBe(convention);
        expect(back?.version).toBe(ART_VERSION);

        const restored = paintFromPayload(back as ArtPayload);
        expect(restored.size).toBe(paint.size);
        expect([...restored.entries()].sort((a, b) => a[0] - b[0])).toEqual(
          [...paint.entries()].sort((a, b) => a[0] - b[0])
        );
      });
    }
  }

  it("holds an empty plate as an empty plate", () => {
    const svg = exportSvg("hexagon", 2, "apex", new Map());
    const back = extractArt(svg);
    expect(back).not.toBeNull();
    expect(back?.cells).toEqual([]);
    expect(paintFromPayload(back as ArtPayload).size).toBe(0);
  });

  it("writes the cells ascending, whatever order the plate held them in", () => {
    const paint = new Map([
      [9, "#111111"],
      [2, "#222222"],
      [7, "#333333"],
    ]);
    const p = payloadFromPaint("triangle", 2, "apex", paint);
    expect(p.cells.map(([i]) => i)).toEqual([2, 7, 9]);
  });

  it("puts the payload immediately after the opening tag", () => {
    const svg = exportSvg("triangle", 1, "apex", new Map([[0, "#abcdef"]]));
    const head = svg.indexOf(">") + 1;
    expect(svg.slice(head).startsWith(`<!-- ${ART_MARKER}:${ART_VERSION} `)).toBe(
      true
    );
  });

  it("exports byte-identical bytes when no payload is asked for", () => {
    const paint = schemePlate("triangle", 2);
    const withOut = exportSvg("triangle", 2, "apex", paint, { payload: false });
    const withIn = exportSvg("triangle", 2, "apex", paint);
    expect(withOut).toBe(stripMarker(withIn));
    expect(extractArt(withOut)).toBeNull();
  });

  it("round-trips through the Swatch-shaped pair too", () => {
    const plate = new Map<number, Swatch>([
      [0, swatchFromHex("#d4a017")],
      [5, swatchFromHex("#0f7b6c")],
    ]);
    const p = payloadFromPlate("hexagon", 1, "apex", plate);
    const back = plateFromPayload(p);
    expect([...back.keys()]).toEqual([0, 5]);
    expect(back.get(0)).toEqual(plate.get(0));
    expect(back.get(5)).toEqual(plate.get(5));
  });
});

// ── the comment must stay a comment ──────────────────────────────────────

describe("comment safety", () => {
  it("never writes `--`, even when a field tries to", () => {
    const hostile: ArtPayload = {
      version: ART_VERSION,
      canvas: "triangle",
      depth: 2,
      convention: "apex",
      cells: [
        [0, "#aa--bb"],
        [1, "--> <script>alert(1)</script>"],
        [2, "-----"],
      ] as [number, string][],
    };
    const line = encodeArt(hostile);
    expect(line.slice(4, -3)).not.toContain("--");
    expect(line.endsWith("-->")).toBe(true);
    // The comment survived, so the payload can be found — and is then refused
    // on its merits rather than by having broken the document.
    expect(extractArt(`<svg>${line}</svg>`)).toBeNull();
  });

  it("escapes dashes reversibly", () => {
    const line = encodeArt({
      version: ART_VERSION,
      canvas: "hexagon",
      depth: 1,
      convention: "ifs",
      cells: [[0, "#a-b-c-"]] as [number, string][],
    });
    const body = line.slice(line.indexOf(" ", 5) + 1, -4);
    expect(JSON.parse(body).cells[0][1]).toBe("#a-b-c-");
  });

  it("a negative depth still cannot break the comment", () => {
    const line = encodeArt({
      version: ART_VERSION,
      canvas: "triangle",
      depth: -1,
      convention: "apex",
      cells: [[-1, "#000000"]] as [number, string][],
    });
    expect(line.slice(4, -3)).not.toContain("--");
    expect(extractArt(line)).toBeNull();
  });
});

// ── hostile input ────────────────────────────────────────────────────────

describe("extractArt is total", () => {
  const good = payloadFromPaint("triangle", 2, "apex", new Map([[3, "#d4a017"]]));
  const wrap = (json: string, version: number = ART_VERSION) =>
    `<svg xmlns="http://www.w3.org/2000/svg"><!-- ${ART_MARKER}:${version} ${json} --></svg>`;

  const hostile: [string, string][] = [
    ["an empty string", ""],
    ["no marker at all", "<svg><polygon points='0,0 1,1 2,2' fill='#fff'/></svg>"],
    ["a marker that never closes", `<svg><!-- ${ART_MARKER}:1 {"canvas":"triangle"`],
    ["malformed JSON", wrap('{"canvas":"triangle",,,}')],
    ["JSON that is not an object", wrap("[1,2,3]")],
    ["JSON null", wrap("null")],
    ["a bare number", wrap("42")],
    ["a wrong version", wrap(JSON.stringify(good), 2)],
    ["version zero", wrap(JSON.stringify(good), 0)],
    [
      "an unknown canvas",
      wrap(JSON.stringify({ ...good, canvas: "pentagon" })),
    ],
    [
      "an unknown convention",
      wrap(JSON.stringify({ ...good, convention: "spiral" })),
    ],
    ["a missing canvas", wrap(JSON.stringify({ depth: 2, cells: [] }))],
    ["a fractional depth", wrap(JSON.stringify({ ...good, depth: 2.5 }))],
    ["a depth of zero", wrap(JSON.stringify({ ...good, depth: 0 }))],
    ["a depth past the canvas", wrap(JSON.stringify({ ...good, depth: 99 }))],
    /**
     * This row used to be `canvas: "hexagon", depth: 5`, and depth 5 on a
     * hexagon is now LEGAL — see `MAX_DEPTH`. The triangle stopped being a
     * canvas and became a view of one sector of the hexagon, so a depth-5
     * triangle file is a depth-5 hexagon file with sector 0 painted, and a
     * ceiling of 4 would have made every one of those files loadable exactly
     * once and never writable again.
     *
     * What the row was actually testing — that a depth past the declared canvas's
     * ceiling is refused rather than clamped — is unchanged, and is kept here one
     * step further out.
     */
    [
      "a hexagon depth past the hexagon's own ceiling",
      wrap(JSON.stringify({ ...good, canvas: "hexagon", depth: 6 })),
    ],
    ["a NaN depth", wrap('{"canvas":"triangle","depth":null,"convention":"apex","cells":[]}')],
    [
      "an out-of-range cell index",
      wrap(JSON.stringify({ ...good, cells: [[16, "#d4a017"]] })),
    ],
    [
      "a negative cell index",
      wrap(JSON.stringify({ ...good, cells: [[-1, "#d4a017"]] })),
    ],
    [
      "a fractional cell index",
      wrap(JSON.stringify({ ...good, cells: [[1.5, "#d4a017"]] })),
    ],
    [
      "a bad colour string",
      wrap(JSON.stringify({ ...good, cells: [[1, "chartreuse"]] })),
    ],
    [
      "an upper-case colour",
      wrap(JSON.stringify({ ...good, cells: [[1, "#D4A017"]] })),
    ],
    [
      "a three-digit colour",
      wrap(JSON.stringify({ ...good, cells: [[1, "#abc"]] })),
    ],
    [
      "a cell that is not a pair",
      wrap(JSON.stringify({ ...good, cells: [[1, "#d4a017", "extra"]] })),
    ],
    ["cells that are not an array", wrap(JSON.stringify({ ...good, cells: 7 }))],
    [
      "the same cell twice",
      wrap(
        JSON.stringify({
          ...good,
          cells: [
            [1, "#d4a017"],
            [1, "#0f7b6c"],
          ],
        })
      ),
    ],
    [
      "more cells than the canvas has",
      wrap(
        JSON.stringify({
          ...good,
          depth: 1,
          cells: Array.from({ length: 5 }, (_, k) => [k % 4, "#d4a017"]),
        })
      ),
    ],
    [
      "an SVG from some other tool",
      `<?xml version="1.0"?><!-- Generator: Adobe Illustrator 27.0 --><svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>`,
    ],
    ["binary junk", " ÿþPK  garbage"],
    ["a string that is only `-->`", "-->"],
    ["a marker inside a string that ends early", `<!-- ${ART_MARKER}:1 --> {}`],
  ];

  for (const [what, text] of hostile) {
    it(`returns null on ${what}`, () => {
      expect(() => extractArt(text)).not.toThrow();
      expect(extractArt(text)).toBeNull();
    });
  }

  it("survives a large file of junk without throwing", () => {
    const junk = "<g><polygon points='0,0 1,1 2,2'/></g>".repeat(200_000);
    expect(junk.length).toBeGreaterThan(5_000_000);
    expect(extractArt(junk)).toBeNull();
  });

  it("survives a large file that opens a marker and never closes it", () => {
    const junk = `<svg><!-- ${ART_MARKER}:1 ` + "x".repeat(5_000_000);
    expect(extractArt(junk)).toBeNull();
  });

  it("takes the first marker and does not wander to a later one", () => {
    const real = payloadFromPaint("triangle", 1, "apex", new Map([[0, "#d4a017"]]));
    const doc = `<svg>${encodeArt(real)}${encodeArt({
      ...real,
      cells: [[1, "#0f7b6c"]],
    })}</svg>`;
    expect(extractArt(doc)?.cells).toEqual([[0, "#d4a017"]]);
  });

  it("reads a payload written with generous whitespace", () => {
    const doc = `<svg>\n  <!--   ${ART_MARKER}:1\n  {"canvas":"triangle","depth":1,"convention":"apex","cells":[[0,"#d4a017"]]}\n  -->\n</svg>`;
    expect(extractArt(doc)?.cells).toEqual([[0, "#d4a017"]]);
  });
});

// ── what a layer says about the gesture that made it ─────────────────────

/**
 * `reveal`, `mode` and `orbit` are the file's whole statement of PROVENANCE, and
 * until now nothing here checked them at all — they were exercised only through
 * `emit.ts`, where a failure shows up as a document that does not round trip and
 * gives no clue which of the two modules dropped the field. These are the
 * payload's own promises, tested where they are made.
 *
 * `mode` is the brush the gesture was made under and `orbit` is how many cells
 * it actually landed. THEY ARE NOT THE SAME NUMBER: a seed on a mirror line of
 * the group is stabilised, so a 6-fold brush can produce an orbit of 3. The
 * validator treats them as two independent integers for that reason, and the
 * first test below is written with `mode: 6, orbit: 3` rather than with a
 * matching pair so that an implementation which quietly derived one from the
 * other could not pass it.
 */
describe("a layer's gesture fields", () => {
  /** A payload carrying one composition, as the comment `emit.ts` writes it. */
  const withComp = (comp: unknown): string =>
    encodeArt({
      version: ART_VERSION,
      canvas: "hexagon",
      depth: 1,
      convention: "apex",
      cells: [[0, "#d4a017"]],
      comp: comp as ArtPayload["comp"],
    });

  /** One layer, with whatever extra fields a case wants to try. */
  const oneLayer = (extra: Record<string, unknown>) =>
    withComp({ layers: [{ id: "g", ...extra }] });

  it("carries the brush and the realised orbit back, separately", () => {
    const back = extractArt(oneLayer({ reveal: 2, mode: 6, orbit: 3 }));
    expect(back).not.toBeNull();
    const l = back?.comp?.layers[0];
    expect(l?.reveal).toBe(2);
    expect(l?.mode).toBe(6);
    // The stabilised orbit, which is not the brush and is not derivable from it.
    expect(l?.orbit).toBe(3);
  });

  it("keeps them on a nested layer, which is where a pasted gesture lands", () => {
    const back = extractArt(
      withComp({
        layers: [
          { id: "outer", children: [{ id: "inner", reveal: 4, mode: 12, orbit: 12 }] },
        ],
      })
    );
    const inner = back?.comp?.layers[0].children?.[0];
    expect(inner?.id).toBe("inner");
    expect([inner?.reveal, inner?.mode, inner?.orbit]).toEqual([4, 12, 12]);
  });

  it("leaves a file that predates them exactly as readable as it was", () => {
    // The whole argument for not versioning an optional field, as a test: a
    // composition written before gestures were recorded says nothing about them,
    // and must come back saying nothing about them. A default of any kind here —
    // `mode: 1`, `orbit: 1`, `reveal: 0` — would be this format inventing a
    // gesture that never happened, and would be indistinguishable from a real
    // one-fold stroke on the first step.
    const back = extractArt(oneLayer({ name: "an old layer" }));
    expect(back).not.toBeNull();
    const l = back?.comp?.layers[0];
    expect(l?.name).toBe("an old layer");
    expect(l?.reveal).toBeUndefined();
    expect(l?.mode).toBeUndefined();
    expect(l?.orbit).toBeUndefined();
    expect("reveal" in (l as object)).toBe(false);
  });

  it("re-encodes to the same bytes, which is what pins the key order", () => {
    // `emit.toArtLayer` writes these keys in one order and `artfile`'s validator
    // rebuilds them in another only if somebody changes one and not the other.
    // The file round trip is on BYTES, so a disagreement would show up in
    // `emit.test.ts` as a document that will not re-serialise and give no hint
    // which module moved. Here it is one line.
    const text = withComp({
      shown: "0-23",
      anim: { stepMs: 250, holdMs: 1800, fadeMs: 90, steps: 6 },
      layers: [
        {
          id: "g",
          name: "six fold on a mirror",
          hidden: true,
          locked: true,
          opacity: 0.5,
          reveal: 2,
          mode: 6,
          orbit: 3,
          cells: [[0, "#d4a017"]],
          children: [{ id: "k", reveal: 3, mode: 3, orbit: 3 }],
        },
      ],
    });
    expect(encodeArt(extractArt(text) as ArtPayload)).toBe(text);
  });

  it("refuses a gesture field that is not a whole, non-negative, sane number", () => {
    // A field the format cannot vouch for is a REFUSAL OF THE WHOLE PAYLOAD, not
    // a field to drop: a layer claiming a 1.5-fold brush was not written by a
    // canvas we understand, and the rest of what it says is worth no more than
    // that.
    for (const field of ["reveal", "mode", "orbit"]) {
      for (const bad of [-1, 1.5, "6", null, true, [], {}, MAX_LAYERS + 1]) {
        expect(
          extractArt(oneLayer({ [field]: bad })),
          `${field} = ${JSON.stringify(bad)}`
        ).toBeNull();
      }
    }
    // `NaN` and `Infinity` cannot be written as JSON at all — `JSON.stringify`
    // turns both into `null` — so they arrive as the `null` case above rather
    // than as themselves. Stated rather than left as a gap in the list.
    expect(JSON.stringify({ mode: NaN })).toBe('{"mode":null}');
  });

  /**
   * THREE FIELDS, THREE BOUNDS, and they were one.
   *
   * All three used to be checked against `MAX_LAYERS` — 8192, the layer-NODE
   * budget. That is the right bound for `reveal`, which is an animation step and
   * has one per gesture layer, and it is not a bound on the other two at all. It
   * admitted `mode: 0`, a symmetry group that does not exist and one that
   * `provenance.unmarked` cannot find, because that query tests `mode !==
   * undefined`: the layer would count as MARKED and appear in a census as a
   * `modes` bucket of zero. And it admitted an orbit of eight thousand cells on a
   * canvas of twenty-four.
   */
  it("bounds `mode` by the canvas's own group, not by the layer budget", () => {
    // Depth 1 hexagon: 24 cells, D₆, so 1, 2, 3, 6 and 12 and nothing else.
    for (const mode of [1, 2, 3, 6, 12]) {
      expect(extractArt(oneLayer({ mode }))?.comp?.layers[0].mode, `mode ${mode}`).toBe(
        mode
      );
    }
    for (const mode of [0, 4, 5, 7, 11, 13, 24, 384]) {
      expect(extractArt(oneLayer({ mode })), `mode ${mode}`).toBeNull();
    }
  });

  it("refuses mode 12 on a TRIANGLE, whose group is D₃ and has no such subgroup", () => {
    // The same rule `validateView` applies to a sector on a triangle: a file
    // claiming something its own canvas cannot have is refused whole rather than
    // half-read. The sector scopes offer a SUBSET of the hexagon's modes, so one
    // list per canvas covers every scope a file could have been drawn in.
    const onTriangle = (mode: number): string =>
      encodeArt({
        version: ART_VERSION,
        canvas: "triangle",
        depth: 1,
        convention: "apex",
        cells: [[0, "#d4a017"]],
        comp: { layers: [{ id: "g", mode }] } as ArtPayload["comp"],
      });
    for (const mode of [1, 2, 3, 6]) {
      expect(extractArt(onTriangle(mode))?.comp?.layers[0].mode, `mode ${mode}`).toBe(mode);
    }
    expect(extractArt(onTriangle(12))).toBeNull();
    // ...and the same file on the hexagon is fine, so the refusal is about the
    // canvas rather than about the number.
    expect(extractArt(oneLayer({ mode: 12 }))?.comp?.layers[0].mode).toBe(12);
  });

  it("bounds `orbit` by the cells the canvas HAS, and refuses an empty one", () => {
    const n = cellCount("hexagon", 1);
    expect(n).toBe(24);
    expect(extractArt(oneLayer({ orbit: 1 }))?.comp?.layers[0].orbit).toBe(1);
    expect(extractArt(oneLayer({ orbit: n }))?.comp?.layers[0].orbit).toBe(n);
    // An orbit is the image of a seed under a subgroup and always contains the
    // seed, so the smallest true one is the stabilised orbit of size 1. Zero is
    // not a short orbit, it is an absent one — and `shortOrbits` would have
    // reported it as the shortest of all.
    expect(extractArt(oneLayer({ orbit: 0 }))).toBeNull();
    expect(extractArt(oneLayer({ orbit: n + 1 }))).toBeNull();
    expect(extractArt(oneLayer({ orbit: 8000 }))).toBeNull();
  });

  it("still keeps `mode` and `orbit` independent — the stabilised seed is ordinary", () => {
    // The bounds are per FIELD. Nothing cross-checks one against the other: a
    // 6-fold brush on a mirror line lays three cells, which is the case a
    // symmetry-minded reader is most interested in.
    expect(extractArt(oneLayer({ mode: 6, orbit: 3 }))?.comp?.layers[0].orbit).toBe(3);
    expect(extractArt(oneLayer({ mode: 1, orbit: 24 }))?.comp?.layers[0].orbit).toBe(24);
    expect(extractArt(oneLayer({ mode: 12, orbit: 1 }))?.comp?.layers[0].mode).toBe(12);
    // And `orbit` alone, or `mode` alone, is a legal statement.
    expect(extractArt(oneLayer({ orbit: 6 }))?.comp?.layers[0].mode).toBeUndefined();
    expect(extractArt(oneLayer({ mode: 6 }))?.comp?.layers[0].orbit).toBeUndefined();
  });

  it("leaves `reveal` bounded by the layer budget, because that is what it counts", () => {
    // One reveal step per gesture layer, so the node cap is its cap. Deliberately
    // NOT narrowed to the canvas: an animated file legitimately has thousands of
    // steps and none of them is a cell index.
    expect(extractArt(oneLayer({ reveal: 0 }))?.comp?.layers[0].reveal).toBe(0);
    expect(extractArt(oneLayer({ reveal: MAX_LAYERS }))?.comp?.layers[0].reveal).toBe(
      MAX_LAYERS
    );
    expect(extractArt(oneLayer({ reveal: MAX_LAYERS + 1 }))).toBeNull();
  });

  it("refuses the WHOLE payload for a bad field on a nested layer", () => {
    // Whole-file rejection, not a half-read tree: the outer layer is perfectly
    // legal and goes with it.
    expect(
      extractArt(
        withComp({ layers: [{ id: "outer", children: [{ id: "inner", mode: 0 }] }] })
      )
    ).toBeNull();
  });

  it("carries the timing block, so an imported file still plays", () => {
    const back = extractArt(
      withComp({ anim: { stepMs: 250, holdMs: 1800, fadeMs: 90, steps: 6 }, layers: [] })
    );
    expect(back?.comp?.anim).toEqual({ stepMs: 250, holdMs: 1800, fadeMs: 90, steps: 6 });
  });

  it("refuses a timing block that is not one", () => {
    const good = { stepMs: 250, holdMs: 1800, fadeMs: 90, steps: 6 };
    const bad: unknown[] = [
      // A step of zero milliseconds is a cycle with no length; `holdMs`,
      // `fadeMs` and `steps` may be zero and `stepMs` may not.
      { ...good, stepMs: 0 },
      { ...good, holdMs: -1 },
      { ...good, fadeMs: 1.5 },
      { ...good, steps: MAX_LAYERS + 1 },
      // Longer than an hour, which is the wall the validator draws.
      { ...good, stepMs: 3_600_001 },
      // Missing a field is missing a field, not a field to default.
      { stepMs: 250, holdMs: 1800, fadeMs: 90 },
      "250ms",
      [250, 1800, 90, 6],
      null,
    ];
    for (const a of bad) {
      expect(extractArt(withComp({ anim: a, layers: [] })), JSON.stringify(a)).toBeNull();
    }
    // And absent is fine: a still export says nothing about timing.
    expect(extractArt(withComp({ layers: [] }))?.comp?.anim).toBeUndefined();
  });
});

// ── normalising a colour ─────────────────────────────────────────────────

describe("normalizeHex", () => {
  it("lower-cases six digits and expands three", () => {
    expect(normalizeHex("#D4A017")).toBe("#d4a017");
    expect(normalizeHex(" #abc ")).toBe("#aabbcc");
  });

  it("refuses anything that is not a hex colour", () => {
    for (const bad of ["chartreuse", "rgb(1,2,3)", "url(#g)", "none", "#12345", ""]) {
      expect(normalizeHex(bad)).toBeNull();
    }
  });
});

// ── the geometric fallback ───────────────────────────────────────────────

describe("importByGeometry", () => {
  it("matches every cell of a file this app exported, marker stripped", () => {
    const paint = schemePlate("triangle", 3);
    const svg = stripMarker(exportSvg("triangle", 3, "apex", paint));
    expect(extractArt(svg)).toBeNull();

    const got = importByGeometry(svg, buildFigure(3, "apex"));
    expect(got.total).toBe(paint.size);
    expect(got.unmatched).toBe(0);
    expect(got.matched.size).toBe(paint.size);
    for (const [i, hex] of paint) expect(got.matched.get(i)?.hex).toBe(hex);
  });

  it("does the same on the hexagon", () => {
    const paint = schemePlate("hexagon", 2);
    const svg = stripMarker(exportSvg("hexagon", 2, "apex", paint));
    const got = importByGeometry(svg, buildHexagon(2, "apex"));
    expect(got.matched.size).toBe(paint.size);
    expect(got.unmatched).toBe(0);
  });

  it("leaves the exported tiling out — a tile is not paint", () => {
    const paint = new Map([[0, "#d4a017"]]);
    const withTiles = stripMarker(exportSvg("triangle", 2, "apex", paint));
    // The file really does carry the other fifteen cells as polygons.
    expect((withTiles.match(/<polygon/g) ?? []).length).toBe(16);
    const got = importByGeometry(withTiles, buildFigure(2, "apex"));
    expect(got.total).toBe(1);
    expect(got.matched.size).toBe(1);
  });

  it("welded paint, whose polygons carry a stroke as well, still matches", () => {
    const fig = buildFigure(2, "apex");
    const paint = new Map([
      [1, "#d4a017"],
      [2, "#0f7b6c"],
    ]);
    const svg = artworkSvg({
      width: fig.width,
      height: fig.height,
      cells: fig.cells as readonly ArtCell[],
      paint,
      background: "#0a0908",
      unpainted: null,
      tileSeam: null,
      paintSeam: null,
      weldPaint: true,
      seamWidth: 1.2,
      title: "welded",
    });
    const got = importByGeometry(svg, fig);
    expect(got.matched.size).toBe(2);
    expect(got.matched.get(1)?.hex).toBe("#d4a017");
  });

  it("does not care which corner a polygon was listed from", () => {
    const fig = buildFigure(1, "apex");
    const v = fig.cells[2].verts;
    const rotated = [v[2], v[0], v[1]]
      .map((p) => `${Math.round(p[0] * 100) / 100},${Math.round(p[1] * 100) / 100}`)
      .join(" ");
    const svg = `<svg><polygon points="${rotated}" fill="#0f7b6c"/></svg>`;
    const got = importByGeometry(svg, fig);
    expect(got.matched.get(2)?.hex).toBe("#0f7b6c");
    expect(got.unmatched).toBe(0);
  });

  it("reads a fill out of an inline style, and single-quoted attributes", () => {
    const fig = buildFigure(1, "apex");
    const pts = fig.cells[0].verts
      .map((p) => `${Math.round(p[0] * 100) / 100},${Math.round(p[1] * 100) / 100}`)
      .join(" ");
    const svg = `<svg><polygon points='${pts}' style="stroke:#000;fill:#ABCDEF"/></svg>`;
    expect(importByGeometry(svg, fig).matched.get(0)?.hex).toBe("#abcdef");
  });

  it("degrades to a reported partial when the file has been mangled", () => {
    const paint = schemePlate("triangle", 2);
    const svg = stripMarker(
      exportSvg("triangle", 2, "apex", paint, { tiling: false })
    );
    // Shove every third painted polygon a long way off the lattice.
    let seen = 0;
    const mangled = svg.replace(/points="([^"]*)"/g, (whole, pts: string) => {
      seen++;
      if (seen % 3 !== 0) return whole;
      const moved = pts
        .split(" ")
        .map((p) => {
          const [x, y] = p.split(",").map(Number);
          return `${x + 999},${y + 999}`;
        })
        .join(" ");
      return `points="${moved}"`;
    });

    const got = importByGeometry(mangled, buildFigure(2, "apex"));
    expect(got.total).toBe(paint.size);
    expect(got.unmatched).toBeGreaterThan(0);
    expect(got.matched.size).toBe(got.total - got.unmatched);
    expect(got.matched.size).toBeGreaterThan(0);
  });

  it("matches nothing, loudly, when the file is from somewhere else", () => {
    const svg = `<svg viewBox="0 0 10 10"><polygon points="0,0 10,0 5,9" fill="#ff0000"/></svg>`;
    const got = importByGeometry(svg, buildFigure(3, "apex"));
    expect(got.total).toBe(1);
    expect(got.unmatched).toBe(1);
    expect(got.matched.size).toBe(0);
  });

  it("ignores shapes with no fill, no points, or a fill that is not a colour", () => {
    const fig = buildFigure(1, "apex");
    const pts = fig.cells[0].verts
      .map((p) => `${Math.round(p[0] * 100) / 100},${Math.round(p[1] * 100) / 100}`)
      .join(" ");
    const svg =
      `<svg>` +
      `<polygon points="${pts}"/>` +
      `<polygon fill="#d4a017"/>` +
      `<polygon points="${pts}" fill="none"/>` +
      `<polygon points="${pts}" fill="url(#grad)"/>` +
      `<polygon points="0,0 1,1" fill="#d4a017"/>` +
      `</svg>`;
    const got = importByGeometry(svg, fig);
    expect(got.total).toBe(0);
    expect(got.matched.size).toBe(0);
  });

  it("does not read a fill-opacity as a fill", () => {
    const fig = buildFigure(1, "apex");
    const pts = fig.cells[0].verts
      .map((p) => `${Math.round(p[0] * 100) / 100},${Math.round(p[1] * 100) / 100}`)
      .join(" ");
    const svg = `<svg><polygon points="${pts}" fill-opacity="0.5"/></svg>`;
    expect(importByGeometry(svg, fig).total).toBe(0);
  });

  it("never throws on junk", () => {
    const fig = buildFigure(1, "apex");
    for (const junk of ["", "<polygon", " ÿ", "<polygon points=\"\" fill=\"\"/>"]) {
      expect(() => importByGeometry(junk, fig)).not.toThrow();
    }
  });
});

// ── the constants the format leans on ────────────────────────────────────

describe("format constants", () => {
  it("counts cells the way the canvases are built", () => {
    for (const d of [1, 2, 3, 4, 5]) {
      expect(cellCount("triangle", d)).toBe(buildFigure(d, "apex").cells.length);
    }
    for (const d of [1, 2, 3, 4]) {
      expect(cellCount("hexagon", d)).toBe(buildHexagon(d, "apex").cells.length);
    }
  });

  it("rounds to the precision the exporter writes at", () => {
    // `artworkSvg` formats coordinates to two decimals; matching at any other
    // precision would compare a rounded file against an unrounded canvas.
    expect(GEOMETRY_PRECISION).toBe(2);
    const svg = exportSvg("triangle", 1, "apex", new Map([[0, "#d4a017"]]));
    const pts = /<polygon points="([^"]*)"/.exec(svg)?.[1] ?? "";
    for (const n of pts.split(/[\s,]+/)) {
      const dot = n.indexOf(".");
      expect(dot < 0 || n.length - dot - 1 <= GEOMETRY_PRECISION).toBe(true);
    }
  });

  /**
   * The hexagon's ceiling was 4 and is 5.
   *
   * CHANGED DELIBERATELY, and it is the one existing expectation this work
   * moved. The triangle is now a VIEW of one sector of the hexagon rather than a
   * canvas of its own, so a file this program exported at triangle depth 5 —
   * 1024 cells, always drawable, always exportable — is a hexagon file at depth
   * 5 with sector 0 painted. Held at 4, the loader would have accepted that file
   * (its declared canvas is `triangle`, whose ceiling is 5) and then refused
   * every re-export of it, because the re-export declares the canvas the plate
   * now lives on. Existing work would have become a one-way trip.
   *
   * The two ceilings are equal for exactly that reason, and the triangle's is
   * kept rather than removed because files declaring it still arrive.
   */
  it("declares a depth ceiling for each canvas", () => {
    expect(MAX_DEPTH.triangle).toBe(5);
    expect(MAX_DEPTH.hexagon).toBe(5);
    expect(MAX_DEPTH.hexagon).toBeGreaterThanOrEqual(MAX_DEPTH.triangle);
  });
});
