import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createWorkspaceHandler } from './plugin.js';
import { createNativeWorkspace } from './native.js';
test('paired native HTTP command journal, receipts, desks and history form one restartable service', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'neighbor-lifecycle-http-'));
  const native = createNativeWorkspace({ directory });
  const server = http.createServer(createWorkspaceHandler({ native }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(async () => {
    await new Promise((r) => server.close(r));
    await native.close();
    await rm(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  let headers = { Origin: base, 'Content-Type': 'application/json' };
  const call = (path, body) =>
    fetch(`${base}/api/world/v1${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const paired = await call('/connect', {});
  headers = {
    ...headers,
    Cookie: paired.headers.get('set-cookie').split(';')[0],
    'X-Neighbor-CSRF': (await paired.json()).csrf,
  };
  const cmd = {
    op: 'write',
    key: '11111111111111111111111111111111',
    payload: {
      kind: 'task',
      title: 'Durable operation',
      description: '',
      status: 'open',
      refs: [],
    },
  };
  const saved = await call('/commands', cmd);
  assert.equal(saved.status, 200);
  const receipt = await saved.json();
  assert.deepEqual(await (await call('/commands', cmd)).json(), receipt);
  assert.equal(
    (
      await call('/commands', {
        ...cmd,
        payload: { ...cmd.payload, title: 'Changed' },
      })
    ).status,
    400,
  );
  const operationsResponse = await call('/operations');
  assert.equal(operationsResponse.status, 200);
  const operations = await operationsResponse.json();
  assert.equal(operations.items[0].state, 'committed');
  assert.deepEqual(operations.items[0].result, receipt);
  assert.equal('command' in operations.items[0], false);
  assert.equal((await call(`/records/${receipt.id}/history`)).status, 200);
  const layout = { version: 1, windows: [], focused: null };
  const desk = await call('/commands', {
    op: 'saveDesk',
    key: '22222222222222222222222222222222',
    payload: { name: 'Native desk', layout },
  });
  assert.equal(desk.status, 200);
  assert.equal(
    (await (await call('/desks')).json()).items[0].payload.name,
    'Native desk',
  );
  // An interrupted prepared command is discoverable and only resumed explicitly.
  const request = {
    ...cmd,
    key: '33333333333333333333333333333333',
    payload: { ...cmd.payload, title: 'Prepared for recovery' },
  };
  await native.execute({ op: 'prepare', request, command: request });
  assert.equal(
    (await (await call('/operations')).json()).items[0].state,
    'pending',
  );
  assert.equal(
    (await call(`/operations/${request.key}/resume`, {})).status,
    200,
  );
  assert.equal(
    (await call(`/operations/${request.key}/resume`, {})).status,
    200,
  );
  assert.equal((await (await call('/query', {})).json()).items.length, 2);
  const evidenceCommand = {
    op: 'preserveEvidence',
    key: '44444444444444444444444444444444',
    permissionConfirmed: true,
    bytes: [0, 255, 10],
    payload: {
      title: 'Private binary original',
      fileName: 'original.bin',
      mediaType: 'application/octet-stream',
      family: '04',
      sourceType: 'unknown',
      originGroup: '',
      dependsOn: null,
      notes: 'HTTP acceptance fixture',
      assertedCapturedAt: null,
      coordinates: null,
    },
  };
  const evidenceResponse = await call('/commands', evidenceCommand);
  assert.equal(evidenceResponse.status, 200);
  const evidence = await evidenceResponse.json();
  assert.equal(
    (await (await call('/evidence-network')).json()).artifacts[0].payload
      .integrity.factualVerification,
    false,
  );
  assert.deepEqual(
    (await (await call(`/evidence/${evidence.id}/original`)).json()).bytes,
    [0, 255, 10],
  );
  assert.equal(
    (
      await call('/commands', {
        op: 'reviewEvidence',
        key: '55555555555555555555555555555555',
        id: evidence.id,
        expected: evidence.sequence,
        state: 'published',
        note: 'Unauthorized publication state',
      })
    ).status,
    400,
  );
  await call('/logout', {});
  assert.equal((await call('/operations')).status, 401);
  assert.equal((await call('/desks')).status, 401);
  assert.equal((await call('/evidence-network')).status, 401);
  assert.equal((await call(`/evidence/${evidence.id}/original`)).status, 401);
});
