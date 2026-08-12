/**
 * Solver worker — thin postMessage shim over the geometry solvers, so the
 * Monte Carlo loop never touches the main thread (SPEC §3.1: Web Workers for
 * all solvers; §9: main-thread long tasks < 50 ms). Owned by A3.
 *
 * Protocol: post a SolverRequest, receive exactly one SolverResponse with the
 * same id. All payloads are plain JSON-structured data — no transferables
 * needed at these sizes.
 */
import { cornerAngleFromQuad, type Intrinsics, type Px, type QuadAngleResult } from '../geometry/angleSolver';
import {
  monteCarloCornerAngle,
  type MonteCarloAngleResult,
  type MonteCarloOptions,
} from '../geometry/montecarlo';

export type SolverRequest =
  | { id: number; kind: 'cornerAngle'; quad: [Px, Px, Px, Px]; k: Intrinsics }
  | {
      id: number;
      kind: 'monteCarlo';
      quad: [Px, Px, Px, Px];
      k: Intrinsics;
      options?: MonteCarloOptions;
    };

export type SolverResponse =
  | { id: number; kind: 'cornerAngle'; result: QuadAngleResult }
  | { id: number; kind: 'monteCarlo'; result: MonteCarloAngleResult };

/** Pure dispatch — exported so unit tests can drive the worker logic directly. */
export function handleSolverRequest(req: SolverRequest): SolverResponse {
  switch (req.kind) {
    case 'cornerAngle':
      return { id: req.id, kind: 'cornerAngle', result: cornerAngleFromQuad(req.quad, req.k) };
    case 'monteCarlo':
      return {
        id: req.id,
        kind: 'monteCarlo',
        result: monteCarloCornerAngle(req.quad, req.k, req.options),
      };
  }
}

// Worker wiring. Typed structurally so the file compiles under the repo's
// combined DOM+WebWorker lib without depending on which global wins, and
// guarded so importing the module outside a worker (unit tests) is a no-op.
interface WorkerScope {
  addEventListener(type: 'message', listener: (ev: MessageEvent) => void): void;
  postMessage(message: unknown): void;
}

const scope = globalThis as Partial<WorkerScope>;
const addListener = scope.addEventListener;
const post = scope.postMessage;
if (typeof addListener === 'function' && typeof post === 'function') {
  addListener.call(scope, 'message', (ev: MessageEvent) => {
    const req = ev.data as SolverRequest;
    post.call(scope, handleSolverRequest(req));
  });
}
