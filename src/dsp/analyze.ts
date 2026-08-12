/**
 * Headless trace analysis — the contract seam between the DSP pipeline (A2),
 * the fixture regression suite, and the DEMO replays. Frozen signature
 * (ADR-003/ADR-004): tests/unit/zero-crossing.test.ts and
 * tests/fixtures.verify.test.ts call exactly this.
 *
 * Signal convention:
 *  - FIELD traces: samples are the calibrated 3-axis field in µT; the working
 *    signal is |B| = hypot(x,y,z).
 *  - PROXY traces: samples carry the signed heading residual Δψ (degrees) in
 *    `x`, with y = z = 0; the working signal is x itself (sign matters — the
 *    fastener sits at the zero crossing between the lobes).
 *
 * Position estimators (SPEC §4.1.2 step 6b):
 *  - 'zeroCrossing' — the shipped estimator. The fastener is at the zero
 *    crossing between the two lobes of the bipolar signature.
 *  - 'amplitude' — deliberately kept for comparison and teaching. It lands
 *    about one lobe-width off, on the wrong side of the stud edge. It must
 *    never become the shipped estimator; the frozen test asserts its failure.
 */
import type { Confidence, SensorTrace, WarningKey } from '../types';

export type PeakEstimator = 'zeroCrossing' | 'amplitude';

export interface AnalyzeOptions {
  estimator?: PeakEstimator;
  /** Peak threshold multiplier k in prominence ≥ k·σ. Default 3.5. */
  sensitivity?: number;
}

export interface TraceAnalysis {
  /** Fastener position estimates, inches along the sweep (via trace anchors). */
  peaksIn: number[];
  /** Best-fit on-center pitch in inches, or null when no lattice fits. */
  pitchIn: number | null;
  confidence: Confidence;
  warnings: WarningKey[];
}

export function analyzeMagTrace(_trace: SensorTrace, _opts: AnalyzeOptions = {}): TraceAnalysis {
  throw new Error('NOT IMPLEMENTED — A2 (DSP/Magnetics) owns this. See kit/SPEC.md §4.1.2.');
}
