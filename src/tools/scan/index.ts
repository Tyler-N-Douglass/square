/**
 * SCAN — the signature tool (SPEC §4.1). Tier-driven assembly per ADR-005:
 * the Tier NONE experience (manual mode + honest explanation + remedy +
 * DEMO offer) is built FIRST and completely; PROXY layers on top of it;
 * FIELD on top of that. Capability is consumed, never assumed.
 *
 * Source selection:
 *   ctx.replayTrace present → ReplayMagSource (badge REPLAY, + SYNTHETIC
 *     when the trace is generated);
 *   FIELD → FieldMagSource, constructed on the user's tap (permission
 *     denial → honest recovery panel, never a dead end);
 *   PROXY → HeadingProxySource over DeviceMotionSource (same-gesture iOS
 *     permission choreography);
 *   NONE → manual stud mode + the Chrome-flag remedy + DEMOs.
 *
 * THE LATENCY SPLIT (SPEC §9, sensor→audio < 50 ms): tone pitch, haptics
 * and the big state word run synchronously in the sample callback through
 * model.LiveFeedback (cheap streaming detrend). The DSP worker round trip
 * (pipeline.ts, ~250 ms cadence) refines events, positions, warnings and
 * confidence after the fact. Audio never waits on the worker.
 *
 * Testability: mountScan accepts injected deps (analyzer, guide memory,
 * replay speed, source factories) so tests/dom/scan-*.test.ts drive the
 * real mount headlessly. `mount` is the ToolModule the router loads.
 */
import type { AppContext, ToolModule, Unmount } from '../../app/router';
import type { ImuSample, MagSample, SensorSource } from '../../sensors/types';
import type { Confidence, MagTier, TraceAnchor, WarningKey } from '../../types';
import { FieldMagSource } from '../../sensors/magnetometer';
import { HeadingProxySource } from '../../sensors/headingProxy';
import { DeviceMotionSource } from '../../sensors/imu';
import { ReplayMagSource } from '../../sensors/replay';
import { recoveryInstructions, requestMotionPermissions, type MotionPermissionResult } from '../../sensors/permissions';
import { announce, tierBadge } from '../../app/shell';
import { rafWriter } from '../../app/store';
import { ensureAudio, setTone, stopTone, tick } from '../../app/audio';
import { vibrate } from '../../app/haptics';
import { releaseWakeLock, requestWakeLock } from '../../app/wakelock';
import { saveMeasurement } from '../../app/logStore';
import { calibrationsForProvenance, getProfile, subscribeProfile } from '../../app/calibrationStore';
import { measuredEl, type MeasuredNumberEl } from '../../ui/components/number';
import { warningBanner, WARNING_COPY } from '../../ui/components/warning';
import { bottomBar } from '../../ui/components/toolbar';
import { coachMark } from '../../ui/components/coach';
import { runGuide, type GuideHandle, type GuideSpec } from '../../guidance/tour';
import { FadingStore, type GuideMemory } from '../../guidance/fading';
import { demosForTool, runDemo, type DemoHandle, type DemoSpec } from '../../guidance/demo';
import { loadFixture } from '../../guidance/fixtures';
import { CONFIDENCE_EXPLAINERS, WARNING_EXPLAINERS, type Explainer } from '../../guidance/explainers';
import { MIN_PROMINENCE_ABS, type DetailedTraceAnalysis } from '../../dsp/analyze';
import { createRibbon, type RibbonEvent } from '../../ui/charts/ribbon';
import { formatInches, rational } from '../../geometry/units';
import {
  CONFIRM_NEEDS_SPAN_COPY,
  LiveFeedback,
  SweepSession,
  type SweepMode,
  buildStudMeasurements,
  confirmVerdict,
  latticeDisplayLines,
  latticeStatement,
  parseSpanInches,
  scoreAgreement,
  type FeedbackFrame,
} from './model';
import { LivePipeline, createSyncAnalyzer, type AnalysisMeta, type DetailedAnalyzer } from './pipeline';
import { createWorkerAnalyzer } from './workerClient';
import { buildManualPanel } from './manualMode';
import { SCAN_GUIDE, SCAN_MANUAL_GUIDE } from './guide';

/* ------------------------------------------------------------------------ */
/* Injectable deps                                                           */
/* ------------------------------------------------------------------------ */

export interface ScanDeps {
  analyzer?: DetailedAnalyzer;
  memory?: GuideMemory;
  replaySpeed?: number | 'sync';
  demoSpeed?: number | 'sync';
  makeFieldSource?: () => SensorSource<MagSample> & { lastError?: string | null };
  makeProxySource?: () => { imu: SensorSource<ImuSample>; source: SensorSource<MagSample> };
  requestMotion?: () => Promise<MotionPermissionResult>;
  /** Auto-run the guided walkthrough on mount (default true). */
  autoGuide?: boolean;
  now?: () => number;
}

const defaultMemory = new FadingStore();

/* ------------------------------------------------------------------------ */
/* Copy                                                                      */
/* ------------------------------------------------------------------------ */

const PROXY_HONESTY_LINE =
  'PROXY tier: heading deflection, not the raw field — coarser, more false positives. Confidence caps at LIKELY; STRONG needs the raw field sensor.';

const NONE_HONESTY_LINE =
  'No magnetometer path exists in this browser, so SCAN shows no reading — a number it did not measure has no place here. Manual mode below does the on-center arithmetic; the DEMOs replay real traces through the real pipeline.';

const CHROME_FLAG_REMEDY =
  'On Android, Chrome can expose the raw sensor: open chrome://flags/#enable-generic-sensor-extra-classes, set it to Enabled, restart Chrome, reload this page.';

const AXIS_TIME_CAPTION = 'TIME — newest at the right edge. Declare a span to convert the chart to inches.';
const AXIS_DISTANCE_CAPTION = 'INCHES along the sweep — mapped by your declared span.';

const DEMO_TITLES: Record<string, string> = {
  'scan-first-wall': 'FIRST WALL — two screws, 16″ on center',
  'scan-hot-wall': 'HOT WALL — watch it refuse',
  'scan-magsafe': 'MAGSAFE — case magnet caught',
  'sweep-too-fast': 'TOO FAST — smeared sweep, no positions',
  'plaster-lath-dense': 'PLASTER & LATH — dense pattern, no stud story',
  'tierB-heading-proxy': 'PROXY TIER — heading deflection',
};

/* ------------------------------------------------------------------------ */
/* Scoped styles (Draplin: flat fills, 3px rules, radius 0, no shadows).     */
/* A7 owns src/ui; this block is scoped under .scan and can move to the      */
/* shared stylesheet without touching markup — same pattern as manual.ts.    */
/* ------------------------------------------------------------------------ */

const SCAN_CSS = `
.scan { padding: 16px 16px 120px; max-width: 760px; margin: 0 auto; }
.scan__top { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
.scan__cal { color: inherit; text-decoration: underline dotted 2px var(--gray, #58595B); }
.scan__sens { display: inline-flex; align-items: center; gap: 8px; }
.scan__sens input { accent-color: var(--gray, #58595B); }
.scan__guidebtns { margin-left: auto; display: inline-flex; gap: 8px; }
.scan__warnings { margin: 12px 0; display: grid; gap: 8px; }
.scan__ribbonwrap { position: relative; margin: 12px 0 4px; }
.scan__ribbon { display: block; width: 100%; height: 180px; border: 3px solid var(--rule, #D1D3D4); background: var(--surface, #fff); }
.scan__axis { font-size: 12px; color: var(--type-2, #58595B); margin: 4px 0 12px; }
.scan__reticle { position: absolute; top: -10px; transform: translateX(-50%); text-align: center; pointer-events: none; z-index: 2; }
.scan__reticle-cross { width: 22px; height: 22px; margin: 0 auto; position: relative; }
.scan__reticle-cross::before, .scan__reticle-cross::after { content: ''; position: absolute; background: var(--type, #1A1A1A); }
.scan__reticle-cross::before { left: 10px; top: 0; width: 2px; height: 22px; }
.scan__reticle-cross::after { top: 10px; left: 0; height: 2px; width: 22px; }
.scan__reticle-label { font-size: 10px; letter-spacing: 0.06em; }
.scan__reticle-note { position: static; font-size: 11px; color: var(--type-2, #58595B); pointer-events: auto; }
.scan__stateword { font-size: clamp(40px, 12vw, 72px); line-height: 1.05; margin: 8px 0 0; min-height: 1.1em; }
.scan__stateword[data-state="PEAK"] { color: var(--orange, #F15A22); }
.scan__snr { font-size: 16px; color: var(--type-2, #58595B); margin-left: 12px; }
.scan__readout { margin: 8px 0 16px; }
.scan__proxyline, .scan__replayline { border: 3px solid var(--rule, #D1D3D4); padding: 8px 12px; font-size: 14px; margin: 8px 0; }
.scan__section { margin: 20px 0 6px; font-size: 14px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--type-2, #58595B); }
.scan__event { display: flex; flex-wrap: wrap; align-items: baseline; gap: 12px; border-top: 3px solid var(--rule, #D1D3D4); padding: 8px 0; }
.scan__event-frac { font-size: 14px; color: var(--type-2, #58595B); }
.scan__lattice { font-size: 15px; margin: 8px 0; }
.scan__confirm { border: 3px solid var(--rule, #D1D3D4); padding: 12px; margin: 12px 0; }
.scan__confirm[data-agree="true"] { border-color: var(--green, #007A3D); }
.scan__confirm[data-agree="false"] { border-color: var(--red, #C1272D); }
.scan__explainer { border: 3px solid var(--rule-strong, #58595B); padding: 12px; margin: 12px 0; background: var(--surface, #fff); }
.scan__explainer h3 { margin: 0 0 8px; }
.scan__explainer p { margin: 6px 0; font-size: 14px; line-height: 1.45; }
.scan__explainer .scan__explabel { font-weight: bold; text-transform: uppercase; font-size: 12px; letter-spacing: 0.06em; }
.scan__spanpanel { border: 3px solid var(--rule-strong, #58595B); padding: 12px; margin: 12px 0; }
.scan__recovery { border: 3px solid var(--red, #C1272D); padding: 12px; margin: 12px 0; }
.scan__none { border: 3px solid var(--rule-strong, #58595B); padding: 12px; margin: 12px 0; }
.scan__modes { display: flex; gap: 8px; margin: 16px 0 8px; flex-wrap: wrap; }
.scan__modes button[aria-pressed="true"] { background: var(--type, #1A1A1A); color: var(--ground, #F1F2F2); }
.scan__demos { margin-top: 24px; }
.scan__demorow { display: flex; align-items: center; gap: 12px; border-top: 3px solid var(--rule, #D1D3D4); padding: 8px 0; }
.scan__demonote { font-size: 13px; color: var(--type-2, #58595B); }
.scan__narration { border-left: 6px solid var(--rule-strong, #58595B); padding: 4px 12px; margin: 8px 0; min-height: 1.4em; font-size: 15px; }
.scan__synthetic { display: inline-block; border: 2px solid var(--type, #1A1A1A); padding: 2px 8px; font-size: 12px; letter-spacing: 0.06em; }
.scan__expected { font-size: 13px; color: var(--type-2, #58595B); margin: 6px 0; }
.scan__prose { font-family: var(--font-prose, system-ui, sans-serif); font-size: 15px; line-height: 1.5; max-width: 62ch; }
.scan__manual { border-top: 6px solid var(--rule-strong, #58595B); margin-top: 24px; padding-top: 8px; }
.scan__manualform { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px; margin: 12px 0; }
.scan__field { display: grid; gap: 4px; }
.scan__fieldlabel { font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--type-2, #58595B); }
.scan__input { min-height: var(--tap, 56px); border: 2px solid currentColor; border-radius: 0; background: transparent; color: inherit; font: inherit; padding: 0 10px; }
.scan__manualecho { font-size: 14px; }
.scan__manualerr { color: var(--red, #C1272D); font-size: 14px; }
.scan__tapemap { margin: 12px 0; }
.scan__strip { position: relative; height: 48px; border: 3px solid var(--rule, #D1D3D4); margin-bottom: 12px; overflow: hidden; }
.scan__stripmark { position: absolute; top: 0; bottom: 0; background: var(--gray-light, #D1D3D4); }
.scan__stripline { position: absolute; left: 50%; top: 0; bottom: 0; width: 3px; margin-left: -1.5px; background: var(--type, #1A1A1A); }
.scan__tapetable { border-collapse: collapse; width: 100%; }
.scan__tapetable th { text-align: left; font-size: 12px; letter-spacing: 0.06em; color: var(--type-2, #58595B); border-bottom: 3px solid var(--rule-strong, #58595B); padding: 6px 8px 6px 0; }
.scan__tapetable td { border-bottom: 1px solid var(--rule, #D1D3D4); padding: 6px 8px 6px 0; }
.scan__manual-honesty { border: 3px solid var(--rule-strong, #58595B); padding: 8px 12px; font-size: 14px; }
.scan__markchip { font-size: 13px; color: var(--type-2, #58595B); }
`;

/* ------------------------------------------------------------------------ */
/* Small helpers                                                             */
/* ------------------------------------------------------------------------ */

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function btn(label: string, id?: string, extraClass = ''): HTMLButtonElement {
  const b = h('button', `btn${extraClass ? ` ${extraClass}` : ''}`, label);
  b.type = 'button';
  if (id) b.id = id;
  return b;
}

function calAgeText(updatedAt: number): string {
  const ms = Date.now() - updatedAt;
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function fractionHint(positionIn: number): string {
  const f = formatInches(rational(Math.round(positionIn * 16), 16), 16);
  return `≈ ${f.text} (nearest 1/16″)`;
}

/* ------------------------------------------------------------------------ */
/* Mount                                                                     */
/* ------------------------------------------------------------------------ */

type SourceKind = 'replay' | 'field' | 'proxy' | 'none';

export function mountScan(el: HTMLElement, ctx: AppContext, deps: ScanDeps = {}): Unmount {
  const cap = ctx.capability;
  const replayTrace = ctx.replayTrace;
  const sourceKind: SourceKind = replayTrace
    ? 'replay'
    : cap.magTier === 'FIELD'
      ? 'field'
      : cap.magTier === 'PROXY'
        ? 'proxy'
        : 'none';
  const dataTier: MagTier = replayTrace ? replayTrace.device.magTier : cap.magTier;
  const live = sourceKind !== 'none';
  const unitFor = (tier: MagTier): string => (tier === 'PROXY' ? '°' : 'µT');
  const minAbsFor = (tier: MagTier): number =>
    tier === 'PROXY' ? MIN_PROMINENCE_ABS.PROXY : MIN_PROMINENCE_ABS.FIELD;

  const memory = deps.memory ?? defaultMemory;
  const now = deps.now ?? ((): number => performance.now() / 1000);
  const ownAnalyzer = deps.analyzer === undefined;
  const analyzer: DetailedAnalyzer = deps.analyzer ?? createWorkerAnalyzer() ?? createSyncAnalyzer();

  const root = h('div', 'scan');
  const style = h('style');
  style.textContent = SCAN_CSS;
  root.append(style);

  /* ---- top row: badge · calibration age · sensitivity · guide ---- */
  const top = h('div', 'scan__top');
  const badge = h('span');
  const baseBadge = (): void => {
    if (replayTrace) {
      badge.className = 'badge badge--field';
      badge.textContent = `REPLAY · ${replayTrace.id}${replayTrace.synthetic ? ' · SYNTHETIC' : ''}`;
    } else {
      const b = tierBadge(cap);
      badge.className = b.cls;
      badge.textContent = b.text;
    }
  };
  baseBadge();

  const calChip = h('a', 'scan__cal') as HTMLAnchorElement;
  calChip.href = '#/calibrate';
  const syncCalChip = (): void => {
    const p = getProfile();
    calChip.textContent = p.mag ? `CAL ${calAgeText(p.updatedAt)}` : 'UNCALIBRATED — open CALIBRATE';
    calChip.setAttribute('aria-label', p.mag
      ? `Magnetometer calibrated ${calAgeText(p.updatedAt)} — open CALIBRATE to redo`
      : 'Magnetometer not calibrated — open CALIBRATE');
  };
  syncCalChip();

  const sens = h('label', 'scan__sens');
  const sensLabel = h('span', 'scan__fieldlabel', 'SENSITIVITY');
  const sensInput = h('input') as HTMLInputElement;
  sensInput.type = 'range';
  sensInput.min = '2';
  sensInput.max = '6';
  sensInput.step = '0.1';
  sensInput.value = '3.5';
  sensInput.id = 'scan-sensitivity';
  const sensVal = h('span', 'entered hud', '3.5·σ');
  sens.append(sensLabel, sensInput, sensVal);

  const guideBtns = h('span', 'scan__guidebtns');
  const guideMeBtn = btn('GUIDE ME', undefined, 'btn--ghost');
  const guideResetBtn = btn('RESET GUIDANCE', undefined, 'btn--ghost');
  guideBtns.append(guideMeBtn, guideResetBtn);

  top.append(badge, calChip, sens, guideBtns);
  root.append(top);

  /* ---- warnings ---- */
  const warnings = h('div', 'scan__warnings');
  root.append(warnings);

  /* ---- explainer panel (shared by warnings, confidence badges, ±) ---- */
  const explainerPanel = h('div', 'scan__explainer');
  explainerPanel.hidden = true;
  explainerPanel.setAttribute('aria-live', 'polite');
  const showExplainer = (ex: Explainer): void => {
    explainerPanel.replaceChildren();
    explainerPanel.append(h('h3', 'display', ex.title));
    const part = (label: string, text: string): void => {
      const p = h('p');
      p.append(h('span', 'scan__explabel', `${label} — `), document.createTextNode(text));
      explainerPanel.append(p);
    };
    part('Why this is happening', ex.why);
    part('What to do', ex.whatToDo);
    part('If you ignore it', ex.ifIgnored);
    if (ex.calibrationRoute) {
      const a = h('a', 'btn btn--ghost', 'OPEN CALIBRATE') as HTMLAnchorElement;
      a.href = '#/calibrate';
      explainerPanel.append(a);
    }
    const close = btn('CLOSE', undefined, 'btn--ghost');
    close.addEventListener('click', () => {
      explainerPanel.hidden = true;
    });
    explainerPanel.append(close);
    explainerPanel.hidden = false;
  };
  const showText = (title: string, text: string): void => {
    explainerPanel.replaceChildren(h('h3', 'display', title), h('p', undefined, text));
    const close = btn('CLOSE', undefined, 'btn--ghost');
    close.addEventListener('click', () => {
      explainerPanel.hidden = true;
    });
    explainerPanel.append(close);
    explainerPanel.hidden = false;
  };

  /* ---- Tier NONE panel (built FIRST — ADR-005) ---- */
  const nonePanel = h('div', 'scan__none');
  if (!live) {
    nonePanel.append(h('p', 'scan__prose', NONE_HONESTY_LINE));
    const blocker = cap.blockers.find((b) => b.code === 'NO_MAG');
    if (blocker) nonePanel.append(h('p', 'scan__prose', `${blocker.message} ${blocker.remedy}`));
    nonePanel.append(h('p', 'scan__prose', CHROME_FLAG_REMEDY));
    const demoOffer = btn('WATCH A DEMO', 'scan-demo-offer');
    demoOffer.addEventListener('click', () => {
      demosSection.scrollIntoView?.({ block: 'start' });
    });
    nonePanel.append(demoOffer);
    root.append(nonePanel);
  }

  /* ---- live surfaces (ribbon, state word, readout) ---- */
  const ribbonWrap = h('div', 'scan__ribbonwrap');
  const reticle = h('div', 'scan__reticle');
  const reticleCross = h('div', 'scan__reticle-cross');
  const reticleLabel = h('div', 'scan__reticle-label', 'SENSOR');
  const reticleNote = h('a', 'scan__reticle-note') as HTMLAnchorElement;
  reticleNote.href = '#/calibrate';
  reticle.append(reticleCross, reticleLabel, reticleNote);
  const canvas = h('canvas', 'scan__ribbon') as HTMLCanvasElement;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute(
    'aria-label',
    'Field ribbon — the detrended signal scrolling right to left, noise floor as a band, detected fasteners as vertical lines',
  );
  ribbonWrap.append(reticle, canvas);
  const axisCaption = h('p', 'scan__axis', AXIS_TIME_CAPTION);

  const syncReticle = (): void => {
    const p = getProfile();
    if (p.sensorOffset) {
      reticle.style.left = `${Math.max(4, Math.min(96, p.sensorOffset.x * 100)).toFixed(1)}%`;
      reticleNote.textContent = '';
      reticleNote.hidden = true;
    } else {
      reticle.style.left = '50%';
      reticleNote.hidden = false;
      reticleNote.textContent = 'sensor position approximate — locate it in CALIBRATE';
    }
  };
  syncReticle();

  const stateRow = h('div');
  const stateword = h('span', 'scan__stateword display', '— NOTHING —');
  stateword.dataset['state'] = 'NOTHING';
  const snrEl = h('span', 'scan__snr hud', '');
  stateRow.append(stateword, snrEl);

  const readoutWrap = h('div', 'scan__readout');
  let readout: MeasuredNumberEl | null = null;

  const proxyLine = h('p', 'scan__proxyline', PROXY_HONESTY_LINE);
  const replayLine = h('p', 'scan__replayline');

  if (live) {
    root.append(ribbonWrap, axisCaption, stateRow, readoutWrap);
    if (dataTier === 'PROXY') root.append(proxyLine);
    if (replayTrace) {
      replayLine.textContent = `Replaying "${replayTrace.id}" through the real pipeline${replayTrace.synthetic ? ' — SYNTHETIC TRACE, generated, not a recording of a real wall' : ''}. ${replayTrace.note}`;
      root.append(replayLine);
    }
  }
  root.append(explainerPanel);

  /* ---- events + lattice + confirm ---- */
  const eventsSection = h('div');
  const eventsHead = h('p', 'scan__section', 'FASTENERS');
  const eventsList = h('div');
  eventsSection.append(eventsHead, eventsList);
  const latticeEl = h('p', 'scan__lattice');
  const confirmPanel = h('div', 'scan__confirm');
  confirmPanel.hidden = true;
  if (live) root.append(eventsSection, latticeEl, confirmPanel);

  /* ---- recovery + span panels ---- */
  const recoveryPanel = h('div', 'scan__recovery');
  recoveryPanel.hidden = true;
  const spanPanel = h('div', 'scan__spanpanel');
  spanPanel.hidden = true;
  if (live) root.append(recoveryPanel, spanPanel);

  /* ---- manual mode (always reachable — §4.1.9) ---- */
  const manual = buildManualPanel({
    onComputed: () => {
      if (!live) memory.recordRun('scan-manual');
    },
  });

  /* ---- DEMO panel ---- */
  const demosSection = h('div', 'scan__demos');
  const demosHead = h('p', 'scan__section', 'DEMO — watch it work, and watch it refuse');
  const demoSynthetic = h('span', 'scan__synthetic');
  demoSynthetic.hidden = true;
  const demoNarration = h('p', 'scan__narration');
  demoNarration.setAttribute('aria-live', 'polite');
  const demoExpected = h('p', 'scan__expected');
  const demoRows = h('div');
  demosSection.append(demosHead, demoSynthetic, demoNarration, demoExpected, demoRows);

  // NONE: manual mode is the primary face — it comes before the demos.
  root.append(manual.el, demosSection);

  /* ---- modes + bottom bar (live tiers; replay drives its own anchors) ---- */
  const modesRow = h('div', 'scan__modes');
  const modeButtons = new Map<SweepMode, HTMLButtonElement>();
  const startBtn = btn(sourceKind === 'replay' ? 'PLAY REPLAY' : 'START SCAN', 'scan-start', 'btn--live');
  const markBtn = btn('MARK', 'scan-mark');
  const anchorBtn = btn('ANCHOR', 'scan-anchor');
  const againBtn = btn('SWEEP AGAIN', 'scan-again');
  const saveBtn = btn('SAVE SCAN', 'scan-save');
  const markChip = h('span', 'scan__markchip');

  /* ====================================================================== */
  /* State                                                                   */
  /* ====================================================================== */

  const session = new SweepSession();
  let feedback = new LiveFeedback(minAbsFor(dataTier));
  let running = false;
  let source: SensorSource<MagSample> | null = null;
  let imu: SensorSource<ImuSample> | null = null;
  let unsubSource: (() => void) | null = null;
  let metronome: ReturnType<typeof setInterval> | null = null;
  let currentAnchors: TraceAnchor[] | null = null;
  let lastAnalysis: DetailedTraceAnalysis | null = null;
  let lastMeta: AnalysisMeta | null = null;
  let prevEventCount = 0;
  let firstEventFired = false;
  let aggregate: Confidence = 'NOISE';
  let lastWord = 'NOTHING';
  let markers = 0;
  let firstPass: { positions: number[] } | null = null;
  let demoHandle: DemoHandle | null = null;
  let demoActive = false;
  let guideHandle: GuideHandle | null = null;
  let unmounted = false;
  /** H-02: set when the live source reported dead — the readout is cleared
   *  and the state word holds SENSOR LOST until a fresh start. */
  let sensorLost = false;
  /** H-02: the source-side rate collapse, surfaced through the same
   *  RATE_COLLAPSE banner the pipeline uses. */
  let sourceDegraded = false;
  let healthPoll: ReturnType<typeof setInterval> | null = null;

  const sampleTaps = new Set<(s: MagSample) => void>();

  const ribbon = createRibbon(canvas, {
    useOffscreen: cap.hasOffscreenCanvas,
    floor: minAbsFor(dataTier) * 2.5,
  });

  // Uncalibrated magnetometer on a live FIELD source: STRONG requires
  // calibration (SPEC §4.1.7), so displayed/saved confidence caps at LIKELY
  // and the UNCALIBRATED warning shows with its route to CALIBRATE. Events
  // are still shown — the detrend removes the hard-iron DC and the accessory
  // guard catches gross offsets, so refusing entirely would overclaim the
  // problem — but nothing wears STRONG without an earned calibration.
  const uncalActive = (): boolean => sourceKind === 'field' && !getProfile().mag;
  const capAt = (): Confidence | undefined => (uncalActive() ? 'LIKELY' : undefined);

  const pipeline = new LivePipeline(analyzer, dataTier === 'NONE' ? 'FIELD' : dataTier, {
    onAnalysis: (a, meta) => onAnalysis(a, meta),
    onError: (msg) => {
      if (!unmounted) showText('ANALYSIS FAILED', `The DSP stage reported: ${msg}. Stop and sweep again.`);
    },
  });

  /* ====================================================================== */
  /* Rendering                                                               */
  /* ====================================================================== */

  const writeState = rafWriter<FeedbackFrame>((f) => {
    if (sensorLost) return; // a dead source never repaints a live state word (H-02)
    stateword.textContent = f.word === 'NOTHING' ? '— NOTHING —' : f.word === 'EDGE' ? '> EDGE <' : '[ ● PEAK ]';
    stateword.dataset['state'] = f.word;
    snrEl.textContent = f.sigma > 0 ? `SNR ${(Math.abs(f.residual) / f.sigma).toFixed(1)}` : '';
  });

  const activeUnit = (): string => unitFor(demoActive && demoTier ? demoTier : dataTier);

  const liveMeasurement = (f: FeedbackFrame): import('../../types').Measurement => ({
    id: 'scan-live',
    kind: 'stud',
    value: f.residual,
    unit: activeUnit(),
    uncertainty: { plusMinus: f.sigma, basis: 'stddev' },
    confidence: aggregate,
    provenance: { tier: dataTier, calibrations: {}, sampleCount: 0, capturedAt: 0 },
  });

  let warnSignature = '';
  const renderWarnings = (pipelineWarnings: readonly WarningKey[]): void => {
    const keys = new Set<WarningKey>(pipelineWarnings);
    if (uncalActive()) keys.add('UNCALIBRATED');
    if (sourceDegraded) keys.add('RATE_COLLAPSE'); // source-side collapse (H-02)
    const sig = [...keys].sort().join(',');
    if (sig === warnSignature) return;
    warnSignature = sig;
    const banners: HTMLElement[] = [];
    for (const key of keys) {
      banners.push(warningBanner(key, WARNING_COPY[key], () => showExplainer(WARNING_EXPLAINERS[key])));
    }
    warnings.replaceChildren(...banners);
  };

  let eventsSignature = '';
  const renderEvents = (a: DetailedTraceAnalysis, meta: AnalysisMeta): void => {
    const hasPositions = currentAnchors !== null && currentAnchors.length >= 2;
    const sig = `${hasPositions}|${a.confidence}|${a.warnings.join(',')}|${a.events.map((e) => `${e.tSeconds.toFixed(2)}:${e.snr.toFixed(1)}`).join(';')}`;
    if (sig === eventsSignature) return;
    eventsSignature = sig;

    if (a.events.length === 0) {
      eventsList.replaceChildren(
        h('p', 'scan__prose', a.confidence === 'UNRELIABLE'
          ? 'No positions reported — conditions are bad; see the warning above.'
          : 'Nothing found on this pass yet.'),
      );
      return;
    }
    const ms = buildStudMeasurements(a.events, {
      tier: dataTier,
      sampleCount: meta.sampleCount,
      calibrations: calibrationsForProvenance(getProfile()),
      hasPositions,
      ...(capAt() !== undefined ? { capAt: capAt()! } : {}),
      capturedAt: 0,
    });
    const rows: HTMLElement[] = [];
    for (let i = 0; i < a.events.length; i++) {
      const ev = a.events[i]!;
      const m = ms[i]!;
      const row = h('div', 'scan__event');
      row.append(
        measuredEl(m, {
          decimals: hasPositions ? 2 : 1,
          showConfidence: 'always',
          onExplainConfidence: () => showExplainer(CONFIDENCE_EXPLAINERS[m.confidence]),
          onExplainUncertainty: () =>
            showText('±', hasPositions
              ? 'The ± is the position bound for this tier: declared-span error plus the zero-crossing estimate, inside the ±0.75″ lattice tolerance.'
              : 'The ± is a time bound along the sweep — declare a span to get inches.'),
        }),
        h('span', 'scan__snr hud', `SNR ${ev.snr.toFixed(1)}`),
      );
      if (hasPositions) row.append(h('span', 'scan__event-frac hud', fractionHint(ev.positionIn)));
      rows.push(row);
    }
    eventsList.replaceChildren(...rows);
  };

  const renderLattice = (a: DetailedTraceAnalysis): void => {
    const hasPositions = currentAnchors !== null && currentAnchors.length >= 2;
    if (!a.lattice.fit || !hasPositions) {
      ribbon.setLattice([]);
      latticeEl.textContent = a.lattice.denseIrregular
        ? 'Dense, irregular fastener pattern — plaster over lath or metal-stud signature. No stud lattice claimed.'
        : '';
      return;
    }
    const fit = a.lattice.fit;
    const aFirst = currentAnchors![0]!;
    const aLast = currentAnchors![currentAnchors!.length - 1]!;
    const lines = latticeDisplayLines(fit.pitchIn, fit.phaseIn, Math.min(aFirst.in, aLast.in), Math.max(aFirst.in, aLast.in));
    ribbon.setLattice(lines);
    latticeEl.textContent = latticeStatement(fit, lines.filter((l) => l.extrapolated).map((l) => l.positionIn));
  };

  const updateRibbonEvents = (a: DetailedTraceAnalysis, meta: AnalysisMeta): void => {
    const evs: RibbonEvent[] = a.events.map((ev) => ({
      t: meta.t0 + ev.tSeconds,
      positionIn: ev.positionIn,
    }));
    ribbon.setEvents(evs);
  };

  function onAnalysis(a: DetailedTraceAnalysis, meta: AnalysisMeta): void {
    if (unmounted) return;
    lastAnalysis = a;
    lastMeta = meta;
    aggregate = capAt() !== undefined && a.confidence === 'STRONG' ? 'LIKELY' : a.confidence;
    renderWarnings(a.warnings);
    renderEvents(a, meta);
    renderLattice(a);
    updateRibbonEvents(a, meta);
    if (a.events.length > 0 && !firstEventFired) {
      firstEventFired = true;
      guideHandle?.fireCustom('first-event');
    }
    if (a.events.length > prevEventCount) vibrate(35);
    prevEventCount = a.events.length;
    syncControls();
  }

  /* ====================================================================== */
  /* Sample path (< 50 ms: tone + state word + haptic — no worker involved)  */
  /* ====================================================================== */

  let demoTier: MagTier | null = null;

  function onSample(s: MagSample): void {
    const f = feedback.push(s.t, s.mag);
    ribbon.push(s.t, f.residual, f.sigma);
    pipeline.push(s);
    setTone(f.toneHz);
    if (f.enteredPeak) {
      vibrate(30);
      announce('PEAK');
    } else if (f.word !== lastWord && f.word === 'EDGE') {
      announce('edge');
    } else if (f.word !== lastWord && f.word === 'NOTHING') {
      announce('nothing');
    }
    lastWord = f.word;
    writeState(f);
    readout?.update(liveMeasurement(f));
    for (const tap of [...sampleTaps]) tap(s);
  }

  /* ====================================================================== */
  /* Controls                                                                */
  /* ====================================================================== */

  const setAxisMode = (mode: 'time' | 'distance'): void => {
    if (mode === 'distance' && currentAnchors && currentAnchors.length >= 2) {
      ribbon.setMode({ kind: 'distance', anchors: currentAnchors });
      axisCaption.textContent = AXIS_DISTANCE_CAPTION;
    } else {
      ribbon.setMode({ kind: 'time', windowS: 12 });
      axisCaption.textContent = AXIS_TIME_CAPTION;
    }
    ribbon.renderOnce();
  };

  const clearPass = (keepGhosts = false): void => {
    session.reset();
    pipeline.reset();
    feedback.reset();
    ribbon.clear();
    if (keepGhosts && firstPass) ribbon.setGhosts(firstPass.positions);
    lastAnalysis = null;
    lastMeta = null;
    prevEventCount = 0;
    currentAnchors = null;
    eventsSignature = '';
    warnSignature = '';
    eventsList.replaceChildren();
    latticeEl.textContent = '';
    markers = 0;
    markChip.textContent = '';
    setAxisMode('time');
  };

  const showRecovery = (kind: 'magnetometer' | 'motion', detail: string): void => {
    recoveryPanel.replaceChildren(
      h('h3', 'display', 'SENSOR UNAVAILABLE'),
      h('p', 'scan__prose', detail),
      h('p', 'scan__prose', recoveryInstructions(kind, cap.platformHint)),
      h('p', 'scan__prose', 'Manual mode below still works, and every DEMO replays a real trace through the real pipeline — no dead end here.'),
    );
    recoveryPanel.hidden = false;
    announce('Sensor unavailable. Recovery instructions shown.', 'assertive');
  };

  /* ---- source health (H-02): a dead stream must never keep rendering ---- */

  const stopHealthPoll = (): void => {
    if (healthPoll !== null) {
      clearInterval(healthPoll);
      healthPoll = null;
    }
    if (sourceDegraded) {
      sourceDegraded = false;
      renderWarnings(lastAnalysis?.warnings ?? []);
    }
  };

  /** The live source went dead mid-sweep: stop tone and haptics, clear the
   *  state word to SENSOR LOST, clear the readout to '—' (the last number
   *  must never keep looking live), show the recovery panel. */
  const onSourceDead = (): void => {
    const kind = sourceKind === 'proxy' ? 'motion' : 'magnetometer';
    running = false;
    sensorLost = true;
    stopHealthPoll();
    stopMetronome();
    stopTone();
    unsubSource?.();
    unsubSource = null;
    source?.stop();
    source = null;
    imu?.stop();
    imu = null;
    void releaseWakeLock();
    session.reset();
    ribbon.stop();
    ribbon.renderOnce();
    stateword.textContent = 'SENSOR LOST';
    stateword.dataset['state'] = 'LOST';
    snrEl.textContent = '';
    readout?.update({
      id: 'scan-live',
      kind: 'stud',
      value: NaN,
      unit: unitFor(dataTier),
      uncertainty: { plusMinus: NaN, basis: 'unknown' },
      confidence: 'NOISE',
      provenance: { tier: dataTier, calibrations: {}, sampleCount: 0, capturedAt: 0 },
    });
    showRecovery(kind, 'The sensor stream went dead mid-sweep — samples stopped arriving. The last reading is no longer live.');
    syncControls();
  };

  const startHealthPoll = (): void => {
    stopHealthPoll();
    if (sourceKind === 'replay') return; // replay ends via onEnd; its health stays 'ok'
    healthPoll = setInterval(() => {
      if (!running || source === null) return;
      const health = source.health;
      if (health === 'dead') {
        onSourceDead();
        return;
      }
      const degraded = health === 'degraded';
      if (degraded !== sourceDegraded) {
        sourceDegraded = degraded;
        renderWarnings(lastAnalysis?.warnings ?? []);
      }
    }, 1000);
  };

  const startMetronome = (): void => {
    if (session.mode !== 'paced') return;
    metronome = setInterval(() => tick('metronome'), 1000);
  };
  const stopMetronome = (): void => {
    if (metronome !== null) {
      clearInterval(metronome);
      metronome = null;
    }
  };

  async function makeAndStartSource(): Promise<boolean> {
    if (sourceKind === 'replay' && replayTrace) {
      const replay = new ReplayMagSource(replayTrace, { speed: deps.replaySpeed ?? 1 });
      replay.onEnd = () => {
        void finishSweep(true);
      };
      source = replay;
      unsubSource = replay.subscribe(onSample);
      currentAnchors = replayTrace.anchors.length >= 2 ? replayTrace.anchors : null;
      pipeline.setAnchors(currentAnchors);
      await replay.start();
      return true;
    }
    if (sourceKind === 'field') {
      const field = (deps.makeFieldSource ?? ((): FieldMagSource => new FieldMagSource(40)))();
      source = field;
      unsubSource = field.subscribe(onSample);
      try {
        await field.start();
      } catch {
        unsubSource?.();
        unsubSource = null;
        source = null;
        showRecovery('magnetometer', field.lastError ?? 'The magnetometer could not be started.');
        return false;
      }
      return true;
    }
    if (sourceKind === 'proxy') {
      const perm = await (deps.requestMotion ?? requestMotionPermissions)();
      if (perm.orientation === 'denied' || perm.motion === 'denied') {
        showRecovery('motion', 'Motion and orientation access was denied, and the heading proxy needs both.');
        return false;
      }
      const made = deps.makeProxySource
        ? deps.makeProxySource()
        : ((): { imu: SensorSource<ImuSample>; source: SensorSource<MagSample> } => {
            const motion = new DeviceMotionSource();
            return { imu: motion, source: new HeadingProxySource(motion) };
          })();
      imu = made.imu;
      source = made.source;
      unsubSource = made.source.subscribe(onSample);
      try {
        await imu.start();
        await made.source.start();
      } catch {
        unsubSource?.();
        unsubSource = null;
        source = null;
        showRecovery('motion', 'The orientation stream could not be started.');
        return false;
      }
      return true;
    }
    return false;
  }

  async function startScan(): Promise<void> {
    ensureAudio();
    if (running) {
      await stopScan();
      return;
    }
    if (demoActive) stopDemo();
    recoveryPanel.hidden = true;
    sensorLost = false;
    clearPass(firstPass !== null);
    // Optimistic: a 'sync'-clock replay delivers the whole trace INSIDE
    // makeAndStartSource and its onEnd flips `running` back off before we
    // return — so the flag is set first and failure paths reset it.
    running = true;
    session.start(now());
    const ok = await makeAndStartSource();
    if (unmounted) return;
    if (!ok) {
      running = false;
      session.reset();
      syncControls();
      return;
    }
    guideHandle?.fireCustom('sensor-live');
    if (running) {
      void requestWakeLock();
      startMetronome();
      startHealthPoll();
      ribbon.start();
      announce(sourceKind === 'replay' ? 'Replay running' : 'Scanning. Hold the phone flat against the wall.');
    }
    syncControls();
  }

  async function stopScan(): Promise<void> {
    if (!running) return;
    running = false;
    stopHealthPoll();
    stopMetronome();
    stopTone();
    unsubSource?.();
    unsubSource = null;
    source?.stop();
    source = null;
    imu?.stop();
    imu = null;
    void releaseWakeLock();
    session.stop(now());
    if (session.phase === 'awaitSpan') {
      showSpanPanel();
    } else {
      await pipeline.flush();
      maybeScoreConfirm();
    }
    ribbon.stop();
    ribbon.renderOnce();
    syncControls();
  }

  /** Replay end (and demo end) — the trace ran out on its own. */
  async function finishSweep(fromReplay: boolean): Promise<void> {
    if (unmounted) return;
    if (fromReplay) {
      running = false;
      stopTone();
      unsubSource?.();
      unsubSource = null;
      source = null;
      void releaseWakeLock();
      await pipeline.flush();
      setAxisMode('distance');
      ribbon.stop();
      ribbon.renderOnce();
      maybeScoreConfirm();
      announce('Replay complete.');
      syncControls();
    }
  }

  const showSpanPanel = (): void => {
    spanPanel.replaceChildren();
    spanPanel.append(h('h3', 'display', 'DECLARE THE SPAN'));
    spanPanel.append(
      h('p', 'scan__prose', session.mode === 'anchor'
        ? 'Enter the distance between your two anchors — tape measure, not eyeball.'
        : 'Enter about how far you swept — “24”, “2′”, “610mm” all work.'),
    );
    const input = h('input', 'scan__input') as HTMLInputElement;
    input.type = 'text';
    input.id = 'scan-span';
    input.placeholder = 'e.g. 24, 2′, 610mm';
    const echo = h('span', 'scan__manualecho');
    const errLine = h('p', 'scan__manualerr');
    errLine.hidden = true;
    const ok = btn('SET SPAN', 'scan-span-ok');
    const skip = btn('SKIP — STAY IN TIME', 'scan-span-skip', 'btn--ghost');
    ok.addEventListener('click', () => {
      const inches = parseSpanInches(input.value);
      if (inches === null) {
        errLine.hidden = false;
        errLine.textContent = 'Cannot read that length. Formats: 24, 2′ 6″, 610mm.';
        return;
      }
      session.declareSpan(inches);
      currentAnchors = session.anchors();
      pipeline.setAnchors(currentAnchors);
      spanPanel.hidden = true;
      void pipeline.flush().then(() => {
        setAxisMode('distance');
        maybeScoreConfirm();
        syncControls();
      });
      announce(`Span set — chart now in inches.`);
    });
    skip.addEventListener('click', () => {
      session.skipSpan();
      spanPanel.hidden = true;
      void pipeline.flush().then(() => {
        maybeScoreConfirm();
        syncControls();
      });
    });
    input.addEventListener('input', () => {
      const inches = parseSpanInches(input.value);
      echo.replaceChildren();
      if (inches !== null) {
        echo.append(document.createTextNode('= '), (() => {
          const f = formatInches(rational(Math.round(inches * 16), 16), 16);
          const e = h('span', 'entered hud', f.text);
          return e;
        })());
      }
    });
    spanPanel.append(input, echo, errLine, ok, skip);
    spanPanel.hidden = false;
    input.focus();
  };

  const currentPositions = (): number[] | null => {
    if (!lastAnalysis || currentAnchors === null || currentAnchors.length < 2) return null;
    return lastAnalysis.events.map((e) => e.positionIn);
  };

  const maybeScoreConfirm = (): void => {
    if (!firstPass) return;
    const second = currentPositions();
    confirmPanel.hidden = false;
    if (second === null) {
      confirmPanel.removeAttribute('data-agree');
      confirmPanel.replaceChildren(h('h3', 'display', 'VERTICAL CONFIRM'), h('p', 'scan__prose', CONFIRM_NEEDS_SPAN_COPY));
      return;
    }
    const score = scoreAgreement(firstPass.positions, second);
    const verdict = confirmVerdict(score);
    confirmPanel.setAttribute('data-agree', String(score.agree));
    confirmPanel.replaceChildren(
      h('h3', 'display', 'VERTICAL CONFIRM'),
      h('p', 'scan__prose', verdict),
      h('p', 'scan__demonote', `${score.pairs.length} matched within ¾″ · ${score.unmatchedFirst.length + score.unmatchedSecond.length} unmatched. First pass shown gray on the ribbon.`),
    );
    announce(verdict);
  };

  const syncControls = (): void => {
    startBtn.textContent = running
      ? 'STOP'
      : sourceKind === 'replay'
        ? 'PLAY REPLAY'
        : 'START SCAN';
    markBtn.disabled = !running;
    anchorBtn.disabled = !(running && session.mode === 'anchor' && sourceKind !== 'replay');
    againBtn.disabled = running || lastAnalysis === null;
    saveBtn.disabled = running || lastAnalysis === null || lastAnalysis.events.length === 0;
    for (const [mode, b] of modeButtons) {
      b.setAttribute('aria-pressed', String(session.mode === mode));
      b.disabled = running || sourceKind === 'replay';
    }
  };

  /* ---- wire the control handlers ---- */

  startBtn.addEventListener('click', () => void startScan());

  markBtn.addEventListener('click', () => {
    if (!running) return;
    markers += 1;
    markChip.textContent = `${markers} pencil mark${markers === 1 ? '' : 's'} this pass`;
    announce(`Marked ${markers}`);
    guideHandle?.fireCustom('marked');
  });

  anchorBtn.addEventListener('click', () => {
    if (!session.dropAnchor(now())) return;
    if (session.phase === 'awaitSpan') {
      // Second anchor ends the sweep — stop the sensor, ask for the distance.
      running = false;
      stopHealthPoll();
      stopMetronome();
      stopTone();
      unsubSource?.();
      unsubSource = null;
      source?.stop();
      source = null;
      imu?.stop();
      imu = null;
      void releaseWakeLock();
      ribbon.stop();
      announce('Second anchor set. Enter the distance between anchors.');
      showSpanPanel();
    } else {
      announce('Anchor set. Sweep to the far end, then anchor again.');
    }
    syncControls();
  });

  againBtn.addEventListener('click', () => {
    const positions = currentPositions();
    firstPass = positions !== null && positions.length > 0 ? { positions } : { positions: [] };
    confirmPanel.hidden = true;
    announce('Second pass: move up twelve inches and sweep the same span.');
    void startScan();
  });

  saveBtn.addEventListener('click', () => {
    void (async () => {
      if (!lastAnalysis || !lastMeta || lastAnalysis.events.length === 0) {
        announce('Nothing detected to save on this pass.');
        return;
      }
      const hasPositions = currentAnchors !== null && currentAnchors.length >= 2;
      const ms = buildStudMeasurements(lastAnalysis.events, {
        tier: dataTier,
        sampleCount: lastMeta.sampleCount,
        calibrations: calibrationsForProvenance(getProfile()),
        hasPositions,
        ...(capAt() !== undefined ? { capAt: capAt()! } : {}),
        capturedAt: Date.now(),
      });
      for (const m of ms) await saveMeasurement(m);
      announce(`Saved ${ms.length} stud mark${ms.length === 1 ? '' : 's'} to the log, each with its confidence.`);
      guideHandle?.fireCustom('saved');
      memory.recordRun('scan');
    })();
  });

  sensInput.addEventListener('input', () => {
    const k = Number(sensInput.value);
    sensVal.textContent = `${k.toFixed(1)}·σ`;
    pipeline.sensitivity = k;
    if (!running && lastAnalysis) void pipeline.flush();
  });

  /* ---- modes ---- */
  const modeDefs: Array<{ mode: SweepMode; label: string; note: string }> = [
    { mode: 'mark', label: 'MARK ON BEEP', note: 'default — no position math, pencil the wall' },
    { mode: 'paced', label: 'PACED', note: 'metronome; declare the span at the end' },
    { mode: 'anchor', label: 'TWO-POINT ANCHOR', note: 'anchor start and end, enter the distance' },
  ];
  for (const def of modeDefs) {
    const b = btn(def.label, `scan-mode-${def.mode}`, 'btn--ghost');
    b.title = def.note;
    b.addEventListener('click', () => {
      if (session.setMode(def.mode)) syncControls();
    });
    modeButtons.set(def.mode, b);
    modesRow.append(b);
  }

  if (live) {
    // Initial value is NaN → renders as "—": no number appears before a
    // sample was actually measured (SPEC §15.1 — never a fake reading).
    readout = measuredEl(
      {
        id: 'scan-live',
        kind: 'stud',
        value: NaN,
        unit: unitFor(dataTier),
        uncertainty: { plusMinus: NaN, basis: 'unknown' },
        confidence: 'NOISE',
        provenance: { tier: dataTier, calibrations: {}, sampleCount: 0, capturedAt: 0 },
      },
      {
        size: 'primary',
        signed: true,
        decimals: 2,
        onExplainUncertainty: () =>
          showText('±', 'The ± is the live noise floor σ — a robust estimate from the trailing residual. A peak has to clear 3.5σ (your sensitivity) to count.'),
        onExplainConfidence: () => showExplainer(CONFIDENCE_EXPLAINERS[aggregate]),
      },
    );
    readoutWrap.append(readout);
    if (sourceKind !== 'replay') root.append(modesRow, markChip);
    root.append(bottomBar(startBtn, markBtn, anchorBtn, againBtn, saveBtn));
  }

  /* ====================================================================== */
  /* DEMO wiring (§7B.4 — replays through the REAL pipeline)                 */
  /* ====================================================================== */

  interface DemoEntry {
    key: string;
    spec: DemoSpec;
  }
  const demoEntries: DemoEntry[] = [
    // DEMO_SPECS now carries the fixture-backed additions too (Gate 2 merge);
    // demosForTool is the single source, so nothing double-lists.
    ...demosForTool('scan').map(({ id, spec }) => ({ key: id, spec })),
  ];

  function stopDemo(): void {
    demoHandle?.stop();
    demoHandle = null;
    demoActive = false;
    demoTier = null;
    stopTone();
    ribbon.stop();
    pipeline.setTier(dataTier === 'NONE' ? 'FIELD' : dataTier);
    feedback = new LiveFeedback(minAbsFor(dataTier));
    ribbon.setFloor(minAbsFor(dataTier) * 2.5);
    baseBadge();
    demoSynthetic.hidden = true;
    syncControls();
  }

  async function playDemo(entry: DemoEntry): Promise<void> {
    ensureAudio();
    if (running) await stopScan();
    if (demoActive) stopDemo();
    demoActive = true;
    demoNarration.textContent = '';
    demoExpected.textContent = '';
    confirmPanel.hidden = true;
    firstPass = null;

    let trace;
    try {
      trace = await loadFixture(entry.spec.fixtureId);
    } catch {
      demoActive = false;
      showText('DEMO UNAVAILABLE', `Fixture "${entry.spec.fixtureId}" failed to load.`);
      return;
    }
    demoTier = trace.device.magTier;
    feedback = new LiveFeedback(minAbsFor(demoTier));
    pipeline.reset();
    pipeline.setTier(demoTier);
    ribbon.clear();
    ribbon.setFloor(minAbsFor(demoTier) * 2.5);
    currentAnchors = trace.anchors.length >= 2 ? trace.anchors : null;
    pipeline.setAnchors(currentAnchors);
    lastAnalysis = null;
    lastMeta = null;
    prevEventCount = 0;
    eventsSignature = '';
    warnSignature = '';
    setAxisMode('time');
    ribbon.start();
    badge.className = 'badge badge--field';
    badge.textContent = `DEMO · REPLAY · ${trace.id}`;

    demoHandle = await runDemo(
      entry.spec,
      {
        onNarration: (line) => {
          demoNarration.textContent = line.text;
          announce(line.text);
        },
        onSyntheticLabel: (text) => {
          demoSynthetic.hidden = false;
          demoSynthetic.textContent = text;
        },
        onSample: (s) => onSample(s),
        onExpected: (exp) => {
          const peaks = exp.peaks_in.length > 0 ? `peaks at ${exp.peaks_in.map((p) => `${p}″`).join(', ')}` : 'no peaks';
          const pitch = exp.pitch_in !== null ? `pitch ${exp.pitch_in}″` : 'no pitch claimed';
          const warns = exp.warnings.length > 0 ? `warnings ${exp.warnings.join(', ')}` : 'no warnings';
          demoExpected.textContent = `The regression suite asserts this trace: ${peaks} (±${exp.tolerance_in}″), ${pitch}, confidence ${exp.confidence}, ${warns}. You watched the same pipeline find that.`;
        },
        onEnd: () => {
          void pipeline.flush().then(() => {
            setAxisMode('distance');
            ribbon.stop();
            ribbon.renderOnce();
          });
          demoActive = false;
          stopTone();
          syncControls();
        },
      },
      { speed: deps.demoSpeed ?? 1, load: () => Promise.resolve(trace) },
    );
  }

  for (const entry of demoEntries) {
    const row = h('div', 'scan__demorow');
    const play = btn('PLAY', `scan-demo-${entry.key}`, 'btn--ghost');
    play.addEventListener('click', () => void playDemo(entry));
    const title = h('span', undefined, DEMO_TITLES[entry.key] ?? entry.key);
    const note = h('span', 'scan__demonote', `fixture: ${entry.spec.fixtureId}`);
    row.append(play, title, note);
    demoRows.append(row);
  }
  const demoStop = btn('STOP DEMO', 'scan-demo-stop', 'btn--ghost');
  demoStop.addEventListener('click', () => stopDemo());
  demosSection.append(demoStop);

  /* ====================================================================== */
  /* Guide wiring (§7B — deps per docs/guidance-notes.md)                    */
  /* ====================================================================== */

  const guideDeps = {
    render: (step: { text: string; anchor?: string }, onDismiss: () => void): (() => void) => {
      const anchorEl = (step.anchor ? root.querySelector<HTMLElement>(step.anchor) : null) ?? root;
      const mark = coachMark(anchorEl, step.text, { onDismiss });
      return () => mark.dismiss();
    },
    sensorHook: (predicate: (sample: unknown) => boolean, cb: () => void): (() => void) => {
      const tap = (s: MagSample): void => {
        if (predicate(s)) cb();
      };
      sampleTaps.add(tap);
      return () => sampleTaps.delete(tap);
    },
  };

  const activeGuideSpec: GuideSpec = live ? SCAN_GUIDE : SCAN_MANUAL_GUIDE;
  if (deps.autoGuide !== false) {
    guideHandle = runGuide(activeGuideSpec, guideDeps, { memory });
  }
  guideMeBtn.addEventListener('click', () => {
    guideHandle?.stop();
    guideHandle = runGuide(activeGuideSpec, guideDeps, { memory, level: 'full' });
  });
  guideResetBtn.addEventListener('click', () => {
    memory.reset('scan');
    memory.reset('scan-manual');
    announce('Guidance reset. The full walkthrough runs on the next visit — or tap GUIDE ME now.');
  });

  /* ====================================================================== */
  /* Profile subscription + mount/unmount                                    */
  /* ====================================================================== */

  const unsubProfile = subscribeProfile(() => {
    syncCalChip();
    syncReticle();
    if (lastAnalysis) renderWarnings(lastAnalysis.warnings);
    else renderWarnings([]);
  });

  renderWarnings([]);
  syncControls();
  el.append(root);

  return () => {
    unmounted = true;
    guideHandle?.stop();
    stopDemo();
    stopHealthPoll();
    stopMetronome();
    stopTone();
    unsubSource?.();
    source?.stop();
    imu?.stop();
    void releaseWakeLock();
    ribbon.stop();
    unsubProfile();
    sampleTaps.clear();
    if (ownAnalyzer) analyzer.dispose();
  };
}

export const mount: ToolModule['mount'] = (el, ctx) => mountScan(el, ctx);
