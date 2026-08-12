/**
 * Wake lock — the screen stays on during active measurement and releases
 * when idle (SPEC §7.7). Backgrounding the tab releases the OS lock, so a
 * visibilitychange listener re-acquires it while the app still wants it —
 * coming back to a sweep must not need a tap.
 *
 * API:
 *   requestWakeLock()  → Promise<boolean> — held? False on refusal
 *                        (unsupported, low battery) — measurement continues,
 *                        the screen may sleep; the tool can say so.
 *   releaseWakeLock()  → Promise<void>
 *   wakeLockActive()   → boolean
 */
let sentinel: WakeLockSentinel | null = null;
let wanted = false;
let listening = false;

async function acquire(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return false;
  try {
    const s = await navigator.wakeLock.request('screen');
    sentinel = s;
    s.addEventListener('release', () => {
      if (sentinel === s) sentinel = null;
    });
    return true;
  } catch {
    return false;
  }
}

function onVisibility(): void {
  if (wanted && document.visibilityState === 'visible' && sentinel === null) void acquire();
}

export async function requestWakeLock(): Promise<boolean> {
  wanted = true;
  if (!listening && typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibility);
    listening = true;
  }
  if (sentinel) return true;
  return acquire();
}

export async function releaseWakeLock(): Promise<void> {
  wanted = false;
  const s = sentinel;
  sentinel = null;
  if (s) {
    try {
      await s.release();
    } catch {
      /* already released by the platform */
    }
  }
}

export function wakeLockActive(): boolean {
  return sentinel !== null;
}
