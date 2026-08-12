/**
 * Tier B — HEADING PROXY. No raw field; a ferrous fastener deflects the
 * magnetically-referenced heading as the phone passes over it. SPEC §2.2:
 * emit the residual Δψ = ψ_magnetic − ψ_gyro_predicted, which shows the same
 * bipolar S-curve as the true field, so the downstream DSP is shared.
 *
 * Emitted as MagSample with the residual (degrees) in `x` and `mag`, y=z=0,
 * tier='PROXY'. Confidence is capped at LIKELY downstream (ADR-005) and the
 * badge reads PROXY · deflection — noticeably worse, and says so.
 */
import type { ImuSample, MagSample, SensorSource, SourceHealth } from './types';

interface HeadingEvent {
  webkitCompassHeading?: number;
  webkitCompassAccuracy?: number;
  alpha: number | null;
  absolute?: boolean;
}

export class HeadingProxySource implements SensorSource<MagSample> {
  readonly nominalHz = 50;
  private subs = new Set<(s: MagSample) => void>();
  private oriHandler: ((e: Event) => void) | null = null;
  private imuUnsub: (() => void) | null = null;
  private _health: SourceHealth = 'ok';
  private lastT = 0;
  private watchdog: ReturnType<typeof setInterval> | null = null;

  // Short-horizon gyro prediction of heading, reset on every magnetic fix.
  private gyroYaw = 0;           // integrated since last magnetic heading, deg
  private lastMagHeading: number | null = null;
  private lastGyroT: number | null = null;
  /** iOS reports compass accuracy in degrees; a sudden degradation is itself an anomaly signal. */
  compassAccuracy: number | null = null;
  /** True once at least one event carried a usable magnetic heading. */
  verified = false;

  constructor(private readonly imu: SensorSource<ImuSample>) {}

  get health(): SourceHealth { return this._health; }

  subscribe(fn: (s: MagSample) => void): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  /** Feed one orientation event; exposed for tests and for replay adapters. */
  ingestHeading(headingDeg: number, t: number, accuracy: number | null): void {
    this.verified = true;
    this.compassAccuracy = accuracy;
    if (this.lastMagHeading !== null) {
      // Predicted heading = last magnetic fix + gyro integration since.
      const predicted = this.lastMagHeading + this.gyroYaw;
      let residual = headingDeg - predicted;
      while (residual > 180) residual -= 360;
      while (residual < -180) residual += 360;
      const sample: MagSample = { t, x: residual, y: 0, z: 0, mag: residual, tier: 'PROXY' };
      for (const fn of this.subs) fn(sample);
    }
    this.lastMagHeading = headingDeg;
    this.gyroYaw = 0;
    this.lastT = t;
  }

  private ingestImu(s: ImuSample): void {
    if (this.lastGyroT !== null) {
      const dt = s.t - this.lastGyroT;
      // Yaw rate about the screen normal; deg. Sign matches compass convention (cw positive).
      if (dt > 0 && dt < 0.5) this.gyroYaw += (-s.gz * 180 / Math.PI) * dt;
    }
    this.lastGyroT = s.t;
  }

  async start(): Promise<void> {
    this.imuUnsub = this.imu.subscribe((s) => this.ingestImu(s));
    this.oriHandler = (e: Event) => {
      const ev = e as unknown as HeadingEvent;
      const t = performance.now() / 1000;
      if (typeof ev.webkitCompassHeading === 'number' && !Number.isNaN(ev.webkitCompassHeading)) {
        this.ingestHeading(ev.webkitCompassHeading, t, ev.webkitCompassAccuracy ?? null);
      } else if (ev.absolute === true && ev.alpha != null) {
        // deviceorientationabsolute: alpha is ccw from north; compass heading is 360 − alpha.
        this.ingestHeading((360 - ev.alpha) % 360, t, null);
      }
    };
    const hasAbsolute = 'ondeviceorientationabsolute' in window;
    window.addEventListener(
      (hasAbsolute ? 'deviceorientationabsolute' : 'deviceorientation') as 'deviceorientation',
      this.oriHandler,
    );
    this.watchdog = setInterval(() => {
      const age = performance.now() / 1000 - this.lastT;
      if (!this.verified || age > 2) this._health = 'dead';
      else this._health = 'ok';
    }, 1500);
  }

  stop(): void {
    if (this.oriHandler) {
      window.removeEventListener('deviceorientationabsolute' as 'deviceorientation', this.oriHandler);
      window.removeEventListener('deviceorientation', this.oriHandler);
      this.oriHandler = null;
    }
    this.imuUnsub?.();
    this.imuUnsub = null;
    if (this.watchdog) { clearInterval(this.watchdog); this.watchdog = null; }
  }
}
