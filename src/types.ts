/**
 * Shared contracts — SPEC §8. Lead-owned (ADR-003).
 * Subagents import from here and never redefine these types.
 * Changing anything in this file requires an ADR in DECISIONS.md.
 */

export type Vec3 = [number, number, number];
/** Row-major 3×3. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];
export interface Quat { w: number; x: number; y: number; z: number; }

export type MagTier = 'FIELD' | 'PROXY' | 'NONE';

export type Confidence = 'STRONG' | 'LIKELY' | 'POSSIBLE' | 'NOISE' | 'UNRELIABLE';

/**
 * Closed union of warning keys (ADR-003). Every key has an explainer card
 * (why it happens / what to do / what ignoring it costs) — SPEC §7B.6.
 * A warning invented ad hoc does not compile.
 */
export type WarningKey =
  | 'WALL_HOT'
  | 'MAGNETIC_ACCESSORY'
  | 'SWEEP_TOO_FAST'
  | 'RATE_COLLAPSE'
  | 'SATURATED'
  | 'UNCALIBRATED'
  | 'GYRO_DRIFT'
  | 'LENS_UNCALIBRATED'
  | 'POOR_GEOMETRY';

export type UncertaintyBasis = 'montecarlo' | 'stddev' | 'nominal' | 'unknown';

/**
 * Everything the UI displays as a measurement flows through this.
 * `uncertainty` and `confidence` are deliberately non-optional (SPEC §8, §15.1):
 * a bare number has no render path.
 */
export interface Measurement<T = number> {
  id: string;
  kind: 'stud' | 'angle' | 'level' | 'plumb' | 'corner' | 'layout' | 'bevel';
  value: T;
  unit: string;
  uncertainty: { plusMinus: number; basis: UncertaintyBasis };
  confidence: Confidence;
  provenance: {
    tier: MagTier;
    calibrations: Record<string, { ok: boolean; ageMs: number }>;
    sampleCount: number;
    capturedAt: number;
    notes?: string;
  };
  media?: { photoId?: string; overlay?: unknown };
}

export interface CalibrationProfile {
  deviceKey: string;
  updatedAt: number;
  mag?: { hardIron: Vec3; softIron: Mat3; residual: number; coverage: number };
  sensorOffset?: { x: number; y: number }; // normalized screen coords
  levelBias?: { pitch: number; roll: number };
  lens?: Record<string, { fPx: number; k1?: number; width: number; height: number }>;
}

/**
 * Sensor trace — `square.trace/1` (tests/fixtures/SCHEMA.md).
 * One format for three jobs: the replay harness, the regression corpus, and
 * the in-app DEMO walkthroughs. The tutorial IS the test.
 */
export interface TraceAnchor { t: number; in: number; }
export interface TraceSample { t: number; x: number; y: number; z: number; }
export interface TraceExpected {
  peaks_in: number[];
  tolerance_in: number;
  pitch_in: number | null;
  confidence: Confidence;
  warnings: WarningKey[];
}
export interface SensorTrace {
  schema: 'square.trace/1';
  id: string;
  synthetic: boolean;
  note: string;
  device: { platform: string; magTier: MagTier };
  hz: number;
  units: { mag: string; t: string; distance: string };
  anchors: TraceAnchor[];
  samples: TraceSample[];
  expected: TraceExpected;
}

/** Number provenance for display — SPEC §5, §15.5. Styled distinguishably, always. */
export type NumberProvenance = 'measured' | 'derived' | 'entered';
