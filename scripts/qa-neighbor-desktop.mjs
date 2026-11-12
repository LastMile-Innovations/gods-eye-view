/** Actual UI/native acceptance for Build 002. Run against an isolated test data directory. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import puppeteer from 'puppeteer';
const url = process.env.NEIGHBOR_QA_URL || 'http://localhost:4174';
const artifacts = new URL(
  '../../research/unified-world/build-002/',
  import.meta.url,
);
await mkdir(artifacts, { recursive: true });
const browser = await puppeteer.launch({
  headless: true,
  executablePath:
    process.env.PUPPETEER_EXECUTABLE_PATH ||
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage();
const exceptions = [];
page.on('pageerror', (error) => {
  exceptions.push(error.message);
  console.log('BROWSER EXCEPTION', error.message);
});
page.on('console', (message) => {
  if (message.type() === 'error')
    console.log(
      'BROWSER ERROR',
      message.text().replace(/https?:\/\/\S+/g, '[url]'),
    );
});
let queries = 0;
page.on('request', (request) => {
  if (request.url().endsWith('/api/world/v1/query')) queries++;
});
const app = (id) => `.nd-window[data-app-id="${id}"]`;
const pause = () =>
  page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
const clickText = async (scope, text) => {
  const clicked = await page.evaluate(
    ({ scope, text }) => {
      const button = [...document.querySelectorAll(`${scope} button`)].find(
        (el) => el.textContent.trim() === text,
      );
      button?.click();
      return Boolean(button);
    },
    { scope, text },
  );
  assert.ok(clicked, `Missing button: ${scope} / ${text}`);
};
const open = async (id) => {
  await page.click(`.nd-dock button[data-app-id="${id}"]`);
  await pause();
};
const rect = async (id) =>
  page.$eval(app(id), (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
async function create(id, title, kind) {
  await clickText(app(id), '+ Create');
  await page.waitForSelector('.nw-dialog[open] input[name="title"]');
  await page.type('.nw-dialog[open] input[name="title"]', title);
  if (kind) await page.select('.nw-dialog[open] select[name="kind"]', kind);
  await page.click('.nw-dialog[open] button[type="submit"]');
  await page.waitForFunction(
    (text) =>
      document
        .querySelector('.nw-status')
        .textContent.includes('Committed revision') &&
      [...document.querySelectorAll('.nw-inspector h2')].some(
        (el) => el.textContent === text,
      ),
    {},
    title,
  );
}
try {
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('.nw-shell', { timeout: 60000 });
  await page.waitForFunction(() =>
    document
      .querySelector('.nw-status')
      .getAttribute('title')
      ?.includes('Saved in Quanta'),
  );
  await create('records', 'Desktop acceptance need');
  await open('board');
  await create('board', 'Independent board task', 'task');
  assert.equal(
    await page.$eval(
      `${app('records')} .nw-inspector h2`,
      (el) => el.textContent,
    ),
    'Desktop acceptance need',
  );
  assert.equal(
    await page.$eval(
      `${app('board')} .nw-inspector h2`,
      (el) => el.textContent,
    ),
    'Independent board task',
  );
  console.log('PASS independent app selection over real Quanta writes');
  await page.type(`${app('board')} input[type="search"]`, 'Independent');
  const before = await rect('board'),
    queryCount = queries;
  const title = await page.$(`${app('board')} .nd-window-title`);
  const bar = await title.boundingBox();
  await page.mouse.move(bar.x + 60, bar.y + 12);
  await page.mouse.down();
  await page.mouse.move(bar.x + 160, bar.y + 62, { steps: 8 });
  await page.mouse.up();
  await pause();
  const after = await rect('board');
  assert.equal(after.x, before.x + 100);
  assert.equal(after.y, before.y + 50);
  assert.equal(
    await page.$eval(`${app('board')} input[type="search"]`, (el) => el.value),
    'Independent',
  );
  assert.equal(queries, queryCount, 'dragging must not query native records');
  const grip = await page.$(`${app('board')} .nd-resize-se`);
  const g = await grip.boundingBox();
  await page.mouse.move(g.x + 5, g.y + 5);
  await page.mouse.down();
  await page.mouse.move(g.x + 45, g.y + 35, { steps: 6 });
  await page.mouse.up();
  await pause();
  assert.equal((await rect('board')).width, after.width + 40);
  console.log(
    'PASS real pointer drag/resize without record queries or input remount',
  );
  await page.click(`${app('board')} .nd-minimize`);
  assert.equal(await page.$eval(app('board'), (el) => el.hidden), true);
  await open('board');
  assert.equal(
    await page.$eval(`${app('board')} input[type="search"]`, (el) => el.value),
    'Independent',
  );
  const floating = await rect('board');
  await page.click(`${app('board')} .nd-maximize`);
  assert.ok((await rect('board')).width > 1300);
  await page.click(`${app('board')} .nd-maximize`);
  assert.deepEqual(await rect('board'), floating);
  await page.click(`${app('board')} .nd-titlebar > button:last-child`);
  assert.equal((await rect('board')).width, 704);
  await page.click(`${app('board')} .nd-titlebar > button:last-child`);
  await page.click(`${app('board')} .nd-titlebar > button:last-child`);
  await page.focus(`${app('board')} .nd-window-title`);
  await page.keyboard.press('ArrowLeft');
  assert.equal((await rect('board')).x, floating.x - 20);
  await page.keyboard.down('Shift');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.up('Shift');
  assert.equal((await rect('board')).width, floating.width + 20);
  console.log(
    'PASS minimize/restore, maximize/restore, split cycle and keyboard geometry',
  );
  await page.click(`${app('board')} .nd-close`);
  await open('board');
  assert.equal(
    await page.$eval(`${app('board')} input[type="search"]`, (el) => el.value),
    'Independent',
  );
  await page.keyboard.down('Control');
  await page.keyboard.press('k');
  await page.keyboard.up('Control');
  await page.type('.nd-launcher[open] input', 'Documents');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() =>
    document
      .querySelector('.nd-window[data-app-id="documents"]')
      .classList.contains('nd-focused'),
  );
  const fixture = '/tmp/neighbor-build002-evidence.txt';
  await writeFile(fixture, '\ufeffDesktop evidence\r\nExact original.\r\n');
  await clickText(app('documents'), 'Import file');
  const chooser = await page.$('.nw-dialog[open] input[type="file"]');
  await chooser.uploadFile(fixture);
  await page.click('.nw-dialog[open] input[type="checkbox"]');
  await page.click('.nw-dialog[open] button[type="submit"]');
  await page.waitForFunction(
    () =>
      document
        .querySelector('.nw-status')
        .textContent.includes('Committed revision') &&
      document.querySelector(
        '.nd-window[data-app-id="documents"] .nw-inspector h2',
      )?.textContent === 'neighbor-build002-evidence.txt',
  );
  await clickText(app('documents'), 'Inspect original evidence');
  await page.waitForSelector(`${app('documents')} .nw-original`);
  assert.equal(
    await page.$eval(
      `${app('documents')} .nw-original`,
      (el) => el.textContent,
    ),
    '\ufeffDesktop evidence\r\nExact original.\r\n',
  );
  console.log(
    'PASS command launcher and actual chooser upload/evidence through native storage',
  );
  // A lost response must keep the exact pending command, even when its window closes.
  await open('board');
  const attempts = [];
  await page.setRequestInterception(true);
  const intercept = (request) => {
    if (!request.url().endsWith('/api/world/v1/commands')) {
      request.continue();
      return;
    }
    attempts.push(request.postData());
    if (attempts.length === 1)
      request.respond({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'UNKNOWN_OUTCOME' } }),
      });
    else request.continue();
  };
  page.on('request', intercept);
  await clickText(app('board'), 'Mark complete');
  await page.waitForFunction(() =>
    document.querySelector('.nw-status').textContent.includes('uncertain'),
  );
  assert.ok(
    await page.$eval(
      `${app('board')} .nw-create .nw-primary`,
      (el) => el.disabled,
    ),
  );
  assert.ok(
    await page.$eval(
      `${app('board')} .nw-inspector button`,
      (el) => el.disabled,
    ),
  );
  await page.click(`${app('board')} .nd-close`);
  await open('board');
  await clickText(app('board'), 'Reconcile pending save');
  await page.waitForFunction(() =>
    document
      .querySelector('.nw-status')
      .textContent.includes('Committed revision'),
  );
  assert.equal(attempts.length, 2);
  assert.equal(
    attempts[0],
    attempts[1],
    'reconciliation must reuse exact command and key',
  );
  page.off('request', intercept);
  await page.setRequestInterception(false);
  console.log(
    'PASS uncertain save blocks new writes and reconciles the exact command after window close/reopen',
  );
  await clickText('.nd-menu', 'Show world');
  assert.equal(
    await page.$$eval(
      '.nd-window',
      (list) => list.filter((el) => !el.hidden).length,
    ),
    0,
  );
  await page.keyboard.press('Escape');
  await open('documents');
  await page.screenshot({ path: new URL('desktop.png', artifacts).pathname });
  await new Promise((resolve) => setTimeout(resolve, 250));
  const layout = await page.evaluate(() =>
    localStorage.getItem('neighbor.desktop.layout.v1'),
  );
  assert.ok(
    !/Desktop acceptance|Independent|neighbor-build002-evidence|Exact original/.test(
      layout,
    ),
  );
  const saved = await rect('documents');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () =>
      document
        .querySelector('.nw-status')
        ?.getAttribute('title')
        ?.includes('Saved in Quanta'),
    { timeout: 60000 },
  );
  assert.deepEqual(await rect('documents'), saved);
  assert.ok(
    await page.$eval(app('documents'), (el) =>
      el.textContent.includes('neighbor-build002-evidence.txt'),
    ),
  );
  console.log(
    'PASS geometry restore and native records after reload; private text absent from layout',
  );
  await page.setViewport({ width: 390, height: 844 });
  await pause();
  assert.equal(
    await page.$$eval(
      '.nd-window',
      (list) => list.filter((el) => !el.hidden).length,
    ),
    1,
  );
  const mobile = await rect('documents');
  assert.ok(mobile.x >= 0 && mobile.x + mobile.width <= 390);
  assert.equal(await page.$eval('.nw-shell', (el) => el.scrollWidth), 390);
  await page.screenshot({ path: new URL('mobile.png', artifacts).pathname });
  await open('records');
  await clickText(app('records'), '+ Create');
  await page.type(
    '.nw-dialog[open] input[name="title"]',
    'Private unsaved draft',
  );
  // Disconnect can be initiated by a session expiry outside this modal; model that same handler.
  await clickText('.nw-header', 'Disconnect');
  assert.equal(
    await page.$eval('.nw-dialog:not(.nd-launcher)', (el) => el.textContent),
    '',
  );
  assert.ok(
    !(await page.$eval('.nd-windows', (el) => el.textContent)).includes(
      'Desktop acceptance',
    ),
  );
  assert.equal(await page.$eval('.nd-windows', (el) => el.hidden), true);
  console.log(
    'PASS small-screen focused apps and disconnect clears private content/drafts',
  );
  const queryCountBeforeDestroy = queries;
  await page.evaluate(async () => {
    const entry = document.querySelector(
      'script[type=module][src*="/src/main.js"]',
    ).src;
    const { application } = await import(entry);
    await application.destroy();
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('resize'));
  });
  assert.equal(await page.$('.nw-shell'), null);
  assert.equal(queries, queryCountBeforeDestroy);
  console.log(
    'PASS actual application teardown removes shell and foreground/resize listeners',
  );
  assert.deepEqual(exceptions, []);
  console.log('PASS no uncaught browser exceptions');
} catch (error) {
  console.log(
    'DOM failure state',
    (await page.$eval('body', (el) => el.textContent)).slice(-1800),
  );
  await page
    .screenshot({ path: new URL('failure.png', artifacts).pathname })
    .catch(() => {});
  throw error;
} finally {
  await browser.close();
}
