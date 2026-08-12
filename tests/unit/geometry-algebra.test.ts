/**
 * Core algebra property tests — SPEC §10.1. Owned by A3 (Geometry/Vision).
 * All randomness is seeded (mulberry32) — no Math.random in tests.
 */
import { describe, expect, it } from 'vitest';
import type { Mat3, Quat, Vec3 } from '../../src/types';
import { vAdd, vCross, vDist, vDot, vLen, vNormalize, vScale, vSub } from '../../src/geometry/vec';
import {
  mat3Col,
  mat3Det,
  mat3FromCols,
  mat3FromRows,
  mat3Identity,
  mat3Inverse,
  mat3Mul,
  mat3MulVec,
  mat3Transpose,
} from '../../src/geometry/mat';
import {
  qConjugate,
  qFromAxisAngle,
  qFromEuler,
  qIdentity,
  qMultiply,
  qNormalize,
  qRotateVec,
  qToEuler,
  qToMat3,
} from '../../src/geometry/quat';
import { gaussianSampler, mulberry32 } from '../../src/geometry/montecarlo';

const DEG = Math.PI / 180;

function randVec(rand: () => number, span = 4): Vec3 {
  return [span * (rand() - 0.5), span * (rand() - 0.5), span * (rand() - 0.5)];
}

/** Uniform random unit quaternion: four gaussians, normalized. */
function randRotation(gauss: () => number): Quat {
  return qNormalize({ w: gauss(), x: gauss(), y: gauss(), z: gauss() });
}

describe('vec3 (SPEC §10.1 core algebra)', () => {
  const rand = mulberry32(101);

  it('cross product is orthogonal to both factors and anticommutative', () => {
    for (let i = 0; i < 1000; i++) {
      const a = randVec(rand);
      const b = randVec(rand);
      const c = vCross(a, b);
      expect(Math.abs(vDot(c, a))).toBeLessThan(1e-10 * (1 + vLen(a) * vLen(a) * vLen(b)));
      expect(Math.abs(vDot(c, b))).toBeLessThan(1e-10 * (1 + vLen(a) * vLen(b) * vLen(b)));
      const cba = vCross(b, a);
      expect(vDist(c, vScale(cba, -1))).toBeLessThan(1e-12 * (1 + vLen(c)));
    }
  });

  it('Lagrange identity: |a×b|² + (a·b)² = |a|²|b|²', () => {
    for (let i = 0; i < 1000; i++) {
      const a = randVec(rand);
      const b = randVec(rand);
      const lhs = vLen(vCross(a, b)) ** 2 + vDot(a, b) ** 2;
      const rhs = (vLen(a) * vLen(b)) ** 2;
      expect(Math.abs(lhs - rhs)).toBeLessThan(1e-9 * (1 + rhs));
    }
  });

  it('add/sub/scale identities and normalize', () => {
    for (let i = 0; i < 200; i++) {
      const a = randVec(rand);
      const b = randVec(rand);
      expect(vDist(vAdd(vSub(a, b), b), a)).toBeLessThan(1e-12 * (1 + vLen(a)));
      const n = vNormalize(a);
      if (vLen(a) > 1e-9) {
        expect(n).not.toBeNull();
        expect(Math.abs(vLen(n!) - 1)).toBeLessThan(1e-12);
      }
    }
    expect(vNormalize([0, 0, 0])).toBeNull();
    expect(vNormalize([NaN, 1, 0])).toBeNull();
  });
});

describe('mat3 (SPEC §10.1 core algebra)', () => {
  const rand = mulberry32(202);
  const randMat = (): Mat3 =>
    Array.from({ length: 9 }, () => 4 * (rand() - 0.5)) as unknown as Mat3;

  it('transpose is an involution and reverses products', () => {
    for (let i = 0; i < 500; i++) {
      const a = randMat();
      const b = randMat();
      expect(mat3Transpose(mat3Transpose(a))).toEqual(a);
      const left = mat3Transpose(mat3Mul(a, b));
      const right = mat3Mul(mat3Transpose(b), mat3Transpose(a));
      for (let j = 0; j < 9; j++) {
        expect(Math.abs(left[j]! - right[j]!)).toBeLessThan(1e-10);
      }
    }
  });

  it('det is multiplicative: det(A·B) = det(A)·det(B)', () => {
    for (let i = 0; i < 500; i++) {
      const a = randMat();
      const b = randMat();
      const lhs = mat3Det(mat3Mul(a, b));
      const rhs = mat3Det(a) * mat3Det(b);
      expect(Math.abs(lhs - rhs)).toBeLessThan(1e-8 * (1 + Math.abs(rhs)));
    }
  });

  it('inverse via adjugate: A·A⁻¹ = I over 2000 seeded invertible matrices', () => {
    const identity = mat3Identity();
    let tested = 0;
    while (tested < 2000) {
      const a = randMat();
      if (Math.abs(mat3Det(a)) < 0.05) continue; // property holds for invertible A
      tested++;
      const inv = mat3Inverse(a);
      expect(inv).not.toBeNull();
      const prod = mat3Mul(a, inv!);
      for (let j = 0; j < 9; j++) {
        expect(Math.abs(prod[j]! - identity[j]!)).toBeLessThan(1e-8);
      }
    }
  });

  it('refuses to invert singular matrices', () => {
    // Rank 2: third row = row0 + row1.
    const singular: Mat3 = [1, 2, 3, 4, 5, 6, 5, 7, 9];
    expect(mat3Inverse(singular)).toBeNull();
    expect(mat3Inverse([0, 0, 0, 0, 0, 0, 0, 0, 0])).toBeNull();
  });

  it('mulVec, rows/cols round trips', () => {
    const m = mat3FromRows([1, 2, 3], [4, 5, 6], [7, 8, 10]);
    expect(mat3MulVec(m, [1, 0, 0])).toEqual([1, 4, 7]);
    expect(mat3Col(m, 2)).toEqual([3, 6, 10]);
    expect(mat3FromCols([1, 4, 7], [2, 5, 8], [3, 6, 10])).toEqual(m);
    expect(mat3MulVec(mat3Identity(), [3, -2, 5])).toEqual([3, -2, 5]);
  });
});

describe('quaternion (SPEC §10.1 core algebra)', () => {
  it('q → euler → q round-trips over 10⁴ seeded random rotations', () => {
    const gauss = gaussianSampler(mulberry32(303));
    const probes: Vec3[] = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
    let worst = 0;
    for (let i = 0; i < 10_000; i++) {
      const q = randRotation(gauss);
      const q2 = qFromEuler(qToEuler(q));
      // Compare the rotations by their action — q and −q are the same rotation.
      for (const v of probes) {
        const err = vDist(qRotateVec(q, v), qRotateVec(q2, v));
        worst = Math.max(worst, err);
      }
    }
    // eslint-disable-next-line no-console
    console.log(`quat euler round-trip worst action error: ${worst.toExponential(2)}`);
    expect(worst).toBeLessThan(1e-7);
  });

  it('round-trips the euler angles themselves away from gimbal lock', () => {
    const rand = mulberry32(404);
    for (let i = 0; i < 2000; i++) {
      const e = {
        yawRad: (rand() * 2 - 1) * Math.PI * 0.999,
        pitchRad: (rand() * 2 - 1) * 80 * DEG, // stay clear of ±90°
        rollRad: (rand() * 2 - 1) * Math.PI * 0.999,
      };
      const back = qToEuler(qFromEuler(e));
      expect(Math.abs(back.yawRad - e.yawRad)).toBeLessThan(1e-9);
      expect(Math.abs(back.pitchRad - e.pitchRad)).toBeLessThan(1e-9);
      expect(Math.abs(back.rollRad - e.rollRad)).toBeLessThan(1e-9);
    }
  });

  it('stays a valid rotation at gimbal lock (pitch = ±90°)', () => {
    for (const pitch of [90 * DEG, -90 * DEG]) {
      const q = qFromEuler({ yawRad: 0.7, pitchRad: pitch, rollRad: -0.3 });
      const q2 = qFromEuler(qToEuler(q));
      for (const v of [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as Vec3[]) {
        expect(vDist(qRotateVec(q, v), qRotateVec(q2, v))).toBeLessThan(1e-9);
      }
    }
  });

  it('rotation preserves length; conjugate inverts; multiply composes like matrices', () => {
    const gauss = gaussianSampler(mulberry32(505));
    for (let i = 0; i < 2000; i++) {
      const a = randRotation(gauss);
      const b = randRotation(gauss);
      const v: Vec3 = [gauss(), gauss(), gauss()];
      expect(Math.abs(vLen(qRotateVec(a, v)) - vLen(v))).toBeLessThan(1e-10 * (1 + vLen(v)));
      // conjugate inverts
      expect(vDist(qRotateVec(qConjugate(a), qRotateVec(a, v)), v)).toBeLessThan(1e-10 * (1 + vLen(v)));
      // R(a⊗b) = R(a)·R(b): apply b first
      const viaQuat = qRotateVec(qMultiply(a, b), v);
      const viaSteps = qRotateVec(a, qRotateVec(b, v));
      expect(vDist(viaQuat, viaSteps)).toBeLessThan(1e-10 * (1 + vLen(v)));
      // qToMat3 agrees with qRotateVec
      const viaMat = mat3MulVec(qToMat3(a), v);
      expect(vDist(viaMat, qRotateVec(a, v))).toBeLessThan(1e-10 * (1 + vLen(v)));
    }
  });

  it('axis-angle basics: 90° about z maps x̂ → ŷ; zero axis → identity', () => {
    const q = qFromAxisAngle([0, 0, 1], Math.PI / 2);
    const r = qRotateVec(q, [1, 0, 0]);
    expect(vDist(r, [0, 1, 0])).toBeLessThan(1e-12);
    // axis is fixed by its own rotation
    const q2 = qFromAxisAngle([1, 2, 3], 1.1);
    const axis = vNormalize([1, 2, 3])!;
    expect(vDist(qRotateVec(q2, axis), axis)).toBeLessThan(1e-12);
    expect(qFromAxisAngle([0, 0, 0], 1)).toEqual(qIdentity());
    // normalize handles degenerate input
    expect(qNormalize({ w: 0, x: 0, y: 0, z: 0 })).toEqual(qIdentity());
  });
});
