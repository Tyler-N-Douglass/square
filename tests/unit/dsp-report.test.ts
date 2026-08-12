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

describe('dev report', () => {
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
