/**
 * LOG — SPEC §4.7. Every saved measurement with its uncertainty, confidence,
 * and calibration state at capture. Views by time, project, and kind; entry
 * detail with full provenance and note/project editing; soft delete with a
 * 10 s undo window (SPEC §7B.9); JSON/CSV export, JSON import, printable job
 * sheet; two-step delete-all that spares calibration.
 *
 * Honesty rules in force here:
 *  - values render through A7's measuredEl — unit and ±/confidence always
 *    attached, never re-formatted into bare numbers (SPEC §15.1, §15.5);
 *  - the in-memory fallback is VISIBLE: a one-line notice says storage is
 *    session-only (SPEC §15.4);
 *  - "No cloud. Ever." is stated in the tool, where it matters.
 */
import './log.css';
import type { AppContext } from '../../app/router';
import { announce } from '../../app/shell';
import { warmedGuidanceStorage } from '../../app/db';
import {
  backendMode,
  deleteAll,
  mediaObjectUrls,
  pendingDeleted,
  softDeleteMeasurement,
  subscribeLog,
  undoDelete,
  updateEntry,
  UNDO_GRACE_MS,
  type SavedEntry,
} from '../../app/logStore';
import { measuredEl } from '../../ui/components/number';
import { bottomBar } from '../../ui/components/toolbar';
import { coachMark } from '../../ui/components/coach';
import { FadingStore, type FadeLevel } from '../../guidance/fading';
import { runGuide, type GuideDeps, type GuideHandle } from '../../guidance/tour';
import { CSV_DROPS, downloadText, exportCsv, exportFilename, exportJson, importJson } from './exporter';
import { LOG_GUIDE } from './guide';

type ViewId = 'time' | 'project' | 'kind';

const LOCAL_PROMISE = 'No cloud. Ever. Export is the only way data leaves this phone.';
const MEMORY_NOTICE = 'Storage is session-only in this browser mode — export before closing.';

/* ---------- small formatters ---------- */

function fmtWhen(ts: number): string {
  const d = new Date(ts);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtAge(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s old`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m old`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h old`;
  return `${Math.round(h / 24)}d old`;
}

function btn(label: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

export function mount(el: HTMLElement, _ctx: AppContext): () => void {
  let disposed = false;
  let view: ViewId = 'time';
  const openIds = new Set<string>();
  const urls = mediaObjectUrls();

  const wrap = document.createElement('div');
  wrap.className = 'log';

  /* ---------- print-only job sheet header ---------- */
  const printHead = document.createElement('header');
  printHead.className = 'log__printhead';
  const printTitle = document.createElement('h1');
  printTitle.textContent = 'SQUARE — JOB SHEET';
  const printMeta = document.createElement('p');
  printHead.append(printTitle, printMeta);

  /* ---------- session-only fallback notice (SPEC §15.4) ---------- */
  const notice = document.createElement('p');
  notice.className = 'log__notice';
  notice.setAttribute('role', 'status');
  notice.textContent = MEMORY_NOTICE;
  notice.hidden = true;
  void backendMode().then((kind) => {
    if (!disposed && kind === 'memory') {
      notice.hidden = false;
      announce(MEMORY_NOTICE, 'assertive');
    }
  });

  /* ---------- view switcher ---------- */
  const views = document.createElement('div');
  views.className = 'log__views';
  views.setAttribute('role', 'group');
  views.setAttribute('aria-label', 'Log views');
  const viewDefs: Array<{ id: ViewId; label: string }> = [
    { id: 'time', label: 'TIME' },
    { id: 'project', label: 'PROJECT' },
    { id: 'kind', label: 'KIND' },
  ];
  const viewBtns = new Map<ViewId, HTMLButtonElement>();
  for (const def of viewDefs) {
    const b = btn(def.label, 'btn btn--ghost', () => {
      view = def.id;
      syncViews();
      renderList();
    });
    viewBtns.set(def.id, b);
    views.append(b);
  }
  function syncViews(): void {
    for (const [id, b] of viewBtns) b.setAttribute('aria-pressed', id === view ? 'true' : 'false');
  }
  syncViews();

  /* ---------- entry list ---------- */
  const list = document.createElement('div');
  list.className = 'log__list';

  let entries: readonly SavedEntry[] = [];

  function provRow(label: string, value: string, bad = false): HTMLElement {
    const row = document.createElement('div');
    row.className = 'log-prov__row';
    const l = document.createElement('span');
    l.className = 'log-prov__label';
    l.textContent = label;
    const v = document.createElement('span');
    v.className = `log-prov__val${bad ? ' log-prov__val--bad' : ''}`;
    v.textContent = value;
    row.append(l, v);
    return row;
  }

  function entryDetail(e: SavedEntry): HTMLElement {
    const m = e.measurement;
    const detail = document.createElement('div');
    detail.className = 'log-entry__detail';

    const photoId = m.media?.photoId;
    if (photoId !== undefined) {
      const img = document.createElement('img');
      img.className = 'log-entry__photo';
      img.alt = 'Saved photo for this measurement';
      void urls.url(photoId).then((u) => {
        if (u !== null) img.src = u;
        else img.remove();
      });
      detail.append(img);
    }

    // Full provenance — what produced this number (SPEC §4.7, §7B.6).
    const prov = document.createElement('div');
    prov.className = 'log-prov';
    prov.append(provRow('SOURCE TIER', m.provenance.tier));
    prov.append(provRow('SAMPLES', String(m.provenance.sampleCount)));
    prov.append(provRow('CAPTURED', fmtWhen(m.provenance.capturedAt)));
    const cals = Object.entries(m.provenance.calibrations);
    if (cals.length === 0) {
      prov.append(provRow('CALIBRATION', 'none recorded at capture', true));
    } else {
      for (const [name, c] of cals) {
        prov.append(provRow(`CAL · ${name.toUpperCase()}`, c.ok ? fmtAge(c.ageMs) : 'not run', !c.ok));
      }
    }
    if (m.provenance.notes !== undefined) prov.append(provRow('PIPELINE NOTE', m.provenance.notes));
    detail.append(prov);

    // Note / project editing.
    const edit = document.createElement('div');
    edit.className = 'log-entry__edit';
    const noteLabel = document.createElement('label');
    noteLabel.textContent = 'NOTE';
    const noteInput = document.createElement('input');
    noteInput.type = 'text';
    noteInput.value = e.note ?? '';
    noteLabel.append(noteInput);
    const projLabel = document.createElement('label');
    projLabel.textContent = 'PROJECT';
    const projInput = document.createElement('input');
    projInput.type = 'text';
    projInput.value = e.project ?? '';
    projLabel.append(projInput);
    edit.append(noteLabel, projLabel);
    detail.append(edit);

    const actions = document.createElement('div');
    actions.className = 'log-entry__actions';
    actions.append(
      btn('SAVE', 'btn', () => {
        void updateEntry(m.id, { note: noteInput.value, project: projInput.value }).then(() => {
          announce('Entry updated');
        });
      }),
      btn('DELETE', 'btn btn--ghost log-entry__delete', () => {
        void softDeleteMeasurement(m.id).then((ok) => {
          if (ok) {
            announce('Entry deleted — undo available');
            showUndoSnackbar(m.id, 'Entry deleted.');
          }
        });
      }),
    );
    detail.append(actions);
    return detail;
  }

  function entryRow(e: SavedEntry): HTMLElement {
    const m = e.measurement;
    const art = document.createElement('article');
    art.className = 'log-entry';
    art.dataset['id'] = m.id;

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'log-entry__head';
    head.setAttribute('aria-expanded', openIds.has(m.id) ? 'true' : 'false');

    const kind = document.createElement('span');
    kind.className = 'log-entry__kind';
    kind.textContent = m.kind.toUpperCase();

    const when = document.createElement('time');
    when.className = 'log-entry__when';
    when.textContent = fmtWhen(m.provenance.capturedAt);

    head.append(kind, when);

    if (e.project !== undefined) {
      const proj = document.createElement('span');
      proj.className = 'log-entry__project';
      proj.textContent = e.project;
      head.append(proj);
    }

    // The measurement itself — through A7's provenance component, so the
    // unit and ±/confidence can never detach from the number.
    const value = document.createElement('span');
    value.className = 'log-entry__value';
    value.append(measuredEl(m, { decimals: 2 }));
    head.append(value);

    const photoId = m.media?.photoId;
    if (photoId !== undefined) {
      const thumb = document.createElement('img');
      thumb.className = 'log-entry__thumb';
      thumb.alt = '';
      void urls.url(photoId).then((u) => {
        if (u !== null) thumb.src = u;
        else thumb.remove();
      });
      head.append(thumb);
    }

    head.addEventListener('click', () => {
      if (openIds.has(m.id)) openIds.delete(m.id);
      else openIds.add(m.id);
      renderList();
    });
    art.append(head);

    if (e.note !== undefined) {
      const note = document.createElement('p');
      note.className = 'log-entry__note';
      note.textContent = e.note;
      art.append(note);
    }

    if (openIds.has(m.id)) art.append(entryDetail(e));
    return art;
  }

  function groupHead(text: string): HTMLElement {
    const h = document.createElement('h2');
    h.className = 'log__group-head display';
    h.textContent = text;
    return h;
  }

  function renderList(): void {
    list.replaceChildren();
    printMeta.textContent = `${entries.length} entries · printed ${fmtWhen(Date.now())} · every value carries its ± or confidence`;

    if (entries.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'log__empty';
      empty.textContent =
        'Nothing logged yet. Save a reading from any tool and it lands here with its uncertainty, confidence, and calibration state.';
      list.append(empty);
      return;
    }

    const newestFirst = [...entries].sort(
      (a, b) => b.measurement.provenance.capturedAt - a.measurement.provenance.capturedAt,
    );

    if (view === 'time') {
      for (const e of newestFirst) list.append(entryRow(e));
      return;
    }

    const keyOf = (e: SavedEntry): string =>
      view === 'project' ? e.project ?? '' : e.measurement.kind;
    const groups = new Map<string, SavedEntry[]>();
    for (const e of newestFirst) {
      const k = keyOf(e);
      const g = groups.get(k);
      if (g) g.push(e);
      else groups.set(k, [e]);
    }
    const keys = [...groups.keys()].sort((a, b) => {
      if (a === '') return 1; // untagged last
      if (b === '') return -1;
      return a < b ? -1 : a > b ? 1 : 0;
    });
    for (const k of keys) {
      list.append(groupHead(k === '' ? 'NO PROJECT' : k.toUpperCase()));
      for (const e of groups.get(k)!) list.append(entryRow(e));
    }
  }

  /* ---------- undo snackbar (SPEC §7B.9) ---------- */
  let snackbar: HTMLElement | null = null;
  let snackbarTimer: ReturnType<typeof setTimeout> | null = null;

  function hideSnackbar(): void {
    if (snackbarTimer !== null) clearTimeout(snackbarTimer);
    snackbarTimer = null;
    snackbar?.remove();
    snackbar = null;
  }

  function showUndoSnackbar(id: string, msg: string): void {
    hideSnackbar();
    const bar = document.createElement('div');
    bar.className = 'log-snackbar';
    bar.setAttribute('role', 'status');
    const text = document.createElement('span');
    text.className = 'log-snackbar__msg';
    text.textContent = msg;
    const undo = btn('UNDO', 'log-snackbar__undo', () => {
      void undoDelete(id).then((restored) => {
        hideSnackbar();
        if (restored) announce('Entry restored');
      });
    });
    bar.append(text, undo);
    wrap.append(bar);
    snackbar = bar;
    snackbarTimer = setTimeout(hideSnackbar, UNDO_GRACE_MS);
  }

  /* ---------- data section: export / import / print ---------- */
  const data = document.createElement('section');
  data.className = 'log__data';
  const dataHead = document.createElement('h2');
  dataHead.className = 'log__section-head display';
  dataHead.textContent = 'EXPORT / IMPORT';

  const status = document.createElement('p');
  status.className = 'log__status';
  status.setAttribute('role', 'status');
  function setStatus(text: string, bad = false): void {
    status.textContent = text;
    status.className = `log__status${bad ? ' log__status--bad' : ''}`;
    announce(text, bad ? 'assertive' : 'polite');
  }

  const importInput = document.createElement('input');
  importInput.type = 'file';
  importInput.accept = 'application/json,.json';
  importInput.hidden = true;
  importInput.addEventListener('change', () => {
    const file = importInput.files?.[0];
    importInput.value = '';
    if (!file) return;
    void file
      .text()
      .then((text) => importJson(text))
      .then((r) => {
        const parts = [`Imported ${r.imported} ${r.imported === 1 ? 'entry' : 'entries'} with new ids.`];
        if (r.skipped.length > 0) {
          parts.push(`Skipped ${r.skipped.length}: ${r.skipped.map((s) => `#${s.index} — ${s.reason}`).join('; ')}.`);
        }
        if (r.warnings.length > 0) parts.push(r.warnings.join('; ') + '.');
        setStatus(parts.join(' '), r.skipped.length > 0);
      })
      .catch((err: unknown) => {
        setStatus(`Import refused: ${err instanceof Error ? err.message : String(err)}`, true);
      });
  });

  const dataRow = document.createElement('div');
  dataRow.className = 'log__data-row';
  dataRow.append(
    btn('EXPORT JSON', 'btn log__export-json', () => {
      void exportJson().then((json) => {
        downloadText(exportFilename('json'), json, 'application/json');
        setStatus('JSON export ready — full fidelity, photos included.');
      });
    }),
    btn('EXPORT CSV', 'btn btn--ghost log__export-csv', () => {
      void exportCsv().then((csv) => {
        downloadText(exportFilename('csv'), csv, 'text/csv');
        setStatus('CSV export ready — flat rows; see what CSV drops below.');
      });
    }),
    btn('IMPORT JSON', 'btn btn--ghost log__import', () => importInput.click()),
    btn('PRINT JOB SHEET', 'btn btn--ghost log__print', () => {
      if (typeof window.print === 'function') window.print();
    }),
  );

  const csvNote = document.createElement('p');
  csvNote.className = 'log__fine';
  csvNote.textContent = CSV_DROPS;

  const promise = document.createElement('p');
  promise.className = 'log__fine log__promise';
  promise.textContent = LOCAL_PROMISE;

  data.append(dataHead, dataRow, csvNote, promise, status, importInput);

  /* ---------- delete-all: two-step confirm (SPEC §4.7) ---------- */
  const danger = document.createElement('section');
  danger.className = 'log__danger';
  const dangerHead = document.createElement('h2');
  dangerHead.className = 'log__section-head display';
  dangerHead.textContent = 'DELETE ALL DATA';
  const dangerBody = document.createElement('div');

  function renderDangerIdle(): void {
    dangerBody.replaceChildren(
      btn('DELETE ALL LOG DATA', 'btn btn--ghost log__deleteall', renderDangerArmed),
    );
  }

  function renderDangerArmed(): void {
    const confirmWrap = document.createElement('div');
    confirmWrap.className = 'log__confirm';
    const warning = document.createElement('p');
    warning.className = 'log__fine';
    warning.textContent =
      `This erases ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'} and every photo from this phone. ` +
      'There is no cloud copy to fall back on. Calibration is not touched — it lives in CALIBRATE.';
    confirmWrap.append(
      warning,
      btn('ERASE EVERYTHING', 'btn log__confirm-erase', () => {
        void deleteAll().then(() => {
          renderDangerIdle();
          announce('All log data erased. Calibration untouched.', 'assertive');
        });
      }),
      btn('KEEP MY DATA', 'btn btn--ghost log__confirm-keep', renderDangerIdle),
    );
    dangerBody.replaceChildren(confirmWrap);
  }

  renderDangerIdle();
  danger.append(dangerHead, dangerBody);

  /* ---------- guided run (SPEC §7B, guidance-notes.md) ---------- */
  const guideStorage = warmedGuidanceStorage();
  const memory = new FadingStore(guideStorage);
  let guideHandle: GuideHandle | null = null;
  let stepsShown = 0;
  const guideDeps: GuideDeps = {
    render: (step, onDismiss) => {
      stepsShown += 1;
      const anchor = (step.anchor !== undefined ? wrap.querySelector<HTMLElement>(step.anchor) : null) ?? wrap;
      const mark = coachMark(anchor, step.text, { onDismiss });
      return () => mark.dismiss();
    },
    sensorHook: () => () => {
      /* LOG is a review surface — no sensor steps */
    },
  };

  function startGuide(level?: FadeLevel): void {
    guideHandle?.stop();
    stepsShown = 0;
    guideHandle = runGuide(LOG_GUIDE, guideDeps, {
      memory,
      ...(level !== undefined ? { level } : {}),
      onEnd: (outcome) => {
        if (outcome === 'completed' && stepsShown > 0) memory.recordRun(LOG_GUIDE.toolId);
      },
    });
  }

  void guideStorage.warmed.then(() => {
    if (!disposed) startGuide();
  });

  /* ---------- bottom bar ---------- */
  const guideMe = btn('GUIDE ME', 'btn btn--ghost log__guideme', () => startGuide('full'));
  const bar = bottomBar(guideMe);

  /* ---------- assemble + subscribe ---------- */
  wrap.append(printHead, notice, views, list, data, danger);
  el.append(wrap, bar);

  const unsubscribe = subscribeLog((next) => {
    entries = next;
    renderList();
  });

  // A delete's undo window survives navigation within the session — re-offer it.
  const pendingNow = pendingDeleted();
  if (pendingNow.length > 0) {
    const last = pendingNow[pendingNow.length - 1]!;
    showUndoSnackbar(last.measurement.id, 'Delete still pending.');
  }

  return () => {
    disposed = true;
    unsubscribe();
    guideHandle?.stop();
    hideSnackbar();
    urls.revokeAll(); // object URLs die with the view
    bar.remove();
    wrap.remove();
  };
}
