/**
 * Repo guardrails — hard constraints that must never drift.
 *  - Zero runtime dependencies (SPEC §0).
 *  - The shipped woff2 fonts are byte-identical to the kit's (they carry the
 *    patched U+00B5 and U+2032; re-subsetting would silently lose both —
 *    SPEC §7.3). Verified by pinned SHA-256, computed from the kit at import
 *    time. If a hash ever changes on purpose, re-verify both glyphs render
 *    and update LICENSE-NOTES.md before touching these pins.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);

describe('zero runtime dependencies (SPEC §0)', () => {
  it('package.json "dependencies" is empty', () => {
    const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies ?? {})).toEqual([]);
  });
});

describe('patched fonts are shipped verbatim (SPEC §7.3, LICENSE-NOTES.md)', () => {
  const pins: Record<string, string> = {
    'public/fonts/ddchardware-compressed.woff2': 'b0f2daf62b4ae89d27f20eb8d83221b2206cf13320d8ba9b0c080796f7312f7f',
    'public/fonts/ddchardware-condensed.woff2': 'f4a75e9e59bf066874404855b1345d5f4382c3b3c990b9b853fa81341f4f9146',
    'public/fonts/ddchardware-regular.woff2': '2609a00de5eb1e0f74d18af7994dbb55d8c4cae025f98581877256ef8f8de7dd',
    'public/fonts/fonts.css': 'ca6e7d7187fbb28cdbaecfb2216a7a41f5a0d49c825d6664b6506e350cdae818',
  };

  for (const [file, sha] of Object.entries(pins)) {
    it(`${file} matches the kit byte-for-byte`, () => {
      const digest = createHash('sha256').update(readFileSync(new URL(file, root))).digest('hex');
      expect(digest).toBe(sha);
    });
  }

  it('woff2 files carry the WOFF2 magic and are the kit sizes (sanity on the pins themselves)', () => {
    for (const file of Object.keys(pins).filter((f) => f.endsWith('.woff2'))) {
      const buf = readFileSync(new URL(file, root));
      expect(buf.subarray(0, 4).toString('latin1')).toBe('wOF2');
      expect(buf.length).toBeGreaterThan(4000);
    }
  });
});

describe('kit assets used verbatim', () => {
  it('manifest.webmanifest parses and names all five icons that exist on disk', () => {
    const manifest = JSON.parse(readFileSync(new URL('public/manifest.webmanifest', root), 'utf8')) as {
      icons: Array<{ src: string }>;
    };
    expect(manifest.icons).toHaveLength(5);
    for (const icon of manifest.icons) {
      expect(() => readFileSync(new URL(`public${icon.src}`, root))).not.toThrow();
    }
  });

  it('netlify.toml grants the sensor Permissions-Policy', () => {
    const toml = readFileSync(new URL('netlify.toml', root), 'utf8');
    expect(toml).toMatch(/magnetometer=\(self\)/);
    expect(toml).toMatch(/accelerometer=\(self\)/);
    expect(toml).toMatch(/gyroscope=\(self\)/);
    expect(toml).toMatch(/camera=\(self\)/);
  });
});
