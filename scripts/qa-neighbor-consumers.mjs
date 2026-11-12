/** Real Activity inbox recovery, including a committed ACK whose HTTP reply is lost. */
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
  '../../research/unified-world/change-consumers/',
  import.meta.url,
);
await mkdir(evidence, { recursive: true });
const root = await mkdtemp(join(tmpdir(), 'neighbor-consumers-'));
const previous = process.env.NEIGHBOR_DATA_DIR;
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
  const ackBodies = [],
    order = [];
  let forwardedReceipt;
  await page.setRequestInterception(true);
  page.on('request', async (request) => {
    if (request.url().endsWith('/sync')) order.push('sync');
    if (!request.url().endsWith('/change-inbox/ack')) return request.continue();
    order.push('ack');
    ackBodies.push(request.postData());
    if (ackBodies.length !== 1) return request.continue();
    const response = await fetch(request.url(), {
      method: 'POST',
      headers: request.headers(),
      body: request.postData(),
    });
    assert.equal(response.status, 200);
    forwardedReceipt = await response.json();
    await request.abort('failed');
  });
  await press('Refresh and acknowledge batch');
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('[data-change-inbox] button')].some(
        (b) => b.textContent === 'Retry inbox action',
      ),
    { timeout: 30000 },
  );
  const committed = await status();
  assert.equal(committed.pending, null);
  assert.equal(committed.acknowledged, first.pending.through);
  await press('Retry inbox action');
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('[data-change-inbox] button')].some(
        (b) => b.textContent === 'Read a bounded change batch' && !b.disabled,
      ),
    { timeout: 30000 },
  );
  assert.equal(ackBodies.length, 2);
  assert.equal(ackBodies[0], ackBodies[1]);
  assert.ok(order.indexOf('sync') < order.indexOf('ack'));
  assert.deepEqual(await status(), committed);
  await press('Read a bounded change batch');
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('[data-change-inbox] button')].some(
        (b) => b.textContent === 'Read a bounded change batch' && !b.disabled,
      ),
    { timeout: 30000 },
  );
  assert.deepEqual(await status(), committed);
  assert.deepEqual(errors, []);
  await page.screenshot({
    path: new URL('activity-inbox.png', evidence).pathname,
  });
  await writeFile(
    new URL('browser-outcomes.json', evidence),
    JSON.stringify(
      {
        status: 'TESTED_LOCAL',
        outcomes: [
          'poll persists a pending delivery without advancing its checkpoint',
          'reload recovers the same native pending delivery',
          'lost HTTP acknowledgement reply still leaves the native checkpoint committed',
          'explicit retry uses the exact original request and does not advance twice',
          'bookkeeping-only idle poll leaves checkpoint revision unchanged',
        ],
        checkpoint: committed,
        ackReceipt: forwardedReceipt,
        requestOrder: order,
        pageErrors: errors,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    'PASS native Activity inbox, reload, lost ACK reply, exact retry and idle tail',
  );
} finally {
  await browser?.close();
  await server?.close();
  if (previous === undefined) delete process.env.NEIGHBOR_DATA_DIR;
  else process.env.NEIGHBOR_DATA_DIR = previous;
  await rm(root, { recursive: true, force: true });
}
