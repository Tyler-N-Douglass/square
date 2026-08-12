// @vitest-environment happy-dom
/**
 * LOG tool UI (SPEC §4.7): entries render through the provenance components
 * (value + unit + ±/confidence, always — §15.1), the memory fallback is
 * visible (§15.4), delete is soft with an undo window (§7B.9), and delete-all
 * is a two-step confirm that spares calibration.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mount } from '../../src/tools/log/index';
import {
  __resetLogStoreForTests,
  listMeasurements,
  pendingDeleted,
  saveMeasurement,
  saveMedia,
} from '../../src/app/logStore';
import type { AppContext } from '../../src/app/router';
import type { CapabilityReport } from '../../src/sensors/types';
import type { Measurement } from '../../src/types';

const cap: CapabilityReport = {
  magTier: 'NONE',
  hasAccel: false,
  hasGyro: false,
  hasAbsoluteOrientation: false,
  hasCamera: false,
  cameraCount: 0,
  hasVibrate: false,
  hasWakeLock: false,
  hasOffscreenCanvas: false,
  secureContext: true,
  permissionsPolicyOk: true,
  platformHint: 'desktop',
  sampleRates: {},
  blockers: [],
};
const ctx: AppContext = { capability: cap, replayTrace: null };

function meas(over: Partial<Measurement> = {}): Measurement {
  return {
    id: over.id ?? `m-${Math.random().toString(36).slice(2)}`,
    kind: 'stud',
    value: 16.02,
    unit: 'in',
    uncertainty: { plusMinus: 0.25, basis: 'stddev' },
    confidence: 'STRONG',
    provenance: {
      tier: 'FIELD',
      calibrations: { mag: { ok: true, ageMs: 120_000 } },
      sampleCount: 480,
      capturedAt: 1_700_000_000_000,
    },
    ...over,
  };
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

let host: HTMLElement;
let unmount: (() => void) | null = null;

async function mountLog(): Promise<void> {
  unmount = mount(host, ctx);
  await flush(); // store warm + backendMode notice
}

function q<T extends Element>(sel: string): T {
  const el = host.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
}

function clickByText(text: string): void {
  const b = [...host.querySelectorAll('button')].find((x) => x.textContent === text);
  if (!b) throw new Error(`no button '${text}'`);
  b.click();
}

beforeEach(() => {
  __resetLogStoreForTests();
  localStorage.clear();
  host = document.createElement('div');
  document.body.append(host);
});

afterEach(() => {
  unmount?.();
  unmount = null;
  host.remove();
  __resetLogStoreForTests();
});

describe('entries render with unit and ±/confidence — never a bare number (SPEC §15.1)', () => {
  it('shows value, unit, and ± through the recorded component (ADR-013: history, not orange)', async () => {
    await saveMeasurement(meas({ id: 'a' }), { note: 'behind the couch', project: 'living room' });
    await mountLog();
    const entry = q<HTMLElement>('.log-entry');
    expect(entry.querySelector('.num--recorded')).toBeTruthy(); // A7's component, not a reformat
    expect(entry.querySelector('.measured')).toBeNull(); // saved history never wears orange
    expect(entry.textContent).toContain('16.02 in');
    expect(entry.textContent).toContain('±0.25 in');
    expect(entry.textContent).toContain('STUD');
    expect(entry.textContent).toContain('living room');
    expect(entry.textContent).toContain('behind the couch');
  });

  it('an UNRELIABLE entry always wears its badge', async () => {
    await saveMeasurement(meas({ id: 'a', confidence: 'UNRELIABLE' }));
    await mountLog();
    expect(q('.log-entry').querySelector('.conf--unreliable')?.textContent).toBe('UNRELIABLE');
  });

  it('a ±-less measurement (basis unknown) falls back to its confidence badge', async () => {
    await saveMeasurement(meas({ id: 'a', uncertainty: { plusMinus: NaN, basis: 'unknown' }, confidence: 'POSSIBLE' }));
    await mountLog();
    const entry = q<HTMLElement>('.log-entry');
    expect(entry.querySelector('.num__pm')).toBeNull();
    expect(entry.querySelector('.conf--possible')).toBeTruthy();
  });

  it('entry detail shows full provenance: tier, samples, calibration ages', async () => {
    await saveMeasurement(
      meas({
        id: 'a',
        provenance: {
          tier: 'FIELD',
          calibrations: { mag: { ok: true, ageMs: 120_000 }, lens: { ok: false, ageMs: 0 } },
          sampleCount: 480,
          capturedAt: 1_700_000_000_000,
        },
      }),
    );
    await mountLog();
    q<HTMLButtonElement>('.log-entry__head').click();
    const detail = q<HTMLElement>('.log-entry__detail');
    expect(detail.textContent).toContain('SOURCE TIER');
    expect(detail.textContent).toContain('FIELD');
    expect(detail.textContent).toContain('480');
    expect(detail.textContent).toContain('CAL · MAG');
    expect(detail.textContent).toContain('2m old');
    expect(detail.textContent).toContain('not run'); // failed calibration is visible, in red
    expect(detail.querySelector('.log-prov__val--bad')).toBeTruthy();
  });

  it('empty log invites action instead of showing nothing', async () => {
    await mountLog();
    expect(q('.log__empty').textContent).toContain('Save a reading');
  });
});

describe('views', () => {
  it('groups by project with untagged entries last', async () => {
    await saveMeasurement(meas({ id: 'a' }), { project: 'kitchen' });
    await saveMeasurement(meas({ id: 'b', provenance: { tier: 'NONE', calibrations: {}, sampleCount: 1, capturedAt: 1 } }));
    await mountLog();
    clickByText('PROJECT');
    const heads = [...host.querySelectorAll('.log__group-head')].map((h) => h.textContent);
    expect(heads).toEqual(['KITCHEN', 'NO PROJECT']);
  });

  it('groups by kind', async () => {
    await saveMeasurement(meas({ id: 'a', kind: 'level' }));
    await saveMeasurement(meas({ id: 'b', kind: 'angle', provenance: { tier: 'NONE', calibrations: {}, sampleCount: 1, capturedAt: 1 } }));
    await mountLog();
    clickByText('KIND');
    const heads = [...host.querySelectorAll('.log__group-head')].map((h) => h.textContent);
    expect(heads).toEqual(['ANGLE', 'LEVEL']);
  });
});

describe('memory fallback is visible (SPEC §15.4)', () => {
  it('shows the session-only notice when the backend is the in-memory fallback', async () => {
    // happy-dom exposes no IndexedDB, so the store lands on the memory backend
    await mountLog();
    const notice = q<HTMLElement>('.log__notice');
    expect(notice.hidden).toBe(false);
    expect(notice.textContent).toBe('Storage is session-only in this browser mode — export before closing.');
  });
});

describe('soft delete with undo (SPEC §7B.9)', () => {
  it('DELETE hides the entry and offers UNDO; UNDO restores it', async () => {
    await saveMeasurement(meas({ id: 'a' }));
    await mountLog();
    q<HTMLButtonElement>('.log-entry__head').click();
    clickByText('DELETE');
    await flush();
    expect(host.querySelector('.log-entry')).toBeNull(); // gone from view immediately
    expect(await listMeasurements()).toEqual([]);
    const snackbar = q<HTMLElement>('.log-snackbar');
    expect(snackbar.textContent).toContain('Entry deleted.');
    clickByText('UNDO');
    await flush();
    expect(host.querySelector('.log-snackbar')).toBeNull();
    expect(host.querySelector('.log-entry')).toBeTruthy();
    expect((await listMeasurements()).map((e) => e.measurement.id)).toEqual(['a']);
  });

  it('the undo window survives navigation: remount re-offers the restore', async () => {
    await saveMeasurement(meas({ id: 'a' }));
    await mountLog();
    q<HTMLButtonElement>('.log-entry__head').click();
    clickByText('DELETE');
    await flush();
    unmount?.();
    unmount = null;
    expect(pendingDeleted()).toHaveLength(1);

    await mountLog(); // navigate back within the session
    const snackbar = q<HTMLElement>('.log-snackbar');
    expect(snackbar.textContent).toContain('Delete still pending.');
    clickByText('UNDO');
    await flush();
    expect((await listMeasurements()).map((e) => e.measurement.id)).toEqual(['a']);
  });
});

describe('delete-all is two-step (SPEC §4.7) — no accidental one-tap wipe', () => {
  it('first tap arms, second tap erases; entries survive the first tap', async () => {
    await saveMedia('p1', new Blob(['x'], { type: 'image/jpeg' }));
    await saveMeasurement(meas({ id: 'a', media: { photoId: 'p1' } }));
    await mountLog();

    clickByText('DELETE ALL LOG DATA');
    await flush();
    expect(await listMeasurements()).toHaveLength(1); // armed, nothing erased yet
    const warning = q<HTMLElement>('.log__confirm');
    expect(warning.textContent).toContain('Calibration is not touched');

    clickByText('ERASE EVERYTHING');
    await flush();
    expect(await listMeasurements()).toEqual([]);
    expect(q('.log__empty')).toBeTruthy();
  });

  it('KEEP MY DATA disarms without erasing', async () => {
    await saveMeasurement(meas({ id: 'a' }));
    await mountLog();
    clickByText('DELETE ALL LOG DATA');
    clickByText('KEEP MY DATA');
    await flush();
    expect(await listMeasurements()).toHaveLength(1);
    expect(host.querySelector('.log__confirm')).toBeNull();
    expect(host.querySelector('.log__deleteall')).toBeTruthy(); // back to the idle control
  });

  it('delete-all wipe does not touch the calibration profile (SPEC §4.7)', async () => {
    localStorage.setItem('square.calibration.v1', '{"deviceKey":"d","updatedAt":5}');
    await saveMeasurement(meas({ id: 'a' }));
    await mountLog();
    clickByText('DELETE ALL LOG DATA');
    clickByText('ERASE EVERYTHING');
    await flush();
    expect(localStorage.getItem('square.calibration.v1')).toBe('{"deviceKey":"d","updatedAt":5}');
  });
});

describe('local-only promise and export affordances', () => {
  it('states the promise in the tool, where it matters', async () => {
    await mountLog();
    expect(q('.log__promise').textContent).toBe('No cloud. Ever. Export is the only way data leaves this phone.');
  });

  it('offers JSON, CSV, import, and print with the CSV lossiness stated', async () => {
    await mountLog();
    expect(q('.log__export-json')).toBeTruthy();
    expect(q('.log__export-csv')).toBeTruthy();
    expect(q('.log__import')).toBeTruthy();
    expect(q('.log__print')).toBeTruthy();
    expect(q('.log__data').textContent).toContain('It drops ids');
  });
});
