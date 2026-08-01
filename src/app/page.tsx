"use client";

import { useCallback, useMemo, useState } from "react";
import Board from "@/components/Board";
import Ledger from "@/components/Ledger";
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

export default function Page() {
  const [depth, setDepth] = useState<number>(4);
  const [state, setState] = useState<GameState>(() => newGame(4));
  const [hovered, setHovered] = useState<number | null>(null);
  const [showMedians, setShowMedians] = useState(true);

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
    setHovered(null);
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

      <div className="layout">
        <section className="plate">
          <div className="plate-rule">
            <span>
              V₄ XOR Sierpiński · depth {depth} · {state.figure.cells.length}{" "}
              cells
            </span>
            <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className="seg">
                {DEPTHS.map((d) => (
                  <button
                    key={d}
                    aria-pressed={depth === d}
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
              </span>
            </span>
          </div>

          <Board
            figure={state.figure}
            selection={state.selection}
            owner={state.owner}
            scoringCells={scoringCells}
            showMedians={showMedians}
            hovered={hovered}
            onHover={setHovered}
            onToggle={(i) => setState((s) => toggleCell(s, i))}
          />
        </section>

        <Ledger
          state={state}
          analysis={analysis}
          hovered={hovered}
          onSubmit={() => setState(submitClaim)}
          onClear={() => setState(clearSelection)}
          onPass={() => setState(pass)}
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
              <strong>blue / red</strong>.
            </p>
            <p>
              A claim needs <strong>three scoring cells</strong> to stand and may
              use at most <strong>twelve</strong> — a symmetry is a motif, not a
              landgrab. Unpaired cells score nothing and are released back to the
              board. Two passes in a row ends the game.
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
              once. It pairs on every axis, and it is the single cell where the
              figure&apos;s threefold structure is exact. Its charge is{" "}
              <code>(σ₂σ₃)ᵈ</code> — gold at even depth, purple at odd.
            </p>
            <p>
              Worth <code>+7</code> if you pair it on all three axes at once.
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
