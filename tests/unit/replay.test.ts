/**
 * Replay harness — deterministic playback (SPEC §3.3). The whole product is
 * tested through this; it ships first.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ReplayMagSource, timeToDistanceIn, validateTrace } from '../../src/sensors/replay';
import type { SensorTrace } from '../../src/types';

function loadSeed(): SensorTrace {
  const raw: unknown = JSON.parse(
    readFileSync(new URL('../fixtures/drywall-16oc-synthetic.json', import.meta.url), 'utf8'),
  );
  validateTrace(raw);
  return raw;
}

describe('ReplayMagSource', () => {
  it('sync mode delivers every sample, in order, with computed |B|', async () => {
    const trace = loadSeed();
    const src = new ReplayMagSource(trace, { speed: 'sync' });
    const got: number[] = [];
    let lastT = -Infinity;
    let magOk = true;
    src.subscribe((s) => {
      got.push(s.t);
      if (s.t < lastT) throw new Error('out of order');
      lastT = s.t;
      const expected = Math.hypot(s.x, s.y, s.z);
      if (Math.abs(s.mag - expected) > 1e-9) magOk = false;
      if (s.tier !== 'FIELD') magOk = false;
    });
    await src.start();
    expect(got).toHaveLength(trace.samples.length);
    expect(magOk).toBe(true);
    expect(src.done).toBe(true);
  });

  it('is deterministic: two sync replays produce identical streams', async () => {
    const trace = loadSeed();
    const runs: number[][] = [];
    for (let i = 0; i < 2; i++) {
      const src = new ReplayMagSource(trace, { speed: 'sync' });
      const mags: number[] = [];
      src.subscribe((s) => mags.push(s.mag));
      await src.start();
      runs.push(mags);
    }
    expect(runs[0]).toEqual(runs[1]);
  });

  it('unsubscribe stops delivery', async () => {
    const trace = loadSeed();
    const src = new ReplayMagSource(trace, { speed: 'sync' });
    let n = 0;
    const un = src.subscribe(() => n++);
    un();
    await src.start();
    expect(n).toBe(0);
  });
});

describe('timeToDistanceIn — the anchor map (ADR-006)', () => {
  const anchors = [{ t: 0, in: 0 }, { t: 8, in: 24 }];
  it('maps linearly between anchors', () => {
    expect(timeToDistanceIn(anchors, 0)).toBeCloseTo(0, 9);
    expect(timeToDistanceIn(anchors, 4)).toBeCloseTo(12, 9);
    expect(timeToDistanceIn(anchors, 8)).toBeCloseTo(24, 9);
    // 3 in/s paced sweep: t = 1.3333 s → 4.0 in (the first fastener).
    expect(timeToDistanceIn(anchors, 4 / 3)).toBeCloseTo(4, 6);
  });
  it('extrapolates beyond the ends on the nearest segment', () => {
    expect(timeToDistanceIn(anchors, 9)).toBeCloseTo(27, 9);
    expect(timeToDistanceIn(anchors, -1)).toBeCloseTo(-3, 9);
  });
  it('multi-segment: piecewise-linear', () => {
    const a = [{ t: 0, in: 0 }, { t: 4, in: 10 }, { t: 8, in: 30 }];
    expect(timeToDistanceIn(a, 2)).toBeCloseTo(5, 9);
    expect(timeToDistanceIn(a, 6)).toBeCloseTo(20, 9);
  });
});

describe('validateTrace', () => {
  it('accepts the shipped seed fixture', () => {
    expect(() => loadSeed()).not.toThrow();
  });
  it('rejects a trace without an expected block — a fixture with no assertion is not a fixture', () => {
    const t = loadSeed() as unknown as Record<string, unknown>;
    delete t['expected'];
    expect(() => validateTrace(t)).toThrow(/expected/);
  });
  it('rejects out-of-order samples', () => {
    const t = loadSeed();
    const bad = { ...t, samples: [{ t: 1, x: 0, y: 0, z: 0 }, { t: 0.5, x: 0, y: 0, z: 0 }] };
    expect(() => validateTrace(bad)).toThrow(/non-decreasing/);
  });
});
