// @vitest-environment happy-dom
/**
 * Saving (SPEC §8, charter #6): the motion gate blocks saves; a held save
 * carries uncertainty + confidence + provenance; the claim discipline is
 * visible pre/post reversal (±0.5° LIKELY → ±0.15° STRONG, bias applied to
 * the displayed and saved value); plumb saves as kind 'plumb' with its
 * out-over-run note.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../../src/app/router';
import type { CapabilityReport } from '../../src/sensors/types';
import { deleteAll, listMeasurements } from '../../src/app/logStore';
import { clearProfile, updateProfile } from '../../src/app/calibrationStore';
import { gravityForAngles } from '../../src/tools/level/demoStream';
import { mount } from '../../src/tools/level/index';

const G = 9.80665;

function cap(): CapabilityReport {
  return {
    magTier: 'NONE',
    hasAccel: true,
    hasGyro: true,
    hasAbsoluteOrientation: false,
    hasCamera: false,
    cameraCount: 0,
    hasVibrate: false,
    hasWakeLock: false,
    hasOffscreenCanvas: false,
    secureContext: true,
    permissionsPolicyOk: true,
    platformHint: 'unknown',
    sampleRates: {},
    blockers: [],
  };
}

const ctx: AppContext = { capability: cap(), replayTrace: null };

let vnow = 0;
let host: HTMLElement;
let unmount: (() => void) | null = null;

function motion(a: readonly [number, number, number], rotDegS: readonly [number, number, number] = [0, 0, 0]): void {
  vnow += 16.7;
  const e = new Event('devicemotion') as Event & {
    accelerationIncludingGravity: { x: number; y: number; z: number };
    rotationRate: { alpha: number; beta: number; gamma: number };
  };
  e.accelerationIncludingGravity = { x: a[0], y: a[1], z: a[2] };
  e.rotationRate = { alpha: rotDegS[0], beta: rotDegS[1], gamma: rotDegS[2] };
  window.dispatchEvent(e);
}

function drive(n: number, a: readonly [number, number, number], rot: readonly [number, number, number] = [0, 0, 0]): void {
  for (let i = 0; i < n; i++) motion(a, rot);
}

const frame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

async function mountLevel(): Promise<void> {
  host = document.createElement('div');
  document.body.append(host);
  unmount = mount(host, ctx);
  await tick();
}

beforeEach(async () => {
  vnow = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => vnow);
  localStorage.clear();
  await deleteAll();
  clearProfile();
});

afterEach(() => {
  unmount?.();
  unmount = null;
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('the motion gate blocks saving', () => {
  it('no HOLD, no save', async () => {
    await mountLevel();
    drive(8, [0, 0, G], [40, 0, 0]);
    await frame();
    (host.querySelector('.level__save') as HTMLButtonElement).click();
    await tick();
    expect((await listMeasurements()).length).toBe(0);
  });
});

describe('a held save is a complete §8 Measurement', () => {
  it('uncalibrated: ±0.5° nominal, LIKELY, full provenance', async () => {
    await mountLevel();
    drive(40, gravityForAngles(1.2, 0) as unknown as readonly [number, number, number]);
    await frame();
    await frame();
    (host.querySelector('.level__save') as HTMLButtonElement).click();
    await tick();

    const entries = await listMeasurements();
    expect(entries.length).toBe(1);
    const m = entries[0]!.measurement;
    expect(m.kind).toBe('level');
    expect(m.unit).toBe('°');
    expect(m.value).toBeCloseTo(1.2, 1);
    expect(m.uncertainty.plusMinus).toBe(0.5);
    expect(m.uncertainty.basis).toBe('nominal');
    expect(m.confidence).toBe('LIKELY');
    expect(m.provenance.tier).toBe('NONE');
    expect(m.provenance.sampleCount).toBeGreaterThanOrEqual(12);
    expect(m.provenance.calibrations['levelBias']).toEqual({ ok: false, ageMs: 0 });
    expect(m.provenance.notes).toContain('mode:surface');
    expect(m.provenance.notes).toContain('uncalibrated');
  });
});

describe('claim discipline pre/post reversal (SPEC §2.3.5)', () => {
  it('pre: the claim line says ±0.5° and that reversal has not run', async () => {
    await mountLevel();
    const claim = host.querySelector('.level__claim')!;
    expect(claim.textContent).toContain('±0.5°');
    expect(claim.textContent).toContain('not run');
  });

  it('post: bias is subtracted from the reading and the save tightens to ±0.15° STRONG', async () => {
    // reversal recovered a +0.5° pitch bias (stored in degrees)
    updateProfile({ levelBias: { pitch: 0.5, roll: 0 } });
    await mountLevel();

    const claim = host.querySelector('.level__claim')!;
    expect(claim.textContent).toContain('±0.15°');

    // raw sensor pitch 1.7° → displayed/saved 1.2° after bias removal
    drive(40, gravityForAngles(1.7, 0) as unknown as readonly [number, number, number]);
    await frame();
    await frame();
    expect(host.querySelector('.level__surface .num--measured')!.textContent).toContain('+1.2°');
    expect(host.querySelector('.level__surface .num__pm')!.textContent).toContain('±0.15°');

    (host.querySelector('.level__save') as HTMLButtonElement).click();
    await tick();
    const m = (await listMeasurements())[0]!.measurement;
    expect(m.value).toBeCloseTo(1.2, 1);
    expect(m.uncertainty.plusMinus).toBe(0.15);
    expect(m.confidence).toBe('STRONG');
    expect(m.provenance.notes).toContain('reversal-calibrated');
    expect(m.provenance.calibrations['levelBias']!.ok).toBe(true);
  });
});

describe('overlay FREEZE (§4.2.3)', () => {
  async function openLiveOverlay(): Promise<void> {
    const stream = new MediaStream();
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
      configurable: true,
    });
    await mountLevel();
    (host.querySelector('.level__mode[data-mode="overlay"]') as HTMLButtonElement).click();
    (host.querySelector('.ovl__start') as HTMLButtonElement).click();
    await tick();
    await tick();
  }

  it('freezing a held reading saves the wedge angle as a level Measurement', async () => {
    await openLiveOverlay();
    drive(40, [0, G, 0]); // upright portrait, dead still → HOLD, tilt 0
    await frame();
    await frame(); // overlay draw loop picks up the reading
    (host.querySelector('.ovl__freeze') as HTMLButtonElement).click();
    await tick();
    await tick();

    const entries = await listMeasurements();
    expect(entries.length).toBe(1);
    const m = entries[0]!.measurement;
    expect(m.kind).toBe('level');
    expect(m.value).toBeCloseTo(0, 1);
    expect(m.unit).toBe('°');
    expect(m.uncertainty.plusMinus).toBe(0.5);
    expect(m.confidence).toBe('LIKELY');
    expect(m.provenance.notes).toContain('overlay-freeze');
  });

  it('freezing while MOVING keeps the frame but refuses the measurement', async () => {
    await openLiveOverlay();
    drive(8, [0, G, 0], [40, 0, 0]); // never still
    await frame();
    await frame();
    (host.querySelector('.ovl__freeze') as HTMLButtonElement).click();
    await tick();
    await tick();
    expect((await listMeasurements()).length).toBe(0);
  });
});

describe('plumb saves as kind plumb with its out-over-run', () => {
  it('kind, sign, and the height note', async () => {
    await mountLevel();
    (host.querySelector('.level__mode[data-mode="plumb"]') as HTMLButtonElement).click();
    // portrait against a wall leaning back 2°
    const rad = Math.PI / 180;
    const a = [0, G * Math.cos(2 * rad), -G * Math.sin(2 * rad)] as const;
    drive(40, a);
    await frame();
    await frame();
    (host.querySelector('.level__save') as HTMLButtonElement).click();
    await tick();

    const m = (await listMeasurements())[0]!.measurement;
    expect(m.kind).toBe('plumb');
    expect(m.value).toBeCloseTo(-2, 1);
    expect(m.provenance.notes).toContain('mode:plumb');
    expect(m.provenance.notes).toContain('height:96in');
    expect(m.provenance.notes).toMatch(/out:-?\d+\.\d\din/);
  });
});
