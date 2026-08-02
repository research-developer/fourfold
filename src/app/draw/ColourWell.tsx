"use client";

import { useRef, useState } from "react";
import { hslToHex, swatch, swatchFromHex, type Swatch } from "@/lib/schemes";
import styles from "./draw.module.css";

/**
 * The base colour: one hue rail and two fader tracks.
 *
 * A square hue/saturation field would be the obvious control and is the wrong
 * one here. The schemes in `schemes.ts` move the HUE and leave s and l where
 * the base put them (analogous excepted, and only by a shallow lightness fan),
 * so hue is the axis a scheme is expressed along and deserves its own full-
 * width instrument. Saturation and lightness set the register the whole plate
 * is played in and belong under it, as trims.
 *
 * Every track is painted with the colours it would actually produce — the hue
 * rail at the current s and l, the s track from grey to full at the current
 * hue — so the control previews its own effect rather than describing it.
 */

const PRESETS = [
  "#d4a017",
  "#f97316",
  "#d6336c",
  "#a855f7",
  "#6366f1",
  "#1f6feb",
  "#06b6d4",
  "#4ade80",
  "#a3e635",
];

const HUE_STOPS = [0, 60, 120, 180, 240, 300, 360];

const pct = (x: number) => `${Math.round(x * 100)}%`;

interface Props {
  base: Swatch;
  onChange: (s: Swatch) => void;
}

export default function ColourWell({ base, onChange }: Props) {
  const rail = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [typed, setTyped] = useState(base.hex);
  const [bad, setBad] = useState(false);
  const [tracked, setTracked] = useState(base.hex);

  // The hex field is an input as well as a readout, so it follows the model
  // only when the model was moved by something OTHER than this field — the hue
  // rail, a preset, a slider. Adjusted during render against a tracked copy of
  // the prop rather than in an effect: an effect would render the stale text
  // once, then render again to correct it, and the field would visibly flicker
  // while the hue rail is being dragged.
  if (tracked !== base.hex) {
    setTracked(base.hex);
    setTyped(base.hex);
    setBad(false);
  }

  const hueAt = (clientX: number) => {
    const el = rail.current;
    if (el === null) return base.h;
    const r = el.getBoundingClientRect();
    const t = (clientX - r.left) / Math.max(r.width, 1);
    return Math.min(359.9, Math.max(0, t * 360));
  };

  const railDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    onChange(swatch(hueAt(e.clientX), base.s, base.l));
  };

  const railMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    onChange(swatch(hueAt(e.clientX), base.s, base.l));
  };

  const railUp = (e: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const railKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 15 : 1;
    const delta =
      e.key === "ArrowRight" || e.key === "ArrowUp"
        ? step
        : e.key === "ArrowLeft" || e.key === "ArrowDown"
        ? -step
        : e.key === "Home"
        ? -base.h
        : e.key === "End"
        ? 359 - base.h
        : null;
    if (delta === null) return;
    e.preventDefault();
    onChange(swatch(base.h + delta, base.s, base.l));
  };

  const commitHex = (v: string) => {
    setTyped(v);
    try {
      onChange(swatchFromHex(v));
      setBad(false);
    } catch {
      setBad(true);
    }
  };

  return (
    <div>
      <div
        ref={rail}
        className={styles.hueRail}
        role="slider"
        tabIndex={0}
        aria-label="base hue, degrees"
        aria-valuemin={0}
        aria-valuemax={359}
        aria-valuenow={Math.round(base.h)}
        aria-valuetext={`${Math.round(base.h)} degrees`}
        style={{
          background: `linear-gradient(to right, ${HUE_STOPS.map((h) =>
            hslToHex(h, base.s, base.l)
          ).join(", ")})`,
        }}
        onPointerDown={railDown}
        onPointerMove={railMove}
        onPointerUp={railUp}
        onPointerCancel={railUp}
        onKeyDown={railKey}
      >
        <div className={styles.hueThumb} style={{ left: `${(base.h / 360) * 100}%` }} />
      </div>

      <div className={styles.sliderRow}>
        <span className={styles.sliderKey}>S</span>
        <input
          className={styles.slider}
          type="range"
          min={0}
          max={100}
          value={Math.round(base.s * 100)}
          aria-label="base saturation, percent"
          style={{
            background: `linear-gradient(to right, ${hslToHex(base.h, 0, base.l)}, ${hslToHex(
              base.h,
              1,
              base.l
            )})`,
          }}
          onChange={(e) => onChange(swatch(base.h, Number(e.target.value) / 100, base.l))}
        />
        <span className={styles.sliderVal}>{pct(base.s)}</span>
      </div>

      <div className={styles.sliderRow}>
        <span className={styles.sliderKey}>L</span>
        <input
          className={styles.slider}
          type="range"
          min={0}
          max={100}
          value={Math.round(base.l * 100)}
          aria-label="base lightness, percent"
          style={{
            background: `linear-gradient(to right, #000, ${hslToHex(
              base.h,
              base.s,
              0.5
            )}, #fff)`,
          }}
          onChange={(e) => onChange(swatch(base.h, base.s, Number(e.target.value) / 100))}
        />
        <span className={styles.sliderVal}>{pct(base.l)}</span>
      </div>

      <div className={styles.presets} role="group" aria-label="preset base colours">
        {PRESETS.map((hex) => (
          <button
            key={hex}
            type="button"
            className={styles.preset}
            style={{ background: hex }}
            aria-label={`base colour ${hex}`}
            aria-pressed={base.hex === hex}
            onClick={() => onChange(swatchFromHex(hex))}
          />
        ))}
      </div>

      <div className={styles.hexRow}>
        <span className={styles.hexSample} style={{ background: base.hex }} aria-hidden="true" />
        <input
          className={styles.hexInput}
          value={typed}
          spellCheck={false}
          aria-label="base colour as hex"
          aria-invalid={bad}
          onChange={(e) => commitHex(e.target.value)}
        />
      </div>
    </div>
  );
}
