// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { canVibrate, vibrate } from '../../src/app/haptics';
import { releaseWakeLock, requestWakeLock, wakeLockActive } from '../../src/app/wakelock';

describe('haptics', () => {
  it('reports absent vibration honestly and never throws (iOS path)', () => {
    delete (navigator as unknown as Record<string, unknown>)['vibrate'];
    expect(canVibrate()).toBe(false);
    expect(() => vibrate(30)).not.toThrow();
    expect(vibrate(30)).toBe(false); // audio not running either — silent, not a lie
  });

  it('uses native vibration when present', () => {
    const fn = vi.fn(() => true);
    Object.defineProperty(navigator, 'vibrate', { value: fn, configurable: true, writable: true });
    expect(canVibrate()).toBe(true);
    expect(vibrate([30, 20, 30])).toBe(true);
    expect(fn).toHaveBeenCalledWith([30, 20, 30]);
    delete (navigator as unknown as Record<string, unknown>)['vibrate'];
  });
});

describe('wakelock', () => {
  it('resolves false where the API does not exist — no dead end', async () => {
    expect(await requestWakeLock()).toBe(false);
    expect(wakeLockActive()).toBe(false);
    await releaseWakeLock();
  });

  it('acquires, survives a system release via visibilitychange, and releases', async () => {
    const releaseListeners: Array<() => void> = [];
    const sentinel = {
      release: vi.fn(async () => {}),
      addEventListener: (type: string, cb: () => void) => {
        if (type === 'release') releaseListeners.push(cb);
      },
    };
    const request = vi.fn(async () => sentinel);
    Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true });

    expect(await requestWakeLock()).toBe(true);
    expect(wakeLockActive()).toBe(true);
    expect(request).toHaveBeenCalledWith('screen');

    // the OS releases the lock (screen dim, tab hidden)...
    for (const cb of releaseListeners) cb();
    expect(wakeLockActive()).toBe(false);

    // ...and coming back re-acquires without a tap
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(wakeLockActive()).toBe(true));
    expect(request).toHaveBeenCalledTimes(2);

    await releaseWakeLock();
    expect(wakeLockActive()).toBe(false);
    expect(sentinel.release).toHaveBeenCalled();

    // released-and-idle: visibility changes must not re-acquire
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((r) => setTimeout(r, 10));
    expect(wakeLockActive()).toBe(false);
    expect(request).toHaveBeenCalledTimes(2);
  });
});
