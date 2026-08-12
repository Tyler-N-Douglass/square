/**
 * SELF-TEST screen — SPEC §4.6: live capability report, live measured sample
 * rates (started only while visible), permission states, calibration
 * summary, a COPY DIAGNOSTICS button (JSON blob to the clipboard), and
 * trace recording via sensors/record.TraceRecorder with anchor marks and an
 * a[download] JSON export — this is how field sessions produce fixtures
 * (docs/FIELD-TEST.md depends on it).
 */
import type { CapabilityReport, MagSample, SensorSource } from '../../sensors/types';
import { probeCapabilities } from '../../sensors/capability';
import { DeviceMotionSource } from '../../sensors/imu';
import { FieldMagSource } from '../../sensors/magnetometer';
import { HeadingProxySource } from '../../sensors/headingProxy';
import { TraceRecorder } from '../../sensors/record';
import { getProfile, calibrationAgeMs } from '../../app/calibrationStore';
import { announce } from '../../app/shell';
import { rafWriter } from '../../app/store';
import { downloadBlob } from '../corner/annotate';
import {
  buildDiagnostics,
  formatAge,
  loadOutcomes,
  RateCounter,
  ROUTINE_PROFILE_PART,
  ROUTINE_TITLES,
  type RoutineId,
} from './logic';

let lastError: string | null = null;

/** Record the most recent error for the diagnostics blob. */
export function noteError(e: unknown): void {
  lastError = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

async function queryPermission(name: string): Promise<string> {
  try {
    const status = await navigator.permissions.query({ name: name as PermissionName });
    return status.state;
  } catch {
    return 'unsupported';
  }
}

export interface SelfTestHandle {
  el: HTMLElement;
  dispose(): void;
}

export function selfTestView(cap: CapabilityReport): SelfTestHandle {
  const el = document.createElement('section');
  el.className = 'calib-selftest';

  const h = document.createElement('h2');
  h.className = 'display';
  h.textContent = 'SELF-TEST';
  el.append(h);

  /* ---- capability report (re-probed live at mount) ---- */
  const capList = document.createElement('dl');
  capList.className = 'calib-selftest__cap';
  const capRow = (label: string, value: string): void => {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    capList.append(dt, dd);
  };
  const fillCap = (c: CapabilityReport): void => {
    capList.replaceChildren();
    capRow('Magnetometer tier', c.magTier);
    capRow('Cameras', c.hasCamera ? String(c.cameraCount) : 'none');
    capRow('Accelerometer / gyro', c.hasAccel ? 'present' : 'absent');
    capRow('Absolute orientation', c.hasAbsoluteOrientation ? 'present' : 'absent');
    capRow('Vibration', c.hasVibrate ? 'present' : 'absent (audio is the non-visual channel)');
    capRow('Wake lock', c.hasWakeLock ? 'present' : 'absent');
    capRow('Secure context', c.secureContext ? 'yes' : 'NO — sensors blocked');
    capRow('Permissions-Policy', c.permissionsPolicyOk ? 'ok' : 'BLOCKED — deployment bug');
    capRow('Platform', c.platformHint);
    for (const b of c.blockers) capRow(`Blocker: ${b.code}`, `${b.message} ${b.remedy}`);
  };
  fillCap(cap);
  el.append(capList);
  void probeCapabilities().then(fillCap).catch(noteError);

  /* ---- live rates ---- */
  const ratesH = document.createElement('h3');
  ratesH.textContent = 'LIVE SAMPLE RATES — measured, not assumed';
  const ratesRow = document.createElement('div');
  ratesRow.className = 'calib-selftest__rates';
  const motionOut = document.createElement('span');
  motionOut.className = 'measured hud';
  motionOut.textContent = 'MOTION — off';
  const magOut = document.createElement('span');
  magOut.className = 'measured hud';
  magOut.textContent = cap.magTier === 'NONE' ? 'MAG — no path on this device' : 'MAG — off';
  ratesRow.append(motionOut, magOut);
  el.append(ratesH, ratesRow);

  const motionRate = new RateCounter();
  const magRate = new RateCounter();
  const writeMotion = rafWriter<string>((s) => { motionOut.textContent = s; });
  const writeMag = rafWriter<string>((s) => { magOut.textContent = s; });

  const imu = new DeviceMotionSource();
  let magSource: (SensorSource<MagSample> & { lastError?: string | null }) | null = null;
  if (cap.magTier === 'FIELD') magSource = new FieldMagSource();
  else if (cap.magTier === 'PROXY') magSource = new HeadingProxySource(imu);

  let recorder: TraceRecorder | null = null;
  let recorderCount = 0;

  const unsubImu = imu.subscribe((s) => {
    motionRate.push(s.t);
    writeMotion(`MOTION — ${motionRate.hz(s.t).toFixed(1)} Hz · ${imu.health}`);
  });
  const unsubMag = magSource?.subscribe((s) => {
    magRate.push(s.t);
    writeMag(`MAG — ${magRate.hz(s.t).toFixed(1)} Hz · ${magSource?.health ?? 'dead'}`);
    if (recorder?.recording) {
      recorder.push(s);
      recorderCount++;
    }
  });

  let running = false;
  let wanted = false;
  const startSources = async (): Promise<void> => {
    wanted = true;
    if (running) return;
    running = true;
    try {
      await imu.start();
    } catch (e) {
      noteError(e);
      motionOut.textContent = 'MOTION — failed to start (permission?)';
    }
    if (magSource) {
      try {
        await magSource.start();
      } catch (e) {
        noteError(e);
        magOut.textContent = `MAG — failed to start (${magSource.lastError ?? 'see blockers'})`;
      }
    }
  };
  const stopSources = (): void => {
    if (!running) return;
    running = false;
    imu.stop();
    magSource?.stop();
  };

  const wakeBtn = document.createElement('button');
  wakeBtn.type = 'button';
  wakeBtn.className = 'btn calib-selftest-wake';
  wakeBtn.textContent = 'WAKE SENSORS';
  wakeBtn.addEventListener('click', () => void startSources());
  ratesRow.append(wakeBtn);

  const onVisibility = (): void => {
    // Stop while hidden (battery, SPEC §9); resume when the tab returns —
    // the permission grant persists, only requestPermission needs a gesture.
    if (document.visibilityState === 'hidden') stopSources();
    else if (wanted) void startSources();
  };
  document.addEventListener('visibilitychange', onVisibility);

  /* ---- permission states ---- */
  const permH = document.createElement('h3');
  permH.textContent = 'PERMISSIONS';
  const permList = document.createElement('dl');
  permList.className = 'calib-selftest__perm';
  el.append(permH, permList);
  const permissions: Record<string, string> = {};
  const fillPerms = async (): Promise<void> => {
    permissions['camera'] = await queryPermission('camera');
    permissions['magnetometer'] = await queryPermission('magnetometer');
    permissions['motion'] =
      motionRate.hz() > 0 ? 'granted (events flowing)' : 'unknown until sensors wake — tap WAKE SENSORS';
    permList.replaceChildren();
    for (const [k, v] of Object.entries(permissions)) {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      permList.append(dt, dd);
    }
  };
  void fillPerms();

  /* ---- calibration summary ---- */
  const calH = document.createElement('h3');
  calH.textContent = 'CALIBRATION';
  const calList = document.createElement('dl');
  calList.className = 'calib-selftest__cal';
  const outcomes = loadOutcomes();
  const profile = getProfile();
  for (const id of ['mag', 'locator', 'levelZero', 'lens'] as RoutineId[]) {
    const dt = document.createElement('dt');
    dt.textContent = ROUTINE_TITLES[id];
    const dd = document.createElement('dd');
    const age = calibrationAgeMs(profile, ROUTINE_PROFILE_PART[id]);
    const outcome = outcomes[id];
    dd.textContent = outcome
      ? `${outcome.pass ? 'PASS' : 'FAIL'} · ${formatAge(Date.now() - outcome.at)} — ${outcome.note}`
      : age === null
        ? 'never run'
        : `stored · ${formatAge(age)}`;
    calList.append(dt, dd);
  }
  el.append(calH, calList);

  /* ---- copy diagnostics ---- */
  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'btn calib-copy-diagnostics';
  copyBtn.textContent = 'COPY DIAGNOSTICS';
  copyBtn.setAttribute('aria-label', 'Copy the diagnostics JSON blob to the clipboard');
  copyBtn.addEventListener('click', () => {
    const blob = buildDiagnostics({
      capability: cap,
      profile: getProfile(),
      outcomes: loadOutcomes(),
      rates: {
        motionHz: motionRate.hz() || null,
        magHz: magRate.hz() || null,
      },
      permissions,
      lastError,
    });
    const json = JSON.stringify(blob, null, 1);
    const done = (): void => announce('Diagnostics copied to the clipboard');
    try {
      void navigator.clipboard.writeText(json).then(done, () => fallbackCopy(json, done));
    } catch {
      fallbackCopy(json, done);
    }
  });
  el.append(copyBtn);

  /* ---- trace recording (field fixtures — FIELD-TEST.md) ---- */
  const recH = document.createElement('h3');
  recH.textContent = 'TRACE RECORDING';
  const recWrap = document.createElement('div');
  recWrap.className = 'calib-selftest__trace';
  el.append(recH, recWrap);

  if (!magSource) {
    recWrap.textContent =
      'No magnetometer path on this device — nothing to record. Traces come from FIELD or PROXY phones.';
  } else {
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    status.textContent = 'Idle. Wake the sensors, then start a trace and sweep.';

    const startBtn = document.createElement('button');
    startBtn.type = 'button';
    startBtn.className = 'btn calib-trace-start';
    startBtn.textContent = 'START TRACE';

    const anchorInput = document.createElement('input');
    anchorInput.className = 'corner__input';
    anchorInput.placeholder = 'anchor position, inches';
    anchorInput.setAttribute('aria-label', 'Anchor position along the sweep, inches');
    const anchorBtn = document.createElement('button');
    anchorBtn.type = 'button';
    anchorBtn.className = 'btn btn--ghost calib-trace-anchor';
    anchorBtn.textContent = 'MARK ANCHOR';

    const stopBtn = document.createElement('button');
    stopBtn.type = 'button';
    stopBtn.className = 'btn calib-trace-stop';
    stopBtn.textContent = 'STOP + DOWNLOAD JSON';

    startBtn.addEventListener('click', () => {
      recorder = new TraceRecorder(cap.magTier, cap.platformHint, magSource?.nominalHz ?? 0);
      recorder.startRecording();
      recorderCount = 0;
      status.textContent = 'Recording. Sweep, mark anchors at known positions, then stop.';
      announce('Trace recording started');
      void startSources();
    });
    anchorBtn.addEventListener('click', () => {
      const inches = Number.parseFloat(anchorInput.value);
      if (!recorder?.recording || !Number.isFinite(inches)) {
        status.textContent = 'Enter the anchor position in inches first, with a trace running.';
        return;
      }
      recorder.markAnchor(inches);
      announce(`Anchor at ${inches} inches`);
    });
    stopBtn.addEventListener('click', () => {
      if (!recorder?.recording) {
        status.textContent = 'No trace running.';
        return;
      }
      const trace = recorder.finish(
        `field-${Date.now().toString(36)}`,
        'SELF-TEST field recording — expected block is a stub until ground-truthed with a tape measure.',
      );
      recorder = null;
      const json = TraceRecorder.toJson(trace);
      downloadBlob(new Blob([json], { type: 'application/json' }), `${trace.id}.json`);
      status.textContent = `Saved ${trace.samples.length} samples (${recorderCount} seen live). Drop the file into tests/fixtures/real/ after ground-truthing.`;
      announce('Trace downloaded');
    });

    recWrap.append(status, startBtn, anchorInput, anchorBtn, stopBtn);
  }

  return {
    el,
    dispose: () => {
      document.removeEventListener('visibilitychange', onVisibility);
      unsubImu();
      unsubMag?.();
      stopSources();
    },
  };
}

function fallbackCopy(text: string, done: () => void): void {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.append(ta);
  ta.select();
  try {
    document.execCommand('copy');
    done();
  } catch {
    announce('Clipboard unavailable — long-press the text to copy it.', 'assertive');
  }
  ta.remove();
}
