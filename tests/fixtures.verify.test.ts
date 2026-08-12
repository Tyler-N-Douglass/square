/**
 * `npm run verify:fixtures` — the regression net for the entire product
 * (SPEC §10.2). Replays every committed trace headlessly through the real
 * pipeline and asserts detected positions, confidence states, and warnings
 * against each fixture's `expected` block.
 *
 * Failure traces are first-class: a fixture whose correct behavior is to
 * find nothing (peaks_in: []) or to warn (expected.warnings) is asserted
 * just as strictly.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyzeMagTrace } from '../src/dsp/analyze';
import { validateTrace } from '../src/sensors/replay';
import type { SensorTrace } from '../src/types';

const dir = new URL('./fixtures/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();

describe('fixture corpus', () => {
  it('contains at least the seed trace', () => {
    expect(files).toContain('drywall-16oc-synthetic.json');
  });

  for (const file of files) {
    describe(file, () => {
      const raw: unknown = JSON.parse(readFileSync(new URL(file, dir), 'utf8'));

      it('validates against square.trace/1', () => {
        expect(() => validateTrace(raw)).not.toThrow();
      });

      const trace = raw as SensorTrace;

      it('replays to its expected outcome through the real pipeline', () => {
        const res = analyzeMagTrace(trace);

        // Positions: same count, each within the fixture's stated tolerance.
        expect(res.peaksIn).toHaveLength(trace.expected.peaks_in.length);
        const got = [...res.peaksIn].sort((a, b) => a - b);
        const want = [...trace.expected.peaks_in].sort((a, b) => a - b);
        for (let i = 0; i < want.length; i++) {
          expect(
            Math.abs(got[i]! - want[i]!),
            `peak ${i}: got ${got[i]}, want ${want[i]} ±${trace.expected.tolerance_in}`,
          ).toBeLessThanOrEqual(trace.expected.tolerance_in);
        }

        // Pitch, when the fixture asserts one.
        if (trace.expected.pitch_in !== null) {
          expect(res.pitchIn).not.toBeNull();
          expect(Math.abs((res.pitchIn ?? NaN) - trace.expected.pitch_in)).toBeLessThanOrEqual(0.5);
        }

        // Confidence state and warning keys, exactly.
        expect(res.confidence).toBe(trace.expected.confidence);
        expect([...res.warnings].sort()).toEqual([...trace.expected.warnings].sort());
      });
    });
  }
});
