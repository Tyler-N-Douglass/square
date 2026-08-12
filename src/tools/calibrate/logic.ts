/**
 * CALIBRATE pure logic — SPEC §4.6. DOM-free, deterministic, tested in
 * tests/unit/calibrate-logic.test.ts.
 *
 * Contents:
 *  - mag routine pass/fail over the REAL ellipsoid fit output (§4.6.1:
 *    all octants covered, residual < 5%, |b| reported; |b| > 40 µT fails
 *    loudly with the MAGNETIC_ACCESSORY message verbatim);
 *  - octant coverage tracking + the flat 2D octant grid projection;
 *  - sensor-locator 9-point grid and the 2D quadratic peak fit (§4.1.3);
 *  - level reversal-zero capture state machine over Orientation samples;
 *  - lens acceptance gate over calibrateFromSheet results + a seeded MC
 *    focal uncertainty;
 *  - measured-rate counter, diagnostics blob, age formatting, and the
 *    per-routine outcome store (pass AND fail are remembered — a failed
 *    calibration is a state, not a secret).
 */
import type { Vec3 } from '../../types';
import type { CalibrationProfile } from '../../types';
import type { CapabilityReport } from '../../sensors/types';
import { HARD_IRON_ACCESSORY_UT, type EllipsoidFit } from '../../dsp/calibration';
import { WARNING_COPY } from '../../ui/components/warning';
import { reversalCalibration } from '../../geometry/levelMath';
import { solveLinear } from '../../dsp/linalg';
import {
  calibrateFromSheet,
  type SheetCalibrationResult,
} from '../../geometry/intrinsics';
import { gaussianSampler, mulberry32, quantileSorted } from '../../geometry/montecarlo';
import type { Px } from '../../geometry/angleSolver';

/* ------------------------------------------------------------------ */
/* Routine identity + outcome store                                    */
/* ------------------------------------------------------------------ */

export type RoutineId = 'mag' | 'locator' | 'levelZero' | 'lens';

/** Which profile block each routine writes (calibrationStore ages key off these). */
export const ROUTINE_PROFILE_PART: Record<RoutineId, 'mag' | 'sensorOffset' | 'levelBias' | 'lens'> = {
  mag: 'mag',
  locator: 'sensorOffset',
  levelZero: 'levelBias',
  lens: 'lens',
};

export const ROUTINE_TITLES: Record<RoutineId, string> = {
  mag: 'MAGNETOMETER IRON',
  locator: 'SENSOR LOCATOR',
  levelZero: 'LEVEL REVERSAL ZERO',
  lens: 'LENS INTRINSICS',
};

/** "What depends on it" — shown on every card (SPEC §4.6). */
export const ROUTINE_DEPENDENTS: Record<RoutineId, string> = {
  mag: 'SCAN rides on this: peak heights, the noise floor, and every confidence badge.',
  locator: 'SCAN’s reticle — where “over the sensor” actually is on your phone.',
  levelZero: 'LEVEL claims tighter than ±0.5° only after this passes.',
  lens: 'CORNER: ±0.3–0.8° with it, ±1.5–3° without it.',
};

export interface RoutineOutcome {
  at: number;
  pass: boolean;
  /** Plain-voice one-liner shown on the card. */
  note: string;
}

export interface OutcomeStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

const OUTCOME_KEY = 'square.calibrate.outcomes.v1';

function defaultStorage(): OutcomeStorage {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    if (ls) {
      ls.setItem(`${OUTCOME_KEY}.probe`, '1');
      ls.removeItem(`${OUTCOME_KEY}.probe`);
      return { get: (k) => ls.getItem(k), set: (k, v) => ls.setItem(k, v) };
    }
  } catch {
    /* fall through */
  }
  const m = new Map<string, string>();
  return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v) };
}

export function loadOutcomes(storage: OutcomeStorage = defaultStorage()): Partial<Record<RoutineId, RoutineOutcome>> {
  try {
    const raw = storage.get(OUTCOME_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<Record<RoutineId, RoutineOutcome>>;
  } catch {
    return {};
  }
}

export function saveOutcome(
  id: RoutineId,
  outcome: RoutineOutcome,
  storage: OutcomeStorage = defaultStorage(),
): void {
  const all = loadOutcomes(storage);
  all[id] = outcome;
  try {
    storage.set(OUTCOME_KEY, JSON.stringify(all));
  } catch {
    /* quota — the card falls back to profile presence */
  }
}

/** 'never' | 'just now' | '5 min ago' | '3 h ago' | '2 d ago'. */
export function formatAge(ms: number | null): string {
  if (ms === null) return 'never';
  if (ms < 60_000) return 'just now';
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}

/* ------------------------------------------------------------------ */
/* Mag routine — pass criteria over the real fit (§4.6.1)              */
/* ------------------------------------------------------------------ */

export const MAG_RESIDUAL_MAX = 0.05;
export const MAG_COLLECT_TARGET_S = 25; // 20–30 s figure-8

export interface MagEvaluation {
  pass: boolean;
  /** |b| > 40 µT: a magnet on the phone, never stored as ok. */
  accessory: boolean;
  hardIronUt: number;
  residual: number;
  coverage: number;
  reasons: string[];
}

export function evaluateMagFit(fit: EllipsoidFit): MagEvaluation {
  const hardIronUt = Math.hypot(fit.hardIron[0], fit.hardIron[1], fit.hardIron[2]);
  const reasons: string[] = [];
  let accessory = false;
  if (!fit.ok) {
    reasons.push(fit.reason ?? 'Fit failed.');
    return { pass: false, accessory, hardIronUt, residual: fit.residual, coverage: fit.coverage, reasons };
  }
  if (hardIronUt > HARD_IRON_ACCESSORY_UT) {
    accessory = true;
    reasons.push(WARNING_COPY.MAGNETIC_ACCESSORY);
  }
  if (fit.coverage < 1) {
    reasons.push(`Coverage ${Math.round(fit.coverage * 8)}/8 octants — keep rotating through the empty cells.`);
  }
  if (fit.residual >= MAG_RESIDUAL_MAX) {
    reasons.push(
      `Residual ${(fit.residual * 100).toFixed(1)}% is over the 5% pass line — sweep smoother, away from steel.`,
    );
  }
  return {
    pass: reasons.length === 0,
    accessory,
    hardIronUt,
    residual: fit.residual,
    coverage: fit.coverage,
    reasons,
  };
}

/** Octant index around a center — same convention as dsp/calibration.ts. */
export function octantIndex(v: Vec3, center: Vec3): number {
  return (
    (v[0] - center[0] >= 0 ? 1 : 0) | (v[1] - center[1] >= 0 ? 2 : 0) | (v[2] - center[2] >= 0 ? 4 : 0)
  );
}

/** Flat 2D cell for the octant-fill display: row by z sign, col by x/y signs. */
export function octantCell(index: number): { row: 0 | 1; col: 0 | 1 | 2 | 3 } {
  const row: 0 | 1 = (index & 4) !== 0 ? 0 : 1;
  const col = ((index & 1) !== 0 ? 1 : 0) + ((index & 2) !== 0 ? 2 : 0);
  return { row, col: col as 0 | 1 | 2 | 3 };
}

/**
 * Live coverage during the figure-8: keeps all samples (the fit needs them
 * anyway) and recomputes octant counts around the running mean — the center
 * moves as hard iron reveals itself.
 */
export class CoverageTracker {
  readonly samples: Vec3[] = [];
  private sum: Vec3 = [0, 0, 0];

  push(v: Vec3): void {
    this.samples.push(v);
    this.sum = [this.sum[0] + v[0], this.sum[1] + v[1], this.sum[2] + v[2]];
  }

  get center(): Vec3 {
    const n = this.samples.length;
    if (n === 0) return [0, 0, 0];
    return [this.sum[0] / n, this.sum[1] / n, this.sum[2] / n];
  }

  counts(): number[] {
    const c = this.center;
    const out = new Array<number>(8).fill(0);
    for (const s of this.samples) out[octantIndex(s, c)]! += 1;
    return out;
  }

  /** Octants with at least minPerOctant samples. */
  filledCount(minPerOctant = 5): number {
    return this.counts().filter((n) => n >= minPerOctant).length;
  }
}

/* ------------------------------------------------------------------ */
/* Sensor locator — 9-point grid + quadratic peak (§4.1.3)             */
/* ------------------------------------------------------------------ */

/** Normalized screen positions for the 9 dwell points, row-major. */
export const LOCATOR_GRID: ReadonlyArray<{ x: number; y: number }> = [0.15, 0.5, 0.85].flatMap(
  (y) => [0.15, 0.5, 0.85].map((x) => ({ x, y })),
);

export const LOCATOR_DWELL_MS = 1500;
/** Minimum µT swing across the grid for a believable peak. */
export const LOCATOR_MIN_SWING_UT = 3;

/** Robust per-dwell amplitude: median |B| over the window. */
export function windowAmplitude(mags: readonly number[]): number {
  if (mags.length === 0) return NaN;
  const s = [...mags].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

export type PeakFit =
  | { ok: true; x: number; y: number }
  | { ok: false; reason: string };

/**
 * Fit z = c0 + c1x + c2y + c3x² + c4xy + c5y² to the 9 amplitudes and return
 * the interpolated maximum. Refuses when the surface has no interior maximum
 * (Hessian not negative-definite), when the swing is below the noise a screw
 * should produce, or when the peak lands far outside the screen.
 */
export function fitPeak2D(
  points: ReadonlyArray<{ x: number; y: number; amp: number }>,
  minSwing = LOCATOR_MIN_SWING_UT,
): PeakFit {
  if (points.length < 6) return { ok: false, reason: 'Not enough dwell points.' };
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of points) {
    if (!Number.isFinite(p.amp)) return { ok: false, reason: 'A dwell recorded no samples — run it again.' };
    lo = Math.min(lo, p.amp);
    hi = Math.max(hi, p.amp);
  }
  if (hi - lo < minSwing) {
    return {
      ok: false,
      reason: `The field barely moved across the grid (${(hi - lo).toFixed(1)} µT swing). Hold the screw closer to the glass and run it again.`,
    };
  }
  // Normal equations for the 6-parameter quadratic.
  const ata: number[][] = Array.from({ length: 6 }, () => new Array<number>(6).fill(0));
  const atb = new Array<number>(6).fill(0);
  for (const p of points) {
    const row = [1, p.x, p.y, p.x * p.x, p.x * p.y, p.y * p.y];
    for (let i = 0; i < 6; i++) {
      atb[i] = atb[i]! + row[i]! * p.amp;
      for (let j = 0; j < 6; j++) ata[i]![j] = ata[i]![j]! + row[i]! * row[j]!;
    }
  }
  const c = solveLinear(ata, atb);
  if (!c) return { ok: false, reason: 'The grid fit is degenerate — run the nine points again.' };
  const c1 = c[1]!, c2 = c[2]!, c3 = c[3]!, c4 = c[4]!, c5 = c[5]!;
  // Maximum requires the Hessian [[2c3, c4],[c4, 2c5]] negative definite.
  const det = 4 * c3 * c5 - c4 * c4;
  if (!(c3 < 0) || !(det > 0)) {
    return {
      ok: false,
      reason: 'No clear peak — the amplitudes do not dome anywhere on the screen. Check for a case magnet, then run it again.',
    };
  }
  const px = (c4 * c2 - 2 * c5 * c1) / det;
  const py = (c4 * c1 - 2 * c3 * c2) / det;
  if (px < -0.15 || px > 1.15 || py < -0.15 || py > 1.15) {
    return {
      ok: false,
      reason: 'The peak lands off the screen — the sensor may sit under the bezel. Re-run with slower placement.',
    };
  }
  return { ok: true, x: Math.min(1, Math.max(0, px)), y: Math.min(1, Math.max(0, py)) };
}

/* ------------------------------------------------------------------ */
/* Level reversal zero (§4.2.2) — stillness capture over Orientation   */
/* ------------------------------------------------------------------ */

export interface PitchRollDeg {
  pitchDeg: number;
  rollDeg: number;
}

export interface StillState {
  state: 'waiting' | 'holding' | 'done';
  /** 0–1 progress through the hold window. */
  progress: number;
  mean?: PitchRollDeg;
  sd?: PitchRollDeg;
}

interface OrientationLike {
  t: number;
  pitch: number;
  roll: number;
  stable: boolean;
}

/**
 * Collect a stillness window from the fusion stream: once samples are
 * flagged stable for holdMs, report the mean pitch/roll (degrees) and their
 * standard deviation (the capture's uncertainty). Motion resets the window.
 */
export class StillnessCapture {
  private samples: Array<{ pitch: number; roll: number }> = [];
  private since: number | null = null;
  private result: StillState | null = null;

  constructor(private readonly holdMs = 1000) {}

  push(o: OrientationLike): StillState {
    if (this.result) return this.result;
    if (!o.stable) {
      this.samples = [];
      this.since = null;
      return { state: 'waiting', progress: 0 };
    }
    if (this.since === null) this.since = o.t;
    this.samples.push({ pitch: o.pitch, roll: o.roll });
    const heldMs = (o.t - this.since) * 1000;
    if (heldMs < this.holdMs) {
      return { state: 'holding', progress: Math.max(0, Math.min(1, heldMs / this.holdMs)) };
    }
    const n = this.samples.length;
    const mean = this.samples.reduce(
      (acc, s) => ({ pitch: acc.pitch + s.pitch / n, roll: acc.roll + s.roll / n }),
      { pitch: 0, roll: 0 },
    );
    const varAcc = this.samples.reduce(
      (acc, s) => ({
        pitch: acc.pitch + (s.pitch - mean.pitch) ** 2 / n,
        roll: acc.roll + (s.roll - mean.roll) ** 2 / n,
      }),
      { pitch: 0, roll: 0 },
    );
    const DEG = 180 / Math.PI;
    this.result = {
      state: 'done',
      progress: 1,
      mean: { pitchDeg: mean.pitch * DEG, rollDeg: mean.roll * DEG },
      sd: { pitchDeg: Math.sqrt(varAcc.pitch) * DEG, rollDeg: Math.sqrt(varAcc.roll) * DEG },
    };
    return this.result;
  }

  reset(): void {
    this.samples = [];
    this.since = null;
    this.result = null;
  }
}

export interface ReversalResult {
  /** Sensor bias per axis, degrees — stored (in radians) as levelBias. */
  biasDeg: PitchRollDeg;
  /** True surface angle per axis, degrees — what the surface really is. */
  surfaceDeg: PitchRollDeg;
}

/** Two-position combine, per axis, via A5/A4's reversalCalibration. */
export function reversalFromCaptures(m1: PitchRollDeg, m2: PitchRollDeg): ReversalResult {
  const p = reversalCalibration(m1.pitchDeg, m2.pitchDeg);
  const r = reversalCalibration(m1.rollDeg, m2.rollDeg);
  return {
    biasDeg: { pitchDeg: p.bias, rollDeg: r.bias },
    surfaceDeg: { pitchDeg: p.surface, rollDeg: r.surface },
  };
}

/* ------------------------------------------------------------------ */
/* Lens routine gate (§4.3.2)                                          */
/* ------------------------------------------------------------------ */

/** Rectified-corner residual past this means bad marks or real distortion. */
export const LENS_RESIDUAL_MAX_DEG = 1.0;

export interface LensEvaluation {
  pass: boolean;
  reasons: string[];
}

export function evaluateLensResult(r: SheetCalibrationResult): LensEvaluation {
  if (!r.ok) return { pass: false, reasons: [r.message] };
  const reasons: string[] = [];
  if (r.squareResidualDeg > LENS_RESIDUAL_MAX_DEG) {
    reasons.push(
      `Rectified corner is ${r.squareResidualDeg.toFixed(2)}° off square (pass line ${LENS_RESIDUAL_MAX_DEG.toFixed(1)}°) — re-mark the corners with the loupe or flatten the sheet.`,
    );
  }
  return { pass: reasons.length === 0, reasons };
}

/**
 * Seeded MC on the sheet solve: perturb the marked corners by sigmaPx and
 * report the focal half-spread — the honest ± for the stored f.
 */
export function lensFocalUncertainty(
  quad: readonly [Px, Px, Px, Px],
  sheetAspect: number,
  imageW: number,
  imageH: number,
  opts: { sigmaPx?: number; samples?: number; seed?: number } = {},
): number | null {
  const sigmaPx = opts.sigmaPx ?? 2;
  const samples = opts.samples ?? 24;
  const gauss = gaussianSampler(mulberry32(opts.seed ?? 0x1e45));
  const fs: number[] = [];
  for (let i = 0; i < samples; i++) {
    const perturbed = quad.map((p) => ({
      x: p.x + sigmaPx * gauss(),
      y: p.y + sigmaPx * gauss(),
    })) as [Px, Px, Px, Px];
    const r = calibrateFromSheet(perturbed, sheetAspect, imageW, imageH);
    if (r.ok) fs.push(r.fPx);
  }
  if (fs.length < samples / 2) return null;
  fs.sort((a, b) => a - b);
  return (quantileSorted(fs, 0.95) - quantileSorted(fs, 0.05)) / 2;
}

/* ------------------------------------------------------------------ */
/* SELF-TEST helpers                                                   */
/* ------------------------------------------------------------------ */

/** Sliding-window measured rate — SPEC §4.6 SELF-TEST live sample rates. */
export class RateCounter {
  private times: number[] = [];

  constructor(private readonly windowS = 3) {}

  push(t: number): void {
    this.times.push(t);
    const cutoff = t - this.windowS;
    while (this.times.length > 0 && this.times[0]! < cutoff) this.times.shift();
  }

  /** Measured Hz over the window ending at `now` (defaults to last sample). */
  hz(now?: number): number {
    if (this.times.length < 2) return 0;
    const end = now ?? this.times[this.times.length - 1]!;
    const cutoff = end - this.windowS;
    const inWindow = this.times.filter((t) => t >= cutoff);
    if (inWindow.length < 2) return 0;
    const span = inWindow[inWindow.length - 1]! - inWindow[0]!;
    if (!(span > 0)) return 0;
    return (inWindow.length - 1) / span;
  }
}

export interface DiagnosticsBlob {
  schema: 'square.diagnostics/1';
  at: string;
  capability: CapabilityReport;
  calibration: {
    profile: CalibrationProfile;
    outcomes: Partial<Record<RoutineId, RoutineOutcome>>;
  };
  rates: Record<string, number | null>;
  permissions: Record<string, string>;
  lastError: string | null;
}

/** The copy-diagnostics JSON — SPEC §4.6 / §7B.9. */
export function buildDiagnostics(input: {
  capability: CapabilityReport;
  profile: CalibrationProfile;
  outcomes: Partial<Record<RoutineId, RoutineOutcome>>;
  rates: Record<string, number | null>;
  permissions: Record<string, string>;
  lastError: string | null;
  now?: Date;
}): DiagnosticsBlob {
  return {
    schema: 'square.diagnostics/1',
    at: (input.now ?? new Date()).toISOString(),
    capability: input.capability,
    calibration: { profile: input.profile, outcomes: input.outcomes },
    rates: input.rates,
    permissions: input.permissions,
    lastError: input.lastError,
  };
}
