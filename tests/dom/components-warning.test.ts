// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { WARNING_COPY, warningBanner } from '../../src/ui/components/warning';
import type { WarningKey } from '../../src/types';

const ALL_KEYS: WarningKey[] = [
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

describe('warningBanner', () => {
  it('renders the message as an assertive alert carrying its key', () => {
    const el = warningBanner('WALL_HOT', WARNING_COPY.WALL_HOT, () => {});
    expect(el.getAttribute('role')).toBe('alert');
    expect(el.getAttribute('data-warning-key')).toBe('WALL_HOT');
    expect(el.textContent).toContain('Wall reads hot.');
  });

  it('always exposes EXPLAIN, and nothing that dismisses without it (§7B.6)', () => {
    const el = warningBanner('SWEEP_TOO_FAST', WARNING_COPY.SWEEP_TOO_FAST, () => {});
    const buttons = el.querySelectorAll('button');
    expect(buttons.length).toBe(1);
    expect(buttons[0]?.textContent).toBe('EXPLAIN');
    expect(buttons[0]?.getAttribute('aria-label')).toContain('why it happens');
  });

  it('fires onExplain on tap', () => {
    let opened = 0;
    const el = warningBanner('SATURATED', WARNING_COPY.SATURATED, () => opened++);
    el.querySelector('button')?.click();
    expect(opened).toBe(1);
  });

  it('ships canonical copy for every warning key in the closed union', () => {
    for (const key of ALL_KEYS) {
      expect(WARNING_COPY[key], key).toBeTruthy();
      expect(WARNING_COPY[key].length).toBeGreaterThan(20);
    }
  });

  it('copy keeps the voice: no apologies, no "simply/just/easy", says what to do', () => {
    const banned = /\b(simply|just|easy|easily|sorry|please|unfortunately|might|maybe)\b/i;
    for (const [key, copy] of Object.entries(WARNING_COPY)) {
      expect(copy, `${key} violates voice rules`).not.toMatch(banned);
    }
  });
});
