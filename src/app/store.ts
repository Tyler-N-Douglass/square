/**
 * Tiny reactive store — SPEC §3.1. No VDOM; live values render through rAF
 * writing to pre-created DOM nodes, never by re-rendering on sensor tick.
 */

export interface Signal<T> {
  get(): T;
  set(v: T): void;
  update(fn: (v: T) => T): void;
  subscribe(fn: (v: T) => void): () => void;
}

export function signal<T>(initial: T): Signal<T> {
  let value = initial;
  const subs = new Set<(v: T) => void>();
  return {
    get: () => value,
    set(v: T) {
      if (Object.is(v, value)) return;
      value = v;
      for (const fn of subs) fn(value);
    },
    update(fn) { this.set(fn(value)); },
    subscribe(fn) {
      subs.add(fn);
      fn(value);
      return () => subs.delete(fn);
    },
  };
}

/**
 * rAF-coalesced writer: many sensor ticks, one DOM write per frame.
 * Returns a setter; the latest value wins.
 */
export function rafWriter<T>(write: (v: T) => void): (v: T) => void {
  let pending: T | undefined;
  let scheduled = false;
  return (v: T) => {
    pending = v;
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      if (pending !== undefined) write(pending);
    });
  };
}

/** Persisted app settings (theme, glove mode, units) — localStorage-backed. */
export function persisted<T extends string>(key: string, fallback: T): Signal<T> {
  let stored: T | null = null;
  try { stored = localStorage.getItem(key) as T | null; } catch { /* private mode */ }
  const s = signal<T>(stored ?? fallback);
  s.subscribe((v) => { try { localStorage.setItem(key, v); } catch { /* ignore */ } });
  return s;
}
