// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { activeCoachMark, coachMark, dismissCoachMark } from '../../src/ui/components/coach';

const css = readFileSync(resolve(process.cwd(), 'src/ui/base.css'), 'utf8');

function anchor(): HTMLElement {
  const el = document.createElement('button');
  document.body.append(el);
  return el;
}

afterEach(() => {
  dismissCoachMark();
  document.body.innerHTML = '';
});

describe('coachMark', () => {
  it('mounts anchored, focus-reachable, announced, and wired via aria-describedby', () => {
    const a = anchor();
    const mark = coachMark(a, 'Sweep slower — match the tick.');
    expect(mark.isConnected).toBe(true);
    expect(mark.getAttribute('role')).toBe('status');
    expect(mark.tabIndex).toBe(0);
    expect(a.getAttribute('aria-describedby')).toBe(mark.id);
    expect(activeCoachMark()).toBe(mark);
  });

  it('is a singleton: mounting a second dismisses the first (§7B.5)', () => {
    const a = anchor();
    const b = anchor();
    let firstDismissed = 0;
    const first = coachMark(a, 'First.', { onDismiss: () => firstDismissed++ });
    const second = coachMark(b, 'Second.');
    expect(first.isConnected).toBe(false);
    expect(firstDismissed).toBe(1);
    expect(second.isConnected).toBe(true);
    expect(activeCoachMark()).toBe(second);
    expect(a.hasAttribute('aria-describedby')).toBe(false);
  });

  it('dismisses on any tap, anywhere', () => {
    const a = anchor();
    const mark = coachMark(a, 'Tap anywhere to continue.');
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(mark.isConnected).toBe(false);
    expect(activeCoachMark()).toBeNull();
  });

  it('dismisses from the keyboard', () => {
    const a = anchor();
    const mark = coachMark(a, 'Press Escape.');
    mark.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(mark.isConnected).toBe(false);
  });

  it('restores a pre-existing aria-describedby instead of clobbering it', () => {
    const a = anchor();
    a.setAttribute('aria-describedby', 'existing-help');
    const mark = coachMark(a, 'Hold still for the capture.');
    expect(a.getAttribute('aria-describedby')).toBe(`existing-help ${mark.id}`);
    mark.dismiss();
    expect(a.getAttribute('aria-describedby')).toBe('existing-help');
  });

  it('fires onDismiss exactly once, however it is dismissed', () => {
    const a = anchor();
    let n = 0;
    const mark = coachMark(a, 'Once only.', { onDismiss: () => n++ });
    mark.dismiss();
    mark.dismiss();
    dismissCoachMark();
    expect(n).toBe(1);
  });

  it('dismissCoachMark() is safe with nothing showing', () => {
    expect(() => dismissCoachMark()).not.toThrow();
    expect(activeCoachMark()).toBeNull();
  });

  it('CSS: two lines maximum, instant appearance — no animation, no transition', () => {
    const rule = css.match(/\.coach\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rule).toContain('-webkit-line-clamp: 2');
    expect(rule).not.toContain('animation');
    expect(rule).not.toContain('transition');
  });
});
