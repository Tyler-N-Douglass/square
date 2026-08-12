/**
 * Sensor abstraction contract — SPEC §3.3. Lead-owned (ADR-003).
 * All tools code against this, never raw events.
 */
import type { MagTier, Quat } from '../types';

export type { MagTier };

export interface Blocker {
  code: string;
  message: string; // human-readable, plain voice (BRAND.md)
  remedy: string;  // what to do about it, per platform
}

export interface CapabilityReport {
  magTier: MagTier;
  hasAccel: boolean;
  hasGyro: boolean;
  hasAbsoluteOrientation: boolean;
  hasCamera: boolean;
  cameraCount: number;
  hasVibrate: boolean;
  hasWakeLock: boolean;
  hasOffscreenCanvas: boolean;
  secureContext: boolean;
  permissionsPolicyOk: boolean;
  platformHint: 'ios' | 'android' | 'desktop' | 'unknown';
  sampleRates: { mag?: number; motion?: number };
  blockers: Blocker[];
}

export interface MagSample { t: number; x: number; y: number; z: number; mag: number; tier: MagTier; }
export interface ImuSample { t: number; ax: number; ay: number; az: number; gx: number; gy: number; gz: number; }
export interface Orientation { t: number; q: Quat; pitch: number; roll: number; yaw: number | null; stable: boolean; }

export type SourceHealth = 'ok' | 'degraded' | 'dead';

export interface SensorSource<T> {
  start(): Promise<void>;
  stop(): void;
  subscribe(fn: (s: T) => void): () => void;
  readonly nominalHz: number;
  readonly health: SourceHealth;
}
