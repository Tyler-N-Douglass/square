/**
 * logStore over the memory backend (node has no IndexedDB, which IS the
 * fallback path): stable Phase 1 contract, v0 localStorage migration, media
 * cascade, soft-delete/undo state machine (SPEC §7B.9), and delete-all that
 * spares calibration (SPEC §4.7).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetLogStoreForTests,
  backendMode,
  deleteAll,
  deleteMeasurement,
  getMedia,
  listMeasurements,
  mediaObjectUrls,
  pendingDeleted,
  saveMeasurement,
  saveMedia,
  softDeleteMeasurement,
  subscribeLog,
  undoDelete,
  updateEntry,
  type SavedEntry,
} from '../../src/app/logStore';
import type { Measurement } from '../../src/types';

function meas(over: Partial<Measurement> = {}): Measurement {
  return {
    id: over.id ?? `m-${Math.random().toString(36).slice(2)}`,
    kind: 'level',
    value: 1.2,
    unit: '°',
    uncertainty: { plusMinus: 0.5, basis: 'nominal' },
    confidence: 'LIKELY',
    provenance: { tier: 'NONE', calibrations: {}, sampleCount: 60, capturedAt: 1000 },
    ...over,
  };
}

/** Minimal localStorage stub — enough for the v0 migration path. */
function stubLocalStorage(initial: Record<string, string> = {}): Map<string, string> {
  const m = new Map(Object.entries(initial));
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
  return m;
}

beforeEach(() => {
  __resetLogStoreForTests();
});

afterEach(() => {
  __resetLogStoreForTests();
  delete (globalThis as { localStorage?: unknown }).localStorage;
  vi.useRealTimers();
});

describe('stable Phase 1 contract', () => {
  it('saveMeasurement / listMeasurements round-trips with note and project', async () => {
    const m = meas({ id: 'a' });
    await saveMeasurement(m, { note: 'behind the couch', project: 'living room' });
    const list = await listMeasurements();
    expect(list).toHaveLength(1);
    expect(list[0]!.measurement.id).toBe('a');
    expect(list[0]!.note).toBe('behind the couch');
    expect(list[0]!.project).toBe('living room');
  });

  it('omitted note/project stay absent, not undefined-valued', async () => {
    await saveMeasurement(meas({ id: 'a' }));
    const e = (await listMeasurements())[0]!;
    expect('note' in e).toBe(false);
    expect('project' in e).toBe(false);
  });

  it('lists entries in capture order', async () => {
    await saveMeasurement(meas({ id: 'late', provenance: { tier: 'NONE', calibrations: {}, sampleCount: 1, capturedAt: 3000 } }));
    await saveMeasurement(meas({ id: 'early', provenance: { tier: 'NONE', calibrations: {}, sampleCount: 1, capturedAt: 1000 } }));
    expect((await listMeasurements()).map((e) => e.measurement.id)).toEqual(['early', 'late']);
  });

  it('subscribeLog fires immediately, then again after the store warms', async () => {
    await saveMeasurement(meas({ id: 'a' })); // warm + populate
    __resetLogStoreForTests.call(undefined); // cold module, data gone with memory backend — reseed via v0 to test warm notify
    stubLocalStorage({ 'square.log.v0': JSON.stringify([{ measurement: meas({ id: 'v0-a' }) }]) });

    const seen: number[] = [];
    const unsub = subscribeLog((entries) => seen.push(entries.length));
    expect(seen).toEqual([0]); // immediate, pre-warm
    await listMeasurements(); // forces warm to finish
    expect(seen[seen.length - 1]).toBe(1); // warm notify carried the migrated entry
    unsub();
  });

  it('deleteMeasurement removes one entry and notifies', async () => {
    await saveMeasurement(meas({ id: 'a' }));
    await saveMeasurement(meas({ id: 'b' }));
    await deleteMeasurement('a');
    expect((await listMeasurements()).map((e) => e.measurement.id)).toEqual(['b']);
  });

  it('runs on the memory backend here — the visible fallback path', async () => {
    expect(await backendMode()).toBe('memory');
  });
});

describe('v0 localStorage migration', () => {
  it('moves square.log.v0 entries into the store and clears the key', async () => {
    const ls = stubLocalStorage({
      'square.log.v0': JSON.stringify([
        { measurement: meas({ id: 'v0-1' }), note: 'from the stub era' },
        { measurement: meas({ id: 'v0-2' }), project: 'garage' },
      ]),
    });
    const list = await listMeasurements();
    expect(list.map((e) => e.measurement.id).sort()).toEqual(['v0-1', 'v0-2']);
    expect(list.find((e) => e.measurement.id === 'v0-1')?.note).toBe('from the stub era');
    expect(ls.has('square.log.v0')).toBe(false); // old key cleared after migration
  });

  it('skips malformed items but keeps the valid ones', async () => {
    stubLocalStorage({
      'square.log.v0': JSON.stringify([{ measurement: meas({ id: 'ok' }) }, { junk: true }, null, 42]),
    });
    expect((await listMeasurements()).map((e) => e.measurement.id)).toEqual(['ok']);
  });

  it('leaves a corrupt v0 blob in place — no silent destruction of unreadable data', async () => {
    const ls = stubLocalStorage({ 'square.log.v0': '{not json' });
    expect(await listMeasurements()).toEqual([]);
    expect(ls.get('square.log.v0')).toBe('{not json');
  });
});

describe('media blobs', () => {
  it('saveMedia / getMedia round-trips bytes', async () => {
    await saveMedia('p1', new Blob(['photo-bytes'], { type: 'image/jpeg' }));
    const blob = await getMedia('p1');
    expect(blob).not.toBeNull();
    expect(blob!.type).toBe('image/jpeg');
    expect(await blob!.text()).toBe('photo-bytes');
    expect(await getMedia('missing')).toBeNull();
  });

  it('deleteMeasurement cascades to the referenced photo blob', async () => {
    await saveMedia('p1', new Blob(['x'], { type: 'image/jpeg' }));
    await saveMeasurement(meas({ id: 'a', media: { photoId: 'p1' } }));
    await deleteMeasurement('a');
    expect(await getMedia('p1')).toBeNull();
  });

  it('mediaObjectUrls creates once per id and revokes on revokeAll', async () => {
    await saveMedia('p1', new Blob(['x'], { type: 'image/jpeg' }));
    const urls = mediaObjectUrls();
    const u1 = await urls.url('p1');
    const u2 = await urls.url('p1');
    expect(u1).toMatch(/^blob:/);
    expect(u2).toBe(u1); // cached, not re-created
    expect(await urls.url('missing')).toBeNull();
    urls.revokeAll();
    expect(await urls.url('p1')).toBeNull(); // revoked helpers hand out nothing
  });
});

describe('soft delete with undo window (SPEC §7B.9)', () => {
  it('hides the entry immediately but keeps it restorable', async () => {
    await saveMeasurement(meas({ id: 'a' }));
    vi.useFakeTimers();
    expect(await softDeleteMeasurement('a')).toBe(true);
    expect(await listMeasurements()).toEqual([]);
    expect(pendingDeleted().map((e) => e.measurement.id)).toEqual(['a']);

    const restored = await undoDelete();
    expect(restored?.measurement.id).toBe('a');
    expect((await listMeasurements()).map((e) => e.measurement.id)).toEqual(['a']);
    expect(pendingDeleted()).toEqual([]);
  });

  it('commits the delete (with media cascade) after the grace window', async () => {
    await saveMedia('p1', new Blob(['x'], { type: 'image/jpeg' }));
    await saveMeasurement(meas({ id: 'a', media: { photoId: 'p1' } }));
    vi.useFakeTimers();
    await softDeleteMeasurement('a');
    await vi.advanceTimersByTimeAsync(10_001);
    expect(pendingDeleted()).toEqual([]);
    expect(await listMeasurements()).toEqual([]);
    expect(await getMedia('p1')).toBeNull(); // cascade committed with the entry
  });

  it('undo after the window is a no-op — the entry is gone', async () => {
    await saveMeasurement(meas({ id: 'a' }));
    vi.useFakeTimers();
    await softDeleteMeasurement('a');
    await vi.advanceTimersByTimeAsync(10_001);
    expect(await undoDelete()).toBeNull();
    expect(await listMeasurements()).toEqual([]);
  });

  it('undoDelete with no id restores the most recent pending delete', async () => {
    await saveMeasurement(meas({ id: 'a' }));
    await saveMeasurement(meas({ id: 'b', provenance: { tier: 'NONE', calibrations: {}, sampleCount: 1, capturedAt: 2000 } }));
    vi.useFakeTimers();
    await softDeleteMeasurement('a');
    await softDeleteMeasurement('b');
    expect((await undoDelete())?.measurement.id).toBe('b'); // restore last
    expect((await undoDelete())?.measurement.id).toBe('a');
  });

  it('soft-deleting an unknown or already-pending id returns false', async () => {
    await saveMeasurement(meas({ id: 'a' }));
    vi.useFakeTimers();
    expect(await softDeleteMeasurement('nope')).toBe(false);
    expect(await softDeleteMeasurement('a')).toBe(true);
    expect(await softDeleteMeasurement('a')).toBe(false);
  });

  it('notifies subscribers on soft delete and on undo', async () => {
    await saveMeasurement(meas({ id: 'a' }));
    vi.useFakeTimers();
    const counts: number[] = [];
    const unsub = subscribeLog((entries) => counts.push(entries.length));
    await softDeleteMeasurement('a');
    await undoDelete();
    expect(counts).toEqual([1, 0, 1]);
    unsub();
  });
});

describe('entry editing', () => {
  it('updateEntry sets and clears note/project; empty string clears', async () => {
    await saveMeasurement(meas({ id: 'a' }), { note: 'old', project: 'kitchen' });
    const next = await updateEntry('a', { note: 'new note', project: '' });
    expect(next?.note).toBe('new note');
    expect(next && 'project' in next).toBe(false);
    const listed = (await listMeasurements())[0]!;
    expect(listed.note).toBe('new note');
    expect('project' in listed).toBe(false);
  });

  it('updateEntry on an unknown id returns null and changes nothing', async () => {
    expect(await updateEntry('ghost', { note: 'x' })).toBeNull();
  });
});

describe('delete-all cascade spares calibration (SPEC §4.7)', () => {
  it('wipes measurements and media, leaves calibration and guidance state alone', async () => {
    const ls = stubLocalStorage({
      'square.calibration.v1': JSON.stringify({ deviceKey: 'test', updatedAt: 123 }),
      'square.guide.log': JSON.stringify({ runs: 4, dismissedSteps: [], guideDismissed: false }),
    });
    await saveMedia('p1', new Blob(['x'], { type: 'image/jpeg' }));
    await saveMeasurement(meas({ id: 'a', media: { photoId: 'p1' } }));
    await saveMeasurement(meas({ id: 'b' }));

    await deleteAll();

    expect(await listMeasurements()).toEqual([]);
    expect(await getMedia('p1')).toBeNull();
    // calibration has its own home in CALIBRATE — untouched
    expect(ls.get('square.calibration.v1')).toBe(JSON.stringify({ deviceKey: 'test', updatedAt: 123 }));
    // guidance memory is not log data — untouched
    expect(ls.has('square.guide.log')).toBe(true);
  });

  it('cancels pending soft deletes rather than leaving zombie timers', async () => {
    await saveMeasurement(meas({ id: 'a' }));
    vi.useFakeTimers();
    await softDeleteMeasurement('a');
    await deleteAll();
    expect(pendingDeleted()).toEqual([]);
    await vi.advanceTimersByTimeAsync(20_000); // nothing should throw or resurrect
    expect(await listMeasurements()).toEqual([]);
  });
});

describe('a parallel-agent caller sees the same seam it had in Phase 1', () => {
  it('save → subscribe → delete flow matches the stub-era shape', async () => {
    const events: Array<readonly SavedEntry[]> = [];
    const unsub = subscribeLog((e) => events.push(e));
    await saveMeasurement(meas({ id: 'x' }), { note: 'n' });
    await deleteMeasurement('x');
    expect(events[0]).toEqual([]); // immediate fire
    expect(events.some((e) => e.length === 1 && e[0]!.measurement.id === 'x')).toBe(true);
    expect(events[events.length - 1]).toEqual([]);
    unsub();
  });
});
