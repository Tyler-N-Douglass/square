/**
 * Overlay geometry (src/ui/overlay/overlayMath.ts): the screen-tilt →
 * canvas-angle mapping, the wedge, tap clamping, and the frame render list
 * on a recording context (no real canvas needed).
 */
import { describe, expect, it } from 'vitest';
import { pitchRollFromGravity } from '../../src/geometry/levelMath';
import { screenTiltDeg } from '../../src/tools/level/levelModes';
import {
  clampTap,
  drawOverlayFrame,
  linePoints,
  outOfTolerance,
  trueHorizontalCanvasRad,
  trueVerticalCanvasRad,
  wedgeAngleDeg,
  wedgeArc,
  type Ctx2D,
} from '../../src/ui/overlay/overlayMath';

const G = 9.80665;
const RAD = Math.PI / 180;

describe('linePoints', () => {
  it('horizontal line at angle 0: endpoints level with the tap point', () => {
    const [a, b] = linePoints({ x: 50, y: 40 }, 0, 100);
    expect(a).toEqual({ x: 0, y: 40 });
    expect(b).toEqual({ x: 100, y: 40 });
  });

  it('midpoint is always the tap point', () => {
    const [a, b] = linePoints({ x: 10, y: 20 }, 0.7, 300);
    expect((a.x + b.x) / 2).toBeCloseTo(10, 9);
    expect((a.y + b.y) / 2).toBeCloseTo(20, 9);
  });
});

describe('canvas mapping — the drawn line and the labeled angle cannot disagree', () => {
  it('true-horizontal canvas angle equals the screen tilt', () => {
    // device rotated CCW by 7°: screenTilt = +7°
    const phi = 7;
    const { pitch, roll } = pitchRollFromGravity(G * Math.sin(phi * RAD), G * Math.cos(phi * RAD), 0);
    const tilt = screenTiltDeg(pitch, roll);
    expect(tilt).toBeCloseTo(phi, 6);
    expect(trueHorizontalCanvasRad(tilt)).toBeCloseTo(phi * RAD, 9);
    expect(trueVerticalCanvasRad(tilt)).toBeCloseTo(phi * RAD + Math.PI / 2, 9);
  });

  it('wedge spans device horizontal (0) to the true horizontal, ordered', () => {
    const up = wedgeArc(5);
    expect(up.start).toBe(0);
    expect(up.end).toBeCloseTo(5 * RAD, 9);
    const down = wedgeArc(-5);
    expect(down.start).toBeCloseTo(-5 * RAD, 9);
    expect(down.end).toBe(0);
  });

  it('the labeled wedge angle IS the measured tilt', () => {
    expect(wedgeAngleDeg(3.4)).toBe(3.4);
    expect(wedgeAngleDeg(-1.1)).toBe(-1.1);
  });
});

describe('outOfTolerance / clampTap', () => {
  it('tolerance gate for the ghost bob', () => {
    expect(outOfTolerance(0.1, 0.2)).toBe(false);
    expect(outOfTolerance(0.3, 0.2)).toBe(true);
    expect(outOfTolerance(-0.3, 0.2)).toBe(true);
    expect(outOfTolerance(NaN, 0.2)).toBe(false);
  });

  it('tap stays inside the frame', () => {
    expect(clampTap({ x: -5, y: 900 }, 320, 240, 12)).toEqual({ x: 12, y: 228 });
    expect(clampTap({ x: 160, y: 120 }, 320, 240, 12)).toEqual({ x: 160, y: 120 });
  });
});

/* ---- render list on a recorder ---- */

interface Call { op: string; args: unknown[] }

function recorder(): { ctx: Ctx2D; calls: Call[] } {
  const calls: Call[] = [];
  const rec = (op: string) => (...args: unknown[]) => void calls.push({ op, args });
  const ctx: Ctx2D = {
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 0,
    globalAlpha: 1,
    beginPath: rec('beginPath'),
    moveTo: rec('moveTo'),
    lineTo: rec('lineTo'),
    arc: rec('arc'),
    closePath: rec('closePath'),
    stroke: rec('stroke'),
    fill: rec('fill'),
    setLineDash: rec('setLineDash'),
    clearRect: rec('clearRect'),
  };
  return { ctx, calls };
}

const colors = { trueLine: '#007A3D', deviceLine: '#939598', wedge: '#F15A22' };

describe('drawOverlayFrame', () => {
  it('level (tilt 0): three strokes (device + two true lines), no wedge fill', () => {
    const { ctx, calls } = recorder();
    drawOverlayFrame(ctx, { w: 320, h: 240, tap: { x: 160, y: 120 }, tiltDeg: 0, colors });
    expect(calls.filter((c) => c.op === 'stroke').length).toBe(3);
    expect(calls.filter((c) => c.op === 'fill').length).toBe(0);
    expect(calls.filter((c) => c.op === 'clearRect').length).toBe(1);
  });

  it('out of level: the wedge is filled once, at the tap point', () => {
    const { ctx, calls } = recorder();
    drawOverlayFrame(ctx, { w: 320, h: 240, tap: { x: 100, y: 80 }, tiltDeg: 4, colors });
    expect(calls.filter((c) => c.op === 'fill').length).toBe(1);
    const arc = calls.find((c) => c.op === 'arc');
    expect(arc).toBeTruthy();
    expect(arc!.args[0]).toBe(100);
    expect(arc!.args[1]).toBe(80);
    expect(arc!.args[3]).toBe(0); // from device horizontal…
    expect(arc!.args[4] as number).toBeCloseTo(4 * RAD, 9); // …to true horizontal
  });

  it('clear:false leaves the still frame under the burn', () => {
    const { ctx, calls } = recorder();
    drawOverlayFrame(ctx, { w: 320, h: 240, tap: { x: 1, y: 1 }, tiltDeg: 1, colors, clear: false });
    expect(calls.filter((c) => c.op === 'clearRect').length).toBe(0);
  });
});
