/**
 * Photo acquisition for CORNER and the lens routine — SPEC §4.3, §6.2.
 * Camera permission is requested ONLY on the user's OPEN CAMERA tap, with the
 * inline reason shown beside the button. Denial is never a dead end: the
 * file-input fallback is always present and the tool works from any photo.
 *
 * When the camera path is used, one OrientationFusion sample is captured at
 * shutter time — the gravity reference for plumb-referenced framing
 * (§4.3.1.7). File uploads carry no gravity; the caller states that.
 */
import type { CapabilityReport, Orientation } from '../../sensors/types';
import { DeviceMotionSource } from '../../sensors/imu';
import { OrientationFusion } from '../../sensors/orientation';
import { requestMotionPermissions, recoveryInstructions } from '../../sensors/permissions';
import { workingSize } from './math';
import { cameraLensKey } from './math';

export interface CaptureResult {
  /** Working-resolution canvas with the photo drawn in. */
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  /** Working px per native px (≤ 1) — pixel-noise bookkeeping. */
  nativeScale: number;
  source: 'camera' | 'file';
  /** One fused orientation sample at shutter — camera path only. */
  orientationAtShutter: Orientation | null;
  /** CalibrationProfile.lens key for this camera, or null for files. */
  cameraKey: string | null;
}

export interface CaptureDeps {
  capability: CapabilityReport;
  /** Ask for gravity (motion permission + fusion) while the camera is open. */
  wantGravity: boolean;
  /** One line, inline, explaining why the camera is asked for. */
  reason: string;
  onCaptured(result: CaptureResult): void;
  announce(text: string): void;
}

export interface CaptureViewHandle {
  el: HTMLElement;
  dispose(): void;
}

export function captureView(deps: CaptureDeps): CaptureViewHandle {
  const el = document.createElement('div');
  el.className = 'capture';

  const status = document.createElement('p');
  status.className = 'capture__status';
  status.setAttribute('role', 'status');

  const reason = document.createElement('p');
  reason.className = 'capture__reason';
  reason.textContent = deps.reason;

  const controls = document.createElement('div');
  controls.className = 'capture__controls';

  let stream: MediaStream | null = null;
  let video: HTMLVideoElement | null = null;
  let fusion: OrientationFusion | null = null;
  let imu: DeviceMotionSource | null = null;
  let latestOrientation: Orientation | null = null;
  let unsubOrientation: (() => void) | null = null;
  let cameraKey: string | null = null;

  const stopCamera = (): void => {
    if (stream) {
      for (const t of stream.getTracks()) t.stop();
      stream = null;
    }
    if (video) {
      video.remove();
      video = null;
    }
    unsubOrientation?.();
    unsubOrientation = null;
    fusion?.stop();
    imu?.stop();
    fusion = null;
    imu = null;
    shutterBtn.hidden = true;
  };

  const drawToWorking = (
    src: CanvasImageSource,
    nativeW: number,
    nativeH: number,
  ): { canvas: HTMLCanvasElement; w: number; h: number; scale: number } | null => {
    const ws = workingSize(nativeW, nativeH);
    const canvas = document.createElement('canvas');
    canvas.width = ws.w;
    canvas.height = ws.h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(src, 0, 0, ws.w, ws.h);
    return { canvas, w: ws.w, h: ws.h, scale: ws.scale };
  };

  /* ---------- camera path ---------- */

  const openBtn = document.createElement('button');
  openBtn.type = 'button';
  openBtn.className = 'btn capture__open';
  openBtn.textContent = 'OPEN CAMERA';

  const shutterBtn = document.createElement('button');
  shutterBtn.type = 'button';
  shutterBtn.className = 'btn capture__shutter';
  shutterBtn.textContent = 'CAPTURE';
  shutterBtn.hidden = true;

  const openCamera = async (): Promise<void> => {
    // Motion permission rides the same gesture (iOS choreography, SPEC §6.1).
    if (deps.wantGravity) {
      try {
        await requestMotionPermissions();
        imu = new DeviceMotionSource();
        fusion = new OrientationFusion(imu);
        unsubOrientation = fusion.subscribe((o) => {
          latestOrientation = o;
        });
        await fusion.start();
      } catch {
        latestOrientation = null; // gravity assist degrades honestly, capture continues
      }
    }
    const md = navigator.mediaDevices;
    if (!md?.getUserMedia) {
      status.textContent = 'No camera API in this browser. Pick a photo instead — the tool works from any shot.';
      return;
    }
    try {
      stream = await md.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 } },
        audio: false,
      });
    } catch {
      status.textContent = `Camera denied. ${recoveryInstructions('camera', deps.capability.platformHint)} Meanwhile, pick a photo below — the tool works from any shot.`;
      deps.announce('Camera denied — the photo picker below still works');
      return;
    }
    const track = stream.getVideoTracks()[0];
    if (track) {
      const settings = typeof track.getSettings === 'function' ? track.getSettings() : {};
      cameraKey = cameraLensKey(settings.deviceId, track.label);
    }
    video = document.createElement('video');
    video.className = 'capture__video';
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.srcObject = stream;
    video.style.width = '100%';
    el.insertBefore(video, controls);
    try {
      await video.play();
    } catch {
      /* autoplay policies — the frame still renders on most engines */
    }
    shutterBtn.hidden = false;
    openBtn.hidden = true;
    status.textContent = 'Frame the corner with both edges long in the view, then capture.';
  };

  const shutter = (): void => {
    if (!video || !stream) return;
    const nw = video.videoWidth || 1280;
    const nh = video.videoHeight || 720;
    const drawn = drawToWorking(video, nw, nh);
    const shutterOrientation = latestOrientation;
    stopCamera();
    openBtn.hidden = false;
    if (!drawn) {
      status.textContent = 'Canvas is unavailable — pick a photo below instead.';
      return;
    }
    deps.announce('Photo captured');
    deps.onCaptured({
      canvas: drawn.canvas,
      width: drawn.w,
      height: drawn.h,
      nativeScale: drawn.scale,
      source: 'camera',
      orientationAtShutter: shutterOrientation,
      cameraKey,
    });
  };

  openBtn.addEventListener('click', () => void openCamera());
  shutterBtn.addEventListener('click', shutter);

  /* ---------- file fallback (always present) ---------- */

  const fileLabel = document.createElement('label');
  fileLabel.className = 'btn btn--ghost capture__file';
  fileLabel.textContent = 'CHOOSE PHOTO';
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.className = 'visually-hidden';
  fileInput.setAttribute('aria-label', 'Choose a photo from the device');
  fileLabel.append(fileInput);

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const drawn = drawToWorking(img, img.naturalWidth, img.naturalHeight);
      URL.revokeObjectURL(url);
      if (!drawn) {
        status.textContent = 'Could not read that image.';
        return;
      }
      deps.announce('Photo loaded');
      deps.onCaptured({
        canvas: drawn.canvas,
        width: drawn.w,
        height: drawn.h,
        nativeScale: drawn.scale,
        source: 'file',
        orientationAtShutter: null,
        cameraKey: null,
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      status.textContent = 'Could not read that image. Pick a different file.';
    };
    img.src = url;
  });

  if (deps.capability.hasCamera) {
    controls.append(openBtn, shutterBtn, fileLabel);
  } else {
    status.textContent = 'No camera on this device — the tool runs from any photo you pick.';
    controls.append(fileLabel);
  }

  el.append(reason, controls, status);

  return {
    el,
    dispose: () => stopCamera(),
  };
}
