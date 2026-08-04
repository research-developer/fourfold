import { describe, expect, it } from "vitest";
import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import {
  PROTOTYPE_LIMIT,
  findLayer,
  flatten,
  idsOf,
  parse,
  rekey,
  resolvedShapes,
  serialise,
  type EmitDoc,
  type EmitLayer,
} from "../src/lib/emit";
import { artworkSvg, type ArtCell } from "../src/lib/strokes";
import {
  extractArt,
  formatRanges,
  parseRanges,
  GEOMETRY_PRECISION,
} from "../src/lib/artfile";
import { buildHexagon } from "../src/lib/hexagon";
import { plateFrame } from "../src/lib/view";
import { buildRelief, reliefFrame, restShell } from "../src/lib/relief";

// ── fixtures ─────────────────────────────────────────────────────────────

const PALETTE = ["#d4a017", "#c0392b", "#2e86c1", "#7d3c98", "#1e8449", "#e67e22"];

const bytes = (s: string) => Buffer.byteLength(s, "utf8");
const gz = (s: string) => gzipSync(Buffer.from(s, "utf8"), { level: 9 }).length;

/** The board's own geometry, at a depth, in one of the two views. */
function frameOf(depth: number, mode: "hexagon" | "sector" = "hexagon") {
  const hex = buildHexagon(depth);
  const pf = plateFrame(hex, { mode, sector: 0 });
  const cells = new Map<number, ArtCell>();
  pf.cells.forEach((c, i) => cells.set(i, { verts: c.verts }));
  return { hex, pf, cells };
}

function paintOf(shown: readonly number[], every: number, offset = 0): Map<number, string> {
  const m = new Map<number, string>();
  for (let k = offset; k < shown.length; k += every) {
    m.set(shown[k], PALETTE[(k * 7) % PALETTE.length]);
  }
  return m;
}

/** A composition with a nested stack, at a depth. */
function docOf(depth: number, layers?: readonly EmitLayer[]): EmitDoc {
  const { pf, cells } = frameOf(depth);
  const shown = pf.shown;
  const stack: readonly EmitLayer[] = layers ?? [
    { id: "ground", name: "ground", paint: paintOf(shown, 5, 0) },
    {
      id: "strokes",
      name: "strokes",
      paint: paintOf(shown, 7, 1),
      children: [
        { id: "detail", name: "detail", paint: paintOf(shown, 11, 2) },
        { id: "hidden-bits", hidden: true, paint: paintOf(shown, 13, 3) },
      ],
    },
  ];
  return {
    width: pf.width,
    height: pf.height,
    cells,
    shown,
    background: "#0a0908",
    unpainted: "#141110",
    tileSeam: "rgba(236,230,220,.16)",
    paintSeam: "rgba(0,0,0,.3)",
    seamWidth: 0.7,
    weldPaint: false,
    title: `FOURFOLD — hexagon, depth ${depth}`,
    layers: stack,
    overlay: [],
    animation: null,
    payload: {
      version: 1,
      canvas: "hexagon",
      depth,
      convention: "apex",
      cells: [...flatten(stack).entries()].sort((a, b) => a[0] - b[0]),
    },
  };
}

/**
 * The same drawing as ONE layer.
 *
 * The comparison against `artworkSvg` has to be like for like: a stack of four
 * layers says something a flat file cannot say at all, and charging the format
 * for that would be measuring the wrong thing.
 */
function flatDoc(depth: number): EmitDoc {
  const { pf } = frameOf(depth);
  const paint = new Map<number, string>();
  for (const [i, c] of paintOf(pf.shown, 3, 0)) paint.set(i, c);
  return docOf(depth, [{ id: "plate", name: "plate", paint }]);
}

/** The same drawing as one flat polygon document — what `artworkSvg` writes. */
function stillOf(doc: EmitDoc): string {
  const cells: ArtCell[] = [];
  const n = Math.max(...doc.shown) + 1;
  for (let i = 0; i < n; i++) {
    cells.push(doc.cells.get(i) ?? { verts: [] });
  }
  return artworkSvg({
    width: doc.width,
    height: doc.height,
    cells,
    shown: doc.shown,
    paint: flatten(doc.layers),
    background: doc.background,
    unpainted: doc.unpainted,
    tileSeam: doc.tileSeam,
    paintSeam: doc.paintSeam,
    seamWidth: doc.seamWidth,
    weldPaint: doc.weldPaint,
    title: doc.title,
    payload: doc.payload,
  });
}

// ── the observation the format is built on ───────────────────────────────

describe("the figure has exactly two cell shapes", () => {
  it("is 2 at every depth, in both views, measured rather than assumed", () => {
    const fmt = (n: number) => {
      const r = Math.round(n * 100) / 100;
      return Object.is(r, -0) ? "0" : String(r);
    };
    for (const depth of [1, 2, 3, 4, 5]) {
      for (const mode of ["hexagon", "sector"] as const) {
        const { pf } = frameOf(depth, mode);
        const shapes = new Set<string>();
        for (const i of pf.shown) {
          const sorted = [...pf.cells[i].verts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
          const o = sorted[0];
          shapes.add(
            sorted.map((v) => `${fmt(v[0] - o[0])},${fmt(v[1] - o[1])}`).join(" ")
          );
        }
        expect(shapes.size, `depth ${depth} ${mode}`).toBe(2);
      }
    }
  });

  it("puts every hexagon x coordinate on an exact integer, so only y needs decimals", () => {
    for (const depth of [1, 2, 3, 4, 5]) {
      const { pf } = frameOf(depth);
      for (const c of pf.cells) {
        for (const v of c.verts) expect(Number.isInteger(v[0])).toBe(true);
      }
    }
  });

  it("writes four prototypes: two shapes, each stated two ways at two decimals", () => {
    const svg = serialise(docOf(3));
    expect(svg.match(/<polygon id=/g)).toHaveLength(4);
    expect(svg).toContain('<polygon id="u" points=');
    expect(svg).toContain('<polygon id="d" points=');
    expect(svg).toContain('<polygon id="u2" points=');
    expect(svg).toContain('<polygon id="d2" points=');
  });

  it("is four in both views at every depth, and the reconstruction is EXACT", () => {
    for (const depth of [1, 2, 3, 4, 5]) {
      for (const mode of ["hexagon", "sector"] as const) {
        const { pf } = frameOf(depth, mode);
        const shapes = new Set<string>();
        let worst = 0;
        for (const i of pf.shown) {
          const q = (n: number) => {
            const r = Math.round(n * 100) / 100;
            return Object.is(r, -0) ? 0 : r;
          };
          const qv = pf.cells[i].verts.map((v) => [q(v[0]), q(v[1])] as [number, number]);
          const sorted = [...qv].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
          const o = sorted[0];
          shapes.add(
            sorted.map((v) => `${q(v[0] - o[0])},${q(v[1] - o[1])}`).join(" ")
          );
          // anchor + prototype coordinate reproduces the rounded vertex, to the
          // bit. That is the whole reason the rounding happens first.
          for (const v of sorted) {
            worst = Math.max(
              worst,
              Math.abs(q(o[0] + q(v[0] - o[0])) - v[0]),
              Math.abs(q(o[1] + q(v[1] - o[1])) - v[1])
            );
          }
        }
        expect(shapes.size, `depth ${depth} ${mode}`).toBeLessThanOrEqual(4);
        expect(worst, `depth ${depth} ${mode}`).toBe(0);
      }
    }
  });
});

// ── the round trip ───────────────────────────────────────────────────────

describe("round trip", () => {
  it("is byte identical through serialise, parse, serialise", () => {
    for (const depth of [1, 2, 3, 4]) {
      const once = serialise(docOf(depth));
      const back = parse(once);
      expect(back, `depth ${depth}`).not.toBeNull();
      expect(serialise(back as EmitDoc)).toBe(once);
    }
  });

  it("is byte identical for a stack nested three deep, which a flat one cannot show", () => {
    const { pf } = frameOf(3);
    const deep: EmitLayer[] = [
      {
        id: "a",
        name: "outer",
        paint: paintOf(pf.shown, 9, 0),
        children: [
          {
            id: "b",
            name: "middle",
            opacity: 0.5,
            paint: paintOf(pf.shown, 11, 1),
            children: [
              {
                id: "c",
                name: "inner",
                locked: true,
                paint: paintOf(pf.shown, 13, 2),
                children: [{ id: "deepest", name: "innermost", paint: paintOf(pf.shown, 17, 3) }],
              },
            ],
          },
        ],
      },
    ];
    const once = serialise(docOf(3, deep));
    const back = parse(once);
    expect(back).not.toBeNull();
    expect(serialise(back as EmitDoc)).toBe(once);

    // Depth and order, not merely membership.
    const tree = (l: readonly EmitLayer[]): string =>
      l.map((x) => `${x.id}(${tree(x.children ?? [])})`).join(",");
    expect(tree((back as EmitDoc).layers)).toBe("a(b(c(deepest())))");
  });

  it("keeps every own flag, and never writes the resolved one", () => {
    const { pf } = frameOf(2);
    const doc = docOf(2, [
      {
        id: "parent",
        hidden: true,
        paint: paintOf(pf.shown, 5, 0),
        children: [
          { id: "kid", paint: paintOf(pf.shown, 7, 1) },
          { id: "kid2", hidden: true, paint: paintOf(pf.shown, 9, 2) },
        ],
      },
    ]);
    const back = parse(serialise(doc)) as EmitDoc;
    expect(back.layers[0].hidden).toBe(true);
    // The child of a hidden parent is NOT itself marked hidden — un-hide the
    // parent and it comes back, which is the whole point of writing own flags.
    expect(back.layers[0].children?.[0].hidden).toBeUndefined();
    expect(back.layers[0].children?.[1].hidden).toBe(true);
    expect(serialise(back)).toBe(serialise(doc));
  });

  it("hides with display:none, so a renderer hides the descendants and the file does not", () => {
    const svg = serialise(docOf(2));
    // As a PRESENTATION ATTRIBUTE, where a reader can override it — the inline
    // style it used to be needed `!important` to answer. See `emitLayers`.
    expect(svg).toContain(`<g id="hidden-bits" display="none">`);
  });

  it("carries the title, the seams, the frame and the weld across", () => {
    const doc = { ...docOf(2), weldPaint: true };
    const back = parse(serialise(doc)) as EmitDoc;
    expect(back.title).toBe(doc.title);
    expect(back.weldPaint).toBe(true);
    expect(back.seamWidth).toBeCloseTo(0.7, 10);
    expect(back.unpainted).toBe("#141110");
    expect(back.tileSeam).toBe("rgba(236,230,220,.16)");
    expect(back.background).toBe("#0a0908");
    expect(formatRanges(back.shown)).toBe(formatRanges(doc.shown));
    expect(serialise(back)).toBe(serialise(doc));
  });

  it("round trips an overlay, which the relief writes", () => {
    const doc = docOf(2);
    const cell = doc.cells.get(0) as ArtCell;
    const withWash: EmitDoc = {
      ...doc,
      overlay: [
        { fill: "#fff", opacity: 0.12, shapes: [cell.verts.map((v) => [v[0], v[1]] as [number, number])] },
        { fill: "#000", opacity: 0.08, shapes: [cell.verts.map((v) => [v[0], v[1]] as [number, number])] },
      ],
    };
    const once = serialise(withWash);
    const back = parse(once) as EmitDoc;
    expect(back.overlay).toHaveLength(2);
    expect(back.overlay[0].fill).toBe("#fff");
    expect(back.overlay[0].opacity).toBeCloseTo(0.12, 10);
    expect(serialise(back)).toBe(once);
  });

  it("survives a name that would otherwise close a tag", () => {
    const { pf } = frameOf(1);
    const doc = docOf(1, [
      { id: "odd", name: `a <b> & "c"`, paint: paintOf(pf.shown, 2, 0) },
    ]);
    const once = serialise(doc);
    expect(once).toContain(`data-name="a &lt;b&gt; &amp; &quot;c&quot;"`);
    const back = parse(once) as EmitDoc;
    expect(back.layers[0].name).toBe(`a <b> & "c"`);
    expect(serialise(back)).toBe(once);
  });
});

// ── scope: one layer, and only what it needs ─────────────────────────────

describe("serialising one layer", () => {
  const doc = docOf(3);

  it("carries the subtree, not just the layer", () => {
    const svg = serialise(doc, { layer: "strokes" });
    expect(svg).toContain(`<g id="strokes"`);
    expect(svg).toContain(`<g id="detail"`);
    expect(svg).toContain(`<g id="hidden-bits"`);
    expect(svg).not.toContain(`<g id="ground"`);
  });

  it("is itself a composition, so pasting one is loading one", () => {
    const svg = serialise(doc, { layer: "strokes" });
    const back = parse(svg);
    expect(back).not.toBeNull();
    expect(serialise(back as EmitDoc)).toBe(svg);
  });

  it("prunes the palette to the colours the subtree uses", () => {
    const only: EmitLayer[] = [
      { id: "one", paint: new Map([[0, "#111111"]]) },
      { id: "two", paint: new Map([[1, "#222222"]]), children: [
        { id: "three", paint: new Map([[2, "#333333"]]) },
      ] },
    ];
    const d = docOf(2, only);
    const whole = serialise(d);
    expect(whole).toContain("#111111");
    expect(whole).toContain("#222222");
    expect(whole).toContain("#333333");

    const part = serialise(d, { layer: "two" });
    // The subtree's own colours, and only those.
    expect(part).not.toContain("#111111");
    expect(part).toContain("#222222");
    expect(part).toContain("#333333");
    expect(part.match(/\.k\d+ \{/g)).toHaveLength(2);
  });

  it("prunes the prototypes to the shapes the subtree places", () => {
    const { pf } = frameOf(2);
    // One up-pointing cell only. Cell 0 of the hexagon is an up triangle.
    const up = pf.cells[0];
    const isUp = (c: { verts: readonly (readonly [number, number])[] }) =>
      Math.abs(c.verts[2][1] - up.verts[2][1]) < 1e-9;
    const upOnly = pf.shown.filter((i) => isUp(pf.cells[i])).slice(0, 4);
    const d = docOf(2, [
      { id: "mixed", paint: new Map(pf.shown.slice(0, 6).map((i) => [i, "#111111"])) },
      { id: "ups", paint: new Map(upOnly.map((i) => [i, "#222222"])) },
    ]);
    const whole = serialise(d);
    const part = serialise(d, { layer: "ups" });
    expect(whole.match(/<polygon id=/g)?.length).toBe(4);
    // Up triangles only, so the down prototypes are not written down.
    expect(part.match(/<polygon id=/g)?.length).toBeLessThanOrEqual(2);
    expect(part).not.toContain('id="d"');
    // And it still draws every cell it claims.
    expect(part.match(/<use /g)).toHaveLength(upOnly.length);
  });

  it("leaves out the tiling, because a copied layer is the layer", () => {
    const svg = serialise(doc, { layer: "detail" });
    expect(svg).not.toContain(`id="tiling"`);
    expect(svg).not.toContain(".tile {");
  });

  it("refuses a layer that is not there", () => {
    expect(() => serialise(doc, { layer: "nope" })).toThrow();
  });
});

// ── paste, and pasting the paste ─────────────────────────────────────────

describe("paste composes with itself", () => {
  const graft = (host: EmitDoc, incoming: readonly EmitLayer[], onto: string): EmitDoc => {
    const safe = rekey(incoming, idsOf(host.layers));
    const put = (list: readonly EmitLayer[]): EmitLayer[] =>
      list.map((l) =>
        l.id === onto
          ? { ...l, children: [...(l.children ?? []), ...safe] }
          : { ...l, ...(l.children === undefined ? {} : { children: put(l.children) }) }
      );
    const layers = put(host.layers);
    return {
      ...host,
      layers,
      payload: {
        ...host.payload,
        cells: [...flatten(layers).entries()].sort((a, b) => a[0] - b[0]),
      },
    };
  };

  it("nests one more level each time, and round trips at every step", () => {
    let host = docOf(3);
    const copied = parse(serialise(docOf(3), { layer: "strokes" })) as EmitDoc;
    expect(copied).not.toBeNull();

    const depthOf = (l: readonly EmitLayer[]): number =>
      l.length === 0 ? 0 : 1 + Math.max(...l.map((x) => depthOf(x.children ?? [])));
    const before = depthOf(host.layers);

    for (let k = 0; k < 3; k++) {
      host = graft(host, copied.layers, "ground");
      const once = serialise(host);
      const back = parse(once);
      expect(back, `paste ${k}`).not.toBeNull();
      expect(serialise(back as EmitDoc), `paste ${k}`).toBe(once);
    }
    expect(depthOf(host.layers)).toBeGreaterThan(before);
  });

  it("renames a subtree whose ids the target already holds, rather than colliding", () => {
    const host = docOf(2);
    const incoming = parse(serialise(docOf(2), { layer: "strokes" })) as EmitDoc;
    // The incoming ids are exactly the ones the host already uses.
    expect(idsOf(incoming.layers).has("strokes")).toBe(true);
    expect(idsOf(host.layers).has("strokes")).toBe(true);

    const merged = graft(host, incoming.layers, "ground");
    const ids = [...idsOf(merged.layers)];
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("strokes");
    expect(ids).toContain("strokes-2");

    const once = serialise(merged);
    expect(serialise(parse(once) as EmitDoc)).toBe(once);
    // Every `id=` in the document is distinct, which is the property that
    // matters to a renderer and to `<use href="#…">`.
    const written = [...once.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(written).size).toBe(written.length);
  });

  it("does not pile suffixes up when the same thing is pasted repeatedly", () => {
    const one = rekey([{ id: "x" }], new Set(["x"]));
    expect(one[0].id).toBe("x-2");
    const two = rekey(one, new Set(["x", "x-2"]));
    expect(two[0].id).toBe("x-3");
    const three = rekey(two, new Set(["x", "x-2", "x-3"]));
    expect(three[0].id).toBe("x-4");
  });

  it("replaces an id that could never be written into the markup", () => {
    const out = rekey([{ id: "9 bad<id" }, { id: "u" }], new Set());
    expect(out[0].id).toMatch(/^[A-Za-z_][\w.-]*$/);
    expect(out[1].id).not.toBe("u");
  });
});

// ── the `<use>` really is the polygon ────────────────────────────────────

describe("use resolves to the same geometry as a polygon", () => {
  it("places every cell where the polygon form places it, to the last digit", () => {
    for (const depth of [2, 3, 4]) {
      const doc = flatDoc(depth);
      const svg = serialise(doc);
      const shapes = resolvedShapes(svg);
      expect(shapes).not.toBeNull();

      const key = (v: readonly (readonly [number, number])[]) =>
        v
          .map((p) => `${Math.round(p[0] * 100) / 100},${Math.round(p[1] * 100) / 100}`)
          .sort()
          .join(" ");

      const want = new Map<string, string>();
      const paint = flatten(doc.layers);
      for (const i of doc.shown) {
        const c = doc.cells.get(i) as ArtCell;
        want.set(key(c.verts), paint.get(i) ?? "#141110");
      }
      // Vertex SETS, because the prototype is written from the sorted corners
      // and a triangle does not care which one it started at.
      const got = new Map<string, string>();
      for (const s of shapes as { verts: [number, number][]; fill: string }[]) {
        got.set(key(s.verts), s.fill);
      }
      expect(got.size, `depth ${depth}`).toBe(want.size);
      for (const [k, colour] of want) expect(got.get(k), `depth ${depth} ${k}`).toBe(colour);
    }
  });

  it("resolves the same shapes out of the polygon file, so the two are comparable", () => {
    const doc = docOf(2);
    const still = stillOf(doc);
    const a = resolvedShapes(still) as { verts: [number, number][] }[];
    const b = resolvedShapes(serialise(doc)) as { verts: [number, number][] }[];
    const key = (v: readonly (readonly [number, number])[]) =>
      v.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).sort().join(" ");
    expect(new Set(a.map((s) => key(s.verts)))).toEqual(
      new Set(b.map((s) => key(s.verts)))
    );
  });
});

// ── bytes ────────────────────────────────────────────────────────────────

describe("what the format is worth, measured", () => {
  /** The drawing on its own: the same file with the payload comment taken out. */
  const drawingOnly = (svg: string) => svg.replace(/<!--[\s\S]*?-->/g, "");

  it("is smaller than one polygon per cell, raw and gzipped, at depth 3, 4 and 5", () => {
    const rows: string[] = [];
    for (const depth of [3, 4, 5]) {
      const doc = flatDoc(depth);
      const poly = stillOf(doc);
      const use = serialise(doc);
      rows.push(
        `d${depth} whole file: poly raw=${bytes(poly)} gz=${gz(poly)} | ` +
          `use raw=${bytes(use)} (${((bytes(use) / bytes(poly)) * 100).toFixed(0)}%) ` +
          `gz=${gz(use)} (${((gz(use) / gz(poly)) * 100).toFixed(0)}%)`
      );
      const pd = drawingOnly(poly);
      const ud = drawingOnly(use);
      rows.push(
        `d${depth} drawing:    poly raw=${bytes(pd)} gz=${gz(pd)} | ` +
          `use raw=${bytes(ud)} (${((bytes(ud) / bytes(pd)) * 100).toFixed(0)}%) ` +
          `gz=${gz(ud)} (${((gz(ud) / gz(pd)) * 100).toFixed(0)}%)`
      );
      expect(bytes(use), `depth ${depth} raw`).toBeLessThan(bytes(poly));
      expect(gz(use), `depth ${depth} gzipped`).toBeLessThan(gz(poly));
      // The saving is bigger once compressed, which is the finding worth
      // stating: the repeated thing got SHORTER, not merely more repetitive.
      expect(gz(use) / gz(poly)).toBeLessThan(bytes(use) / bytes(poly));
    }
    expect(rows).toHaveLength(6);
  });

  it("saves more of the DRAWING than of the file, because the payload is a fixed tax", () => {
    const doc = flatDoc(4);
    const poly = stillOf(doc);
    const use = serialise(doc);
    const wholeRatio = gz(use) / gz(poly);
    const drawingRatio = gz(drawingOnly(use)) / gz(drawingOnly(poly));
    expect(drawingRatio).toBeLessThan(wholeRatio);
    // The tax is the layer stack said a second time, for readers that predate
    // it: the flat `cells` list stays so an old build still loads the drawing.
    expect(wholeRatio).toBeLessThan(0.8);
    expect(drawingRatio).toBeLessThan(0.6);
  });

  it("pays a few percent of the gzipped bytes for being readable", () => {
    const doc = flatDoc(4);
    const pretty = serialise(doc);
    const minified = pretty.replace(/\n\s*/g, "");
    expect(bytes(pretty) / bytes(minified)).toBeGreaterThan(1.1);
    expect(gz(pretty) / gz(minified)).toBeLessThan(1.05);
  });

  it("beats a fill attribute per cell most clearly when the paint is welded", () => {
    const doc = { ...flatDoc(4), weldPaint: true };
    const poly = stillOf(doc);
    const use = serialise(doc);
    expect(bytes(drawingOnly(use)) / bytes(drawingOnly(poly))).toBeLessThan(0.7);
    // One rule per colour, not two attributes per cell.
    const colours = new Set(flatten(doc.layers).values());
    expect(use.match(/\.k\d+ \{/g)).toHaveLength(colours.size);
    expect(use.match(/stroke-width/g)?.length).toBe(colours.size + 1);
  });
});

// ── the picture whose cells are not congruent ────────────────────────────

describe("the relief, whose cells are genuinely not congruent", () => {
  it("has far more than two shapes, so the prototype form would not help", () => {
    const hex = buildHexagon(3);
    const surface = buildRelief(hex);
    const baked = reliefFrame(surface, restShell(surface), "convex");
    const shapes = new Set<string>();
    for (const verts of baked.verts) {
      const sorted = [...verts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const o = sorted[0];
      shapes.add(
        sorted
          .map((v) => `${Math.round((v[0] - o[0]) * 100) / 100},${Math.round((v[1] - o[1]) * 100) / 100}`)
          .join(" ")
      );
    }
    expect(shapes.size).toBeGreaterThan(PROTOTYPE_LIMIT);
  });

  it("falls back to polygons, and still round trips", () => {
    const depth = 3;
    const hex = buildHexagon(depth);
    const surface = buildRelief(hex);
    const baked = reliefFrame(surface, restShell(surface), "convex");
    const pf = plateFrame(hex, { mode: "hexagon", sector: 0 });
    const cells = new Map<number, ArtCell>();
    baked.verts.forEach((verts, i) =>
      cells.set(i, { verts: verts.map((v) => [v[0], v[1]] as [number, number]) })
    );
    const layers: EmitLayer[] = [
      { id: "relieved", paint: paintOf(pf.shown, 4, 0) },
    ];
    const doc: EmitDoc = {
      ...docOf(depth, layers),
      cells,
    };
    const once = serialise(doc);
    expect(once).not.toContain("<use ");
    expect(once).not.toContain("<defs>");
    expect(once.match(/<polygon /g)?.length).toBe(pf.shown.length);
    const back = parse(once);
    expect(back).not.toBeNull();
    expect(serialise(back as EmitDoc)).toBe(once);
  });
});

// ── the animation ────────────────────────────────────────────────────────

describe("animation", () => {
  const animated = (): EmitDoc => {
    const { pf } = frameOf(3);
    const steps = 6;
    const layers: EmitLayer[] = [
      { id: "ground", paint: paintOf(pf.shown, 20, 0) },
    ];
    for (let k = 0; k < steps; k++) {
      layers.push({
        id: `s${k}`,
        reveal: k,
        mode: 6,
        orbit: 6,
        paint: new Map(pf.shown.slice(k * 6, k * 6 + 6).map((i) => [i, PALETTE[k % 6]])),
      });
    }
    const doc = docOf(3, layers);
    return {
      ...doc,
      animation: { stepMs: 250, holdMs: 1800, fadeMs: 90, steps },
    };
  };

  const doc = animated();
  const svg = serialise(doc);

  it("is one standalone looping document with no script and nothing to fetch", () => {
    expect(svg.startsWith("<svg xmlns=")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg.match(/<style>/g)).toHaveLength(1);
    expect(svg).not.toMatch(/<script/i);
    expect(svg).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
    expect(svg).not.toMatch(/xlink:href|url\(/);
    expect(svg).toContain("animation-iteration-count: infinite");
    expect(svg).toContain(`animation-duration: ${6 * 250 + 1800}ms`);
  });

  it("writes one rule and one keyframes per STEP, not per cell", () => {
    // The names carry the document's own id, because `@keyframes` has one
    // global namespace per document and nothing scopes it. See `rootIdOf`.
    expect(svg.match(/@keyframes ff[0-9a-f]{6}-r\d+ \{/g)).toHaveLength(6);
    expect(
      svg.match(/\[data-reveal="\d+"\] \{ animation-name: ff[0-9a-f]{6}-r\d+ \}/g)
    ).toHaveLength(6);
    // 36 cells are animated; the rule count does not follow them.
    expect(svg.match(/<use [^>]*class="k/g)?.length).toBeGreaterThan(36);
  });

  it("reveals the steps in order, each later in the cycle than the last", () => {
    const ons = [
      ...svg.matchAll(/@keyframes ff[0-9a-f]{6}-r(\d+) \{ 0%(?:, ([\d.]+)%)? \{/g),
    ].map((m) => Number(m[2] ?? 0));
    expect(ons).toHaveLength(6);
    for (let k = 1; k < ons.length; k++) expect(ons[k]).toBeGreaterThan(ons[k - 1]);
    expect(ons[0]).toBe(0);
    expect(ons[ons.length - 1]).toBeLessThan(100);
  });

  it("imports back with its strokes and its timing intact", () => {
    const back = parse(svg) as EmitDoc;
    expect(back).not.toBeNull();
    expect(back.animation).toEqual({ stepMs: 250, holdMs: 1800, fadeMs: 90, steps: 6 });
    const marks = back.layers.filter((l) => l.reveal !== undefined);
    expect(marks).toHaveLength(6);
    expect(marks.map((l) => l.reveal)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(marks.every((l) => l.mode === 6 && l.orbit === 6)).toBe(true);
    for (let k = 0; k < 6; k++) {
      expect([...(marks[k].paint as ReadonlyMap<number, string>).values()]).toEqual(
        new Array(6).fill(PALETTE[k % 6])
      );
    }
    expect(serialise(back)).toBe(svg);
  });

  it("states the symmetry in the markup, on the group and not on the cells", () => {
    expect(svg).toContain(`<g id="s0" data-reveal="0" data-orbit="6" data-mode="6">`);
    const first = svg.slice(svg.indexOf(`<g id="s0"`));
    const group = first.slice(0, first.indexOf("</g>"));
    expect(group.match(/<use /g)).toHaveLength(6);
    expect(group.match(/data-orbit/g)).toHaveLength(1);
  });
});

// ── gesture provenance ───────────────────────────────────────────────────

/**
 * Whether a gesture is still a gesture after the file has been round tripped.
 *
 * The block above measures one animated document whose gestures are all at the
 * TOP LEVEL and all six-fold, which is the easy shape: a flat list of layers
 * that agree with each other. This one asks the harder question, which is the
 * one that decides whether the format is portable — can a reader open a file
 * this program wrote, find each gesture, say which symmetry made it and how
 * many cells it actually landed, and write the file back out unchanged? So the
 * fixture nests, hides, fades, and mixes brushes, and every assertion below is
 * against a STATED expectation rather than against the document it came from.
 * Comparing a parsed tree to the tree it was parsed from passes just as happily
 * when both sides are empty.
 */
describe("a gesture survives export, import and re-export", () => {
  /**
   * Six gestures under six different brushes: two nested, one hidden, one faded,
   * and one whose ORBIT IS SHORTER THAN ITS BRUSH.
   *
   * `g2` is the case the two fields exist for and the one a single field could
   * not state. A seed cell sitting on a mirror line of the group is stabilised,
   * so a 6-fold brush lays down three cells and not six: `mode` is what the user
   * chose and `orbit` is what the figure gave back, and a reader that derived
   * either from the other would report a six-cell compound path with three cells
   * in it. They are written independently for that reason, and the round trip is
   * asserted on both separately below.
   */
  const gestural = (): EmitDoc => {
    const { pf } = frameOf(3);
    const shown = pf.shown;
    /** `n` cells starting a twelfth of the way along, so the gestures differ. */
    const stroke = (k: number, n: number): Map<number, string> =>
      new Map(
        shown
          .slice(k * 12, k * 12 + n)
          .map((i, j) => [i, PALETTE[(k + j) % PALETTE.length]] as [number, string])
      );
    const layers: EmitLayer[] = [
      // No gesture at all: the plate the strokes were laid on.
      { id: "ground", name: "ground", paint: paintOf(shown, 20, 0) },
      { id: "g0", name: "one fold", reveal: 0, mode: 1, orbit: 1, paint: stroke(0, 1) },
      { id: "g1", name: "three fold", reveal: 1, mode: 3, orbit: 3, paint: stroke(1, 3) },
      {
        id: "g2",
        name: "six fold on a mirror",
        reveal: 2,
        mode: 6,
        // STABILISED. Not a typo and not derivable from `mode`.
        orbit: 3,
        paint: stroke(2, 3),
        children: [
          { id: "g3", name: "twelve fold", reveal: 3, mode: 12, orbit: 12, paint: stroke(3, 12) },
          {
            id: "g4",
            name: "two fold, hidden",
            hidden: true,
            reveal: 4,
            mode: 2,
            orbit: 2,
            paint: stroke(4, 2),
            children: [
              {
                id: "g5",
                name: "six fold, faded",
                opacity: 0.5,
                reveal: 5,
                mode: 6,
                orbit: 6,
                paint: stroke(5, 6),
              },
            ],
          },
        ],
      },
    ];
    return {
      ...docOf(3, layers),
      animation: { stepMs: 250, holdMs: 1800, fadeMs: 90, steps: 6 },
    };
  };

  /**
   * Every layer's provenance, in tree order, one line each, with the PATH so
   * that a gesture that came back at the wrong depth reads as a different line
   * rather than as the same one.
   */
  const provenance = (layers: readonly EmitLayer[], path = ""): string[] => {
    const out: string[] = [];
    for (const l of layers) {
      const say = (k: string, v: number | undefined) => (v === undefined ? "" : ` ${k}=${v}`);
      out.push(
        `${path}${l.id}${say("reveal", l.reveal)}${say("mode", l.mode)}${say("orbit", l.orbit)}`
      );
      if (l.children !== undefined) out.push(...provenance(l.children, `${path}${l.id}/`));
    }
    return out;
  };

  /** What the fixture says, written out rather than read back off itself. */
  const STATED = [
    "ground",
    "g0 reveal=0 mode=1 orbit=1",
    "g1 reveal=1 mode=3 orbit=3",
    "g2 reveal=2 mode=6 orbit=3",
    "g2/g3 reveal=3 mode=12 orbit=12",
    "g2/g4 reveal=4 mode=2 orbit=2",
    "g2/g4/g5 reveal=5 mode=6 orbit=6",
  ];

  const doc = gestural();
  const once = serialise(doc);

  it("is the document the assertions below claim it is", () => {
    // The fixture guarding itself. Everything after this compares a parsed tree
    // to `STATED`, which is worth nothing if the tree it was built from never
    // said that in the first place.
    expect(provenance(doc.layers)).toEqual(STATED);
  });

  it("writes the brush and the realised orbit into the markup, independently", () => {
    // Both, on the group, once each — the compound-path statement an SVG tool
    // that has never heard of this format can still read.
    expect(once).toContain(
      `<g id="g2" data-name="six fold on a mirror" data-reveal="2" data-orbit="3" data-mode="6">`
    );
    expect(once).toContain(`data-reveal="3" data-orbit="12" data-mode="12"`);
    // The hidden gesture keeps its own provenance AND its own flag; hiding a
    // stroke must not erase what made it.
    expect(once).toContain(
      `<g id="g4" data-name="two fold, hidden" display="none" data-reveal="4" data-orbit="2" data-mode="2">`
    );
    expect(once).toContain(`opacity="0.5" data-reveal="5" data-orbit="6" data-mode="6"`);
    // Six gestures, six groups carrying a brush, and not one attribute on a
    // cell: the orbit is the group, which is the whole addressability claim.
    expect(once.match(/data-mode="/g)).toHaveLength(6);
    expect(once.match(/data-orbit="/g)).toHaveLength(6);
    expect(once).not.toMatch(/<use [^>]*data-(?:mode|orbit|reveal)/);
  });

  it("brings every gesture back, at the depth and in the order it was written", () => {
    const back = parse(once);
    expect(back).not.toBeNull();
    const got = back as EmitDoc;
    expect(provenance(got.layers)).toEqual(STATED);
    // Nesting, stated separately: `provenance` prints the path, but a tree that
    // came back flat with slashes in its ids would print the same lines.
    const tree = (l: readonly EmitLayer[]): string =>
      l.map((x) => `${x.id}(${tree(x.children ?? [])})`).join(",");
    expect(tree(got.layers)).toBe("ground(),g0(),g1(),g2(g3(),g4(g5()))");
    expect(got.animation).toEqual({ stepMs: 250, holdMs: 1800, fadeMs: 90, steps: 6 });
    // The stabilised one, called out on its own, because "6 and 3" surviving is
    // the claim and "6 and 6" would survive an implementation that derived one
    // from the other.
    const g2 = findLayer(got.layers, "g2") as EmitLayer;
    expect([g2.mode, g2.orbit]).toEqual([6, 3]);
  });

  it("re-exports to the same bytes, and the re-export is still animated", () => {
    const back = parse(once) as EmitDoc;
    const twice = serialise(back);
    expect(twice).toBe(once);
    // Byte identity already implies this, and it is asserted anyway: the
    // question the round trip was run to answer is whether an IMPORTED file
    // still plays, and "the bytes match" is an answer about the wrong thing if
    // the bytes never carried an animation to begin with.
    expect(twice.match(/@keyframes ff[0-9a-f]{6}-r\d+ \{/g)).toHaveLength(6);
    expect(twice).toMatch(/#ff[0-9a-f]{6} \[data-reveal\] \{ opacity: 0;/);
    expect(twice).toContain("animation-iteration-count: infinite");
    // On the GROUPS, and counted there: `data-reveal="k"` also appears once per
    // step inside the stylesheet, as the selector that gives the step its
    // keyframes, so an unqualified count of the string is twelve and says
    // nothing about how many gestures the file holds.
    expect(twice.match(/<g [^>]*data-reveal="\d+"/g)).toHaveLength(6);
    // And a third pass, because a fixed point reached on the second call is a
    // weaker promise than a fixed point: `parse` reads the payload and the
    // markup separately and only their agreement makes the file stable.
    expect(serialise(parse(twice) as EmitDoc)).toBe(twice);
  });

  it("states the symmetry in a STILL export too, where nothing is playing", () => {
    // A gesture's symmetry is a fact about the gesture. A file exported with the
    // reveal turned off is the same six compound paths made by the same six
    // brushes, and a tool opening it has the same reason to want to address
    // them — so the attributes are written on the `<g>` whether or not there is
    // a stylesheet that animates it.
    const still = serialise({ ...doc, animation: null });
    expect(still).not.toContain("@keyframes");
    expect(still).not.toContain("animation-iteration-count");
    expect(still).toContain(
      `<g id="g2" data-name="six fold on a mirror" data-reveal="2" data-orbit="3" data-mode="6">`
    );
    expect(still.match(/data-mode="/g)).toHaveLength(6);
    expect(still.match(/data-orbit="/g)).toHaveLength(6);
    const back = parse(still) as EmitDoc;
    expect(back.animation).toBeNull();
    expect(provenance(back.layers)).toEqual(STATED);
    expect(serialise(back)).toBe(still);
  });

  it("keeps the provenance when one gesture is copied out on its own", () => {
    // The operation the whole feature is for: select a compound path, copy it,
    // paste it somewhere else. A scoped export is a standalone composition, so
    // the copy has to state what made it just as the file it came from did —
    // otherwise "copy" is where the symmetry gets lost, and it would get lost
    // silently, because the copied drawing looks identical.
    const clip = serialise(doc, { layer: "g2" });
    const back = parse(clip) as EmitDoc;
    expect(back).not.toBeNull();
    expect(provenance(back.layers)).toEqual([
      "g2 reveal=2 mode=6 orbit=3",
      "g2/g3 reveal=3 mode=12 orbit=12",
      "g2/g4 reveal=4 mode=2 orbit=2",
      "g2/g4/g5 reveal=5 mode=6 orbit=6",
    ]);
    expect(serialise(back)).toBe(clip);

    // And through the rename that pasting into a document which already holds
    // those ids forces. `rekey` moves nothing and must therefore change nothing
    // but the ids — a paste that dropped the brush would be a paste that turned
    // four addressable gestures into four anonymous groups.
    const fresh = rekey(back.layers, new Set(["g2", "g3", "g4", "g5"]));
    expect(provenance(fresh)).toEqual([
      "g2-2 reveal=2 mode=6 orbit=3",
      "g2-2/g3-2 reveal=3 mode=12 orbit=12",
      "g2-2/g4-2 reveal=4 mode=2 orbit=2",
      "g2-2/g4-2/g5-2 reveal=5 mode=6 orbit=6",
    ]);
  });

  it("writes no attribute at all for a layer that carries no gesture", () => {
    // Absent, not defaulted and not empty. A `data-mode=""` on every group would
    // be a file claiming a symmetry for the plate itself, and a `data-mode="1"`
    // default would be indistinguishable from a real one-fold stroke.
    const plain = serialise(docOf(2));
    expect(plain).not.toMatch(/data-(?:mode|orbit|reveal)/);
    // And inside a document that DOES carry gestures, the layer that has none
    // still gets nothing.
    expect(once).toContain(`<g id="ground" data-name="ground">`);
  });

  /**
   * What `data-mode` and `data-orbit` cost, measured on a document shaped like a
   * real drawing rather than on the fixture above.
   *
   * 120 gestures on a depth-4 hexagon, each a six-cell orbit — one in seven of
   * them stabilised to three, so the two fields genuinely differ and neither
   * compresses as a copy of the other. Both sides are the same document: the
   * "without" side is this emitter's own output with only those two attributes
   * deleted, so nothing else in the file moves.
   *
   *                    RAW                          GZIPPED
   *   animated   134 018 / 130 538  +2.67%      14 366 / 14 281  +0.60%
   *   still      115 279 / 111 799  +3.11%      12 320 / 12 213  +0.88%
   *
   * THREE PERCENT OF THE RAW BYTES IS A FEW PERCENT, and it is left standing
   * rather than argued down. The raw cost is exactly 29 bytes per gesture —
   * ` data-orbit="6" data-mode="6"` and nothing else — so it is 3480 bytes in
   * both columns and the percentage only moves because the still file is
   * smaller. It reads as a percentage of the whole file because the file is
   * O(cells) and this is O(gestures); on a sparser drawing, or one whose
   * gestures ARE its cells, the same 29 bytes would be a larger fraction, and
   * that is the case where the provenance is most of what there is to say.
   *
   * Gzipped it is under one percent, which is the number that matters for a file
   * that travels. What the two attributes add is highly repetitive text —
   * `data-orbit="6" data-mode="6"` verbatim on 102 of the 120 groups — so
   * deflate charges nearly nothing for them, and the 107 bytes it does charge
   * are mostly the eighteen stabilised groups saying something different from
   * their neighbours. Which is the information.
   *
   * Two ceilings rather than one, because the raw and the gzipped answers differ
   * by a factor of three and a single bound would have to be the loose one.
   */
  it("costs about three percent raw and under one percent gzipped to say all this", () => {
    const { pf } = frameOf(4);
    const shown = pf.shown;
    const layers: EmitLayer[] = [{ id: "ground", paint: paintOf(shown, 20, 0) }];
    for (let k = 0; k < 120; k++) {
      layers.push({
        id: `g${k}`,
        reveal: k,
        mode: 6,
        orbit: k % 7 === 0 ? 3 : 6,
        paint: new Map(
          shown.slice(k * 6, k * 6 + 6).map((i) => [i, PALETTE[k % PALETTE.length]] as [number, string])
        ),
      });
    }
    const base = docOf(4, layers);
    for (const animation of [
      { stepMs: 120, holdMs: 1200, fadeMs: 60, steps: 120 },
      null,
    ] as const) {
      const what = animation === null ? "still" : "animated";
      const svg = serialise({ ...base, animation });
      // The same file with only these two attributes taken out.
      const bare = svg.replace(/ data-(?:mode|orbit)="\d+"/g, "");
      expect(bare).not.toMatch(/data-(?:mode|orbit)/);
      // `data-reveal` is left alone: it predates this and pays for itself in the
      // stylesheet, so charging it here would be charging the animation twice.
      // Counted on the groups — the stylesheet spells it too. See above.
      expect(bare.match(/<g [^>]*data-reveal="/g)).toHaveLength(120);
      // 29 bytes a gesture, and the same 29 whether or not anything is playing.
      expect(bytes(svg) - bytes(bare), `${what} raw`).toBe(120 * 29);
      expect(bytes(svg) / bytes(bare), `${what} raw`).toBeLessThan(1.04);
      expect(gz(svg) / gz(bare), `${what} gzipped`).toBeGreaterThan(1);
      expect(gz(svg) / gz(bare), `${what} gzipped`).toBeLessThan(1.01);
    }
  });
});

// ── untrusted input ──────────────────────────────────────────────────────

describe("a loaded file is untrusted", () => {
  const good = serialise(docOf(2));

  /** The same document with its payload rewritten. */
  const repayload = (
    svg: string,
    edit: (o: Record<string, unknown>) => void
  ): string => {
    const m = /<!-- fourfold:art:1 ([\s\S]*?) -->/.exec(svg) as RegExpExecArray;
    const o = JSON.parse(m[1]) as Record<string, unknown>;
    edit(o);
    // The same dash escape `artfile.commentSafe` applies, so the comment stays
    // a comment. Nothing here writes a negative number.
    return svg.replace(m[0], `<!-- fourfold:art:1 ${JSON.stringify(o).replace(/-/g, "\\u002d")} -->`);
  };

  type Comp = { layers: { id: string; cells?: [number, string][] }[]; shown?: string };
  const comp = (o: Record<string, unknown>) => o.comp as Comp;

  it("returns null and never throws, for everything that is not a file we wrote", () => {
    let nested: unknown = { id: "deep0" };
    for (let k = 1; k < 64; k++) nested = { id: `deep${k}`, children: [nested] };

    const hostile: unknown[] = [
      null,
      undefined,
      42,
      {},
      [],
      "",
      "<svg></svg>",
      "<svg><script>alert(1)</script></svg>",
      // No payload: this format states its cells there, so there is nothing to
      // read the picture against.
      good.replace(/<!-- fourfold:art:1[\s\S]*?-->/, ""),
      // A payload with no composition: an ordinary artwork, not a stack.
      repayload(good, (o) => delete o.comp),
      // Truncated.
      good.slice(0, good.length >> 1),
      // The payload marker with no close.
      good.replace(/(fourfold:art:1[\s\S]*?) -->/, "$1"),
      // Broken JSON in the payload.
      good.replace('{"canvas"', '{"canvas'),
      // A cell index the canvas cannot hold.
      repayload(good, (o) => {
        comp(o).layers[0].cells![0][0] = 999999;
      }),
      // A colour that is not one.
      repayload(good, (o) => {
        comp(o).layers[0].cells![0][1] = "javascript:x" as string;
      }),
      // A layer id colliding with the document's own furniture.
      repayload(good, (o) => {
        comp(o).layers[0].id = "u";
      }),
      // A duplicate id.
      repayload(good, (o) => {
        comp(o).layers[1].id = comp(o).layers[0].id;
      }),
      // An id that is not an XML name.
      repayload(good, (o) => {
        comp(o).layers[0].id = "9 nope";
      }),
      // A frame that leaves the canvas.
      repayload(good, (o) => {
        comp(o).shown = "0-99999";
      }),
      // A layer whose cells are not ascending, which is the order the markup
      // is paired against.
      repayload(good, (o) => {
        comp(o).layers[0].cells = [[5, "#ffffff"], [1, "#ffffff"]];
      }),
      // Nested past what a composition may be.
      repayload(good, (o) => {
        comp(o).layers = [nested as { id: string }];
      }),
      // A `<use>` naming a prototype that is not defined.
      good.replace('href="#u"', 'href="#gone"'),
      // A `<use>` with no position.
      good.replace(/<use href="#u" x="[\d.-]+" y="[\d.-]+"/, '<use href="#u"'),
      // One shape too few for what the payload says the layer paints.
      good.replace(/\n\s*<use href="#[ud]2?" [^\n]*class="k0"\/>/, ""),
      // Unbalanced groups.
      good.replace("</g>\n", ""),
      // A pile of groups, to walk the reader's stack off the end.
      `<svg width="1" height="1">${'<g id="x">'.repeat(200)}`,
    ];
    for (const h of hostile) {
      let out: unknown = "not run";
      expect(() => {
        out = parse(h as string);
      }, String(h).slice(0, 70)).not.toThrow();
      expect(out, String(h).slice(0, 70)).toBeNull();
    }
  });

  it("refuses a file past the size wall rather than chewing on it", () => {
    expect(parse("<svg" + "x".repeat(9 * 1024 * 1024))).toBeNull();
  });

  it("keeps the payload out of the drawing even when a name tries to close the comment", () => {
    const { pf } = frameOf(1);
    const doc = docOf(1, [
      { id: "sneak", name: "a--b -->", paint: paintOf(pf.shown, 2, 0) },
    ]);
    const once = serialise(doc);
    // The comment survives intact: the escape in `artfile.commentSafe` is what
    // makes a name that contains `-->` a name rather than an early close.
    expect(extractArt(once)?.comp?.layers[0].name).toBe("a--b -->");
    expect(serialise(parse(once) as EmitDoc)).toBe(once);
  });

  it("never lets markup hidden in a comment reach the reader", () => {
    const doc = docOf(1);
    const once = serialise(doc);
    const smuggled = once.replace("<rect", '<!-- <g id="ghost"> --><rect');
    const back = parse(smuggled);
    expect(back).not.toBeNull();
    expect((back as EmitDoc).layers.map((l) => l.id)).toEqual(
      doc.layers.map((l) => l.id)
    );
  });
});

// ── the still export is untouched ────────────────────────────────────────

describe("nothing here moved artworkSvg", () => {
  it("writes the bytes it always did for a payload with no composition", () => {
    const doc = docOf(2);
    const still = stillOf(doc);
    expect(still.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(still).toContain("<polygon points=");
    expect(still).not.toContain("<use ");
    expect(still).not.toContain("comp");
  });

  it("writes the payload comment byte for byte as it did before layers existed", () => {
    // A frozen string, deliberately. The still export's bytes are a promise the
    // load path depends on, and the composition field is written last and only
    // when it is there — so this is what catches a future change to `encodeArt`
    // that quietly moves them.
    const svg = artworkSvg({
      width: 10,
      height: 10,
      cells: [{ verts: [[0, 0], [10, 0], [5, 8.66]] }],
      paint: new Map([[0, "#d4a017"]]),
      background: "#0a0908",
      unpainted: null,
      tileSeam: null,
      paintSeam: null,
      seamWidth: 0.5,
      title: "t",
      payload: {
        version: 1,
        canvas: "triangle",
        depth: 1,
        convention: "apex",
        cells: [[0, "#d4a017"]],
      },
    });
    expect(svg).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="10" height="10" role="img">' +
        '<!-- fourfold:art:1 {"canvas":"triangle","depth":1,"convention":"apex","cells":[[0,"#d4a017"]]} -->' +
        "<title>t</title>" +
        '<rect width="10" height="10" fill="#0a0908"/>' +
        "<g>" +
        '<polygon points="0,0 10,0 5,8.66" fill="#d4a017"/>' +
        "</g></svg>"
    );
  });

  it("leaves a payload without layers exactly as it was", () => {
    const doc = docOf(2);
    const svg = serialise(doc);
    const payload = extractArt(svg);
    expect(payload?.comp?.layers).toHaveLength(2);
    // And the flat cell list still says what the picture shows, so a reader
    // that knows nothing about layers still loads the drawing.
    const flat = new Map(payload?.cells);
    expect(flat).toEqual(flatten(doc.layers));
  });
});

// ── ranges ───────────────────────────────────────────────────────────────

describe("the framed cells, as ranges", () => {
  it("round trips a contiguous frame in eight bytes", () => {
    const all = Array.from({ length: 1024 }, (_, i) => i);
    expect(formatRanges(all)).toBe("0-1023");
    expect(parseRanges("0-1023", 6144)).toEqual(all);
  });

  it("round trips a broken one", () => {
    const some = [0, 1, 2, 5, 9, 10];
    expect(formatRanges(some)).toBe("0-2,5,9-10");
    expect(parseRanges("0-2,5,9-10", 100)).toEqual(some);
  });

  it("refuses one that is not ascending, overlaps, or leaves the canvas", () => {
    expect(parseRanges("5,3", 100)).toBeNull();
    expect(parseRanges("0-5,3-9", 100)).toBeNull();
    expect(parseRanges("0-500", 100)).toBeNull();
    expect(parseRanges("a-b", 100)).toBeNull();
    expect(parseRanges("-1", 100)).toBeNull();
    expect(parseRanges("1-", 100)).toBeNull();
  });
});

// ── the layer model contract ─────────────────────────────────────────────

describe("the interface required of the layer model", () => {
  it("finds a layer anywhere in the tree", () => {
    const doc = docOf(1);
    expect(findLayer(doc.layers, "detail")?.id).toBe("detail");
    expect(findLayer(doc.layers, "missing")).toBeNull();
  });

  it("flattens later over earlier, and skips hidden subtrees", () => {
    const stack: EmitLayer[] = [
      { id: "under", paint: new Map([[0, "#111111"], [1, "#111111"]]) },
      { id: "over", paint: new Map([[1, "#222222"]]) },
      { id: "off", hidden: true, paint: new Map([[2, "#333333"]]) },
      {
        id: "offparent",
        hidden: true,
        children: [{ id: "onchild", paint: new Map([[3, "#444444"]]) }],
      },
    ];
    expect([...flatten(stack).entries()]).toEqual([
      [0, "#111111"],
      [1, "#222222"],
    ]);
  });
});

// ── the file is a guest on somebody else's page ──────────────────────────

describe("nothing the file writes escapes the file", () => {
  const animated = (): EmitDoc => {
    const { pf } = frameOf(2);
    const layers: EmitLayer[] = [{ id: "g", paint: paintOf(pf.shown, 20, 0) }];
    for (let k = 0; k < 3; k++) {
      layers.push({
        id: `s${k}`,
        reveal: k,
        paint: new Map(pf.shown.slice(k * 4, k * 4 + 4).map((i) => [i, PALETTE[k]])),
      });
    }
    return { ...docOf(2, layers), animation: { stepMs: 250, holdMs: 1800, fadeMs: 90, steps: 3 } };
  };

  it("scopes every selector under the document's own id", () => {
    const svg = serialise(animated());
    const style = /<style>([\s\S]*?)<\/style>/.exec(svg) as RegExpExecArray;
    const root = /<svg[^>]* id="(ff[0-9a-f]{6})"/.exec(svg)?.[1] as string;
    expect(root).toMatch(/^ff[0-9a-f]{6}$/);

    // Every rule that has a selector at all states this document first. A
    // `.k0` or a `[data-reveal]` on its own is a rule about the whole page.
    const rules = style[1]
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    expect(rules.length).toBeGreaterThan(3);
    for (const rule of rules) {
      if (rule.startsWith("@keyframes") || rule.startsWith("@media")) continue;
      expect(rule, rule).toMatch(new RegExp(`^#${root} `));
    }
    // `@media` wraps a scoped rule rather than a bare one.
    for (const at of rules.filter((r) => r.startsWith("@media"))) {
      expect(at, at).toContain(`{ #${root} `);
    }
    expect(svg).not.toMatch(/\n\s*\.k\d+ \{/);
    expect(svg).not.toMatch(/\n\s*\.tile \{/);
    expect(svg).not.toMatch(/\n\s*\[data-reveal\] \{/);
  });

  it("prefixes every keyframe name, which no scoping mechanism can do for it", () => {
    const svg = serialise(animated());
    const root = /<svg[^>]* id="(ff[0-9a-f]{6})"/.exec(svg)?.[1] as string;
    const names = [...svg.matchAll(/@keyframes ([\w-]+) /g)].map((m) => m[1]);
    expect(names).toHaveLength(3);
    for (const n of names) expect(n).toMatch(new RegExp(`^${root}-r\\d+$`));
    // The rule that names one agrees with it, so the animation still runs.
    for (const n of names) expect(svg).toContain(`animation-name: ${n} }`);
  });

  it("gives two different drawings two different ids, so inlining both is safe", () => {
    const a = serialise(docOf(2));
    const b = serialise(flatDoc(2));
    const idOf = (s: string) => /<svg[^>]* id="(ff[0-9a-f]{6})"/.exec(s)?.[1];
    expect(idOf(a)).not.toBe(idOf(b));
    // And the SAME drawing the same one, twice, or the round trip would not be
    // on bytes.
    expect(idOf(serialise(docOf(2)))).toBe(idOf(a));
  });

  it("honours prefers-reduced-motion, which the exported file could not be told", () => {
    const svg = serialise(animated());
    const root = /<svg[^>]* id="(ff[0-9a-f]{6})"/.exec(svg)?.[1] as string;
    expect(svg).toContain(
      `@media (prefers-reduced-motion: reduce) { #${root} [data-reveal] { animation: none; opacity: 1 } }`
    );
    // A still document says nothing about motion at all.
    expect(serialise(docOf(2))).not.toContain("prefers-reduced-motion");
  });
});

// ── a file that has been somewhere else ──────────────────────────────────

describe("a file that has been through another tool still loads", () => {
  const good = serialise(docOf(2));

  it("reads past an XML declaration, a BOM, a DOCTYPE or a leading newline", () => {
    for (const [what, text] of [
      ["xml declaration", `<?xml version="1.0" encoding="UTF-8"?>\n${good}`],
      ["byte order mark", `﻿${good}`],
      ["doctype", `<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/x.dtd">\n${good}`],
      ["leading newline", `\n\n${good}`],
    ] as const) {
      const back = parse(text);
      expect(back, what).not.toBeNull();
      expect(serialise(back as EmitDoc), what).toBe(good);
    }
  });

  it("reads <use></use> and single-quoted attributes, which are the same document", () => {
    const long = good.replace(
      /<use href="([^"]+)" x="([^"]+)" y="([^"]+)"( class="[^"]+")?\/>/g,
      "<use href=\"$1\" x=\"$2\" y=\"$3\"$4></use>"
    );
    expect(long).not.toBe(good);
    expect(serialise(parse(long) as EmitDoc)).toBe(good);

    const quoted = good.replace(/x="([\d.-]+)" y="([\d.-]+)"/g, "x='$1' y='$2'");
    expect(quoted).not.toBe(good);
    expect(serialise(parse(quoted) as EmitDoc)).toBe(good);
  });

  it("still refuses an <svg> smuggled into the payload rather than taking the first one", () => {
    const { pf } = frameOf(1);
    const sneak = serialise(
      docOf(1, [{ id: "s", name: `<svg width="9" height="9">`, paint: paintOf(pf.shown, 2, 0) }])
    );
    const back = parse(sneak) as EmitDoc;
    // The real root, not the one written inside a comment.
    expect(back.width).toBeGreaterThan(9);
    expect(serialise(back)).toBe(sneak);
  });
});

// ── the reader is stricter about numbers than Number is ──────────────────

describe("parse hardening", () => {
  const good = serialise(docOf(1));

  it("refuses an empty, hexadecimal or exponential number", () => {
    expect(parse(good.replace(/width="[\d.]+" height="[\d.]+"/, 'width="" height=""'))).toBeNull();
    for (const bad of ["0x10", "6.04e2", "+5", "Infinity", "1_0", " "]) {
      const text = good.replace(/(<use href="#[^"]+" x=")([\d.-]+)(")/, `$1${bad}$3`);
      expect(text, bad).not.toBe(good);
      expect(parse(text), bad).toBeNull();
    }
    // And in a prototype's own points, where the same trick moves every cell.
    expect(parse(good.replace(/(<polygon id="u" points=")([^"]+)/, "$10x10,0 8,0 4,8"))).toBeNull();
  });

  it("refuses a duplicate defs id, which this reader and a browser resolve differently", () => {
    const twice = good.replace("</defs>", `  <polygon id="u" points="0,0 4,0 2,4"/>\n  </defs>`);
    expect(twice).not.toBe(good);
    expect(parse(twice)).toBeNull();
  });

  it("reads CDATA as the character data it is, not as elements", () => {
    const cd = good.replace("<rect", '<![CDATA[ <g id="ghost"><use href="#u" x="0" y="0"/> ]]><rect');
    const back = parse(cd);
    expect(back).not.toBeNull();
    expect((back as EmitDoc).layers.map((l) => l.id)).toEqual(
      (parse(good) as EmitDoc).layers.map((l) => l.id)
    );
    expect(serialise(back as EmitDoc)).toBe(good);
  });

  it("does not mistake an element in another namespace for a group", () => {
    const ns = good.replace("<rect", '<g:x id="ghost"><rect');
    const back = parse(ns);
    expect(back).not.toBeNull();
    expect(serialise(back as EmitDoc)).toBe(good);
  });

  it("keeps a numeric character reference meaning what it said", () => {
    const { pf } = frameOf(1);
    const doc = docOf(1, [{ id: "e", paint: paintOf(pf.shown, 2, 0) }]);
    const svg = serialise(doc).replace(
      /<title([^>]*)>[^<]*<\/title>/,
      "<title$1>a &#60; b &#x26; c</title>"
    );
    const back = parse(svg) as EmitDoc;
    // The characters, not the eight bytes that spell them.
    expect(back.title).toBe("a < b & c");
    // And re-serialising says the same thing rather than escaping the escape.
    expect(serialise(back)).toContain("<title id=");
    expect(serialise(back)).toContain("a &lt; b &amp; c");
    expect(serialise(back)).not.toContain("&amp;#60;");
    // One pass: an escaped escape stays escaped.
    const twice = serialise(doc).replace(
      /<title([^>]*)>[^<]*<\/title>/,
      "<title$1>a &amp;lt; b</title>"
    );
    expect((parse(twice) as EmitDoc).title).toBe("a &lt; b");
  });
});

// ── ids the document mints cannot collide with ids it was given ──────────

describe("every id in the document is distinct", () => {
  it("does not hand a prototype the name a layer already has", () => {
    const { pf } = frameOf(2);
    // `u2` is a name `prototypeId` mints and `RESERVED_IDS` does not forbid.
    for (const name of ["u2", "d2", "p", "ux"]) {
      const svg = serialise(docOf(2, [{ id: name, paint: paintOf(pf.shown, 5, 0) }]));
      const ids = [...svg.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
      expect(new Set(ids).size, name).toBe(ids.length);
      expect(ids, name).toContain(name);
      // And every `<use>` still names a shape the file defines.
      const defined = new Set(
        [...svg.matchAll(/<polygon id="([^"]+)"/g)].map((m) => m[1])
      );
      for (const m of svg.matchAll(/<use href="#([^"]+)"/g)) {
        expect(defined.has(m[1]), `${name}: #${m[1]}`).toBe(true);
      }
      expect(serialise(parse(svg) as EmitDoc)).toBe(svg);
    }
  });

  it("does not hand the root or the title a name a layer already has", () => {
    const { pf } = frameOf(2);
    const plain = serialise(docOf(2, [{ id: "a", paint: paintOf(pf.shown, 5, 0) }]));
    const root = /<svg[^>]* id="(ff[0-9a-f]{6})"/.exec(plain)?.[1] as string;

    // A layer named exactly what the document was going to call ITSELF, and
    // one named what it was going to call its own title. Both are legal
    // payloads; neither may end up written twice.
    for (const clash of [root, `${root}-t`]) {
      const svg = serialise(docOf(2, [{ id: clash, paint: paintOf(pf.shown, 5, 0) }]));
      const ids = [...svg.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
      expect(new Set(ids).size, clash).toBe(ids.length);
      expect(ids, clash).toContain(clash);
      // And the label still points at the title element and not at a layer.
      const labelled = /aria-labelledby="([^"]+)"/.exec(svg)?.[1] as string;
      expect(svg, clash).toContain(`<title id="${labelled}">`);
      expect(serialise(parse(svg) as EmitDoc), clash).toBe(svg);
    }
  });
});

// ── the geometric fallback shows what the picture shows ──────────────────

describe("resolvedShapes skips what the picture does not show", () => {
  it("leaves a hidden subtree out, exactly as flatten does", () => {
    const doc = docOf(2, [
      { id: "vis", paint: new Map([[0, "#111111"], [1, "#111111"]]) },
      // Written LAST, so under painter's algorithm it would win every cell it
      // names — and it names one the visible layer already painted.
      {
        id: "gone",
        hidden: true,
        paint: new Map([[0, "#999999"], [2, "#999999"]]),
        children: [{ id: "gonekid", paint: new Map([[3, "#888888"]]) }],
      },
    ]);
    const shapes = resolvedShapes(serialise(doc)) as { fill: string }[];
    const fills = shapes.map((s) => s.fill);
    expect(fills).not.toContain("#999999");
    expect(fills).not.toContain("#888888");
    expect(fills.filter((f) => f === "#111111")).toHaveLength(2);
    // The same answer `flatten` gives, which is the point.
    expect(new Set(flatten(doc.layers).values())).toEqual(new Set(["#111111"]));
  });

  it("still reads a hidden group written as an inline style, which older files use", () => {
    const svg = serialise(docOf(2, [
      { id: "vis", paint: new Map([[0, "#111111"]]) },
      { id: "gone", hidden: true, paint: new Map([[1, "#999999"]]) },
    ]));
    const older = svg.replace(`display="none"`, `style="display:none"`);
    expect(older).not.toBe(svg);
    const fills = (resolvedShapes(older) as { fill: string }[]).map((s) => s.fill);
    expect(fills).not.toContain("#999999");
  });
});

// ── the payload is a comment a person can scroll past ────────────────────

describe("the payload comment wraps", () => {
  it("has no line long enough to stall an editor, at every depth", () => {
    for (const depth of [3, 4, 5]) {
      const svg = serialise(flatDoc(depth));
      const longest = Math.max(...svg.split("\n").map((l) => l.length));
      expect(longest, `depth ${depth}`).toBeLessThan(400);
    }
    // The one line this file used to have, for scale.
    const flat = serialise(flatDoc(5)).replace(
      /(<!-- fourfold:art:1 )([\s\S]*?)( -->)/,
      (_m, a: string, b: string, c: string) => a + b.replace(/\n\s*/g, "") + c
    );
    expect(Math.max(...flat.split("\n").map((l) => l.length))).toBeGreaterThan(60000);
  });

  it("wraps only where a newline is legal JSON, and only outside a string", () => {
    const { pf } = frameOf(2);
    // Names long enough that the wrap must cross one, each holding a comma and
    // a quote — the two characters the scan has to get right. A raw newline
    // inside a JSON string is not JSON, so a break landing in one would be a
    // payload that no longer parses.
    const doc = docOf(
      2,
      Array.from({ length: 6 }, (_, k) => ({
        id: `long${k}`,
        name: `x, "y", ${"z".repeat(100)}`,
        paint: paintOf(pf.shown, 7, k),
      }))
    );
    const svg = serialise(doc);
    const body = /<!-- fourfold:art:1 ([\s\S]*?) -->/.exec(svg)?.[1] as string;
    expect(body).toContain("\n");
    expect(() => JSON.parse(body) as unknown).not.toThrow();
    expect(extractArt(svg)?.comp?.layers[0].name).toBe(doc.layers[0].name);
    expect(serialise(parse(svg) as EmitDoc)).toBe(svg);
  });

  it("keeps the marker readable across the break, which is what makes it safe", () => {
    const svg = serialise(flatDoc(4));
    // `MARKER_HEAD` allows the run of whitespace, `extractArt` finds the body
    // by indexOf, and JSON.parse ignores whitespace between tokens.
    expect(extractArt(svg)).not.toBeNull();
    expect(extractArt(svg)?.comp?.layers).toHaveLength(1);
    // Hand-broken in a different place: still read.
    const rebroken = svg.replace(
      /(<!-- fourfold:art:1 )([\s\S]*?)( -->)/,
      (_m, a: string, b: string, c: string) =>
        a + "\n      " + b.replace(/\n\s*/g, " ") + "\n  " + c
    );
    expect(extractArt(rebroken)?.comp?.layers).toHaveLength(1);
  });

  it("costs the drawing nothing it cannot afford, which is why it is 320 and not 110", () => {
    const doc = flatDoc(4);
    const pretty = serialise(doc);
    const minified = pretty.replace(/\n\s*/g, "");
    // The same ceiling the readability test holds the whole file to.
    expect(gz(pretty) / gz(minified)).toBeLessThan(1.05);
  });
});

// ── what a reader who is not looking at it is told ───────────────────────

describe("the exported file names itself", () => {
  it("carries lang, a title with an id, aria-labelledby and a desc", () => {
    const svg = serialise(docOf(2));
    const root = /<svg[^>]* id="(ff[0-9a-f]{6})"/.exec(svg)?.[1] as string;
    expect(svg).toContain(` lang="en"`);
    expect(svg).toContain(` role="img"`);
    expect(svg).toContain(` aria-labelledby="${root}-t"`);
    expect(svg).toContain(`<title id="${root}-t">`);
    const desc = /<desc>([^<]*)<\/desc>/.exec(svg)?.[1] as string;
    expect(desc).toContain("hexagon");
    expect(desc).toContain("depth 2");
    // The name the label points at is the title, not the description.
    const titled = /<title id="[^"]*">([^<]*)<\/title>/.exec(svg)?.[1] as string;
    expect(titled).toBe("FOURFOLD — hexagon, depth 2");
  });

  it("says the same thing about the drawing that the drawing says", () => {
    const doc = docOf(2);
    const desc = /<desc>([^<]*)<\/desc>/.exec(serialise(doc))?.[1] as string;
    expect(desc).toContain(`${flatten(doc.layers).size} painted cells`);
    expect(desc).toContain("4 layers");
  });
});

// ── the numbers the comments claim ───────────────────────────────────────

describe("the module's own measurements reproduce", () => {
  it("counts the relief's distinct shapes at 278 of 384 and 1130 of 1536", () => {
    const want: Record<number, [number, number]> = { 3: [278, 384], 4: [1130, 1536] };
    for (const depth of [3, 4]) {
      const hex = buildHexagon(depth);
      const surface = buildRelief(hex);
      for (const reading of ["convex", "concave"] as const) {
        const baked = reliefFrame(surface, restShell(surface), reading);
        const shapes = new Set<string>();
        for (const verts of baked.verts) {
          const sorted = [...verts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
          const o = sorted[0];
          shapes.add(
            sorted
              .map(
                (v) =>
                  `${Math.round((v[0] - o[0]) * 100) / 100},${
                    Math.round((v[1] - o[1]) * 100) / 100
                  }`
              )
              .join(" ")
          );
        }
        expect([shapes.size, baked.verts.length], `depth ${depth} ${reading}`).toEqual(
          want[depth]
        );
      }
    }
  });

  it("puts a two-decimal matrix 0.23 units out at depth 5, which is why there is none", () => {
    const { pf } = frameOf(5);
    const ys = new Set<number>();
    for (const c of pf.cells) for (const v of c.verts) ys.add(Math.round(v[1] * 1e6) / 1e6);
    const sorted = [...ys].sort((a, b) => a - b);
    const unit = 512 / 2 ** 5;
    const row = (unit * Math.sqrt(3)) / 2;
    expect(unit).toBe(16);
    // `b` — the lattice row index — reaches 64 on the depth-5 hexagon.
    const rows = Math.round((sorted[sorted.length - 1] - sorted[0]) / row);
    expect(rows).toBe(64);
    const written = Math.round(row * 100) / 100;
    expect(Math.abs(row - written) * rows).toBeCloseTo(0.23, 2);
    // Ten times the precision the geometric importer matches at.
    expect(Math.abs(row - written) * rows).toBeGreaterThan(10 * 10 ** -GEOMETRY_PRECISION);
  });
});

// ── the stylesheet the app itself ships ──────────────────────────────────

describe("draw.module.css carries no residue", () => {
  const css = readFileSync(
    new URL("../src/app/draw/draw.module.css", import.meta.url),
    "utf8"
  );

  it("defines no custom property nothing reads", () => {
    const src = ["src/app/draw/page.tsx", "src/app/draw/draw.module.css"]
      .map((p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8"))
      .join("\n");
    const declared = [...css.matchAll(/^\s*(--[\w-]+):/gm)].map((m) => m[1]);
    expect(declared.length).toBeGreaterThan(0);
    for (const name of new Set(declared)) {
      expect(src.includes(`var(${name})`), `${name} is declared and never read`).toBe(true);
    }
  });

  it("puts every animation it does not defend inside the reduced-motion block", () => {
    const at = css.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(at).toBeGreaterThan(0);
    const block = css.slice(at, css.indexOf("\n}", at));
    // Named because it was the one that got away.
    expect(block).toContain(".menu");
  });

  it("reaches for the token rather than the literal behind it", () => {
    expect(css).not.toContain("#f59e0b");
  });
});
