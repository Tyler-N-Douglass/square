/**
 * THE capability probe — SPEC §2.2, §3.3. Everything consumes this; nothing assumes.
 * The probe is passive: it never prompts for a permission and never constructs a
 * sensor in a way that would show UI. Runtime truth can still differ (a source can
 * die after start), so sources carry their own `health` and report rate collapse.
 */
import type { Blocker, CapabilityReport, MagTier } from './types';

/** Injectable environment so the probe is unit-testable in Node. */
export interface ProbeEnv {
  win: Record<string, unknown>;
  nav: {
    userAgent?: string;
    maxTouchPoints?: number;
    mediaDevices?: MediaDevices;
    vibrate?: unknown;
    wakeLock?: unknown;
  };
  doc?: { featurePolicy?: { allowsFeature?: (f: string) => boolean } };
  isSecureContext: boolean;
  userAgent: string;
  maxTouchPoints?: number;
}

function defaultEnv(): ProbeEnv {
  const g = globalThis as unknown as Record<string, unknown>;
  const nav = (g['navigator'] ?? {}) as ProbeEnv['nav'];
  return {
    win: g,
    nav,
    doc: g['document'] as unknown as ProbeEnv['doc'],
    isSecureContext: (g['isSecureContext'] as boolean | undefined) ?? false,
    userAgent: (nav.userAgent as string | undefined) ?? '',
    maxTouchPoints: (nav.maxTouchPoints as number | undefined) ?? 0,
  };
}

export function detectPlatform(ua: string, maxTouchPoints = 0): CapabilityReport['platformHint'] {
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
  // iPadOS 13+ masquerades as macOS but reports touch points.
  if (/Macintosh/.test(ua) && maxTouchPoints > 1) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Windows|Macintosh|Linux|CrOS/.test(ua)) return 'desktop';
  return 'unknown';
}

export async function probeCapabilities(env: ProbeEnv = defaultEnv()): Promise<CapabilityReport> {
  const blockers: Blocker[] = [];
  const platformHint = detectPlatform(env.userAgent, env.maxTouchPoints ?? 0);

  const secureContext = env.isSecureContext;
  if (!secureContext) {
    blockers.push({
      code: 'INSECURE_CONTEXT',
      message: 'This page is not served over HTTPS. Browsers block all sensors without it.',
      remedy: 'Open the app from its https:// address.',
    });
  }

  // Permissions-Policy check (magnetometer is the one that gets blocked in practice).
  let permissionsPolicyOk = true;
  const fp = env.doc?.featurePolicy;
  if (fp?.allowsFeature) {
    permissionsPolicyOk = fp.allowsFeature('magnetometer');
    if (!permissionsPolicyOk) {
      blockers.push({
        code: 'PERMISSIONS_POLICY',
        message: 'The server did not grant this page magnetometer access.',
        remedy: 'The deployed site must send Permissions-Policy: magnetometer=(self). This is a deployment bug, not a phone setting.',
      });
    }
  }

  // Motion / orientation.
  const hasDeviceMotion = 'ondevicemotion' in env.win || 'DeviceMotionEvent' in env.win;
  const hasAccel = hasDeviceMotion;
  const hasGyro = hasDeviceMotion; // devicemotion carries rotationRate; realized rate is measured at runtime
  const hasAbsoluteOrientation =
    'AbsoluteOrientationSensor' in env.win || 'ondeviceorientationabsolute' in env.win;

  // Magnetometer tiers — SPEC §2.2.
  const hasRawMag = typeof env.win['Magnetometer'] === 'function';
  // Tier B needs a magnetically-referenced heading: absolute orientation, or iOS webkitCompassHeading
  // (only observable from a real event, so on iOS we report the tier as PROXY when orientation
  // events exist at all — the source verifies on first event and downgrades honestly if absent).
  const hasHeading =
    hasAbsoluteOrientation || (platformHint === 'ios' && ('DeviceOrientationEvent' in env.win || 'ondeviceorientation' in env.win));

  let magTier: MagTier = 'NONE';
  if (hasRawMag && secureContext && permissionsPolicyOk) magTier = 'FIELD';
  else if (hasHeading && secureContext) magTier = 'PROXY';

  if (magTier === 'PROXY') {
    blockers.push({
      code: 'NO_RAW_MAG',
      message: 'This browser exposes no raw magnetic field. SCAN runs on heading deflection — coarser, more false positives.',
      remedy: platformHint === 'android'
        ? 'Chrome on Android can expose the raw sensor: enable chrome://flags/#enable-generic-sensor-extra-classes and restart Chrome.'
        : 'iOS exposes no raw magnetometer to web apps. Heading-deflection mode and MANUAL mode are the honest options here.',
    });
  } else if (magTier === 'NONE') {
    blockers.push({
      code: 'NO_MAG',
      message: 'No magnetometer path is available in this browser. SCAN sensing is off — MANUAL stud mode still works.',
      remedy: platformHint === 'desktop'
        ? 'Desktops have no magnetometer. Open the app on a phone, or use MANUAL mode and DEMO replays here.'
        : 'Use MANUAL stud mode (it does the 16″/24″ on-center arithmetic), or open in Chrome on Android with the generic-sensor flag enabled.',
    });
  }

  // Camera.
  let hasCamera = false;
  let cameraCount = 0;
  const md = env.nav.mediaDevices as MediaDevices | undefined;
  if (md?.enumerateDevices) {
    try {
      const devices = await md.enumerateDevices();
      cameraCount = devices.filter((d) => d.kind === 'videoinput').length;
      hasCamera = cameraCount > 0;
    } catch {
      hasCamera = typeof md.getUserMedia === 'function';
    }
  }

  const hasVibrate = typeof env.nav.vibrate === 'function';
  const hasWakeLock = 'wakeLock' in env.nav && env.nav.wakeLock != null;
  const hasOffscreenCanvas = typeof env.win['OffscreenCanvas'] === 'function';

  if (!hasVibrate && platformHint === 'ios') {
    blockers.push({
      code: 'NO_VIBRATE',
      message: 'iOS Safari has no vibration API. Audio is the non-visual channel during a scan.',
      remedy: 'Turn the ringer on, or watch the screen state word instead.',
    });
  }

  return {
    magTier,
    hasAccel,
    hasGyro,
    hasAbsoluteOrientation,
    hasCamera,
    cameraCount,
    hasVibrate,
    hasWakeLock,
    hasOffscreenCanvas,
    secureContext,
    permissionsPolicyOk,
    platformHint,
    sampleRates: {},
    blockers,
  };
}
