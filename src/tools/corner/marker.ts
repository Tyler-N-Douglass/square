/**
 * Marking canvas with magnifier loupe — SPEC §4.3.1.2. The loupe is
 * essential, not optional: the fingertip covers the corner, so a zoomed
 * circle offset above the finger shows the pixels under it. Tap places the
 * next point in the enforced order; dragging any placed point refines it.
 * Optional snap-assist (off by default): on release, the mark snaps to the
 * local gradient maximum within ±6 px, and only when there is a clear edge.
 *
 * Shared between CORNER and CALIBRATE's lens routine (same component, same
 * loupe — charter requirement). DOM-light and guarded so it mounts in test
 * environments without a 2D canvas.
 */
import { MarkingSession, MARK_STEPS, type MarkStep } from './state';
import { loupeSourceRect } from './math';
import { lumaFromRgba, snapToGradientMax, SNAP_RADIUS_PX } from './snap';

export const LOUPE_SIZE_CSS = 132;
export const LOUPE_ZOOM = 3;
const GRAB_RADIUS_CSS = 28;

export interface MarkerDeps {
  /** The working-resolution canvas holding the photo. */
  photo: HTMLCanvasElement;
  steps?: readonly [MarkStep, MarkStep, MarkStep, MarkStep];
  snapDefault?: boolean;
  /** Called after every change; check session.complete for the quad. */
  onChange(session: MarkingSession): void;
  /** Fired when the point COUNT increases (mark-1 … mark-4 guide moments). */
  onPlaced?(count: number): void;
  announce?(text: string): void;
}

export interface MarkerView {
  el: HTMLElement;
  session: MarkingSession;
  /** Working px per CSS px right now (marking-noise bookkeeping). */
  cssToWorkingScale(): number;
  snapEnabled(): boolean;
  dispose(): void;
}

export function markerView(deps: MarkerDeps): MarkerView {
  const steps = deps.steps ?? MARK_STEPS;
  const session = new MarkingSession(deps.photo.width, deps.photo.height);
  let snap = deps.snapDefault === true;

  const el = document.createElement('div');
  el.className = 'marker';

  const stage = document.createElement('div');
  stage.className = 'marker__stage';
  stage.style.position = 'relative';
  stage.style.touchAction = 'none';

  deps.photo.className = 'marker__photo';
  deps.photo.style.width = '100%';
  deps.photo.style.display = 'block';

  const overlay = document.createElement('canvas');
  overlay.className = 'marker__overlay';
  overlay.width = deps.photo.width;
  overlay.height = deps.photo.height;
  overlay.style.position = 'absolute';
  overlay.style.inset = '0';
  overlay.style.width = '100%';
  overlay.style.height = '100%';
  overlay.style.pointerEvents = 'none';

  const loupe = document.createElement('canvas');
  loupe.className = 'marker__loupe';
  loupe.width = LOUPE_SIZE_CSS * 2; // 2× backing for crispness
  loupe.height = LOUPE_SIZE_CSS * 2;
  loupe.style.position = 'absolute';
  loupe.style.width = `${LOUPE_SIZE_CSS}px`;
  loupe.style.height = `${LOUPE_SIZE_CSS}px`;
  loupe.style.pointerEvents = 'none';
  loupe.style.display = 'none';

  stage.append(deps.photo, overlay, loupe);

  const prompt = document.createElement('p');
  prompt.className = 'marker__prompt';
  prompt.setAttribute('aria-live', 'polite');

  const controls = document.createElement('div');
  controls.className = 'marker__controls';

  const undoBtn = document.createElement('button');
  undoBtn.type = 'button';
  undoBtn.className = 'btn btn--ghost marker__undo';
  undoBtn.textContent = 'UNDO POINT';
  undoBtn.setAttribute('aria-label', 'Undo the last placed point');

  const snapBtn = document.createElement('button');
  snapBtn.type = 'button';
  snapBtn.className = 'btn btn--ghost marker__snap';
  snapBtn.textContent = 'SNAP ASSIST';
  snapBtn.title = 'Snap marks to the strongest edge within 6 px. Off by default.';
  const syncSnap = (): void => snapBtn.setAttribute('aria-pressed', snap ? 'true' : 'false');
  syncSnap();

  controls.append(undoBtn, snapBtn);
  el.append(stage, prompt, controls);

  const cssToWorkingScale = (): number => {
    const rect = deps.photo.getBoundingClientRect();
    if (!(rect.width > 0)) return 1;
    return deps.photo.width / rect.width;
  };

  const syncPrompt = (): void => {
    const next = session.nextStep;
    prompt.textContent = next
      ? `${next.label} — ${next.prompt}`
      : 'All four points down. Drag any point to refine it with the loupe.';
  };
  syncPrompt();

  const drawOverlay = (): void => {
    const ctx = overlay.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    const pts = session.points;
    const s = Math.max(2, Math.round(overlay.width / 480));
    if (pts.length >= 2) {
      ctx.strokeStyle = '#F15A22';
      ctx.lineWidth = s;
      ctx.beginPath();
      // Draw the quad path as far as it exists: P0→P1, P1→P2, P2→P3, P3→P0.
      ctx.moveTo(pts[0]!.x, pts[0]!.y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
      if (pts.length === 4) ctx.closePath();
      ctx.stroke();
    }
    pts.forEach((p, i) => {
      ctx.beginPath();
      ctx.fillStyle = i === 0 ? '#F15A22' : '#FFFFFF';
      ctx.strokeStyle = '#1A1A1A';
      ctx.lineWidth = Math.max(1, s / 2);
      ctx.arc(p.x, p.y, 4 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#1A1A1A';
      ctx.font = `${8 * s}px sans-serif`;
      ctx.fillText(steps[i as 0 | 1 | 2 | 3].label, p.x + 6 * s, p.y - 6 * s);
    });
  };

  const drawLoupe = (wx: number, wy: number, cssX: number, cssY: number): void => {
    const ctx = loupe.getContext('2d');
    if (!ctx) {
      loupe.style.display = 'none';
      return;
    }
    const scale = cssToWorkingScale();
    const srcSize = LOUPE_SIZE_CSS * scale; // loupe covers LOUPE_SIZE css px at zoom 1
    const r = loupeSourceRect(wx, wy, deps.photo.width, deps.photo.height, srcSize, LOUPE_ZOOM);
    const size = loupe.width;
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(deps.photo, r.sx, r.sy, r.sw, r.sh, 0, 0, size, size);
    ctx.restore();
    // Crosshair at the mark, hard lines, then the rim.
    ctx.strokeStyle = '#F15A22';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(size / 2, size / 2 - 18);
    ctx.lineTo(size / 2, size / 2 + 18);
    ctx.moveTo(size / 2 - 18, size / 2);
    ctx.lineTo(size / 2 + 18, size / 2);
    ctx.stroke();
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
    ctx.stroke();

    loupe.style.display = 'block';
    loupe.style.left = `${cssX - LOUPE_SIZE_CSS / 2}px`;
    // Offset ABOVE the finger (SPEC §4.3.1.2); clamp into the stage.
    const top = cssY - LOUPE_SIZE_CSS - 48;
    loupe.style.top = `${Math.max(0, top)}px`;
  };

  const hideLoupe = (): void => {
    loupe.style.display = 'none';
  };

  const toWorking = (ev: PointerEvent): { x: number; y: number; cssX: number; cssY: number } => {
    const rect = stage.getBoundingClientRect();
    const cssX = ev.clientX - rect.left;
    const cssY = ev.clientY - rect.top;
    const scale = cssToWorkingScale();
    return { x: cssX * scale, y: cssY * scale, cssX, cssY };
  };

  let dragIndex: number | null = null;

  const applySnap = (index: number): void => {
    if (!snap) return;
    const p = session.points[index];
    if (!p) return;
    const ctx = deps.photo.getContext('2d');
    if (!ctx) return;
    const pad = SNAP_RADIUS_PX + 2;
    const x0 = Math.max(0, Math.round(p.x) - pad);
    const y0 = Math.max(0, Math.round(p.y) - pad);
    const w = Math.min(deps.photo.width - x0, pad * 2 + 1);
    const h = Math.min(deps.photo.height - y0, pad * 2 + 1);
    if (w < 3 || h < 3) return;
    let img: ImageData;
    try {
      img = ctx.getImageData(x0, y0, w, h);
    } catch {
      return;
    }
    const patch = lumaFromRgba(img.width, img.height, img.data);
    const hitPt = snapToGradientMax(patch, p.x - x0, p.y - y0, SNAP_RADIUS_PX);
    if (hitPt) session.setPoint(index, x0 + hitPt.x, y0 + hitPt.y);
  };

  const changed = (): void => {
    drawOverlay();
    syncPrompt();
    deps.onChange(session);
  };

  const onDown = (ev: PointerEvent): void => {
    const { x, y, cssX, cssY } = toWorking(ev);
    const grab = GRAB_RADIUS_CSS * cssToWorkingScale();
    const hitIdx = session.hit(x, y, grab);
    if (hitIdx !== null) {
      dragIndex = hitIdx;
    } else {
      const placed = session.place(x, y);
      if (placed === null) return;
      dragIndex = placed;
      const step = steps[placed as 0 | 1 | 2 | 3];
      deps.announce?.(`${step.label} placed`);
      deps.onPlaced?.(session.count);
    }
    try {
      stage.setPointerCapture(ev.pointerId);
    } catch {
      /* not supported in tests */
    }
    drawLoupe(x, y, cssX, cssY);
    changed();
  };

  const onMove = (ev: PointerEvent): void => {
    if (dragIndex === null) return;
    const { x, y, cssX, cssY } = toWorking(ev);
    session.moveTo(dragIndex, x, y);
    drawLoupe(x, y, cssX, cssY);
    drawOverlay();
  };

  const onUp = (): void => {
    if (dragIndex === null) return;
    applySnap(dragIndex);
    dragIndex = null;
    hideLoupe();
    changed();
  };

  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerup', onUp);
  stage.addEventListener('pointercancel', onUp);

  undoBtn.addEventListener('click', () => {
    if (session.undo()) {
      deps.announce?.('Point removed');
      changed();
    }
  });
  snapBtn.addEventListener('click', () => {
    snap = !snap;
    syncSnap();
    deps.announce?.(snap ? 'Snap assist on' : 'Snap assist off');
  });

  return {
    el,
    session,
    cssToWorkingScale,
    snapEnabled: () => snap,
    dispose: () => {
      stage.removeEventListener('pointerdown', onDown);
      stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerup', onUp);
      stage.removeEventListener('pointercancel', onUp);
    },
  };
}
