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

export const TOOL_ROUTES: ReadonlyArray<{ id: RouteId; title: string; line: string }> = [
  { id: 'scan', title: 'SCAN', line: 'Find the screw line. Infer the stud.' },
  { id: 'level', title: 'LEVEL', line: 'Level and plumb, on the actual object.' },
  { id: 'corner', title: 'CORNER', line: 'True corner angles from a photo.' },
  { id: 'layout', title: 'LAYOUT', line: 'N marks, exact equal spacing.' },
  { id: 'bevel', title: 'BEVEL', line: 'Capture a cut angle. Set the saw.' },
  { id: 'calibrate', title: 'CALIBRATE', line: 'Earn the accuracy claims.' },
  { id: 'log', title: 'LOG', line: 'Every reading, with its uncertainty.' },
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
