/**
 * Scoped style injection for A3b's tool views. src/ui/** is A7's territory,
 * so these tools carry their own small style blocks (same pattern as
 * src/guidance/manual.ts) — when A7 lands shared classes the blocks can be
 * deleted without touching markup. Flat fills, 3px rules, radius 0, no
 * shadows (SPEC §7.4).
 */
const injected = new Set<string>();

export function injectStylesOnce(id: string, css: string): void {
  if (injected.has(id)) return;
  if (typeof document === 'undefined') return;
  if (document.getElementById(id)) {
    injected.add(id);
    return;
  }
  const style = document.createElement('style');
  style.id = id;
  style.textContent = css;
  document.head.append(style);
  injected.add(id);
}
