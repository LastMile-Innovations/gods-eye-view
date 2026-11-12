import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceSynchronizer } from './workspaceSync.js';
const cursor = (sequence = '1', workspace = 'private-workspace') => ({
  version: 1,
  workspace,
  sequence,
});
const response = (sequence = '1') => ({
  changed: true,
  reset: true,
  cursor: cursor(sequence),
  projection: {
    snapshot: {
      workspace: 'private-workspace',
      sequence: Number(sequence),
      items: [],
    },
    operations: { items: [] },
    desks: { items: [] },
    evidenceNetwork: { artifacts: [], claims: [], casebooks: [] },
    domainNetwork: { offers: [], proposals: [], commitments: [], projects: [] },
  },
});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
test('sync uses a native bundle, reuses unchanged state and never falls back to mixed reads', async () => {
  const calls = [];
  let next = response();
  const sync = createWorkspaceSynchronizer({
    sync: async (c) => {
      calls.push(c);
      return next;
    },
  });
  const first = await sync.read();
  next = { changed: false, reset: false, cursor: cursor() };
  assert.equal(await sync.read(), first);
  assert.deepEqual(calls, [undefined, cursor()]);
  next = response('2');
  assert.notEqual(await sync.read(), first);
});
test('concurrent refresh after a write queues one followup instead of accepting an old in-flight snapshot', async () => {
  const pending = deferred();
  let calls = 0;
  const sync = createWorkspaceSynchronizer({
    sync: async () => (++calls === 1 ? pending.promise : response('2')),
  });
  const a = sync.read(),
    b = sync.read(),
    c = sync.read();
  assert.equal(calls, 1);
  pending.resolve(response());
  assert.equal((await a).snapshot.sequence, 2);
  assert.equal(await b, await c);
  assert.equal(calls, 2);
});
test('logout/reset rejects delayed private replies and a new session always requests a full bundle', async () => {
  const old = deferred();
  const sent = [];
  const sync = createWorkspaceSynchronizer({
    sync: async (c) => {
      sent.push(c);
      return sent.length === 1 ? old.promise : response('2');
    },
  });
  const a = sync.read();
  sync.clear();
  const fresh = await sync.read();
  old.resolve(response());
  assert.equal(await a, undefined);
  assert.equal(fresh.snapshot.sequence, 2);
  assert.deepEqual(sent, [undefined, undefined]);
});
test('malformed, regressed, mixed-workspace and unsolicited unchanged responses never replace current state', async () => {
  let next = { changed: false, reset: false, cursor: cursor() };
  const sync = createWorkspaceSynchronizer({ sync: async () => next });
  await assert.rejects(sync.read(), /NATIVE_UNAVAILABLE/);
  next = response('2');
  const first = await sync.read();
  for (const invalid of [
    response('1'),
    {
      ...response('3'),
      projection: {
        ...response('3').projection,
        snapshot: { workspace: 'other', sequence: 3, items: [] },
      },
    },
    { ...response('3'), projection: undefined },
    { ...response('3'), cursor: cursor('03') },
    { changed: false, reset: false, cursor: cursor('3') },
  ]) {
    next = invalid;
    await assert.rejects(sync.read(), /NATIVE_UNAVAILABLE/);
  }
  next = { changed: false, reset: false, cursor: cursor('2') };
  assert.equal(await sync.read(), first);
});
