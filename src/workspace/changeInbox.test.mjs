import test from 'node:test';
import assert from 'node:assert/strict';
import { createChangeInboxController } from './changeInbox.js';
test('a definitive stale acknowledgement refreshes native state and clears the refused request', async () => {
  let refreshed = 0;
  const control = createChangeInboxController({
    makeKey: () => 'stale',
    refresh: async () => {
      refreshed++;
      return true;
    },
    api: {
      ackChangeInbox: async () => {
        const e = new Error('CONFLICT');
        e.status = 409;
        throw e;
      },
    },
  });
  await assert.rejects(
    control.run('ack', { revision: '3', pending: { id: 'old' } }),
    /CONFLICT/,
  );
  assert.equal(refreshed, 2);
  assert.equal(control.pending, undefined);
  await assert.rejects(control.run('retry'), /INVALID/);
});
const inbox = { revision: '7', pending: { id: 'delivery', through: '6' } };
test('inbox acknowledgement follows a successful fresh read and retries the exact uncertain request', async () => {
  const order = [],
    bodies = [];
  let fail = true;
  const control = createChangeInboxController({
    makeKey: () => 'original-key',
    refresh: async () => {
      order.push('refresh');
      return true;
    },
    api: {
      ackChangeInbox: async (body) => {
        order.push('ack');
        bodies.push(body);
        if (fail) {
          fail = false;
          throw new Error('UNKNOWN_OUTCOME');
        }
        return { status: 'committed' };
      },
    },
  });
  await assert.rejects(control.run('ack', inbox), /UNKNOWN_OUTCOME/);
  assert.deepEqual(order, ['refresh', 'ack']);
  assert.equal(control.pending.action, 'ack');
  await control.run('retry');
  assert.equal(bodies[0], bodies[1]);
  assert.deepEqual(bodies[1], {
    key: 'original-key',
    expected: '7',
    delivery: 'delivery',
  });
  assert.equal(control.pending, undefined);
});
test('failed workspace refresh cannot acknowledge or discard the original retry key', async () => {
  let called = 0;
  const control = createChangeInboxController({
    makeKey: () => 'same',
    refresh: async () => false,
    api: { ackChangeInbox: async () => called++ },
  });
  await assert.rejects(control.run('ack', inbox), /NATIVE_UNAVAILABLE/);
  assert.equal(called, 0);
  assert.equal(control.pending.action, 'ack');
});
test('clearing a session ignores late replies and cannot retry a prior account action', async () => {
  let release;
  const control = createChangeInboxController({
    makeKey: () => 'old',
    refresh: async () => true,
    api: { pollChangeInbox: () => new Promise((r) => (release = r)) },
  });
  const pending = control.run('poll');
  control.clear();
  release({ registered: true });
  assert.equal(await pending, undefined);
  assert.equal(control.pending, undefined);
  await assert.rejects(control.run('retry'), /INVALID/);
});
test('native recovery phase is visible during an ACK and retained after exact-key resolution', async () => {
  let finish,
    state = 'recovering';
  const changes = [];
  const control = createChangeInboxController({
    makeKey: () => 'same',
    pollMs: 5,
    refresh: async () => true,
    onChange: () => changes.push(control.recovery.state),
    api: {
      ackChangeInbox: () => new Promise((r) => (finish = r)),
      inboxRecovery: async () => ({ state, key: 'must-not-escape' }),
    },
  });
  const running = control.run('ack', inbox);
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(control.recovery, { state: 'recovering' });
  state = 'recovered';
  finish({ status: 'committed' });
  await running;
  assert.deepEqual(control.recovery, { state: 'recovered' });
  assert.ok(changes.includes('recovering'));
  control.clear();
  assert.deepEqual(control.recovery, { state: 'idle' });
});
test('late recovery status cannot restore prior-session UI', async () => {
  let status, finish;
  const control = createChangeInboxController({
    makeKey: () => 'old',
    pollMs: 5,
    refresh: async () => true,
    api: {
      pollChangeInbox: () => new Promise((r) => (finish = r)),
      inboxRecovery: () => new Promise((r) => (status = r)),
    },
  });
  const running = control.run('poll');
  await new Promise((r) => setTimeout(r, 15));
  control.clear();
  status({ state: 'blocked' });
  finish({ registered: true });
  await running;
  assert.deepEqual(control.recovery, { state: 'idle' });
});
test('an older recovery response cannot overwrite the final resolved phase', async () => {
  let finish,
    oldStatus,
    reads = 0;
  const control = createChangeInboxController({
    makeKey: () => 'same',
    pollMs: 5,
    refresh: async () => true,
    api: {
      ackChangeInbox: () => new Promise((r) => (finish = r)),
      inboxRecovery: () =>
        ++reads === 1
          ? new Promise((r) => (oldStatus = r))
          : Promise.resolve({ state: 'recovered' }),
    },
  });
  const running = control.run('ack', inbox);
  await new Promise((r) => setTimeout(r, 15));
  finish({ status: 'committed' });
  await running;
  oldStatus({ state: 'recovering' });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(control.recovery, { state: 'recovered' });
});
