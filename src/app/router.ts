/**
 * Hash router — SPEC §3.2. Seven tools + home + manual. Tool modules are
 * lazy-loaded so each tool is its own chunk (bundle budget, SPEC §9).
 */
import type { CapabilityReport } from '../sensors/types';
import type { SensorTrace } from '../types';

export interface AppContext {
  capability: CapabilityReport;
  /** Present when the app was launched with ?replay=<fixture-id>. */
  replayTrace: SensorTrace | null;
}

export type Unmount = () => void;
export interface ToolModule { mount(el: HTMLElement, ctx: AppContext): Unmount; }

export type RouteId = 'home' | 'scan' | 'level' | 'corner' | 'layout' | 'bevel' | 'calibrate' | 'log' | 'manual';

// Tile subtitles are the plain task, verb first (ADR-015): each tile says
// the job in homeowner language; the trade framing lives one level deeper
// (tool screens, glossary).
export const TOOL_ROUTES: ReadonlyArray<{ id: RouteId; title: string; line: string }> = [
  { id: 'scan', title: 'SCAN', line: 'Find a stud to screw into.' },
  { id: 'level', title: 'LEVEL', line: 'Check it’s level or plumb.' },
  { id: 'corner', title: 'CORNER', line: 'Measure a corner from a photo.' },
  { id: 'layout', title: 'LAYOUT', line: 'Space pictures or shelves evenly.' },
  { id: 'bevel', title: 'BEVEL', line: 'Copy an angle to your saw.' },
  { id: 'calibrate', title: 'CALIBRATE', line: 'Tune the sensors. Takes two minutes, tightens every reading.' },
  { id: 'log', title: 'LOG', line: 'Everything you’ve measured.' },
];

const loaders: Record<RouteId, () => Promise<ToolModule>> = {
  home: () => import('./home'),
  scan: () => import('../tools/scan/index'),
  level: () => import('../tools/level/index'),
  corner: () => import('../tools/corner/index'),
  layout: () => import('../tools/layout/index'),
  bevel: () => import('../tools/bevel/index'),
  calibrate: () => import('../tools/calibrate/index'),
  log: () => import('../tools/log/index'),
  manual: () => import('../guidance/manual'),
};

export function parseRoute(hash: string): RouteId {
  const clean = hash.replace(/^#\/?/, '').split('?')[0] ?? '';
  const known: RouteId[] = ['scan', 'level', 'corner', 'layout', 'bevel', 'calibrate', 'log', 'manual'];
  return (known as string[]).includes(clean) ? (clean as RouteId) : 'home';
}

export function startRouter(outlet: HTMLElement, ctx: AppContext, onRoute: (r: RouteId) => void): void {
  let unmount: Unmount | null = null;
  let generation = 0;

  const render = async () => {
    const route = parseRoute(location.hash);
    const gen = ++generation;
    onRoute(route);
    const mod = await loaders[route]();
    if (gen !== generation) return; // user navigated again while loading
    unmount?.();
    outlet.replaceChildren();
    unmount = mod.mount(outlet, ctx);
    outlet.focus({ preventScroll: true });
  };

  window.addEventListener('hashchange', () => void render());
  void render();
}
