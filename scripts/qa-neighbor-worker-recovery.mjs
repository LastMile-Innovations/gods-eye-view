/** Actual hosted gateway/native I/O recovery with fixture OIDC identities, no live IdP. */
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHostedApplication } from '../server/hosted/application.js';
import { readHostedConfig } from '../server/hosted/config.js';
import { instrumentedWorkspace } from './fixtures/recovery-worker.mjs';
const evidence = new URL(
  process.env.NEIGHBOR_RECOVERY_EVIDENCE_URL ||
    '../../research/unified-world/native-worker-recovery/',
  import.meta.url,
);
await mkdir(evidence, { recursive: true });
const outcomes = [];
for (const point of ['wal_sync', 'ack_sync', 'lost']) {
  const root = await mkdtemp(join(tmpdir(), 'neighbor-worker-recovery-'));
  const origin = 'https://neighbor.example',
    workers = [];
  await mkdir(join(root, 'dist'));
  await writeFile(join(root, 'dist/index.html'), '<html>test fixture</html>');
  const config = readHostedConfig(
    {
      NEIGHBOR_PUBLIC_ORIGIN: origin,
      NEIGHBOR_OIDC_ISSUER: 'https://identity.example',
      NEIGHBOR_OIDC_CLIENT_ID: 'fixture-client',
      NEIGHBOR_OIDC_CLIENT_SECRET: 'fixture-only',
      NEIGHBOR_TENANT_KEY: Buffer.alloc(32, 7).toString('base64'),
      NEIGHBOR_HOSTED_DATA_DIR: join(root, 'private'),
    },
    { staticRoot: join(root, 'dist') },
  );
  const app = createHostedApplication({
    config,
    oidc: {
      begin: async () => ({
        state: crypto.randomUUID(),
        nonce: 'fixture',
        verifier: 'fixture',
        url: 'https://identity.example/authorize',
      }),
      complete: async (url) => ({
        iss: 'https://identity.example',
        sub: url.searchParams.get('code'),
      }),
    },
    nativeFactory: ({ directory }) => {
      const worker = instrumentedWorkspace(directory);
      workers.push(worker);
      return worker;
    },
  });
  const server = http.createServer(app.handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const request = (path, auth, body, extra = {}) =>
    new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: server.address().port,
          path,
          method: body === undefined ? 'GET' : 'POST',
          headers: {
            Host: 'neighbor.example',
            ...(body === undefined
              ? {}
              : { Origin: origin, 'Content-Type': 'application/json' }),
            ...auth,
            ...extra,
          },
        },
        (res) => {
          let bytes = '';
          res.on('data', (c) => (bytes += c));
          res.on('end', () =>
            resolve({
              status: res.statusCode,
              headers: new Headers(
                Object.entries(res.headers).flatMap(([k, v]) =>
                  (Array.isArray(v) ? v : [v]).map((item) => [k, item]),
                ),
              ),
              data: bytes ? JSON.parse(bytes) : undefined,
            }),
          );
        },
      );
      req.on('error', reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  const login = async (subject) => {
    const start = await request('/auth/login');
    assert.equal(start.status, 302);
    const cookie = start.headers.get('set-cookie').split(';')[0],
      state = decodeURIComponent(cookie.split('=')[1]);
    const finish = await request(
      `/auth/callback?code=${subject}&state=${state}`,
      { Cookie: cookie },
    );
    assert.equal(finish.status, 302);
    const session = finish.headers
      .getSetCookie()
      .find((c) => c.startsWith('__Host-neighbor_session='))
      .split(';')[0];
    const current = await request('/api/world/v1/session', { Cookie: session });
    assert.equal(current.status, 200);
    return { Cookie: session, 'X-Neighbor-CSRF': current.data.csrf };
  };
  try {
    const alice = await login('alice'),
      bob = await login('bob');
    const saved = await request('/api/world/v1/commands', alice, {
      op: 'write',
      key: '01'.repeat(16),
      payload: {
        kind: 'need',
        title: 'Alice private recovery record',
        description: 'Private',
        status: 'open',
        refs: [],
      },
    });
    assert.equal(saved.status, 200);
    const pending = await request('/api/world/v1/change-inbox/poll', alice, {
      key: '02'.repeat(16),
    });
    assert.equal(pending.status, 200);
    assert.equal(pending.data.acknowledged, '0');
    const bobBefore = await request('/api/world/v1/change-inbox', bob);
    assert.deepEqual(bobBefore.data, { registered: false });
    assert.equal(
      (await request('/api/world/v1/change-inbox/recovery')).status,
      401,
    );
    const original = {
      key: '03'.repeat(16),
      expected: pending.data.revision,
      delivery: pending.data.pending.id,
    };
    await workers[0].arm(point, 600);
    const recovering = request(
      '/api/world/v1/change-inbox/ack',
      alice,
      original,
    );
    const observed = new Set();
    const observationDeadline = Date.now() + 5000;
    while (Date.now() < observationDeadline) {
      const status = await request(
        '/api/world/v1/change-inbox/recovery',
        alice,
      );
      assert.match(status.headers.get('cache-control'), /no-store/);
      assert.deepEqual(Object.keys(status.data), ['state']);
      observed.add(status.data.state);
      if (status.data.state === 'recovering') break;
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.ok(observed.has('recovering'));
    assert.deepEqual(
      (await request('/api/world/v1/change-inbox/recovery', bob)).data,
      { state: 'idle' },
    );
    const recovered = await recovering;
    assert.equal(recovered.status, 200);
    assert.deepEqual(
      (await request('/api/world/v1/change-inbox/recovery', alice)).data,
      { state: 'recovered' },
    );
    const ackLines = workers[0].lines.filter(
      (line) => JSON.parse(line).op === 'ackChangeInbox',
    );
    assert.equal(ackLines.length, 2);
    assert.equal(ackLines[0], ackLines[1]);
    const nativeReplies = workers[0].replies
      .filter((x) => x.op === 'ackChangeInbox')
      .map((x) => x.value);
    if (point === 'lost') assert.deepEqual(nativeReplies[0], recovered.data);
    else
      assert.equal(
        nativeReplies[0].error?.code,
        'UNKNOWN_OUTCOME',
        'live I/O injection actually executed',
      );
    const after = await request('/api/world/v1/change-inbox', alice);
    assert.equal(after.data.pending, null);
    assert.equal(after.data.acknowledged, pending.data.pending.through);
    assert.equal(after.data.revision, String(recovered.data.sequence));
    const duplicate = await request(
      '/api/world/v1/change-inbox/ack',
      alice,
      original,
    );
    assert.deepEqual(duplicate.data, recovered.data);
    assert.deepEqual(
      (await request('/api/world/v1/change-inbox', alice)).data,
      after.data,
    );
    assert.deepEqual(
      (await request('/api/world/v1/change-inbox', bob)).data,
      bobBefore.data,
    );
    assert.equal(
      (await request('/api/world/v1/query', bob, {})).data.items.length,
      0,
    );
    const denied = await request(
      '/api/world/v1/change-inbox/ack',
      bob,
      original,
      { 'X-Neighbor-CSRF': alice['X-Neighbor-CSRF'] },
    );
    assert.equal(denied.status, 403);
    assert.equal(
      (await request('/api/world/v1/query', alice, {})).data.items.length,
      1,
    );
    outcomes.push({
      fault: point,
      outcome: 'PASSED',
      native_ack_dispatches: 2,
      exact_bytes: true,
      one_checkpoint_advance: true,
      same_receipt_on_retry: true,
      other_account_unchanged: true,
      observed_recovering: true,
    });
    console.log(
      `${point}: original ACK reconciled once; other account unchanged`,
    );
  } finally {
    await new Promise((r) => server.close(r));
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
}
await writeFile(
  new URL('native-http-outcomes.json', evidence),
  JSON.stringify(
    {
      view: 'Reality Check',
      provenance: 'TESTED_LOCAL',
      oidc: 'fixture identity adapter; not live provider validation',
      outcomes,
    },
    null,
    2,
  ) + '\n',
);
