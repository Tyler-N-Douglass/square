/**
 * Prominence-based bipolar peak detection — SPEC §4.1.2 steps 6 and 6b.
 *
 * A fastener passing under the sensor writes a bipolar signature (one
 * positive lobe, one negative lobe) into the detrended signal. Detection
 * therefore works on LOBES: local extrema of either sign whose prominence
 * clears k·σ. A lobe only becomes a fastener EVENT when an opposite-sign
 * lobe flanks it within about one lobe-width — the bipolar-shape test that
 * rejects one-sided drift artifacts.
 *
 * Position is THE ZERO CROSSING between the paired lobes (step 6b), found by
 * linearly interpolating the sign change — not either amplitude extremum.
 * The amplitude extremum sits a full lobe-sigma (~1″ at paced speed) to the
 * side; the frozen zero-crossing test asserts exactly that failure.
 */

export interface Lobe {
  /** Sample index of the extremum. */
  index: number;
  /** +1 for a positive lobe, −1 for a negative lobe. */
  sign: 1 | -1;
  /** Prominence measured on the lobe's own orientation. */
  prominence: number;
  /** Signal value at the extremum. */
  value: number;
}

export interface BipolarEvent {
  /** Index of the earlier lobe. */
  iFirst: number;
  /** Index of the later lobe. */
  iSecond: number;
  /** Fractional sample index of the zero crossing between the lobes. */
  zeroCrossIndex: number;
  /** Sample index of the max-|amplitude| extremum (the WRONG estimator, kept to be provably wrong). */
  amplitudeIndex: number;
  /** Prominence of the dominant lobe. */
  prominence: number;
  /** prominence / σ. */
  snr: number;
  /** Normalized correlation against the derivative-of-Gaussian template, [−1, 1]. */
  shapeScore: number;
}

/**
 * Bipolar-shape score: normalized correlation (cosine) between the signal
 * around a candidate event and a derivative-of-Gaussian template. The
 * template width starts from the candidate's own lobe spacing but is clamped
 * to the PHYSICALLY expected lobe sigma (± the honest spread) — band-limited
 * noise makes narrow smooth ripple pairs that would fool a self-sized
 * template, but cannot stay coherent across a physically wide window.
 * Range [−1, 1].
 */
export function bipolarShapeScore(
  signal: readonly number[],
  zeroCrossIndex: number,
  iFirst: number,
  iSecond: number,
  expectedLobeSamples: number,
): number {
  const n = signal.length;
  const s = Math.min(
    Math.max(3, (iSecond - iFirst) / 2, 0.7 * expectedLobeSamples),
    1.5 * expectedLobeSamples,
  );
  const positiveFirst = signal[iFirst]! >= 0;
  const lo = Math.max(0, Math.round(zeroCrossIndex - 2.5 * s));
  const hi = Math.min(n - 1, Math.round(zeroCrossIndex + 2.5 * s));
  if (hi - lo < 4) return 0;
  let dot = 0;
  let ww = 0;
  let gg = 0;
  for (let j = lo; j <= hi; j++) {
    const u = (j - zeroCrossIndex) / s;
    // DoG template: positive lobe before the crossing when positiveFirst.
    let g = -u * Math.exp(-0.5 * u * u);
    if (!positiveFirst) g = -g;
    const w = signal[j]!;
    dot += w * g;
    ww += w * w;
    gg += g * g;
  }
  if (ww === 0 || gg === 0) return 0;
  return dot / Math.sqrt(ww * gg);
}

/** Indices of local maxima (strictly rises into, does not rise out of). */
export function localMaxima(signal: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < signal.length - 1; i++) {
    if (signal[i]! > signal[i - 1]! && signal[i]! >= signal[i + 1]!) out.push(i);
  }
  return out;
}

/**
 * Topographic prominence of the local maximum at `i`: height above the
 * higher of the two key saddles (the deepest point crossed before reaching
 * higher ground on each side, or the signal end).
 */
export function peakProminence(signal: readonly number[], i: number): number {
  const n = signal.length;
  const h = signal[i]!;
  let leftMin = h;
  for (let j = i - 1; j >= 0; j--) {
    if (signal[j]! > h) break;
    if (signal[j]! < leftMin) leftMin = signal[j]!;
  }
  let rightMin = h;
  for (let j = i + 1; j < n; j++) {
    if (signal[j]! > h) break;
    if (signal[j]! < rightMin) rightMin = signal[j]!;
  }
  return h - Math.max(leftMin, rightMin);
}

/**
 * All candidate lobes of both signs with prominence ≥ `minProminence`,
 * sorted by index. Negative lobes are found by running the same detector on
 * the negated signal.
 */
export function findLobes(signal: readonly number[], minProminence: number): Lobe[] {
  const neg = signal.map((v) => -v);
  const out: Lobe[] = [];
  for (const i of localMaxima(signal)) {
    const p = peakProminence(signal, i);
    if (p >= minProminence) out.push({ index: i, sign: 1, prominence: p, value: signal[i]! });
  }
  for (const i of localMaxima(neg)) {
    const p = peakProminence(neg, i);
    if (p >= minProminence) out.push({ index: i, sign: -1, prominence: p, value: signal[i]! });
  }
  out.sort((a, b) => a.index - b.index);
  return out;
}

export interface DetectOptions {
  /** Noise floor σ (signal units). */
  sigma: number;
  /** Threshold multiplier k: a PRIMARY lobe needs prominence ≥ k·σ. Default 3.5. */
  kSigma?: number;
  /**
   * Physical floor on prominence (signal units), independent of σ. A real
   * fastener at 12–15 mm standoff produces ≥ 0.5 µT (SPEC §4.1.1); on a very
   * quiet sensor k·σ alone would chase sub-physical ripples. Default 0.
   */
  minProminenceAbs?: number;
  /** Max index gap between the two lobes of one event (≈ one lobe-width plus slack). */
  maxPairGap: number;
  /** Events with zero crossings closer than this many samples: keep the stronger. */
  minSeparation: number;
  /** Minimum bipolar-shape correlation to accept an event. Default SHAPE_SCORE_MIN. */
  minShapeScore?: number;
  /**
   * Physically expected lobe sigma in samples (≈ 1″ × samples-per-inch at
   * the anchor-implied sweep speed). Sets the shape-template width and the
   * minimum credible lobe spacing. Default: maxPairGap / 3.5.
   */
  expectedLobeSamples?: number;
}

/**
 * Default bipolar-shape acceptance bar. Measured on the corpus physics:
 * true events (even at detection-threshold SNR) score ≥ ~0.75 because the
 * S-curve is coherent across the window; blank-wall noise pairings cluster
 * well below. See tests/unit/dsp-peaks.test.ts and docs/accuracy-dsp.md.
 */
export const SHAPE_SCORE_MIN = 0.55;

/**
 * Flank bar as a fraction of the primary bar. A real fastener's two lobes are
 * near-symmetric (both ≈ the dipole amplitude); band-limited noise makes
 * frequent weak ripples but rarely a strong opposite partner. 0.7 keeps a
 * marginally noisy second lobe while rejecting noise pairings — measured in
 * tests/unit/dsp-peaks.test.ts and the precision/recall suite.
 */
export const FLANK_RATIO = 0.7;

/**
 * Assemble bipolar events from lobes.
 *
 * - PRIMARY lobes clear the full k·σ prominence bar.
 * - A primary is confirmed only when an opposite-sign FLANK lobe with
 *   prominence ≥ FLANK_RATIO·k·σ sits within `maxPairGap` samples, so a
 *   marginally noisy second lobe does not throw away a real fastener, but a
 *   lone one-sided bump (drift artifact) is still rejected.
 * - Pairing runs strongest-first, each lobe used once, choosing the
 *   largest-|value| eligible flank — so a tiny ripple cannot steal a real
 *   lobe's partner.
 * - The zero crossing between the paired lobes (nearest to their midpoint,
 *   when noise makes several) is linearly interpolated; if the signal never
 *   changes sign between them (possible under extreme offsets), the midpoint
 *   is used.
 */
export function detectBipolarEvents(signal: readonly number[], opts: DetectOptions): BipolarEvent[] {
  const k = opts.kSigma ?? 3.5;
  const bar = Math.max(k * opts.sigma, opts.minProminenceAbs ?? 0);
  const expectedLobe = opts.expectedLobeSamples ?? Math.max(4, opts.maxPairGap / 3.5);
  // Lobes of a real fastener sit ≈ 2 lobe-sigma apart; anything under ~1.6
  // lobe-sigma is a noise ripple pair, not a dipole signature.
  const minPairGap = Math.max(3, Math.round(0.8 * expectedLobe));
  const lobes = findLobes(signal, bar * FLANK_RATIO);
  const primaries = lobes
    .map((l, idx) => ({ l, idx }))
    .filter(({ l }) => l.prominence >= bar)
    .sort((a, b) => Math.abs(b.l.value) - Math.abs(a.l.value));

  const used = new Set<number>();
  const events: BipolarEvent[] = [];

  for (const { l, idx } of primaries) {
    if (used.has(idx)) continue;
    let best = -1;
    for (let j = 0; j < lobes.length; j++) {
      if (j === idx || used.has(j)) continue;
      const cand = lobes[j]!;
      if (cand.sign === l.sign) continue;
      const gap = Math.abs(cand.index - l.index);
      if (gap > opts.maxPairGap || gap < minPairGap) continue;
      if (best === -1 || Math.abs(cand.value) > Math.abs(lobes[best]!.value)) best = j;
    }
    if (best === -1) continue; // bipolar test failed: one-sided artifact
    const partner = lobes[best]!;
    const iFirst = Math.min(l.index, partner.index);
    const iSecond = Math.max(l.index, partner.index);

    // Zero crossing between the lobes, nearest to their midpoint.
    const mid = (iFirst + iSecond) / 2;
    let zc = mid;
    let bestDist = Infinity;
    for (let i = iFirst; i < iSecond; i++) {
      const a = signal[i]!;
      const b = signal[i + 1]!;
      if (a === 0 || a < 0 !== b < 0) {
        const denom = b - a;
        const frac = denom === 0 ? 0 : -a / denom;
        const x = i + frac;
        const d = Math.abs(x - mid);
        if (d < bestDist) {
          bestDist = d;
          zc = x;
        }
      }
    }

    const amplitudeIndex = Math.abs(l.value) >= Math.abs(partner.value) ? l.index : partner.index;
    const prominence = Math.max(l.prominence, partner.prominence);
    const shapeScore = bipolarShapeScore(signal, zc, iFirst, iSecond, expectedLobe);
    if (shapeScore < (opts.minShapeScore ?? SHAPE_SCORE_MIN)) continue; // ripple pair, not an S-curve
    used.add(idx);
    used.add(best);
    events.push({
      iFirst,
      iSecond,
      zeroCrossIndex: zc,
      amplitudeIndex,
      prominence,
      snr: prominence / opts.sigma,
      shapeScore,
    });
  }

  // Minimum separation: keep the stronger of any two events too close together.
  events.sort((a, b) => a.zeroCrossIndex - b.zeroCrossIndex);
  const kept: BipolarEvent[] = [];
  for (const ev of events) {
    const prev = kept[kept.length - 1];
    if (prev && ev.zeroCrossIndex - prev.zeroCrossIndex < opts.minSeparation) {
      if (ev.prominence > prev.prominence) kept[kept.length - 1] = ev;
      continue;
    }
    kept.push(ev);
  }
  return kept;
}
