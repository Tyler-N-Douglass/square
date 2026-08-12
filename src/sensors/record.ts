/**
 * Capture live sensor streams to a square.trace/1 JSON for the fixture corpus —
 * SPEC §3.3, §10.4. Real recordings from field sessions land in tests/fixtures/real/
 * and make the suite stronger every time.
 */
import type { SensorTrace, TraceAnchor, TraceExpected } from '../types';
import type { MagSample, MagTier } from './types';

export class TraceRecorder {
  private samples: Array<{ t: number; x: number; y: number; z: number }> = [];
  private anchors: TraceAnchor[] = [];
  private t0: number | null = null;
  recording = false;

  constructor(
    private readonly tier: MagTier,
    private readonly platform: string,
    private readonly hz: number,
  ) {}

  startRecording(): void {
    this.samples = [];
    this.anchors = [];
    this.t0 = null;
    this.recording = true;
  }

  push(s: MagSample): void {
    if (!this.recording) return;
    if (this.t0 === null) this.t0 = s.t;
    this.samples.push({
      t: +(s.t - this.t0).toFixed(4),
      x: +s.x.toFixed(3),
      y: +s.y.toFixed(3),
      z: +s.z.toFixed(3),
    });
  }

  /** Anchor the current moment to a physical distance along the sweep (inches). */
  markAnchor(inches: number): void {
    if (!this.recording || this.samples.length === 0) return;
    const last = this.samples[this.samples.length - 1]!;
    this.anchors.push({ t: last.t, in: inches });
  }

  /**
   * Finish and produce the trace. The expected block starts as a stub the
   * human fills in after ground-truthing with a tape measure — an unverified
   * recording must not enter the corpus as if it were asserted.
   */
  finish(id: string, note: string, expected?: TraceExpected): SensorTrace {
    this.recording = false;
    return {
      schema: 'square.trace/1',
      id,
      synthetic: false,
      note,
      device: { platform: this.platform, magTier: this.tier },
      hz: this.hz,
      units: { mag: 'uT', t: 's', distance: 'in' },
      anchors: this.anchors,
      samples: this.samples,
      expected: expected ?? {
        peaks_in: [],
        tolerance_in: 0.75,
        pitch_in: null,
        confidence: 'UNRELIABLE',
        warnings: ['UNCALIBRATED'],
      },
    };
  }

  /** Serialize for download / clipboard from the SELF-TEST screen. */
  static toJson(trace: SensorTrace): string {
    return JSON.stringify(trace, null, 1);
  }
}
