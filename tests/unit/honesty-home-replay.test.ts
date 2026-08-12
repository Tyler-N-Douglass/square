// @vitest-environment happy-dom
/**
 * A11 FINDING PIN — the home replay readout must state the trace's own unit
 * (SPEC §15.1: every displayed number carries ITS unit — a heading-proxy
 * residual is degrees, not microtesla).
 *
 * src/app/home.ts renders the ?replay= dummy readout as `${mag} µT` with the
 * unit hardcoded. A PROXY trace's `mag` carries the heading residual in
 * DEGREES (trace.units.mag === 'deg'; see headingProxy.ts and replay.ts), so
 * replaying tierB-heading-proxy on the home screen labels degrees as µT.
 *
 * This test EXPECTS the correct behavior. If it fails, that is finding H-03
 * in docs/HONESTY-AUDIT.md, alive in the code — do not weaken the test;
 * fix home.ts to derive the unit from the trace (and keep the REPLAY ·
 * SYNTHETIC labeling, which the second assertion pins as already correct).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '../../src/app/home';
import { validateTrace } from '../../src/sensors/replay';
import type { CapabilityReport } from '../../src/sensors/types';
import type { SensorTrace } from '../../src/types';
import tierBJson from '../fixtures/tierB-heading-proxy.json';

function loadTierB(): SensorTrace {
  const raw: unknown = tierBJson;
  validateTrace(raw);
  return raw;
}

function capability(): CapabilityReport {
  return {
    magTier: 'PROXY',
    hasAccel: true,
    hasGyro: true,
    hasAbsoluteOrientation: true,
    hasCamera: false,
    cameraCount: 0,
    hasVibrate: false,
    hasWakeLock: false,
    hasOffscreenCanvas: false,
    secureContext: true,
    permissionsPolicyOk: true,
    platformHint: 'ios',
    sampleRates: {},
    blockers: [],
  };
}

async function waitFor(pred: () => boolean, ms = 2000): Promise<void> {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) return; // assertions below state the failure
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('home ?replay= readout — unit honesty for PROXY traces (SPEC §15.1)', () => {
  let unmount: (() => void) | null = null;
  afterEach(() => {
    unmount?.();
    unmount = null;
  });

  it('labels a heading-proxy residual in degrees, never µT, and keeps the REPLAY · SYNTHETIC label', async () => {
    localStorage.setItem('square.firstrun.done', '1');
    const trace = loadTierB();
    expect(trace.device.magTier).toBe('PROXY');
    expect(trace.units.mag).toBe('deg'); // the trace states its own unit

    const host = document.createElement('div');
    document.body.append(host);
    unmount = mount(host, { capability: capability(), replayTrace: trace });

    const label = host.querySelector('.replaypanel__label');
    expect(label?.textContent).toContain('REPLAY');
    expect(label?.textContent).toContain('SYNTHETIC'); // generated trace never presents as a recording

    const value = host.querySelector('.replaypanel__value');
    expect(value).not.toBeNull();
    await waitFor(() => (value?.textContent ?? '—') !== '—');
    const text = value?.textContent ?? '';
    expect(text, 'replay readout never rendered a sample').not.toBe('—');

    // The honesty property: a degrees-valued residual must not wear µT.
    expect(text, `PROXY residual is degrees (trace.units.mag='deg') but renders as: "${text}"`).not.toContain('µT');
  });
});
