/**
 * CORNER tool math — pure, deterministic helpers over A3's frozen Phase-1
 * geometry (SPEC §4.3). Owned by A3b (Phase 2). Everything here is
 * unit-tested in tests/unit/corner-math.test.ts; nothing touches the DOM.
 *
 * Contents:
 *  - working-resolution + marking-noise bookkeeping (§4.3.3: σ = 2 px scaled
 *    with zoom level and image resolution);
 *  - magnifier-loupe source-rect math (§4.3.1.2);
 *  - gravity assist: device gravity at shutter → camera frame → plumb-
 *    referenced framing, honestly refused when the geometry does not support
 *    it (§4.3.1.7);
 *  - consequences (§4.3.4): trim gap L·tan Δ with propagated ±, and the rack
 *    readout from the rectified quad + a declared reference dimension;
 *  - uncalibrated-lens widening (§2.3.4): a focal-sweep spread combined in
 *    quadrature with the Monte Carlo half-width — computed, not asserted;
 *  - per-camera lens lookup against CalibrationProfile.lens.
 */
import type { CalibrationProfile, Confidence, Vec3 } from '../../types';
import {
  cornerAngleFromQuad,
  validateQuadGeometry,
  type Intrinsics,
  type Px,
} from '../../geometry/angleSolver';
import { homographyUnitSquareToQuad } from '../../geometry/homography';
import { resolveDirectionSign, vanishingPointsFromH } from '../../geometry/vanishing';
import { vDot, vNormalize } from '../../geometry/vec';
import { mat3FromCols, mat3Inverse, mat3MulVec } from '../../geometry/mat';
import { gaussianSampler, mulberry32, quantileSorted } from '../../geometry/montecarlo';
import { defaultIntrinsics } from '../../geometry/intrinsics';

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/* ------------------------------------------------------------------ */
/* Working resolution + marking noise                                  */
/* ------------------------------------------------------------------ */

/** Cap for the working canvas long edge — SPEC-charter ~2048 px. */
export const WORKING_LONG_EDGE_MAX = 2048;

export interface WorkingSize {
  w: number;
  h: number;
  /** working px per native px (≤ 1). Recorded for pixel-noise bookkeeping. */
  scale: number;
}

/** Downscale a native frame so the long edge fits the working cap. */
export function workingSize(nativeW: number, nativeH: number, maxLongEdge = WORKING_LONG_EDGE_MAX): WorkingSize {
  if (!(nativeW > 0) || !(nativeH > 0)) return { w: 1, h: 1, scale: 1 };
  const long = Math.max(nativeW, nativeH);
  const scale = Math.min(1, maxLongEdge / long);
  return {
    w: Math.max(1, Math.round(nativeW * scale)),
    h: Math.max(1, Math.round(nativeH * scale)),
    scale,
  };
}

export interface SigmaOptions {
  /** Working-canvas px per CSS px of the on-screen image (workingW / cssW). */
  cssToWorkingScale: number;
  /** True when every point was drag-refined under the loupe. */
  allRefined: boolean;
  /** Loupe magnification used while refining. */
  loupeZoom: number;
  /** Touch/marking error at display scale, px. SPEC §4.3.3 default: 2. */
  basePx?: number;
}

/**
 * Marking-noise σ in WORKING-canvas pixels, for the Monte Carlo. A 2 px
 * finger error on screen maps through the display scale; loupe-refined
 * points earn a bounded credit (÷ up to 2 — the loupe helps, it does not
 * make a finger a micrometer). Floored at 0.75 px: sub-pixel marking with a
 * finger is not a credible claim.
 */
export function markingSigmaPx(opts: SigmaOptions): number {
  const base = opts.basePx ?? 2;
  let sigma = base * opts.cssToWorkingScale;
  if (opts.allRefined) sigma /= Math.min(Math.max(opts.loupeZoom, 1), 2);
  return Math.max(0.75, sigma);
}

/* ------------------------------------------------------------------ */
/* Loupe                                                               */
/* ------------------------------------------------------------------ */

export interface LoupeRect { sx: number; sy: number; sw: number; sh: number }

/**
 * Source rect on the working canvas that the loupe magnifies: a square of
 * loupeSizePx/zoom centered on the finger, clamped inside the image so the
 * loupe never shows out-of-image garbage at the edges.
 */
export function loupeSourceRect(
  cx: number,
  cy: number,
  imageW: number,
  imageH: number,
  loupeSizePx: number,
  zoom: number,
): LoupeRect {
  const sw = Math.min(imageW, loupeSizePx / Math.max(zoom, 1));
  const sh = Math.min(imageH, loupeSizePx / Math.max(zoom, 1));
  const sx = Math.min(Math.max(cx - sw / 2, 0), imageW - sw);
  const sy = Math.min(Math.max(cy - sh / 2, 0), imageH - sh);
  return { sx, sy, sw, sh };
}

/* ------------------------------------------------------------------ */
/* Gravity assist (§4.3.1.7) — camera path only                        */
/* ------------------------------------------------------------------ */

/**
 * Device-frame "up" (the low-passed reaction vector direction) from the
 * fusion's pitch/roll (radians). Inverse of levelMath.pitchRollFromGravity:
 * ax = −sin p, ay = cos p sin r, az = cos p cos r (unit norm).
 */
export function deviceUpFromPitchRoll(pitchRad: number, rollRad: number): Vec3 {
  return [
    -Math.sin(pitchRad),
    Math.cos(pitchRad) * Math.sin(rollRad),
    Math.cos(pitchRad) * Math.cos(rollRad),
  ];
}

/**
 * World-down in the REAR-CAMERA frame (x right, y down along the image,
 * z forward into the scene). Device→camera axis map: x_cam = x_dev,
 * y_cam = −y_dev (image y is down, device y is toward the top edge),
 * z_cam = −z_dev (the rear camera looks out the back of the phone).
 */
export function downInCamera(pitchRad: number, rollRad: number): Vec3 {
  const up = deviceUpFromPitchRoll(pitchRad, rollRad);
  // down_dev = −up; then map to camera axes.
  return [-up[0], up[1], up[2]];
}

export type FamilyDirections =
  | { ok: true; d1: Vec3; d2: Vec3 }
  | { ok: false; message: string };

/**
 * The two edge-family 3D directions in camera coordinates for a marked quad,
 * sign-resolved from the image ordering — the same construction the angle
 * solver uses (H columns → K⁻¹v → sign), exposed so the gravity assist can
 * compare them with world-down.
 */
export function familyDirections(quad: readonly [Px, Px, Px, Px], k: Intrinsics): FamilyDirections {
  const shape = validateQuadGeometry(quad);
  if (!shape.ok) return { ok: false, message: shape.message };
  const hres = homographyUnitSquareToQuad(quad);
  if (!hres.ok) return { ok: false, message: hres.message };
  const { v1, v2 } = vanishingPointsFromH(hres.h);
  const s1 = resolveDirectionSign(v1, k, quad[0], quad[1]);
  if (!s1.ok) return { ok: false, message: s1.message };
  const s2 = resolveDirectionSign(v2, k, quad[0], quad[3]);
  if (!s2.ok) return { ok: false, message: s2.message };
  const d1 = vNormalize(s1.d);
  const d2 = vNormalize(s2.d);
  if (!d1 || !d2) return { ok: false, message: 'edge direction is degenerate' };
  return { ok: true, d1, d2 };
}

/** Angle between a direction and an axis, folded to [0°, 90°]. */
export function angleToAxisDeg(d: Vec3, axis: Vec3): number {
  const dn = vNormalize(d);
  const an = vNormalize(axis);
  if (!dn || !an) return NaN;
  const c = Math.min(1, Math.abs(vDot(dn, an)));
  return Math.acos(c) * DEG;
}

export interface PlumbFraming {
  /** Which marked family (1 = P0→P1, 2 = P0→P3) is the near-vertical one. */
  verticalFamily: 1 | 2;
  /** How far the near-vertical family is off plumb, degrees. */
  offPlumbDeg: number;
  /** How far the other family is off level, degrees. */
  offLevelDeg: number;
}

export type PlumbAssistResult =
  | { ok: true; framing: PlumbFraming }
  | { ok: false; reason: string };

/**
 * Plumb-referenced framing: compare both edge-family directions with
 * world-down (from gravity at shutter). Only claims a reference when one
 * family is within maxTiltDeg of vertical AND the other within maxTiltDeg of
 * horizontal — otherwise the assignment is a guess, and we refuse instead
 * (SPEC §15.3).
 */
export function plumbAssist(d1: Vec3, d2: Vec3, downCam: Vec3, maxTiltDeg = 25): PlumbAssistResult {
  const down = vNormalize(downCam);
  if (!down) return { ok: false, reason: 'gravity direction at shutter is degenerate' };
  const a1 = angleToAxisDeg(d1, down);
  const a2 = angleToAxisDeg(d2, down);
  if (!Number.isFinite(a1) || !Number.isFinite(a2)) {
    return { ok: false, reason: 'edge directions are degenerate' };
  }
  const verticalFamily: 1 | 2 = a1 <= a2 ? 1 : 2;
  const offPlumbDeg = Math.min(a1, a2);
  const offLevelDeg = Math.abs(90 - Math.max(a1, a2));
  if (offPlumbDeg > maxTiltDeg) {
    return { ok: false, reason: 'Neither edge family lines up with gravity here — plumb reference omitted.' };
  }
  if (offLevelDeg > maxTiltDeg) {
    return { ok: false, reason: 'The second edge family is far from level — plumb reference omitted.' };
  }
  return { ok: true, framing: { verticalFamily, offPlumbDeg, offLevelDeg } };
}

/* ------------------------------------------------------------------ */
/* Consequences (§4.3.4)                                               */
/* ------------------------------------------------------------------ */

/** Gap at the heel/toe for trim of length L meeting a corner Δ off square. */
export function trimGapIn(lengthIn: number, deltaDeg: number): number {
  return lengthIn * Math.tan(Math.abs(deltaDeg) * RAD);
}

/** First-order propagated ± for the trim gap: L·sec²Δ·δΔ. */
export function trimGapPmIn(lengthIn: number, deltaDeg: number, pmDeg: number): number {
  const d = Math.abs(deltaDeg) * RAD;
  const sec = 1 / Math.cos(d);
  return Math.abs(lengthIn) * sec * sec * (Math.abs(pmDeg) * RAD);
}

/**
 * Rectify a declared parallelogram (a racked rectangle IS a parallelogram)
 * via the depth solve: rays rᵢ = K⁻¹pᵢ, X0 + X2 = X1 + X3 with λ0 ≡ 1.
 * Returns the two edge vectors u = X1−X0, w = X3−X0 in camera units (scale
 * unobservable), or null when degenerate.
 */
export function rectifyParallelogram(
  quad: readonly [Px, Px, Px, Px],
  k: Intrinsics,
): { u: Vec3; w: Vec3 } | null {
  const rays = quad.map((p): Vec3 => [(p.x - k.cx) / k.fPx, (p.y - k.cy) / k.fPx, 1]);
  const r0 = rays[0]!;
  const r1 = rays[1]!;
  const r2 = rays[2]!;
  const r3 = rays[3]!;
  const m = mat3FromCols(r1, [-r2[0], -r2[1], -r2[2]], r3);
  const mInv = mat3Inverse(m);
  if (!mInv) return null;
  const lam = mat3MulVec(mInv, r0);
  if (!(lam[0] > 0 && lam[1] > 0 && lam[2] > 0)) return null;
  const u: Vec3 = [lam[0] * r1[0] - r0[0], lam[0] * r1[1] - r0[1], lam[0] * r1[2] - r0[2]];
  const w: Vec3 = [lam[2] * r3[0] - r0[0], lam[2] * r3[1] - r0[1], lam[2] * r3[2] - r0[2]];
  return { u, w };
}

export interface RackOptions {
  sigmaPx?: number;
  samples?: number;
  seed?: number;
  maxRefusalFraction?: number;
}

export type RackResult =
  | {
      ok: true;
      /** |P0→P2| diagonal, inches (scaled by the declared reference edge). */
      diag1In: number;
      /** |P1→P3| diagonal, inches. */
      diag2In: number;
      /** Signed difference diag1 − diag2, inches (median of the MC). */
      diffIn: number;
      /** Half-width of the 5–95% MC interval on the difference, inches. */
      pmIn: number;
      cornerDeg: number;
    }
  | { ok: false; reason: 'POOR_GEOMETRY'; message: string };

const vlen = (v: Vec3): number => Math.hypot(v[0], v[1], v[2]);

/**
 * Rack readout — SPEC §4.3.4: the difference between the two diagonals of a
 * DECLARED rectangle, from the rectified quad and a declared reference
 * dimension (the real length of edge P0→P1). Uncertainty by seeded Monte
 * Carlo over the marked corners; deterministic for a given seed.
 */
export function rackReadout(
  quad: readonly [Px, Px, Px, Px],
  k: Intrinsics,
  refLenIn: number,
  opts: RackOptions = {},
): RackResult {
  if (!(refLenIn > 0) || !Number.isFinite(refLenIn)) {
    return { ok: false, reason: 'POOR_GEOMETRY', message: 'reference dimension must be a positive length' };
  }
  const shape = validateQuadGeometry(quad);
  if (!shape.ok) return { ok: false, reason: 'POOR_GEOMETRY', message: shape.message };

  const solveDiff = (q: readonly [Px, Px, Px, Px]): { diff: number; d1: number; d2: number; corner: number } | null => {
    const rect = rectifyParallelogram(q, k);
    if (!rect) return null;
    const lu = vlen(rect.u);
    const lw = vlen(rect.w);
    if (!(lu > 0) || !(lw > 0)) return null;
    const scale = refLenIn / lu;
    const sum: Vec3 = [rect.u[0] + rect.w[0], rect.u[1] + rect.w[1], rect.u[2] + rect.w[2]];
    const dif: Vec3 = [rect.u[0] - rect.w[0], rect.u[1] - rect.w[1], rect.u[2] - rect.w[2]];
    const d1 = vlen(sum) * scale;
    const d2 = vlen(dif) * scale;
    const c = Math.min(1, Math.max(-1, vDot(rect.u, rect.w) / (lu * lw)));
    return { diff: d1 - d2, d1, d2, corner: Math.acos(c) * DEG };
  };

  const base = solveDiff(quad);
  if (!base) {
    return {
      ok: false,
      reason: 'POOR_GEOMETRY',
      message: 'the marked quad cannot be rectified — re-mark the four corners',
    };
  }

  const sigmaPx = opts.sigmaPx ?? 2;
  const samples = opts.samples ?? 200;
  const maxRefusalFraction = opts.maxRefusalFraction ?? 0.25;
  const gauss = gaussianSampler(mulberry32(opts.seed ?? 0xac5e));
  const diffs: number[] = [];
  let refused = 0;
  for (let i = 0; i < samples; i++) {
    const perturbed = quad.map((p) => ({
      x: p.x + sigmaPx * gauss(),
      y: p.y + sigmaPx * gauss(),
    })) as [Px, Px, Px, Px];
    const r = solveDiff(perturbed);
    if (r) diffs.push(r.diff);
    else refused++;
  }
  if (refused / samples > maxRefusalFraction) {
    return {
      ok: false,
      reason: 'POOR_GEOMETRY',
      message: 'the rack estimate is fragile under marking noise — re-mark with the loupe or move back',
    };
  }
  diffs.sort((a, b) => a - b);
  const p5 = quantileSorted(diffs, 0.05);
  const p95 = quantileSorted(diffs, 0.95);
  return {
    ok: true,
    diag1In: base.d1,
    diag2In: base.d2,
    diffIn: quantileSorted(diffs, 0.5),
    pmIn: (p95 - p5) / 2,
    cornerDeg: base.corner,
  };
}

/* ------------------------------------------------------------------ */
/* Uncalibrated-lens widening (§2.3.4)                                 */
/* ------------------------------------------------------------------ */

/** Plausible phone main-camera horizontal FOV band when uncalibrated. */
export const HFOV_BAND_DEG = { lo: 57, hi: 77 } as const;

/**
 * Half-spread of the solved angle across the plausible focal band — the
 * honest widening for an uncalibrated lens, computed from THIS quad rather
 * than asserted. Null when the sweep cannot be evaluated (a refusal at
 * either end): the caller keeps the MC ± and the banner still states the
 * ±1.5–3° expectation.
 */
export function focalSpreadDeg(
  quad: readonly [Px, Px, Px, Px],
  imageW: number,
  imageH: number,
): number | null {
  const kLo = defaultIntrinsics(imageW, imageH, HFOV_BAND_DEG.lo);
  const kHi = defaultIntrinsics(imageW, imageH, HFOV_BAND_DEG.hi);
  const q = quad as [Px, Px, Px, Px];
  const a = cornerAngleFromQuad(q, { fPx: kLo.fPx, cx: kLo.cx, cy: kLo.cy });
  const b = cornerAngleFromQuad(q, { fPx: kHi.fPx, cx: kHi.cx, cy: kHi.cy });
  if (!a.ok || !b.ok) return null;
  return Math.abs(a.thetaDeg - b.thetaDeg) / 2;
}

/** Combine the MC half-width with the focal-sweep spread in quadrature. */
export function combinedHalfWidthDeg(mcHalfDeg: number, spreadDeg: number | null): number {
  if (spreadDeg === null) return mcHalfDeg;
  return Math.hypot(mcHalfDeg, spreadDeg);
}

/* ------------------------------------------------------------------ */
/* Confidence + display gates                                          */
/* ------------------------------------------------------------------ */

/** MC half-width beyond which the poor-geometry guidance card shows (§4.3.3). */
export const POOR_GEOMETRY_HALF_WIDTH_DEG = 2.5;

/**
 * Confidence for a corner reading. STRONG needs a calibrated lens and a
 * tight interval (§2.3.4's calibrated band); an interval past ±2.5° is
 * POSSIBLE and triggers the guidance card. UNRELIABLE never appears here —
 * an unreliable solve is a refusal, not a number.
 */
export function cornerConfidence(halfWidthDeg: number, lensCalibrated: boolean): Confidence {
  if (!Number.isFinite(halfWidthDeg) || halfWidthDeg > POOR_GEOMETRY_HALF_WIDTH_DEG) return 'POSSIBLE';
  if (lensCalibrated && halfWidthDeg <= 0.8) return 'STRONG';
  return 'LIKELY';
}

/* ------------------------------------------------------------------ */
/* Per-camera lens lookup                                              */
/* ------------------------------------------------------------------ */

/** Stable-ish key for CalibrationProfile.lens, per camera track. */
export function cameraLensKey(deviceId?: string, label?: string): string {
  const id = (deviceId && deviceId.trim()) || (label && label.trim()) || 'default';
  return `cam:${id}`;
}

export interface LensChoice {
  k: Intrinsics;
  calibrated: boolean;
  /** UI line — says which state is in effect (SPEC §2.3.4). */
  label: string;
}

/**
 * Intrinsics for an image: the stored per-camera calibration when the key
 * matches and the aspect agrees (focal rescaled by the long-edge ratio —
 * f scales with pixel pitch), else the FOV default, loudly uncalibrated.
 */
export function lensForImage(
  profile: CalibrationProfile,
  key: string | null,
  imageW: number,
  imageH: number,
): LensChoice {
  const stored = key ? profile.lens?.[key] : undefined;
  if (stored && stored.width > 0 && stored.height > 0) {
    const imgLong = Math.max(imageW, imageH);
    const imgShort = Math.min(imageW, imageH);
    const stLong = Math.max(stored.width, stored.height);
    const stShort = Math.min(stored.width, stored.height);
    const aspectDelta = Math.abs(imgLong / imgShort - stLong / stShort) / (stLong / stShort);
    if (aspectDelta <= 0.03) {
      const fPx = stored.fPx * (imgLong / stLong);
      return {
        k: { fPx, cx: imageW / 2, cy: imageH / 2 },
        calibrated: true,
        label: `LENS: CALIBRATED (f = ${Math.round(fPx)} px)`,
      };
    }
  }
  const d = defaultIntrinsics(imageW, imageH);
  return {
    k: { fPx: d.fPx, cx: d.cx, cy: d.cy },
    calibrated: false,
    label: `LENS: ESTIMATED (f ≈ ${Math.round(d.fPx)} px, ${d.hFovDeg}° FOV assumed) — not calibrated`,
  };
}
