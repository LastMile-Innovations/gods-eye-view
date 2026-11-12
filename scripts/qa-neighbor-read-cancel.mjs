/** Negative browser outcome: cancelling a slow file read must not dispatch any native command. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';
const artifacts = new URL(
  '../../research/unified-world/build-003/',
  import.meta.url,
);
const browser = await puppeteer.launch({
  headless: true,
  executablePath:
    process.env.PUPPETEER_EXECUTABLE_PATH ||
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto('http://localhost:4175', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForFunction(() =>
    document
      .querySelector('.nw-status')
      .getAttribute('title')
      ?.includes('Saved in Quanta'),
  );
  const before = await page.evaluate(async () => ({
    network: await (await fetch('/api/world/v1/evidence-network')).json(),
    ops: await (await fetch('/api/world/v1/operations')).json(),
  }));
  await page.click('.nd-dock [data-app-id=evidence]');
  await page.evaluate(() =>
    [...document.querySelectorAll('.nd-window[data-app-id=evidence] button')]
      .find((b) => b.textContent === 'Preserve evidence')
      .click(),
  );
  const directory = await mkdtemp(join(tmpdir(), 'neighbor-cancel-')),
    path = join(directory, 'cancelled.bin');
  await writeFile(path, Buffer.from([0, 255, 10, 0]));
  await (await page.$('.nw-dialog[open] input[type=file]')).uploadFile(path);
  await page.click('.nw-dialog[open] input[type=checkbox]');
  await page.evaluate(() => {
    const read = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function () {
      return new Promise((resolve) =>
        setTimeout(() => resolve(read.call(this)), 500),
      );
    };
  });
  let commands = 0;
  page.on('request', (r) => {
    if (r.url().endsWith('/api/world/v1/commands')) commands++;
  });
  await page.click('.nw-dialog[open] button[type=submit]');
  await page.waitForFunction(
    () =>
      document.querySelector('.nw-status').textContent ===
      'Reading original bytes…',
  );
  assert.equal(
    await page.$eval(
      '.nd-window[data-app-id=evidence] .nw-primary',
      (el) => el.disabled,
    ),
    true,
  );
  await page.evaluate(() =>
    [...document.querySelectorAll('.nw-dialog[open] button')]
      .find((b) => b.textContent === 'Cancel')
      .click(),
  );
  await page.waitForFunction(
    () =>
      document.querySelector('.nw-status').textContent ===
      'Read cancelled. Nothing was sent.',
  );
  const after = await page.evaluate(async () => ({
    network: await (await fetch('/api/world/v1/evidence-network')).json(),
    ops: await (await fetch('/api/world/v1/operations')).json(),
  }));
  assert.equal(commands, 0);
  assert.deepEqual(after, before);
  assert.equal(
    await page.$eval(
      '.nd-window[data-app-id=evidence] .nw-primary',
      (el) => el.disabled,
    ),
    false,
  );
  console.log(
    'PASS slow read locks actions; cancellation dispatches zero commands and leaves native artifacts/journal unchanged',
  );
  await page.evaluate(() =>
    [...document.querySelectorAll('.nw-header button')]
      .find((b) => b.textContent === 'Disconnect')
      .click(),
  );
} finally {
  await browser.close();
}
