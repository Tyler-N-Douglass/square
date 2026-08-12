/**
 * Exact rational arithmetic + fraction I/O — SPEC §5. Owned by A4 (Craft Math).
 *
 * Layout math runs on exact rationals (bigint num/den) so one hundred
 * cumulative marks land exactly where multiplication says they do. Floats
 * drift; tape measures don't. Rounding to the user's precision (1/8, 1/16,
 * 1/32) happens only at display time and always reports its direction.
 *
 * Formatting uses U+2032 PRIME (′) for feet and U+2033 DOUBLE PRIME (″) for
 * inches. The shipped DDC Hardware woff2 files carry a patched U+2032 glyph
 * for exactly this (SPEC §7.3) — do not swap these for ASCII quotes.
 *
 * Metric is exact too: 1 in = 25.4 mm by definition, i.e. 127/5 mm, so
 * mm↔inch conversions stay rational.
 */

// ---------------------------------------------------------------------------
// Rational core
// ---------------------------------------------------------------------------

export interface Rational {
  /** Normalized: gcd(|num|, den) = 1, den > 0, sign carried by num. */
  readonly num: bigint;
  readonly den: bigint;
}

function big(x: bigint | number, what: string): bigint {
  if (typeof x === 'bigint') return x;
  if (!Number.isSafeInteger(x)) {
    throw new RangeError(`${what} must be an integer — build fractions from numerator and denominator, not from a float.`);
  }
  return BigInt(x);
}

function bgcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

/** Build a normalized rational. Throws on a zero denominator or float inputs. */
export function rational(num: bigint | number, den: bigint | number = 1n): Rational {
  let n = big(num, 'Numerator');
  let d = big(den, 'Denominator');
  if (d === 0n) throw new RangeError('Denominator must not be zero.');
  if (d < 0n) { n = -n; d = -d; }
  const g = bgcd(n, d);
  return g === 0n ? { num: 0n, den: 1n } : { num: n / g, den: d / g };
}

export const ZERO: Rational = rational(0);
export const ONE: Rational = rational(1);

export function add(a: Rational, b: Rational): Rational {
  return rational(a.num * b.den + b.num * a.den, a.den * b.den);
}
export function sub(a: Rational, b: Rational): Rational {
  return rational(a.num * b.den - b.num * a.den, a.den * b.den);
}
export function mul(a: Rational, b: Rational): Rational {
  return rational(a.num * b.num, a.den * b.den);
}
export function div(a: Rational, b: Rational): Rational {
  if (b.num === 0n) throw new RangeError('Division by zero.');
  return rational(a.num * b.den, a.den * b.num);
}
export function neg(a: Rational): Rational {
  return { num: -a.num, den: a.den };
}
export function abs(a: Rational): Rational {
  return a.num < 0n ? neg(a) : a;
}
export function cmp(a: Rational, b: Rational): -1 | 0 | 1 {
  const lhs = a.num * b.den;
  const rhs = b.num * a.den;
  return lhs < rhs ? -1 : lhs > rhs ? 1 : 0;
}
export function eq(a: Rational, b: Rational): boolean {
  return a.num === b.num && a.den === b.den;
}
export function sign(a: Rational): -1 | 0 | 1 {
  return a.num < 0n ? -1 : a.num > 0n ? 1 : 0;
}
/** Lossy by design — display/plotting only. All arithmetic stays rational. */
export function toNumber(a: Rational): number {
  return Number(a.num) / Number(a.den);
}

/** Exact rational from a decimal string: '40.5' → 81/2. */
export function fromDecimalString(s: string): Rational {
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(s.trim());
  if (!m || ((m[2] ?? '') === '' && (m[3] ?? '') === '')) {
    throw new RangeError(`Not a decimal number: "${s}"`);
  }
  const signPart = m[1] === '-' ? -1n : 1n;
  const intPart = m[2] ?? '';
  const fracPart = m[3] ?? '';
  const numDigits = (intPart === '' ? '0' : intPart) + fracPart;
  return rational(signPart * BigInt(numDigits), 10n ** BigInt(fracPart.length));
}

// ---------------------------------------------------------------------------
// Metric conversion — exact: 1 in = 25.4 mm = 127/5 mm.
// ---------------------------------------------------------------------------

const MM_PER_INCH: Rational = rational(127, 5);

export function mmFromInches(inches: Rational): Rational {
  return mul(inches, MM_PER_INCH);
}
export function inchesFromMm(mm: Rational): Rational {
  return div(mm, MM_PER_INCH);
}

// ---------------------------------------------------------------------------
// Parsing — SPEC §5. Accepts ASCII quotes and the typographic primes.
// ---------------------------------------------------------------------------

export type LengthUnit = 'in' | 'ft-in' | 'mm' | 'cm' | 'm';

export interface ParsedLength {
  /** Always inches, exact. */
  inches: Rational;
  /** The unit family the user typed, so the UI can echo their language. */
  unit: LengthUnit;
}

/**
 * Parse a length. Understands:
 *   3' 4-7/16"   3′ 4-7/16″   3'4.5"   3'      (feet–inches)
 *   40.5"  7/16  1-3/8  1 3/8  12  12in       (inches)
 *   1220mm  2.5cm  1.2m                        (metric, exact via 127/5)
 * Returns null on anything it cannot read exactly — no guessing.
 */
export function parseLength(raw: string): ParsedLength | null {
  let s = raw
    .replace(/[′’]/g, "'")
    .replace(/[″“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
  if (s === '') return null;

  let negative = false;
  if (s.startsWith('-') || s.startsWith('−')) {
    negative = true;
    s = s.slice(1).trim();
  }
  const signed = (r: Rational): Rational => (negative ? neg(r) : r);

  // Metric: 1220mm, 2.5 cm, 1.2m
  const metric = /^(\d+(?:\.\d+)?|\.\d+)\s*(mm|cm|m)$/i.exec(s);
  if (metric) {
    const value = fromDecimalString(metric[1] ?? '');
    const suffix = (metric[2] ?? '').toLowerCase() as 'mm' | 'cm' | 'm';
    const mm = suffix === 'mm' ? value : suffix === 'cm' ? mul(value, rational(10)) : mul(value, rational(1000));
    return { inches: signed(inchesFromMm(mm)), unit: suffix };
  }

  // Feet, with optional inches remainder: 3' 4-7/16"
  const ft = /^(\d+(?:\.\d+)?|\.\d+)\s*'\s*(.*)$/.exec(s);
  if (ft) {
    const feet = fromDecimalString(ft[1] ?? '');
    const rest = (ft[2] ?? '').trim();
    let inchPart = ZERO;
    if (rest !== '') {
      const parsed = parseInchExpression(stripInchSuffix(rest));
      if (parsed === null) return null;
      inchPart = parsed;
    }
    return { inches: signed(add(mul(feet, rational(12)), inchPart)), unit: 'ft-in' };
  }

  // Plain inches: 40.5"  7/16  1-3/8  12in
  const parsed = parseInchExpression(stripInchSuffix(s));
  if (parsed === null) return null;
  return { inches: signed(parsed), unit: 'in' };
}

function stripInchSuffix(s: string): string {
  return s.replace(/\s*(?:"|in\.?|inch(?:es)?)$/i, '').trim();
}

/** Whole, fraction, whole-with-fraction, or decimal — exact, or null. */
function parseInchExpression(s: string): Rational | null {
  if (s === '') return null;

  let m = /^(\d+)[- ](\d+)\/(\d+)$/.exec(s);
  if (m) {
    const den = BigInt(m[3] ?? '0');
    if (den === 0n) return null;
    return add(rational(BigInt(m[1] ?? '0')), rational(BigInt(m[2] ?? '0'), den));
  }

  m = /^(\d+)\/(\d+)$/.exec(s);
  if (m) {
    const den = BigInt(m[2] ?? '0');
    if (den === 0n) return null;
    return rational(BigInt(m[1] ?? '0'), den);
  }

  if (/^(\d+(?:\.\d+)?|\.\d+)$/.test(s)) return fromDecimalString(s);
  return null;
}

// ---------------------------------------------------------------------------
// Formatting — round only here, and say which way the number moved.
// ---------------------------------------------------------------------------

export type FractionDenom = 8 | 16 | 32;

/**
 * 'exact' — the displayed value is the true value.
 * 'up'    — display rounded toward +∞ (displayed > true).
 * 'down'  — display rounded toward −∞ (displayed < true).
 * Ties round away from zero.
 */
export type RoundingDirection = 'exact' | 'up' | 'down';

export interface FormattedLength {
  text: string;
  rounding: RoundingDirection;
}

const PRIME = '′';        // ′ feet
const DOUBLE_PRIME = '″'; // ″ inches

/** Nearest integer count of 1/denom units, ties away from zero. */
function roundToUnits(value: Rational, denom: bigint): { units: bigint; rounding: RoundingDirection } {
  const scaledNum = value.num * denom;                 // value in units = scaledNum / value.den
  const negative = scaledNum < 0n;
  const absNum = negative ? -scaledNum : scaledNum;
  let units = absNum / value.den;
  const rem = absNum % value.den;
  if (2n * rem >= value.den) units += 1n;
  if (negative) units = -units;
  const displayed = rational(units, denom);
  const c = cmp(displayed, value);
  return { units, rounding: c === 0 ? 'exact' : c > 0 ? 'up' : 'down' };
}

function fractionText(units: bigint, denom: bigint): string {
  // units/denom of an inch, units >= 0, as W-N/D with the fraction reduced.
  const whole = units / denom;
  const fracUnits = units % denom;
  if (fracUnits === 0n) return `${whole}`;
  const g = bgcd(fracUnits, denom);
  const frac = `${fracUnits / g}/${denom / g}`;
  return whole === 0n ? frac : `${whole}-${frac}`;
}

/** Inches only: 40-1/2″. Rounds to the nearest 1/denom and reports direction. */
export function formatInches(inches: Rational, denom: FractionDenom): FormattedLength {
  const d = BigInt(denom);
  const { units, rounding } = roundToUnits(inches, d);
  const negative = units < 0n;
  const absUnits = negative ? -units : units;
  const text = `${negative ? '-' : ''}${fractionText(absUnits, d)}${DOUBLE_PRIME}`;
  return { text, rounding };
}

/** Feet–inches: 3′ 4-7/16″. Feet appear at 12″ and up; inches always shown. */
export function formatFtIn(inches: Rational, denom: FractionDenom): FormattedLength {
  const d = BigInt(denom);
  const { units, rounding } = roundToUnits(inches, d);
  const negative = units < 0n;
  const absUnits = negative ? -units : units;
  const unitsPerFoot = 12n * d;
  const feet = absUnits / unitsPerFoot;
  const inchUnits = absUnits % unitsPerFoot;
  const signText = negative ? '-' : '';
  const text = feet === 0n
    ? `${signText}${fractionText(inchUnits, d)}${DOUBLE_PRIME}`
    : `${signText}${feet}${PRIME} ${fractionText(inchUnits, d)}${DOUBLE_PRIME}`;
  return { text, rounding };
}

/** Decimal metric with fixed decimals, rounding direction reported. */
function formatDecimal(value: Rational, decimals: number, suffix: string): FormattedLength {
  const scaleBig = 10n ** BigInt(decimals);
  const { units, rounding } = roundToUnits(value, scaleBig);
  const negative = units < 0n;
  const absUnits = negative ? -units : units;
  const whole = absUnits / scaleBig;
  const frac = absUnits % scaleBig;
  const fracText = decimals === 0 ? '' : `.${frac.toString().padStart(decimals, '0')}`;
  return { text: `${negative ? '-' : ''}${whole}${fracText} ${suffix}`, rounding };
}

/** Millimetres from exact inches: formatMm(1/2″) → "12.7 mm". */
export function formatMm(inches: Rational, decimals = 1): FormattedLength {
  return formatDecimal(mmFromInches(inches), decimals, 'mm');
}

/** Centimetres from exact inches. */
export function formatCm(inches: Rational, decimals = 1): FormattedLength {
  return formatDecimal(div(mmFromInches(inches), rational(10)), decimals, 'cm');
}
