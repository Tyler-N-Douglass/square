/**
 * Capability probe — SPEC §2.2. The probe decides the tier honestly and
 * always attaches a remedy to a blocker.
 */
import { describe, expect, it } from 'vitest';
import { detectPlatform, probeCapabilities, type ProbeEnv } from '../../src/sensors/capability';

function env(overrides: Partial<ProbeEnv>): ProbeEnv {
  return {
    win: {},
    nav: {},
    doc: undefined,
    isSecureContext: true,
    userAgent: 'test',
    maxTouchPoints: 0,
    ...overrides,
  };
}

describe('probeCapabilities — tier decision', () => {
  it('FIELD when the raw Magnetometer constructor exists in a secure context', async () => {
    const r = await probeCapabilities(env({ win: { Magnetometer: function M() { /* ctor */ } } }));
    expect(r.magTier).toBe('FIELD');
  });

  it('PROXY when only absolute orientation exists', async () => {
    const r = await probeCapabilities(env({ win: { ondeviceorientationabsolute: null } }));
    expect(r.magTier).toBe('PROXY');
    expect(r.blockers.some((b) => b.code === 'NO_RAW_MAG')).toBe(true);
  });

  it('PROXY on iOS with orientation events (webkitCompassHeading path)', async () => {
    const r = await probeCapabilities(env({
      win: { DeviceOrientationEvent: function E() { /* ctor */ }, DeviceMotionEvent: function E2() { /* ctor */ } },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
    }));
    expect(r.platformHint).toBe('ios');
    expect(r.magTier).toBe('PROXY');
  });

  it('NONE on a bare desktop, with a remedy attached', async () => {
    const r = await probeCapabilities(env({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' }));
    expect(r.magTier).toBe('NONE');
    const blocker = r.blockers.find((b) => b.code === 'NO_MAG');
    expect(blocker).toBeDefined();
    expect(blocker!.remedy.length).toBeGreaterThan(10);
  });

  it('insecure context forces a blocker and never FIELD', async () => {
    const r = await probeCapabilities(env({
      isSecureContext: false,
      win: { Magnetometer: function M() { /* ctor */ } },
    }));
    expect(r.magTier).not.toBe('FIELD');
    expect(r.blockers.some((b) => b.code === 'INSECURE_CONTEXT')).toBe(true);
  });

  it('permissions-policy denial blocks FIELD and names the deployment, not the phone', async () => {
    const r = await probeCapabilities(env({
      win: { Magnetometer: function M() { /* ctor */ } },
      doc: { featurePolicy: { allowsFeature: (f: string) => f !== 'magnetometer' } },
    }));
    expect(r.magTier).not.toBe('FIELD');
    const b = r.blockers.find((x) => x.code === 'PERMISSIONS_POLICY');
    expect(b?.remedy).toMatch(/Permissions-Policy/);
  });

  it('every blocker carries a human remedy — degradation is never silent (SPEC §15.4)', async () => {
    for (const e of [
      env({}),
      env({ isSecureContext: false }),
      env({ win: { ondeviceorientationabsolute: null } }),
    ]) {
      const r = await probeCapabilities(e);
      for (const b of r.blockers) {
        expect(b.message.length).toBeGreaterThan(0);
        expect(b.remedy.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('detectPlatform', () => {
  it('classifies the common agents', () => {
    expect(detectPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe('ios');
    expect(detectPlatform('Mozilla/5.0 (Linux; Android 14; Pixel 8)')).toBe('android');
    expect(detectPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('desktop');
    expect(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe('ios'); // iPad masquerade
    expect(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0)).toBe('desktop');
  });
});
