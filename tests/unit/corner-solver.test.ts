/**
 * MC uncertainty plumbing through the worker boundary (SPEC §4.3.3, §3.1):
 * drive the pure handler exported by solver.worker with the same requests
 * the CORNER tool posts, against synthetic projections with known truth.
 * No physics mocked — the handler calls the real solver + Monte Carlo.
 */
import { describe, expect, it } from 'vitest';
import { handleSolverRequest } from '../../src/workers/solver.worker';
import { createSolverRunner } from '../../src/tools/corner/solverClient';
import { degenerateExample, workedExample } from '../../src/tools/corner/worked';

const ex = workedExample(88.6);

describe('handleSolverRequest — the worker protocol', () => {
  it('cornerAngle echoes the id and recovers the truth within 0.3°', () => {
    const res = handleSolverRequest({ id: 7, kind: 'cornerAngle', quad: ex.quad, k: ex.k });
    expect(res.id).toBe(7);
    expect(res.kind).toBe('cornerAngle');
    if (res.kind !== 'cornerAngle') return;
    expect(res.result.ok).toBe(true);
    if (res.result.ok) expect(Math.abs(res.result.thetaDeg - ex.truthDeg)).toBeLessThanOrEqual(0.3);
  });

  it('monteCarlo returns a band that brackets the truth, with MC bookkeeping', () => {
    const res = handleSolverRequest({
      id: 8,
      kind: 'monteCarlo',
      quad: ex.quad,
      k: ex.k,
      options: { sigmaPx: 2, samples: 500, seed: 0x5eed },
    });
    expect(res.kind).toBe('monteCarlo');
    if (res.kind !== 'monteCarlo') return;
    const mc = res.result;
    expect(mc.ok).toBe(true);
    if (!mc.ok) return;
    expect(mc.samplesUsed + mc.samplesRefused).toBe(500);
    expect(mc.halfWidthDeg).toBeGreaterThan(0);
    expect(mc.p5Deg).toBeLessThan(mc.medianDeg);
    expect(mc.p95Deg).toBeGreaterThan(mc.medianDeg);
    // The truth sits inside (or within noise of) the reported band.
    expect(Math.abs(mc.medianDeg - ex.truthDeg)).toBeLessThanOrEqual(mc.halfWidthDeg + 0.3);
    expect(mc.sigmaPx).toBe(2);
  });

  it('is deterministic for a fixed seed', () => {
    const req = {
      id: 1,
      kind: 'monteCarlo',
      quad: ex.quad,
      k: ex.k,
      options: { sigmaPx: 2, samples: 200, seed: 42 },
    } as const;
    const a = handleSolverRequest({ ...req });
    const b = handleSolverRequest({ ...req });
    expect(a).toEqual(b);
  });

  it('σ scaling matters: more marking noise, wider band', () => {
    const run = (sigmaPx: number) => {
      const res = handleSolverRequest({
        id: 2,
        kind: 'monteCarlo',
        quad: ex.quad,
        k: ex.k,
        options: { sigmaPx, samples: 300, seed: 9 },
      });
      if (res.kind !== 'monteCarlo' || !res.result.ok) throw new Error('unexpected refusal');
      return res.result.halfWidthDeg;
    };
    expect(run(4)).toBeGreaterThan(run(1));
  });

  it('the degenerate marking refuses with POOR_GEOMETRY — no number', () => {
    const bad = degenerateExample();
    const res = handleSolverRequest({ id: 3, kind: 'monteCarlo', quad: bad.quad, k: bad.k });
    if (res.kind !== 'monteCarlo') throw new Error('wrong kind');
    expect(res.result.ok).toBe(false);
    if (!res.result.ok) expect(res.result.reason).toBe('POOR_GEOMETRY');
  });
});

describe('createSolverRunner fallback (no Worker in this environment)', () => {
  it('routes through the same pure functions the worker dispatches to', async () => {
    const runner = createSolverRunner();
    const point = await runner.cornerAngle(ex.quad, ex.k);
    expect(point.ok).toBe(true);
    if (point.ok) expect(Math.abs(point.thetaDeg - ex.truthDeg)).toBeLessThanOrEqual(0.3);
    const mc = await runner.monteCarlo(ex.quad, ex.k, { sigmaPx: 2, samples: 200, seed: 42 });
    expect(mc.ok).toBe(true);
    runner.dispose();
  });
});
