"use client";

import {
  AXES,
  CHARGE_FIXES,
  CHARGE_LABEL,
  CHARGE_NAME,
  type Axis,
  type Figure,
} from "@/lib/figure";
import {
  AXIS_VALUE,
  axisCapacity,
  winner,
  type ClaimAnalysis,
  type GameState,
} from "@/lib/game";
import { AXIS_COLOR, AXIS_NAME, FILL, PLAYER_COLOR, PLAYER_NAME } from "@/lib/palette";

interface LedgerProps {
  state: GameState;
  analysis: ClaimAnalysis;
  hovered: number | null;
  onSubmit: () => void;
  onClear: () => void;
  onPass: () => void;
  onReset: () => void;
}

function Inspector({
  figure,
  hovered,
}: {
  figure: Figure;
  hovered: number | null;
}) {
  if (hovered === null) {
    return (
      <div className="inspect">
        Point at a cell to see its address, its Galois charge, and where its
        three mirror partners lie.
      </div>
    );
  }
  const c = figure.cells[hovered];
  return (
    <div className="inspect">
      <div className="addr">{c.addr}</div>
      <div style={{ marginTop: 5 }}>
        <span
          className="swatch"
          style={{ background: FILL[c.charge][c.eps] }}
          aria-hidden
        />
        {CHARGE_LABEL[c.charge]} · {CHARGE_NAME[c.charge]} ·{" "}
        {CHARGE_FIXES[c.charge]}
      </div>
      <div>
        {c.eps === 0 ? "upright" : "inverted"} · first non-centre digit{" "}
        <strong style={{ color: "var(--bone)" }}>{c.ftype || "— (hub)"}</strong>
      </div>
      <div style={{ marginTop: 5 }}>
        pairs on:{" "}
        {c.coherentAxes.length === 0 ? (
          <em>no axis</em>
        ) : (
          c.coherentAxes.map((ax) => (
            <span
              key={ax}
              className="tag"
              style={{ borderColor: AXIS_COLOR[ax], marginRight: 4 }}
            >
              m<sub>{ax}</sub> +{AXIS_VALUE[ax]}
            </span>
          ))
        )}
      </div>
    </div>
  );
}

export default function Ledger({
  state,
  analysis,
  hovered,
  onSubmit,
  onClear,
  onPass,
  onReset,
}: LedgerProps) {
  const { figure } = state;
  const cap = axisCapacity(figure);
  const claimed = state.owner.filter((o) => o !== null).length;
  const win = winner(state);

  return (
    <aside className="ledger">
      <div className="ledger-head">
        {state.over ? "final" : `turn — ${PLAYER_NAME[state.turn]}`}
      </div>

      <div className="scorecard">
        {([0, 1] as const).map((p) => (
          <div
            key={p}
            className={`score${
              !state.over && state.turn === p ? " score--active" : ""
            }`}
            style={{ "--accent": PLAYER_COLOR[p] } as React.CSSProperties}
          >
            <div className="score-name">
              <span className="score-dot" aria-hidden />
              {PLAYER_NAME[p]}
            </div>
            <div className="score-value">{state.scores[p]}</div>
          </div>
        ))}
      </div>

      <div className="ledger-body">
        {state.over && (
          <div className="banner">
            <strong>
              {win === "draw"
                ? "Drawn."
                : `${PLAYER_NAME[win as 0 | 1]} takes it.`}
            </strong>{" "}
            {state.scores[0]}–{state.scores[1]} over {state.log.length} turns.
          </div>
        )}

        <div
          className={`verdict${analysis.valid ? " verdict--ok" : ""}`}
          aria-live="polite"
        >
          <div className="verdict-points">
            {analysis.points}
            <span
              style={{
                fontSize: 11,
                color: "var(--bone-faint)",
                marginLeft: 6,
                letterSpacing: "0.14em",
              }}
            >
              PTS
            </span>
          </div>
          {analysis.reason}
        </div>

        <div className="btn-row">
          <button
            className="primary"
            onClick={onSubmit}
            disabled={!analysis.valid || state.over}
          >
            Claim
          </button>
          <button onClick={onClear} disabled={state.selection.size === 0}>
            Clear
          </button>
          <button onClick={onPass} disabled={state.over}>
            Pass
          </button>
        </div>

        <div style={{ marginTop: 16 }}>
          {AXES.map((ax: Axis) => (
            <div className="row" key={ax}>
              <span className="row-key">
                <span
                  className="swatch"
                  style={{ background: AXIS_COLOR[ax] }}
                  aria-hidden
                />
                m<sub>{ax}</sub> — {AXIS_NAME[ax]}
              </span>
              <span className="row-val">
                {cap[ax]}/{figure.cells.length} · +{AXIS_VALUE[ax]}
              </span>
            </div>
          ))}
          <div className="row">
            <span className="row-key">cells claimed</span>
            <span className="row-val">
              {claimed}/{figure.cells.length}
            </span>
          </div>
        </div>

        <Inspector figure={figure} hovered={hovered} />

        {state.log.length > 0 && (
          <div className="log">
            {state.log
              .slice()
              .reverse()
              .map((l, k) => (
                <div className="log-line" key={state.log.length - k}>
                  <span style={{ color: PLAYER_COLOR[l.player] }}>
                    {PLAYER_NAME[l.player]}
                  </span>
                  <span>
                    {l.kind === "pass"
                      ? "passed"
                      : `${l.cells} cells · ${l.axes
                          .map((a) => `m${a}`)
                          .join(" ")} · +${l.points}`}
                  </span>
                </div>
              ))}
          </div>
        )}

        <div style={{ marginTop: 14 }}>
          <button onClick={onReset} style={{ width: "100%" }}>
            New game
          </button>
        </div>
      </div>
    </aside>
  );
}
