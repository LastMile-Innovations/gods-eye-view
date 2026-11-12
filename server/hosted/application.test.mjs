import {
  createInferenceGateway,
  readInferenceConfig,
} from '../workspace/inference.js';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHostedApplication } from './application.js';
import { readHostedConfig } from './config.js';

const origin = 'https://neighbor.example';
const nativeOnly = {
  skip: existsSync(
    process.env.NEIGHBOR_NATIVE_BIN ||
      fileURLToPath(
        new URL(
          '../../../Quanta/native/target/release/neighbor-workspace',
          import.meta.url,
        ),
      ),
  )
    ? false
    : 'Build the native workspace adapter first (npm run workspace:build)',
};
async function setup(t, options = {}) {
  const root =
    options.root || (await mkdtemp(join(tmpdir(), 'neighbor-hosted-')));
  await mkdir(join(root, 'dist'), { recursive: true });
  await writeFile(join(root, 'dist/index.html'), '<html>NeighborOS</html>');
  await writeFile(join(root, 'private.txt'), 'private');
  const config = readHostedConfig(
    {
      NEIGHBOR_PUBLIC_ORIGIN: origin,
      NEIGHBOR_OIDC_ISSUER: 'https://identity.example',
      NEIGHBOR_OIDC_CLIENT_ID: 'neighbor-test',
      NEIGHBOR_OIDC_CLIENT_SECRET: 'test-only-secret',
      NEIGHBOR_TENANT_KEY: Buffer.alloc(32, 7).toString('base64'),
      NEIGHBOR_HOSTED_DATA_DIR: join(root, 'private'),
    },
    { staticRoot: join(root, 'dist') },
  );
  const oidc = {
    async begin() {
      return {
        state: crypto.randomUUID(),
        nonce: 'fixture-nonce',
        verifier: 'fixture-verifier',
        url: 'https://identity.example/authorize',
      };
    },
    async complete(url) {
      if (url.searchParams.get('code') === 'failure')
        throw new Error('provider detail must stay private');
      return {
        iss: 'https://identity.example',
        sub: url.searchParams.get('code'),
        email: 'same@fixture.invalid',
      };
    },
  };
  for (const staticRoot of [config.dataRoot, join(config.dataRoot, 'public')])
    assert.throws(
      () =>
        readHostedConfig(
          {
            NEIGHBOR_PUBLIC_ORIGIN: origin,
            NEIGHBOR_OIDC_ISSUER: config.issuer,
            NEIGHBOR_OIDC_CLIENT_ID: config.clientId,
            NEIGHBOR_OIDC_CLIENT_SECRET: config.clientSecret,
            NEIGHBOR_TENANT_KEY: config.tenantKey.toString('base64'),
            NEIGHBOR_HOSTED_DATA_DIR: config.dataRoot,
          },
          { staticRoot },
        ),
      /CONFIG/,
    );
  const app = createHostedApplication({ config, oidc, ...options });
  const server = http.createServer(app.handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(async () => {
    await new Promise((r) => server.close(r));
    await app.close();
    if (!options.root) await rm(root, { recursive: true, force: true });
  });
  const request = (path, { body, headers, method } = {}) =>
    new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: server.address().port,
          path,
          method: method || (body === undefined ? 'GET' : 'POST'),
          headers: {
            Host: new URL(origin).host,
            ...(body === undefined
              ? {}
              : { Origin: origin, 'Content-Type': 'application/json' }),
            ...headers,
          },
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            const responseHeaders = new Headers();
            for (const [key, value] of Object.entries(res.headers))
              for (const item of Array.isArray(value) ? value : [value])
                if (item !== undefined) responseHeaders.append(key, item);
            resolve({
              status: res.statusCode,
              headers: responseHeaders,
              json: async () => JSON.parse(text),
              text: async () => text,
            });
          });
        },
      );
      req.on('error', reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  const login = async (subject) => {
    const start = await request('/auth/login');
    assert.equal(start.status, 302);
    const cookie = start.headers.get('set-cookie').split(';')[0];
    const state = decodeURIComponent(cookie.split('=')[1]);
    const path = `/auth/callback?code=${subject}&state=${state}`;
    const finish = await request(path, { headers: { Cookie: cookie } });
    assert.equal(finish.status, 302);
    const cookies = finish.headers.getSetCookie();
    const sessionCookie = cookies.find((c) =>
      c.startsWith('__Host-neighbor_session='),
    );
    assert.match(sessionCookie, /Secure; HttpOnly; SameSite=Lax; Path=\//);
    const session = await request('/api/world/v1/session', {
      headers: { Cookie: sessionCookie.split(';')[0] },
    });
    const data = await session.json();
    assert.equal(data.paired, true);
    assert.equal(data.mode, 'hosted');
    return {
      headers: {
        Cookie: sessionCookie.split(';')[0],
        'X-Neighbor-CSRF': data.csrf,
      },
      path,
      transactionCookie: cookie,
    };
  };
  return { request, login, config, root, app };
}

test('hosted startup refuses missing/insecure config and overlapping private/static roots', () => {
  assert.throws(() => readHostedConfig({}), /CONFIG/);
  assert.throws(
    () =>
      readHostedConfig({ NEIGHBOR_PUBLIC_ORIGIN: 'http://neighbor.example' }),
    /CONFIG/,
  );
});

test('anonymous discovery and public frontend require no pairing; private and development routes refuse', async (t) => {
  let workers = 0;
  const { request } = await setup(t, {
    nativeFactory: () => {
      workers++;
      throw new Error('must not start');
    },
  });
  const session = await request('/api/world/v1/session');
  assert.deepEqual(await session.json(), {
    paired: false,
    mode: 'hosted',
    signInPath: '/auth/login',
  });
  assert.equal((await request('/')).status, 200);
  assert.equal(
    (await request('/api/world/v1/query', { body: {} })).status,
    401,
  );
  for (const path of [
    '/api/world/v1/pair',
    '/api/world/v1/connect',
    '/api/setup/keys',
    '/api/mcp',
    '/server/workspace/plugin.js',
    '/.env',
    '/private.txt',
    '/api/unknown',
  ]) {
    assert.equal((await request(path, { body: {} })).status, 404, path);
  }
  assert.equal(workers, 0);
});

test('static asset traversal and symlink escape cannot reveal private JSON', async (t) => {
  const { root, request } = await setup(t);
  await writeFile(
    join(root, 'private.json'),
    JSON.stringify({ private: true }),
  );
  try {
    await symlink(join(root, 'private.json'), join(root, 'dist/escape.json'));
  } catch (error) {
    if (error.code === 'EPERM')
      return t.skip('Symlinks unavailable on this host');
    throw error;
  }
  for (const path of [
    '/escape.json',
    '/..%2fprivate.json',
    '/%2e%2e%2fprivate.json',
    '/.env',
    '/server/hosted/config.js',
  ]) {
    const response = await request(path);
    assert.equal(response.status, 404, path);
    assert.doesNotMatch(await response.text(), /"private":true/);
  }
});

test('login transactions are browser-bound, expire, reject provider errors and cannot be replayed', async (t) => {
  let clock = Date.now();
  const { request, login } = await setup(t, { now: () => clock });
  const auth = await login('alice');
  assert.equal(
    (await request(auth.path, { headers: { Cookie: auth.transactionCookie } }))
      .status,
    401,
  );
  const begin = await request('/auth/login');
  const cookie = begin.headers.get('set-cookie').split(';')[0];
  const state = cookie.split('=')[1];
  const callback = `/auth/callback?code=bob&state=${state}`;
  assert.equal((await request(callback)).status, 401);
  const failure = await request(`/auth/callback?code=failure&state=${state}`, {
    headers: { Cookie: cookie },
  });
  assert.equal(failure.status, 401);
  assert.doesNotMatch(await failure.text(), /provider detail/);
  const next = await request('/auth/login');
  const nextCookie = next.headers.get('set-cookie').split(';')[0];
  clock += 600_001;
  assert.equal(
    (
      await request(
        `/auth/callback?code=bob&state=${nextCookie.split('=')[1]}`,
        { headers: { Cookie: nextCookie } },
      )
    ).status,
    401,
  );
});

test(
  'two signed-in accounts get isolated native records, stable identities, CSRF and logout boundaries',
  nativeOnly,
  async (t) => {
    const { request, login } = await setup(t);
    const alice = await login('alice'),
      bob = await login('bob');
    const command = {
      op: 'write',
      key: '11111111111111111111111111111111',
      payload: {
        kind: 'need',
        title: 'Alice private need',
        description: 'Private',
        status: 'open',
        refs: [],
      },
    };
    const savedResponse = await request('/api/world/v1/commands', {
      body: command,
      headers: alice.headers,
    });
    assert.equal(savedResponse.status, 200);
    const saved = await savedResponse.json();
    const query = async (auth) =>
      (
        await request('/api/world/v1/query', {
          body: {},
          headers: auth.headers,
        })
      ).json();
    assert.equal((await query(alice)).items[0].id, saved.id);
    assert.equal((await query(bob)).items.length, 0);
    const draft = await request('/api/world/v1/drafts', {
      method: 'PUT',
      headers: alice.headers,
      body: {
        key: '33333333333333333333333333333333',
        payload: {
          appId: 'projects',
          formId: 'projects:create:v1',
          fields: { 'project-title': 'Alice unfinished project' },
        },
      },
    });
    assert.equal(draft.status, 200);
    const savedDraft = await draft.json();
    assert.equal(
      (
        await (
          await request('/api/world/v1/drafts', { headers: bob.headers })
        ).json()
      ).items.length,
      0,
    );
    assert.equal(
      (
        await request(`/api/world/v1/drafts/${savedDraft.id}`, {
          headers: bob.headers,
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await request(`/api/world/v1/records/${saved.id}/history`, {
          headers: bob.headers,
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await request('/api/world/v1/commands', {
          body: { ...command, principal: 'alice' },
          headers: bob.headers,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await request('/api/world/v1/query', {
          body: {},
          headers: { Cookie: alice.headers.Cookie },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await request('/api/world/v1/query', {
          body: {},
          headers: { ...alice.headers, Origin: 'https://evil.example' },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await request('/api/world/v1/query', {
          body: {},
          headers: { 'X-Forwarded-User': 'alice' },
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await request('/api/world/v1/logout', {
          body: {},
          headers: alice.headers,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await request('/api/world/v1/query', {
          body: {},
          headers: alice.headers,
        })
      ).status,
      401,
    );
    const again = await login('alice');
    assert.equal((await query(again)).items[0].id, saved.id);
    // Known-wrong oracle: forbidden cross-account visibility must fail this assertion.
    const forbidden = await query(bob);
    assert.throws(
      () => assert.ok(forbidden.items.some((item) => item.id === saved.id)),
      assert.AssertionError,
    );
  },
);

test(
  'hosted restart requires sign-in again and restores the same native account identity',
  nativeOnly,
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'neighbor-hosted-restart-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    let priorWorkspace, oldCookie;
    await t.test('first server', async (inner) => {
      const { login, request } = await setup(inner, { root });
      const auth = await login('alice');
      oldCookie = auth.headers.Cookie;
      const write = await request('/api/world/v1/commands', {
        headers: auth.headers,
        body: {
          op: 'write',
          key: '22222222222222222222222222222222',
          payload: {
            kind: 'need',
            title: 'Restart continuity',
            description: '',
            status: 'open',
            refs: [],
          },
        },
      });
      assert.equal(write.status, 200);
      priorWorkspace = (
        await (
          await request('/api/world/v1/query', {
            body: {},
            headers: auth.headers,
          })
        ).json()
      ).workspace;
    });
    await t.test('second server', async (inner) => {
      const { login, request } = await setup(inner, { root });
      assert.equal(
        (
          await request('/api/world/v1/operations', {
            headers: { Cookie: oldCookie },
          })
        ).status,
        401,
      );
      const auth = await login('alice');
      const snapshot = await (
        await request('/api/world/v1/query', {
          body: {},
          headers: auth.headers,
        })
      ).json();
      assert.equal(snapshot.workspace, priorWorkspace);
      assert.equal(snapshot.items[0].payload.title, 'Restart continuity');
    });
  },
);

test('absolute session expiry, login/session caps, duplicate cookies and host/origin spoofing fail closed', async (t) => {
  let clock = Date.now();
  const { request, login } = await setup(t, {
    now: () => clock,
    maxSessions: 1,
    maxTransactions: 1,
  });
  const auth = await login('alice');
  assert.equal(
    (
      await request('/api/world/v1/session', {
        headers: { Host: 'evil.example' },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request('/api/world/v1/session', {
        headers: {
          Cookie: auth.headers.Cookie,
          Origin: 'https://evil.example',
        },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request('/api/world/v1/operations', {
        headers: { Cookie: `${auth.headers.Cookie}; ${auth.headers.Cookie}` },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await request('/api/world/v1/logout', {
        body: {},
        headers: { Cookie: auth.headers.Cookie },
      })
    ).status,
    403,
  );
  const begin = await request('/auth/login');
  assert.equal(begin.status, 302);
  assert.equal((await request('/auth/login')).status, 429);
  const cookie = begin.headers.get('set-cookie').split(';')[0];
  assert.equal(
    (
      await request(`/auth/callback?code=bob&state=${cookie.split('=')[1]}`, {
        headers: { Cookie: cookie },
      })
    ).status,
    429,
  );
  clock += 28_800_001;
  assert.equal(
    (await request('/api/world/v1/operations', { headers: auth.headers }))
      .status,
    401,
  );
  assert.equal(
    (
      await (
        await request('/api/world/v1/session', { headers: auth.headers })
      ).json()
    ).paired,
    false,
  );
});

test(
  'hosted workflow validation and executed evaluations stay inside the signed-in account',
  nativeOnly,
  async (t) => {
    const { request, login } = await setup(t);
    const alice = await login('alice'),
      bob = await login('bob');
    const write = async (body) => {
      const r = await request('/api/world/v1/commands', {
        body,
        headers: alice.headers,
      });
      assert.equal(r.status, 200, await r.text());
      return r.json();
    };
    const saved = await write({
      op: 'qhSaveWorkflow',
      key: '88888888888888888888888888888881',
      payload: {
        workflowId: 'test.read.v1',
        title: 'Private hosted reads',
        origin: 'authored',
        stages: [{ id: 'records', action: 'quanta.query' }],
      },
    });
    await write({
      op: 'qhValidateWorkflow',
      key: '88888888888888888888888888888882',
      workflowId: saved.id,
      expected: saved.sequence,
    });
    const body = {
      operation: 'execute',
      execution: { strategy: 'workflow', interaction: 'sync' },
      workflowId: saved.id,
    };
    const read = await request('/api/world/v1/qh/v1/execute', {
      body,
      headers: alice.headers,
    });
    assert.equal(read.status, 200);
    assert.equal((await read.json()).executionMode, 'native_read_only');
    const other = await request('/api/world/v1/qh/v1/execute', {
      body,
      headers: bob.headers,
    });
    assert.equal(other.status, 404);
    const forged = await request('/api/world/v1/qh/v1/execute', {
      body,
      headers: { Cookie: alice.headers.Cookie },
    });
    assert.equal(forged.status, 403);
    await write({
      op: 'qhRunEval',
      key: '88888888888888888888888888888883',
      suite: 'qharness-core-20',
    });
    const report = await (
      await request('/api/world/v1/qh/v1/status', { headers: alice.headers })
    ).json();
    assert.ok(
      report.evaluations.some(
        (e) => e.effectiveStatus === 'partial' && e.payload.notRunCount === 11,
      ),
    );
    const privateState = await (
      await request('/api/world/v1/qh/v1/status', { headers: bob.headers })
    ).json();
    assert.equal(privateState.workflows.length, 0);
    assert.equal(privateState.evaluations.length, 0);
  },
);

test(
  'hosted configured chat forwards only typed text after OIDC and CSRF checks',
  nativeOnly,
  async (t) => {
    const outbound = [];
    const inference = createInferenceGateway({
      config: readInferenceConfig({
        NEIGHBOR_AI_ENABLED: '1',
        NEIGHBOR_AI_CHAT_URL: 'https://fixture.invalid/v1/chat/completions',
        NEIGHBOR_AI_MODEL: 'fixture-v1',
        NEIGHBOR_AI_API_KEY: 'fixture-only',
      }),
      fetchImpl: async (url, options) => {
        outbound.push(JSON.parse(options.body));
        return Response.json({
          id: 'fixture-response',
          created: 1,
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'Synthetic provider output',
              },
              finish_reason: 'stop',
            },
          ],
        });
      },
    });
    const { request, login } = await setup(t, { inference });
    const alice = await login('alice');
    const path = '/api/world/v1/v1/chat/completions';
    const body = {
      messages: [{ role: 'user', content: 'Synthetic typed question' }],
    };
    assert.equal((await request(path, { body })).status, 401);
    assert.equal(
      (await request(path, { body, headers: { Cookie: alice.headers.Cookie } }))
        .status,
      403,
    );
    const response = await request(path, { body, headers: alice.headers });
    assert.equal(response.status, 200);
    assert.equal(
      (await response.json()).choices[0].message.content,
      'Synthetic provider output',
    );
    assert.deepEqual(outbound[0].messages, body.messages);
    assert.equal(outbound.length, 1);
  },
);
