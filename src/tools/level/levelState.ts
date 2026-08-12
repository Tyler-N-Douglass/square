/**
 * LEVEL tool state — pure logic, unit-tested (tests/unit/level-tool-*.test.ts).
 *
 * Claim discipline (SPEC §2.3.5, §4.2.2): the app claims ±0.5° until the
 * two-position reversal calibration is done, ±0.15° after. A stale
 * calibration (> 30 days) keeps its claim but says so and routes to
 * recalibration — suggested, never blocked (SPEC §15.4 degrades visibly).
 *
 * The hold-window uncertainty never undercuts the calibration-state claim:
 * a very quiet sensor cannot talk its way past an uncalibrated zero. Basis
 * is 'stddev' only when the window scatter actually dominates — otherwise
 * the ± is the nominal claim and says so (the explainer text for each basis
 * must stay true; src/guidance/explainers.ts).
 *
 * Units at this layer: DEGREES. `CalibrationProfile.levelBias` is stored in
 * degrees (the claim numbers ±0.5°/±0.15° and ACCURACY.md speak degrees).
 */
import type { CalibrationProfile, Confidence, Measurement, UncertaintyBasis } from '../../types';
import type { MagTier } from '../../sensors/types';
import {
  drainSlopeCheck,
  removeBias,
  reversalCalibration,
  slopeFromAngle,
  type DrainCheck,
} from '../../geometry/levelMath';
import type { LevelMode } from './levelModes';
import { kindForMode } from './levelModes';

export const CLAIM_UNCALIBRATED_DEG = 0.5;
export const CLAIM_CALIBRATED_DEG = 0.15;
export const CLAIM_STALE_MS = 30 * 24 * 60 * 60 * 1000;

/* ---------------------------------------------------------------------- *
 * Claim discipline
 * ---------------------------------------------------------------------- */

export interface LevelClaim {
  plusMinus: number;
  calibrated: boolean;
  /** Calibration age in whole days, null when never calibrated. */
  ageDays: number | null;
  /** True when calibrated but older than 30 days — suggest, don't block. */
  stale: boolean;
  /** Claim line for the UI — says which state is in effect (SPEC §2.3.4/5). */
  text: string;
}

export function claimFor(profile: CalibrationProfile, now = Date.now()): LevelClaim {
  const calibrated = profile.levelBias !== undefined;
  if (!calibrated) {
    return {
      plusMinus: CLAIM_UNCALIBRATED_DEG,
      calibrated: false,
      ageDays: null,
      stale: false,
      text: `CLAIM ±${CLAIM_UNCALIBRATED_DEG}° — reversal calibration not run. REVERSE earns ±${CLAIM_CALIBRATED_DEG}°.`,
    };
  }
  const ageMs = Math.max(0, now - profile.updatedAt);
  const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
  const stale = ageMs > CLAIM_STALE_MS;
  return {
    plusMinus: CLAIM_CALIBRATED_DEG,
    calibrated: true,
    ageDays,
    stale,
    text: stale
      ? `CLAIM ±${CLAIM_CALIBRATED_DEG}° — reversal calibration is ${ageDays} days old. Run REVERSE again.`
      : `CLAIM ±${CLAIM_CALIBRATED_DEG}° — reversal calibration ${ageDays === 0 ? 'run today' : `${ageDays} day${ageDays === 1 ? '' : 's'} old`}.`,
  };
}

/* ---------------------------------------------------------------------- *
 * Session zero — SPEC §4.2.2 "zero here". Per mode, so zeroing a shelf in
 * EDGE never skews a later PLUMB check. Cleared visibly by the same control.
 * ---------------------------------------------------------------------- */

export class LevelSession {
  private surfaceZero: { pitch: number; roll: number } | null = null;
  private scalarZero: Partial<Record<Exclude<LevelMode, 'surface'>, number>> = {};

  zeroed(mode: LevelMode): boolean {
    return mode === 'surface' ? this.surfaceZero !== null : this.scalarZero[mode] !== undefined;
  }

  zeroHere(mode: 'surface', current: { pitchDeg: number; rollDeg: number }): void;
  zeroHere(mode: Exclude<LevelMode, 'surface'>, current: number): void;
  zeroHere(mode: LevelMode, current: { pitchDeg: number; rollDeg: number } | number): void {
    if (mode === 'surface') {
      const c = current as { pitchDeg: number; rollDeg: number };
      this.surfaceZero = { pitch: c.pitchDeg, roll: c.rollDeg };
    } else {
      this.scalarZero[mode] = current as number;
    }
  }

  clearZero(mode: LevelMode): void {
    if (mode === 'surface') this.surfaceZero = null;
    else delete this.scalarZero[mode];
  }

  /** Apply the session zero to a scalar mode reading (degrees). */
  applyScalar(mode: Exclude<LevelMode, 'surface'>, deg: number): number {
    const z = this.scalarZero[mode];
    return z === undefined ? deg : removeBias(deg, z);
  }

  /** Apply the session zero to the surface pair (degrees). */
  applySurface(pitchDeg: number, rollDeg: number): { pitchDeg: number; rollDeg: number } {
    if (this.surfaceZero === null) return { pitchDeg, rollDeg };
    return {
      pitchDeg: removeBias(pitchDeg, this.surfaceZero.pitch),
      rollDeg: removeBias(rollDeg, this.surfaceZero.roll),
    };
  }
}

/* ---------------------------------------------------------------------- *
 * Hold window — stddev basis for a held reading (SPEC §8, charter #6).
 * Samples accumulate only while the fusion says stable; any motion clears
 * the window, so the stats never mix a held reading with the approach.
 * ---------------------------------------------------------------------- */

export interface HoldStats { n: number; mean: number; stddev: number }

export class HoldWindow {
  private samples: number[] = [];
  constructor(private readonly cap = 240) {}

  push(deg: number, stable: boolean): void {
    if (!stable) {
      this.samples.length = 0;
      return;
    }
    this.samples.push(deg);
    if (this.samples.length > this.cap) this.samples.shift();
  }

  clear(): void {
    this.samples.length = 0;
  }

  stats(): HoldStats {
    const n = this.samples.length;
    if (n === 0) return { n: 0, mean: NaN, stddev: NaN };
    const mean = this.samples.reduce((a, b) => a + b, 0) / n;
    if (n === 1) return { n, mean, stddev: 0 };
    const v = this.samples.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (n - 1);
    return { n, mean, stddev: Math.sqrt(v) };
  }
}

/** Minimum held samples before the window can speak for the ±. */
export const MIN_HOLD_SAMPLES = 12;

/**
 * The ± that ships on a saved reading. Never tighter than the calibration
 * claim — window scatter measures noise, not bias, and the bias is what the
 * claim bounds. Basis is 'stddev' only when scatter genuinely dominates.
 */
export function uncertaintyForSave(
  claimDeg: number,
  stats: HoldStats,
): { plusMinus: number; basis: UncertaintyBasis } {
  if (stats.n >= MIN_HOLD_SAMPLES && Number.isFinite(stats.stddev) && stats.stddev > claimDeg) {
    return { plusMinus: stats.stddev, basis: 'stddev' };
  }
  return { plusMinus: claimDeg, basis: 'nominal' };
}

/** Display confidence: STRONG only calibrated + held; LIKELY held but on the
 *  uncalibrated ±0.5° claim; POSSIBLE while moving — an indication, not a
 *  measurement (the motion gate enforces the rest in the render path). */
export function confidenceFor(stable: boolean, calibrated: boolean): Confidence {
  if (!stable) return 'POSSIBLE';
  return calibrated ? 'STRONG' : 'LIKELY';
}

/* ---------------------------------------------------------------------- *
 * Measurement builders — everything displayed or saved flows through
 * Measurement (SPEC §8; uncertainty and confidence are non-optional).
 * ---------------------------------------------------------------------- */

export interface DisplayArgs {
  mode: LevelMode;
  valueDeg: number;
  stable: boolean;
  claim: LevelClaim;
  tier: MagTier;
}

/**
 * The live on-screen Measurement. While MOVING the basis is 'unknown' — the
 * ± disappears and the reading is presented as an indication, not a
 * measurement. That is the render-path enforcement of SPEC §4.2.1, not copy.
 */
export function displayMeasurement(a: DisplayArgs): Measurement {
  return {
    id: 'level-live',
    kind: kindForMode(a.mode),
    value: a.valueDeg,
    unit: '°',
    uncertainty: a.stable
      ? { plusMinus: a.claim.plusMinus, basis: 'nominal' }
      : { plusMinus: NaN, basis: 'unknown' },
    confidence: confidenceFor(a.stable, a.claim.calibrated),
    provenance: {
      tier: a.tier,
      calibrations: {},
      sampleCount: 1,
      capturedAt: 0,
    },
  };
}

export interface SaveArgs {
  mode: LevelMode;
  valueDeg: number;
  claim: LevelClaim;
  stats: HoldStats;
  tier: MagTier;
  calibrations: Record<string, { ok: boolean; ageMs: number }>;
  zeroed: boolean;
  notes?: string;
  now?: number;
  id?: string;
}

export function buildSaveMeasurement(a: SaveArgs): Measurement {
  const u = uncertaintyForSave(a.claim.plusMinus, a.stats);
  const noteParts = [
    `mode:${a.mode}`,
    a.zeroed ? 'zeroed' : null,
    a.claim.calibrated ? 'reversal-calibrated' : 'uncalibrated',
    a.notes ?? null,
  ].filter((s): s is string => s !== null);
  return {
    id: a.id ?? `level-${(a.now ?? Date.now()).toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    kind: kindForMode(a.mode),
    value: a.valueDeg,
    unit: '°',
    uncertainty: u,
    confidence: confidenceFor(true, a.claim.calibrated),
    provenance: {
      tier: a.tier,
      calibrations: a.calibrations,
      sampleCount: a.stats.n,
      capturedAt: a.now ?? Date.now(),
      notes: noteParts.join(' '),
    },
  };
}

/* ---------------------------------------------------------------------- *
 * Reversal calibration state machine — SPEC §4.2.2, guide-engine-driven in
 * index.ts. Pure: fed orientation-shaped samples, it walks
 *   first (hold still, capture m1)
 *   → turn (180° in plane — observable as motion, then stillness again;
 *           a tap-dismiss path calls forceTurnDone())
 *   → second (hold still, capture m2)
 *   → done (bias = (m1+m2)/2 per axis, surface = (m1−m2)/2)
 * The pitch/roll fed here are RAW (bias-free) fusion outputs in degrees —
 * feeding bias-corrected values would calibrate the correction, not the
 * sensor.
 * ---------------------------------------------------------------------- */

export interface ReversalSample { stable: boolean; pitchDeg: number; rollDeg: number }

export interface ReversalResult {
  biasPitchDeg: number;
  biasRollDeg: number;
  surfacePitchDeg: number;
  surfaceRollDeg: number;
  /** Combined per-capture scatter — honesty garnish for the result panel. */
  captureStddevDeg: number;
}

type RevState = 'first' | 'turn' | 'second' | 'done';

export class ReversalMachine {
  private _state: RevState = 'first';
  private acc: Array<{ p: number; r: number }> = [];
  private m1: { p: number; r: number; sd: number } | null = null;
  private unstableRun = 0;
  private sawMotion = false;
  private _result: ReversalResult | null = null;

  constructor(private readonly holdSamples = 20, private readonly motionSamples = 5) {}

  get state(): RevState { return this._state; }
  get result(): ReversalResult | null { return this._result; }

  /** The tap-dismiss path for the turn prompt: user asserts the turn happened. */
  forceTurnDone(): void {
    if (this._state === 'turn') {
      this._state = 'second';
      this.acc = [];
    }
  }

  feed(s: ReversalSample): RevState {
    switch (this._state) {
      case 'first':
      case 'second': {
        if (!s.stable) {
          this.acc = [];
          break;
        }
        this.acc.push({ p: s.pitchDeg, r: s.rollDeg });
        if (this.acc.length >= this.holdSamples) {
          const cap = this.capture();
          if (this._state === 'first') {
            this.m1 = cap;
            this._state = 'turn';
            this.unstableRun = 0;
            this.sawMotion = false;
          } else {
            this.finish(cap);
          }
          this.acc = [];
        }
        break;
      }
      case 'turn': {
        if (!s.stable) {
          this.unstableRun += 1;
          if (this.unstableRun >= this.motionSamples) this.sawMotion = true;
        } else {
          this.unstableRun = 0;
          if (this.sawMotion) {
            // Turned and set back down — the observable signature of the
            // 180° in-plane turn with a yaw-free fusion (yaw is null here;
            // it is never invented — SPEC §15).
            this._state = 'second';
            this.acc = [];
          }
        }
        break;
      }
      case 'done':
        break;
    }
    return this._state;
  }

  private capture(): { p: number; r: number; sd: number } {
    const n = this.acc.length;
    const mp = this.acc.reduce((a, b) => a + b.p, 0) / n;
    const mr = this.acc.reduce((a, b) => a + b.r, 0) / n;
    const v =
      this.acc.reduce((a, b) => a + (b.p - mp) * (b.p - mp) + (b.r - mr) * (b.r - mr), 0) /
      Math.max(1, 2 * n - 2);
    return { p: mp, r: mr, sd: Math.sqrt(v) };
  }

  private finish(m2: { p: number; r: number; sd: number }): void {
    const m1 = this.m1;
    if (!m1) return; // unreachable by construction
    // A 180° in-plane turn flips the true surface component of BOTH axes;
    // the sensor bias rides along unchanged. reversalCalibration splits them.
    const pitch = reversalCalibration(m1.p, m2.p);
    const roll = reversalCalibration(m1.r, m2.r);
    this._result = {
      biasPitchDeg: pitch.bias,
      biasRollDeg: roll.bias,
      surfacePitchDeg: pitch.surface,
      surfaceRollDeg: roll.surface,
      captureStddevDeg: Math.hypot(m1.sd, m2.sd) / 2,
    };
    this._state = 'done';
  }
}

/* ---------------------------------------------------------------------- *
 * Slope strip — SPEC §4.2.3: every trade form of one measured angle, shown
 * simultaneously, each DERIVED with a propagated ± (d/dθ of each form ×
 * claim). The drain callout appears only in the plausible drain range.
 * ---------------------------------------------------------------------- */

export interface StripRow {
  label: string;
  value: number;
  unit: string;
  plusMinus: number;
  decimals: number;
}

export interface SlopeStripModel {
  rows: StripRow[];
  /** rise:run — "1 : N" when meaningful, null when the angle is inside the
   *  claim (run would be fiction) — the UI says LEVEL instead. */
  riseRun: { run: number; plusMinus: number } | null;
  /** Drain-band callout, message verbatim from levelMath.drainSlopeCheck. */
  drain: DrainCheck | null;
}

/** Plausible drain-slope range for showing the callout (charter #4). */
export const DRAIN_SHOW_MIN_IN_PER_FT = 0.05;
export const DRAIN_SHOW_MAX_IN_PER_FT = 1.5;

export function slopeStripModel(angleDeg: number, claimDeg: number): SlopeStripModel {
  const rad = (angleDeg * Math.PI) / 180;
  const claimRad = (claimDeg * Math.PI) / 180;
  const s = slopeFromAngle(rad);
  const sec2 = 1 / (Math.cos(rad) * Math.cos(rad));
  const dTan = sec2 * claimRad; // δ(tan θ) for δθ = claim

  const rows: StripRow[] = [
    { label: 'ANGLE', value: s.degrees, unit: '°', plusMinus: claimDeg, decimals: 1 },
    { label: 'GRADE', value: s.percentGrade, unit: '%', plusMinus: 100 * dTan, decimals: 1 },
    { label: 'PER FOOT', value: s.inPerFt, unit: 'in/ft', plusMinus: 12 * dTan, decimals: 2 },
    { label: 'PER METRE', value: s.mmPerM, unit: 'mm/m', plusMinus: 1000 * dTan, decimals: 0 },
  ];

  const t = Math.tan(rad);
  const riseRun =
    Math.abs(angleDeg) > claimDeg
      ? { run: 1 / Math.abs(t), plusMinus: (sec2 / (t * t)) * claimRad }
      : null;

  const absInPerFt = Math.abs(s.inPerFt);
  const drain =
    absInPerFt >= DRAIN_SHOW_MIN_IN_PER_FT && absInPerFt <= DRAIN_SHOW_MAX_IN_PER_FT
      ? drainSlopeCheck(absInPerFt)
      : null;

  return { rows, riseRun, drain };
}
