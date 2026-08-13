/**
 * Screenshot the built app (dist/) with the preinstalled Chromium — used to
 * show the deploy without a deploy (ADR-014: this container cannot reach
 * Netlify). Serves dist on a local port, shoots key screens at phone size.
 * Usage: node scripts/screenshots.mjs [outDir]
 */
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { extname, join } from 'node:path';

const dist = new URL('../dist', import.meta.url).pathname;
const outDir = process.argv[2] ?? '/tmp/screens';
mkdirSync(outDir, { recursive: true });

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  let file = join(dist, path === '/' ? 'index.html' : path);
  if (!existsSync(file)) file = join(dist, 'index.html'); // SPA fallback
  try {
    const body = readFileSync(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end();
  }
});
await new Promise((r) => server.listen(4199, r));

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({
  viewport: { width: 390, height: 844 }, // iPhone-ish
  deviceScaleFactor: 2,
});

const shots = [
  ['home', 'http://localhost:4199/'],
  ['home-replay', 'http://localhost:4199/?replay=drywall-16oc-synthetic'],
  ['scan', 'http://localhost:4199/#/scan'],
  ['level', 'http://localhost:4199/#/level'],
  ['layout', 'http://localhost:4199/#/layout'],
  ['bevel', 'http://localhost:4199/#/bevel'],
  ['calibrate', 'http://localhost:4199/#/calibrate'],
  ['manual', 'http://localhost:4199/#/manual'],
];

for (const [name, url] of shots) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200); // let replay/live panels paint
  await page.screenshot({ path: join(outDir, `${name}.png`) });
  console.log(`shot: ${name}`);
}

// Night theme, home.
await page.goto('http://localhost:4199/', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.setItem('square.theme', 'night'));
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await page.screenshot({ path: join(outDir, 'home-night.png') });
console.log('shot: home-night');

await browser.close();
server.close();
console.log(`done → ${outDir}`);
