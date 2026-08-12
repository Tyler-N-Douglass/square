// @vitest-environment happy-dom
/**
 * Permission choreography (SPEC §6): the §6.1 wake gesture with its one-line
 * reason; denial → recovery instructions + the practice form (the math still
 * works — never a dead end); the overlay's §6.2 camera request with inline
 * reason, denial recovery, and the other modes unaffected.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../../src/app/router';
import type { CapabilityReport } from '../../src/sensors/types';
import { clearProfile } from '../../src/app/calibrationStore';
import { deleteAll } from '../../src/app/logStore';
import { mount } from '../../src/tools/level/index';

function cap(): CapabilityReport {
  return {
    magTier: 'NONE',
    hasAccel: true,
    hasGyro: true,
    hasAbsoluteOrientation: false,
    hasCamera: true,
    cameraCount: 1,
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

let host: HTMLElement;
let unmount: (() => void) | null = null;
const g = globalThis as Record<string, unknown>;

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

beforeEach(async () => {
  localStorage.clear();
  await deleteAll();
  clearProfile();
});

afterEach(() => {
  unmount?.();
  unmount = null;
  delete g['DeviceMotionEvent'];
  delete g['DeviceOrientationEvent'];
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function mountLevel(): void {
  host = document.createElement('div');
  document.body.append(host);
  unmount = mount(host, ctx);
}

describe('the §6.1 wake gesture', () => {
  it('renders TAP TO WAKE SENSORS with a one-line reason when the platform gates motion', () => {
    g['DeviceMotionEvent'] = { requestPermission: vi.fn().mockResolvedValue('granted') };
    g['DeviceOrientationEvent'] = { requestPermission: vi.fn().mockResolvedValue('granted') };
    mountLevel();
    const panel = host.querySelector('.level__wakepanel') as HTMLElement;
    expect(panel.hidden).toBe(false);
    expect(host.querySelector('.level__wake')!.textContent).toBe('TAP TO WAKE SENSORS');
    expect(host.querySelector('.level__wakereason')!.textContent).toContain('nothing leaves the phone');
  });

  it('grant hides the panel and starts the sensors', async () => {
    g['DeviceMotionEvent'] = { requestPermission: vi.fn().mockResolvedValue('granted') };
    g['DeviceOrientationEvent'] = { requestPermission: vi.fn().mockResolvedValue('granted') };
    mountLevel();
    (host.querySelector('.level__wake') as HTMLButtonElement).click();
    await tick();
    await tick();
    expect((host.querySelector('.level__wakepanel') as HTMLElement).hidden).toBe(true);
    expect((host.querySelector('.level__denied') as HTMLElement).hidden).toBe(true);
  });
});

describe('denial → recovery + practice form, never a dead end', () => {
  async function deny(): Promise<void> {
    g['DeviceMotionEvent'] = { requestPermission: vi.fn().mockResolvedValue('denied') };
    g['DeviceOrientationEvent'] = { requestPermission: vi.fn().mockResolvedValue('denied') };
    mountLevel();
    (host.querySelector('.level__wake') as HTMLButtonElement).click();
    await tick();
    await tick();
  }

  it('shows the platform recovery path and keeps the rest of the app framed as working', async () => {
    await deny();
    const panel = host.querySelector('.level__denied') as HTMLElement;
    expect(panel.hidden).toBe(false);
    const text = panel.textContent!;
    expect(text).toContain('MOTION ACCESS DENIED');
    expect(text).toContain('allow motion sensors'); // recoveryInstructions('motion', non-ios)
    expect(text).toContain('every other tool is unaffected');
  });

  it('the practice form runs the real slope math on typed numbers — ENTERED and DERIVED, never orange', async () => {
    await deny();
    const panel = host.querySelector('.level__denied')!;
    const angle = panel.querySelector('input[aria-label*="Angle"]') as HTMLInputElement;
    angle.value = '3';
    angle.dispatchEvent(new Event('input'));

    const out = panel.querySelector('.level__practiceout')!;
    expect(out.querySelector('.num--entered')).toBeTruthy();
    expect(out.querySelectorAll('.num--derived').length).toBeGreaterThanOrEqual(4);
    expect(out.querySelector('.measured')).toBeNull(); // nothing is being measured
    // out-by over the default 96″ appears too
    expect(out.textContent).toContain('out by');
    // 3° ≈ 0.63 in/ft — the drain callout fires in practice as well
    const drain = out.querySelector('.lvlstrip__drain');
    expect(drain).toBeTruthy();
    expect(drain!.getAttribute('data-state')).toBe('over');
  });

  it('mode controls remain present and usable after denial', async () => {
    await deny();
    const modes = host.querySelectorAll('.level__mode');
    expect(modes.length).toBe(4);
    (host.querySelector('.level__mode[data-mode="edge"]') as HTMLButtonElement).click();
    expect(host.querySelector('.level__edge')!.classList.contains('level__panel--active')).toBe(true);
  });
});

describe('overlay camera (§6.2): request only on open, inline reason, denial recovery', () => {
  it('shows the inline reason first; camera is requested only from the START gesture', async () => {
    const gum = vi.fn().mockRejectedValue(Object.assign(new Error('nope'), { name: 'NotAllowedError' }));
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: gum }, configurable: true });
    mountLevel();
    await tick();

    (host.querySelector('.level__mode[data-mode="overlay"]') as HTMLButtonElement).click();
    expect(host.querySelector('.ovl__reasonline')!.textContent).toContain('stays on the phone');
    expect(gum).not.toHaveBeenCalled(); // opening the mode alone never prompts

    (host.querySelector('.ovl__start') as HTMLButtonElement).click();
    await tick();
    await tick();
    expect(gum).toHaveBeenCalledWith({ video: { facingMode: { ideal: 'environment' } } });

    const rec = host.querySelector('.ovl__recovery') as HTMLElement;
    expect(rec.hidden).toBe(false);
    expect(rec.textContent).toContain('Camera permission was denied.');
    expect(rec.textContent).toContain('Camera'); // platform recovery line
    expect(rec.textContent).toContain('keep working without the camera');
  });

  it('after camera denial the other modes still work', async () => {
    const gum = vi.fn().mockRejectedValue(Object.assign(new Error('nope'), { name: 'NotAllowedError' }));
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: gum }, configurable: true });
    mountLevel();
    await tick();
    (host.querySelector('.level__mode[data-mode="overlay"]') as HTMLButtonElement).click();
    (host.querySelector('.ovl__start') as HTMLButtonElement).click();
    await tick();
    await tick();

    (host.querySelector('.level__mode[data-mode="surface"]') as HTMLButtonElement).click();
    expect(host.querySelector('.level__surface')!.classList.contains('level__panel--active')).toBe(true);
    expect(host.querySelector('.bubble')).toBeTruthy();
  });

  it('no camera API at all: honest recovery, still no dead end', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
    mountLevel();
    await tick();
    (host.querySelector('.level__mode[data-mode="overlay"]') as HTMLButtonElement).click();
    (host.querySelector('.ovl__start') as HTMLButtonElement).click();
    await tick();
    const rec = host.querySelector('.ovl__recovery') as HTMLElement;
    expect(rec.hidden).toBe(false);
    expect(rec.textContent).toContain('does not offer a camera');
    (host.querySelector('.level__mode[data-mode="plumb"]') as HTMLButtonElement).click();
    expect(host.querySelector('.level__plumb')!.classList.contains('level__panel--active')).toBe(true);
  });
});
