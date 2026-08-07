#!/usr/bin/env node
/**
 * Decompose every hue class of a full-canvas hexad export into maximal
 * address-prefix blocks — exact rep-4 subtriangles — and print the census.
 *
 * An instrument, not a test: it asserts nothing. See docs/hexad-findings.md
 * for what it measured on 2026-08-07 and what the numbers mean.
 *
 *   node docs/hexad-findings/analyze.mjs <export.svg>
 *
 * Reads the file's own `fourfold:art:1` payload; cell order is buildHexagon's
 * DFS (six sectors of 4^depth leaves, digits in REP4_LETTERS order: A B C X).
 */
import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("usage: node analyze.mjs <export.svg>");
  process.exit(1);
}
const svg = readFileSync(file, "utf8");
const m = svg.match(/fourfold:art:1 (\{[\s\S]*?\})\s*-->/);
if (!m) throw new Error("no fourfold:art:1 payload in this file");
const payload = JSON.parse(m[1].replace(/\n\s*/g, ""));
const D = payload.depth;
const PER = 4 ** D;
const LETTERS = "ABCX";

const hues = [...new Set(payload.cells.map(([, c]) => c))];
const hueIx = new Map(hues.map((h, i) => [h, i]));
const sectors = Array.from({ length: 6 }, () => new Array(PER).fill(-1));
for (const [i, c] of payload.cells) {
  sectors[Math.floor(i / PER)][i % PER] = hueIx.get(c);
}

const wordOf = (w) => {
  let s = "";
  for (let k = D - 1; k >= 0; k--) s += LETTERS[(w >> (2 * k)) & 3];
  return s;
};

/** Maximal common-prefix blocks of a word set: exact subtriangles. */
function blocks(set) {
  const out = [];
  const recur = (prefix, len) => {
    const span = 4 ** (D - len);
    const start = prefix * span;
    let all = true;
    let none = true;
    for (let w = start; w < start + span; w++) {
      if (set.has(w)) none = false;
      else all = false;
      if (!all && !none) break;
    }
    if (none) return;
    if (all) {
      out.push({ prefix: wordOf(start).slice(0, len), size: span });
      return;
    }
    for (let c = 0; c < 4; c++) recur(prefix * 4 + c, len + 1);
  };
  recur(0, 0);
  return out;
}

console.log(`canvas ${payload.canvas} depth ${D}, hues: ${hues.join(" ")}\n`);
for (let h = 0; h < hues.length; h++) {
  const tally = new Map();
  let cells = 0;
  const perSector = [];
  for (let s = 0; s < 6; s++) {
    const set = new Set();
    sectors[s].forEach((hh, w) => {
      if (hh === h) set.add(w);
    });
    cells += set.size;
    const bs = blocks(set);
    perSector.push(bs);
    for (const b of bs) tally.set(b.size, (tally.get(b.size) ?? 0) + 1);
  }
  const line = [...tally.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([sz, n]) => `${sz}:${n}`)
    .join("  ");
  console.log(`hue ${h} (${hues[h]}): ${cells} cells — blocks ${line}`);
  if (process.argv.includes("--blocks")) {
    perSector.forEach((bs, s) =>
      console.log(
        `  s${s}: ` +
          bs
            .sort((a, b) => b.size - a.size)
            .map((b) => `[${b.prefix}]x${b.size}`)
            .join(" ")
      )
    );
  }
}
