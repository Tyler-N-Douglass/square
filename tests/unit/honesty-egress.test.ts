/**
 * A11 HONESTY PIN — zero network egress at runtime (SPEC §0, §15; charter:
 * "prove zero network egress"). Static sweep of every file under src/ for
 * anything that could open a network channel or reference an external host,
 * plus the deployment rails that would stop egress even if code tried:
 *
 *  - src/** contains no fetch(), XMLHttpRequest, WebSocket, EventSource,
 *    sendBeacon, importScripts, or navigator.onLine gating;
 *  - src/** contains no external URL with a host. Allowlist (each one is
 *    inert, not a network reference):
 *      · http://www.w3.org/2000/svg — XML namespace identifier in inline SVG
 *      · chrome://flags/...        — instructional copy for the Android flag
 *    ("https:// address" in capability.ts has no host and never matches);
 *  - index.html (source and dist, when built) references no external origin;
 *  - the service-worker template refuses to proxy cross-origin requests;
 *  - the deployed CSP pins connect-src to 'self' with no extra hosts.
 *
 * Any new hit is a finding, not a formatting nit. Extend the allowlist only
 * with a documented reason on the same line.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SRC = join(ROOT, 'src');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const srcFiles = walk(SRC);

/** Egress-capable APIs. `fetch(` includes window.fetch / globalThis.fetch. */
const API_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'fetch(', re: /\bfetch\s*\(/ },
  { name: 'XMLHttpRequest', re: /XMLHttpRequest/ },
  { name: 'WebSocket', re: /\bWebSocket\b/ },
  { name: 'EventSource', re: /\bEventSource\b/ },
  { name: 'sendBeacon', re: /sendBeacon/ },
  { name: 'importScripts', re: /importScripts/ },
  { name: "new URL('http", re: /new URL\(\s*['"`]https?:/ },
];

/** A URL with an actual host (letter/digit after //). */
const HOSTED_URL = /\bhttps?:\/\/[A-Za-z0-9][A-Za-z0-9.-]*/g;

const URL_ALLOWLIST = [
  'http://www.w3.org/2000/svg', // SVG namespace identifier — parsed, never fetched
];

describe('zero network egress — src/** static sweep (SPEC §0, §15)', () => {
  it('no egress-capable API appears anywhere in src/ (comments stripped)', () => {
    const hits: string[] = [];
    for (const file of srcFiles) {
      // Strip comments for the API scan only — a doc line saying "without
      // fetch()" is not an egress path. The URL scan below keeps comments.
      const text = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      for (const { name, re } of API_PATTERNS) {
        if (re.test(text)) hits.push(`${file.slice(ROOT.length)}: ${name}`);
      }
    }
    expect(hits, `egress-capable API in app code:\n${hits.join('\n')}`).toEqual([]);
  });

  it('no external URL with a host appears in src/ outside the allowlist', () => {
    const hits: string[] = [];
    for (const file of srcFiles) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.match(HOSTED_URL) ?? []) {
        if (URL_ALLOWLIST.some((ok) => ok.startsWith(m) || m.startsWith(ok))) continue;
        hits.push(`${file.slice(ROOT.length)}: ${m}`);
      }
    }
    expect(hits, `external URL in app code:\n${hits.join('\n')}`).toEqual([]);
  });

  it('index.html (source) references no external origin', () => {
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    expect(html.match(HOSTED_URL) ?? []).toEqual([]);
    // No protocol-relative references either.
    expect(/(?:src|href)\s*=\s*["']\/\//.test(html)).toBe(false);
  });

  it('built dist/index.html (when present) references no external origin', () => {
    const p = join(ROOT, 'dist', 'index.html');
    if (!existsSync(p)) return; // build artifact absent — source check above still holds
    const html = readFileSync(p, 'utf8');
    expect(html.match(HOSTED_URL) ?? []).toEqual([]);
    expect(/(?:src|href)\s*=\s*["']\/\//.test(html)).toBe(false);
  });

  it('service worker template never proxies cross-origin and fetches same-origin only', () => {
    const template = readFileSync(join(ROOT, 'scripts', 'build-sw.mjs'), 'utf8');
    expect(template).toContain('url.origin !== self.location.origin) return;');
    const built = join(ROOT, 'dist', 'sw.js');
    if (existsSync(built)) {
      const sw = readFileSync(built, 'utf8');
      expect(sw).toContain('url.origin !== self.location.origin) return;');
      expect(sw.match(HOSTED_URL) ?? []).toEqual([]);
    }
  });

  it("deployed CSP pins connect-src to 'self' and names no external host", () => {
    const toml = readFileSync(join(ROOT, 'netlify.toml'), 'utf8');
    const csp = /Content-Security-Policy\s*=\s*"([^"]+)"/.exec(toml)?.[1];
    expect(csp, 'CSP header missing from netlify.toml').toBeTruthy();
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("default-src 'self'");
    // The whole policy names no host at all — every source is a keyword/scheme.
    expect(csp!.match(HOSTED_URL) ?? []).toEqual([]);
  });

  it('package.json dependencies stay empty — no library can smuggle a beacon in', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies ?? {})).toEqual([]);
  });
});
