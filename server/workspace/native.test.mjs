import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { setImmediate as turn } from 'node:timers/promises';
import { createNativeWorkspace } from './native.js';

function fixture(t, options = {}) {
  const workers = [];
  const adapter = createNativeWorkspace({
    binary: '/fixture/neighbor-workspace',
    directory: '/fixture/private',
    timeoutMs: 1000,
    spawnProcess(binary, args, config) {
      assert.equal(binary, '/fixture/neighbor-workspace');
      assert.deepEqual(args, ['/fixture/private']);
      assert.equal(config.shell, false);
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.writes = [];
      child.callbacks = [];
      child.stdin = new Writable({
        write(chunk, _encoding, done) {
          child.writes.push(String(chunk));
          child.callbacks.push(done);
        },
      });
      child.signals = [];
      child.kill = (signal = 'SIGTERM') => {
        child.signals.push(signal);
        child.killed = true;
        if (!options.manualClose) queueMicrotask(() => child.emit('close'));
        return true;
      };
      workers.push(child);
      queueMicrotask(() => {
        if (options.failSpawn) {
          child.emit('error', new Error('ENOENT'));
          child.emit('close');
        } else child.emit('spawn');
      });
      return child;
    },
    ...options,
  });
  t.after(() => {
    const closing = adapter.close();
    for (const child of workers) child.emit('close');
    return closing;
  });
  return { adapter, workers };
}

test('worker death after dispatch is uncertain and replacement waits for process close', async (t) => {
  const { adapter, workers } = fixture(t, { manualClose: true });
  const first = adapter.execute({ op: 'save', key: 'same-key' });
  const failed = assert.rejects(first, /^Error: UNKNOWN_OUTCOME$/);
  await turn();
  assert.equal(workers[0]?.writes.length, 1);
  workers[0].emit('exit', 1);
  await failed;
  const next = adapter.execute({ op: 'operation', key: 'same-key' });
  await turn();
  assert.equal(workers.length, 1, 'storage lock can remain until close');
  workers[0].emit('close');
  await turn();
  assert.equal(workers.length, 2);
  workers[1].stdout.write('{"state":"committed"}\n');
  assert.deepEqual(await next, { state: 'committed' });
});

test('queued commands capture their admitted bytes and handle split UTF-8 replies', async (t) => {
  const { adapter, workers } = fixture(t);
  const command = { op: 'save', payload: { title: 'original' } };
  const result = adapter.execute(command);
  command.payload.title = 'changed after admission';
  await turn();
  assert.equal(JSON.parse(workers[0]?.writes[0]).payload.title, 'original');
  const reply = Buffer.from('{"title":"café 🌍"}\n');
  for (const byte of reply) workers[0].stdout.write(Buffer.from([byte]));
  assert.deepEqual(await result, { title: 'café 🌍' });
});

test('invalid or oversized commands fail before starting a worker and leave the queue usable', async (t) => {
  const { adapter, workers } = fixture(t);
  const circular = {};
  circular.self = circular;
  for (const command of [circular, null, [], 1n, undefined])
    await assert.rejects(adapter.execute(command), /^Error: INVALID$/);
  await assert.rejects(
    adapter.execute({ text: 'x'.repeat(8 * 1024 * 1024) }),
    /RESOURCE_LIMIT/,
  );
  assert.equal(workers.length, 0);
  const next = adapter.execute({ op: 'snapshot' });
  await turn();
  workers[0].stdout.write('{"items":[]}\n');
  assert.deepEqual(await next, { items: [] });
});

test('malformed or oversized replies never become acknowledged command results', async (t) => {
  for (const reply of [
    'bad\n',
    'null\n',
    '[]\n',
    '{"x":"' + 'x'.repeat(65),
    Buffer.from([0xff, 0x0a]),
  ]) {
    const { adapter, workers } = fixture(t, { maxResponseBytes: 64 });
    const result = adapter.execute({ op: 'save' });
    const failed = assert.rejects(result, /UNKNOWN_OUTCOME/);
    await turn();
    workers[0].stdout.write(reply);
    await failed;
    assert.equal(workers[0].killed, true);
    await adapter.close();
  }
});

test('a late stdin error from a completed request cannot reject the following request', async (t) => {
  const { adapter, workers } = fixture(t);
  const first = adapter.execute({ op: 'snapshot' });
  await turn();
  const child = workers[0];
  child.stdout.write('{"sequence":1}\n');
  assert.deepEqual(await first, { sequence: 1 });
  const next = adapter.execute({ op: 'snapshot' });
  await turn();
  child.callbacks[0](new Error('late pipe failure'));
  const failed = assert.rejects(next, /UNKNOWN_OUTCOME/);
  // A stream error invalidates the worker, but can never acknowledge/reject the
  // wrong ticket using the old write callback. A replacement remains available.
  await failed;
  const recovered = adapter.execute({ op: 'snapshot' });
  await turn();
  workers[1].stdout.write('{"sequence":2}\n');
  assert.deepEqual(await recovered, { sequence: 2 });
});

test('timeout rejects only dispatched work and queued work starts after shutdown', async (t) => {
  const { adapter, workers } = fixture(t, { timeoutMs: 15 });
  const first = adapter.execute({ op: 'save' });
  const failed = assert.rejects(first, /UNKNOWN_OUTCOME/);
  const next = adapter.execute({ op: 'snapshot' });
  await failed;
  await turn();
  assert.equal(workers.length, 2);
  workers[0].stdout.write('{"wrong":"late result"}\n');
  workers[1].stdout.write('{"sequence":3}\n');
  assert.deepEqual(await next, { sequence: 3 });
});

test('close rejects in-flight work as uncertain and refuses all queued and new work', async (t) => {
  const { adapter, workers } = fixture(t);
  const first = adapter.execute({ op: 'save' });
  const failed = assert.rejects(first, /UNKNOWN_OUTCOME/);
  const queued = adapter.execute({ op: 'snapshot' });
  const refused = assert.rejects(queued, /NATIVE_UNAVAILABLE/);
  await turn();
  await adapter.close();
  await Promise.all([failed, refused]);
  await assert.rejects(
    adapter.execute({ op: 'snapshot' }),
    /NATIVE_UNAVAILABLE/,
  );
  assert.equal(workers.length, 1);
  assert.equal(workers[0].writes.length, 1);
});

test('the bounded queue refuses the seventeenth admission without spawning more workers', async (t) => {
  const { adapter, workers } = fixture(t);
  const accepted = Array.from({ length: 16 }, () =>
    adapter.execute({ op: 'snapshot' }),
  );
  const settled = Promise.allSettled(accepted);
  await assert.rejects(adapter.execute({ op: 'snapshot' }), /RATE_LIMITED/);
  await turn();
  await adapter.close();
  assert.equal((await settled).length, 16);
  assert.equal(workers.length, 1);
});

test('spawn failure before dispatch is unavailable', async (t) => {
  const { adapter, workers } = fixture(t, { failSpawn: true });
  const first = adapter.execute({ op: 'snapshot' });
  const failed = assert.rejects(first, /NATIVE_UNAVAILABLE/);
  await failed;
  assert.equal(workers[0].writes.length, 0);
});

test('shutdown escalates a stuck worker and still waits for its close barrier', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { adapter, workers } = fixture(t, { manualClose: true });
  const result = adapter.execute({ op: 'save' });
  const failed = assert.rejects(result, /UNKNOWN_OUTCOME/);
  await turn();
  let finished = false;
  const closing = adapter.close().then(() => {
    finished = true;
  });
  await failed;
  assert.deepEqual(workers[0].signals, ['SIGTERM']);
  t.mock.timers.tick(1000);
  assert.deepEqual(workers[0].signals, ['SIGTERM', 'SIGKILL']);
  assert.equal(finished, false);
  workers[0].emit('close');
  await closing;
  assert.equal(finished, true);
});
