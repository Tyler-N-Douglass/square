/**
 * Worker-backed analyzer — keeps the DSP off the main thread (SPEC §3.1,
 * §9: main-thread long tasks < 50 ms). A thin promise wrapper over the
 * postMessage protocol of src/workers/dsp.worker.ts; one pending request
 * per id, errors surfaced, terminate on dispose.
 *
 * Returns null where module workers are unavailable (tests, ancient
 * browsers) — the caller falls back to pipeline.createSyncAnalyzer().
 */
import type { SensorTrace } from '../../types';
import type { AnalyzeOptions, DetailedTraceAnalysis } from '../../dsp/analyze';
import type { DspRequest, DspResponse } from '../../workers/dsp.worker';
import type { DetailedAnalyzer } from './pipeline';

export function createWorkerAnalyzer(): DetailedAnalyzer | null {
  if (typeof Worker !== 'function') return null;
  let worker: Worker;
  try {
    worker = new Worker(new URL('../../workers/dsp.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }

  interface Pending {
    resolve(value: DetailedTraceAnalysis): void;
    reject(reason: Error): void;
  }
  const pending = new Map<number, Pending>();
  let nextId = 1;

  worker.addEventListener('message', (e: MessageEvent<DspResponse>) => {
    const res = e.data;
    const p = pending.get(res.id);
    if (!p) return;
    pending.delete(res.id);
    if (res.ok) p.resolve(res.result as DetailedTraceAnalysis);
    else p.reject(new Error(res.error));
  });
  worker.addEventListener('error', (e) => {
    const err = new Error(e.message || 'DSP worker failed');
    for (const p of pending.values()) p.reject(err);
    pending.clear();
  });

  return {
    analyze(trace: SensorTrace, opts: AnalyzeOptions): Promise<DetailedTraceAnalysis> {
      const id = nextId++;
      return new Promise<DetailedTraceAnalysis>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        const req: DspRequest = { id, kind: 'analyzeDetailed', trace, opts };
        worker.postMessage(req);
      });
    },
    dispose(): void {
      const err = new Error('analyzer disposed');
      for (const p of pending.values()) p.reject(err);
      pending.clear();
      worker.terminate();
    },
  };
}
