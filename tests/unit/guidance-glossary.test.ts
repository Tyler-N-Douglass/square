/**
 * Glossary — SPEC §7B.8.
 * The listed terms are all present, no entry is empty, defs stay short,
 * and the voice rules hold everywhere.
 */
import { describe, expect, it } from 'vitest';
import { GLOSSARY, REQUIRED_TERM_SLUGS, defineTerm, findTerm, termRegex } from '../../src/guidance/glossary';
import { voiceViolations } from '../../src/guidance/voice';

/** The §7B.8 list verbatim — hardcoded here so glossary.ts cannot quietly shrink it. */
const SPEC_7B8_TERMS = [
  'on-center', 'plumb', 'spring-angle', 'miter', 'bevel', 'kerf', 'witness-mark',
  'king-stud', 'header', 'standoff', 'hard-iron', 'soft-iron', 'snr',
  'prominence', 'vanishing-point', 'dihedral',
];

describe('the §7B.8 list is complete', () => {
  it('REQUIRED_TERM_SLUGS matches the spec list', () => {
    expect([...REQUIRED_TERM_SLUGS].sort()).toEqual([...SPEC_7B8_TERMS].sort());
  });

  for (const slug of SPEC_7B8_TERMS) {
    it(`defines "${slug}"`, () => {
      expect(GLOSSARY[slug], `missing §7B.8 term: ${slug}`).toBeDefined();
    });
  }
});

describe('every entry is complete, short, and in voice', () => {
  for (const [slug, entry] of Object.entries(GLOSSARY)) {
    it(`${slug}`, () => {
      expect(entry.term.trim().length, 'term').toBeGreaterThan(0);
      expect(entry.def.trim().length, 'def').toBeGreaterThan(0);
      expect(entry.whyItMatters.trim().length, 'whyItMatters').toBeGreaterThan(0);
      // One short sentence: single terminal period, bounded length.
      expect(entry.def.trim().endsWith('.'), `def should end with a period: "${entry.def}"`).toBe(true);
      expect((entry.def.match(/\./g) ?? []).length, `def should be one sentence: "${entry.def}"`).toBe(1);
      expect(entry.def.length, 'def stays short').toBeLessThan(220);
      expect(entry.whyItMatters.length, 'whyItMatters is one line').toBeLessThan(220);
      for (const text of [entry.def, entry.whyItMatters]) {
        expect(voiceViolations(text), `voice rules (§7B.10): "${text}"`).toEqual([]);
      }
    });
  }
});

describe('defineTerm', () => {
  it('returns the entry for a known slug', () => {
    expect(defineTerm('plumb')?.term).toBe('plumb');
    expect(defineTerm('snr')?.term).toBe('SNR');
  });

  it('returns null for an unknown slug', () => {
    expect(defineTerm('warp-core')).toBeNull();
  });
});

describe('prose matching', () => {
  it('matches hyphenated and plural surface forms back to their entry', () => {
    expect(findTerm('on-center')?.slug).toBe('on-center');
    expect(findTerm('On Center')?.slug).toBe('on-center');
    expect(findTerm('toggle bolts')?.slug).toBe('toggle-bolt');
    expect(findTerm('detrended')?.slug).toBe('detrend');
    expect(findTerm('nonsense phrase')).toBeNull();
  });

  it('termRegex finds terms in running prose', () => {
    const text = 'Studs land at 16″ on-center; check the noise floor and the zero crossing.';
    const found = [...text.matchAll(termRegex())].map((m) => m[0]);
    expect(found).toContain('on-center');
    expect(found).toContain('noise floor');
    expect(found).toContain('zero crossing');
  });
});
