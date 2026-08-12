/**
 * CORNER marking state machine + noise bookkeeping (SPEC §4.3, A3b).
 * The quad order contract (P0 corner, P1 family-1, P2 diagonal, P3 family-2)
 * is enforced by flow: points can only be placed in order, are re-editable,
 * and undo removes the most recent (§7B.9). Loupe + sigma math is pure.
 */
import { describe, expect, it } from 'vitest';
import { MarkingSession, MARK_STEPS } from '../../src/tools/corner/state';
import { loupeSourceRect, markingSigmaPx, workingSize, WORKING_LONG_EDGE_MAX } from '../../src/tools/corner/math';

describe('MARK_STEPS — the enforced solver order', () => {
  it('marks the corner first, then family 1, then the diagonal, then family 2', () => {
    expect(MARK_STEPS.map((s) => s.key)).toEqual(['P0', 'P1', 'P2', 'P3']);
    expect(MARK_STEPS[0].label).toBe('CORNER');
    expect(MARK_STEPS[2].label).toBe('DIAGONAL');
  });
});

describe('MarkingSession', () => {
  it('places points strictly in order and refuses a fifth', () => {
    const s = new MarkingSession(1000, 800);
    expect(s.nextStep?.key).toBe('P0');
    expect(s.place(10, 20)).toBe(0);
    expect(s.nextStep?.key).toBe('P1');
    expect(s.place(500, 20)).toBe(1);
    expect(s.place(500, 400)).toBe(2);
    expect(s.nextStep?.key).toBe('P3');
    expect(s.place(10, 400)).toBe(3);
    expect(s.complete).toBe(true);
    expect(s.nextStep).toBeNull();
    expect(s.place(600, 600)).toBeNull(); // no fifth point, ever
    expect(s.count).toBe(4);
  });

  it('produces the quad in contract order only when complete', () => {
    const s = new MarkingSession(1000, 800);
    s.place(1, 2);
    expect(s.quad()).toBeNull();
    s.place(3, 4);
    s.place(5, 6);
    s.place(7, 8);
    expect(s.quad()).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
      { x: 5, y: 6 },
      { x: 7, y: 8 },
    ]);
  });

  it('undo removes the most recent point and re-opens its step', () => {
    const s = new MarkingSession(1000, 800);
    expect(s.undo()).toBe(false);
    s.place(1, 1);
    s.place(2, 2);
    expect(s.undo()).toBe(true);
    expect(s.count).toBe(1);
    expect(s.nextStep?.key).toBe('P1');
    s.place(9, 9);
    expect(s.points[1]).toMatchObject({ x: 9, y: 9 });
  });

  it('drag-to-refine: hit finds the nearest point in radius, moveTo flags refined', () => {
    const s = new MarkingSession(1000, 800);
    s.place(100, 100);
    s.place(300, 100);
    expect(s.hit(305, 104, 20)).toBe(1);
    expect(s.hit(500, 500, 20)).toBeNull();
    expect(s.moveTo(1, 310, 90)).toBe(true);
    expect(s.points[1]).toMatchObject({ x: 310, y: 90, refined: true });
    expect(s.allRefined).toBe(false); // point 0 untouched
    s.moveTo(0, 101, 101);
    expect(s.allRefined).toBe(true);
  });

  it('clamps placements and moves to the image bounds', () => {
    const s = new MarkingSession(100, 50);
    s.place(-10, 700);
    expect(s.points[0]).toMatchObject({ x: 0, y: 50 });
    s.moveTo(0, 500, -3);
    expect(s.points[0]).toMatchObject({ x: 100, y: 0 });
  });

  it('setPoint (snap assist) adjusts without claiming a loupe refinement', () => {
    const s = new MarkingSession(100, 100);
    s.place(10, 10);
    s.setPoint(0, 12, 11);
    expect(s.points[0]).toMatchObject({ x: 12, y: 11, refined: false });
  });
});

describe('workingSize — resolution cap with recorded scale', () => {
  it('caps the long edge at 2048 and records the factor', () => {
    const w = workingSize(4000, 3000);
    expect(w.w).toBe(WORKING_LONG_EDGE_MAX);
    expect(w.h).toBe(1536);
    expect(w.scale).toBeCloseTo(0.512, 5);
  });

  it('never upscales', () => {
    expect(workingSize(1280, 720)).toEqual({ w: 1280, h: 720, scale: 1 });
  });
});

describe('markingSigmaPx — σ = 2 px scaled with resolution and zoom (§4.3.3)', () => {
  it('scales the 2 px touch error by the display-to-working ratio', () => {
    expect(markingSigmaPx({ cssToWorkingScale: 5, allRefined: false, loupeZoom: 3 })).toBeCloseTo(10);
  });

  it('credits loupe refinement, capped at 2×', () => {
    const refined = markingSigmaPx({ cssToWorkingScale: 5, allRefined: true, loupeZoom: 3 });
    expect(refined).toBeCloseTo(5); // ÷ min(3, 2)
    const mildZoom = markingSigmaPx({ cssToWorkingScale: 5, allRefined: true, loupeZoom: 1.5 });
    expect(mildZoom).toBeCloseTo(10 / 1.5);
  });

  it('floors at 0.75 px — no sub-pixel finger claims', () => {
    expect(markingSigmaPx({ cssToWorkingScale: 0.1, allRefined: true, loupeZoom: 3 })).toBe(0.75);
  });
});

describe('loupeSourceRect — magnified source window', () => {
  it('centers on the finger and divides by zoom', () => {
    const r = loupeSourceRect(500, 400, 2000, 1600, 300, 3);
    expect(r.sw).toBeCloseTo(100);
    expect(r.sh).toBeCloseTo(100);
    expect(r.sx).toBeCloseTo(450);
    expect(r.sy).toBeCloseTo(350);
  });

  it('clamps at the image edges so the loupe never samples outside', () => {
    const r = loupeSourceRect(5, 5, 2000, 1600, 300, 3);
    expect(r.sx).toBe(0);
    expect(r.sy).toBe(0);
    const r2 = loupeSourceRect(1999, 1599, 2000, 1600, 300, 3);
    expect(r2.sx + r2.sw).toBeLessThanOrEqual(2000);
    expect(r2.sy + r2.sh).toBeLessThanOrEqual(1600);
  });
});
