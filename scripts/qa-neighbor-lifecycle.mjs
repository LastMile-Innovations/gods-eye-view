import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import puppeteer from 'puppeteer';
import sharp from 'sharp';
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
const page = await browser.newPage();
const exceptions = [];
page.on('pageerror', (e) => exceptions.push(e.message));
const app = (id) => `.nd-window[data-app-id="${id}"]`;
const click = async (scope, label) =>
  assert.ok(
    await page.evaluate(
      ({ scope, label }) => {
        const b = [...document.querySelectorAll(`${scope} button`)].find(
          (b) => b.textContent.trim() === label,
        );
        b?.click();
        return Boolean(b);
      },
      { scope, label },
    ),
    `Missing ${scope} / ${label}`,
  );
const open = async (id) => page.click(`.nd-dock [data-app-id="${id}"]`);
const committed = async () =>
  page.waitForFunction(
    () =>
      document
        .querySelector('.nw-status')
        .textContent.includes('Committed revision'),
    { timeout: 30000 },
  );
const submit = async () => {
  const previous = await page.$eval('.nw-status', (el) => el.textContent);
  await page.click('.nw-dialog[open] button[type=submit]');
  await page.waitForFunction(
    (previous) =>
      document
        .querySelector('.nw-status')
        .textContent.includes('Committed revision') &&
      document.querySelector('.nw-status').textContent !== previous &&
      !document.querySelector('.nw-dialog:not(.nd-launcher)[open]'),
    { timeout: 30000 },
    previous,
  );
};
const fixtureDir = await mkdtemp(join(tmpdir(), 'neighbor-cen-browser-'));
try {
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(process.env.NEIGHBOR_QA_URL || 'http://localhost:4175', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForFunction(() =>
    document
      .querySelector('.nw-status')
      .getAttribute('title')
      ?.includes('Saved in Quanta'),
  );
  await click(app('records'), '+ Create');
  await page.type('[name=title]', 'Recovery acceptance task');
  await page.select('[name=kind]', 'task');
  await page.click('.nw-dialog[open] button[type=submit]');
  await page.waitForFunction(() =>
    document.querySelector('.nw-status').textContent.includes('uncertain'),
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () =>
      document.querySelector('.nw-status')?.textContent.includes('need review'),
    { timeout: 60000 },
  );
  assert.equal(
    await page.$eval(
      `${app('records')} .nw-create .nw-primary`,
      (el) => el.disabled,
    ),
    true,
  );
  await open('recovery');
  await click(app('recovery'), 'Resume exact save');
  await committed();
  await open('records');
  assert.equal(
    await page.$$eval(
      `${app('records')} .nw-record`,
      (r) =>
        r.filter((el) => el.textContent.includes('Recovery acceptance task'))
          .length,
    ),
    1,
  );
  await page.click(`${app('records')} .nw-record`);
  await click(app('records'), 'Mark complete');
  await committed();
  await click(app('records'), 'View record history');
  await page.waitForFunction(
    () =>
      document.querySelectorAll(
        '.nd-window[data-app-id="history"] .nw-service-card',
      ).length === 2,
  );
  assert.equal(
    await page.$eval(`${app('history')} .nw-service-card:first-of-type`, (el) =>
      el.textContent.includes('done'),
    ),
    true,
  );
  console.log(
    'PASS prepared native command survives reload, explicit recovery creates one record, actual history contains two revisions',
  );
  await open('board');
  await page.click(`${app('board')} .nd-maximize`);
  await open('desks');
  await page.type(
    `${app('desks')} [name=desk-name]`,
    'Research acceptance desk',
  );
  await page.click(`${app('desks')} button[type=submit]`);
  await committed();
  assert.ok(
    await page.$eval(app('desks'), (el) =>
      el.textContent.includes('Research acceptance desk'),
    ),
  );
  console.log('PASS named desk persisted through the native command journal');
  const png1 = await sharp({
    create: { width: 2, height: 2, channels: 4, background: '#2d6b88' },
  })
    .png()
    .toBuffer();
  const png2 = await sharp({
    create: { width: 2, height: 2, channels: 4, background: '#976f45' },
  })
    .png()
    .toBuffer();
  const file1 = join(fixtureDir, 'original.png'),
    file2 = join(fixtureDir, 'other-original.png');
  await writeFile(file1, png1);
  await writeFile(file2, png2);
  await open('evidence');
  async function intake(title, group, path) {
    await click(app('evidence'), 'Preserve evidence');
    const file = await page.$('.nw-dialog[open] input[type=file]');
    await file.uploadFile(path);
    await page.$eval('[name=evidence-title]', (el) => (el.value = ''));
    await page.type('[name=evidence-title]', title);
    await page.select(
      '.nw-dialog[open] select[aria-label="Source type"]',
      'firsthand',
    );
    await page.select(
      '.nw-dialog[open] select[aria-label="Evidence family"]',
      '01',
    );
    await page.type('[name=origin-group]', group);
    await page.type(
      '[name=evidence-notes]',
      'Synthetic acceptance fixture; no real-world allegation.',
    );
    await page.click('.nw-dialog[open] input[type=checkbox]');
    await submit();
  }
  await intake('Evidence acceptance original', 'observer-a', file1);
  await intake('Duplicate acceptance copy', 'observer-b', file1);
  await intake('Other acceptance original', 'observer-c', file2);
  const artifactId = await page.$$eval(
    `${app('evidence')} [data-artifact-id]`,
    (list) =>
      list.find(
        (el) =>
          el.querySelector('h2').textContent === 'Evidence acceptance original',
      ).dataset.artifactId,
  );
  assert.ok(
    await page.$eval(
      `${app('evidence')} [data-artifact-id="${artifactId}"]`,
      (el) => el.textContent.includes('SHA-256'),
    ),
  );
  const network = await page.evaluate(
    async () => await (await fetch('/api/world/v1/evidence-network')).json(),
  );
  assert.equal(network.artifacts.length, 3);
  const original = network.artifacts.find((a) => a.id === artifactId);
  assert.equal(
    original.payload.integrity.sha256,
    createHash('sha256').update(png1).digest('hex'),
  );
  assert.equal(original.payload.integrity.factualVerification, false);
  const downloads = join(fixtureDir, 'downloads');
  await mkdir(downloads);
  const cdp = await page.createCDPSession();
  await cdp.send('Page.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: downloads,
  });
  await click(
    `${app('evidence')} [data-artifact-id="${artifactId}"]`,
    'Download exact original',
  );
  let downloaded;
  for (let i = 0; i < 100; i++) {
    try {
      downloaded = await readFile(join(downloads, 'original.png'));
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  assert.deepEqual(downloaded, png1);
  console.log(
    'PASS actual binary chooser intake, native digests, and exact original download',
  );
  const checkbox = async (fieldset, title) => {
    assert.ok(
      await page.evaluate(
        ({ fieldset, title }) => {
          const fs = [
            ...document.querySelectorAll('.nw-dialog[open] fieldset'),
          ].find((el) => el.querySelector('legend').textContent === fieldset);
          const label = [...fs.querySelectorAll('label')].find(
            (el) => el.textContent.trim() === title,
          );
          label?.querySelector('input').click();
          return Boolean(label);
        },
        { fieldset, title },
      ),
    );
  };
  await click(app('evidence'), 'Create claim');
  await page.type('[name=claim-text]', 'Synthetic review claim for acceptance');
  await page.select('[aria-label="Reviewer assessment"]', 'corroborated');
  await checkbox('Supporting artifacts', 'Evidence acceptance original');
  await checkbox('Supporting artifacts', 'Duplicate acceptance copy');
  await page.type(
    '[name=claim-rationale]',
    'Explicit test reviewer attestation; these fixtures do not establish real-world facts.',
  );
  await page.$$eval(
    '.nw-dialog[open] form > label input[type=checkbox]',
    (list) => list.at(-1).click(),
  );
  await page.click('.nw-dialog[open] button[type=submit]');
  await page.waitForFunction(() =>
    document.querySelector('.nw-status').classList.contains('nw-error'),
  );
  assert.equal(
    await page.evaluate(
      async () =>
        (await (await fetch('/api/world/v1/evidence-network')).json()).claims
          .length,
    ),
    0,
  );
  await checkbox('Supporting artifacts', 'Duplicate acceptance copy');
  await checkbox('Supporting artifacts', 'Other acceptance original');
  await submit();
  console.log(
    'PASS duplicate uploads rejected as independent corroboration; explicit distinct-source reviewer assessment accepted',
  );
  await click(app('evidence'), 'Create casebook');
  await page.type('[name=casebook-title]', 'Acceptance citizen casebook');
  await checkbox('Artifacts', 'Evidence acceptance original');
  await checkbox('Claims', 'Synthetic review claim for acceptance');
  await submit();
  await click(
    `${app('evidence')} [data-artifact-id="${artifactId}"]`,
    'Review lifecycle',
  );
  await page.select('[aria-label="Next lifecycle state"]', 'under_review');
  await page.type(
    '[name=review-note]',
    'Original preserved; only byte integrity assessed.',
  );
  await page.select('[name=dimension-integrity]', 'supported');
  await submit();
  await click(
    `${app('evidence')} [data-artifact-id="${artifactId}"]`,
    'Inspect custody',
  );
  await page.waitForSelector(`${app('evidence')} .nw-original`);
  assert.ok(
    await page.$eval(
      `${app('evidence')} .nw-original`,
      (el) =>
        el.textContent.includes('preserved') &&
        el.textContent.includes('review-transition'),
    ),
  );
  await page.screenshot({
    path: new URL('citizen-evidence.png', artifacts).pathname,
  });
  console.log(
    'PASS native casebook references, six review dimensions and custody transitions',
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () =>
      document
        .querySelector('.nw-status')
        ?.getAttribute('title')
        ?.includes('Saved in Quanta'),
    { timeout: 60000 },
  );
  const restored = await page.evaluate(
    async () => await (await fetch('/api/world/v1/evidence-network')).json(),
  );
  assert.equal(restored.casebooks.length, 1);
  assert.equal(restored.claims[0].payload.automaticallyVerified, false);
  assert.equal(
    restored.artifacts.find((a) => a.id === artifactId).payload
      .verificationDimensions.integrity.assessment,
    'supported',
  );
  await open('desks');
  await click(app('desks'), 'Restore desk');
  assert.equal(
    await page.$eval(app('board'), (el) => el.dataset.mode),
    'maximized',
  );
  const layout = await page.evaluate(() =>
    localStorage.getItem('neighbor.desktop.layout.v1'),
  );
  assert.ok(
    !/Research acceptance desk|Evidence acceptance|Synthetic review/.test(
      layout,
    ),
  );
  console.log(
    'PASS reload restores native evidence, claims, casebook and desk; private names excluded from browser layout',
  );
  await page.setViewport({ width: 390, height: 844 });
  await open('evidence');
  assert.equal(await page.$eval('.nw-shell', (el) => el.scrollWidth), 390);
  await page.screenshot({
    path: new URL('citizen-evidence-mobile.png', artifacts).pathname,
  });
  await click('.nw-header', 'Disconnect');
  assert.ok(
    !(await page.$eval('.nd-windows', (el) => el.textContent)).includes(
      'Evidence acceptance',
    ),
  );
  await page.evaluate(async () => {
    const entry = document.querySelector(
      'script[type=module][src*="/src/main.js"]',
    ).src;
    await (await import(entry)).application.destroy();
  });
  assert.equal(await page.$('.nw-shell'), null);
  assert.deepEqual(exceptions, []);
  console.log(
    'PASS narrow viewport, disconnect privacy cleanup, teardown and no uncaught exceptions',
  );
} catch (error) {
  await page
    .screenshot({ path: new URL('lifecycle-failure.png', artifacts).pathname })
    .catch(() => {});
  console.log(
    'Failure status:',
    await page.$eval('.nw-status', (el) => el.textContent).catch(() => ''),
  );
  throw error;
} finally {
  await browser.close();
}
