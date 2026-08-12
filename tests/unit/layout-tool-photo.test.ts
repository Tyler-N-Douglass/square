/**
 * Photo-scaled layout math — SPEC §4.4.2 (A4, Phase 2): scale from two
 * reference taps + a real distance; displayed uncertainty derived from a
 * stated ±2 px marking error, GROWING with the span-to-reference ratio.
 */
import { describe, expect, it } from 'vitest';
import { MARK_ERROR_PX, photoScaleFrom, scaledLength } from '../../src/tools/layout/solver';
import { parseLength } from '../../src/geometry/units';

describe('photoScaleFrom', () => {
  it('sets inches-per-pixel from the reference pair', () => {
    const r = photoScaleFrom(400, parseLength('36"')!.inches);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.scale.inPerPx).toBeCloseTo(0.09, 9);
  });

  it('refuses reference points too close to carry a scale', () => {
    const r = photoScaleFrom(12, parseLength('36"')!.inches);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('too close');
  });

  it('refuses a zero real distance', () => {
    expect(photoScaleFrom(400, parseLength('0"')!.inches).ok).toBe(false);
  });
});

describe('scaledLength uncertainty — grows with span/reference ratio', () => {
  const scale = (() => {
    const r = photoScaleFrom(400, parseLength('36"')!.inches);
    if (!r.ok) throw new Error('scale setup failed');
    return r.scale;
  })();

  it('propagates σ_L = √2·σ_px·s·√(1 + (p/d)²)', () => {
    const p = 800;
    const out = scaledLength(scale, p);
    const s = 36 / 400;
    const expected = Math.SQRT2 * MARK_ERROR_PX * s * Math.sqrt(1 + (p / 400) ** 2);
    expect(out.inches).toBeCloseTo(72, 9);
    expect(out.plusMinusIn).toBeCloseTo(expected, 12);
  });

  it('is monotonic in the ratio: an 8× span carries ~5.7× the ± of a 1× span', () => {
    const one = scaledLength(scale, 400).plusMinusIn;
    const eight = scaledLength(scale, 3200).plusMinusIn;
    expect(eight).toBeGreaterThan(one);
    expect(eight / one).toBeCloseTo(Math.sqrt(65) / Math.SQRT2, 2);
  });

  it('never claims zero even for a tiny measured span — the reference error remains', () => {
    const tiny = scaledLength(scale, 1).plusMinusIn;
    expect(tiny).toBeGreaterThan(Math.SQRT2 * MARK_ERROR_PX * scale.inPerPx * 0.99);
  });
});
