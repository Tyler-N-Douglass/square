/**
 * Layout spacing solvers — SPEC §4.4.1. Owned by A4 (Craft Math).
 *
 * All arithmetic is exact rational (see units.ts): no float drift across a
 * hundred marks. Every solver returns, per mark, both the cumulative distance
 * from the datum (measure them all from the same end — avoids stacking error)
 * and the increment from the previous mark (how people actually walk a tape).
 *
 * Impossible inputs come back as { ok: false, reason } with the numbers in
 * the reason — never silently clamped, per the honesty charter (SPEC §15).
 */

import {
  type Rational,
  ZERO,
  add,
  cmp,
  div,
  formatInches,
  mul,
  rational,
  sub,
  toNumber,
} from './units';
import type { FractionDenom } from './units';

export interface LayoutMark {
  /** 0-based mark index, left to right from the datum. */
  index: number;
  /** Distance from the datum. Measure every mark from the same end. */
  cumulativeFromDatum: Rational;
  /** Distance from the previous mark (from the datum, for the first mark). */
  incrementalFromPrevious: Rational;
}

export interface LayoutFailure {
  ok: false;
  /** Plain statement of what doesn't fit and by how much. */
  reason: string;
}

export interface EqualCentersLayout {
  ok: true;
  marks: LayoutMark[];
  /** Center-to-center pitch = span/(n+1). */
  pitch: Rational;
}

export interface FixedMarginsLayout {
  ok: true;
  marks: LayoutMark[];
  /** Distance from the last center to the far end of the span. */
  leftover: Rational;
}

export interface EqualGapsLayout {
  ok: true;
  marks: LayoutMark[];
  /** The equal clear gap = (span − n·width)/(n+1). */
  gap: Rational;
}

export interface FixedPitchCenteredLayout {
  ok: true;
  marks: LayoutMark[];
  /** Equal margin left over at each end = (span − (n−1)·pitch)/2. */
  margin: Rational;
}

/** SPEC §4.4.1 copy — surfaces beside every mark table. */
export const LAYOUT_TAPE_WARNING = "Measure all marks from the same end. Don't chain.";

const FMT: FractionDenom = 32;
const inches = (r: Rational): string => formatInches(r, FMT).text;

function fail(reason: string): LayoutFailure {
  return { ok: false, reason };
}

function checkCount(n: number): LayoutFailure | null {
  if (!Number.isInteger(n) || n < 1) {
    return fail('Count must be a whole number, 1 or more.');
  }
  return null;
}

function checkSpan(span: Rational): LayoutFailure | null {
  if (cmp(span, ZERO) <= 0) {
    return fail('Span must be greater than zero.');
  }
  return null;
}

/** Build marks from an ordered list of center positions. */
function marksFromCenters(centers: Rational[]): LayoutMark[] {
  const marks: LayoutMark[] = [];
  let prev = ZERO;
  let index = 0;
  for (const c of centers) {
    marks.push({ index, cumulativeFromDatum: c, incrementalFromPrevious: sub(c, prev) });
    prev = c;
    index += 1;
  }
  return marks;
}

/**
 * Equal centers: n marks at S·(i+1)/(n+1) — wall-to-wall gallery hang.
 * The pitch between marks (and from each wall to the nearest mark) is equal.
 */
export function equalCenters(span: Rational, n: number): EqualCentersLayout | LayoutFailure {
  const bad = checkCount(n) ?? checkSpan(span);
  if (bad) return bad;
  const pitch = div(span, rational(n + 1));
  const centers: Rational[] = [];
  for (let i = 0; i < n; i++) centers.push(mul(span, rational(i + 1, n + 1)));
  return { ok: true, marks: marksFromCenters(centers), pitch };
}

/**
 * Fixed margins: first center at `margin` from the datum, then every `pitch`.
 * Fails when the last center runs past the span.
 */
export function fixedMargins(
  span: Rational,
  n: number,
  margin: Rational,
  pitch: Rational,
): FixedMarginsLayout | LayoutFailure {
  const bad = checkCount(n) ?? checkSpan(span);
  if (bad) return bad;
  if (cmp(margin, ZERO) < 0) return fail('Margin must not be negative.');
  if (n > 1 && cmp(pitch, ZERO) <= 0) return fail('Pitch must be greater than zero.');

  const last = add(margin, mul(pitch, rational(n - 1)));
  if (cmp(last, span) > 0) {
    return fail(
      `Doesn't fit. The last mark lands at ${inches(last)}, past the ${inches(span)} span.`,
    );
  }
  const centers: Rational[] = [];
  for (let i = 0; i < n; i++) centers.push(add(margin, mul(pitch, rational(i))));
  return { ok: true, marks: marksFromCenters(centers), leftover: sub(span, last) };
}

/**
 * Equal gaps: n items of width w in span S with an equal clear gap between
 * items and at both ends: gap = (S − n·w)/(n+1), centers at
 * gap·(i+1) + w·(i+1/2). Fails — with the shortfall — when the items
 * outmeasure the span.
 */
export function equalGaps(
  span: Rational,
  n: number,
  itemWidth: Rational,
): EqualGapsLayout | LayoutFailure {
  const bad = checkCount(n) ?? checkSpan(span);
  if (bad) return bad;
  if (cmp(itemWidth, ZERO) < 0) return fail('Item width must not be negative.');

  const totalWidth = mul(itemWidth, rational(n));
  if (cmp(totalWidth, span) > 0) {
    const short = sub(totalWidth, span);
    return fail(
      `Doesn't fit. ${n} pieces at ${inches(itemWidth)} total ${inches(totalWidth)}; the span is ${inches(span)} — ${inches(short)} short.`,
    );
  }
  const gap = div(sub(span, totalWidth), rational(n + 1));
  const centers: Rational[] = [];
  for (let i = 0; i < n; i++) {
    centers.push(add(mul(gap, rational(i + 1)), mul(itemWidth, rational(2 * i + 1, 2))));
  }
  return { ok: true, marks: marksFromCenters(centers), gap };
}

/**
 * Fixed pitch, centered: the run of n centers at the given pitch (e.g. 96 mm
 * cabinet pulls) centered in the span, equal margins reported at both ends.
 * Fails — with the overrun — when the run outmeasures the span.
 */
export function fixedPitchCentered(
  span: Rational,
  n: number,
  pitch: Rational,
): FixedPitchCenteredLayout | LayoutFailure {
  const bad = checkCount(n) ?? checkSpan(span);
  if (bad) return bad;
  if (n > 1 && cmp(pitch, ZERO) <= 0) return fail('Pitch must be greater than zero.');

  const run = n > 1 ? mul(pitch, rational(n - 1)) : ZERO;
  if (cmp(run, span) > 0) {
    const over = sub(run, span);
    return fail(
      `Doesn't fit. ${n} marks at ${inches(pitch)} pitch run ${inches(run)}; the span is ${inches(span)} — over by ${inches(over)}.`,
    );
  }
  const margin = div(sub(span, run), rational(2));
  const centers: Rational[] = [];
  for (let i = 0; i < n; i++) centers.push(add(margin, mul(pitch, rational(i))));
  return { ok: true, marks: marksFromCenters(centers), margin };
}

// ---------------------------------------------------------------------------
// Story pole / cut-list export (data side — SPEC §4.4.2). The printable strip
// and print stylesheet are Phase 2 UI; this emits the rows they render, and a
// CSV a person can drop into anything.
// ---------------------------------------------------------------------------

export interface StoryPoleRow {
  /** 1-based mark number as read aloud on a ladder. */
  mark: number;
  cumulative: string;
  incremental: string;
  cumulativeDecimalIn: string;
  cumulativeMm: string;
}

export function storyPoleRows(marks: LayoutMark[], denom: FractionDenom): StoryPoleRow[] {
  return marks.map((m) => ({
    mark: m.index + 1,
    cumulative: formatInches(m.cumulativeFromDatum, denom).text,
    incremental: formatInches(m.incrementalFromPrevious, denom).text,
    cumulativeDecimalIn: toNumber(m.cumulativeFromDatum).toFixed(4),
    cumulativeMm: (toNumber(m.cumulativeFromDatum) * 25.4).toFixed(1),
  }));
}

/** CSV with header. Cumulative column is the one to measure from. */
export function storyPoleCsv(marks: LayoutMark[], denom: FractionDenom): string {
  const rows = storyPoleRows(marks, denom);
  const lines = ['mark,cumulative,incremental,cumulative_in,cumulative_mm'];
  for (const r of rows) {
    lines.push(`${r.mark},${r.cumulative},${r.incremental},${r.cumulativeDecimalIn},${r.cumulativeMm}`);
  }
  return lines.join('\n');
}
