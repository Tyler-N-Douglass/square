/**
 * Ellipsoid-fit access for CALIBRATE — the fit runs in dsp.worker (SPEC §3.1)
 * where Workers exist; environments without Workers (tests, odd embedders)
 * call the SAME fitEllipsoid the worker dispatches to. Never imports
 * src/workers/dsp.worker.ts on the main thread — that module wires a
 * message listener onto its global scope.
 */
import type { Vec3 } from '../../types';
import { fitEllipsoid, type EllipsoidFit } from '../../dsp/calibration';

export interface DspRunner {
  fitEllipsoid(points: Vec3[]): Promise<EllipsoidFit>;
  dispose(): void;
}

export function createDspRunner(): DspRunner {
  let worker: Worker | null = null;
  try {
    if (typeof Worker === 'function') {
      worker = new Worker(new URL('../../workers/dsp.worker.ts', import.meta.url), { type: 'module' });
    }
  } catch {
    worker = null;
  }

  if (!worker) {
    return {
      fitEllipsoid: (points) => Promise.resolve(fitEllipsoid(points)),
      dispose: () => undefined,
    };
  }

  const w = worker;
  let nextId = 1;
  const pending = new Map<number, (fit: EllipsoidFit) => void>();
  w.addEventListener('message', (ev: MessageEvent) => {
    const res = ev.data as { id: number; ok: boolean; result?: unknown; error?: string };
    const resolve = pending.get(res.id);
    if (!resolve) return;
    pending.delete(res.id);
    if (res.ok) {
      resolve(res.result as EllipsoidFit);
    } else {
      resolve({
        ok: false,
        reason: res.error ?? 'fit failed in the worker',
        hardIron: [0, 0, 0],
        softIron: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        residual: 1,
        coverage: 0,
        radius: 0,
      });
    }
  });

  return {
    fitEllipsoid: (points) =>
      new Promise((resolve) => {
        const id = nextId++;
        pending.set(id, resolve);
        w.postMessage({ id, kind: 'fitEllipsoid', points });
      }),
    dispose: () => {
      w.terminate();
      pending.clear();
    },
  };
}
