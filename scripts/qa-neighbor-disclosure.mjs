import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';
const evidence = new URL(
  '../../research/unified-world/build-004/',
  import.meta.url,
);
const browser = await puppeteer.launch({
  headless: true,
  executablePath:
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const scope = '.nd-window[data-app-id=evidence]';
const click = async (s, label) =>
  assert.ok(
    await page.evaluate(
      ({ s, label }) => {
        const b = [...document.querySelectorAll(`${s} button`)].find(
          (b) => b.textContent.trim() === label,
        );
        b?.click();
        return !!b;
      },
      { s, label },
    ),
    `Missing ${label}`,
  );
const card = async (title, label) =>
  assert.ok(
    await page.evaluate(
      ({ title, label }) => {
        const a = [...document.querySelectorAll('.nw-service-card')].find(
          (a) => a.querySelector('h2')?.textContent === title,
        );
        const b = [...a.querySelectorAll('button')].find(
          (b) => b.textContent === label,
        );
        b?.click();
        return !!b;
      },
      { title, label },
    ),
  );
const set = async (selector, value) => {
  await page.$eval(selector, (el) => {
    el.value = '';
  });
  await page.type(selector, value);
};
const check = async (legend, label, checked = true) =>
  page.evaluate(
    ({ legend, label, checked }) => {
      const group = [
        ...document.querySelectorAll('.nw-dialog[open] fieldset'),
      ].find((f) => f.querySelector('legend')?.textContent === legend);
      const control = [...group.querySelectorAll('label')]
        .find((l) => l.textContent === label)
        ?.querySelector('input');
      if (!control) throw new Error('Missing reference ' + label);
      control.checked = checked;
    },
    { legend, label, checked },
  );
const submit = async () => {
  const prior = await page.$eval('.nw-status', (e) => e.textContent);
  await page.click('.nw-dialog[open] button[type=submit]');
  await page.waitForFunction(
    (prior) =>
      document
        .querySelector('.nw-status')
        .textContent.includes('Committed revision') &&
      document.querySelector('.nw-status').textContent !== prior &&
      !document.querySelector('.nw-dialog:not(.nd-launcher)[open]'),
    { timeout: 30000 },
    prior,
  );
};
const network = () =>
  page.evaluate(async () =>
    (await fetch('/api/world/v1/evidence-network')).json(),
  );
const tab = async (label) =>
  assert.ok(
    await page.evaluate(
      ({ scope, label }) => {
        const b = [
          ...document.querySelectorAll(scope + ' .nw-evidence-tabs button'),
        ].find((b) => b.textContent.startsWith(label + ' ·'));
        b?.click();
        return !!b;
      },
      { scope, label },
    ),
  );
const fixture = await mkdtemp(join(tmpdir(), 'neighbor-disclosure-qa-'));
const path = join(fixture, 'PRIVATE_SOURCE_TITLE.txt');
const raw = Buffer.from('Header\r\né SECRET public\r\n');
await writeFile(path, raw);
const downloads = await mkdtemp(join(tmpdir(), 'neighbor-dossier-download-'));
try {
  await page.setViewport({ width: 1440, height: 1000 });
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
  await page.click('.nd-dock [data-app-id=evidence]');
  await click(scope, 'Preserve evidence');
  await (await page.$('.nw-dialog[open] input[type=file]')).uploadFile(path);
  await page.type('[name=evidence-notes]', 'PRIVATE_CONTEXT');
  await page.click('.nw-dialog[open] input[type=checkbox]');
  await submit();
  let net = await network();
  const parent = net.artifacts.find(
    (a) => a.payload.title === 'PRIVATE_SOURCE_TITLE.txt',
  );
  assert.ok(parent);
  await card('PRIVATE_SOURCE_TITLE.txt', 'Create redacted text derivative');
  await page.waitForSelector('[aria-label="Original plain text"]');
  assert.equal(
    await page.$eval('[aria-label="Original plain text"]', (el) => el.value),
    'Header\né SECRET public\n',
  );
  await page.$eval('[aria-label="Original plain text"]', (el) => {
    el.focus();
    el.setSelectionRange(9, 15);
  });
  await click('.nw-dialog[open]', 'Redact selected text');
  assert.equal(
    await page.$eval('[name=redaction-ranges]', (el) => el.value),
    '[[11,17]]',
  );
  await page.type('[name=redaction-reason]', 'PRIVATE_REDACTION_REASON');
  assert.ok(
    (await page.$eval('.nw-dialog[open]', (el) => el.textContent)).includes(
      'é [REDACTED] public',
    ),
  );
  await submit();
  net = await network();
  let child = net.artifacts.find((a) => a.payload.title === 'Reviewed excerpt');
  assert.equal(child.payload.dependsOn, parent.id);
  const original = await page.evaluate(
    async (id) =>
      (await (await fetch(`/api/world/v1/evidence/${id}/original`)).json())
        .bytes,
    parent.id,
  );
  assert.deepEqual(Buffer.from(original), raw);
  await card('Reviewed excerpt', 'Review lifecycle');
  await page.select('[aria-label="Next lifecycle state"]', 'under_review');
  await page.type(
    '[name=review-note]',
    'Review entire excerpt for local disclosure',
  );
  await submit();
  console.log(
    'PASS actual UTF-8 chooser intake, byte-boundary selection preview, native child lineage and unchanged parent bytes',
  );
  await click(scope, 'Create claim');
  await page.type('[name=claim-text]', 'Initial attribution awaiting review');
  await check('Supporting artifacts', 'PRIVATE_SOURCE_TITLE.txt');
  await page.type(
    '[name=claim-rationale]',
    'Limited excerpt; no automatic factual verification.',
  );
  await submit();
  await click(scope, 'Create casebook');
  await page.type('[name=casebook-title]', 'PRIVATE_BOOK');
  await page.type('[name=casebook-description]', 'PRIVATE_DESCRIPTION');
  await check('Artifacts', 'Reviewed excerpt');
  await check('Claims', 'Initial attribution awaiting review');
  await submit();
  await tab('Casebooks');
  await card('PRIVATE_BOOK', 'Edit casebook');
  assert.equal(
    await page.$eval('[name=casebook-description]', (e) => e.value),
    'PRIVATE_DESCRIPTION',
  );
  await set('[name=casebook-description]', 'PRIVATE_REVISED_DESCRIPTION');
  await submit();
  const approve = async () => {
    await tab('Casebooks');
    await card('PRIVATE_BOOK', 'Approve local dossier');
    await page.type('[name=disclosure-title]', 'Selected evidence excerpt');
    await check('Reviewed text derivatives', 'Reviewed excerpt');
    const claims = (await network()).claims;
    await check('Claims', claims[0].payload.text);
    await click('.nw-dialog[open]', 'Inspect derived text');
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.nw-dialog[open] pre')].some(
        (e) => e.textContent === 'Header\r\né [REDACTED] public\r\n',
      ),
    );
    await page.click('[name=disclosure-consent]');
    await submit();
  };
  await approve();
  net = await network();
  const first = net.disclosures[0];
  assert.equal(first.readiness, 'ready');
  await tab('Dossiers');
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: downloads,
  });
  await card('Selected evidence excerpt', 'Download reviewed dossier');
  let files = [];
  for (let i = 0; i < 100; i++) {
    files = await readdir(downloads);
    if (files.includes('evidence-dossier.json')) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(files.includes('evidence-dossier.json'));
  const exported = JSON.parse(
    await readFile(join(downloads, 'evidence-dossier.json'), 'utf8'),
  );
  assert.equal(exported.artifacts[0].text, 'Header\r\né [REDACTED] public\r\n');
  assert.deepEqual(exported.claims[0].supporting, [0]);
  assert.equal(exported.claims[0].automaticallyVerified, false);
  const wire = JSON.stringify(exported);
  for (const secret of [
    'SECRET',
    'PRIVATE_',
    parent.id,
    child.id,
    'originGroup',
    'coordinates',
    'parentSha256',
  ])
    assert.ok(!wire.includes(secret), 'leaked ' + secret);
  await writeFile(
    new URL('dossier-fixture.json', evidence),
    JSON.stringify(exported, null, 2) + '\n',
  );
  console.log(
    'PASS native casebook editing, explicit dossier approval and actual downloaded JSON; no private originals/context/IDs',
  );
  await tab('Claims');
  await card('Initial attribution awaiting review', 'Correct evidence claim');
  assert.equal(
    await page.$eval('[name=claim-text]', (e) => e.value),
    'Initial attribution awaiting review',
  );
  assert.equal(
    await page.$eval('[name=claim-rationale]', (e) => e.value),
    'Limited excerpt; no automatic factual verification.',
  );
  await set('[name=claim-text]', 'Attribution refuted after correction');
  await page.select('[aria-label="Reviewer assessment"]', 'refuted');
  await check('Supporting artifacts', 'PRIVATE_SOURCE_TITLE.txt', false);
  await check('Contradicting artifacts', 'PRIVATE_SOURCE_TITLE.txt');
  await set(
    '[name=claim-rationale]',
    'Counter evidence requires correcting the attribution.',
  );
  await submit();
  await card('Attribution refuted after correction', 'Revision comparison');
  await page.waitForSelector('.nw-revision-compare');
  const history = await page.$eval(
    '.nw-revision-compare',
    (e) => e.textContent,
  );
  assert.ok(history.includes('Initial attribution awaiting review'));
  assert.ok(history.includes('Attribution refuted after correction'));
  await page.screenshot({
    path: new URL('correction-history.png', evidence).pathname,
  });
  await click('.nw-dialog[open]', 'Close');
  net = await network();
  assert.equal(
    net.disclosures.find((d) => d.id === first.id).readiness,
    'stale',
  );
  assert.equal(
    await page.evaluate(
      async (id) =>
        (await fetch(`/api/world/v1/disclosures/${id}/dossier`)).status,
      first.id,
    ),
    409,
  );
  await approve();
  net = await network();
  const fresh = net.disclosures.find((d) => d.id !== first.id);
  assert.equal(fresh.readiness, 'ready');
  const corrected = await page.evaluate(
    async (id) =>
      await (await fetch(`/api/world/v1/disclosures/${id}/dossier`)).json(),
    fresh.id,
  );
  assert.equal(corrected.claims[0].status, 'refuted');
  assert.deepEqual(corrected.claims[0].contradicting, [0]);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector(scope);
  await tab('Dossiers');
  net = await network();
  assert.equal(
    net.disclosures.find((d) => d.id === first.id).readiness,
    'stale',
  );
  assert.equal(
    net.disclosures.find((d) => d.id === fresh.id).readiness,
    'ready',
  );
  // Latest approval is the first dossier card after native revision sorting.
  await card('Selected evidence excerpt', 'Withdraw dossier approval');
  await page.type(
    '[name=withdrawal-note]',
    'Local approval withdrawn after review',
  );
  await submit();
  assert.equal(
    await page.evaluate(
      async (id) =>
        (await fetch(`/api/world/v1/disclosures/${id}/dossier`)).status,
      fresh.id,
    ),
    404,
  );
  await page.screenshot({
    path: new URL('dossier-desktop.png', evidence).pathname,
  });
  await page.setViewport({ width: 390, height: 844 });
  await page.screenshot({
    path: new URL('dossier-mobile.png', evidence).pathname,
  });
  console.log(
    'PASS claim correction and two real revision columns, stale approval refusal, fresh corrected dossier, reload and withdrawal',
  );
  await click('.nw-header', 'Disconnect');
  assert.ok(
    !(await page.$eval(scope, (e) => e.textContent)).includes(
      'Selected evidence excerpt',
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS 390px layout, disconnect privacy cleanup and zero uncaught page exceptions',
  );
} catch (error) {
  await page.screenshot({
    path: new URL('browser-final-failure.png', evidence).pathname,
  });
  throw error;
} finally {
  await browser.close();
}
