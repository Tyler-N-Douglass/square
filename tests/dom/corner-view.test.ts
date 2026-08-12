// @vitest-environment happy-dom
/**
 * CORNER tool DOM honesty (SPEC §2.3.4, §4.3.3, §15):
 *  - the uncalibrated-lens banner + claim text state which mode is in effect;
 *  - a POOR_GEOMETRY refusal renders the explainer, never a number;
 *  - a successful solve renders the measured angle WITH its ± and states the
 *    lens mode; a wide interval raises the poor-geometry guidance card.
 * Solver outputs come from the REAL solver on synthetic projections — no
 * physics is mocked.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { AppContext } from '../../src/app/router';
import type { CapabilityReport } from '../../src/sensors/types';
import { monteCarloCornerAngle } from '../../src/geometry/montecarlo';
import { mount, renderRefusal, renderSolve } from '../../src/tools/corner/index';
import { workedExample } from '../../src/tools/corner/worked';

const capability: CapabilityReport = {
  magTier: 'NONE',
  hasAccel: true,
  hasGyro: true,
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

const ctx: AppContext = { capability, replayTrace: null };

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
});

describe('mount — lens state is stated up front', () => {
  it('shows the LENS_UNCALIBRATED banner and the ±1.5–3° claim with no stored lens', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const unmount = mount(host, ctx);
    const lensLine = host.querySelector('.corner-lens');
    expect(lensLine?.textContent).toContain('NOT CALIBRATED');
    expect(lensLine?.textContent).toContain('±1.5–3°');
    const banner = host.querySelector('[data-warning-key="LENS_UNCALIBRATED"]');
    expect(banner).toBeTruthy();
    expect(banner?.textContent).toContain('Lens not calibrated');
    unmount();
  });

  it('offers the file-photo path even with no camera — never a dead end', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const unmount = mount(host, ctx);
    const fileInput = host.querySelector<HTMLInputElement>('input[type="file"]');
    expect(fileInput).toBeTruthy();
    expect(fileInput?.accept).toBe('image/*');
    expect(host.textContent).toContain('runs from any photo');
    unmount();
  });
});

describe('renderRefusal — a refusal is an explainer, not a number', () => {
  it('renders the POOR_GEOMETRY explainer card and no measured value', () => {
    const host = document.createElement('div');
    document.body.append(host);
    renderRefusal(host, 'marked corners are nearly collinear — no usable second dimension');
    expect(host.querySelector('.num--measured')).toBeNull();
    expect(host.querySelector('.num__value')).toBeNull();
    const card = host.querySelector('.explaincard');
    expect(card?.textContent).toContain('POOR GEOMETRY');
    expect(card?.textContent).toContain('What to do');
    expect(host.querySelector('[data-warning-key="POOR_GEOMETRY"]')).toBeTruthy();
    expect(host.textContent).toContain('nearly collinear');
  });
});

describe('renderSolve — the measured number always carries its ± and lens state', () => {
  const ex = workedExample(88.6);
  const mc = monteCarloCornerAngle(ex.quad, ex.k, { sigmaPx: 2, samples: 300, seed: 0x5eed });
  if (!mc.ok) throw new Error('worked example must solve');

  it('calibrated path: orange measured value, ±, and the CALIBRATED claim', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const m = renderSolve(
      host,
      {
        quad: ex.quad,
        k: ex.k,
        imageW: ex.imageW,
        imageH: ex.imageH,
        mc,
        lens: { k: ex.k, calibrated: true, label: 'LENS: CALIBRATED (f = 1100 px)' },
        spreadDeg: null,
        gravity: null,
        source: 'camera',
      },
      { tier: 'NONE' },
    );
    expect(m.kind).toBe('corner');
    expect(m.uncertainty.basis).toBe('montecarlo');
    const reading = host.querySelector('.num--measured');
    expect(reading?.textContent).toContain('°');
    expect(reading?.textContent).toContain('±');
    expect(host.querySelector('.corner-lens')?.textContent).toContain('CALIBRATED');
    expect(host.querySelector('[data-warning-key="LENS_UNCALIBRATED"]')).toBeNull();
    // Deviation from 90° rides along as a derived value.
    expect(host.querySelector('.num--derived')).toBeTruthy();
    // Confidence badge is always shown for corner readings.
    expect(host.querySelector('.conf')).toBeTruthy();
  });

  it('uncalibrated path: claim text says which mode is in effect and widens the ±', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const m = renderSolve(
      host,
      {
        quad: ex.quad,
        k: ex.k,
        imageW: ex.imageW,
        imageH: ex.imageH,
        mc,
        lens: { k: ex.k, calibrated: false, label: 'LENS: ESTIMATED (f ≈ 1100 px, 67° FOV assumed) — not calibrated' },
        spreadDeg: 1.2,
        gravity: null,
        source: 'file',
      },
      { tier: 'NONE' },
    );
    expect(host.querySelector('.corner-lens')?.textContent).toContain('not calibrated');
    expect(host.querySelector('[data-warning-key="LENS_UNCALIBRATED"]')).toBeTruthy();
    // ± is the MC width ⊕ focal spread — strictly wider than MC alone.
    expect(m.uncertainty.plusMinus).toBeCloseTo(Math.hypot(mc.halfWidthDeg, 1.2), 6);
    // File uploads say plainly that the plumb reference needs a live shot.
    expect(host.textContent).toContain('no gravity at shutter');
  });

  it('an interval past ±2.5° raises the poor-geometry guidance card (§4.3.3)', () => {
    const host = document.createElement('div');
    document.body.append(host);
    renderSolve(
      host,
      {
        quad: ex.quad,
        k: ex.k,
        imageW: ex.imageW,
        imageH: ex.imageH,
        mc,
        lens: { k: ex.k, calibrated: false, label: 'LENS: ESTIMATED — not calibrated' },
        spreadDeg: 3.0, // genuinely focal-degenerate view → combined > 2.5°
        gravity: null,
        source: 'file',
      },
      { tier: 'NONE' },
    );
    expect(host.querySelector('[data-warning-key="POOR_GEOMETRY"]')).toBeTruthy();
    const conf = host.querySelector('.conf');
    expect(conf?.textContent).toBe('POSSIBLE');
  });

  it('demo source is labeled a synthetic worked example and offers no save', () => {
    const host = document.createElement('div');
    document.body.append(host);
    renderSolve(
      host,
      {
        quad: ex.quad,
        k: ex.k,
        imageW: ex.imageW,
        imageH: ex.imageH,
        mc,
        lens: { k: ex.k, calibrated: true, label: 'LENS: KNOWN (synthetic camera, f = 1100 px)' },
        spreadDeg: null,
        gravity: null,
        source: 'demo',
        truthDeg: 88.6,
      },
      { tier: 'NONE', onSave: () => undefined },
    );
    expect(host.querySelector('.corner__synthetic')?.textContent).toContain('SYNTHETIC');
    expect(host.textContent).toContain('88.6');
    expect(host.querySelector('.corner-save')).toBeNull();
  });
});
