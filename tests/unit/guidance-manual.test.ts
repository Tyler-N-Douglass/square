// @vitest-environment happy-dom
/**
 * Field Manual — SPEC §7B.7.
 * Task-organized, the can't-do entry first, every entry ends with a
 * verification step, voice rules hold, search works, and the rendered view
 * wraps glossary terms as tappable .term spans (never orange — dotted gray).
 */
import { describe, expect, it } from 'vitest';
import type { AppContext } from '../../src/app/router';
import { GLOSSARY } from '../../src/guidance/glossary';
import { MANUAL_ENTRIES, mount, searchManual, wrapTerms } from '../../src/guidance/manual';
import { voiceViolations } from '../../src/guidance/voice';

const KNOWN_ROUTES = ['home', 'scan', 'level', 'corner', 'layout', 'bevel', 'calibrate', 'log', 'manual'];

const REQUIRED_TITLES = [
  'What this app can’t do',
  'Hang a heavy mirror',
  'Find a stud with no power tools',
  'Why won’t my trim fit this corner?',
  'Space five frames evenly',
  'Cut crown for a corner that isn’t 90°',
  'Check a shelf is level before drilling',
];

describe('the entry set (§7B.7)', () => {
  it('ships every required task', () => {
    const titles = MANUAL_ENTRIES.map((e) => e.title);
    for (const t of REQUIRED_TITLES) {
      expect(titles, `missing manual entry: ${t}`).toContain(t);
    }
  });

  it('"What this app can’t do" comes first (§15.7 — teach the limits first)', () => {
    expect(MANUAL_ENTRIES[0]?.title).toBe('What this app can’t do');
  });

  it('slugs are unique', () => {
    const slugs = MANUAL_ENTRIES.map((e) => e.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe('every entry is complete and honest', () => {
  for (const entry of MANUAL_ENTRIES) {
    it(`${entry.slug}: goal, steps, and a mandatory verification step`, () => {
      expect(entry.title.trim().length).toBeGreaterThan(0);
      expect(entry.goal.trim().length).toBeGreaterThan(0);
      expect(entry.steps.length).toBeGreaterThan(0);
      for (const s of entry.steps) expect(s.trim().length).toBeGreaterThan(0);
      // §7B.7: every entry ends with a verification step. Non-negotiable.
      expect(entry.verify.trim().length, `${entry.slug} has no verify step`).toBeGreaterThan(0);
    });

    it(`${entry.slug}: tools and openTool reference real routes`, () => {
      for (const t of entry.tools) expect(KNOWN_ROUTES).toContain(t);
      if (entry.openTool) expect(KNOWN_ROUTES).toContain(entry.openTool.route);
    });

    it(`${entry.slug}: voice rules hold everywhere (§7B.10)`, () => {
      const texts = [entry.title, entry.goal, ...entry.steps, ...entry.failureModes, entry.verify];
      for (const text of texts) {
        expect(voiceViolations(text), `voice violation in ${entry.slug}: "${text}"`).toEqual([]);
      }
    });
  }

  it('task entries carry real numbers, not vibes', () => {
    const numbered = MANUAL_ENTRIES.filter((e) => e.slug !== 'cant-do');
    for (const entry of numbered) {
      const all = [...entry.steps, entry.verify].join(' ');
      expect(/\d/.test(all), `${entry.slug} steps should contain real numbers`).toBe(true);
    }
  });
});

describe('searchManual', () => {
  it('empty query returns everything in order', () => {
    expect(searchManual('').map((e) => e.slug)).toEqual(MANUAL_ENTRIES.map((e) => e.slug));
  });

  it('substring match is case-insensitive and spans steps and failure modes', () => {
    expect(searchManual('MIRROR').map((e) => e.slug)).toContain('hang-heavy-mirror');
    expect(searchManual('spring angle').map((e) => e.slug)).toContain('crown-not-90');
    expect(searchManual('toggle').map((e) => e.slug)).toContain('hang-heavy-mirror');
    expect(searchManual('flux capacitor')).toEqual([]);
  });
});

describe('rendering', () => {
  const ctx = { capability: null, replayTrace: null } as unknown as AppContext;

  it('mounts a searchable list with the can’t-do entry first, and unmounts clean', () => {
    const el = document.createElement('div');
    const unmount = mount(el, ctx);
    const items = [...el.querySelectorAll<HTMLElement>('.manual__item')];
    expect(items.length).toBe(MANUAL_ENTRIES.length);
    expect(items[0]?.dataset['slug']).toBe('cant-do');

    const search = el.querySelector<HTMLInputElement>('.manual__search');
    expect(search).not.toBeNull();
    search!.value = 'mirror';
    search!.dispatchEvent(new Event('input'));
    const filtered = [...el.querySelectorAll<HTMLElement>('.manual__item')];
    expect(filtered.map((i) => i.dataset['slug'])).toContain('hang-heavy-mirror');
    expect(filtered.length).toBeLessThan(MANUAL_ENTRIES.length);

    unmount();
    expect(el.querySelector('.manual')).toBeNull();
  });

  it('entry view shows steps, the verify block, and an open-tool link', () => {
    const el = document.createElement('div');
    const unmount = mount(el, ctx);
    const mirror = [...el.querySelectorAll<HTMLElement>('.manual__item')].find(
      (i) => i.dataset['slug'] === 'hang-heavy-mirror',
    );
    mirror!.click();
    expect(el.querySelectorAll('ol.prose li').length).toBeGreaterThan(3);
    expect(el.querySelector('.manual__verify')?.textContent).toMatch(/pull down/i);
    expect(el.querySelector<HTMLAnchorElement>('.manual__open')?.getAttribute('href')).toBe('#/scan');
    unmount();
  });

  it('wrapTerms marks glossary terms as tappable .term spans and skips tool names', () => {
    const taps: string[] = [];
    const frag = wrapTerms(
      'Sweep past the stud bay and watch the zero crossing. Capture with BEVEL against the flats.',
      (slug) => taps.push(slug),
    );
    const host = document.createElement('div');
    host.append(frag);
    const spans = [...host.querySelectorAll<HTMLElement>('.term')];
    const slugs = spans.map((s) => s.dataset['slug']);
    expect(slugs).toContain('stud-bay');
    expect(slugs).toContain('zero-crossing');
    expect(slugs).not.toContain('bevel'); // all-caps BEVEL is the tool, not the term
    // the plain text is preserved around the spans
    expect(host.textContent).toBe(
      'Sweep past the stud bay and watch the zero crossing. Capture with BEVEL against the flats.',
    );
    spans[0]!.click();
    expect(taps).toEqual(['stud-bay']);
  });

  it('tapping a term fills the definition panel from the glossary', () => {
    const el = document.createElement('div');
    const unmount = mount(el, ctx);
    const item = [...el.querySelectorAll<HTMLElement>('.manual__item')].find(
      (i) => i.dataset['slug'] === 'find-stud-no-power-tools',
    );
    item!.click();
    const term = el.querySelector<HTMLElement>('.term[data-slug="on-center"]');
    expect(term).not.toBeNull();
    term!.click();
    const def = el.querySelector('.manual__def');
    expect(def?.textContent).toContain(GLOSSARY['on-center']!.def);
    unmount();
  });
});
