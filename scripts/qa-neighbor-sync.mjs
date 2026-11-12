/** Real two-session native sync journey in disposable storage; no live providers required. */
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
  '../../research/unified-world/database-sync/',
  import.meta.url,
);
await mkdir(evidence, { recursive: true });
const root = await mkdtemp(join(tmpdir(), 'neighbor-sync-'));
const previous = process.env.NEIGHBOR_DATA_DIR;
process.env.NEIGHBOR_DATA_DIR = join(root, 'data');
let server, browser;
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
  const failures = [];
  page.on('pageerror', (error) => failures.push(error.message));
  await page.setViewport({ width: 1440, height: 1000 });
  const syncResponses = [];
  page.on('response', async (response) => {
    if (response.url().endsWith('/api/world/v1/sync') && response.ok()) {
      const data = await response.json().catch(() => null);
      if (data)
        syncResponses.push({
          changed: data.changed,
          bytes: JSON.stringify(data).length,
        });
    }
  });
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(
    () =>
      document.querySelector('.nw-status')?.title?.includes('Saved in Quanta'),
    { timeout: 60000 },
  );
  // A second independent HttpOnly development session writes to this same native owner store.
  const connection = await fetch(`${origin}/api/world/v1/connect`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(connection.status, 200);
  const cookie = connection.headers.get('set-cookie').split(';')[0];
  const { csrf } = await connection.json();
  const command = {
    op: 'write',
    key: '12121212121212121212121212121212',
    payload: {
      kind: 'task',
      title: 'Changed from second session',
      description: 'Synthetic cross-session native synchronization fixture',
      status: 'open',
      refs: [],
    },
  };
  const result = await fetch(`${origin}/api/world/v1/commands`, {
    method: 'POST',
    headers: {
      Origin: origin,
      Cookie: cookie,
      'Content-Type': 'application/json',
      'X-Neighbor-CSRF': csrf,
    },
    body: JSON.stringify(command),
  });
  assert.equal(result.status, 200);
  const receipt = await result.json();
  const selector = 'button[aria-label="Open Changed from second session"]';
  await page.waitForSelector(selector, { timeout: 20000 });
  // No-change polling must leave the actual selected row node intact.
  await page.$eval(selector, (el) => {
    el.dataset.syncWitness = 'retained';
  });
  await page.waitForFunction(() => performance.now() > 0);
  const count = syncResponses.length;
  await page.waitForFunction(async () => {
    const status = document.querySelector('.nw-status');
    return Boolean(status?.title?.includes('Saved in Quanta'));
  });
  // Wait on actual API evidence, rather than a fixed timing assumption.
  const until = Date.now() + 15000;
  while (
    !syncResponses.slice(count).some((r) => !r.changed) &&
    Date.now() < until
  )
    await new Promise((r) => setTimeout(r, 100));
  assert.ok(syncResponses.slice(count).some((r) => !r.changed));
  assert.equal(
    await page.$eval(selector, (el) => el.dataset.syncWitness),
    'retained',
  );
  await page.click('.nd-dock [data-app-id="projects"]');
  await page.evaluate(() =>
    [...document.querySelectorAll('.nd-window[data-app-id="projects"] button')]
      .find((button) => button.textContent === 'New project')
      .click(),
  );
  const titleField =
    '.nd-window[data-app-id="projects"] input[data-draft-key="project-title"]';
  await page.waitForSelector(titleField);
  await page.type(titleField, 'Keep my unsubmitted project');
  await page.$eval(titleField, (el) => {
    el.setSelectionRange(3, 7);
    el.dataset.syncDraftWitness = 'before-change';
  });
  const second = await fetch(`${origin}/api/world/v1/commands`, {
    method: 'POST',
    headers: {
      Origin: origin,
      Cookie: cookie,
      'Content-Type': 'application/json',
      'X-Neighbor-CSRF': csrf,
    },
    body: JSON.stringify({
      ...command,
      key: '13131313131313131313131313131313',
      payload: {
        ...command.payload,
        title: 'Another session update while editing',
      },
    }),
  });
  assert.equal(second.status, 200);
  await page.waitForFunction(
    (field) => {
      const input = document.querySelector(field);
      return input && !input.dataset.syncDraftWitness;
    },
    { timeout: 20000 },
    titleField,
  );
  assert.deepEqual(
    await page.$eval(titleField, (el) => ({
      value: el.value,
      focused: el === document.activeElement,
      selection: [el.selectionStart, el.selectionEnd],
    })),
    {
      value: 'Keep my unsubmitted project',
      focused: true,
      selection: [3, 7],
    },
  );
  const invalid = await page.evaluate(async () => {
    const session = await (await fetch('/api/world/v1/session')).json();
    const response = await fetch('/api/world/v1/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Neighbor-CSRF': session.csrf,
      },
      body: JSON.stringify({
        cursor: { version: 1, workspace: 'bad', sequence: '01' },
      }),
    });
    return response.status;
  });
  assert.equal(invalid, 400);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector(selector, { timeout: 60000 });
  await page.screenshot({
    path: new URL('desktop-sync.png', evidence).pathname,
  });
  assert.deepEqual(failures, []);
  await writeFile(
    new URL('browser-outcomes.json', evidence),
    JSON.stringify(
      {
        status: 'TESTED_LOCAL',
        outcomes: [
          'second session native command appears without reload',
          'unchanged native poll retains DOM identity',
          'changed native poll preserves unsubmitted form, focus and selection',
          'malformed cursor rejected',
          'page reload reconstructs native record',
        ],
        record: receipt.id,
        syncResponses,
        pageErrors: failures,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    'PASS real two-session native sync, unchanged DOM, strict cursor and native reload',
  );
} finally {
  await browser?.close();
  await server?.close();
  if (previous === undefined) delete process.env.NEIGHBOR_DATA_DIR;
  else process.env.NEIGHBOR_DATA_DIR = previous;
  await rm(root, { recursive: true, force: true });
}
