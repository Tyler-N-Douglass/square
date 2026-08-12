import { placeholderMount } from '../placeholder';
export const mount = placeholderMount(
  'CALIBRATE',
  'Four routines — magnetometer iron, sensor locator, level reversal zero, lens intrinsics — each with a pass/fail and an age. Everything else’s accuracy claims are gated on these.',
  'A stale or failed calibration shows up on every tool that depends on it. There is no way to silence that, on purpose.',
);
