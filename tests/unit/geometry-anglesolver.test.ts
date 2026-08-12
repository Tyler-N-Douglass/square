/**
 * A3's own angle-solver tests, beyond the frozen ground-truth suite
 * (tests/unit/angle-solver-groundtruth.test.ts — ADR-004, not edited here).
 * Mirrors the sweep at 1° resolution with a much tighter bound (noise-free
 * input must recover to float precision, not merely 0.3°), pins the refusal
 * behavior for every degenerate class, and exercises the worker shim.
 * Owned by A3 (Geometry/Vision).
 */
import { describe, expect, it } from 'vitest';
import type { Intrinsics, Px } from '../../src/geometry/angleSolver';
import { cornerAngleFromQuad, QUAD_LIMITS } from '../../src/geometry/angleSolver';
import { handleSolverRequest } from '../../src/workers/solver.worker';

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
  return (p: V3): Px => {
    const w = sub(p, c);
    const z = dot(f, w);
    if (z <= 0.1) throw new Error('point behind camera — bad test setup');
    return { x: K.fPx * (dot(r, w) / z) + K.cx, y: K.fPx * (dot(d, w) / z) + K.cy };
  };
}

/** Planar corner quad at thetaDeg on z=0: P0 corner, P1 along e1, P2 diagonal, P3 along e2. */
function makeQuad(thetaDeg: number): [V3, V3, V3, V3] {
  const th = (thetaDeg * Math.PI) / 180;
  const p1: V3 = [30, 0, 0];
  const p3: V3 = [20 * Math.cos(th), 20 * Math.sin(th), 0];
  return [[0, 0, 0], p1, [p1[0] + p3[0], p1[1] + p3[1], 0], p3];
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

describe('angle solver: noise-free recovery is float-precision, not merely 0.3° (SPEC §10.1)', () => {
  it('recovers within 1e-6° at 1° steps over θ ∈ [70°,110°] × 10 poses', () => {
    let worst = 0;
    let worstAt = '';
    for (let theta = 70; theta <= 110; theta += 1) {
      const world = makeQuad(theta);
      for (const pose of POSES) {
        const project = makeCamera(pose.c, [15, 8, 0], pose.roll);
        const quad = world.map(project) as [Px, Px, Px, Px];
        const res = cornerAngleFromQuad(quad, K);
        expect(res.ok, `θ=${theta} pose=${JSON.stringify(pose)}: ${res.ok ? '' : res.message}`).toBe(true);
        if (!res.ok) continue;
        const err = Math.abs(res.thetaDeg - theta);
        if (err > worst) {
          worst = err;
          worstAt = `θ=${theta}° pose=${JSON.stringify(pose)}`;
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(`angle solver worst-case sweep error: ${worst.toExponential(3)}° at ${worstAt}`);
    expect(worst).toBeLessThan(1e-6);
  });

  it('resolves obtuse vs acute from image ordering at EVERY pose (110° stays > 100°, 70° stays < 80°)', () => {
    for (const pose of POSES) {
      const project = makeCamera(pose.c, [15, 8, 0], pose.roll);
      const q110 = makeQuad(110).map(project) as [Px, Px, Px, Px];
      const r110 = cornerAngleFromQuad(q110, K);
      expect(r110.ok).toBe(true);
      if (r110.ok) expect(r110.thetaDeg).toBeGreaterThan(100);
      const q70 = makeQuad(70).map(project) as [Px, Px, Px, Px];
      const r70 = cornerAngleFromQuad(q70, K);
      expect(r70.ok).toBe(true);
      if (r70.ok) expect(r70.thetaDeg).toBeLessThan(80);
    }
  });

  it('fronto-parallel (vanishing points exactly at infinity) recovers to float precision', () => {
    const project = makeCamera([15, 8, 60], [15, 8, 0], 0);
    for (const theta of [70, 80, 90, 100, 110]) {
      const quad = makeQuad(theta).map(project) as [Px, Px, Px, Px];
      const res = cornerAngleFromQuad(quad, K);
      expect(res.ok).toBe(true);
      if (res.ok) expect(Math.abs(res.thetaDeg - theta)).toBeLessThan(1e-9);
    }
  });
});

describe('angle solver refusals: every degenerate class returns POOR_GEOMETRY (SPEC §15.3)', () => {
  const expectRefusal = (quad: [Px, Px, Px, Px], k: Intrinsics = K) => {
    const res = cornerAngleFromQuad(quad, k);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe('POOR_GEOMETRY');
      expect(res.message.length).toBeGreaterThan(0);
    }
  };

  it('near-collinear quad', () => {
    expectRefusal([
      { x: 100, y: 500 },
      { x: 700, y: 502 },
      { x: 1300, y: 504 },
      { x: 1720, y: 505.5 },
    ]);
  });

  it('extreme foreshortening (near-zero normalized area)', () => {
    expectRefusal([
      { x: 100, y: 500 },
      { x: 3100, y: 500 },
      { x: 3100, y: 508 },
      { x: 100, y: 511 },
    ]);
  });

  it('coincident corners', () => {
    expectRefusal([
      { x: 100, y: 100 },
      { x: 100.001, y: 100.001 },
      { x: 400, y: 400 },
      { x: 100, y: 400 },
    ]);
  });

  it('quad too small to measure', () => {
    expectRefusal([
      { x: 100, y: 100 },
      { x: 104, y: 100 },
      { x: 104, y: 104 },
      { x: 100, y: 104 },
    ]);
  });

  it('self-intersecting (bowtie) marking order', () => {
    // A valid projected quad with its last two corners swapped.
    const project = makeCamera([15, 8, 60], [15, 8, 0], 12);
    const good = makeQuad(90).map(project) as [Px, Px, Px, Px];
    expectRefusal([good[0], good[1], good[3], good[2]]);
  });

  it('non-finite coordinates and invalid intrinsics', () => {
    const project = makeCamera([15, 8, 60], [15, 8, 0], 0);
    const good = makeQuad(90).map(project) as [Px, Px, Px, Px];
    expectRefusal([{ x: NaN, y: 100 }, good[1], good[2], good[3]]);
    const res = cornerAngleFromQuad(good, { fPx: 0, cx: 960, cy: 540 });
    expect(res.ok).toBe(false);
    const res2 = cornerAngleFromQuad(good, { fPx: -100, cx: 960, cy: 540 });
    expect(res2.ok).toBe(false);
  });

  it('the frozen sweep clears every refusal threshold with ≥ 10× margin', () => {
    // Guards against thresholds creeping up until they eat valid geometry:
    // compute the worst (smallest) margin of the entire ground-truth sweep
    // against each refusal limit.
    let minNormArea = Infinity;
    let minSin = Infinity;
    for (let theta = 70; theta <= 110; theta += 5) {
      const world = makeQuad(theta);
      for (const pose of POSES) {
        const project = makeCamera(pose.c, [15, 8, 0], pose.roll);
        const quad = world.map(project) as [Px, Px, Px, Px];
        const ex: number[] = [];
        const ey: number[] = [];
        const el: number[] = [];
        let maxEdge = 0;
        for (let i = 0; i < 4; i++) {
          const a = quad[i]!;
          const b = quad[(i + 1) % 4]!;
          ex.push(b.x - a.x);
          ey.push(b.y - a.y);
          el.push(Math.hypot(b.x - a.x, b.y - a.y));
          maxEdge = Math.max(maxEdge, el[i]!);
        }
        let area2 = 0;
        for (let i = 0; i < 4; i++) {
          const a = quad[i]!;
          const b = quad[(i + 1) % 4]!;
          area2 += a.x * b.y - b.x * a.y;
        }
        minNormArea = Math.min(minNormArea, Math.abs(area2 / 2) / (maxEdge * maxEdge));
        for (let i = 0; i < 4; i++) {
          const p = (i + 3) % 4;
          minSin = Math.min(minSin, Math.abs(ex[p]! * ey[i]! - ey[p]! * ex[i]!) / (el[p]! * el[i]!));
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(
      `sweep margins — normalized area: ${minNormArea.toExponential(2)} (limit ${QUAD_LIMITS.minNormalizedArea}), ` +
        `vertex sin: ${minSin.toExponential(2)} (limit ${QUAD_LIMITS.minVertexSin})`,
    );
    expect(minNormArea).toBeGreaterThan(10 * QUAD_LIMITS.minNormalizedArea);
    expect(minSin).toBeGreaterThan(10 * QUAD_LIMITS.minVertexSin);
  });
});

describe('solver worker shim (SPEC §3.1: solvers off the main thread)', () => {
  it('dispatches cornerAngle requests and echoes the id', () => {
    const project = makeCamera([15, 8, 60], [15, 8, 0], 12);
    const quad = makeQuad(95).map(project) as [Px, Px, Px, Px];
    const res = handleSolverRequest({ id: 42, kind: 'cornerAngle', quad, k: K });
    expect(res.id).toBe(42);
    expect(res.kind).toBe('cornerAngle');
    if (res.kind === 'cornerAngle' && res.result.ok) {
      expect(Math.abs(res.result.thetaDeg - 95)).toBeLessThan(1e-6);
    } else {
      throw new Error('expected an ok cornerAngle result');
    }
  });

  it('dispatches monteCarlo requests deterministically', () => {
    const project = makeCamera([15, 8, 60], [15, 8, 0], 12);
    const quad = makeQuad(90).map(project) as [Px, Px, Px, Px];
    const a = handleSolverRequest({
      id: 1,
      kind: 'monteCarlo',
      quad,
      k: K,
      options: { samples: 100, seed: 7 },
    });
    const b = handleSolverRequest({
      id: 2,
      kind: 'monteCarlo',
      quad,
      k: K,
      options: { samples: 100, seed: 7 },
    });
    expect(a.kind).toBe('monteCarlo');
    if (a.kind === 'monteCarlo' && b.kind === 'monteCarlo') {
      expect(a.result).toEqual(b.result);
      if (a.result.ok) {
        expect(Math.abs(a.result.medianDeg - 90)).toBeLessThan(1);
      } else {
        throw new Error('expected an ok monteCarlo result');
      }
    }
  });
});
