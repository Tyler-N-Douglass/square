/**
 * SCAN model — pure logic (src/tools/scan/model.ts): the sweep-mode state
 * machine, anchor/span entry parsing, vertical-confirm scoring, manual-mode
 * arithmetic (± band growth), lattice-display derivation labeling, the live
 * feedback state words, and the saved-Measurement builder.
 */
import { describe, expect, it } from 'vitest';
import {
  CONFIRM_AGREE_COPY,
  CONFIRM_DISAGREE_COPY,
  LiveFeedback,
  MANUAL_BASE_BAND_IN,
  MANUAL_BAND_PER_IN,
  OC_CHOICES,
  POSITION_PM_IN,
  SweepSession,
  buildStudMeasurements,
  confirmVerdict,
  latticeDisplayLines,
  latticeStatement,
  manualBandIn,
  parseSpanInches,
  pitchForAnomaly,
  pitchLabel,
  predictStuds,
  referenceAdjustment,
  scoreAgreement,
  stateWordFor,
} from '../../src/tools/scan/model';
import type { FastenerEvent } from '../../src/dsp/analyze';
import { rational, toNumber } from '../../src/geometry/units';

/* ------------------------------------------------------------------------ */
/* Sweep-mode state machine                                                  */
/* ------------------------------------------------------------------------ */

describe('SweepSession state machine', () => {
  it('starts idle in MARK-ON-BEEP (the default mode — SPEC §4.1.4)', () => {
    const s = new SweepSession();
    expect(s.phase).toBe('idle');
    expect(s.mode).toBe('mark');
  });

  it('mark mode: start → stop goes straight to done with no anchors', () => {
    const s = new SweepSession();
    expect(s.start(10)).toBe(true);
    expect(s.phase).toBe('sweeping');
    expect(s.stop(18)).toBe(true);
    expect(s.phase).toBe('done');
    expect(s.anchors()).toBeNull(); // no position math ever claimed
  });

  it('paced mode: stop asks for a span; declaring builds the anchor map', () => {
    const s = new SweepSession();
    s.setMode('paced');
    s.start(100);
    s.stop(108);
    expect(s.phase).toBe('awaitSpan');
    expect(s.anchors()).toBeNull(); // ADR-006: no distances before declaration
    expect(s.declareSpan(24)).toBe(true);
    expect(s.phase).toBe('done');
    expect(s.anchors()).toEqual([
      { t: 100, in: 0 },
      { t: 108, in: 24 },
    ]);
  });

  it('paced mode: skipping the span stays honest in time units', () => {
    const s = new SweepSession();
    s.setMode('paced');
    s.start(0);
    s.stop(5);
    expect(s.skipSpan()).toBe(true);
    expect(s.phase).toBe('done');
    expect(s.anchors()).toBeNull();
  });

  it('anchor mode: two anchor taps end the sweep and map the span between THE ANCHORS', () => {
    const s = new SweepSession();
    s.setMode('anchor');
    s.start(50);
    expect(s.dropAnchor(51)).toBe(true);
    expect(s.phase).toBe('sweeping');
    expect(s.dropAnchor(59)).toBe(true);
    expect(s.phase).toBe('awaitSpan');
    s.declareSpan(32);
    expect(s.anchors()).toEqual([
      { t: 51, in: 0 },
      { t: 59, in: 32 },
    ]);
  });

  it('anchor mode: a sweep stopped before the second anchor has no span', () => {
    const s = new SweepSession();
    s.setMode('anchor');
    s.start(0);
    s.dropAnchor(1);
    s.stop(4);
    expect(s.phase).toBe('done');
    expect(s.anchors()).toBeNull();
  });

  it('illegal transitions are no-ops that return false', () => {
    const s = new SweepSession();
    expect(s.stop(1)).toBe(false);
    expect(s.declareSpan(24)).toBe(false);
    expect(s.dropAnchor(1)).toBe(false); // not sweeping
    s.start(0);
    expect(s.dropAnchor(1)).toBe(false); // wrong mode (mark)
    expect(s.setMode('paced')).toBe(false); // cannot change mode mid-sweep
    expect(s.start(2)).toBe(false); // already sweeping
    expect(s.declareSpan(0)).toBe(false);
  });

  it('rejects a non-positive or non-finite span', () => {
    const s = new SweepSession();
    s.setMode('paced');
    s.start(0);
    s.stop(8);
    expect(s.declareSpan(0)).toBe(false);
    expect(s.declareSpan(-3)).toBe(false);
    expect(s.declareSpan(NaN)).toBe(false);
    expect(s.phase).toBe('awaitSpan');
  });

  it('anchor taps must move forward in time', () => {
    const s = new SweepSession();
    s.setMode('anchor');
    s.start(0);
    s.dropAnchor(5);
    expect(s.dropAnchor(5)).toBe(false);
    expect(s.dropAnchor(4)).toBe(false);
    expect(s.phase).toBe('sweeping');
  });
});

/* ------------------------------------------------------------------------ */
/* Anchor/span entry parsing (units.parseLength under the hood)              */
/* ------------------------------------------------------------------------ */

describe('parseSpanInches', () => {
  it('reads plain inches, feet, and metric ("24", "2\'", "610mm" all work)', () => {
    expect(parseSpanInches('24')).toBeCloseTo(24, 9);
    expect(parseSpanInches("2'")).toBeCloseTo(24, 9);
    expect(parseSpanInches('610mm')).toBeCloseTo(610 / 25.4, 9);
    expect(parseSpanInches('2′ 6″')).toBeCloseTo(30, 9);
    expect(parseSpanInches('16-1/2')).toBeCloseTo(16.5, 9);
  });

  it('refuses garbage and non-positive spans — no guessing', () => {
    expect(parseSpanInches('')).toBeNull();
    expect(parseSpanInches('about two feet')).toBeNull();
    expect(parseSpanInches('0')).toBeNull();
    expect(parseSpanInches('-12')).toBeNull();
  });
});

/* ------------------------------------------------------------------------ */
/* Vertical-confirm scoring (SPEC §4.1.5)                                    */
/* ------------------------------------------------------------------------ */

describe('scoreAgreement / confirmVerdict', () => {
  it('agrees when every peak repeats within the ¾″ tolerance', () => {
    const score = scoreAgreement([4.0, 20.0], [4.3, 19.7]);
    expect(score.agree).toBe(true);
    expect(score.pairs).toHaveLength(2);
    expect(confirmVerdict(score)).toBe(CONFIRM_AGREE_COPY);
  });

  it('disagrees when peaks move beyond tolerance', () => {
    const score = scoreAgreement([4.0, 20.0], [7.5, 24.0]);
    expect(score.agree).toBe(false);
    expect(confirmVerdict(score)).toBe(CONFIRM_DISAGREE_COPY);
  });

  it('an extra unmatched peak on either pass breaks agreement (strict on purpose)', () => {
    expect(scoreAgreement([4, 20], [4, 20, 11]).agree).toBe(false);
    expect(scoreAgreement([4, 20, 11], [4, 20]).agree).toBe(false);
  });

  it('empty passes never agree', () => {
    expect(scoreAgreement([], []).agree).toBe(false);
    expect(scoreAgreement([4], []).agree).toBe(false);
    expect(scoreAgreement([], [4]).agree).toBe(false);
  });

  it('matches greedily to the nearest partner, order-independent', () => {
    const score = scoreAgreement([20.0, 4.0], [3.8, 20.4]);
    expect(score.agree).toBe(true);
    expect(score.pairs).toEqual([
      [4.0, 3.8],
      [20.0, 20.4],
    ]);
  });
});

/* ------------------------------------------------------------------------ */
/* Manual stud mode arithmetic (SPEC §4.1.9)                                 */
/* ------------------------------------------------------------------------ */

describe('manual mode arithmetic', () => {
  it('predicts 16″ OC centerlines from a corner across 96″ exactly', () => {
    const marks = predictStuds(rational(0), rational(16), 1, rational(96));
    expect(marks.map((m) => m.centerIn)).toEqual([0, 16, 32, 48, 64, 80, 96]);
  });

  it('the ± band grows with distance from the reference', () => {
    const marks = predictStuds(rational(0), rational(16), 1, rational(96));
    const bands = marks.map((m) => m.bandIn);
    for (let i = 1; i < bands.length; i++) expect(bands[i]!).toBeGreaterThan(bands[i - 1]!);
    // Exact formula: base + distance/64.
    expect(bands[0]).toBeCloseTo(MANUAL_BASE_BAND_IN, 12);
    expect(bands[6]).toBeCloseTo(MANUAL_BASE_BAND_IN + 96 * MANUAL_BAND_PER_IN, 12);
    expect(manualBandIn(-32)).toBeCloseTo(manualBandIn(32), 12); // symmetric
  });

  it('19.2″ OC stays exact over five bays (rational arithmetic, no float drift)', () => {
    const oc = OC_CHOICES.find((c) => c.id === '19.2')!;
    const marks = predictStuds(rational(0), oc.inches, 1, rational(96));
    const last = marks[marks.length - 1]!;
    expect(last.center.num).toBe(96n); // 5 × 96/5 = 96 exactly
    expect(last.center.den).toBe(1n);
  });

  it('metric 400 mm OC is exact via 127/5 mm per inch', () => {
    const oc = OC_CHOICES.find((c) => c.id === '400mm')!;
    expect(toNumber(oc.inches)).toBeCloseTo(15.748031496, 6);
    const marks = predictStuds(rational(0), oc.inches, 1, rational(48));
    expect(marks.map((m) => m.centerIn)).toHaveLength(4); // 0, 15.75, 31.5, 47.24
  });

  it('walks the other direction and stays inside [0, span]', () => {
    const marks = predictStuds(rational(90), rational(16), -1, rational(96));
    expect(marks.map((m) => m.centerIn)).toEqual([90, 74, 58, 42, 26, 10]);
    for (const m of marks) {
      expect(m.centerIn).toBeGreaterThanOrEqual(0);
      expect(m.centerIn).toBeLessThanOrEqual(96);
    }
  });

  it('outlet references get the ¾″ stud-side offset in the layout direction', () => {
    expect(toNumber(referenceAdjustment('outlet', 1))).toBeCloseTo(0.75, 12);
    expect(toNumber(referenceAdjustment('outlet', -1))).toBeCloseTo(-0.75, 12);
    expect(toNumber(referenceAdjustment('corner', 1))).toBe(0);
    expect(toNumber(referenceAdjustment('stud', -1))).toBe(0);
  });
});

/* ------------------------------------------------------------------------ */
/* Lattice display derivation (SPEC §4.1.5)                                  */
/* ------------------------------------------------------------------------ */

describe('latticeDisplayLines', () => {
  it('flags lines beyond the swept span as extrapolated (DERIVED, dashed, never orange)', () => {
    const lines = latticeDisplayLines(16, 4, 0, 24, 2);
    const inSpan = lines.filter((l) => !l.extrapolated).map((l) => l.positionIn);
    const beyond = lines.filter((l) => l.extrapolated).map((l) => l.positionIn);
    expect(inSpan).toEqual([4, 20]);
    expect(beyond).toEqual([-28, -12, 36, 52]);
  });

  it('covers exactly extendBays pitches off each edge', () => {
    const lines = latticeDisplayLines(24, 0, 0, 48, 1);
    expect(lines.map((l) => l.positionIn)).toEqual([-24, 0, 24, 48, 72]);
    expect(lines.map((l) => l.extrapolated)).toEqual([true, false, false, false, true]);
  });

  it('returns nothing for a degenerate pitch', () => {
    expect(latticeDisplayLines(0, 4, 0, 24)).toEqual([]);
    expect(latticeDisplayLines(-16, 4, 0, 24)).toEqual([]);
  });
});

describe('latticeStatement', () => {
  it('states phase lock only at ≥3 explained peaks, and labels predictions derived', () => {
    const locked = latticeStatement(
      { pitchIn: 16, phaseIn: 4, rmsIn: 0.1, explained: 3, total: 3 },
      [36, 52],
    );
    expect(locked).toContain('phase locked');
    expect(locked).toContain('derived, not measured');
    const thin = latticeStatement({ pitchIn: 16, phaseIn: 4, rmsIn: 0.1, explained: 2, total: 2 }, []);
    expect(thin).not.toContain('phase locked');
    expect(thin).toContain('thin evidence');
  });

  it('labels metric pitches in their own language', () => {
    expect(pitchLabel(2000 / 127)).toBe('400 mm');
    expect(pitchLabel(3000 / 127)).toBe('600 mm');
    expect(pitchLabel(16)).toBe('16″');
    expect(pitchLabel(19.2)).toBe('19.2″');
  });
});

/* ------------------------------------------------------------------------ */
/* Live feedback (the < 50 ms path)                                          */
/* ------------------------------------------------------------------------ */

describe('stateWordFor / pitchForAnomaly', () => {
  it('maps residual to NOTHING / EDGE / PEAK against the noise floor', () => {
    expect(stateWordFor(0.1, 0.2, 0.4)).toBe('NOTHING');
    expect(stateWordFor(0.5, 0.2, 0.4)).toBe('EDGE'); // ≥2σ but under the 0.4 physical floor ×3.5σ bar
    expect(stateWordFor(2.0, 0.2, 0.4)).toBe('PEAK');
  });

  it('PEAK never fires below the physical prominence floor, however quiet the sensor', () => {
    // σ ≈ 0: bars ride on the physical floor (ADR-011 #3).
    expect(stateWordFor(0.3, 0.001, 0.4)).toBe('EDGE');
    expect(stateWordFor(0.39, 0.001, 0.4)).toBe('EDGE');
    expect(stateWordFor(0.41, 0.001, 0.4)).toBe('PEAK');
  });

  it('tone is silent on a quiet wall and rises monotonically with amplitude', () => {
    expect(pitchForAnomaly(0.05, 0.2, 0.4)).toBe(0);
    let prev = 0;
    for (const amp of [0.5, 1, 2, 3, 5]) {
      const f = pitchForAnomaly(amp, 0.2, 0.4);
      expect(f).toBeGreaterThan(prev);
      prev = f;
    }
    expect(prev).toBeLessThanOrEqual(880);
  });

  it('LiveFeedback detects a bump on a drifting pedestal and reports the haptic moment once', () => {
    const fb = new LiveFeedback(0.4);
    const hz = 40;
    let peaks = 0;
    let entered = 0;
    for (let i = 0; i < 400; i++) {
      const t = i / hz;
      const pedestal = 50 + 0.5 * (t / 10); // slow earth-field drift
      const bump = t > 5 && t < 5.5 ? 4.0 : 0; // fastener-sized anomaly
      const f = fb.push(t, pedestal + bump);
      if (f.word === 'PEAK') peaks++;
      if (f.enteredPeak) entered++;
    }
    expect(peaks).toBeGreaterThan(0);
    expect(entered).toBe(1); // one entry, one haptic pulse
  });

  it('LiveFeedback stays at NOTHING on a quiet drifting wall', () => {
    const fb = new LiveFeedback(0.4);
    for (let i = 0; i < 400; i++) {
      const t = i / 40;
      const f = fb.push(t, 48 + 0.8 * Math.sin(t / 8));
      expect(f.word).toBe('NOTHING');
    }
  });
});

/* ------------------------------------------------------------------------ */
/* Saved measurements (SPEC §8, §15.1)                                       */
/* ------------------------------------------------------------------------ */

function ev(positionIn: number, snr: number, confidence: FastenerEvent['confidence']): FastenerEvent {
  return {
    positionIn,
    amplitudePositionIn: positionIn - 1,
    tSeconds: positionIn / 3,
    snr,
    prominence: 2,
    shapeScore: 0.9,
    confidence,
  };
}

describe('buildStudMeasurements', () => {
  const calibrations = { mag: { ok: true, ageMs: 1000 } };

  it('every saved entry carries unit, uncertainty AND confidence', () => {
    const ms = buildStudMeasurements([ev(4.0, 9.1, 'STRONG'), ev(20.0, 6.0, 'LIKELY')], {
      tier: 'FIELD',
      sampleCount: 320,
      calibrations,
      hasPositions: true,
      capturedAt: 1234,
    });
    expect(ms).toHaveLength(2);
    for (const m of ms) {
      expect(m.kind).toBe('stud');
      expect(m.unit).toBe('in');
      expect(m.uncertainty.plusMinus).toBe(POSITION_PM_IN.FIELD);
      expect(m.uncertainty.basis).toBe('nominal');
      expect(['STRONG', 'LIKELY', 'POSSIBLE', 'NOISE', 'UNRELIABLE']).toContain(m.confidence);
      expect(m.provenance.tier).toBe('FIELD');
      expect(m.provenance.sampleCount).toBe(320);
    }
    expect(new Set(ms.map((m) => m.id)).size).toBe(2); // unique ids
  });

  it('without a declared span the value is honestly in seconds and says so', () => {
    const ms = buildStudMeasurements([ev(NaN, 5, 'LIKELY')], {
      tier: 'FIELD',
      sampleCount: 100,
      calibrations,
      hasPositions: false,
      capturedAt: 1,
    });
    expect(ms[0]!.unit).toBe('s');
    expect(ms[0]!.provenance.notes).toContain('no span declared');
  });

  it('PROXY doubles the position bound and the uncalibrated cap holds STRONG down to LIKELY', () => {
    const proxy = buildStudMeasurements([ev(4, 9, 'LIKELY')], {
      tier: 'PROXY',
      sampleCount: 10,
      calibrations,
      hasPositions: true,
      capturedAt: 1,
    });
    expect(proxy[0]!.uncertainty.plusMinus).toBe(POSITION_PM_IN.PROXY);

    const capped = buildStudMeasurements([ev(4, 9, 'STRONG')], {
      tier: 'FIELD',
      sampleCount: 10,
      calibrations,
      hasPositions: true,
      capAt: 'LIKELY',
      capturedAt: 1,
    });
    expect(capped[0]!.confidence).toBe('LIKELY');
  });
});
