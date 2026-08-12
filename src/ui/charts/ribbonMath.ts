/**
 * Field-ribbon math — the pure half of src/ui/charts/ribbon.ts, kept free of
 * DOM and canvas so the ring buffer and every scaling decision unit-test
 * headlessly (tests/unit/scan-ribbon-math.test.ts).
 *
 * Coordinate model (SPEC §4.1.8, ADR-006):
 *  - TIME mode: x is seconds, right edge = the newest sample, scrolling
 *    right-to-left. This is the honest axis until a span is declared.
 *  - DISTANCE mode: x is inches along the sweep via the anchor mapping
 *    (the same `timeToDistanceIn` model replay and live sweeps share).
 *  - y is symmetric about zero (the detrended signal is an AC anomaly on a
 *    removed pedestal); the half-range never drops below a physical floor so
 *    a quiet wall does not zoom sensor noise into fake drama.
 */

/**
 * Fixed-capacity ring of (t, value, sigma) samples in typed arrays.
 * push() never allocates; readers address samples by logical index
 * (0 = oldest) so the draw loop can iterate without building arrays.
 */
export class RingBuffer {
  private readonly t: Float64Array;
  private readonly v: Float64Array;
  private readonly s: Float64Array;
  private head = 0; // next write slot
  private count = 0;

  constructor(readonly capacity: number) {
    if (!(capacity > 0)) throw new RangeError('RingBuffer capacity must be > 0');
    this.t = new Float64Array(capacity);
    this.v = new Float64Array(capacity);
    this.s = new Float64Array(capacity);
  }

  get size(): number {
    return this.count;
  }

  push(t: number, value: number, sigma: number): void {
    this.t[this.head] = t;
    this.v[this.head] = value;
    this.s[this.head] = sigma;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
  }

  private phys(i: number): number {
    // logical i (0 = oldest) → physical slot
    return (this.head - this.count + i + this.capacity * 2) % this.capacity;
  }

  tAt(i: number): number {
    return this.t[this.phys(i)] ?? NaN;
  }
  vAt(i: number): number {
    return this.v[this.phys(i)] ?? NaN;
  }
  sAt(i: number): number {
    return this.s[this.phys(i)] ?? NaN;
  }

  /** Newest sample time, or null when empty. */
  latestT(): number | null {
    return this.count === 0 ? null : this.tAt(this.count - 1);
  }

  /**
   * Logical index of the first sample with t >= tMin (binary search — sample
   * times are non-decreasing). Returns size when every sample is older.
   */
  firstIndexAtOrAfter(tMin: number): number {
    let lo = 0;
    let hi = this.count;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.tAt(mid) < tMin) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
}

/**
 * Vertical half-range for the ribbon: at least the physical floor (a quiet
 * wall stays visually quiet), at least 1.15× the largest excursion in the
 * window (peaks never clip), and at least 4× the noise band (the band reads
 * as a band, not the whole chart).
 */
export function computeHalfRange(maxAbs: number, sigmaMax: number, floor: number): number {
  return Math.max(floor, maxAbs * 1.15, sigmaMax * 4);
}

/** Ease the displayed scale toward its target so rescales don't jump cut. */
export function easeScale(current: number, target: number): number {
  if (!Number.isFinite(current) || current <= 0) return target;
  const next = current + (target - current) * 0.2;
  return Math.abs(next - target) < target * 1e-3 ? target : next;
}

/** value → y pixel; zero maps to the vertical center, +v up. */
export function yForValue(v: number, halfRange: number, heightPx: number): number {
  const c = heightPx / 2;
  const y = c - (v / halfRange) * (c - 2);
  return Math.max(0, Math.min(heightPx, y));
}

/** TIME mode: t → x with the right edge pinned to tRight. */
export function xForTime(t: number, tRight: number, windowS: number, widthPx: number): number {
  return widthPx - ((tRight - t) / windowS) * widthPx;
}

/** DISTANCE mode: inches → x across the declared span. */
export function xForDistance(d: number, dMin: number, dMax: number, widthPx: number): number {
  const span = dMax - dMin;
  if (span <= 0) return 0;
  return ((d - dMin) / span) * widthPx;
}

/** First tick at or above `min` on a `step` grid (for axis tick loops). */
export function firstTickAtOrAbove(min: number, step: number): number {
  return Math.ceil(min / step - 1e-9) * step + 0; // + 0 normalizes -0
}
