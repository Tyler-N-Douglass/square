/**
 * Stud lattice inference from fastener positions — SPEC §4.1.5.
 *
 * Candidate on-center pitches cover US framing (16″, 24″), engineered/TJI
 * layouts (12″, 19.2″) and metric framing (400 mm = 15.748″, 600 mm =
 * 23.622″). For each pitch the phase is fit in closed form by circular mean,
 * the squared residual is minimized, and the best pitch is the one that
 * explains the most peaks within ±0.75″ (ties: smaller RMS; near-ties:
 * larger pitch, because 24″ evidence is always also 12″ evidence and the
 * conservative claim wins).
 *
 * Dense irregular patterns (plaster over lath, metal-stud walls) are a
 * refusal signature, not a lattice: ≥4 peaks with a median nearest-neighbor
 * spacing under 6″ report no pitch and cap confidence at POSSIBLE.
 */

export const CANDIDATE_PITCHES_IN: readonly number[] = [16.0, 24.0, 12.0, 19.2, 15.748, 23.622];

/** Peaks must land within this of the lattice to count as explained. */
export const LATTICE_TOLERANCE_IN = 0.75;

/**
 * Median nearest-neighbor spacing below this (with ≥4 peaks) reads as
 * dense/irregular. The tightest real stud pitch is 12″ OC, so a horizontal
 * sweep never meets stud fasteners closer than 12″ apart on median — a
 * median under 8″ is plaster nails or metal-stud clutter, not a lattice.
 */
export const DENSE_SPACING_IN = 8.0;

export interface LatticeFit {
  pitchIn: number;
  /** Phase offset in [0, pitch): lattice lines at phase + k·pitch. */
  phaseIn: number;
  /** RMS residual of the explained peaks, inches. */
  rmsIn: number;
  /** How many observed peaks land within ±LATTICE_TOLERANCE_IN. */
  explained: number;
  total: number;
}

export interface LatticeAnalysis {
  fit: LatticeFit | null;
  /** True for the plaster/metal signature: dense AND irregular. */
  denseIrregular: boolean;
  /** Median nearest-neighbor spacing, inches (NaN below 2 peaks). */
  medianSpacingIn: number;
}

/** Fold a residual into [−p/2, p/2). */
function fold(x: number, p: number): number {
  let r = x % p;
  if (r < -p / 2) r += p;
  if (r >= p / 2) r -= p;
  return r;
}

/**
 * Best phase for one pitch by circular mean:
 * φ = (p/2π)·atan2(Σ sin(2πxᵢ/p), Σ cos(2πxᵢ/p)), normalized into [0, p).
 */
export function fitPhase(positionsIn: readonly number[], pitchIn: number): number {
  let s = 0;
  let c = 0;
  for (const x of positionsIn) {
    const th = (2 * Math.PI * x) / pitchIn;
    s += Math.sin(th);
    c += Math.cos(th);
  }
  let phase = (pitchIn * Math.atan2(s, c)) / (2 * Math.PI);
  phase %= pitchIn;
  if (phase < 0) phase += pitchIn;
  return phase;
}

function scorePhase(positionsIn: readonly number[], pitchIn: number, phase: number): LatticeFit {
  let explained = 0;
  let sq = 0;
  for (const x of positionsIn) {
    const r = fold(x - phase, pitchIn);
    if (Math.abs(r) <= LATTICE_TOLERANCE_IN) {
      explained++;
      sq += r * r;
    }
  }
  let p = phase % pitchIn;
  if (p < 0) p += pitchIn;
  return {
    pitchIn,
    phaseIn: p,
    rmsIn: explained > 0 ? Math.sqrt(sq / explained) : NaN,
    explained,
    total: positionsIn.length,
  };
}

function betterFit(a: LatticeFit, b: LatticeFit): LatticeFit {
  if (b.explained > a.explained) return b;
  if (b.explained === a.explained && b.explained > 0 && b.rmsIn < a.rmsIn) return b;
  return a;
}

/**
 * Evaluate one candidate pitch against the peaks. The circular-mean phase is
 * optimal on clean lattices but one off-lattice outlier drags it, so every
 * peak's own phase is also tried (deterministic RANSAC over ≤ a dozen
 * candidates), then the winner is refined by a circular mean over only the
 * peaks it explains.
 */
export function evaluatePitch(positionsIn: readonly number[], pitchIn: number): LatticeFit {
  let best = scorePhase(positionsIn, pitchIn, fitPhase(positionsIn, pitchIn));
  for (const x of positionsIn) {
    best = betterFit(best, scorePhase(positionsIn, pitchIn, x));
  }
  if (best.explained > 0) {
    const inliers = positionsIn.filter(
      (x) => Math.abs(fold(x - best.phaseIn, pitchIn)) <= LATTICE_TOLERANCE_IN,
    );
    best = betterFit(best, scorePhase(positionsIn, pitchIn, fitPhase(inliers, pitchIn)));
  }
  return best;
}

function medianOf(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * Full lattice analysis. Requires ≥2 explained peaks for any claim
 * (SPEC §4.1.5); a dense irregular pattern reports no pitch at all —
 * prefer refusing to guessing (§15.3).
 */
export function analyzeLattice(positionsIn: readonly number[]): LatticeAnalysis {
  const sorted = [...positionsIn].sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) gaps.push(sorted[i]! - sorted[i - 1]!);
  const medianSpacingIn = medianOf(gaps);

  const denseIrregular = sorted.length >= 4 && medianSpacingIn < DENSE_SPACING_IN;
  if (denseIrregular || sorted.length < 2) {
    return { fit: null, denseIrregular, medianSpacingIn };
  }

  let best: LatticeFit | null = null;
  for (const p of CANDIDATE_PITCHES_IN) {
    const fit = evaluatePitch(sorted, p);
    if (fit.explained < 2) continue;
    if (best === null) {
      best = fit;
      continue;
    }
    if (fit.explained > best.explained) {
      best = fit;
    } else if (fit.explained === best.explained) {
      const d = fit.rmsIn - best.rmsIn;
      if (d < -0.05) best = fit; // clearly tighter
      else if (Math.abs(d) <= 0.05 && fit.pitchIn > best.pitchIn) best = fit; // near-tie: conservative (larger) pitch
    }
  }
  return { fit: best, denseIrregular, medianSpacingIn };
}
