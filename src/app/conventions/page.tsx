"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import ConventionBoard from "@/components/ConventionBoard";
import {
  AXES,
  buildFigure,
  CHARGE_LABEL,
  CHARGE_NAME,
  H,
  type Axis,
  type Convention,
} from "@/lib/figure";
import {
  CHARACTER_NAMES,
  CHARACTERS,
  characterReport,
  chargeDivergence,
  exactIsometries,
  ISOMETRY_LABEL,
  isometryReport,
} from "@/lib/conventions";
import { AXIS_COLOR, AXIS_NAME } from "@/lib/palette";
import HexBoard, { HEX_MIRRORS } from "@/components/HexBoard";
import {
  buildHexagon,
  census,
  hexIsometryReport,
  indexMap,
  latKey,
  triangleCensus,
} from "@/lib/hexagon";

const DEPTHS = [2, 3, 4, 5] as const;

type Canvas = "triangle" | "hexagon";

const BLURB: Record<Convention, string> = {
  apex: "Every corner child keeps the parent’s corner as its own role-A vertex. This is what equilat_v4.py implements, and what FOURFOLD is played on.",
  ifs: "Each corner child’s roles are the images of (A,B,C) under the homothety that produces it — the standard IFS reading.",
};

export default function ConventionsPage() {
  const [convention, setConvention] = useState<Convention>("apex");
  const [canvas, setCanvas] = useState<Canvas>("triangle");
  const [depth, setDepth] = useState<number>(4);
  const [focus, setFocus] = useState<number | null>(null);
  const [showMedians, setShowMedians] = useState(true);
  const [markChanged, setMarkChanged] = useState(false);

  const isHex = canvas === "hexagon";

  const figure = useMemo(
    () => buildFigure(depth, convention),
    [depth, convention]
  );
  const other = useMemo(
    () => buildFigure(depth, convention === "apex" ? "ifs" : "apex"),
    [depth, convention]
  );

  // Built only when the hexagon canvas is on, so triangle mode does no extra
  // work and behaves exactly as it did before.
  const hex = useMemo(
    () => (isHex ? buildHexagon(depth, convention) : null),
    [isHex, depth, convention]
  );
  const hexOther = useMemo(
    () =>
      isHex
        ? buildHexagon(depth, convention === "apex" ? "ifs" : "apex")
        : null,
    [isHex, depth, convention]
  );

  const isoRows = useMemo(() => isometryReport(figure), [figure]);
  const exact = useMemo(() => exactIsometries(isoRows), [isoRows]);
  const hexRows = useMemo(() => (hex ? hexIsometryReport(hex) : null), [hex]);
  const hexExactCount = hexRows ? hexRows.filter((r) => r.exact).length : 0;
  const chars = useMemo(() => characterReport(figure), [figure]);
  const divergence = useMemo(
    () => chargeDivergence(figure, other),
    [figure, other]
  );

  const balance = useMemo(
    () => (hex ? census(hex) : triangleCensus(figure)),
    [hex, figure]
  );

  /** Cells the other convention labels differently, by index in THIS figure. */
  const changed = useMemo(() => {
    const byKey = new Map(other.cells.map((c) => [c.key.join(","), c]));
    const out = new Set<number>();
    for (const c of figure.cells) {
      if (byKey.get(c.key.join(","))!.charge !== c.charge) out.add(c.i);
    }
    return out;
  }, [figure, other]);

  const hexChanged = useMemo(() => {
    if (!hex || !hexOther) return new Set<number>();
    const byKey = new Map(hexOther.cells.map((c) => [latKey(c.key), c]));
    const out = new Set<number>();
    for (const c of hex.cells) {
      if (byKey.get(latKey(c.key))!.charge !== c.charge) out.add(c.i);
    }
    return out;
  }, [hex, hexOther]);

  /** Mirror partners of the focused hexagon cell, across sector seams. */
  const hexPartners = useMemo(() => {
    if (!hex || focus === null || !isHex) return null;
    return HEX_MIRRORS.map((g) => {
      const j = indexMap(hex, g)[focus];
      return { g, cell: hex.cells[j] };
    });
  }, [hex, focus, isHex]);

  const focused =
    focus === null ? null : isHex && hex ? hex.cells[focus] : figure.cells[focus];
  const total = isHex && hex ? hex.cells.length : figure.cells.length;

  return (
    <main style={S.page}>
      <header style={S.header}>
        <div>
          <h1 style={S.h1}>
            <span style={{ color: "#d4a017" }}>V₄</span> — THE CONVENTION TOGGLE
          </h1>
          <p style={S.sub}>
            The same 4<sup>d</sup> triangles, labelled two ways. One way has a
            symmetry group of order 2; the other of order 6. Nothing about the
            geometry differs.
          </p>
        </div>
        <Link href="/" style={S.back}>
          ← back to the game
        </Link>
      </header>

      <div style={S.stage}>
        <section style={S.canvasWrap}>
          <div style={S.toggleRow}>
            <div style={S.seg} role="group" aria-label="child-role convention">
              {(["apex", "ifs"] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => setConvention(c)}
                  aria-pressed={convention === c}
                  style={{
                    ...S.segBtn,
                    ...(convention === c ? S.segBtnOn : null),
                  }}
                >
                  {c}
                </button>
              ))}
            </div>
            <div style={S.seg} role="group" aria-label="canvas">
              {(["triangle", "hexagon"] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => {
                    setCanvas(c);
                    setFocus(null);
                  }}
                  aria-pressed={canvas === c}
                  style={{
                    ...S.segBtn,
                    ...(canvas === c ? S.segBtnOn : null),
                  }}
                >
                  {c}
                </button>
              ))}
            </div>
            <span style={S.order}>
              symmetry group order{" "}
              {isHex ? (
                <b
                  style={{ color: hexExactCount === 12 ? "#a3e635" : "#f59e0b" }}
                >
                  {hexExactCount}
                </b>
              ) : (
                <b style={{ color: exact.length === 6 ? "#a3e635" : "#f59e0b" }}>
                  {exact.length}
                </b>
              )}
            </span>
          </div>

          <p style={S.blurb}>{BLURB[convention]}</p>

          {isHex && hex ? (
            <HexBoard
              hex={hex}
              focus={focus}
              onFocus={setFocus}
              showMedians={showMedians}
              changed={hexChanged}
              markChanged={markChanged}
            />
          ) : (
            <ConventionBoard
              figure={figure}
              focus={focus}
              onFocus={setFocus}
              showMedians={showMedians}
              changed={changed}
              markChanged={markChanged}
            />
          )}

          <div style={S.controls}>
            <label style={S.small}>
              depth&nbsp;
              <select
                value={depth}
                onChange={(e) => {
                  setDepth(Number(e.target.value));
                  setFocus(null);
                }}
                style={S.select}
              >
                {DEPTHS.map((d) => (
                  <option key={d} value={d}>
                    {d} — {isHex ? 6 * 4 ** d : 4 ** d} cells
                  </option>
                ))}
              </select>
            </label>
            <label style={S.small}>
              <input
                type="checkbox"
                checked={showMedians}
                onChange={(e) => setShowMedians(e.target.checked)}
              />
              &nbsp;medians
            </label>
            <label style={S.small}>
              <input
                type="checkbox"
                checked={markChanged}
                onChange={(e) => setMarkChanged(e.target.checked)}
              />
              &nbsp;outline cells the other convention recolours
            </label>
          </div>
        </section>

        <aside style={S.panel}>
          <div style={S.card}>
            <h2 style={S.h2}>what actually changes</h2>
            <dl style={S.dl}>
              <Row k="triangles that move" v="0" good />
              <Row k="cells that change orientation" v="0" good />
              <Row
                k="cells that change colour"
                v={`${divergence} of ${total} (${((100 * divergence) / total).toFixed(1)}%)`}
              />
            </dl>
            <p style={S.note}>
              The centre child <code>(M_BC, M_AC, M_AB)</code> is inverted in
              both conventions, so ε — the parity of the X count — cannot
              change. Only the two corner children’s role ordering differs, and
              that is enough to move the symmetry group from order 2 to order 6.
            </p>
          </div>

          <div style={S.card}>
            <h2 style={S.h2}>orientation census</h2>
            <dl style={S.dl}>
              <Row k="up" v={String(balance.up)} />
              <Row k="down" v={String(balance.down)} />
              <Row
                k={isHex ? "balanced (must be)" : "balanced"}
                v={
                  balance.balanced
                    ? "yes"
                    : `no — off by ${Math.abs(balance.up - balance.down)}`
                }
                good={balance.balanced}
              />
            </dl>
            <p style={S.note}>
              {isHex ? (
                <>
                  Checked live, never assumed: both must read{" "}
                  <code>3·4ᵈ = {3 * 4 ** depth}</code>. Three sectors are drawn
                  in each lattice orientation, so the triangle&rsquo;s surplus of{" "}
                  <code>2ᵈ = {2 ** depth}</code> appears once with each sign and
                  cancels. Every sector is a <em>complete</em> triangle — no
                  corner is missing from the hexagon.
                </>
              ) : (
                <>
                  A lone triangle is not balanced: up −	down ={" "}
                  <code>2ᵈ = {2 ** depth}</code> exactly, since up ={" "}
                  <code>(4ᵈ+2ᵈ)/2</code>. Switch to the hexagon and it cancels.
                </>
              )}
            </p>
          </div>

          <div style={S.card}>
            <h2 style={S.h2}>
              isometries that lift exactly{isHex ? " — D₆" : ""}
            </h2>
            <table style={S.table}>
              <tbody>
                {isHex && hexRows
                  ? hexRows.map((r) => (
                      <tr key={r.name}>
                        <td style={S.tdName}>
                          <code>{r.name}</code>
                          <span style={S.tdSub}>{r.label}</span>
                        </td>
                        <td style={S.tdNum}>
                          {r.matches}/{r.total}
                        </td>
                        <td style={S.tdFlag}>
                          {r.exact ? (
                            <span style={S.exact}>exact</span>
                          ) : (
                            <span style={S.inexact}>
                              {(((100 * r.matches) / r.total) | 0)}%
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  : isoRows.map((r) => (
                      <tr key={r.name}>
                        <td style={S.tdName}>
                          <code>{r.name}</code>
                          <span style={S.tdSub}>{ISOMETRY_LABEL[r.name]}</span>
                        </td>
                        <td style={S.tdNum}>
                          {r.matches}/{r.total}
                        </td>
                        <td style={S.tdFlag}>
                          {r.exact ? (
                            <span style={S.exact}>exact</span>
                          ) : (
                            <span style={S.inexact}>
                              {(((100 * r.matches) / r.total) | 0)}%
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
              </tbody>
            </table>
            <p style={S.note}>
              {isHex ? (
                <>
                  Best over all 24 relabellings of V₄, every one of{" "}
                  {6 * 4 ** depth} cells checked. All twelve lift — rotations by
                  the identity relabelling, reflections by φ = (σ₂ σ₃) — and the
                  table is <b>identical in both conventions</b>. The hexagon
                  cannot see the apex/ifs difference: its D₆ comes from the
                  arrangement of six identical sectors, not from the V₄
                  structure, which lives <em>inside</em> a sector.
                </>
              ) : (
                <>
                  Best over all 24 relabellings of V₄, every cell checked. In{" "}
                  <code>apex</code> the three non-exact rows all sit at exactly{" "}
                  <code>(4ᵈ−1)/3 + 1</code> — one ftype class plus the hub.
                </>
              )}
            </p>
          </div>

          <div style={S.card}>
            <h2 style={S.h2}>which median carries which subfield</h2>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}></th>
                  {AXES.map((ax) => (
                    <th key={ax} style={{ ...S.th, color: AXIS_COLOR[ax] }}>
                      m_{ax}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {CHARACTER_NAMES.map((cn) => (
                  <tr key={cn}>
                    <td style={S.tdName}>
                      {CHARACTERS[cn].label}
                      <span style={S.tdSub}>{CHARACTERS[cn].subfield}</span>
                    </td>
                    {(["m_A", "m_B", "m_C"] as const).map((m) => {
                      const v = chars[cn][m];
                      const full = v === total;
                      return (
                        <td
                          key={m}
                          style={{
                            ...S.tdNum,
                            color: full ? "#a3e635" : "#8a8078",
                            fontWeight: full ? 600 : 400,
                          }}
                        >
                          {v}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={S.note}>
              {convention === "apex" ? (
                <>
                  Only <b>m_A</b> carries a character exactly, and it is χ√6. So
                  √6 looks canonical — but that is this convention speaking.
                </>
              ) : (
                <>
                  <b>Each</b> median carries a different character exactly, and{" "}
                  <code>rot+</code> cycles them. Aut(V₄) ≅ S₃ acts transitively
                  on the three quadratic subfields: none is canonical.
                </>
              )}
            </p>
          </div>

          <div style={S.card}>
            <h2 style={S.h2}>
              {focused ? (
                <>
                  cell <code>{focused.addr}</code>
                </>
              ) : (
                "hover a cell"
              )}
            </h2>
            {focused && isHex && hexPartners && "sector" in focused ? (
              <>
                <dl style={S.dl}>
                  <Row k="sector" v={String(focused.sector)} />
                  <Row
                    k="charge"
                    v={`${CHARGE_LABEL[focused.charge]} — ${CHARGE_NAME[focused.charge]}`}
                  />
                  <Row
                    k="orientation (drawn)"
                    v={`${focused.eps === 0 ? "upright" : "inverted"}${
                      focused.eps !== focused.baseEps ? " — flipped by sector" : ""
                    }`}
                  />
                </dl>
                <table style={S.table}>
                  <tbody>
                    {hexPartners.map(({ g, cell }) => {
                      const ok = H.has(focused.charge) === H.has(cell.charge);
                      return (
                        <tr key={g.name}>
                          <td
                            style={{
                              ...S.tdName,
                              color: g.k % 2 === 1 ? "#67e8f9" : "#f59e0b",
                            }}
                          >
                            <code>{g.name}</code>
                            <span style={S.tdSub}>
                              {g.k % 2 === 1 ? "spine" : "boundary"}
                            </span>
                          </td>
                          <td style={S.tdNum}>
                            <code>
                              s{cell.sector}·{cell.addr}
                            </code>
                          </td>
                          <td style={S.tdFlag}>
                            {ok ? (
                              <span style={S.exact}>coherent</span>
                            ) : (
                              <span style={S.inexact}>no</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p style={S.note}>
                  Partners routinely land in another sector — the readout gives{" "}
                  <code>sector·address</code>. Cyan links are spine mirrors,
                  amber are sector boundaries.
                </p>
              </>
            ) : focused && !isHex && "ftype" in focused ? (
              <>
                <dl style={S.dl}>
                  <Row
                    k="charge"
                    v={`${CHARGE_LABEL[focused.charge]} — ${CHARGE_NAME[focused.charge]}`}
                  />
                  <Row k="ftype" v={focused.ftype || "hub (all X)"} />
                  <Row
                    k="orientation"
                    v={focused.eps === 0 ? "upright" : "inverted"}
                  />
                </dl>
                <table style={S.table}>
                  <tbody>
                    {AXES.map((ax) => {
                      const j = focused.mirror[ax];
                      const ok = focused.coherentAxes.includes(ax);
                      const self = j === focused.i;
                      return (
                        <tr key={ax}>
                          <td style={{ ...S.tdName, color: AXIS_COLOR[ax] }}>
                            m_{ax}
                            <span style={S.tdSub}>{AXIS_NAME[ax as Axis]}</span>
                          </td>
                          <td style={S.tdNum}>
                            <code>{self ? "self" : figure.cells[j].addr}</code>
                          </td>
                          <td style={S.tdFlag}>
                            {ok ? (
                              <span style={S.exact}>coherent</span>
                            ) : (
                              <span style={S.inexact}>no</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p style={S.note}>
                  Solid link on the figure means the mirror carries the
                  colouring there; dashed means it does not. In{" "}
                  <code>apex</code> the diagonals are dashed for roughly
                  two-thirds of the board — that is the game. In{" "}
                  <code>ifs</code> nothing is ever dashed.
                </p>
              </>
            ) : (
              <p style={S.note}>
                Hover or tap any cell to see its three mirror partners and
                whether each one is charge-coherent.
              </p>
            )}
          </div>

          <p style={S.foot}>
            Both tables are recomputed in the browser from{" "}
            <code>src/lib/conventions.ts</code> — exhaustive over every cell,
            all six isometries and all 24 permutations of V₄. The Python
            counterpart is <code>tools/conventions.py</code>; the gates are{" "}
            <code>test/conventions.test.ts</code>. See{" "}
            <code>docs/symmetry-findings.md</code> section E.
          </p>
        </aside>
      </div>
    </main>
  );
}

function Row({ k, v, good }: { k: string; v: string; good?: boolean }) {
  return (
    <div style={S.row}>
      <dt style={S.dt}>{k}</dt>
      <dd style={{ ...S.dd, color: good ? "#a3e635" : "#ece6dc" }}>{v}</dd>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  page: { maxWidth: 1280, margin: "0 auto", padding: "22px 20px 40px" },
  header: {
    display: "flex",
    flexWrap: "wrap",
    gap: 16,
    alignItems: "flex-start",
    justifyContent: "space-between",
    borderBottom: "1px solid var(--rule)",
    paddingBottom: 14,
    marginBottom: 18,
  },
  h1: {
    fontSize: 15,
    fontWeight: 700,
    letterSpacing: ".18em",
    margin: 0,
    textTransform: "uppercase",
  },
  sub: {
    color: "var(--bone-dim)",
    fontSize: 12,
    margin: "8px 0 0",
    maxWidth: 620,
    lineHeight: 1.6,
  },
  back: {
    color: "var(--bone-dim)",
    fontSize: 11,
    letterSpacing: ".1em",
    textTransform: "uppercase",
    textDecoration: "none",
    borderBottom: "1px solid var(--rule)",
    paddingBottom: 2,
  },
  stage: {
    display: "grid",
    gridTemplateColumns: "minmax(0,1fr) 350px",
    gap: 18,
    alignItems: "start",
  },
  canvasWrap: {
    border: "1px solid var(--rule)",
    background: "var(--plate)",
    borderRadius: 3,
    padding: 14,
  },
  toggleRow: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    flexWrap: "wrap",
    marginBottom: 10,
  },
  seg: {
    display: "inline-flex",
    border: "1px solid var(--rule-bright)",
    borderRadius: 2,
    overflow: "hidden",
  },
  segBtn: {
    font: "inherit",
    fontSize: 12,
    letterSpacing: ".14em",
    padding: "7px 20px",
    border: 0,
    background: "transparent",
    color: "var(--bone-dim)",
    cursor: "pointer",
    textTransform: "uppercase",
  },
  segBtnOn: { background: "var(--bone)", color: "var(--ink)", fontWeight: 600 },
  order: { fontSize: 11.5, color: "var(--bone-dim)", letterSpacing: ".06em" },
  blurb: {
    fontSize: 11.5,
    color: "var(--bone-dim)",
    lineHeight: 1.6,
    margin: "0 0 12px",
  },
  controls: {
    display: "flex",
    gap: 18,
    flexWrap: "wrap",
    marginTop: 12,
    paddingTop: 12,
    borderTop: "1px solid var(--rule)",
  },
  small: {
    fontSize: 11,
    color: "var(--bone-dim)",
    letterSpacing: ".05em",
    display: "inline-flex",
    alignItems: "center",
  },
  select: {
    font: "inherit",
    fontSize: 11,
    background: "var(--plate-2)",
    color: "var(--bone)",
    border: "1px solid var(--rule)",
    borderRadius: 2,
    padding: "3px 6px",
  },
  panel: { display: "flex", flexDirection: "column", gap: 14 },
  card: {
    border: "1px solid var(--rule)",
    background: "var(--plate)",
    borderRadius: 3,
    padding: 13,
  },
  h2: {
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: ".16em",
    textTransform: "uppercase",
    color: "var(--bone-dim)",
    margin: "0 0 10px",
  },
  dl: { margin: 0 },
  row: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    padding: "3px 0",
  },
  dt: { fontSize: 11, color: "var(--bone-faint)", margin: 0 },
  dd: { fontSize: 11.5, margin: 0, fontWeight: 500 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 11 },
  th: {
    textAlign: "right",
    fontSize: 10,
    letterSpacing: ".1em",
    color: "var(--bone-faint)",
    fontWeight: 500,
    padding: "0 0 5px",
  },
  tdName: {
    padding: "4px 8px 4px 0",
    color: "var(--bone)",
    display: "flex",
    flexDirection: "column",
    gap: 1,
  },
  tdSub: { fontSize: 9.5, color: "var(--bone-faint)", letterSpacing: ".04em" },
  tdNum: {
    textAlign: "right",
    padding: "4px 0",
    color: "var(--bone-dim)",
    fontVariantNumeric: "tabular-nums",
  },
  tdFlag: { textAlign: "right", padding: "4px 0 4px 10px", width: 62 },
  exact: {
    fontSize: 9.5,
    letterSpacing: ".1em",
    textTransform: "uppercase",
    color: "#a3e635",
  },
  inexact: { fontSize: 10, color: "var(--bone-faint)" },
  note: {
    fontSize: 10.5,
    color: "var(--bone-faint)",
    lineHeight: 1.65,
    margin: "10px 0 0",
  },
  foot: {
    fontSize: 10,
    color: "var(--bone-faint)",
    lineHeight: 1.7,
    margin: 0,
  },
};
