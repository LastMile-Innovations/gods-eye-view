/** Synthetic lookup-only microbenchmark; excludes DOM, native reads and rendering. */
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { writeFile } from 'node:fs/promises';
import { createWorkspaceRecordLookup } from '../src/workspace/workspaceData.js';

const snapshot = {
  items: Array.from({ length: 10000 }, (_, i) => ({
    id: `record-${i}`,
    revision: 1,
    payload: { title: `Synthetic ${i}` },
  })),
};
const domainNetwork = {
  projects: [],
  offers: [],
  proposals: [],
  commitments: [],
};
const evidenceNetwork = { artifacts: [], claims: [], casebooks: [] };
const projection = { snapshot, domainNetwork, evidenceNetwork };
// Frozen previous shell lookup: materialize all authorized rows on every call.
const before = (id) =>
  [
    ...snapshot.items,
    ...domainNetwork.projects,
    ...domainNetwork.offers,
    ...domainNetwork.proposals,
    ...domainNetwork.commitments,
    ...evidenceNetwork.artifacts,
    ...evidenceNetwork.claims,
    ...evidenceNetwork.casebooks,
  ].find((record) => record.id === id);
const lookup = createWorkspaceRecordLookup();
const after = (id) => lookup.find(id, projection);
const run = (find, sample) => {
  const start = performance.now();
  for (let app = 0; app < 11; app++) {
    const id = `record-${9900 + (sample % 100)}`;
    assert.equal(find(id), snapshot.items[9900 + (sample % 100)]);
  }
  return performance.now() - start;
};
for (let i = 0; i < 30; i++) {
  run(before, i);
  run(after, i);
}
const measurements = { before: [], after: [] };
for (let i = 0; i < 200; i++) {
  // Alternate ordering to reduce one-sided warm-up/GC bias; retain every sample.
  for (const name of i % 2 ? ['after', 'before'] : ['before', 'after'])
    measurements[name].push(run(name === 'before' ? before : after, i));
}
const summarize = (samples) => {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    p50Ms: sorted[Math.floor(sorted.length * 0.5)],
    p95Ms: sorted[Math.floor(sorted.length * 0.95)],
  };
};
const receipt = {
  scope:
    'Synthetic warm authorized lookup only; 10000 records, 11 lookups per sample, 200 samples. Excludes DOM, selection dispatch, native storage, network and rendering. Not a product latency SLO.',
  node: process.version,
  before: summarize(measurements.before),
  after: summarize(measurements.after),
  measurements,
};
await writeFile(
  new URL(
    '../../research/unified-world/integration-hardening/selection-benchmark.json',
    import.meta.url,
  ),
  JSON.stringify(receipt, null, 2) + '\n',
);
console.info(JSON.stringify({ ...receipt, measurements: undefined }, null, 2));
