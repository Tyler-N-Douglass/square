/**
 * LEVEL guide specs (src/tools/level/guide.ts): structure per §7B (stable
 * ids, critical stillness step, sensor-event advancing), the reversal
 * walkthrough driving the machine through the real tour engine, voice
 * rules over every string, and the glossary additions' shape.
 */
import { describe, expect, it } from 'vitest';
import { runGuide, type GuideDeps, type GuideStep } from '../../src/guidance/tour';
import { voiceViolations } from '../../src/guidance/voice';
import { ReversalMachine } from '../../src/tools/level/levelState';
import { DEMOS, GLOSSARY_ADDITIONS, LEVEL_GUIDE, reversalGuideSpec } from '../../src/tools/level/guide';

const RAD = Math.PI / 180;

describe('LEVEL_GUIDE structure', () => {
  it('advances on real events: sensors live → set flat → stillness → reading → reversal', () => {
    const ids = LEVEL_GUIDE.steps.map((s) => s.id);
    expect(ids).toEqual(['wake', 'set-surface', 'hold-still', 'reading', 'reversal-offer']);
    expect(LEVEL_GUIDE.steps[0]!.advanceOn).toEqual({ event: 'custom', name: 'sensors-live' });
    const holdStill = LEVEL_GUIDE.steps.find((s) => s.id === 'hold-still')!;
    expect(typeof holdStill.advanceOn).toBe('object');
  });

  it('the stillness step is critical — it survives fading to reduced', () => {
    expect(LEVEL_GUIDE.steps.find((s) => s.id === 'hold-still')!.critical).toBe(true);
    expect(LEVEL_GUIDE.steps.find((s) => s.id === 'set-surface')!.critical).toBe(true);
  });

  it('the stillness predicate fires on the fusion stable flag, not on values', () => {
    const step = LEVEL_GUIDE.steps.find((s) => s.id === 'hold-still')!;
    const on = step.advanceOn as { event: 'sensor'; predicate: (s: unknown) => boolean };
    expect(on.predicate({ pitch: 0.5, roll: 0.5, stable: false })).toBe(false);
    expect(on.predicate({ pitch: 0.5, roll: 0.5, stable: true })).toBe(true);
    expect(on.predicate(null)).toBe(false);
  });

  it('the set-flat predicate wants a face-up-ish phone', () => {
    const step = LEVEL_GUIDE.steps.find((s) => s.id === 'set-surface')!;
    const on = step.advanceOn as { event: 'sensor'; predicate: (s: unknown) => boolean };
    expect(on.predicate({ pitch: 1 * RAD, roll: 2 * RAD, stable: false })).toBe(true);
    expect(on.predicate({ pitch: 80 * RAD, roll: 0, stable: true })).toBe(false);
  });
});

describe('reversal walkthrough through the real tour engine', () => {
  function engineHarness() {
    let pred: ((s: unknown) => boolean) | null = null;
    let cb: (() => void) | null = null;
    const rendered: string[] = [];
    const deps: GuideDeps = {
      render: (step: GuideStep) => {
        rendered.push(step.id);
        return () => { /* torn down by engine */ };
      },
      sensorHook: (p, c) => {
        pred = p;
        cb = c;
        return () => {
          pred = null;
          cb = null;
        };
      },
    };
    const feed = (o: { pitch: number; roll: number; stable: boolean }): void => {
      if (pred && pred(o)) cb?.();
    };
    return { deps, feed, rendered };
  }

  it('measure → turn (motion observed) → measure → done computes the bias', () => {
    const machine = new ReversalMachine(5, 3);
    const { deps, feed, rendered } = engineHarness();
    let outcome = '';
    runGuide(reversalGuideSpec(machine), deps, { onEnd: (o) => { outcome = o; } });

    // step 1: hold still at m1 = true(1.2) + bias(0.5)
    for (let i = 0; i < 5; i++) feed({ pitch: 1.7 * RAD, roll: 0.3 * RAD, stable: true });
    expect(rendered).toContain('rev-turn');
    // step 2: the turn — motion, then still again
    for (let i = 0; i < 4; i++) feed({ pitch: 0.5, roll: 0.5, stable: false });
    feed({ pitch: -0.7 * RAD, roll: -0.1 * RAD, stable: true });
    expect(rendered).toContain('rev-m2');
    // step 3: hold still at m2 = −true + bias
    for (let i = 0; i < 5; i++) feed({ pitch: -0.7 * RAD, roll: -0.1 * RAD, stable: true });

    expect(outcome).toBe('completed');
    expect(machine.state).toBe('done');
    expect(machine.result!.biasPitchDeg).toBeCloseTo(0.5, 6);
    expect(machine.result!.surfacePitchDeg).toBeCloseTo(1.2, 6);
    expect(machine.result!.biasRollDeg).toBeCloseTo(0.1, 6);
  });

  it('rev-m2 honors a tap-dismissed turn prompt via forceTurnDone', () => {
    const machine = new ReversalMachine(5, 3);
    const spec = reversalGuideSpec(machine);
    // capture m1
    const on1 = spec.steps[0]!.advanceOn as { event: 'sensor'; predicate: (s: unknown) => boolean };
    for (let i = 0; i < 5; i++) on1.predicate({ pitch: 1.0 * RAD, roll: 0, stable: true });
    expect(machine.state).toBe('turn');
    // user tap-dismissed the turn step; step 3's predicate converts it
    const on3 = spec.steps[2]!.advanceOn as { event: 'sensor'; predicate: (s: unknown) => boolean };
    let done = false;
    for (let i = 0; i < 5 && !done; i++) done = on3.predicate({ pitch: -0.4 * RAD, roll: 0, stable: true });
    expect(machine.state).toBe('done');
    expect(machine.result!.biasPitchDeg).toBeCloseTo(0.3, 6);
  });

  it('every reversal step is critical and sensor-advanced', () => {
    const spec = reversalGuideSpec(new ReversalMachine());
    for (const s of spec.steps) {
      expect(s.critical).toBe(true);
      expect(typeof s.advanceOn).toBe('object');
    }
  });
});

describe('voice rules (§7B.10) over every LEVEL guidance string', () => {
  const strings: string[] = [
    ...LEVEL_GUIDE.steps.map((s) => s.text),
    ...reversalGuideSpec(new ReversalMachine()).steps.map((s) => s.text),
    ...DEMOS.flatMap((d) => d.narration.map((l) => l.text)),
    ...Object.values(GLOSSARY_ADDITIONS).flatMap((g) => [g.term, g.def, g.whyItMatters]),
  ];

  it('collects a real corpus', () => {
    expect(strings.length).toBeGreaterThan(15);
  });

  for (const s of strings) {
    it(`clean: "${s.slice(0, 48)}…"`, () => {
      expect(voiceViolations(s)).toEqual([]);
    });
  }

  it('coach-mark texts stay within two short lines (§7B.5)', () => {
    for (const s of [...LEVEL_GUIDE.steps, ...reversalGuideSpec(new ReversalMachine()).steps]) {
      expect(s.text.length).toBeLessThanOrEqual(110);
    }
  });
});

describe('GLOSSARY_ADDITIONS shape', () => {
  it('each entry has a term, one-sentence def, and a why-it-matters line', () => {
    const entries = Object.entries(GLOSSARY_ADDITIONS);
    expect(entries.length).toBeGreaterThan(0);
    for (const [slug, e] of entries) {
      expect(slug).toMatch(/^[a-z][a-z-]*$/);
      expect(e.term.length).toBeGreaterThan(2);
      expect(e.def.length).toBeGreaterThan(10);
      expect(e.whyItMatters.length).toBeGreaterThan(10);
    }
  });
});
