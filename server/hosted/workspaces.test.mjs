import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspacePool } from './workspaces.js';

test('worker pool bounds concurrent accounts, protects active leases, and awaits eviction shutdown', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'neighbor-pool-'));
  let clock = 0,
    closed = 0;
  const directories = [];
  const pool = createWorkspacePool({
    dataRoot: root,
    tenantKey: Buffer.alloc(32, 3),
    maxWorkers: 1,
    idleMs: 10,
    now: () => clock,
    nativeFactory({ directory }) {
      directories.push(directory);
      return {
        async close() {
          await Promise.resolve();
          closed++;
        },
      };
    },
  });
  t.after(async () => {
    await pool.close();
    await rm(root, { recursive: true, force: true });
  });
  const alice = { iss: 'https://id.example', sub: 'alice' };
  const first = await pool.acquire(alice);
  const same = await pool.acquire(alice);
  assert.equal(first.native, same.native);
  clock = 100;
  await assert.rejects(pool.acquire({ ...alice, sub: 'bob' }), /RATE_LIMITED/);
  first.release();
  first.release();
  await assert.rejects(pool.acquire({ ...alice, sub: 'bob' }), /RATE_LIMITED/);
  same.release();
  clock = 111;
  const bob = await pool.acquire({ ...alice, sub: 'bob' });
  assert.equal(closed, 1);
  assert.notEqual(directories[0], directories[1]);
  assert.doesNotMatch(directories[0], /alice/);
  bob.release();
  await pool.close();
  await assert.rejects(pool.acquire(alice), /NATIVE_UNAVAILABLE/);
});
