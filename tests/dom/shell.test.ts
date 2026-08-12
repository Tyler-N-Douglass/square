// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { announce, applyTheme, buildShell, glove, theme, tierBadge } from '../../src/app/shell';
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

describe('tierBadge', () => {
  it('states the tier honestly, including NONE', () => {
    expect(tierBadge(cap({ magTier: 'FIELD' })).text).toBe('FIELD · µT');
    expect(tierBadge(cap({ magTier: 'PROXY' })).text).toBe('PROXY · deflection');
    expect(tierBadge(cap({ magTier: 'NONE' })).text).toBe('NO MAG · manual');
  });
});

describe('buildShell', () => {
  it('builds topbar, outlet, and keeps the setTitle contract', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const { outlet, setTitle } = buildShell(root, cap());
    expect(outlet.id).toBe('outlet');
    expect(outlet.tabIndex).toBe(-1);
    setTitle('LEVEL');
    expect(root.querySelector('.topbar__title')?.textContent).toBe('LEVEL');
    expect(root.querySelector('.badge')?.textContent).toBe('NO MAG · manual');
  });

  it('glove toggle flips data-glove on the document and its own pressed state', () => {
    applyTheme();
    const root = document.createElement('div');
    document.body.append(root);
    buildShell(root, cap());
    const btn = root.querySelector<HTMLButtonElement>('.topbar__glove')!;
    const before = glove.get();
    btn.click();
    expect(glove.get()).not.toBe(before);
    expect(document.documentElement.getAttribute('data-glove')).toBe(glove.get());
    expect(btn.getAttribute('aria-pressed')).toBe(glove.get() === 'on' ? 'true' : 'false');
    btn.click(); // restore
    expect(glove.get()).toBe(before);
  });

  it('theme toggle flips data-theme and announces the target in its label', () => {
    applyTheme();
    const root = document.createElement('div');
    document.body.append(root);
    buildShell(root, cap());
    const btn = root.querySelector<HTMLButtonElement>('.topbar__theme')!;
    const before = theme.get();
    btn.click();
    expect(theme.get()).not.toBe(before);
    expect(document.documentElement.getAttribute('data-theme')).toBe(theme.get());
    const target = theme.get() === 'night' ? 'shop' : 'night';
    expect(btn.getAttribute('aria-label')).toBe(`Switch to ${target} theme`);
    btn.click(); // restore
  });

  it('shows the capability banner only for real critical blockers', () => {
    const root = document.createElement('div');
    document.body.append(root);
    buildShell(root, cap());
    expect(root.querySelector('.capbanner--visible')).toBeNull();

    const root2 = document.createElement('div');
    document.body.append(root2);
    buildShell(
      root2,
      cap({
        secureContext: false,
        blockers: [{ code: 'INSECURE_CONTEXT', message: 'Sensors need HTTPS.', remedy: 'Open the https:// address.' }],
      }),
    );
    const banner = root2.querySelector('.capbanner--visible');
    expect(banner?.textContent).toContain('Sensors need HTTPS.');
    expect(banner?.textContent).toContain('Open the https:// address.');
  });
});

describe('announce', () => {
  it('routes values politely and warnings assertively (SPEC §7.7)', () => {
    announce('PEAK');
    announce('Wall reads hot.', 'assertive');
    const polite = document.querySelector('[aria-live="polite"].visually-hidden');
    const assertive = document.querySelector('[aria-live="assertive"].visually-hidden');
    expect(polite?.textContent).toBe('PEAK');
    expect(assertive?.textContent).toBe('Wall reads hot.');
  });

  it('re-announces a repeated state word by nudging the text', () => {
    announce('PEAK');
    const polite = document.querySelector('[aria-live="polite"].visually-hidden');
    const first = polite?.textContent;
    announce('PEAK');
    expect(polite?.textContent).not.toBe(first);
    expect(polite?.textContent?.trim()).toBe('PEAK');
  });
});
