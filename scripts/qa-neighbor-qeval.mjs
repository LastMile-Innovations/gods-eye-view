/** Real UI/native workflow and partial-check journey in isolated development storage. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import puppeteer from 'puppeteer';
import { createBrowserViteConfig } from '../build/vite.js';
import { neighborWorkspacePlugin } from '../server/workspace/plugin.js';
import { apiNotFoundPlugin } from '../server/standalone/api-not-found.js';

const root = await mkdtemp(join(tmpdir(), 'neighbor-qeval-browser-'));
const evidence = new URL(
  '../../research/unified-world/qeval-foundation/',
  import.meta.url,
);
await mkdir(evidence, { recursive: true });
const previousDirectory = process.env.NEIGHBOR_DATA_DIR;
process.env.NEIGHBOR_DATA_DIR = join(root, 'data');
const server = await createServer({
  configFile: false,
  ...createBrowserViteConfig({
    plugins: [neighborWorkspacePlugin(), apiNotFoundPlugin()],
    host: '127.0.0.1',
    port: 0,
    command: 'serve',
  }),
  cacheDir: join(root, 'cache'),
});
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
let browser;
const errors = [];
try {
  browser = await puppeteer.launch({
    headless: true,
    executablePath:
      process.env.PUPPETEER_EXECUTABLE_PATH ||
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader'],
  });
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(
    () => document.querySelector('.nw-status')?.textContent === 'Saved locally',
    { timeout: 60000 },
  );
  await page.evaluate(async () => {
    const session = await (await fetch('/api/world/v1/session')).json();
    const response = await fetch('/api/world/v1/commands', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Neighbor-CSRF': session.csrf,
      },
      body: JSON.stringify({
        op: 'write',
        key: '99999999999999999999999999999991',
        payload: {
          kind: 'need',
          title: 'Actual browser source record',
          description: 'Synthetic isolated acceptance data',
          status: 'open',
          refs: [],
        },
      }),
    });
    if (!response.ok)
      throw new Error(`Native fixture write ${response.status}`);
  });
  await page.click('.nd-dock [data-app-id="agent"]');
  const click = async (label, cardTitle) => {
    await page.waitForFunction(
      ({ label, cardTitle }) => {
        const scope = document.querySelector('.nd-window[data-app-id="agent"]');
        if (!scope) return false;
        const card = cardTitle
          ? [...scope.querySelectorAll('article')].find(
              (c) => c.querySelector('h2')?.textContent === cardTitle,
            )
          : scope;
        return (
          card &&
          [...card.querySelectorAll('button')].some(
            (b) => b.textContent === label && !b.disabled,
          )
        );
      },
      { timeout: 30000 },
      { label, cardTitle },
    );
    assert.ok(
      await page.evaluate(
        ({ label, cardTitle }) => {
          const scope = document.querySelector(
            '.nd-window[data-app-id="agent"]',
          );
          const card = cardTitle
            ? [...scope.querySelectorAll('article')].find(
                (c) => c.querySelector('h2')?.textContent === cardTitle,
              )
            : scope;
          const button = [...card.querySelectorAll('button')].find(
            (b) => b.textContent === label,
          );
          if (!button || button.disabled) return false;
          button.click();
          return true;
        },
        { label, cardTitle },
      ),
      `Enabled button ${label}`,
    );
  };
  await click('Workflows');
  await page.waitForFunction(
    () =>
      document.querySelector('.nd-window[data-app-id="agent"] h1')
        ?.textContent === 'Read workflows',
  );
  await page.waitForSelector(
    '.nd-window[data-app-id="agent"] input[name=title]:not([disabled])',
  );
  await page.type(
    '.nd-window[data-app-id="agent"] input[name=title]',
    'Synthetic read overview',
  );
  await click('Save workflow draft');
  await page.waitForFunction(
    () =>
      [
        ...document.querySelectorAll(
          '.nd-window[data-app-id="agent"] article h2',
        ),
      ].some((n) => n.textContent === 'Synthetic read overview'),
    { timeout: 30000 },
  );
  await click('Validate reads', 'Synthetic read overview');
  await page.waitForFunction(
    () =>
      document
        .querySelector('.nd-window[data-app-id="agent"]')
        ?.textContent.includes('Validated read-only definition'),
    { timeout: 30000 },
  );
  await click('Run workflow', 'Synthetic read overview');
  await page.waitForFunction(
    () =>
      [
        ...document.querySelectorAll(
          '.nd-window[data-app-id="agent"] .nw-workflow-result-row',
        ),
      ].some((n) => n.textContent.includes('Actual browser source record')),
    { timeout: 30000 },
  );
  await page.evaluate(() => {
    const results = document.querySelector(
      '.nd-window[data-app-id="agent"] [aria-label="Workflow results"]',
    );
    results.scrollIntoView({ block: 'center' });
  });
  await page.screenshot({
    path: new URL('workflow-results.png', evidence).pathname,
  });
  await click('Open');
  await page.waitForFunction(
    () =>
      document
        .querySelector('.nd-window[data-app-id="records"] .nw-inspector')
        ?.textContent.includes('Actual browser source record'),
    { timeout: 30000 },
  );
  await page.click('.nd-dock [data-app-id="agent"]');

  await click('Edit workflow', 'Synthetic read overview');
  await page.waitForFunction(() =>
    [
      ...document.querySelectorAll('.nd-window[data-app-id="agent"] button'),
    ].some((n) => n.textContent === 'Save changes' && !n.disabled),
  );
  const title = await page.$(
    '.nd-window[data-app-id="agent"] input[name=title]',
  );
  await title.evaluate((input) => {
    input.focus();
    input.select();
  });
  assert.ok(
    await title.evaluate(
      (input) =>
        input.selectionStart === 0 && input.selectionEnd === input.value.length,
    ),
  );
  await page.keyboard.type('Edited read overview');
  await click('Save changes');
  await page.waitForFunction(
    () =>
      [
        ...document.querySelectorAll('.nd-window[data-app-id="agent"] article'),
      ].some(
        (c) =>
          c.querySelector('h2')?.textContent === 'Edited read overview' &&
          c.textContent.includes('Validation required'),
      ),
    { timeout: 30000 },
  );
  assert.equal(
    await page.evaluate(
      () =>
        [
          ...document.querySelectorAll(
            '.nd-window[data-app-id="agent"] button',
          ),
        ].find((n) => n.textContent === 'Run workflow').disabled,
    ),
    true,
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => document.querySelector('.nw-status')?.textContent === 'Saved locally',
    { timeout: 60000 },
  );
  await page.click('.nd-dock [data-app-id="agent"]');
  await click('Workflows');
  await page.waitForFunction(
    () =>
      document
        .querySelector('.nd-window[data-app-id="agent"]')
        ?.textContent.includes('Edited read overview'),
    { timeout: 30000 },
  );
  await click('Checks');
  await page.waitForFunction(() =>
    [
      ...document.querySelectorAll('.nd-window[data-app-id="agent"] button'),
    ].some((n) => n.textContent === 'Run core checks' && !n.disabled),
  );
  await click('Run core checks');
  await page.waitForFunction(
    () =>
      document
        .querySelector('.nd-window[data-app-id="agent"]')
        ?.textContent.includes('9 passed · 0 failed · 11 not run'),
    { timeout: 30000 },
  );
  await page.screenshot({
    path: new URL('executed-checks.png', evidence).pathname,
  });
  const state = await page.evaluate(async () =>
    (await fetch('/api/world/v1/qh/v1/status')).json(),
  );
  const evaluation = state.evaluations.find(
    (e) => e.payload.suite === 'qharness-core-20',
  );
  assert.equal(evaluation.effectiveStatus, 'partial');
  assert.equal(evaluation.payload.executedCount, 9);
  assert.equal(evaluation.payload.kpiSampleCount, 0);
  await page.setViewport({ width: 390, height: 844 });
  await page.screenshot({
    path: new URL('checks-mobile.png', evidence).pathname,
  });
  assert.deepEqual(errors, []);
  const result = {
    status: 'TESTED_LOCAL',
    actualNativeRead: true,
    resultHandoffToRecords: true,
    validationPinnedToDefinition: true,
    editInvalidatesValidation: true,
    workflowSurvivedReload: true,
    coreChecks: { executed: 9, notRun: 11, status: 'partial' },
    uncaughtExceptions: errors,
  };
  await writeFile(
    new URL('browser-result.json', evidence),
    JSON.stringify(result, null, 2),
  );
  console.info(JSON.stringify(result));
} catch (error) {
  const page = (await browser?.pages())?.find((p) =>
    p.url().startsWith(origin),
  );
  if (page) {
    console.info(
      'Failure state',
      await page.evaluate(() => ({
        status: document.querySelector('.nw-status')?.title,
        agent: document.querySelector('.nd-window[data-app-id="agent"]')
          ?.textContent,
        inputs: [
          ...document.querySelectorAll('.nd-window[data-app-id="agent"] input'),
        ].map((n) => ({ name: n.name, value: n.value })),
      })),
    );
    await page.screenshot({
      path: new URL('browser-failure.png', evidence).pathname,
    });
  }
  throw error;
} finally {
  await browser?.close();
  await server.close();
  if (previousDirectory === undefined) delete process.env.NEIGHBOR_DATA_DIR;
  else process.env.NEIGHBOR_DATA_DIR = previousDirectory;
  await rm(root, { recursive: true, force: true });
}
