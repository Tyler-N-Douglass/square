/**
 * FROZEN LOAD-BEARING TEST (ADR-004) — written before the implementation.
 * Subagents make it pass; nobody edits it. SPEC §4.5.2, §10.1.
 *
 * The compound-miter canonical values. Derived from rotation matrices, not
 * from the spec's candidate formulas — the candidate bevel form
 * asin(cos S · cos D) coincidentally matches at D = 45° but fails the flat
 * splice (it gives 90° − S instead of 0°). If an implementation reproduces
 * the candidate instead of the canonicals, the implementation is wrong.
 */
import { describe, expect, it } from 'vitest';
import { compoundMiter, simpleMiter } from '../../src/geometry/miter';

describe('compound miter — canonical values (SPEC §4.5.2)', () => {
  it('90° corner, 45/45 crown → miter 35.26°, bevel 30.00°', () => {
    const { miterDeg, bevelDeg } = compoundMiter(90, 45);
    expect(miterDeg).toBeCloseTo(35.26, 2);
    expect(bevelDeg).toBeCloseTo(30.0, 2);
  });

  it('90° corner, 52/38 crown (spring 38°) → miter 31.62°, bevel 33.86°', () => {
    const { miterDeg, bevelDeg } = compoundMiter(90, 38);
    expect(miterDeg).toBeCloseTo(31.62, 2);
    expect(bevelDeg).toBeCloseTo(33.86, 2);
  });

  it('180° flat splice → miter 0°, bevel 0°, at every spring angle', () => {
    for (const s of [30, 38, 45, 52, 60]) {
      const { miterDeg, bevelDeg } = compoundMiter(180, s);
      expect(Math.abs(miterDeg)).toBeLessThan(1e-6);
      expect(Math.abs(bevelDeg)).toBeLessThan(1e-6);
    }
  });

  it('is continuous and finite across C ∈ [60°,180°], S ∈ [30°,60°]', () => {
    for (let s = 30; s <= 60; s += 1) {
      let prev: { miterDeg: number; bevelDeg: number } | null = null;
      for (let c = 60; c <= 180; c += 0.5) {
        const cut = compoundMiter(c, s);
        expect(Number.isFinite(cut.miterDeg)).toBe(true);
        expect(Number.isFinite(cut.bevelDeg)).toBe(true);
        if (prev) {
          expect(Math.abs(cut.miterDeg - prev.miterDeg)).toBeLessThan(1.0);
          expect(Math.abs(cut.bevelDeg - prev.bevelDeg)).toBeLessThan(1.0);
        }
        prev = cut;
      }
    }
  });

  it('is monotonic in corner angle: opening the corner shrinks both settings', () => {
    for (const s of [30, 45, 60]) {
      let prev = compoundMiter(60, s);
      for (let c = 61; c <= 180; c += 1) {
        const cut = compoundMiter(c, s);
        expect(cut.miterDeg).toBeLessThanOrEqual(prev.miterDeg + 1e-9);
        expect(cut.bevelDeg).toBeLessThanOrEqual(prev.bevelDeg + 1e-9);
        prev = cut;
      }
    }
  });
});

describe('simple miter', () => {
  it('splits the corner evenly: 90° → 45°, 180° → 0°, 135° → 22.5°', () => {
    expect(simpleMiter(90)).toBeCloseTo(45, 6);
    expect(simpleMiter(180)).toBeCloseTo(0, 6);
    expect(simpleMiter(135)).toBeCloseTo(22.5, 6);
  });
});
