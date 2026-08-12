/**
 * LEVEL — digital level + plumb with live camera overlay (SPEC §4.2). A5.
 *
 * One DeviceMotionSource, one OrientationFusion, started on the §6.1
 * gesture. The motion gate is enforced in the render path: while the fusion
 * is not stable the reading dims, the state word is MOVING, and the live
 * Measurement carries basis 'unknown' — a twitching number is never
 * presented as a measurement, and never saved (SPEC §4.2.1, §15.1).
 *
 * Modes (§4.2.3): SURFACE (2-axis bubble), EDGE (huge numeral, LEVEL lock,
 * tone + haptic), PLUMB (deviation + out-over-run), OVERLAY (camera).
 * Zeroing (§4.2.2): ZERO HERE per mode + the reversal walkthrough, guide-
 * engine-driven. Claim discipline (§2.3.5): ±0.5° until reversal, ±0.15°
 * after, stale > 30 days suggests recalibration.
 */
import type { AppContext } from '../../app/router';
import type { Measurement } from '../../types';
import type { Orientation } from '../../sensors/types';
import { DeviceMotionSource } from '../../sensors/imu';
import { OrientationFusion } from '../../sensors/orientation';
import { recoveryInstructions, requestMotionPermissions } from '../../sensors/permissions';
import { outOverRun } from '../../geometry/levelMath';
import { derivedEl, enteredEl, measuredEl, type MeasuredNumberEl } from '../../ui/components/number';
import { ghostBob } from '../../ui/components/mark';
import { warningBanner, WARNING_COPY } from '../../ui/components/warning';
import { bottomBar } from '../../ui/components/toolbar';
import { coachMark } from '../../ui/components/coach';
import { announce } from '../../app/shell';
import { ensureAudio, levelTone, resetLevelTone } from '../../app/audio';
import { vibrate } from '../../app/haptics';
import { releaseWakeLock, requestWakeLock } from '../../app/wakelock';
import { saveMeasurement, saveMedia } from '../../app/logStore';
import {
  calibrationsForProvenance,
  getProfile,
  persistenceOk,
  subscribeProfile,
  updateProfile,
} from '../../app/calibrationStore';
import { rafWriter } from '../../app/store';
import { runGuide, type GuideDeps, type GuideHandle } from '../../guidance/tour';
import { FadingStore } from '../../guidance/fading';
import { UNCERTAINTY_EXPLAINER, WARNING_EXPLAINERS } from '../../guidance/explainers';
import { cameraOverlay } from '../../ui/overlay/cameraOverlay';
import {
  bubbleXY,
  edgeAngleDeg,
  kindForMode,
  LEVEL_MODES,
  LOCK_TOL_DEG,
  plumbAngleDeg,
  screenTiltDeg,
  surfaceTiltDeg,
  type LevelMode,
} from './levelModes';
import {
  buildSaveMeasurement,
  claimFor,
  displayMeasurement,
  HoldWindow,
  LevelSession,
  ReversalMachine,
  slopeStripModel,
  type LevelClaim,
  type ReversalResult,
} from './levelState';
import { DEMOS, LEVEL_GUIDE, reversalGuideSpec } from './guide';
import { runLevelImuDemo, type LevelDemoHandle } from './demoStream';
import { LEVEL_CSS } from './style';

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;
const DEFAULT_PLUMB_HEIGHT_IN = 96;

interface View {
  stable: boolean;
  /** Bias-corrected, pre-zero mode readings (degrees). */
  pre: { pitch: number; roll: number; edge: number; plumb: number; tilt: number };
  /** Zero-applied display values (degrees). */
  pitch: number;
  roll: number;
  edge: number;
  plumb: number;
  tilt: number;
  primary: number;
}

const MODE_LABEL: Record<LevelMode, string> = {
  surface: 'SURFACE',
  edge: 'EDGE',
  plumb: 'PLUMB',
  overlay: 'OVERLAY',
};

export function mount(el: HTMLElement, ctx: AppContext): () => void {
  const platform = ctx.capability.platformHint;
  const tier = ctx.capability.magTier;

  const imu = new DeviceMotionSource();
  const fusion = new OrientationFusion(imu);
  const session = new LevelSession();
  const holdWindow = new HoldWindow();
  const memory = new FadingStore();

  let mode: LevelMode = 'surface';
  let claim: LevelClaim = claimFor(getProfile());
  let view: View | null = null;
  let wasStable = false;
  let wasLocked = false;
  let sensorsLive = false;
  let demoActive = false;
  let demoHandle: LevelDemoHandle | null = null;
  let guideHandle: GuideHandle | null = null;
  let revHandle: GuideHandle | null = null;
  let plumbHeightIn = DEFAULT_PLUMB_HEIGHT_IN;
  let lastStripDeg: number | null = null;
  let lastOutDeg: number | null = null;
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  /** H-02: the live stream reported dead — the last value is dimmed, the
   *  state word says SENSOR LOST, and the recovery panel shows. Cleared by
   *  the next real sample. */
  let sensorLost = false;
  let healthPoll: ReturnType<typeof setInterval> | null = null;
  const unsubs: Array<() => void> = [];

  /* ================= DOM ================= */

  const root = document.createElement('div');
  root.className = 'level';
  const style = document.createElement('style');
  style.textContent = LEVEL_CSS;
  root.append(style);

  // -- top row: state word, zero chip, guide me --
  const top = document.createElement('div');
  top.className = 'level__top';
  const stateWord = document.createElement('span');
  stateWord.className = 'level__state level__state--moving';
  stateWord.textContent = 'MOVING';
  const zeroChip = document.createElement('span');
  zeroChip.className = 'level__zerochip';
  zeroChip.textContent = 'ZEROED';
  zeroChip.hidden = true;
  const guideMe = document.createElement('button');
  guideMe.type = 'button';
  guideMe.className = 'btn btn--ghost level__guideme';
  guideMe.textContent = 'GUIDE ME';
  top.append(stateWord, zeroChip, guideMe);
  root.append(top);

  // -- claim line (§2.3.5: says which state is in effect; routes to REVERSE) --
  const claimBtn = document.createElement('button');
  claimBtn.type = 'button';
  claimBtn.className = 'level__claim';
  root.append(claimBtn);

  // -- source-health warning host (H-02: degraded rate surfaces, never silent) --
  const healthWarn = document.createElement('div');
  healthWarn.className = 'level__healthwarn';
  healthWarn.hidden = true;
  root.append(healthWarn);

  // -- reversal result panel --
  const revResult = document.createElement('div');
  revResult.className = 'level__revresult';
  revResult.hidden = true;
  root.append(revResult);

  // -- wake / denial / no-sensor panels --
  const wakePanel = document.createElement('div');
  wakePanel.className = 'level__wakepanel';
  wakePanel.hidden = true;
  const wakeBtn = document.createElement('button');
  wakeBtn.type = 'button';
  wakeBtn.className = 'btn btn--live level__wake';
  wakeBtn.textContent = 'TAP TO WAKE SENSORS';
  const wakeReason = document.createElement('p');
  wakeReason.className = 'level__wakereason';
  wakeReason.textContent = 'The level reads the motion sensors — this platform asks once, and nothing leaves the phone.';
  wakePanel.append(wakeBtn, wakeReason);
  root.append(wakePanel);

  const deniedPanel = document.createElement('div');
  deniedPanel.className = 'level__denied';
  deniedPanel.hidden = true;
  root.append(deniedPanel);

  const noSensorsPanel = document.createElement('div');
  noSensorsPanel.className = 'level__nosensors';
  noSensorsPanel.hidden = true;
  root.append(noSensorsPanel);

  // -- stage with the four mode panels --
  const stage = document.createElement('div');
  stage.className = 'level__stage';

  const ghost = ghostBob();
  ghost.classList.add('level__ghost');
  ghost.hidden = true;
  stage.append(ghost);

  const explainUncertainty = (): void =>
    showExplain(UNCERTAINTY_EXPLAINER(view?.stable ? 'nominal' : 'unknown'));

  const dm = (valueDeg: number, m: LevelMode, stable: boolean) =>
    displayMeasurement({ mode: m, valueDeg, stable, claim, tier });

  // SURFACE
  const surfacePanel = document.createElement('div');
  surfacePanel.className = 'level__panel level__surface level__panel--active';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.setAttribute('role', 'img');
  bubble.setAttribute('aria-label', 'Two-axis bubble level');
  const crossH = document.createElement('div');
  crossH.className = 'bubble__cross-h';
  const crossV = document.createElement('div');
  crossV.className = 'bubble__cross-v';
  const tolBox = document.createElement('div');
  tolBox.className = 'bubble__tol';
  const dot = document.createElement('div');
  dot.className = 'bubble__dot';
  bubble.append(crossH, crossV, tolBox, dot);
  const pair = document.createElement('div');
  pair.className = 'level__pair level__readout';
  const pitchLabel = document.createElement('span');
  pitchLabel.className = 'level__axislabel';
  pitchLabel.textContent = 'PITCH';
  const pitchEl: MeasuredNumberEl = measuredEl(dm(NaN, 'surface', false), {
    decimals: 1,
    signed: true,
    onExplainUncertainty: explainUncertainty,
  });
  const rollLabel = document.createElement('span');
  rollLabel.className = 'level__axislabel';
  rollLabel.textContent = 'ROLL';
  const rollEl: MeasuredNumberEl = measuredEl(dm(NaN, 'surface', false), {
    decimals: 1,
    signed: true,
    onExplainUncertainty: explainUncertainty,
  });
  pair.append(pitchLabel, pitchEl, rollLabel, rollEl);
  surfacePanel.append(bubble, pair);

  // EDGE
  const edgePanel = document.createElement('div');
  edgePanel.className = 'level__panel level__edge';
  const lockWord = document.createElement('span');
  lockWord.className = 'level__lock';
  const edgeWrap = document.createElement('div');
  edgeWrap.className = 'level__readout';
  const edgeEl: MeasuredNumberEl = measuredEl(dm(NaN, 'edge', false), {
    decimals: 1,
    signed: true,
    size: 'primary',
    onExplainUncertainty: explainUncertainty,
  });
  edgeWrap.append(edgeEl);
  edgePanel.append(lockWord, edgeWrap);

  // PLUMB
  const plumbPanel = document.createElement('div');
  plumbPanel.className = 'level__panel level__plumb';
  const plumbWrap = document.createElement('div');
  plumbWrap.className = 'level__readout';
  const plumbEl: MeasuredNumberEl = measuredEl(dm(NaN, 'plumb', false), {
    decimals: 1,
    signed: true,
    size: 'primary',
    onExplainUncertainty: explainUncertainty,
  });
  plumbWrap.append(plumbEl);
  const plumbRow = document.createElement('div');
  plumbRow.className = 'level__plumbrow';
  const heightLabel = document.createElement('label');
  heightLabel.className = 'level__height';
  const heightText = document.createElement('span');
  heightText.textContent = 'OVER';
  const heightInput = document.createElement('input');
  heightInput.type = 'number';
  heightInput.step = '1';
  heightInput.min = '1';
  heightInput.value = String(DEFAULT_PLUMB_HEIGHT_IN);
  heightInput.setAttribute('aria-label', 'Run height in inches — entered by you');
  const heightUnit = document.createElement('span');
  heightUnit.textContent = '″';
  heightLabel.append(heightText, heightInput, heightUnit);
  const outBy = document.createElement('span');
  outBy.className = 'level__outby';
  plumbRow.append(heightLabel, outBy);
  plumbPanel.append(plumbWrap, plumbRow);

  // OVERLAY
  const overlayPanel = document.createElement('div');
  overlayPanel.className = 'level__panel level__overlaypanel';
  const overlay = cameraOverlay({
    platform,
    lockTolDeg: LOCK_TOL_DEG,
    getReading: () => {
      if (!view) return null;
      return {
        tiltDeg: view.tilt,
        stable: view.stable,
        measurement: dm(view.tilt, 'overlay', view.stable),
      };
    },
    // H-06: the burned still carries the claim discipline, not a bare angle.
    getClaim: () => ({ plusMinusDeg: claim.plusMinus, calibrated: claim.calibrated }),
    onFreeze: (capture) => void onOverlayFreeze(capture),
    announce,
  });
  overlayPanel.append(overlay.el);

  stage.append(surfacePanel, edgePanel, plumbPanel, overlayPanel);
  root.append(stage);

  // -- slope strip (§4.2.3: all forms simultaneously) --
  const strip = document.createElement('section');
  strip.className = 'lvlstrip';
  strip.setAttribute('aria-label', 'Slope in every trade form');
  const stripIdle = document.createElement('p');
  stripIdle.className = 'lvlstrip__idle';
  stripIdle.textContent = 'Slope forms appear with a HOLD reading.';
  const stripRows = document.createElement('div');
  stripRows.className = 'lvlstrip__rows';
  stripRows.hidden = true;
  const drainOut = document.createElement('p');
  drainOut.className = 'lvlstrip__drain';
  drainOut.hidden = true;
  strip.append(stripIdle, stripRows, drainOut);
  root.append(strip);

  // -- demos (§7B.4 / ADR-012) --
  const demos = document.createElement('section');
  demos.className = 'level__demos';
  const demoHead = document.createElement('h2');
  demoHead.className = 'level__demohead';
  demoHead.textContent = 'DEMO — WATCH IT WORK ON A KNOWN STREAM';
  const synthBanner = document.createElement('span');
  synthBanner.className = 'level__synthetic';
  synthBanner.hidden = true;
  const narration = document.createElement('p');
  narration.className = 'level__narration';
  narration.setAttribute('aria-live', 'polite');
  const demoBtns = document.createElement('div');
  demoBtns.className = 'level__demobtns';
  for (const spec of DEMOS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn--ghost level__demo';
    b.setAttribute('data-demo', spec.fixtureId);
    b.textContent = spec.fixtureId.includes('motion-gate')
      ? 'THE GATE REFUSES A MOVING PHONE'
      : 'A SURFACE AT +1.2° SETTLES TO HOLD';
    b.addEventListener('click', () => startDemo(spec.fixtureId));
    demoBtns.append(b);
  }
  const guideReset = document.createElement('button');
  guideReset.type = 'button';
  guideReset.className = 'btn btn--ghost level__guidereset';
  guideReset.textContent = 'RESET GUIDANCE';
  guideReset.addEventListener('click', () => {
    memory.reset('level');
    announce('Guidance reset — the full walkthrough returns on the next run.');
  });
  demos.append(demoHead, synthBanner, narration, demoBtns, guideReset);
  root.append(demos);

  // -- bottom bar: primary controls, one-handed (§7.7) --
  const modeBtns = new Map<LevelMode, HTMLButtonElement>();
  const modeCtls: HTMLElement[] = [];
  for (const m of LEVEL_MODES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn--ghost level__mode';
    b.setAttribute('data-mode', m);
    b.setAttribute('aria-pressed', m === mode ? 'true' : 'false');
    b.textContent = MODE_LABEL[m];
    b.addEventListener('click', () => {
      ensureAudio();
      setMode(m);
    });
    modeBtns.set(m, b);
    modeCtls.push(b);
  }
  const zeroBtn = document.createElement('button');
  zeroBtn.type = 'button';
  zeroBtn.className = 'btn level__zero';
  zeroBtn.textContent = 'ZERO HERE';
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'btn level__save';
  saveBtn.textContent = 'SAVE';
  const revBtn = document.createElement('button');
  revBtn.type = 'button';
  revBtn.className = 'btn level__reverse';
  revBtn.textContent = 'REVERSE';
  const bar = bottomBar(...modeCtls, zeroBtn, saveBtn, revBtn);
  root.append(bar);

  el.append(root);

  /* ================= behavior ================= */

  function showExplain(text: string): void {
    root.querySelector('.level__explain')?.remove();
    const card = document.createElement('div');
    card.className = 'level__explain';
    card.setAttribute('role', 'status');
    card.textContent = `${text} Tap to dismiss.`;
    card.addEventListener('click', () => card.remove());
    claimBtn.after(card);
  }

  function renderClaim(): void {
    claimBtn.textContent = claim.text;
    claimBtn.classList.toggle('level__claim--stale', claim.stale);
    claimBtn.setAttribute(
      'aria-label',
      `${claim.text} ${claim.calibrated && !claim.stale ? '' : 'Tap to run the reversal calibration.'}`.trim(),
    );
  }

  unsubs.push(
    subscribeProfile((p) => {
      claim = claimFor(p);
      renderClaim();
    }),
  );

  claimBtn.addEventListener('click', () => {
    if (!claim.calibrated || claim.stale) startReversal();
    else showExplain('The ±0.15° claim comes from the reversal calibration — two measurements 180° apart split sensor bias from true tilt.');
  });

  /* ---- mode switching ---- */

  function setMode(m: LevelMode): void {
    if (m === mode) return;
    resetLevelTone(); // the tone re-establishes on the next sample in a tone mode
    mode = m;
    for (const [id, b] of modeBtns) b.setAttribute('aria-pressed', id === m ? 'true' : 'false');
    surfacePanel.classList.toggle('level__panel--active', m === 'surface');
    edgePanel.classList.toggle('level__panel--active', m === 'edge');
    plumbPanel.classList.toggle('level__panel--active', m === 'plumb');
    overlayPanel.classList.toggle('level__panel--active', m === 'overlay');
    if (m === 'overlay') overlay.open();
    else overlay.close();
    ghost.hidden = true;
    lastStripDeg = null;
    lastOutDeg = null;
    stripRows.hidden = true;
    drainOut.hidden = true;
    stripIdle.hidden = false;
    zeroBtn.textContent = session.zeroed(m) ? 'CLEAR ZERO' : 'ZERO HERE';
    zeroChip.hidden = !session.zeroed(m);
    wasLocked = false;
    announce(`${MODE_LABEL[m]} mode`);
  }

  /* ---- render path (rAF-coalesced; SPEC §3.1) ---- */

  const render = rafWriter<View>((v) => {
    if (sensorLost) return; // a dead stream never repaints a live state (H-02)
    stateWord.textContent = v.stable ? 'HOLD' : 'MOVING';
    stateWord.classList.toggle('level__state--hold', v.stable);
    stateWord.classList.toggle('level__state--moving', !v.stable);
    root.classList.toggle('level--moving', !v.stable);

    if (mode === 'surface') {
      pitchEl.update(dm(v.pitch, 'surface', v.stable));
      rollEl.update(dm(v.roll, 'surface', v.stable));
      const half = Math.max(24, (bubble.clientWidth || 208) / 2 - 12);
      const { x, y } = bubbleXY(v.pitch, v.roll, 3, half);
      dot.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      dot.classList.toggle('bubble__dot--lock', v.stable && v.tilt < LOCK_TOL_DEG);
    } else if (mode === 'edge') {
      edgeEl.update(dm(v.edge, 'edge', v.stable));
      const locked = v.stable && Math.abs(v.edge) < LOCK_TOL_DEG;
      lockWord.textContent = locked ? 'LEVEL' : '';
      lockWord.className = `level__lock${locked ? ' state-lock' : ''}`;
    } else if (mode === 'plumb') {
      plumbEl.update(dm(v.plumb, 'plumb', v.stable));
      renderOutBy(v);
    }
    // overlay panel renders itself off getReading() in its own rAF loop

    // Ghost bob — a held reading out of tolerance (SPEC §7.5.2; ADR-010).
    const showGhost =
      mode !== 'overlay' && v.stable && Math.abs(v.primary) > LOCK_TOL_DEG;
    ghost.hidden = !showGhost;

    renderStrip(v);
  });

  function renderOutBy(v: View): void {
    if (!v.stable) return;
    const rounded = Math.round(v.plumb * 20) / 20;
    if (lastOutDeg === rounded && outBy.childElementCount > 0) return;
    lastOutDeg = rounded;
    const out = outOverRun(v.plumb * RAD, plumbHeightIn);
    const pmOut = plumbHeightIn * (claim.plusMinus * RAD) / Math.pow(Math.cos(v.plumb * RAD), 2);
    outBy.replaceChildren(
      document.createTextNode('out by '),
      derivedEl(out, '″', pmOut, 'nominal', { decimals: 2, signed: true }),
    );
  }

  function renderStrip(v: View): void {
    strip.classList.toggle('lvlstrip--stale', !v.stable);
    if (!v.stable) return;
    const angle = mode === 'surface' ? v.tilt : v.primary;
    const rounded = Math.round(angle * 20) / 20;
    if (lastStripDeg === rounded) return;
    lastStripDeg = rounded;
    const model = slopeStripModel(angle, claim.plusMinus);
    stripIdle.hidden = true;
    stripRows.hidden = false;
    stripRows.replaceChildren();
    for (const r of model.rows) {
      const rowEl = document.createElement('div');
      rowEl.className = 'lvlstrip__row';
      const lab = document.createElement('span');
      lab.className = 'lvlstrip__label';
      lab.textContent = r.label;
      rowEl.append(lab, derivedEl(r.value, r.unit, r.plusMinus, 'nominal', { decimals: r.decimals }));
      stripRows.append(rowEl);
    }
    const rr = document.createElement('div');
    rr.className = 'lvlstrip__row lvlstrip__row--riserun';
    const rrLab = document.createElement('span');
    rrLab.className = 'lvlstrip__label';
    rrLab.textContent = 'RISE:RUN — 1 :';
    if (model.riseRun) {
      rr.append(rrLab, derivedEl(model.riseRun.run, 'run', model.riseRun.plusMinus, 'nominal', { decimals: 1 }));
    } else {
      rrLab.textContent = 'RISE:RUN';
      const lvl = document.createElement('span');
      lvl.className = 'state-lock display';
      lvl.textContent = 'LEVEL';
      rr.append(rrLab, lvl);
    }
    stripRows.append(rr);

    if (model.drain) {
      drainOut.hidden = false;
      drainOut.setAttribute('data-state', model.drain.state);
      drainOut.textContent = model.drain.message;
    } else {
      drainOut.hidden = true;
    }
  }

  /* ---- sample pipeline ---- */

  function handleOrientation(o: Orientation, fromDemo = false): void {
    if (demoActive !== fromDemo) return; // demo owns the display while it runs
    const bias = getProfile().levelBias; // degrees (see levelState.ts header)
    const cp = o.pitch - (bias ? bias.pitch * RAD : 0);
    const cr = o.roll - (bias ? bias.roll * RAD : 0);
    const pre = {
      pitch: cp * DEG,
      roll: cr * DEG,
      edge: edgeAngleDeg(cp, cr),
      plumb: plumbAngleDeg(cp, cr),
      tilt: surfaceTiltDeg(cp, cr),
    };
    const zs = session.applySurface(pre.pitch, pre.roll);
    const v: View = {
      stable: o.stable,
      pre,
      pitch: zs.pitchDeg,
      roll: zs.rollDeg,
      edge: session.applyScalar('edge', pre.edge),
      plumb: session.applyScalar('plumb', pre.plumb),
      tilt: pre.tilt,
      primary: 0,
    };
    v.primary =
      mode === 'surface' ? v.tilt : mode === 'edge' ? v.edge : mode === 'plumb' ? v.plumb : session.applyScalar('overlay', screenTiltDeg(cp, cr));
    if (mode === 'overlay') v.tilt = v.primary; // overlay reads tilt as its angle
    view = v;

    holdWindow.push(v.primary, v.stable);

    // §4.2.4: pitch maps deviation, silent at level, click on crossing —
    // in the modes where the phone rests on the work (eyes on the bracket).
    if (mode === 'edge') {
      levelTone(v.edge);
      const locked = v.stable && Math.abs(v.edge) < LOCK_TOL_DEG;
      if (locked && !wasLocked) {
        vibrate(30);
        announce('LEVEL');
      }
      wasLocked = locked;
    } else if (mode === 'surface') {
      levelTone(v.tilt);
    }
    if (v.stable && !wasStable) announce('HOLD');
    wasStable = v.stable;

    render(v);
  }

  /* ---- guide wiring (§7B) ---- */

  const guideDeps: GuideDeps = {
    render: (step, onDismiss) => {
      const anchor = (step.anchor ? root.querySelector<HTMLElement>(step.anchor) : null) ?? stage;
      const mk = coachMark(anchor, step.text, { onDismiss });
      return () => mk.dismiss();
    },
    sensorHook: (predicate, cb) =>
      fusion.subscribe((o) => {
        if (predicate(o)) cb();
      }),
  };

  guideHandle = runGuide(LEVEL_GUIDE, guideDeps, { memory });
  guideMe.addEventListener('click', () => {
    guideHandle?.stop();
    guideHandle = runGuide(LEVEL_GUIDE, guideDeps, { memory, level: 'full' });
    if (sensorsLive) guideHandle.fireCustom('sensors-live');
  });

  /* ---- reversal walkthrough (§4.2.2, guide-engine-driven) ---- */

  function startReversal(): void {
    setMode('surface');
    revHandle?.stop();
    revResult.hidden = true;
    const machine = new ReversalMachine();
    announce('Reversal calibration: set the phone on a surface and hold still.');
    revHandle = runGuide(reversalGuideSpec(machine), guideDeps, {
      onEnd: (outcome) => {
        if (outcome === 'completed' && machine.result) applyReversal(machine.result);
      },
    });
  }

  function applyReversal(r: ReversalResult): void {
    // levelBias is stored in DEGREES (levelState.ts header).
    updateProfile({ levelBias: { pitch: r.biasPitchDeg, roll: r.biasRollDeg } });
    const pm = Math.max(0.02, r.captureStddevDeg);
    revResult.replaceChildren();
    const head = document.createElement('h2');
    head.className = 'level__revhead';
    head.textContent = 'REVERSAL COMPLETE';
    const biasLine = document.createElement('p');
    biasLine.className = 'level__revline';
    biasLine.append(
      document.createTextNode('Recovered sensor bias — pitch '),
      derivedEl(r.biasPitchDeg, '°', pm, 'stddev', { decimals: 2, signed: true }),
      document.createTextNode(', roll '),
      derivedEl(r.biasRollDeg, '°', pm, 'stddev', { decimals: 2, signed: true }),
      document.createTextNode('. It is subtracted from every reading now.'),
    );
    const surfLine = document.createElement('p');
    surfLine.className = 'level__revline';
    surfLine.append(
      document.createTextNode('True surface angle from the pair — pitch '),
      derivedEl(r.surfacePitchDeg, '°', pm, 'stddev', { decimals: 2, signed: true }),
      document.createTextNode(', roll '),
      derivedEl(r.surfaceRollDeg, '°', pm, 'stddev', { decimals: 2, signed: true }),
      document.createTextNode('.'),
    );
    const claimLine = document.createElement('p');
    claimLine.className = 'level__revline';
    claimLine.textContent = 'The claim tightens to ±0.15° while this calibration is current.';
    const done = document.createElement('button');
    done.type = 'button';
    done.className = 'btn level__revdone';
    done.textContent = 'DONE';
    done.addEventListener('click', () => {
      revResult.hidden = true;
    });
    revResult.append(head, biasLine, surfLine, claimLine);
    if (!persistenceOk()) {
      // H-04: the write did not reach durable storage — say so, same copy
      // pattern LOG uses. The calibration still works for this session.
      const persistLine = document.createElement('p');
      persistLine.className = 'level__revline level__revline--persist';
      persistLine.textContent = 'Storage is session-only in this browser mode — this calibration lasts until the tab closes.';
      revResult.append(persistLine);
    }
    revResult.append(done);
    revResult.hidden = false;
    announce('Reversal calibration complete. The claim is now plus or minus 0.15 degrees.', 'polite');
  }

  revBtn.addEventListener('click', () => {
    ensureAudio();
    startReversal();
  });

  /* ---- zero (§4.2.2) ---- */

  zeroBtn.addEventListener('click', () => {
    ensureAudio();
    if (demoActive) {
      coachMark(zeroBtn, 'Demo running — synthetic readings never zero or save.');
      return;
    }
    if (mode === 'overlay') {
      coachMark(zeroBtn, 'Overlay lines answer to gravity — zero is off in this mode.');
      return;
    }
    if (session.zeroed(mode)) {
      session.clearZero(mode);
      zeroBtn.textContent = 'ZERO HERE';
      zeroChip.hidden = true;
      lastStripDeg = null;
      announce('Zero cleared');
      return;
    }
    if (!view?.stable) {
      coachMark(zeroBtn, 'Hold still — ZERO captures the current reading.');
      return;
    }
    if (mode === 'surface') session.zeroHere('surface', { pitchDeg: view.pre.pitch, rollDeg: view.pre.roll });
    else if (mode === 'edge') session.zeroHere('edge', view.pre.edge);
    else session.zeroHere('plumb', view.pre.plumb);
    zeroBtn.textContent = 'CLEAR ZERO';
    zeroChip.hidden = false;
    lastStripDeg = null;
    announce('Zeroed here');
  });

  /* ---- save (§8; motion gate enforced) ---- */

  async function doSave(valueDeg: number, m: LevelMode, media?: Measurement['media'], extraNote?: string): Promise<void> {
    const stats = holdWindow.stats();
    const notes = [
      m === 'plumb' ? `height:${plumbHeightIn}in out:${outOverRun(valueDeg * RAD, plumbHeightIn).toFixed(2)}in` : null,
      extraNote ?? null,
    ]
      .filter((s): s is string => s !== null)
      .join(' ') || undefined;
    const meas = buildSaveMeasurement({
      mode: m,
      valueDeg,
      claim,
      stats,
      tier,
      calibrations: calibrationsForProvenance(getProfile()),
      zeroed: session.zeroed(m),
      ...(notes !== undefined ? { notes } : {}),
    });
    if (media) meas.media = media;
    await saveMeasurement(meas);
    memory.recordRun('level');
    guideHandle?.fireCustom('measurement-saved');
    announce(`Saved ${valueDeg.toFixed(1)} degrees ${kindForMode(m)} with its uncertainty`);
  }

  saveBtn.addEventListener('click', () => {
    ensureAudio();
    if (demoActive) {
      coachMark(saveBtn, 'Demo running — synthetic readings never zero or save.');
      return;
    }
    if (!view?.stable) {
      coachMark(saveBtn, 'No HOLD, no save — hold still first.');
      return;
    }
    void doSave(view.primary, mode);
  });

  /** Data-URL → Blob without fetch() (CSP: no connect-src for data:). */
  function blobFromDataUrl(dataUrl: string): Blob | null {
    try {
      const [head, body] = dataUrl.split(',', 2);
      if (!head || body === undefined) return null;
      const mime = /data:([^;]+)/.exec(head)?.[1] ?? 'image/jpeg';
      const bin = atob(body);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type: mime });
    } catch {
      return null;
    }
  }

  async function onOverlayFreeze(capture: { angleDeg: number; stable: boolean; blob: Blob | null; dataUrl: string | null }): Promise<void> {
    if (demoActive) return;
    if (!capture.stable) {
      announce('Frozen. No HOLD while freezing — frame kept, measurement not saved.');
      return;
    }
    // Burned still frame → the media store (A8), referenced by photoId.
    const blob = capture.blob ?? (capture.dataUrl ? blobFromDataUrl(capture.dataUrl) : null);
    let media: Measurement['media'] | undefined;
    if (blob) {
      const photoId = `level-freeze-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
      await saveMedia(photoId, blob);
      media = { photoId };
    }
    await doSave(capture.angleDeg, 'overlay', media, 'overlay-freeze');
  }

  /* ---- plumb height ---- */

  heightInput.addEventListener('input', () => {
    const v = Number(heightInput.value);
    if (Number.isFinite(v) && v > 0) {
      plumbHeightIn = v;
      lastOutDeg = null;
      if (view) renderOutBy(view);
    }
  });

  /* ---- demos (ADR-012) ---- */

  function startDemo(fixtureId: string): void {
    const spec = DEMOS.find((d) => d.fixtureId === fixtureId);
    if (!spec) return;
    demoHandle?.stop();
    if (mode !== 'surface') setMode('surface');
    demoActive = true;
    holdWindow.clear();
    narration.textContent = '';
    demoHandle = runLevelImuDemo(spec, {
      onSyntheticLabel: (text) => {
        synthBanner.textContent = text;
        synthBanner.hidden = false;
      },
      onNarration: (line) => {
        narration.textContent = line.text;
        announce(line.text);
      },
      onOrientation: (o) => handleOrientation(o, true),
      onEnd: () => {
        demoActive = false;
        holdWindow.clear();
        narration.textContent = `${narration.textContent} — DEMO END.`;
        synthBanner.hidden = true;
      },
    });
  }

  /* ---- sensor start (§6.1) ---- */

  const dme = (globalThis as Record<string, unknown>)['DeviceMotionEvent'] as
    | { requestPermission?: () => Promise<string> }
    | undefined;
  const needsGesture = typeof dme?.requestPermission === 'function';

  function buildPracticeForm(): HTMLElement {
    const form = document.createElement('div');
    form.className = 'level__practice';
    const head = document.createElement('h3');
    head.className = 'level__practicehead';
    head.textContent = 'PRACTICE — THE MATH ON TYPED NUMBERS';
    const angleLabel = document.createElement('label');
    const angleText = document.createElement('span');
    angleText.textContent = 'ANGLE °';
    const angleInput = document.createElement('input');
    angleInput.type = 'number';
    angleInput.step = '0.1';
    angleInput.setAttribute('aria-label', 'Angle in degrees — entered by you');
    angleLabel.append(angleText, angleInput);
    const hLabel = document.createElement('label');
    const hText = document.createElement('span');
    hText.textContent = 'OVER ″';
    const hInput = document.createElement('input');
    hInput.type = 'number';
    hInput.step = '1';
    hInput.value = String(DEFAULT_PLUMB_HEIGHT_IN);
    hInput.setAttribute('aria-label', 'Run height in inches — entered by you');
    hLabel.append(hText, hInput);
    const out = document.createElement('div');
    out.className = 'level__practiceout';
    const renderPractice = (): void => {
      const a = Number(angleInput.value);
      const h = Number(hInput.value);
      out.replaceChildren();
      if (!Number.isFinite(a) || angleInput.value.trim() === '') return;
      const echo = document.createElement('p');
      echo.append(document.createTextNode('From your entered '), enteredEl(a, '°'), document.createTextNode(':'));
      out.append(echo);
      const model = slopeStripModel(a, claim.plusMinus);
      const rows = document.createElement('div');
      rows.className = 'lvlstrip__rows';
      for (const r of model.rows) {
        const rowEl = document.createElement('div');
        rowEl.className = 'lvlstrip__row';
        const lab = document.createElement('span');
        lab.className = 'lvlstrip__label';
        lab.textContent = r.label;
        rowEl.append(lab, derivedEl(r.value, r.unit, r.plusMinus, 'nominal', { decimals: r.decimals }));
        rows.append(rowEl);
      }
      out.append(rows);
      if (Number.isFinite(h) && h > 0) {
        const p = document.createElement('p');
        const o = outOverRun((a * Math.PI) / 180, h);
        const pmO = h * (claim.plusMinus * Math.PI / 180) / Math.pow(Math.cos((a * Math.PI) / 180), 2);
        p.append(document.createTextNode('out by '), derivedEl(o, '″', pmO, 'nominal', { decimals: 2, signed: true }));
        out.append(p);
      }
      if (model.drain) {
        const d = document.createElement('p');
        d.className = 'lvlstrip__drain';
        d.setAttribute('data-state', model.drain.state);
        d.textContent = model.drain.message;
        out.append(d);
      }
    };
    angleInput.addEventListener('input', renderPractice);
    hInput.addEventListener('input', renderPractice);
    form.append(head, angleLabel, hLabel, out);
    return form;
  }

  function showDenied(): void {
    deniedPanel.replaceChildren();
    const head = document.createElement('h2');
    head.className = 'level__deniedhead';
    head.textContent = 'MOTION ACCESS DENIED';
    const rec = document.createElement('p');
    rec.className = 'level__recovery';
    rec.textContent = recoveryInstructions('motion', platform);
    const still = document.createElement('p');
    still.className = 'level__recovery';
    still.textContent = 'The live level needs the sensor. The math below works now, and every other tool is unaffected.';
    deniedPanel.append(head, rec, still, buildPracticeForm());
    deniedPanel.hidden = false;
    wakePanel.hidden = true;
    announce('Motion access denied. Recovery steps and practice math are on screen.', 'assertive');
  }

  function showNoSensors(): void {
    noSensorsPanel.replaceChildren();
    const head = document.createElement('h2');
    head.className = 'level__deniedhead';
    head.textContent = 'NO MOTION DATA';
    const rec = document.createElement('p');
    rec.className = 'level__recovery';
    rec.textContent = `No motion samples arrived. ${recoveryInstructions('motion', platform)}`;
    const still = document.createElement('p');
    still.className = 'level__recovery';
    still.textContent = 'Desktops usually have no motion sensors — open LEVEL on a phone for the live reading. The math below works here.';
    noSensorsPanel.append(head, rec, still, buildPracticeForm());
    noSensorsPanel.hidden = false;
  }

  let gotSample = false;

  /* ---- source health (H-02): a stream that dies after HOLD must not leave
   *      a frozen orange angle looking live. Poll the source's own health
   *      word every second while live; the first-2.5 s window belongs to the
   *      no-sample watchdog above. Demos are synthetic and exempt. ---- */

  function onStreamDead(): void {
    sensorLost = true;
    resetLevelTone();
    stateWord.textContent = 'SENSOR LOST';
    stateWord.classList.remove('level__state--hold');
    stateWord.classList.add('level__state--moving');
    root.classList.add('level--moving'); // dims the readout — the last value no longer looks live
    ghost.hidden = true;
    showNoSensors();
    announce('Motion samples stopped arriving. The last reading is no longer live.', 'assertive');
  }

  function syncDegraded(degraded: boolean): void {
    if (degraded === !healthWarn.hidden) return;
    if (degraded) {
      healthWarn.replaceChildren(
        warningBanner('RATE_COLLAPSE', WARNING_COPY.RATE_COLLAPSE, () => {
          const ex = WARNING_EXPLAINERS.RATE_COLLAPSE;
          showExplain(`${ex.why} ${ex.whatToDo}`);
        }),
      );
      healthWarn.hidden = false;
    } else {
      healthWarn.replaceChildren();
      healthWarn.hidden = true;
    }
  }

  function startHealthPoll(): void {
    if (healthPoll !== null) return;
    healthPoll = setInterval(() => {
      if (!sensorsLive || demoActive || !gotSample) return;
      const health = fusion.health;
      if (health === 'dead' && !sensorLost) onStreamDead();
      syncDegraded(health === 'degraded');
    }, 1000);
  }

  async function beginSensors(): Promise<void> {
    await fusion.start();
    unsubs.push(
      fusion.subscribe((o) => {
        if (!gotSample) {
          gotSample = true;
          noSensorsPanel.hidden = true;
          if (watchdog) { clearTimeout(watchdog); watchdog = null; }
        }
        if (sensorLost) {
          // Samples resumed — the panel clears and the render path repaints.
          sensorLost = false;
          noSensorsPanel.hidden = true;
        }
        handleOrientation(o);
      }),
    );
    sensorsLive = true;
    wakePanel.hidden = true;
    guideHandle?.fireCustom('sensors-live');
    void requestWakeLock();
    startHealthPoll();
    watchdog = setTimeout(() => {
      if (!gotSample) showNoSensors();
    }, 2500);
  }

  if (needsGesture) {
    wakePanel.hidden = false;
    wakeBtn.addEventListener('click', () => {
      ensureAudio();
      void requestMotionPermissions().then((res) => {
        if (res.motion === 'denied' || res.orientation === 'denied') showDenied();
        else void beginSensors();
      });
    });
  } else {
    void beginSensors();
  }

  /* ================= unmount ================= */

  return () => {
    for (const u of unsubs) u();
    guideHandle?.stop();
    revHandle?.stop();
    demoHandle?.stop();
    overlay.close();
    fusion.stop();
    imu.stop();
    resetLevelTone();
    if (watchdog) clearTimeout(watchdog);
    if (healthPoll !== null) clearInterval(healthPoll);
    void releaseWakeLock();
  };
}
