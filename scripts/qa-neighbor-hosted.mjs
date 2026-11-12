/** Built frontend + HTTPS gateway + signed fixture OIDC + real native storage. No live IdP/provider acceptance. */
import assert from 'node:assert/strict';
import https from 'node:https';
import {
  generateKeyPairSync,
  sign,
  createHash,
  randomBytes,
} from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';
import { createHostedApplication } from '../server/hosted/application.js';
import { createOidcClient } from '../server/hosted/oidc.js';
import { readHostedConfig } from '../server/hosted/config.js';

const evidence = new URL(
  '../../research/unified-world/hosted-foundation/',
  import.meta.url,
);
await mkdir(evidence, { recursive: true });
const directory = await mkdtemp(join(tmpdir(), 'neighbor-hosted-browser-'));
execFileSync(
  'openssl',
  [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    join(directory, 'key.pem'),
    '-out',
    join(directory, 'cert.pem'),
    '-days',
    '1',
    '-subj',
    '/CN=localhost',
  ],
  { stdio: 'ignore' },
);
const issuer = 'https://identity.fixture';
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const jwk = {
  ...publicKey.export({ format: 'jwk' }),
  alg: 'RS256',
  kid: 'browser-fixture',
  use: 'sig',
};
const codes = new Map();
let application, origin;
const server = https.createServer(
  {
    key: await readFile(join(directory, 'key.pem')),
    cert: await readFile(join(directory, 'cert.pem')),
  },
  (req, res) => {
    const url = new URL(req.url, origin);
    if (url.pathname === '/fixture/authorize') {
      const code = randomBytes(24).toString('hex');
      codes.set(code, {
        nonce: url.searchParams.get('nonce'),
        challenge: url.searchParams.get('code_challenge'),
      });
      res.writeHead(302, {
        Location: `${origin}/auth/callback?code=${code}&state=${url.searchParams.get('state')}`,
      });
      res.end();
    } else void application.handler(req, res);
  },
);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
origin = `https://localhost:${server.address().port}`;
const config = readHostedConfig({
  NEIGHBOR_PUBLIC_ORIGIN: origin,
  NEIGHBOR_OIDC_ISSUER: issuer,
  NEIGHBOR_OIDC_CLIENT_ID: 'neighbor-browser',
  NEIGHBOR_OIDC_CLIENT_SECRET: 'synthetic-secret',
  NEIGHBOR_TENANT_KEY: randomBytes(32).toString('base64'),
  NEIGHBOR_HOSTED_DATA_DIR: join(directory, 'data'),
});
const encode = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
const oidc = await createOidcClient({
  ...config,
  async fetchImpl(input, options) {
    const url = String(input);
    if (url.includes('/.well-known/'))
      return Response.json({
        issuer,
        authorization_endpoint: `${origin}/fixture/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        response_types_supported: ['code'],
        id_token_signing_alg_values_supported: ['RS256'],
      });
    if (url === `${issuer}/jwks`) return Response.json({ keys: [jwk] });
    if (url === `${issuer}/token`) {
      const params = new URLSearchParams(options.body);
      const code = codes.get(params.get('code'));
      codes.delete(params.get('code'));
      assert.ok(code);
      assert.equal(
        createHash('sha256')
          .update(params.get('code_verifier'))
          .digest('base64url'),
        code.challenge,
      );
      const now = Math.floor(Date.now() / 1000);
      const jwt = `${encode({ alg: 'RS256', kid: 'browser-fixture' })}.${encode({ iss: issuer, sub: 'synthetic-browser-owner', aud: 'neighbor-browser', nonce: code.nonce, iat: now, exp: now + 300 })}`;
      return Response.json({
        access_token: 'fixture-only',
        token_type: 'Bearer',
        id_token: `${jwt}.${sign('RSA-SHA256', Buffer.from(jwt), privateKey).toString('base64url')}`,
      });
    }
    assert.fail(`Unexpected fixture URL: ${url}`);
  },
});
application = createHostedApplication({ config, oidc });
let browser;
const errors = [];
try {
  browser = await puppeteer.launch({
    headless: true,
    acceptInsecureCerts: true,
    executablePath:
      process.env.PUPPETEER_EXECUTABLE_PATH ||
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: [
      '--no-sandbox',
      '--allow-insecure-localhost',
      '--use-gl=angle',
      '--use-angle=swiftshader',
    ],
  });
  const page = await browser.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewport({ width: 1440, height: 960 });
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('.nw-sign-in a[href="/auth/login"]', {
    timeout: 60000,
  });
  assert.equal(await page.$('[name=pairing]'), null);
  await page.waitForFunction(
    () =>
      document.querySelector('#loading-screen')?.classList.contains('hidden'),
    { timeout: 30000 },
  );
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector('#loading-screen')).opacity ===
      '0',
    { timeout: 30000 },
  );
  await page.screenshot({
    path: new URL('hosted-sign-in.png', evidence).pathname,
  });
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    page.click('.nw-sign-in a'),
  ]);
  await page.waitForFunction(
    () => document.querySelector('.nw-status')?.textContent === 'Saved',
    { timeout: 60000 },
  );
  const cookies = await page.cookies();
  const cookie = cookies.find((c) => c.name === '__Host-neighbor_session');
  assert.ok(cookie?.secure && cookie.httpOnly);
  const record = await page.evaluate(async () => {
    const session = await (await fetch('/api/world/v1/session')).json();
    const response = await fetch('/api/world/v1/commands', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Neighbor-CSRF': session.csrf,
      },
      body: JSON.stringify({
        op: 'write',
        key: '77777777777777777777777777777777',
        payload: {
          kind: 'need',
          title: 'Hosted browser continuity',
          description: 'Synthetic hosted acceptance record',
          status: 'open',
          refs: [],
        },
      }),
    });
    if (!response.ok) throw new Error(`native write ${response.status}`);
    return response.json();
  });
  assert.equal(record.status, 'committed');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => document.querySelector('.nw-status')?.textContent === 'Saved',
    { timeout: 60000 },
  );
  assert.equal(await page.$('[name=pairing]'), null);
  const snapshot = await page.evaluate(async () => {
    const session = await (await fetch('/api/world/v1/session')).json();
    return (
      await fetch('/api/world/v1/query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Neighbor-CSRF': session.csrf,
        },
        body: '{}',
      })
    ).json();
  });
  assert.ok(snapshot.items.some((i) => i.id === record.id));
  await page.click('.nd-dock [data-app-id="records"]');
  await page.waitForFunction(() =>
    document
      .querySelector('[data-app-id="records"].nd-window')
      ?.textContent.includes('Hosted browser continuity'),
  );
  await page.screenshot({
    path: new URL('hosted-workspace.png', evidence).pathname,
  });
  await page.setViewport({ width: 390, height: 844 });
  await page.screenshot({
    path: new URL('hosted-mobile.png', evidence).pathname,
  });
  assert.deepEqual(errors, []);
  const receipt = {
    status: 'TESTED_LOCAL',
    fixtureOidc: true,
    signedTokenVerified: true,
    secureHttpOnlyCookie: true,
    nativeRecordRestoredAfterReload: true,
    automaticSessionRestore: true,
    pairingInputs: 0,
    uncaughtExceptions: errors,
    liveProviderAcceptance: 'NOT_RUN',
  };
  await writeFile(
    new URL('browser-result.json', evidence),
    JSON.stringify(receipt, null, 2),
  );
  console.info(JSON.stringify(receipt));
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
  await application.close();
  await rm(directory, { recursive: true, force: true });
}
