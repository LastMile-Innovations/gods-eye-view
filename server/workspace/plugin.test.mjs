import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createWorkspaceHandler, neighborWorkspacePlugin } from './plugin.js';

async function setup(t, options = {}) {
  const calls = [];
  const native = {
    async execute(command) {
      calls.push(command);
      return { items: [], workspace: 'authorized-local', sequence: 1 };
    },
  };
  const handler = createWorkspaceHandler({
    native,
    ...options,
  });
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, body, extra = {}) =>
    fetch(`${base}/api/world/v1${path}`, {
      ...(body === undefined
        ? {}
        : { method: 'POST', body: JSON.stringify(body) }),
      headers: {
        Origin: base,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...extra,
      },
      redirect: 'error',
    });
  const pair = async () => {
    const res = await request('/connect', {});
    assert.equal(res.status, 200);
    const cookie = res.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly; SameSite=Strict/);
    const { csrf } = await res.json();
    return { Cookie: cookie.split(';')[0], 'X-Neighbor-CSRF': csrf };
  };
  return { request, pair, calls, base };
}
test('disconnected session discovery returns only public state without native access', async (t) => {
  const { request, calls } = await setup(t);
  const response = await request('/session');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    paired: false,
    mode: 'local-development',
  });
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal((await request('/query', {})).status, 401);
  assert.equal(calls.length, 0);
});
test('change inbox uses authenticated account routing, CSRF and fixed native operations', async (t) => {
  const { request, pair, calls } = await setup(t);
  assert.equal((await request('/change-inbox')).status, 401);
  assert.equal((await request('/change-inbox/poll', { key: 'x' })).status, 401);
  const headers = await pair();
  assert.equal(
    (
      await request(
        '/change-inbox/poll',
        { key: 'x' },
        { Cookie: headers.Cookie },
      )
    ).status,
    403,
  );
  for (const input of [
    [],
    {},
    { key: 'x', op: 'write' },
    { key: 'x', principal: 'forged' },
  ])
    assert.equal(
      (await request('/change-inbox/poll', input, headers)).status,
      400,
    );
  assert.equal(
    (
      await request(
        '/change-inbox/ack',
        { key: 'x', expected: 7, delivery: 'y' },
        headers,
      )
    ).status,
    400,
  );
  assert.equal(calls.length, 0);
  assert.equal(
    (await request('/change-inbox', undefined, headers)).status,
    200,
  );
  assert.equal(
    (await request('/change-inbox/poll', { key: 'x' }, headers)).status,
    200,
  );
  const response = await request(
    '/change-inbox/ack',
    { key: 'z', expected: '7', delivery: 'y' },
    headers,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(calls, [
    { op: 'changeInbox' },
    { op: 'pollChangeInbox', key: 'x' },
    { op: 'ackChangeInbox', key: 'z', expected: '7', delivery: 'y' },
  ]);
});
test('sync binds to the authenticated store, requires CSRF and never accepts command or principal overrides', async (t) => {
  const { request, pair, calls } = await setup(t);
  assert.equal((await request('/sync', {})).status, 401);
  const headers = await pair();
  assert.equal(
    (await request('/sync', {}, { Cookie: headers.Cookie })).status,
    403,
  );
  for (const body of [
    [],
    null,
    { op: 'snapshot' },
    { principal: 'forged' },
    { cursor: {}, command: { op: 'write' } },
  ]) {
    assert.equal((await request('/sync', body, headers)).status, 400);
  }
  assert.equal(calls.length, 0);
  const cursor = { version: 1, workspace: 'fixture', sequence: '1' };
  const result = await request('/sync', { cursor }, headers);
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.deepEqual(calls, [{ op: 'sync', cursor }]);
});
test('unauthenticated, forged Origin, forwarded and missing-CSRF requests cannot read or mutate', async (t) => {
  const { request, pair, calls } = await setup(t);
  assert.equal((await request('/query', {})).status, 401);
  const headers = await pair();
  assert.equal((await request('/query', {}, headers)).status, 200);
  assert.equal(
    (await request('/commands', { op: 'write' }, { Cookie: headers.Cookie }))
      .status,
    403,
  );
  assert.equal(
    (
      await request(
        '/query',
        {},
        { ...headers, Origin: 'https://evil.example' },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        '/query',
        {},
        { ...headers, 'X-Forwarded-For': '127.0.0.1' },
      )
    ).status,
    403,
  );
  assert.equal(calls.length, 1);
});
test('automatic development sessions coexist and logout invalidates only its cookie', async (t) => {
  const { request, pair, calls } = await setup(t);
  const headers = await pair();
  const other = await pair();
  assert.notEqual(other.Cookie, headers.Cookie);
  assert.equal((await request('/logout', {}, headers)).status, 200);
  assert.equal((await request('/query', {}, headers)).status, 401);
  assert.equal((await request('/query', {}, other)).status, 200);
  assert.equal(calls.length, 1);
});
test('permission attestation and file type are required, unknown operations are refused', async (t) => {
  const { request, pair, calls } = await setup(t);
  const headers = await pair();
  assert.equal(
    (
      await request(
        '/commands',
        {
          op: 'import',
          payload: { kind: 'document', title: 'private.md' },
          original: 'private',
        },
        headers,
      )
    ).status,
    400,
  );
  assert.equal(
    (await request('/commands', { op: 'delete', actor: 'owner' }, headers))
      .status,
    400,
  );
  assert.equal(calls.length, 0);
});
test('session expiry, malformed body and over-limit requests fail before native work', async (t) => {
  let time = 1000;
  const { request, pair, calls } = await setup(t, { now: () => time });
  const headers = await pair();
  assert.equal(
    (
      await request(
        '/commands',
        { original: 'x'.repeat(8 * 1024 * 1024) },
        headers,
      )
    ).status,
    413,
  );
  time += 8 * 60 * 60 * 1000;
  assert.equal((await request('/query', {}, headers)).status, 401);
  assert.equal(calls.length, 0);
});
test('native conflict and unknown result preserve their distinct statuses', async (t) => {
  let code = 'CONFLICT';
  const { request, pair } = await setup(t, {
    native: {
      async execute() {
        return { error: { code } };
      },
    },
  });
  const headers = await pair();
  const input = {
    op: 'write',
    key: '11111111111111111111111111111111',
    payload: {},
  };
  assert.equal((await request('/commands', input, headers)).status, 409);
  code = 'UNKNOWN_OUTCOME';
  assert.equal((await request('/commands', input, headers)).status, 503);
});

test('private native storage is denied through Vite static and filesystem routes', () => {
  const config = neighborWorkspacePlugin().config();
  assert.ok(config.server.fs.deny.includes('**/.neighbor-world/**'));
  assert.ok(
    config.server.fs.deny.some((entry) =>
      entry.endsWith('/.neighbor-world/**'),
    ),
  );
});

test('HTTP inference never dispatches native fixture output, including generic commands and journal recovery', async (t) => {
  const { request, pair, calls } = await setup(t);
  assert.equal((await request('/v1/models')).status, 401);
  const headers = await pair();
  const catalog = await request('/v1/models', undefined, headers);
  assert.deepEqual(await catalog.json(), { object: 'list', data: [] });
  for (const [path, input] of [
    [
      '/v1/chat/completions',
      { messages: [{ role: 'user', content: 'Hello' }] },
    ],
    ['/v1/responses', { input: 'Hello' }],
    ['/v1/embeddings', { input: 'Hello' }],
    [
      '/qh/v1/execute',
      {
        operation: 'generate',
        execution: { strategy: 'direct', interaction: 'sync' },
      },
    ],
    [
      '/commands',
      {
        op: 'qhExecute',
        key: '11111111111111111111111111111111',
        operation: 'generate',
        execution: { strategy: 'direct', interaction: 'sync' },
      },
    ],
    ['/qh/v1/missions', { key: '11111111111111111111111111111111' }],
  ]) {
    const response = await request(path, input, headers);
    assert.equal(response.status, 503, path);
    assert.equal((await response.json()).error.code, 'INFERENCE_UNAVAILABLE');
  }
  assert.equal(calls.length, 0);
  assert.equal(
    (await request('/qh/v1/status', undefined, headers)).status,
    200,
  );
  assert.equal(calls.at(-1).op, 'qhStatus');
  const workflow = await request(
    '/qh/v1/execute',
    {
      operation: 'execute',
      execution: { strategy: 'workflow', interaction: 'sync' },
      workflowId: 'synthetic-id',
    },
    headers,
  );
  assert.equal(workflow.status, 200);
  assert.equal(calls.at(-1).op, 'qhExecute');
});

test('configured text transport remains behind session and CSRF; no context lookup or native template fallback', async (t) => {
  const inputs = [];
  const inference = {
    models: () => ({ object: 'list', data: [{ id: 'qh/chat' }] }),
    complete: async (input, { account, signal }) => {
      inputs.push(input);
      assert.ok(account);
      assert.ok(signal);
      return { choices: [{ message: { content: 'Fixture provider reply' } }] };
    },
  };
  const { request, pair, calls } = await setup(t, { inference });
  const input = { messages: [{ role: 'user', content: 'Explicit text only' }] };
  assert.equal((await request('/v1/chat/completions', input)).status, 401);
  const headers = await pair();
  assert.equal(
    (await request('/v1/chat/completions', input, { Cookie: headers.Cookie }))
      .status,
    403,
  );
  const response = await request('/v1/chat/completions', input, headers);
  assert.equal(response.status, 200);
  assert.equal(
    (await response.json()).choices[0].message.content,
    'Fixture provider reply',
  );
  assert.deepEqual(inputs, [input]);
  assert.equal(calls.length, 0);
});

test('resume cannot execute stored simulated commands; real read workflow recovery is admitted', async (t) => {
  let profile = null;
  let kind = 'qhExecute';
  const calls = [];
  const { request, pair } = await setup(t, {
    native: {
      async execute(cmd) {
        calls.push(cmd);
        if (cmd.op === 'operation') return { kind, executionProfile: profile };
        return { status: 'committed' };
      },
    },
  });
  const headers = await pair();
  assert.equal(
    (await request('/operations/fixture/resume', {}, headers)).status,
    503,
  );
  assert.equal(
    calls.some((c) => c.op === 'resume'),
    false,
  );
  profile = 'native_read_workflow';
  assert.equal(
    (await request('/operations/fixture/resume', {}, headers)).status,
    200,
  );
  kind = 'qhMissionAction';
  assert.equal(
    (await request('/operations/fixture/resume', {}, headers)).status,
    503,
  );
});

test('draft endpoints preserve session and CSRF boundaries and canonical QID paths', async (t) => {
  const { base, request, pair, calls } = await setup(t);
  assert.equal((await request('/drafts')).status, 401);
  const headers = await pair();
  const input = {
    key: '001122',
    payload: {
      appId: 'projects',
      formId: 'projects:create:v1',
      fields: { 'project-title': 'Private draft' },
    },
  };
  const put = (extra) =>
    fetch(`${base}/api/world/v1/drafts`, {
      method: 'PUT',
      headers: { Origin: base, 'Content-Type': 'application/json', ...extra },
      body: JSON.stringify(input),
    });
  assert.equal((await put({ Cookie: headers.Cookie })).status, 403);
  assert.equal((await put(headers)).status, 200);
  assert.equal(calls.at(-1).op, 'saveDraft');
  assert.equal(
    (await request('/drafts/q1_TEST-CANONICAL', undefined, headers)).status,
    200,
  );
  assert.equal(calls.at(-1).op, 'draft');
  assert.equal(calls.at(-1).id, 'q1_TEST-CANONICAL');
  assert.equal((await request('/drafts', undefined, headers)).status, 200);
  await request('/logout', {}, headers);
  assert.equal((await request('/drafts', undefined, headers)).status, 401);
});
test('recovery status is authenticated, no-store and contains only an account-local phase', async (t) => {
  let calls = 0;
  const { request, pair } = await setup(t, {
    native: {
      execute: async () => {
        calls++;
        throw new Error('wrong queue');
      },
      recoveryStatus: () => ({
        state: 'recovering',
        key: 'private-key',
        directory: '/private',
      }),
    },
  });
  assert.equal((await request('/change-inbox/recovery')).status, 401);
  const headers = await pair();
  const response = await request('/change-inbox/recovery', undefined, headers);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.deepEqual(await response.json(), { state: 'recovering' });
  assert.equal(calls, 0);
});
