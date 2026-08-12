import './ui/base.css';
import { probeCapabilities } from './sensors/capability';
import { applyTheme, buildShell } from './app/shell';
import { startRouter, TOOL_ROUTES, type AppContext } from './app/router';
import { loadFixture } from './guidance/fixtures';
import type { SensorTrace } from './types';

async function boot(): Promise<void> {
  applyTheme();
  const capability = await probeCapabilities();

  // ?replay=<fixture-id> drives the app from a recorded trace — SPEC §3.3.
  let replayTrace: SensorTrace | null = null;
  const replayId = new URLSearchParams(location.search).get('replay');
  if (replayId) {
    try {
      replayTrace = await loadFixture(replayId.replace(/^.*\//, '').replace(/\.json$/, ''));
    } catch (e) {
      console.warn('replay fixture failed to load:', e);
    }
  }

  const root = document.getElementById('app')!;
  const { outlet, setTitle } = buildShell(root, capability);
  const ctx: AppContext = { capability, replayTrace };

  startRouter(outlet, ctx, (route) => {
    const tool = TOOL_ROUTES.find((t) => t.id === route);
    setTitle(tool ? tool.title : route === 'manual' ? 'FIELD MANUAL' : '');
    document.title = tool ? `${tool.title} — SQUARE` : 'SQUARE — is it square?';
  });

  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    try { await navigator.serviceWorker.register('/sw.js'); } catch { /* offline still fine on repeat visits */ }
  }
}

void boot();
