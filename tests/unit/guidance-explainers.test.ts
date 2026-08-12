/**
 * Explainer registry — SPEC §7B.6, §7B.10.
 * Every warning and every confidence state has a complete card, in voice.
 * The Record types make a missing key a compile error; this suite makes an
 * empty or off-voice card a runtime failure.
 */
import { describe, expect, it } from 'vitest';
import {
  CONFIDENCE_EXPLAINERS,
  UNCERTAINTY_EXPLAINER,
  WARNING_EXPLAINERS,
  type Explainer,
} from '../../src/guidance/explainers';
import { voiceViolations } from '../../src/guidance/voice';
import type { Confidence, UncertaintyBasis, WarningKey } from '../../src/types';

/** All nine — hardcoded so a silently narrowed union cannot shrink the test. */
const ALL_WARNINGS: WarningKey[] = [
  'WALL_HOT',
  'MAGNETIC_ACCESSORY',
  'SWEEP_TOO_FAST',
  'RATE_COLLAPSE',
  'SATURATED',
  'UNCALIBRATED',
  'GYRO_DRIFT',
  'LENS_UNCALIBRATED',
  'POOR_GEOMETRY',
];

const ALL_CONFIDENCE: Confidence[] = ['STRONG', 'LIKELY', 'POSSIBLE', 'NOISE', 'UNRELIABLE'];

const ALL_BASES: UncertaintyBasis[] = ['montecarlo', 'stddev', 'nominal', 'unknown'];

const CALIBRATION_ROUTES = ['mag', 'sensorLocator', 'levelZero', 'lens'];

function assertCard(name: string, card: Explainer): void {
  for (const field of ['title', 'why', 'whatToDo', 'ifIgnored'] as const) {
    const text = card[field];
    expect(text, `${name}.${field} must be non-empty`).toBeTruthy();
    expect(text.trim().length, `${name}.${field} must have content`).toBeGreaterThan(0);
    expect(
      voiceViolations(text),
      `${name}.${field} breaks the voice rules (§7B.10): "${text}"`,
    ).toEqual([]);
  }
  if (card.calibrationRoute !== undefined) {
    expect(CALIBRATION_ROUTES, `${name}.calibrationRoute`).toContain(card.calibrationRoute);
  }
}

describe('WARNING_EXPLAINERS covers all nine keys with complete cards in voice', () => {
  it('has exactly the nine WarningKeys', () => {
    expect(Object.keys(WARNING_EXPLAINERS).sort()).toEqual([...ALL_WARNINGS].sort());
  });

  for (const key of ALL_WARNINGS) {
    it(`${key}: all four fields non-empty, voice rules hold`, () => {
      assertCard(key, WARNING_EXPLAINERS[key]);
    });
  }

  it('the calibration-linked warnings route to a calibration (§7B.6 one-tap route)', () => {
    expect(WARNING_EXPLAINERS.MAGNETIC_ACCESSORY.calibrationRoute).toBe('mag');
    expect(WARNING_EXPLAINERS.UNCALIBRATED.calibrationRoute).toBe('mag');
    expect(WARNING_EXPLAINERS.LENS_UNCALIBRATED.calibrationRoute).toBe('lens');
  });

  it('WALL_HOT carries the real physical content, not filler', () => {
    const c = WARNING_EXPLAINERS.WALL_HOT;
    expect(c.why).toMatch(/metal studs/i);
    expect(c.why).toMatch(/conduit/i);
    expect(c.whatToDo).toMatch(/MANUAL/);
    expect(c.ifIgnored).toMatch(/guess/i);
  });
});

describe('CONFIDENCE_EXPLAINERS covers all five states with complete cards in voice', () => {
  it('has exactly the five Confidence states', () => {
    expect(Object.keys(CONFIDENCE_EXPLAINERS).sort()).toEqual([...ALL_CONFIDENCE].sort());
  });

  for (const key of ALL_CONFIDENCE) {
    it(`${key}: all four fields non-empty, voice rules hold`, () => {
      assertCard(key, CONFIDENCE_EXPLAINERS[key]);
    });
  }

  it('states below STRONG say what would raise them (§7B.6)', () => {
    for (const key of ['LIKELY', 'POSSIBLE', 'NOISE'] as const) {
      expect(
        CONFIDENCE_EXPLAINERS[key].calibrationRoute,
        `${key} should route to the calibration that helps`,
      ).toBeDefined();
    }
  });
});

describe('UNCERTAINTY_EXPLAINER — one sentence per basis (§7B.6)', () => {
  for (const basis of ALL_BASES) {
    it(`${basis}: one non-empty sentence, voice rules hold`, () => {
      const text = UNCERTAINTY_EXPLAINER(basis);
      expect(text.trim().length).toBeGreaterThan(0);
      expect(voiceViolations(text)).toEqual([]);
      // One sentence: exactly one terminal period, no internal sentence breaks.
      expect(text.trim().endsWith('.'), `"${text}" should end with a period`).toBe(true);
      expect((text.match(/\./g) ?? []).length, `"${text}" should be one sentence`).toBe(1);
    });
  }
});
