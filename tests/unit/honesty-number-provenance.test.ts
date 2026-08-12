// @vitest-environment happy-dom
/**
 * A11 HONESTY PIN — the number-provenance layer really is airtight
 * (SPEC §5, §15.1, §15.5; ADR-003 "a bare number has no render path").
 *
 * Pins, at the component seam every tool renders through:
 *  - a unit is mandatory: measuredEl/derivedEl/enteredEl all throw without one;
 *  - a derived value cannot render without a finite ±;
 *  - a measured value with an uncharacterized ± (basis 'unknown' / NaN) shows
 *    its confidence badge instead of a tidy fake ±;
 *  - UNRELIABLE and NOISE always show their badge, even alongside a ± —
 *    a tidy ± on an unreliable reading would overstate it;
 *  - recorded (saved) values do NOT wear the live-measured class — orange
 *    means "a sensor is producing this now" (§7.1, ADR-013.1);
 *  - entered values carry no ± — the user's number is not the app's claim.
 */
import { describe, expect, it } from 'vitest';
import { derivedEl, enteredEl, measuredEl, recordedEl } from '../../src/ui/components/number';
import type { Measurement } from '../../src/types';

function m(over: Partial<Measurement> = {}): Measurement {
  return {
    id: 't',
    kind: 'level',
    value: 1.2,
    unit: '°',
    uncertainty: { plusMinus: 0.5, basis: 'nominal' },
    confidence: 'LIKELY',
    provenance: { tier: 'NONE', calibrations: {}, sampleCount: 1, capturedAt: 0 },
    ...over,
  };
}

describe('a bare number has no render path (SPEC §15.1)', () => {
  it('measuredEl throws on a missing unit', () => {
    expect(() => measuredEl(m({ unit: '' }))).toThrow();
    expect(() => measuredEl(m({ unit: '   ' }))).toThrow();
  });

  it('derivedEl throws on a missing unit or a non-finite ±', () => {
    expect(() => derivedEl(1, '', 0.1, 'nominal')).toThrow();
    expect(() => derivedEl(1, '°', NaN, 'nominal')).toThrow();
    expect(() => derivedEl(1, '°', Infinity, 'nominal')).toThrow();
  });

  it('enteredEl throws on a missing unit', () => {
    expect(() => enteredEl(5, '')).toThrow();
  });

  it('update() re-enforces the unit on every tick', () => {
    const el = measuredEl(m());
    expect(() => el.update(m({ unit: '' }))).toThrow();
  });
});

describe('uncharacterized ± shows confidence, not a fake band', () => {
  it("basis 'unknown' renders the badge and no ± element", () => {
    const el = measuredEl(m({ uncertainty: { plusMinus: NaN, basis: 'unknown' } }));
    expect(el.querySelector('.num__pm')).toBeNull();
    expect(el.querySelector('.conf')?.textContent).toBe('LIKELY');
  });

  it('a finite ± with a known basis renders with the unit attached', () => {
    const el = measuredEl(m());
    expect(el.querySelector('.num__pm')?.textContent).toBe('±0.50°');
  });
});

describe('UNRELIABLE and NOISE always wear their badge (SPEC §15.1)', () => {
  it('UNRELIABLE badge shows even when a finite ± is present', () => {
    const el = measuredEl(m({ confidence: 'UNRELIABLE' }));
    expect(el.querySelector('.num__pm')).not.toBeNull();
    expect(el.querySelector('.conf--unreliable')?.textContent).toBe('UNRELIABLE');
  });

  it('NOISE badge shows even when a finite ± is present', () => {
    const el = measuredEl(m({ confidence: 'NOISE' }));
    expect(el.querySelector('.conf--noise')?.textContent).toBe('NOISE');
  });
});

describe('provenance styling (SPEC §5, §7.1, ADR-013.1)', () => {
  it('measured wears .measured; recorded strips it and wears the type color', () => {
    const live = measuredEl(m());
    expect(live.querySelector('.num__reading')?.classList.contains('measured')).toBe(true);

    const saved = recordedEl(m());
    const reading = saved.querySelector('.num__reading');
    expect(reading?.classList.contains('measured')).toBe(false);
    expect(reading?.classList.contains('derived')).toBe(true);
    expect(saved.classList.contains('num--recorded')).toBe(true);
  });

  it('recorded values keep the mandatory unit and ±/confidence', () => {
    const saved = recordedEl(m({ confidence: 'UNRELIABLE' }));
    expect(saved.querySelector('.num__pm')).not.toBeNull();
    expect(saved.querySelector('.conf--unreliable')).not.toBeNull();
  });

  it('entered values render the unit, never orange, and never a ±', () => {
    const el = enteredEl(96, '″');
    expect(el.querySelector('.num__reading')?.classList.contains('entered')).toBe(true);
    expect(el.querySelector('.num__reading')?.classList.contains('measured')).toBe(false);
    expect(el.querySelector('.num__pm')).toBeNull();
    expect(el.textContent).toContain('″');
  });
});
