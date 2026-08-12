/**
 * Fixture registry — the bridge that makes the test corpus and the DEMO
 * content the same files (SPEC §7B.4, KIT SCHEMA.md). Traces are loaded as
 * lazy chunks so DEMO payloads stay out of the boot bundle; the service
 * worker precaches them, so DEMO works offline.
 *
 * tests/unit/demo-corpus.test.ts fails if a DEMO references a fixture the
 * suite does not assert — DoD requirement.
 */
import type { SensorTrace } from '../types';
import { validateTrace } from '../sensors/replay';

const files = import.meta.glob('../../tests/fixtures/*.json');

export function fixtureIds(): string[] {
  return Object.keys(files)
    .map((p) => p.split('/').pop()!.replace(/\.json$/, ''))
    .sort();
}

export async function loadFixture(id: string): Promise<SensorTrace> {
  const key = Object.keys(files).find((p) => p.endsWith(`/${id}.json`));
  if (!key) throw new Error(`unknown fixture: ${id}`);
  const mod = (await files[key]!()) as { default: unknown };
  validateTrace(mod.default);
  return mod.default;
}
