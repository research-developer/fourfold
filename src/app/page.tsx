"use client";

import { useCallback, useMemo, useState } from "react";
import Board, { type ColorMode } from "@/components/Board";
import Ledger from "@/components/Ledger";
import { CHARGE_NAME, H, type Figure } from "@/lib/figure";
import { AXIS_NAME, PLAYER_NAME } from "@/lib/palette";
import {
  analyseClaim,
  clearSelection,
  newGame,
  pass,
  submitClaim,
  toggleCell,
  type GameState,
} from "@/lib/game";

const DEPTHS = [3, 4, 5] as const;

/** What a screen reader is told about the cell under the cursor. */
function describe(figure: Figure, i: number, selected: boolean): string {
  const c = figure.cells[i];
  const coset = H.has(c.charge)
    ? "coset H, pairs with gold and purple"
    : "outside H, pairs with blue and red";
  const axes = c.coherentAxes.length
    ? c.coherentAxes.map((a) => AXIS_NAME[a]).join(", ")
    : "no axis";
  return `${c.addr.split("").join(" ")}, ${CHARGE_NAME[c.charge]}, ${coset}, ${
    c.eps === 0 ? "upright" : "inverted"
  }, pairs on ${axes}, ${selected ? "selected" : "not selected"}`;
}

export default function Page() {
  const [depth, setDepth] = useState<number>(4);
  const [state, setState] = useState<GameState>(() => newGame(4));
  const [cursor, setCursor] = useState<number | null>(null);
  const [showMedians, setShowMedians] = useState(true);
  const [colorMode, setColorMode] = useState<ColorMode>("charge");
  const [phaseLevel, setPhaseLevel] = useState(2);
  // Two polite regions: one for where the cursor is, one for what happened.
  const [srCursor, setSrCursor] = useState("");
  const [srEvent, setSrEvent] = useState("");

  const analysis = useMemo(
    () => analyseClaim(state.figure, state.selection),
    [state.figure, state.selection]
  );

  const scoringCells = useMemo(
    () => new Set(analysis.verdicts.keys()),
    [analysis]
  );

  const reset = useCallback((d: number) => {
    setDepth(d);
    setState(newGame(d));
    setPhaseLevel((k) => Math.min(k, d));
    setCursor(null);
    setSrCursor("");
    setSrEvent(`New game at depth ${d}. ${PLAYER_NAME[0]} to play.`);
  }, []);

  const handleCursor = useCallback(
    (i: number | null, viaKeyboard?: boolean) => {
      setCursor(i);
      if (viaKeyboard && i !== null) {
        setSrCursor(describe(state.figure, i, state.selection.has(i)));
      }
    },
    [state.figure, state.selection]
  );

  const handleSubmit = useCallback(() => {
    setState((s) => {
      const a = analyseClaim(s.figure, s.selection);
      const next = submitClaim(s);
      if (next === s) return s;
      const who = PLAYER_NAME[s.turn];
      const axes = [...new Set([...a.verdicts.values()].flatMap((v) => v.axes))]
        .sort()
        .map((x) => AXIS_NAME[x])
        .join(" and ");
      setSrEvent(
        `${who} claimed ${a.verdicts.size} cells on the ${axes} median, plus ${a.points}. ` +
          `${PLAYER_NAME[0]} ${next.scores[0]}, ${PLAYER_NAME[1]} ${next.scores[1]}. ` +
          (next.over
            ? "Board full, game over."
            : `${PLAYER_NAME[next.turn]} to play.`)
      );
      return next;
    });
  }, []);

  const handlePass = useCallback(() => {
    setState((s) => {
      const next = pass(s);
      setSrEvent(
        `${PLAYER_NAME[s.turn]} passed. ` +
          (next.over
            ? "Two passes in a row, game over."
            : `${PLAYER_NAME[next.turn]} to play.`)
      );
      return next;
    });
  }, []);

  return (
    <main className="shell">
      <header className="masthead">
        <h1 className="wordmark display">Fourfold</h1>
        <p className="dek">
          Two players claim mirror symmetries on a Galois-coloured Sierpiński
          triangle. One axis is free. Two are earned.
        </p>
      </header>

      <div className="sr-only" role="status" aria-live="polite">
        {srEvent}
      </div>
      <div className="sr-only" role="status" aria-live="polite">
        {srCursor}
      </div>

      <div className="layout">
        <section className="plate">
          <div className="plate-rule">
            <span>
              V₄ XOR Sierpiński · depth {depth} · {state.figure.cells.length}{" "}
              cells
            </span>
            <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span
                className="seg"
                role="radiogroup"
                aria-label="Recursion depth"
              >
                {DEPTHS.map((d) => (
                  <button
                    key={d}
                    role="radio"
                    aria-checked={depth === d}
                    aria-label={`Depth ${d}, ${4 ** d} cells`}
                    onClick={() => reset(d)}
                  >
                    d{d}
                  </button>
                ))}
              </span>
              <span className="seg">
                <button
                  aria-pressed={showMedians}
                  onClick={() => setShowMedians((v) => !v)}
                >
                  medians
                </button>
                <button
                  aria-pressed={colorMode === "coset"}
                  aria-label="Coset view: recolour the board by pairing group only"
                  title="Recolour by pairing group only — the most colour-blind-legible view"
                  onClick={() =>
                    setColorMode((m) => (m === "coset" ? "charge" : "coset"))
                  }
                >
                  coset
                </button>
                <button
                  aria-pressed={colorMode === "phase"}
                  aria-label="Phase view: colour each region by which recolouring realises its mirror"
                  title="Colour each sub-triangle by its mirror phase"
                  onClick={() =>
                    setColorMode((m) => (m === "phase" ? "charge" : "phase"))
                  }
                >
                  phase
                </button>
              </span>
            </span>
          </div>

          {colorMode === "phase" && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                fontSize: 10,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "var(--bone-faint)",
                marginBottom: 8,
              }}
            >
              <label htmlFor="phaseLevel">scale</label>
              <input
                id="phaseLevel"
                type="range"
                min={1}
                max={depth}
                step={1}
                value={phaseLevel}
                onChange={(e) => setPhaseLevel(Number(e.target.value))}
                style={{ flex: 1, maxWidth: 240, accentColor: "var(--lime)" }}
              />
              <span style={{ color: "var(--bone)" }}>
                {4 ** phaseLevel} regions
              </span>
              <span>
                gold = mirrors in phase · purple = cosets swapped
              </span>
            </div>
          )}

          <Board
            figure={state.figure}
            selection={state.selection}
            owner={state.owner}
            scoringCells={scoringCells}
            showMedians={showMedians}
            colorMode={colorMode}
            phaseLevel={phaseLevel}
            cursor={cursor}
            onCursor={handleCursor}
            onToggle={(i) => setState((s) => toggleCell(s, i))}
          />
        </section>

        <Ledger
          state={state}
          analysis={analysis}
          cursor={cursor}
          onSubmit={handleSubmit}
          onClear={() => setState(clearSelection)}
          onPass={handlePass}
          onReset={() => reset(depth)}
        />
      </div>

      <section className="notes">
        <div className="notes-grid">
          <div className="note">
            <h3>How to play</h3>
            <p>
              Click cells to build a <strong>claim</strong>. A cell scores only
              if its mirror partner across some median is <em>also</em> in the
              claim and the two colours are compatible — both from{" "}
              <strong>gold / purple</strong>, or both from{" "}
              <strong>blue / red</strong>. Cells outside the gold/purple pair
              are <strong>hatched</strong>, so the rule never depends on telling
              hues apart.
            </p>
            <p>
              A claim needs <strong>three scoring cells</strong> to stand and may
              use at most <strong>twelve</strong> — a symmetry is a motif, not a
              landgrab. Unpaired cells score nothing and are released back to
              the board. Two passes in a row ends the game.
            </p>
            <p>
              Keyboard: arrows move, space selects, <code>A</code>/<code>B</code>
              /<code>C</code> jump to the mirror partner across that median,{" "}
              <code>Home</code> goes to the hub.
            </p>
          </div>

          <div className="note">
            <h3>Why one axis is free</h3>
            <p>
              Reflecting across the vertical median swaps the digits B and C in
              every address. That swap lifts to an <strong>automorphism</strong>{" "}
              of the Klein four-group — it exchanges σ₂ with σ₃ and fixes 1 and
              σ₂σ₃. So gold stays gold, purple stays purple, and blue and red
              trade places. <strong>Every</strong> vertical pair is legal, which
              is why it pays only <code>+1</code>.
            </p>
          </div>

          <div className="note">
            <h3>Why two axes are earned</h3>
            <p>
              The diagonals act on addresses <em>with carry</em>, like an
              odometer, so no relabelling of the four colours can track them. A
              diagonal pair is legal for exactly one third of the board —{" "}
              <code>(4ᵈ−1)/3</code> cells, plus the hub.
            </p>
            <p>
              The tell: look at the <strong>first digit that is not X</strong>.
              If it is B, the left diagonal works. If it is C, the right
              diagonal works. Nothing else about the address matters. Each
              diagonal pays <code>+3</code>.
            </p>
          </div>

          <div className="note">
            <h3>The hub</h3>
            <p>
              The all-X address is the only cell sitting on all three medians at
              once, and the single cell where the figure&apos;s threefold
              structure is exact. Its charge is <code>(σ₂σ₃)ᵈ</code> — gold at
              even depth, purple at odd.
            </p>
            <p>
              It sits <em>on</em> every median rather than pairing across one, so
              it collects <code>+7</code> only in a claim where real pairs have
              established all three axes.
            </p>
          </div>
        </div>
      </section>

      <footer
        style={{
          marginTop: 34,
          paddingTop: 14,
          borderTop: "1px solid var(--rule)",
          fontSize: 10.5,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "var(--bone-faint)",
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <span>
          V₄ ≅ Gal(ℚ(√2,√3)/ℚ) · scoring verified exhaustively at depths 2–6
        </span>
        <a
          href="https://github.com/research-developer/fourfold"
          style={{ color: "inherit" }}
        >
          source
        </a>
      </footer>
    </main>
  );
}
