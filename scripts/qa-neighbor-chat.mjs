/** Text chat UI with real session/native middleware and a synthetic provider transport. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import puppeteer from 'puppeteer';
import { createBrowserViteConfig } from '../build/vite.js';
import {
  createInferenceGateway,
  readInferenceConfig,
} from '../server/workspace/inference.js';
import { neighborWorkspacePlugin } from '../server/workspace/plugin.js';
import { apiNotFoundPlugin } from '../server/standalone/api-not-found.js';

const root = await mkdtemp(join(tmpdir(), 'neighbor-chat-browser-'));
const evidence = new URL(
  '../../research/unified-world/inference-foundation/',
  import.meta.url,
);
await mkdir(evidence, { recursive: true });
const previousDirectory = process.env.NEIGHBOR_DATA_DIR;
process.env.NEIGHBOR_DATA_DIR = join(root, 'data');
let enabled = false;
const requests = [];
const transport = createInferenceGateway({
  config: readInferenceConfig({
    NEIGHBOR_AI_ENABLED: '1',
    NEIGHBOR_AI_CHAT_URL: 'https://fixture.invalid/chat/completions',
    NEIGHBOR_AI_API_KEY: 'synthetic-only',
    NEIGHBOR_AI_MODEL: 'fixture-text',
  }),
  fetchImpl: async (url, options) => {
    requests.push(JSON.parse(options.body));
    return Response.json({
      id: 'fixture-answer',
      created: 1,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content:
              'Synthetic provider answer: <script>not executable</script>',
          },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 8, completion_tokens: 12, total_tokens: 20 },
    });
  },
});
const inference = {
  models: () => (enabled ? transport.models() : { object: 'list', data: [] }),
  complete: (...args) => transport.complete(...args),
};
const server = await createServer({
  configFile: false,
  ...createBrowserViteConfig({
    plugins: [neighborWorkspacePlugin({ inference }), apiNotFoundPlugin()],
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
  await page.click('.nd-dock [data-app-id="agent"]');
  const click = async (label) => {
    await page.waitForFunction(
      (label) =>
        [
          ...document.querySelectorAll(
            '.nd-window[data-app-id="agent"] button',
          ),
        ].some((b) => b.textContent === label && !b.disabled),
      { timeout: 30000 },
      label,
    );
    await page.evaluate(
      (label) =>
        [...document.querySelectorAll('.nd-window[data-app-id="agent"] button')]
          .find((b) => b.textContent === label && !b.disabled)
          .click(),
      label,
    );
  };
  await click('Chat');
  await page.waitForFunction(() =>
    document
      .querySelector('.nd-window[data-app-id="agent"]')
      ?.textContent.includes('Chat is not available yet.'),
  );
  await page.screenshot({
    path: new URL('chat-unavailable.png', evidence).pathname,
  });
  enabled = true;
  await click('Refresh');
  await page.waitForSelector(
    'textarea[name="agent-chat-text"]:not([disabled])',
  );
  await page.type(
    'textarea[name="agent-chat-text"]',
    'Synthetic typed message only',
  );
  await click('Send');
  await page.waitForFunction(() =>
    document
      .querySelector('.nw-chat-transcript')
      ?.textContent.includes('Synthetic provider answer'),
  );
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].messages, [
    { role: 'user', content: 'Synthetic typed message only' },
  ]);
  assert.equal(
    await page.$$eval('.nw-chat-transcript script', (nodes) => nodes.length),
    0,
  );
  await page.screenshot({
    path: new URL('chat-fixture.png', evidence).pathname,
  });
  await page.setViewport({ width: 390, height: 844 });
  await page.screenshot({
    path: new URL('chat-mobile.png', evidence).pathname,
  });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth + 1,
  );
  assert.equal(overflow, false);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => document.querySelector('.nw-status')?.textContent === 'Saved locally',
    { timeout: 60000 },
  );
  await page.click('.nd-dock [data-app-id="agent"]');
  await click('Chat');
  await page.waitForSelector(
    'textarea[name="agent-chat-text"]:not([disabled])',
  );
  assert.equal(
    await page.$eval('.nw-chat-transcript', (n) => n.textContent),
    '',
  );
  assert.equal(errors.length, 0, JSON.stringify(errors));
  const result = {
    automaticDevelopmentSession: true,
    disabledState: true,
    configuredFixtureTextChat: true,
    explicitTextOnly: true,
    literalModelMarkup: true,
    reloadClearsConversation: true,
    mobileOverflow: false,
    outboundRequests: requests.length,
    uncaughtExceptions: errors,
    liveProviderAcceptance: 'NOT_RUN',
  };
  await writeFile(
    new URL('browser-result.json', evidence),
    JSON.stringify(result, null, 2) + '\n',
  );
  console.info(JSON.stringify(result));
} catch (error) {
  const page = (await browser?.pages())?.find((p) =>
    p.url().startsWith(origin),
  );
  if (page) {
    console.info(
      await page.evaluate(
        () =>
          document.querySelector('.nd-window[data-app-id="agent"]')
            ?.textContent,
      ),
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
