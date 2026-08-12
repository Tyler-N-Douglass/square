/**
 * Log store seam — lead-owned contract (ADR-003 discipline). Every tool saves
 * through this; A8 (Persistence & Log) owns the implementation behind it and
 * may rewrite the internals, keeping these exported signatures stable.
 *
 * Phase 2 state (A8): IndexedDB-backed through src/app/db.ts, with the
 * visible in-memory fallback for browsers that refuse IDB (Safari private
 * mode) — check `backendMode()` and tell the user their data is
 * session-only (SPEC §15.4). Phase 1 entries written to localStorage under
 * 'square.log.v0' migrate into IndexedDB on first open, then the old key is
 * cleared.
 *
 * Stable exports (Phase 1 contract): SavedEntry, saveMeasurement,
 * listMeasurements, deleteMeasurement, deleteAll, subscribeLog.
 * A8 additions: note/project editing, media blobs with cascade delete and an
 * object-URL lifecycle helper, soft delete with a 10 s undo window
 * (SPEC §7B.9 — nothing destructive is one tap from gone), and backendMode.
 */
import type { Measurement } from '../types';
import { squareBackend, STORE_KV, STORE_MEASUREMENTS, STORE_MEDIA, __resetDbForTests, type BackendLike } from './db';

export interface SavedEntry {
  measurement: Measurement;
  note?: string;
  project?: string;
}

type Listener = (entries: readonly SavedEntry[]) => void;

const V0_KEY = 'square.log.v0';

/** Soft-deleted entries commit (cascade and all) after this window — SPEC §7B.9. */
export const UNDO_GRACE_MS = 10_000;

let backend: BackendLike | null = null;
let readyPromise: Promise<void> | null = null;
let cache: SavedEntry[] = [];
const listeners = new Set<Listener>();

interface PendingDelete {
  entry: SavedEntry;
  timer: ReturnType<typeof setTimeout>;
}
/** Insertion-ordered: the last inserted is "restore last". Survives navigation within the session. */
const pending = new Map<string, PendingDelete>();

/* ------------------------------------------------------------------ */
/* internals                                                           */
/* ------------------------------------------------------------------ */

function byCapture(a: SavedEntry, b: SavedEntry): number {
  return (
    a.measurement.provenance.capturedAt - b.measurement.provenance.capturedAt ||
    (a.measurement.id < b.measurement.id ? -1 : a.measurement.id > b.measurement.id ? 1 : 0)
  );
}

function snapshot(): readonly SavedEntry[] {
  return [...cache];
}

function notify(): void {
  const snap = snapshot();
  for (const fn of listeners) fn(snap);
}

function looksLikeEntry(x: unknown): x is SavedEntry {
  if (x === null || typeof x !== 'object') return false;
  const m = (x as { measurement?: unknown }).measurement;
  return m !== null && typeof m === 'object' && typeof (m as { id?: unknown }).id === 'string';
}

/**
 * Phase 1 stub entries (localStorage 'square.log.v0') move into IndexedDB on
 * first open, then the key is cleared. A corrupt v0 blob is left in place —
 * destroying what we cannot read would be silent data loss.
 */
async function migrateV0(b: BackendLike): Promise<void> {
  let raw: string | null = null;
  try {
    raw = (globalThis as { localStorage?: Storage }).localStorage?.getItem(V0_KEY) ?? null;
  } catch {
    return; // no localStorage — nothing to migrate
  }
  if (raw === null) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return; // corrupt: leave the key for a human/diagnostics, migrate nothing
  }
  if (!Array.isArray(parsed)) return;
  for (const item of parsed) {
    if (!looksLikeEntry(item)) continue;
    const existing = await b.get(STORE_MEASUREMENTS, item.measurement.id);
    if (existing === undefined) await b.put(STORE_MEASUREMENTS, item);
  }
  try {
    (globalThis as { localStorage?: Storage }).localStorage?.removeItem(V0_KEY);
  } catch {
    /* removal is best-effort */
  }
}

function ready(): Promise<void> {
  if (!readyPromise) {
    readyPromise = (async () => {
      const b = await squareBackend();
      backend = b;
      await migrateV0(b);
      cache = ((await b.getAll(STORE_MEASUREMENTS)) as SavedEntry[]).sort(byCapture);
      notify();
    })();
  }
  return readyPromise;
}

function insertSorted(entry: SavedEntry): void {
  cache = cache.filter((e) => e.measurement.id !== entry.measurement.id);
  cache.push(entry);
  cache.sort(byCapture);
}

async function cascadeMedia(b: BackendLike, entry: SavedEntry | undefined): Promise<void> {
  const photoId = entry?.measurement.media?.photoId;
  if (photoId !== undefined) await b.delete(STORE_MEDIA, photoId);
}

async function hardDelete(b: BackendLike, id: string): Promise<void> {
  const stored = (await b.get(STORE_MEASUREMENTS, id)) as SavedEntry | undefined;
  await cascadeMedia(b, stored);
  await b.delete(STORE_MEASUREMENTS, id);
}

/* ------------------------------------------------------------------ */
/* stable contract (Phase 1 signatures)                                */
/* ------------------------------------------------------------------ */

/** Save a measurement with optional note/project. Resolves when durably queued. */
export async function saveMeasurement(m: Measurement, opts: { note?: string; project?: string } = {}): Promise<void> {
  await ready();
  const entry: SavedEntry = { measurement: m };
  if (opts.note !== undefined) entry.note = opts.note;
  if (opts.project !== undefined) entry.project = opts.project;
  await backend!.put(STORE_MEASUREMENTS, entry);
  insertSorted(entry);
  notify();
}

export async function listMeasurements(): Promise<readonly SavedEntry[]> {
  await ready();
  return snapshot();
}

/** Immediate delete with media cascade. LOG's own delete goes through softDeleteMeasurement. */
export async function deleteMeasurement(id: string): Promise<void> {
  await ready();
  const p = pending.get(id);
  if (p) {
    clearTimeout(p.timer);
    pending.delete(id);
  }
  await hardDelete(backend!, id);
  const before = cache.length;
  cache = cache.filter((e) => e.measurement.id !== id);
  if (before !== cache.length || p) notify();
}

/**
 * Wipes measurements and media. Calibration is deliberately NOT touched — it
 * lives in CALIBRATE's own store and survives a log wipe (SPEC §4.7).
 * Guidance state (kv) also survives: it is not log data.
 */
export async function deleteAll(): Promise<void> {
  await ready();
  for (const p of pending.values()) clearTimeout(p.timer);
  pending.clear();
  await backend!.clear(STORE_MEASUREMENTS);
  await backend!.clear(STORE_MEDIA);
  cache = [];
  notify();
}

/** Subscribe to changes; returns unsubscribe. Fires immediately with current. */
export function subscribeLog(fn: Listener): () => void {
  listeners.add(fn);
  fn(snapshot());
  void ready(); // warm in the background; subscribers hear again once loaded
  return () => listeners.delete(fn);
}

/* ------------------------------------------------------------------ */
/* A8 additions — entry editing                                        */
/* ------------------------------------------------------------------ */

/**
 * Edit note/project on an entry. A provided empty (or whitespace) string
 * clears the field; an omitted field is untouched.
 */
export async function updateEntry(id: string, patch: { note?: string; project?: string }): Promise<SavedEntry | null> {
  await ready();
  const entry = cache.find((e) => e.measurement.id === id);
  if (!entry) return null;
  const next: SavedEntry = { ...entry };
  for (const field of ['note', 'project'] as const) {
    const v = patch[field];
    if (v === undefined) continue;
    if (v.trim() === '') delete next[field];
    else next[field] = v;
  }
  await backend!.put(STORE_MEASUREMENTS, next);
  insertSorted(next);
  notify();
  return next;
}

/* ------------------------------------------------------------------ */
/* A8 additions — media blobs                                          */
/* ------------------------------------------------------------------ */

export async function saveMedia(id: string, blob: Blob): Promise<void> {
  await ready();
  await backend!.put(STORE_MEDIA, blob, id);
}

export async function getMedia(id: string): Promise<Blob | null> {
  await ready();
  const v = (await backend!.get(STORE_MEDIA, id)) as Blob | undefined;
  return v ?? null;
}

export async function deleteMedia(id: string): Promise<void> {
  await ready();
  await backend!.delete(STORE_MEDIA, id);
}

export interface MediaUrls {
  /** Object URL for a stored photo, cached per id; null when the blob is gone. */
  url(id: string): Promise<string | null>;
  /** Revoke every URL this helper created. Call on unmount. */
  revokeAll(): void;
}

/**
 * Object-URL lifecycle helper: create on view, revoke on unmount. One helper
 * per mounted view; never share across mounts.
 */
export function mediaObjectUrls(): MediaUrls {
  const made = new Map<string, string>();
  let revoked = false;
  return {
    async url(id: string): Promise<string | null> {
      if (revoked) return null;
      const hit = made.get(id);
      if (hit !== undefined) return hit;
      const blob = await getMedia(id);
      if (blob === null || revoked) return null;
      const u = URL.createObjectURL(blob);
      made.set(id, u);
      return u;
    },
    revokeAll(): void {
      revoked = true;
      for (const u of made.values()) URL.revokeObjectURL(u);
      made.clear();
    },
  };
}

/* ------------------------------------------------------------------ */
/* A8 additions — soft delete with undo window (SPEC §7B.9)            */
/* ------------------------------------------------------------------ */

/**
 * Remove an entry from view now; commit the real delete (with media cascade)
 * after the grace window. Within the window undoDelete() restores it intact.
 * Pending deletes live at module scope, so "restore last" survives
 * navigation within the session; a reload before commit leaves the entry in
 * IndexedDB untouched — losing a delete is the safe direction.
 */
export async function softDeleteMeasurement(id: string, graceMs: number = UNDO_GRACE_MS): Promise<boolean> {
  await ready();
  const entry = cache.find((e) => e.measurement.id === id);
  if (!entry || pending.has(id)) return false;
  cache = cache.filter((e) => e.measurement.id !== id);
  const timer = setTimeout(() => {
    void commitDelete(id);
  }, graceMs);
  pending.set(id, { entry, timer });
  notify();
  return true;
}

async function commitDelete(id: string): Promise<void> {
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  clearTimeout(p.timer);
  await ready();
  await hardDelete(backend!, id);
}

/** Restore a pending delete — the given id, or the most recent without one. */
export async function undoDelete(id?: string): Promise<SavedEntry | null> {
  await ready();
  const key = id ?? [...pending.keys()].pop();
  if (key === undefined) return null;
  const p = pending.get(key);
  if (!p) return null;
  clearTimeout(p.timer);
  pending.delete(key);
  insertSorted(p.entry);
  notify();
  return p.entry;
}

/** Entries in their undo window, oldest first — the UI re-offers UNDO from this after navigation. */
export function pendingDeleted(): readonly SavedEntry[] {
  return [...pending.values()].map((p) => p.entry);
}

/* ------------------------------------------------------------------ */
/* A8 additions — backend visibility + test reset                      */
/* ------------------------------------------------------------------ */

/**
 * Which backend actually holds the data. 'memory' means Safari-private-mode
 * style fallback: session-only storage the UI must surface (SPEC §15.4).
 */
export async function backendMode(): Promise<'idb' | 'memory'> {
  await ready();
  return backend!.kind;
}

/** Test hook: drop all module state and the shared db handle. */
export function __resetLogStoreForTests(): void {
  for (const p of pending.values()) clearTimeout(p.timer);
  pending.clear();
  cache = [];
  listeners.clear();
  backend = null;
  readyPromise = null;
  __resetDbForTests();
}

/** Re-exported so LOG's UI (and tests) can name the stores without importing db.ts everywhere. */
export { STORE_KV, STORE_MEASUREMENTS, STORE_MEDIA };
