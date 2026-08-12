/**
 * CALIBRATE guides + DEMO (SPEC §4.6, §7B, ADR-012): the guided run IS the
 * routines — four GuideSpecs advancing on real events; the DEMO drives the
 * REAL ellipsoid fit with a labeled deterministic synthetic stream, failure
 * (MagSafe) listed first; copy passes the voice lint.
 */
import { describe, expect, it } from 'vitest';
import {
  CALIBRATE_DEMOS,
  CALIBRATE_GUIDES,
  CALIBRATE_SYNTH_LABEL,
  DEMOS,
  GLOSSARY_ADDITIONS,
  runCalibrateDemo,
  type CalibrateDemoOutcome,
} from '../../src/tools/calibrate/guide';
import { HARD_IRON_ACCESSORY_UT } from '../../src/dsp/calibration';
import { WARNING_COPY } from '../../src/ui/components/warning';
import { voiceViolations } from '../../src/guidance/voice';
import { GLOSSARY } from '../../src/guidance/glossary';
import { stepsForLevel } from '../../src/guidance/tour';

describe('the guided run IS the routines (§4.6 + §7B.3)', () => {
  it('ships one GuideSpec per routine, advancing on real routine events', () => {
    const ids = new Set<string>();
    for (const [routine, spec] of Object.entries(CALIBRATE_GUIDES)) {
      expect(spec.toolId).toBe('calibrate');
      expect(spec.steps.length).toBeGreaterThanOrEqual(3);
      for (const s of spec.steps) {
        expect(ids.has(s.id), `duplicate step id ${s.id} (${routine})`).toBe(false);
        ids.add(s.id);
        // Every step advances on a real event — never a Next button.
        expect(s.advanceOn === 'tap' || typeof s.advanceOn === 'object').toBe(true);
      }
      const eventSteps = spec.steps.filter((s) => typeof s.advanceOn === 'object');
      expect(eventSteps.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('critical steps survive fading — the places people actually go wrong', () => {
    for (const spec of Object.values(CALIBRATE_GUIDES)) {
      expect(stepsForLevel([...spec.steps], 'reduced').length).toBeGreaterThan(0);
    }
    expect(stepsForLevel([...CALIBRATE_GUIDES.mag.steps], 'reduced').map((s) => s.id)).toContain(
      'mag-case-off',
    );
  });

  it('every step passes the mechanical voice lint (§7B.10)', () => {
    for (const spec of Object.values(CALIBRATE_GUIDES)) {
      for (const s of spec.steps) expect(voiceViolations(s.text), s.id).toEqual([]);
    }
  });
});

describe('CALIBRATE DEMO — synthetic stream through the REAL fit (ADR-012)', () => {
  it('lists the MagSafe failure first — limits before capability (§15.7)', () => {
    expect(CALIBRATE_DEMOS[0]!.kind).toBe('magsafe-fail');
    for (const d of CALIBRATE_DEMOS) {
      for (const line of d.narration) expect(voiceViolations(line)).toEqual([]);
    }
  });

  it('clean pass: labels SYNTHETIC first, fills octants, recovers the built truth', () => {
    const labels: string[] = [];
    const progress: number[] = [];
    let outcome: CalibrateDemoOutcome | null = null;
    const spec = CALIBRATE_DEMOS.find((d) => d.kind === 'clean-pass')!;
    runCalibrateDemo(spec, {
      onSyntheticLabel: (t) => labels.push(t),
      onNarration: () => undefined,
      onProgress: (filled) => progress.push(filled),
      onResult: (o) => {
        outcome = o;
      },
    });
    expect(labels).toEqual([CALIBRATE_SYNTH_LABEL]);
    expect(progress.length).toBe(8);
    expect(progress[progress.length - 1]).toBe(8); // all octants filled by the end
    for (let i = 1; i < progress.length; i++) expect(progress[i]!).toBeGreaterThanOrEqual(progress[i - 1]!);
    const o = outcome!;
    expect(o.fit.ok).toBe(true);
    expect(o.evaluation.pass).toBe(true);
    const truthMag = Math.hypot(...o.truthHardIron);
    expect(Math.abs(o.evaluation.hardIronUt - truthMag)).toBeLessThan(1);
  });

  it('MagSafe demo FAILS through the real gate with the verbatim message', () => {
    let outcome: CalibrateDemoOutcome | null = null;
    runCalibrateDemo(CALIBRATE_DEMOS[0]!, {
      onSyntheticLabel: () => undefined,
      onNarration: () => undefined,
      onResult: (o) => {
        outcome = o;
      },
    });
    const o = outcome!;
    expect(o.evaluation.pass).toBe(false);
    expect(o.evaluation.accessory).toBe(true);
    expect(o.evaluation.hardIronUt).toBeGreaterThan(HARD_IRON_ACCESSORY_UT);
    expect(o.evaluation.reasons).toContain(WARNING_COPY.MAGNETIC_ACCESSORY);
  });

  it('is deterministic — same spec, identical outcome', () => {
    const run = (): CalibrateDemoOutcome =>
      runCalibrateDemo(CALIBRATE_DEMOS[1]!, {
        onSyntheticLabel: () => undefined,
        onNarration: () => undefined,
        onResult: () => undefined,
      });
    expect(run()).toEqual(run());
  });
});

describe('DEMOS — DemoSpec-shaped registry for the lead to merge', () => {
  it('mirrors CALIBRATE_DEMOS one-to-one, failure first', () => {
    expect(DEMOS.map((d) => d.fixtureId)).toEqual(CALIBRATE_DEMOS.map((d) => d.id));
    expect(DEMOS[0]!.fixtureId).toBe('calibrate-magsafe-fail');
    for (const d of DEMOS) expect(d.toolId).toBe('calibrate');
  });
});

describe('GLOSSARY_ADDITIONS (merged by the lead, §7B.8)', () => {
  it('entries are complete, voice-clean, and collision-free', () => {
    for (const [slug, entry] of Object.entries(GLOSSARY_ADDITIONS)) {
      expect(GLOSSARY[slug], slug).toBeUndefined();
      expect(entry.term.length).toBeGreaterThan(0);
      expect(entry.def.length).toBeGreaterThan(0);
      expect(entry.whyItMatters.length).toBeGreaterThan(0);
      expect(voiceViolations(`${entry.def} ${entry.whyItMatters}`)).toEqual([]);
    }
    expect(Object.keys(GLOSSARY_ADDITIONS)).toContain('octant');
  });
});
