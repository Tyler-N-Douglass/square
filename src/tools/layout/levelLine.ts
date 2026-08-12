/**
 * LAYOUT level line — SPEC §4.4.2, scoped per Phase 2 charter: the live
 * camera overlay is A5's territory, so LAYOUT establishes the level line
 * NUMERICALLY. Hold the phone against the wall as a straightedge, capture the
 * roll over a still window (real OrientationFusion output), and read the
 * line's drop over the span via outOverRun. The §4.4.2 boundary is stated in
 * the UI verbatim: the overlay plans and verifies; the tape makes the mark.
 */
import type { Orientation } from '../../sensors/types';
import { outOverRun } from '../../geometry/levelMath';

export const ROLL_WINDOW_MS = 500;

export interface RollReading {
  /** Mean roll over the still window, radians. */
  rollRad: number;
  /** Standard deviation of the window's roll samples, radians. */
  stddevRad: number;
  sampleCount: number;
  t: number;
}

export type RollPhase =
  | { phase: 'idle' }
  | { phase: 'moving' }
  | { phase: 'settling'; progress: number }
  | { phase: 'captured'; reading: RollReading };

/**
 * Same shape as BEVEL's capture: arm, feed Orientation samples, capture after
 * a 500 ms window of `stable` fusion output. Consumes the fused stream the
 * tool already subscribes to — no second fusion instance.
 */
export class RollCapture {
  private windowStart: number | null = null;
  private rolls: number[] = [];
  private armed = false;
  private state: RollPhase = { phase: 'idle' };

  get phase(): RollPhase {
    return this.state;
  }

  arm(): void {
    if (this.state.phase === 'idle' || this.state.phase === 'captured') this.state = { phase: 'moving' };
    this.armed = true;
    this.windowStart = null;
    this.rolls = [];
  }

  reset(): void {
    this.armed = false;
    this.windowStart = null;
    this.rolls = [];
    this.state = { phase: 'idle' };
  }

  ingest(o: Orientation): RollPhase {
    if (!this.armed || this.state.phase === 'captured') return this.state;
    if (!o.stable) {
      this.windowStart = null;
      this.rolls = [];
      this.state = { phase: 'moving' };
      return this.state;
    }
    if (this.windowStart === null) this.windowStart = o.t;
    this.rolls.push(o.roll);
    const elapsedMs = (o.t - this.windowStart) * 1000;
    if (elapsedMs >= ROLL_WINDOW_MS) {
      const n = this.rolls.length;
      const mean = this.rolls.reduce((a, b) => a + b, 0) / n;
      const varSum = this.rolls.reduce((a, b) => a + (b - mean) * (b - mean), 0);
      this.state = {
        phase: 'captured',
        reading: { rollRad: mean, stddevRad: Math.sqrt(varSum / n), sampleCount: n, t: o.t },
      };
    } else {
      this.state = { phase: 'settling', progress: Math.min(1, elapsedMs / ROLL_WINDOW_MS) };
    }
    return this.state;
  }
}

export interface LevelLineDrop {
  /** How far the line falls over the span: tan(roll) · span, inches. */
  dropIn: number;
  /** Propagated: span · δθ / cos²θ, inches. */
  plusMinusIn: number;
}

/**
 * Drop over the span, with the ± propagated from the DISCIPLINED angle
 * uncertainty. `plusMinusRad` is the same ± the roll readout claims —
 * max(calibration-state claim, window scatter), per LEVEL's claim discipline
 * (SPEC §2.3.5; src/tools/level/levelState.ts) — never the raw window
 * scatter alone: a quiet sensor cannot talk its way past an uncalibrated
 * zero, and neither can the drop derived from it.
 */
export function levelLineDrop(reading: RollReading, spanIn: number, plusMinusRad: number): LevelLineDrop {
  const c = Math.cos(reading.rollRad);
  return {
    dropIn: outOverRun(reading.rollRad, spanIn),
    plusMinusIn: (spanIn * plusMinusRad) / (c * c),
  };
}

/** The §4.4.2 boundary, stated plainly wherever the line renders. */
export const OVERLAY_BOUNDARY_LINE = 'The overlay plans and verifies. The tape makes the mark.';
