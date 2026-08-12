/**
 * FROZEN LOAD-BEARING TEST (ADR-004) — written before the implementation.
 * SPEC §4.1.2 step 6b: the fastener sits at the ZERO CROSSING between the two
 * lobes of the bipolar signature, not at either amplitude extremum. This is
 * the difference between a hole in the stud and a hole beside it.
 *
 * Asserted against the kit's verified seed fixture (truth: fasteners at
 * 4.00″ and 20.00″, stud half-width 0.75″):
 *  - the zero-crossing estimator recovers within 0.25″ of truth
 *    (kit reference implementation: 3.90″ and 20.02″),
 *  - the amplitude estimator misses by more than the stud half-width on BOTH
 *    fasteners — i.e. it marks a spot outside the fastener line entirely.
 *
 * If a change makes the amplitude estimator pass, the test is broken, not the
 * algorithm (SPEC §4.1.2). Do not weaken these bounds.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyzeMagTrace } from '../../src/dsp/analyze';
import { validateTrace } from '../../src/sensors/replay';
import type { SensorTrace } from '../../src/types';

const TRUTH_IN = [4.0, 20.0] as const;
const STUD_HALF_WIDTH_IN = 0.75;

function loadSeed(): SensorTrace {
  const raw: unknown = JSON.parse(
    readFileSync(new URL('../fixtures/drywall-16oc-synthetic.json', import.meta.url), 'utf8'),
  );
  validateTrace(raw);
  return raw;
}

describe('fastener position — zero crossing, not amplitude (SPEC §4.1.2 6b)', () => {
  it('zero-crossing estimator recovers both fasteners within 0.25″ of truth', () => {
    const res = analyzeMagTrace(loadSeed(), { estimator: 'zeroCrossing' });
    expect(res.peaksIn).toHaveLength(2);
    const sorted = [...res.peaksIn].sort((a, b) => a - b);
    expect(Math.abs(sorted[0]! - TRUTH_IN[0])).toBeLessThanOrEqual(0.25);
    expect(Math.abs(sorted[1]! - TRUTH_IN[1])).toBeLessThanOrEqual(0.25);
  });

  it('recovers the 16″ on-center pitch, STRONG confidence, no warnings', () => {
    const trace = loadSeed();
    const res = analyzeMagTrace(trace, { estimator: 'zeroCrossing' });
    expect(res.pitchIn).not.toBeNull();
    expect(Math.abs((res.pitchIn ?? NaN) - 16.0)).toBeLessThanOrEqual(0.5);
    expect(res.confidence).toBe(trace.expected.confidence);
    expect(res.warnings).toEqual([]);
  });

  it('amplitude estimator lands outside the stud half-width on BOTH fasteners', () => {
    const res = analyzeMagTrace(loadSeed(), { estimator: 'amplitude' });
    expect(res.peaksIn).toHaveLength(2);
    const sorted = [...res.peaksIn].sort((a, b) => a - b);
    const err0 = Math.abs(sorted[0]! - TRUTH_IN[0]);
    const err1 = Math.abs(sorted[1]! - TRUTH_IN[1]);
    // ~1″ off per the kit's reference run (3.00″, 18.98″) — beyond the stud
    // edge, i.e. a drill hole beside the stud, not in it.
    expect(err0).toBeGreaterThan(STUD_HALF_WIDTH_IN);
    expect(err1).toBeGreaterThan(STUD_HALF_WIDTH_IN);
  });

  it('zero crossing strictly beats amplitude on both fasteners', () => {
    const trace = loadSeed();
    const zc = analyzeMagTrace(trace, { estimator: 'zeroCrossing' });
    const amp = analyzeMagTrace(trace, { estimator: 'amplitude' });
    const zcS = [...zc.peaksIn].sort((a, b) => a - b);
    const ampS = [...amp.peaksIn].sort((a, b) => a - b);
    for (let i = 0; i < TRUTH_IN.length; i++) {
      const zcErr = Math.abs(zcS[i]! - TRUTH_IN[i]!);
      const ampErr = Math.abs(ampS[i]! - TRUTH_IN[i]!);
      expect(zcErr).toBeLessThan(ampErr);
    }
  });
});
