import { describe, expect, it } from "vitest";
import { gzipSync } from "node:zlib";
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
import { extractArt, formatRanges, parseRanges } from "../src/lib/artfile";
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
    expect(svg).toContain(`<g id="hidden-bits" style="display:none">`);
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
    expect(svg.match(/@keyframes r\d+ \{/g)).toHaveLength(6);
    expect(svg.match(/\[data-reveal="\d+"\] \{ animation-name: r\d+ \}/g)).toHaveLength(6);
    // 36 cells are animated; the rule count does not follow them.
    expect(svg.match(/<use [^>]*class="k/g)?.length).toBeGreaterThan(36);
  });

  it("reveals the steps in order, each later in the cycle than the last", () => {
    const ons = [...svg.matchAll(/@keyframes r(\d+) \{ 0%(?:, ([\d.]+)%)? \{/g)].map(
      (m) => Number(m[2] ?? 0)
    );
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
