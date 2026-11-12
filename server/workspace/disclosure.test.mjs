import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createWorkspaceHandler } from './plugin.js';
import { createNativeWorkspace } from './native.js';
test('real paired HTTP scopes redacted dossiers, history, stale approval and withdrawal', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'neighbor-disclosure-http-'));
  const native = createNativeWorkspace({
    directory: dir,
    binary: process.env.NEIGHBOR_TEST_NATIVE_BIN,
  });
  const server = http.createServer(createWorkspaceHandler({ native }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(async () => {
    await new Promise((r) => server.close(r));
    await native.close();
    await rm(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  let headers = { Origin: base, 'Content-Type': 'application/json' };
  const call = (path, body) =>
    fetch(`${base}/api/world/v1${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  assert.equal(
    (await call('/citizen/00000000000000000000000000000000/history')).status,
    401,
  );
  const paired = await call('/connect', {});
  headers = {
    ...headers,
    Cookie: paired.headers.get('set-cookie').split(';')[0],
    'X-Neighbor-CSRF': (await paired.json()).csrf,
  };
  let n = 400;
  const command = async (v) => {
    const r = await call('/commands', {
      key: (n++).toString(16).padStart(32, '0'),
      ...v,
    });
    assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
    return r.json();
  };
  const source = await command({
    op: 'preserveEvidence',
    permissionConfirmed: true,
    bytes: [...Buffer.from('PUBLIC SECRET end')],
    payload: {
      title: 'Private source',
      fileName: 'source.txt',
      mediaType: 'text/plain',
      family: '04',
      sourceType: 'unknown',
      originGroup: '',
      dependsOn: null,
      notes: 'PRIVATE_NOTE',
      assertedCapturedAt: null,
      coordinates: null,
    },
  });
  const history = await call(`/citizen/${source.id}/history`);
  assert.equal(history.status, 200);
  assert.equal((await history.json()).items.length, 1);
  const child = await command({
    op: 'deriveEvidenceText',
    parent: source.id,
    expected: source.sequence,
    title: 'Reviewed excerpt',
    ranges: [[7, 13]],
    note: 'Remove sensitive identifier',
  });
  const a = await command({
    op: 'reviewEvidence',
    id: child.id,
    expected: child.sequence,
    state: 'under_review',
    note: 'Human review of selected text',
  });
  const b = await command({
    op: 'saveCasebook',
    payload: {
      title: 'PRIVATE_BOOK',
      description: 'PRIVATE_DESCRIPTION',
      artifacts: [a.id],
      claims: [],
    },
  });
  const payload = {
    title: 'Reviewed local dossier',
    scope: 'local-download',
    approvalConfirmed: true,
    casebook: { id: b.id, revision: b.sequence },
    artifacts: [{ id: a.id, revision: a.sequence }],
    claims: [],
  };
  const saved = await command({ op: 'saveEvidenceDisclosure', payload });
  const exportResponse = await call(`/disclosures/${saved.id}/dossier`);
  assert.equal(exportResponse.status, 200);
  const dossier = await exportResponse.json();
  assert.equal(dossier.artifacts[0].text, 'PUBLIC [REDACTED] end');
  assert.ok(!JSON.stringify(dossier).includes('PRIVATE_'));
  assert.ok(!JSON.stringify(dossier).includes('SECRET'));
  await command({
    op: 'reviewEvidence',
    id: source.id,
    expected: source.sequence,
    state: 'restricted',
    note: 'Current restriction invalidates approval',
  });
  assert.equal((await call(`/disclosures/${saved.id}/dossier`)).status, 409);
  const withdrawal = await command({
    op: 'withdrawEvidenceDisclosure',
    id: saved.id,
    expected: saved.sequence,
    note: 'Withdraw local approval',
  });
  assert.equal((await call(`/disclosures/${saved.id}/dossier`)).status, 404);
  assert.equal(
    (await (await call(`/citizen/${withdrawal.id}/history`)).json()).items
      .length,
    2,
  );
  await call('/logout', {});
  assert.equal((await call(`/disclosures/${saved.id}/dossier`)).status, 401);
  assert.equal((await call(`/citizen/${source.id}/history`)).status, 401);
});
