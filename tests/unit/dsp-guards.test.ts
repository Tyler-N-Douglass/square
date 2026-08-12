/**
 * Environment guards (SPEC §4.1.6) and analyzer-level behavior (SPEC §4.1.2)
 * on synthesized traces. Every guard forces UNRELIABLE and suppresses the
 * peak list — refusing beats guessing (SPEC §15.3).
 */
import { describe, expect, it } from 'vitest';
import {
  ACCESSORY_MEDIAN_UT,
  analyzeMagTrace,
  analyzeMagTraceDetailed,
  RATE_COLLAPSE_HZ,
  SATURATION_UT,
  SWEEP_FAST_IN_PER_S,
  WALL_HOT_SIGMA,
} from '../../src/dsp/analyze';
import { synthesizeTrace, type SynthOptions } from '../../src/dsp/synth';
import type { TraceExpected } from '../../src/types';

const EXPECTED_STUB: TraceExpected = {
  peaks_in: [],
  tolerance_in: 0.75,
  pitch_in: null,
  confidence: 'NOISE',
  warnings: [],
};

function baseOpts(partial: Partial<SynthOptions>): SynthOptions {
  return {
    id: 'test',
    note: 'unit-test trace',
    seed: 42,
    hz: 40,
    spanIn: 24,
    speedInPerS: 3.0,
    fasteners: [],
    noise: 0.22,
    expected: EXPECTED_STUB,
    ...partial,
  };
}

describe('guard thresholds (documented constants)', () => {
  it('are the documented values', () => {
    expect(WALL_HOT_SIGMA.FIELD).toBe(1.8);
    expect(SATURATION_UT).toBe(120);
    expect(ACCESSORY_MEDIAN_UT).toBe(90);
    expect(SWEEP_FAST_IN_PER_S).toBe(6.0);
    expect(RATE_COLLAPSE_HZ).toBe(12);
  });
});

describe('WALL_HOT (§4.1.6: hot wall)', () => {
  it('broadband elevated wall → WALL_HOT, UNRELIABLE, no peaks', () => {
    const bumps = [];
    for (let x = 0; x < 26; x += 2.2) {
      bumps.push({ positionIn: x, amplitude: (x % 4.4 < 2.2 ? 1 : -1) * 6, sigmaIn: 1.6 });
    }
    const trace = synthesizeTrace(baseOpts({ seed: 71, bumps, noise: 2.0, driftAmplitude: 2 }));
    const res = analyzeMagTrace(trace);
    expect(res.warnings).toContain('WALL_HOT');
    expect(res.confidence).toBe('UNRELIABLE');
    expect(res.peaksIn).toEqual([]);
    expect(res.pitchIn).toBeNull();
  });

  it('a clean wall with two strong fasteners is NOT hot (isolated peaks keep MAD low)', () => {
    const trace = synthesizeTrace(
      baseOpts({
        seed: 72,
        fasteners: [
          { positionIn: 4, amplitude: 3.5 },
          { positionIn: 20, amplitude: 3.5 },
        ],
      }),
    );
    const res = analyzeMagTrace(trace);
    expect(res.warnings).not.toContain('WALL_HOT');
    expect(res.peaksIn).toHaveLength(2);
  });
});

describe('SATURATED (§4.1.6: near-field / saturation)', () => {
  it('|B| beyond 120 µT → SATURATED, UNRELIABLE, no peaks', () => {
    const trace = synthesizeTrace(baseOpts({ seed: 73, pedestal: [80, 40, 95] })); // |B| ≈ 131
    const res = analyzeMagTrace(trace);
    expect(res.warnings).toContain('SATURATED');
    expect(res.confidence).toBe('UNRELIABLE');
    expect(res.peaksIn).toEqual([]);
  });
});

describe('MAGNETIC_ACCESSORY (§4.1.6: fixed offset)', () => {
  it('median |B| far above the earth range → MAGNETIC_ACCESSORY', () => {
    const trace = synthesizeTrace(
      baseOpts({
        seed: 74,
        hardIronOffset: [74, 20, 12],
        fasteners: [{ positionIn: 12, amplitude: 3 }],
      }),
    );
    const res = analyzeMagTrace(trace);
    expect(res.warnings).toContain('MAGNETIC_ACCESSORY');
    expect(res.confidence).toBe('UNRELIABLE');
    // The fastener is real. It is still not reported: refusal beats guessing.
    expect(res.peaksIn).toEqual([]);
  });

  it('a normal earth pedestal (25–65 µT) does not trip it', () => {
    const trace = synthesizeTrace(baseOpts({ seed: 75 }));
    expect(analyzeMagTrace(trace).warnings).not.toContain('MAGNETIC_ACCESSORY');
  });
});

describe('SWEEP_TOO_FAST (§4.1.6)', () => {
  it('8 in/s anchors → SWEEP_TOO_FAST, UNRELIABLE, no positions', () => {
    const trace = synthesizeTrace(baseOpts({ seed: 76, speedInPerS: 8 }));
    const res = analyzeMagTrace(trace);
    expect(res.warnings).toContain('SWEEP_TOO_FAST');
    expect(res.confidence).toBe('UNRELIABLE');
    expect(res.peaksIn).toEqual([]);
  });

  it('the paced 3 in/s sweep does not trip it', () => {
    const trace = synthesizeTrace(baseOpts({ seed: 77 }));
    expect(analyzeMagTrace(trace).warnings).not.toContain('SWEEP_TOO_FAST');
  });
});

describe('RATE_COLLAPSE (§4.1.6)', () => {
  it('sample intervals implying < 12 Hz → RATE_COLLAPSE, UNRELIABLE', () => {
    const trace = synthesizeTrace(baseOpts({ seed: 78, hz: 8 }));
    const res = analyzeMagTrace(trace);
    expect(res.warnings).toContain('RATE_COLLAPSE');
    expect(res.confidence).toBe('UNRELIABLE');
    expect(res.peaksIn).toEqual([]);
  });
});

describe('PROXY tier guard scoping', () => {
  it('field-magnitude guards do not read degree units as µT', () => {
    // A proxy trace whose residual rides a large constant offset: the offset
    // is a heading bias, not a magnet — no MAGNETIC_ACCESSORY, no SATURATED.
    const trace = synthesizeTrace(
      baseOpts({ seed: 79, tier: 'PROXY', fasteners: [{ positionIn: 12, amplitude: 3 }] }),
    );
    trace.samples = trace.samples.map((s) => ({ ...s, x: s.x + 130 }));
    const res = analyzeMagTrace(trace);
    expect(res.warnings).not.toContain('MAGNETIC_ACCESSORY');
    expect(res.warnings).not.toContain('SATURATED');
  });
});

describe('analyzer options and determinism', () => {
  it('sensitivity raises the bar: k=6 hides what k=3.5 finds', () => {
    const opts = baseOpts({
      seed: 80,
      fasteners: [
        { positionIn: 6, amplitude: 0.95 },
        { positionIn: 22, amplitude: 0.95 },
      ],
      noise: 0.5,
    });
    const trace = synthesizeTrace(opts);
    const loose = analyzeMagTrace(trace, { sensitivity: 3.5 });
    const strict = analyzeMagTrace(trace, { sensitivity: 6.0 });
    expect(loose.peaksIn.length).toBeGreaterThan(strict.peaksIn.length);
  });

  it('two identical runs produce byte-identical results (no Math.random, no Date.now)', () => {
    const trace = synthesizeTrace(
      baseOpts({
        seed: 81,
        fasteners: [
          { positionIn: 4, amplitude: 3 },
          { positionIn: 20, amplitude: 3 },
        ],
      }),
    );
    const a = analyzeMagTraceDetailed(trace);
    const b = analyzeMagTraceDetailed(trace);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('detailed result exposes the ribbon internals the SCAN UI needs', () => {
    const trace = synthesizeTrace(
      baseOpts({ seed: 82, fasteners: [{ positionIn: 12, amplitude: 4 }] }),
    );
    const d = analyzeMagTraceDetailed(trace);
    expect(d.filtered).toHaveLength(trace.samples.length);
    expect(d.sigmaTrail).toHaveLength(trace.samples.length);
    expect(d.sigma).toBeGreaterThan(0);
    expect(d.events).toHaveLength(1);
    expect(d.events[0]!.confidence).toBe('STRONG');
    expect(d.sampleRateHz).toBeCloseTo(40, 0);
  });
});
