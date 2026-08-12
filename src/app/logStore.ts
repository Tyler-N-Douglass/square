/**
 * Log store seam — lead-owned contract (ADR-003 discipline). Every tool saves
 * through this; A8 (Persistence & Log) owns the implementation behind it and
 * may rewrite the internals, keeping these exported signatures stable.
 *
 * Phase 1 state: in-memory + localStorage-mirror fallback so tools can wire
 * saving before the IndexedDB layer lands. A8 replaces the internals with the
 * real IDB store (media blobs, projects, export) in Phase 2.
 */
import type { Measurement } from '../types';

export interface SavedEntry {
  measurement: Measurement;
  note?: string;
  project?: string;
}

type Listener = (entries: readonly SavedEntry[]) => void;

const KEY = 'square.log.v0';
let entries: SavedEntry[] | null = null;
const listeners = new Set<Listener>();

function load(): SavedEntry[] {
  if (entries) return entries;
  try {
    entries = JSON.parse(localStorage.getItem(KEY) ?? '[]') as SavedEntry[];
  } catch {
    entries = [];
  }
  return entries;
}

function persist(): void {
  try { localStorage.setItem(KEY, JSON.stringify(entries ?? [])); } catch { /* quota/private mode */ }
  for (const fn of listeners) fn(entries ?? []);
}

/** Save a measurement with optional note/project. Resolves when durably queued. */
export async function saveMeasurement(m: Measurement, opts: { note?: string; project?: string } = {}): Promise<void> {
  const list = load();
  const entry: SavedEntry = { measurement: m };
  if (opts.note !== undefined) entry.note = opts.note;
  if (opts.project !== undefined) entry.project = opts.project;
  list.push(entry);
  persist();
}

export async function listMeasurements(): Promise<readonly SavedEntry[]> {
  return load();
}

export async function deleteMeasurement(id: string): Promise<void> {
  const list = load();
  const i = list.findIndex((e) => e.measurement.id === id);
  if (i >= 0) { list.splice(i, 1); persist(); }
}

export async function deleteAll(): Promise<void> {
  entries = [];
  persist();
}

/** Subscribe to changes; returns unsubscribe. Fires immediately with current. */
export function subscribeLog(fn: Listener): () => void {
  listeners.add(fn);
  fn(load());
  return () => listeners.delete(fn);
}
