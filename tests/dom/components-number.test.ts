// @vitest-environment happy-dom
/**
 * The honesty display layer (SPEC §5, §15.1, §15.5): every rendered number
 * carries its unit and either a ± or a confidence badge; measured wears
 * orange (.measured) and derived/entered never do; there is no exported way
 * to render a bare number.
 */
import { describe, expect, it } from 'vitest';
import * as numbers from '../../src/ui/components/number';
import { derivedEl, enteredEl, measuredEl } from '../../src/ui/components/number';
import type { Measurement } from '../../src/types';

function meas(over: Partial<Measurement> = {}): Measurement {
  return {
    id: 'm1',
    kind: 'level',
    value: 1.2,
    unit: '°',
    uncertainty: { plusMinus: 0.5, basis: 'nominal' },
    confidence: 'LIKELY',
    provenance: { tier: 'NONE', calibrations: {}, sampleCount: 60, capturedAt: 0 },
    ...over,
  };
}

const frame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

describe('measuredEl', () => {
  it('renders value, unit, and ± together — never a bare number', () => {
    const el = measuredEl(meas());
    expect(el.textContent).toContain('1.2°');
    expect(el.textContent).toContain('±0.50°');
    expect(el.querySelector('.num__unit')?.textContent).toBe('°');
  });

  it('wears the .measured (orange) class on the reading', () => {
    const el = measuredEl(meas());
    expect(el.querySelector('.measured')).toBeTruthy();
  });

  it('falls back to the confidence badge when the ± basis is unknown', () => {
    const el = measuredEl(meas({ uncertainty: { plusMinus: NaN, basis: 'unknown' } }));
    expect(el.querySelector('.num__pm')).toBeNull();
    const badge = el.querySelector('.conf');
    expect(badge).toBeTruthy();
    expect(badge?.textContent).toBe('LIKELY');
  });

  it('always shows the badge for UNRELIABLE and NOISE, even with a ±', () => {
    for (const confidence of ['UNRELIABLE', 'NOISE'] as const) {
      const el = measuredEl(meas({ confidence }));
      expect(el.querySelector('.num__pm')).toBeTruthy();
      expect(el.querySelector(`.conf--${confidence.toLowerCase()}`)).toBeTruthy();
    }
  });

  it('hides the badge by default when a trustworthy ± exists', () => {
    const el = measuredEl(meas({ confidence: 'STRONG' }));
    expect(el.querySelector('.num__pm')).toBeTruthy();
    expect(el.querySelector('.conf')).toBeNull();
  });

  it('shows badge and ± together with showConfidence: "always"', () => {
    const el = measuredEl(meas({ confidence: 'STRONG' }), { showConfidence: 'always' });
    expect(el.querySelector('.num__pm')).toBeTruthy();
    expect(el.querySelector('.conf--strong')).toBeTruthy();
  });

  it('formats signed anomaly readouts with a spaced word unit', () => {
    const el = measuredEl(meas({ value: 3.42, unit: 'µT', uncertainty: { plusMinus: 0.22, basis: 'stddev' } }), {
      decimals: 2,
      signed: true,
    });
    expect(el.textContent).toContain('+3.42 µT');
    expect(el.textContent).toContain('±0.22 µT');
  });

  it('update() is rAF-coalesced into the same nodes — latest value wins', async () => {
    const el = measuredEl(meas());
    const valueNode = el.querySelector('.num__value');
    el.update(meas({ value: 2.0 }));
    el.update(meas({ value: 3.3 }));
    expect(el.textContent).toContain('1.2°'); // nothing painted before the frame
    await frame();
    expect(el.textContent).toContain('3.3°');
    expect(el.textContent).not.toContain('2.0');
    expect(el.querySelector('.num__value')).toBe(valueNode); // no node churn
  });

  it('update() can move between ± and badge as the basis changes', async () => {
    const el = measuredEl(meas());
    el.update(meas({ uncertainty: { plusMinus: NaN, basis: 'unknown' }, confidence: 'POSSIBLE' }));
    await frame();
    expect(el.querySelector('.num__pm')).toBeNull();
    expect(el.querySelector('.conf--possible')).toBeTruthy();
  });

  it('makes the ± tappable when an explainer is provided (SPEC §7B.6)', () => {
    let opened = 0;
    const el = measuredEl(meas(), { onExplainUncertainty: () => opened++ });
    const pm = el.querySelector('button.num__pm');
    expect(pm).toBeTruthy();
    (pm as HTMLButtonElement).click();
    expect(opened).toBe(1);
    expect(pm?.getAttribute('aria-label')).toContain('tap to see where the uncertainty comes from');
  });

  it('does not announce every tick (aria-live off on the reading)', () => {
    const el = measuredEl(meas());
    expect(el.querySelector('.num__reading')?.getAttribute('aria-live')).toBe('off');
  });

  it('exposes the uncertainty basis for explainer cards', () => {
    const el = measuredEl(meas({ uncertainty: { plusMinus: 0.6, basis: 'montecarlo' } }));
    expect(el.querySelector('.num__pm')?.getAttribute('data-basis')).toBe('montecarlo');
  });

  it('throws on a missing unit — a bare number has no render path', () => {
    expect(() => measuredEl(meas({ unit: '' }))).toThrow();
    expect(() => measuredEl(meas({ unit: '  ' }))).toThrow();
    const el = measuredEl(meas());
    expect(() => el.update(meas({ unit: '' }))).toThrow();
  });
});

describe('derivedEl', () => {
  it('renders value, unit, and propagated ± — never orange', () => {
    const el = derivedEl(88.4, '°', 0.6, 'montecarlo');
    expect(el.textContent).toContain('88.4°');
    expect(el.textContent).toContain('±0.60°');
    expect(el.querySelector('.derived')).toBeTruthy();
    expect(el.querySelector('.measured')).toBeNull();
  });

  it('throws without a finite ± — derived values carry propagation', () => {
    expect(() => derivedEl(88.4, '°', NaN, 'montecarlo')).toThrow();
    expect(() => derivedEl(88.4, '°', Infinity, 'montecarlo')).toThrow();
  });

  it('throws on a missing unit', () => {
    expect(() => derivedEl(88.4, '', 0.6, 'montecarlo')).toThrow();
  });
});

describe('enteredEl', () => {
  it('renders value and unit in the entered (dotted, never orange) style', () => {
    const el = enteredEl('3-7/16', 'in');
    expect(el.textContent).toContain('3-7/16 in');
    expect(el.querySelector('.entered')).toBeTruthy();
    expect(el.querySelector('.measured')).toBeNull();
    expect(el.querySelector('.conf')).toBeNull();
  });

  it('accepts numbers and throws on a missing unit', () => {
    expect(enteredEl(96, 'in').textContent).toContain('96 in');
    expect(() => enteredEl(96, '')).toThrow();
  });
});

describe('module surface', () => {
  it('exports exactly the three provenance factories — no bare-number path', () => {
    const fns = Object.entries(numbers)
      .filter(([, v]) => typeof v === 'function')
      .map(([k]) => k)
      .sort();
    expect(fns).toEqual(['derivedEl', 'enteredEl', 'measuredEl']);
  });
});
