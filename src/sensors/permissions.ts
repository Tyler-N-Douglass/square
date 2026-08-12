/**
 * Permission choreography — SPEC §6. iOS requires requestPermission() calls
 * from inside a user gesture; both motion and orientation are requested in the
 * SAME gesture handler. Every denial gets a recovery path; nothing blocks the
 * whole app, ever.
 */

export type PermState = 'granted' | 'denied' | 'unavailable' | 'not-required';

export interface MotionPermissionResult {
  motion: PermState;
  orientation: PermState;
}

interface RequestableEvent { requestPermission?: () => Promise<'granted' | 'denied'>; }

/**
 * Call ONLY from a user gesture (tap handler). On platforms without the
 * iOS permission dance this resolves immediately as 'not-required'.
 */
export async function requestMotionPermissions(): Promise<MotionPermissionResult> {
  const DME = (globalThis as Record<string, unknown>)['DeviceMotionEvent'] as RequestableEvent | undefined;
  const DOE = (globalThis as Record<string, unknown>)['DeviceOrientationEvent'] as RequestableEvent | undefined;

  const ask = async (e: RequestableEvent | undefined): Promise<PermState> => {
    if (!e) return 'unavailable';
    if (typeof e.requestPermission !== 'function') return 'not-required';
    try {
      return (await e.requestPermission()) === 'granted' ? 'granted' : 'denied';
    } catch {
      return 'denied';
    }
  };

  // Same gesture, both requests — iOS coalesces them into one prompt flow.
  const [motion, orientation] = await Promise.all([ask(DME), ask(DOE)]);
  return { motion, orientation };
}

/** Passive query for the magnetometer permission where the Permissions API knows it. */
export async function queryMagnetometerPermission(): Promise<PermissionState | 'unsupported'> {
  try {
    const status = await navigator.permissions.query({ name: 'magnetometer' as PermissionName });
    return status.state;
  } catch {
    return 'unsupported';
  }
}

/** Recovery copy per platform — used by every denial screen (SPEC §6.4). */
export function recoveryInstructions(kind: 'motion' | 'camera' | 'magnetometer', platform: 'ios' | 'android' | 'desktop' | 'unknown'): string {
  if (kind === 'motion') {
    if (platform === 'ios') return 'Open Settings → Safari → Motion & Orientation Access and turn it on, then reload this page. If you tapped Don’t Allow: reload the page and tap the wake panel again.';
    return 'Reload the page and allow motion sensors when asked. If the prompt never appears, check the site permissions in the browser’s address-bar menu.';
  }
  if (kind === 'camera') {
    if (platform === 'ios') return 'Open Settings → Safari → Camera and choose Allow, then reload. The camera is used for the overlay only — nothing leaves the phone.';
    return 'Tap the padlock/tune icon in the address bar → Permissions → Camera → Allow, then reload.';
  }
  // magnetometer
  if (platform === 'android') return 'In Chrome, open chrome://flags/#enable-generic-sensor-extra-classes, set it to Enabled, restart Chrome. Then reload and allow sensor access.';
  if (platform === 'ios') return 'iOS never exposes the raw magnetometer to web apps. SCAN runs in heading-deflection mode here — or use MANUAL mode.';
  return 'Desktops have no magnetometer. Use MANUAL mode, or open the app on a phone.';
}
