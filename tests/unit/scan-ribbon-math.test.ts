/**
 * Field-ribbon math, headless (src/ui/charts/ribbonMath.ts): the ring
 * buffer's no-allocation indexing/wrapping and the scaling math. Pixel
 * assertions are deliberately absent — the renderer is exercised on-device;
 * the math that decides what it draws is exercised here.
 */
import { describe, expect, it } from 'vitest';
import {
  RingBuffer,
  computeHalfRange,
  easeScale,
  firstTickAtOrAbove,
  xForDistance,
  xForTime,
  yForValue,
} from '../../src/ui/charts/ribbonMath';

describe('RingBuffer', () => {
  it('stores samples in order and reads them back by logical index', () => {
    const b = new RingBuffer(8);
    for (let i = 0; i < 5; i++) b.push(i * 0.1, i, i * 0.01);
    expect(b.size).toBe(5);
    expect(b.tAt(0)).toBeCloseTo(0);
    expect(b.vAt(4)).toBe(4);
    expect(b.sAt(2)).toBeCloseTo(0.02);
    expect(b.latestT()).toBeCloseTo(0.4);
  });

  it('wraps at capacity, keeping the newest samples', () => {
    const b = new RingBuffer(4);
    for (let i = 0; i < 10; i++) b.push(i, i * 10, 0);
    expect(b.size).toBe(4);
    expect(b.tAt(0)).toBe(6); // oldest surviving
    expect(b.tAt(3)).toBe(9); // newest
    expect(b.vAt(0)).toBe(60);
    expect(b.latestT()).toBe(9);
  });

  it('binary-searches the window start over the wrapped buffer', () => {
    const b = new RingBuffer(8);
    for (let i = 0; i < 20; i++) b.push(i, 0, 0); // keeps t = 12..19
    expect(b.firstIndexAtOrAfter(12)).toBe(0);
    expect(b.firstIndexAtOrAfter(15)).toBe(3);
    expect(b.firstIndexAtOrAfter(19)).toBe(7);
    expect(b.firstIndexAtOrAfter(100)).toBe(8); // everything is older
    expect(b.firstIndexAtOrAfter(-5)).toBe(0);
  });

  it('empty buffer: no latest time, window start at 0', () => {
    const b = new RingBuffer(4);
    expect(b.latestT()).toBeNull();
    expect(b.firstIndexAtOrAfter(0)).toBe(0);
    expect(b.size).toBe(0);
  });

  it('rejects a nonsense capacity', () => {
    expect(() => new RingBuffer(0)).toThrow();
  });
});

describe('vertical scale', () => {
  it('never drops below the physical floor — a quiet wall stays visually quiet', () => {
    expect(computeHalfRange(0.01, 0.005, 1.0)).toBe(1.0);
  });

  it('grows with the largest excursion so peaks never clip', () => {
    expect(computeHalfRange(6, 0.2, 1.0)).toBeCloseTo(6.9); // 1.15×max
  });

  it('keeps the noise band a band: at least 4× σ', () => {
    expect(computeHalfRange(0.1, 0.5, 1.0)).toBeCloseTo(2.0);
  });

  it('easeScale converges to the target without overshoot', () => {
    let s = 1;
    for (let i = 0; i < 100; i++) s = easeScale(s, 5);
    expect(s).toBeCloseTo(5, 6);
    expect(easeScale(0, 3)).toBe(3); // degenerate current snaps
    expect(easeScale(NaN, 3)).toBe(3);
  });

  it('yForValue: zero at center, +v up, clamped to the canvas', () => {
    expect(yForValue(0, 2, 100)).toBe(50);
    expect(yForValue(2, 2, 100)).toBeLessThan(50);
    expect(yForValue(-2, 2, 100)).toBeGreaterThan(50);
    expect(yForValue(50, 2, 100)).toBeGreaterThanOrEqual(0);
    expect(yForValue(-50, 2, 100)).toBeLessThanOrEqual(100);
    // symmetric about the center line
    expect(yForValue(1, 2, 100) + yForValue(-1, 2, 100)).toBeCloseTo(100);
  });
});

describe('horizontal mapping', () => {
  it('time mode: right edge is now, one window back is the left edge', () => {
    expect(xForTime(20, 20, 12, 600)).toBe(600);
    expect(xForTime(8, 20, 12, 600)).toBe(0);
    expect(xForTime(14, 20, 12, 600)).toBe(300);
    expect(xForTime(2, 20, 12, 600)).toBeLessThan(0); // scrolled off — culled by the renderer
  });

  it('distance mode maps the declared span across the full width, monotonically', () => {
    expect(xForDistance(0, 0, 24, 600)).toBe(0);
    expect(xForDistance(24, 0, 24, 600)).toBe(600);
    expect(xForDistance(12, 0, 24, 600)).toBe(300);
    let prev = -Infinity;
    for (let d = 0; d <= 24; d += 3) {
      const x = xForDistance(d, 0, 24, 600);
      expect(x).toBeGreaterThan(prev);
      prev = x;
    }
  });

  it('distance mode with a degenerate span never divides by zero', () => {
    expect(xForDistance(5, 10, 10, 600)).toBe(0);
  });

  it('tick grid starts at the first step at or above the minimum', () => {
    expect(firstTickAtOrAbove(0, 4)).toBe(0);
    expect(firstTickAtOrAbove(1, 4)).toBe(4);
    expect(firstTickAtOrAbove(-9, 4)).toBe(-8);
    expect(firstTickAtOrAbove(8.000000001, 4)).toBe(8);
  });
});
