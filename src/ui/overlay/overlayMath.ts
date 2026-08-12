/**
 * Camera-overlay geometry — pure, canvas-free, unit-tested
 * (tests/unit/level-tool-overlay-math.test.ts). A5 territory (src/ui/overlay).
 *
 * Canvas frame: x right, y DOWN (standard 2D canvas). Device frame: x right,
 * y UP. The screen tilt δ (levelModes.screenTiltDeg — rotation of the device
 * about the view axis, positive = top edge toward device +x) maps onto canvas
 * angles exactly:
 *
 *   true-horizontal line: canvas angle  +δ   (radians, atan2(dy, dx))
 *   true-vertical line:   canvas angle  +δ + 90°
 *   device-frame horizontal reference:  canvas angle 0
 *
 * Derivation: gravity-DOWN in device coords is (−ux, −uy); flipping y for
 * canvas gives (−ux, +uy), so the true-vertical direction has canvas angle
 * atan2(uy, −ux) = δ + 90°, and the horizontal is δ. The discrepancy wedge
 * between the device frame and true horizontal therefore spans canvas angles
 * 0 → δ, and its magnitude IS the measured screen tilt — one number, drawn
 * and labeled, never two disagreeing ones.
 */

export interface Pt { x: number; y: number }

/** Endpoints of a segment of length `len` centered on `p` at canvas angle
 *  `angleRad` (atan2 convention: 0 = +x, positive toward +y/down). */
export function linePoints(p: Pt, angleRad: number, len: number): [Pt, Pt] {
  const dx = Math.cos(angleRad) * (len / 2);
  const dy = Math.sin(angleRad) * (len / 2);
  return [
    { x: p.x - dx, y: p.y - dy },
    { x: p.x + dx, y: p.y + dy },
  ];
}

/** Canvas angle of the true-horizontal line for screen tilt δ (degrees in,
 *  radians out). Identity by construction — kept as a named function so the
 *  overlay renderer and the tests share one definition of the mapping. */
export function trueHorizontalCanvasRad(screenTiltDeg: number): number {
  return (screenTiltDeg * Math.PI) / 180;
}

/** Canvas angle of the true-vertical line for screen tilt δ (degrees in). */
export function trueVerticalCanvasRad(screenTiltDeg: number): number {
  return trueHorizontalCanvasRad(screenTiltDeg) + Math.PI / 2;
}

/** The discrepancy wedge between the device-frame horizontal (canvas angle 0)
 *  and the true horizontal, as a canvas arc [start, end], start ≤ end. */
export function wedgeArc(screenTiltDeg: number): { start: number; end: number; deg: number } {
  const a = trueHorizontalCanvasRad(screenTiltDeg);
  return { start: Math.min(0, a), end: Math.max(0, a), deg: screenTiltDeg };
}

/** Wedge angle shown to the user — the screen tilt, degrees. Named for the
 *  tests: the labeled wedge and the measured roll can never disagree. */
export function wedgeAngleDeg(screenTiltDeg: number): number {
  return screenTiltDeg;
}

/** Out-of-tolerance predicate for the ghost bob (SPEC §7.5.2, ADR-010). */
export function outOfTolerance(angleDeg: number, tolDeg: number): boolean {
  return Number.isFinite(angleDeg) && Math.abs(angleDeg) > tolDeg;
}

/** Keep the tap point at least `margin` px inside a w×h canvas. */
export function clampTap(p: Pt, w: number, h: number, margin: number): Pt {
  const cl = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
  return { x: cl(p.x, margin, Math.max(margin, w - margin)), y: cl(p.y, margin, Math.max(margin, h - margin)) };
}

/* ------------------------------------------------------------------------ *
 * Frame drawing — takes a minimal 2D-context interface so the render list
 * is testable without a real canvas (happy-dom has none). The real
 * CanvasRenderingContext2D satisfies Ctx2D structurally.
 * ------------------------------------------------------------------------ */

export interface Ctx2D {
  strokeStyle: string | CanvasGradient | CanvasPattern;
  fillStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  globalAlpha: number;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, r: number, a0: number, a1: number, ccw?: boolean): void;
  closePath(): void;
  stroke(): void;
  fill(): void;
  setLineDash(d: number[]): void;
  clearRect(x: number, y: number, w: number, h: number): void;
}

export interface OverlayFrameOpts {
  w: number;
  h: number;
  tap: Pt;
  /** Screen tilt, degrees (levelModes.screenTiltDeg, bias/zero corrected). */
  tiltDeg: number;
  /** Palette — passed in so this module stays token-free. */
  colors: { trueLine: string; deviceLine: string; wedge: string };
  lineWidth?: number;
  wedgeRadius?: number;
  /** false = draw over existing pixels (burning onto a still frame). */
  clear?: boolean;
}

/**
 * Draw one overlay frame: true-horizontal + true-vertical through the tap
 * point (solid, colors.trueLine — the gravity reference), the device-frame
 * horizontal (dashed, colors.deviceLine), and the discrepancy wedge between
 * them (flat fill at reduced alpha, colors.wedge — it visualizes the live
 * measured discrepancy). Flat, hard-edged, no gradients (SPEC §7).
 */
export function drawOverlayFrame(ctx: Ctx2D, o: OverlayFrameOpts): void {
  const len = 2 * Math.hypot(o.w, o.h);
  const lw = o.lineWidth ?? 3;
  const wr = o.wedgeRadius ?? Math.min(o.w, o.h) * 0.28;

  if (o.clear !== false) ctx.clearRect(0, 0, o.w, o.h);

  // Device-frame horizontal reference — dashed gray, canvas angle 0.
  ctx.setLineDash([8, 8]);
  ctx.strokeStyle = o.colors.deviceLine;
  ctx.lineWidth = lw;
  ctx.globalAlpha = 1;
  const [d0, d1] = linePoints(o.tap, 0, len);
  ctx.beginPath();
  ctx.moveTo(d0.x, d0.y);
  ctx.lineTo(d1.x, d1.y);
  ctx.stroke();
  ctx.setLineDash([]);

  // The wedge — between device horizontal and true horizontal.
  const arc = wedgeArc(o.tiltDeg);
  if (arc.end - arc.start > 1e-6) {
    ctx.fillStyle = o.colors.wedge;
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    ctx.moveTo(o.tap.x, o.tap.y);
    ctx.arc(o.tap.x, o.tap.y, wr, arc.start, arc.end);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // True horizontal + true vertical — solid, the gravity reference.
  ctx.strokeStyle = o.colors.trueLine;
  ctx.lineWidth = lw;
  for (const ang of [trueHorizontalCanvasRad(o.tiltDeg), trueVerticalCanvasRad(o.tiltDeg)]) {
    const [a, b] = linePoints(o.tap, ang, len);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
}
