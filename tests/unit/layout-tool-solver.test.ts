/**
 * LAYOUT tool view-model — SPEC §4.4, §5 (A4, Phase 2): table rendering math
 * (fractions at precision, rounding-direction markers, cumulative vs
 * incremental), refusal passthrough, presets, stud-datum alignment, and the
 * level-line roll capture.
 */
import { describe, expect, it } from 'vitest';
import {
  MODE_LABELS,
  STUD_SNAP_TOL_IN,
  TOGGLE_BOLT_NOTE,
  alignMarksToStuds,
  computeLayout,
  layoutTableRows,
  roundingMarker,
  studsFromLog,
} from '../../src/tools/layout/solver';
import { LAYOUT_PRESETS } from '../../src/tools/layout/presets';
import { RollCapture, levelLineDrop, OVERLAY_BOUNDARY_LINE } from '../../src/tools/layout/levelLine';
import { parseLength, rational, toNumber } from '../../src/geometry/units';
import { LAYOUT_TAPE_WARNING } from '../../src/geometry/layout';
import type { SavedEntry } from '../../src/app/logStore';
import type { Measurement } from '../../src/types';
import type { Orientation } from '../../src/sensors/types';

const IDENTITY_Q = { w: 1, x: 0, y: 0, z: 0 };

describe('computeLayout + table rows', () => {
  it('equal centers on 10′: both columns, ft-in formatting, exact markers', () => {
    const r = computeLayout({ span: rational(120), count: 5, mode: 'equal-centers' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const rows = layoutTableRows(r.marks, 16);
    expect(rows.map((x) => x.cumulative.text)).toEqual(['1′ 8″', '3′ 4″', '5′ 0″', '6′ 8″', '8′ 4″']);
    // incremental: every step identical to the pitch
    expect(new Set(rows.map((x) => x.incremental.text))).toEqual(new Set(['1′ 8″']));
    for (const row of rows) {
      expect(row.cumulative.rounding).toBe('exact');
      expect(row.incremental.rounding).toBe('exact');
    }
    expect(r.summary[0]?.label).toBe('Pitch');
    expect(toNumber(r.summary[0]!.value)).toBeCloseTo(20, 12);
  });

  it('incremental steps always sum to the cumulative — the two columns agree', () => {
    const r = computeLayout({
      span: parseLength(`8' 6"`)!.inches,
      count: 7,
      mode: 'equal-gaps',
      itemWidth: parseLength('7/8')!.inches,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    let sum = 0;
    for (const m of r.marks) sum += toNumber(m.incrementalFromPrevious);
    expect(sum).toBeCloseTo(toNumber(r.marks[r.marks.length - 1]!.cumulativeFromDatum), 9);
  });

  it('rounding markers state the display direction: 1/3″ at 1/8 precision rounds up', () => {
    // marks at 1/3″ and 2/3″: nearest eighth is 3/8 (up) and 5/8 (down)
    const r = computeLayout({ span: rational(1), count: 2, mode: 'equal-centers' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const rows = layoutTableRows(r.marks, 8);
    expect(rows[0]!.cumulative.text).toBe('3/8″');
    expect(rows[0]!.cumulative.rounding).toBe('up');
    expect(rows[1]!.cumulative.text).toBe('5/8″');
    expect(rows[1]!.cumulative.rounding).toBe('down');
    // finer precision changes the rounding, honestly
    const rows32 = layoutTableRows(r.marks, 32);
    expect(rows32[0]!.cumulative.text).toBe('11/32″');
    expect(rows32[0]!.cumulative.rounding).toBe('up');
  });

  it('mm column is exact where 25.4 divides evenly', () => {
    const r = computeLayout({ span: rational(36), count: 2, mode: 'equal-centers' });
    if (!r.ok) return;
    const rows = layoutTableRows(r.marks, 16);
    expect(rows[0]!.cumulativeMm.text).toBe('304.8 mm'); // 12″ exactly
    expect(rows[0]!.cumulativeMm.rounding).toBe('exact');
  });

  it('refusals pass through the solver reason with the shortfall — no clamped numbers', () => {
    const r = computeLayout({
      span: rational(120),
      count: 6,
      mode: 'equal-gaps',
      itemWidth: rational(24),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain(`Doesn't fit`);
    expect(r.reason).toContain('short');
    expect(r.reason).toContain('144″');
  });

  it('missing per-mode inputs refuse with a stated reason', () => {
    expect(computeLayout({ span: rational(96), count: 3, mode: 'equal-gaps' }).ok).toBe(false);
    expect(computeLayout({ span: rational(96), count: 3, mode: 'fixed-pitch' }).ok).toBe(false);
    expect(computeLayout({ span: rational(96), count: 3, mode: 'fixed-margins' }).ok).toBe(false);
  });

  it('roundingMarker exposes ▴/▾ with labels, nothing for exact', () => {
    expect(roundingMarker('up').char).toBe('▴');
    expect(roundingMarker('down').char).toBe('▾');
    expect(roundingMarker('exact').char).toBe('');
    expect(roundingMarker('up').label).toContain('up');
  });

  it('the chaining warning is the verbatim solver constant', () => {
    expect(LAYOUT_TAPE_WARNING).toBe("Measure all marks from the same end. Don't chain.");
  });
});

describe('presets (§4.4.3)', () => {
  it('every preset parses, computes ok, and states its assumption', () => {
    for (const p of LAYOUT_PRESETS) {
      const span = parseLength(p.span);
      expect(span, p.id).not.toBeNull();
      const input = {
        span: span!.inches,
        count: p.count,
        mode: p.mode,
        ...(p.itemWidth ? { itemWidth: parseLength(p.itemWidth)!.inches } : {}),
        ...(p.margin ? { margin: parseLength(p.margin)!.inches } : {}),
        ...(p.pitch ? { pitch: parseLength(p.pitch)!.inches } : {}),
      };
      const r = computeLayout(input);
      expect(r.ok, `${p.id} should compute`).toBe(true);
      expect(p.assumption.length, p.id).toBeGreaterThan(20);
      expect(p.assumption.toLowerCase(), p.id).toContain('assumes');
      expect(MODE_LABELS[p.mode], p.id).toBeDefined();
    }
  });

  it('gallery preset carries the 57″ standard; pulls carry 96 mm CTC', () => {
    const gallery = LAYOUT_PRESETS.find((p) => p.id === 'gallery-wall')!;
    expect(`${gallery.assumption} ${gallery.note ?? ''}`).toContain('57″');
    const pulls = LAYOUT_PRESETS.find((p) => p.id === 'cabinet-pulls')!;
    expect(pulls.pitch).toBe('96mm');
    expect(pulls.assumption).toContain('128');
    expect(pulls.assumption).toContain('160');
  });
});

describe('stud datum (§4.4.3)', () => {
  const stud = (id: string, value: number, unit = 'in', capturedAt = 1000): SavedEntry => ({
    measurement: {
      id,
      kind: 'stud',
      value,
      unit,
      uncertainty: { plusMinus: 0.3, basis: 'nominal' },
      confidence: 'LIKELY',
      provenance: { tier: 'FIELD', calibrations: {}, sampleCount: 100, capturedAt },
    } as Measurement,
  });

  it('reads stud measurements from the log, in/mm, sorted', () => {
    const entries = [
      stud('a', 32),
      stud('b', 406.4, 'mm'), // 16″
      { ...stud('c', 5), measurement: { ...stud('c', 5).measurement, kind: 'level' as const } },
    ];
    const studs = studsFromLog(entries, 61_000);
    expect(studs.map((s) => s.centerIn)).toEqual([16, 32]);
    expect(studs[0]!.confidence).toBe('LIKELY');
    expect(studs[0]!.ageMs).toBe(60_000);
  });

  it('snaps marks within the stated tolerance and flags the rest with the toggle-bolt note', () => {
    const r = computeLayout({ span: rational(96), count: 3, mode: 'equal-centers' });
    if (!r.ok) return; // marks at 24, 48, 72
    const aligns = alignMarksToStuds(r.marks, [16, 32, 48.5]);
    expect(aligns[1]!.miss).toBe(false);
    expect(aligns[1]!.snappedIn).toBe(48.5);
    expect(aligns[1]!.deltaIn).toBeCloseTo(0.5, 9);
    expect(aligns[0]!.miss).toBe(true); // 24 is 8″ from either stud
    expect(aligns[2]!.miss).toBe(true);
    expect(STUD_SNAP_TOL_IN).toBe(2);
    expect(TOGGLE_BOLT_NOTE.toLowerCase()).toContain('toggle bolt');
  });
});

describe('level line (§4.4.2 numeric)', () => {
  const orient = (t: number, rollRad: number, stable: boolean): Orientation => ({
    t,
    q: IDENTITY_Q,
    pitch: 0,
    roll: rollRad,
    yaw: null,
    stable,
  });

  it('captures the mean roll and its scatter over a 500 ms stable window', () => {
    const cap = new RollCapture();
    cap.arm();
    let captured: { rollRad: number; stddevRad: number } | null = null;
    const base = 0.01;
    for (let i = 0; i < 40; i++) {
      const wiggle = (i % 2 === 0 ? 1 : -1) * 0.001;
      const phase = cap.ingest(orient(i / 60, base + wiggle, true));
      if (phase.phase === 'captured') captured = phase.reading;
    }
    expect(captured).not.toBeNull();
    expect(captured!.rollRad).toBeCloseTo(base, 3);
    expect(captured!.stddevRad).toBeCloseTo(0.001, 3);
  });

  it('motion resets the window', () => {
    const cap = new RollCapture();
    cap.arm();
    for (let i = 0; i < 20; i++) cap.ingest(orient(i / 60, 0.01, true));
    expect(cap.phase.phase).toBe('settling');
    cap.ingest(orient(21 / 60, 0.2, false));
    expect(cap.phase.phase).toBe('moving');
  });

  it('drop over the span is tan(θ)·L with the DISCIPLINED ± propagated (H-01)', () => {
    // The caller hands in the disciplined ±: max(calibration-state claim,
    // window scatter). A very quiet window (σ = 0.1°) on an uncalibrated
    // phone still propagates the ±0.5° claim floor — never the raw scatter.
    const reading = { rollRad: (1 * Math.PI) / 180, stddevRad: (0.1 * Math.PI) / 180, sampleCount: 30, t: 0 };
    const claimRad = (0.5 * Math.PI) / 180; // uncalibrated claim floor, radians
    const d = levelLineDrop(reading, 96, claimRad);
    expect(d.dropIn).toBeCloseTo(Math.tan(reading.rollRad) * 96, 9);
    expect(d.plusMinusIn).toBeCloseTo((96 * claimRad) / Math.cos(reading.rollRad) ** 2, 9);
    // The scatter never leaks into the ± on its own.
    expect(d.plusMinusIn).toBeGreaterThan((96 * reading.stddevRad) / Math.cos(reading.rollRad) ** 2);
  });

  it('a noisy window dominates the claim when it is genuinely wider', () => {
    // When the scatter exceeds the claim, the caller passes the scatter —
    // the propagation itself is the same δθ → span·δθ/cos²θ either way.
    const reading = { rollRad: 0, stddevRad: (0.8 * Math.PI) / 180, sampleCount: 30, t: 0 };
    const d = levelLineDrop(reading, 48, reading.stddevRad);
    expect(d.plusMinusIn).toBeCloseTo(48 * reading.stddevRad, 9);
  });

  it('states the §4.4.2 boundary verbatim', () => {
    expect(OVERLAY_BOUNDARY_LINE).toBe('The overlay plans and verifies. The tape makes the mark.');
  });
});
