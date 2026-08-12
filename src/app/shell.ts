/**
 * App shell — top bar (wordmark, capability badge, theme toggle), outlet,
 * capability banner with honest blockers. A7 territory; Phase 0 skeleton.
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

  const themeBtn = document.createElement('button');
  themeBtn.className = 'btn btn--ghost topbar__theme';
  themeBtn.setAttribute('aria-label', 'Switch theme');
  const syncThemeBtn = () => { themeBtn.textContent = theme.get() === 'night' ? 'SHOP' : 'NIGHT'; };
  syncThemeBtn();
  themeBtn.addEventListener('click', () => {
    theme.set(theme.get() === 'night' ? 'shop' : 'night');
    syncThemeBtn();
  });

  bar.append(home, title, badge, themeBtn);

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
  return { outlet, setTitle: (t: string) => { title.textContent = t; } };
}
