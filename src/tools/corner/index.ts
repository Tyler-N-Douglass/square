/**
 * CORNER — true corner angles from a photograph (SPEC §4.3). Phase 2 UI over
 * A3's frozen Phase-1 solvers. Flow: acquire photo (camera with inline
 * permission reason, file fallback — never a dead end) → mark four points in
 * the enforced solver order with the loupe → solve + Monte Carlo in the
 * solver worker → display θ with its MC ± and confidence, deviation from
 * 90°, plumb-referenced framing when gravity supports it, and the §4.3.4
 * consequences (trim gap, split/asymmetric miter, rack readout) → save the
 * annotated photo + Measurement to the log.
 *
 * Honesty rails: the lens state is ALWAYS stated (§2.3.4); a refusal renders
 * the POOR_GEOMETRY explainer and no number (§15.3); an MC half-width past
 * ±2.5° raises the poor-geometry guidance card (§4.3.3); gravity framing is
 * omitted with the reason when the geometry (or a file upload) cannot
 * support it.
 */
import type { AppContext } from '../../app/router';
import type { Measurement } from '../../types';
import { announce } from '../../app/shell';
import { getProfile, calibrationsForProvenance } from '../../app/calibrationStore';
import { saveMeasurement } from '../../app/logStore';
import { requestWakeLock, releaseWakeLock } from '../../app/wakelock';
import { measuredEl, derivedEl, enteredEl } from '../../ui/components/number';
import { warningBanner, WARNING_COPY } from '../../ui/components/warning';
import { bottomBar } from '../../ui/components/toolbar';
import {
  WARNING_EXPLAINERS,
  CONFIDENCE_EXPLAINERS,
  UNCERTAINTY_EXPLAINER,
} from '../../guidance/explainers';
import { runGuide, type GuideHandle } from '../../guidance/tour';
import { FadingStore } from '../../guidance/fading';
import { parseLength, formatInches, rational, toNumber } from '../../geometry/units';
import { simpleMiter, asymmetricMiter } from '../../geometry/miter';
import type { Intrinsics, Px } from '../../geometry/angleSolver';
import type { MonteCarloAngleResult } from '../../geometry/montecarlo';
import { captureView, type CaptureResult } from './capture';
import { markerView, type MarkerView, LOUPE_ZOOM } from './marker';
import { createSolverRunner, type SolverRunner } from './solverClient';
import {
  markingSigmaPx,
  lensForImage,
  focalSpreadDeg,
  combinedHalfWidthDeg,
  cornerConfidence,
  POOR_GEOMETRY_HALF_WIDTH_DEG,
  familyDirections,
  downInCamera,
  plumbAssist,
  trimGapIn,
  trimGapPmIn,
  rackReadout,
  type LensChoice,
  type PlumbAssistResult,
} from './math';
import { annotateCanvas, canvasBlob, stashPhoto } from './annotate';
import { CORNER_GUIDE, CORNER_DEMOS, runCornerDemo, WORKED_LABEL } from './guide';
import { coachRenderDep, noSensorHook } from './coachDeps';
import { showExplainerCard } from './explainCard';
import { injectStylesOnce } from './styles';

const CSS = `
.corner { padding: 16px; max-width: 720px; margin: 0 auto 96px; }
.corner h1 { font-size: clamp(2rem, 8vw, 3rem); margin: 8px 0; }
.corner section { margin: 16px 0; border-top: 3px solid var(--rule, #D1D3D4); padding-top: 8px; }
.corner-lens { font-family: var(--font-hud, monospace); font-size: 0.9375rem; }
.corner-lens[data-calibrated="true"] { color: var(--green, #007A3D); }
.corner__label { font-size: 0.8125rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--type-2, #58595B); margin: 8px 0 2px; }
.corner__row { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; margin: 4px 0; }
.corner__input { border: 2px solid var(--type, #1A1A1A); background: var(--surface, #fff); color: inherit; padding: 8px; min-height: 44px; font-size: 1rem; width: 9em; }
.corner__synthetic { display: inline-block; background: var(--type, #1A1A1A); color: var(--ground, #F1F2F2); padding: 4px 8px; font-size: 0.8125rem; letter-spacing: 0.06em; text-transform: uppercase; }
.corner__narration { font-family: var(--font-prose, inherit); line-height: 1.5; padding-left: 1.2em; }
.capture__controls { display: flex; gap: 8px; flex-wrap: wrap; margin: 8px 0; }
.capture__reason, .capture__status { font-family: var(--font-prose, inherit); line-height: 1.4; margin: 4px 0; }
.marker__prompt { font-weight: 700; min-height: 1.4em; }
.marker__controls { display: flex; gap: 8px; margin: 8px 0; }
`;

interface SolveDisplay {
  quad: [Px, Px, Px, Px];
  k: Intrinsics;
  imageW: number;
  imageH: number;
  mc: MonteCarloAngleResult & { ok: true };
  lens: LensChoice;
  /** Focal-sweep half-spread for an uncalibrated lens; null when calibrated. */
  spreadDeg: number | null;
  gravity: PlumbAssistResult | null;
  source: 'camera' | 'file' | 'demo';
  truthDeg?: number;
}

let idSeq = 0;
const newId = (): string => `corner-${Date.now().toString(36)}-${(idSeq++).toString(36)}`;

/* ------------------------------------------------------------------ */
/* Result rendering — exported for DOM tests and reused by the DEMO.   */
/* ------------------------------------------------------------------ */

/** A refusal renders the explainer and the how-to-fix guidance — no number. */
export function renderRefusal(host: HTMLElement, message: string): void {
  host.replaceChildren();
  const band = warningBanner('POOR_GEOMETRY', WARNING_COPY.POOR_GEOMETRY, () =>
    showExplainerCard(host, WARNING_EXPLAINERS.POOR_GEOMETRY),
  );
  const detail = document.createElement('p');
  detail.className = 'corner__refusal-detail';
  detail.textContent = `The solver refused: ${message}`;
  host.append(band, detail);
  showExplainerCard(host, WARNING_EXPLAINERS.POOR_GEOMETRY);
}

export interface RenderDeps {
  onSave?: (m: Measurement, annotatedQuad: [Px, Px, Px, Px]) => void;
  tier: AppContext['capability']['magTier'];
}

/** Build the full result section for a successful solve. */
export function renderSolve(host: HTMLElement, d: SolveDisplay, deps: RenderDeps): Measurement {
  host.replaceChildren();

  if (d.source === 'demo') {
    const tag = document.createElement('span');
    tag.className = 'corner__synthetic';
    tag.textContent = WORKED_LABEL;
    host.append(tag);
  }

  const lensLine = document.createElement('p');
  lensLine.className = 'corner-lens';
  lensLine.setAttribute('data-calibrated', String(d.lens.calibrated));
  lensLine.textContent = d.lens.label;
  host.append(lensLine);

  const halfWidth = combinedHalfWidthDeg(d.mc.halfWidthDeg, d.spreadDeg);
  const confidence = cornerConfidence(halfWidth, d.lens.calibrated);

  const m: Measurement = {
    id: newId(),
    kind: 'corner',
    value: d.mc.medianDeg,
    unit: '°',
    uncertainty: { plusMinus: halfWidth, basis: 'montecarlo' },
    confidence,
    provenance: {
      tier: deps.tier,
      calibrations: calibrationsForProvenance(getProfile()),
      sampleCount: d.mc.samplesUsed,
      capturedAt: Date.now(),
      notes: d.lens.calibrated
        ? 'lens calibrated'
        : `lens uncalibrated — focal-band spread ${d.spreadDeg === null ? 'unbounded' : `±${d.spreadDeg.toFixed(2)}°`} folded into ±`,
    },
  };

  const label = document.createElement('p');
  label.className = 'corner__label';
  label.textContent = 'CORNER ANGLE — measured';
  const theta = measuredEl(m, {
    size: 'primary',
    showConfidence: 'always',
    onExplainUncertainty: () => {
      const base = UNCERTAINTY_EXPLAINER('montecarlo');
      const extra = d.lens.calibrated
        ? ''
        : ` The lens is uncalibrated, so the plausible focal range adds ±${(d.spreadDeg ?? 0).toFixed(2)}° in quadrature (expect ±1.5–3° overall until CALIBRATE).`;
      showExplainerCard(host, {
        title: 'WHERE THE ± COMES FROM',
        why: base + extra,
        whatToDo: 'Tighten it: calibrate the lens, mark with the loupe, capture longer edges.',
        ifIgnored: 'The ± is the honest width. Cutting to the center of a wide band is a gamble the wood pays for.',
        calibrationRoute: d.lens.calibrated ? undefined : 'lens',
      });
    },
    onExplainConfidence: () => showExplainerCard(host, CONFIDENCE_EXPLAINERS[confidence]),
  });

  const devLabel = document.createElement('p');
  devLabel.className = 'corner__label';
  devLabel.textContent = 'OFF SQUARE — derived';
  const deviation = derivedEl(d.mc.medianDeg - 90, '°', halfWidth, 'montecarlo', { signed: true });

  host.append(label, theta, devLabel, deviation);

  if (d.truthDeg !== undefined) {
    const truth = document.createElement('p');
    truth.className = 'corner__truth';
    truth.textContent = `Built at ${d.truthDeg.toFixed(1)}° exactly — the difference from the reading above is the method's honest error.`;
    host.append(truth);
  }

  if (halfWidth > POOR_GEOMETRY_HALF_WIDTH_DEG) {
    host.append(
      warningBanner('POOR_GEOMETRY', WARNING_COPY.POOR_GEOMETRY, () =>
        showExplainerCard(host, WARNING_EXPLAINERS.POOR_GEOMETRY),
      ),
    );
  }
  if (!d.lens.calibrated) {
    host.append(
      warningBanner('LENS_UNCALIBRATED', WARNING_COPY.LENS_UNCALIBRATED, () =>
        showExplainerCard(host, WARNING_EXPLAINERS.LENS_UNCALIBRATED),
      ),
    );
  }

  /* ---- gravity assist (§4.3.1.7) ---- */
  const grav = document.createElement('section');
  const gravH = document.createElement('p');
  gravH.className = 'corner__label';
  gravH.textContent = 'PLUMB REFERENCE — gravity at shutter';
  grav.append(gravH);
  if (d.source === 'file') {
    const p = document.createElement('p');
    p.textContent = 'Needs a live shot: an uploaded photo carries no gravity at shutter, so plumb-referenced framing is off.';
    grav.append(p);
  } else if (d.source === 'demo') {
    const p = document.createElement('p');
    p.textContent = 'Synthetic example — no device gravity to reference.';
    grav.append(p);
  } else if (!d.gravity) {
    const p = document.createElement('p');
    p.textContent = 'No usable orientation sample arrived at shutter time — plumb reference omitted.';
    grav.append(p);
  } else if (!d.gravity.ok) {
    const p = document.createElement('p');
    p.textContent = d.gravity.reason;
    grav.append(p);
  } else {
    const f = d.gravity.framing;
    const vertName = f.verticalFamily === 1 ? 'first marked edge' : 'second marked edge';
    const horName = f.verticalFamily === 1 ? 'second marked edge' : 'first marked edge';
    const row1 = document.createElement('div');
    row1.className = 'corner__row';
    row1.append(`${vertName} out of plumb: `, derivedEl(f.offPlumbDeg, '°', halfWidth, 'nominal'));
    const row2 = document.createElement('div');
    row2.className = 'corner__row';
    row2.append(`${horName} out of level: `, derivedEl(f.offLevelDeg, '°', halfWidth, 'nominal'));
    grav.append(row1, row2);
  }
  host.append(grav);

  /* ---- consequences (§4.3.4) ---- */
  const cons = document.createElement('section');
  const consH = document.createElement('p');
  consH.className = 'corner__label';
  consH.textContent = 'WHAT IT MEANS AT THE SAW';
  cons.append(consH);

  const deltaDeg = Math.abs(d.mc.medianDeg - 90);

  // Trim gap for entered length L.
  const gapRow = document.createElement('div');
  gapRow.className = 'corner__row';
  const gapInput = document.createElement('input');
  gapInput.className = 'corner__input corner-trim-length';
  gapInput.placeholder = 'trim length, e.g. 8\' or 96"';
  gapInput.setAttribute('aria-label', 'Trim length for the gap estimate');
  const gapOut = document.createElement('span');
  gapOut.className = 'corner-trim-out';
  const recomputeGap = (): void => {
    gapOut.replaceChildren();
    const parsed = parseLength(gapInput.value);
    if (!parsed) {
      if (gapInput.value.trim() !== '') gapOut.textContent = 'Enter a length like 96", 8\', or 2400mm.';
      return;
    }
    const lenIn = toNumber(parsed.inches);
    const gap = trimGapIn(lenIn, deltaDeg);
    const pm = trimGapPmIn(lenIn, deltaDeg, halfWidth);
    gapOut.append(
      'gap at the heel: ',
      derivedEl(gap, 'in', pm, 'montecarlo', { decimals: 3 }),
      ` (≈ ${formatInches(rational(Math.round(gap * 32), 32), 32).text})`,
    );
  };
  gapInput.addEventListener('input', recomputeGap);
  const gapLabel = document.createElement('p');
  gapLabel.className = 'corner__label';
  gapLabel.textContent = 'TRIM GAP — for a piece this long, entered';
  gapRow.append(gapInput, gapOut);
  cons.append(gapLabel, gapRow);

  // Split miter + asymmetric option.
  const miterLabel = document.createElement('p');
  miterLabel.className = 'corner__label';
  miterLabel.textContent = 'MITER — split evenly, derived';
  const miterRow = document.createElement('div');
  miterRow.className = 'corner__row';
  miterRow.append(
    'each piece: ',
    derivedEl(simpleMiter(d.mc.medianDeg), '°', halfWidth / 2, 'montecarlo'),
  );
  const asymRow = document.createElement('div');
  asymRow.className = 'corner__row';
  const asymInput = document.createElement('input');
  asymInput.className = 'corner__input corner-asym-fixed';
  asymInput.placeholder = 'fixed piece miter, °';
  asymInput.setAttribute('aria-label', 'Miter already cut on the fixed piece, degrees');
  const asymOut = document.createElement('span');
  const recomputeAsym = (): void => {
    asymOut.replaceChildren();
    const v = Number.parseFloat(asymInput.value);
    if (!Number.isFinite(v)) return;
    const mate = asymmetricMiter(d.mc.medianDeg, v);
    if (mate < 0 || mate > 90) {
      asymOut.textContent = `mate needs ${mate.toFixed(1)}° — that fixed cut cannot meet this corner. Recut the fixed piece.`;
      return;
    }
    asymOut.append(enteredEl(v, '°'), ' fixed → mate: ', derivedEl(mate, '°', halfWidth, 'montecarlo'));
  };
  asymInput.addEventListener('input', recomputeAsym);
  asymRow.append(asymInput, asymOut);
  cons.append(miterLabel, miterRow, asymRow);

  // Rack readout for a declared rectangle.
  const rackLabel = document.createElement('p');
  rackLabel.className = 'corner__label';
  rackLabel.textContent = 'RACK — declared rectangle, diagonal difference';
  const rackRow = document.createElement('div');
  rackRow.className = 'corner__row';
  const rackInput = document.createElement('input');
  rackInput.className = 'corner__input corner-rack-ref';
  rackInput.placeholder = 'edge 1 true length';
  rackInput.setAttribute(
    'aria-label',
    'Declared true length of the first marked edge, for the rack readout',
  );
  const rackOut = document.createElement('span');
  rackOut.className = 'corner-rack-out';
  const recomputeRack = (): void => {
    rackOut.replaceChildren();
    const parsed = parseLength(rackInput.value);
    if (!parsed) {
      if (rackInput.value.trim() !== '') rackOut.textContent = 'Enter the real length of the first marked edge.';
      return;
    }
    const refIn = toNumber(parsed.inches);
    const rack = rackReadout(d.quad, d.k, refIn, { sigmaPx: d.mc.sigmaPx, seed: 0xac5e });
    if (!rack.ok) {
      rackOut.textContent = rack.message;
      return;
    }
    rackOut.append(
      'diagonals differ by ',
      derivedEl(Math.abs(rack.diffIn), 'in', rack.pmIn, 'montecarlo', { decimals: 2 }),
      ` (${rack.diag1In.toFixed(1)}" vs ${rack.diag2In.toFixed(1)}") — equal diagonals means square.`,
    );
  };
  rackInput.addEventListener('input', recomputeRack);
  rackRow.append(rackInput, rackOut);
  cons.append(rackLabel, rackRow);
  host.append(cons);

  /* ---- save ---- */
  if (d.source !== 'demo' && deps.onSave) {
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'btn corner-save';
    saveBtn.textContent = 'SAVE TO LOG';
    saveBtn.addEventListener('click', () => deps.onSave?.(m, d.quad));
    host.append(saveBtn);
  }

  return m;
}

/* ------------------------------------------------------------------ */
/* Mount                                                               */
/* ------------------------------------------------------------------ */

export function mount(el: HTMLElement, ctx: AppContext): () => void {
  injectStylesOnce('a3b-corner', CSS);
  const runner: SolverRunner = createSolverRunner();
  const memory = new FadingStore();

  const root = document.createElement('div');
  root.className = 'corner';

  const h1 = document.createElement('h1');
  h1.className = 'display';
  h1.textContent = 'CORNER';

  const intro = document.createElement('p');
  intro.textContent =
    'Photograph the corner; mark it; read the true angle with its uncertainty. Assumes a pinhole camera with square pixels and the image center as principal point.';

  // Lens state line — always states which mode is in effect (§2.3.4).
  const lensLine = document.createElement('p');
  lensLine.className = 'corner-lens';
  const bannerHost = document.createElement('div');
  const syncLensHeader = (): void => {
    const profile = getProfile();
    const hasAny = profile.lens && Object.keys(profile.lens).length > 0;
    lensLine.setAttribute('data-calibrated', String(Boolean(hasAny)));
    lensLine.textContent = hasAny
      ? 'LENS: CALIBRATED profile on file — applied when this camera shoots. Expect ±0.3–0.8°.'
      : 'LENS: NOT CALIBRATED — angles carry ±1.5–3° until you calibrate. Expect the wide band.';
    bannerHost.replaceChildren();
    if (!hasAny) {
      bannerHost.append(
        warningBanner('LENS_UNCALIBRATED', WARNING_COPY.LENS_UNCALIBRATED, () =>
          showExplainerCard(bannerHost, WARNING_EXPLAINERS.LENS_UNCALIBRATED),
        ),
      );
    }
  };
  syncLensHeader();

  const captureHost = document.createElement('section');
  captureHost.className = 'corner-capture';
  const markHost = document.createElement('section');
  markHost.className = 'corner-mark';
  const resultHost = document.createElement('section');
  resultHost.className = 'corner-result';
  resultHost.setAttribute('aria-live', 'polite');

  root.append(h1, intro, lensLine, bannerHost, captureHost, markHost, resultHost);

  let capture: CaptureResult | null = null;
  let marker: MarkerView | null = null;
  let guide: GuideHandle | null = null;
  let solveToken = 0;
  let runRecorded = false;

  const fireGuide = (name: string): void => guide?.fireCustom(name);

  const doSolve = async (): Promise<void> => {
    if (!capture || !marker) return;
    const quad = marker.session.quad();
    if (!quad) return;
    const token = ++solveToken;
    const profile = getProfile();
    // Files fall back to 'cam:default' so a lens calibrated from an uploaded
    // sheet photo still applies to uploaded corner shots (aspect-guarded).
    const lens = lensForImage(profile, capture.cameraKey ?? 'cam:default', capture.width, capture.height);
    const sigmaPx = markingSigmaPx({
      cssToWorkingScale: marker.cssToWorkingScale(),
      allRefined: marker.session.allRefined,
      loupeZoom: LOUPE_ZOOM,
    });
    const mc = await runner.monteCarlo(quad, lens.k, { sigmaPx, samples: 500, seed: 0x5eed });
    if (token !== solveToken) return; // superseded by a newer edit
    if (!mc.ok) {
      renderRefusal(resultHost, mc.message);
      announce('Poor geometry — the solver refused. See the card for fixes.', 'assertive');
      return;
    }
    const spread = lens.calibrated
      ? null
      : focalSpreadDeg(quad, capture.width, capture.height);

    let gravity: PlumbAssistResult | null = null;
    if (capture.source === 'camera' && capture.orientationAtShutter) {
      const dirs = familyDirections(quad, lens.k);
      if (dirs.ok) {
        const o = capture.orientationAtShutter;
        gravity = plumbAssist(dirs.d1, dirs.d2, downInCamera(o.pitch, o.roll));
      } else {
        gravity = { ok: false, reason: 'Edge directions are too degenerate for a plumb reference.' };
      }
    }

    renderSolve(
      resultHost,
      {
        quad,
        k: lens.k,
        imageW: capture.width,
        imageH: capture.height,
        mc,
        lens,
        spreadDeg: spread,
        gravity,
        source: capture.source,
      },
      {
        tier: ctx.capability.magTier,
        onSave: (m, annotatedQuad) => void save(m, annotatedQuad),
      },
    );
    const half = combinedHalfWidthDeg(mc.halfWidthDeg, spread);
    announce(`Corner ${mc.medianDeg.toFixed(1)} degrees, plus or minus ${half.toFixed(1)}`);
    if (!runRecorded) {
      runRecorded = true;
      memory.recordRun('corner');
    }
    fireGuide('solved');
  };

  const save = async (m: Measurement, quad: [Px, Px, Px, Px]): Promise<void> => {
    if (!capture) return;
    const label = [
      `CORNER ${m.value.toFixed(1)}° ±${m.uncertainty.plusMinus.toFixed(1)}° · ${m.confidence}`,
      getProfile().lens && Object.keys(getProfile().lens ?? {}).length > 0
        ? 'lens: calibrated'
        : 'lens: NOT calibrated (±1.5–3°)',
    ];
    const annotated = annotateCanvas(capture.canvas, quad, label);
    const blob = await canvasBlob(annotated);
    let photoId: string | null = null;
    if (blob) photoId = await stashPhoto(blob);
    const withMedia: Measurement = photoId
      ? { ...m, media: { photoId, overlay: { quad, width: capture.width, height: capture.height } } }
      : { ...m, media: { overlay: { quad, width: capture.width, height: capture.height } } };
    await saveMeasurement(withMedia, { note: 'CORNER photo measurement' });
    announce('Saved to log');
  };

  const beginMarking = (cap: CaptureResult): void => {
    capture = cap;
    runRecorded = false;
    marker?.dispose();
    resultHost.replaceChildren();
    marker = markerView({
      photo: cap.canvas,
      onChange: (session) => {
        if (session.complete) void doSolve();
        else resultHost.replaceChildren();
      },
      onPlaced: (count) => fireGuide(`mark-${count}`),
      announce,
    });
    markHost.replaceChildren(marker.el);
    if (cap.source === 'file') {
      const note = document.createElement('p');
      note.textContent = 'Uploaded photo: plumb-referenced framing needs a live camera shot, so it stays off for this one.';
      markHost.append(note);
    }
    fireGuide('photo-captured');
  };

  const cameraUI = captureView({
    capability: ctx.capability,
    wantGravity: true,
    reason:
      'The camera is used only to photograph the corner — the shot stays on this phone. Gravity at shutter adds the plumb reference.',
    onCaptured: beginMarking,
    announce,
  });
  captureHost.append(cameraUI.el);

  /* ---- DEMO (worked examples through the real solver, ADR-012) ---- */
  const demoHost = document.createElement('section');
  demoHost.className = 'corner-demo';
  root.append(demoHost);

  const runDemoById = async (id: string): Promise<void> => {
    const spec = CORNER_DEMOS.find((s) => s.id === id);
    if (!spec) return;
    demoHost.replaceChildren();
    const narr = document.createElement('ol');
    narr.className = 'corner__narration';
    demoHost.append(narr);
    await runCornerDemo(spec, {
      runner,
      onSyntheticLabel: (text) => {
        const tag = document.createElement('span');
        tag.className = 'corner__synthetic';
        tag.textContent = text;
        demoHost.prepend(tag);
      },
      onNarration: (line) => {
        const li = document.createElement('li');
        li.textContent = line;
        narr.append(li);
      },
      onResult: (outcome) => {
        if (outcome.kind === 'refusal') {
          const msg = outcome.result.ok ? '' : outcome.result.message;
          renderRefusal(resultHost, msg);
          announce('Demo: the solver refused the degenerate marking, as it must.');
          return;
        }
        if (!outcome.mc.ok) {
          renderRefusal(resultHost, outcome.mc.message);
          return;
        }
        renderSolve(
          resultHost,
          {
            quad: outcome.quad,
            k: outcome.k,
            imageW: outcome.imageW,
            imageH: outcome.imageH,
            mc: outcome.mc,
            lens: {
              k: outcome.k,
              calibrated: true,
              label: `LENS: KNOWN (synthetic camera, f = ${outcome.k.fPx} px)`,
            },
            spreadDeg: null,
            gravity: null,
            source: 'demo',
            truthDeg: outcome.truthDeg,
          },
          { tier: ctx.capability.magTier },
        );
        announce('Demo solved — compare the reading with the built-in truth.');
      },
    });
  };

  /* ---- bottom bar: guide / demo / start over ---- */
  const guideBtn = document.createElement('button');
  guideBtn.type = 'button';
  guideBtn.className = 'btn btn--ghost corner-guide-me';
  guideBtn.textContent = 'GUIDE ME';

  const demoBtn = document.createElement('button');
  demoBtn.type = 'button';
  demoBtn.className = 'btn btn--ghost corner-demo-btn';
  demoBtn.textContent = 'DEMO';

  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'btn btn--ghost corner-reset';
  resetBtn.textContent = 'START OVER';

  const startGuide = (level?: 'full'): void => {
    guide?.stop();
    guide = runGuide(
      CORNER_GUIDE,
      { render: coachRenderDep(root), sensorHook: noSensorHook },
      level ? { memory, level } : { memory },
    );
  };
  guideBtn.addEventListener('click', () => startGuide('full'));
  demoBtn.addEventListener('click', () => {
    demoHost.replaceChildren();
    const pick = document.createElement('div');
    pick.className = 'capture__controls';
    for (const spec of CORNER_DEMOS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn';
      b.textContent = spec.title;
      b.addEventListener('click', () => void runDemoById(spec.id));
      pick.append(b);
    }
    demoHost.append(pick);
  });
  resetBtn.addEventListener('click', () => {
    capture = null;
    marker?.dispose();
    marker = null;
    markHost.replaceChildren();
    resultHost.replaceChildren();
    demoHost.replaceChildren();
    syncLensHeader();
    announce('Cleared. Photograph or pick a new shot.');
  });

  const resetGuidance = document.createElement('button');
  resetGuidance.type = 'button';
  resetGuidance.className = 'btn btn--ghost corner-reset-guidance';
  resetGuidance.textContent = 'RESET GUIDANCE';
  resetGuidance.title = 'Show all walkthrough prompts again from run one.';
  resetGuidance.addEventListener('click', () => {
    memory.reset('corner');
    announce('Guidance reset — full walkthrough on the next run.');
  });
  root.append(resetGuidance);

  const bar = bottomBar(guideBtn, demoBtn, resetBtn);
  root.append(bar);
  el.append(root);

  void requestWakeLock();
  startGuide(); // fades per stored run count; silent after run 6 (§7B.3)

  return () => {
    guide?.stop();
    cameraUI.dispose();
    marker?.dispose();
    runner.dispose();
    void releaseWakeLock();
  };
}
