/**
 * THE unification test — SPEC §7B.4, DoD: "The fixture corpus and the
 * tutorial content are the same files — verified by a test that fails if a
 * DEMO references a fixture the suite does not use."
 *
 * Reads tests/fixtures/ from disk at runtime, so a DEMO pointing at a
 * fixture that is not committed fails here — whether the fixture was
 * renamed, deleted, or never landed. While A2/A10 are still generating the
 * corpus (metal-stud-hot, magsafe-attached, …) this test is EXPECTED to be
 * red for those ids; it goes green the moment the files land, with no code
 * change. Do not skip it and do not stub the fixtures to appease it.
 */
import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEMO_SPECS } from '../../src/guidance/demo';

const fixturesDir = new URL('../fixtures/', import.meta.url);

describe('every DEMO replays a fixture the regression suite asserts', () => {
  const onDisk = new Set(
    readdirSync(fixturesDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, '')),
  );

  it('the fixtures directory exists and is not empty', () => {
    expect(onDisk.size).toBeGreaterThan(0);
  });

  for (const [id, spec] of Object.entries(DEMO_SPECS)) {
    it(`DEMO "${id}" → tests/fixtures/${spec.fixtureId}.json`, () => {
      expect(
        onDisk.has(spec.fixtureId),
        `DEMO "${id}" references fixture "${spec.fixtureId}" but tests/fixtures/ has: ${[...onDisk].sort().join(', ')}`,
      ).toBe(true);
    });
  }
});
