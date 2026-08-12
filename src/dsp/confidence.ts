/**
 * The honest confidence state machine — SPEC §4.1.7, ADR-005.
 *
 * Five states, mapped from SNR = prominence/σ:
 *   STRONG   — SNR ≥ 8, bipolar confirmed, FIELD tier
 *   LIKELY   — SNR 5–8, or STRONG conditions on PROXY (the Tier B cap)
 *   POSSIBLE — SNR 3.5–5
 *   NOISE    — below threshold / nothing detected
 *   UNRELIABLE — any environment guard fired (handled by the caller)
 *
 * PROXY never reports STRONG (ADR-005: the §4.1.7 table is the operational
 * contract; Tier B caps at LIKELY). A dense irregular pattern caps the whole
 * scan at POSSIBLE — the peaks may be real but the stud story is not.
 */
import type { Confidence, MagTier } from '../types';

export const SNR_STRONG = 8.0;
export const SNR_LIKELY = 5.0;
export const SNR_POSSIBLE = 3.5;

const RANK: Record<Confidence, number> = {
  UNRELIABLE: -1,
  NOISE: 0,
  POSSIBLE: 1,
  LIKELY: 2,
  STRONG: 3,
};

/** Map one event's SNR to a state. `bipolar` is true for every event the detector emits. */
export function snrToConfidence(snr: number, tier: MagTier, bipolar: boolean): Confidence {
  if (snr >= SNR_STRONG && bipolar) return tier === 'FIELD' ? 'STRONG' : 'LIKELY';
  if (snr >= SNR_LIKELY) return 'LIKELY';
  if (snr >= SNR_POSSIBLE) return 'POSSIBLE';
  return 'NOISE';
}

/** The lower of two states. */
export function capConfidence(c: Confidence, cap: Confidence): Confidence {
  return RANK[c] <= RANK[cap] ? c : cap;
}

/**
 * Aggregate a scan's confidence from its events.
 * No events → NOISE. Guards → UNRELIABLE (caller decides; passed as a flag
 * so the precedence lives in one place). Dense irregular → capped POSSIBLE.
 */
export function aggregateConfidence(
  eventSnrs: readonly number[],
  tier: MagTier,
  opts: { guardFired: boolean; denseIrregular: boolean },
): Confidence {
  if (opts.guardFired) return 'UNRELIABLE';
  let best: Confidence = 'NOISE';
  for (const snr of eventSnrs) {
    const c = snrToConfidence(snr, tier, true);
    if (RANK[c] > RANK[best]) best = c;
  }
  if (opts.denseIrregular) best = capConfidence(best, 'POSSIBLE');
  return best;
}
