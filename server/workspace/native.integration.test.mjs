import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNativeWorkspace } from './native.js';
import { spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';
const binary =
  process.env.NEIGHBOR_NATIVE_BIN ||
  fileURLToPath(
    new URL(
      '../../../Quanta/native/target/release/neighbor-workspace',
      import.meta.url,
    ),
  );
test(
  'lost acknowledgement after an actual native commit reconciles the same key without a duplicate',
  {
    skip: existsSync(binary)
      ? false
      : 'Build the native workspace adapter first',
  },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'neighbor-lost-ack-'));
    let intercepted = false,
      committedReply;
    const adapter = createNativeWorkspace({
      directory,
      binary,
      spawnProcess(program, args, options) {
        const child = spawn(program, args, options);
        if (!intercepted) {
          intercepted = true;
          // Observe a real durable acknowledgement, suppress its delivery to the
          // adapter, then kill the process. No native store or WAL is mocked.
          const realOutput = child.stdout;
          child.stdout = new PassThrough();
          let line = '';
          realOutput.on('data', (chunk) => {
            line += chunk;
            if (line.includes('\n') && !committedReply) {
              committedReply = JSON.parse(line.split('\n')[0]);
              child.kill('SIGKILL');
            }
          });
        }
        return child;
      },
    });
    t.after(async () => {
      await adapter.close();
      await rm(directory, { recursive: true, force: true });
    });
    const command = {
      op: 'write',
      key: '12345678901234567890123456789012',
      payload: {
        kind: 'need',
        title: 'Lost acknowledgement fixture',
        description: 'Synthetic isolated native fault test',
        status: 'open',
        refs: [],
      },
    };
    await assert.rejects(adapter.execute(command), /^Error: UNKNOWN_OUTCOME$/);
    assert.equal(committedReply.status, 'committed');
    assert.deepEqual(await adapter.execute(command), committedReply);
    const snapshot = await adapter.execute({ op: 'snapshot' });
    assert.equal(snapshot.items.length, 1);
    assert.equal(snapshot.items[0].id, committedReply.id);
  },
);
test(
  'real native worker preserves evidence, exact receipts and identities across worker restart',
  {
    skip: existsSync(binary)
      ? false
      : 'Build the native workspace adapter with npm run workspace:build',
  },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'neighbor-native-'));
    let adapter = createNativeWorkspace({ directory, binary });
    t.after(async () => {
      await adapter.close();
      await rm(directory, { recursive: true, force: true });
    });
    const command = {
      op: 'import',
      key: '11111111111111111111111111111111',
      original: '\ufeff# Source evidence\r\nPrivate verification fixture.\r\n',
      payload: {
        kind: 'document',
        title: 'source.md',
        description: 'Verification fixture',
        status: 'open',
        refs: [],
      },
    };
    const saved = await adapter.execute(command);
    assert.equal(saved.status, 'committed');
    assert.match(saved.id, /^q1_/);
    assert.deepEqual(await adapter.execute(command), saved);
    const altered = await adapter.execute({
      ...command,
      original: 'altered bytes',
    });
    assert.equal(altered.error.code, 'INVALID');
    await adapter.close();
    adapter = createNativeWorkspace({ directory, binary });
    const snapshot = await adapter.execute({ op: 'snapshot' });
    assert.equal(snapshot.items.length, 1);
    assert.equal(snapshot.items[0].id, saved.id);
    const evidence = await adapter.execute({ op: 'evidence', id: saved.id });
    assert.equal(evidence.original, command.original);
    const forged = await adapter.execute({
      op: 'snapshot',
      principal: 'owner',
    });
    assert.equal(forged.error.code, 'INVALID');
  },
);
test(
  'closing transport prevents queued work from starting native storage',
  {
    skip: existsSync(binary)
      ? false
      : 'Build the native workspace adapter first',
  },
  async (t) => {
    const parent = await mkdtemp(join(tmpdir(), 'neighbor-close-'));
    const directory = join(parent, 'unopened');
    const adapter = createNativeWorkspace({ directory, binary });
    t.after(async () => {
      await adapter.close();
      await rm(parent, { recursive: true, force: true });
    });
    const queued = adapter.execute({ op: 'snapshot' });
    await adapter.close();
    await assert.rejects(queued, /NATIVE_UNAVAILABLE/);
    assert.equal(existsSync(directory), false);
  },
);
test(
  'real native worker executes QHarness QServe, QFlow, QAgent missions, and QEval across worker restart',
  {
    skip: existsSync(binary)
      ? false
      : 'Build the native workspace adapter with npm run workspace:build',
  },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'neighbor-qh-native-'));
    let adapter = createNativeWorkspace({ directory, binary });
    t.after(async () => {
      await adapter.close();
      await rm(directory, { recursive: true, force: true });
    });

    const models = await adapter.execute({ op: 'qhModels' });
    assert.equal(models.object, 'list');
    assert.ok(models.data.length >= 6);

    const chat = await adapter.execute({
      op: 'qhOpenAiChatCompletions',
      model: 'auto',
      messages: [{ role: 'user', content: 'Verify QHarness stdio bridge.' }],
    });
    assert.equal(chat.object, 'chat.completion');
    assert.ok(chat.qh.resolvedModel);

    const mission = await adapter.execute({
      op: 'qhCreateMission',
      key: '55555555555555555555555555555551',
      payload: {
        title: 'Inspect Stormwater Corridor',
        objective: 'Create stormwater inspection task and verify durability',
      },
    });
    assert.equal(mission.status, 'committed');
    assert.match(mission.id, /^q1_/);

    await adapter.close();
    adapter = createNativeWorkspace({ directory, binary });

    const evalCommit = await adapter.execute({
      op: 'qhRunEval',
      key: '55555555555555555555555555555552',
      suite: 'qharness-core-20',
    });
    assert.equal(evalCommit.status, 'committed');

    const status = await adapter.execute({ op: 'qhStatus' });
    assert.equal(status.version, '0.2.0-build-006');
    assert.ok(status.missions.some((m) => m.id === mission.id));
    assert.equal(status.evaluations[0].effectiveStatus, 'partial');
    assert.equal(status.evaluations[0].payload.passedCount, 9);
    assert.equal(status.evaluations[0].payload.notRunCount, 11);
    assert.equal(status.evaluations[0].payload.scenarioCount, 20);
  },
);
