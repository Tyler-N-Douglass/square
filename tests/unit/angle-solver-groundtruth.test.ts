/**
 * FROZEN LOAD-BEARING TEST (ADR-004) — written before the implementation.
 * SPEC §10.1: "the single most important test in the repo."
 *
 * Synthetic-projection ground truth for the photo corner-angle solver: build
 * a virtual planar corner at a known angle, project it through known
 * intrinsics from many camera poses, feed the projected pixels to the solver,
 * assert recovery within 0.3°. The projection math here is derived
 * independently, with plain arrays — it deliberately imports nothing from
 * src/geometry except the solver under test (A10 independence, SPEC §12).
 */
import { describe, expect, it } from 'vitest';
import { cornerAngleFromQuad, type Intrinsics, type Px } from '../../src/geometry/angleSolver';

type V3 = [number, number, number];

const K: Intrinsics = { fPx: 1100, cx: 960, cy: 540 };

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

/** Pinhole camera at C looking at target T, rolled by rollDeg about its axis. */
function makeCamera(c: V3, target: V3, rollDeg: number) {
  const f = norm(sub(target, c));                 // forward
  let r = norm(cross(f, [0, 1, 0]));              // right
  let d = cross(f, r);                            // down
  const phi = (rollDeg * Math.PI) / 180;
  const r2: V3 = [
    r[0] * Math.cos(phi) + d[0] * Math.sin(phi),
    r[1] * Math.cos(phi) + d[1] * Math.sin(phi),
    r[2] * Math.cos(phi) + d[2] * Math.sin(phi),
  ];
  const d2: V3 = [
    -r[0] * Math.sin(phi) + d[0] * Math.cos(phi),
    -r[1] * Math.sin(phi) + d[1] * Math.cos(phi),
    -r[2] * Math.sin(phi) + d[2] * Math.cos(phi),
  ];
  r = r2; d = d2;
  return (p: V3): Px => {
    const w = sub(p, c);
    const z = dot(f, w);
    if (z <= 0.1) throw new Error('point behind camera — bad test pose');
    return { x: K.fPx * (dot(r, w) / z) + K.cx, y: K.fPx * (dot(d, w) / z) + K.cy };
  };
}

/**
 * Planar corner at angle thetaDeg on the z=0 plane:
 * P0 = corner, P1 along e1, P2 = P1 + edge2, P3 along e2.
 */
function makeQuad(thetaDeg: number): [V3, V3, V3, V3] {
  const th = (thetaDeg * Math.PI) / 180;
  const e1: V3 = [1, 0, 0];
  const e2: V3 = [Math.cos(th), Math.sin(th), 0];
  const l1 = 30, l2 = 20;
  const p0: V3 = [0, 0, 0];
  const p1: V3 = [e1[0] * l1, e1[1] * l1, 0];
  const p3: V3 = [e2[0] * l2, e2[1] * l2, 0];
  const p2: V3 = [p1[0] + p3[0], p1[1] + p3[1], 0];
  return [p0, p1, p2, p3];
}

const POSES: Array<{ c: V3; roll: number }> = [
  { c: [15, 8, 60], roll: 0 },
  { c: [15, 8, 60], roll: 20 },
  { c: [15, 8, 60], roll: -15 },
  { c: [-10, 20, 55], roll: 0 },
  { c: [40, -5, 70], roll: 10 },
  { c: [5, 35, 45], roll: -25 },
  { c: [30, 25, 80], roll: 5 },
  { c: [-20, -10, 65], roll: 0 },
  { c: [15, 8, 35], roll: 30 },
  { c: [50, 30, 90], roll: -10 },
];

describe('corner angle from synthetic projections (SPEC §10.1)', () => {
  it('recovers the true angle within 0.3° across θ ∈ [70°,110°] and 10 poses', () => {
    for (let theta = 70; theta <= 110; theta += 5) {
      const world = makeQuad(theta);
      for (const pose of POSES) {
        const project = makeCamera(pose.c, [15, 8, 0], pose.roll);
        const quad = world.map(project) as [Px, Px, Px, Px];
        const res = cornerAngleFromQuad(quad, K);
        expect(res.ok, `θ=${theta}° pose=${JSON.stringify(pose)} refused: ${res.ok ? '' : res.message}`).toBe(true);
        if (res.ok) {
          expect(
            Math.abs(res.thetaDeg - theta),
            `θ=${theta}° pose=${JSON.stringify(pose)} got ${res.thetaDeg.toFixed(3)}°`,
          ).toBeLessThanOrEqual(0.3);
        }
      }
    }
  });

  it('resolves obtuse vs acute from the image ordering — 110° is not reported as 70°', () => {
    const project = makeCamera([15, 8, 60], [15, 8, 0], 12);
    const quad110 = makeQuad(110).map(project) as [Px, Px, Px, Px];
    const res = cornerAngleFromQuad(quad110, K);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.thetaDeg).toBeGreaterThan(100);
  });

  it('refuses degenerate geometry instead of emitting a number (SPEC §15.3)', () => {
    // Nearly collinear quad — no usable second dimension.
    const quad: [Px, Px, Px, Px] = [
      { x: 100, y: 500 },
      { x: 700, y: 502 },
      { x: 1300, y: 504 },
      { x: 1720, y: 505.5 },
    ];
    const res = cornerAngleFromQuad(quad, K);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('POOR_GEOMETRY');
  });

  it('handles the fronto-parallel case (vanishing points at infinity) without instability', () => {
    // Camera square-on to the plane: projected quad is (near) a parallelogram,
    // vanishing points go to infinity. Homogeneous math must stay exact.
    for (const theta of [80, 90, 100]) {
      const world = makeQuad(theta);
      const project = makeCamera([15, 8, 60], [15, 8, 0], 0);
      const quad = world.map(project) as [Px, Px, Px, Px];
      const res = cornerAngleFromQuad(quad, K);
      expect(res.ok).toBe(true);
      if (res.ok) expect(Math.abs(res.thetaDeg - theta)).toBeLessThanOrEqual(0.3);
    }
  });
});
