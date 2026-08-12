/**
 * CALIBRATE pure logic (SPEC §4.6): pass/fail gates over the REAL fits —
 * including the 40 µT accessory failure with its verbatim message — the
 * 9-point locator peak fit, the reversal-zero capture algebra, the lens
 * acceptance gate, the rate counter, and the diagnostics blob shape.
 * Deterministic; seeded synthesis only.
 */
import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../src/types';
import { fitEllipsoid, HARD_IRON_ACCESSORY_UT } from '../../src/dsp/calibration';
import { WARNING_COPY } from '../../src/ui/components/warning';
import { calibrateFromSheet, SHEET_ASPECT } from '../../src/geometry/intrinsics';
import type { Intrinsics, Px } from '../../src/geometry/angleSolver';
import { makeProjector } from '../../src/tools/corner/worked';
import { cleanPhoneStream, magsafeStream, synthFigure8 } from '../../src/tools/calibrate/synth';
import {
  buildDiagnostics,
  CoverageTracker,
  evaluateLensResult,
  evaluateMagFit,
  fitPeak2D,
  formatAge,
  lensFocalUncertainty,
  loadOutcomes,
  LOCATOR_GRID,
  MAG_RESIDUAL_MAX,
  octantCell,
  octantIndex,
  RateCounter,
  reversalFromCaptures,
  saveOutcome,
  StillnessCapture,
  windowAmplitude,
  type OutcomeStorage,
} from '../../src/tools/calibrate/logic';

describe('mag routine pass/fail (§4.6.1) — over the REAL ellipsoid fit', () => {
  it('a clean phone passes: residual < 5%, all octants, |b| recovered', () => {
    const { points, truthHardIron } = cleanPhoneStream();
    const fit = fitEllipsoid(points);
    const ev = evaluateMagFit(fit);
    expect(fit.ok).toBe(true);
    expect(ev.pass).toBe(true);
    expect(ev.accessory).toBe(false);
    expect(ev.residual).toBeLessThan(MAG_RESIDUAL_MAX);
    expect(ev.coverage).toBe(1);
    const truthMag = Math.hypot(...truthHardIron);
    expect(Math.abs(ev.hardIronUt - truthMag)).toBeLessThan(1);
  });

  it('|b| > 40 µT fails LOUDLY with the verbatim accessory message, never stored as ok', () => {
    const { points, truthHardIron } = magsafeStream();
    expect(Math.hypot(...truthHardIron)).toBeGreaterThan(HARD_IRON_ACCESSORY_UT);
    const ev = evaluateMagFit(fitEllipsoid(points));
    expect(ev.pass).toBe(false);
    expect(ev.accessory).toBe(true);
    expect(ev.reasons).toContain(WARNING_COPY.MAGNETIC_ACCESSORY);
    expect(ev.hardIronUt).toBeGreaterThan(HARD_IRON_ACCESSORY_UT);
  });

  it('poor coverage cannot pass', () => {
    // Upper-hemisphere-only sweep: directions never reach z < 0 octants.
    const points = synthFigure8({
      radiusUt: 48,
      hardIronUt: [5, 5, 5],
      softStretch: [1, 1, 1],
      noiseUt: 0.3,
      samples: 400,
      seed: 11,
    }).map((p): Vec3 => [p[0], p[1], Math.abs(p[2] - 5) + 5]);
    const ev = evaluateMagFit(fitEllipsoid(points));
    expect(ev.pass).toBe(false);
  });

  it('a failed fit reports its reason and fails', () => {
    const ev = evaluateMagFit(fitEllipsoid([[1, 2, 3] as Vec3]));
    expect(ev.pass).toBe(false);
    expect(ev.reasons.length).toBeGreaterThan(0);
  });
});

describe('octant bookkeeping', () => {
  it('octantIndex/octantCell map the 8 octants onto 8 distinct grid cells', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 8; i++) {
      const { row, col } = octantCell(i);
      seen.add(`${row},${col}`);
    }
    expect(seen.size).toBe(8);
    expect(octantIndex([1, 1, 1], [0, 0, 0])).toBe(7);
    expect(octantIndex([-1, -1, -1], [0, 0, 0])).toBe(0);
  });

  it('CoverageTracker fills all octants around the RUNNING center, not the origin', () => {
    const tracker = new CoverageTracker();
    // All samples share a big positive offset — around the origin they would
    // land in one octant; around their own center they cover all eight.
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
      for (let n = 0; n < 6; n++) tracker.push([100 + x * (2 + n * 0.1), 100 + y * 2, 100 + z * 2]);
    }
    expect(tracker.filledCount(5)).toBe(8);
    expect(tracker.center[0]).toBeCloseTo(100, 0);
  });
});

describe('sensor locator 9-point peak fit (§4.1.3)', () => {
  it('recovers a known dome peak from the 9 grid amplitudes', () => {
    const peak = { x: 0.62, y: 0.18 };
    const amps = LOCATOR_GRID.map((g) => ({
      x: g.x,
      y: g.y,
      amp: 30 - 40 * ((g.x - peak.x) ** 2 + (g.y - peak.y) ** 2),
    }));
    const fit = fitPeak2D(amps);
    expect(fit.ok).toBe(true);
    if (fit.ok) {
      expect(fit.x).toBeCloseTo(peak.x, 2);
      expect(fit.y).toBeCloseTo(peak.y, 2);
    }
  });

  it('refuses a flat field — the swing a real screw produces is absent', () => {
    const fit = fitPeak2D(LOCATOR_GRID.map((g) => ({ x: g.x, y: g.y, amp: 50.2 })));
    expect(fit.ok).toBe(false);
    if (!fit.ok) expect(fit.reason).toContain('swing');
  });

  it('refuses a ramp — no interior dome anywhere on screen', () => {
    const fit = fitPeak2D(LOCATOR_GRID.map((g) => ({ x: g.x, y: g.y, amp: 10 + 20 * g.x })));
    expect(fit.ok).toBe(false);
  });

  it('windowAmplitude is the median — robust to a spike', () => {
    expect(windowAmplitude([50, 51, 49, 50, 400])).toBe(50);
    expect(Number.isNaN(windowAmplitude([]))).toBe(true);
  });
});

describe('level reversal zero (§4.2.2)', () => {
  it('StillnessCapture waits, holds, then reports mean ± sd in degrees', () => {
    const cap = new StillnessCapture(1000);
    // Motion first — must not count.
    let st = cap.push({ t: 0, pitch: 0.1, roll: 0, stable: false });
    expect(st.state).toBe('waiting');
    // 61 stable samples at 60 Hz spanning slightly over 1 s.
    const pitchRad = 0.02;
    const rollRad = -0.01;
    for (let i = 0; i <= 61; i++) {
      st = cap.push({ t: 1 + i / 60, pitch: pitchRad, roll: rollRad, stable: true });
    }
    expect(st.state).toBe('done');
    expect(st.mean!.pitchDeg).toBeCloseTo((pitchRad * 180) / Math.PI, 4);
    expect(st.mean!.rollDeg).toBeCloseTo((rollRad * 180) / Math.PI, 4);
    expect(st.sd!.pitchDeg).toBeCloseTo(0, 4);
  });

  it('motion resets the hold window', () => {
    const cap = new StillnessCapture(1000);
    for (let i = 0; i < 30; i++) cap.push({ t: i / 60, pitch: 0, roll: 0, stable: true });
    const bumped = cap.push({ t: 0.51, pitch: 0.3, roll: 0, stable: false });
    expect(bumped.state).toBe('waiting');
    const resumed = cap.push({ t: 0.6, pitch: 0, roll: 0, stable: true });
    expect(resumed.state).toBe('holding');
    expect(resumed.progress).toBeLessThan(0.2);
  });

  it('reversalFromCaptures splits surface from sensor bias per axis', () => {
    // Surface really tilts +0.40° pitch / −0.10° roll; sensor bias +0.25° / +0.15°.
    const m1 = { pitchDeg: 0.4 + 0.25, rollDeg: -0.1 + 0.15 };
    const m2 = { pitchDeg: -0.4 + 0.25, rollDeg: 0.1 + 0.15 };
    const r = reversalFromCaptures(m1, m2);
    expect(r.biasDeg.pitchDeg).toBeCloseTo(0.25, 10);
    expect(r.biasDeg.rollDeg).toBeCloseTo(0.15, 10);
    expect(r.surfaceDeg.pitchDeg).toBeCloseTo(0.4, 10);
    expect(r.surfaceDeg.rollDeg).toBeCloseTo(-0.1, 10);
  });
});

describe('lens routine gate (§4.3.2)', () => {
  const K: Intrinsics = { fPx: 1123, cx: 960, cy: 540 };

  /** Letter sheet (11 × 8.5) on z=0, photographed obliquely through known K. */
  function sheetQuad(): [Px, Px, Px, Px] {
    const project = makeProjector(K, [18, 14, 24], [5.5, 4.25, 0], 6);
    const world: Array<[number, number, number]> = [
      [0, 0, 0],
      [11, 0, 0], // long edge first — the SHEET_ASPECT numerator
      [11, 8.5, 0],
      [0, 8.5, 0],
    ];
    return world.map(project) as [Px, Px, Px, Px];
  }

  it('accepts a good sheet solve and the REAL fit recovers the true focal', () => {
    const res = calibrateFromSheet(sheetQuad(), SHEET_ASPECT.letter, 1920, 1080);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(Math.abs(res.fPx - K.fPx) / K.fPx).toBeLessThan(0.02);
    const ev = evaluateLensResult(res);
    expect(ev.pass).toBe(true);
    const pm = lensFocalUncertainty(sheetQuad(), SHEET_ASPECT.letter, 1920, 1080, { seed: 3 });
    expect(pm).not.toBeNull();
    expect(pm!).toBeGreaterThan(0);
  });

  it('rejects a high residual — nothing gets stored on a bad solve', () => {
    const ev = evaluateLensResult({
      ok: true,
      fPx: 1000,
      squareResidualDeg: 2.4,
      aspectResidual: 1e-6,
      rectifiedAspect: SHEET_ASPECT.letter,
    });
    expect(ev.pass).toBe(false);
    expect(ev.reasons[0]).toContain('re-mark');
  });

  it('propagates a refusal from the solver', () => {
    const ev = evaluateLensResult({ ok: false, reason: 'POOR_GEOMETRY', message: 'square-on view' });
    expect(ev.pass).toBe(false);
    expect(ev.reasons[0]).toContain('square-on');
  });
});

describe('SELF-TEST helpers', () => {
  it('RateCounter measures a 50 Hz stream over its sliding window', () => {
    const rc = new RateCounter(3);
    for (let i = 0; i < 200; i++) rc.push(i / 50);
    expect(rc.hz()).toBeCloseTo(50, 0);
    const sparse = new RateCounter(3);
    sparse.push(0);
    expect(sparse.hz()).toBe(0);
  });

  it('buildDiagnostics produces the stable JSON blob shape', () => {
    const blob = buildDiagnostics({
      capability: {
        magTier: 'PROXY',
        hasAccel: true,
        hasGyro: true,
        hasAbsoluteOrientation: false,
        hasCamera: true,
        cameraCount: 2,
        hasVibrate: false,
        hasWakeLock: true,
        hasOffscreenCanvas: true,
        secureContext: true,
        permissionsPolicyOk: true,
        platformHint: 'ios',
        sampleRates: {},
        blockers: [],
      },
      profile: { deviceKey: 'd', updatedAt: 0 },
      outcomes: { mag: { at: 1, pass: false, note: 'accessory' } },
      rates: { motionHz: 59.7, magHz: null },
      permissions: { camera: 'granted' },
      lastError: null,
      now: new Date(0),
    });
    expect(blob.schema).toBe('square.diagnostics/1');
    expect(blob.at).toBe('1970-01-01T00:00:00.000Z');
    const round = JSON.parse(JSON.stringify(blob)) as typeof blob;
    expect(round).toEqual(blob);
    expect(round.calibration.outcomes.mag?.pass).toBe(false);
    expect(round.rates['magHz']).toBeNull();
  });

  it('formatAge speaks in honest units', () => {
    expect(formatAge(null)).toBe('never');
    expect(formatAge(5_000)).toBe('just now');
    expect(formatAge(5 * 60_000)).toBe('5 min ago');
    expect(formatAge(3 * 3_600_000)).toBe('3 h ago');
    expect(formatAge(50 * 3_600_000)).toBe('2 d ago');
  });

  it('outcome store round-trips and shrugs off corruption', () => {
    const m = new Map<string, string>();
    const storage: OutcomeStorage = { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v) };
    saveOutcome('lens', { at: 5, pass: true, note: 'f = 1100 px' }, storage);
    saveOutcome('mag', { at: 6, pass: false, note: 'accessory' }, storage);
    const loaded = loadOutcomes(storage);
    expect(loaded.lens?.pass).toBe(true);
    expect(loaded.mag?.note).toBe('accessory');
    m.set('square.calibrate.outcomes.v1', '{not json');
    expect(loadOutcomes(storage)).toEqual({});
  });
});
