import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { createNativeWorkspace } from '../../server/workspace/native.js';

test('default OS worker serves durable state from the qualified optimized binary', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'neighbor-optimized-'));
  const launched = [];
  const workspace = createNativeWorkspace({
    directory,
    spawnProcess(program, args, options) {
      launched.push(program);
      return spawn(program, args, options);
    },
  });
  try {
    const command = {
      op: 'write',
      key: 'aabbaabbaabbaabbaabbaabbaabbaabb',
      payload: {
        kind: 'need',
        title: 'Optimized worker continuity',
        description: 'Local compiled profile verification',
        status: 'open',
        refs: [],
      },
    };
    const saved = await workspace.execute(command);
    assert.equal(saved.status, 'committed');
    assert.deepEqual(await workspace.execute(command), saved);
    const state = await workspace.execute({ op: 'snapshot' });
    assert.equal(state.items.length, 1);
    assert.equal(state.items[0].id, saved.id);
    assert.ok(launched[0].endsWith(`${sep}release${sep}neighbor-workspace`));
  } finally {
    await workspace.close();
    await rm(directory, { recursive: true, force: true });
  }
});
