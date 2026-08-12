/**
 * Filtering primitives for the SCAN signal chain — SPEC §4.1.2 steps 3–5.
 * Pure functions, no allocation surprises, no Math.random, no Date.now.
 * Every routine here is unit-tested in tests/unit/dsp-filters.test.ts and
 * documented with formulas in docs/physics-dsp.md.
 */

/** Median of an array (average of the two middle values for even length). */
export function median(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Median absolute deviation about the median. */
export function mad(values: readonly number[]): number {
  const m = median(values);
  return median(values.map((v) => Math.abs(v - m)));
}

/**
 * Robust noise scale over a whole array: σ = 1.4826 × MAD.
 * 1.4826 = 1/Φ⁻¹(3/4) makes MAD consistent with the standard deviation of a
 * Gaussian. Floored at 1e-3 signal units so a noiseless synthetic trace
 * cannot divide by zero.
 */
export function robustSigma(values: readonly number[]): number {
  return Math.max(1.4826 * mad(values), 1e-3);
}

/**
 * Per-sample noise floor from a TRAILING window — SPEC §4.1.2 step 5:
 * σᵢ = 1.4826 × MAD(residual over the trailing `windowS` seconds).
 * This is the streaming form the live SCAN ribbon draws as the noise band.
 * Samples earlier than one full window use the FIRST full window, so the
 * value is defined (and deterministic) from sample zero.
 */
export function noiseSigmaTrailing(values: readonly number[], hz: number, windowS = 3.0): number[] {
  const n = values.length;
  const w = Math.min(n, Math.max(8, Math.round(windowS * hz)));
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const seg = i + 1 < w ? values.slice(0, w) : values.slice(i + 1 - w, i + 1);
    out[i] = Math.max(1.4826 * mad(seg), 1e-3);
  }
  return out;
}

/**
 * Centered moving median — SPEC §4.1.2 step 3 (detrend). Window in samples
 * must be odd; windows are truncated at the edges rather than padded, so the
 * ends track the local baseline instead of a reflected fiction.
 */
export function movingMedian(values: readonly number[], window: number): number[] {
  if (window % 2 === 0) throw new Error('movingMedian window must be odd');
  const half = window >> 1;
  const n = values.length;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(n, i + half + 1);
    out[i] = median(values.slice(lo, hi));
  }
  return out;
}

/**
 * Detrend: subtract a `windowS`-second moving median (window in samples =
 * round(windowS·hz), forced odd). Removes the Earth-field pedestal and slow
 * hand-rotation drift; passes the fastener's bipolar wiggle.
 */
export function detrend(values: readonly number[], hz: number, windowS = 2.0): number[] {
  let w = Math.max(3, Math.round(windowS * hz));
  if (w % 2 === 0) w += 1;
  const base = movingMedian(values, Math.min(w, values.length % 2 === 0 ? values.length - 1 : values.length));
  return values.map((v, i) => v - base[i]!);
}

/**
 * Savitzky-Golay smoothing coefficients for a quadratic (order-2) fit over a
 * centered window of 2m+1 samples — the standard closed form:
 *
 *   c_i = (3(3m² + 3m − 1) − 15 i²) / ((2m−1)(2m+1)(2m+3)),  i ∈ [−m, m]
 *
 * For m = 4 (window 9) this is [−21, 14, 39, 54, 59, 54, 39, 14, −21] / 231.
 * Coefficients sum to exactly 1 in exact arithmetic.
 */
export function savitzkyGolayCoeffs(m: number): number[] {
  const denom = (2 * m - 1) * (2 * m + 1) * (2 * m + 3);
  const out = new Array<number>(2 * m + 1);
  for (let i = -m; i <= m; i++) {
    out[i + m] = (3 * (3 * m * m + 3 * m - 1) - 15 * i * i) / denom;
  }
  return out;
}

/**
 * Savitzky-Golay smooth — SPEC §4.1.2 step 4 (band-limit). Window ~9
 * samples, order 2: kills per-sample sensor noise without smearing a lobe
 * that is ~13 samples wide at the paced sweep rate. Edges use reflection.
 */
export function savitzkyGolay(values: readonly number[], window = 9): number[] {
  if (window % 2 === 0) throw new Error('savitzkyGolay window must be odd');
  const n = values.length;
  if (n === 0) return [];
  const m = window >> 1;
  const c = savitzkyGolayCoeffs(m);
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let k = -m; k <= m; k++) {
      let j = i + k;
      if (j < 0) j = -j; // reflect
      if (j >= n) j = 2 * (n - 1) - j;
      if (j < 0) j = 0; // degenerate tiny-n guard
      acc += c[k + m]! * values[j]!;
    }
    out[i] = acc;
  }
  return out;
}

/** Root-mean-square of an array. */
export function rms(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let acc = 0;
  for (const v of values) acc += v * v;
  return Math.sqrt(acc / values.length);
}
