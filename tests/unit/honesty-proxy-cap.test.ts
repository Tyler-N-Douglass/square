/**
 * A11 HONESTY PIN — the PROXY confidence cap and the refusal contract
 * (SPEC §2.2, §4.1.7, §15.3; ADR-005: Tier B caps at LIKELY, STRONG
 * requires Tier A).
 *
 * These tests attack the cap from every seam a regression could enter:
 *  1. the mapping function itself, at absurd SNR;
 *  2. the full pipeline on a synthetic PROXY trace built for enormous SNR
 *     (clean 4° lobes over 0.02° noise — SNR far beyond the STRONG bar),
 *     with an identical FIELD control trace proving the cap is the tier,
 *     not the signal;
 *  3. the shipped tierB fixture (the corpus file DEMO replays);
 *  4. the save path: buildStudMeasurements honors an UNCALIBRATED-tier cap
 *     (ADR-013.2) so a STRONG event can never be SAVED as STRONG when the
 *     screen said LIKELY;
 *  5. UNRELIABLE ships no positions — a guard fires, the peak list is empty
 *     (§15.3: refusing beats guessing), pinned on the hot-wall fixture.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyzeMagTrace, analyzeMagTraceDetailed } from '../../src/dsp/analyze';
import { aggregateConfidence, snrToConfidence, SNR_STRONG } from '../../src/dsp/confidence';
import { synthesizeTrace, type SynthOptions } from '../../src/dsp/synth';
import { buildStudMeasurements } from '../../src/tools/scan/model';
import { validateTrace } from '../../src/sensors/replay';
import type { Confidence, SensorTrace } from '../../src/types';

const RANK: Record<Confidence, number> = { UNRELIABLE: -1, NOISE: 0, POSSIBLE: 1, LIKELY: 2, STRONG: 3 };

function loadFixture(name: string): SensorTrace {
  const raw: unknown = JSON.parse(
    readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'),
  );
  validateTrace(raw);
  return raw;
}

/** Huge-SNR sweep: two fasteners 16″ OC, 4° lobes on 0.02° noise. */
function hugeSnrOptions(tier: 'FIELD' | 'PROXY'): SynthOptions {
  return {
    id: `honesty-huge-snr-${tier}`,
    note: 'A11 cap probe — SNR far beyond the STRONG bar',
    seed: 0xa11,
    hz: 40,
    spanIn: 32,
    speedInPerS: 3,
    fasteners: [
      { positionIn: 8, amplitude: 4 },
      { positionIn: 24, amplitude: 4 },
    ],
    noise: 0.02,
    tier,
    driftAmplitude: 0.05,
    expected: {
      peaks_in: [8, 24],
      tolerance_in: 0.75,
      pitch_in: 16,
      confidence: tier === 'FIELD' ? 'STRONG' : 'LIKELY',
      warnings: [],
    },
  };
}

describe('PROXY tier never reaches STRONG (SPEC §4.1.7, ADR-005)', () => {
  it('snrToConfidence caps PROXY at LIKELY even at absurd SNR', () => {
    for (const snr of [SNR_STRONG, 20, 1e3, 1e9]) {
      expect(snrToConfidence(snr, 'PROXY', true)).toBe('LIKELY');
      expect(snrToConfidence(snr, 'FIELD', true)).toBe('STRONG');
    }
  });

  it('aggregateConfidence over PROXY events caps at LIKELY', () => {
    const c = aggregateConfidence([1e6, 50, 9], 'PROXY', { guardFired: false, denseIrregular: false });
    expect(c).toBe('LIKELY');
  });

  it('full pipeline: a huge-SNR PROXY sweep reports LIKELY; the identical FIELD sweep reports STRONG', () => {
    const proxy = analyzeMagTraceDetailed(synthesizeTrace(hugeSnrOptions('PROXY')));
    expect(proxy.events.length).toBeGreaterThan(0);
    // Every detected event clears the STRONG SNR bar by construction…
    for (const ev of proxy.events) expect(ev.snr).toBeGreaterThan(SNR_STRONG);
    // …and still nothing wears STRONG, per event or in aggregate.
    for (const ev of proxy.events) expect(RANK[ev.confidence]).toBeLessThanOrEqual(RANK.LIKELY);
    expect(proxy.confidence).toBe('LIKELY');

    // Control: the cap is the tier, not the signal.
    const field = analyzeMagTraceDetailed(synthesizeTrace(hugeSnrOptions('FIELD')));
    expect(field.confidence).toBe('STRONG');
  });

  it('the shipped tierB fixture reports LIKELY through the real pipeline', () => {
    const res = analyzeMagTrace(loadFixture('tierB-heading-proxy'));
    expect(res.confidence).toBe('LIKELY');
    expect(RANK[res.confidence]).toBeLessThan(RANK.STRONG);
  });
});

describe('save-path cap (ADR-013.2: uncalibrated FIELD caps at LIKELY)', () => {
  it('buildStudMeasurements honors capAt — a STRONG event saves as LIKELY under the cap', () => {
    const detailed = analyzeMagTraceDetailed(synthesizeTrace(hugeSnrOptions('FIELD')));
    const strongEvents = detailed.events.filter((e) => e.confidence === 'STRONG');
    expect(strongEvents.length).toBeGreaterThan(0);
    const capped = buildStudMeasurements(strongEvents, {
      tier: 'FIELD',
      sampleCount: 100,
      calibrations: {},
      hasPositions: true,
      capAt: 'LIKELY',
      capturedAt: 0,
    });
    for (const m of capped) expect(m.confidence).toBe('LIKELY');
    // Without the cap the same events save as STRONG — the cap is the only gate.
    const uncapped = buildStudMeasurements(strongEvents, {
      tier: 'FIELD',
      sampleCount: 100,
      calibrations: {},
      hasPositions: true,
      capturedAt: 0,
    });
    for (const m of uncapped) expect(m.confidence).toBe('STRONG');
  });

  it('every saved stud measurement carries a unit and a finite ±', () => {
    const detailed = analyzeMagTraceDetailed(synthesizeTrace(hugeSnrOptions('FIELD')));
    for (const hasPositions of [true, false]) {
      const ms = buildStudMeasurements(detailed.events, {
        tier: 'FIELD',
        sampleCount: 100,
        calibrations: {},
        hasPositions,
        capturedAt: 0,
      });
      for (const m of ms) {
        expect(m.unit === 'in' || m.unit === 's').toBe(true);
        expect(Number.isFinite(m.uncertainty.plusMinus)).toBe(true);
        expect(m.confidence).toBeTruthy();
        // No span declared → the unit says seconds, never fake inches (ADR-006).
        if (!hasPositions) expect(m.unit).toBe('s');
      }
    }
  });
});

describe('UNRELIABLE ships no positions (SPEC §15.3)', () => {
  it('hot-wall fixture: guard fires, confidence UNRELIABLE, zero peaks reported', () => {
    const res = analyzeMagTrace(loadFixture('metal-stud-hot'));
    expect(res.confidence).toBe('UNRELIABLE');
    expect(res.warnings).toContain('WALL_HOT');
    expect(res.peaksIn).toEqual([]);
    expect(res.pitchIn).toBeNull();
  });

  it('any guard suppresses the peak list even when the signal alone would detect fasteners', () => {
    // Same huge-SNR sweep, but swept far too fast — positions become fictions.
    const opts = hugeSnrOptions('FIELD');
    const fast = synthesizeTrace({ ...opts, speedInPerS: 13, expected: { ...opts.expected, peaks_in: [], pitch_in: null, confidence: 'UNRELIABLE', warnings: ['SWEEP_TOO_FAST'] } });
    const res = analyzeMagTrace(fast);
    expect(res.warnings).toContain('SWEEP_TOO_FAST');
    expect(res.confidence).toBe('UNRELIABLE');
    expect(res.peaksIn).toEqual([]);
  });
});
