/**
 * Deterministic synthetic-trace physics for the DSP test suites — the same
 * model scripts/gen-fixtures.mjs uses to build the committed fixture corpus
 * (kept in sync by hand; the fixtures are frozen artifacts, this module is
 * what the property and precision/recall tests sweep).
 *
 * Physics (matches the seed fixture's note): each fastener writes a bipolar
 * derivative-of-Gaussian anomaly along the sweep axis onto a slowly drifting
 * Earth-field pedestal. The anomaly is added along the pedestal direction so
 * it survives into |B| linearly. Sensor noise is white Gaussian per axis.
 *
 * All randomness flows through mulberry32 — seeded, deterministic, no
 * Math.random anywhere.
 */
import type { SensorTrace, TraceExpected } from '../types';

/** mulberry32 — tiny seeded PRNG, uniform in [0, 1). */
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

/** Standard normal via Box-Muller, driven by a uniform PRNG. */
export function gaussian(rand: () => number): () => number {
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    let u = 0;
    let v = 0;
    do {
      u = rand();
    } while (u <= 1e-12);
    v = rand();
    const r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };
}

export interface Fastener {
  /** Position along the sweep, inches. */
  positionIn: number;
  /** Lobe amplitude, µT (FIELD) or degrees (PROXY). */
  amplitude: number;
  /** Lobe sigma, inches (extrema sit ±sigma from the fastener). Default 1.0. */
  lobeSigmaIn?: number;
  /** +1: positive lobe first (approaching), −1: flipped polarity. Default +1. */
  polarity?: 1 | -1;
}

export interface SynthOptions {
  id: string;
  note: string;
  seed: number;
  hz: number;
  /** Sweep span, inches. */
  spanIn: number;
  /** Sweep speed, inches per second. */
  speedInPerS: number;
  fasteners: Fastener[];
  /** Per-axis raw sensor noise σ (µT or degrees). */
  noise: number;
  tier?: 'FIELD' | 'PROXY';
  /** Earth pedestal vector, µT (FIELD only). Default [21.4, −8.1, 41.9]. */
  pedestal?: [number, number, number];
  /** Fixed offset added to the pedestal (a case magnet), µT. */
  hardIronOffset?: [number, number, number];
  /** Peak-to-trough slow drift amplitude (hand rotation / gyro drift). */
  driftAmplitude?: number;
  /** Extra broadband wall signal: array of {positionIn, amplitude, sigmaIn} Gaussian bumps. */
  bumps?: Array<{ positionIn: number; amplitude: number; sigmaIn: number }>;
  expected: TraceExpected;
}

/**
 * Bipolar derivative-of-Gaussian, unit lobe amplitude, positive lobe first:
 * g(x) = ((p − x)/s)·exp(−(x−p)²/(2s²)) / exp(−1/2) — extrema exactly ±1 at
 * x = p ∓ s, zero crossing exactly at p.
 */
export function dogSignature(x: number, positionIn: number, lobeSigmaIn: number): number {
  const u = (x - positionIn) / lobeSigmaIn;
  return -u * Math.exp(-0.5 * u * u) / Math.exp(-0.5);
}

export function synthesizeTrace(o: SynthOptions): SensorTrace {
  const tier = o.tier ?? 'FIELD';
  const rand = mulberry32(o.seed);
  const gauss = gaussian(rand);
  const durationS = o.spanIn / o.speedInPerS;
  const n = Math.round(durationS * o.hz) + 1;
  const pedestal = o.pedestal ?? [21.4, -8.1, 41.9];
  const off = o.hardIronOffset ?? [0, 0, 0];
  const drift = o.driftAmplitude ?? 0.8;
  // Random-but-seeded drift phases so fixtures don't share one drift shape.
  const ph1 = rand() * 2 * Math.PI;
  const ph2 = rand() * 2 * Math.PI;

  const pmag = Math.hypot(pedestal[0], pedestal[1], pedestal[2]);
  const unit = [pedestal[0] / pmag, pedestal[1] / pmag, pedestal[2] / pmag] as const;

  const samples = [] as SensorTrace['samples'];
  for (let i = 0; i < n; i++) {
    const t = i / o.hz;
    const x = t * o.speedInPerS;
    let anomaly = 0;
    for (const f of o.fasteners) {
      const pol = f.polarity ?? 1;
      anomaly += pol * f.amplitude * dogSignature(x, f.positionIn, f.lobeSigmaIn ?? 1.0);
    }
    for (const b of o.bumps ?? []) {
      const u = (x - b.positionIn) / b.sigmaIn;
      anomaly += b.amplitude * Math.exp(-0.5 * u * u);
    }
    const d =
      (drift / 2) * Math.sin((2 * Math.PI * t) / 9.5 + ph1) +
      (drift / 3) * Math.sin((2 * Math.PI * t) / 4.1 + ph2);

    if (tier === 'PROXY') {
      samples.push({
        t: round3(t),
        x: round3(anomaly + d + o.noise * gauss()),
        y: 0,
        z: 0,
      });
    } else {
      samples.push({
        t: round3(t),
        x: round3(pedestal[0] + off[0] + unit[0] * (anomaly + d) + o.noise * gauss()),
        y: round3(pedestal[1] + off[1] + unit[1] * (anomaly + d) + o.noise * gauss()),
        z: round3(pedestal[2] + off[2] + unit[2] * (anomaly + d) + o.noise * gauss()),
      });
    }
  }

  return {
    schema: 'square.trace/1',
    id: o.id,
    synthetic: true,
    note: o.note,
    device: { platform: 'synthetic', magTier: tier },
    hz: o.hz,
    units: { mag: tier === 'PROXY' ? 'deg' : 'uT', t: 's', distance: 'in' },
    anchors: [
      { t: 0, in: 0 },
      { t: round3((n - 1) / o.hz), in: round3(((n - 1) / o.hz) * o.speedInPerS) },
    ],
    samples,
    expected: o.expected,
  };
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
