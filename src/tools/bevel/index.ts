/**
 * BEVEL — angle capture and transfer (SPEC §4.5). Owned by A4 (Phase 2).
 *
 * Gravity capture is the default: two still placements across a level joint
 * edge → dihedral. The horizontal-edge condition is ENFORCED (capture.ts has
 * the derivation); a violation renders the refusal explanation, never the
 * invalid angle. 3D mode (advanced) links placements by gyro integration
 * with a visible drift budget and refuses at 20 s (GYRO_DRIFT). Practice
 * mode runs the full solver on typed numbers (§7B.9) — useful on the drive
 * to the store.
 *
 * The saw card states its METHOD louder than its numbers: flat and nested
 * take different settings for the same corner, and handing a carpenter the
 * wrong family wastes a stick of molding (§4.5.2, ADR-009).
 */
import './bevel.css';
import type { AppContext } from '../../app/router';
import type { Measurement, WarningKey } from '../../types';
import { sawCard, type CutMethod, type SawCardData } from '../../geometry/miter';
import {
  Bevel3DCapture,
  DRIFT_REFUSE_S,
  EDGE_TOL_MS2,
  GravityCapture,
  bladeTiltFromDihedralDeg,
  confidenceForStddev,
  dihedralFromCaptures,
  type CapturePhase,
  type DihedralOk,
  type FaceCapture,
  type ThreeDPhase,
} from './capture';
import { BEVEL_DEMOS, BEVEL_GUIDE, runBevelDemo, type BevelDemoHandle } from './guide';
import { DeviceMotionSource } from '../../sensors/imu';
import { requestMotionPermissions, recoveryInstructions } from '../../sensors/permissions';
import { announce } from '../../app/shell';
import { ensureAudio, tick } from '../../app/audio';
import { vibrate } from '../../app/haptics';
import { requestWakeLock, releaseWakeLock } from '../../app/wakelock';
import { listMeasurements, saveMeasurement } from '../../app/logStore';
import { calibrationsForProvenance, getProfile } from '../../app/calibrationStore';
import { bottomBar } from '../../ui/components/toolbar';
import { coachMark } from '../../ui/components/coach';
import { measuredEl, derivedEl } from '../../ui/components/number';
import { warningBanner, WARNING_COPY } from '../../ui/components/warning';
import { WARNING_EXPLAINERS } from '../../guidance/explainers';
import { FadingStore } from '../../guidance/fading';
import { runGuide, type GuideHandle } from '../../guidance/tour';

type BevelMode = 'gravity' | '3d' | 'practice';

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

/** Finite-difference propagation of a corner-angle σ through a saw setting. */
function propagate(fn: (cornerDeg: number) => number, cornerDeg: number, sigmaDeg: number): number {
  const d = 0.01;
  const slope = (fn(cornerDeg + d) - fn(cornerDeg - d)) / (2 * d);
  return Math.abs(slope) * sigmaDeg;
}

export function mount(el: HTMLElement, ctx: AppContext): () => void {
  const root = h('div', 'bevel');

  /* ---------------- state ---------------- */
  let mode: BevelMode = 'gravity';
  let sensorsOn = false;
  let corner: { deg: number; sigmaDeg: number | null; source: 'captured' | 'entered' | 'log' } | null = null;
  let springDeg = 45;
  let method: CutMethod = 'flat';
  let lastResult: DihedralOk | null = null;
  let lastCaptures: { c1: FaceCapture; c2: FaceCapture } | null = null;
  let ranRecorded = false;
  let demoHandle: BevelDemoHandle | null = null;
  const cleanups: Array<() => void> = [];

  const gravity = new GravityCapture();
  const threeD = new Bevel3DCapture();
  let firstFace: FaceCapture | null = null;
  let imu: DeviceMotionSource | null = null;

  /* ---------------- header ---------------- */
  const head = h('div', 'bevel__head');
  const name = h('h1', 'bevel__name display', 'BEVEL');
  const practice = h('span', 'practicebadge', 'PRACTICE — typed numbers');
  practice.id = 'bevel-practice';
  practice.title = 'The full solver runs on typed numbers — no sensor attached (SPEC §7B.9).';
  head.append(name, practice);
  root.append(head);

  const syncPractice = (): void => {
    practice.style.display = mode === 'practice' || !sensorsOn ? '' : 'none';
  };

  /* ---------------- mode switch ---------------- */
  const modeRow = h('div', 'bevel__modes');
  const modeBtns: Array<{ m: BevelMode; btn: HTMLButtonElement }> = [];
  const modeDefs: Array<{ m: BevelMode; label: string; disabled?: string }> = [
    { m: 'gravity', label: 'GRAVITY (DEFAULT)' },
    {
      m: '3d',
      label: '3D (ADVANCED)',
      ...(ctx.capability.hasGyro ? {} : { disabled: 'No gyroscope on this device — 3D mode needs one.' }),
    },
    { m: 'practice', label: 'PRACTICE' },
  ];
  for (const def of modeDefs) {
    const b = h('button', 'btn btn--ghost', def.label);
    b.type = 'button';
    if (def.disabled) {
      b.disabled = true;
      b.title = def.disabled;
    }
    b.addEventListener('click', () => {
      mode = def.m;
      syncMode();
    });
    modeBtns.push({ m: def.m, btn: b });
    modeRow.append(b);
  }
  root.append(modeRow);

  /* ---------------- capture section ---------------- */
  const capSection = h('section');
  capSection.id = 'bevel-capture';
  capSection.append(h('h2', 'display', 'CAPTURE'));
  const capHint = h('p', 'bevel__hint');
  const capLine = h('p', 'bevel__capline');
  const wakeBtn = h('button', 'btn', 'WAKE SENSORS');
  wakeBtn.id = 'bevel-wake';
  wakeBtn.type = 'button';
  const startBtn = h('button', 'btn', 'START CAPTURE');
  startBtn.type = 'button';
  startBtn.disabled = true;
  const stateWord = h('p', 'bevel__state', '—');
  stateWord.id = 'bevel-state';
  const subState = h('p', 'bevel__substate');
  const facesLine = h('div', 'bevel__faces');
  const driftLine = h('p', 'bevel__drift');
  driftLine.style.display = 'none';
  const capOut = h('div');
  capOut.id = 'bevel-result';
  capSection.append(capHint, capLine, wakeBtn, startBtn, stateWord, subState, facesLine, driftLine, capOut);
  root.append(capSection);

  const yawLine = (): string =>
    ctx.capability.magTier !== 'NONE' || ctx.capability.hasAbsoluteOrientation
      ? 'Yaw on this device can reference the magnetic field — nearby steel corrupts it, so 3D mode still links placements by gyro and shows the drift budget.'
      : 'No magnetic yaw on this device — 3D mode is gyro-only between placements, and the drift budget is the whole story.';

  const syncMode = (): void => {
    for (const { m, btn } of modeBtns) btn.setAttribute('aria-pressed', m === mode ? 'true' : 'false');
    capSection.style.display = mode === 'practice' ? 'none' : '';
    if (mode === 'gravity') {
      capHint.textContent =
        'Lay the phone flat on the first face, LONG EDGE against the joint, and hold still about a second. Then the same on the second face. Valid only across a LEVEL joint edge — the tool checks and refuses otherwise.';
      capLine.textContent = `Edge check: gravity along the long edge must stay under ${EDGE_TOL_MS2} m/s² in both captures.`;
    } else if (mode === '3d') {
      capHint.textContent =
        'Capture the first face, move directly to the second, capture again. No level-edge rule — but the link between placements rides on the gyro, and drift grows every second.';
      capLine.textContent = yawLine();
    }
    driftLine.style.display = 'none';
    syncPractice();
    renderCard();
  };

  const resetCaptureUi = (): void => {
    stateWord.textContent = '—';
    stateWord.classList.remove('bevel__state--hold');
    subState.textContent = '';
    facesLine.replaceChildren();
    capOut.replaceChildren();
    driftLine.style.display = 'none';
    lastResult = null;
    lastCaptures = null;
    firstFace = null;
  };

  wakeBtn.addEventListener('click', () => {
    void (async () => {
      ensureAudio();
      const perm = await requestMotionPermissions();
      if (perm.motion === 'denied' || perm.orientation === 'denied') {
        stateWord.textContent = 'MOTION BLOCKED';
        subState.textContent = recoveryInstructions('motion', ctx.capability.platformHint);
        return;
      }
      if (perm.motion === 'unavailable') {
        stateWord.textContent = 'NO MOTION SENSOR';
        subState.textContent = 'This device reports no motion sensor. PRACTICE mode still solves typed angles.';
        return;
      }
      imu = new DeviceMotionSource();
      await imu.start();
      cleanups.push(imu.subscribe(onSample));
      sensorsOn = true;
      syncPractice();
      void requestWakeLock();
      wakeBtn.disabled = true;
      startBtn.disabled = false;
      stateWord.textContent = 'READY';
      announce('Motion sensors on');
      guideHandle?.fireCustom('sensors-started');
    })();
  });

  startBtn.addEventListener('click', () => {
    resetCaptureUi();
    gravity.reset();
    threeD.reset();
    if (mode === 'gravity') {
      gravity.arm();
      stateWord.textContent = 'FACE 1 — HOLD STILL';
    } else {
      threeD.arm();
      stateWord.textContent = 'FACE 1 — HOLD STILL';
    }
  });

  const showCapturePhase = (phase: CapturePhase, faceLabel: string): void => {
    if (phase.phase === 'moving') {
      stateWord.textContent = `${faceLabel} — MOVING`;
      stateWord.classList.remove('bevel__state--hold');
    } else if (phase.phase === 'settling') {
      stateWord.textContent = `${faceLabel} — HOLD`;
      stateWord.classList.add('bevel__state--hold');
      subState.textContent = `Averaging… ${Math.round(phase.progress * 100)}%`;
    }
  };

  function onSample(s: import('../../sensors/types').ImuSample): void {
    if (mode === 'gravity') {
      const phase = gravity.ingest(s);
      if (phase.phase === 'captured') {
        if (firstFace === null) {
          firstFace = phase.capture;
          renderFaceLine(1, firstFace);
          tick('soft');
          vibrate(30);
          announce('Face one captured');
          guideHandle?.fireCustom('face1-captured');
          gravity.reset();
          gravity.arm();
          stateWord.textContent = 'FACE 2 — HOLD STILL';
          subState.textContent = 'Move across the joint, same edge against it.';
        } else if (lastResult === null && capOut.childNodes.length === 0) {
          renderFaceLine(2, phase.capture);
          tick('soft');
          vibrate([30, 40, 30]);
          announce('Face two captured');
          guideHandle?.fireCustom('face2-captured');
          finishGravity(firstFace, phase.capture);
        }
      } else {
        showCapturePhase(phase, firstFace === null ? 'FACE 1' : 'FACE 2');
      }
    } else if (mode === '3d') {
      const phase = threeD.ingest(s);
      render3DPhase(phase);
    }
  }

  const renderFaceLine = (n: number, c: FaceCapture): void => {
    const span = h('span');
    span.append(
      h('span', 'bevel__hint', `Face ${n}: edge `),
      h('span', 'hud', `${c.edgeMs2.toFixed(2)} m/s²`),
      h('span', 'bevel__hint', ` · scatter ${c.stddevDeg.toFixed(2)}° · ${c.sampleCount} samples`),
    );
    facesLine.append(span);
  };

  const finishGravity = (c1: FaceCapture, c2: FaceCapture): void => {
    const result = dihedralFromCaptures(c1, c2);
    if (!result.ok) {
      stateWord.textContent = 'REFUSED';
      stateWord.classList.remove('bevel__state--hold');
      subState.textContent = '';
      const refusal = h('div', 'bevel__refusal', result.reason);
      refusal.setAttribute('role', 'alert');
      capOut.append(refusal);
      const again = h('button', 'btn', 'CAPTURE AGAIN');
      again.type = 'button';
      again.addEventListener('click', () => startBtn.click());
      capOut.append(again);
      announce(result.reason, 'assertive');
      return;
    }
    lastResult = result;
    lastCaptures = { c1, c2 };
    stateWord.textContent = 'CAPTURED';
    subState.textContent = '';
    if (!ranRecorded) {
      ranRecorded = true;
      memory.recordRun('bevel');
    }
    const m = measurementFrom(result, c1, c2, 'gravity dihedral');
    const line = h('div');
    line.append(measuredEl(m, { size: 'primary', decimals: 1 }));
    capOut.append(line);
    capOut.append(h('p', 'bevel__hint',
      `Fold angle between the faces. Blade tilt to reproduce this face on flat stock: ${bladeTiltFromDihedralDeg(result.thetaDeg).toFixed(1)}° from vertical.`));
    const useBtn = h('button', 'btn', 'USE AS CORNER ANGLE');
    useBtn.type = 'button';
    useBtn.addEventListener('click', () => {
      corner = { deg: result.thetaDeg, sigmaDeg: result.plusMinusDeg, source: 'captured' };
      cornerInput.value = result.thetaDeg.toFixed(1);
      renderCard();
      announce(`Corner set to ${result.thetaDeg.toFixed(1)} degrees`);
    });
    const saveBtn = h('button', 'btn', 'SAVE TO LOG');
    saveBtn.type = 'button';
    saveBtn.addEventListener('click', () => {
      void saveMeasurement(measurementFrom(result, c1, c2, sawProvenanceNote()), { note: 'BEVEL gravity capture' });
      saveBtn.disabled = true;
      saveBtn.textContent = 'SAVED';
      announce('Saved to log');
    });
    capOut.append(useBtn, saveBtn);
    renderAngleTable();
    announce(`Dihedral ${result.thetaDeg.toFixed(1)} degrees, plus or minus ${result.plusMinusDeg.toFixed(1)}`);
  };

  const render3DPhase = (phase: ThreeDPhase): void => {
    if (phase.phase === 'face1') {
      showCapturePhase(phase.capture, 'FACE 1');
      return;
    }
    if (phase.phase === 'transit') {
      driftLine.style.display = '';
      const left = Math.max(0, DRIFT_REFUSE_S - phase.elapsedS);
      driftLine.textContent = `Drift budget ±${phase.budgetDeg.toFixed(1)}° · ${left.toFixed(0)} s left of ${DRIFT_REFUSE_S}`;
      driftLine.classList.toggle('bevel__drift--late', left <= 5);
      if (phase.capture.phase === 'moving') {
        stateWord.textContent = 'MOVE TO FACE 2';
        stateWord.classList.remove('bevel__state--hold');
        subState.textContent = 'Go directly — the budget is running.';
      } else {
        showCapturePhase(phase.capture, 'FACE 2');
      }
      return;
    }
    if (phase.phase === 'refused') {
      if (capOut.childNodes.length > 0) return;
      stateWord.textContent = 'REFUSED';
      stateWord.classList.remove('bevel__state--hold');
      subState.textContent = '';
      driftLine.style.display = 'none';
      const key: WarningKey = 'GYRO_DRIFT';
      const banner = warningBanner(key, WARNING_COPY[key], () => showExplainer(key));
      const refusal = h('div', 'bevel__refusal', phase.reason);
      refusal.setAttribute('role', 'alert');
      const again = h('button', 'btn', 'CAPTURE AGAIN');
      again.type = 'button';
      again.addEventListener('click', () => startBtn.click());
      capOut.append(banner, refusal, again);
      announce(phase.reason, 'assertive');
      return;
    }
    if (phase.phase === 'done' && capOut.childNodes.length === 0) {
      const r = phase.result;
      stateWord.textContent = 'CAPTURED';
      subState.textContent = '';
      if (!ranRecorded) {
        ranRecorded = true;
        memory.recordRun('bevel');
      }
      const m: Measurement = {
        id: newId(),
        kind: 'bevel',
        value: r.thetaDeg,
        unit: '°',
        uncertainty: { plusMinus: r.plusMinusDeg, basis: 'nominal' },
        confidence: confidenceForStddev(Math.hypot(r.c1.stddevDeg, r.c2.stddevDeg)),
        provenance: {
          tier: ctx.capability.magTier,
          calibrations: calibrationsForProvenance(getProfile()),
          sampleCount: r.c1.sampleCount + r.c2.sampleCount,
          capturedAt: Date.now(),
          notes: `3D gyro-linked capture · elapsed ${r.elapsedS.toFixed(1)} s · drift budget ±${r.budgetDeg.toFixed(1)}°`,
        },
      };
      capOut.append(measuredEl(m, { size: 'primary', decimals: 1 }));
      capOut.append(h('p', 'bevel__hint',
        `± includes the gyro drift budget (±${r.budgetDeg.toFixed(1)}° after ${r.elapsedS.toFixed(1)} s) — basis nominal, not window scatter alone.`));
      const useBtn = h('button', 'btn', 'USE AS CORNER ANGLE');
      useBtn.type = 'button';
      useBtn.addEventListener('click', () => {
        corner = { deg: r.thetaDeg, sigmaDeg: r.plusMinusDeg, source: 'captured' };
        cornerInput.value = r.thetaDeg.toFixed(1);
        renderCard();
      });
      const saveBtn = h('button', 'btn', 'SAVE TO LOG');
      saveBtn.type = 'button';
      saveBtn.addEventListener('click', () => {
        void saveMeasurement(m, { note: 'BEVEL 3D capture' });
        saveBtn.disabled = true;
        saveBtn.textContent = 'SAVED';
      });
      capOut.append(useBtn, saveBtn);
      announce(`Dihedral ${r.thetaDeg.toFixed(1)} degrees`);
    }
  };

  const measurementFrom = (r: DihedralOk, c1: FaceCapture, c2: FaceCapture, notes: string): Measurement => ({
    id: newId(),
    kind: 'bevel',
    value: r.thetaDeg,
    unit: '°',
    uncertainty: { plusMinus: r.plusMinusDeg, basis: 'stddev' },
    confidence: confidenceForStddev(Math.hypot(c1.stddevDeg, c2.stddevDeg)),
    provenance: {
      tier: ctx.capability.magTier,
      calibrations: calibrationsForProvenance(getProfile()),
      sampleCount: c1.sampleCount + c2.sampleCount,
      capturedAt: Date.now(),
      notes,
    },
  });

  const sawProvenanceNote = (): string => {
    if (corner === null) return 'gravity dihedral';
    const card = sawCard({ cornerDeg: corner.deg, springDeg, method });
    return `saw card (${method}): miter ${card.miterDeg.toFixed(1)}°, bevel ${card.bevelDeg.toFixed(1)}°, spring ${springDeg}°`;
  };

  /* ---------------- explainer sheet ---------------- */
  const explainerBox = h('div', 'explainerbox');
  explainerBox.style.display = 'none';
  const showExplainer = (key: WarningKey): void => {
    const ex = WARNING_EXPLAINERS[key];
    explainerBox.replaceChildren(
      h('h2', 'display', ex.title),
      h('p', 'bevel__hint', `Why: ${ex.why}`),
      h('p', 'bevel__hint', `What to do: ${ex.whatToDo}`),
      h('p', 'bevel__hint', `If you ignore it: ${ex.ifIgnored}`),
    );
    explainerBox.style.display = '';
  };
  root.append(explainerBox);

  /* ---------------- solver / saw card ---------------- */
  const solveSection = h('section');
  solveSection.id = 'bevel-solver';
  solveSection.append(h('h2', 'display', 'SAW SETTINGS'));
  solveSection.append(h('p', 'bevel__hint',
    'Corner angle + spring angle → the saw card. The captured dihedral can feed the corner; everything also works typed (practice).'));

  const form = h('div', 'bevel__form');
  const cornerField = h('div', 'bevel__field');
  const cornerLab = h('label', undefined, 'Corner angle (wall to wall)');
  cornerLab.setAttribute('for', 'bevel-corner');
  const cornerInput = h('input');
  cornerInput.id = 'bevel-corner';
  cornerInput.type = 'number';
  cornerInput.step = '0.1';
  cornerInput.min = '1';
  cornerInput.max = '359';
  cornerInput.value = '90';
  const cornerErr = h('span', 'bevel__parse-error');
  cornerField.append(cornerLab, cornerInput, cornerErr);

  const springField = h('div', 'bevel__field');
  const springLab = h('label', undefined, 'Spring angle (crown off the wall)');
  springLab.setAttribute('for', 'bevel-spring');
  const springInput = h('input');
  springInput.id = 'bevel-spring';
  springInput.type = 'number';
  springInput.step = '0.1';
  springInput.min = '0';
  springInput.max = '90';
  springInput.value = '45';
  const springErr = h('span', 'bevel__parse-error');
  springField.append(springLab, springInput, springErr);
  form.append(cornerField, springField);
  solveSection.append(form);

  const springRow = h('div', 'bevel__springrow');
  for (const preset of [
    { label: '45/45 CROWN', spring: 45 },
    { label: '52/38 CROWN', spring: 38 },
  ]) {
    const b = h('button', 'btn btn--ghost', preset.label);
    b.type = 'button';
    b.addEventListener('click', () => {
      springDeg = preset.spring;
      springInput.value = String(preset.spring);
      renderCard();
    });
    springRow.append(b);
  }
  const measureSpringBtn = h('button', 'btn btn--ghost', 'MEASURE SPRING (CAPTURE)');
  measureSpringBtn.type = 'button';
  measureSpringBtn.title = 'Capture wall → crown back with the gravity capture above, then USE the folded angle here: spring = the captured fold, or 180° minus it if you folded the long way.';
  measureSpringBtn.addEventListener('click', () => {
    if (lastResult) {
      const t = lastResult.thetaDeg;
      springDeg = t <= 90 ? t : 180 - t;
      springInput.value = springDeg.toFixed(1);
      renderCard();
      announce(`Spring set to ${springDeg.toFixed(1)} degrees from the capture`);
    } else {
      announce('Capture the wall and the crown back first — the last capture feeds the spring angle.');
      measureSpringBtn.title += ' No capture yet.';
    }
  });
  springRow.append(measureSpringBtn);
  solveSection.append(springRow);

  // corner from the LOG (kind 'corner'), like LAYOUT offers studs
  const cornerRow = h('div', 'bevel__cornerrow');
  const cornerLogBtn = h('button', 'btn btn--ghost', 'USE CORNER FROM LOG');
  cornerLogBtn.type = 'button';
  const cornerLogBody = h('div');
  cornerRow.append(cornerLogBtn);
  solveSection.append(cornerRow, cornerLogBody);
  cornerLogBtn.addEventListener('click', () => {
    void (async () => {
      const entries = await listMeasurements();
      const corners = entries.filter(
        (e) => e.measurement.kind === 'corner' && typeof e.measurement.value === 'number' && e.measurement.unit.trim() === '°',
      );
      cornerLogBody.replaceChildren();
      if (corners.length === 0) {
        const p = h('p', 'bevel__hint', 'No corner measurements in the log. Photograph the corner in CORNER and save it — it appears here. ');
        const a = h('a', undefined, 'Open CORNER');
        a.href = '#/corner';
        p.append(a);
        cornerLogBody.append(p);
        return;
      }
      const list = h('ul', 'cornerlist');
      for (const e of corners) {
        const m = e.measurement;
        const li = h('li');
        const pick = h('button', 'btn btn--ghost', `${(m.value as number).toFixed(1)}°`);
        pick.type = 'button';
        pick.addEventListener('click', () => {
          corner = { deg: m.value as number, sigmaDeg: m.uncertainty.plusMinus, source: 'log' };
          cornerInput.value = (m.value as number).toFixed(1);
          renderCard();
          announce(`Corner ${(m.value as number).toFixed(1)} degrees from the log`);
        });
        li.append(
          pick,
          h('span', `conf conf--${m.confidence.toLowerCase()}`, m.confidence),
          h('span', 'bevel__hint', `±${m.uncertainty.plusMinus.toFixed(1)}° · ${fmtAge(Math.max(0, Date.now() - m.provenance.capturedAt))}`),
        );
        list.append(li);
      }
      cornerLogBody.append(list);
    })();
  });

  // method switch — the flat/nested distinction, unmissable
  const methodRow = h('div', 'bevel__modes');
  const methodBtns: Array<{ m: CutMethod; btn: HTMLButtonElement }> = [];
  for (const def of [
    { m: 'flat' as const, label: 'CUT FLAT' },
    { m: 'nested' as const, label: 'CUT NESTED' },
  ]) {
    const b = h('button', 'btn btn--ghost', def.label);
    b.type = 'button';
    b.addEventListener('click', () => {
      method = def.m;
      renderCard();
    });
    methodBtns.push({ m: def.m, btn: b });
    methodRow.append(b);
  }
  solveSection.append(methodRow);

  const cardWrap = h('div');
  cardWrap.id = 'bevel-card';
  solveSection.append(cardWrap);
  root.append(solveSection);

  cornerInput.addEventListener('input', () => {
    const v = Number(cornerInput.value);
    if (!Number.isFinite(v) || v <= 0 || v >= 360) {
      cornerErr.textContent = 'Corner must be between 0° and 360°, exclusive.';
      return;
    }
    cornerErr.textContent = '';
    corner = { deg: v, sigmaDeg: null, source: 'entered' };
    renderCard();
  });
  springInput.addEventListener('input', () => {
    const v = Number(springInput.value);
    if (!Number.isFinite(v) || v < 0 || v > 90) {
      springErr.textContent = 'Spring must be between 0° and 90°.';
      return;
    }
    springErr.textContent = '';
    springDeg = v;
    renderCard();
  });

  const settingEl = (label: string, value: number, sigmaDeg: number | null): HTMLElement => {
    const wrap = h('div', 'sawcard__num');
    wrap.append(h('span', 'label', label));
    if (sigmaDeg !== null) {
      wrap.append(derivedEl(value, '°', Math.max(0.05, sigmaDeg), 'stddev', { size: 'primary', decimals: 1 }));
    } else {
      wrap.append(h('span', 'derived hud', `${value.toFixed(1)}°`));
    }
    return wrap;
  };

  const renderCard = (): void => {
    cardWrap.replaceChildren();
    if (corner === null) {
      corner = { deg: Number(cornerInput.value) || 90, sigmaDeg: null, source: 'entered' };
    }
    const c = corner;
    let card: SawCardData;
    try {
      card = sawCard({ cornerDeg: c.deg, springDeg, method });
    } catch {
      return; // out-of-range values already flagged at the inputs
    }
    for (const { m, btn } of methodBtns) btn.setAttribute('aria-pressed', m === method ? 'true' : 'false');

    const box = h('div', 'sawcard');
    const methodLine = h('p', 'sawcard__method',
      card.method === 'flat'
        ? 'METHOD: FLAT — crown on its back on the table'
        : 'METHOD: NESTED — crown upside down against the fence');
    methodLine.setAttribute('data-method', card.method);
    box.append(methodLine);

    const nums = h('div', 'sawcard__numbers');
    const miterSigma = c.sigmaDeg !== null
      ? propagate((cd) => sawCard({ cornerDeg: cd, springDeg, method }).miterDeg, c.deg, c.sigmaDeg)
      : null;
    const bevelSigma = c.sigmaDeg !== null
      ? propagate((cd) => sawCard({ cornerDeg: cd, springDeg, method }).bevelDeg, c.deg, c.sigmaDeg)
      : null;
    nums.append(settingEl('MITER (table)', card.miterDeg, miterSigma));
    nums.append(settingEl('BEVEL (blade tilt)', card.bevelDeg, bevelSigma));
    box.append(nums);

    const srcLine = h('p', 'bevel__capline',
      c.source === 'captured'
        ? `Corner ${c.deg.toFixed(1)}° is MEASURED (capture, ±${(c.sigmaDeg ?? 0).toFixed(1)}°); the settings are derived from it.`
        : c.source === 'log'
          ? `Corner ${c.deg.toFixed(1)}° comes from the LOG (±${(c.sigmaDeg ?? 0).toFixed(1)}°); the settings are derived from it.`
          : `Corner ${c.deg.toFixed(1)}° is ENTERED — the settings are exact math on your number; the corner itself is your claim.`);
    box.append(srcLine);

    const lines = h('ul', 'sawcard__lines');
    for (const text of [card.tiltDirection, card.fenceSide, card.keeperSide, card.flipMate]) {
      lines.append(h('li', undefined, text));
    }
    const test = h('li', 'sawcard__test', card.testCutNote);
    lines.append(test);
    box.append(lines);
    cardWrap.append(box);
  };

  /* ---------------- common-angle table ---------------- */
  const tableSection = h('section');
  tableSection.id = 'bevel-angles';
  tableSection.append(h('h2', 'display', 'COMMON ANGLES'));
  tableSection.append(h('p', 'bevel__hint', 'Hold a row to transfer its corner into the solver. The measured value, when one exists, pins to the top.'));
  const angleTable = h('table', 'angletable');
  const angleHead = h('tr');
  for (const lab of ['CORNER', 'SIMPLE MITER (each piece)', 'TRANSFER']) angleHead.append(h('th', undefined, lab));
  angleTable.append(angleHead);
  const angleBody = h('tbody');
  angleTable.append(angleBody);
  tableSection.append(angleTable);
  root.append(tableSection);

  const renderAngleTable = (): void => {
    angleBody.replaceChildren();
    const rows: Array<{ cornerDeg: number; pinned: boolean }> = [];
    if (lastResult) rows.push({ cornerDeg: lastResult.thetaDeg, pinned: true });
    for (const cd of [90, 45, 22.5, 135]) rows.push({ cornerDeg: cd, pinned: false });
    for (const r of rows) {
      const tr = h('tr');
      if (r.pinned) tr.setAttribute('data-pinned', 'true');
      tr.append(h('td', undefined, r.pinned ? `${r.cornerDeg.toFixed(1)}° (measured)` : `${r.cornerDeg}°`));
      tr.append(h('td', undefined, `${((180 - r.cornerDeg) / 2).toFixed(1)}°`));
      const td = h('td');
      const btn = h('button', 'btn btn--ghost', 'HOLD');
      btn.type = 'button';
      btn.setAttribute('aria-label', `Hold to transfer ${r.cornerDeg} degrees into the solver`);
      let timer: ReturnType<typeof setTimeout> | null = null;
      const transfer = (): void => {
        corner = { deg: r.cornerDeg, sigmaDeg: r.pinned ? (lastResult?.plusMinusDeg ?? null) : null, source: r.pinned ? 'captured' : 'entered' };
        cornerInput.value = String(r.cornerDeg);
        renderCard();
        announce(`Corner ${r.cornerDeg} degrees loaded`);
      };
      btn.addEventListener('pointerdown', () => {
        timer = setTimeout(transfer, 400);
      });
      for (const ev of ['pointerup', 'pointerleave', 'pointercancel'] as const) {
        btn.addEventListener(ev, () => {
          if (timer !== null) clearTimeout(timer);
          timer = null;
        });
      }
      btn.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          transfer();
        }
      });
      td.append(btn);
      tr.append(td);
      angleBody.append(tr);
    }
  };
  renderAngleTable();

  /* ---------------- DEMO (ADR-012: synthetic streams, real pipeline) ------ */
  const demoSection = h('section');
  demoSection.id = 'bevel-demo';
  demoSection.append(h('h2', 'display', 'DEMO'));
  demoSection.append(h('p', 'bevel__hint',
    'Deterministic synthetic IMU streams played through the real capture pipeline — including the two refusals. The limits teach first.'));
  const demoRow = h('div', 'bevel__demos');
  const demoPanel = h('div', 'demopanel');
  demoPanel.style.display = 'none';
  for (const [id, spec] of Object.entries(BEVEL_DEMOS)) {
    const b = h('button', 'btn btn--ghost', spec.title.toUpperCase());
    b.type = 'button';
    b.setAttribute('data-demo-id', id);
    b.addEventListener('click', () => {
      demoHandle?.stop();
      demoPanel.replaceChildren();
      demoPanel.style.display = '';
      const label = h('span', 'demopanel__label');
      const narration = h('ul', 'demopanel__narration');
      const outcome = h('div');
      demoPanel.append(label, h('h2', 'display', spec.title), narration, outcome);
      demoHandle = runBevelDemo(spec, {
        onSyntheticLabel: (text) => {
          label.textContent = text;
        },
        onNarration: (line) => {
          narration.append(h('li', undefined, line.text));
        },
        onPhase: (phase) => {
          // 3D demo phases drive the live drift countdown too
          if (phase.phase === 'transit') {
            driftLine.style.display = '';
            driftLine.textContent = `Drift budget ±${phase.budgetDeg.toFixed(1)}° · ${Math.max(0, DRIFT_REFUSE_S - phase.elapsedS).toFixed(0)} s left of ${DRIFT_REFUSE_S}`;
          }
        },
        onResult: (result) => {
          if ('ok' in result) {
            if (result.ok) {
              outcome.append(h('p', 'bevel__hint',
                `Pipeline result: θ = ${result.thetaDeg.toFixed(1)}° ± ${result.plusMinusDeg.toFixed(1)}° (window scatter).`));
            } else {
              const refusal = h('div', 'bevel__refusal', result.reason);
              refusal.setAttribute('role', 'alert');
              outcome.append(refusal);
            }
          } else if (result.phase === 'refused') {
            const banner = warningBanner('GYRO_DRIFT', WARNING_COPY.GYRO_DRIFT, () => showExplainer('GYRO_DRIFT'));
            const refusal = h('div', 'bevel__refusal', result.reason);
            refusal.setAttribute('role', 'alert');
            outcome.append(banner, refusal);
          } else if (result.phase === 'done') {
            outcome.append(h('p', 'bevel__hint',
              `Pipeline result: θ = ${result.result.thetaDeg.toFixed(1)}° ± ${result.result.plusMinusDeg.toFixed(1)}° (incl. drift budget).`));
          }
        },
        onEnd: () => {
          demoPanel.append(h('p', 'bevel__hint', 'End of stream. The same generator feeds the unit suite — the demo cannot drift from tested behavior.'));
        },
      }, { speed: 4 });
    });
    demoRow.append(b);
  }
  demoSection.append(demoRow, demoPanel);
  root.append(demoSection);

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
    guideHandle = runGuide(BEVEL_GUIDE, guideDeps, level ? { memory, level } : { memory });
  };
  const guideBtn = h('button', 'btn btn--ghost', 'GUIDE ME');
  guideBtn.type = 'button';
  guideBtn.addEventListener('click', () => startGuide('full'));
  const resetGuideBtn = h('button', 'btn btn--ghost', 'RESET GUIDE');
  resetGuideBtn.type = 'button';
  resetGuideBtn.setAttribute('aria-label', 'Reset guidance for this tool — prompts show again from the first run');
  resetGuideBtn.addEventListener('click', () => memory.reset('bevel'));

  root.append(bottomBar(guideBtn, resetGuideBtn));

  syncMode();
  renderCard();
  el.append(root);
  startGuide();

  return () => {
    guideHandle?.stop();
    demoHandle?.stop();
    for (const c of cleanups) c();
    imu?.stop();
    void releaseWakeLock();
  };
}
