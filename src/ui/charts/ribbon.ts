/**
 * THE FIELD RIBBON — the signature visual (SPEC §4.1.8, §7).
 *
 * A strip chart scrolling right-to-left: the detrended signal as a single
 * hard line, the noise floor as a flat band (no gradients, no glows —
 * Draplin), detected fastener events pinned as vertical orange ember lines
 * (they are live measured events; orange is the live-value color and nothing
 * else wears it), ghost events from a previous pass in gray, the predicted
 * stud lattice as DASHED gray lines (derived, never orange — ADR/§5), and
 * the sensor "you are here" line at the right edge.
 *
 * Axis honesty (ADR-006): TIME mode until a span is declared, then INCHES.
 * The mode is explicit; the caller labels the axis in the DOM caption.
 *
 * Performance (SPEC §9, 60 fps):
 *  - draw runs on requestAnimationFrame from a typed-array ring buffer
 *    (ribbonMath.RingBuffer); the loop addresses samples by index and
 *    allocates nothing per frame — tick labels are precomputed per mode.
 *  - devicePixelRatio-aware: the backing store is resized to DPR and the
 *    context transform set once per resize, not per frame.
 *  - OffscreenCanvas where available (capability.hasOffscreenCanvas): the
 *    frame is rastered into an OffscreenCanvas back buffer and blitted in
 *    one drawImage. A full worker-side renderer is not warranted at
 *    ≤ ~2k points/frame — the win here is a single main-canvas write per
 *    frame. Plain 2D fallback draws direct.
 *
 * Reduced motion: the ribbon still scrolls — it is data, not decoration
 * (charter). Nothing else in this chart animates at all.
 */
import type { TraceAnchor } from '../../types';
import { timeToDistanceIn } from '../../sensors/replay';
import {
  RingBuffer,
  computeHalfRange,
  easeScale,
  firstTickAtOrAbove,
  xForDistance,
  xForTime,
  yForValue,
} from './ribbonMath';

export interface RibbonEvent {
  /** Sample-stream time of the event (same time base as push()). */
  t: number;
  /** Position in inches, NaN until a span is declared. */
  positionIn: number;
}

export interface LatticeLine {
  positionIn: number;
  /** True for lines beyond the swept span — predictions, not observations. */
  extrapolated: boolean;
}

export type RibbonMode =
  | { kind: 'time'; windowS: number }
  | { kind: 'distance'; anchors: TraceAnchor[] };

export interface Ribbon {
  push(t: number, value: number, sigma: number): void;
  setEvents(events: readonly RibbonEvent[]): void;
  setGhosts(positionsIn: readonly number[]): void;
  setLattice(lines: readonly LatticeLine[]): void;
  setMode(mode: RibbonMode): void;
  /** Physical floor for the y half-range (µT on FIELD, ° on PROXY). */
  setFloor(floor: number): void;
  clear(): void;
  start(): void;
  stop(): void;
  /** One draw without the rAF loop — refresh a stopped (idle) chart. */
  renderOnce(): void;
}

interface Colors {
  live: string;
  band: string;
  ghost: string;
  derived: string;
  now: string;
  tick: string;
}

const DASH: number[] = [6, 6];
const SOLID: number[] = [];

function readColors(): Colors {
  let cs: CSSStyleDeclaration | null = null;
  try {
    cs = getComputedStyle(document.documentElement);
  } catch {
    /* headless */
  }
  const val = (name: string, fallback: string): string => {
    const v = cs?.getPropertyValue(name).trim();
    return v ? v : fallback;
  };
  return {
    live: val('--orange', '#F15A22'),
    band: val('--rule', '#D1D3D4'),
    ghost: val('--gray-mid', '#939598'),
    derived: val('--gray-mid', '#939598'),
    now: val('--type', '#1A1A1A'),
    tick: val('--rule', '#D1D3D4'),
  };
}

export function createRibbon(
  canvas: HTMLCanvasElement,
  opts: { useOffscreen: boolean; floor: number; windowS?: number; capacity?: number },
): Ribbon {
  const buf = new RingBuffer(opts.capacity ?? 4096);
  let mode: RibbonMode = { kind: 'time', windowS: opts.windowS ?? 12 };
  let floor = opts.floor;
  let events: readonly RibbonEvent[] = [];
  let ghosts: readonly number[] = [];
  let lattice: readonly LatticeLine[] = [];
  let halfRange = floor;
  let running = false;
  let raf = 0;

  let colors = readColors();
  let themeObserver: MutationObserver | null = null;
  const observeTheme = (): void => {
    if (themeObserver) return;
    try {
      themeObserver = new MutationObserver(() => {
        colors = readColors();
      });
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    } catch {
      themeObserver = null; /* headless */
    }
  };
  observeTheme();

  // Precomputed tick labels/positions — rebuilt only when the mode changes,
  // never in the draw loop.
  let tickLabels: string[] = [];
  let tickValues: number[] = [];
  const rebuildTicks = (): void => {
    tickLabels = [];
    tickValues = [];
    if (mode.kind === 'time') {
      // Ticks at fixed offsets behind the right ("now") edge.
      for (let off = 2; off < mode.windowS; off += 2) {
        tickValues.push(off);
        tickLabels.push(`${off}s`);
      }
    } else {
      const a = mode.anchors;
      if (a.length >= 2) {
        const dMin = Math.min(a[0]!.in, a[a.length - 1]!.in);
        const dMax = Math.max(a[0]!.in, a[a.length - 1]!.in);
        for (let d = firstTickAtOrAbove(dMin, 4); d <= dMax; d += 4) {
          tickValues.push(d);
          tickLabels.push(`${d}″`);
        }
      }
    }
  };
  rebuildTicks();

  // --- canvas plumbing ------------------------------------------------------
  let mainCtx: CanvasRenderingContext2D | null = null;
  try {
    mainCtx = canvas.getContext('2d');
  } catch {
    mainCtx = null;
  }
  let back: OffscreenCanvas | null = null;
  let backCtx: OffscreenCanvasRenderingContext2D | null = null;
  let cssW = 0;
  let cssH = 0;
  let dpr = 1;

  const resizeIfNeeded = (): void => {
    const w = canvas.clientWidth || 320;
    const h = canvas.clientHeight || 160;
    const ratio = (typeof devicePixelRatio === 'number' && devicePixelRatio > 0) ? devicePixelRatio : 1;
    if (w === cssW && h === cssH && ratio === dpr) return;
    cssW = w;
    cssH = h;
    dpr = ratio;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    if (opts.useOffscreen && typeof OffscreenCanvas === 'function') {
      try {
        back = new OffscreenCanvas(canvas.width, canvas.height);
        backCtx = back.getContext('2d');
      } catch {
        back = null;
        backCtx = null;
      }
    }
    mainCtx?.setTransform(1, 0, 0, 1, 0, 0);
  };

  const xOf = (t: number, positionIn: number, tRight: number, dMin: number, dMax: number): number => {
    if (mode.kind === 'time') return xForTime(t, tRight, mode.windowS, cssW);
    return xForDistance(positionIn, dMin, dMax, cssW);
  };

  const draw = (): void => {
    resizeIfNeeded();
    const target = (backCtx ?? mainCtx) as CanvasRenderingContext2D | null;
    if (!target) return; // headless test environment — API stays usable
    const ctx = target;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const n = buf.size;
    const tRight = buf.latestT() ?? 0;
    let dMin = 0;
    let dMax = 1;
    let i0 = 0;
    if (mode.kind === 'time') {
      i0 = buf.firstIndexAtOrAfter(tRight - mode.windowS);
    } else {
      const a = mode.anchors;
      if (a.length >= 2) {
        dMin = Math.min(a[0]!.in, a[a.length - 1]!.in);
        dMax = Math.max(a[0]!.in, a[a.length - 1]!.in);
      }
    }

    // Pass 1 — scale (no allocation; two loops beat one array build).
    let maxAbs = 0;
    let sigmaMax = 0;
    for (let i = i0; i < n; i++) {
      const av = Math.abs(buf.vAt(i));
      if (av > maxAbs) maxAbs = av;
      const s = buf.sAt(i);
      if (s > sigmaMax) sigmaMax = s;
    }
    halfRange = easeScale(halfRange, computeHalfRange(maxAbs, sigmaMax, floor));

    const sampleX = (i: number): number =>
      mode.kind === 'time'
        ? xForTime(buf.tAt(i), tRight, mode.windowS, cssW)
        : xForDistance(timeToDistanceIn(mode.anchors, buf.tAt(i)), dMin, dMax, cssW);

    // Ticks — 1px flat lines, labels precomputed.
    ctx.strokeStyle = colors.tick;
    ctx.fillStyle = colors.ghost;
    ctx.lineWidth = 1;
    ctx.font = '10px system-ui, sans-serif';
    ctx.setLineDash(SOLID);
    for (let k = 0; k < tickValues.length; k++) {
      const tv = tickValues[k]!;
      const x = mode.kind === 'time'
        ? xForTime(tRight - tv, tRight, mode.windowS, cssW)
        : xForDistance(tv, dMin, dMax, cssW);
      if (x < 0 || x > cssW) continue;
      ctx.beginPath();
      ctx.moveTo(x, cssH - 12);
      ctx.lineTo(x, cssH);
      ctx.stroke();
      ctx.fillText(tickLabels[k]!, x + 2, cssH - 2);
    }

    // Noise band — one flat fill: +σ edge left→right, −σ edge back.
    if (n - i0 >= 2) {
      ctx.fillStyle = colors.band;
      ctx.beginPath();
      for (let i = i0; i < n; i++) {
        const x = sampleX(i);
        const y = yForValue(buf.sAt(i), halfRange, cssH);
        if (i === i0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      for (let i = n - 1; i >= i0; i--) {
        ctx.lineTo(sampleX(i), yForValue(-buf.sAt(i), halfRange, cssH));
      }
      ctx.closePath();
      ctx.fill();
    }

    // Lattice — derived, dashed, never orange. Distance mode only (a lattice
    // line has no honest x before a span exists).
    if (mode.kind === 'distance' && lattice.length > 0) {
      ctx.setLineDash(DASH);
      ctx.strokeStyle = colors.derived;
      for (const line of lattice) {
        const x = xForDistance(line.positionIn, dMin, dMax, cssW);
        ctx.lineWidth = line.extrapolated ? 2 : 3;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, cssH);
        ctx.stroke();
      }
      ctx.setLineDash(SOLID);
    }

    // Ghost events from the previous pass (vertical confirm overlay).
    if (mode.kind === 'distance' && ghosts.length > 0) {
      ctx.strokeStyle = colors.ghost;
      ctx.lineWidth = 3;
      for (const g of ghosts) {
        const x = xForDistance(g, dMin, dMax, cssW);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, cssH);
        ctx.stroke();
      }
    }

    // The signal line.
    if (n - i0 >= 2) {
      ctx.strokeStyle = colors.live;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = i0; i < n; i++) {
        const x = sampleX(i);
        const y = yForValue(buf.vAt(i), halfRange, cssH);
        if (i === i0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Detected events — vertical orange ember lines (live measured events).
    ctx.strokeStyle = colors.live;
    ctx.lineWidth = 3;
    for (const ev of events) {
      const x = xOf(ev.t, ev.positionIn, tRight, dMin, dMax);
      if (x < 0 || x > cssW) continue;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, cssH);
      ctx.stroke();
    }

    // The sensor "you are here" line — right edge in time mode.
    if (mode.kind === 'time') {
      ctx.strokeStyle = colors.now;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cssW - 1.5, 0);
      ctx.lineTo(cssW - 1.5, cssH);
      ctx.stroke();
    }

    // Blit the back buffer in one write when the OffscreenCanvas path is on.
    if (backCtx && back && mainCtx) {
      mainCtx.setTransform(1, 0, 0, 1, 0, 0);
      mainCtx.clearRect(0, 0, canvas.width, canvas.height);
      mainCtx.drawImage(back, 0, 0);
    }
  };

  const loop = (): void => {
    if (!running) return;
    draw();
    raf = requestAnimationFrame(loop);
  };

  return {
    push(t, value, sigma) {
      buf.push(t, value, sigma);
    },
    setEvents(e) {
      events = e;
    },
    setGhosts(g) {
      ghosts = g;
    },
    setLattice(l) {
      lattice = l;
    },
    setMode(m) {
      mode = m;
      rebuildTicks();
    },
    setFloor(f) {
      floor = f;
    },
    clear() {
      buf.clear();
      events = [];
      ghosts = [];
      lattice = [];
    },
    start() {
      if (running) return;
      running = true;
      observeTheme();
      if (typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(loop);
    },
    stop() {
      running = false;
      if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
      raf = 0;
      themeObserver?.disconnect();
      themeObserver = null;
    },
    renderOnce() {
      draw();
    },
  };
}
