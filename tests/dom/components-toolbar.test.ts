// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bottomBar } from '../../src/ui/components/toolbar';

const base = readFileSync(resolve(process.cwd(), 'src/ui/base.css'), 'utf8');
const tokens = readFileSync(resolve(process.cwd(), 'src/ui/tokens.css'), 'utf8');

describe('bottomBar', () => {
  it('groups the controls with a label, in call order', () => {
    const a = document.createElement('button');
    a.textContent = 'MARK';
    const b = document.createElement('button');
    b.textContent = 'ANCHOR';
    const bar = bottomBar(a, b);
    expect(bar.classList.contains('bottombar')).toBe(true);
    expect(bar.getAttribute('role')).toBe('group');
    expect(bar.getAttribute('aria-label')).toBe('Tool controls');
    expect([...bar.children]).toEqual([a, b]);
  });

  it('marks every control for target sizing', () => {
    const a = document.createElement('button');
    const b = document.createElement('a');
    const bar = bottomBar(a, b);
    for (const c of bar.children) {
      expect(c.classList.contains('bottombar__ctl')).toBe(true);
    }
  });

  it('CSS: fixed to the bottom edge with safe-area padding', () => {
    const rule = base.match(/\.bottombar\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rule).toContain('position: fixed');
    expect(rule).toContain('bottom: 0');
    expect(rule).toContain('safe-area-inset-bottom');
  });

  it('CSS: 56px targets, 72px under glove mode — via the --tap token', () => {
    const ctl = base.match(/\.bottombar__ctl\s*\{[^}]*\}/)?.[0] ?? '';
    expect(ctl).toContain('min-height: var(--tap)');
    expect(ctl).toContain('min-width: var(--tap)');
    expect(tokens).toContain('--tap: 56px');
    expect(tokens).toContain('--tap-glove: 72px');
    expect(tokens).toMatch(/\[data-glove="on"\]\s*\{\s*--tap: var\(--tap-glove\)/);
  });

  it('CSS: the outlet clears the fixed bar so content never hides under it', () => {
    const outlet = base.match(/\.outlet\s*\{[^}]*\}/s)?.[0] ?? '';
    expect(outlet).toContain('padding-bottom');
    expect(outlet).toContain('var(--tap)');
  });
});
