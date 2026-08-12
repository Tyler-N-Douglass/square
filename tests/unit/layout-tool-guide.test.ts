/**
 * LAYOUT guide + worked-example DEMO — SPEC §7B, ADR-012 (A4, Phase 2).
 * The demo narration is asserted against an INDEPENDENT run of the same
 * solver — if the copy and the math ever disagree, this suite goes red.
 */
import { describe, expect, it } from 'vitest';
import {
  GLOSSARY_ADDITIONS,
  LAYOUT_DEMOS,
  LAYOUT_GUIDE,
  WORKED_EXAMPLE_LABEL,
  buildGalleryDemo,
  buildRefusalDemo,
} from '../../src/tools/layout/guide';
import { layoutTableRows } from '../../src/tools/layout/solver';
import { equalGaps } from '../../src/geometry/layout';
import { formatInches, rational } from '../../src/geometry/units';
import { voiceViolations } from '../../src/guidance/voice';

describe('LAYOUT guide spec', () => {
  it('walks span → count → mode → read-the-table', () => {
    const ids = LAYOUT_GUIDE.steps.map((s) => s.id);
    expect(ids.indexOf('span')).toBeLessThan(ids.indexOf('count'));
    expect(ids.indexOf('count')).toBeLessThan(ids.indexOf('mode'));
    expect(ids.indexOf('mode')).toBeLessThan(ids.indexOf('read-table'));
  });

  it('tap-advance everywhere — a form tool, not a sensor flow', () => {
    for (const step of LAYOUT_GUIDE.steps) {
      expect(step.advanceOn, step.id).toBe('tap');
    }
  });

  it('the chaining-warning step is critical — it survives fading to reduced', () => {
    const noChain = LAYOUT_GUIDE.steps.find((s) => s.id === 'no-chain');
    expect(noChain?.critical).toBe(true);
  });

  it('keeps the §7B.10 voice in every step', () => {
    for (const step of LAYOUT_GUIDE.steps) {
      expect(voiceViolations(step.text), step.id).toEqual([]);
    }
  });
});

describe('gallery-wall DEMO — numbers from the real solver', () => {
  it('narration carries the solver-computed gap and centers', () => {
    const demo = buildGalleryDemo();
    expect(demo.label).toBe(WORKED_EXAMPLE_LABEL);

    // Independent recompute: five 18″ frames on 120″, equal gaps.
    const check = equalGaps(rational(120), 5, rational(18));
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    const gapText = formatInches(check.gap, 16).text;
    expect(gapText).toBe('5″');
    const all = demo.steps.map((s) => s.text).join('\n');
    expect(all).toContain(gapText);
    for (const row of layoutTableRows(check.marks, 16)) {
      expect(all).toContain(row.cumulative.text);
    }
    expect(all).toContain("Measure all marks from the same end. Don't chain.");
    expect(all).toContain('57″');
  });

  it('keeps the voice', () => {
    for (const step of buildGalleryDemo().steps) {
      expect(voiceViolations(step.text)).toEqual([]);
    }
  });
});

describe('refusal DEMO — quotes the real refusal', () => {
  it('contains the solver reason verbatim, with the shortfall', () => {
    const demo = buildRefusalDemo();
    const check = equalGaps(rational(120), 6, rational(24));
    expect(check.ok).toBe(false);
    if (check.ok) return;
    const all = demo.steps.map((s) => s.text).join('\n');
    expect(all).toContain(check.reason);
    expect(check.reason).toContain('short');
  });
});

describe('demo registry + glossary additions', () => {
  it('both demos ship, labeled worked-example', () => {
    expect(Object.keys(LAYOUT_DEMOS).sort()).toEqual(['layout-doesnt-fit', 'layout-gallery-wall']);
    for (const spec of Object.values(LAYOUT_DEMOS)) {
      expect(spec.label).toBe(WORKED_EXAMPLE_LABEL);
      expect(spec.steps.length).toBeGreaterThan(2);
    }
  });

  it('GLOSSARY_ADDITIONS entries are complete, short, and in voice', () => {
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
