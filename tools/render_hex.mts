/**
 * Render the hexagon canvas to a standalone SVG.
 *
 * A visual fixture: committed to docs/img/ so the sector layout can be
 * inspected without running the app, and regenerated identically by anyone.
 * The geometry comes from the same model the page uses, so this is the render
 * path under test, not a reimplementation.
 *
 *   npx tsx tools/render_hex.mts docs/img
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildHexagon } from "../src/lib/hexagon.js";
import { FILL } from "../src/lib/palette.js";
import { H, type Charge } from "../src/lib/figure.js";
import type { Convention } from "../src/lib/figure.js";

const OUT = process.argv[2] ?? "docs/img";
const DEPTH = Number(process.argv[3] ?? 2);

function render(depth: number, convention: Convention): string {
  const hex = buildHexagon(depth, convention);
  const L: string[] = [];
  L.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${hex.width.toFixed(0)}" height="${hex.height.toFixed(0)}" viewBox="0 0 ${hex.width.toFixed(0)} ${hex.height.toFixed(0)}">`
  );
  L.push(
    `<metadata><hexagon depth="${depth}" convention="${convention}" cells="${hex.cells.length}" sectors="6"/></metadata>`
  );
  L.push(`<rect width="100%" height="100%" fill="#121010"/>`);

  // Hatch patterns for the non-H coset, matching the app.
  const hatch = new Set<string>();
  for (const ch of [1, 2] as const) {
    hatch.add(FILL[ch][0]);
    hatch.add(FILL[ch][1]);
  }
  L.push("<defs>");
  for (const c of hatch) {
    const id = `p${c.replace("#", "")}`;
    L.push(
      `<pattern id="${id}" patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="rotate(45)">` +
        `<rect width="7" height="7" fill="${c}"/>` +
        `<line x1="0" y1="0" x2="0" y2="7" stroke="rgba(0,0,0,.42)" stroke-width="2.4"/></pattern>`
    );
  }
  L.push("</defs>");

  for (const c of hex.cells) {
    const base = FILL[c.charge as Charge][c.eps];
    const fill = H.has(c.charge as Charge)
      ? base
      : `url(#p${base.replace("#", "")})`;
    L.push(
      `<polygon points="${c.verts.map((v) => `${v[0].toFixed(2)},${v[1].toFixed(2)}`).join(" ")}" fill="${fill}" stroke="rgba(10,9,8,.5)" stroke-width="0.35"/>`
    );
  }

  // The six mirror lines: odd k are sector spines, even k sector boundaries.
  const [cx, cy] = hex.centre;
  for (let k = 0; k < 6; k++) {
    const spine = k % 2 === 1;
    // Boundaries reach the corners (circumradius), spines the edge midpoints
    // (inradius). One length for both would make the spines overshoot.
    const len = spine ? (hex.radius * Math.sqrt(3)) / 2 : hex.radius;
    const t = (Math.PI / 180) * 30 * k;
    const dx = Math.cos(t) * len;
    const dy = Math.sin(t) * len;
    L.push(
      `<line x1="${(cx - dx).toFixed(2)}" y1="${(cy + dy).toFixed(2)}" x2="${(cx + dx).toFixed(2)}" y2="${(cy - dy).toFixed(2)}" ` +
        `stroke="${spine ? "#67e8f9" : "#f59e0b"}" stroke-width="${spine ? 2.2 : 1.8}" ` +
        `${spine ? "" : 'stroke-dasharray="8 5" '}opacity="${spine ? 0.65 : 0.75}"/>`
    );
  }

  L.push(
    `<text x="16" y="26" font-family="monospace" font-size="13" fill="#ece6dc">` +
      `hexagon · depth ${depth} · ${convention} · ${hex.cells.length} cells</text>`
  );
  L.push(
    `<text x="16" y="44" font-family="monospace" font-size="11" fill="#8a8078">` +
      `cyan = sector spines (m30/m90/m150) · amber = sector boundaries (m0/m60/m120)</text>`
  );
  L.push("</svg>");
  return L.join("\n");
}

for (const conv of ["apex", "ifs"] as const) {
  const path = join(OUT, `hexagon_d${DEPTH}_${conv}.svg`);
  writeFileSync(path, render(DEPTH, conv) + "\n");
  console.log(`wrote ${path}`);
}
