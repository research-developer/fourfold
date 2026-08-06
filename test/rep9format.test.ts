/**
 * THE ADDRESS ALPHABET AS THE RADIX SCHEDULE.
 *
 * `docs/rep-tile-findings.md` Q2 left the file format one open item — *"a rep-9
 * address needs nine letters; a mixed address needs the radix schedule to be
 * recoverable"* — and `scale.ts` priced the recovery as a schedule field in the
 * payload. This file measures the claim that no such field is needed, and the
 * claim is about the ALPHABET and not about any code: if the two radices' letters
 * are disjoint then every character states the edge division of its own cut, a
 * word is a self-describing mixed-radix numeral, and `radixAt` answers by reading
 * one character.
 *
 * ── What is decided here, and by what ────────────────────────────────────
 *
 * SELF-DESCRIPTION, by exhaustion over the alphabet and over every word of up to
 * three cuts, against an oracle that maps each character INDEPENDENTLY and never
 * looks at the word. That oracle is the whole content of the claim: if it agrees
 * with `scaleOfWord` then no word context is being read, which is what "the
 * letter answers" means.
 *
 * THE REFUTATION OF THE OVERLAPPING SPELLING, because a property that cannot
 * fail is not a measurement. `docs/rep9-charge.md` offers `A B C` / `a b c` /
 * `X Y Z` as "one admissible spelling". Its NAMING — by (vertex, grade) rather
 * than by index order — is what `scale.REP9_LETTERS` implements. Its CHARACTERS
 * are refused, and the test below shows exactly what they cost: under that
 * spelling the single word `ABX` has four admissible scales, so an address stops
 * determining its own scale, `plate.ts`'s resolution comparison stops having an
 * answer, and the schedule has to go in the file after all.
 *
 * THE PLATE'S FOUR RESOLUTION RULES under a mixed alphabet, cell by cell, and
 * the WRITE path separately, because the write path is the half that actually
 * changed: a node's siblings are the letters of the cut that made it, and with
 * two radices that question has two answers.
 *
 * BYTE IDENTITY for rep-4 documents, on literals pinned from the tree BEFORE the
 * alphabet was widened, on the discipline `test/byteidentity.test.ts` sets out —
 * a re-encode would pass on any consistent wrong answer.
 *
 * ── The books are hand-built, and that is deliberate ─────────────────────
 *
 * `AddressBook` is an address LIST plus a scale; it is not a picture. The rep-9
 * and mixed books below are built here from the alphabet rather than from a
 * figure, so this file measures the FORMAT and the PLATE with no dependency on
 * whether a rep-9 renderer exists yet. Where a rep-4 book is wanted, the real
 * `buildFigure` / `buildHexagon` are used, because there the canvas exists and a
 * hand-built stand-in would be a fixture agreeing with the implementation about
 * the thing under test.
 */

import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  ADDRESS_LETTERS,
  addressCount,
  addressWord,
  cellCount,
  encodeArt,
  extractArt,
  lettersAt,
  MAX_DEPTH,
  MAX_LAYER_DEPTH,
  MAX_LAYERS,
  MAX_SCALE,
  payloadFromPaint,
  REP4_LETTERS,
  type ArtPayload,
} from "../src/lib/artfile";
import {
  EDGE_DIVISION,
  REP9_EDGE_DIVISION,
  REP9_LETTERS,
  radixAt,
  scaleOfWord,
} from "../src/lib/scale";
import {
  addressBook,
  applyPlateEdits,
  ancestorAt,
  covers,
  descendantsOf,
  DIGITS,
  inheritedColour,
  nearestAncestor,
  planPlateEdits,
  plateEntries,
  resolvePlate,
  sectorTag,
  STEM,
  type Address,
  type AddressBook,
  type AddressPlate,
} from "../src/lib/plate";
import { buildFigure } from "../src/lib/figure";
import { buildHexagon } from "../src/lib/hexagon";

const GOLD = "#d4a017";
const RED = "#c0392b";
const BLUE = "#2b6cc0";

/** Every word of exactly `n` cuts over `letters`. */
function words(letters: string, n: number): string[] {
  let out = [""];
  for (let k = 0; k < n; k++) {
    const next: string[] = [];
    for (const w of out) for (const ch of letters) next.push(w + ch);
    out = next;
  }
  return out;
}

/**
 * Every word of 1…`n` cuts over `letters`.
 *
 * Appended one at a time rather than spread: the whole alphabet to five cuts is
 * 402,233 words, and `push(...)` at that size is a call with 371,293 arguments
 * and a blown stack.
 */
const wordsUpTo = (letters: string, n: number): string[] => {
  const out: string[] = [];
  for (let k = 1; k <= n; k++) for (const w of words(letters, k)) out.push(w);
  return out;
};

/** A plate as a sorted list, so two plates can be compared exactly. */
const snapshot = (p: AddressPlate) =>
  [...p.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));

/** The resolved board as address → colour, which is what a reader can check. */
const board = (p: AddressPlate, book: AddressBook): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [i, hex] of resolvePlate(p, book)) out[book.addr[i]] = hex;
  return out;
};

/**
 * A book over an arbitrary radix SCHEDULE — one edge division per level.
 *
 * `[3, 3]` is a rep-9 canvas two cuts deep; `[2, 3, 2]` is a mixed one. The scale
 * is read back out of the addresses by `scaleOfWord` rather than multiplied here,
 * so if the alphabet and the schedule ever disagreed this would say so rather
 * than paper over it.
 */
function schedBook(schedule: readonly number[], name: string): AddressBook {
  const addr: Address[] = [];
  const walk = (w: string, level: number): void => {
    if (level === schedule.length) {
      addr.push(w);
      return;
    }
    for (const ch of lettersAt(schedule[level])) walk(w + ch, level + 1);
  };
  walk("", 0);
  const index = new Map<Address, number>();
  addr.forEach((a, i) => index.set(a, i));
  return {
    kind: "triangle",
    depth: schedule.length,
    scale: scaleOfWord(addr[0]),
    addr,
    index,
    stem: 0,
    id: name,
  };
}

const sha256 = (s: string): string =>
  createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");

// ── 1. the alphabet encodes the radix ────────────────────────────────────

describe("the alphabet is the radix schedule", () => {
  it("spells the two radices with disjoint characters", () => {
    const four = new Set(REP4_LETTERS);
    const nine = new Set(REP9_LETTERS);
    expect(four.size).toBe(4);
    expect(nine.size).toBe(9);
    for (const ch of nine) expect(four.has(ch)).toBe(false);
    for (const ch of four) expect(nine.has(ch)).toBe(false);
    // No third source of letters: the address alphabet is exactly the two.
    expect([...ADDRESS_LETTERS].sort().join("")).toBe(
      [...four, ...nine].sort().join("")
    );
    expect(new Set(ADDRESS_LETTERS).size).toBe(13);
  });

  it("gives every letter exactly one edge division, read off the letter alone", () => {
    for (const ch of ADDRESS_LETTERS) {
      const k = REP4_LETTERS.includes(ch) ? EDGE_DIVISION : REP9_EDGE_DIVISION;
      expect(radixAt(ch, 0)).toBe(k);
      // THE SAME ANSWER AT EVERY POSITION OF EVERY CONTEXT. This is what makes
      // the address self-describing rather than merely decodable: no prefix, no
      // level parity and no neighbouring letter can change the answer.
      for (const pad of ["", "A", "aA", "ABCX", "uvwxy"]) {
        expect(radixAt(pad + ch, pad.length)).toBe(k);
      }
    }
    expect(lettersAt(EDGE_DIVISION).join("")).toBe(REP4_LETTERS);
    expect(lettersAt(REP9_EDGE_DIVISION).join("")).toBe(REP9_LETTERS);
    // Memoised, so the answer must be the same object and not a fresh sieve.
    expect(lettersAt(EDGE_DIVISION)).toBe(lettersAt(EDGE_DIVISION));
    // A radix the alphabet does not spell gets no invented letters.
    expect(lettersAt(4)).toEqual([]);
    expect(lettersAt(9)).toEqual([]);
    // `plate.DIGITS` is the rep-4 answer and not a second spelling of it.
    expect(DIGITS.join("")).toBe(REP4_LETTERS);
  });

  it("makes a word's scale the product of its letters, over 2,379 words", () => {
    // The oracle maps each character INDEPENDENTLY. `scaleOfWord` walks the word
    // through `radixAt`; if the two agree on every word then no word context is
    // being read anywhere in that walk.
    const perLetter = (ch: string): number =>
      REP4_LETTERS.includes(ch) ? EDGE_DIVISION : REP9_EDGE_DIVISION;
    let checked = 0;
    for (const w of wordsUpTo(ADDRESS_LETTERS, 3)) {
      let product = 1;
      for (const ch of w) product *= perLetter(ch);
      expect(scaleOfWord(w)).toBe(product);
      checked++;
    }
    expect(checked).toBe(13 + 13 ** 2 + 13 ** 3);
    // The three readings a mixed word has to keep apart.
    expect(scaleOfWord("ABC")).toBe(8);
    expect(scaleOfWord("abc")).toBe(27);
    expect(scaleOfWord("ABa")).toBe(12);
    expect(scaleOfWord("aAB")).toBe(12);
    expect(scaleOfWord("abA")).toBe(18);
  });

  it("keeps the sector tag outside the cut alphabet", () => {
    // `plate.ts` gets prefix-equals-ancestry across sectors from this, and the
    // argument was written when there were four letters. Thirteen now.
    for (const ch of "s:0123456789") {
      expect(ADDRESS_LETTERS.includes(ch)).toBe(false);
    }
    expect(sectorTag(3)).toBe("s3:");
    expect(sectorTag(3).length).toBe(STEM.hexagon);
  });

  /**
   * THE GUARD-FIRE, and it is the reason this file exists rather than a comment.
   *
   * Disjointness is a property that could be true by luck, so the test that
   * matters is the one showing what its failure would cost. `docs/rep9-charge.md`
   * proposes `A B C` for the corner class, `a b c` for the edge class and
   * `X Y Z` for the inverted class — a spelling that overlaps `[ABCX]` in all
   * four characters. Under it, four of the nine rep-9 letters are also rep-4
   * letters, so a word made only of those has an edge division at every position
   * that could be either.
   *
   * The count below is the schedule the file would have to carry: `ABX` has 2³
   * possible schedules landing on four distinct scales, and nothing in the
   * address distinguishes them. `plate.buildView` asks `refines(scaleOfWord(w),
   * book.scale)` — a question with four answers is not a question.
   */
  it("REFUTES the overlapping spelling docs/rep9-charge.md offers", () => {
    const DOC_REP9 = "ABCabcXYZ";
    const radices = (ch: string): number[] => {
      const out: number[] = [];
      if (REP4_LETTERS.includes(ch)) out.push(EDGE_DIVISION);
      if (DOC_REP9.includes(ch)) out.push(REP9_EDGE_DIVISION);
      return out;
    };
    const scales = (w: string): Set<number> => {
      let acc = new Set([1]);
      for (const ch of w) {
        const next = new Set<number>();
        for (const s of acc) for (const k of radices(ch)) next.add(s * k);
        acc = next;
      }
      return acc;
    };

    // Ambiguous, and not marginally: a three-cut address has four scales.
    expect([...scales("ABX")].sort((a, b) => a - b)).toEqual([8, 12, 18, 27]);
    expect(scales("A").size).toBe(2);

    // How much of the address space is ambiguous under that spelling: every word
    // over the four shared characters, which is every address ever written.
    const ambiguous = wordsUpTo("ABCX", 3).filter((w) => scales(w).size > 1);
    expect(ambiguous.length).toBe(4 + 16 + 64);

    // And the shipped alphabet, by the same measure: exactly one scale, always.
    const shipped = (w: string): Set<number> => {
      let acc = new Set([1]);
      for (const ch of w) {
        const next = new Set<number>();
        for (const s of acc) next.add(s * radixAt(ch, 0));
        acc = next;
      }
      return acc;
    };
    for (const w of wordsUpTo(ADDRESS_LETTERS, 3)) expect(shipped(w).size).toBe(1);
  });
});

// ── 2. every rep-4 address is still exactly as valid ─────────────────────

describe("no existing address changes meaning", () => {
  it("admits all 1,364 triangle words and all 8,184 hexagon addresses", () => {
    const tri = wordsUpTo(REP4_LETTERS, MAX_DEPTH.triangle);
    expect(tri.length).toBe(1364);
    for (const w of tri) expect(addressWord(w, "triangle")).toBe(w);

    let hex = 0;
    for (let s = 0; s < 6; s++) {
      for (const w of wordsUpTo(REP4_LETTERS, MAX_DEPTH.hexagon)) {
        expect(addressWord(sectorTag(s) + w, "hexagon")).toBe(w);
        hex++;
      }
    }
    expect(hex).toBe(8184);
  });

  it("carries all 1,364 of them through the real reader in one payload", () => {
    const tri = wordsUpTo(REP4_LETTERS, MAX_DEPTH.triangle);
    const p = payloadFromPaint(
      "triangle",
      MAX_DEPTH.triangle,
      "apex",
      new Map(),
      undefined,
      tri.map((w) => [w, GOLD] as const)
    );
    expect(p.plate?.length).toBe(1364);
    const back = extractArt(`<svg>${encodeArt(p)}</svg>`);
    expect(back).not.toBeNull();
    expect(back?.plate?.length).toBe(1364);
  });

  it("makes the old length bound and the new scale bound the same predicate", () => {
    // Over `[ABCX]` an address has scale 2^length, so `scale ≤ 32` and
    // `length ≤ 5` decide identically — which is why widening the alphabet could
    // not have moved an existing file.
    for (const w of wordsUpTo(REP4_LETTERS, MAX_DEPTH.triangle + 1)) {
      const byLength = w.length <= MAX_DEPTH.triangle;
      const byScale = scaleOfWord(w) <= MAX_SCALE.triangle;
      expect(byScale).toBe(byLength);
      expect(addressWord(w, "triangle") !== null).toBe(byLength);
    }
    expect(MAX_SCALE.triangle).toBe(32);
    expect(MAX_SCALE.hexagon).toBe(32);
  });
});

// ── 3. byte identity, pinned before the alphabet was widened ─────────────

/**
 * Pinned from the tree at `c4a6094`, before a line of this change was written.
 *
 * Re-pinning to make a red test green is the failure these exist to prevent. The
 * first two are the whole comment line, because they are short enough to read and
 * a diff on them says WHAT moved; the third is a digest, because it is 5.5 kB.
 */
const PLAIN_TRIANGLE =
  '<!-- fourfold:art:1 {"canvas":"triangle","depth":2,"convention":"apex",' +
  '"cells":[[0,"#d4a017"],[5,"#c0392b"],[15,"#2b6cc0"]]} -->';

const HEX_MULTI_DEPTH =
  '<!-- fourfold:art:1 {"canvas":"hexagon","depth":3,"convention":"apex",' +
  '"cells":[[6,"#c0392b"],[7,"#c0392b"],[260,"#d4a017"],[261,"#d4a017"],' +
  '[262,"#d4a017"],[263,"#d4a017"]],"plate":[["s0:ABC","#c0392b"],' +
  '["s0:ABX","#c0392b"],["s4:AB","#d4a017"]]} -->';

const TRI_DEEP_PIN = {
  bytes: 5554,
  sha256: "0766525ca63d4ad4f644deb10103f9dd85763f54d8bc4e10a91a6d3dc97c3025",
};

/** Lay `colour` on `addrs` as one stroke, through the real planner. */
const lay = (
  plate: AddressPlate,
  book: AddressBook,
  addrs: readonly Address[],
  colour: string | null
): AddressPlate =>
  applyPlateEdits(
    plate,
    planPlateEdits(plate, book, addrs, addrs.map(() => colour)),
    "do"
  );

describe("byte identity for rep-4 documents", () => {
  it("writes a plain drawing byte for byte as it did", () => {
    const p = payloadFromPaint(
      "triangle",
      2,
      "apex",
      new Map([
        [0, GOLD],
        [5, RED],
        [15, BLUE],
      ])
    );
    expect(encodeArt(p)).toBe(PLAIN_TRIANGLE);
    expect(extractArt(`<svg>${encodeArt(p)}</svg>`)).not.toBeNull();
  });

  it("writes a multi-depth address plate byte for byte as it did", () => {
    const book = addressBook(buildHexagon(3));
    const d2 = addressBook(buildHexagon(2));
    let plate: AddressPlate = new Map();
    plate = lay(plate, d2, ["s4:AB"], GOLD);
    plate = lay(plate, book, ["s0:ABX", "s0:ABC"], RED);
    const p = payloadFromPaint(
      "hexagon",
      3,
      "apex",
      resolvePlate(plate, book),
      undefined,
      plateEntries(plate, book)
    );
    expect(encodeArt(p)).toBe(HEX_MULTI_DEPTH);
  });

  it("writes a plate painted at all five depths byte for byte as it did", () => {
    const book = addressBook(buildFigure(5));
    const plate: AddressPlate = new Map([
      ["A", GOLD],
      ["BA", RED],
      ["CAB", BLUE],
      ["XABC", GOLD],
      ["ABCXA", RED],
    ]);
    const line = encodeArt(
      payloadFromPaint(
        "triangle",
        5,
        "ifs",
        resolvePlate(plate, book),
        { on: true, reading: "convex" },
        plateEntries(plate, book)
      )
    );
    expect({ bytes: Buffer.byteLength(line, "utf8"), sha256: sha256(line) }).toEqual(
      TRI_DEEP_PIN
    );
  });
});

// ── 4. nine-letter and mixed addresses, and what is refused ──────────────

describe("the gate", () => {
  it("admits a nine-letter address up to the resolution ceiling", () => {
    expect(addressWord("a", "triangle")).toBe("a");
    expect(addressWord("abc", "triangle")).toBe("abc");
    expect(addressWord("uvw", "triangle")).toBe("uvw");
    expect(addressWord("xyz", "triangle")).toBe("xyz");
    expect(addressWord("s2:abc", "hexagon")).toBe("abc");
    // Three rep-9 cuts is scale 27 and 729 cells a sector; four is scale 81 and
    // 6,561, past anything this build can show.
    expect(scaleOfWord("abc")).toBe(27);
    expect(addressWord("abca", "triangle")).toBeNull();
  });

  it("admits a mixed address and reads its scale off it", () => {
    for (const [w, scale] of [
      ["ABa", 12],
      ["aAB", 12],
      ["abA", 18],
      ["Aab", 18],
      ["ABCa", 24],
      ["ABCXa", 48],
    ] as const) {
      expect(scaleOfWord(w)).toBe(scale);
      expect(addressWord(w, "triangle")).toBe(scale <= MAX_SCALE.triangle ? w : null);
    }
  });

  it("REFUSES on the scale, which the length bound no longer implies", () => {
    // Four characters, well inside `MAX_DEPTH`, and 6,561 cells a sector.
    expect("aaaa".length).toBeLessThanOrEqual(MAX_DEPTH.triangle);
    expect(scaleOfWord("aaaa")).toBe(81);
    expect(addressWord("aaaa", "triangle")).toBeNull();
    // The length bound survives as the scale bound's SHADOW: the coarsest cut
    // halves the edge, so nothing admissible can be longer than MAX_DEPTH.
    for (const w of wordsUpTo(ADDRESS_LETTERS, 3)) {
      if (addressWord(w, "triangle") === null) continue;
      expect(w.length).toBeLessThanOrEqual(MAX_DEPTH.triangle);
    }
  });

  it("refuses a letter that is not a letter, in either case", () => {
    for (const bad of ["D", "d", "e", "t", "AD", "Ad", "s", "s0:A", "A:", "A0", "", "A B"]) {
      expect(addressWord(bad, "triangle")).toBeNull();
    }
    // The tag rules are unchanged and now hold against thirteen letters.
    expect(addressWord("abc", "hexagon")).toBeNull();
    expect(addressWord("s6:abc", "hexagon")).toBeNull();
    expect(addressWord("s0:s0:a", "hexagon")).toBeNull();
  });

  it("rejects the WHOLE payload for one bad address, and never a filtered plate", () => {
    const good = payloadFromPaint("triangle", 2, "apex", new Map([[0, GOLD]]));
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
    expect(read([["ABa", GOLD], ["abc", RED]])).not.toBeNull();
    // One bad entry among good ones. The plate is not shortened; the file dies.
    expect(read([["ABa", GOLD], ["aaaa", RED]])).toBeNull();
    expect(read([["ABa", GOLD], ["Ade", RED]])).toBeNull();
    expect(read([["abc", GOLD], ["abc", RED]])).toBeNull();
  });

  it("drops on the way out exactly what it would refuse on the way in", () => {
    // A writer and a reader that disagree about the alphabet is a file this
    // program writes and will not read.
    const p = payloadFromPaint("triangle", 2, "apex", new Map(), undefined, [
      ["ABa", GOLD],
      ["aaaa", RED],
      ["Ade", BLUE],
    ]);
    expect(p.plate).toEqual([["ABa", GOLD]]);
    expect(extractArt(`<svg>${encodeArt(p)}</svg>`)).not.toBeNull();
  });
});

// ── 5. the caps ──────────────────────────────────────────────────────────

describe("what the caps still mean", () => {
  it("counts the address space by enumeration, not by the old depth formula", () => {
    // The oracle: every word of up to MAX_DEPTH cuts over the whole alphabet,
    // filtered by the gate. 402,233 candidates, no formula.
    let admitted = 0;
    for (const w of wordsUpTo(ADDRESS_LETTERS, MAX_DEPTH.triangle)) {
      if (addressWord(w, "triangle") !== null) admitted++;
    }
    expect(admitted).toBe(5963);
    expect(addressCount("triangle")).toBe(5963);
    expect(addressCount("hexagon")).toBe(6 * 5963);

    // The formula this replaced — Σ cellCount over the drawable depths — counts
    // only the rep-4 words. It is a FLOOR, and the direction matters: a mixed
    // plate larger than it would have been refused as self-contradictory.
    let old = 0;
    for (let d = 1; d <= MAX_DEPTH.triangle; d++) old += cellCount("triangle", d);
    expect(old).toBe(1364);
    expect(addressCount("triangle")).toBeGreaterThan(old);
  });

  it("leaves the LAYER caps untouched, because they are not address caps", () => {
    // `MAX_LAYER_DEPTH` bounds the nesting of the layer tree and the length of a
    // composition trail; `MAX_LAYERS` bounds the node count. Neither is a
    // statement about cells, so a nine-letter alphabet cannot move them.
    expect(MAX_LAYER_DEPTH).toBe(32);
    expect(MAX_LAYERS).toBe(8192);
    const p = payloadFromPaint("triangle", 2, "apex", new Map([[0, GOLD]]), undefined, [
      ["abc", RED],
    ]);
    const back = extractArt(
      `<svg><!-- fourfold:art:1 ${JSON.stringify({
        canvas: p.canvas,
        depth: p.depth,
        convention: p.convention,
        cells: p.cells,
        plate: p.plate,
        comp: { layers: [{ id: "l0", children: [{ id: "l1", cells: [[0, GOLD]] }] }] },
      })} --></svg>`
    );
    expect(back).not.toBeNull();
    expect(back?.comp?.layers[0].children?.[0].id).toBe("l1");
  });

  it("MEASURES the gap: `depth` still names a rep-4 canvas and nothing else", () => {
    // The plate is self-describing; the index-keyed `cells` list is not. `depth`
    // is all the file says about the canvas that issued those indices, and it is
    // read as 2^depth. So a rep-9 CANVAS — as opposed to a rep-9 address — is
    // still owed a field, and this is the number that says so.
    expect(cellCount("triangle", 3)).toBe(64);
    expect(scaleOfWord("abc") ** 2).toBe(729);
    expect(cellCount("triangle", 3)).not.toBe(scaleOfWord("abc") ** 2);
  });
});

// ── 6. plate.ts's four resolution rules, under a mixed alphabet ──────────

describe("the plate resolves a mixed alphabet by the same four rules", () => {
  const book = addressBook(buildHexagon(2));
  const nine = [...REP9_LETTERS];

  it("1 EXACT — the address itself, whatever alphabet the rest of the plate uses", () => {
    const plate: AddressPlate = new Map([
      ["s0:AB", GOLD],
      ["s1:ab", RED], // a divergent rep-9 address, inert here
    ]);
    expect(board(plate, book)["s0:AB"]).toBe(GOLD);
  });

  it("2 ANCESTOR — a rep-4 cell inherits from its rep-4 ancestor, unchanged", () => {
    const plate: AddressPlate = new Map([["s1:A", GOLD]]);
    const b = board(plate, book);
    for (const g of DIGITS) expect(b[`s1:A${g}`]).toBe(GOLD);
    expect(nearestAncestor(plate, book, "s1:AB")).toBe("s1:A");
    expect(inheritedColour(plate, book, "s1:AB")).toBe(GOLD);
    // And across a rep-9 letter: the walk is by level count, so it steps over
    // `s1:Aa` and finds `s1:A` exactly as it would over `s1:AA`.
    expect(nearestAncestor(plate, book, "s1:Aab")).toBe("s1:A");
  });

  it("1 beats 2 — an exact colour wins over an inherited one", () => {
    const plate: AddressPlate = new Map([
      ["s2:A", GOLD],
      ["s2:AB", RED],
    ]);
    const b = board(plate, book);
    expect(b["s2:AB"]).toBe(RED);
    expect(b["s2:AA"]).toBe(GOLD);
  });

  it("3 CONSENSUS — over a REP-9 refinement of a rep-4 cell", () => {
    // THE NEW CASE. Nine children of `s3:AB`, cut at edge division three, at
    // scale 12 against a book at scale 4. They agree, so the cell shows it.
    const plate: AddressPlate = new Map(nine.map((g) => [`s3:AB${g}`, BLUE]));
    expect(board(plate, book)["s3:AB"]).toBe(BLUE);
    expect(descendantsOf(plate, book, "s3:AB").length).toBe(9);
    for (const a of descendantsOf(plate, book, "s3:AB")) {
      expect(scaleOfWord(a.slice(book.stem))).toBe(12);
      expect(covers("s3:AB", a)).toBe(true);
      expect(ancestorAt(a, book.stem, book.depth)).toBe("s3:AB");
    }
  });

  it("3 CONSENSUS — one dissenting rep-9 child and the cell shows nothing", () => {
    const plate = new Map(nine.map((g) => [`s3:AB${g}`, BLUE]));
    plate.set(`s3:AB${nine[4]}`, RED);
    expect(board(plate, book)["s3:AB"]).toBeUndefined();
  });

  it("1 beats 3 — a coarse paint outranks its own finer detail", () => {
    const plate = new Map<Address, string>(nine.map((g) => [`s4:AB${g}`, RED]));
    plate.set("s4:AB", GOLD);
    expect(board(plate, book)["s4:AB"]).toBe(GOLD);
  });

  it("resolves two levels of mixed descent to the right parent", () => {
    // `s5:AB` + `a` + `A` is four cuts, scale 24, and truncating by LEVEL COUNT
    // still lands on `s5:AB` — which is the whole reason one character per cut
    // is load-bearing.
    const plate: AddressPlate = new Map([
      ["s5:ABaA", BLUE],
      ["s5:ABaB", BLUE],
    ]);
    expect(scaleOfWord("ABaA")).toBe(24);
    expect(board(plate, book)["s5:AB"]).toBe(BLUE);
    expect(ancestorAt("s5:ABaA", book.stem, 2)).toBe("s5:AB");
  });

  it("4 — a DIVERGENT address is carried, not drawn, and not cleared", () => {
    // `s0:ab` is a rep-9 first cut where this canvas cut rep-4. Its scale is 9,
    // the book's is 4, and neither refines the other: the incomparable case.
    // There is no cell of this canvas it is the paint of, so it resolves nowhere.
    const plate: AddressPlate = new Map([["s0:ab", RED]]);
    expect(scaleOfWord("ab")).toBe(9);
    expect(Object.keys(board(plate, book)).length).toBe(0);

    // Painting the whole sector over it does NOT clear it — it is in no target's
    // `below`. That is this module's "detail resurrects" case surviving across
    // radices, and it is pinned so it is a counted precondition and not a
    // surprise. It also means the plate round-trips it into the file.
    const sector0 = book.addr.filter((a) => a.startsWith("s0:"));
    const painted = lay(plate, book, sector0, GOLD);
    expect(painted.get("s0:ab")).toBe(RED);
    expect(plateEntries(painted, book)?.some(([a]) => a === "s0:ab")).toBe(true);
  });

  it("writes the plate field for an address that is the same LENGTH but not the same scale", () => {
    // `s0:ab` is two cuts, as the book is, and scale 9 where the book is 4. A
    // length comparison would have called them equal and omitted the field.
    const plate: AddressPlate = new Map([["s0:ab", RED]]);
    expect(plateEntries(plate, book)).toEqual([["s0:ab", RED]]);
  });

  it("round-trips a mixed plate through the file exactly", () => {
    const plate: AddressPlate = new Map([
      ["s0:AB", GOLD],
      ["s0:ABa", RED],
      ["s1:abc", BLUE],
      ["s2:aA", GOLD],
    ]);
    const p = payloadFromPaint(
      "hexagon",
      2,
      "apex",
      resolvePlate(plate, book),
      undefined,
      plateEntries(plate, book)
    );
    const back = extractArt(`<svg>${encodeArt(p)}</svg>`);
    expect(back).not.toBeNull();
    expect(new Map((back as ArtPayload).plate)).toEqual(new Map(snapshot(plate)));
  });
});

// ── 7. the write path: a node's siblings are the cut that made it ────────

describe("the erase split reads the radix off the path", () => {
  it("splits a rep-9 ancestor into its NINE siblings, not four", () => {
    const b = schedBook([3, 3], "rep9:2");
    expect(b.addr.length).toBe(81);
    expect(b.scale).toBe(9);

    const plate: AddressPlate = new Map([["a", GOLD]]);
    const edits = planPlateEdits(plate, b, ["ab"], [null]);
    // One delete of the ancestor plus eight repainted siblings. Under the
    // rep-4-only enumeration this was, the eight would have been `aA`…`aX` —
    // four addresses at scale 6 that no cell of this book has — and the gold
    // would have vanished from the canvas entirely.
    expect(edits.filter((e) => e.to === null).map((e) => e.cell)).toEqual(["a"]);
    expect(edits.filter((e) => e.to === GOLD).length).toBe(8);
    for (const e of edits) if (e.to !== null) expect(e.cell.length).toBe(2);

    const after = applyPlateEdits(plate, edits, "do");
    const drawn = board(after, b);
    expect(Object.keys(drawn).length).toBe(8);
    expect(drawn["ab"]).toBeUndefined();
    for (const g of REP9_LETTERS) {
      if (g === "b") continue;
      expect(drawn[`a${g}`]).toBe(GOLD);
    }

    // Undo restores the ancestor byte for byte, which is what makes the split a
    // rewrite of the plate and not a loss.
    expect(snapshot(applyPlateEdits(after, edits, "undo"))).toEqual(snapshot(plate));
  });

  it("splits across TWO radices in one stroke, level by level", () => {
    // A canvas cut rep-4, then rep-9, then rep-4: scale 12, 144 cells.
    const b = schedBook([2, 3, 2], "mixed:2-3-2");
    expect(b.addr.length).toBe(4 * 9 * 4);
    expect(b.scale).toBe(12);

    const plate: AddressPlate = new Map([["A", GOLD]]);
    const edits = planPlateEdits(plate, b, ["AaB"], [null]);
    // `A` was cut nine ways (the letter below it is `a`), and `Aa` four ways
    // (the letter below it is `B`). Eight plus three repaints, one delete.
    expect(edits.filter((e) => e.to === null).map((e) => e.cell)).toEqual(["A"]);
    const repainted = edits.filter((e) => e.to === GOLD).map((e) => e.cell);
    expect(repainted.filter((a) => a.length === 2).length).toBe(8);
    expect(repainted.filter((a) => a.length === 3).length).toBe(3);

    const after = applyPlateEdits(plate, edits, "do");
    const drawn = board(after, b);
    // Every cell under `A` except the hole, and nothing outside it.
    expect(Object.keys(drawn).length).toBe(9 * 4 - 1);
    expect(drawn["AaB"]).toBeUndefined();
    for (const a of b.addr) {
      if (!a.startsWith("A")) expect(drawn[a]).toBeUndefined();
      else if (a !== "AaB") expect(drawn[a]).toBe(GOLD);
    }
  });

  it("REFUSES a stroke whose targets cut one node two ways", () => {
    // Unreachable from the program — the targets of a stroke come from one book,
    // hence one tree — and refused rather than guessed, because guessing means
    // repainting two overlapping regions of the same triangle.
    const b = schedBook([2, 3], "mixed:2-3");
    const plate: AddressPlate = new Map([["A", GOLD]]);
    expect(() => planPlateEdits(plate, b, ["Aa", "AB"], [null, null])).toThrow(
      /cut 3 and 2 in one stroke/
    );
  });

  it("leaves the rep-4 split exactly as it was", () => {
    // The same measurement on the shipped canvas: four siblings, three repaints.
    const b = addressBook(buildFigure(2));
    const plate: AddressPlate = new Map([["A", GOLD]]);
    const edits = planPlateEdits(plate, b, ["AB"], [null]);
    expect(edits.filter((e) => e.to === null).map((e) => e.cell)).toEqual(["A"]);
    expect(edits.filter((e) => e.to === GOLD).map((e) => e.cell).sort()).toEqual([
      "AA",
      "AC",
      "AX",
    ]);
  });
});
