/**
 * Calibration profile store — lead-owned seam (ADR-003 discipline).
 * CALIBRATE writes; SCAN / LEVEL / CORNER read and display staleness honestly.
 * localStorage-backed (a calibration profile is small and device-local);
 * exported signatures are stable — internals may move behind them.
 *
 * Staleness is a first-class output: every consumer shows the age and the
 * ok/failed state of the calibration it depends on (SPEC §4.6, §15.4).
 */
import type { CalibrationProfile } from '../types';

const KEY = 'square.calibration.v1';
type Listener = (p: CalibrationProfile) => void;
const listeners = new Set<Listener>();
let cached: CalibrationProfile | null = null;

function deviceKey(): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'node';
  return `${ua.slice(0, 64)}|${typeof screen !== 'undefined' ? `${screen.width}x${screen.height}` : ''}`;
}

export function getProfile(): CalibrationProfile {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) { cached = JSON.parse(raw) as CalibrationProfile; return cached; }
  } catch { /* private mode / corrupt */ }
  cached = { deviceKey: deviceKey(), updatedAt: 0 };
  return cached;
}

type CalPart = 'mag' | 'sensorOffset' | 'levelBias' | 'lens';
const PARTS: readonly CalPart[] = ['mag', 'sensorOffset', 'levelBias', 'lens'];

/** Per-part timestamps ride alongside the profile (H-05): a lens calibration
 * must not make a months-old mag calibration read fresh. Additive — stored in
 * the same JSON blob, absent on old profiles. */
interface StoredProfile extends CalibrationProfile {
  updatedAtByPart?: Partial<Record<CalPart, number>>;
}

let lastPersistOk = true;

/** False when the most recent updateProfile could not write durable storage
 * (private mode, quota). Consumers append the session-only notice (H-04). */
export function persistenceOk(): boolean {
  return lastPersistOk;
}

/** Merge-update the profile; stamps updatedAt globally and per touched part;
 * notifies subscribers. Check persistenceOk() before claiming "stored". */
export function updateProfile(patch: Partial<Omit<CalibrationProfile, 'deviceKey'>>): CalibrationProfile {
  const prev = getProfile() as StoredProfile;
  const now = Date.now();
  const byPart: Partial<Record<CalPart, number>> = { ...prev.updatedAtByPart };
  for (const part of PARTS) if (part in patch) byPart[part] = now;
  const next: StoredProfile = { ...prev, ...patch, deviceKey: deviceKey(), updatedAt: now, updatedAtByPart: byPart };
  cached = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
    lastPersistOk = true;
  } catch {
    lastPersistOk = false; // visible via persistenceOk(); never claim "stored"
  }
  for (const fn of listeners) fn(next);
  return next;
}

export function clearProfile(): void {
  cached = { deviceKey: deviceKey(), updatedAt: 0 };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  for (const fn of listeners) fn(cached);
}

export function subscribeProfile(fn: Listener): () => void {
  listeners.add(fn);
  fn(getProfile());
  return () => listeners.delete(fn);
}

/** Age of one calibration block in ms, or null when it has never been run.
 * Prefers the per-part stamp (H-05); falls back to the global one only for
 * profiles written before per-part stamps existed. */
export function calibrationAgeMs(profile: CalibrationProfile, part: 'mag' | 'sensorOffset' | 'levelBias' | 'lens'): number | null {
  if (!profile[part]) return null;
  const stamp = (profile as StoredProfile).updatedAtByPart?.[part] ?? profile.updatedAt;
  return Math.max(0, Date.now() - stamp);
}

/**
 * The provenance block every tool attaches to its Measurements (SPEC §8).
 * Missing calibrations are reported ok:false with age 0 — visible, never
 * silently absent.
 */
export function calibrationsForProvenance(profile: CalibrationProfile): Record<string, { ok: boolean; ageMs: number }> {
  const out: Record<string, { ok: boolean; ageMs: number }> = {};
  for (const part of ['mag', 'sensorOffset', 'levelBias', 'lens'] as const) {
    const age = calibrationAgeMs(profile, part);
    out[part] = age === null ? { ok: false, ageMs: 0 } : { ok: true, ageMs: age };
  }
  return out;
}
