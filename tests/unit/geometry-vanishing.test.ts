/**
 * Vanishing-point recovery tests — SPEC §4.3.1.3/.4/.6, §10.1.
 * Owned by A3 (Geometry/Vision). Synthetic projections are derived locally
 * (independent of src/geometry) so the module under test cannot grade its
 * own homework. Seeded randomness only.
 */
import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../src/types';
import type { Intrinsics, Px } from '../../src/geometry/angleSolver';
import { cornerAngleFromQuad, cornerAngleFromVanishingPoints } from '../../src/geometry/angleSolver';
import { homographyUnitSquareToQuad } from '../../src/geometry/homography';
import {
  backprojectDirection,
  imageDirectionToward,
  lineThroughPoints,
  vanishingFromParallelSegments,
  vanishingPointsFromH,
} from '../../src/geometry/vanishing';

const K: Intrinsics = { fPx: 1100, cx: 960, cy: 540 };

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

/** Pinhole camera; also exposes the world→camera direction transform. */
function makeCamera(c: V3, target: V3, rollDeg: number) {
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
  return {
    project(p: V3): Px {
      const w = sub(p, c);
      const z = dot(f, w);
      if (z <= 0.1) throw new Error('point behind camera — bad test setup');
      return { x: K.fPx * (dot(r, w) / z) + K.cx, y: K.fPx * (dot(d, w) / z) + K.cy };
    },
    /** World direction expressed in camera axes (right, down, forward). */
    dirToCam(dir: V3): V3 {
      return [dot(r, dir), dot(d, dir), dot(f, dir)];
    },
  };
}

/** |sin| of the angle between two 3D directions (sign-independent). */
function sinBetween(a: V3, b: V3): number {
  const na = norm(a);
  const nb = norm(b);
  const c = cross(na, nb);
  return Math.hypot(c[0], c[1], c[2]);
}

describe('lineThroughPoints', () => {
  it('produces a homogeneous line containing both points and any point between', () => {
    const p1: Px = { x: 120, y: 40 };
    const p2: Px = { x: 700, y: 310 };
    const l = lineThroughPoints(p1, p2);
    for (const t of [0, 0.25, 0.5, 1]) {
      const p: Vec3 = [p1.x + t * (p2.x - p1.x), p1.y + t * (p2.y - p1.y), 1];
      const scale = Math.hypot(l[0], l[1]) * Math.hypot(p[0], p[1], 1);
      expect(Math.abs(dot(l, p)) / scale).toBeLessThan(1e-12);
    }
    // The horizontal axis: y = 0.
    const axis = lineThroughPoints({ x: 0, y: 0 }, { x: 1, y: 0 });
    expect(axis[0]).toBe(0);
    expect(axis[2]).toBe(0);
    expect(axis[1]).not.toBe(0);
  });
});

describe('vanishing point from two world-parallel segments (SPEC §4.3.1.4a)', () => {
  it('back-projects to the true 3D direction across oblique poses', () => {
    const dirs: V3[] = [
      [1, 0, 0],
      [0, 1, 0],
      [Math.cos(0.4), Math.sin(0.4), 0],
    ];
    const poses: Array<{ c: V3; roll: number }> = [
      { c: [15, 8, 60], roll: 10 },
      { c: [-10, 20, 55], roll: 0 },
      { c: [40, -5, 70], roll: -20 },
    ];
    for (const pose of poses) {
      const cam = makeCamera(pose.c, [15, 8, 0], pose.roll);
      for (const dir of dirs) {
        // Two distinct world lines along `dir` on the z=0 plane.
        const a0: V3 = [2, 3, 0];
        const b0: V3 = [9, 14, 0];
        const v = vanishingFromParallelSegments(
          cam.project(a0),
          cam.project([a0[0] + 12 * dir[0], a0[1] + 12 * dir[1], 0]),
          cam.project(b0),
          cam.project([b0[0] + 9 * dir[0], b0[1] + 9 * dir[1], 0]),
        );
        expect(v).not.toBeNull();
        const d = backprojectDirection(v!, K);
        const expected = cam.dirToCam(dir);
        expect(sinBetween(d as V3, expected)).toBeLessThan(1e-8);
      }
    }
  });

  it('fronto-parallel family lands exactly at infinity (w ≈ 0) and still carries direction', () => {
    // Camera square-on to the z=0 plane: world-x lines are parallel to the sensor.
    const cam = makeCamera([15, 8, 60], [15, 8, 0], 0);
    const v = vanishingFromParallelSegments(
      cam.project([0, 0, 0]),
      cam.project([30, 0, 0]),
      cam.project([0, 16, 0]),
      cam.project([30, 16, 0]),
    );
    expect(v).not.toBeNull();
    const mag = Math.hypot(v![0], v![1], v![2]);
    expect(Math.abs(v![2]) / mag).toBeLessThan(1e-9); // at infinity — and that is FINE
    const d = backprojectDirection(v!, K);
    expect(sinBetween(d as V3, cam.dirToCam([1, 0, 0]))).toBeLessThan(1e-9);
  });

  it('refuses degenerate constructions (same line, coincident endpoints)', () => {
    const a: Px = { x: 100, y: 100 };
    const b: Px = { x: 500, y: 300 };
    // Both segments on the same image line.
    const mid: Px = { x: 300, y: 200 };
    const far: Px = { x: 700, y: 400 };
    expect(vanishingFromParallelSegments(a, b, mid, far)).toBeNull();
    // A segment with coincident endpoints has no direction.
    expect(vanishingFromParallelSegments(a, a, mid, far)).toBeNull();
    expect(vanishingFromParallelSegments(a, b, { x: NaN, y: 0 }, far)).toBeNull();
  });

  it('agrees with the homography-column vanishing points on a projected quad', () => {
    const cam = makeCamera([5, 35, 45], [15, 8, 0], -25);
    const th = (104 * Math.PI) / 180;
    const world: V3[] = [
      [0, 0, 0],
      [30, 0, 0],
      [30 + 20 * Math.cos(th), 20 * Math.sin(th), 0],
      [20 * Math.cos(th), 20 * Math.sin(th), 0],
    ];
    const quad = world.map((p) => cam.project(p)) as [Px, Px, Px, Px];
    const hres = homographyUnitSquareToQuad(quad);
    expect(hres.ok).toBe(true);
    if (!hres.ok) return;
    const { v1, v2 } = vanishingPointsFromH(hres.h);

    // Same vanishing points from the segment path (opposite edges are world-parallel).
    const v1seg = vanishingFromParallelSegments(quad[0], quad[1], quad[3], quad[2]);
    const v2seg = vanishingFromParallelSegments(quad[0], quad[3], quad[1], quad[2]);
    expect(v1seg).not.toBeNull();
    expect(v2seg).not.toBeNull();
    expect(sinBetween(backprojectDirection(v1, K) as V3, backprojectDirection(v1seg!, K) as V3)).toBeLessThan(1e-8);
    expect(sinBetween(backprojectDirection(v2, K) as V3, backprojectDirection(v2seg!, K) as V3)).toBeLessThan(1e-8);

    // And the full two-parallel-lines angle path agrees with the quad path.
    const viaSegments = cornerAngleFromVanishingPoints(v1seg!, v2seg!, K, quad[0], quad[1], quad[3]);
    const viaQuad = cornerAngleFromQuad(quad, K);
    expect(viaSegments.ok).toBe(true);
    expect(viaQuad.ok).toBe(true);
    if (viaSegments.ok && viaQuad.ok) {
      expect(Math.abs(viaSegments.thetaDeg - viaQuad.thetaDeg)).toBeLessThan(1e-6);
      expect(Math.abs(viaQuad.thetaDeg - 104)).toBeLessThan(1e-6);
    }
  });
});

describe('imageDirectionToward (homogeneous-safe sign resolution input)', () => {
  it('matches the finite-point direction when w > 0 and flips when w < 0', () => {
    const from: Px = { x: 100, y: 200 };
    const vFinite: Vec3 = [400, 500, 1]; // at (400,500)
    const dir = imageDirectionToward(vFinite, from);
    expect(dir.x).toBeCloseTo(300, 12);
    expect(dir.y).toBeCloseTo(300, 12);
    const vNeg: Vec3 = [-400, -500, -1]; // same projective point, opposite representative
    const dirNeg = imageDirectionToward(vNeg, from);
    expect(dirNeg.x).toBeCloseTo(-300, 12);
    expect(dirNeg.y).toBeCloseTo(-300, 12);
  });

  it('returns the line direction at infinity (w = 0)', () => {
    const dir = imageDirectionToward([3, -4, 0], { x: 9999, y: -777 });
    expect(dir).toEqual({ x: 3, y: -4 });
  });
});
