/**
 * Export/import — SPEC §4.7. JSON round-trips at full fidelity including
 * media bytes; CSV is flat and documents exactly what it drops; import
 * validates, states its reasons, and never overwrites existing entries.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  __resetLogStoreForTests,
  getMedia,
  listMeasurements,
  saveMeasurement,
  saveMedia,
} from '../../src/app/logStore';
import {
  base64ToBytes,
  bytesToBase64,
  CSV_COLUMNS,
  CSV_DROPS,
  entryProblem,
  EXPORT_SCHEMA,
  exportCsv,
  exportFilename,
  exportJson,
  importJson,
  type ExportEnvelope,
} from '../../src/tools/log/exporter';
import type { Measurement } from '../../src/types';

function meas(over: Partial<Measurement> = {}): Measurement {
  return {
    id: 'm1',
    kind: 'stud',
    value: 16.02,
    unit: 'in',
    uncertainty: { plusMinus: 0.25, basis: 'stddev' },
    confidence: 'STRONG',
    provenance: {
      tier: 'FIELD',
      calibrations: { mag: { ok: true, ageMs: 60_000 } },
      sampleCount: 480,
      capturedAt: 1_700_000_000_000,
    },
    ...over,
  };
}

beforeEach(() => {
  __resetLogStoreForTests();
});

afterEach(() => {
  __resetLogStoreForTests();
});

describe('base64 helpers', () => {
  it('round-trips arbitrary bytes, including lengths that need padding', () => {
    for (const len of [0, 1, 2, 3, 4, 5, 255, 256, 1000]) {
      const bytes = new Uint8Array(len).map((_, i) => (i * 37 + len) % 256);
      const b64 = bytesToBase64(bytes);
      expect(base64ToBytes(b64)).toEqual(bytes);
    }
  });

  it('matches the platform encoder', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
  });

  it('rejects strings that are not base64', () => {
    expect(() => base64ToBytes('not base64!!')).toThrow(/base64/);
    expect(() => base64ToBytes('abc')).toThrow(/base64/); // bad length
  });
});

describe('JSON export/import round-trip', () => {
  it('round-trips entries and media bytes at full fidelity, with new ids', async () => {
    const photoBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]); // JPEG-ish
    await saveMedia('p1', new Blob([photoBytes.buffer as ArrayBuffer], { type: 'image/jpeg' }));
    await saveMeasurement(meas({ id: 'a', media: { photoId: 'p1' } }), { note: 'stud line', project: 'kitchen' });
    await saveMeasurement(
      meas({
        id: 'b',
        kind: 'angle',
        value: 88.4,
        unit: '°',
        uncertainty: { plusMinus: 0.6, basis: 'montecarlo' },
        confidence: 'LIKELY',
      }),
    );

    const json = await exportJson();
    const envelope = JSON.parse(json) as ExportEnvelope;
    expect(envelope.schema).toBe(EXPORT_SCHEMA);
    expect(envelope.entries).toHaveLength(2);
    expect(envelope.media).toHaveLength(1);

    // fresh phone
    __resetLogStoreForTests();
    const result = await importJson(json);
    expect(result.imported).toBe(2);
    expect(result.skipped).toEqual([]);
    expect(result.warnings).toEqual([]);

    const list = await listMeasurements();
    expect(list).toHaveLength(2);
    const a = list.find((e) => e.note === 'stud line')!;
    expect(a.measurement.id).not.toBe('a'); // new id on import — never overwrite
    expect(a.project).toBe('kitchen');
    expect(a.measurement.value).toBe(16.02);
    expect(a.measurement.uncertainty).toEqual({ plusMinus: 0.25, basis: 'stddev' });
    expect(a.measurement.provenance.calibrations['mag']).toEqual({ ok: true, ageMs: 60_000 });

    const newPhotoId = a.measurement.media?.photoId;
    expect(newPhotoId).toBeDefined();
    expect(newPhotoId).not.toBe('p1'); // media remapped alongside the entry
    const blob = await getMedia(newPhotoId!);
    expect(blob?.type).toBe('image/jpeg');
    expect(new Uint8Array(await blob!.arrayBuffer())).toEqual(photoBytes);
  });

  it('importing the same file twice duplicates nothing over itself — every entry lands fresh', async () => {
    await saveMeasurement(meas({ id: 'a' }));
    const json = await exportJson();
    await importJson(json);
    await importJson(json);
    const list = await listMeasurements();
    expect(list).toHaveLength(3); // original + two imported copies with distinct ids
    expect(new Set(list.map((e) => e.measurement.id)).size).toBe(3);
  });

  it('a non-finite ± (basis unknown) survives the trip as NaN, not 0', async () => {
    await saveMeasurement(meas({ id: 'a', uncertainty: { plusMinus: NaN, basis: 'unknown' } }));
    const json = await exportJson();
    __resetLogStoreForTests();
    await importJson(json);
    const e = (await listMeasurements())[0]!;
    expect(Number.isNaN(e.measurement.uncertainty.plusMinus)).toBe(true);
    expect(e.measurement.uncertainty.basis).toBe('unknown');
  });
});

describe('import validation — stated reasons, no guessing', () => {
  it('rejects non-JSON and wrong schemas with stated reasons', async () => {
    await expect(importJson('not json at all')).rejects.toThrow(/Not a JSON file/);
    await expect(importJson('{"schema":"square.log/999","entries":[]}')).rejects.toThrow(/Unknown schema 'square.log\/999'/);
    await expect(importJson('{"schema":"square.log/1"}')).rejects.toThrow(/no entries array/);
    await expect(importJson('[1,2,3]')).rejects.toThrow(/no envelope/);
  });

  it('skips invalid entries with per-entry reasons and imports the rest', async () => {
    const envelope = {
      schema: EXPORT_SCHEMA,
      exportedAt: 0,
      entries: [
        { measurement: meas({ id: 'ok' }) },
        { measurement: { ...meas({ id: 'bad' }), unit: '' } },
        { measurement: { ...meas({ id: 'bad2' }), confidence: 'GREAT' } },
        'not an entry',
      ],
      media: [],
    };
    const result = await importJson(JSON.stringify(envelope));
    expect(result.imported).toBe(1);
    expect(result.skipped).toEqual([
      { index: 1, reason: 'unit missing — a bare number has no render path' },
      { index: 2, reason: "unknown confidence 'GREAT'" },
      { index: 3, reason: 'entry is not an object' },
    ]);
  });

  it('warns and imports without the photo when the media blob is missing from the file', async () => {
    const envelope = {
      schema: EXPORT_SCHEMA,
      exportedAt: 0,
      entries: [{ measurement: meas({ id: 'a', media: { photoId: 'ghost' } }) }],
      media: [],
    };
    const result = await importJson(JSON.stringify(envelope));
    expect(result.imported).toBe(1);
    expect(result.warnings).toEqual(["entry 0: photo 'ghost' is not in the file — imported without it"]);
    const e = (await listMeasurements())[0]!;
    expect(e.measurement.media?.photoId).toBeUndefined();
  });

  it('entryProblem pins the closed unions — an ad-hoc kind does not import', () => {
    expect(entryProblem({ measurement: meas() })).toBeNull();
    expect(entryProblem({ measurement: { ...meas(), kind: 'vibes' } })).toMatch(/unknown kind/);
    expect(entryProblem({ measurement: { ...meas(), uncertainty: undefined } })).toMatch(/uncertainty missing/);
    expect(entryProblem({ measurement: { ...meas(), provenance: undefined } })).toMatch(/provenance missing/);
  });
});

describe('CSV export — flat, escaped, honestly lossy', () => {
  it('emits the documented columns and ISO timestamps', async () => {
    await saveMeasurement(meas({ id: 'a' }), { note: 'first', project: 'kitchen' });
    const csv = await exportCsv();
    const [header, row] = csv.trimEnd().split('\r\n');
    expect(header).toBe('kind,value,unit,plusMinus,confidence,capturedAt,note,project');
    expect(header).toBe(CSV_COLUMNS.join(','));
    expect(row).toBe('stud,16.02,in,0.25,STRONG,2023-11-14T22:13:20.000Z,first,kitchen');
  });

  it('escapes commas, quotes, and newlines in notes', async () => {
    await saveMeasurement(meas({ id: 'a' }), { note: 'says "16 in, roughly"\nsecond line' });
    const csv = await exportCsv();
    expect(csv).toContain('"says ""16 in, roughly""\nsecond line"');
  });

  it('leaves plusMinus empty for a non-finite ± instead of inventing a number', async () => {
    await saveMeasurement(meas({ id: 'a', uncertainty: { plusMinus: NaN, basis: 'unknown' } }));
    const csv = await exportCsv();
    const row = csv.trimEnd().split('\r\n')[1]!;
    expect(row.split(',')[3]).toBe('');
  });

  it('documents its lossiness: no id, basis, provenance, photo, or overlay columns', () => {
    for (const dropped of ['id', 'basis', 'tier', 'photo', 'overlay', 'sampleCount', 'calibration']) {
      expect((CSV_COLUMNS as readonly string[]).includes(dropped)).toBe(false);
    }
    expect(CSV_DROPS).toMatch(/drops ids/);
    expect(CSV_DROPS).toMatch(/JSON/);
  });
});

describe('filenames', () => {
  it('stamps the date and extension', () => {
    expect(exportFilename('json')).toMatch(/^square-log-\d{4}-\d{2}-\d{2}\.json$/);
    expect(exportFilename('csv')).toMatch(/^square-log-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});
