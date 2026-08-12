// TEMPORARY dev harness (A2) — replaced by real suites before handoff.
import { readFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { analyzeMagTrace, analyzeMagTraceDetailed } from '../../src/dsp/analyze';
import type { SensorTrace } from '../../src/types';

function load(name: string): SensorTrace {
  return JSON.parse(
    readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'),
  ) as SensorTrace;
}

import { fitEllipsoid } from '../../src/dsp/calibration';
import { mul3 } from '../../src/dsp/linalg';
import { gaussian, mulberry32 } from '../../src/dsp/synth';
import type { Vec3 } from '../../src/types';

describe('dev report', () => {
  it('calibration failing seeds', () => {
    const fib = (n: number): Vec3[] => {
      const pts: Vec3[] = [];
      const golden = Math.PI * (3 - Math.sqrt(5));
      for (let i = 0; i < n; i++) {
        const y = 1 - (2 * i) / (n - 1);
        const r = Math.sqrt(Math.max(0, 1 - y * y));
        pts.push([r * Math.cos(golden * i), y, r * Math.sin(golden * i)]);
      }
      return pts;
    };
    const softGen = (rand: () => number, lo: number, hi: number): number[][] => {
      const a = rand() * 2 * Math.PI, b = rand() * 2 * Math.PI, c = rand() * 2 * Math.PI;
      const rz = [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]];
      const ry = [[Math.cos(b), 0, Math.sin(b)], [0, 1, 0], [-Math.sin(b), 0, Math.cos(b)]];
      const rx = [[1, 0, 0], [0, Math.cos(c), -Math.sin(c)], [0, Math.sin(c), Math.cos(c)]];
      const q = mul3(mul3(rz, ry), rx);
      const s = [lo + rand() * (hi - lo), lo + rand() * (hi - lo), lo + rand() * (hi - lo)];
      const out = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
        let acc = 0;
        for (let k = 0; k < 3; k++) acc += q[i]![k]! * s[k]! * q[j]![k]!;
        out[i]![j] = acc;
      }
      return out;
    };
    for (let seed = 1; seed <= 200; seed++) {
      const rand = mulberry32(seed * 7919);
      const gauss = gaussian(rand);
      const hard: Vec3 = [(rand() - 0.5) * 60, (rand() - 0.5) * 60, (rand() - 0.5) * 60];
      const soft = softGen(rand, 0.8, 1.25);
      const pts = fib(300).map(([x, y, z]) => {
        const sx = 48 * x, sy = 48 * y, sz = 48 * z;
        return [
          soft[0]![0]! * sx + soft[0]![1]! * sy + soft[0]![2]! * sz + hard[0] + 0.25 * gauss(),
          soft[1]![0]! * sx + soft[1]![1]! * sy + soft[1]![2]! * sz + hard[1] + 0.25 * gauss(),
          soft[2]![0]! * sx + soft[2]![1]! * sy + soft[2]![2]! * sz + hard[2] + 0.25 * gauss(),
        ] as Vec3;
      });
      const fit = fitEllipsoid(pts);
      if (!fit.ok) console.log('seed', seed, 'FAIL:', fit.reason);
      else {
        const err = Math.hypot(fit.hardIron[0] - hard[0], fit.hardIron[1] - hard[1], fit.hardIron[2] - hard[2]);
        if (err > 0.8 || fit.residual > 0.015) console.log('seed', seed, 'marginal: hardErr', err.toFixed(3), 'resid', fit.residual.toFixed(4));
      }
    }
  });
  it('all fixtures', () => {
    for (const id of [
      'drywall-24oc-noisy',
      'metal-stud-hot',
      'plaster-lath-dense',
      'magsafe-attached',
      'sweep-too-fast',
      'tierB-heading-proxy',
    ]) {
      const t = load(id);
      const d = analyzeMagTraceDetailed(t);
      console.log(
        id,
        '| peaks', d.peaksIn.map((p) => p.toFixed(2)).join(','),
        '| pitch', d.pitchIn,
        '| conf', d.confidence,
        '| warn', JSON.stringify(d.warnings),
        '| sigma', d.sigma.toFixed(3),
        '| snrs', d.events.map((e) => e.snr.toFixed(1)).join('/'),
        '| medNN', d.lattice.medianSpacingIn.toFixed(2),
        '| speed', d.sweepSpeedInPerS.toFixed(1),
      );
    }
  });

  it('seed numbers', () => {
    const seed = load('drywall-16oc-synthetic');
    const zc = analyzeMagTrace(seed, { estimator: 'zeroCrossing' });
    const amp = analyzeMagTrace(seed, { estimator: 'amplitude' });
    const det = analyzeMagTraceDetailed(seed);
    console.log('ZC  :', zc.peaksIn.map((p) => p.toFixed(3)).join(', '));
    console.log('AMP :', amp.peaksIn.map((p) => p.toFixed(3)).join(', '));
    console.log('pitch', zc.pitchIn, 'conf', zc.confidence, 'warn', JSON.stringify(zc.warnings));
    console.log('sigma', det.sigma.toFixed(4), 'rms', det.rmsResidual.toFixed(3),
      'snrs', det.events.map((e) => e.snr.toFixed(1)).join('/'),
      'rate', det.sampleRateHz.toFixed(1), 'speed', det.sweepSpeedInPerS.toFixed(2));
  });
});
