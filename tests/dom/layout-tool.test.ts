// @vitest-environment happy-dom
/**
 * LAYOUT tool DOM — SPEC §4.4, §5, §15 (A4, Phase 2):
 *  - PRACTICE badge shows while nothing is sensed (§7B.9);
 *  - the chaining warning renders verbatim and prominently;
 *  - refusals render the stated reason, never a clamped table;
 *  - outputs wear derived provenance — no orange without a live sensor.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { mount } from '../../src/tools/layout/index';
import { LAYOUT_TAPE_WARNING } from '../../src/geometry/layout';
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
