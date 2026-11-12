/** Fixed local adapter workload. Synthetic data; no production throughput claim. */
import { performance } from 'node:perf_hooks';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir, cpus, platform, arch } from 'node:os';
import { join } from 'node:path';
import { createNativeWorkspace } from '../server/workspace/native.js';
import assert from 'node:assert/strict';
const directory = await mkdtemp(join(tmpdir(), 'neighbor-bench-'));
const adapter = createNativeWorkspace({ directory });
const key = (n) => n.toString(16).padStart(32, '0');
const samples = [],
  imports = [];
try {
  const start = performance.now();
  for (let i = 0; i < 64; i++) {
    const r = await adapter.execute({
      op: 'write',
      key: key(i + 1),
      payload: {
        kind: i % 2 ? 'task' : 'need',
        title: `Work ${i}`,
        description: 'Fixed native workload',
        status: 'open',
        refs: [],
      },
    });
    assert.equal(r.status, 'committed');
  }
  for (let i = 0; i < 8; i++) {
    const r = await adapter.execute({
      op: 'import',
      key: key(i + 100),
      payload: {
        kind: 'document',
        title: `source-${i}.md`,
        description: 'Fixed source fixture',
        status: 'open',
        refs: [],
      },
      original: `# Exact fixture ${i}\r\n`,
    });
    assert.equal(r.status, 'committed');
    imports.push(r.id);
  }
  const loadMs = performance.now() - start;
  for (let i = 0; i < 12; i++) {
    const t = performance.now(),
      result = await adapter.execute({ op: 'snapshot' });
    samples.push(performance.now() - t);
    assert.equal(result.items.length, 72);
    assert.equal(
      result.items.filter((i) => i.epistemic === 'Authored').length,
      64,
    );
    assert.equal(result.items.filter((i) => i.hasEvidence).length, 8);
    assert.equal(
      result.items.filter((i) => i.payload.status === 'open').length,
      72,
    );
  }
  for (let i = 0; i < 8; i++)
    assert.equal(
      (await adapter.execute({ op: 'evidence', id: imports[i] })).original,
      `# Exact fixture ${i}\r\n`,
    );
  const ordered = [...samples].sort((a, b) => a - b);
  console.log(
    JSON.stringify(
      {
        workload: '64-authored-8-documents-12-snapshots-v1',
        node: process.version,
        platform: platform(),
        arch: arch(),
        cpu: cpus()[0].model,
        loadMs,
        snapshotMs: samples,
        p50Ms: ordered[6],
        p95Ms: ordered[11],
        semanticChecks:
          '72 authorized rows; 64 authored; 8 evidence; exact original CRLF bytes',
      },
      null,
      2,
    ),
  );
} finally {
  adapter.close();
  await rm(directory, { recursive: true, force: true });
}
