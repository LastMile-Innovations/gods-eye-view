/** Actual desktop/native selection and rendering journey in disposable storage.
 * Run: node scripts/qa-neighbor-integration.mjs (native adapter must be built).
 * Uses the viewer's real selectedEntity event; it does not qualify pointer picking.
 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import puppeteer from 'puppeteer';
import { createBrowserViteConfig } from '../build/vite.js';
import { neighborWorkspacePlugin } from '../server/workspace/plugin.js';
import { apiNotFoundPlugin } from '../server/standalone/api-not-found.js';

const evidence = new URL(
  '../../research/unified-world/integration-hardening/',
  import.meta.url,
);
await mkdir(evidence, { recursive: true });
const root = await mkdtemp(join(tmpdir(), 'neighbor-integration-'));
const previousDirectory = process.env.NEIGHBOR_DATA_DIR;
process.env.NEIGHBOR_DATA_DIR = join(root, 'data');
let browser, server;
try {
  const config = createBrowserViteConfig({
    plugins: [neighborWorkspacePlugin(), apiNotFoundPlugin()],
    host: '127.0.0.1',
    command: 'serve',
  });
  server = await createServer({
    ...config,
    server: { ...config.server, port: 0 },
    configFile: false,
    cacheDir: join(root, 'cache'),
  });
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await puppeteer.launch({
    headless: true,
    executablePath:
      process.env.PUPPETEER_EXECUTABLE_PATH ||
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader'],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(`${origin}/?desktopDiagnostics`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForFunction(
    () => document.querySelector('.nw-status')?.textContent === 'Saved locally',
    { timeout: 60000 },
  );
  const places = await page.evaluate(async () => {
    const session = await (await fetch('/api/world/v1/session')).json();
    const ids = [];
    for (let i = 0; i < 2; i++) {
      const response = await fetch('/api/world/v1/commands', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Neighbor-CSRF': session.csrf,
        },
        body: JSON.stringify({
          op: 'write',
          key: `7777777777777777777777777777777${i}`,
          payload: {
            kind: 'place',
            title: `Integration place ${i}`,
            description: 'Synthetic isolated integration record',
            status: 'open',
            coordinates: [-123.1 + i / 100, 44.6],
            refs: [],
          },
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.id)
        throw new Error(`Native fixture write: ${response.status}`);
      ids.push(result.id);
    }
    return ids;
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('button[aria-label="Open Integration place 0"]', {
    timeout: 60000,
  });
  await page.click('.nd-dock [data-app-id="marketplace"]');
  const market = '.nd-window[data-app-id="marketplace"]';
  await page.evaluate(
    (scope) =>
      [...document.querySelectorAll(`${scope} .nw-tabs button`)]
        .find((b) => b.textContent.startsWith('Offers ('))
        .click(),
    market,
  );
  // A real globe entity selection must leave the unrelated Offers tab and open
  // this merchant's canonical product page, using the field the renderer reads.
  const selectedProduct = await page.evaluate(async () => {
    const { application } = await import('/src/main.js');
    const { CANONICAL_PRODUCTS } =
      await import('/src/workspace/marketCatalog.js');
    const product = CANONICAL_PRODUCTS.find((p) =>
      p.offers.some((o) => o.coordinates),
    );
    const offer = product.offers.find((o) => o.coordinates);
    const viewer = application.getComponents().scene.viewer;
    viewer.selectedEntity = viewer.entities.getById(`neighbor-${offer.id}`);
    return product.title;
  });
  await page.waitForFunction(
    (scope) =>
      Boolean(document.querySelector(`${scope} .nw-product-workspace`)),
    {},
    market,
  );
  assert.ok(
    await page.$eval(
      market,
      (el, title) => el.textContent.includes(title),
      selectedProduct,
    ),
  );
  // Independent Records retains its selection while the world changes.
  await page.click('.nd-dock [data-app-id="records"]');
  await page.select(
    '.nd-window[data-app-id="records"] .nd-context-badge',
    'independent',
  );
  await page.click('button[aria-label="Open Integration place 0"]');
  await page.evaluate(async (id) => {
    const { application } = await import('/src/main.js');
    const viewer = application.getComponents().scene.viewer;
    viewer.selectedEntity = viewer.entities.getById(`neighbor-${id}`);
  }, places[1]);
  assert.equal(
    await page.$eval(
      '.nd-window[data-app-id="records"] .nw-selected strong',
      (el) => el.textContent,
    ),
    'Integration place 0',
  );
  await page.select(
    '.nd-window[data-app-id="records"] .nd-context-badge',
    'follow-world',
  );
  await page.waitForFunction(
    () =>
      document.querySelector(
        '.nd-window[data-app-id="records"] .nw-selected strong',
      )?.textContent === 'Integration place 1',
  );
  // Changing an independent app must retain the existing world action controls.
  assert.equal(
    await page.evaluate(async () => {
      const surface = document.querySelector('.nw-world-surface');
      const control = surface.querySelector('button');
      const { application } = await import('/src/main.js');
      const before =
        application.getComponents().scene.viewer.entities.values.length;
      document.querySelector(
        '.nd-window[data-app-id="records"] .nd-context-badge',
      ).value = 'independent';
      document
        .querySelector('.nd-window[data-app-id="records"] .nd-context-badge')
        .dispatchEvent(new Event('change'));
      document
        .querySelector('button[aria-label="Open Integration place 0"]')
        .click();
      return (
        control === surface.querySelector('button') &&
        before ===
          application.getComponents().scene.viewer.entities.values.length
      );
    }),
    true,
  );
  await page.select('.nd-layout', 'focus');
  await page.waitForFunction(
    () =>
      document.querySelector('#cesiumContainer')?.dataset.renderSuspended ===
      'true',
    { timeout: 10000 },
  );
  await page.select('.nd-layout', 'desktop');
  await page.waitForFunction(
    () =>
      document.querySelector('#cesiumContainer')?.dataset.renderSuspended ===
      'false',
  );
  const diagnostics = await page.evaluate(async () => {
    const { getRenderGovernorDiagnostics } =
      await import('/src/renderGovernor.js');
    return getRenderGovernorDiagnostics();
  });
  assert.equal(diagnostics.suspended, false);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: new URL('desktop.png', evidence).pathname });
  const receipt = {
    status: 'TESTED_LOCAL / REVIEW_PENDING',
    checks: [
      'native writes in isolated temporary storage',
      'globe merchant selection opens actual Market product detail',
      'independent selection isolation and follow-world rejoin',
      'unchanged world action controls retain DOM identity',
      'Focus grace suspends rendering and Desktop resumes',
    ],
    pageErrors: errors,
    diagnostics,
  };
  await writeFile(
    new URL('browser.json', evidence),
    JSON.stringify(receipt, null, 2) + '\n',
  );
  console.info(JSON.stringify(receipt, null, 2));
} finally {
  await browser?.close();
  await server?.close();
  if (previousDirectory === undefined) delete process.env.NEIGHBOR_DATA_DIR;
  else process.env.NEIGHBOR_DATA_DIR = previousDirectory;
  await rm(root, { recursive: true, force: true });
}
