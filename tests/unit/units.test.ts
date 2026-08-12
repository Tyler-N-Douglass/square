/**
 * Exact rational arithmetic + fraction I/O — SPEC §5, §10.1.
 * Round trips, exactness (not closeness) over 100 cumulative marks, and the
 * load-bearing typography: U+2032 PRIME for feet, U+2033 DOUBLE PRIME for
 * inches (the patched font glyphs exist for these exact characters).
 */
import { describe, expect, it } from 'vitest';
import {
  ZERO,
  add,
  cmp,
  div,
  eq,
  formatCm,
  formatFtIn,
  formatInches,
  formatMm,
  fromDecimalString,
  inchesFromMm,
  mmFromInches,
  mul,
  neg,
  parseLength,
  rational,
  sign,
  sub,
  toNumber,
} from '../../src/geometry/units';

const PRIME = '′';
const DOUBLE_PRIME = '″';

/** Deterministic PRNG so property tests are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('rational core', () => {
  it('normalizes: 2/4 = 1/2, sign lives on the numerator, den > 0', () => {
    expect(rational(2, 4)).toEqual({ num: 1n, den: 2n });
    expect(rational(1, -2)).toEqual({ num: -1n, den: 2n });
    expect(rational(-3, -6)).toEqual({ num: 1n, den: 2n });
    expect(rational(0, 7)).toEqual({ num: 0n, den: 1n });
  });

  it('refuses floats and zero denominators', () => {
    expect(() => rational(0.5)).toThrow(RangeError);
    expect(() => rational(1, 0)).toThrow(RangeError);
    expect(() => div(rational(1), ZERO)).toThrow(RangeError);
  });

  it('adds, subtracts, multiplies, divides exactly', () => {
    expect(eq(add(rational(1, 3), rational(1, 6)), rational(1, 2))).toBe(true);
    expect(eq(sub(rational(1, 2), rational(1, 3)), rational(1, 6))).toBe(true);
    expect(eq(mul(rational(3, 4), rational(2, 9)), rational(1, 6))).toBe(true);
    expect(eq(div(rational(1, 6), rational(1, 3)), rational(1, 2))).toBe(true);
  });

  it('compares and signs', () => {
    expect(cmp(rational(1, 3), rational(1, 2))).toBe(-1);
    expect(cmp(rational(2, 4), rational(1, 2))).toBe(0);
    expect(sign(neg(rational(5)))).toBe(-1);
    expect(sign(ZERO)).toBe(0);
  });

  it('parses decimal strings exactly: 40.5 → 81/2', () => {
    expect(eq(fromDecimalString('40.5'), rational(81, 2))).toBe(true);
    expect(eq(fromDecimalString('-0.125'), rational(-1, 8))).toBe(true);
    expect(eq(fromDecimalString('.25'), rational(1, 4))).toBe(true);
    expect(() => fromDecimalString('abc')).toThrow(RangeError);
  });
});

describe('parseLength — every form in SPEC §5', () => {
  const cases: Array<[string, bigint, bigint]> = [
    [`3' 4-7/16"`, 647n, 16n],
    ['3′ 4-7/16″', 647n, 16n], // typographic primes
    [`40.5"`, 81n, 2n],
    ['7/16', 7n, 16n],
    ['1-3/8', 11n, 8n],
    ['1 3/8', 11n, 8n],
    ['12', 12n, 1n],
    ['12in', 12n, 1n],
    [`3'`, 36n, 1n],
    [`3'4"`, 40n, 1n],
    ['1220mm', 6100n, 127n], // 1220 · 5/127 — exact
    ['2.5cm', 125n, 127n],   // 25 mm
    ['1.2m', 6000n, 127n],   // 1200 mm
    ['-3/4', -3n, 4n],
  ];

  for (const [input, num, den] of cases) {
    it(`parses ${JSON.stringify(input)} → ${num}/${den} inches exactly`, () => {
      const parsed = parseLength(input);
      expect(parsed).not.toBeNull();
      expect(eq(parsed!.inches, rational(num, den))).toBe(true);
    });
  }

  it('tags the unit family the user typed', () => {
    expect(parseLength(`3' 4"`)!.unit).toBe('ft-in');
    expect(parseLength('40.5"')!.unit).toBe('in');
    expect(parseLength('1220mm')!.unit).toBe('mm');
    expect(parseLength('2.5cm')!.unit).toBe('cm');
    expect(parseLength('1.2m')!.unit).toBe('m');
  });

  it('returns null on garbage instead of guessing', () => {
    for (const bad of ['', '  ', 'abc', '3//4', '4-7/0', '7/0', `"`, '1-3', '--5', '1.2.3']) {
      expect(parseLength(bad)).toBeNull();
    }
  });
});

describe('formatting — primes, precision, rounding direction', () => {
  it('formats feet–inches with U+2032 and U+2033, exact when exact', () => {
    const r = formatFtIn(rational(647, 16), 16);
    expect(r.text).toBe(`3${PRIME} 4-7/16${DOUBLE_PRIME}`);
    expect(r.rounding).toBe('exact');
  });

  it('shows whole feet with a zero inch part, and sub-foot values without feet', () => {
    expect(formatFtIn(rational(36), 16).text).toBe(`3${PRIME} 0${DOUBLE_PRIME}`);
    expect(formatFtIn(rational(7, 16), 16).text).toBe(`7/16${DOUBLE_PRIME}`);
    expect(formatFtIn(ZERO, 16).text).toBe(`0${DOUBLE_PRIME}`);
  });

  it('reduces displayed fractions: 8/16 shows as 1/2', () => {
    expect(formatInches(rational(1, 2), 16).text).toBe(`1/2${DOUBLE_PRIME}`);
    expect(formatInches(rational(81, 2), 8).text).toBe(`40-1/2${DOUBLE_PRIME}`);
  });

  it('reports rounding direction at each precision', () => {
    const third = rational(1, 3);
    const at16 = formatInches(third, 16); // nearest 16th below: 5/16
    expect(at16.text).toBe(`5/16${DOUBLE_PRIME}`);
    expect(at16.rounding).toBe('down');

    const at8 = formatInches(rational(3, 10), 8); // 0.3 → 5/16? no: nearest 8th is 2/8 = 0.25 vs 3/8: 0.3 → 0.3125 off... nearest is 5/16 at 16ths; at 8ths: 0.25 (down 0.05) vs 0.375 (up 0.075) → 1/4, down
    expect(at8.text).toBe(`1/4${DOUBLE_PRIME}`);
    expect(at8.rounding).toBe('down');

    const up = formatInches(rational(23, 100), 8); // 0.23 → 2/8 = 0.25, up
    expect(up.text).toBe(`1/4${DOUBLE_PRIME}`);
    expect(up.rounding).toBe('up');
  });

  it('breaks ties away from zero and says so', () => {
    const tie = formatInches(rational(1, 32), 16); // exactly between 0 and 1/16
    expect(tie.text).toBe(`1/16${DOUBLE_PRIME}`);
    expect(tie.rounding).toBe('up');

    const negTie = formatInches(rational(-1, 32), 16);
    expect(negTie.text).toBe(`-1/16${DOUBLE_PRIME}`);
    expect(negTie.rounding).toBe('down');
  });

  it('formats metric from exact inches', () => {
    expect(formatMm(rational(1, 2)).text).toBe('12.7 mm');
    expect(formatMm(rational(1, 2)).rounding).toBe('exact');
    expect(formatMm(inchesFromMm(rational(1220))).text).toBe('1220.0 mm');
    expect(formatCm(inchesFromMm(rational(1220))).text).toBe('122.0 cm');
    const inexact = formatMm(rational(1, 3), 1); // 8.4666… mm → 8.5, up
    expect(inexact.text).toBe('8.5 mm');
    expect(inexact.rounding).toBe('up');
  });

  it('round trips mm→inches→mm exactly', () => {
    const mm = rational(1220);
    expect(eq(mmFromInches(inchesFromMm(mm)), mm)).toBe(true);
  });
});

describe('property: parse ↔ format round trips', () => {
  it('any multiple of 1/32 formats exactly at 1/32 and reparses to the same rational (500 cases)', () => {
    const rnd = mulberry32(0x5153);
    for (let k = 0; k < 500; k++) {
      const units = Math.floor(rnd() * 32 * 1200); // 0 … 1200″ in 32nds
      const value = rational(units, 32);
      const asIn = formatInches(value, 32);
      expect(asIn.rounding).toBe('exact');
      const backIn = parseLength(asIn.text);
      expect(backIn).not.toBeNull();
      expect(eq(backIn!.inches, value)).toBe(true);

      const asFtIn = formatFtIn(value, 32);
      expect(asFtIn.rounding).toBe('exact');
      const backFtIn = parseLength(asFtIn.text);
      expect(backFtIn).not.toBeNull();
      expect(eq(backFtIn!.inches, value)).toBe(true);
    }
  });
});

describe('property: no accumulated drift over 100 cumulative marks', () => {
  it('100 marks at 3-3/16″ pitch: repeated addition EQUALS multiplication, mark by mark', () => {
    const pitch = parseLength('3-3/16')!.inches; // 51/16
    let cursor = ZERO;
    for (let i = 1; i <= 100; i++) {
      cursor = add(cursor, pitch);
      // Exactness, not closeness: bigint equality of normalized rationals.
      expect(eq(cursor, mul(pitch, rational(i)))).toBe(true);
    }
    expect(eq(cursor, rational(5100, 16))).toBe(true);
    expect(formatFtIn(cursor, 16).text).toBe(`26${PRIME} 6-3/4${DOUBLE_PRIME}`);
    expect(formatFtIn(cursor, 16).rounding).toBe('exact');
  });

  it('the float failure this exists to prevent: 100 × 0.1 misses 10 in binary, lands exactly in rationals', () => {
    let float = 0;
    for (let i = 0; i < 100; i++) float += 0.1;
    expect(float).not.toBe(10); // 9.99999999999998 — the classic stacking error

    let exact = ZERO;
    const tenth = rational(1, 10);
    for (let i = 0; i < 100; i++) exact = add(exact, tenth);
    expect(eq(exact, rational(10))).toBe(true);
    expect(toNumber(exact)).toBe(10);
  });
});
