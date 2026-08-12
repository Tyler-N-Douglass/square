/**
 * CALIBRATE — SPEC §4.6. Four routines, each a guided flow with pass/fail
 * and an age, writing calibrationStore; plus the SELF-TEST screen. Cards
 * show last-run age, pass/fail state, and what depends on each routine.
 * Tiers degrade honestly: iron calibration and the sensor locator need the
 * raw field, and on PROXY/NONE the cards say so and point at the routines
 * that still work — never a dead end (SPEC §6.4, §15.4).
 */
import type { AppContext } from '../../app/router';
import type { Vec3 } from '../../types';
import { announce } from '../../app/shell';
import {
  getProfile,
  updateProfile,
  calibrationAgeMs,
} from '../../app/calibrationStore';
import { requestWakeLock, releaseWakeLock } from '../../app/wakelock';
import { derivedEl } from '../../ui/components/number';
import { warningBanner, WARNING_COPY } from '../../ui/components/warning';
import { bottomBar } from '../../ui/components/toolbar';
import { WARNING_EXPLAINERS } from '../../guidance/explainers';
import { runGuide, type GuideHandle, type GuideSpec } from '../../guidance/tour';
import { FadingStore } from '../../guidance/fading';
import { FieldMagSource } from '../../sensors/magnetometer';
import { DeviceMotionSource } from '../../sensors/imu';
import { OrientationFusion } from '../../sensors/orientation';
import { requestMotionPermissions } from '../../sensors/permissions';
import { SHEET_ASPECT, calibrateFromSheet } from '../../geometry/intrinsics';
import { rafWriter } from '../../app/store';
import { captureView, type CaptureResult } from '../corner/capture';
import { markerView, type MarkerView } from '../corner/marker';
import type { MarkStep } from '../corner/state';
import { coachRenderDep, noSensorHook } from '../corner/coachDeps';
import { showExplainerCard } from '../corner/explainCard';
import { injectStylesOnce } from '../corner/styles';
import { createDspRunner } from './dspClient';
import {
  CoverageTracker,
  evaluateMagFit,
  fitPeak2D,
  windowAmplitude,
  reversalFromCaptures,
  StillnessCapture,
  evaluateLensResult,
  lensFocalUncertainty,
  formatAge,
  loadOutcomes,
  saveOutcome,
  octantCell,
  LOCATOR_GRID,
  LOCATOR_DWELL_MS,
  MAG_COLLECT_TARGET_S,
  ROUTINE_TITLES,
  ROUTINE_DEPENDENTS,
  ROUTINE_PROFILE_PART,
  LENS_RESIDUAL_MAX_DEG,
  type RoutineId,
} from './logic';
import {
  CALIBRATE_GUIDES,
  CALIBRATE_DEMOS,
  runCalibrateDemo,
} from './guide';
import { selfTestView, noteError, type SelfTestHandle } from './selftest';

const CSS = `
.calib { padding: 16px; max-width: 720px; margin: 0 auto 96px; }
.calib h1 { font-size: clamp(2rem, 8vw, 3rem); margin: 8px 0; }
.calib h2 { margin: 16px 0 8px; }
.calib h3 { margin: 16px 0 4px; font-size: 1rem; text-transform: uppercase; letter-spacing: 0.06em; }
.calib-card { border: 3px solid var(--rule-strong, #58595B); background: var(--surface, #fff); padding: 16px; margin: 12px 0; }
.calib-card__title { font-size: 1.25rem; margin: 0 0 4px; }
.calib-card__status { font-family: var(--font-hud, monospace); margin: 2px 0; }
.calib-card__status[data-state="pass"] { color: var(--green, #007A3D); }
.calib-card__status[data-state="fail"] { color: var(--red, #C1272D); }
.calib-card__deps { color: var(--type-2, #58595B); margin: 4px 0 8px; font-family: var(--font-prose, inherit); }
.calib-octants { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; max-width: 320px; margin: 12px 0; }
.calib-octants div { border: 2px solid var(--type, #1A1A1A); height: 44px; }
.calib-octants div[data-filled="true"] { background: var(--type, #1A1A1A); }
.calib-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin: 8px 0; }
.calib-hud { font-family: var(--font-hud, monospace); font-size: 1.25rem; }
.calib-loc-stage { position: fixed; inset: 0; background: var(--ground, #F1F2F2); z-index: 40; }
.calib-loc-target { position: absolute; width: 56px; height: 56px; margin: -28px 0 0 -28px; border: 6px solid var(--type, #1A1A1A); }
.calib-loc-target[data-active="true"] { border-color: var(--orange, #F15A22); }
.calib-reticle { position: absolute; width: 32px; height: 32px; margin: -16px 0 0 -16px; border: 3px solid var(--green, #007A3D); }
.calib-selftest dl { display: grid; grid-template-columns: minmax(10em, auto) 1fr; gap: 2px 12px; }
.calib-selftest dt { font-weight: 700; }
.calib-selftest dd { margin: 0; font-family: var(--font-prose, inherit); }
.calib-synthetic { display: inline-block; background: var(--type, #1A1A1A); color: var(--ground, #F1F2F2); padding: 4px 8px; font-size: 0.8125rem; letter-spacing: 0.06em; text-transform: uppercase; }
.calib-narration { font-family: var(--font-prose, inherit); line-height: 1.5; padding-left: 1.2em; }
.corner__input { border: 2px solid var(--type, #1A1A1A); background: var(--surface, #fff); color: inherit; padding: 8px; min-height: 44px; font-size: 1rem; width: 9em; }
`;

type ViewId = 'cards' | RoutineId | 'selftest';

export function mount(el: HTMLElement, ctx: AppContext): () => void {
  injectStylesOnce('a3b-calibrate', CSS);
  const memory = new FadingStore();
  const dsp = createDspRunner();

  const root = document.createElement('div');
  root.className = 'calib';
  const h1 = document.createElement('h1');
  h1.className = 'display';
  h1.textContent = 'CALIBRATE';
  const intro = document.createElement('p');
  intro.textContent =
    'Four routines, each with a pass/fail and an age. Every other tool’s accuracy claim is gated on these — a stale or failed calibration shows up where it matters.';
  const viewHost = document.createElement('div');
  root.append(h1, intro, viewHost);

  let guide: GuideHandle | null = null;
  let forceFullGuide = false;
  let currentDispose: (() => void) | null = null;

  const fireGuide = (name: string): void => guide?.fireCustom(name);

  const startGuideFor = (spec: GuideSpec): void => {
    guide?.stop();
    guide = runGuide(
      spec,
      { render: coachRenderDep(root), sensorHook: noSensorHook },
      forceFullGuide ? { memory, level: 'full' } : { memory },
    );
    forceFullGuide = false;
  };

  const show = (view: ViewId): void => {
    currentDispose?.();
    currentDispose = null;
    guide?.stop();
    guide = null;
    viewHost.replaceChildren();
    switch (view) {
      case 'cards':
        viewHost.append(cardsView());
        break;
      case 'mag':
        viewHost.append(magView());
        break;
      case 'locator':
        viewHost.append(locatorView());
        break;
      case 'levelZero':
        viewHost.append(levelZeroView());
        break;
      case 'lens':
        viewHost.append(lensView());
        break;
      case 'selftest': {
        const st: SelfTestHandle = selfTestView(ctx.capability);
        currentDispose = st.dispose;
        viewHost.append(backBtn(), st.el);
        break;
      }
    }
  };

  const backBtn = (): HTMLElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn--ghost calib-back';
    b.textContent = '← ALL ROUTINES';
    b.addEventListener('click', () => show('cards'));
    return b;
  };

  /* ---------------------------------------------------------------- */
  /* Cards                                                             */
  /* ---------------------------------------------------------------- */

  const statusFor = (id: RoutineId): { text: string; state: 'pass' | 'fail' | 'none' } => {
    const outcome = loadOutcomes()[id];
    if (outcome) {
      return {
        text: `${outcome.pass ? 'PASS' : 'FAIL'} · ${formatAge(Date.now() - outcome.at)} — ${outcome.note}`,
        state: outcome.pass ? 'pass' : 'fail',
      };
    }
    const age = calibrationAgeMs(getProfile(), ROUTINE_PROFILE_PART[id]);
    if (age !== null) return { text: `stored · ${formatAge(age)}`, state: 'pass' };
    return { text: 'never run', state: 'none' };
  };

  const cardsView = (): HTMLElement => {
    const wrap = document.createElement('div');
    const tier = ctx.capability.magTier;
    for (const id of ['mag', 'locator', 'levelZero', 'lens'] as RoutineId[]) {
      const card = document.createElement('section');
      card.className = `calib-card calib-card--${id}`;
      const title = document.createElement('h2');
      title.className = 'calib-card__title display';
      title.textContent = ROUTINE_TITLES[id];
      const status = document.createElement('p');
      status.className = 'calib-card__status';
      const s = statusFor(id);
      status.textContent = s.text;
      status.setAttribute('data-state', s.state);
      const deps = document.createElement('p');
      deps.className = 'calib-card__deps';
      deps.textContent = ROUTINE_DEPENDENTS[id];
      card.append(title, status, deps);

      const needsRawField = id === 'mag' || id === 'locator';
      if (needsRawField && tier !== 'FIELD') {
        const why = document.createElement('p');
        why.className = 'calib-card__blocked';
        why.textContent =
          tier === 'PROXY'
            ? id === 'mag'
              ? 'Needs the raw field vector, and this browser exposes heading only. Heading-proxy SCAN runs uncalibrated with capped confidence. Level zero and lens calibration below still work.'
              : 'Needs the raw field magnitude to measure amplitude, and this browser exposes heading only. Level zero and lens calibration below still work.'
            : 'No magnetometer path on this device. Level zero and lens calibration below still work.';
        card.append(why);
      } else {
        const run = document.createElement('button');
        run.type = 'button';
        run.className = `btn calib-run-${id}`;
        run.textContent = 'RUN';
        run.setAttribute('aria-label', `Run ${ROUTINE_TITLES[id]}`);
        run.addEventListener('click', () => show(id));
        card.append(run);
      }
      wrap.append(card);
    }

    // DEMO — synthetic stream through the real fit (ADR-012). Failure first.
    const demoH = document.createElement('h2');
    demoH.className = 'display';
    demoH.textContent = 'DEMO';
    const demoRow = document.createElement('div');
    demoRow.className = 'calib-row';
    const demoHost = document.createElement('div');
    demoHost.className = 'calib-demo';
    for (const spec of CALIBRATE_DEMOS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn';
      b.textContent = spec.title;
      b.addEventListener('click', () => {
        demoHost.replaceChildren();
        const narr = document.createElement('ol');
        narr.className = 'calib-narration';
        const grid = octantGrid();
        demoHost.append(narr, grid.el);
        runCalibrateDemo(spec, {
          onSyntheticLabel: (text) => {
            const tag = document.createElement('span');
            tag.className = 'calib-synthetic';
            tag.textContent = text;
            demoHost.prepend(tag);
          },
          onNarration: (line) => {
            const li = document.createElement('li');
            li.textContent = line;
            narr.append(li);
          },
          onProgress: (filled) => grid.setFilled(filled),
          onResult: (outcome) => {
            const res = document.createElement('div');
            res.className = 'calib-demo-result';
            const truth = document.createElement('p');
            const t = outcome.truthHardIron;
            truth.textContent = `Built-in truth: hard iron [${t[0]}, ${t[1]}, ${t[2]}] µT (|b| = ${Math.hypot(t[0], t[1], t[2]).toFixed(1)} µT).`;
            res.append(truth);
            const recovered = document.createElement('p');
            recovered.className = 'calib-hud';
            recovered.textContent = `Fit recovered |b| = ${outcome.evaluation.hardIronUt.toFixed(1)} µT · residual ${(outcome.fit.residual * 100).toFixed(1)}% · coverage ${Math.round(outcome.fit.coverage * 8)}/8`;
            res.append(recovered);
            if (outcome.evaluation.accessory) {
              res.append(
                warningBanner('MAGNETIC_ACCESSORY', WARNING_COPY.MAGNETIC_ACCESSORY, () =>
                  showExplainerCard(res, WARNING_EXPLAINERS.MAGNETIC_ACCESSORY),
                ),
              );
              const note = document.createElement('p');
              note.textContent = 'FAIL — nothing stored. That is the routine working.';
              res.append(note);
            } else {
              const note = document.createElement('p');
              note.textContent = outcome.evaluation.pass
                ? 'PASS — in a live run this would be stored and every SCAN reading would ride on it.'
                : `FAIL — ${outcome.evaluation.reasons.join(' ')}`;
              res.append(note);
            }
            demoHost.append(res);
          },
        });
      });
      demoRow.append(b);
    }
    wrap.append(demoH, demoRow, demoHost);
    return wrap;
  };

  /* ---------------------------------------------------------------- */
  /* Octant grid (shared by live mag + demo)                           */
  /* ---------------------------------------------------------------- */

  function octantGrid(): { el: HTMLElement; update(counts: number[], minPer?: number): void; setFilled(n: number): void } {
    const grid = document.createElement('div');
    grid.className = 'calib-octants';
    grid.setAttribute('role', 'img');
    grid.setAttribute('aria-label', 'Octant coverage — eight cells fill as the figure-8 covers all directions');
    const cells: HTMLElement[] = [];
    for (let i = 0; i < 8; i++) {
      const c = document.createElement('div');
      cells.push(c);
    }
    // Place by octant cell so the layout is stable: row 0 = z+, row 1 = z−.
    for (let i = 0; i < 8; i++) {
      const { row, col } = octantCell(i);
      grid.append(cells[row * 4 + col]!);
    }
    return {
      el: grid,
      update: (counts, minPer = 5) => {
        counts.forEach((n, i) => {
          const { row, col } = octantCell(i);
          cells[row * 4 + col]!.setAttribute('data-filled', String(n >= minPer));
        });
      },
      setFilled: (n) => {
        cells.forEach((c, i) => c.setAttribute('data-filled', String(i < n)));
      },
    };
  }

  /* ---------------------------------------------------------------- */
  /* Routine: magnetometer iron (§4.6.1)                               */
  /* ---------------------------------------------------------------- */

  const magView = (): HTMLElement => {
    const wrap = document.createElement('div');
    wrap.append(backBtn());
    const h = document.createElement('h2');
    h.className = 'display';
    h.textContent = ROUTINE_TITLES.mag;
    const how = document.createElement('p');
    how.textContent =
      'Take the phone out of its case, start, then roll it through a slow figure-8 for 20–30 seconds. The eight cells fill as the directions get covered.';
    wrap.append(h, how);

    const grid = octantGrid();
    const hud = document.createElement('p');
    hud.className = 'calib-hud';
    hud.textContent = '—';
    const resultHost = document.createElement('div');
    resultHost.className = 'calib-mag-result';

    const startB = document.createElement('button');
    startB.type = 'button';
    startB.className = 'btn calib-mag-start';
    startB.textContent = 'START FIGURE-8';
    const stopB = document.createElement('button');
    stopB.type = 'button';
    stopB.className = 'btn calib-mag-stop';
    stopB.textContent = 'STOP + FIT';
    stopB.hidden = true;

    const row = document.createElement('div');
    row.className = 'calib-row';
    row.append(startB, stopB);
    wrap.append(row, grid.el, hud, resultHost);

    const source = new FieldMagSource();
    const tracker = new CoverageTracker();
    let startedAt = 0;
    let covered = false;
    const writeHud = rafWriter<string>((s) => { hud.textContent = s; });
    const unsub = source.subscribe((s) => {
      tracker.push([s.x, s.y, s.z]);
      const filled = tracker.filledCount();
      grid.update(tracker.counts());
      const elapsed = s.t - startedAt;
      writeHud(`${tracker.samples.length} samples · ${filled}/8 octants · ${elapsed.toFixed(0)} s of ${MAG_COLLECT_TARGET_S}`);
      if (!covered && filled === 8) {
        covered = true;
        fireGuide('mag-covered');
        announce('All eight octants covered — keep going a few more seconds, then stop.');
      }
    });

    let running = false;
    startB.addEventListener('click', () => {
      void (async () => {
        try {
          await source.start();
          running = true;
          startedAt = performance.now() / 1000;
          startB.hidden = true;
          stopB.hidden = false;
          fireGuide('mag-started');
          announce('Collecting. Roll the phone through a figure-8.');
        } catch (e) {
          noteError(e);
          resultHost.textContent = `The raw magnetometer would not start: ${source.lastError ?? 'unknown'}. On Android Chrome enable chrome://flags/#enable-generic-sensor-extra-classes and reload.`;
        }
      })();
    });

    stopB.addEventListener('click', () => {
      void (async () => {
        if (!running) return;
        running = false;
        source.stop();
        stopB.hidden = true;
        startB.hidden = false;
        hud.textContent = `${tracker.samples.length} samples — fitting…`;
        const fit = await dsp.fitEllipsoid(tracker.samples);
        const ev = evaluateMagFit(fit);
        resultHost.replaceChildren();
        const line = document.createElement('div');
        line.className = 'calib-row';
        line.append(
          '|b| = ',
          derivedEl(ev.hardIronUt, 'µT', Math.max(0.5, fit.residual * fit.radius), 'nominal'),
          ` · residual ${(fit.residual * 100).toFixed(1)}% · coverage ${Math.round(fit.coverage * 8)}/8`,
        );
        resultHost.append(line);
        if (ev.accessory) {
          resultHost.append(
            warningBanner('MAGNETIC_ACCESSORY', WARNING_COPY.MAGNETIC_ACCESSORY, () =>
              showExplainerCard(resultHost, WARNING_EXPLAINERS.MAGNETIC_ACCESSORY),
            ),
          );
          showExplainerCard(resultHost, WARNING_EXPLAINERS.MAGNETIC_ACCESSORY);
          const kept = document.createElement('p');
          kept.textContent = 'Nothing stored. Any previous calibration is kept.';
          resultHost.append(kept);
          saveOutcome('mag', { at: Date.now(), pass: false, note: `|b| ${ev.hardIronUt.toFixed(0)} µT — magnetic accessory` });
          announce(WARNING_COPY.MAGNETIC_ACCESSORY, 'assertive');
        } else if (ev.pass) {
          updateProfile({
            mag: { hardIron: fit.hardIron, softIron: fit.softIron, residual: fit.residual, coverage: fit.coverage },
          });
          saveOutcome('mag', {
            at: Date.now(),
            pass: true,
            note: `residual ${(fit.residual * 100).toFixed(1)}%, |b| ${ev.hardIronUt.toFixed(1)} µT`,
          });
          const ok = document.createElement('p');
          ok.textContent = 'PASS — stored. SCAN now subtracts this phone’s own field from every reading.';
          resultHost.append(ok);
          announce('Calibration pass. Stored.');
        } else {
          saveOutcome('mag', { at: Date.now(), pass: false, note: ev.reasons[0] ?? 'failed' });
          for (const r of ev.reasons) {
            const p = document.createElement('p');
            p.textContent = r;
            resultHost.append(p);
          }
          const kept = document.createElement('p');
          kept.textContent = 'Nothing stored. Any previous calibration is kept.';
          resultHost.append(kept);
          announce('Calibration failed — see the reasons on screen.', 'assertive');
        }
        fireGuide('mag-fitted');
        memory.recordRun('calibrate');
      })();
    });

    currentDispose = () => {
      unsub();
      source.stop();
    };
    startGuideFor(CALIBRATE_GUIDES.mag);
    return wrap;
  };

  /* ---------------------------------------------------------------- */
  /* Routine: sensor locator (§4.1.3)                                  */
  /* ---------------------------------------------------------------- */

  const locatorView = (): HTMLElement => {
    const wrap = document.createElement('div');
    wrap.append(backBtn());
    const h = document.createElement('h2');
    h.className = 'display';
    h.textContent = ROUTINE_TITLES.locator;
    const how = document.createElement('p');
    how.textContent =
      'Hold a screw or paperclip against the glass on each of nine targets for a second and a half each. The routine fits the amplitude peak and marks where the sensor really sits.';
    wrap.append(h, how);

    const startB = document.createElement('button');
    startB.type = 'button';
    startB.className = 'btn calib-loc-start';
    startB.textContent = 'START 9-POINT GRID';
    const resultHost = document.createElement('div');
    resultHost.className = 'calib-loc-result';
    wrap.append(startB, resultHost);

    const source = new FieldMagSource();
    let stage: HTMLElement | null = null;
    let disposeRun: (() => void) | null = null;

    const runGrid = async (): Promise<void> => {
      try {
        await source.start();
      } catch (e) {
        noteError(e);
        resultHost.textContent = `The raw magnetometer would not start: ${source.lastError ?? 'unknown'}.`;
        return;
      }
      fireGuide('loc-started');
      stage = document.createElement('div');
      stage.className = 'calib-loc-stage';
      const target = document.createElement('div');
      target.className = 'calib-loc-target';
      target.setAttribute('data-active', 'true');
      const progress = document.createElement('p');
      progress.className = 'calib-hud';
      progress.style.position = 'absolute';
      progress.style.bottom = '96px';
      progress.style.left = '16px';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'btn btn--ghost';
      cancel.textContent = 'CANCEL';
      cancel.style.position = 'absolute';
      cancel.style.bottom = '24px';
      cancel.style.left = '16px';
      stage.append(target, progress, cancel);
      document.body.append(stage);

      const amplitudes: Array<{ x: number; y: number; amp: number }> = [];
      let window: number[] = [];
      let dwellStart = performance.now();
      let index = 0;

      const placeTarget = (): void => {
        const g = LOCATOR_GRID[index]!;
        target.style.left = `${g.x * 100}%`;
        target.style.top = `${g.y * 100}%`;
        progress.textContent = `Target ${index + 1} of 9 — hold the metal on the square.`;
        window = [];
        dwellStart = performance.now();
      };
      placeTarget();

      const unsub = source.subscribe((s) => {
        window.push(s.mag);
        const held = performance.now() - dwellStart;
        if (held >= LOCATOR_DWELL_MS && window.length >= 10) {
          const g = LOCATOR_GRID[index]!;
          amplitudes.push({ x: g.x, y: g.y, amp: windowAmplitude(window) });
          index++;
          if (index === 5) fireGuide('loc-halfway');
          if (index >= LOCATOR_GRID.length) {
            finish();
          } else {
            announce(`Target ${index + 1}`);
            placeTarget();
          }
        }
      });

      const teardown = (): void => {
        unsub();
        source.stop();
        stage?.remove();
        stage = null;
      };
      disposeRun = teardown;

      const finish = (): void => {
        teardown();
        const fitRes = fitPeak2D(amplitudes);
        resultHost.replaceChildren();
        if (!fitRes.ok) {
          resultHost.textContent = fitRes.reason;
          saveOutcome('locator', { at: Date.now(), pass: false, note: fitRes.reason });
          announce('Locator run failed — see the reason on screen.', 'assertive');
        } else {
          updateProfile({ sensorOffset: { x: fitRes.x, y: fitRes.y } });
          saveOutcome('locator', {
            at: Date.now(),
            pass: true,
            note: `sensor at ${(fitRes.x * 100).toFixed(0)}%, ${(fitRes.y * 100).toFixed(0)}% of screen`,
          });
          const p = document.createElement('p');
          p.textContent = `PASS — sensor located at ${(fitRes.x * 100).toFixed(0)}% across, ${(fitRes.y * 100).toFixed(0)}% down. SCAN draws its reticle there, not at screen center.`;
          const demoStage = document.createElement('div');
          demoStage.style.position = 'relative';
          demoStage.style.height = '160px';
          demoStage.style.border = '3px solid var(--rule, #D1D3D4)';
          const reticle = document.createElement('div');
          reticle.className = 'calib-reticle';
          reticle.style.left = `${fitRes.x * 100}%`;
          reticle.style.top = `${fitRes.y * 100}%`;
          reticle.setAttribute('aria-label', 'SENSOR position on the screen outline');
          demoStage.append(reticle);
          resultHost.append(p, demoStage);
          announce('Sensor located. The scan reticle moves to the true position.');
          fireGuide('loc-fitted');
        }
        memory.recordRun('calibrate');
      };

      cancel.addEventListener('click', teardown);
    };

    startB.addEventListener('click', () => void runGrid());

    currentDispose = () => {
      disposeRun?.();
      source.stop();
    };
    startGuideFor(CALIBRATE_GUIDES.locator);
    return wrap;
  };

  /* ---------------------------------------------------------------- */
  /* Routine: level reversal zero (§4.2.2)                             */
  /* ---------------------------------------------------------------- */

  const levelZeroView = (): HTMLElement => {
    const wrap = document.createElement('div');
    wrap.append(backBtn());
    const h = document.createElement('h2');
    h.className = 'display';
    h.textContent = ROUTINE_TITLES.levelZero;
    const how = document.createElement('p');
    how.textContent =
      'Two positions on the same spot: measure, rotate the phone 180° in place, measure again. The average is the sensor’s own bias; the difference is the true surface.';
    wrap.append(h, how);

    const stageP = document.createElement('p');
    stageP.className = 'calib-lz-stage calib-hud';
    stageP.setAttribute('role', 'status');
    stageP.textContent = 'Tap START, set the phone flat on a firm surface, and let go.';
    const resultHost = document.createElement('div');
    resultHost.className = 'calib-lz-result';

    const startB = document.createElement('button');
    startB.type = 'button';
    startB.className = 'btn calib-lz-start';
    startB.textContent = 'START';
    wrap.append(startB, stageP, resultHost);

    const imu = new DeviceMotionSource();
    const fusion = new OrientationFusion(imu);
    let capture = new StillnessCapture(1000);
    let phase: 'idle' | 'first' | 'rotate' | 'second' = 'idle';
    let m1: { pitchDeg: number; rollDeg: number; sd: { pitchDeg: number; rollDeg: number } } | null = null;
    let sawMotionSinceFirst = false;

    const writeStage = rafWriter<string>((s) => { stageP.textContent = s; });

    const unsub = fusion.subscribe((o) => {
      if (phase === 'idle') return;
      if (phase === 'rotate') {
        if (!o.stable) sawMotionSinceFirst = true;
        if (sawMotionSinceFirst && o.stable) {
          phase = 'second';
          capture = new StillnessCapture(1000);
        } else {
          writeStage('Rotate the phone 180° in place — same spot, nose swapped.');
          return;
        }
      }
      const st = capture.push(o);
      if (st.state === 'holding') {
        writeStage(`Hold still — ${(st.progress * 100).toFixed(0)}%`);
      } else if (st.state === 'waiting') {
        writeStage('Waiting for stillness. Let go of the phone.');
      } else if (st.state === 'done' && st.mean && st.sd) {
        if (phase === 'first') {
          m1 = { pitchDeg: st.mean.pitchDeg, rollDeg: st.mean.rollDeg, sd: st.sd };
          phase = 'rotate';
          sawMotionSinceFirst = false;
          fireGuide('lz-first-captured');
          announce('First position captured. Rotate the phone 180 degrees in place.');
          writeStage('Captured. Rotate the phone 180° in place — same spot, nose swapped.');
        } else if (phase === 'second' && m1) {
          phase = 'idle';
          imu.stop();
          fusion.stop();
          fireGuide('lz-second-captured');
          const m2 = { pitchDeg: st.mean.pitchDeg, rollDeg: st.mean.rollDeg };
          const rev = reversalFromCaptures(m1, m2);
          const sd = {
            pitchDeg: Math.hypot(m1.sd.pitchDeg, st.sd.pitchDeg) / 2,
            rollDeg: Math.hypot(m1.sd.rollDeg, st.sd.rollDeg) / 2,
          };
          const sane =
            Math.abs(rev.biasDeg.pitchDeg) < 5 &&
            Math.abs(rev.biasDeg.rollDeg) < 5 &&
            sd.pitchDeg < 0.3 &&
            sd.rollDeg < 0.3;
          resultHost.replaceChildren();
          const rowP = document.createElement('div');
          rowP.className = 'calib-row';
          rowP.append('pitch bias: ', derivedEl(rev.biasDeg.pitchDeg, '°', Math.max(0.02, sd.pitchDeg), 'stddev', { decimals: 2, signed: true }));
          const rowR = document.createElement('div');
          rowR.className = 'calib-row';
          rowR.append('roll bias: ', derivedEl(rev.biasDeg.rollDeg, '°', Math.max(0.02, sd.rollDeg), 'stddev', { decimals: 2, signed: true }));
          const surf = document.createElement('p');
          surf.textContent = `The surface itself reads ${rev.surfaceDeg.pitchDeg.toFixed(2)}° pitch / ${rev.surfaceDeg.rollDeg.toFixed(2)}° roll — that part belongs to the surface, not the sensor.`;
          resultHost.append(rowP, rowR, surf);
          if (sane) {
            // CalibrationProfile.levelBias is stored in DEGREES — the unit
            // contract fixed by A5 in src/tools/level/levelState.ts.
            updateProfile({
              levelBias: { pitch: rev.biasDeg.pitchDeg, roll: rev.biasDeg.rollDeg },
            });
            saveOutcome('levelZero', {
              at: Date.now(),
              pass: true,
              note: `bias ${rev.biasDeg.pitchDeg.toFixed(2)}°/${rev.biasDeg.rollDeg.toFixed(2)}°`,
            });
            const claim = document.createElement('p');
            claim.textContent =
              'PASS — stored. LEVEL now subtracts this bias and may claim ±0.15° instead of ±0.5° (the measured number lives in ACCURACY.md).';
            resultHost.append(claim);
            announce('Reversal zero stored. Level claims tighten.');
            fireGuide('lz-stored');
          } else {
            saveOutcome('levelZero', {
              at: Date.now(),
              pass: false,
              note: 'captures too noisy or bias implausible — nothing stored',
            });
            const bad = document.createElement('p');
            bad.textContent =
              'FAIL — the two captures disagree more than a firm surface allows. Nothing stored. Use a harder surface, keep hands off during the holds, and run it again.';
            resultHost.append(bad);
            announce('Reversal zero failed — nothing stored.', 'assertive');
          }
          writeStage('Done.');
          memory.recordRun('calibrate');
        }
      }
    });

    startB.addEventListener('click', () => {
      void (async () => {
        await requestMotionPermissions();
        try {
          await fusion.start();
        } catch (e) {
          noteError(e);
          stageP.textContent = 'Motion sensors would not start. Allow motion access and retry.';
          return;
        }
        capture = new StillnessCapture(1000);
        m1 = null;
        phase = 'first';
        announce('Set the phone flat and let go.');
      })();
    });

    currentDispose = () => {
      unsub();
      fusion.stop();
      imu.stop();
    };
    startGuideFor(CALIBRATE_GUIDES.levelZero);
    return wrap;
  };

  /* ---------------------------------------------------------------- */
  /* Routine: lens intrinsics (§4.3.2)                                 */
  /* ---------------------------------------------------------------- */

  const LENS_STEPS: readonly [MarkStep, MarkStep, MarkStep, MarkStep] = [
    { key: 'P0', label: 'CORNER A', prompt: 'Mark any corner of the sheet.' },
    { key: 'P1', label: 'LONG EDGE', prompt: 'Mark the next corner along the LONG edge.' },
    { key: 'P2', label: 'DIAGONAL', prompt: 'Mark the corner diagonal from the first.' },
    { key: 'P3', label: 'SHORT EDGE', prompt: 'Mark the last corner — along the short edge from the first.' },
  ];

  const lensView = (): HTMLElement => {
    const wrap = document.createElement('div');
    wrap.append(backBtn());
    const h = document.createElement('h2');
    h.className = 'display';
    h.textContent = ROUTINE_TITLES.lens;
    const how = document.createElement('p');
    how.textContent =
      'Photograph a flat sheet of paper at a moderate angle (about 30° — square-on carries no focal information), then mark its four corners with the loupe. The known aspect ratio pins the focal length.';
    wrap.append(h, how);

    let sheet: 'letter' | 'a4' = 'letter';
    const sheetRow = document.createElement('div');
    sheetRow.className = 'calib-row';
    const letterB = document.createElement('button');
    letterB.type = 'button';
    letterB.className = 'btn calib-sheet-letter';
    letterB.textContent = 'US LETTER';
    const a4B = document.createElement('button');
    a4B.type = 'button';
    a4B.className = 'btn btn--ghost calib-sheet-a4';
    a4B.textContent = 'A4';
    const syncSheet = (): void => {
      letterB.className = sheet === 'letter' ? 'btn calib-sheet-letter' : 'btn btn--ghost calib-sheet-letter';
      a4B.className = sheet === 'a4' ? 'btn calib-sheet-a4' : 'btn btn--ghost calib-sheet-a4';
      letterB.setAttribute('aria-pressed', String(sheet === 'letter'));
      a4B.setAttribute('aria-pressed', String(sheet === 'a4'));
    };
    letterB.addEventListener('click', () => { sheet = 'letter'; syncSheet(); });
    a4B.addEventListener('click', () => { sheet = 'a4'; syncSheet(); });
    syncSheet();
    sheetRow.append(letterB, a4B);
    wrap.append(sheetRow);

    const capHost = document.createElement('div');
    capHost.className = 'calib-lens-capture';
    const markHost = document.createElement('div');
    const resultHost = document.createElement('div');
    resultHost.className = 'calib-lens-result';
    wrap.append(capHost, markHost, resultHost);

    let marker: MarkerView | null = null;
    let cap: CaptureResult | null = null;

    const solveSheet = (): void => {
      if (!marker || !cap) return;
      const quad = marker.session.quad();
      if (!quad) return;
      const aspect = SHEET_ASPECT[sheet];
      const res = calibrateFromSheet(quad, aspect, cap.width, cap.height);
      const ev = evaluateLensResult(res);
      resultHost.replaceChildren();
      fireGuide('lens-solved');
      if (!res.ok) {
        showExplainerCard(resultHost, WARNING_EXPLAINERS.POOR_GEOMETRY);
        const p = document.createElement('p');
        p.textContent = res.message;
        resultHost.prepend(p);
        saveOutcome('lens', { at: Date.now(), pass: false, note: res.message });
        announce('Lens solve refused — see the card.', 'assertive');
        memory.recordRun('calibrate');
        return;
      }
      const pmF = lensFocalUncertainty(quad, aspect, cap.width, cap.height, { sigmaPx: 2, seed: 0x1e45 });
      const line = document.createElement('div');
      line.className = 'calib-row';
      line.append(
        'f = ',
        derivedEl(res.fPx, 'px', pmF ?? Math.max(10, res.fPx * 0.05), pmF ? 'montecarlo' : 'nominal', { decimals: 0 }),
        ` · residual ${res.squareResidualDeg.toFixed(2)}° (pass < ${LENS_RESIDUAL_MAX_DEG.toFixed(1)}°)`,
      );
      resultHost.append(line);
      if (!ev.pass) {
        for (const r of ev.reasons) {
          const p = document.createElement('p');
          p.textContent = r;
          resultHost.append(p);
        }
        const kept = document.createElement('p');
        kept.textContent = 'Nothing stored — a poor residual would poison every CORNER reading.';
        resultHost.append(kept);
        saveOutcome('lens', { at: Date.now(), pass: false, note: `residual ${res.squareResidualDeg.toFixed(2)}°` });
        announce('Lens residual too high — nothing stored.', 'assertive');
        memory.recordRun('calibrate');
        return;
      }
      const key = cap.cameraKey ?? 'cam:default';
      const profile = getProfile();
      updateProfile({
        lens: { ...(profile.lens ?? {}), [key]: { fPx: res.fPx, width: cap.width, height: cap.height } },
      });
      saveOutcome('lens', {
        at: Date.now(),
        pass: true,
        note: `f = ${Math.round(res.fPx)} px, residual ${res.squareResidualDeg.toFixed(2)}°`,
      });
      const ok = document.createElement('p');
      ok.textContent = `PASS — stored for this camera. CORNER now reads LENS: CALIBRATED (f = ${Math.round(res.fPx)} px) and claims ±0.3–0.8°.`;
      resultHost.append(ok);
      announce('Lens calibration stored.');
      memory.recordRun('calibrate');
    };

    const capUI = captureView({
      capability: ctx.capability,
      wantGravity: false,
      reason: 'The camera photographs the sheet only — the shot stays on this phone.',
      onCaptured: (c) => {
        cap = c;
        marker?.dispose();
        resultHost.replaceChildren();
        marker = markerView({
          photo: c.canvas,
          steps: LENS_STEPS,
          onChange: (session) => {
            if (session.complete) {
              fireGuide('lens-marked');
              solveSheet();
            } else {
              resultHost.replaceChildren();
            }
          },
          announce,
        });
        markHost.replaceChildren(marker.el);
        fireGuide('lens-captured');
      },
      announce,
    });
    capHost.append(capUI.el);

    currentDispose = () => {
      capUI.dispose();
      marker?.dispose();
    };
    startGuideFor(CALIBRATE_GUIDES.lens);
    return wrap;
  };

  /* ---------------------------------------------------------------- */
  /* Bottom bar + boot                                                 */
  /* ---------------------------------------------------------------- */

  const selfTestB = document.createElement('button');
  selfTestB.type = 'button';
  selfTestB.className = 'btn btn--ghost calib-open-selftest';
  selfTestB.textContent = 'SELF-TEST';
  selfTestB.addEventListener('click', () => show('selftest'));

  const guideB = document.createElement('button');
  guideB.type = 'button';
  guideB.className = 'btn btn--ghost calib-guide-me';
  guideB.textContent = 'GUIDE ME';
  guideB.addEventListener('click', () => {
    forceFullGuide = true;
    announce('Open a routine — its walkthrough runs on real sensor events.');
  });

  const resetB = document.createElement('button');
  resetB.type = 'button';
  resetB.className = 'btn btn--ghost calib-reset-guidance';
  resetB.textContent = 'RESET GUIDANCE';
  resetB.addEventListener('click', () => {
    memory.reset('calibrate');
    announce('Guidance reset — full walkthroughs on the next run.');
  });

  root.append(bottomBar(selfTestB, guideB, resetB));
  el.append(root);
  show('cards');
  void requestWakeLock();

  return () => {
    currentDispose?.();
    guide?.stop();
    dsp.dispose();
    void releaseWakeLock();
  };
}
