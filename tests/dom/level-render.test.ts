// @vitest-environment happy-dom
/**
 * LEVEL render states (SPEC §4.2.1, §4.2.3): MOVING dims and strips the ±
 * (render-path enforcement, not copy); HOLD restores the claim; EDGE locks
 * green with the ghost bob out-of-tolerance and never orange; the slope
 * strip appears only with a held reading; ZERO HERE is visible and
 * reversible.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../../src/app/router';
import type { CapabilityReport } from '../../src/sensors/types';
import { deleteAll } from '../../src/app/logStore';
import { clearProfile } from '../../src/app/calibrationStore';
import { drainSlopeCheck } from '../../src/geometry/levelMath';
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
  await tick(); // beginSensors() subscribes after a microtask
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

const FACE_UP = [0, 0, G] as const;

describe('motion gate in the render path', () => {
  it('MOVING: dims, labels, and strips the ± — a twitching number is never a measurement', async () => {
    await mountLevel();
    drive(6, FACE_UP, [40, 0, 0]); // 0.7 rad/s about z — the gate refuses
    await frame();
    await frame();

    const state = host.querySelector('.level__state')!;
    expect(state.textContent).toBe('MOVING');
    expect(host.querySelector('.level')!.classList.contains('level--moving')).toBe(true);
    // no ± while moving — the reading is an indication, not a measurement
    expect(host.querySelector('.level__surface .num__pm')).toBeNull();
    expect(host.querySelector('.level__surface .conf--possible')).toBeTruthy();
  });

  it('HOLD appears only after 400 ms of stillness, and the ± claim returns', async () => {
    await mountLevel();
    drive(6, FACE_UP, [40, 0, 0]);
    drive(10, FACE_UP); // still, but only ~170 ms
    await frame();
    await frame();
    expect(host.querySelector('.level__state')!.textContent).toBe('MOVING');

    drive(30, FACE_UP); // past 400 ms of stillness
    await frame();
    await frame();
    const state = host.querySelector('.level__state')!;
    expect(state.textContent).toBe('HOLD');
    expect(host.querySelector('.level')!.classList.contains('level--moving')).toBe(false);
    const pm = host.querySelector('.level__surface .num__pm');
    expect(pm).toBeTruthy();
    expect(pm!.textContent).toContain('±0.50°'); // uncalibrated claim
  });
});

describe('EDGE mode — lock, tone path, ghost bob', () => {
  it('reads the long-edge angle huge, shows the ghost bob when held out of tolerance', async () => {
    await mountLevel();
    (host.querySelector('.level__mode[data-mode="edge"]') as HTMLButtonElement).click();
    const rad = Math.PI / 180;
    const a = [-G * Math.cos(1 * rad), G * Math.sin(1 * rad), 0] as const;
    drive(35, a);
    await frame();
    await frame();

    const primary = host.querySelector('.level__edge .num--primary')!;
    expect(primary.textContent).toContain('+1.0°');
    const ghost = host.querySelector('.level__ghost') as HTMLElement;
    expect(ghost.hidden).toBe(false);
    // ADR-010: the ghost is the gravity reference — currentColor, never orange
    expect(ghost.innerHTML).toContain('currentColor');
    expect(ghost.innerHTML.toUpperCase()).not.toContain('#F15A22');
    expect(ghost.closest('.measured')).toBeNull();
    expect(host.querySelector('.level__lock')!.textContent).toBe('');
  });

  it('locks green inside 0.2° and hides the ghost', async () => {
    await mountLevel();
    (host.querySelector('.level__mode[data-mode="edge"]') as HTMLButtonElement).click();
    drive(35, [-G, 0, 0]); // dead level on the long edge
    await frame();
    await frame();

    const lock = host.querySelector('.level__lock')!;
    expect(lock.textContent).toBe('LEVEL');
    expect(lock.classList.contains('state-lock')).toBe(true);
    expect((host.querySelector('.level__ghost') as HTMLElement).hidden).toBe(true);
  });
});

describe('slope strip (§4.2.3)', () => {
  it('idles until HOLD, then shows every form as DERIVED with the drain callout verbatim', async () => {
    await mountLevel();
    expect((host.querySelector('.lvlstrip__idle') as HTMLElement).hidden).toBe(false);
    expect((host.querySelector('.lvlstrip__rows') as HTMLElement).hidden).toBe(true);

    drive(35, gravityForAngles(1.2, 0) as unknown as readonly [number, number, number]);
    await frame();
    await frame();

    const rows = host.querySelectorAll('.lvlstrip__row');
    expect(rows.length).toBe(5); // four forms + rise:run
    const labels = [...host.querySelectorAll('.lvlstrip__label')].map((n) => n.textContent);
    expect(labels).toContain('ANGLE');
    expect(labels).toContain('GRADE');
    expect(labels).toContain('PER FOOT');
    expect(labels).toContain('PER METRE');
    // derived, never measured-orange
    expect(host.querySelectorAll('.lvlstrip .num--derived').length).toBeGreaterThanOrEqual(5);
    expect(host.querySelector('.lvlstrip .measured')).toBeNull();

    const drain = host.querySelector('.lvlstrip__drain') as HTMLElement;
    expect(drain.hidden).toBe(false);
    expect(drain.getAttribute('data-state')).toBe('in-band');
    const inPerFt = 12 * Math.tan((1.2 * Math.PI) / 180);
    expect(drain.textContent).toBe(drainSlopeCheck(inPerFt).message);
  });
});

describe('ZERO HERE (§4.2.2)', () => {
  it('zeroes visibly, reads zero on the same surface, and clears visibly', async () => {
    await mountLevel();
    const g12 = gravityForAngles(1.2, 0) as unknown as readonly [number, number, number];
    drive(35, g12);
    await frame();
    await frame();

    const zeroBtn = host.querySelector('.level__zero') as HTMLButtonElement;
    const chip = host.querySelector('.level__zerochip') as HTMLElement;
    expect(chip.hidden).toBe(true);
    zeroBtn.click();
    expect(chip.hidden).toBe(false);
    expect(zeroBtn.textContent).toBe('CLEAR ZERO');

    drive(5, g12);
    await frame();
    await frame();
    const pitchText = host.querySelector('.level__surface .num--measured')!.textContent!;
    expect(pitchText).toContain('+0.0°');

    zeroBtn.click();
    expect(chip.hidden).toBe(true);
    expect(zeroBtn.textContent).toBe('ZERO HERE');
    drive(5, g12);
    await frame();
    await frame();
    expect(host.querySelector('.level__surface .num--measured')!.textContent).toContain('+1.2°');
  });
});
