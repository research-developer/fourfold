import { describe, expect, it } from "vitest";
import { buildFigure } from "../src/lib/figure";
import { buildHexagon } from "../src/lib/hexagon";
import {
  addressBook,
  addressDepth,
  ancestorAt,
  applyPlateEdits,
  covers,
  depthCensus,
  inheritedColour,
  nearestAncestor,
  planPlateEdits,
  plateEntries,
  plateFromArtPayload,
  resolvePlate,
  sectorTag,
  strandedCount,
  type AddressBook,
  type AddressPlate,
} from "../src/lib/plate";
import {
  encodeArt,
  extractArt,
  payloadFromPaint,
  type ArtPayload,
} from "../src/lib/artfile";
import { clearStroke, commit, EMPTY_HISTORY, undo } from "../src/lib/strokes";

const GOLD = "#d4a017";
const RED = "#c0392b";
const BLUE = "#2b6cc0";

const triBook = (d: number) => addressBook(buildFigure(d));
const hexBook = (d: number) => addressBook(buildHexagon(d));

/** Lay `colour` on the cells named by `addrs`, as one stroke. */
const lay = (
  plate: AddressPlate,
  book: AddressBook,
  addrs: string[],
  colour: string | null
): AddressPlate =>
  applyPlateEdits(
    plate,
    planPlateEdits(plate, book, addrs, addrs.map(() => colour)),
    "do"
  );

/** A plate as a sorted list, so two plates can be compared exactly. */
const snapshot = (p: AddressPlate) =>
  [...p.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));

/** The resolved board as a sorted list of [index, colour]. */
const board = (p: AddressPlate, book: AddressBook) =>
  [...resolvePlate(p, book).entries()].sort((a, b) => a[0] - b[0]);

// ── the address scheme ───────────────────────────────────────────────────

describe("addresses", () => {
  it("names a triangle cell by its own word", () => {
    const f = buildFigure(3);
    const book = addressBook(f);
    expect(book.stem).toBe(0);
    expect(book.addr).toEqual(f.cells.map((c) => c.addr));
    for (const c of f.cells) expect(book.index.get(c.addr)).toBe(c.i);
  });

  it("tags a hexagon cell with its sector, so six sectors do not collide", () => {
    const h = buildHexagon(2);
    const book = addressBook(h);
    expect(book.stem).toBe(3);
    expect(book.index.size).toBe(h.cells.length);
    for (const c of h.cells) {
      expect(book.addr[c.i]).toBe(`${sectorTag(c.sector)}${c.addr}`);
      expect(addressDepth(book.addr[c.i], book.stem)).toBe(2);
    }
    // The same base word in six sectors is six distinct addresses.
    const sameWord = book.addr.filter((a) => a.endsWith(":AB"));
    expect(sameWord.length).toBe(6);
    expect(new Set(sameWord).size).toBe(6);
  });

  it("makes ancestry plain string prefixing, and never across sectors", () => {
    expect(covers("AB", "ABX")).toBe(true);
    expect(covers("AB", "AC")).toBe(false);
    expect(covers("s3:A", "s3:AB")).toBe(true);
    expect(covers("s3:A", "s4:AB")).toBe(false);
    expect(ancestorAt("s3:ABX", 3, 2)).toBe("s3:AB");
    expect(ancestorAt("ABX", 0, 1)).toBe("A");
  });

  it("gives the same addresses under both conventions", () => {
    // The conventions cut the same triangles in the same recursion order and
    // differ only in which vertex plays role A, so an address is the same
    // string at the same index — which is what lets the cache key be (kind,
    // depth) with no convention in it.
    expect(addressBook(buildFigure(3, "ifs")).addr).toEqual(
      addressBook(buildFigure(3, "apex")).addr
    );
  });
});

// ── resolving ────────────────────────────────────────────────────────────

describe("resolvePlate", () => {
  it("gives a child its nearest painted ancestor's colour, exactly", () => {
    const d2 = triBook(2);
    const d4 = triBook(4);
    const plate = lay(new Map(), d2, ["AB"], GOLD);

    // Every depth-4 cell under AB, and nothing else.
    const painted = board(plate, d4);
    expect(painted.length).toBe(16);
    expect(painted.every(([, c]) => c === GOLD)).toBe(true);
    for (const [i] of painted) expect(d4.addr[i].startsWith("AB")).toBe(true);
  });

  it("prefers the NEAREST ancestor when two cover the same cell", () => {
    const d1 = triBook(1);
    const d2 = triBook(2);
    const d3 = triBook(3);
    let plate = lay(new Map(), d1, ["A"], GOLD);
    plate = lay(plate, d2, ["AB"], RED);
    const at3 = resolvePlate(plate, d3);
    expect(at3.get(d3.index.get("ABX") as number)).toBe(RED);
    expect(at3.get(d3.index.get("ACX") as number)).toBe(GOLD);
    expect(nearestAncestor(plate, d3, "ABX")).toBe("AB");
    expect(inheritedColour(plate, d3, "ABX")).toBe(RED);
    expect(nearestAncestor(plate, d3, "ACX")).toBe("A");
    expect(inheritedColour(plate, d3, "ACX")).toBe(GOLD);
    expect(nearestAncestor(plate, d3, "BBB")).toBeNull();
  });

  it("shows a parent the colour its painted descendants agree on", () => {
    const d2 = triBook(2);
    const d4 = triBook(4);
    // Only a quarter of AB is painted, and all of it is one colour.
    const plate = lay(new Map(), d4, ["ABAA", "ABAB"], RED);
    expect(resolvePlate(plate, d2).get(d2.index.get("AB") as number)).toBe(RED);
  });

  it("shows nothing where the descendants disagree — and keeps both", () => {
    const d2 = triBook(2);
    const d4 = triBook(4);
    let plate = lay(new Map(), d4, ["ABAA"], RED);
    plate = lay(plate, d4, ["ABAB"], BLUE);
    expect(resolvePlate(plate, d2).has(d2.index.get("AB") as number)).toBe(false);
    // The disagreement is a rendering decision, not a loss.
    expect(resolvePlate(plate, d4).get(d4.index.get("ABAA") as number)).toBe(RED);
    expect(resolvePlate(plate, d4).get(d4.index.get("ABAB") as number)).toBe(BLUE);
  });

  it("lets an exact paint outrank a disagreeing subtree", () => {
    const d2 = triBook(2);
    const d4 = triBook(4);
    let plate = lay(new Map(), d2, ["AB"], GOLD);
    plate = lay(plate, d4, ["ABAA"], RED);
    // Zooming out shows the coarse stroke rather than going blank.
    expect(resolvePlate(plate, d2).get(d2.index.get("AB") as number)).toBe(GOLD);
    // And the detail is still there when you go back in.
    expect(resolvePlate(plate, d4).get(d4.index.get("ABAA") as number)).toBe(RED);
    expect(resolvePlate(plate, d4).get(d4.index.get("ABAB") as number)).toBe(GOLD);
  });

  it("is memoised on plate identity, so a re-render is free", () => {
    const book = triBook(4);
    const plate = lay(new Map(), book, ["ABAA"], RED);
    expect(resolvePlate(plate, book)).toBe(resolvePlate(plate, book));
    // A different depth of the same plate is a different, also-cached view.
    const other = triBook(2);
    expect(resolvePlate(plate, other)).not.toBe(resolvePlate(plate, book));
    expect(resolvePlate(plate, other)).toBe(resolvePlate(plate, other));
  });
});

// ── the round trip the whole thing exists for ────────────────────────────

describe("a depth change is lossless", () => {
  it("triangle: paint at d4, drop to d2, return to d4 — plate identical", () => {
    const d4 = triBook(4);
    const d2 = triBook(2);
    const cells = ["ABAA", "ABAB", "ACXA", "XXXA", "BBBB"];
    const plate = lay(new Map(), d4, cells, RED);

    const before = snapshot(plate);
    const at4 = board(plate, d4);

    // Drop to d2 and back. Nothing writes; the plate is the same object.
    resolvePlate(plate, d2);
    const after = snapshot(plate);
    const back = board(plate, d4);

    expect(after).toEqual(before);
    expect(back).toEqual(at4);
  });

  it("hexagon d4: the same, across all six sectors", () => {
    const d4 = hexBook(4);
    const d2 = hexBook(2);
    const cells = [0, 1, 2, 3, 4, 5].map((s) => `s${s}:ABAX`);
    const plate = lay(new Map(), d4, cells, BLUE);

    const before = snapshot(plate);
    const at4 = board(plate, d4);
    expect(board(plate, d2).length).toBe(6);
    expect(snapshot(plate)).toEqual(before);
    expect(board(plate, d4)).toEqual(at4);
  });

  it("keeps every depth a plate has ever been painted at", () => {
    const d2 = triBook(2);
    const d4 = triBook(4);
    let plate = lay(new Map(), d2, ["AB"], GOLD);
    plate = lay(plate, d4, ["ABAA"], RED);
    plate = lay(plate, d4, ["ACAA"], BLUE);
    expect([...depthCensus(plate, 0)]).toEqual([
      [2, 1],
      [4, 2],
    ]);
  });
});

// ── the subtle one: stale descendants must not resurrect ─────────────────

describe("a coarse paint clears what is under it", () => {
  it("does not let depth-4 detail come back after a depth-2 stroke", () => {
    const d2 = triBook(2);
    const d4 = triBook(4);
    let plate = lay(new Map(), d4, ["ABAA", "ABBB"], RED);
    plate = lay(plate, d2, ["AB"], GOLD);

    // Nothing under AB survives except AB itself.
    expect(snapshot(plate)).toEqual([["AB", GOLD]]);
    const at4 = resolvePlate(plate, d4);
    for (const [a, i] of d4.index) {
      if (a.startsWith("AB")) expect(at4.get(i)).toBe(GOLD);
    }
  });

  it("clears even when the coarse stroke lays the SAME colour", () => {
    // The trap: nothing changes on screen at depth 2, so a writer that asks
    // "would this be visible?" emits no edits and the stale detail survives.
    const d2 = triBook(2);
    const d4 = triBook(4);
    let plate = lay(new Map(), d4, ["ABAA"], GOLD);
    plate = lay(plate, d2, ["AB"], GOLD);
    expect(snapshot(plate)).toEqual([["AB", GOLD]]);
    expect(resolvePlate(plate, d4).size).toBe(16);
  });

  it("does not clear a sibling the stroke did not cover", () => {
    const d2 = triBook(2);
    const d4 = triBook(4);
    let plate = lay(new Map(), d4, ["ABAA", "ACAA"], RED);
    plate = lay(plate, d2, ["AB"], GOLD);
    expect(snapshot(plate)).toEqual([
      ["ABAA".slice(0, 2), GOLD],
      ["ACAA", RED],
    ]);
  });

  it("undo puts the cleared detail back, exactly", () => {
    const d2 = triBook(2);
    const d4 = triBook(4);
    const start = lay(new Map(), d4, ["ABAA", "ABBB"], RED);
    const edits = planPlateEdits(start, d2, ["AB"], [GOLD]);
    const after = applyPlateEdits(start, edits, "do");
    const back = applyPlateEdits(after, edits, "undo");
    expect(snapshot(back)).toEqual(snapshot(start));
  });
});

// ── erasing has to break the ancestor ────────────────────────────────────

describe("erase", () => {
  it("splits the ancestor rather than deleting nothing", () => {
    const d2 = triBook(2);
    const d3 = triBook(3);
    let plate = lay(new Map(), d2, ["AB"], GOLD);
    plate = lay(plate, d3, ["ABA"], null);

    expect(resolvePlate(plate, d3).has(d3.index.get("ABA") as number)).toBe(false);
    for (const w of ["ABB", "ABC", "ABX"]) {
      expect(resolvePlate(plate, d3).get(d3.index.get(w) as number)).toBe(GOLD);
    }
    // AB itself is gone; its other children carry the colour now.
    expect(plate.has("AB")).toBe(false);
    expect(snapshot(plate)).toEqual([
      ["ABB", GOLD],
      ["ABC", GOLD],
      ["ABX", GOLD],
    ]);
  });

  it("splits several levels at once, and skips a child that has its own paint", () => {
    const d1 = triBook(1);
    const d3 = triBook(3);
    let plate = lay(new Map(), d1, ["A"], GOLD);
    plate = lay(plate, d3, ["ABC"], RED);
    plate = lay(plate, d3, ["ABA"], null);

    const at3 = resolvePlate(plate, d3);
    expect(at3.has(d3.index.get("ABA") as number)).toBe(false);
    expect(at3.get(d3.index.get("ABC") as number)).toBe(RED);
    expect(at3.get(d3.index.get("ABB") as number)).toBe(GOLD);
    expect(at3.get(d3.index.get("ACC") as number)).toBe(GOLD);
    expect(at3.get(d3.index.get("AXX") as number)).toBe(GOLD);
    // Everything outside A is untouched.
    expect(at3.has(d3.index.get("BBB") as number)).toBe(false);
  });

  it("splits once when several holes share an ancestor", () => {
    const d2 = triBook(2);
    const d3 = triBook(3);
    let plate = lay(new Map(), d2, ["AB"], GOLD);
    plate = lay(plate, d3, ["ABA", "ABB"], null);
    const at3 = resolvePlate(plate, d3);
    expect(at3.has(d3.index.get("ABA") as number)).toBe(false);
    expect(at3.has(d3.index.get("ABB") as number)).toBe(false);
    expect(at3.get(d3.index.get("ABC") as number)).toBe(GOLD);
    expect(at3.get(d3.index.get("ABX") as number)).toBe(GOLD);
    expect(plate.has("AB")).toBe(false);
  });

  it("round-trips: erase then undo restores the ancestor", () => {
    const d2 = triBook(2);
    const d3 = triBook(3);
    const start = lay(new Map(), d2, ["AB"], GOLD);
    const edits = planPlateEdits(start, d3, ["ABA"], [null]);
    const gone = applyPlateEdits(start, edits, "do");
    expect(snapshot(applyPlateEdits(gone, edits, "undo"))).toEqual(snapshot(start));
  });

  it("is a no-op where there was nothing to erase", () => {
    const d3 = triBook(3);
    expect(planPlateEdits(new Map(), d3, ["ABA"], [null])).toEqual([]);
  });

  it("clears an entire subtree from above", () => {
    const d2 = triBook(2);
    const d4 = triBook(4);
    let plate = lay(new Map(), d4, ["ABAA", "ABAB"], RED);
    plate = lay(plate, d2, ["AB"], null);
    expect(snapshot(plate)).toEqual([]);
  });
});

// ── undo across a depth change ───────────────────────────────────────────

describe("history survives a depth change", () => {
  it("undoes a depth-4 stroke exactly while the board shows depth 2", () => {
    const d4 = triBook(4);
    const d2 = triBook(2);

    let plate: AddressPlate = new Map();
    let history = commit(EMPTY_HISTORY, {
      edits: planPlateEdits(plate, d4, ["ABAA", "ABAB"], [RED, RED]),
    });
    plate = applyPlateEdits(plate, history.past[0].edits, "do");
    const painted = snapshot(plate);

    // The user drops to depth 2 — no write happens, the plate is untouched —
    // and then presses undo.
    expect(snapshot(plate)).toEqual(painted);
    const step = undo(history);
    expect(step.stroke).not.toBeNull();
    plate = applyPlateEdits(plate, step.stroke!.edits, "undo");
    history = step.history;

    expect(snapshot(plate)).toEqual([]);
    // And the depth-4 view agrees, because the plate is the only state there is.
    expect(resolvePlate(plate, d4).size).toBe(0);
    expect(resolvePlate(plate, d2).size).toBe(0);
  });

  it("clear takes back every depth at once, and undoes to all of them", () => {
    const d2 = triBook(2);
    const d4 = triBook(4);
    let plate = lay(new Map(), d2, ["CB"], GOLD);
    plate = lay(plate, d4, ["ABAA"], RED);
    const before = snapshot(plate);

    const stroke = clearStroke(plate);
    expect(stroke.edits.length).toBe(2);
    const cleared = applyPlateEdits(plate, stroke.edits, "do");
    expect(snapshot(cleared)).toEqual([]);
    expect(snapshot(applyPlateEdits(cleared, stroke.edits, "undo"))).toEqual(before);
  });
});

// ── the file ─────────────────────────────────────────────────────────────

describe("the art file carries the address plate", () => {
  it("omits the field for a plate painted at one depth — same bytes as before", () => {
    const d4 = triBook(4);
    const plate = lay(new Map(), d4, ["ABAA", "ABAB"], RED);
    expect(plateEntries(plate, d4)).toBeUndefined();

    const paint = resolvePlate(plate, d4);
    const withField = payloadFromPaint(
      "triangle",
      4,
      "apex",
      paint,
      undefined,
      plateEntries(plate, d4)
    );
    const without = payloadFromPaint("triangle", 4, "apex", paint);
    expect(withField.plate).toBeUndefined();
    expect(encodeArt(withField)).toBe(encodeArt(without));
    expect(encodeArt(withField)).not.toContain("plate");
  });

  it("carries the field when the plate spans depths, and restores it exactly", () => {
    const d2 = triBook(2);
    const d4 = triBook(4);
    let plate = lay(new Map(), d2, ["AB"], GOLD);
    plate = lay(plate, d4, ["ACAA"], RED);

    const entries = plateEntries(plate, d4);
    expect(entries).toEqual([
      ["AB", GOLD],
      ["ACAA", RED],
    ]);

    const payload = payloadFromPaint(
      "triangle",
      4,
      "apex",
      resolvePlate(plate, d4),
      undefined,
      entries
    );
    const read = extractArt(`<svg>${encodeArt(payload)}</svg>`);
    expect(read).not.toBeNull();
    expect(snapshot(plateFromArtPayload(read as ArtPayload, d4))).toEqual(
      snapshot(plate)
    );
  });

  it("reads a file with no address field as a plate at the declared depth", () => {
    const d3 = triBook(3);
    const old: ArtPayload = {
      version: 1,
      canvas: "triangle",
      depth: 3,
      convention: "apex",
      cells: [
        [0, GOLD],
        [5, RED],
      ],
    };
    const plate = plateFromArtPayload(old, d3);
    expect(plate.get(d3.addr[0])).toBe(GOLD);
    expect(plate.get(d3.addr[5])).toBe(RED);
    expect(plate.size).toBe(2);
  });

  it("survives the comment escape, and the hexagon's tags", () => {
    const d3 = hexBook(3);
    const d2 = hexBook(2);
    let plate = lay(new Map(), d2, ["s4:AB"], GOLD);
    plate = lay(plate, d3, ["s0:ABX"], RED);
    const payload = payloadFromPaint(
      "hexagon",
      3,
      "apex",
      resolvePlate(plate, d3),
      undefined,
      plateEntries(plate, d3)
    );
    const read = extractArt(`<svg>${encodeArt(payload)}</svg>`);
    expect(snapshot(plateFromArtPayload(read as ArtPayload, d3))).toEqual(
      snapshot(plate)
    );
  });

  it("rejects a malformed address field outright", () => {
    const good = payloadFromPaint("triangle", 2, "apex", new Map([[0, GOLD]]));
    const bad = (plate: unknown) =>
      extractArt(
        `<svg><!-- fourfold:art:1 ${JSON.stringify({
          canvas: good.canvas,
          depth: good.depth,
          convention: good.convention,
          cells: good.cells,
          plate,
        })} --></svg>`
      );
    expect(bad([["AB", GOLD]])).not.toBeNull();
    expect(bad([["AD", GOLD]])).toBeNull(); // D is not a cut
    expect(bad([["s9:AB", GOLD]])).toBeNull(); // a sector tag on a triangle
    expect(bad([["AB", "not a colour"]])).toBeNull();
    expect(bad([["AB", GOLD], ["AB", RED]])).toBeNull(); // named twice
    expect(bad([["ABCXABCX", GOLD]])).toBeNull(); // deeper than this build draws
    expect(bad("AB")).toBeNull();
    expect(bad([["AB"]])).toBeNull();
  });

  it("rejects a hexagon address with no sector tag", () => {
    const good = payloadFromPaint("hexagon", 2, "apex", new Map([[0, GOLD]]));
    const read = (plate: unknown) =>
      extractArt(
        `<svg><!-- fourfold:art:1 ${JSON.stringify({
          canvas: good.canvas,
          depth: good.depth,
          convention: good.convention,
          cells: good.cells,
          plate,
        })} --></svg>`
      );
    expect(read([["s3:AB", GOLD]])).not.toBeNull();
    expect(read([["AB", GOLD]])).toBeNull();
    expect(read([["s6:AB", GOLD]])).toBeNull();
  });
});

// ── cost ─────────────────────────────────────────────────────────────────

describe("resolution cost", () => {
  it("resolves a depth-4 hexagon plate well inside a frame", () => {
    const book = hexBook(4);
    expect(book.addr.length).toBe(1536);

    // A full plate, painted at the render depth — the worst case for the exact
    // lookup and the best case for the prefix walk. Then the same again with a
    // quarter of it moved a level deeper, which is what forces the walk.
    const flat = new Map(book.addr.map((a, i) => [a, i % 2 ? GOLD : RED]));
    const deep = new Map(flat);
    for (const [i, a] of book.addr.entries()) {
      if (i % 4 !== 0) continue;
      deep.delete(a);
      for (const g of ["A", "B", "C", "X"]) deep.set(a + g, BLUE);
    }

    const time = (p: Map<string, string>) => {
      const runs = 200;
      const t0 = performance.now();
      for (let k = 0; k < runs; k++) {
        // A fresh Map each time, so the identity cache never hits and what is
        // measured is a COLD resolution — the cost the paint loop pays on every
        // application, not the cost a re-render pays.
        resolvePlate(new Map(p), book);
      }
      return (performance.now() - t0) / runs;
    };

    const flatMs = time(flat);
    const deepMs = time(deep);

    console.log(
      `resolvePlate, hexagon d4 (1536 cells): ${flatMs.toFixed(3)} ms cold ` +
        `at one depth, ${deepMs.toFixed(3)} ms with a quarter of it a level deeper`
    );
    // A frame is 16.7 ms and this runs at most once per pointer event. The
    // bound is a wall a long way past anything measured, not a threshold.
    expect(flatMs).toBeLessThan(8);
    expect(deepMs).toBeLessThan(8);
  });

  it("a warm resolution is one lookup", () => {
    const book = hexBook(4);
    const plate = new Map(book.addr.map((a, i) => [a, i % 2 ? GOLD : RED]));
    resolvePlate(plate, book);
    const t0 = performance.now();
    for (let k = 0; k < 10000; k++) resolvePlate(plate, book);
    const per = (performance.now() - t0) / 10000;

    console.log(`resolvePlate, warm: ${(per * 1000).toFixed(3)} µs`);
    expect(per).toBeLessThan(0.01);
  });
});

/**
 * THE PHANTOMS, COUNTED — because a comment claimed they already were.
 *
 * `buildView`'s header used to end "`test/rep9format.test.ts` pins the behaviour
 * so it is a counted precondition and not a surprise". A vitest assertion pins a
 * behaviour; it is not a count and it does not reach words. Every other decline
 * in this program reaches `setAnnounce` and this one reached nothing, while
 * `layers.census.addresses` went on counting such an address beside drawable
 * paint and inflating the export sentence with it.
 *
 * Reachable from a FILE: `artfile.validatePlate` deliberately does not cross-check
 * an address against the payload depth, so a rep-9 word loads into a rep-4 book,
 * resolves nowhere, survives a full-sector wash, and is re-exported forever.
 */
describe("addresses this canvas cannot draw are counted", () => {
  const book: AddressBook = addressBook(buildHexagon(2, "apex"));

  it("an ordinary plate strands nothing", () => {
    const plate: AddressPlate = new Map([
      ["s0:AA", "#c0392b"],
      ["s0:AB", "#2e86c1"],
      ["s1:A", "#1e8449"], // coarser than the book: resolves by inheritance
    ]);
    expect(strandedCount(plate, book)).toBe(0);
    // And every one of them reaches a cell.
    expect(resolvePlate(plate, book).size).toBeGreaterThan(0);
  });

  it("a rep-9 first cut in a rep-4 book is stranded, and is still carried", () => {
    const plate: AddressPlate = new Map([
      ["s0:AA", "#c0392b"],
      ["s0:ab", "#7d3c98"], // rep-9 cuts where this canvas cut rep-4
    ]);
    expect(strandedCount(plate, book)).toBe(1);
    // NOT DRAWN — which is `buildView`'s own answer and is unchanged.
    const drawn = resolvePlate(plate, book);
    expect([...drawn.values()]).not.toContain("#7d3c98");
    // AND NOT LOST: it is still in the plate and `plateEntries` re-exports it.
    expect(plate.get("s0:ab")).toBe("#7d3c98");
    expect(plateEntries(plate, book)?.map(([a]) => a)).toContain("s0:ab");
  });

  it("counts every stranded entry, not every stranded bucket", () => {
    const plate: AddressPlate = new Map([
      ["s0:ab", "#7d3c98"],
      ["s0:abc", "#1e8449"], // same bucket key prefix, a second entry
      ["s0:ba", "#c0392b"],
    ]);
    expect(strandedCount(plate, book)).toBe(3);
  });

  it("a finer address that genuinely refines a cell is NOT stranded", () => {
    // `s0:ABa` is a rep-9 cut UNDER a rep-4 cell — mixed radix downwards, which
    // buckets under `s0:AB` exactly and is the whole point of the alphabet.
    const plate: AddressPlate = new Map([["s0:ABa", "#7d3c98"]]);
    expect(strandedCount(plate, book)).toBe(0);
  });

  it("is memoised with the resolution it is built beside", () => {
    const plate: AddressPlate = new Map([["s0:ab", "#7d3c98"]]);
    resolvePlate(plate, book);
    // Same plate identity, same book: the second call is a map lookup, and it
    // must give the same answer or the cache is lying.
    expect(strandedCount(plate, book)).toBe(strandedCount(plate, book));
  });
});
