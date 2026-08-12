/**
 * Haptics — navigator.vibrate where it exists, audio tick where it does not
 * (SPEC §2.1: Android yes, iOS Safari no; audio is the primary non-visual
 * channel). Never throws, never blocks.
 *
 * API:
 *   canVibrate()      native vibration available on this device
 *   vibrate(pattern)  true when native vibration fired; otherwise plays a
 *                     soft audio tick (if the audio engine is running,
 *                     which takes one prior user gesture) and returns false
 */
import { audioReady, tick } from './audio';

export function canVibrate(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

export function vibrate(pattern: number | number[]): boolean {
  if (canVibrate()) {
    try {
      if (navigator.vibrate(pattern)) return true;
    } catch {
      /* fall through to audio */
    }
  }
  if (audioReady()) tick('soft');
  return false;
}
