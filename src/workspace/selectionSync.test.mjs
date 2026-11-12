import test from 'node:test';
import assert from 'node:assert/strict';
import { createCapabilityBus } from './capabilityBus.js';
import { createWorkspaceRecordLookup } from './workspaceData.js';
import {
  synchronizeWorkspaceSelection,
  prepareWorkspaceSelection,
} from './selectionSync.js';

test('selection opens the actual Market product, offer or proposal view and Evidence tab', () => {
  const context = { tab: 'cart', selectedProductId: 'old' };
  prepareWorkspaceSelection('marketplace', context, {
    id: 'merchant',
    payload: { kind: 'market-product', productId: 'canonical' },
  });
  assert.equal(context.selectedProductId, 'canonical');
  assert.equal(context.tab, 'products');
  assert.equal(context.selected, 'merchant');
  for (const kind of ['market-offer', 'proposal', 'commitment']) {
    prepareWorkspaceSelection('marketplace', context, {
      id: kind,
      payload: { kind },
    });
    assert.equal(context.tab, kind === 'market-offer' ? 'offers' : 'proposals');
    assert.equal(context.selectedOfferId, kind);
  }
  const evidence = {
    claims: [{ id: 'claim' }],
    casebooks: [{ id: 'casebook' }],
  };
  for (const [id, tab] of [
    ['claim', 'claims'],
    ['casebook', 'casebooks'],
    ['original', 'artifacts'],
  ]) {
    prepareWorkspaceSelection('evidence', context, { id }, evidence);
    assert.equal(context.evidenceTab, tab);
  }
});

test('current projection lookup preserves precedence, revisions and removes revoked records', () => {
  const lookup = createWorkspaceRecordLookup([
    {
      id: 'product',
      title: 'Catalog',
      offers: [{ id: 'merchant', sellerName: 'Shop' }],
    },
  ]);
  const original = { id: 'record', revision: 1 };
  const projection = {
    snapshot: { items: [original] },
    domainNetwork: { offers: [{ id: 'record', revision: 99 }] },
  };
  assert.equal(lookup.find('record', projection), original);
  const next = { id: 'record', revision: 2 };
  projection.snapshot = { items: [next] };
  assert.equal(lookup.find('record', projection), next);
  assert.equal(
    lookup.find('merchant', projection).payload.productId,
    'product',
  );
  lookup.clear();
  assert.equal(lookup.find('record'), undefined);
  assert.equal(lookup.find('product').payload.kind, 'market-product');
});

test('repeated selection lookups scan each unchanged projection array only once', () => {
  let scans = 0;
  const items = new Proxy([{ id: 'one' }, { id: 'two' }], {
    get(target, prop, receiver) {
      if (prop === Symbol.iterator) scans++;
      return Reflect.get(target, prop, receiver);
    },
  });
  const lookup = createWorkspaceRecordLookup();
  for (let i = 0; i < 1000; i++)
    assert.equal(lookup.find('two', { snapshot: { items } }).id, 'two');
  assert.equal(scans, 1);
  assert.equal(lookup.find('two', { snapshot: { items: [] } }), undefined);
});

test('world selection resolves once for followers and leaves linked and independent windows alone', () => {
  const bus = createCapabilityBus();
  bus.setWindowContext('evidence', { contextMode: 'linked', linkGroup: 'B' });
  const contexts = new Map(
    ['records', 'marketplace', 'projects', 'evidence', 'social'].map((id) => [
      id,
      {},
    ]),
  );
  const selected = [],
    invalidated = [],
    resolved = [];
  const options = {
    bus,
    contexts,
    findAuthorized: (id) => {
      resolved.push(id);
      return {
        id,
        payload: { kind: 'market-product', productId: 'canonical' },
      };
    },
    select: (id, record) => {
      contexts.get(id).selected = record.id;
      selected.push([id, record.payload.productId]);
    },
    invalidate: (id) => invalidated.push(id),
  };
  bus.selectObject({ id: 'offer', sourceApp: 'world' });
  assert.equal(synchronizeWorkspaceSelection(options), true);
  assert.deepEqual(resolved, ['offer']);
  assert.deepEqual(selected, [
    ['records', 'canonical'],
    ['marketplace', 'canonical'],
    ['projects', 'canonical'],
  ]);
  assert.deepEqual(invalidated, ['records', 'marketplace', 'projects']);
  assert.equal(synchronizeWorkspaceSelection(options), false);
  assert.deepEqual(resolved, ['offer']);
});

test('linked selection resolves current authorization and never opens an unavailable object', () => {
  const bus = createCapabilityBus();
  const contexts = new Map(['projects', 'records'].map((id) => [id, {}]));
  for (const appId of contexts.keys())
    bus.setWindowContext(appId, { contextMode: 'linked', linkGroup: 'C' });
  bus.selectObject({ id: 'missing', sourceApp: 'projects' });
  let lookups = 0;
  const options = {
    bus,
    contexts,
    findAuthorized: () => {
      lookups++;
    },
    select: () => assert.fail('unavailable record selected'),
    invalidate: () => assert.fail('unavailable record rendered'),
  };
  assert.equal(synchronizeWorkspaceSelection(options), false);
  assert.equal(lookups, 1);
});
