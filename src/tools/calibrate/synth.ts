/**
 * Deterministic synthetic magnetometer streams for the CALIBRATE DEMO —
 * ADR-012: the replay corpus has no figure-8 trace, so the mag-routine demo
 * drives the REAL ellipsoid fit with a generated sample stream, always
 * labeled SYNTHETIC. Seeded mulberry32 throughout; no Math.random.
 *
 * Physical model, same as the fit assumes (src/dsp/calibration.ts): true
 * field on a sphere of radius R, distorted by a soft-iron matrix A and
 * offset by a hard-iron vector b, plus Gaussian sensor noise:
 *   x = A·(R·direction) + b + noise.
 */
import type { Vec3 } from '../../types';
import { gaussian, mulberry32 } from '../../dsp/synth';

export interface SynthMagOptions {
  /** True field magnitude, µT (Earth ~25–65). */
  radiusUt: number;
  hardIronUt: Vec3;
  /** Diagonal soft-iron stretch factors (near 1). */
  softStretch: Vec3;
  noiseUt: number;
  samples: number;
  seed: number;
}

/**
 * A figure-8-like tumble: directions sweep a lissajous over the sphere so
 * every octant fills, the way a real 25 s calibration should.
 */
export function synthFigure8(o: SynthMagOptions): Vec3[] {
  const g = gaussian(mulberry32(o.seed));
  const out: Vec3[] = [];
  for (let i = 0; i < o.samples; i++) {
    const t = (i / o.samples) * Math.PI * 2;
    // Lissajous on the sphere: azimuth 3 turns, elevation 2 oscillations.
    const az = 3 * t;
    const el = Math.sin(2 * t) * 1.2;
    const dir: Vec3 = [
      Math.cos(el) * Math.cos(az),
      Math.cos(el) * Math.sin(az),
      Math.sin(el),
    ];
    out.push([
      o.softStretch[0] * o.radiusUt * dir[0] + o.hardIronUt[0] + g() * o.noiseUt,
      o.softStretch[1] * o.radiusUt * dir[1] + o.hardIronUt[1] + g() * o.noiseUt,
      o.softStretch[2] * o.radiusUt * dir[2] + o.hardIronUt[2] + g() * o.noiseUt,
    ]);
  }
  return out;
}

/** A clean phone: modest hard iron, slight soft iron, quiet sensor. */
export function cleanPhoneStream(): { points: Vec3[]; truthHardIron: Vec3 } {
  const truthHardIron: Vec3 = [8, -5, 4];
  return {
    points: synthFigure8({
      radiusUt: 48,
      hardIronUt: truthHardIron,
      softStretch: [1.04, 0.97, 1.0],
      noiseUt: 0.35,
      samples: 600,
      seed: 0xf168,
    }),
    truthHardIron,
  };
}

/** A MagSafe ring attached: the offset dwarfs the field. Must FAIL loudly. */
export function magsafeStream(): { points: Vec3[]; truthHardIron: Vec3 } {
  const truthHardIron: Vec3 = [95, -140, 60];
  return {
    points: synthFigure8({
      radiusUt: 48,
      hardIronUt: truthHardIron,
      softStretch: [1.02, 0.99, 1.0],
      noiseUt: 0.35,
      samples: 600,
      seed: 0xdead,
    }),
    truthHardIron,
  };
}
