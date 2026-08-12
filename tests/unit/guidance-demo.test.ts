/**
 * DEMO mode — SPEC §7B.4, tests/fixtures/SCHEMA.md.
 * Narration lands at trace times through the real replay source, the
 * synthetic label always surfaces, and the shipped specs are well-formed
 * and in voice. (The corpus link is asserted separately in
 * guidance-demo-corpus.test.ts.)
 */
import { describe, expect, it } from 'vitest';
import {
  DEMO_SPECS,
  SYNTHETIC_LABEL,
  demosForTool,
  runDemo,
  type DemoSpec,
} from '../../src/guidance/demo';
import { voiceViolations } from '../../src/guidance/voice';
import type { SensorTrace } from '../../src/types';

function makeTrace(overrides: Partial<SensorTrace> = {}): SensorTrace {
  return {
    schema: 'square.trace/1',
    id: 'test-trace',
    synthetic: true,
    note: 'unit-test trace',
    device: { platform: 'test', magTier: 'FIELD' },
    hz: 40,
    units: { mag: 'uT', t: 's', distance: 'in' },
    anchors: [
      { t: 0, in: 0 },
      { t: 1, in: 3 },
    ],
    samples: [
      { t: 0.0, x: 0, y: 0, z: 50 },
      { t: 0.5, x: 1, y: 0, z: 50 },
      { t: 1.0, x: 0, y: 0, z: 50 },
    ],
    expected: { peaks_in: [], tolerance_in: 0.75, pitch_in: null, confidence: 'NOISE', warnings: [] },
    ...overrides,
  };
}

const demoSpec: DemoSpec = {
  toolId: 'scan',
  fixtureId: 'test-trace',
  narration: [
    { atT: 0.4, text: 'Watch the middle sample.' },
    { atT: 0.0, text: 'Watch the ribbon start.' },
    { atT: 99, text: 'Read the result.' },
  ],
};

describe('runDemo', () => {
  it('plays the fixture through ReplayMagSource and emits narration at trace times, in order', async () => {
    const events: string[] = [];
    await runDemo(
      demoSpec,
      {
        onNarration: (l) => events.push(`narr@${l.atT}`),
        onSyntheticLabel: (t) => events.push(`label:${t}`),
        onSample: (s) => events.push(`sample@${s.t}`),
        onExpected: (e) => events.push(`expected:${e.confidence}`),
        onEnd: () => events.push('end'),
      },
      { speed: 'sync', load: async () => makeTrace() },
    );
    expect(events).toEqual([
      `label:${SYNTHETIC_LABEL}`, // surfaced before any playback
      'narr@0',
      'sample@0',
      'narr@0.4', // sorted into time order despite spec order
      'sample@0.5',
      'sample@1',
      'narr@99', // lines past the trace still land at the end
      'expected:NOISE',
      'end',
    ]);
  });

  it('always surfaces trace.synthetic — and stays quiet for a real recording', async () => {
    const labels: string[] = [];
    const deps = {
      onNarration: () => {},
      onSyntheticLabel: (t: string) => labels.push(t),
    };
    await runDemo(demoSpec, deps, { speed: 'sync', load: async () => makeTrace({ synthetic: true }) });
    expect(labels).toEqual([SYNTHETIC_LABEL]);

    labels.length = 0;
    await runDemo(demoSpec, deps, { speed: 'sync', load: async () => makeTrace({ synthetic: false }) });
    expect(labels).toEqual([]);
  });

  it('exposes the trace and a stop() on the handle', async () => {
    const handle = await runDemo(
      demoSpec,
      { onNarration: () => {}, onSyntheticLabel: () => {} },
      { speed: 'sync', load: async () => makeTrace() },
    );
    expect(handle.trace.id).toBe('test-trace');
    expect(handle.source.done).toBe(true);
    handle.stop(); // idempotent after sync completion
  });
});

describe('DEMO_SPECS — the shipped demos', () => {
  it('includes the scan walkthrough and both failure demos (§15.7: teach the limits)', () => {
    expect(DEMO_SPECS['scan-first-wall']?.fixtureId).toBe('drywall-16oc-synthetic');
    expect(DEMO_SPECS['scan-hot-wall']?.fixtureId).toBe('metal-stud-hot');
    expect(DEMO_SPECS['scan-magsafe']?.fixtureId).toBe('magsafe-attached');
  });

  it('the first-wall narration teaches the ribbon, the zero crossing, and the lattice lock', () => {
    const text = DEMO_SPECS['scan-first-wall']!.narration.map((l) => l.text).join(' ');
    expect(text).toMatch(/ribbon/i);
    expect(text).toMatch(/zero crossing/i);
    expect(text).toMatch(/lattice/i);
    expect(text).toMatch(/sixteen inches|16/);
  });

  for (const [id, spec] of Object.entries(DEMO_SPECS)) {
    it(`${id}: well-formed, narrated, and in voice`, () => {
      expect(spec.toolId.length).toBeGreaterThan(0);
      expect(spec.fixtureId.length).toBeGreaterThan(0);
      expect(spec.narration.length).toBeGreaterThan(0);
      for (const line of spec.narration) {
        expect(line.atT).toBeGreaterThanOrEqual(0);
        expect(line.text.trim().length).toBeGreaterThan(0);
        expect(voiceViolations(line.text), `voice rules (§7B.10): "${line.text}"`).toEqual([]);
      }
    });
  }

  it('demosForTool filters by tool and keeps declaration order', () => {
    const scan = demosForTool('scan').map((d) => d.id);
    expect(scan).toEqual(['scan-first-wall', 'scan-hot-wall', 'scan-magsafe']);
    expect(demosForTool('level')).toEqual([]);
  });
});
