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
 *
 * The full chain (SPEC §4.1.2): working signal → 2.0 s moving-median detrend
 * → Savitzky-Golay (9, order 2) → σ = 1.4826·MAD noise floor → prominence
 * peaks + bipolar-shape test → zero-crossing position → anchors map to
 * inches → lattice fit (§4.1.5) → confidence (§4.1.7), with the environment
 * guards of §4.1.6 running over the whole trace. Deterministic throughout:
 * no Math.random, no Date.now.
 */
import type { Confidence, SensorTrace, WarningKey } from '../types';
import { timeToDistanceIn } from '../sensors/replay';
import { detrend, noiseSigmaTrailing, median, robustSigma, rms, savitzkyGolay } from './filters';
import { detectBipolarEvents, type BipolarEvent } from './peaks';
import { analyzeLattice, type LatticeAnalysis } from './spacing';
import { aggregateConfidence, snrToConfidence } from './confidence';

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

// ---------------------------------------------------------------------------
// Tuning constants — every one is justified in docs/physics-dsp.md and
// exercised by tests/unit/dsp-*.test.ts. Units: µT on FIELD, degrees on PROXY.
// ---------------------------------------------------------------------------

/** Detrend window (SPEC step 3). */
export const DETREND_WINDOW_S = 2.0;
/** Savitzky-Golay window (SPEC step 4). */
export const SG_WINDOW = 9;
/** Trailing noise-floor window (SPEC step 5). */
export const NOISE_WINDOW_S = 3.0;
/**
 * Lobe-pair gap: nominal lobe separation is 2·s ≈ 2″ at 12–15 mm standoff,
 * and noise shifts each extremum by up to ~0.5″ — 3.5″ covers the real
 * spread without reaching across neighboring 16″-OC fasteners.
 */
export const MAX_PAIR_GAP_IN = 3.5;
/** Two events closer than this merge into the stronger one. */
export const MIN_EVENT_SEP_IN = 2.0;
/**
 * WALL_HOT: whole-sweep robust noise floor above this = broadband hot wall.
 * 1.8 µT is ~15× the post-filter sensor noise, above the densest legitimate
 * fastener pattern in the corpus (plaster fixture: σ ≈ 1.3) and well below
 * the mildest metal-stud wall (σ ≈ 2.6+). Justified in docs/physics-dsp.md.
 */
export const WALL_HOT_SIGMA = { FIELD: 1.8 /* µT */, PROXY: 2.5 /* deg */ } as const;
/** SATURATED: |B| beyond this is near-field metal or a case magnet (§4.1.6). */
export const SATURATION_UT = 120;
/** MAGNETIC_ACCESSORY: median |B| far above the 25–65 µT earth range. */
export const ACCESSORY_MEDIAN_UT = 90;
/** SWEEP_TOO_FAST: 2× the 3 in/s paced rate (§4.1.6). */
export const SWEEP_FAST_IN_PER_S = 6.0;
/** RATE_COLLAPSE: below this the lobes are undersampled (§4.1.6). */
export const RATE_COLLAPSE_HZ = 12;
/**
 * Physical prominence floor (§4.1.1): a drywall screw at working standoff
 * produces 0.5–8 µT, so anything under 0.4 µT prominence (0.5° on the
 * heading proxy) is sub-physical ripple even when a very quiet sensor makes
 * k·σ tiny.
 */
export const MIN_PROMINENCE_ABS = { FIELD: 0.4 /* µT */, PROXY: 0.5 /* deg */ } as const;

/** One detected fastener with everything the UI needs to be honest about it. */
export interface FastenerEvent {
  positionIn: number;
  amplitudePositionIn: number;
  tSeconds: number;
  snr: number;
  prominence: number;
  /** Bipolar-shape correlation, [−1, 1] — how S-shaped the event really is. */
  shapeScore: number;
  confidence: Confidence;
}

/** Extended result for the SCAN UI (ribbon, badges, explainers). */
export interface DetailedTraceAnalysis extends TraceAnalysis {
  events: FastenerEvent[];
  /** Filtered, detrended working signal (ribbon trace). */
  filtered: number[];
  /** Per-sample trailing noise floor (ribbon band) — SPEC step 5. */
  sigmaTrail: number[];
  /** Whole-trace robust noise floor used for detection SNR. */
  sigma: number;
  /** RMS of the filtered residual. */
  rmsResidual: number;
  lattice: LatticeAnalysis;
  /** Anchor-implied sweep speed, in/s (fastest segment). */
  sweepSpeedInPerS: number;
  /** Median achieved sample rate, Hz. */
  sampleRateHz: number;
}

function anchorSpeeds(trace: SensorTrace): { max: number; mean: number } {
  const a = trace.anchors;
  if (a.length < 2) return { max: 0, mean: 0 };
  let max = 0;
  const first = a[0]!;
  const last = a[a.length - 1]!;
  for (let i = 1; i < a.length; i++) {
    const dt = a[i]!.t - a[i - 1]!.t;
    if (dt <= 0) continue;
    const v = Math.abs(a[i]!.in - a[i - 1]!.in) / dt;
    if (v > max) max = v;
  }
  const span = Math.abs(last.in - first.in);
  const dur = last.t - first.t;
  return { max, mean: dur > 0 ? span / dur : 0 };
}

function achievedRateHz(trace: SensorTrace): number {
  const s = trace.samples;
  if (s.length < 2) return trace.hz;
  const dts: number[] = [];
  for (let i = 1; i < s.length; i++) dts.push(s[i]!.t - s[i - 1]!.t);
  const m = median(dts);
  return m > 0 ? 1 / m : trace.hz;
}

/**
 * Full analysis with internals exposed — the SCAN tool and DEMO layer
 * consume this; the frozen analyzeMagTrace wraps it.
 */
export function analyzeMagTraceDetailed(trace: SensorTrace, opts: AnalyzeOptions = {}): DetailedTraceAnalysis {
  const estimator: PeakEstimator = opts.estimator ?? 'zeroCrossing';
  const k = opts.sensitivity ?? 3.5;
  const tier = trace.device.magTier;
  const ts = trace.samples.map((s) => s.t);

  // Working signal: |B| on FIELD, the signed residual itself on PROXY.
  const working =
    tier === 'PROXY'
      ? trace.samples.map((s) => s.x)
      : trace.samples.map((s) => Math.hypot(s.x, s.y, s.z));

  // --- Environment guards (SPEC §4.1.6) -----------------------------------
  const warnings: WarningKey[] = [];
  const rate = achievedRateHz(trace);
  const speeds = anchorSpeeds(trace);

  if (tier === 'FIELD') {
    const medB = median(working);
    if (medB > ACCESSORY_MEDIAN_UT) warnings.push('MAGNETIC_ACCESSORY');
    let over = 0;
    for (const b of working) if (b > SATURATION_UT) over++;
    if (over >= 3 || over > working.length * 0.01) warnings.push('SATURATED');
  }

  // --- Signal chain (SPEC §4.1.2 steps 3–5) -------------------------------
  const hz = rate > 0 ? rate : trace.hz;
  const detrended = detrend(working, hz, DETREND_WINDOW_S);
  const filtered = savitzkyGolay(detrended, SG_WINDOW);
  const sigmaTrail = noiseSigmaTrailing(filtered, hz, NOISE_WINDOW_S);
  // Detection uses the whole-trace robust MAD: the trailing window is the
  // streaming (ribbon) form, but at sweep start it contains the first
  // fastener itself and over-estimates the floor. Same estimator, wider
  // support; documented in docs/physics-dsp.md.
  const sigma = robustSigma(filtered);
  const rmsResidual = rms(filtered);

  const hotBar = tier === 'PROXY' ? WALL_HOT_SIGMA.PROXY : WALL_HOT_SIGMA.FIELD;
  if (sigma > hotBar) warnings.push('WALL_HOT');
  if (speeds.max > SWEEP_FAST_IN_PER_S) warnings.push('SWEEP_TOO_FAST');
  if (rate < RATE_COLLAPSE_HZ) warnings.push('RATE_COLLAPSE');

  const lattice0: LatticeAnalysis = { fit: null, denseIrregular: false, medianSpacingIn: NaN };

  // Refusing beats guessing (§15.3): a hot wall, a magnet on the phone, or a
  // saturated sensor makes every "peak" a fiction; a too-fast sweep or a
  // collapsed sample rate makes every POSITION a fiction (lobes smear and
  // alias). UNRELIABLE never ships stud markers — any guard suppresses the
  // peak list, and the warning tells the user what to fix.
  const suppress = warnings.length > 0;
  if (suppress) {
    return {
      peaksIn: [],
      pitchIn: null,
      confidence: 'UNRELIABLE',
      warnings,
      events: [],
      filtered,
      sigmaTrail,
      sigma,
      rmsResidual,
      lattice: lattice0,
      sweepSpeedInPerS: speeds.max,
      sampleRateHz: rate,
    };
  }

  // --- Peak detection + zero-crossing position (steps 6, 6b) --------------
  const speedForWindows = speeds.mean > 0.5 ? speeds.mean : 3.0;
  const samplesPerInch = hz / speedForWindows;
  const events: BipolarEvent[] = detectBipolarEvents(filtered, {
    sigma,
    kSigma: k,
    minProminenceAbs: tier === 'PROXY' ? MIN_PROMINENCE_ABS.PROXY : MIN_PROMINENCE_ABS.FIELD,
    maxPairGap: Math.max(3, Math.round(MAX_PAIR_GAP_IN * samplesPerInch)),
    minSeparation: Math.max(2, Math.round(MIN_EVENT_SEP_IN * samplesPerInch)),
    expectedLobeSamples: Math.max(4, samplesPerInch), // lobe sigma ≈ 1″ at working standoff
  });

  const indexToT = (idx: number): number => {
    const i0 = Math.max(0, Math.min(ts.length - 1, Math.floor(idx)));
    const i1 = Math.min(ts.length - 1, i0 + 1);
    const frac = idx - i0;
    return ts[i0]! + frac * (ts[i1]! - ts[i0]!);
  };

  const fasteners: FastenerEvent[] = events.map((ev) => {
    const tZc = indexToT(ev.zeroCrossIndex);
    const tAmp = ts[ev.amplitudeIndex]!;
    return {
      positionIn: timeToDistanceIn(trace.anchors, tZc),
      amplitudePositionIn: timeToDistanceIn(trace.anchors, tAmp),
      tSeconds: tZc,
      snr: ev.snr,
      prominence: ev.prominence,
      shapeScore: ev.shapeScore,
      confidence: snrToConfidence(ev.snr, tier, true),
    };
  });
  fasteners.sort((a, b) => a.positionIn - b.positionIn);

  const positions = fasteners.map((f) =>
    estimator === 'amplitude' ? f.amplitudePositionIn : f.positionIn,
  );

  // --- Lattice (§4.1.5) and confidence (§4.1.7) ---------------------------
  const lattice = analyzeLattice(fasteners.map((f) => f.positionIn));
  const guardFired = warnings.length > 0;
  const confidence = aggregateConfidence(
    fasteners.map((f) => f.snr),
    tier,
    { guardFired, denseIrregular: lattice.denseIrregular },
  );

  return {
    peaksIn: positions,
    pitchIn: lattice.fit ? lattice.fit.pitchIn : null,
    confidence,
    warnings,
    events: fasteners,
    filtered,
    sigmaTrail,
    sigma,
    rmsResidual,
    lattice,
    sweepSpeedInPerS: speeds.max,
    sampleRateHz: rate,
  };
}

export function analyzeMagTrace(trace: SensorTrace, opts: AnalyzeOptions = {}): TraceAnalysis {
  const d = analyzeMagTraceDetailed(trace, opts);
  return { peaksIn: d.peaksIn, pitchIn: d.pitchIn, confidence: d.confidence, warnings: d.warnings };
}
