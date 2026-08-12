/**
 * LEVEL DEMO streams (ADR-012): deterministic seeded synthesis, played
 * through the REAL OrientationFusion — the settle stream earns HOLD at
 * +1.2°, the motion-gate stream never earns HOLD (limits first, §15.7),
 * and the driver refuses to play unlabeled.
 */
import { describe, expect, it } from 'vitest';
import type { Orientation } from '../../src/sensors/types';
import { SYNTHETIC_LABEL, type DemoSpec } from '../../src/guidance/demo';
import {
  LEVEL_DEMO_STREAMS,
  makeMotionGateStream,
  makeSurfaceSettleStream,
  runLevelImuDemo,
} from '../../src/tools/level/demoStream';
import { DEMOS } from '../../src/tools/level/guide';

const DEG = 180 / Math.PI;

describe('determinism — same seed, same stream, every run', () => {
  it('surface-settle regenerates byte-identical', () => {
    expect(makeSurfaceSettleStream()).toEqual(makeSurfaceSettleStream());
  });

  it('motion-gate regenerates byte-identical', () => {
    expect(makeMotionGateStream()).toEqual(makeMotionGateStream());
  });

  it('both streams are labeled synthetic in their data', () => {
    expect(makeSurfaceSettleStream().synthetic).toBe(true);
    expect(makeMotionGateStream().synthetic).toBe(true);
  });
});

function playThroughRealFusion(fixtureId: string): Orientation[] {
  const spec = DEMOS.find((d) => d.fixtureId === fixtureId)!;
  const out: Orientation[] = [];
  runLevelImuDemo(
    spec,
    {
      onSyntheticLabel: () => { /* asserted separately */ },
      onNarration: () => { /* asserted separately */ },
      onOrientation: (o) => out.push(o),
    },
    { speed: 'sync' },
  );
  return out;
}

describe('through the real fusion — no demo bypasses the pipeline', () => {
  it('surface-settle: MOVING under tremor, then HOLD at +1.2°', () => {
    const out = playThroughRealFusion('level-imu-surface-settle');
    expect(out.length).toBe(makeSurfaceSettleStream().samples.length);
    // tremor phase: the gate refuses
    expect(out.filter((o) => o.t < 3.3).every((o) => !o.stable)).toBe(true);
    // settled phase: HOLD, at the true angle
    const last = out[out.length - 1]!;
    expect(last.stable).toBe(true);
    expect(last.pitch * DEG).toBeCloseTo(1.2, 1);
    expect(Math.abs(last.roll * DEG)).toBeLessThan(0.1);
  });

  it('motion-gate: the fusion never grants HOLD — refusal is the demo', () => {
    const out = playThroughRealFusion('level-imu-motion-gate');
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((o) => !o.stable)).toBe(true);
  });
});

describe('the driver', () => {
  it('labels SYNTHETIC before any sample or narration — mandatory', () => {
    const order: string[] = [];
    runLevelImuDemo(
      DEMOS[1]!,
      {
        onSyntheticLabel: (t) => order.push(`label:${t}`),
        onNarration: () => order.push('narration'),
        onSample: () => { if (order.length < 3) order.push('sample'); },
      },
      { speed: 'sync' },
    );
    expect(order[0]).toBe(`label:${SYNTHETIC_LABEL}`);
  });

  it('emits narration lines in time order at their trace times', () => {
    const seen: number[] = [];
    runLevelImuDemo(
      DEMOS[0]!,
      {
        onSyntheticLabel: () => { /* required */ },
        onNarration: (l) => seen.push(l.atT),
      },
      { speed: 'sync' },
    );
    expect(seen).toEqual(DEMOS[0]!.narration.map((l) => l.atT));
  });

  it('calls onEnd after the full stream', () => {
    let ended = false;
    runLevelImuDemo(
      DEMOS[0]!,
      { onSyntheticLabel: () => { /* required */ }, onNarration: () => { /* n/a */ }, onEnd: () => { ended = true; } },
      { speed: 'sync' },
    );
    expect(ended).toBe(true);
  });

  it('throws on a stream id that does not exist in-repo', () => {
    const bad: DemoSpec = { toolId: 'level', fixtureId: 'no-such-stream', narration: [] };
    expect(() =>
      runLevelImuDemo(bad, { onSyntheticLabel: () => { /* required */ }, onNarration: () => { /* n/a */ } }, { speed: 'sync' }),
    ).toThrow(/no-such-stream/);
  });
});

describe('DEMOS specs', () => {
  it('limits first (§15.7): the refusal demo leads', () => {
    expect(DEMOS[0]!.fixtureId).toBe('level-imu-motion-gate');
  });

  it('every fixtureId resolves to an in-repo seeded stream (ADR-012)', () => {
    for (const d of DEMOS) {
      expect(d.toolId).toBe('level');
      expect(LEVEL_DEMO_STREAMS[d.fixtureId], d.fixtureId).toBeTypeOf('function');
      expect(d.narration.length).toBeGreaterThan(0);
    }
  });

  it('narration names the stream synthetic out loud, not only in the banner', () => {
    for (const d of DEMOS) {
      expect(d.narration.some((l) => /synthetic|generated/i.test(l.text))).toBe(true);
    }
  });
});
