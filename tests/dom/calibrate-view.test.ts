// @vitest-environment happy-dom
/**
 * CALIBRATE DOM honesty (SPEC §4.6, §15.4):
 *  - routine cards show last-run age, pass/fail state, and what depends on
 *    each routine;
 *  - on PROXY tier the raw-field routines say honestly why they cannot run
 *    and point at the ones that still can;
 *  - the SELF-TEST screen exists with its COPY DIAGNOSTICS button;
 *  - the MagSafe DEMO fails through the REAL fit with the verbatim message.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { AppContext } from '../../src/app/router';
import type { CapabilityReport } from '../../src/sensors/types';
import { updateProfile } from '../../src/app/calibrationStore';
import { WARNING_COPY } from '../../src/ui/components/warning';
import { saveOutcome } from '../../src/tools/calibrate/logic';
import { mount } from '../../src/tools/calibrate/index';

function cap(magTier: CapabilityReport['magTier']): CapabilityReport {
  return {
    magTier,
    hasAccel: true,
    hasGyro: true,
    hasAbsoluteOrientation: magTier !== 'NONE',
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

const ctxProxy: AppContext = { capability: cap('PROXY'), replayTrace: null };

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
});

describe('routine cards', () => {
  it('show never-run state, dependents, and all four routines', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const unmount = mount(host, ctxProxy);
    const cards = host.querySelectorAll('.calib-card');
    expect(cards.length).toBe(4);
    for (const card of cards) {
      expect(card.querySelector('.calib-card__status')?.textContent).toContain('never run');
      expect(card.querySelector('.calib-card__deps')?.textContent?.length).toBeGreaterThan(10);
    }
    unmount();
  });

  it('PROXY tier: raw-field routines say why they cannot run; the others still can', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const unmount = mount(host, ctxProxy);
    const magCard = host.querySelector('.calib-card--mag');
    expect(magCard?.querySelector('button.calib-run-mag')).toBeNull();
    expect(magCard?.textContent).toContain('heading only');
    expect(magCard?.textContent).toContain('still work');
    const locCard = host.querySelector('.calib-card--locator');
    expect(locCard?.querySelector('button.calib-run-locator')).toBeNull();
    expect(host.querySelector('button.calib-run-levelZero')).toBeTruthy();
    expect(host.querySelector('button.calib-run-lens')).toBeTruthy();
    unmount();
  });

  it('show pass/fail + age after a run is recorded', () => {
    saveOutcome('lens', { at: Date.now() - 3 * 3_600_000, pass: true, note: 'f = 1123 px, residual 0.21°' });
    saveOutcome('mag', { at: Date.now() - 30_000, pass: false, note: '|b| 62 µT — magnetic accessory' });
    updateProfile({ lens: { 'cam:default': { fPx: 1123, width: 1920, height: 1080 } } });
    const host = document.createElement('div');
    document.body.append(host);
    const unmount = mount(host, ctxProxy);
    const lensStatus = host.querySelector('.calib-card--lens .calib-card__status');
    expect(lensStatus?.textContent).toContain('PASS');
    expect(lensStatus?.textContent).toContain('3 h ago');
    expect(lensStatus?.getAttribute('data-state')).toBe('pass');
    const magStatus = host.querySelector('.calib-card--mag .calib-card__status');
    expect(magStatus?.textContent).toContain('FAIL');
    expect(magStatus?.textContent).toContain('just now');
    expect(magStatus?.getAttribute('data-state')).toBe('fail');
    unmount();
  });
});

describe('SELF-TEST screen (§4.6)', () => {
  it('opens with capability report, permissions, calibration summary, and the COPY DIAGNOSTICS button', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const unmount = mount(host, ctxProxy);
    (host.querySelector('.calib-open-selftest') as HTMLButtonElement).click();
    expect(host.querySelector('.calib-selftest')).toBeTruthy();
    expect(host.querySelector('.calib-copy-diagnostics')).toBeTruthy();
    expect(host.textContent).toContain('Magnetometer tier');
    expect(host.textContent).toContain('PROXY');
    expect(host.textContent).toContain('PERMISSIONS');
    expect(host.textContent).toContain('CALIBRATION');
    expect(host.textContent).toContain('LIVE SAMPLE RATES');
    // Trace recording exists on a mag-capable tier.
    expect(host.querySelector('.calib-trace-start')).toBeTruthy();
    unmount();
  });

  it('on NONE tier the trace recorder says honestly there is nothing to record', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const unmount = mount(host, { capability: cap('NONE'), replayTrace: null });
    (host.querySelector('.calib-open-selftest') as HTMLButtonElement).click();
    expect(host.querySelector('.calib-trace-start')).toBeNull();
    expect(host.textContent).toContain('nothing to record');
    unmount();
  });
});

describe('DEMO — the MagSafe failure through the real fit', () => {
  it('fails loudly with the verbatim accessory message and stores nothing', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const unmount = mount(host, ctxProxy);
    const buttons = [...host.querySelectorAll<HTMLButtonElement>('.calib-row .btn')];
    const magsafeBtn = buttons.find((b) => b.textContent?.includes('CATCH A MAGNET'));
    expect(magsafeBtn).toBeTruthy();
    magsafeBtn!.click();
    // The demo runs synchronously through the real fit.
    const demo = host.querySelector('.calib-demo');
    expect(demo?.textContent).toContain('SYNTHETIC');
    expect(demo?.textContent).toContain(WARNING_COPY.MAGNETIC_ACCESSORY);
    expect(demo?.textContent).toContain('FAIL — nothing stored');
    expect(localStorage.getItem('square.calibration.v1')).toBeNull(); // demo never writes the profile
    unmount();
  });
});
