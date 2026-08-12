/**
 * LAYOUT — repeat spacing (SPEC §4.4). Owned by A4 (Craft Math, Phase 2).
 *
 * The whole tool runs on typed numbers (practice mode, §7B.9) — the PRACTICE
 * badge stands until a sensor line or a photo is attached. Every output
 * derives from entered values and wears derived provenance; the only orange
 * on this screen is the live roll reading while the level-line sensor runs.
 *
 * The §4.4.2 boundary is stated where the level line renders: the overlay
 * plans and verifies; the tape makes the mark. Live camera overlay is A5's
 * territory — LAYOUT establishes the line numerically (levelLine.ts).
 */
import './layout.css';
import type { AppContext } from '../../app/router';
import type { Measurement } from '../../types';
import type { Rational, FractionDenom } from '../../geometry/units';
import { formatFtIn, formatInches, parseLength, rational, toNumber } from '../../geometry/units';
import { LAYOUT_TAPE_WARNING, storyPoleCsv, storyPoleRows } from '../../geometry/layout';
import {
  MODE_LABELS,
  PRINT_TRUE_SCALE_MAX_IN,
  STUD_SNAP_TOL_IN,
  TOGGLE_BOLT_NOTE,
  alignMarksToStuds,
  computeLayout,
  layoutTableRows,
  photoScaleFrom,
  roundingMarker,
  scaledLength,
  studsFromLog,
  type LayoutComputation,
  type LayoutMode,
  type PhotoScale,
} from './solver';
import { LAYOUT_PRESETS } from './presets';
import { LAYOUT_DEMOS, LAYOUT_GUIDE } from './guide';
import { OVERLAY_BOUNDARY_LINE, RollCapture, levelLineDrop } from './levelLine';
import { claimFor, confidenceFor, uncertaintyForSave } from '../level/levelState';
import { DeviceMotionSource } from '../../sensors/imu';
import { OrientationFusion } from '../../sensors/orientation';
import { requestMotionPermissions, recoveryInstructions } from '../../sensors/permissions';
import { announce } from '../../app/shell';
import { listMeasurements } from '../../app/logStore';
import { calibrationsForProvenance, getProfile } from '../../app/calibrationStore';
import { requestWakeLock, releaseWakeLock } from '../../app/wakelock';
import { vibrate } from '../../app/haptics';
import { bottomBar } from '../../ui/components/toolbar';
import { coachMark } from '../../ui/components/coach';
import { measuredEl, derivedEl } from '../../ui/components/number';
import { FadingStore } from '../../guidance/fading';
import { runGuide, type GuideHandle } from '../../guidance/tour';

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

function newId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  return c?.randomUUID ? c.randomUUID() : `m-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function fmtAge(ms: number): string {
  if (ms < 60_000) return 'moments ago';
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)} h ago`;
  return `${Math.round(ms / 86_400_000)} d ago`;
}

/** Derived fraction output: units.ts text + rounding marker, .derived class. */
function fractionCell(text: string, rounding: 'exact' | 'up' | 'down'): HTMLElement {
  const wrap = h('span');
  wrap.append(Object.assign(h('span', 'derived hud'), { textContent: text }));
  const marker = roundingMarker(rounding);
  if (marker.char) {
    const m = h('span', 'rounding-marker', marker.char);
    m.setAttribute('aria-label', marker.label);
    m.title = marker.label;
    wrap.append(m);
  }
  return wrap;
}

export function mount(el: HTMLElement, ctx: AppContext): () => void {
  const root = h('div', 'layout');

  /* ---------------- state ---------------- */
  let precision: FractionDenom = 16;
  let showMm = false;
  let mode: LayoutMode = 'equal-centers';
  let computation: LayoutComputation | null = null;
  let spanIn: Rational | null = null;
  let alignToStuds = false;
  let studCenters: number[] = [];
  let sensorActive = false;
  let photoAttached = false;
  let ranRecorded = false;
  const cleanups: Array<() => void> = [];

  /* ---------------- header ---------------- */
  const head = h('div', 'layout__head');
  const name = h('h1', 'layout__name display', 'LAYOUT');
  const practice = h('span', 'practicebadge', 'PRACTICE — typed numbers');
  practice.id = 'layout-practice';
  practice.title = 'Every number on this screen is math on what you typed. The badge clears when a sensor line or a photo is attached (SPEC §7B.9).';
  head.append(name, practice);
  root.append(head);

  const syncPractice = (): void => {
    practice.style.display = sensorActive || photoAttached ? 'none' : '';
  };

  /* ---------------- presets ---------------- */
  const presetSection = h('section');
  presetSection.append(h('h2', 'display', 'PRESETS'));
  const presetRow = h('div', 'presetrow');
  const presetAssumption = h('p', 'preset__assumption');
  presetAssumption.style.display = 'none';
  for (const p of LAYOUT_PRESETS) {
    const b = h('button', 'btn btn--ghost', p.name.toUpperCase());
    b.type = 'button';
    b.addEventListener('click', () => {
      mode = p.mode;
      modeSelect.value = p.mode;
      spanInput.value = p.span;
      countInput.value = String(p.count);
      widthInput.value = p.itemWidth ?? '';
      marginInput.value = p.margin ?? '';
      pitchInput.value = p.pitch ?? '';
      presetAssumption.textContent = p.note ? `${p.assumption} ${p.note}` : p.assumption;
      presetAssumption.style.display = '';
      syncModeFields();
      recompute();
    });
    presetRow.append(b);
  }
  presetSection.append(presetRow, presetAssumption);
  root.append(presetSection);

  /* ---------------- form ---------------- */
  const formSection = h('section');
  formSection.append(h('h2', 'display', 'SPACING'));
  const form = h('div', 'layout__form');

  const field = (id: string, label: string, placeholder: string): { wrap: HTMLElement; input: HTMLInputElement; err: HTMLElement } => {
    const wrap = h('div', 'layout__field');
    const lab = h('label', undefined, label);
    lab.setAttribute('for', id);
    const input = h('input');
    input.id = id;
    input.type = 'text';
    input.placeholder = placeholder;
    input.autocomplete = 'off';
    input.inputMode = 'text';
    const err = h('span', 'layout__parse-error');
    wrap.append(lab, input, err);
    return { wrap, input, err };
  };

  const spanF = field('layout-span', 'Span (datum to far end)', `8' 6"  ·  2600mm`);
  const spanInput = spanF.input;
  const countWrap = h('div', 'layout__field');
  const countLab = h('label', undefined, 'Count (number of marks)');
  countLab.setAttribute('for', 'layout-count');
  const countInput = h('input');
  countInput.id = 'layout-count';
  countInput.type = 'number';
  countInput.min = '1';
  countInput.step = '1';
  countInput.value = '5';
  countWrap.append(countLab, countInput, h('span', 'layout__parse-error'));

  const modeWrap = h('div', 'layout__field');
  const modeLab = h('label', undefined, 'Mode');
  modeLab.setAttribute('for', 'layout-mode');
  const modeSelect = h('select');
  modeSelect.id = 'layout-mode';
  for (const [value, label] of Object.entries(MODE_LABELS)) {
    const opt = h('option', undefined, label);
    opt.value = value;
    modeSelect.append(opt);
  }
  modeSelect.value = mode;
  modeWrap.append(modeLab, modeSelect);

  const widthF = field('layout-width', 'Item width (equal gaps)', '18"');
  const widthInput = widthF.input;
  const marginF = field('layout-margin', 'First margin (fixed margins)', '4"');
  const marginInput = marginF.input;
  const pitchF = field('layout-pitch', 'Pitch (center to center)', '96mm');
  const pitchInput = pitchF.input;

  form.append(spanF.wrap, countWrap, modeWrap, widthF.wrap, marginF.wrap, pitchF.wrap);
  formSection.append(form);

  const echo = h('p', 'layout__echo layout__hint');
  formSection.append(echo);

  const syncModeFields = (): void => {
    widthF.wrap.style.display = mode === 'equal-gaps' ? '' : 'none';
    marginF.wrap.style.display = mode === 'fixed-margins' ? '' : 'none';
    pitchF.wrap.style.display = mode === 'fixed-margins' || mode === 'fixed-pitch' ? '' : 'none';
  };
  syncModeFields();

  // precision + mm controls
  const precisionRow = h('div', 'precisionrow');
  precisionRow.append(h('span', 'layout__hint', 'Precision:'));
  const precBtns: Array<{ denom: FractionDenom; btn: HTMLButtonElement }> = [];
  for (const denom of [8, 16, 32] as const) {
    const b = h('button', 'btn btn--ghost', `1/${denom}″`);
    b.type = 'button';
    b.addEventListener('click', () => {
      precision = denom;
      syncPrecision();
      recompute();
    });
    precBtns.push({ denom, btn: b });
    precisionRow.append(b);
  }
  const mmBtn = h('button', 'btn btn--ghost', 'MM');
  mmBtn.type = 'button';
  mmBtn.setAttribute('aria-pressed', 'false');
  mmBtn.setAttribute('aria-label', 'Show a millimetre column');
  mmBtn.addEventListener('click', () => {
    showMm = !showMm;
    mmBtn.setAttribute('aria-pressed', showMm ? 'true' : 'false');
    recompute();
  });
  precisionRow.append(mmBtn);
  const syncPrecision = (): void => {
    for (const { denom, btn } of precBtns) btn.setAttribute('aria-pressed', denom === precision ? 'true' : 'false');
  };
  syncPrecision();
  formSection.append(precisionRow);
  root.append(formSection);

  /* ---------------- result ---------------- */
  const resultSection = h('section');
  resultSection.id = 'layout-table';
  resultSection.append(h('h2', 'display', 'MARKS'));
  const resultBody = h('div');
  resultSection.append(resultBody);
  root.append(resultSection);

  /* ---------------- stud datum (§4.4.3) ---------------- */
  const studSection = h('section');
  studSection.id = 'layout-studs';
  studSection.append(h('h2', 'display', 'STUD DATUM'));
  const studHint = h('p', 'layout__hint',
    `Align marks to studs found by SCAN. A mark snaps to a stud center within ${STUD_SNAP_TOL_IN}″; marks with no stud in reach are flagged.`);
  const studBtn = h('button', 'btn', 'USE FOUND STUDS');
  studBtn.type = 'button';
  const studBody = h('div');
  studSection.append(studHint, studBtn, studBody);
  root.append(studSection);

  studBtn.addEventListener('click', () => {
    void (async () => {
      const entries = await listMeasurements();
      const studs = studsFromLog(entries);
      studBody.replaceChildren();
      if (studs.length === 0) {
        const p = h('p', 'layout__hint', 'No stud scans in the log yet. Run a sweep in SCAN and save it — found studs appear here as a datum. ');
        const a = h('a', undefined, 'Open SCAN');
        a.href = '#/scan';
        p.append(a);
        studBody.append(p);
        alignToStuds = false;
        return;
      }
      const list = h('ul', 'studlist');
      for (const s of studs) {
        const li = h('li');
        li.append(
          Object.assign(h('span', 'hud'), { textContent: formatInches(inchesRational(s.centerIn), precision).text }),
          h('span', `conf conf--${s.confidence.toLowerCase()}`, s.confidence),
          h('span', 'layout__hint', fmtAge(s.ageMs)),
        );
        list.append(li);
      }
      studBody.append(list);
      alignToStuds = true;
      studCenters = studs.map((s) => s.centerIn);
      recompute();
    })();
  });

  /* ---------------- level line (§4.4.2, numeric — camera overlay is A5's) -- */
  const levelSection = h('section');
  levelSection.id = 'layout-level';
  levelSection.append(h('h2', 'display', 'LEVEL LINE'));
  levelSection.append(h('p', 'layout__hint',
    'Hold the phone against the wall on its long edge, like a straightedge, and capture the roll. The drop over your span says how far the line falls.'));
  const boundary = h('p', 'levelline__boundary', OVERLAY_BOUNDARY_LINE);
  const wakeBtn = h('button', 'btn', 'WAKE SENSORS');
  wakeBtn.id = 'layout-level-wake';
  wakeBtn.type = 'button';
  const armBtn = h('button', 'btn', 'CAPTURE ROLL');
  armBtn.type = 'button';
  armBtn.disabled = true;
  const levelState = h('p', 'levelline__state display', '');
  const levelOut = h('div');
  levelSection.append(boundary, wakeBtn, armBtn, levelState, levelOut);
  root.append(levelSection);

  const rollCapture = new RollCapture();
  let imu: DeviceMotionSource | null = null;
  let fusion: OrientationFusion | null = null;

  wakeBtn.addEventListener('click', () => {
    void (async () => {
      const perm = await requestMotionPermissions();
      if (perm.motion === 'denied' || perm.orientation === 'denied') {
        levelState.textContent = 'MOTION BLOCKED';
        levelOut.replaceChildren(h('p', 'layout__hint', recoveryInstructions('motion', ctx.capability.platformHint)));
        return;
      }
      if (perm.motion === 'unavailable') {
        levelState.textContent = 'NO MOTION SENSOR';
        levelOut.replaceChildren(h('p', 'layout__hint', 'This device reports no motion sensor. The layout table above still works — level the line with a spirit level.'));
        return;
      }
      imu = new DeviceMotionSource();
      fusion = new OrientationFusion(imu);
      await fusion.start();
      sensorActive = true;
      syncPractice();
      void requestWakeLock();
      armBtn.disabled = false;
      wakeBtn.disabled = true;
      levelState.textContent = 'SENSORS ON';
      announce('Motion sensors on');
      cleanups.push(fusion.subscribe((o) => {
        // H-01: subtract the stored reversal bias (DEGREES — A5 unit
        // contract, levelState.ts header) before the capture ever sees the
        // roll. Raw fusion output carries the sensor's zero error.
        const bias = getProfile().levelBias;
        const corrected = bias ? { ...o, roll: o.roll - bias.roll * RAD } : o;
        const phase = rollCapture.ingest(corrected);
        if (phase.phase === 'moving') levelState.textContent = 'MOVING — hold still';
        else if (phase.phase === 'settling') levelState.textContent = `HOLD… ${Math.round(phase.progress * 100)}%`;
        else if (phase.phase === 'captured' && !levelOut.hasChildNodes()) renderRoll(phase.reading.rollRad, phase.reading.stddevRad, phase.reading.sampleCount);
      }));
    })();
  });

  armBtn.addEventListener('click', () => {
    levelOut.replaceChildren();
    rollCapture.arm();
    levelState.textContent = 'HOLD THE PHONE ON THE WALL';
  });

  const renderRoll = (rollRad: number, stddevRad: number, samples: number): void => {
    levelState.textContent = 'CAPTURED';
    vibrate(30);
    const rollDeg = rollRad * DEG;
    const stddevDeg = stddevRad * DEG;
    // Claim discipline (SPEC §2.3.5, H-01): the ± is never tighter than the
    // calibration-state claim — ±0.5° uncalibrated, ±0.15° after reversal —
    // and confidence caps at LIKELY without a stored levelBias. The window
    // scatter measures noise, not bias; LEVEL's levelState.ts owns the rule.
    const claim = claimFor(getProfile());
    const u = uncertaintyForSave(claim.plusMinus, { n: samples, mean: rollDeg, stddev: stddevDeg });
    const m: Measurement = {
      id: newId(),
      kind: 'level',
      value: rollDeg,
      unit: '°',
      uncertainty: u,
      confidence: confidenceFor(true, claim.calibrated),
      provenance: {
        tier: ctx.capability.magTier,
        calibrations: calibrationsForProvenance(getProfile()),
        sampleCount: samples,
        capturedAt: Date.now(),
      },
    };
    const line = h('div');
    line.append(h('span', 'layout__hint', 'Roll: '), measuredEl(m, { decimals: 2, showConfidence: 'always' }));
    levelOut.append(line);
    levelOut.append(h('p', 'layout__hint', claim.text));
    if (spanIn !== null) {
      const spanNum = toNumber(spanIn);
      const drop = levelLineDrop({ rollRad, stddevRad, sampleCount: samples, t: 0 }, spanNum, u.plusMinus * RAD);
      const dropLine = h('div');
      dropLine.append(
        h('span', 'layout__hint', `Drop over ${formatFtIn(spanIn, precision).text}: `),
        derivedEl(drop.dropIn, '″', Math.max(0.01, drop.plusMinusIn), u.basis, { decimals: 2 }),
      );
      levelOut.append(dropLine);
    }
    levelOut.append(h('p', 'levelline__boundary', OVERLAY_BOUNDARY_LINE));
    announce(`Roll captured: ${rollDeg.toFixed(2)} degrees, plus or minus ${u.plusMinus.toFixed(2)}`);
  };

  /* ---------------- photo-scaled layout (§4.4.2) ---------------- */
  const photoSection = h('section');
  photoSection.id = 'layout-photo';
  photoSection.append(h('h2', 'display', 'PHOTO SCALE'));
  photoSection.append(h('p', 'layout__hint',
    'Freeze a photo of the wall, tap two points a known distance apart, enter that distance — then the layout marks land on the photo with real-unit callouts. The ± comes from a stated ±2 px marking error and grows with the span-to-reference ratio.'));
  const fileInput = h('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.setAttribute('aria-label', 'Load a photo of the wall');
  const photoStatus = h('p', 'photo__status', 'Load a photo to begin.');
  const canvasWrap = h('div', 'photo__canvaswrap');
  canvasWrap.style.display = 'none';
  const canvas = h('canvas');
  canvasWrap.append(canvas);
  const refWrap = h('div', 'layout__field');
  refWrap.style.display = 'none';
  const refLab = h('label', undefined, 'Real distance between the two reference points');
  refLab.setAttribute('for', 'layout-photo-ref');
  const refInput = h('input');
  refInput.id = 'layout-photo-ref';
  refInput.type = 'text';
  refInput.placeholder = `36"`;
  const refErr = h('span', 'layout__parse-error');
  const refBtn = h('button', 'btn', 'SET SCALE');
  refBtn.type = 'button';
  refWrap.append(refLab, refInput, refErr, refBtn);
  const undoBtn = h('button', 'btn btn--ghost', 'UNDO POINT');
  undoBtn.type = 'button';
  undoBtn.style.display = 'none';
  const photoOut = h('div');
  photoSection.append(fileInput, photoStatus, canvasWrap, refWrap, undoBtn, photoOut);
  root.append(photoSection);

  let photoImg: HTMLImageElement | null = null;
  let photoUrl: string | null = null;
  let photoPoints: Array<{ x: number; y: number }> = [];
  let photoScale: PhotoScale | null = null;

  // Canvas ink resolved from the --type token (ribbon.ts pattern): these are
  // DERIVED marks from ENTERED spans — never orange (SPEC §7.1, H-07) — and
  // the token keeps them theme-correct in NIGHT.
  const canvasInk = (): string => {
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue('--type').trim();
      return v || '#1A1A1A';
    } catch {
      return '#1A1A1A';
    }
  };

  const drawPhoto = (): void => {
    const cx = canvas.getContext('2d');
    if (!cx || !photoImg) return;
    const ink = canvasInk();
    cx.clearRect(0, 0, canvas.width, canvas.height);
    cx.drawImage(photoImg, 0, 0, canvas.width, canvas.height);
    cx.lineWidth = 3;
    photoPoints.forEach((p, i) => {
      const isRef = i < 2;
      cx.strokeStyle = ink;
      cx.beginPath();
      cx.arc(p.x, p.y, 10, 0, Math.PI * 2);
      cx.stroke();
      cx.fillStyle = ink;
      cx.font = '16px sans-serif';
      cx.fillText(isRef ? `R${i + 1}` : i === 2 ? 'A' : 'B', p.x + 14, p.y - 6);
    });
    // layout line + marks
    const a = photoPoints[2];
    const b = photoPoints[3];
    if (a && b && photoScale && computation?.ok) {
      cx.strokeStyle = ink;
      cx.beginPath();
      cx.moveTo(a.x, a.y);
      cx.lineTo(b.x, b.y);
      cx.stroke();
      const px = Math.hypot(b.x - a.x, b.y - a.y);
      const spanScaled = scaledLength(photoScale, px);
      const rows = layoutTableRows(computation.marks, precision);
      computation.marks.forEach((m, i) => {
        const cum = toNumber(m.cumulativeFromDatum);
        const f = spanScaled.inches > 0 ? cum / spanScaled.inches : 0;
        if (f < 0 || f > 1) return;
        const mx = a.x + (b.x - a.x) * f;
        const my = a.y + (b.y - a.y) * f;
        cx.beginPath();
        cx.moveTo(mx - 8, my - 8);
        cx.lineTo(mx + 8, my + 8);
        cx.moveTo(mx + 8, my - 8);
        cx.lineTo(mx - 8, my + 8);
        cx.stroke();
        const label = rows[i]?.cumulative.text ?? '';
        cx.fillStyle = ink;
        cx.fillText(label, mx + 10, my + 20);
      });
    }
  };

  const syncPhotoStatus = (): void => {
    undoBtn.style.display = photoPoints.length > 0 ? '' : 'none';
    if (!photoImg) {
      photoStatus.textContent = 'Load a photo to begin.';
    } else if (photoPoints.length < 2) {
      photoStatus.textContent = `Tap reference point ${photoPoints.length + 1} of 2 — two spots a known distance apart (outlet to corner, jamb to jamb).`;
      refWrap.style.display = 'none';
    } else if (!photoScale) {
      photoStatus.textContent = 'Enter the real distance between R1 and R2, then set the scale.';
      refWrap.style.display = '';
    } else if (photoPoints.length < 4) {
      photoStatus.textContent = `Scale set. Tap the ${photoPoints.length === 2 ? 'start (A)' : 'end (B)'} of the layout line.`;
    } else {
      photoStatus.textContent = 'Marks placed along A–B with real-unit callouts. Plan here; measure with the tape.';
    }
  };

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    photoUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      photoImg = img;
      photoPoints = [];
      photoScale = null;
      photoAttached = true;
      syncPractice();
      const w = Math.min(720, img.naturalWidth || 720);
      const ratio = img.naturalWidth > 0 ? w / img.naturalWidth : 1;
      canvas.width = w;
      canvas.height = Math.max(1, Math.round((img.naturalHeight || 480) * ratio));
      canvasWrap.style.display = '';
      photoOut.replaceChildren();
      drawPhoto();
      syncPhotoStatus();
    };
    img.src = photoUrl;
  });

  canvas.addEventListener('pointerdown', (ev) => {
    if (!photoImg) return;
    if (photoPoints.length >= 4) return;
    if (photoPoints.length >= 2 && !photoScale) return; // set the scale first
    const r = canvas.getBoundingClientRect();
    const x = ((ev.clientX - r.left) / Math.max(1, r.width)) * canvas.width;
    const y = ((ev.clientY - r.top) / Math.max(1, r.height)) * canvas.height;
    photoPoints.push({ x, y });
    drawPhoto();
    syncPhotoStatus();
    renderPhotoOut();
  });

  undoBtn.addEventListener('click', () => {
    photoPoints.pop();
    if (photoPoints.length < 2) photoScale = null;
    drawPhoto();
    syncPhotoStatus();
    renderPhotoOut();
  });

  refBtn.addEventListener('click', () => {
    const parsed = parseLength(refInput.value);
    if (!parsed) {
      refErr.textContent = `Can't read that length — type it like 36", 3', or 900mm.`;
      return;
    }
    refErr.textContent = '';
    const p1 = photoPoints[0];
    const p2 = photoPoints[1];
    if (!p1 || !p2) return;
    const result = photoScaleFrom(Math.hypot(p2.x - p1.x, p2.y - p1.y), parsed.inches);
    if (!result.ok) {
      refErr.textContent = result.reason;
      return;
    }
    photoScale = result.scale;
    syncPhotoStatus();
    renderPhotoOut();
  });

  const renderPhotoOut = (): void => {
    photoOut.replaceChildren();
    const a = photoPoints[2];
    const b = photoPoints[3];
    if (!photoScale || !a || !b) return;
    const px = Math.hypot(b.x - a.x, b.y - a.y);
    const s = scaledLength(photoScale, px);
    const line = h('div');
    line.append(
      h('span', 'layout__hint', 'Layout line A–B on the wall plane: '),
      derivedEl(s.inches, '″', Math.max(0.01, s.plusMinusIn), 'nominal', { decimals: 1 }),
    );
    photoOut.append(line);
    photoOut.append(h('p', 'layout__hint',
      `± is a stated ±2 px marking error pushed through the scale — it grows with span ÷ reference (${(px / photoScale.refPx).toFixed(1)}× here). ${OVERLAY_BOUNDARY_LINE}`));
    drawPhoto();
  };

  /* ---------------- story pole / export (§4.4.2) ---------------- */
  const poleSection = h('section');
  poleSection.id = 'layout-pole';
  poleSection.append(h('h2', 'display', 'STORY POLE'));
  const readAloud = h('ol', 'readaloud');
  readAloud.setAttribute('aria-label', 'Read-aloud mark list');
  const poleHint = h('p', 'layout__hint',
    `PRINT renders the pole at true scale for spans up to ${PRINT_TRUE_SCALE_MAX_IN}″ (one page); longer spans print the table and the read-aloud list only.`);
  poleSection.append(readAloud, poleHint);
  root.append(poleSection);

  const printBlock = h('div', 'layout-print');
  printBlock.setAttribute('aria-hidden', 'true');
  root.append(printBlock);

  /* ---------------- DEMO (ADR-012 worked examples) ---------------- */
  const demoSection = h('section');
  demoSection.id = 'layout-demo';
  demoSection.append(h('h2', 'display', 'DEMO'));
  demoSection.append(h('p', 'layout__hint', 'Worked examples computed by the real solvers — the numbers in the story are the solver’s output, including the refusal.'));
  const demoRow = h('div', 'presetrow');
  const demoPanel = h('div', 'workedpanel');
  demoPanel.style.display = 'none';
  for (const [id, spec] of Object.entries(LAYOUT_DEMOS)) {
    const b = h('button', 'btn btn--ghost', spec.title.toUpperCase());
    b.type = 'button';
    b.setAttribute('data-demo-id', id);
    b.addEventListener('click', () => {
      demoPanel.replaceChildren();
      demoPanel.style.display = '';
      demoPanel.append(h('div', 'workedpanel__label', spec.label));
      let step = 0;
      const stepsWrap = h('div');
      demoPanel.append(stepsWrap);
      const controls = h('div', 'workedpanel__controls');
      const next = h('button', 'btn', 'NEXT STEP');
      next.type = 'button';
      const showStep = (): void => {
        const s = spec.steps[step];
        if (!s) return;
        stepsWrap.append(h('p', 'workedpanel__step', s.text));
        step += 1;
        if (step >= spec.steps.length) next.disabled = true;
      };
      next.addEventListener('click', showStep);
      controls.append(next);
      demoPanel.append(controls);
      showStep();
    });
    demoRow.append(b);
  }
  demoSection.append(demoRow, demoPanel);
  root.append(demoSection);

  /* ---------------- recompute ---------------- */
  function inchesRational(v: number): Rational {
    // Nearest 1/32 as an exact rational, for display of float-valued studs.
    return rational(Math.round(v * 32), 32);
  }

  const recompute = (): void => {
    resultBody.replaceChildren();
    computation = null;
    spanIn = null;

    const spanRaw = spanInput.value.trim();
    if (spanRaw === '') {
      spanF.err.textContent = '';
      echo.textContent = '';
      renderPole(null);
      return;
    }
    const spanParsed = parseLength(spanRaw);
    if (!spanParsed) {
      spanF.err.textContent = `Can't read that length — type it like 8' 6", 40-1/2", or 2600mm.`;
      renderPole(null);
      return;
    }
    spanF.err.textContent = '';
    spanIn = spanParsed.inches;
    // Echo the parse in ENTERED provenance (SPEC §5, §15.5): the span is the
    // user's claim, dotted-underlined, never orange.
    echo.replaceChildren(
      document.createTextNode('Span reads as '),
      h('span', 'entered hud', formatFtIn(spanParsed.inches, precision).text),
      document.createTextNode(` (${formatInches(spanParsed.inches, precision).text}). Entered values stay yours — outputs are derived.`),
    );

    const count = Number(countInput.value);
    const need = (raw: string, err: HTMLElement): Rational | null | 'error' => {
      if (raw.trim() === '') {
        err.textContent = '';
        return null;
      }
      const p = parseLength(raw);
      if (!p) {
        err.textContent = `Can't read that length.`;
        return 'error';
      }
      err.textContent = '';
      return p.inches;
    };
    const width = need(widthInput.value, widthF.err);
    const margin = need(marginInput.value, marginF.err);
    const pitch = need(pitchInput.value, pitchF.err);
    if (width === 'error' || margin === 'error' || pitch === 'error') return;

    computation = computeLayout({
      span: spanParsed.inches,
      count,
      mode,
      ...(width !== null ? { itemWidth: width } : {}),
      ...(margin !== null ? { margin } : {}),
      ...(pitch !== null ? { pitch } : {}),
    });

    if (!computation.ok) {
      const refusal = h('div', 'layout__refusal', computation.reason);
      refusal.setAttribute('role', 'status');
      resultBody.append(refusal);
      renderPole(null);
      announce(computation.reason);
      return;
    }

    if (!ranRecorded) {
      ranRecorded = true;
      memory.recordRun('layout');
    }

    // summary
    const summary = h('div', 'layout__summary');
    for (const item of computation.summary) {
      const wrap = h('div', 'layout__summary-item');
      wrap.append(h('span', 'label', item.label));
      const f = formatFtIn(item.value, precision);
      wrap.append(fractionCell(f.text, f.rounding));
      summary.append(wrap);
    }
    resultBody.append(summary);

    // the chaining warning — verbatim, prominent, beside every mark table
    const warning = h('div', 'layout__tape-warning', LAYOUT_TAPE_WARNING);
    warning.setAttribute('role', 'note');
    resultBody.append(warning);

    // table
    const rows = layoutTableRows(computation.marks, precision);
    const table = h('table', 'marktable');
    const caption = h('caption', undefined,
      `Derived from your entered values, exact fractions, rounded to 1/${precision}″ for display only — ▴ up, ▾ down. Cumulative places the mark; incremental checks the spacing.`);
    table.append(caption);
    const thead = h('thead');
    const hr = h('tr');
    for (const label of ['MARK', 'CUMULATIVE (from datum)', 'INCREMENTAL (from previous)', ...(showMm ? ['MM'] : [])]) {
      hr.append(h('th', undefined, label));
    }
    thead.append(hr);
    table.append(thead);
    const tbody = h('tbody');
    for (const r of rows) {
      const tr = h('tr');
      tr.append(h('td', undefined, String(r.mark)));
      const cumTd = h('td');
      cumTd.append(fractionCell(r.cumulative.text, r.cumulative.rounding));
      const incTd = h('td');
      incTd.append(fractionCell(r.incremental.text, r.incremental.rounding));
      tr.append(cumTd, incTd);
      if (showMm) {
        const mmTd = h('td');
        mmTd.append(fractionCell(r.cumulativeMm.text, r.cumulativeMm.rounding));
        tr.append(mmTd);
      }
      tbody.append(tr);
    }
    table.append(tbody);
    resultBody.append(table);

    // stud alignment overlay
    if (alignToStuds && studCenters.length > 0) {
      const aligns = alignMarksToStuds(computation.marks, studCenters);
      const list = h('ul', 'studalign');
      for (const al of aligns) {
        const li = h('li');
        if (al.miss) {
          li.className = 'studalign__miss';
          li.textContent = `Mark ${al.markIndex + 1} at ${formatInches(inchesRational(al.targetIn), precision).text}: ${TOGGLE_BOLT_NOTE}`;
        } else {
          const delta = al.deltaIn ?? 0;
          li.textContent = `Mark ${al.markIndex + 1} → stud center at ${formatInches(inchesRational(al.snappedIn ?? 0), precision).text} (moves ${delta >= 0 ? '+' : '−'}${formatInches(inchesRational(Math.abs(delta)), precision).text})`;
        }
        list.append(li);
      }
      resultBody.append(h('h2', 'display', 'ON THE STUDS'), list);
    }

    renderPole(computation);
    drawPhoto();
    announce(`Layout computed: ${rows.length} marks`);
  };

  const renderPole = (comp: LayoutComputation | null): void => {
    readAloud.replaceChildren();
    printBlock.replaceChildren();
    if (!comp || !comp.ok) return;
    const rows = storyPoleRows(comp.marks, precision);
    for (const r of rows) {
      readAloud.append(h('li', undefined, `Mark ${r.mark} — ${r.cumulative}`));
    }
    // print view
    const title = h('h1', undefined, 'SQUARE — LAYOUT story pole');
    const spanText = spanIn ? formatFtIn(spanIn, precision).text : '';
    const meta = h('p', 'layout-print__meta',
      `${MODE_LABELS[comp.mode]} · span ${spanText} · ${rows.length} marks · 1/${precision}″ · ${LAYOUT_TAPE_WARNING}`);
    printBlock.append(title, meta);
    const spanNum = spanIn ? toNumber(spanIn) : Infinity;
    if (spanNum <= PRINT_TRUE_SCALE_MAX_IN) {
      const pole = h('div', 'layout-print__pole');
      pole.style.height = `${spanNum}in`;
      for (const [i, m] of comp.marks.entries()) {
        const at = toNumber(m.cumulativeFromDatum);
        const tick = h('div', 'layout-print__tick');
        tick.style.top = `${at}in`;
        const lbl = h('span', undefined, `${i + 1} · ${rows[i]?.cumulative ?? ''}`);
        tick.append(lbl);
        pole.append(tick);
      }
      printBlock.append(h('p', 'layout-print__meta', 'Strip is at TRUE SCALE — check the first interval with a tape before trusting the printer.'), pole);
    } else {
      printBlock.append(h('p', 'layout-print__meta',
        `Span exceeds the ${PRINT_TRUE_SCALE_MAX_IN}″ true-scale strip — use the table and the read-aloud list.`));
    }
    const table = h('table');
    const hr2 = h('tr');
    for (const lab of ['mark', 'cumulative', 'incremental', 'mm']) hr2.append(h('th', undefined, lab));
    table.append(hr2);
    for (const r of rows) {
      const tr = h('tr');
      tr.append(h('td', undefined, String(r.mark)), h('td', undefined, r.cumulative), h('td', undefined, r.incremental), h('td', undefined, r.cumulativeMm));
      table.append(tr);
    }
    printBlock.append(table);
  };

  modeSelect.addEventListener('change', () => {
    mode = modeSelect.value as LayoutMode;
    syncModeFields();
    recompute();
  });
  for (const input of [spanInput, countInput, widthInput, marginInput, pitchInput]) {
    input.addEventListener('input', recompute);
  }

  /* ---------------- guidance ---------------- */
  const memory = new FadingStore();
  let guideHandle: GuideHandle | null = null;
  const guideDeps = {
    render: (step: { text: string; anchor?: string }, onDismiss: () => void): (() => void) => {
      const anchor = (step.anchor ? root.querySelector<HTMLElement>(step.anchor) : null) ?? name;
      const mark = coachMark(anchor, step.text, { onDismiss });
      return () => mark.dismiss();
    },
    sensorHook: (): (() => void) => () => undefined,
  };
  const startGuide = (level?: 'full'): void => {
    guideHandle?.stop();
    guideHandle = runGuide(LAYOUT_GUIDE, guideDeps, level ? { memory, level } : { memory });
  };
  const guideBtn = h('button', 'btn btn--ghost', 'GUIDE ME');
  guideBtn.type = 'button';
  guideBtn.addEventListener('click', () => startGuide('full'));
  const resetGuideBtn = h('button', 'btn btn--ghost', 'RESET GUIDE');
  resetGuideBtn.type = 'button';
  resetGuideBtn.setAttribute('aria-label', 'Reset guidance for this tool — prompts show again from the first run');
  resetGuideBtn.addEventListener('click', () => memory.reset('layout'));

  /* ---------------- bottom bar ---------------- */
  const printBtn = h('button', 'btn', 'PRINT');
  printBtn.type = 'button';
  printBtn.addEventListener('click', () => {
    if (typeof window.print === 'function') window.print();
  });
  const csvBtn = h('button', 'btn', 'CSV');
  csvBtn.type = 'button';
  let csvUrl: string | null = null;
  csvBtn.addEventListener('click', () => {
    if (!computation?.ok) return;
    const csv = storyPoleCsv(computation.marks, precision);
    if (typeof Blob === 'undefined' || typeof URL.createObjectURL !== 'function') return;
    if (csvUrl) URL.revokeObjectURL(csvUrl);
    csvUrl = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = h('a');
    a.href = csvUrl;
    a.download = 'layout-marks.csv';
    a.click();
  });
  root.append(bottomBar(guideBtn, resetGuideBtn, printBtn, csvBtn));

  el.append(root);
  recompute();
  startGuide();

  return () => {
    guideHandle?.stop();
    for (const c of cleanups) c();
    fusion?.stop();
    imu?.stop();
    void releaseWakeLock();
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    if (csvUrl) URL.revokeObjectURL(csvUrl);
  };
}
