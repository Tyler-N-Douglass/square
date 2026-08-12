/**
 * Camera intrinsics: honest defaults and known-sheet lens calibration —
 * SPEC §4.3.2. Owned by A3 (Geometry/Vision). Tested in
 * tests/unit/geometry-intrinsics.test.ts.
 *
 * Model everywhere: pinhole, square pixels, zero skew, principal point at the
 * image center — K = [[f,0,cx],[0,f,cy],[0,0,1]]. These assumptions are
 * stated in the UI (SPEC §4.3.1.1) and in docs/physics-geometry.md.
 *
 * Calibration method (documented in docs/physics-geometry.md §lens):
 * the user photographs a sheet of known aspect ratio (US Letter 11/8.5,
 * A4 297/210) and marks its four corners in the CORNER order (P0, then P1
 * along the LONG edge, P2 diagonal, P3 along the short edge — or any order
 * consistent with the sheetAspect passed in). For a candidate focal f:
 *   rays rᵢ = K⁻¹·pᵢ point from the camera center at each corner, so the
 *   world corners are Xᵢ = λᵢ·rᵢ. A rectangle is a parallelogram:
 *   X0 + X2 = X1 + X3, which with λ0 ≡ 1 (overall scale is unobservable) is
 *   a 3×3 linear system for (λ1, λ2, λ3). Then u = X1 − X0, w = X3 − X0 and
 *   aspect(f) = |u|/|w|. aspect(f) is monotone-in-practice and we solve
 *   aspect(f) = sheetAspect by log-grid search + golden-section refinement.
 * The residual quality metric is the rectified corner angle's deviation from
 * 90° at the solved f (the rectangle's SECOND constraint, orthogonality,
 * which the fit never used — a genuinely independent check): 0° would be a
 * perfect rectangle; > ~1° means poorly marked corners or real distortion.
 *
 * Refusals: a sheet photographed square-on carries no focal information
 * (aspect(f) is constant); we say so instead of returning an arbitrary f.
 */
import type { Vec3 } from '../types';
import { mat3FromCols, mat3Inverse, mat3MulVec } from './mat';
import { vDot, vLen, vSub } from './vec';
import type { Intrinsics, Px } from './angleSolver';

/** Known sheet aspect ratios (long edge / short edge). */
export const SHEET_ASPECT = {
  letter: 11 / 8.5,
  a4: 297 / 210,
} as const;

export interface IntrinsicsEstimate extends Intrinsics {
  /** True until calibrateFromSheet has produced a per-device focal. */
  uncalibrated: boolean;
  /** The horizontal FOV assumption the default focal was derived from. */
  hFovDeg: number;
}

/**
 * Uncalibrated default: f = (imageW/2)/tan(hFov/2), principal point at the
 * image center. hFov defaults to 67° (typical phone main camera) per SPEC
 * §4.3.2; the UI must display the uncalibrated state (LENS_UNCALIBRATED).
 */
export function defaultIntrinsics(imageW: number, imageH: number, hFovDeg = 67): IntrinsicsEstimate {
  const half = ((hFovDeg / 2) * Math.PI) / 180;
  return {
    fPx: imageW / 2 / Math.tan(half),
    cx: imageW / 2,
    cy: imageH / 2,
    uncalibrated: true,
    hFovDeg,
  };
}

export type SheetCalibrationResult =
  | {
      ok: true;
      /** Solved focal length in pixels for this image resolution. */
      fPx: number;
      /** Primary quality metric: |90° − rectified corner angle| at fPx, degrees. */
      squareResidualDeg: number;
      /** |aspect(fPx)/sheetAspect − 1| — how exactly the search converged. */
      aspectResidual: number;
      /** The rectified aspect ratio actually achieved. */
      rectifiedAspect: number;
    }
  | { ok: false; reason: 'POOR_GEOMETRY'; message: string };

/** Search bracket around the FOV-default guess, and refusal thresholds. */
const SEARCH = {
  bracketLo: 0.1, // × default-f guess
  bracketHi: 10, // × default-f guess
  gridPoints: 121,
  goldenIters: 80,
  /** Below this relative aspect variation across the whole bracket, the view is fronto-parallel: no focal information. */
  minAspectSwing: 5e-3,
  /** A solution this close to the bracket edge is not a solution. */
  edgeMargin: 1.02,
} as const;

interface Rectified { aspect: number; cosCorner: number }

/** Rectify the sheet quad at focal f via the parallelogram depth solve. Null = invalid at this f. */
function rectifyAt(quad: readonly [Px, Px, Px, Px], f: number, cx: number, cy: number): Rectified | null {
  const rays: Vec3[] = quad.map((p): Vec3 => [(p.x - cx) / f, (p.y - cy) / f, 1]);
  const r0 = rays[0]!;
  const r1 = rays[1]!;
  const r2 = rays[2]!;
  const r3 = rays[3]!;
  // λ1·r1 − λ2·r2 + λ3·r3 = r0, λ0 ≡ 1.
  const m = mat3FromCols(r1, [-r2[0], -r2[1], -r2[2]], r3);
  const mInv = mat3Inverse(m);
  if (!mInv) return null;
  const lam = mat3MulVec(mInv, r0);
  // All corners must sit in front of the camera on the same side.
  if (!(lam[0] > 0 && lam[1] > 0 && lam[2] > 0)) return null;
  const u = vSub([lam[0] * r1[0], lam[0] * r1[1], lam[0] * r1[2]], r0); // X1 − X0
  const w = vSub([lam[2] * r3[0], lam[2] * r3[1], lam[2] * r3[2]], r0); // X3 − X0
  const lu = vLen(u);
  const lw = vLen(w);
  if (!(lu > 0) || !(lw > 0)) return null;
  const aspect = lu / lw;
  const cosCorner = vDot(u, w) / (lu * lw);
  if (!Number.isFinite(aspect) || !Number.isFinite(cosCorner)) return null;
  return { aspect, cosCorner };
}

/**
 * Solve for the focal length that makes the rectified sheet match the known
 * aspect ratio. quadPx uses the CORNER point order with P0→P1 along the edge
 * whose world length is the numerator of sheetAspect.
 */
export function calibrateFromSheet(
  quadPx: readonly [Px, Px, Px, Px],
  sheetAspect: number,
  imageW: number,
  imageH: number,
): SheetCalibrationResult {
  if (!Number.isFinite(sheetAspect) || sheetAspect <= 0) {
    return { ok: false, reason: 'POOR_GEOMETRY', message: 'sheet aspect ratio must be positive' };
  }
  if (!(imageW > 0) || !(imageH > 0)) {
    return { ok: false, reason: 'POOR_GEOMETRY', message: 'image dimensions must be positive' };
  }
  for (const p of quadPx) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      return { ok: false, reason: 'POOR_GEOMETRY', message: 'sheet corners have non-finite coordinates' };
    }
  }
  const cx = imageW / 2;
  const cy = imageH / 2;
  const fGuess = defaultIntrinsics(imageW, imageH).fPx;
  const target = Math.log(sheetAspect);
  const cost = (f: number): number | null => {
    const r = rectifyAt(quadPx, f, cx, cy);
    if (!r) return null;
    const e = Math.log(r.aspect) - target;
    return e * e;
  };

  // Log-spaced grid over the bracket.
  const tLo = Math.log(fGuess * SEARCH.bracketLo);
  const tHi = Math.log(fGuess * SEARCH.bracketHi);
  let bestI = -1;
  let bestE = Infinity;
  let minAspect = Infinity;
  let maxAspect = 0;
  let validCount = 0;
  const ts: number[] = [];
  const es: Array<number | null> = [];
  for (let i = 0; i < SEARCH.gridPoints; i++) {
    const t = tLo + ((tHi - tLo) * i) / (SEARCH.gridPoints - 1);
    ts.push(t);
    const r = rectifyAt(quadPx, Math.exp(t), cx, cy);
    if (!r) {
      es.push(null);
      continue;
    }
    validCount++;
    minAspect = Math.min(minAspect, r.aspect);
    maxAspect = Math.max(maxAspect, r.aspect);
    const e = Math.log(r.aspect) - target;
    es.push(e * e);
    if (e * e < bestE) {
      bestE = e * e;
      bestI = i;
    }
  }
  if (validCount < 10 || bestI < 0) {
    return {
      ok: false,
      reason: 'POOR_GEOMETRY',
      message: 'sheet corners do not form a usable perspective view — re-mark the four corners',
    };
  }
  if ((maxAspect - minAspect) / sheetAspect < SEARCH.minAspectSwing) {
    return {
      ok: false,
      reason: 'POOR_GEOMETRY',
      message:
        'sheet is square-on to the camera, which carries no focal information — re-shoot at a moderate angle (~30°)',
    };
  }

  // Golden-section refinement in log-f between the grid neighbors of the best point.
  let lo = ts[Math.max(0, bestI - 1)]!;
  let hi = ts[Math.min(SEARCH.gridPoints - 1, bestI + 1)]!;
  const phi = (Math.sqrt(5) - 1) / 2;
  let t1 = hi - phi * (hi - lo);
  let t2 = lo + phi * (hi - lo);
  let e1 = cost(Math.exp(t1));
  let e2 = cost(Math.exp(t2));
  for (let iter = 0; iter < SEARCH.goldenIters; iter++) {
    const c1 = e1 ?? Infinity;
    const c2 = e2 ?? Infinity;
    if (c1 <= c2) {
      hi = t2;
      t2 = t1;
      e2 = e1;
      t1 = hi - phi * (hi - lo);
      e1 = cost(Math.exp(t1));
    } else {
      lo = t1;
      t1 = t2;
      e1 = e2;
      t2 = lo + phi * (hi - lo);
      e2 = cost(Math.exp(t2));
    }
  }
  const fSolved = Math.exp((lo + hi) / 2);
  const atEdge =
    fSolved <= fGuess * SEARCH.bracketLo * SEARCH.edgeMargin ||
    fSolved >= (fGuess * SEARCH.bracketHi) / SEARCH.edgeMargin;
  const rect = rectifyAt(quadPx, fSolved, cx, cy);
  if (!rect || atEdge) {
    return {
      ok: false,
      reason: 'POOR_GEOMETRY',
      message: 'no plausible focal length matches this sheet — re-mark the corners and re-shoot',
    };
  }
  const cornerDeg = (Math.acos(Math.min(1, Math.max(-1, rect.cosCorner))) * 180) / Math.PI;
  return {
    ok: true,
    fPx: fSolved,
    squareResidualDeg: Math.abs(90 - cornerDeg),
    aspectResidual: Math.abs(rect.aspect / sheetAspect - 1),
    rectifiedAspect: rect.aspect,
  };
}
