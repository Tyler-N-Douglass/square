/**
 * Confidence state machine — SPEC §4.1.7, ADR-005.
 * Five states only; PROXY caps at LIKELY; guards force UNRELIABLE;
 * dense irregular caps at POSSIBLE.
 */
import { describe, expect, it } from 'vitest';
import {
  aggregateConfidence,
  capConfidence,
  SNR_LIKELY,
  SNR_POSSIBLE,
  SNR_STRONG,
  snrToConfidence,
} from '../../src/dsp/confidence';

describe('threshold constants (SPEC §4.1.7)', () => {
  it('STRONG ≥ 8, LIKELY 5–8, POSSIBLE 3.5–5', () => {
    expect(SNR_STRONG).toBe(8);
    expect(SNR_LIKELY).toBe(5);
    expect(SNR_POSSIBLE).toBe(3.5);
  });
});

describe('snrToConfidence', () => {
  it('maps the bands on FIELD', () => {
    expect(snrToConfidence(12, 'FIELD', true)).toBe('STRONG');
    expect(snrToConfidence(8, 'FIELD', true)).toBe('STRONG');
    expect(snrToConfidence(7.9, 'FIELD', true)).toBe('LIKELY');
    expect(snrToConfidence(5, 'FIELD', true)).toBe('LIKELY');
    expect(snrToConfidence(4.9, 'FIELD', true)).toBe('POSSIBLE');
    expect(snrToConfidence(3.5, 'FIELD', true)).toBe('POSSIBLE');
    expect(snrToConfidence(3.4, 'FIELD', true)).toBe('NOISE');
  });

  it('PROXY caps at LIKELY even with STRONG-level SNR (ADR-005)', () => {
    expect(snrToConfidence(20, 'PROXY', true)).toBe('LIKELY');
    expect(snrToConfidence(8, 'PROXY', true)).toBe('LIKELY');
    expect(snrToConfidence(6, 'PROXY', true)).toBe('LIKELY');
    expect(snrToConfidence(4, 'PROXY', true)).toBe('POSSIBLE');
  });

  it('STRONG requires the bipolar confirmation', () => {
    expect(snrToConfidence(12, 'FIELD', false)).toBe('LIKELY');
  });
});

describe('capConfidence', () => {
  it('returns the lower state', () => {
    expect(capConfidence('STRONG', 'LIKELY')).toBe('LIKELY');
    expect(capConfidence('POSSIBLE', 'LIKELY')).toBe('POSSIBLE');
    expect(capConfidence('NOISE', 'POSSIBLE')).toBe('NOISE');
    expect(capConfidence('STRONG', 'UNRELIABLE')).toBe('UNRELIABLE');
  });
});

describe('aggregateConfidence', () => {
  it('no events → NOISE', () => {
    expect(aggregateConfidence([], 'FIELD', { guardFired: false, denseIrregular: false })).toBe('NOISE');
  });
  it('best event wins', () => {
    expect(
      aggregateConfidence([4, 9], 'FIELD', { guardFired: false, denseIrregular: false }),
    ).toBe('STRONG');
  });
  it('guard fired → UNRELIABLE regardless of SNR', () => {
    expect(
      aggregateConfidence([20], 'FIELD', { guardFired: true, denseIrregular: false }),
    ).toBe('UNRELIABLE');
  });
  it('dense irregular caps at POSSIBLE (plaster/metal signature, SPEC §4.1.5)', () => {
    expect(
      aggregateConfidence([15, 12], 'FIELD', { guardFired: false, denseIrregular: true }),
    ).toBe('POSSIBLE');
  });
  it('PROXY aggregate never exceeds LIKELY', () => {
    expect(
      aggregateConfidence([25, 18], 'PROXY', { guardFired: false, denseIrregular: false }),
    ).toBe('LIKELY');
  });
});
