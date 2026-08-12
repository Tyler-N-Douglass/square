/**
 * Intrinsics tests — SPEC §4.3.2, §10.1. Owned by A3 (Geometry/Vision).
 * The sheet-calibration ground truth is synthesized with a locally-derived
 * pinhole projector (independent of src/geometry). Seeded randomness only.
 */
import { describe, expect, it } from 'vitest';
import type { Px } from '../../src/geometry/angleSolver';
import { calibrateFromSheet, defaultIntrinsics, SHEET_ASPECT } from '../../src/geometry/intrinsics';
import { gaussianSampler, mulberry32 } from '../../src/geometry/montecarlo';

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: V3): V3 => {
  const n = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / n, a[1] / n, a[2] / n];
};

const IMG_W = 1920;
const IMG_H = 1080;

function makeCamera(c: V3, target: V3, rollDeg: number, fPx: number) {
  const cx = IMG_W / 2;
  const cy = IMG_H / 2;
  const f = norm(sub(target, c));
  const r0 = norm(cross(f, [0, 1, 0]));
  const d0 = cross(f, r0);
  const phi = (rollDeg * Math.PI) / 180;
  const r: V3 = [
    r0[0] * Math.cos(phi) + d0[0] * Math.sin(phi),
    r0[1] * Math.cos(phi) + d0[1] * Math.sin(phi),
    r0[2] * Math.cos(phi) + d0[2] * Math.sin(phi),
  ];
  const d: V3 = [
    -r0[0] * Math.sin(phi) + d0[0] * Math.cos(phi),
    -r0[1] * Math.sin(phi) + d0[1] * Math.cos(phi),
    -r0[2] * Math.sin(phi) + d0[2] * Math.cos(phi),
  ];
  return (p: V3): Px => {
    const w = sub(p, c);
    const z = dot(f, w);
    if (z <= 0.1) throw new Error('point behind camera — bad test setup');
    return { x: fPx * (dot(r, w) / z) + cx, y: fPx * (dot(d, w) / z) + cy };
  };
}

/** Sheet quad in CORNER order with P0→P1 the LONG edge, on the z=0 plane. */
function sheetQuad(longIn: number, shortIn: number): [V3, V3, V3, V3] {
  return [
    [0, 0, 0],
    [longIn, 0, 0],
    [longIn, shortIn, 0],
    [0, shortIn, 0],
  ];
}

describe('defaultIntrinsics (SPEC §4.3.2)', () => {
  it('derives f from the horizontal FOV and flags itself uncalibrated', () => {
    const k = defaultIntrinsics(1920, 1080);
    expect(k.cx).toBe(960);
    expect(k.cy).toBe(540);
    expect(k.hFovDeg).toBe(67);
    expect(k.uncalibrated).toBe(true);
    // f = (W/2)/tan(hFOV/2)
    expect(k.fPx).toBeCloseTo(960 / Math.tan((33.5 * Math.PI) / 180), 9);
    // 90° FOV → f = W/2 exactly.
    expect(defaultIntrinsics(1000, 800, 90).fPx).toBeCloseTo(500, 9);
  });
});

describe('calibrateFromSheet (SPEC §4.3.2)', () => {
  it('recovers the true focal from a clean US Letter shot at an oblique pose', () => {
    const fTrue = 1100;
    const project = makeCamera([2, -6, 16], [5.5, 4.25, 0], 5, fTrue);
    const quad = sheetQuad(11, 8.5).map(project) as [Px, Px, Px, Px];
    const res = calibrateFromSheet(quad, SHEET_ASPECT.letter, IMG_W, IMG_H);
    expect(res.ok, res.ok ? '' : res.message).toBe(true);
    if (!res.ok) return;
    // eslint-disable-next-line no-console
    console.log(
      `letter calibration: f=${res.fPx.toFixed(2)} (true ${fTrue}), ` +
        `square residual ${res.squareResidualDeg.toExponential(2)}°, aspect residual ${res.aspectResidual.toExponential(2)}`,
    );
    expect(Math.abs(res.fPx - fTrue) / fTrue).toBeLessThan(0.005);
    expect(res.squareResidualDeg).toBeLessThan(0.05);
    expect(res.aspectResidual).toBeLessThan(1e-6);
    expect(Math.abs(res.rectifiedAspect - SHEET_ASPECT.letter)).toBeLessThan(1e-4);
  });

  it('recovers a different focal from an A4 shot at another pose', () => {
    const fTrue = 1450;
    const project = makeCamera([-8, 20, 55], [14.85, 10.5, 0], -12, fTrue);
    const quad = sheetQuad(29.7, 21).map(project) as [Px, Px, Px, Px];
    const res = calibrateFromSheet(quad, SHEET_ASPECT.a4, IMG_W, IMG_H);
    expect(res.ok, res.ok ? '' : res.message).toBe(true);
    if (!res.ok) return;
    expect(Math.abs(res.fPx - fTrue) / fTrue).toBeLessThan(0.005);
    expect(res.squareResidualDeg).toBeLessThan(0.05);
  });

  it('stays within a usable band under 1 px marking noise (seeded)', () => {
    const fTrue = 1100;
    const project = makeCamera([2, -6, 16], [5.5, 4.25, 0], 5, fTrue);
    const clean = sheetQuad(11, 8.5).map(project) as [Px, Px, Px, Px];
    const gauss = gaussianSampler(mulberry32(909));
    let worstRel = 0;
    let okCount = 0;
    const trials = 40;
    for (let t = 0; t < trials; t++) {
      const noisy = clean.map((p) => ({ x: p.x + gauss(), y: p.y + gauss() })) as [Px, Px, Px, Px];
      const res = calibrateFromSheet(noisy, SHEET_ASPECT.letter, IMG_W, IMG_H);
      if (!res.ok) continue;
      okCount++;
      worstRel = Math.max(worstRel, Math.abs(res.fPx - fTrue) / fTrue);
    }
    // eslint-disable-next-line no-console
    console.log(`sheet calibration under 1px noise: ${okCount}/${trials} ok, worst |Δf|/f = ${(100 * worstRel).toFixed(1)}%`);
    expect(okCount).toBeGreaterThanOrEqual(trials - 2);
    expect(worstRel).toBeLessThan(0.25);
  });

  it('refuses a fronto-parallel sheet — no focal information — instead of inventing f', () => {
    const project = makeCamera([5.5, 4.25, 20], [5.5, 4.25, 0], 0, 1100);
    const quad = sheetQuad(11, 8.5).map(project) as [Px, Px, Px, Px];
    const res = calibrateFromSheet(quad, SHEET_ASPECT.letter, IMG_W, IMG_H);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe('POOR_GEOMETRY');
      expect(res.message).toMatch(/square-on|angle/);
    }
  });

  it('refuses degenerate input', () => {
    const collinear: [Px, Px, Px, Px] = [
      { x: 100, y: 500 },
      { x: 700, y: 502 },
      { x: 1300, y: 504 },
      { x: 1720, y: 505.5 },
    ];
    expect(calibrateFromSheet(collinear, SHEET_ASPECT.letter, IMG_W, IMG_H).ok).toBe(false);
    const project = makeCamera([2, -6, 16], [5.5, 4.25, 0], 5, 1100);
    const quad = sheetQuad(11, 8.5).map(project) as [Px, Px, Px, Px];
    expect(calibrateFromSheet(quad, 0, IMG_W, IMG_H).ok).toBe(false);
    expect(calibrateFromSheet(quad, NaN, IMG_W, IMG_H).ok).toBe(false);
    expect(calibrateFromSheet(quad, SHEET_ASPECT.letter, 0, IMG_H).ok).toBe(false);
    const nonFinite = [{ x: NaN, y: 1 }, quad[1], quad[2], quad[3]] as [Px, Px, Px, Px];
    expect(calibrateFromSheet(nonFinite, SHEET_ASPECT.letter, IMG_W, IMG_H).ok).toBe(false);
  });
});
