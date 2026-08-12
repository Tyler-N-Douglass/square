/**
 * LOG's guided run (SPEC §7B, §12): a review surface — every step
 * tap-advances (the tooltip flow, never a Next button), copy obeys the voice
 * rules, ids are stable keys for dismissal memory, and the glossary
 * additions are well-formed for the lead to merge (parallel-work amendment:
 * A8 does not edit A13's files).
 */
import { describe, expect, it } from 'vitest';
import { GLOSSARY_ADDITIONS, LOG_GUIDE } from '../../src/tools/log/guide';
import { GLOSSARY } from '../../src/guidance/glossary';
import { runGuide, stepsForLevel, type GuideDeps, type GuideStep } from '../../src/guidance/tour';
import { voiceViolations } from '../../src/guidance/voice';

describe('LOG_GUIDE shape', () => {
  it('targets the log tool with unique, stable step ids', () => {
    expect(LOG_GUIDE.toolId).toBe('log');
    const ids = LOG_GUIDE.steps.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('provenance');
    expect(ids).toContain('export');
    expect(ids).toContain('local-only');
  });

  it('is all tap-advance — a review surface waits on no sensor', () => {
    for (const step of LOG_GUIDE.steps) expect(step.advanceOn).toBe('tap');
  });

  it('flags the steps where people actually go wrong as critical (reduced-level survivors)', () => {
    const reduced = stepsForLevel(LOG_GUIDE.steps as GuideStep[], 'reduced').map((s) => s.id);
    expect(reduced).toEqual(['provenance', 'export']);
  });

  it('anchors every step to a control selector', () => {
    for (const step of LOG_GUIDE.steps) {
      expect(step.anchor, step.id).toMatch(/^\.log/);
    }
  });

  it('copy passes the voice lint and stays coach-mark short (§7B.5, §7B.10)', () => {
    for (const step of LOG_GUIDE.steps) {
      expect(voiceViolations(step.text), step.id).toEqual([]);
      expect(step.text.length, `${step.id} must fit two lines`).toBeLessThanOrEqual(90);
    }
  });

  it('states the local-only promise verbatim in the guide', () => {
    const local = LOG_GUIDE.steps.find((s) => s.id === 'local-only')!;
    expect(local.text).toBe('No cloud. Ever. Export is the only way data leaves this phone.');
  });

  it('walks every step to completion through the tour engine', () => {
    const shown: string[] = [];
    let outcome = '';
    const deps: GuideDeps = {
      render: (step, onDismiss) => {
        shown.push(step.id);
        queueMicrotask(onDismiss); // the user taps each mark
        return () => undefined;
      },
      sensorHook: () => () => undefined,
    };
    runGuide(LOG_GUIDE, deps, { onEnd: (o) => (outcome = o) });
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(shown).toEqual(LOG_GUIDE.steps.map((s) => s.id));
        expect(outcome).toBe('completed');
        resolve();
      }, 0);
    });
  });
});

describe('GLOSSARY_ADDITIONS for the lead to merge', () => {
  it('adds provenance and job sheet, well-formed and voice-clean', () => {
    expect(Object.keys(GLOSSARY_ADDITIONS).sort()).toEqual(['job-sheet', 'provenance']);
    for (const [slug, entry] of Object.entries(GLOSSARY_ADDITIONS)) {
      expect(entry.term.length, slug).toBeGreaterThan(0);
      expect(entry.def.length, slug).toBeGreaterThan(10);
      expect(entry.whyItMatters.length, slug).toBeGreaterThan(10);
      expect(voiceViolations(`${entry.def} ${entry.whyItMatters}`), slug).toEqual([]);
    }
  });

  it('is merged into the glossary verbatim (Gate 2) — present and unshadowed', () => {
    for (const [slug, entry] of Object.entries(GLOSSARY_ADDITIONS)) {
      expect(GLOSSARY[slug], slug).toEqual(entry);
    }
  });
});
