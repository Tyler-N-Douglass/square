/**
 * Orientation fusion — complementary filter (ADR-007), gravity low-pass fused
 * with gyro integration. Pitch/roll conventions per SPEC §4.2.1:
 *   pitch = atan2(-ax, sqrt(ay² + az²)),  roll = atan2(ay, az)
 * with devicemotion axes (x right, y toward top edge, z out of screen).
 * Derivation and the six cardinal cases: docs/PHYSICS.md and tests/unit/level-math.
 *
 * Motion gate (SPEC §4.2.1): a reading only counts as HOLD after 400 ms of
 * stillness; a moving reading is flagged, dimmed, and never logged as a value.
 */
import type { ImuSample, Orientation, SensorSource, SourceHealth } from './types';
import { pitchRollFromGravity } from '../geometry/levelMath';

const G = 9.80665;

export interface FusionOptions {
  /** Complementary blend for the gravity estimate, per sample at ~60 Hz. */
  alpha?: number;
  /** Motion gate thresholds. */
  accTolMs2?: number;   // | |a| − g |
  gyroTolRad?: number;  // ‖ω‖
  holdMs?: number;
}

export class OrientationFusion implements SensorSource<Orientation> {
  readonly nominalHz = 60;
  private subs = new Set<(s: Orientation) => void>();
  private unsub: (() => void) | null = null;
  private gLow: [number, number, number] | null = null;
  private lastT: number | null = null;
  private stillSince: number | null = null;
  private readonly alpha: number;
  private readonly accTol: number;
  private readonly gyroTol: number;
  private readonly holdMs: number;

  constructor(private readonly imu: SensorSource<ImuSample>, opts: FusionOptions = {}) {
    this.alpha = opts.alpha ?? 0.02;
    this.accTol = opts.accTolMs2 ?? 0.35;
    this.gyroTol = opts.gyroTolRad ?? 0.25;
    this.holdMs = opts.holdMs ?? 400;
  }

  get health(): SourceHealth { return this.imu.health; }

  subscribe(fn: (s: Orientation) => void): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  /** Process one IMU sample. Public so tests and replay can drive it directly. */
  ingest(s: ImuSample): Orientation {
    const dt = this.lastT !== null ? s.t - this.lastT : 0;
    this.lastT = s.t;

    if (this.gLow === null) {
      this.gLow = [s.ax, s.ay, s.az];
    } else if (dt > 0 && dt < 0.5) {
      // Complementary: rotate the gravity estimate by the gyro, then pull toward accel.
      const [gx, gy, gz] = this.gLow;
      // g' = g − ω×g·dt  (rotating vector in the body frame)
      const rx = gx - (s.gy * gz - s.gz * gy) * dt;
      const ry = gy - (s.gz * gx - s.gx * gz) * dt;
      const rz = gz - (s.gx * gy - s.gy * gx) * dt;
      this.gLow = [
        rx * (1 - this.alpha) + s.ax * this.alpha,
        ry * (1 - this.alpha) + s.ay * this.alpha,
        rz * (1 - this.alpha) + s.az * this.alpha,
      ];
    }

    const [ax, ay, az] = this.gLow;
    const { pitch, roll } = pitchRollFromGravity(ax, ay, az);

    const accMag = Math.hypot(s.ax, s.ay, s.az);
    const gyroMag = Math.hypot(s.gx, s.gy, s.gz);
    const still = Math.abs(accMag - G) <= this.accTol && gyroMag <= this.gyroTol;
    const nowMs = s.t * 1000;
    if (still) {
      if (this.stillSince === null) this.stillSince = nowMs;
    } else {
      this.stillSince = null;
    }
    const stable = this.stillSince !== null && nowMs - this.stillSince >= this.holdMs;

    // Quaternion for the gravity-aligned attitude (yaw-free): rotation taking
    // device −z to the measured gravity direction. Yaw needs a magnetic
    // reference and is null here — never invented (SPEC §15).
    const q = quatFromPitchRoll(pitch, roll);
    const out: Orientation = { t: s.t, q, pitch, roll, yaw: null, stable };
    for (const fn of this.subs) fn(out);
    return out;
  }

  async start(): Promise<void> {
    await this.imu.start();
    this.unsub = this.imu.subscribe((s) => this.ingest(s));
  }

  stop(): void {
    this.unsub?.();
    this.unsub = null;
  }
}

function quatFromPitchRoll(pitch: number, roll: number): { w: number; x: number; y: number; z: number } {
  const cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
  const cr = Math.cos(roll / 2), sr = Math.sin(roll / 2);
  // Pitch rotates about the device x axis, roll about the device y axis; yaw
  // omitted (no magnetic reference). Convention documented in docs/PHYSICS.md.
  return {
    w: cp * cr,
    x: sp * cr,
    y: cp * sr,
    z: -sp * sr,
  };
}
