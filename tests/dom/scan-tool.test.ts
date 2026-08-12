// @vitest-environment happy-dom
/**
 * SCAN tool mount — tier-driven assembly (ADR-005) exercised through the
 * real mount with injected deps: the synchronous in-process analyzer (the
 * SAME pipeline functions the worker runs) and 'sync' replay clocks.
 *
 *  - Tier NONE renders manual mode + the honest remedy and NEVER a fake
 *    reading;
 *  - PROXY renders the §2.2 cap copy;
 *  - pipeline warnings render warning banners (real hot-wall fixture);
 *  - a live FIELD device with no stored calibration shows UNCALIBRATED with
 *    a route to CALIBRATE.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { CapabilityReport } from '../../src/sensors/types';
import type { AppContext } from '../../src/app/router';
import type { SensorTrace } from '../../src/types';
import { mountScan } from '../../src/tools/scan/index';
import { createSyncAnalyzer } from '../../src/tools/scan/pipeline';
import { FadingStore, memoryStorage } from '../../src/guidance/fading';
import { clearProfile } from '../../src/app/calibrationStore';
import hotWallJson from '../fixtures/metal-stud-hot.json';

function capability(magTier: CapabilityReport['magTier'], platformHint: CapabilityReport['platformHint'] = 'android'): CapabilityReport {
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
    platformHint,
    sampleRates: {},
    blockers:
      magTier === 'NONE'
        ? [{ code: 'NO_MAG', message: 'No magnetometer path is available in this browser. SCAN sensing is off — MANUAL stud mode still works.', remedy: 'Use MANUAL stud mode, or open in Chrome on Android with the generic-sensor flag enabled.' }]
        : [],
  };
}

function ctxFor(magTier: CapabilityReport['magTier'], replayTrace: SensorTrace | null = null): AppContext {
  return { capability: capability(magTier), replayTrace };
}

function testDeps() {
  return {
    analyzer: createSyncAnalyzer(),
    memory: new FadingStore(memoryStorage()),
    replaySpeed: 'sync' as const,
    demoSpeed: 'sync' as const,
    autoGuide: false,
  };
}

function flush(times = 6): Promise<void> {
  let p = Promise.resolve();
  for (let i = 0; i < times; i++) p = p.then(() => new Promise((r) => setTimeout(r, 0)));
  return p;
}

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  clearProfile();
});

describe('Tier NONE — manual mode first, honest remedy, never a fake reading', () => {
  it('renders manual mode, the Chrome-flag remedy, and a DEMO offer', () => {
    const el = document.createElement('div');
    document.body.append(el);
    const unmount = mountScan(el, ctxFor('NONE'), testDeps());

    expect(el.querySelector('.scan__manual')).not.toBeNull();
    expect(el.querySelector('.scan__tapemap')).not.toBeNull();
    expect(el.textContent).toContain('chrome://flags/#enable-generic-sensor-extra-classes');
    expect(el.querySelector('#scan-demo-offer')).not.toBeNull();
    expect(el.querySelector('.scan__demos')).not.toBeNull();
    unmount();
  });

  it('NEVER shows a measured (orange) reading or a sensor unit — nothing was measured', () => {
    const el = document.createElement('div');
    document.body.append(el);
    const unmount = mountScan(el, ctxFor('NONE'), testDeps());

    expect(el.querySelector('.num--measured')).toBeNull();
    expect(el.querySelector('.measured')).toBeNull();
    expect(el.querySelector('#scan-start')).toBeNull(); // no start button for a sensor that does not exist
    expect(el.textContent).not.toContain('µT');
    unmount();
  });

  it('manual tape map computes on mount with DERIVED numbers carrying ± bands', () => {
    const el = document.createElement('div');
    document.body.append(el);
    const unmount = mountScan(el, ctxFor('NONE'), testDeps());

    const rows = el.querySelectorAll('.scan__tapetable tbody tr');
    expect(rows.length).toBe(7); // 0..96 at 16″ OC
    expect(el.querySelectorAll('.scan__tapetable .num--derived').length).toBeGreaterThan(0);
    expect(el.querySelector('.scan__tapetable .num__pm')?.textContent).toContain('±');
    // Standard-practice notes ship with the map (SPEC §4.1.9).
    expect(el.textContent).toContain('king and jack studs');
    expect(el.textContent).toContain('side of a stud');
    unmount();
  });
});

describe('Tier PROXY — the §2.2 honesty line', () => {
  it('renders the cap copy and the deflection badge unit, with no number before a sample', () => {
    const el = document.createElement('div');
    document.body.append(el);
    const unmount = mountScan(el, ctxFor('PROXY'), testDeps());

    expect(el.textContent).toContain('coarser, more false positives');
    expect(el.textContent).toContain('Confidence caps at LIKELY');
    expect(el.textContent).toContain('PROXY · deflection');
    // The live readout exists but shows no fabricated value.
    const value = el.querySelector('.num--measured .num__value');
    expect(value?.textContent).toBe('—');
    unmount();
  });
});

describe('pipeline warnings render warning banners (real hot-wall fixture)', () => {
  it('WALL_HOT appears with EXPLAIN, no positions are reported, and the explainer card opens', async () => {
    const el = document.createElement('div');
    document.body.append(el);
    const trace = hotWallJson as unknown as SensorTrace;
    const unmount = mountScan(el, ctxFor('FIELD', trace), testDeps());

    (el.querySelector('#scan-start') as HTMLButtonElement).click();
    await flush(10);

    const band = el.querySelector('[data-warning-key="WALL_HOT"]');
    expect(band).not.toBeNull();
    expect(band?.textContent).toContain('Wall reads hot');
    // Refusal, not fabrication: no event rows, and the refusal copy shows.
    expect(el.querySelectorAll('.scan__event').length).toBe(0);
    expect(el.textContent).toContain('No positions reported');

    // EXPLAIN opens the why / what to do / if-ignored card (§7B.6).
    (band?.querySelector('button') as HTMLButtonElement).click();
    const panel = el.querySelector('.scan__explainer') as HTMLElement;
    expect(panel.hidden).toBe(false);
    expect(panel.textContent).toContain('WALL READS HOT');
    expect(panel.textContent).toContain('Why this is happening');
    unmount();
  });
});

describe('UNCALIBRATED on a live FIELD tier', () => {
  it('shows the warning with a route to CALIBRATE before any sweep', () => {
    const el = document.createElement('div');
    document.body.append(el);
    const unmount = mountScan(el, ctxFor('FIELD'), testDeps());

    const band = el.querySelector('[data-warning-key="UNCALIBRATED"]');
    expect(band).not.toBeNull();
    // The calibration chip routes to CALIBRATE (#/calibrate).
    const chip = el.querySelector('.scan__cal') as HTMLAnchorElement;
    expect(chip.getAttribute('href')).toBe('#/calibrate');
    expect(chip.textContent).toContain('UNCALIBRATED');
    // Sensor reticle: default position with the honest "approximate" note.
    expect(el.querySelector('.scan__reticle')).not.toBeNull();
    expect(el.textContent).toContain('locate it in CALIBRATE');
    unmount();
  });
});
