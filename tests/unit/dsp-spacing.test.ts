/**
 * Stud lattice inference — SPEC §4.1.5, §10.1 ("synthetic 16/24 screw
 * patterns with missing and spurious fasteners; verify correct pitch/phase
 * recovery and correct refusal on random patterns").
 */
import { describe, expect, it } from 'vitest';
import {
  analyzeLattice,
  CANDIDATE_PITCHES_IN,
  DENSE_SPACING_IN,
  evaluatePitch,
  fitPhase,
  LATTICE_TOLERANCE_IN,
} from '../../src/dsp/spacing';
import { mulberry32 } from '../../src/dsp/synth';

describe('candidate set and constants', () => {
  it('covers US, engineered, and metric framing', () => {
    expect(CANDIDATE_PITCHES_IN).toEqual([16.0, 24.0, 12.0, 19.2, 15.748, 23.622]);
    expect(LATTICE_TOLERANCE_IN).toBe(0.75);
    expect(DENSE_SPACING_IN).toBe(8.0);
  });
});

describe('phase fit', () => {
  it('recovers a known phase exactly on a clean lattice', () => {
    const phase = fitPhase([4, 20, 36, 52], 16);
    expect(phase).toBeCloseTo(4, 6);
  });
  it('phase is reported in [0, pitch)', () => {
    const phase = fitPhase([15, 31, 47], 16);
    expect(phase).toBeGreaterThanOrEqual(0);
    expect(phase).toBeLessThan(16);
    expect(phase).toBeCloseTo(15, 6);
  });
});

describe('pitch recovery', () => {
  it('16″ OC from three noisy peaks', () => {
    const { fit } = analyzeLattice([3.9, 20.1, 35.85]);
    expect(fit).not.toBeNull();
    expect(fit!.pitchIn).toBe(16);
    expect(fit!.explained).toBe(3);
    expect(fit!.rmsIn).toBeLessThan(0.3);
  });

  it('24″ OC beats its 12″ alias (conservative larger pitch on equal evidence)', () => {
    const { fit } = analyzeLattice([2.0, 26.0]);
    expect(fit).not.toBeNull();
    expect(fit!.pitchIn).toBe(24);
  });

  it('16″ beats 15.748″ (400 mm) when the separation says 16', () => {
    const { fit } = analyzeLattice([4.003, 20.016]);
    expect(fit).not.toBeNull();
    expect(fit!.pitchIn).toBe(16);
  });

  it('metric 400 mm wins when the separations really are 15.748″', () => {
    const { fit } = analyzeLattice([3.0, 18.748, 34.496]);
    expect(fit).not.toBeNull();
    expect(fit!.pitchIn).toBe(15.748);
  });

  it('19.2″ engineered layout recovers', () => {
    const { fit } = analyzeLattice([5.0, 24.2, 43.4]);
    expect(fit).not.toBeNull();
    expect(fit!.pitchIn).toBe(19.2);
  });

  it('survives a missing fastener (16, gap, 48)', () => {
    const { fit } = analyzeLattice([4.0, 20.0, 52.1]);
    expect(fit).not.toBeNull();
    expect(fit!.pitchIn).toBe(16);
    expect(fit!.explained).toBe(3);
  });

  it('survives one spurious fastener among a 16″ lattice', () => {
    const { fit } = analyzeLattice([4.0, 11.3, 20.0, 36.1]);
    expect(fit).not.toBeNull();
    expect(fit!.pitchIn).toBe(16);
    expect(fit!.explained).toBe(3);
    expect(fit!.total).toBe(4);
  });
});

describe('refusal (SPEC §15.3)', () => {
  it('fewer than 2 peaks: no lattice claim', () => {
    expect(analyzeLattice([]).fit).toBeNull();
    expect(analyzeLattice([12.5]).fit).toBeNull();
  });

  it('two peaks that fit no candidate: no lattice claim', () => {
    const { fit } = analyzeLattice([3.0, 10.0]); // 7″ apart fits nothing
    expect(fit).toBeNull();
  });

  it('dense irregular pattern → denseIrregular, pitch refused', () => {
    const res = analyzeLattice([3.4, 9.1, 14.2, 21.7, 27.1, 33.9]);
    expect(res.denseIrregular).toBe(true);
    expect(res.fit).toBeNull();
    expect(res.medianSpacingIn).toBeLessThan(DENSE_SPACING_IN);
  });

  it('property: random dense patterns are refused, seeded ×100', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const rand = mulberry32(seed * 131);
      const peaks: number[] = [];
      let x = 1 + rand() * 3;
      while (x < 40 && peaks.length < 12) {
        peaks.push(x);
        x += 1.5 + rand() * 4.5; // 1.5–6″ gaps: never a stud lattice
      }
      if (peaks.length < 4) continue;
      const res = analyzeLattice(peaks);
      expect(res.fit, `seed ${seed}: claimed pitch on a dense random pattern`).toBeNull();
    }
  });

  it('property: 16″ and 24″ lattices with jitter ≤0.3″ recover, seeded ×100', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const rand = mulberry32(seed * 977);
      const pitch = seed % 2 === 0 ? 16 : 24;
      const phase = rand() * pitch;
      const peaks: number[] = [];
      for (let k = 0; k < 4; k++) {
        peaks.push(phase + k * pitch + (rand() - 0.5) * 0.6);
      }
      const res = analyzeLattice(peaks);
      expect(res.fit, `seed ${seed}`).not.toBeNull();
      expect(res.fit!.pitchIn, `seed ${seed}: wrong pitch`).toBe(pitch);
      expect(res.fit!.explained).toBe(4);
    }
  });
});

describe('evaluatePitch details', () => {
  it('reports rms over explained peaks only', () => {
    const fit = evaluatePitch([4.0, 20.0, 29.0], 16);
    expect(fit.explained).toBe(2);
    expect(fit.rmsIn).toBeLessThan(0.01);
  });
});
