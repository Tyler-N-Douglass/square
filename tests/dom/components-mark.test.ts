// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MARK_SVG, ghostBob, loadingMark } from '../../src/ui/components/mark';

const icon = readFileSync(resolve(process.cwd(), 'public/icons/app-icon-square.svg'), 'utf8');
const css = readFileSync(resolve(process.cwd(), 'src/ui/base.css'), 'utf8');

describe('the mark (SPEC §7.5)', () => {
  it('inlined template carries the shipped icon geometry exactly — no drift', () => {
    // every path in the shipped icon appears verbatim in the template
    for (const d of icon.match(/d="[^"]+"/g) ?? []) {
      expect(MARK_SVG).toContain(d);
    }
    // every rect (background, graduations, bob stem) appears verbatim
    const rects = icon.match(/<rect [^/>]+/g) ?? [];
    expect(rects.length).toBeGreaterThan(10);
    for (const r of rects) {
      expect(MARK_SVG).toContain(r);
    }
    // same palette, nothing new
    for (const hex of ['#2E2E2E', '#F1F2F2', '#F15A22']) {
      expect(MARK_SVG).toContain(hex);
    }
  });

  it('loadingMark wraps the SVG with the bob grouped for the drop', () => {
    const el = loadingMark();
    expect(el.classList.contains('mark--loading')).toBe(true);
    expect(el.querySelector('svg')).toBeTruthy();
    const bob = el.querySelector('.mark__bob');
    expect(bob).toBeTruthy();
    // the bob group holds exactly the two orange elements: stem + bob
    expect(bob?.querySelectorAll('rect').length).toBe(1);
    expect(bob?.querySelectorAll('path').length).toBe(1);
  });

  it('CSS: the bob drops once, 400 ms, transform-only, ending settled', () => {
    const rule = css.match(/\.mark--loading \.mark__bob\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rule).toContain('400ms');
    expect(rule).toMatch(/animation:.*mark-drop/);
    const frames = css.match(/@keyframes mark-drop\s*\{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(frames).toContain('transform');
    expect(frames).toContain('translateY(0)'); // settled end state for reduced motion
  });

  it('ghostBob is the bob alone: hidden from AT, currentColor, never orange', () => {
    const el = ghostBob();
    expect(el.classList.contains('ghostbob')).toBe(true);
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.innerHTML).toContain('currentColor');
    expect(el.innerHTML).not.toContain('#F15A22');
    expect(el.innerHTML).not.toContain('#2E2E2E');
    // same bob geometry as the mark
    expect(el.innerHTML).toContain('M256 340 L300 402 L256 486 L212 402 Z');
  });

  it('CSS: ghost sits at 15% opacity and never intercepts a tap', () => {
    const rule = css.match(/\.ghostbob\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rule).toContain('opacity: 0.15');
    expect(rule).toContain('pointer-events: none');
  });
});
