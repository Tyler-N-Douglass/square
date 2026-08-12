/**
 * LEVEL mode math (src/tools/level/levelModes.ts): the gravity-up
 * reconstruction against pitchRollFromGravity, the four mode angles on
 * synthetic gravity vectors with pinned signs, the bubble mapping.
 */
import { describe, expect, it } from 'vitest';
import { pitchRollFromGravity } from '../../src/geometry/levelMath';
import {
  bubbleXY,
  edgeAngleDeg,
  gravityUpFromPitchRoll,
  kindForMode,
  LEVEL_MODES,
  plumbAngleDeg,
  primaryAngleDeg,
  screenTiltDeg,
  surfaceTiltDeg,
} from '../../src/tools/level/levelModes';
import { mulberry32 } from '../../src/tools/level/demoStream';

const G = 9.80665;
const RAD = Math.PI / 180;

function pr(ax: number, ay: number, az: number): { pitch: number; roll: number } {
  return pitchRollFromGravity(ax, ay, az);
}

describe('gravityUpFromPitchRoll', () => {
  it('is the exact inverse of pitchRollFromGravity over random orientations', () => {
    const rand = mulberry32(7);
    for (let i = 0; i < 500; i++) {
      const pitch = (rand() - 0.5) * Math.PI * 0.98; // avoid the exact gimbal
      const roll = (rand() - 0.5) * 2 * Math.PI * 0.98;
      const [ux, uy, uz] = gravityUpFromPitchRoll(pitch, roll);
      expect(Math.hypot(ux, uy, uz)).toBeCloseTo(1, 9);
      const back = pitchRollFromGravity(ux * G, uy * G, uz * G);
      expect(back.pitch).toBeCloseTo(pitch, 8);
      expect(back.roll).toBeCloseTo(roll, 8);
    }
  });
});

describe('edgeAngleDeg — phone on its long edge', () => {
  it('reads 0 on a level shelf (right edge down, gimbal-adjacent)', () => {
    const { pitch, roll } = pr(-G, 0, 0);
    expect(edgeAngleDeg(pitch, roll)).toBeCloseTo(0, 6);
  });

  for (const theta of [-10, -1, 1, 10]) {
    it(`reads ${theta}° when the long axis tips ${theta}° (top edge ${theta > 0 ? 'up' : 'down'})`, () => {
      const a = [-G * Math.cos(theta * RAD), G * Math.sin(theta * RAD), 0] as const;
      const { pitch, roll } = pr(a[0], a[1], a[2]);
      expect(edgeAngleDeg(pitch, roll)).toBeCloseTo(theta, 6);
    });
  }

  it('works on the other long edge too (left edge down)', () => {
    const theta = 2;
    const a = [G * Math.cos(theta * RAD), G * Math.sin(theta * RAD), 0] as const;
    const { pitch, roll } = pr(a[0], a[1], a[2]);
    expect(edgeAngleDeg(pitch, roll)).toBeCloseTo(theta, 6);
  });
});

describe('plumbAngleDeg — phone flat against a vertical surface', () => {
  it('reads 0 against a plumb wall, portrait', () => {
    const { pitch, roll } = pr(0, G, 0);
    expect(plumbAngleDeg(pitch, roll)).toBeCloseTo(0, 6);
  });

  it('portrait: a wall leaning back by θ reads −θ (sign pinned)', () => {
    const theta = 5;
    const a = [0, G * Math.cos(theta * RAD), -G * Math.sin(theta * RAD)] as const;
    const { pitch, roll } = pr(a[0], a[1], a[2]);
    expect(plumbAngleDeg(pitch, roll)).toBeCloseTo(-theta, 6);
  });

  it('landscape grip against the same wall reads the same number', () => {
    const theta = 5;
    const a = [-G * Math.cos(theta * RAD), 0, -G * Math.sin(theta * RAD)] as const;
    const { pitch, roll } = pr(a[0], a[1], a[2]);
    expect(plumbAngleDeg(pitch, roll)).toBeCloseTo(-theta, 5);
  });

  it('overhang (wall face tips upward) reads positive', () => {
    const theta = 3;
    const a = [0, G * Math.cos(theta * RAD), G * Math.sin(theta * RAD)] as const;
    const { pitch, roll } = pr(a[0], a[1], a[2]);
    expect(plumbAngleDeg(pitch, roll)).toBeCloseTo(theta, 6);
  });
});

describe('surfaceTiltDeg — flat mode total tilt', () => {
  it('0 face-up, and equals the resultant of small pitch+roll', () => {
    expect(surfaceTiltDeg(0, 0)).toBeCloseTo(0, 9);
    const t = surfaceTiltDeg(1 * RAD, 1 * RAD);
    expect(t).toBeGreaterThan(1.4);
    expect(t).toBeLessThan(1.45);
  });

  it('matches |pitch| when roll is 0', () => {
    expect(surfaceTiltDeg(1.2 * RAD, 0)).toBeCloseTo(1.2, 6);
  });

  it('is never negative', () => {
    expect(surfaceTiltDeg(-2 * RAD, 0.5 * RAD)).toBeGreaterThan(0);
  });
});

describe('screenTiltDeg — overlay rotation about the view axis', () => {
  it('0 in upright portrait', () => {
    const { pitch, roll } = pr(0, G, 0);
    expect(screenTiltDeg(pitch, roll)).toBeCloseTo(0, 6);
  });

  it('device rotated clockwise by φ (top edge toward −x) reads −φ', () => {
    const phi = 10;
    const a = [-G * Math.sin(phi * RAD), G * Math.cos(phi * RAD), 0] as const;
    const { pitch, roll } = pr(a[0], a[1], a[2]);
    expect(screenTiltDeg(pitch, roll)).toBeCloseTo(-phi, 6);
  });

  it('device rotated counter-clockwise reads +φ', () => {
    const phi = 7;
    const a = [G * Math.sin(phi * RAD), G * Math.cos(phi * RAD), 0] as const;
    const { pitch, roll } = pr(a[0], a[1], a[2]);
    expect(screenTiltDeg(pitch, roll)).toBeCloseTo(phi, 6);
  });

  it('reports 0 (not NaN) when the screen is exactly horizontal', () => {
    expect(screenTiltDeg(0, 0)).toBe(0);
  });
});

describe('primaryAngleDeg / kindForMode', () => {
  it('routes each mode to its angle', () => {
    const { pitch, roll } = pr(0, G * Math.sin(2 * RAD), G * Math.cos(2 * RAD));
    expect(primaryAngleDeg('surface', pitch, roll)).toBeCloseTo(2, 5);
    for (const m of LEVEL_MODES) {
      expect(Number.isFinite(primaryAngleDeg(m, pitch, roll))).toBe(true);
    }
  });

  it('plumb saves as kind plumb; everything else as level', () => {
    expect(kindForMode('plumb')).toBe('plumb');
    expect(kindForMode('surface')).toBe('level');
    expect(kindForMode('edge')).toBe('level');
    expect(kindForMode('overlay')).toBe('level');
  });
});

describe('bubbleXY — the bubble rises to the high side', () => {
  it('pitch > 0 (right edge down) puts the dot left; roll > 0 puts it up', () => {
    const p = bubbleXY(1, 0, 3, 90);
    expect(p.x).toBeLessThan(0);
    expect(p.y).toBeCloseTo(0, 12);
    const r = bubbleXY(0, 1, 3, 90);
    expect(r.y).toBeLessThan(0);
    expect(r.x).toBeCloseTo(0, 12);
  });

  it('clamps at the rim', () => {
    const p = bubbleXY(30, -30, 3, 90);
    expect(p.x).toBe(-90);
    expect(p.y).toBe(90);
  });

  it('is proportional inside full scale', () => {
    const p = bubbleXY(1.5, 0, 3, 90);
    expect(p.x).toBeCloseTo(-45, 9);
  });
});
