// @vitest-environment happy-dom
/**
 * BEVEL tool DOM — SPEC §4.5, §15 (A4, Phase 2):
 *  - PRACTICE badge when nothing is sensed (§7B.9);
 *  - the saw card states its METHOD loudly, flat vs nested;
 *  - refusals render the explanation, never a number — exercised through the
 *    shipped demos, which drive the REAL capture pipeline.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '../../src/tools/bevel/index';
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

const ctx = (over: Partial<CapabilityReport> = {}): AppContext => ({ capability: cap(over), replayTrace: null });

function mountTool(over: Partial<CapabilityReport> = {}): { el: HTMLElement; unmount: () => void } {
  const el = document.createElement('div');
  document.body.append(el);
  const unmount = mount(el, ctx(over));
  return { el, unmount };
}

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('BEVEL tool', () => {
  it('shows the PRACTICE badge while no sensor is attached', () => {
    const { el, unmount } = mountTool();
    const badge = el.querySelector<HTMLElement>('#bevel-practice');
    expect(badge).toBeTruthy();
    expect(badge!.textContent).toContain('PRACTICE');
    expect(badge!.style.display).not.toBe('none');
    unmount();
  });

  it('the saw card states METHOD: FLAT loudly by default, with the canonical settings', () => {
    const { el, unmount } = mountTool();
    const method = el.querySelector('.sawcard__method');
    expect(method).toBeTruthy();
    expect(method!.textContent).toContain('FLAT');
    expect(method!.getAttribute('data-method')).toBe('flat');
    const card = el.querySelector('.sawcard')!;
    expect(card.textContent).toContain('35.3°'); // miter, 90° corner 45/45 crown
    expect(card.textContent).toContain('30.0°'); // bevel
    expect(card.textContent).toContain('scrap'); // the test-cut line
    unmount();
  });

  it('switching to NESTED restates the method and swaps the settings', () => {
    const { el, unmount } = mountTool();
    const nested = [...el.querySelectorAll('button')].find((b) => b.textContent === 'CUT NESTED')!;
    nested.click();
    const method = el.querySelector('.sawcard__method')!;
    expect(method.textContent).toContain('NESTED');
    expect(method.getAttribute('data-method')).toBe('nested');
    const card = el.querySelector('.sawcard')!;
    expect(card.textContent).toContain('45.0°'); // nested miter for a 90° corner
    expect(card.textContent).toContain('No tilt');
    unmount();
  });

  it('entered corner renders as exact derived math with the entered-claim caption', () => {
    const { el, unmount } = mountTool();
    const caption = el.querySelector('.sawcard + * , .sawcard')!;
    expect(el.querySelector('.sawcard')!.textContent).toContain('ENTERED');
    expect(caption.textContent).toContain('your');
    // settings wear derived provenance, never orange
    expect(el.querySelectorAll('.sawcard .derived').length).toBeGreaterThan(0);
    expect(el.querySelector('.sawcard .measured')).toBeNull();
    unmount();
  });

  it('3D mode is disabled honestly without a gyro', () => {
    const { el, unmount } = mountTool({ hasGyro: false });
    const btn = [...el.querySelectorAll('button')].find((b) => b.textContent?.startsWith('3D'))!;
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(btn.title).toContain('gyroscope');
    unmount();
  });

  it('tilted-edge DEMO renders the refusal explanation — never the angle', async () => {
    vi.useFakeTimers();
    const { el, unmount } = mountTool();
    const demoBtn = el.querySelector<HTMLButtonElement>('button[data-demo-id="bevel-tilted-edge"]')!;
    demoBtn.click();
    await vi.advanceTimersByTimeAsync(4000); // 4 s stream at 4× speed + slack
    const panel = el.querySelector('.demopanel')!;
    expect(panel.textContent).toContain('SYNTHETIC STREAM');
    const refusal = panel.querySelector('.bevel__refusal');
    expect(refusal).toBeTruthy();
    expect(refusal!.textContent).toContain('Joint edge is not level');
    expect(refusal!.textContent).toContain('capture again');
    // the true fold was 135° — the refusal never leaks it, and no measured
    // number renders anywhere in the outcome
    expect(refusal!.textContent).not.toContain('135');
    expect(panel.querySelector('.measured')).toBeNull();
    unmount();
  });

  it('drift-budget DEMO refuses with the GYRO_DRIFT warning through the real 3D machine', async () => {
    vi.useFakeTimers();
    const { el, unmount } = mountTool();
    const demoBtn = el.querySelector<HTMLButtonElement>('button[data-demo-id="bevel-drift-budget"]')!;
    demoBtn.click();
    await vi.advanceTimersByTimeAsync(9000); // ~25 s stream at 4× speed + slack
    const panel = el.querySelector('.demopanel')!;
    const band = panel.querySelector('[data-warning-key="GYRO_DRIFT"]');
    expect(band).toBeTruthy();
    const refusal = panel.querySelector('.bevel__refusal');
    expect(refusal).toBeTruthy();
    expect(refusal!.textContent).toContain('20');
    expect(panel.querySelector('.measured')).toBeNull();
    unmount();
  });

  it('known-cut DEMO reports the pipeline angle with its ±', async () => {
    vi.useFakeTimers();
    const { el, unmount } = mountTool();
    const demoBtn = el.querySelector<HTMLButtonElement>('button[data-demo-id="bevel-known-cut"]')!;
    demoBtn.click();
    await vi.advanceTimersByTimeAsync(4000);
    const panel = el.querySelector('.demopanel')!;
    expect(panel.textContent).toMatch(/Pipeline result: θ = 13[45](\.\d)?°/);
    expect(panel.textContent).toContain('±');
    unmount();
  });

  it('common-angle table pins nothing until a capture exists, and transfers on keyboard', () => {
    const { el, unmount } = mountTool();
    expect(el.querySelector('.angletable tr[data-pinned="true"]')).toBeNull();
    const holdBtns = [...el.querySelectorAll<HTMLButtonElement>('.angletable button')];
    expect(holdBtns.length).toBe(4); // 90 / 45 / 22.5 / 135
    holdBtns[3]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const cornerInput = el.querySelector<HTMLInputElement>('#bevel-corner')!;
    expect(cornerInput.value).toBe('135');
    expect(el.querySelector('.sawcard')!.textContent).toContain('135.0°');
    unmount();
  });

  it('unmount removes any active coach mark', () => {
    const { unmount } = mountTool();
    expect(document.querySelector('.coach')).toBeTruthy();
    unmount();
    expect(document.querySelector('.coach')).toBeNull();
  });
});
