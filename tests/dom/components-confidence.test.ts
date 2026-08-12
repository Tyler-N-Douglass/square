// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { confidenceBadge } from '../../src/ui/components/confidence';
import type { Confidence } from '../../src/types';

const STATES: Confidence[] = ['STRONG', 'LIKELY', 'POSSIBLE', 'NOISE', 'UNRELIABLE'];
const css = readFileSync(resolve(process.cwd(), 'src/ui/base.css'), 'utf8');

describe('confidenceBadge', () => {
  it('renders each of the five states with its state class and word', () => {
    for (const s of STATES) {
      const el = confidenceBadge(s);
      expect(el.classList.contains(`conf--${s.toLowerCase()}`)).toBe(true);
      expect(el.textContent).toBe(s);
    }
  });

  it('is a plain span without an explainer, a real button with one', () => {
    expect(confidenceBadge('STRONG').tagName).toBe('SPAN');
    const btn = confidenceBadge('STRONG', () => {});
    expect(btn.tagName).toBe('BUTTON');
    expect((btn as unknown as HTMLButtonElement).type).toBe('button');
    expect(btn.classList.contains('conf--explain')).toBe(true);
  });

  it('labels the tappable badge with the explain affordance', () => {
    const btn = confidenceBadge('STRONG', () => {});
    expect(btn.getAttribute('aria-label')).toBe('confidence: STRONG — tap to see what produced this');
    const span = confidenceBadge('NOISE');
    expect(span.getAttribute('aria-label')).toBe('confidence: NOISE');
  });

  it('fires onExplain on tap', () => {
    let opened = 0;
    const btn = confidenceBadge('POSSIBLE', () => opened++);
    (btn as unknown as HTMLButtonElement).click();
    expect(opened).toBe(1);
  });

  it('update() restyles in place without re-mounting', () => {
    const el = confidenceBadge('STRONG', () => {});
    el.update('UNRELIABLE');
    expect(el.classList.contains('conf--unreliable')).toBe(true);
    expect(el.classList.contains('conf--strong')).toBe(false);
    expect(el.classList.contains('conf--explain')).toBe(true); // tap affordance survives
    expect(el.textContent).toBe('UNRELIABLE');
    expect(el.getAttribute('aria-label')).toContain('UNRELIABLE');
  });

  it('CSS: state colors come from tokens and the tappable badge meets the 56px target', () => {
    const conf = css.match(/\.conf--unreliable\s*\{[^}]*\}/)?.[0] ?? '';
    expect(conf).toContain('var(--red)');
    const explain = css.match(/\.conf--explain\s*\{[^}]*\}/)?.[0] ?? '';
    expect(explain).toContain('min-height: var(--tap)');
    expect(explain).toContain('min-width: var(--tap)');
    // never orange: no .conf rule reaches for the live-value color
    for (const block of css.match(/\.conf[^{]*\{[^}]*\}/g) ?? []) {
      expect(block).not.toContain('--orange');
    }
  });
});
