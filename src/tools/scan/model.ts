/**
 * SCAN model — every piece of scan logic that can be pure, kept pure so
 * tests/unit/scan-model.test.ts exercises it without a DOM or a sensor:
 *
 *  - SweepSession: the sweep-mode state machine (MARK-ON-BEEP / PACED /
 *    TWO-POINT ANCHOR — SPEC §4.1.4, ADR-006). Distances exist only after a
 *    span is declared; before that the honest axis is time.
 *  - scoreAgreement / confirmVerdict: vertical-confirm scoring (§4.1.5) —
 *    the second sweep is aligned by anchors and scored by position matching.
 *  - Manual stud mode arithmetic (§4.1.9): exact rational centerlines with a
 *    ± band that grows with distance from the reference.
 *  - latticeDisplayLines / latticeStatement: derived stud-line display
 *    (§4.1.5) — extrapolated lines are flagged so the UI can never draw a
 *    prediction in the style of a measurement.
 *  - LiveFeedback: the low-latency audio/haptic side of the pipeline split.
 *
 * THE LATENCY SPLIT (SPEC §9: sensor→audio < 50 ms): audio pitch and the
 * big state word are driven HERE, synchronously in the raw sample callback,
 * via a cheap streaming detrend (EMA baseline) and a robust noise-floor
 * estimate — never from the DSP-worker round trip, which runs every ~250 ms
 * and refines events, positions, and confidence after the fact. The worker
 * is the truth for what gets marked and saved; this class is only the
 * real-time feel.
 */
import type { Confidence, Measurement, MagTier, TraceAnchor } from '../../types';
import type { FastenerEvent } from '../../dsp/analyze';
import type { LatticeFit } from '../../dsp/spacing';
import { capConfidence } from '../../dsp/confidence';
import {
  type Rational,
  add,
  cmp,
  mul,
  neg,
  parseLength,
  rational,
  toNumber,
} from '../../geometry/units';

/* ------------------------------------------------------------------------ */
/* Sweep-mode state machine (SPEC §4.1.4, ADR-006)                           */
/* ------------------------------------------------------------------------ */

export type SweepMode = 'mark' | 'paced' | 'anchor';
export type SweepPhase = 'idle' | 'sweeping' | 'awaitSpan' | 'done';

/**
 * One sweep from start to done. Transitions return false (and change
 * nothing) when illegal, so the UI can wire buttons without guards.
 */
export class SweepSession {
  mode: SweepMode = 'mark';
  phase: SweepPhase = 'idle';
  tStart = 0;
  tEnd = 0;
  private anchorStartT: number | null = null;
  private anchorEndT: number | null = null;
  private declared: TraceAnchor[] | null = null;

  setMode(mode: SweepMode): boolean {
    if (this.phase === 'sweeping' || this.phase === 'awaitSpan') return false;
    this.mode = mode;
    return true;
  }

  start(t: number): boolean {
    if (this.phase === 'sweeping' || this.phase === 'awaitSpan') return false;
    this.phase = 'sweeping';
    this.tStart = t;
    this.tEnd = 0;
    this.anchorStartT = null;
    this.anchorEndT = null;
    this.declared = null;
    return true;
  }

  /** TWO-POINT ANCHOR: first tap pins the start, second pins the end. */
  dropAnchor(t: number): boolean {
    if (this.phase !== 'sweeping' || this.mode !== 'anchor') return false;
    if (this.anchorStartT === null) {
      this.anchorStartT = t;
      return true;
    }
    if (t <= this.anchorStartT) return false;
    this.anchorEndT = t;
    this.tEnd = t;
    this.phase = 'awaitSpan';
    return true;
  }

  stop(t: number): boolean {
    if (this.phase !== 'sweeping') return false;
    this.tEnd = t;
    if (this.mode === 'paced' && t > this.tStart) {
      this.phase = 'awaitSpan';
    } else {
      // MARK-ON-BEEP never had position math; an anchor sweep stopped before
      // its second anchor has no span either. Honest: done, in time units.
      this.phase = 'done';
    }
    return true;
  }

  /** Declare the physical span in inches; converts the sweep to distance. */
  declareSpan(spanIn: number): boolean {
    if (this.phase !== 'awaitSpan') return false;
    if (!Number.isFinite(spanIn) || spanIn <= 0) return false;
    const t0 = this.mode === 'anchor' ? this.anchorStartT! : this.tStart;
    const t1 = this.mode === 'anchor' ? this.anchorEndT! : this.tEnd;
    this.declared = [
      { t: t0, in: 0 },
      { t: t1, in: spanIn },
    ];
    this.phase = 'done';
    return true;
  }

  /** Decline to declare a span — the sweep stays honest in time units. */
  skipSpan(): boolean {
    if (this.phase !== 'awaitSpan') return false;
    this.phase = 'done';
    return true;
  }

  /** Anchor mapping (absolute time base), or null when no span exists. */
  anchors(): TraceAnchor[] | null {
    return this.declared;
  }

  reset(): void {
    this.phase = 'idle';
    this.tStart = 0;
    this.tEnd = 0;
    this.anchorStartT = null;
    this.anchorEndT = null;
    this.declared = null;
  }
}

/** Parse a span/anchor distance: "24", "2'", "610mm" all work (units.ts). */
export function parseSpanInches(raw: string): number | null {
  const parsed = parseLength(raw);
  if (parsed === null) return null;
  const inches = toNumber(parsed.inches);
  return Number.isFinite(inches) && inches > 0 ? inches : null;
}

/* ------------------------------------------------------------------------ */
/* Vertical confirm (SPEC §4.1.5)                                            */
/* ------------------------------------------------------------------------ */

export const CONFIRM_TOL_IN = 0.75;

export interface AgreementScore {
  pairs: Array<[number, number]>;
  unmatchedFirst: number[];
  unmatchedSecond: number[];
  agree: boolean;
}

/**
 * Greedy nearest matching of two position sets within a tolerance.
 * Agreement is deliberately strict — refusing beats guessing (§15.3):
 * every peak of the larger pass must find a partner, minus none. A second
 * pass that adds or loses peaks is "unconfirmed", not "close enough".
 */
export function scoreAgreement(
  first: readonly number[],
  second: readonly number[],
  tol = CONFIRM_TOL_IN,
): AgreementScore {
  const a = [...first].sort((x, y) => x - y);
  const b = [...second].sort((x, y) => x - y);
  const usedB = new Array<boolean>(b.length).fill(false);
  const pairs: Array<[number, number]> = [];
  const unmatchedFirst: number[] = [];

  for (const x of a) {
    let bestJ = -1;
    let bestD = Infinity;
    for (let j = 0; j < b.length; j++) {
      if (usedB[j]) continue;
      const d = Math.abs(b[j]! - x);
      if (d < bestD) {
        bestD = d;
        bestJ = j;
      }
    }
    if (bestJ >= 0 && bestD <= tol) {
      usedB[bestJ] = true;
      pairs.push([x, b[bestJ]!]);
    } else {
      unmatchedFirst.push(x);
    }
  }
  const unmatchedSecond = b.filter((_, j) => !usedB[j]);

  const agree =
    pairs.length >= 1 &&
    unmatchedFirst.length === 0 &&
    unmatchedSecond.length === 0;

  return { pairs, unmatchedFirst, unmatchedSecond, agree };
}

export const CONFIRM_AGREE_COPY =
  'Peaks repeat at the same spots. That’s a stud line, not a stray fastener.';
export const CONFIRM_DISAGREE_COPY = 'Peaks moved. Treat the first pass as unconfirmed.';
export const CONFIRM_NEEDS_SPAN_COPY =
  'Declare a span on both passes — agreement scoring aligns peaks by anchors, and anchors need inches.';

export function confirmVerdict(score: AgreementScore): string {
  return score.agree ? CONFIRM_AGREE_COPY : CONFIRM_DISAGREE_COPY;
}

/* ------------------------------------------------------------------------ */
/* Manual stud mode (SPEC §4.1.9) — exact rational arithmetic                */
/* ------------------------------------------------------------------------ */

export interface OcChoice {
  id: string;
  label: string;
  inches: Rational;
}

/** 400 mm = 400·5/127 ″ and 600 mm = 600·5/127 ″ — exact (units.ts). */
export const OC_CHOICES: readonly OcChoice[] = [
  { id: '16', label: '16″ OC', inches: rational(16) },
  { id: '24', label: '24″ OC', inches: rational(24) },
  { id: '12', label: '12″ OC', inches: rational(12) },
  { id: '19.2', label: '19.2″ OC', inches: rational(96, 5) },
  { id: '400mm', label: '400 mm OC', inches: rational(2000, 127) },
  { id: '600mm', label: '600 mm OC', inches: rational(3000, 127) },
];

export type ManualReferenceKind = 'corner' | 'outlet' | 'stud' | 'other';

/**
 * Standard-practice offset from the entered reference to the first stud
 * center. An outlet box screws to the SIDE of a stud, so the stud center
 * sits about half a stud thickness — 3/4″ — past the box edge in the chosen
 * direction. Corners and known studs need no adjustment.
 */
export function referenceAdjustment(kind: ManualReferenceKind, direction: 1 | -1): Rational {
  if (kind === 'outlet') {
    const three4 = rational(3, 4);
    return direction === 1 ? three4 : neg(three4);
  }
  return rational(0);
}

/** Base band at the reference: your tape measurement is good to about ¼″. */
export const MANUAL_BASE_BAND_IN = 0.25;
/**
 * Band growth: real framing wanders roughly ±¼″ per 16″ bay, i.e. 1/64″ per
 * inch of distance from the trusted reference. The band states honestly that
 * a prediction eight feet from its reference is a place to start scanning,
 * not a place to drill.
 */
export const MANUAL_BAND_PER_IN = 1 / 64;

export function manualBandIn(distanceFromRefIn: number): number {
  return MANUAL_BASE_BAND_IN + Math.abs(distanceFromRefIn) * MANUAL_BAND_PER_IN;
}

export interface ManualStudMark {
  index: number;
  /** Exact centerline position along the tape, inches. */
  center: Rational;
  /** Float mirror of `center` for plotting. */
  centerIn: number;
  /** ± band, inches (grows with distance from the reference). */
  bandIn: number;
}

/**
 * Predicted stud centerlines from a reference along a direction, kept inside
 * [0, span]. k = 0 is the reference stud itself (after any standard-practice
 * adjustment). Pure rational arithmetic — no float drift over a long wall.
 */
export function predictStuds(
  referenceIn: Rational,
  ocIn: Rational,
  direction: 1 | -1,
  spanIn: Rational,
  maxMarks = 64,
): ManualStudMark[] {
  const marks: ManualStudMark[] = [];
  const zero = rational(0);
  if (cmp(spanIn, zero) <= 0) return marks;
  const refFloat = toNumber(referenceIn);
  const step = direction === 1 ? ocIn : neg(ocIn);
  for (let k = 0; k < maxMarks; k++) {
    const center = add(referenceIn, mul(step, rational(k)));
    if (cmp(center, zero) < 0 || cmp(center, spanIn) > 0) break;
    const centerIn = toNumber(center);
    marks.push({ index: k, center, centerIn, bandIn: manualBandIn(centerIn - refFloat) });
  }
  return marks;
}

/** Standard-practice notes — SPEC §4.1.9, rendered with every tape map. */
export const MANUAL_NOTES: readonly string[] = [
  'Outlet and switch boxes fasten to the side of a stud — expect the stud center about 3/4″ past the box edge.',
  'The first stud in from a corner is often irregular — confirm it before trusting the rhythm.',
  'Door and window openings carry king and jack studs plus a header — extra framing there, not a missing stud.',
];

export const MANUAL_HONESTY_LINE =
  'Arithmetic, not measurement. Verify with a knock test or a small pilot hole before the big bit.';

/* ------------------------------------------------------------------------ */
/* Lattice display (SPEC §4.1.5)                                             */
/* ------------------------------------------------------------------------ */

export interface LatticeDisplayLine {
  positionIn: number;
  /** True beyond the swept span — a prediction (DERIVED), never a measurement. */
  extrapolated: boolean;
}

/**
 * Lattice lines across the swept span plus `extendBays` predicted lines off
 * each edge. Every line is derived from the fit; the ones beyond the span
 * are additionally extrapolated and must render as predictions (dashed,
 * never orange).
 */
export function latticeDisplayLines(
  pitchIn: number,
  phaseIn: number,
  spanStartIn: number,
  spanEndIn: number,
  extendBays = 2,
): LatticeDisplayLine[] {
  if (!(pitchIn > 0) || !Number.isFinite(phaseIn)) return [];
  const lo = Math.min(spanStartIn, spanEndIn) - extendBays * pitchIn;
  const hi = Math.max(spanStartIn, spanEndIn) + extendBays * pitchIn;
  const kFirst = Math.ceil((lo - phaseIn) / pitchIn - 1e-9);
  const lines: LatticeDisplayLine[] = [];
  for (let k = kFirst; phaseIn + k * pitchIn <= hi + 1e-9; k++) {
    const pos = phaseIn + k * pitchIn;
    lines.push({
      positionIn: pos,
      extrapolated: pos < Math.min(spanStartIn, spanEndIn) - 1e-9 || pos > Math.max(spanStartIn, spanEndIn) + 1e-9,
    });
  }
  return lines;
}

/** Human label for a fitted pitch (16.0 → 16″; 15.748 → 400 mm). */
export function pitchLabel(pitchIn: number): string {
  if (Math.abs(pitchIn - 2000 / 127) < 0.01) return '400 mm';
  if (Math.abs(pitchIn - 3000 / 127) < 0.01) return '600 mm';
  return `${pitchIn % 1 === 0 ? pitchIn.toFixed(0) : pitchIn.toFixed(1)}″`;
}

/**
 * The §4.1.5 phase-locked copy. ≥3 explained peaks: phase locked, with the
 * predicted positions. 2 peaks: the fit is stated as thin evidence, not a
 * lock — one interval cannot discriminate neighboring pitch candidates
 * (ADR-011 #5/#6).
 */
export function latticeStatement(fit: LatticeFit, predictedIn: readonly number[]): string {
  const label = pitchLabel(fit.pitchIn);
  if (fit.explained >= 3) {
    const preds = predictedIn
      .slice(0, 4)
      .map((p) => `${p.toFixed(1)}″`)
      .join(', ');
    return preds.length > 0
      ? `${label} on center, phase locked — predicting studs at ${preds}. Predicted lines are derived, not measured.`
      : `${label} on center, phase locked.`;
  }
  return `${label} on center fits ${fit.explained} peaks — thin evidence. Sweep a longer span, or confirm 12″ higher.`;
}

/* ------------------------------------------------------------------------ */
/* Plain verdict line (SPEC §4.1.7 copy column; ADR-015)                     */
/* ------------------------------------------------------------------------ */

/**
 * The one-line what-to-do under the big state word. Verbatim from the
 * §4.1.7 copy column — the verdict leads, the numerals demote to the
 * secondary row. UNRELIABLE routes to the warning banner, which carries
 * the specific reason and its remedy.
 */
export const VERDICT_COPY: Readonly<Record<Confidence, string>> = {
  STRONG: 'Screw. Mark it.',
  LIKELY: 'Probably a fastener.',
  POSSIBLE: 'Something’s there. Sweep again to confirm.',
  NOISE: 'Nothing found on this pass.',
  UNRELIABLE: 'Conditions are bad — tap the warning for why.',
};

export function verdictFor(confidence: Confidence): string {
  return VERDICT_COPY[confidence];
}

/* ------------------------------------------------------------------------ */
/* Live feedback — state word, tone pitch, haptic trigger                    */
/* ------------------------------------------------------------------------ */

export type StateWord = 'NOTHING' | 'EDGE' | 'PEAK';

/**
 * State word from the instantaneous detrended residual. Bars ride on the
 * live noise floor but never drop below the physical prominence floor
 * (a drywall screw at working standoff makes ≥ ~0.4 µT — anything smaller
 * is ripple, not a fastener; SPEC §4.1.1, ADR-011 #3).
 */
export function stateWordFor(absResidual: number, sigma: number, minAbs: number): StateWord {
  const peakBar = Math.max(3.5 * sigma, minAbs);
  const edgeBar = Math.max(2.0 * sigma, 0.6 * minAbs);
  if (absResidual >= peakBar) return 'PEAK';
  if (absResidual >= edgeBar) return 'EDGE';
  return 'NOTHING';
}

export const PITCH_MIN_HZ = 220;
export const PITCH_MAX_HZ = 880;

/**
 * Anomaly → tone pitch (Hz), 0 = silent. Silent below the EDGE bar (a quiet
 * wall is quiet), rising exponentially to the top pitch at ~4× the PEAK bar.
 * Exponential because ears judge intervals, not hertz (matches app/audio.ts).
 */
export function pitchForAnomaly(absResidual: number, sigma: number, minAbs: number): number {
  const peakBar = Math.max(3.5 * sigma, minAbs);
  const edgeBar = Math.max(2.0 * sigma, 0.6 * minAbs);
  if (!Number.isFinite(absResidual) || absResidual < edgeBar) return 0;
  const top = 4 * peakBar;
  const x = Math.min(1, (absResidual - edgeBar) / Math.max(top - edgeBar, 1e-9));
  return PITCH_MIN_HZ * Math.pow(PITCH_MAX_HZ / PITCH_MIN_HZ, x);
}

export interface FeedbackFrame {
  residual: number;
  sigma: number;
  word: StateWord;
  /** Tone frequency for audio.setTone; 0 = silence. */
  toneHz: number;
  /** True exactly when this sample entered PEAK — the haptic moment. */
  enteredPeak: boolean;
}

/**
 * Streaming detrend + noise floor for the < 50 ms feedback path. EMA
 * baseline (τ ≈ 2 s) stands in for the worker's moving median; the noise
 * floor is an EMA of clipped |residual| scaled to σ (1.2533·mean|x| for
 * Gaussian noise), clipping so a passing fastener does not inflate the floor
 * under itself. Deliberately cheap — the DSP worker owns the truth.
 */
export class LiveFeedback {
  private baseline: number | null = null;
  private emaAbs: number;
  private lastT: number | null = null;
  private lastWord: StateWord = 'NOTHING';

  constructor(
    private readonly minAbs: number,
    private readonly detrendTauS = 2.0,
    private readonly sigmaTauS = 3.0,
  ) {
    this.emaAbs = minAbs / (2 * 1.2533);
  }

  get sigma(): number {
    return 1.2533 * this.emaAbs;
  }

  push(t: number, value: number): FeedbackFrame {
    if (this.baseline === null || this.lastT === null) {
      this.baseline = value;
      this.lastT = t;
      return { residual: 0, sigma: this.sigma, word: 'NOTHING', toneHz: 0, enteredPeak: false };
    }
    const dt = Math.max(0, Math.min(0.5, t - this.lastT));
    this.lastT = t;

    const aBase = dt / this.detrendTauS;
    this.baseline += aBase * (value - this.baseline);
    const residual = value - this.baseline;

    const sigmaNow = this.sigma;
    const clipped = Math.min(Math.abs(residual), 3 * sigmaNow + this.minAbs);
    const aSigma = dt / this.sigmaTauS;
    this.emaAbs += aSigma * (clipped - this.emaAbs);

    const sigma = this.sigma;
    const word = stateWordFor(Math.abs(residual), sigma, this.minAbs);
    const enteredPeak = word === 'PEAK' && this.lastWord !== 'PEAK';
    this.lastWord = word;
    return {
      residual,
      sigma,
      word,
      toneHz: pitchForAnomaly(Math.abs(residual), sigma, this.minAbs),
      enteredPeak,
    };
  }

  reset(): void {
    this.baseline = null;
    this.lastT = null;
    this.lastWord = 'NOTHING';
    this.emaAbs = this.minAbs / (2 * 1.2533);
  }
}

/* ------------------------------------------------------------------------ */
/* Saving (SPEC §8, §15.1)                                                   */
/* ------------------------------------------------------------------------ */

/**
 * Position uncertainty for a saved stud mark, inches. Nominal basis: the
 * dominant error is the user-declared span (± ~0.5″ over two feet) plus the
 * zero-crossing estimate (±0.1″ measured on the seed fixture) — bounded by
 * the ±0.75″ lattice tolerance the whole product reasons in. The PROXY tier
 * is coarser end to end (SPEC §2.2), so its bound doubles.
 */
export const POSITION_PM_IN: Readonly<Record<'FIELD' | 'PROXY', number>> = {
  FIELD: 0.75,
  PROXY: 1.5,
};

export interface SaveOptions {
  tier: MagTier;
  sampleCount: number;
  calibrations: Record<string, { ok: boolean; ageMs: number }>;
  /** True when a declared span mapped events to inches. */
  hasPositions: boolean;
  /** Extra cap (e.g. LIKELY when FIELD is uncalibrated — SPEC §4.1.7). */
  capAt?: Confidence;
  capturedAt: number;
}

/**
 * One Measurement per detected fastener. Every entry carries uncertainty
 * AND confidence (non-optional by contract). Without a declared span the
 * position is honestly saved in seconds along the sweep, flagged in notes —
 * a number never pretends to be inches it does not have.
 */
export function buildStudMeasurements(
  events: readonly FastenerEvent[],
  o: SaveOptions,
): Measurement[] {
  return events.map((ev, i) => {
    const confidence = o.capAt ? capConfidence(ev.confidence, o.capAt) : ev.confidence;
    const pmTier = o.tier === 'PROXY' ? POSITION_PM_IN.PROXY : POSITION_PM_IN.FIELD;
    const m: Measurement = {
      id: `stud-${o.capturedAt}-${i}-${Math.floor(Math.random() * 1e6).toString(36)}`,
      kind: 'stud',
      value: o.hasPositions ? ev.positionIn : ev.tSeconds,
      unit: o.hasPositions ? 'in' : 's',
      uncertainty: { plusMinus: o.hasPositions ? pmTier : 0.5, basis: 'nominal' },
      confidence,
      provenance: {
        tier: o.tier,
        calibrations: o.calibrations,
        sampleCount: o.sampleCount,
        capturedAt: o.capturedAt,
        ...(o.hasPositions
          ? { notes: `SNR ${ev.snr.toFixed(1)}` }
          : { notes: `SNR ${ev.snr.toFixed(1)} — time along sweep; no span declared` }),
      },
    };
    return m;
  });
}
