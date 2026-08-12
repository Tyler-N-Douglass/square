/**
 * Worked-example synthesis for the CORNER DEMO — ADR-012: CORNER's demo is a
 * worked example through the REAL solver, using the same projection math the
 * ground-truth suite uses (a virtual planar corner at a KNOWN angle projected
 * through a KNOWN pinhole camera). Nothing here bypasses the pipeline: the
 * demo feeds these pixels to the same solver + Monte Carlo the live tool
 * calls, and the truth is printed next to what the solver recovered.
 *
 * The projection is written with plain arrays, mirroring
 * tests/unit/angle-solver-groundtruth.test.ts — deliberately not reusing the
 * solver's own homography, so the demo cannot be circular.
 */
import type { Intrinsics, Px } from '../../geometry/angleSolver';

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

/** Pinhole projector at c looking at target, rolled about its axis. */
export function makeProjector(k: Intrinsics, c: V3, target: V3, rollDeg: number): (p: V3) => Px {
  const f = norm(sub(target, c));
  let r = norm(cross(f, [0, 1, 0]));
  let d = cross(f, r);
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
  r = r2;
  d = d2;
  return (p: V3): Px => {
    const w = sub(p, c);
    const z = dot(f, w);
    if (z <= 0.1) throw new Error('point behind camera — bad demo pose');
    return { x: k.fPx * (dot(r, w) / z) + k.cx, y: k.fPx * (dot(d, w) / z) + k.cy };
  };
}

/**
 * Planar corner at thetaDeg on z = 0, solver point order:
 * P0 corner, P1 along edge family one, P2 diagonal, P3 along family two.
 */
export function cornerWorldQuad(thetaDeg: number, l1 = 30, l2 = 20): [V3, V3, V3, V3] {
  const th = (thetaDeg * Math.PI) / 180;
  const p0: V3 = [0, 0, 0];
  const p1: V3 = [l1, 0, 0];
  const p3: V3 = [l2 * Math.cos(th), l2 * Math.sin(th), 0];
  const p2: V3 = [p1[0] + p3[0], p1[1] + p3[1], 0];
  return [p0, p1, p2, p3];
}

export interface WorkedExample {
  /** The known truth the projection was built from. */
  truthDeg: number;
  /** The known camera the projection was built with. */
  k: Intrinsics;
  imageW: number;
  imageH: number;
  /** Projected pixel quad in solver order — the "marks". */
  quad: [Px, Px, Px, Px];
}

/**
 * The shipped worked example: an 88.6° doorway (a real-world out-of-square
 * corner) seen from a believable hand-held pose, through a known camera.
 */
export function workedExample(truthDeg = 88.6): WorkedExample {
  const k: Intrinsics = { fPx: 1100, cx: 960, cy: 540 };
  const project = makeProjector(k, [15, 8, 60], [15, 8, 0], 12);
  const quad = cornerWorldQuad(truthDeg).map(project) as [Px, Px, Px, Px];
  return { truthDeg, k, imageW: 1920, imageH: 1080, quad };
}

/**
 * The refusal example (limits first, SPEC §15.7): four marks that are nearly
 * a line — a marking a rushed user actually produces when both "edges" run
 * along the same jamb. The REAL solver refuses this with POOR_GEOMETRY.
 */
export function degenerateExample(): { k: Intrinsics; quad: [Px, Px, Px, Px] } {
  return {
    k: { fPx: 1100, cx: 960, cy: 540 },
    quad: [
      { x: 100, y: 500 },
      { x: 700, y: 502 },
      { x: 1300, y: 504 },
      { x: 1720, y: 505.5 },
    ],
  };
}
