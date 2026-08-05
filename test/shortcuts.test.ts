import { describe, expect, it } from "vitest";
import { allChords, SHORTCUTS } from "../src/lib/shortcuts";
import { RING_DIRS, RING_KEY } from "../src/lib/lattice";

describe("the shortcut table", () => {
  it("binds no chord twice", () => {
    const chords = allChords();
    const seen = new Set<string>();
    for (const c of chords) {
      expect(seen.has(c), `chord ${c} is listed twice`).toBe(false);
      seen.add(c);
    }
  });

  it("gives every row a key and a description", () => {
    for (const group of SHORTCUTS) {
      expect(group.title.length).toBeGreaterThan(0);
      expect(group.rows.length).toBeGreaterThan(0);
      for (const row of group.rows) {
        expect(row.keys.length).toBeGreaterThan(0);
        expect(row.what.length).toBeGreaterThan(0);
      }
    }
  });

  it("lists the whole navigation cluster", () => {
    const chords = new Set(allChords());
    for (const dir of RING_DIRS) expect(chords.has(RING_KEY[dir])).toBe(true);
    expect(chords.has("w")).toBe(true);
    expect(chords.has("x")).toBe(true);
  });

  /**
   * The drill-in pair shipped in one change and the table was updated in the
   * next, because the two files were in different lanes. A row that says so is
   * cheaper than another release where the panel describes a program that has
   * moved on — which is the failure this file exists to catch.
   */
  it("lists the focus keys the canvas binds", () => {
    const chords = new Set(allChords());
    expect(chords.has("i")).toBe(true);
    expect(chords.has("o")).toBe(true);
  });

  /** Option carries two meanings now, and the panel has to name both. */
  it("describes both meanings of Option", () => {
    const alt = SHORTCUTS.flatMap((g) => g.rows).filter((r) =>
      r.chord.startsWith("alt")
    );
    expect(alt.length).toBe(2);
    expect(alt.some((r) => /eras/i.test(r.what))).toBe(true);
    expect(alt.some((r) => /anchor/i.test(r.what))).toBe(true);
  });

  it("does not bind a navigation letter to anything else", () => {
    const nav = new Set([...RING_DIRS.map((d) => RING_KEY[d]), "w", "x"]);
    for (const group of SHORTCUTS) {
      if (group.title === "move on the lattice") continue;
      for (const row of group.rows) {
        expect(nav.has(row.chord), `${row.chord} collides with navigation`).toBe(
          false
        );
      }
    }
  });
});
