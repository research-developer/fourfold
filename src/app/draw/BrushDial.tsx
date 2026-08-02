"use client";

import { glyphOrbit, subgroupShape } from "@/lib/guides";
import type { BrushMode, CanvasKind } from "@/lib/orbit";
import styles from "./draw.module.css";

/**
 * The brush selector.
 *
 * Each button's glyph is the ACTUAL ORBIT of a generic point under the subgroup
 * that button selects, computed by `glyphOrbit` from the same shape the overlay
 * draws from. Nothing here is a hand-drawn icon, so a button cannot come to
 * disagree with the brush behind it — change the subgroup table and the icons
 * change with it.
 *
 * The seed point is placed deliberately OFF every mirror, so the glyph shows
 * the full |H| dots. A seed on a mirror would show a short orbit, which is a
 * true picture of a pinned cell but a misleading picture of the brush.
 */

const SEED_ANGLE: Record<CanvasKind, number> = {
  // Halfway between two adjacent mirrors in each family: 60° sits between the
  // triangle's 30° and 90° medians, 15° between the hexagon's 0° and 30°.
  triangle: 60,
  hexagon: 15,
};

const TRIANGLE_MIRROR_COLOUR = ["#4ade80", "#67e8f9", "#f59e0b"]; // 30°, 90°, 150° = m_B, m_A, m_C

const mirrorColour = (kind: CanvasKind, index: number, angle: number) =>
  kind === "triangle"
    ? TRIANGLE_MIRROR_COLOUR[index] ?? "#67e8f9"
    : (angle / 30) % 2 === 1
    ? "#67e8f9"
    : "#f59e0b";

const R_DOT = 30;
const R_LINE = 42;

export function SubgroupGlyph({
  kind,
  mode,
  active,
}: {
  kind: CanvasKind;
  mode: BrushMode;
  active: boolean;
}) {
  const shape = subgroupShape(kind, mode);
  const a = (SEED_ANGLE[kind] * Math.PI) / 180;
  const orbit = glyphOrbit(shape, [R_DOT * Math.cos(a), R_DOT * Math.sin(a)]);

  return (
    <svg viewBox="-50 -50 100 100" className={styles.dialGlyph} aria-hidden="true">
      {shape.mirrors.map((deg, k) => {
        const t = (deg * Math.PI) / 180;
        const dx = Math.cos(t) * R_LINE;
        const dy = Math.sin(t) * R_LINE;
        return (
          <line
            key={deg}
            x1={-dx}
            y1={dy}
            x2={dx}
            y2={-dy}
            stroke={mirrorColour(kind, k, deg)}
            strokeWidth={3}
            opacity={active ? 0.7 : 0.34}
            strokeLinecap="round"
          />
        );
      })}

      {shape.rotation > 1 && (
        <circle
          r={R_DOT}
          fill="none"
          stroke="#a78bfa"
          strokeWidth={2}
          strokeDasharray="4 5"
          opacity={active ? 0.62 : 0.28}
        />
      )}

      {orbit.map((p, k) => (
        <circle
          key={k}
          cx={p[0]}
          // The glyph is drawn in mathematical orientation, so y is negated to
          // land on screen the same way the canvas overlay does.
          cy={-p[1]}
          r={7.5}
          fill={active ? "#ece6dc" : "#8a8078"}
        />
      ))}

      <circle r={2.6} fill={active ? "#ece6dc" : "#5a534b"} />
    </svg>
  );
}

interface Props {
  kind: CanvasKind;
  modes: readonly BrushMode[];
  mode: BrushMode;
  onPick: (m: BrushMode) => void;
}

export default function BrushDial({ kind, modes, mode, onPick }: Props) {
  return (
    <div className={styles.dial} role="group" aria-label="brush symmetry">
      {modes.map((m) => (
        <button
          key={m}
          type="button"
          className={styles.dialBtn}
          aria-pressed={mode === m}
          aria-label={`${m}-fold brush — subgroup of order ${m}`}
          onClick={() => onPick(m)}
        >
          <SubgroupGlyph kind={kind} mode={m} active={mode === m} />
          <span className={styles.dialNum}>{m}</span>
        </button>
      ))}
    </div>
  );
}
