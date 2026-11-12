import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatExactMoney,
  parseExactMoneyInput,
  createCapabilityBus,
} from './capabilityBus.js';
import {
  NEIGHBOR_CAPABILITY_REGISTRY,
  NEIGHBOR_SUPERSESSION_REGISTRY,
  resolveCapabilitiesForObject,
} from './registry.js';

test('ExactMoney formatting and parsing operate on exact integer minor units without float drift', () => {
  assert.equal(
    formatExactMoney({ amountMinorUnits: 145050, currency: 'USD' }),
    '$1,450.50',
  );
  assert.equal(formatExactMoney(48000), '$480.00');
  assert.deepEqual(parseExactMoneyInput('$1,450.50', 'USD'), {
    amountMinorUnits: 145050,
    currency: 'USD',
  });
  assert.deepEqual(parseExactMoneyInput('19.99', 'USD'), {
    amountMinorUnits: 1999,
    currency: 'USD',
  });
  assert.equal(parseExactMoneyInput('19.999', 'USD'), null);
  assert.equal(parseExactMoneyInput('-50', 'USD'), null);
  assert.equal(parseExactMoneyInput('abc', 'USD'), null);
});

test('CapabilityBus synchronizes Follow-World, Linked Group, and Independent window contexts and cross-app handoffs', () => {
  const opened = [];
  const flown = [];
  const bus = createCapabilityBus({
    onOpenApp: (id) => opened.push(id),
    onFlyTo: (coords) => flown.push(coords),
  });

  // Default modes: marketplace follows world, social is independent
  assert.equal(bus.getWindowContext('marketplace').contextMode, 'follow-world');
  assert.equal(bus.getWindowContext('social').contextMode, 'independent');

  bus.selectObject(
    {
      id: '11111111111111111111111111111111',
      kind: 'place',
      title: 'North Berkeley Commons',
      coordinates: [-122.2695, 37.8795],
      sourceApp: 'world',
    },
    { flyTo: true },
  );

  assert.equal(flown.length, 1);
  assert.equal(
    bus.effectiveSelectionFor('marketplace')?.title,
    'North Berkeley Commons',
  );
  assert.equal(bus.effectiveSelectionFor('social'), null);

  // Cycle social from independent -> follow-world -> linked A
  bus.cycleWindowContext('social');
  assert.equal(bus.getWindowContext('social').contextMode, 'follow-world');
  bus.cycleWindowContext('social');
  assert.equal(bus.getWindowContext('social').contextMode, 'linked');

  // Handoff from Projects BOM to Marketplace
  bus.handoff({
    targetApp: 'marketplace',
    action: 'source-bom',
    payload: { projectId: 'proj-1', query: 'materials' },
  });
  assert.deepEqual(opened, ['marketplace']);
  const consumed = bus.consumeHandoff('marketplace');
  assert.equal(consumed.action, 'source-bom');
  assert.equal(bus.consumeHandoff('marketplace'), null);
});

test('Machine-readable Capability Registry exposes 4 orthogonal status dimensions, supersession records, and object capability matching', () => {
  assert.ok(NEIGHBOR_CAPABILITY_REGISTRY.length >= 10);
  for (const cap of NEIGHBOR_CAPABILITY_REGISTRY) {
    assert.ok(cap.id);
    assert.ok(cap.specificationStatus);
    assert.ok(cap.implementationStatus);
    assert.ok(cap.verificationStatus);
    assert.ok(cap.releaseStatus);
    assert.ok(cap.evidence);
  }

  const offerCaps = resolveCapabilitiesForObject({
    id: '22222222222222222222222222222222',
    kind: 'market-offer',
    coordinates: [-122.27, 37.87],
  });
  assert.ok(
    offerCaps.some(
      (action) => action.actionId === 'marketplace.sourceForObject',
    ),
  );
  assert.ok(actionHasWorldFlyTo(offerCaps));

  const commitmentCaps = resolveCapabilitiesForObject({
    id: '33333333333333333333333333333333',
    kind: 'commitment',
    outcomeState: 'reported_complete',
  });
  assert.ok(
    commitmentCaps.some(
      (action) => action.actionId === 'marketplace.verifyOutcome',
    ),
  );

  assert.ok(
    NEIGHBOR_CAPABILITY_REGISTRY.some((cap) => cap.id === 'CAP-QH-SERVE-001'),
  );
  assert.ok(
    NEIGHBOR_CAPABILITY_REGISTRY.some((cap) => cap.id === 'CAP-QH-FLOW-001'),
  );
  assert.ok(
    NEIGHBOR_CAPABILITY_REGISTRY.some((cap) => cap.id === 'CAP-QH-AGENT-001'),
  );
  assert.ok(
    NEIGHBOR_CAPABILITY_REGISTRY.some((cap) => cap.id === 'CAP-QH-CONTROL-001'),
  );

  assert.ok(
    NEIGHBOR_SUPERSESSION_REGISTRY.some(
      (entry) => entry.supersededId === 'ARCH-RUST-HTTP-SERVICE-V1',
    ),
  );
  assert.ok(
    NEIGHBOR_SUPERSESSION_REGISTRY.some(
      (entry) =>
        entry.supersededId === 'SUPERSEDED-QHARNESS-STANDALONE-POSTGRES',
    ),
  );
});

function actionHasWorldFlyTo(actions) {
  return actions.some((action) => action.actionId === 'world.flyTo');
}
