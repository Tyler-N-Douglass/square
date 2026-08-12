/**
 * App shell — top bar (wordmark, capability badge, glove + theme toggles),
 * outlet, capability banner with honest blockers, and the screen-reader
 * announcer. A7 territory.
 *
 * The announcer is the one path for spoken state: announce(text) for values
 * and state words (polite), announce(text, 'assertive') for warnings
 * (SPEC §7.7 — a screen-reader user must be able to run SCAN by audio
 * alone, and so should everyone else, because the screen faces the wall).
 */
import type { CapabilityReport } from '../sensors/types';
import { persisted } from './store';

export const theme = persisted<'shop' | 'night'>('square.theme', matchMedia('(prefers-color-scheme: dark)').matches ? 'night' : 'shop');
export const glove = persisted<'off' | 'on'>('square.glove', 'off');

export function applyTheme(): void {
  theme.subscribe((t) => document.documentElement.setAttribute('data-theme', t === 'night' ? 'night' : 'shop'));
  glove.subscribe((g) => document.documentElement.setAttribute('data-glove', g));
}

export function tierBadge(cap: CapabilityReport): { text: string; cls: string } {
  switch (cap.magTier) {
    case 'FIELD': return { text: 'FIELD · µT', cls: 'badge badge--field' };
    case 'PROXY': return { text: 'PROXY · deflection', cls: 'badge badge--proxy' };
    case 'NONE': return { text: 'NO MAG · manual', cls: 'badge badge--none' };
  }
}

/* ---------- screen-reader live regions ---------- */

export type Urgency = 'polite' | 'assertive';

let liveEls: { polite: HTMLElement; assertive: HTMLElement } | null = null;

function ensureLiveRegions(): { polite: HTMLElement; assertive: HTMLElement } {
  if (liveEls && liveEls.polite.isConnected) return liveEls;
  const make = (mode: Urgency): HTMLElement => {
    const el = document.createElement('div');
    el.className = 'visually-hidden';
    el.setAttribute('aria-live', mode);
    el.setAttribute('aria-atomic', 'true');
    document.body.append(el);
    return el;
  };
  liveEls = { polite: make('polite'), assertive: make('assertive') };
  return liveEls;
}

/**
 * Announce to screen readers. 'polite' for values and state words
 * (PEAK, LEVEL, HOLD), 'assertive' for warnings. Repeats of the same text
 * are re-announced — a second PEAK matters as much as the first.
 */
export function announce(text: string, urgency: Urgency = 'polite'): void {
  const els = ensureLiveRegions();
  const el = urgency === 'assertive' ? els.assertive : els.polite;
  el.textContent = el.textContent === text ? `${text} ` : text;
}

/* ---------- shell ---------- */

export function buildShell(root: HTMLElement, cap: CapabilityReport): { outlet: HTMLElement; setTitle: (t: string) => void } {
  root.innerHTML = '';

  const bar = document.createElement('header');
  bar.className = 'topbar';

  const home = document.createElement('a');
  home.href = '#/';
  home.className = 'topbar__mark display';
  home.textContent = 'SQUARE';
  home.setAttribute('aria-label', 'SQUARE home');

  const title = document.createElement('span');
  title.className = 'topbar__title display';
  title.setAttribute('aria-live', 'polite');

  const badge = document.createElement('span');
  const b = tierBadge(cap);
  badge.className = b.cls;
  badge.textContent = b.text;
  badge.title = 'Magnetometer capability on this device';

  const gloveBtn = document.createElement('button');
  gloveBtn.type = 'button';
  gloveBtn.className = 'btn btn--ghost topbar__glove';
  gloveBtn.textContent = 'GLOVE';
  gloveBtn.setAttribute('aria-label', 'Glove mode — larger targets, wider spacing');
  const syncGloveBtn = (): void => {
    gloveBtn.setAttribute('aria-pressed', glove.get() === 'on' ? 'true' : 'false');
  };
  syncGloveBtn();
  gloveBtn.addEventListener('click', () => {
    glove.set(glove.get() === 'on' ? 'off' : 'on');
    syncGloveBtn();
    announce(glove.get() === 'on' ? 'Glove mode on' : 'Glove mode off');
  });

  const themeBtn = document.createElement('button');
  themeBtn.type = 'button';
  themeBtn.className = 'btn btn--ghost topbar__theme';
  const syncThemeBtn = (): void => {
    const target = theme.get() === 'night' ? 'shop' : 'night';
    themeBtn.textContent = target === 'night' ? 'NIGHT' : 'SHOP';
    themeBtn.setAttribute('aria-label', `Switch to ${target} theme`);
  };
  syncThemeBtn();
  themeBtn.addEventListener('click', () => {
    theme.set(theme.get() === 'night' ? 'shop' : 'night');
    syncThemeBtn();
  });

  bar.append(home, title, badge, gloveBtn, themeBtn);

  const banner = document.createElement('div');
  banner.className = 'capbanner';
  banner.setAttribute('role', 'status');
  if (!cap.secureContext || !cap.permissionsPolicyOk) {
    const critical = cap.blockers.find((x) => x.code === 'INSECURE_CONTEXT' || x.code === 'PERMISSIONS_POLICY');
    if (critical) {
      banner.textContent = `${critical.message} ${critical.remedy}`;
      banner.classList.add('capbanner--visible');
    }
  }

  const outlet = document.createElement('main');
  outlet.className = 'outlet';
  outlet.id = 'outlet';
  outlet.tabIndex = -1;

  root.append(bar, banner, outlet);
  ensureLiveRegions();
  return { outlet, setTitle: (t: string) => { title.textContent = t; } };
}
