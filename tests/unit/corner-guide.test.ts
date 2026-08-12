/**
 * CORNER guide + DEMO specs (SPEC §7B, ADR-012). The guided run advances on
 * real tool events; the DEMO is a worked example through the REAL solver
 * with the truth printed beside the recovery; the refusal demo comes first
 * (limits before capability, §15.7); copy passes the voice lint.
 */
import { describe, expect, it } from 'vitest';
import {
  CORNER_DEMOS,
  CORNER_GUIDE,
  DEMOS,
  GLOSSARY_ADDITIONS,
  runCornerDemo,
  WORKED_LABEL,
} from '../../src/tools/corner/guide';
import { createSolverRunner } from '../../src/tools/corner/solverClient';
import { voiceViolations } from '../../src/guidance/voice';
import { GLOSSARY } from '../../src/guidance/glossary';
import { stepsForLevel } from '../../src/guidance/tour';

describe('CORNER_GUIDE spec', () => {
  it('has stable unique step ids and anchors', () => {
    const ids = CORNER_GUIDE.steps.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(CORNER_GUIDE.toolId).toBe('corner');
    expect(CORNER_GUIDE.steps.length).toBeGreaterThanOrEqual(5);
  });

  it('critical steps survive fading: camera distance + marking precision (§7B.3)', () => {
    const reduced = stepsForLevel([...CORNER_GUIDE.steps], 'reduced').map((s) => s.id);
    expect(reduced).toContain('frame'); // camera distance
    expect(reduced).toContain('mark-corner'); // marking precision
    expect(reduced).toContain('mark-edge2');
    expect(stepsForLevel([...CORNER_GUIDE.steps], 'silent')).toEqual([]);
  });

  it('advances on real events, never a Next button', () => {
    for (const s of CORNER_GUIDE.steps) {
      if (s.advanceOn !== 'tap') {
        expect(typeof s.advanceOn).toBe('object');
      }
    }
    const eventSteps = CORNER_GUIDE.steps.filter((s) => s.advanceOn !== 'tap');
    expect(eventSteps.length).toBeGreaterThanOrEqual(5);
  });

  it('every step obeys the mechanical voice rules (§7B.10)', () => {
    for (const s of CORNER_GUIDE.steps) expect(voiceViolations(s.text)).toEqual([]);
  });
});

describe('CORNER_DEMOS (ADR-012 worked examples)', () => {
  it('lists the refusal demo first — limits teach first (§15.7)', () => {
    expect(CORNER_DEMOS[0]!.kind).toBe('refusal');
    expect(CORNER_DEMOS.some((d) => d.kind === 'solve')).toBe(true);
  });

  it('narration passes the voice lint', () => {
    for (const d of CORNER_DEMOS) {
      for (const line of d.narration) expect(voiceViolations(line)).toEqual([]);
    }
  });

  it('the solve demo runs the REAL solver and lands on the built truth', async () => {
    const runner = createSolverRunner();
    const labels: string[] = [];
    const lines: string[] = [];
    let outcome: Awaited<Parameters<Parameters<typeof runCornerDemo>[1]['onResult']>[0]> | null = null;
    const spec = CORNER_DEMOS.find((d) => d.kind === 'solve')!;
    await runCornerDemo(spec, {
      runner,
      onSyntheticLabel: (t) => labels.push(t),
      onNarration: (l) => lines.push(l),
      onResult: (o) => {
        outcome = o;
      },
    });
    runner.dispose();
    expect(labels).toEqual([WORKED_LABEL]); // labeled BEFORE any result shows
    expect(lines).toEqual([...spec.narration]);
    expect(outcome).not.toBeNull();
    const o = outcome!;
    if (o.kind !== 'solve') throw new Error('expected a solve outcome');
    expect(o.truthDeg).toBeCloseTo(88.6, 6);
    expect(o.point.ok).toBe(true);
    expect(o.mc.ok).toBe(true);
    if (o.mc.ok) {
      expect(Math.abs(o.mc.medianDeg - o.truthDeg)).toBeLessThanOrEqual(o.mc.halfWidthDeg + 0.3);
    }
  });

  it('the refusal demo gets a real POOR_GEOMETRY refusal, not a number', async () => {
    const runner = createSolverRunner();
    let outcome: Awaited<Parameters<Parameters<typeof runCornerDemo>[1]['onResult']>[0]> | null = null;
    const labels: string[] = [];
    await runCornerDemo(CORNER_DEMOS[0]!, {
      runner,
      onSyntheticLabel: (t) => labels.push(t),
      onNarration: () => undefined,
      onResult: (o) => {
        outcome = o;
      },
    });
    runner.dispose();
    expect(labels).toEqual([WORKED_LABEL]);
    const o = outcome!;
    if (o.kind !== 'refusal') throw new Error('expected a refusal outcome');
    expect(o.result.ok).toBe(false);
    if (!o.result.ok) expect(o.result.reason).toBe('POOR_GEOMETRY');
  });
});

describe('DEMOS — DemoSpec-shaped registry for the lead to merge', () => {
  it('mirrors CORNER_DEMOS one-to-one with ordered narration times', () => {
    expect(DEMOS.map((d) => d.fixtureId)).toEqual(CORNER_DEMOS.map((d) => d.id));
    for (const d of DEMOS) {
      expect(d.toolId).toBe('corner');
      for (let i = 1; i < d.narration.length; i++) {
        expect(d.narration[i]!.atT).toBeGreaterThan(d.narration[i - 1]!.atT);
      }
    }
  });
});

describe('GLOSSARY_ADDITIONS (merged by the lead, §7B.8)', () => {
  it('entries are complete and do not collide with the existing glossary', () => {
    for (const [slug, entry] of Object.entries(GLOSSARY_ADDITIONS)) {
      expect(GLOSSARY[slug]).toBeUndefined();
      expect(entry.term.length).toBeGreaterThan(0);
      expect(entry.def.length).toBeGreaterThan(0);
      expect(entry.whyItMatters.length).toBeGreaterThan(0);
      expect(voiceViolations(`${entry.def} ${entry.whyItMatters}`)).toEqual([]);
    }
    expect(Object.keys(GLOSSARY_ADDITIONS)).toContain('rack');
    // 'loupe' ships in the base glossary already — additions must not shadow it.
    expect(GLOSSARY['loupe']).toBeDefined();
  });
});
