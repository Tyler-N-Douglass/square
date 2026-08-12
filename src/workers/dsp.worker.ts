/**
 * DSP worker — a thin postMessage shim over the headless pipeline
 * (SPEC §3.1: all DSP runs off the main thread; the main thread keeps the
 * camera and the overlay). No logic lives here: the worker parses a request,
 * calls the same pure functions the tests exercise, and posts the result or
 * the error. Deterministic — no Math.random, no Date.now.
 */
import type { SensorTrace, Vec3 } from '../types';
import { analyzeMagTrace, analyzeMagTraceDetailed, type AnalyzeOptions } from '../dsp/analyze';
import { fitEllipsoid } from '../dsp/calibration';

export type DspRequest =
  | { id: number; kind: 'analyze'; trace: SensorTrace; opts?: AnalyzeOptions }
  | { id: number; kind: 'analyzeDetailed'; trace: SensorTrace; opts?: AnalyzeOptions }
  | { id: number; kind: 'fitEllipsoid'; points: Vec3[] };

export type DspResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };

function handle(req: DspRequest): unknown {
  switch (req.kind) {
    case 'analyze':
      return analyzeMagTrace(req.trace, req.opts ?? {});
    case 'analyzeDetailed':
      return analyzeMagTraceDetailed(req.trace, req.opts ?? {});
    case 'fitEllipsoid':
      return fitEllipsoid(req.points);
  }
}

self.addEventListener('message', (e: MessageEvent<DspRequest>) => {
  const req = e.data;
  try {
    const result = handle(req);
    const res: DspResponse = { id: req.id, ok: true, result };
    (self as unknown as Worker).postMessage(res);
  } catch (err) {
    const res: DspResponse = {
      id: req.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    (self as unknown as Worker).postMessage(res);
  }
});
