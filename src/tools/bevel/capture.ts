/**
 * BEVEL capture engines — SPEC §4.5.1. Owned by A4 (Craft Math, Phase 2).
 *
 * GRAVITY MODE (default, robust)
 * ------------------------------
 * Place the phone flat on the reference face, long edge against the joint;
 * hold still; capture the gravity vector g₁ in the device frame. Same on the
 * second face → g₂. The dihedral fold angle is θ = acos(ĝ₁·ĝ₂).
 *
 * WHY θ NEEDS A HORIZONTAL EDGE — the derivation behind the check
 * ---------------------------------------------------------------
 * Let ê be the unit direction of the shared (fold) edge in the world, and let
 * the phone lie on each face with its long edge (device +y) along ê. Moving
 * the phone from face 1 to face 2 is a rigid rotation by the fold angle φ
 * about ê. Split gravity into the component along the edge, s = g·ê, and the
 * component p ⊥ ê (|p|² = g² − s²). In each device frame:
 *
 *     g_dev,i = ( p_i , s , … )   with p₂ = R(φ, ê)·p₁ and the edge
 *                                 component s IDENTICAL in both frames,
 *                                 because the rotation axis is ê itself.
 *
 * So  ĝ₁·ĝ₂ = ( s² + |p|²·cos φ ) / g²
 *            = sin²τ + cos²τ·cos φ        where sin τ = s/g (edge tilt τ).
 *
 * Only when τ = 0 — the edge HORIZONTAL, gravity entirely perpendicular to
 * it — does acos(ĝ₁·ĝ₂) equal the true fold angle φ. Any tilt biases the
 * reading toward 0° (at τ = 90° the reading is 0° regardless of φ). The
 * error is not noise; it is a wrong number with a confident face.
 *
 * THE CHECK, operationally: with the long edge against the joint, the edge
 * direction is the device y axis, so s is simply the y component of the
 * captured gravity. Require |mean g_y| < EDGE_TOL_MS2 (0.8 m/s² ≈ 4.7° of
 * edge tilt, which biases a 90° reading by ≲ 0.4°) in BOTH captures.
 * Violated → REFUSE with the §4.5.1 explanation; the invalid angle is never
 * emitted (SPEC §15.3). The identity above is verified numerically in
 * tests/unit/bevel-capture.test.ts with synthetic gravity pairs at level and
 * tilted fold axes.
 *
 * STILLNESS + AVERAGING (SPEC §4.5.1): each capture runs the REAL
 * OrientationFusion (A1) for its motion gate — stillness must hold 400 ms
 * before the fusion reports stable — then averages raw gravity over a
 * further 500 ms window. The RMS angular scatter of the window about the
 * mean direction is the reading's uncertainty (basis 'stddev'). A capture
 * therefore takes about a second of holding still, on purpose.
 *
 * 3D MODE (advanced): quaternion at placement 1, gyro integration through
 * the move, quaternion at placement 2; face normals in the shared frame give
 * θ with no horizontal-edge restriction. Without magnetic yaw the relative
 * rotation rides on the gyro alone, so a drift budget grows with elapsed
 * time and the capture REFUSES at 20 s (SPEC §4.5.1, warning GYRO_DRIFT).
 */
import type { ImuSample, SensorSource } from '../../sensors/types';
import type { Confidence, Quat, Vec3 } from '../../types';
import { OrientationFusion } from '../../sensors/orientation';
import { qFromAxisAngle, qMultiply, qRotateVec } from '../../geometry/quat';

export const G_MS2 = 9.80665;
/** Averaging window after the fusion motion gate opens (SPEC §4.5.1). */
export const CAPTURE_WINDOW_MS = 500;
/** |mean g_y| at or above this refuses the gravity dihedral (edge not level). */
export const EDGE_TOL_MS2 = 0.8;

const DEG = 180 / Math.PI;

/** Never-started stub so the capture machines can own a real OrientationFusion
 *  and drive it sample-by-sample via ingest(). */
function nullImuSource(): SensorSource<ImuSample> {
  return {
    start: async () => undefined,
    stop: () => undefined,
    subscribe: () => () => undefined,
    nominalHz: 60,
    health: 'ok',
  };
}

export interface FaceCapture {
  /** Mean gravity over the still window, device frame, m/s². */
  g: Vec3;
  /** Unit direction of g. */
  ghat: Vec3;
  /** RMS angular scatter of window samples about the mean direction, degrees. */
  stddevDeg: number;
  /** |mean g_y| — gravity along the joint-edge axis (device long edge), m/s². */
  edgeMs2: number;
  sampleCount: number;
  /** Trace time the window completed, seconds. */
  t: number;
}

export type CapturePhase =
  | { phase: 'idle' }
  | { phase: 'moving' }
  | { phase: 'settling'; progress: number }
  | { phase: 'captured'; capture: FaceCapture };

/**
 * One face's gravity capture: real fusion motion gate, then a 500 ms window
 * average. arm() → ingest each ImuSample → 'captured'. reset() to reuse.
 */
export class GravityCapture {
  private fusion = new OrientationFusion(nullImuSource());
  private armed = false;
  private windowStart: number | null = null;
  private window: Array<{ x: number; y: number; z: number }> = [];
  private state: CapturePhase = { phase: 'idle' };

  get phase(): CapturePhase {
    return this.state;
  }

  arm(): void {
    if (this.state.phase === 'idle') this.state = { phase: 'moving' };
    this.armed = true;
  }

  reset(): void {
    this.fusion = new OrientationFusion(nullImuSource());
    this.armed = false;
    this.windowStart = null;
    this.window = [];
    this.state = { phase: 'idle' };
  }

  ingest(s: ImuSample): CapturePhase {
    const o = this.fusion.ingest(s);
    if (!this.armed || this.state.phase === 'captured') return this.state;

    if (!o.stable) {
      this.windowStart = null;
      this.window = [];
      this.state = { phase: 'moving' };
      return this.state;
    }

    if (this.windowStart === null) this.windowStart = s.t;
    this.window.push({ x: s.ax, y: s.ay, z: s.az });
    const elapsedMs = (s.t - this.windowStart) * 1000;

    if (elapsedMs >= CAPTURE_WINDOW_MS) {
      this.state = { phase: 'captured', capture: finalizeWindow(this.window, s.t) };
    } else {
      this.state = { phase: 'settling', progress: Math.min(1, elapsedMs / CAPTURE_WINDOW_MS) };
    }
    return this.state;
  }
}

function finalizeWindow(window: Array<{ x: number; y: number; z: number }>, t: number): FaceCapture {
  const n = window.length;
  let mx = 0, my = 0, mz = 0;
  for (const w of window) { mx += w.x; my += w.y; mz += w.z; }
  mx /= n; my /= n; mz /= n;
  const mag = Math.hypot(mx, my, mz);
  const ghat: Vec3 = mag > 0 ? [mx / mag, my / mag, mz / mag] : [0, 0, 1];

  // RMS angular deviation of each sample's direction from the mean direction.
  let sumSq = 0;
  for (const w of window) {
    const wm = Math.hypot(w.x, w.y, w.z);
    if (wm <= 0) continue;
    const dot = Math.min(1, Math.max(-1, (w.x * ghat[0] + w.y * ghat[1] + w.z * ghat[2]) / wm));
    const ang = Math.acos(dot) * DEG;
    sumSq += ang * ang;
  }
  return {
    g: [mx, my, mz],
    ghat,
    stddevDeg: Math.sqrt(sumSq / n),
    edgeMs2: Math.abs(my),
    sampleCount: n,
    t,
  };
}

/* ------------------------------------------------------------------------ */
/* Dihedral from two gravity captures                                        */
/* ------------------------------------------------------------------------ */

export interface DihedralOk {
  ok: true;
  /** Fold angle θ = acos(ĝ₁·ĝ₂), degrees, [0, 180]. */
  thetaDeg: number;
  /** √(σ₁² + σ₂²), floored at 0.1° — basis 'stddev'. */
  plusMinusDeg: number;
  edge1Ms2: number;
  edge2Ms2: number;
}

export interface DihedralRefusal {
  ok: false;
  /** The §4.5.1 explanation, with the offending numbers. Never an angle. */
  reason: string;
  edge1Ms2: number;
  edge2Ms2: number;
}

export type DihedralResult = DihedralOk | DihedralRefusal;

/**
 * θ = acos(ĝ₁·ĝ₂) — valid only when the shared edge is horizontal, enforced
 * via |g_edge| < EDGE_TOL_MS2 in BOTH captures (derivation in the header).
 * On violation: refusal with the stated reason, never the invalid angle.
 */
export function dihedralFromCaptures(c1: FaceCapture, c2: FaceCapture, edgeTolMs2 = EDGE_TOL_MS2): DihedralResult {
  const worst = Math.max(c1.edgeMs2, c2.edgeMs2);
  if (worst >= edgeTolMs2) {
    return {
      ok: false,
      reason:
        `Joint edge is not level — gravity reads ${worst.toFixed(1)} m/s² along the edge ` +
        `(limit ${edgeTolMs2.toFixed(1)}). Tilt leaks the fold angle into the edge axis and the ` +
        `gravity method returns a wrong angle, not a noisy one. ` +
        `Stand the piece so the joint edge is level, then capture again.`,
      edge1Ms2: c1.edgeMs2,
      edge2Ms2: c2.edgeMs2,
    };
  }
  const dot = Math.min(1, Math.max(-1,
    c1.ghat[0] * c2.ghat[0] + c1.ghat[1] * c2.ghat[1] + c1.ghat[2] * c2.ghat[2]));
  return {
    ok: true,
    thetaDeg: Math.acos(dot) * DEG,
    plusMinusDeg: Math.max(0.1, Math.hypot(c1.stddevDeg, c2.stddevDeg)),
    edge1Ms2: c1.edgeMs2,
    edge2Ms2: c2.edgeMs2,
  };
}

/**
 * Confidence for a saved bevel reading, from the window scatter. Documented
 * mapping (nominal, stated here once): ≤0.3° STRONG, ≤1.0° LIKELY, else
 * POSSIBLE. Refusals are never saved, so UNRELIABLE has no path here.
 */
export function confidenceForStddev(stddevDeg: number): Confidence {
  if (stddevDeg <= 0.3) return 'STRONG';
  if (stddevDeg <= 1.0) return 'LIKELY';
  return 'POSSIBLE';
}

/* ------------------------------------------------------------------------ */
/* 3D mode — gyro-linked placements with a drift budget                      */
/* ------------------------------------------------------------------------ */

/** Refuse to report past this many seconds between placements (SPEC §4.5.1). */
export const DRIFT_REFUSE_S = 20;
/** Nominal gyro-integration error model: base + rate·t (consumer MEMS bias
 *  without magnetic correction). Stated as nominal, not measured. */
export const DRIFT_BASE_DEG = 0.5;
export const DRIFT_RATE_DEG_PER_S = 0.15;

export function driftBudgetDeg(elapsedS: number): number {
  return DRIFT_BASE_DEG + DRIFT_RATE_DEG_PER_S * Math.max(0, elapsedS);
}

export interface ThreeDResult {
  /** Angle between the two face normals in the shared frame, degrees. */
  thetaDeg: number;
  /** √(σ₁² + σ₂² + budget²) — basis 'nominal' (the budget dominates). */
  plusMinusDeg: number;
  budgetDeg: number;
  elapsedS: number;
  c1: FaceCapture;
  c2: FaceCapture;
}

export type ThreeDPhase =
  | { phase: 'idle' }
  | { phase: 'face1'; capture: CapturePhase }
  | { phase: 'transit'; elapsedS: number; budgetDeg: number; capture: CapturePhase }
  | { phase: 'done'; result: ThreeDResult }
  | { phase: 'refused'; warning: 'GYRO_DRIFT'; reason: string; elapsedS: number };

/**
 * Face 1 capture → gyro-integrated relative rotation (body-frame quaternion
 * update q ← q ⊗ δq(ω·dt)) → face 2 capture. The device face normal is +z in
 * the device frame, so θ = acos( ẑ · R_rel ẑ ). Elapsed time runs from the
 * completion of capture 1 to the completion of capture 2; past DRIFT_REFUSE_S
 * the machine refuses with GYRO_DRIFT and never emits the angle.
 */
export class Bevel3DCapture {
  private face1 = new GravityCapture();
  private face2 = new GravityCapture();
  private q: Quat = { w: 1, x: 0, y: 0, z: 0 };
  private t0: number | null = null;
  private lastT: number | null = null;
  private state: ThreeDPhase = { phase: 'idle' };

  get phase(): ThreeDPhase {
    return this.state;
  }

  arm(): void {
    if (this.state.phase !== 'idle') return;
    this.face1.arm();
    this.state = { phase: 'face1', capture: this.face1.phase };
  }

  reset(): void {
    this.face1.reset();
    this.face2.reset();
    this.q = { w: 1, x: 0, y: 0, z: 0 };
    this.t0 = null;
    this.lastT = null;
    this.state = { phase: 'idle' };
  }

  ingest(s: ImuSample): ThreeDPhase {
    if (this.state.phase === 'idle' || this.state.phase === 'done' || this.state.phase === 'refused') {
      return this.state;
    }

    if (this.state.phase === 'face1') {
      const cap = this.face1.ingest(s);
      if (cap.phase === 'captured') {
        this.t0 = cap.capture.t;
        this.lastT = cap.capture.t;
        this.face2.arm();
        this.state = { phase: 'transit', elapsedS: 0, budgetDeg: driftBudgetDeg(0), capture: this.face2.phase };
      } else {
        this.state = { phase: 'face1', capture: cap };
      }
      return this.state;
    }

    // Transit + face-2 settling: integrate the gyro on every sample.
    if (this.lastT !== null && this.t0 !== null) {
      const dt = s.t - this.lastT;
      this.lastT = s.t;
      if (dt > 0 && dt < 0.5) {
        const w = Math.hypot(s.gx, s.gy, s.gz);
        if (w > 0) {
          this.q = qMultiply(this.q, qFromAxisAngle([s.gx, s.gy, s.gz], w * dt));
        }
      }
      const elapsedS = s.t - this.t0;
      if (elapsedS >= DRIFT_REFUSE_S) {
        this.state = {
          phase: 'refused',
          warning: 'GYRO_DRIFT',
          reason:
            `Too long between placements — ${elapsedS.toFixed(0)} s of gyro-only tracking ` +
            `(budget ends at ${DRIFT_REFUSE_S} s). The accumulated drift is larger than the ` +
            `angle being measured, so no angle is reported. Capture the first face again and ` +
            `move directly to the second.`,
          elapsedS,
        };
        return this.state;
      }

      const cap = this.face2.ingest(s);
      if (cap.phase === 'captured') {
        const c1 = this.face1.phase.phase === 'captured' ? this.face1.phase.capture : null;
        if (c1 === null) return this.state; // unreachable by construction
        const c2 = cap.capture;
        const n2 = qRotateVec(this.q, [0, 0, 1]);
        const dot = Math.min(1, Math.max(-1, n2[2]));
        const budgetDeg = driftBudgetDeg(elapsedS);
        this.state = {
          phase: 'done',
          result: {
            thetaDeg: Math.acos(dot) * DEG,
            plusMinusDeg: Math.hypot(c1.stddevDeg, c2.stddevDeg, budgetDeg),
            budgetDeg,
            elapsedS,
            c1,
            c2,
          },
        };
      } else {
        this.state = { phase: 'transit', elapsedS, budgetDeg: driftBudgetDeg(elapsedS), capture: cap };
      }
    }
    return this.state;
  }
}

/**
 * Blade tilt that reproduces a captured face on flat stock: the fold capture
 * measures the exterior dihedral θ between the reference face and the cut
 * face, so the cut face meets the stock at 180° − θ, and the blade (tilt
 * measured from vertical) reproduces it at |θ − 90|°.
 */
export function bladeTiltFromDihedralDeg(thetaDeg: number): number {
  return Math.abs(thetaDeg - 90);
}
