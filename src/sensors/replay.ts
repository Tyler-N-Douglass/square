/**
 * Deterministic playback of recorded sensor traces — SPEC §3.3 ("Replay is mandatory").
 * Drives the app via ?replay=<fixture-id>, drives the regression suite headlessly,
 * and drives every DEMO walkthrough. One code path for all three.
 *
 * Two clocks:
 *  - 'sync'  — the whole trace is delivered synchronously on start(). Tests use this.
 *  - number  — real-time speed multiplier (1 = recorded speed). The app uses this.
 */
import type { SensorTrace, TraceAnchor } from '../types';
import type { MagSample, SensorSource, SourceHealth } from './types';

export interface ReplayOptions {
  speed?: number | 'sync';
  loop?: boolean;
}

export class ReplayMagSource implements SensorSource<MagSample> {
  readonly nominalHz: number;
  private subs = new Set<(s: MagSample) => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private idx = 0;
  private _health: SourceHealth = 'ok';
  private startedAt = 0;
  private readonly speed: number | 'sync';
  private readonly loop: boolean;
  private _done = false;
  onEnd: (() => void) | null = null;

  constructor(readonly trace: SensorTrace, opts: ReplayOptions = {}) {
    this.nominalHz = trace.hz;
    this.speed = opts.speed ?? 1;
    this.loop = opts.loop ?? false;
  }

  get health(): SourceHealth { return this._health; }
  get done(): boolean { return this._done; }

  subscribe(fn: (s: MagSample) => void): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  private emit(i: number): void {
    const s = this.trace.samples[i];
    if (!s) return;
    // FIELD: working signal is |B|. PROXY: samples carry the signed heading
    // residual in x (sign is load-bearing — the fastener is at the zero
    // crossing), so mag passes it through signed. Matches HeadingProxySource.
    const tier = this.trace.device.magTier;
    const mag = tier === 'PROXY' ? s.x : Math.hypot(s.x, s.y, s.z);
    const sample: MagSample = { t: s.t, x: s.x, y: s.y, z: s.z, mag, tier };
    for (const fn of this.subs) fn(sample);
  }

  async start(): Promise<void> {
    this._done = false;
    this.idx = 0;
    if (this.speed === 'sync') {
      for (let i = 0; i < this.trace.samples.length; i++) this.emit(i);
      this._done = true;
      this.onEnd?.();
      return;
    }
    this.startedAt = performance.now();
    const speed = this.speed;
    const tick = () => {
      const elapsed = ((performance.now() - this.startedAt) / 1000) * speed;
      while (this.idx < this.trace.samples.length && (this.trace.samples[this.idx]?.t ?? Infinity) <= elapsed) {
        this.emit(this.idx++);
      }
      if (this.idx >= this.trace.samples.length) {
        if (this.loop) {
          this.idx = 0;
          this.startedAt = performance.now();
        } else {
          this.stop();
          this._done = true;
          this.onEnd?.();
          return;
        }
      }
      this.timer = setTimeout(tick, 1000 / this.nominalHz / 2);
    };
    tick();
  }

  stop(): void {
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
  }
}

/**
 * Map a sample time to physical distance along the sweep using the trace's
 * anchors (piecewise-linear, clamped extrapolation at the ends). This is the
 * same two-point-anchor model live sweeps use (ADR-006).
 */
export function timeToDistanceIn(anchors: TraceAnchor[], t: number): number {
  if (anchors.length === 0) return NaN;
  if (anchors.length === 1) return anchors[0]!.in;
  let a = anchors[0]!;
  let b = anchors[anchors.length - 1]!;
  for (let i = 0; i < anchors.length - 1; i++) {
    const lo = anchors[i]!;
    const hi = anchors[i + 1]!;
    if (t >= lo.t && t <= hi.t) { a = lo; b = hi; break; }
    if (t < anchors[0]!.t) { a = anchors[0]!; b = anchors[1]!; break; }
    if (t > hi.t) { a = lo; b = hi; }
  }
  const dt = b.t - a.t;
  if (dt === 0) return a.in;
  return a.in + ((t - a.t) / dt) * (b.in - a.in);
}

/** Runtime validation of a trace file — used by the loader and the fixture suite. */
export function validateTrace(x: unknown): asserts x is SensorTrace {
  const fail = (msg: string): never => { throw new Error(`invalid trace: ${msg}`); };
  if (typeof x !== 'object' || x === null) fail('not an object');
  const t = x as Record<string, unknown>;
  if (t['schema'] !== 'square.trace/1') fail(`schema must be "square.trace/1", got ${String(t['schema'])}`);
  if (typeof t['id'] !== 'string' || !t['id']) fail('missing id');
  if (typeof t['synthetic'] !== 'boolean') fail('missing synthetic flag');
  if (typeof t['hz'] !== 'number' || !((t['hz'] as number) > 0)) fail('hz must be > 0');
  const device = t['device'] as Record<string, unknown> | undefined;
  if (!device || !['FIELD', 'PROXY', 'NONE'].includes(String(device['magTier']))) fail('device.magTier invalid');
  const samples = t['samples'];
  if (!Array.isArray(samples) || samples.length === 0) fail('samples empty');
  let prev = -Infinity;
  for (const s of samples as Array<Record<string, unknown>>) {
    if (typeof s['t'] !== 'number' || typeof s['x'] !== 'number' || typeof s['y'] !== 'number' || typeof s['z'] !== 'number') {
      fail('sample fields must be numbers');
    }
    if ((s['t'] as number) < prev) fail('sample times must be non-decreasing');
    prev = s['t'] as number;
  }
  const anchors = t['anchors'];
  if (!Array.isArray(anchors)) fail('anchors missing');
  for (const a of anchors as Array<Record<string, unknown>>) {
    if (typeof a['t'] !== 'number' || typeof a['in'] !== 'number') fail('anchor fields must be numbers');
  }
  const expected = t['expected'] as Record<string, unknown> | undefined;
  if (!expected) return fail('expected block is required — a fixture with no assertion is not a fixture');
  if (!Array.isArray(expected['peaks_in'])) fail('expected.peaks_in missing');
  if (!Array.isArray(expected['warnings'])) fail('expected.warnings missing');
}
