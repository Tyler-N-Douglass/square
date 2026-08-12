/**
 * Layout spacing solvers — SPEC §4.4.1, §10.1. All exact rational; every
 * solver hands back cumulative AND incremental distances; impossible inputs
 * fail with a stated reason, never a clamp.
 */
import { describe, expect, it } from 'vitest';
import {
  LAYOUT_TAPE_WARNING,
  equalCenters,
  equalGaps,
  fixedMargins,
  fixedPitchCentered,
  storyPoleCsv,
  storyPoleRows,
} from '../../src/geometry/layout';
import {
  ZERO,
  add,
  eq,
  mul,
  parseLength,
  rational,
  sub,
  toNumber,
} from '../../src/geometry/units';
import type { LayoutMark } from '../../src/geometry/layout';

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

/** Incrementals must chain exactly back to every cumulative — bigint equality. */
function assertChainsExactly(marks: LayoutMark[]): void {
  let cursor = ZERO;
  for (const m of marks) {
    cursor = add(cursor, m.incrementalFromPrevious);
    expect(eq(cursor, m.cumulativeFromDatum)).toBe(true);
  }
}

describe('equalCenters — S·(i+1)/(n+1)', () => {
  it('3 marks across 120″ land at 30, 60, 90 with pitch 30', () => {
    const r = equalCenters(rational(120), 3);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.marks.map((m) => toNumber(m.cumulativeFromDatum))).toEqual([30, 60, 90]);
    expect(r.marks.map((m) => toNumber(m.incrementalFromPrevious))).toEqual([30, 30, 30]);
    expect(eq(r.pitch, rational(30))).toBe(true);
    assertChainsExactly(r.marks);
  });

  it('a single mark centers the span', () => {
    const r = equalCenters(rational(57), 1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(eq(r.marks[0]!.cumulativeFromDatum, rational(57, 2))).toBe(true);
  });

  it('stays exact where floats cannot: 7 marks across 100″', () => {
    const r = equalCenters(rational(100), 7);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Center i sits at exactly 100·(i+1)/8 — assert the last: 87-1/2″.
    expect(eq(r.marks[6]!.cumulativeFromDatum, rational(175, 2))).toBe(true);
    assertChainsExactly(r.marks);
  });
});

describe('fixedMargins — margin + i·pitch', () => {
  it('4 studs-worth of brackets: margin 6″, pitch 16″ in 96″', () => {
    const r = fixedMargins(rational(96), 4, rational(6), rational(16));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.marks.map((m) => toNumber(m.cumulativeFromDatum))).toEqual([6, 22, 38, 54]);
    expect(toNumber(r.marks[0]!.incrementalFromPrevious)).toBe(6);
    expect(eq(r.leftover, rational(42))).toBe(true);
    assertChainsExactly(r.marks);
  });

  it('fails with the overrun stated when the run leaves the span', () => {
    const r = fixedMargins(rational(96), 7, rational(6), rational(16));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/fit/i);
    expect(r.reason).toMatch(/102″/); // 6 + 6·16 — the number, not a shrug
  });

  it('rejects a negative margin and a zero pitch', () => {
    expect(fixedMargins(rational(96), 2, rational(-1), rational(16)).ok).toBe(false);
    expect(fixedMargins(rational(96), 2, rational(6), ZERO).ok).toBe(false);
  });
});

describe('equalGaps — gap = (S − n·w)/(n+1)', () => {
  it('3 frames 8″ wide across 96″: gap 18″, centers 22, 48, 74', () => {
    const r = equalGaps(rational(96), 3, rational(8));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(eq(r.gap, rational(18))).toBe(true);
    expect(r.marks.map((m) => toNumber(m.cumulativeFromDatum))).toEqual([22, 48, 74]);
    assertChainsExactly(r.marks);
    // The far edge closes the span exactly: last center + w/2 + gap = S.
    const close = add(add(r.marks[2]!.cumulativeFromDatum, rational(4)), r.gap);
    expect(eq(close, rational(96))).toBe(true);
  });

  it('allows touching items (gap exactly zero)', () => {
    const r = equalGaps(rational(24), 3, rational(8));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(eq(r.gap, ZERO)).toBe(true);
  });

  it('fails with the shortfall stated when the items outmeasure the span', () => {
    const r = equalGaps(rational(36), 5, rational(8));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/fit/i);
    expect(r.reason).toMatch(/4″ short/); // 40 − 36, never clamped away
  });
});

describe('fixedPitchCentered — cabinet pulls at 96 mm CTC', () => {
  it('centers the run and reports equal margins, exactly, from metric pitch', () => {
    const pitch = parseLength('96mm')!.inches; // 480/127 — exact
    const span = rational(40);
    const r = fixedPitchCentered(span, 5, pitch);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // margin·2 + (n−1)·pitch reassembles the span with zero residue.
    const reassembled = add(mul(r.margin, rational(2)), mul(pitch, rational(4)));
    expect(eq(reassembled, span)).toBe(true);
    expect(eq(sub(r.marks[1]!.cumulativeFromDatum, r.marks[0]!.cumulativeFromDatum), pitch)).toBe(true);
    assertChainsExactly(r.marks);
  });

  it('n = 1 centers the single mark', () => {
    const r = fixedPitchCentered(rational(30), 1, rational(96));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(eq(r.marks[0]!.cumulativeFromDatum, rational(15))).toBe(true);
  });

  it('fails with the overrun stated when the run outmeasures the span', () => {
    const r = fixedPitchCentered(rational(10), 4, rational(4));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/fit/i);
    expect(r.reason).toMatch(/over by 2″/); // 12 − 10
  });
});

describe('shared input validation', () => {
  it('rejects a non-integer, zero, or negative count with a stated reason', () => {
    for (const bad of [0, -1, 2.5, NaN]) {
      const r = equalCenters(rational(100), bad);
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.reason.length).toBeGreaterThan(0);
    }
  });

  it('rejects a zero or negative span', () => {
    expect(equalCenters(ZERO, 3).ok).toBe(false);
    expect(equalGaps(rational(-10), 2, rational(1)).ok).toBe(false);
  });

  it('ships the tape warning copy verbatim from SPEC §4.4.1', () => {
    expect(LAYOUT_TAPE_WARNING).toBe("Measure all marks from the same end. Don't chain.");
  });
});

describe('property: cumulative and incremental agree exactly for random inputs', () => {
  it('500 random solver runs chain incrementals into cumulatives with bigint equality', () => {
    const rnd = mulberry32(0xa4a4);
    for (let k = 0; k < 500; k++) {
      const span = rational(64 + Math.floor(rnd() * 32 * 200), 32); // 2″ … ~202″ in 32nds
      const n = 1 + Math.floor(rnd() * 12);
      const solver = k % 3;
      const r = solver === 0
        ? equalCenters(span, n)
        : solver === 1
          ? equalGaps(span, n, rational(Math.floor(rnd() * 16), 32))
          : fixedPitchCentered(span, n, rational(1 + Math.floor(rnd() * 64), 32));
      if (!r.ok) {
        expect(r.reason.length).toBeGreaterThan(0); // refusals carry reasons
        continue;
      }
      assertChainsExactly(r.marks);
      expect(r.marks).toHaveLength(n);
    }
  });
});

describe('story pole export (data side)', () => {
  it('emits one row per mark with tape fractions, decimal inches, and mm', () => {
    const r = equalCenters(rational(120), 3);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const rows = storyPoleRows(r.marks, 16);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      mark: 1,
      cumulative: '30″',
      incremental: '30″',
      cumulativeDecimalIn: '30.0000',
      cumulativeMm: '762.0',
    });
  });

  it('CSV has a header and one line per mark', () => {
    const r = equalGaps(rational(96), 3, rational(8));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const csv = storyPoleCsv(r.marks, 16);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('mark,cumulative,incremental,cumulative_in,cumulative_mm');
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain('22″');
  });
});
