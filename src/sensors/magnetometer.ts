/**
 * Tier A — TRUE FIELD. Generic Sensor API `Magnetometer`, Chromium/Android only,
 * historically flag-gated. Full 3-axis µT vector. Badge: FIELD · µT. SPEC §2.2.
 */
import type { MagSample, SensorSource, SourceHealth } from './types';

interface GenericSensor {
  start(): void;
  stop(): void;
  addEventListener(type: 'reading' | 'error', fn: (e: Event) => void): void;
  x?: number; y?: number; z?: number;
}
type MagnetometerCtor = new (opts: { frequency: number }) => GenericSensor;

export class FieldMagSource implements SensorSource<MagSample> {
  readonly nominalHz: number;
  private subs = new Set<(s: MagSample) => void>();
  private sensor: GenericSensor | null = null;
  private _health: SourceHealth = 'ok';
  private lastT = 0;
  private emaInterval: number;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  /** Populated when start() fails, with the honest reason. */
  lastError: string | null = null;

  constructor(frequency = 40) {
    this.nominalHz = frequency;
    this.emaInterval = 1 / frequency;
  }

  get health(): SourceHealth { return this._health; }
  get measuredHz(): number { return this.emaInterval > 0 ? 1 / this.emaInterval : 0; }

  subscribe(fn: (s: MagSample) => void): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  async start(): Promise<void> {
    const Ctor = (globalThis as Record<string, unknown>)['Magnetometer'] as MagnetometerCtor | undefined;
    if (typeof Ctor !== 'function') {
      this._health = 'dead';
      this.lastError = 'Magnetometer API not present';
      throw new Error('NO_RAW_MAG');
    }
    try {
      this.sensor = new Ctor({ frequency: this.nominalHz });
    } catch (e) {
      this._health = 'dead';
      this.lastError = e instanceof Error ? e.message : String(e);
      throw new Error('MAG_CONSTRUCT_FAILED');
    }
    this.sensor.addEventListener('error', (e) => {
      this._health = 'dead';
      const err = (e as { error?: { name?: string; message?: string } }).error;
      this.lastError = err?.name === 'NotAllowedError'
        ? 'Magnetometer permission denied'
        : err?.name === 'NotReadableError'
          ? 'Magnetometer exists but cannot be read (flag not enabled?)'
          : (err?.message ?? 'sensor error');
    });
    this.sensor.addEventListener('reading', () => {
      const s = this.sensor;
      if (!s || s.x == null || s.y == null || s.z == null) return;
      const t = performance.now() / 1000;
      if (this.lastT > 0) {
        const dt = t - this.lastT;
        if (dt > 0 && dt < 1) this.emaInterval = this.emaInterval * 0.95 + dt * 0.05;
      }
      this.lastT = t;
      const sample: MagSample = {
        t, x: s.x, y: s.y, z: s.z,
        mag: Math.hypot(s.x, s.y, s.z),
        tier: 'FIELD',
      };
      for (const fn of this.subs) fn(sample);
    });
    this.sensor.start();
    this.watchdog = setInterval(() => {
      const age = performance.now() / 1000 - this.lastT;
      if (this.lastT === 0 || age > 2) this._health = 'dead';
      else if (this.measuredHz < 12) this._health = 'degraded'; // SPEC §4.1.6 rate collapse
      else this._health = 'ok';
    }, 1000);
  }

  stop(): void {
    this.sensor?.stop();
    this.sensor = null;
    if (this.watchdog) { clearInterval(this.watchdog); this.watchdog = null; }
    this.lastT = 0;
  }
}
