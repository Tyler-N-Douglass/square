/**
 * Pure logic of the audio engine (SPEC §4.2.4): the deviation→pitch map and
 * the zero-crossing click decision. Runs in node — no AudioContext exists
 * here, which also proves the engine degrades to silence, never to a throw.
 */
import { describe, expect, it } from 'vitest';
import {
  LEVEL_DEADBAND_DEG,
  PITCH_MAX_HZ,
  PITCH_MIN_HZ,
  PITCH_SPAN_DEG,
  audioReady,
  ensureAudio,
  levelTone,
  pitchForDeviation,
  resetLevelTone,
  setTone,
  shouldClick,
  stopTone,
  tick,
} from '../../src/app/audio';

describe('pitchForDeviation', () => {
  it('is silent at level: 0 inside the deadband', () => {
    expect(pitchForDeviation(0)).toBe(0);
    expect(pitchForDeviation(LEVEL_DEADBAND_DEG - 0.01)).toBe(0);
    expect(pitchForDeviation(-(LEVEL_DEADBAND_DEG - 0.01))).toBe(0);
  });

  it('speaks from the deadband out, starting at the low pitch', () => {
    const f = pitchForDeviation(LEVEL_DEADBAND_DEG);
    expect(f).toBeGreaterThanOrEqual(PITCH_MIN_HZ);
    expect(f).toBeLessThan(PITCH_MIN_HZ * 1.1);
  });

  it('is symmetric — tilt left sounds like tilt right', () => {
    for (const d of [0.3, 1, 2.5, 7, 12]) {
      expect(pitchForDeviation(-d)).toBeCloseTo(pitchForDeviation(d), 10);
    }
  });

  it('rises monotonically with deviation', () => {
    let prev = 0;
    for (let d = LEVEL_DEADBAND_DEG; d <= PITCH_SPAN_DEG; d += 0.1) {
      const f = pitchForDeviation(d);
      expect(f).toBeGreaterThan(prev);
      prev = f;
    }
  });

  it('clamps at the top pitch beyond the span', () => {
    expect(pitchForDeviation(PITCH_SPAN_DEG)).toBeCloseTo(PITCH_MAX_HZ, 6);
    expect(pitchForDeviation(45)).toBeCloseTo(PITCH_MAX_HZ, 6);
    expect(pitchForDeviation(-90)).toBeCloseTo(PITCH_MAX_HZ, 6);
  });

  it('stays inside [min, max] everywhere it speaks', () => {
    for (let d = 0; d <= 90; d += 0.25) {
      const f = pitchForDeviation(d);
      if (f !== 0) {
        expect(f).toBeGreaterThanOrEqual(PITCH_MIN_HZ);
        expect(f).toBeLessThanOrEqual(PITCH_MAX_HZ);
      }
    }
  });

  it('never sings on garbage', () => {
    expect(pitchForDeviation(NaN)).toBe(0);
  });
});

describe('shouldClick', () => {
  it('clicks on arriving at level from outside', () => {
    expect(shouldClick(1.5, 0.1)).toBe(true);
    expect(shouldClick(-0.8, 0.0)).toBe(true);
  });

  it('clicks on swinging through zero outside the band', () => {
    expect(shouldClick(0.5, -0.5)).toBe(true);
    expect(shouldClick(-2, 3)).toBe(true);
  });

  it('stays quiet while holding level, holding a tilt, or leaving level', () => {
    expect(shouldClick(0.05, -0.05)).toBe(false); // inside band the tone is already silent
    expect(shouldClick(2, 1.5)).toBe(false);
    expect(shouldClick(-3, -2)).toBe(false);
    expect(shouldClick(0.1, 1.5)).toBe(false); // leaving level: the tone starting is the signal
  });

  it('never clicks on garbage', () => {
    expect(shouldClick(NaN, 0)).toBe(false);
    expect(shouldClick(0, NaN)).toBe(false);
  });
});

describe('engine without an AudioContext (this environment)', () => {
  it('reports unavailable instead of pretending', () => {
    expect(ensureAudio()).toBe(false);
    expect(audioReady()).toBe(false);
  });

  it('every voice call degrades to silence, never to a throw', () => {
    expect(() => tick()).not.toThrow();
    expect(() => tick('soft')).not.toThrow();
    expect(() => setTone(440)).not.toThrow();
    expect(() => stopTone()).not.toThrow();
    expect(() => levelTone(1.2)).not.toThrow();
    expect(() => levelTone(0)).not.toThrow();
    expect(() => resetLevelTone()).not.toThrow();
  });
});
