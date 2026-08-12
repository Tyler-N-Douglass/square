/**
 * BEVEL 3D mode — SPEC §4.5.1 (A4, Phase 2): gyro-linked placements, drift
 * budget growing with elapsed time, hard refusal at 20 s with GYRO_DRIFT.
 */
import { describe, expect, it } from 'vitest';
import {
  Bevel3DCapture,
  DRIFT_BASE_DEG,
  DRIFT_RATE_DEG_PER_S,
  DRIFT_REFUSE_S,
  driftBudgetDeg,
  type ThreeDPhase,
} from '../../src/tools/bevel/capture';
import { foldStream, gravityOnFace, syntheticImuStream } from '../../src/tools/bevel/synthetic';

function runStream(machine: Bevel3DCapture, samples: ReturnType<typeof foldStream>): ThreeDPhase[] {
  machine.arm();
  const phases: ThreeDPhase[] = [];
  for (const s of samples) phases.push(machine.ingest(s));
  return phases;
}

describe('drift budget model', () => {
  it('grows with elapsed time', () => {
    expect(driftBudgetDeg(0)).toBeCloseTo(DRIFT_BASE_DEG, 9);
    expect(driftBudgetDeg(10)).toBeCloseTo(DRIFT_BASE_DEG + 10 * DRIFT_RATE_DEG_PER_S, 9);
    expect(driftBudgetDeg(19)).toBeGreaterThan(driftBudgetDeg(5));
  });
});

describe('Bevel3DCapture', () => {
  it('recovers a 135° fold by gyro integration between two still placements', () => {
    const phases = runStream(new Bevel3DCapture(), foldStream({ foldDeg: 135, seed: 7 }));
    const done = phases.find((p) => p.phase === 'done');
    expect(done).toBeDefined();
    if (done && done.phase === 'done') {
      expect(Math.abs(done.result.thetaDeg - 135)).toBeLessThan(1.5);
      // ± includes the budget, so it can never undercut it
      expect(done.result.plusMinusDeg).toBeGreaterThanOrEqual(done.result.budgetDeg);
      expect(done.result.elapsedS).toBeGreaterThan(0);
      expect(done.result.elapsedS).toBeLessThan(DRIFT_REFUSE_S);
    }
  });

  it('shows a budget that grows through transit', () => {
    const phases = runStream(new Bevel3DCapture(), foldStream({ foldDeg: 90, transitS: 3, seed: 21 }));
    const budgets = phases.filter((p) => p.phase === 'transit').map((p) => (p.phase === 'transit' ? p.budgetDeg : 0));
    expect(budgets.length).toBeGreaterThan(10);
    expect(budgets[budgets.length - 1]!).toBeGreaterThan(budgets[0]!);
  });

  it('REFUSES at 20 s between placements — GYRO_DRIFT, no angle ever emitted', () => {
    const samples = syntheticImuStream({
      g0: gravityOnFace(0, 0),
      seed: 13,
      segments: [
        { kind: 'still', s: 1.4 },
        { kind: 'shake', s: 21 },
        { kind: 'rotate', axis: [0, 1, 0], totalDeg: 135, s: 1.0 },
        { kind: 'still', s: 1.4 },
      ],
    });
    const phases = runStream(new Bevel3DCapture(), samples);
    const refused = phases.find((p) => p.phase === 'refused');
    expect(refused).toBeDefined();
    if (refused && refused.phase === 'refused') {
      expect(refused.warning).toBe('GYRO_DRIFT');
      expect(refused.elapsedS).toBeGreaterThanOrEqual(DRIFT_REFUSE_S);
      expect(refused.elapsedS).toBeLessThan(DRIFT_REFUSE_S + 1);
      expect(refused.reason).toContain('20');
      // never a dihedral: no done phase anywhere in the run
      expect(phases.some((p) => p.phase === 'done')).toBe(false);
    }
    // and the machine stays refused for the rest of the stream
    expect(phases[phases.length - 1]!.phase).toBe('refused');
  });

  it('a capture inside the budget still succeeds after a long-but-legal transit', () => {
    const samples = syntheticImuStream({
      g0: gravityOnFace(0, 0),
      seed: 17,
      segments: [
        { kind: 'still', s: 1.4 },
        { kind: 'shake', s: 8 },
        { kind: 'rotate', axis: [0, 1, 0], totalDeg: 90, s: 1.0 },
        { kind: 'still', s: 1.4 },
      ],
    });
    const phases = runStream(new Bevel3DCapture(), samples);
    const done = phases.find((p) => p.phase === 'done');
    expect(done).toBeDefined();
    if (done && done.phase === 'done') {
      // the shake integrates seeded zero-mean gyro noise; stay honest but loose
      expect(Math.abs(done.result.thetaDeg - 90)).toBeLessThan(6);
      expect(done.result.budgetDeg).toBeGreaterThan(driftBudgetDeg(8));
    }
  });
});
