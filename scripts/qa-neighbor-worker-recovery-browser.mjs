/** Real Activity UI across actual native wal_sync failure and automatic reopening. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import puppeteer from 'puppeteer';
import { createBrowserViteConfig } from '../build/vite.js';
import { createWorkspaceHandler } from '../server/workspace/plugin.js';
import { instrumentedWorkspace } from './fixtures/recovery-worker.mjs';
import { apiNotFoundPlugin } from '../server/standalone/api-not-found.js';
const evidence = new URL(
  '../../research/unified-world/native-worker-recovery/',
  import.meta.url,
);
await mkdir(evidence, { recursive: true });
const root = await mkdtemp(join(tmpdir(), 'neighbor-consumers-'));
const previous = process.env.NEIGHBOR_DATA_DIR;
process.env.NEIGHBOR_DATA_DIR = join(root, 'data');
const native = instrumentedWorkspace(join(root, 'data'));
let browser, server;
try {
  const config = createBrowserViteConfig({
    plugins: [
      {
        name: 'test-instrumented-worker',
        configureServer(server) {
          server.middlewares.use(
            '/api/world/v1',
            createWorkspaceHandler({ native }),
          );
        },
      },
      apiNotFoundPlugin(),
    ],
    host: '127.0.0.1',
    command: 'serve',
  });
  server = await createServer({
    ...config,
    configFile: false,
    server: { ...config.server, port: 0 },
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
  await page.setViewport({ width: 1440, height: 1000 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const ready = () =>
    page.waitForFunction(
      () =>
        document
          .querySelector('.nw-status')
          ?.title?.includes('Saved in Quanta'),
      { timeout: 60000 },
    );
  const open = async () => {
    await page.click('.nd-dock-apps');
    await page.click('.nd-launcher[open] button[aria-label="Activity"]');
  };
  const press = (label) =>
    page.evaluate(
      (label) =>
        [...document.querySelectorAll('[data-change-inbox] button')]
          .find((b) => b.textContent === label)
          ?.click(),
      label,
    );
  const status = () =>
    page.evaluate(async () => {
      const r = await fetch('/api/world/v1/change-inbox');
      if (!r.ok) throw new Error('inbox status unavailable');
      return r.json();
    });
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await ready();
  await open();
  await press('Read a bounded change batch');
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-change-inbox]')
        ?.textContent.includes('Pending batch'),
    { timeout: 30000 },
  );
  const first = await status();
  assert.equal(first.acknowledged, '0');
  assert.ok(first.pending);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready();
  await open();
  assert.deepEqual(await status(), first);
  await native.arm('wal_sync', 900);
  await press('Refresh and acknowledge batch');
  await page.waitForSelector('[data-inbox-recovery="recovering"]', {
    timeout: 20000,
  });
  const recoveryText = await page.$eval(
    '[data-inbox-recovery]',
    (el) => el.textContent,
  );
  assert.match(recoveryText, /Reopening native storage/);
  await page.screenshot({
    path: new URL('activity-recovering.png', evidence).pathname,
  });
  await page.waitForSelector('[data-inbox-recovery="recovered"]', {
    timeout: 20000,
  });
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('[data-change-inbox] button')].some(
        (b) => b.textContent === 'Read a bounded change batch' && !b.disabled,
      ),
    { timeout: 20000 },
  );
  const after = await status();
  assert.equal(after.pending, null);
  assert.equal(after.acknowledged, first.pending.through);
  const lines = native.lines.filter(
    (line) => JSON.parse(line).op === 'ackChangeInbox',
  );
  assert.equal(lines.length, 2);
  assert.equal(lines[0], lines[1]);
  assert.ok(
    native.replies.some(
      (r) =>
        r.op === 'ackChangeInbox' && r.value.error?.code === 'UNKNOWN_OUTCOME',
    ),
  );
  assert.deepEqual(errors, []);
  await page.screenshot({
    path: new URL('activity-recovered.png', evidence).pathname,
  });
  await writeFile(
    new URL('browser-outcomes.json', evidence),
    JSON.stringify(
      {
        provenance: 'TESTED_LOCAL',
        outcomes: [
          'Activity shows recovering during a real native I/O fault',
          'worker reopens and exact ACK bytes reconcile automatically',
          'checkpoint advances once and pending clears',
          'Activity shows resolved recovery without manual restart or retry',
        ],
        page_errors: errors,
      },
      null,
      2,
    ) + '\n',
  );
  console.log('Browser: 4 recovery outcomes passed; zero page errors');
} finally {
  await browser?.close();
  await server?.close();
  await native.close();
  if (previous === undefined) delete process.env.NEIGHBOR_DATA_DIR;
  else process.env.NEIGHBOR_DATA_DIR = previous;
  await rm(root, { recursive: true, force: true });
}
