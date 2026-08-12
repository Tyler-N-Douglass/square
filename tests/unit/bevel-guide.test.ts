/**
 * BEVEL guide + DEMOs — SPEC §7B, ADR-012 (A4, Phase 2).
 *
 * The demos are deterministic synthetic streams played through the REAL
 * capture pipeline; this suite runs every shipped demo end-to-end and
 * asserts the outcome its spec claims — including both refusals. The
 * SYNTHETIC label is a required callback: a demo that can't label a
 * generated stream can't play one.
 */
import { describe, expect, it } from 'vitest';
import {
  BEVEL_DEMOS,
  BEVEL_GUIDE,
  GLOSSARY_ADDITIONS,
  SYNTHETIC_STREAM_LABEL,
  runBevelDemo,
} from '../../src/tools/bevel/guide';
import { voiceViolations } from '../../src/guidance/voice';

describe('BEVEL guide spec', () => {
  it('advances on real events for the capture steps', () => {
    const byId = new Map(BEVEL_GUIDE.steps.map((s) => [s.id, s]));
    expect(byId.get('wake')?.advanceOn).toEqual({ event: 'custom', name: 'sensors-started' });
    expect(byId.get('face1-still')?.advanceOn).toEqual({ event: 'custom', name: 'face1-captured' });
    expect(byId.get('face2-still')?.advanceOn).toEqual({ event: 'custom', name: 'face2-captured' });
  });

  it('flags the stillness and edge-horizontal steps critical (§7B.3 reduced level)', () => {
    const critical = BEVEL_GUIDE.steps.filter((s) => s.critical === true).map((s) => s.id);
    expect(critical).toContain('face1-still');
    expect(critical).toContain('face2-still');
    expect(critical).toContain('edge-level');
  });

  it('keeps the §7B.10 voice in every step', () => {
    for (const step of BEVEL_GUIDE.steps) {
      expect(voiceViolations(step.text), step.id).toEqual([]);
    }
  });
});

describe('DEMOs run the real pipeline (sync)', () => {
  it('every demo is synthetic and labels itself before playing', async () => {
    for (const [id, spec] of Object.entries(BEVEL_DEMOS)) {
      expect(spec.synthetic, id).toBe(true);
      let label: string | null = null;
      const handle = runBevelDemo(spec, {
        onSyntheticLabel: (text) => {
          label = text;
        },
        onNarration: () => undefined,
      }, { speed: 'sync' });
      await handle.done;
      expect(label, id).toBe(SYNTHETIC_STREAM_LABEL);
    }
  });

  it('bevel-known-cut recovers 135° through GravityCapture', async () => {
    const spec = BEVEL_DEMOS['bevel-known-cut']!;
    let theta: number | null = null;
    await runBevelDemo(spec, {
      onSyntheticLabel: () => undefined,
      onNarration: () => undefined,
      onResult: (r) => {
        if ('ok' in r && r.ok) theta = r.thetaDeg;
      },
    }, { speed: 'sync' }).done;
    expect(theta).not.toBeNull();
    const exp = spec.expected;
    expect(exp.kind).toBe('angle');
    if (exp.kind === 'angle') {
      expect(Math.abs((theta ?? 0) - exp.thetaDeg)).toBeLessThan(exp.tolDeg);
    }
  });

  it('bevel-tilted-edge REFUSES with the stated reason — never an angle', async () => {
    const spec = BEVEL_DEMOS['bevel-tilted-edge']!;
    let refusal: string | null = null;
    let sawAngle = false;
    await runBevelDemo(spec, {
      onSyntheticLabel: () => undefined,
      onNarration: () => undefined,
      onResult: (r) => {
        if ('ok' in r) {
          if (r.ok) sawAngle = true;
          else refusal = r.reason;
        }
      },
    }, { speed: 'sync' }).done;
    expect(sawAngle).toBe(false);
    expect(refusal).not.toBeNull();
    const exp = spec.expected;
    if (exp.kind === 'refusal') {
      expect(refusal!).toContain(exp.reasonIncludes);
    }
    // the true fold was 135° — the refusal must not leak it
    expect(refusal!).not.toContain('135');
  });

  it('bevel-drift-budget REFUSES with GYRO_DRIFT through Bevel3DCapture', async () => {
    const spec = BEVEL_DEMOS['bevel-drift-budget']!;
    let warning: string | null = null;
    let sawDone = false;
    await runBevelDemo(spec, {
      onSyntheticLabel: () => undefined,
      onNarration: () => undefined,
      onResult: (r) => {
        if (!('ok' in r)) {
          if (r.phase === 'refused') warning = r.warning;
          if (r.phase === 'done') sawDone = true;
        }
      },
    }, { speed: 'sync' }).done;
    expect(warning).toBe('GYRO_DRIFT');
    expect(sawDone).toBe(false);
  });

  it('narration lands in order and keeps the voice', async () => {
    const seen: number[] = [];
    for (const spec of Object.values(BEVEL_DEMOS)) {
      seen.length = 0;
      await runBevelDemo(spec, {
        onSyntheticLabel: () => undefined,
        onNarration: (line) => {
          seen.push(line.atT);
          expect(voiceViolations(line.text)).toEqual([]);
        },
      }, { speed: 'sync' }).done;
      expect(seen.length).toBe(spec.narration.length);
      expect([...seen].sort((a, b) => a - b)).toEqual(seen);
    }
  });
});

describe('GLOSSARY_ADDITIONS (merged by the lead)', () => {
  it('entries are complete, short, and in voice — same rules as glossary.ts', () => {
    for (const [slug, entry] of Object.entries(GLOSSARY_ADDITIONS)) {
      expect(entry.term.trim().length, slug).toBeGreaterThan(0);
      expect(entry.def.trim().endsWith('.'), slug).toBe(true);
      expect((entry.def.match(/\./g) ?? []).length, slug).toBe(1);
      expect(entry.def.length, slug).toBeLessThan(220);
      expect(entry.whyItMatters.length, slug).toBeLessThan(220);
      expect(voiceViolations(entry.def), slug).toEqual([]);
      expect(voiceViolations(entry.whyItMatters), slug).toEqual([]);
    }
  });
});
