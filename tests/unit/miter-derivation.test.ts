/**
 * A4's own miter tests — beyond the frozen canonicals in
 * miter-canonical.test.ts. Pins the vector derivation against the spec's
 * candidate formulas exactly where they agree AND where they disagree
 * (ADR-009), plus nested crown, asymmetric miter, the face line, and the
 * saw card. Discrepancies documented in docs/physics-craft.md.
 */
import { describe, expect, it } from 'vitest';
import {
  asymmetricMiter,
  compoundMiter,
  crownFaceLine,
  nestedCrown,
  sawCard,
  simpleMiter,
} from '../../src/geometry/miter';

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const D = (cornerDeg: number): number => (180 - cornerDeg) / 2;

// The spec's §4.5.2 candidate formulas, transcribed verbatim for comparison.
// They are NOT the implementation (ADR-009) — the vector derivation is.
const candidateMiter = (c: number, s: number): number =>
  Math.atan(Math.sin(s * RAD) * Math.tan(D(c) * RAD)) * DEG;
const candidateBevel = (c: number, s: number): number =>
  Math.asin(Math.cos(s * RAD) * Math.cos(D(c) * RAD)) * DEG;

// The closed forms the derivation reduces to (docs/physics-craft.md):
//   miter = atan(sin S · tan D)  — same as the candidate
//   bevel = asin(cos S · sin D)  — candidate has cos D
const derivedBevelClosed = (c: number, s: number): number =>
  Math.asin(Math.cos(s * RAD) * Math.sin(D(c) * RAD)) * DEG;

describe('derivation vs closed forms', () => {
  it('the vector construction reduces to miter = atan(sin S · tan D), bevel = asin(cos S · sin D)', () => {
    for (let c = 60; c <= 180; c += 3) {
      for (let s = 30; s <= 60; s += 3) {
        const cut = compoundMiter(c, s);
        expect(cut.miterDeg).toBeCloseTo(candidateMiter(c, s), 9);
        expect(cut.bevelDeg).toBeCloseTo(derivedBevelClosed(c, s), 9);
      }
    }
  });
});

describe('derivation vs the spec candidate formulas (ADR-009)', () => {
  it('agrees with the candidate MITER formula everywhere', () => {
    for (let c = 60; c <= 180; c += 5) {
      for (let s = 30; s <= 60; s += 5) {
        expect(compoundMiter(c, s).miterDeg).toBeCloseTo(candidateMiter(c, s), 9);
      }
    }
  });

  it('agrees with the candidate BEVEL formula at 90° corners only — sin 45° = cos 45°', () => {
    for (let s = 30; s <= 60; s += 5) {
      expect(compoundMiter(90, s).bevelDeg).toBeCloseTo(candidateBevel(90, s), 9);
    }
  });

  it('refutes the candidate BEVEL at the flat splice: candidate says 90° − S, geometry says 0°', () => {
    for (const s of [30, 38, 45, 52, 60]) {
      const derived = compoundMiter(180, s).bevelDeg;
      expect(Math.abs(derived)).toBeLessThan(1e-9);
      expect(candidateBevel(180, s)).toBeCloseTo(90 - s, 9); // the trap, quantified
    }
  });

  it('diverges from the candidate BEVEL at every non-90° corner (e.g. 120°/45°: 37.8° vs 20.7°)', () => {
    const derived = compoundMiter(120, 45).bevelDeg;
    const candidate = candidateBevel(120, 45);
    expect(derived).toBeCloseTo(20.7, 1);
    expect(candidate).toBeCloseTo(37.76, 1);
    expect(candidate - derived).toBeGreaterThan(15);
  });
});

describe('nested (in-position) crown', () => {
  it('cuts at miter = (180 − C)/2 with zero bevel — the spring angle drops out', () => {
    for (let c = 60; c <= 180; c += 5) {
      const cut = nestedCrown(c);
      expect(cut.miterDeg).toBeCloseTo(D(c), 9);
      expect(Math.abs(cut.bevelDeg)).toBeLessThan(1e-9);
      expect(cut.miterDeg).toBeCloseTo(simpleMiter(c), 9);
    }
  });

  it('90° corner → 45° miter; 135° corner → 22.5° miter', () => {
    expect(nestedCrown(90).miterDeg).toBeCloseTo(45, 9);
    expect(nestedCrown(135).miterDeg).toBeCloseTo(22.5, 9);
  });

  it('differs from the flat-cut settings for the same corner — the wrong family wastes molding', () => {
    const flat = compoundMiter(90, 38);
    const nested = nestedCrown(90);
    expect(Math.abs(flat.miterDeg - nested.miterDeg)).toBeGreaterThan(10);
    expect(flat.bevelDeg).toBeGreaterThan(30);
    expect(nested.bevelDeg).toBe(0);
  });
});

describe('asymmetric miter', () => {
  it('the two miters sum to 180° − C', () => {
    expect(asymmetricMiter(90, 40)).toBeCloseTo(50, 9);
    expect(asymmetricMiter(90, 45)).toBeCloseTo(45, 9);
    expect(asymmetricMiter(135, 10)).toBeCloseTo(35, 9);
  });

  it('reports the true remainder without clamping, even when it is not cuttable', () => {
    expect(asymmetricMiter(90, 95)).toBeCloseTo(-5, 9);
  });
});

describe('crown face line — a marking angle, not a saw setting', () => {
  it('from-square equals the flat-cut miter: the saw draws the same line across the face', () => {
    for (let c = 60; c <= 180; c += 5) {
      for (let s = 30; s <= 60; s += 5) {
        const face = crownFaceLine(c, s);
        expect(face.fromSquareDeg).toBeCloseTo(compoundMiter(c, s).miterDeg, 9);
        expect(face.fromEdgeDeg).toBeCloseTo(90 - face.fromSquareDeg, 9);
      }
    }
  });

  it('matches the spec\'s atan(tan D / cos S) family at the 90°/45° canonical: 54.74° from the edge', () => {
    const family = Math.atan(Math.tan(D(90) * RAD) / Math.cos(45 * RAD)) * DEG;
    expect(crownFaceLine(90, 45).fromEdgeDeg).toBeCloseTo(54.7356, 3);
    expect(family).toBeCloseTo(54.7356, 3);
  });

  it('refutes the literal family formula off the 45° spring: 90°/38° face line is 58.4°, not 51.8°', () => {
    const family = Math.atan(Math.tan(D(90) * RAD) / Math.cos(38 * RAD)) * DEG;
    const derived = crownFaceLine(90, 38).fromEdgeDeg;
    expect(derived).toBeCloseTo(58.381, 2);
    expect(family).toBeCloseTo(51.766, 2);
    expect(derived - family).toBeGreaterThan(6);
  });
});

describe('saw card — SPEC §4.5.2', () => {
  const banned = /\b(simply|just|easy)\b/i;
  const allStrings = (card: ReturnType<typeof sawCard>): string[] => [
    card.tiltDirection,
    card.fenceSide,
    card.keeperSide,
    card.flipMate,
    card.testCutNote,
  ];

  it('flat card carries the derived flat settings', () => {
    const card = sawCard({ cornerDeg: 90, springDeg: 38, method: 'flat' });
    expect(card.method).toBe('flat');
    expect(card.miterDeg).toBeCloseTo(31.62, 2);
    expect(card.bevelDeg).toBeCloseTo(33.86, 2);
  });

  it('nested card carries the nested settings: miter D, zero bevel, fence holds the spring', () => {
    const card = sawCard({ cornerDeg: 90, springDeg: 38, method: 'nested' });
    expect(card.method).toBe('nested');
    expect(card.miterDeg).toBeCloseTo(45, 9);
    expect(card.bevelDeg).toBe(0);
    expect(card.fenceSide).toMatch(/upside down/);
  });

  it('always tells the user to test on scrap, in BRAND voice', () => {
    for (const method of ['flat', 'nested'] as const) {
      const card = sawCard({ cornerDeg: 92.5, springDeg: 45, method });
      expect(card.testCutNote).toMatch(/scrap/);
      for (const s of allStrings(card)) {
        expect(s.length).toBeGreaterThan(0);
        expect(s).not.toMatch(banned);
      }
    }
  });

  it('mirrors the table swing between the two pieces of a corner', () => {
    const left = sawCard({ cornerDeg: 90, springDeg: 45, method: 'flat', piece: 'left' });
    const right = sawCard({ cornerDeg: 90, springDeg: 45, method: 'flat', piece: 'right' });
    expect(left.tiltDirection).toMatch(/table right/);
    expect(right.tiltDirection).toMatch(/table left/);
    expect(left.keeperSide).toMatch(/left side/);
    expect(right.keeperSide).toMatch(/right side/);
  });

  it('flips the swing for an outside corner', () => {
    const inside = sawCard({ cornerDeg: 90, springDeg: 45, method: 'flat', corner: 'inside', piece: 'left' });
    const outside = sawCard({ cornerDeg: 90, springDeg: 45, method: 'flat', corner: 'outside', piece: 'left' });
    expect(inside.tiltDirection).toMatch(/table right/);
    expect(outside.tiltDirection).toMatch(/table left/);
  });
});

describe('input validation — refuse, never emit garbage', () => {
  it('rejects non-finite and out-of-range corner angles', () => {
    for (const bad of [NaN, Infinity, -Infinity, 0, -10, 360, 400]) {
      expect(() => compoundMiter(bad, 45)).toThrow(RangeError);
      expect(() => simpleMiter(bad)).toThrow(RangeError);
      expect(() => nestedCrown(bad)).toThrow(RangeError);
    }
  });

  it('rejects out-of-range spring angles', () => {
    for (const bad of [NaN, -1, 90.1, Infinity]) {
      expect(() => compoundMiter(90, bad)).toThrow(RangeError);
      expect(() => crownFaceLine(90, bad)).toThrow(RangeError);
    }
  });

  it('accepts outside-corner angles above 180°', () => {
    const cut = compoundMiter(270, 45);
    expect(Number.isFinite(cut.miterDeg)).toBe(true);
    expect(Number.isFinite(cut.bevelDeg)).toBe(true);
    // 270° outside corner mirrors the 90° inside corner in magnitude.
    expect(cut.miterDeg).toBeCloseTo(compoundMiter(90, 45).miterDeg, 9);
    expect(cut.bevelDeg).toBeCloseTo(compoundMiter(90, 45).bevelDeg, 9);
  });
});
