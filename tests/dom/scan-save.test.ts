// @vitest-environment happy-dom
/**
 * SCAN save path, vertical confirm, and DEMO wiring — driven end to end
 * through the REAL pipeline (sync analyzer = the same functions the worker
 * runs) with the committed seed fixture replayed at the 'sync' clock.
 *
 * The save test is the §8 contract check: every Measurement written to the
 * log carries unit, uncertainty AND confidence, with full provenance.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { CapabilityReport } from '../../src/sensors/types';
import type { AppContext } from '../../src/app/router';
import type { SensorTrace } from '../../src/types';
import { mountScan } from '../../src/tools/scan/index';
import { createSyncAnalyzer } from '../../src/tools/scan/pipeline';
import { FadingStore, memoryStorage } from '../../src/guidance/fading';
import { clearProfile } from '../../src/app/calibrationStore';
import { deleteAll, listMeasurements } from '../../src/app/logStore';
import seedJson from '../fixtures/drywall-16oc-synthetic.json';

function capability(magTier: CapabilityReport['magTier']): CapabilityReport {
  return {
    magTier,
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
    platformHint: 'android',
    sampleRates: {},
    blockers: [],
  };
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

function flush(times = 8): Promise<void> {
  let p = Promise.resolve();
  for (let i = 0; i < times; i++) p = p.then(() => new Promise((r) => setTimeout(r, 0)));
  return p;
}

const seed = seedJson as unknown as SensorTrace;

beforeEach(async () => {
  document.body.innerHTML = '';
  localStorage.clear();
  clearProfile();
  await deleteAll();
});

describe('replay → detect → save', () => {
  it('replays the seed fixture, shows REPLAY + SYNTHETIC, finds both fasteners in inches', async () => {
    const el = document.createElement('div');
    document.body.append(el);
    const ctx: AppContext = { capability: capability('FIELD'), replayTrace: seed };
    const unmount = mountScan(el, ctx, testDeps());

    // Badge is honest about what is driving the tool.
    expect(el.textContent).toContain('REPLAY · drywall-16oc-synthetic');
    expect(el.textContent).toContain('SYNTHETIC');

    (el.querySelector('#scan-start') as HTMLButtonElement).click();
    await flush(12);

    const rows = el.querySelectorAll('.scan__event');
    expect(rows.length).toBe(2);
    // Positions in inches (the trace carries anchors), each with confidence.
    const text = el.textContent ?? '';
    expect(text).toContain('in'); // unit rendered
    expect(el.querySelectorAll('.scan__event .conf').length).toBe(2);
    // The lattice statement claims the fit honestly (2 peaks = thin evidence,
    // never "phase locked" — ADR-011 #5/#6).
    expect(text).toContain('16″ on center');
    expect(text).toContain('thin evidence');
    expect(text).not.toContain('phase locked');
    // Axis converted to inches after the anchored replay finished (ADR-006).
    expect(text).toContain('INCHES along the sweep');
    unmount();
  });

  it('SAVE SCAN writes one well-formed Measurement per fastener (§8: uncertainty + confidence present)', async () => {
    const el = document.createElement('div');
    document.body.append(el);
    const ctx: AppContext = { capability: capability('FIELD'), replayTrace: seed };
    const unmount = mountScan(el, ctx, testDeps());

    (el.querySelector('#scan-start') as HTMLButtonElement).click();
    await flush(12);

    const saveBtn = el.querySelector('#scan-save') as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(false);
    saveBtn.click();
    await flush(6);

    const entries = await listMeasurements();
    expect(entries.length).toBe(2);
    const positions = entries.map((e) => e.measurement.value as number).sort((a, b) => a - b);
    // Zero-crossing estimator territory: 4.00″ and 20.00″ ± the fixture tolerance.
    expect(Math.abs(positions[0]! - 4.0)).toBeLessThanOrEqual(0.75);
    expect(Math.abs(positions[1]! - 20.0)).toBeLessThanOrEqual(0.75);
    for (const e of entries) {
      const m = e.measurement;
      expect(m.kind).toBe('stud');
      expect(m.unit).toBe('in');
      expect(Number.isFinite(m.uncertainty.plusMinus)).toBe(true);
      expect(m.uncertainty.plusMinus).toBeGreaterThan(0);
      expect(m.uncertainty.basis).toBe('nominal');
      expect(['STRONG', 'LIKELY', 'POSSIBLE', 'NOISE', 'UNRELIABLE']).toContain(m.confidence);
      expect(m.provenance.tier).toBe('FIELD');
      expect(m.provenance.sampleCount).toBeGreaterThan(0);
      expect(m.provenance.capturedAt).toBeGreaterThan(0);
      expect(m.provenance.calibrations).toHaveProperty('mag');
    }
    // Replay provenance: a fixture replays under its own recorded
    // conditions — the live-device UNCALIBRATED cap does not apply here
    // (it applies to a live FIELD source; covered below).
    unmount();
  });

  it('live FIELD with no calibration: saves cap at LIKELY, and time-units say so without a span', async () => {
    // A fake live source that plays the seed fixture synchronously — the
    // LIVE code path (not replay): no anchors, mark-on-beep default.
    const fakeField = () => {
      const subs = new Set<(s: { t: number; x: number; y: number; z: number; mag: number; tier: 'FIELD' }) => void>();
      return {
        nominalHz: 40,
        health: 'ok' as const,
        lastError: null,
        subscribe(fn: (s: never) => void) {
          subs.add(fn as never);
          return () => subs.delete(fn as never);
        },
        async start() {
          for (const s of seed.samples) {
            const sample = { t: s.t, x: s.x, y: s.y, z: s.z, mag: Math.hypot(s.x, s.y, s.z), tier: 'FIELD' as const };
            for (const fn of subs) fn(sample);
          }
        },
        stop() {},
      };
    };
    const el = document.createElement('div');
    document.body.append(el);
    const ctx: AppContext = { capability: capability('FIELD'), replayTrace: null };
    const unmount = mountScan(el, ctx, { ...testDeps(), makeFieldSource: fakeField as never });

    // UNCALIBRATED warning stands before the sweep (route to CALIBRATE).
    expect(el.querySelector('[data-warning-key="UNCALIBRATED"]')).not.toBeNull();

    const startBtn = el.querySelector('#scan-start') as HTMLButtonElement;
    startBtn.click(); // START — the fake emits the whole trace
    await flush(10);
    startBtn.click(); // STOP
    await flush(10);

    const saveBtn = el.querySelector('#scan-save') as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(false);
    saveBtn.click();
    await flush(6);

    const entries = await listMeasurements();
    expect(entries.length).toBe(2);
    for (const e of entries) {
      const m = e.measurement;
      // No span declared → honestly seconds, flagged in provenance notes.
      expect(m.unit).toBe('s');
      expect(m.provenance.notes).toContain('no span declared');
      // STRONG requires Tier A *calibrated* (SPEC §4.1.7) — capped here.
      expect(m.confidence).not.toBe('STRONG');
      expect(Number.isFinite(m.uncertainty.plusMinus)).toBe(true);
    }
    unmount();
  });

  it('SWEEP AGAIN overlays the passes and scores agreement — same trace agrees', async () => {
    const el = document.createElement('div');
    document.body.append(el);
    const ctx: AppContext = { capability: capability('FIELD'), replayTrace: seed };
    const unmount = mountScan(el, ctx, testDeps());

    (el.querySelector('#scan-start') as HTMLButtonElement).click();
    await flush(12);

    const again = el.querySelector('#scan-again') as HTMLButtonElement;
    expect(again.disabled).toBe(false);
    again.click();
    await flush(12);

    const confirm = el.querySelector('.scan__confirm') as HTMLElement;
    expect(confirm.hidden).toBe(false);
    expect(confirm.getAttribute('data-agree')).toBe('true');
    expect(confirm.textContent).toContain('That’s a stud line');
    unmount();
  });
});

describe('DEMO wiring', () => {
  it('lists A13’s three scan demos plus the guide.ts additions', () => {
    const el = document.createElement('div');
    document.body.append(el);
    const ctx: AppContext = { capability: capability('NONE'), replayTrace: null };
    const unmount = mountScan(el, ctx, testDeps());

    for (const key of [
      'scan-first-wall',
      'scan-hot-wall',
      'scan-magsafe',
      'sweep-too-fast',
      'plaster-lath-dense',
      'tierB-heading-proxy',
    ]) {
      expect(el.querySelector(`#scan-demo-${key}`), key).not.toBeNull();
    }
    unmount();
  });

  it('runs a demo through the real pipeline: SYNTHETIC label, narration, asserted outcome', async () => {
    const el = document.createElement('div');
    document.body.append(el);
    const ctx: AppContext = { capability: capability('NONE'), replayTrace: null };
    const unmount = mountScan(el, ctx, testDeps());

    (el.querySelector('#scan-demo-scan-first-wall') as HTMLButtonElement).click();
    await flush(14);

    expect(el.textContent).toContain('SYNTHETIC TRACE'); // required label for generated traces
    expect((el.querySelector('.scan__narration') as HTMLElement).textContent?.length).toBeGreaterThan(0);
    const expected = el.querySelector('.scan__expected') as HTMLElement;
    expect(expected.textContent).toContain('The regression suite asserts this trace');
    expect(expected.textContent).toContain('4″, 20″');
    unmount();
  });
});

describe('guided run', () => {
  it('auto-runs on first visit with a coach mark on the first step, torn down on unmount', () => {
    const el = document.createElement('div');
    document.body.append(el);
    const ctx: AppContext = { capability: capability('FIELD'), replayTrace: null };
    const deps = { ...testDeps(), autoGuide: true };
    const unmount = mountScan(el, ctx, deps);

    const mark = document.querySelector('.coach');
    expect(mark).not.toBeNull();
    expect(mark?.textContent).toContain('START SCAN');
    unmount();
    expect(document.querySelector('.coach')).toBeNull(); // stop() tears the mark down
  });
});
