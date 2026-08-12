// @vitest-environment happy-dom
/**
 * LEVEL source health (H-02, SPEC §15.4): the no-sample watchdog covers only
 * the first 2.5 s — a stream that dies AFTER HOLD must not leave a frozen
 * orange angle looking live. The tool polls fusion.health every second while
 * live: on 'dead' the state word clears to SENSOR LOST, the readout dims
 * (the level--moving restyle — not live), and the existing recovery panel
 * shows. Samples resuming clear the state.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../../src/app/router';
import type { CapabilityReport } from '../../src/sensors/types';
import { deleteAll } from '../../src/app/logStore';
import { clearProfile } from '../../src/app/calibrationStore';
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

function motion(a: readonly [number, number, number]): void {
  vnow += 16.7;
  const e = new Event('devicemotion') as Event & {
    accelerationIncludingGravity: { x: number; y: number; z: number };
    rotationRate: { alpha: number; beta: number; gamma: number };
  };
  e.accelerationIncludingGravity = { x: a[0], y: a[1], z: a[2] };
  e.rotationRate = { alpha: 0, beta: 0, gamma: 0 };
  window.dispatchEvent(e);
}

const FACE_UP = [0, 0, G] as const;

describe('H-02 — a stream that dies after HOLD must not stay looking live', () => {
  let host: HTMLElement;
  let unmount: (() => void) | null = null;

  beforeEach(async () => {
    vi.useFakeTimers();
    vnow = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => vnow);
    localStorage.clear();
    await deleteAll();
    clearProfile();
    host = document.createElement('div');
    document.body.append(host);
  });

  afterEach(() => {
    unmount?.();
    unmount = null;
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  async function mountToHold(): Promise<void> {
    unmount = mount(host, ctx);
    await vi.advanceTimersByTimeAsync(0); // beginSensors subscribes after a microtask
    for (let i = 0; i < 35; i++) motion(FACE_UP);
    await vi.advanceTimersByTimeAsync(40); // raf paint
    expect(host.querySelector('.level__state')!.textContent).toBe('HOLD');
  }

  async function killStream(): Promise<void> {
    // No more samples; the source watchdog flags dead after > 2 s of silence
    // and the tool's 1 s health poll picks it up.
    vnow += 3200;
    await vi.advanceTimersByTimeAsync(3200);
  }

  it('SENSOR LOST: state word clears, the readout dims to non-live, the recovery panel shows', async () => {
    await mountToHold();
    await killStream();

    expect(host.querySelector('.level__state')!.textContent).toBe('SENSOR LOST');
    // The last value never keeps looking live — the moving restyle dims it.
    expect(host.querySelector('.level')!.classList.contains('level--moving')).toBe(true);
    expect((host.querySelector('.level__nosensors') as HTMLElement).hidden).toBe(false);
  });

  it('samples resuming clear SENSOR LOST and repaint the live state', async () => {
    await mountToHold();
    await killStream();
    expect(host.querySelector('.level__state')!.textContent).toBe('SENSOR LOST');

    for (let i = 0; i < 35; i++) motion(FACE_UP);
    await vi.advanceTimersByTimeAsync(40);

    expect(host.querySelector('.level__state')!.textContent).toBe('HOLD');
    expect(host.querySelector('.level')!.classList.contains('level--moving')).toBe(false);
    expect((host.querySelector('.level__nosensors') as HTMLElement).hidden).toBe(true);
  });
});
