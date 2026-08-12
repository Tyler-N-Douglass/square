// @vitest-environment happy-dom
/**
 * LAYOUT tool DOM — SPEC §4.4, §5, §15 (A4, Phase 2):
 *  - PRACTICE badge shows while nothing is sensed (§7B.9);
 *  - the chaining warning renders verbatim and prominently;
 *  - refusals render the stated reason, never a clamped table;
 *  - outputs wear derived provenance — no orange without a live sensor.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '../../src/tools/layout/index';
import { LAYOUT_TAPE_WARNING } from '../../src/geometry/layout';
import { clearProfile, updateProfile } from '../../src/app/calibrationStore';
import { gravityForAngles } from '../../src/tools/level/demoStream';
import type { AppContext } from '../../src/app/router';
import type { CapabilityReport } from '../../src/sensors/types';

function cap(over: Partial<CapabilityReport> = {}): CapabilityReport {
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
    platformHint: 'desktop',
    sampleRates: {},
    blockers: [],
    ...over,
  };
}

const ctx = (): AppContext => ({ capability: cap(), replayTrace: null });

function mountTool(): { el: HTMLElement; unmount: () => void } {
  const el = document.createElement('div');
  document.body.append(el);
  const unmount = mount(el, ctx());
  return { el, unmount };
}

function setInput(el: HTMLElement, selector: string, value: string, event = 'input'): void {
  const input = el.querySelector<HTMLInputElement>(selector);
  expect(input, selector).toBeTruthy();
  input!.value = value;
  input!.dispatchEvent(new Event(event, { bubbles: true }));
}

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
});

describe('LAYOUT tool', () => {
  it('shows the PRACTICE badge while nothing is sensed', () => {
    const { el, unmount } = mountTool();
    const badge = el.querySelector<HTMLElement>('#layout-practice');
    expect(badge).toBeTruthy();
    expect(badge!.textContent).toContain('PRACTICE');
    expect(badge!.style.display).not.toBe('none');
    unmount();
  });

  it('renders the table with BOTH labeled columns and the verbatim chaining warning', () => {
    const { el, unmount } = mountTool();
    setInput(el, '#layout-span', `10'`);
    const warning = el.querySelector('.layout__tape-warning');
    expect(warning).toBeTruthy();
    expect(warning!.textContent).toBe(LAYOUT_TAPE_WARNING);

    const table = el.querySelector('.marktable');
    expect(table).toBeTruthy();
    const headers = [...table!.querySelectorAll('th')].map((th) => th.textContent ?? '');
    expect(headers.some((t) => t.includes('CUMULATIVE'))).toBe(true);
    expect(headers.some((t) => t.includes('INCREMENTAL'))).toBe(true);
    // 5 marks (default count) on 120″ → pitch 120/6 = 20″
    expect(table!.querySelectorAll('tbody tr').length).toBe(5);
    expect(table!.textContent).toContain('1′ 8″');
    unmount();
  });

  it('outputs wear derived provenance — never orange without a live sensor', () => {
    const { el, unmount } = mountTool();
    setInput(el, '#layout-span', `8' 6"`);
    expect(el.querySelectorAll('.marktable .derived').length).toBeGreaterThan(0);
    // the span echo wears ENTERED provenance; nothing wears orange
    expect(el.querySelector('.layout__echo .entered')).toBeTruthy();
    expect(el.querySelector('.measured')).toBeNull();
    unmount();
  });

  it('mm toggle adds the millimetre column', () => {
    const { el, unmount } = mountTool();
    setInput(el, '#layout-span', `10'`);
    const mmBtn = [...el.querySelectorAll('button')].find((b) => b.textContent === 'MM')!;
    mmBtn.click();
    const headers = [...el.querySelectorAll('.marktable th')].map((th) => th.textContent ?? '');
    expect(headers.some((t) => t === 'MM')).toBe(true);
    expect(el.querySelector('.marktable')!.textContent).toContain('mm');
    unmount();
  });

  it('REFUSES an impossible layout with the stated reason and no table', () => {
    const { el, unmount } = mountTool();
    const modeSelect = el.querySelector<HTMLSelectElement>('#layout-mode')!;
    modeSelect.value = 'equal-gaps';
    modeSelect.dispatchEvent(new Event('change', { bubbles: true }));
    setInput(el, '#layout-span', `10'`);
    setInput(el, '#layout-count', '6');
    setInput(el, '#layout-width', '24"');

    const refusal = el.querySelector('.layout__refusal');
    expect(refusal).toBeTruthy();
    expect(refusal!.textContent).toContain(`Doesn't fit`);
    expect(refusal!.textContent).toContain('short');
    expect(el.querySelector('.marktable')).toBeNull();
    unmount();
  });

  it('an unreadable span states the parse problem instead of guessing', () => {
    const { el, unmount } = mountTool();
    setInput(el, '#layout-span', 'about eight feet');
    expect(el.querySelector('.layout__parse-error')!.textContent).toContain(`Can't read`);
    expect(el.querySelector('.marktable')).toBeNull();
    unmount();
  });

  it('presets prefill the form and state their assumption', () => {
    const { el, unmount } = mountTool();
    const galleryBtn = [...el.querySelectorAll('button')].find((b) => b.textContent === 'GALLERY WALL')!;
    galleryBtn.click();
    const assumption = el.querySelector<HTMLElement>('.preset__assumption')!;
    expect(assumption.style.display).not.toBe('none');
    expect(assumption.textContent).toContain('57″');
    expect(el.querySelector('.marktable')).toBeTruthy();
    unmount();
  });

  it('stud datum with an empty log says so and links SCAN', async () => {
    const { el, unmount } = mountTool();
    const studBtn = [...el.querySelectorAll('button')].find((b) => b.textContent === 'USE FOUND STUDS')!;
    studBtn.click();
    await new Promise((r) => setTimeout(r, 0));
    const section = el.querySelector('#layout-studs')!;
    expect(section.textContent).toContain('No stud scans in the log');
    expect(section.querySelector('a[href="#/scan"]')).toBeTruthy();
    unmount();
  });

  it('worked-example DEMO panels open labeled as real solver output', () => {
    const { el, unmount } = mountTool();
    const demoBtn = el.querySelector<HTMLButtonElement>('button[data-demo-id="layout-gallery-wall"]')!;
    demoBtn.click();
    const panel = el.querySelector<HTMLElement>('.workedpanel')!;
    expect(panel.style.display).not.toBe('none');
    expect(panel.textContent).toContain('WORKED EXAMPLE — real solver output');
    unmount();
  });

  it('states the read-aloud list and the true-scale print limit', () => {
    const { el, unmount } = mountTool();
    setInput(el, '#layout-span', `10'`);
    expect(el.querySelectorAll('.readaloud li').length).toBe(5);
    expect(el.querySelector('#layout-pole')!.textContent).toContain('true scale');
    unmount();
  });

  it('unmount removes any active coach mark', () => {
    const { unmount } = mountTool();
    // the guided run auto-starts on a fresh FadingStore
    expect(document.querySelector('.coach')).toBeTruthy();
    unmount();
    expect(document.querySelector('.coach')).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * Level-line claim discipline (H-01, SPEC §2.3.5): the roll capture
 * subtracts the stored reversal bias, its ± is never tighter than the
 * calibration-state claim, and confidence caps at LIKELY uncalibrated.
 * ------------------------------------------------------------------ */

describe('LAYOUT level line — claim discipline (H-01)', () => {
  let vnow = 0;

  const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

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

  async function captureRoll(el: HTMLElement, rollDeg: number): Promise<void> {
    (el.querySelector('#layout-level-wake') as HTMLButtonElement).click();
    await tick();
    await tick();
    const armBtn = [...el.querySelectorAll('button')].find((b) => b.textContent === 'CAPTURE ROLL')!;
    expect(armBtn.hasAttribute('disabled')).toBe(false);
    armBtn.click();
    // 400 ms stillness gate + 500 ms capture window at ~60 Hz
    const g = gravityForAngles(0, rollDeg) as unknown as readonly [number, number, number];
    for (let i = 0; i < 80; i++) motion(g);
  }

  beforeEach(() => {
    vnow = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => vnow);
    // No requestPermission function → 'not-required', same as Android.
    (globalThis as Record<string, unknown>)['DeviceMotionEvent'] = function DeviceMotionEvent(): void {};
    localStorage.clear();
    clearProfile();
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>)['DeviceMotionEvent'];
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('uncalibrated: a very quiet window still claims ±0.50° and caps at LIKELY — and the drop inherits the ±', async () => {
    const { el, unmount } = mountTool();
    setInput(el, '#layout-span', `10'`);
    await captureRoll(el, 0.42);

    const level = el.querySelector('#layout-level')!;
    const readout = level.querySelector('.num--measured')!;
    // The window scatter here is ~0° — the old code claimed ±0.05° STRONG.
    expect(readout.querySelector('.num__pm')!.textContent).toBe('±0.50°');
    expect(readout.querySelector('.num__pm')!.getAttribute('data-basis')).toBe('nominal');
    expect(readout.querySelector('.conf--likely')).toBeTruthy();
    expect(readout.querySelector('.conf--strong')).toBeNull();
    // The claim line states which state is in effect.
    expect(level.textContent).toContain('reversal calibration not run');
    // Drop over 120″: ± = span · claimRad / cos²θ ≈ 1.05″, basis nominal —
    // an order of magnitude wider than the old scatter-only ±0.08″.
    const drop = level.querySelector('.num--derived .num__pm')!;
    expect(drop.textContent).toBe('±1.0″');
    expect(drop.getAttribute('data-basis')).toBe('nominal');
    unmount();
  });

  it('calibrated: subtracts the stored levelBias (degrees) and claims ±0.15° STRONG', async () => {
    updateProfile({ levelBias: { pitch: 0, roll: 0.42 } });
    const { el, unmount } = mountTool();
    await captureRoll(el, 0.42);

    const readout = el.querySelector('#layout-level .num--measured')!;
    // The bias is subtracted before the capture ever sees the roll.
    expect(Math.abs(parseFloat(readout.querySelector('.num__value')!.textContent!))).toBeLessThan(0.05);
    expect(readout.querySelector('.num__pm')!.textContent).toBe('±0.15°');
    expect(readout.querySelector('.conf--strong')).toBeTruthy();
    unmount();
  });
});
