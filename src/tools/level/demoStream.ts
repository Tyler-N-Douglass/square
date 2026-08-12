/**
 * LEVEL DEMO streams + driver — ADR-012.
 *
 * The trace corpus (square.trace/1) is magnetometer-shaped, so LEVEL's DEMO
 * cannot replay it. Instead these are deterministic, seeded, in-repo
 * synthesized ImuSample streams played through the REAL OrientationFusion —
 * the same class, the same motion gate, the same 400 ms hold. No demo
 * bypasses the pipeline; determinism is pinned by
 * tests/unit/level-tool-demo.test.ts.
 *
 * Every stream is synthetic by construction, and the driver refuses to play
 * without a synthetic-label callback — same contract as guidance/demo.ts.
 */
import type { ImuSample, Orientation, SensorSource, SourceHealth } from '../../sensors/types';
import type { DemoNarrationLine, DemoSpec } from '../../guidance/demo';
import { SYNTHETIC_LABEL } from '../../guidance/demo';
import { OrientationFusion } from '../../sensors/orientation';

const G = 9.80665;
const RAD = Math.PI / 180;

/** Deterministic PRNG — same generator family the test suite uses. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Gravity (accelerationIncludingGravity, pointing away from earth) for a
 *  device at the given pitch/roll — exact inverse of pitchRollFromGravity. */
export function gravityForAngles(pitchDeg: number, rollDeg: number, g = G): [number, number, number] {
  const p = pitchDeg * RAD;
  const r = rollDeg * RAD;
  return [-g * Math.sin(p), g * Math.cos(p) * Math.sin(r), g * Math.cos(p) * Math.cos(r)];
}

export interface LevelDemoStream {
  id: string;
  synthetic: true;
  hz: number;
  note: string;
  samples: ImuSample[];
}

function gauss(rand: () => number): number {
  // Box–Muller, deterministic off the seeded PRNG.
  const u = Math.max(rand(), 1e-12);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * A surface at +1.2° pitch. 0–3 s: held by a hand with normal tremor —
 * accel magnitude and gyro both violate the motion gate. 3–8 s: hand off,
 * the stream settles and the REAL fusion earns HOLD at +1.2°.
 */
export function makeSurfaceSettleStream(): LevelDemoStream {
  const rand = mulberry32(0xc0ffee);
  const hz = 60;
  const samples: ImuSample[] = [];
  for (let i = 0; i < hz * 8; i++) {
    const t = i / hz;
    const tremor = t < 3;
    const aN = tremor ? 0.45 : 0.012;
    const gN = tremor ? 0.35 : 0.004;
    const [gx0, gy0, gz0] = gravityForAngles(1.2, 0);
    samples.push({
      t,
      ax: gx0 + gauss(rand) * aN,
      ay: gy0 + gauss(rand) * aN,
      az: gz0 + gauss(rand) * aN,
      gx: gauss(rand) * gN,
      gy: gauss(rand) * gN,
      gz: gauss(rand) * gN,
    });
  }
  return {
    id: 'level-imu-surface-settle',
    synthetic: true,
    hz,
    note: 'Synthesized: surface at +1.2° pitch, hand tremor for 3 s, then settling. Seed 0xC0FFEE.',
    samples,
  };
}

/**
 * A phone that never stops moving: a 0.6 Hz sway in pitch with gyro and
 * accel-magnitude violations phased so the gate never sees one still sample
 * — the demo where the motion gate correctly refuses to measure (§15.7:
 * limits first).
 */
export function makeMotionGateStream(): LevelDemoStream {
  const rand = mulberry32(0xbadcab);
  const hz = 60;
  const f = 0.6;
  const samples: ImuSample[] = [];
  for (let i = 0; i < hz * 6; i++) {
    const t = i / hz;
    const phase = 2 * Math.PI * f * t;
    const pitchDeg = 6 * Math.sin(phase);
    const [gx0, gy0, gz0] = gravityForAngles(pitchDeg, 0);
    // Linear-acceleration wobble along z, in phase with the sway extremes,
    // so when the gyro dips low the accel-magnitude check trips instead.
    const shake = 0.7 * Math.sin(phase);
    const gyro = 6 * RAD * 2 * Math.PI * f * Math.cos(phase); // d(pitch)/dt about x
    samples.push({
      t,
      ax: gx0 + gauss(rand) * 0.05,
      ay: gy0 + gauss(rand) * 0.05,
      az: gz0 + shake + gauss(rand) * 0.05,
      gx: gyro + gauss(rand) * 0.02,
      gy: gauss(rand) * 0.02,
      gz: gauss(rand) * 0.02,
    });
  }
  return {
    id: 'level-imu-motion-gate',
    synthetic: true,
    hz,
    note: 'Synthesized: continuous handheld sway — the motion gate never grants HOLD. Seed 0xBADCAB.',
    samples,
  };
}

/** Registry keyed by the ids LEVEL's DemoSpecs use as `fixtureId` (ADR-012:
 *  for LEVEL the id resolves here, in-repo, not in tests/fixtures/). */
export const LEVEL_DEMO_STREAMS: Readonly<Record<string, () => LevelDemoStream>> = {
  'level-imu-motion-gate': makeMotionGateStream,
  'level-imu-surface-settle': makeSurfaceSettleStream,
};

/* ---------------------------------------------------------------------- *
 * Driver — same narration-at-time pattern as guidance/demo.runDemo, over an
 * ImuSample stream and the real fusion instead of ReplayMagSource.
 * ---------------------------------------------------------------------- */

/** Inert IMU source — the demo drives fusion.ingest() directly. */
class InertImuSource implements SensorSource<ImuSample> {
  readonly nominalHz = 60;
  get health(): SourceHealth { return 'ok'; }
  async start(): Promise<void> { /* driven externally */ }
  stop(): void { /* nothing running */ }
  subscribe(): () => void { return () => { /* no stream */ }; }
}

export interface LevelDemoDeps {
  onNarration(line: DemoNarrationLine): void;
  /** Required, not optional — a DEMO that cannot label a synthetic stream
   *  does not get to play one (same contract as guidance/demo.ts). */
  onSyntheticLabel(text: string): void;
  /** Every fused output — drive the tool's real render path with these. */
  onOrientation?(o: Orientation): void;
  onSample?(s: ImuSample): void;
  onEnd?(): void;
}

export interface LevelDemoOptions {
  /** 1 = real time (default); 'sync' delivers everything on start (tests). */
  speed?: number | 'sync';
}

export interface LevelDemoHandle {
  stop(): void;
  readonly stream: LevelDemoStream;
  readonly fusion: OrientationFusion;
}

export function runLevelImuDemo(
  spec: DemoSpec,
  deps: LevelDemoDeps,
  opts: LevelDemoOptions = {},
): LevelDemoHandle {
  const make = LEVEL_DEMO_STREAMS[spec.fixtureId];
  if (!make) {
    throw new Error(`SQUARE: unknown LEVEL demo stream "${spec.fixtureId}"`);
  }
  const stream = make();
  const fusion = new OrientationFusion(new InertImuSource());
  const lines = [...spec.narration].sort((a, b) => a.atT - b.atT);
  let next = 0;
  let idx = 0;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  // Mandatory before the first sample: a generated stream never presents as
  // a recording.
  deps.onSyntheticLabel(SYNTHETIC_LABEL);

  const emit = (i: number): void => {
    const s = stream.samples[i];
    if (!s) return;
    while (next < lines.length && lines[next]!.atT <= s.t) {
      deps.onNarration(lines[next]!);
      next += 1;
    }
    const o = fusion.ingest(s);
    deps.onSample?.(s);
    deps.onOrientation?.(o);
  };

  const end = (): void => {
    while (next < lines.length) {
      deps.onNarration(lines[next]!);
      next += 1;
    }
    deps.onEnd?.();
  };

  const speed = opts.speed ?? 1;
  if (speed === 'sync') {
    for (idx = 0; idx < stream.samples.length; idx++) emit(idx);
    end();
  } else {
    const t0 = Date.now();
    const tick = (): void => {
      if (stopped) return;
      const elapsed = ((Date.now() - t0) / 1000) * speed;
      while (idx < stream.samples.length && stream.samples[idx]!.t <= elapsed) {
        emit(idx);
        idx += 1;
      }
      if (idx >= stream.samples.length) {
        end();
        return;
      }
      timer = setTimeout(tick, 1000 / stream.hz);
    };
    timer = setTimeout(tick, 0);
  }

  return {
    stop(): void {
      stopped = true;
      if (timer) { clearTimeout(timer); timer = null; }
    },
    stream,
    fusion,
  };
}
