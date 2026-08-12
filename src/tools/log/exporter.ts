/**
 * LOG export / import — SPEC §4.7. All through the logStore seam; no direct
 * backend access, no libraries.
 *
 * Formats:
 *   JSON  full fidelity: every SavedEntry field plus photo blobs as base64,
 *         wrapped in a versioned envelope { schema: 'square.log/1' }. The
 *         only format import accepts.
 *   CSV   flat rows for spreadsheets: kind, value, unit, plusMinus,
 *         confidence, capturedAt (ISO 8601), note, project. Lossy by design —
 *         see CSV_DROPS for exactly what it drops.
 *
 * Import policy: every imported entry gets a NEW id (and its photo a new
 * media id) — importing can never silently overwrite what is already on the
 * phone. Invalid entries are skipped with stated reasons, never guessed at.
 */
import {
  getMedia,
  listMeasurements,
  saveMeasurement,
  saveMedia,
  type SavedEntry,
} from '../../app/logStore';
import type { Confidence, MagTier, Measurement, UncertaintyBasis } from '../../types';

export const EXPORT_SCHEMA = 'square.log/1';

export interface ExportMediaItem {
  id: string;
  type: string;
  base64: string;
}

export interface ExportEnvelope {
  schema: typeof EXPORT_SCHEMA;
  exportedAt: number;
  entries: SavedEntry[];
  media: ExportMediaItem[];
}

/* ------------------------------------------------------------------ */
/* base64 — hand-rolled, byte-exact                                    */
/* ------------------------------------------------------------------ */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_REV = new Map<string, number>([...B64].map((c, i) => [c, i]));

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    out += B64[a >> 2]! + B64[((a & 3) << 4) | (b >> 4)]!;
    out += i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)]! : '=';
    out += i + 2 < bytes.length ? B64[c & 63]! : '=';
  }
  return out;
}

export function base64ToBytes(s: string): Uint8Array {
  if (s.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(s) || /=[^=]/.test(s.replace(/==$/, '='))) {
    throw new Error('not valid base64');
  }
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  const clean = s.slice(0, s.length - pad);
  const out = new Uint8Array((s.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (lookup(clean[i]) << 18) |
      (lookup(clean[i + 1]) << 12) |
      (i + 2 < clean.length ? lookup(clean[i + 2]) << 6 : 0) |
      (i + 3 < clean.length ? lookup(clean[i + 3]) : 0);
    out[o++] = (n >> 16) & 0xff;
    if (o < out.length) out[o++] = (n >> 8) & 0xff;
    if (o < out.length) out[o++] = n & 0xff;
  }
  return out;
}

function lookup(c: string | undefined): number {
  const v = c === undefined ? undefined : B64_REV.get(c);
  if (v === undefined) throw new Error('not valid base64');
  return v;
}

/* ------------------------------------------------------------------ */
/* JSON export                                                         */
/* ------------------------------------------------------------------ */

/**
 * Full-fidelity JSON. A non-finite plusMinus (basis 'unknown') survives the
 * trip as null — JSON has no NaN — and import restores it to NaN.
 */
export async function exportJson(): Promise<string> {
  const entries = [...(await listMeasurements())];
  const media: ExportMediaItem[] = [];
  for (const e of entries) {
    const photoId = e.measurement.media?.photoId;
    if (photoId === undefined) continue;
    const blob = await getMedia(photoId);
    if (blob === null) continue; // dangling reference: entry still exports, photo honestly absent
    media.push({ id: photoId, type: blob.type, base64: bytesToBase64(new Uint8Array(await blob.arrayBuffer())) });
  }
  const envelope: ExportEnvelope = { schema: EXPORT_SCHEMA, exportedAt: Date.now(), entries, media };
  return JSON.stringify(envelope, (_k, v: unknown) => (typeof v === 'number' && !Number.isFinite(v) ? null : v), 2);
}

/* ------------------------------------------------------------------ */
/* JSON import — validate, remap ids, never overwrite                  */
/* ------------------------------------------------------------------ */

export interface ImportResult {
  imported: number;
  /** New ids assigned to the imported entries, in file order. */
  ids: string[];
  skipped: Array<{ index: number; reason: string }>;
  warnings: string[];
}

const KINDS = new Set<Measurement['kind']>(['stud', 'angle', 'level', 'plumb', 'corner', 'layout', 'bevel']);
const BASES = new Set<UncertaintyBasis>(['montecarlo', 'stddev', 'nominal', 'unknown']);
const CONFIDENCES = new Set<Confidence>(['STRONG', 'LIKELY', 'POSSIBLE', 'NOISE', 'UNRELIABLE']);
const TIERS = new Set<MagTier>(['FIELD', 'PROXY', 'NONE']);

function isRecord(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

/** Why this is not a valid entry, or null when it is. */
export function entryProblem(x: unknown): string | null {
  if (!isRecord(x)) return 'entry is not an object';
  const m = x['measurement'];
  if (!isRecord(m)) return 'no measurement object';
  if (typeof m['id'] !== 'string' || m['id'] === '') return 'measurement.id missing';
  if (typeof m['kind'] !== 'string' || !KINDS.has(m['kind'] as Measurement['kind'])) return `unknown kind '${String(m['kind'])}'`;
  if (typeof m['value'] !== 'number') return 'value is not a number';
  if (typeof m['unit'] !== 'string' || m['unit'].trim() === '') return 'unit missing — a bare number has no render path';
  const u = m['uncertainty'];
  if (!isRecord(u)) return 'uncertainty missing — a bare number has no render path';
  if (typeof u['plusMinus'] !== 'number' && u['plusMinus'] !== null) return 'uncertainty.plusMinus is not a number';
  if (typeof u['basis'] !== 'string' || !BASES.has(u['basis'] as UncertaintyBasis)) return `unknown uncertainty basis '${String(u['basis'])}'`;
  if (typeof m['confidence'] !== 'string' || !CONFIDENCES.has(m['confidence'] as Confidence)) return `unknown confidence '${String(m['confidence'])}'`;
  const p = m['provenance'];
  if (!isRecord(p)) return 'provenance missing';
  if (typeof p['tier'] !== 'string' || !TIERS.has(p['tier'] as MagTier)) return `unknown tier '${String(p['tier'])}'`;
  if (!isRecord(p['calibrations'])) return 'provenance.calibrations missing';
  if (typeof p['sampleCount'] !== 'number') return 'provenance.sampleCount is not a number';
  if (typeof p['capturedAt'] !== 'number') return 'provenance.capturedAt is not a number';
  if (x['note'] !== undefined && typeof x['note'] !== 'string') return 'note is not a string';
  if (x['project'] !== undefined && typeof x['project'] !== 'string') return 'project is not a string';
  const media = m['media'];
  if (media !== undefined) {
    if (!isRecord(media)) return 'media is not an object';
    if (media['photoId'] !== undefined && typeof media['photoId'] !== 'string') return 'media.photoId is not a string';
  }
  return null;
}

function newId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `imp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Import a square.log/1 JSON export. Rejects (throws) with a stated reason
 * when the file itself is not a valid envelope; skips invalid entries with
 * per-entry reasons. Every accepted entry and photo gets a fresh id — an
 * import never overwrites existing data.
 */
export async function importJson(json: string): Promise<ImportResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Not a JSON file — export files are JSON with schema square.log/1.');
  }
  if (!isRecord(parsed)) throw new Error('Not a SQUARE export — the file has no envelope object.');
  if (parsed['schema'] !== EXPORT_SCHEMA) {
    throw new Error(`Unknown schema '${String(parsed['schema'])}' — this build imports ${EXPORT_SCHEMA}.`);
  }
  if (!Array.isArray(parsed['entries'])) throw new Error('Envelope has no entries array.');
  const mediaList = Array.isArray(parsed['media']) ? (parsed['media'] as unknown[]) : [];
  const mediaById = new Map<string, ExportMediaItem>();
  for (const item of mediaList) {
    if (isRecord(item) && typeof item['id'] === 'string' && typeof item['base64'] === 'string') {
      mediaById.set(item['id'], {
        id: item['id'],
        type: typeof item['type'] === 'string' ? item['type'] : 'application/octet-stream',
        base64: item['base64'],
      });
    }
  }

  const result: ImportResult = { imported: 0, ids: [], skipped: [], warnings: [] };

  for (const [index, raw] of (parsed['entries'] as unknown[]).entries()) {
    const problem = entryProblem(raw);
    if (problem !== null) {
      result.skipped.push({ index, reason: problem });
      continue;
    }
    const entry = raw as SavedEntry & { measurement: { uncertainty: { plusMinus: number | null } } };
    const id = newId();
    const m: Measurement = structuredClone(entry.measurement) as Measurement;
    m.id = id;
    if ((m.uncertainty.plusMinus as number | null) === null) m.uncertainty.plusMinus = NaN;

    const photoId = m.media?.photoId;
    if (photoId !== undefined) {
      const item = mediaById.get(photoId);
      if (item === undefined) {
        result.warnings.push(`entry ${index}: photo '${photoId}' is not in the file — imported without it`);
        delete m.media!.photoId;
      } else {
        let bytes: Uint8Array;
        try {
          bytes = base64ToBytes(item.base64);
        } catch {
          result.warnings.push(`entry ${index}: photo '${photoId}' is corrupt base64 — imported without it`);
          delete m.media!.photoId;
          bytes = new Uint8Array(0);
        }
        if (m.media!.photoId !== undefined) {
          const newPhotoId = newId();
          await saveMedia(newPhotoId, new Blob([bytes.buffer as ArrayBuffer], { type: item.type }));
          m.media!.photoId = newPhotoId;
        }
      }
    }

    const opts: { note?: string; project?: string } = {};
    if (entry.note !== undefined) opts.note = entry.note;
    if (entry.project !== undefined) opts.project = entry.project;
    await saveMeasurement(m, opts);
    result.imported += 1;
    result.ids.push(id);
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* CSV export — flat and lossy on purpose                              */
/* ------------------------------------------------------------------ */

export const CSV_COLUMNS = ['kind', 'value', 'unit', 'plusMinus', 'confidence', 'capturedAt', 'note', 'project'] as const;

/** The honest statement of what CSV drops. Shown next to the CSV button. */
export const CSV_DROPS =
  'CSV keeps kind, value, unit, ±, confidence, time, note, and project. ' +
  'It drops ids, the uncertainty basis, tier and calibration provenance, sample counts, photos, and overlays. ' +
  'Export JSON for a full copy — import reads JSON only.';

function csvField(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v;
}

export async function exportCsv(): Promise<string> {
  const rows: string[] = [CSV_COLUMNS.join(',')];
  for (const e of await listMeasurements()) {
    const m = e.measurement;
    rows.push(
      [
        m.kind,
        String(m.value),
        m.unit,
        Number.isFinite(m.uncertainty.plusMinus) ? String(m.uncertainty.plusMinus) : '',
        m.confidence,
        new Date(m.provenance.capturedAt).toISOString(),
        e.note ?? '',
        e.project ?? '',
      ]
        .map(csvField)
        .join(','),
    );
  }
  return rows.join('\r\n') + '\r\n';
}

/* ------------------------------------------------------------------ */
/* download helper — object URLs, no libs                              */
/* ------------------------------------------------------------------ */

export function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the click's navigation can read the blob first.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** square-log-2026-08-12.json style stamps. */
export function exportFilename(ext: 'json' | 'csv'): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  return `square-log-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.${ext}`;
}
