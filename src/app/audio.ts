/**
 * Audio engine — WebAudio, fully synthesized, zero audio asset files
 * (SPEC §4.2.4, §4.1.8). Audio is the primary non-visual channel: the
 * screen faces the wall during a scan, and iOS has no vibration API.
 *
 * Call ensureAudio() from a user gesture before anything else — browsers
 * refuse to start audio outside one. Everything degrades to silence,
 * never to a throw.
 *
 * API:
 *   ensureAudio()                create/resume the context (user gesture!)
 *   audioReady()                 context exists and is running
 *   tick(kind?)                  one click — 'metronome' (paced sweep) or
 *                                'soft' (level crossing, haptic fallback)
 *   setTone(freqHz) / stopTone() continuous tone, click-free ramps
 *   pitchForDeviation(deg)       pure: deviation → Hz; 0 inside the deadband
 *   levelTone(deg)               tone + silence at level + soft click on
 *                                crossing zero (§4.2.4); stateful
 *   shouldClick(prev, next)      pure: the click decision, unit-tested
 *   resetLevelTone()             clear state on tool unmount
 */

/** Silence inside this band — matches the LEVEL lock threshold (SPEC §4.2.3). */
export const LEVEL_DEADBAND_DEG = 0.2;
export const PITCH_MIN_HZ = 220;
export const PITCH_MAX_HZ = 880;
/** Deviations at or beyond this map to the top pitch. */
export const PITCH_SPAN_DEG = 10;

/**
 * Deviation → pitch, pure. Silent (0) inside the deadband; from the deadband
 * out, pitch rises exponentially from PITCH_MIN_HZ to PITCH_MAX_HZ over
 * PITCH_SPAN_DEG, clamped above. Exponential because ears judge intervals,
 * not hertz — equal error steps sound like equal pitch steps.
 */
export function pitchForDeviation(deg: number): number {
  const a = Math.abs(deg);
  if (!Number.isFinite(a) || a < LEVEL_DEADBAND_DEG) return 0;
  const x = Math.min(a, PITCH_SPAN_DEG) / PITCH_SPAN_DEG;
  return PITCH_MIN_HZ * Math.pow(PITCH_MAX_HZ / PITCH_MIN_HZ, x);
}

/**
 * Click when the reading enters the deadband from outside (arrived at
 * level), or when it crosses zero while outside the band (swung through
 * level). Pure; NaN never clicks.
 */
export function shouldClick(prev: number, next: number): boolean {
  if (!Number.isFinite(prev) || !Number.isFinite(next)) return false;
  const inBefore = Math.abs(prev) < LEVEL_DEADBAND_DEG;
  const inNow = Math.abs(next) < LEVEL_DEADBAND_DEG;
  if (inNow && !inBefore) return true;
  if (!inNow && !inBefore && Math.sign(prev) !== Math.sign(next)) return true;
  return false;
}

/* ---------- engine state (lazy — nothing constructed at import time) ---------- */

type ACCtor = typeof AudioContext;

let ctx: AudioContext | null = null;
let tone: { osc: OscillatorNode; gain: GainNode } | null = null;

const TONE_LEVEL = 0.08;

function ctor(): ACCtor | null {
  const g = globalThis as { AudioContext?: ACCtor; webkitAudioContext?: ACCtor };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

/** Create or resume the AudioContext. MUST be called from a user gesture. */
export function ensureAudio(): boolean {
  const AC = ctor();
  if (!AC) return false;
  if (!ctx) {
    try {
      ctx = new AC();
    } catch {
      return false;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return true;
}

export function audioReady(): boolean {
  return ctx !== null && ctx.state === 'running';
}

/** One click. 'metronome' paces a sweep; 'soft' marks a level crossing and
 *  backs up haptics on phones without a vibration API. */
export function tick(kind: 'metronome' | 'soft' = 'metronome'): void {
  if (!ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.value = kind === 'soft' ? 1200 : 1800;
  gain.gain.setValueAtTime(kind === 'soft' ? 0.05 : 0.12, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.035);
}

/** Continuous tone at freqHz. Ramped, so changing pitch never clicks.
 *  freqHz <= 0 stops the tone. */
export function setTone(freqHz: number): void {
  if (!ctx || ctx.state !== 'running') return;
  if (!Number.isFinite(freqHz) || freqHz <= 0) {
    stopTone();
    return;
  }
  const t = ctx.currentTime;
  if (!tone) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freqHz;
    gain.gain.setValueAtTime(0, t);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    tone = { osc, gain };
  }
  tone.osc.frequency.setTargetAtTime(freqHz, t, 0.02);
  tone.gain.gain.setTargetAtTime(TONE_LEVEL, t, 0.03);
}

export function stopTone(): void {
  if (!ctx || !tone) return;
  const { osc, gain } = tone;
  tone = null;
  const t = ctx.currentTime;
  gain.gain.setTargetAtTime(0, t, 0.02);
  osc.stop(t + 0.2);
}

/* ---------- the level voice (SPEC §4.2.4) ---------- */

let lastDeg: number | null = null;

/**
 * Feed the live deviation on every reading. Pitch tracks the deviation,
 * silence inside the deadband, one soft click on arriving at or swinging
 * through level. The user levels the shelf with their eyes on the bracket.
 */
export function levelTone(deg: number): void {
  if (lastDeg !== null && shouldClick(lastDeg, deg)) tick('soft');
  const f = pitchForDeviation(deg);
  if (f === 0) stopTone();
  else setTone(f);
  lastDeg = deg;
}

/** Call on tool unmount: silence and forget the previous reading. */
export function resetLevelTone(): void {
  lastDeg = null;
  stopTone();
}
