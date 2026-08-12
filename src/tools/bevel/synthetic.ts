/**
 * Deterministic synthetic IMU streams — BEVEL's DEMO source (ADR-012).
 *
 * The demos drive the REAL capture pipeline (GravityCapture / Bevel3DCapture
 * → OrientationFusion) with generated `ImuSample` arrays. Everything here is
 * seeded and reproducible: the same spec always yields the same samples, so
 * the demo the user watches is the stream the suite asserts. Anything built
 * from these is labeled SYNTHETIC in the UI — a generated trace never
 * presents as a recording (SPEC §7B.4).
 *
 * The generator tracks the gravity vector in the device frame. A 'rotate'
 * segment turns the device by `totalDeg` about a body axis: gravity, fixed in
 * the world, rotates by −ω·dt about that axis in the device frame while the
 * gyro reports +ω — exactly the relationship the 3D integrator inverts, so
 * gravity mode and 3D mode agree on the fold angle by construction.
 */
import type { ImuSample } from '../../sensors/types';
import type { Vec3 } from '../../types';
import { qFromAxisAngle, qRotateVec } from '../../geometry/quat';
import { G_MS2 } from './capture';

export type StreamSegment =
  /** Hold still for `s` seconds (small seeded noise under the motion gate). */
  | { kind: 'still'; s: number }
  /** Rotate the device `totalDeg` about the body axis over `s` seconds. */
  | { kind: 'rotate'; axis: Vec3; totalDeg: number; s: number }
  /** Handling motion: accel + gyro jitter that breaks the motion gate. */
  | { kind: 'shake'; s: number };

export interface StreamSpec {
  /** Initial gravity in the device frame, m/s² (reads +z when face-up). */
  g0: Vec3;
  segments: StreamSegment[];
  hz?: number;
  seed?: number;
  /** Still-segment noise, m/s² (default 0.02 — well under the 0.35 gate). */
  noiseAcc?: number;
  /** Still-segment gyro noise, rad/s (default 0.004). */
  noiseGyro?: number;
}

/** mulberry32 — small, seeded, good enough for demo noise. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function syntheticImuStream(spec: StreamSpec): ImuSample[] {
  const hz = spec.hz ?? 60;
  const dt = 1 / hz;
  const rand = rng(spec.seed ?? 1);
  const noiseAcc = spec.noiseAcc ?? 0.02;
  const noiseGyro = spec.noiseGyro ?? 0.004;
  const n = (x: number): number => (rand() * 2 - 1) * x;

  let g: Vec3 = [...spec.g0];
  let t = 0;
  const out: ImuSample[] = [];

  const push = (ax: number, ay: number, az: number, gx: number, gy: number, gz: number): void => {
    out.push({ t, ax, ay, az, gx, gy, gz });
    t += dt;
  };

  for (const seg of spec.segments) {
    const steps = Math.max(1, Math.round(seg.s * hz));
    if (seg.kind === 'still') {
      for (let i = 0; i < steps; i++) {
        push(g[0] + n(noiseAcc), g[1] + n(noiseAcc), g[2] + n(noiseAcc), n(noiseGyro), n(noiseGyro), n(noiseGyro));
      }
    } else if (seg.kind === 'rotate') {
      const mag = Math.hypot(seg.axis[0], seg.axis[1], seg.axis[2]);
      const axis: Vec3 = mag > 0 ? [seg.axis[0] / mag, seg.axis[1] / mag, seg.axis[2] / mag] : [0, 1, 0];
      const rateRad = (seg.totalDeg * Math.PI) / 180 / seg.s;
      const stepQ = qFromAxisAngle(axis, -rateRad * dt); // gravity rotates opposite the body
      for (let i = 0; i < steps; i++) {
        g = qRotateVec(stepQ, g);
        push(
          g[0] + n(noiseAcc), g[1] + n(noiseAcc), g[2] + n(noiseAcc),
          axis[0] * rateRad + n(noiseGyro), axis[1] * rateRad + n(noiseGyro), axis[2] * rateRad + n(noiseGyro),
        );
      }
    } else {
      for (let i = 0; i < steps; i++) {
        // Handling motion past the gate (|‖a‖−g| > 0.35 or ‖ω‖ > 0.25):
        // accel jitters randomly; the gyro oscillates like hand tremor —
        // large rates, near-zero net rotation over the segment, so a legal
        // transit's integration error stays inside the drift budget while an
        // illegal one is refused on TIME, which is what the budget measures.
        const tt = i * dt;
        push(
          g[0] + n(1.8), g[1] + n(1.8), g[2] + n(1.8),
          0.6 * Math.sin(2 * Math.PI * 6.1 * tt) + n(0.02),
          0.6 * Math.sin(2 * Math.PI * 7.3 * tt) + n(0.02),
          0.6 * Math.sin(2 * Math.PI * 5.7 * tt) + n(0.02),
        );
      }
    }
  }
  return out;
}

/**
 * Gravity for a device lying on a face whose fold edge is tilted `edgeTiltDeg`
 * out of horizontal, with the device long edge (y) along the fold edge.
 * At tilt τ the edge carries s = G·sin τ; the rest lies in the device x–z
 * plane at phase `phaseDeg`. Feeding two of these (same tilt, phases φ apart)
 * to the dihedral solver reproduces the identity in capture.ts exactly.
 */
export function gravityOnFace(edgeTiltDeg: number, phaseDeg: number): Vec3 {
  const tau = (edgeTiltDeg * Math.PI) / 180;
  const a = (phaseDeg * Math.PI) / 180;
  const p = G_MS2 * Math.cos(tau);
  return [p * Math.sin(a), G_MS2 * Math.sin(tau), p * Math.cos(a)];
}

/** A fold-capture stream: still on face 1 → rotate about the edge → still on face 2. */
export function foldStream(opts: {
  foldDeg: number;
  edgeTiltDeg?: number;
  holdS?: number;
  transitS?: number;
  seed?: number;
}): ImuSample[] {
  const hold = opts.holdS ?? 1.4;
  const transit = opts.transitS ?? 1.2;
  return syntheticImuStream({
    g0: gravityOnFace(opts.edgeTiltDeg ?? 0, 0),
    seed: opts.seed ?? 7,
    segments: [
      { kind: 'still', s: hold },
      { kind: 'rotate', axis: [0, 1, 0], totalDeg: opts.foldDeg, s: transit },
      { kind: 'still', s: hold },
    ],
  });
}
