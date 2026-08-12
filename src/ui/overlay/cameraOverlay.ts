/**
 * Camera overlay — LEVEL's OVERLAY mode (SPEC §4.2.3), A5 territory.
 *
 * Live rear camera with a true-horizontal and true-vertical line through a
 * tap point, rotated by the measured screen tilt; the discrepancy wedge
 * between the device frame and the true line, angle labeled through
 * measuredEl; the ghost bob behind the readout when out of tolerance
 * (ADR-010: currentColor, never orange). FREEZE burns the overlay into a
 * still frame and hands the capture back for LOG.
 *
 * Permission choreography (SPEC §6.2): the camera is requested ONLY from the
 * START CAMERA gesture inside this mode, behind an inline one-line reason.
 * Denial shows the platform recovery path and the rest of LEVEL keeps
 * working — the mode is degraded, never a dead end.
 */
import type { Measurement } from '../../types';
import { measuredEl, type MeasuredNumberEl } from '../components/number';
import { ghostBob } from '../components/mark';
import { recoveryInstructions } from '../../sensors/permissions';
import {
  clampTap,
  drawOverlayFrame,
  outOfTolerance,
  type Ctx2D,
  type Pt,
} from './overlayMath';

export interface OverlayReadingSnapshot {
  /** Bias/zero-corrected screen tilt, degrees. */
  tiltDeg: number;
  stable: boolean;
  /** Display Measurement built by the tool's render rules (motion gate
   *  already applied: basis 'unknown' while moving). */
  measurement: Measurement;
}

export interface CameraOverlayDeps {
  platform: 'ios' | 'android' | 'desktop' | 'unknown';
  lockTolDeg: number;
  getReading(): OverlayReadingSnapshot | null;
  /** Claim discipline for the burned label (H-06): the ± the app is entitled
   *  to claim (degrees) and whether the reversal calibration backs it. A
   *  saved photo outlives the session — it must carry both (SPEC §15.1). */
  getClaim(): { plusMinusDeg: number; calibrated: boolean };
  onFreeze(capture: { angleDeg: number; stable: boolean; blob: Blob | null; dataUrl: string | null }): void;
  announce?(text: string): void;
}

export interface CameraOverlayEl {
  el: HTMLElement;
  /** Entering the mode: shows the inline reason (or resumes a live stream). */
  open(): void;
  /** Leaving the mode / unmount: stops tracks and the draw loop. */
  close(): void;
  readonly live: boolean;
}

function cssVar(name: string, fallback: string): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch {
    return fallback;
  }
}

const BURN_MAX_W = 1280;

export function cameraOverlay(deps: CameraOverlayDeps): CameraOverlayEl {
  const root = document.createElement('div');
  root.className = 'ovl';

  /* ---- inline reason + gesture (SPEC §6.2) ---- */
  const reason = document.createElement('div');
  reason.className = 'ovl__reason';
  const reasonLine = document.createElement('p');
  reasonLine.className = 'ovl__reasonline';
  reasonLine.textContent =
    'The camera shows the object while the level line is drawn over it. The picture stays on the phone.';
  const startBtn = document.createElement('button');
  startBtn.type = 'button';
  startBtn.className = 'btn ovl__start';
  startBtn.textContent = 'START CAMERA';
  reason.append(reasonLine, startBtn);

  /* ---- recovery (denial is a state, not a dead end — SPEC §6.4) ---- */
  const recovery = document.createElement('div');
  recovery.className = 'ovl__recovery';
  recovery.hidden = true;

  /* ---- live view ---- */
  const liveWrap = document.createElement('div');
  liveWrap.className = 'ovl__livewrap';
  liveWrap.hidden = true;

  const video = document.createElement('video');
  video.className = 'ovl__video';
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('aria-label', 'Rear camera preview');

  const canvas = document.createElement('canvas');
  canvas.className = 'ovl__canvas';

  const frozenImg = document.createElement('img');
  frozenImg.className = 'ovl__frozen';
  frozenImg.alt = 'Frozen frame with the level overlay burned in';
  frozenImg.hidden = true;

  // Readout block: ghost bob behind the live wedge angle (SPEC §7.5.2).
  const labelWrap = document.createElement('div');
  labelWrap.className = 'ovl__label';
  const ghost = ghostBob();
  ghost.classList.add('ovl__ghost');
  ghost.hidden = true;
  let label: MeasuredNumberEl | null = null;

  const hint = document.createElement('p');
  hint.className = 'ovl__hint';
  hint.textContent = 'Tap the picture to move the level lines onto the object.';

  const freezeBtn = document.createElement('button');
  freezeBtn.type = 'button';
  freezeBtn.className = 'btn ovl__freeze';
  freezeBtn.textContent = 'FREEZE';

  const resumeBtn = document.createElement('button');
  resumeBtn.type = 'button';
  resumeBtn.className = 'btn btn--ghost ovl__resume';
  resumeBtn.textContent = 'RESUME';
  resumeBtn.hidden = true;

  labelWrap.append(ghost);
  liveWrap.append(video, frozenImg, canvas, labelWrap, hint, freezeBtn, resumeBtn);
  root.append(reason, recovery, liveWrap);

  /* ---- state ---- */
  let stream: MediaStream | null = null;
  let raf = 0;
  let opened = false;
  let frozen = false;
  let tap: Pt | null = null;
  let lastTiltDeg = 0;
  let lastStable = false;

  const colors = {
    trueLine: cssVar('--green', '#007A3D'),
    deviceLine: cssVar('--gray-mid', '#939598'),
    wedge: cssVar('--orange', '#F15A22'),
  };

  canvas.addEventListener('pointerdown', (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    tap = clampTap({ x: e.clientX - r.left, y: e.clientY - r.top }, r.width, r.height, 12);
  });

  function showRecovery(message: string): void {
    recovery.replaceChildren();
    const msg = document.createElement('p');
    msg.className = 'ovl__recoverymsg';
    msg.textContent = message;
    const how = document.createElement('p');
    how.className = 'ovl__recoveryhow';
    how.textContent = recoveryInstructions('camera', deps.platform);
    const still = document.createElement('p');
    still.className = 'ovl__recoverystill';
    still.textContent = 'SURFACE, EDGE, and PLUMB keep working without the camera.';
    recovery.append(msg, how, still);
    recovery.hidden = false;
    reason.hidden = true;
    deps.announce?.(message);
  }

  function frame(): void {
    raf = 0;
    if (!opened || frozen) return;
    const w = liveWrap.clientWidth || 320;
    const h = Math.max(200, Math.round(w * 0.75));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const reading = deps.getReading();
    if (reading) {
      lastTiltDeg = reading.tiltDeg;
      lastStable = reading.stable;
      label?.update(reading.measurement);
      root.classList.toggle('ovl--moving', !reading.stable);
      ghost.hidden = !outOfTolerance(reading.tiltDeg, deps.lockTolDeg);
    }
    const ctx = canvas.getContext('2d') as (Ctx2D & CanvasRenderingContext2D) | null;
    if (ctx) {
      drawOverlayFrame(ctx, {
        w,
        h,
        tap: tap ?? { x: w / 2, y: h / 2 },
        tiltDeg: lastTiltDeg,
        colors,
      });
    }
    raf = requestAnimationFrame(frame);
  }

  async function startCamera(): Promise<void> {
    const gum = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
    if (!gum) {
      showRecovery('This browser does not offer a camera here.');
      return;
    }
    try {
      stream = await gum({ video: { facingMode: { ideal: 'environment' } } });
    } catch (err) {
      const name = err instanceof Error ? err.name : 'Error';
      showRecovery(
        name === 'NotAllowedError'
          ? 'Camera permission was denied.'
          : `The camera did not start (${name}).`,
      );
      return;
    }
    reason.hidden = true;
    recovery.hidden = true;
    liveWrap.hidden = false;
    try {
      video.srcObject = stream;
      await video.play();
    } catch {
      /* autoplay refusal or a platform srcObject quirk — the overlay lines
         still draw; the preview joins on the next gesture where possible */
    }
    if (!label) {
      const first = deps.getReading();
      if (first) {
        label = measuredEl(first.measurement, { decimals: 1 });
        label.classList.add('ovl__labelnum');
        labelWrap.append(label);
      }
    }
    deps.announce?.('Camera on. Tap the picture to place the level lines.');
    if (!raf) raf = requestAnimationFrame(frame);
  }

  function burnAndFreeze(): void {
    frozen = true;
    freezeBtn.hidden = true;
    resumeBtn.hidden = false;

    let blob: Blob | null = null;
    let dataUrl: string | null = null;
    const finish = (): void =>
      deps.onFreeze({ angleDeg: lastTiltDeg, stable: lastStable, blob, dataUrl });

    try {
      const vw = video.videoWidth || canvas.width;
      const vh = video.videoHeight || canvas.height;
      if (!vw || !vh) { finish(); return; }
      const scale = Math.min(1, BURN_MAX_W / vw);
      const bw = Math.round(vw * scale);
      const bh = Math.round(vh * scale);
      const burn = document.createElement('canvas');
      burn.width = bw;
      burn.height = bh;
      const bctx = burn.getContext('2d');
      if (!bctx) { finish(); return; }
      bctx.drawImage(video, 0, 0, bw, bh);
      const displayW = canvas.width || bw;
      const k = bw / displayW;
      const t = tap ?? { x: (canvas.width || bw) / 2, y: (canvas.height || bh) / 2 };
      drawOverlayFrame(bctx as unknown as Ctx2D, {
        w: bw,
        h: bh,
        tap: { x: t.x * k, y: t.y * k },
        tiltDeg: lastTiltDeg,
        colors,
        lineWidth: Math.max(2, Math.round(3 * k)),
        clear: false,
      });
      // Label card — CORNER's annotate pattern (src/tools/corner/annotate.ts):
      // flat ink card, off-white monospace type, never orange. A frozen frame
      // is not a live sensor value (H-06), and the burn carries the ± and the
      // calibration state because the photo outlives the session.
      const claim = deps.getClaim();
      const labelLines = [
        `${lastTiltDeg.toFixed(1)}° ±${claim.plusMinusDeg}°`,
        claim.calibrated ? 'reversal-calibrated' : 'uncalibrated',
      ];
      const s = Math.max(2, Math.round(bw / 480));
      const fontPx = 10 * s;
      bctx.font = `${fontPx}px monospace`;
      const pad = 4 * s;
      const widest = labelLines.reduce((m, l) => Math.max(m, bctx.measureText(l).width), 0);
      bctx.fillStyle = '#1A1A1A';
      bctx.fillRect(0, 0, widest + pad * 2, labelLines.length * (fontPx + pad / 2) + pad * 1.5);
      bctx.fillStyle = '#F1F2F2';
      labelLines.forEach((line, i) => {
        bctx.fillText(line, pad, pad + fontPx * (i + 1) + (pad / 2) * i);
      });
      try {
        dataUrl = burn.toDataURL('image/jpeg', 0.8);
        frozenImg.src = dataUrl;
        frozenImg.hidden = false;
        video.classList.add('ovl__video--hidden');
      } catch {
        dataUrl = null;
      }
      if (typeof burn.toBlob === 'function') {
        burn.toBlob((b) => { blob = b; finish(); }, 'image/jpeg', 0.8);
        return;
      }
    } catch {
      /* burn failed — the measurement still saves, without media */
    }
    finish();
  }

  function resume(): void {
    frozen = false;
    frozenImg.hidden = true;
    video.classList.remove('ovl__video--hidden');
    freezeBtn.hidden = false;
    resumeBtn.hidden = true;
    if (!raf) raf = requestAnimationFrame(frame);
  }

  startBtn.addEventListener('click', () => void startCamera());
  freezeBtn.addEventListener('click', burnAndFreeze);
  resumeBtn.addEventListener('click', resume);

  return {
    el: root,
    open(): void {
      opened = true;
      if (stream) {
        liveWrap.hidden = false;
        if (!frozen && !raf) raf = requestAnimationFrame(frame);
      } else {
        reason.hidden = !recovery.hidden ? true : false;
      }
    },
    close(): void {
      opened = false;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (stream) {
        try {
          for (const track of stream.getTracks?.() ?? []) track.stop();
        } catch {
          /* platform stream without track access — nothing to release */
        }
        stream = null;
        try {
          video.srcObject = null;
        } catch {
          /* srcObject quirk — the element is being discarded anyway */
        }
      }
      frozen = false;
      frozenImg.hidden = true;
      video.classList.remove('ovl__video--hidden');
      freezeBtn.hidden = false;
      resumeBtn.hidden = true;
      liveWrap.hidden = true;
      reason.hidden = false;
    },
    get live(): boolean {
      return stream !== null;
    },
  };
}
