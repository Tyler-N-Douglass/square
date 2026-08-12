/**
 * Solver access for the CORNER tool — SPEC §3.1/§9: the solve + Monte Carlo
 * run in solver.worker so the main thread stays free for the camera and the
 * canvas. Where Workers are unavailable (unit/DOM tests, odd embedders) the
 * SAME pure functions the worker dispatches to are called directly — the
 * pipeline is identical either way, only the thread differs.
 *
 * Deliberately does NOT import src/workers/solver.worker.ts on the main
 * thread: that module wires a message listener onto its global scope, which
 * in a window would shadow window 'message' traffic. The worker build gets
 * the module via `new Worker(new URL(...))`; the fallback imports the
 * geometry functions themselves.
 */
import {
  cornerAngleFromQuad,
  type Intrinsics,
  type Px,
  type QuadAngleResult,
} from '../../geometry/angleSolver';
import {
  monteCarloCornerAngle,
  type MonteCarloAngleResult,
  type MonteCarloOptions,
} from '../../geometry/montecarlo';

export interface SolverRunner {
  cornerAngle(quad: [Px, Px, Px, Px], k: Intrinsics): Promise<QuadAngleResult>;
  monteCarlo(
    quad: [Px, Px, Px, Px],
    k: Intrinsics,
    options?: MonteCarloOptions,
  ): Promise<MonteCarloAngleResult>;
  dispose(): void;
}

interface WireResponse {
  id: number;
  kind: 'cornerAngle' | 'monteCarlo';
  result: unknown;
}

/** Worker-backed runner, or the direct fallback when Worker is unavailable. */
export function createSolverRunner(): SolverRunner {
  let worker: Worker | null = null;
  try {
    if (typeof Worker === 'function') {
      worker = new Worker(new URL('../../workers/solver.worker.ts', import.meta.url), {
        type: 'module',
      });
    }
  } catch {
    worker = null;
  }

  if (!worker) {
    // Direct path — same functions the worker calls (src/workers/solver.worker.ts).
    return {
      cornerAngle: (quad, k) => Promise.resolve(cornerAngleFromQuad(quad, k)),
      monteCarlo: (quad, k, options) => Promise.resolve(monteCarloCornerAngle(quad, k, options)),
      dispose: () => undefined,
    };
  }

  const w = worker;
  let nextId = 1;
  const pending = new Map<number, (result: unknown) => void>();
  w.addEventListener('message', (ev: MessageEvent) => {
    const res = ev.data as WireResponse;
    const resolve = pending.get(res.id);
    if (resolve) {
      pending.delete(res.id);
      resolve(res.result);
    }
  });
  w.addEventListener('error', () => {
    // Worker died: resolve everything pending as a refusal rather than hanging.
    for (const [id, resolve] of pending) {
      pending.delete(id);
      resolve({
        ok: false,
        reason: 'POOR_GEOMETRY',
        message: 'solver worker failed — reload and retry',
      });
    }
  });

  const post = <T>(msg: Record<string, unknown>): Promise<T> =>
    new Promise<T>((resolve) => {
      const id = nextId++;
      pending.set(id, (r) => resolve(r as T));
      w.postMessage({ id, ...msg });
    });

  return {
    cornerAngle: (quad, k) => post<QuadAngleResult>({ kind: 'cornerAngle', quad, k }),
    monteCarlo: (quad, k, options) =>
      post<MonteCarloAngleResult>({ kind: 'monteCarlo', quad, k, options }),
    dispose: () => {
      w.terminate();
      pending.clear();
    },
  };
}
