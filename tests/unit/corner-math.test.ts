/**
 * CORNER pure math: gravity assist (§4.3.1.7), consequences (§4.3.4 — trim
 * gap and the rack readout from the rectified quad), uncalibrated-lens
 * widening (§2.3.4), confidence mapping, and per-camera lens lookup.
 * Deterministic throughout; seeded MC only.
 */
import { describe, expect, it } from 'vitest';
import type { CalibrationProfile } from '../../src/types';
import type { Intrinsics, Px } from '../../src/geometry/angleSolver';
import { pitchRollFromGravity } from '../../src/geometry/levelMath';
import {
  angleToAxisDeg,
  cameraLensKey,
  combinedHalfWidthDeg,
  cornerConfidence,
  deviceUpFromPitchRoll,
  downInCamera,
  familyDirections,
  focalSpreadDeg,
  lensForImage,
  plumbAssist,
  rackReadout,
  trimGapIn,
  trimGapPmIn,
} from '../../src/tools/corner/math';
import { cornerWorldQuad, makeProjector } from '../../src/tools/corner/worked';

const K: Intrinsics = { fPx: 1100, cx: 960, cy: 540 };

describe('gravity mapping', () => {
  it('deviceUpFromPitchRoll inverts pitchRollFromGravity', () => {
    for (const [ax, ay, az] of [
      [0, 0, 9.81], // flat, screen up
      [0, 9.81, 0], // upright portrait
      [9.81, 0, 0], // on its left edge
      [2, 3, 8],
    ] as const) {
      const n = Math.hypot(ax, ay, az);
      const { pitch, roll } = pitchRollFromGravity(ax, ay, az);
      const up = deviceUpFromPitchRoll(pitch, roll);
      expect(up[0]).toBeCloseTo(ax / n, 6);
      expect(up[1]).toBeCloseTo(ay / n, 6);
      expect(up[2]).toBeCloseTo(az / n, 6);
    }
  });

  it('an upright portrait phone maps world-down to image-down', () => {
    const { pitch, roll } = pitchRollFromGravity(0, 9.81, 0);
    const down = downInCamera(pitch, roll);
    expect(down[0]).toBeCloseTo(0, 6);
    expect(down[1]).toBeCloseTo(1, 6); // +y in camera = down the image
    expect(down[2]).toBeCloseTo(0, 6);
  });
});

/** Fronto-parallel quad with family 1 rotated `tiltDeg` off image-vertical. */
function tiltedQuad(tiltDeg: number): [Px, Px, Px, Px] {
  const t = (tiltDeg * Math.PI) / 180;
  const v = { x: Math.sin(t), y: -Math.cos(t) }; // family 1, roughly "up"
  const h = { x: Math.cos(t), y: Math.sin(t) }; // family 2, perpendicular
  const p0 = { x: 800, y: 700 };
  const p1 = { x: p0.x + 400 * v.x, y: p0.y + 400 * v.y };
  const p3 = { x: p0.x + 500 * h.x, y: p0.y + 500 * h.y };
  const p2 = { x: p1.x + 500 * h.x, y: p1.y + 500 * h.y };
  return [p0, p1, p2, p3];
}

describe('plumb assist (§4.3.1.7)', () => {
  const downCam = [0, 1, 0] as [number, number, number];

  it('reports out-of-plumb and out-of-level for a slightly tilted frame', () => {
    const dirs = familyDirections(tiltedQuad(1.1), K);
    expect(dirs.ok).toBe(true);
    if (!dirs.ok) return;
    const res = plumbAssist(dirs.d1, dirs.d2, downCam);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.framing.verticalFamily).toBe(1);
    expect(res.framing.offPlumbDeg).toBeCloseTo(1.1, 1);
    expect(res.framing.offLevelDeg).toBeCloseTo(1.1, 1);
  });

  it('refuses honestly when neither family lines up with gravity (45° frame)', () => {
    const dirs = familyDirections(tiltedQuad(45), K);
    expect(dirs.ok).toBe(true);
    if (!dirs.ok) return;
    const res = plumbAssist(dirs.d1, dirs.d2, downCam);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain('omitted');
  });

  it('angleToAxisDeg folds to [0, 90]', () => {
    expect(angleToAxisDeg([0, -1, 0], [0, 1, 0])).toBeCloseTo(0, 6);
    expect(angleToAxisDeg([1, 0, 0], [0, 1, 0])).toBeCloseTo(90, 6);
  });
});

describe('trim gap (§4.3.4)', () => {
  it('gap = L·tan Δ, with first-order propagated ±', () => {
    expect(trimGapIn(96, 1)).toBeCloseTo(96 * Math.tan(Math.PI / 180), 6);
    expect(trimGapIn(96, 0)).toBe(0);
    const pm = trimGapPmIn(96, 1, 0.5);
    expect(pm).toBeCloseTo(96 * (0.5 * Math.PI / 180) / Math.cos(Math.PI / 180) ** 2, 6);
    expect(pm).toBeGreaterThan(0);
  });
});

describe('rack readout (§4.3.4) — rectified quad + declared reference', () => {
  it('a true rectangle reads near-equal diagonals', () => {
    // Rectangle 30 × 20 world units, declared edge P0→P1 = 30 in.
    const project = makeProjector(K, [15, 8, 60], [15, 8, 0], 10);
    const quad = cornerWorldQuad(90).map(project) as [Px, Px, Px, Px];
    const r = rackReadout(quad, K, 30, { seed: 7 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const trueDiag = Math.hypot(30, 20);
    expect(r.diag1In).toBeCloseTo(trueDiag, 1);
    expect(r.diag2In).toBeCloseTo(trueDiag, 1);
    expect(Math.abs(r.diffIn)).toBeLessThanOrEqual(r.pmIn + 0.05);
    expect(r.cornerDeg).toBeCloseTo(90, 1);
  });

  it('a racked frame reads the analytic diagonal difference', () => {
    const theta = 85;
    const project = makeProjector(K, [15, 8, 60], [15, 8, 0], -5);
    const quad = cornerWorldQuad(theta).map(project) as [Px, Px, Px, Px];
    const r = rackReadout(quad, K, 30, { seed: 7 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const th = (theta * Math.PI) / 180;
    const u = [30, 0];
    const w = [20 * Math.cos(th), 20 * Math.sin(th)];
    const d1 = Math.hypot(u[0]! + w[0]!, u[1]! + w[1]!);
    const d2 = Math.hypot(u[0]! - w[0]!, u[1]! - w[1]!);
    expect(r.diffIn).toBeCloseTo(d1 - d2, 1);
    expect(r.cornerDeg).toBeCloseTo(theta, 1);
  });

  it('refuses degenerate input instead of emitting inches', () => {
    const collinear: [Px, Px, Px, Px] = [
      { x: 0, y: 0 },
      { x: 100, y: 1 },
      { x: 200, y: 2 },
      { x: 300, y: 3 },
    ];
    const r = rackReadout(collinear, K, 30);
    expect(r.ok).toBe(false);
    const bad = rackReadout(cornerWorldQuad(90).map((p) => ({ x: p[0], y: p[1] })) as [Px, Px, Px, Px], K, -5);
    expect(bad.ok).toBe(false);
  });

  it('is deterministic for a fixed seed', () => {
    const project = makeProjector(K, [15, 8, 60], [15, 8, 0], 10);
    const quad = cornerWorldQuad(88).map(project) as [Px, Px, Px, Px];
    const a = rackReadout(quad, K, 30, { seed: 42 });
    const b = rackReadout(quad, K, 30, { seed: 42 });
    expect(a).toEqual(b);
  });
});

describe('uncalibrated-lens widening (§2.3.4)', () => {
  it('an oblique view carries real focal sensitivity — spread > 0', () => {
    // Camera well off the plane normal: the recovered angle genuinely moves
    // with the assumed focal, and the widening must say so.
    const project = makeProjector(K, [45, 30, 50], [15, 8, 0], 8);
    const quad = cornerWorldQuad(88.6).map(project) as [Px, Px, Px, Px];
    const spread = focalSpreadDeg(quad, 1920, 1080);
    expect(spread).not.toBeNull();
    expect(spread!).toBeGreaterThan(0.5);
  });

  it('a fronto-parallel view is focal-insensitive — spread ≈ 0, honestly', () => {
    const spread = focalSpreadDeg(tiltedQuad(2), 1920, 1080);
    expect(spread).not.toBeNull();
    expect(spread!).toBeLessThan(0.05);
  });

  it('combines in quadrature and passes MC through when unbounded', () => {
    expect(combinedHalfWidthDeg(0.6, 0.8)).toBeCloseTo(1.0, 6);
    expect(combinedHalfWidthDeg(0.6, null)).toBe(0.6);
  });
});

describe('cornerConfidence', () => {
  it('maps interval width + lens state to the honest states', () => {
    expect(cornerConfidence(0.5, true)).toBe('STRONG');
    expect(cornerConfidence(0.5, false)).toBe('LIKELY');
    expect(cornerConfidence(1.2, true)).toBe('LIKELY');
    expect(cornerConfidence(2.6, true)).toBe('POSSIBLE');
    expect(cornerConfidence(Number.NaN, true)).toBe('POSSIBLE');
  });
});

describe('per-camera lens lookup', () => {
  const profile: CalibrationProfile = {
    deviceKey: 'test',
    updatedAt: 1,
    lens: { 'cam:abc': { fPx: 3000, width: 4000, height: 3000 } },
  };

  it('rescales the stored focal by the long-edge ratio and says CALIBRATED', () => {
    const l = lensForImage(profile, 'cam:abc', 2048, 1536);
    expect(l.calibrated).toBe(true);
    expect(l.k.fPx).toBeCloseTo(3000 * (2048 / 4000), 6);
    expect(l.label).toContain('CALIBRATED');
    expect(l.k.cx).toBe(1024);
  });

  it('applies across a rotation (portrait capture of a landscape-calibrated camera)', () => {
    const l = lensForImage(profile, 'cam:abc', 1536, 2048);
    expect(l.calibrated).toBe(true);
    expect(l.k.fPx).toBeCloseTo(1536, 0);
  });

  it('falls back loudly on aspect mismatch or unknown camera', () => {
    const mismatch = lensForImage(profile, 'cam:abc', 2048, 1152); // 16:9 vs 4:3
    expect(mismatch.calibrated).toBe(false);
    expect(mismatch.label).toContain('not calibrated');
    const unknown = lensForImage(profile, 'cam:zzz', 2048, 1536);
    expect(unknown.calibrated).toBe(false);
    const noKey = lensForImage(profile, null, 2048, 1536);
    expect(noKey.calibrated).toBe(false);
  });

  it('cameraLensKey prefers deviceId, then label, then default', () => {
    expect(cameraLensKey('dev1', 'Back Camera')).toBe('cam:dev1');
    expect(cameraLensKey(undefined, 'Back Camera')).toBe('cam:Back Camera');
    expect(cameraLensKey('', '')).toBe('cam:default');
  });
});
