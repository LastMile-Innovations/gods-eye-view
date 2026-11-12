import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { setImmediate as turn } from 'node:timers/promises';
import { createNativeWorkspace } from '../../server/workspace/native.js';
const ack = () => ({
  op: 'ackChangeInbox',
  key: '11'.repeat(16),
  expected: '7',
  delivery: '22'.repeat(16),
});
const committed = {
  status: 'committed',
  id: 'consumer',
  sequence: 8,
  receipt: 'digest',
};
function fixture(t) {
  const children = [];
  const native = createNativeWorkspace({
    binary: '/fixed/worker',
    directory: '/fixed/account',
    timeoutMs: 500,
    spawnProcess(binary, args, options) {
      assert.equal(binary, '/fixed/worker');
      assert.deepEqual(args, ['/fixed/account']);
      assert.equal(options.shell, false);
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.lines = [];
      child.stdin = new Writable({
        write(chunk, _enc, done) {
          child.lines.push(String(chunk));
          done();
        },
      });
      child.kill = () => {
        child.killed = true;
        return true;
      };
      children.push(child);
      queueMicrotask(() => child.emit('spawn'));
      return child;
    },
  });
  t.after(async () => {
    const done = native.close();
    children.forEach((c) => c.emit('close'));
    await done;
  });
  return { native, children };
}
function reply(child, value) {
  child.stdout.write(JSON.stringify(value) + '\n');
}
const unknown = { error: { code: 'UNKNOWN_OUTCOME' } };
test('uncertain ACK reopens only after close and reconciles frozen bytes before queued mutation', async (t) => {
  const { native, children } = fixture(t);
  const command = ack();
  const first = native.execute(command);
  const later = native.execute({ op: 'saveDraft', key: 'later' });
  await turn();
  const original = children[0].lines[0];
  command.key = 'mutated';
  reply(children[0], unknown);
  await turn();
  assert.equal(native.recoveryStatus().state, 'recovering');
  assert.equal(children[0].killed, true);
  assert.equal(children.length, 1);
  children[0].emit('close');
  await turn();
  assert.equal(children.length, 2);
  assert.deepEqual(children[1].lines, [original]);
  reply(children[1], committed);
  assert.deepEqual(await first, committed);
  await turn();
  assert.equal(JSON.parse(children[1].lines[1]).op, 'saveDraft');
  reply(children[1], { saved: true });
  assert.deepEqual(await later, { saved: true });
  assert.deepEqual(native.recoveryStatus(), { state: 'recovered' });
});
test('persistent ACK failure blocks following mutation and next request reconciles original first', async (t) => {
  const { native, children } = fixture(t);
  const first = native.execute(ack());
  const refused = assert.rejects(first, /UNKNOWN_OUTCOME/);
  await turn();
  const original = children[0].lines[0];
  reply(children[0], unknown);
  await turn();
  assert.equal(
    children[0].killed,
    true,
    'uncertain native result must retire handle',
  );
  children[0].emit('close');
  await turn();
  reply(children[1], unknown);
  await refused;
  assert.equal(native.recoveryStatus().state, 'blocked');
  const next = native.execute({ op: 'write', key: 'new-key', payload: {} });
  await turn();
  assert.equal(children.length, 2);
  children[1].emit('close');
  await turn();
  assert.deepEqual(children[2].lines, [original]);
  reply(children[2], committed);
  await turn();
  assert.equal(JSON.parse(children[2].lines[1]).key, 'new-key');
  reply(children[2], { saved: true });
  await next;
});
test('transport loss during ACK is automatically reconciled; generic effects are never replayed', async (t) => {
  const { native, children } = fixture(t);
  const first = native.execute(ack());
  await turn();
  const original = children[0].lines[0];
  children[0].emit('exit', 1);
  await turn();
  children[0].emit('close');
  await turn();
  assert.equal(children.length, 2, 'ACK must reopen automatically');
  assert.equal(children[1].lines[0], original);
  reply(children[1], committed);
  await first;
  const other = native.execute({ op: 'resume', key: 'effect' });
  const failed = assert.rejects(other, /UNKNOWN_OUTCOME/);
  await turn();
  children[1].emit('exit', 1);
  await failed;
  children[1].emit('close');
  await turn();
  assert.equal(children.length, 2);
});
test('shutdown during ACK recovery does not reopen or replay', async (t) => {
  const { native, children } = fixture(t);
  const first = native.execute(ack());
  const failed = assert.rejects(first, /UNKNOWN_OUTCOME|NATIVE_UNAVAILABLE/);
  await turn();
  reply(children[0], unknown);
  await turn();
  assert.equal(children[0].killed, true);
  const closing = native.close();
  children[0].emit('close');
  await closing;
  await failed;
  assert.equal(children.length, 1);
  await assert.rejects(native.execute(ack()), /NATIVE_UNAVAILABLE/);
});
test('ACK timeout performs one bounded exact replay and an unresolved attempt never dispatches later work', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { native, children } = fixture(t);
  const first = native.execute(ack());
  const failed = assert.rejects(first, /UNKNOWN_OUTCOME/);
  await turn();
  const original = children[0].lines[0];
  t.mock.timers.tick(500);
  await turn();
  assert.equal(children[0].killed, true);
  children[0].emit('close');
  await turn();
  assert.deepEqual(children[1].lines, [original]);
  t.mock.timers.tick(500);
  await failed;
  assert.equal(native.recoveryStatus().state, 'blocked');
  const later = native.execute({ op: 'write', key: 'another-key' });
  const blocked = assert.rejects(later, /UNKNOWN_OUTCOME/);
  children[1].emit('close');
  await turn();
  assert.deepEqual(children[2].lines, [original]);
  reply(children[2], unknown);
  await blocked;
  assert.equal(children[2].lines.length, 1);
});
test('hosted pool cannot evict an unresolved ACK barrier during idle cleanup', async (t) => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { createWorkspacePool } =
    await import('../../server/hosted/workspaces.js');
  const root = await mkdtemp(join(tmpdir(), 'recovery-pool-'));
  let clock = 0,
    phase = 'blocked',
    closed = 0;
  const pool = createWorkspacePool({
    dataRoot: root,
    tenantKey: Buffer.alloc(32, 4),
    maxWorkers: 1,
    idleMs: 10,
    now: () => clock,
    nativeFactory: () => ({
      recoveryStatus: () => ({ state: phase }),
      close: async () => closed++,
    }),
  });
  t.after(async () => {
    await pool.close();
    await rm(root, { recursive: true, force: true });
  });
  const identity = { iss: 'https://fixture.invalid', sub: 'alice' },
    first = await pool.acquire(identity);
  first.release();
  clock = 100;
  for (phase of ['blocked', 'recovering']) {
    await assert.rejects(
      pool.acquire({ ...identity, sub: 'bob' }),
      /RATE_LIMITED/,
    );
    assert.equal(closed, 0);
    const again = await pool.acquire(identity);
    assert.equal(again.native, first.native);
    again.release();
    clock += 100;
  }
  phase = 'recovered';
  const next = await pool.acquire({ ...identity, sub: 'bob' });
  next.release();
  assert.equal(closed, 1);
});
test('authority refusal or a non-receipt reply cannot resolve an uncertain prior ACK', async (t) => {
  for (const response of [
    { error: { code: 'NOT_AVAILABLE' } },
    { error: { code: 'PERMISSION_DENIED' } },
    { items: [] },
  ]) {
    const { native, children } = fixture(t);
    const first = native.execute(ack());
    const unresolved = assert.rejects(first, /UNKNOWN_OUTCOME/);
    await turn();
    reply(children[0], unknown);
    await turn();
    children[0].emit('close');
    await turn();
    reply(children[1], response);
    await unresolved;
    assert.equal(
      native.recoveryStatus().state,
      'blocked',
      'current read denial does not establish the earlier commit fate',
    );
    const closing = native.close();
    children[1].emit('close');
    await closing;
  }
});
