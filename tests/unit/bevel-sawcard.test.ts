/**
 * Saw-card assembly — SPEC §4.5.2 (A4, Phase 2). The flat-vs-nested
 * distinction is the money test: same corner, different settings, and the
 * card must always state which hold its numbers are for.
 */
import { describe, expect, it } from 'vitest';
import { sawCard } from '../../src/geometry/miter';

describe('sawCard method labeling — flat vs nested never blur', () => {
  it('same corner, different settings: flat 90/45 → 35.26/30.00; nested 90 → 45/0', () => {
    const flat = sawCard({ cornerDeg: 90, springDeg: 45, method: 'flat' });
    const nested = sawCard({ cornerDeg: 90, springDeg: 45, method: 'nested' });
    expect(flat.method).toBe('flat');
    expect(nested.method).toBe('nested');
    expect(flat.miterDeg).toBeCloseTo(35.26, 1);
    expect(flat.bevelDeg).toBeCloseTo(30.0, 1);
    expect(nested.miterDeg).toBeCloseTo(45, 6);
    expect(nested.bevelDeg).toBeCloseTo(0, 6);
    // the two methods really are different numbers for the same corner
    expect(Math.abs(flat.miterDeg - nested.miterDeg)).toBeGreaterThan(5);
  });

  it('the handling copy matches the method', () => {
    const flat = sawCard({ cornerDeg: 90, springDeg: 38, method: 'flat' });
    expect(flat.fenceSide.toLowerCase()).toContain('flat on the table');
    expect(flat.tiltDirection.toLowerCase()).toContain('tilt the blade');
    const nested = sawCard({ cornerDeg: 90, springDeg: 38, method: 'nested' });
    expect(nested.fenceSide.toLowerCase()).toContain('against the fence');
    expect(nested.tiltDirection.toLowerCase()).toContain('no tilt');
  });

  it('every card carries keeper, flip and the test-cut line', () => {
    for (const method of ['flat', 'nested'] as const) {
      const card = sawCard({ cornerDeg: 135, springDeg: 45, method });
      expect(card.keeperSide.length).toBeGreaterThan(0);
      expect(card.flipMate.length).toBeGreaterThan(0);
      expect(card.testCutNote.toLowerCase()).toContain('scrap');
    }
  });

  it('mate swings the opposite way', () => {
    const left = sawCard({ cornerDeg: 90, springDeg: 45, method: 'flat', piece: 'left' });
    const right = sawCard({ cornerDeg: 90, springDeg: 45, method: 'flat', piece: 'right' });
    expect(left.tiltDirection).not.toBe(right.tiltDirection);
  });
});
