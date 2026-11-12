import { createHmac } from 'node:crypto';
import { join } from 'node:path';
import { mkdir, realpath } from 'node:fs/promises';
import { createNativeWorkspace } from '../workspace/native.js';

/** Bounded, server-routed per-account workers. Sessions share the same account's single-writer queue. */
export function createWorkspacePool({
  dataRoot,
  tenantKey,
  nativeFactory = createNativeWorkspace,
  maxWorkers = 16,
  idleMs = 600_000,
  now = Date.now,
}) {
  const entries = new Map();
  let closed = false;
  let gate = Promise.resolve();
  async function locked(fn) {
    const previous = gate;
    let unlock;
    gate = new Promise((r) => {
      unlock = r;
    });
    await previous;
    try {
      return await fn();
    } finally {
      unlock();
    }
  }
  return {
    async acquire(identity) {
      return locked(async () => {
        if (closed) throw new Error('NATIVE_UNAVAILABLE');
        const account = createHmac('sha256', tenantKey)
          .update(JSON.stringify([identity.iss, identity.sub]))
          .digest('hex');
        let entry = entries.get(account);
        if (!entry) {
          for (const [id, item] of entries) {
            // Eviction must not forget an unresolved exact-key ACK barrier.
            const phase = item.native.recoveryStatus?.().state;
            if (
              !item.users &&
              now() - item.lastUsed >= idleMs &&
              !['recovering', 'blocked'].includes(phase)
            ) {
              await item.native.close();
              entries.delete(id);
            }
          }
          if (entries.size >= maxWorkers) throw new Error('RATE_LIMITED');
          await mkdir(dataRoot, { recursive: true, mode: 0o700 });
          const parent = join(await realpath(dataRoot), 'tenants');
          await mkdir(parent, { recursive: true, mode: 0o700 });
          const directory = join(parent, account);
          await mkdir(directory, { mode: 0o700 }).catch((e) => {
            if (e.code !== 'EEXIST') throw e;
          });
          // Refuse symlink redirection of an account outside the managed private volume.
          if (
            (await realpath(parent)) !== parent ||
            (await realpath(directory)) !== directory
          )
            throw new Error('NATIVE_UNAVAILABLE');
          entry = {
            native: nativeFactory({ directory }),
            users: 0,
            lastUsed: now(),
          };
          entries.set(account, entry);
        }
        entry.users++;
        let released = false;
        return {
          native: entry.native,
          release() {
            if (!released) {
              released = true;
              entry.users--;
              entry.lastUsed = now();
            }
          },
        };
      });
    },
    async close() {
      await locked(async () => {
        closed = true;
        await Promise.all([...entries.values()].map((e) => e.native.close()));
        entries.clear();
      });
    },
  };
}
