/**
 * Live scan pipeline — the seam between the raw sample stream and the DSP
 * worker (SPEC §3.1, §4.1.2, §9).
 *
 * Samples accumulate in a growing window (trimmed to `maxWindowS`); every
 * ~250 ms of SAMPLE time the trailing window is packaged as a square.trace/1
 * and handed to an injected analyzer — the worker-backed one in the app
 * (workerClient.ts), a synchronous in-process one in tests and in browsers
 * without module workers. One analysis in flight at a time; the cadence is
 * sample-clocked so replay at any speed behaves identically to live.
 *
 * THE LATENCY SPLIT (SPEC §9): nothing here is on the audio path. Audio
 * pitch, haptics and the big state word run synchronously in the sample
 * callback via model.LiveFeedback; this pipeline's ~250 ms round trip only
 * refines events, positions, warnings and confidence. See model.ts.
 */
import type { MagSample, MagTier } from '../../sensors/types';
import type { SensorTrace, TraceAnchor } from '../../types';
import {
  analyzeMagTraceDetailed,
  type AnalyzeOptions,
  type DetailedTraceAnalysis,
} from '../../dsp/analyze';

export interface DetailedAnalyzer {
  analyze(trace: SensorTrace, opts: AnalyzeOptions): Promise<DetailedTraceAnalysis>;
  dispose(): void;
}

/** In-process analyzer — tests, and the fallback when Worker is unavailable. */
export function createSyncAnalyzer(): DetailedAnalyzer {
  return {
    analyze: (trace, opts) => Promise.resolve(analyzeMagTraceDetailed(trace, opts)),
    dispose: () => {},
  };
}

export interface AnalysisMeta {
  /** Absolute time of the window's first sample (the trace's t = 0). */
  t0: number;
  sampleCount: number;
}

export interface LivePipelineOpts {
  onAnalysis(a: DetailedTraceAnalysis, meta: AnalysisMeta): void;
  onError?(message: string): void;
  /** Seconds of sample time between analyses. Default 0.25 (SPEC §4.1). */
  cadenceS?: number;
  /** Trailing window kept for analysis. Default 45 s (≈ 11 ft at pace). */
  maxWindowS?: number;
}

const MIN_SAMPLES = 12;

export class LivePipeline {
  private ts: number[] = [];
  private xs: number[] = [];
  private ys: number[] = [];
  private zs: number[] = [];
  private anchorsAbs: TraceAnchor[] | null = null;
  private lastRunT = -Infinity;
  private inflight: Promise<void> | null = null;
  sensitivity = 3.5;

  private readonly cadenceS: number;
  private readonly maxWindowS: number;

  constructor(
    private readonly analyzer: DetailedAnalyzer,
    private tier: MagTier,
    private readonly opts: LivePipelineOpts,
  ) {
    this.cadenceS = opts.cadenceS ?? 0.25;
    this.maxWindowS = opts.maxWindowS ?? 45;
  }

  get sampleCount(): number {
    return this.ts.length;
  }

  /** Absolute time base of the current window (NaN when empty). */
  get t0(): number {
    return this.ts.length > 0 ? this.ts[0]! : NaN;
  }

  setTier(tier: MagTier): void {
    this.tier = tier;
  }

  /** Anchor mapping in the same absolute time base as pushed samples. */
  setAnchors(anchors: TraceAnchor[] | null): void {
    this.anchorsAbs = anchors && anchors.length > 0 ? [...anchors] : null;
  }

  push(s: MagSample): void {
    this.ts.push(s.t);
    this.xs.push(s.x);
    this.ys.push(s.y);
    this.zs.push(s.z);
    this.trim(s.t);
    if (s.t - this.lastRunT >= this.cadenceS) void this.runOnce();
  }

  /** Force a final full-window analysis (sweep stop, span declared). */
  async flush(): Promise<void> {
    while (this.inflight) await this.inflight;
    await this.runOnce(true);
    while (this.inflight) await this.inflight;
  }

  reset(): void {
    this.ts = [];
    this.xs = [];
    this.ys = [];
    this.zs = [];
    this.lastRunT = -Infinity;
    this.anchorsAbs = null;
  }

  private trim(tNow: number): void {
    const cutoff = tNow - this.maxWindowS;
    if (this.ts.length === 0 || this.ts[0]! >= cutoff) return;
    let cut = 0;
    while (cut < this.ts.length && this.ts[cut]! < cutoff) cut++;
    this.ts.splice(0, cut);
    this.xs.splice(0, cut);
    this.ys.splice(0, cut);
    this.zs.splice(0, cut);
  }

  private buildTrace(): SensorTrace | null {
    const n = this.ts.length;
    if (n < MIN_SAMPLES) return null;
    const t0 = this.ts[0]!;
    const tLast = this.ts[n - 1]!;
    const hz = tLast > t0 ? (n - 1) / (tLast - t0) : 40;
    const samples = new Array<{ t: number; x: number; y: number; z: number }>(n);
    for (let i = 0; i < n; i++) {
      samples[i] = { t: this.ts[i]! - t0, x: this.xs[i]!, y: this.ys[i]!, z: this.zs[i]! };
    }
    const anchors: TraceAnchor[] = [];
    if (this.anchorsAbs) {
      for (const a of this.anchorsAbs) {
        const rel = a.t - t0;
        if (rel >= 0 && rel <= tLast - t0 + 1) anchors.push({ t: rel, in: a.in });
      }
    }
    return {
      schema: 'square.trace/1',
      id: 'live',
      synthetic: false,
      note: 'live sweep window',
      device: { platform: 'live', magTier: this.tier },
      hz,
      units: { mag: this.tier === 'PROXY' ? 'deg' : 'uT', t: 's', distance: 'in' },
      anchors,
      samples,
      // Required by the trace schema; a live window asserts nothing.
      expected: { peaks_in: [], tolerance_in: 0.75, pitch_in: null, confidence: 'NOISE', warnings: [] },
    };
  }

  private runOnce(force = false): Promise<void> {
    if (this.inflight) return this.inflight;
    const trace = this.buildTrace();
    if (!trace) return Promise.resolve();
    const lastT = this.ts[this.ts.length - 1]!;
    if (!force && lastT - this.lastRunT < this.cadenceS) return Promise.resolve();
    this.lastRunT = lastT;
    const t0 = this.ts[0]!;
    const sampleCount = trace.samples.length;
    this.inflight = this.analyzer
      .analyze(trace, { sensitivity: this.sensitivity })
      .then((a) => this.opts.onAnalysis(a, { t0, sampleCount }))
      .catch((e: unknown) => this.opts.onError?.(e instanceof Error ? e.message : String(e)))
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }
}
