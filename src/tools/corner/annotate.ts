/**
 * Annotated-photo builder + local media stash for CORNER — SPEC §4.3.4:
 * save the photo with the marks, the angle, and the ± burned in. The photo
 * never leaves the device: the blob goes into a small IndexedDB stash and
 * the Measurement carries only the photoId (src/types.ts media contract).
 *
 * NOTE for the lead / A8: the log seam (src/app/logStore.ts) has no media
 * API yet, so this stash is tool-local on purpose — one DB, one store, keyed
 * by photoId — and can be migrated behind A8's wrapper without touching the
 * Measurement records, which only know the id.
 */
import type { Px } from '../../geometry/angleSolver';

const DB_NAME = 'square.corner.media.v1';
const STORE = 'photos';

/** Draw marks + label onto a copy of the working canvas. ctx-less environments get the bare copy. */
export function annotateCanvas(
  source: HTMLCanvasElement,
  quad: readonly Px[],
  labelLines: readonly string[],
): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = source.width;
  out.height = source.height;
  const ctx = out.getContext('2d');
  if (!ctx) return out;
  ctx.drawImage(source, 0, 0);

  const s = Math.max(2, Math.round(source.width / 480));

  // Edge families from the corner, then the far sides, then the marks.
  if (quad.length === 4) {
    ctx.strokeStyle = '#F15A22';
    ctx.lineWidth = s;
    ctx.beginPath();
    const order = [0, 1, 2, 3, 0];
    for (let i = 0; i < order.length; i++) {
      const p = quad[order[i]!]!;
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }
  for (const [i, p] of quad.entries()) {
    ctx.fillStyle = i === 0 ? '#F15A22' : '#FFFFFF';
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = Math.max(1, s / 2);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // Label block, top-left, flat card — Draplin: hard edges, no soft anything.
  const fontPx = 10 * s;
  ctx.font = `${fontPx}px monospace`;
  const pad = 4 * s;
  const widest = labelLines.reduce((m, l) => Math.max(m, ctx.measureText(l).width), 0);
  ctx.fillStyle = '#1A1A1A';
  ctx.fillRect(0, 0, widest + pad * 2, labelLines.length * (fontPx + pad / 2) + pad * 1.5);
  ctx.fillStyle = '#F1F2F2';
  labelLines.forEach((line, i) => {
    ctx.fillText(line, pad, pad + fontPx * (i + 1) + (pad / 2) * i);
  });
  return out;
}

/** canvas.toBlob as a promise; null where canvas export is unsupported. */
export function canvasBlob(canvas: HTMLCanvasElement, type = 'image/jpeg', quality = 0.9): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((b) => resolve(b), type, quality);
    } catch {
      resolve(null);
    }
  });
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

let idSeq = 0;

/** Store a photo blob locally; returns its photoId, or null when storage is unavailable. */
export async function stashPhoto(blob: Blob): Promise<string | null> {
  const db = await openDb();
  if (!db) return null;
  const photoId = `corner-${Date.now().toString(36)}-${(idSeq++).toString(36)}`;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(blob, photoId);
      tx.oncomplete = () => {
        db.close();
        resolve(photoId);
      };
      tx.onerror = () => {
        db.close();
        resolve(null);
      };
    } catch {
      db.close();
      resolve(null);
    }
  });
}

/** Fetch a stashed photo (LOG integration point). */
export async function loadPhoto(photoId: string): Promise<Blob | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(photoId);
      req.onsuccess = () => {
        db.close();
        resolve((req.result as Blob | undefined) ?? null);
      };
      req.onerror = () => {
        db.close();
        resolve(null);
      };
    } catch {
      db.close();
      resolve(null);
    }
  });
}

/** a[download] via object URL — also used by SELF-TEST trace export. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
