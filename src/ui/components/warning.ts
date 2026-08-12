/**
 * Warning banner — flat red band, hard edges, no soft anything (SPEC §7.4,
 * §7B.6, §15.4). Every warning carries an EXPLAIN affordance opening its
 * card: why this is happening / what to do / what ignoring it costs. There
 * is no dismiss control here — a warning leaves when its condition does,
 * or after the caller has offered the explanation.
 *
 * API:
 *   warningBanner(key, message, onExplain) → <div role="alert">
 *   WARNING_COPY[key]                      → the canonical one-line message
 *
 * Copy rules (BRAND.md): what happened, then what to do. Verb first where
 * it reads naturally. Never "simply", "just", "easy", never an apology.
 */
import type { WarningKey } from '../../types';

/** Canonical one-liners per warning key. Tools may pass richer, situation-
 *  specific text; this map is the floor, and the voice reference. */
export const WARNING_COPY: Record<WarningKey, string> = {
  WALL_HOT:
    'Wall reads hot. Likely metal studs, conduit, ductwork, or rebar. Fastener detection is not reliable here.',
  MAGNETIC_ACCESSORY:
    'Something magnetic is attached to your phone. Take the case off, then recalibrate.',
  SWEEP_TOO_FAST:
    'Sweep slower — peaks smear above about six inches per second.',
  RATE_COLLAPSE:
    'Sensor samples are arriving too slowly for a reliable read. Keep the app in the foreground and sweep again.',
  SATURATED:
    'The field here is stronger than the sensor can read. Move away from magnets, speakers, and large steel.',
  UNCALIBRATED:
    'Calibrate before trusting this. Open CALIBRATE and run the figure-8 — about 20 seconds.',
  GYRO_DRIFT:
    'Too long between captures — gyro drift has passed its budget. Capture the first face again.',
  LENS_UNCALIBRATED:
    'Lens not calibrated. Angles carry ±1.5–3° until you photograph a Letter or A4 sheet in CALIBRATE.',
  POOR_GEOMETRY:
    'The geometry is poor — uncertainty exceeds ±2.5°. Get more square-on, capture more of both edges, and use the loupe.',
};

export function warningBanner(key: WarningKey, message: string, onExplain: () => void): HTMLElement {
  const band = document.createElement('div');
  band.className = 'warnband';
  band.setAttribute('role', 'alert');
  band.setAttribute('data-warning-key', key);

  const msg = document.createElement('p');
  msg.className = 'warnband__msg';
  msg.textContent = message;

  const explain = document.createElement('button');
  explain.type = 'button';
  explain.className = 'warnband__explain display';
  explain.textContent = 'EXPLAIN';
  explain.setAttribute(
    'aria-label',
    'Explain this warning — why it happens, what to do, what ignoring it costs',
  );
  explain.addEventListener('click', onExplain);

  band.append(msg, explain);
  return band;
}
