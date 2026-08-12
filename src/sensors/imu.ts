/**
 * devicemotion normalization — SPEC §3.2. Units and sign conventions:
 *  - Acceleration: m/s², `accelerationIncludingGravity`, device frame
 *    (x right, y toward top of screen, z out of the screen — W3C convention).
 *  - Rotation rate: rad/s (the event reports deg/s; we convert here, once,
 *    so nothing downstream ever sees degrees). Axis order gx=alpha? No:
 *    devicemotion rotationRate alpha/beta/gamma are about z/x/y respectively;
 *    we emit gx (about x), gy (about y), gz (about z).
 * Documented with derivations in docs/PHYSICS.md.
 */
import type { ImuSample, SensorSource, SourceHealth } from './types';

const DEG2RAD = Math.PI / 180;

export class DeviceMotionSource implements SensorSource<ImuSample> {
  readonly nominalHz = 60;
  private subs = new Set<(s: ImuSample) => void>();
  private handler: ((e: DeviceMotionEvent) => void) | null = null;
  private _health: SourceHealth = 'ok';
  private lastT = 0;
  private emaInterval = 1 / 60;
  private watchdog: ReturnType<typeof setInterval> | null = null;

  get health(): SourceHealth { return this._health; }
  /** Realized sample rate, Hz — measured, not assumed. */
  get measuredHz(): number { return this.emaInterval > 0 ? 1 / this.emaInterval : 0; }

  subscribe(fn: (s: ImuSample) => void): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  async start(): Promise<void> {
    if (this.handler) return;
    this.handler = (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity;
      const r = e.rotationRate;
      if (!a || a.x == null || a.y == null || a.z == null) return;
      const t = performance.now() / 1000;
      if (this.lastT > 0) {
        const dt = t - this.lastT;
        if (dt > 0 && dt < 1) this.emaInterval = this.emaInterval * 0.95 + dt * 0.05;
      }
      this.lastT = t;
      const s: ImuSample = {
        t,
        ax: a.x, ay: a.y, az: a.z,
        // rotationRate: alpha about z, beta about x, gamma about y (W3C) — reorder to x,y,z.
        gx: (r?.beta ?? 0) * DEG2RAD,
        gy: (r?.gamma ?? 0) * DEG2RAD,
        gz: (r?.alpha ?? 0) * DEG2RAD,
      };
      for (const fn of this.subs) fn(s);
    };
    window.addEventListener('devicemotion', this.handler);
    // Health watchdog: rate collapse must surface, never pass silently (SPEC §4.1.6).
    this.watchdog = setInterval(() => {
      const age = performance.now() / 1000 - this.lastT;
      if (this.lastT === 0 || age > 2) this._health = 'dead';
      else if (this.measuredHz < 12) this._health = 'degraded';
      else this._health = 'ok';
    }, 1000);
  }

  stop(): void {
    if (this.handler) { window.removeEventListener('devicemotion', this.handler); this.handler = null; }
    if (this.watchdog) { clearInterval(this.watchdog); this.watchdog = null; }
    this.lastT = 0;
  }
}
