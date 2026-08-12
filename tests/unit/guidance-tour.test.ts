/**
 * Guided-run engine — SPEC §7B.1 layer 3, §7B.3, §7B.5.
 * UI-free by construction: these tests inject render/sensorHook fakes and
 * assert the invariants — advance on real events only, one step visible at
 * a time, dismiss/skip always work and are remembered, fading filters.
 */
import { describe, expect, it } from 'vitest';
import { FadingStore, memoryStorage } from '../../src/guidance/fading';
import {
  runGuide,
  stepsForLevel,
  type GuideDeps,
  type GuideOutcome,
  type GuideSpec,
  type GuideStep,
} from '../../src/guidance/tour';

interface Harness {
  deps: GuideDeps;
  rendered: string[]; // step ids in render order
  visible: () => string[]; // step ids currently on screen
  tapVisible: () => void; // user taps the visible coach mark
  emit: (sample: unknown) => void; // sensor sample arrives
}

function makeHarness(): Harness {
  const rendered: string[] = [];
  const onScreen = new Map<string, () => void>(); // id -> onDismiss
  const hooks: Array<{ predicate: (s: unknown) => boolean; cb: () => void; off: boolean }> = [];
  const deps: GuideDeps = {
    render(step, onDismiss) {
      rendered.push(step.id);
      onScreen.set(step.id, onDismiss);
      return () => onScreen.delete(step.id);
    },
    sensorHook(predicate, cb) {
      const h = { predicate, cb, off: false };
      hooks.push(h);
      return () => {
        h.off = true;
      };
    },
  };
  return {
    deps,
    rendered,
    visible: () => [...onScreen.keys()],
    tapVisible: () => {
      for (const dismiss of [...onScreen.values()]) dismiss();
    },
    emit: (sample) => {
      for (const h of [...hooks]) {
        if (!h.off && h.predicate(sample)) h.cb();
      }
    },
  };
}

const spec: GuideSpec = {
  toolId: 'scan',
  steps: [
    { id: 'intro', text: 'Hold the phone flat on the wall.', advanceOn: 'tap' },
    {
      id: 'sweep',
      text: 'Sweep right at the metronome pace.',
      critical: true,
      advanceOn: { event: 'sensor', predicate: (s) => (s as { mag: number }).mag > 3 },
    },
    { id: 'mark', text: 'Tap MARK on the peak.', anchor: '#mark', critical: true, advanceOn: { event: 'custom', name: 'marked' } },
  ],
};

describe('advancing on real events, never a Next button (§7B.1)', () => {
  it('tap steps advance when the user taps the mark', () => {
    const h = makeHarness();
    const guide = runGuide(spec, h.deps);
    expect(guide.step?.id).toBe('intro');
    h.tapVisible();
    expect(guide.step?.id).toBe('sweep');
  });

  it('sensor steps advance only when a sample satisfies the predicate', () => {
    const h = makeHarness();
    const guide = runGuide(spec, h.deps);
    h.tapVisible(); // past intro
    expect(guide.step?.id).toBe('sweep');
    h.emit({ mag: 0.4 }); // below threshold — no advance
    expect(guide.step?.id).toBe('sweep');
    h.emit({ mag: 4.2 }); // a real peak
    expect(guide.step?.id).toBe('mark');
  });

  it('custom steps advance only on the matching event name', () => {
    const outcomes: GuideOutcome[] = [];
    const h = makeHarness();
    const guide = runGuide(spec, h.deps, { onEnd: (o) => outcomes.push(o) });
    h.tapVisible();
    h.emit({ mag: 9 });
    expect(guide.step?.id).toBe('mark');
    guide.fireCustom('anchored'); // wrong event
    expect(guide.step?.id).toBe('mark');
    guide.fireCustom('marked');
    expect(guide.active).toBe(false);
    expect(outcomes).toEqual(['completed']);
  });
});

describe('one step visible at a time (§7B.5)', () => {
  it('tears the previous mark down before rendering the next', () => {
    const h = makeHarness();
    runGuide(spec, h.deps);
    expect(h.visible()).toEqual(['intro']);
    h.tapVisible();
    expect(h.visible()).toEqual(['sweep']);
    h.emit({ mag: 9 });
    expect(h.visible()).toEqual(['mark']);
    expect(h.rendered).toEqual(['intro', 'sweep', 'mark']);
  });

  it('sensor hooks are released when their step ends', () => {
    const h = makeHarness();
    const guide = runGuide(spec, h.deps);
    h.tapVisible();
    h.emit({ mag: 9 }); // advances sweep -> mark
    h.emit({ mag: 9 }); // stale sample must not advance anything
    expect(guide.step?.id).toBe('mark');
    expect(h.visible()).toEqual(['mark']);
  });
});

describe('dismiss and skip always work, and are remembered (§7B.3)', () => {
  it('skip ends the guide, records it, and the guide stays silent afterward', () => {
    const memory = new FadingStore(memoryStorage());
    const outcomes: GuideOutcome[] = [];
    const h1 = makeHarness();
    const guide = runGuide(spec, h1.deps, { memory, onEnd: (o) => outcomes.push(o) });
    guide.skip();
    expect(outcomes).toEqual(['skipped']);
    expect(guide.active).toBe(false);
    expect(h1.visible()).toEqual([]);
    expect(memory.isGuideDismissed('scan')).toBe(true);

    const h2 = makeHarness();
    runGuide(spec, h2.deps, { memory, onEnd: (o) => outcomes.push(o) });
    expect(h2.rendered).toEqual([]); // nothing re-shows without explicit re-entry
    expect(outcomes).toEqual(['skipped', 'completed']);
  });

  it('"guide me" re-entry (explicit level) overrides a remembered skip', () => {
    const memory = new FadingStore(memoryStorage());
    memory.dismissGuide('scan');
    const h = makeHarness();
    runGuide(spec, h.deps, { memory, level: 'full' });
    expect(h.rendered).toEqual(['intro']);
  });

  it('dismissing an event-advanced step is remembered per step', () => {
    const memory = new FadingStore(memoryStorage());
    const h1 = makeHarness();
    const g1 = runGuide(spec, h1.deps, { memory });
    h1.tapVisible(); // advance intro (normal tap flow — not a dismissal)
    expect(g1.step?.id).toBe('sweep');
    h1.tapVisible(); // dismiss the sensor step's prompt — remembered
    expect(g1.step?.id).toBe('mark');
    expect(memory.isStepDismissed('scan', 'sweep')).toBe(true);
    expect(memory.isStepDismissed('scan', 'intro')).toBe(false);

    const h2 = makeHarness();
    const g2 = runGuide(spec, h2.deps, { memory });
    h2.tapVisible();
    expect(g2.step?.id).toBe('mark'); // sweep never re-shows
    expect(h2.rendered).toEqual(['intro', 'mark']);
  });

  it('per-tool reset restores every prompt', () => {
    const memory = new FadingStore(memoryStorage());
    memory.dismissStep('scan', 'sweep');
    memory.dismissGuide('scan');
    memory.reset('scan');
    const h = makeHarness();
    runGuide(spec, h.deps, { memory });
    expect(h.rendered).toEqual(['intro']);
  });

  it('stop tears down without recording a dismissal', () => {
    const memory = new FadingStore(memoryStorage());
    const h = makeHarness();
    const guide = runGuide(spec, h.deps, { memory });
    guide.stop();
    expect(h.visible()).toEqual([]);
    expect(memory.isGuideDismissed('scan')).toBe(false);
  });
});

describe('fading filters the steps (§7B.3)', () => {
  it('full shows everything, reduced shows critical only, silent shows nothing', () => {
    expect(stepsForLevel(spec.steps, 'full').map((s) => s.id)).toEqual(['intro', 'sweep', 'mark']);
    expect(stepsForLevel(spec.steps, 'reduced').map((s) => s.id)).toEqual(['sweep', 'mark']);
    expect(stepsForLevel(spec.steps, 'silent')).toEqual([]);
  });

  it('reduced runs render only critical steps', () => {
    const h = makeHarness();
    const guide = runGuide(spec, h.deps, { level: 'reduced' });
    expect(guide.step?.id).toBe('sweep');
    h.emit({ mag: 9 });
    expect(guide.step?.id).toBe('mark');
    expect(h.rendered).toEqual(['sweep', 'mark']);
  });

  it('silent runs complete immediately with no renders', () => {
    const outcomes: GuideOutcome[] = [];
    const h = makeHarness();
    const guide = runGuide(spec, h.deps, { level: 'silent', onEnd: (o) => outcomes.push(o) });
    expect(h.rendered).toEqual([]);
    expect(guide.active).toBe(false);
    expect(outcomes).toEqual(['completed']);
  });

  it('the level comes from memory when not given: run 3 is reduced', () => {
    const memory = new FadingStore(memoryStorage());
    memory.recordRun('scan');
    memory.recordRun('scan');
    const h = makeHarness();
    runGuide(spec, h.deps, { memory });
    expect(h.rendered).toEqual(['sweep']);
  });
});

describe('step copy obeys the coach-mark rules (§7B.5)', () => {
  it('example spec text stays within two short lines', () => {
    for (const s of spec.steps as GuideStep[]) {
      expect(s.text.length).toBeLessThan(160);
    }
  });
});
