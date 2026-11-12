import test from 'node:test';
import assert from 'node:assert/strict';
import { searchDesktop, actionHandoff } from './desktopCommands.js';
import { coveredFraction } from './worldPresentation.js';
import { createCapabilityBus } from './capabilityBus.js';
import { draftFieldKey } from './draftFields.js';
test('global search groups authorized records and never invents a result', () => {
  const records = [
    { id: 'authorized', title: 'Garden evidence', kind: 'document' },
  ];
  const groups = searchDesktop('garden', records);
  assert.equal(groups[2].items.length, 1);
  assert.equal(groups[2].items[0].id, 'authorized');
  assert.equal(
    searchDesktop('secret', records).flatMap((g) => g.items).length,
    0,
  );
  assert.ok(
    searchDesktop('', records)
      .find((g) => g.title === 'Actions')
      .items.some((a) => a.id === 'project.create'),
  );
});
test('opaque coverage is an exact clipped union and reveal has no overlap overcount', () => {
  const b = { x: 0, y: 0, width: 100, height: 100 };
  assert.equal(
    coveredFraction(b, [
      { ...b, width: 60 },
      { ...b, width: 60 },
    ]),
    0.6,
  );
  assert.equal(
    coveredFraction(b, [
      { ...b, width: 60 },
      { ...b, x: 60, width: 80 },
    ]),
    1,
  );
  assert.equal(
    coveredFraction(b, [{ x: 200, y: 0, width: 10, height: 10 }]),
    0,
  );
});
test('linked groups, independent selections and reset cannot leak prior session context', () => {
  const bus = createCapabilityBus();
  bus.setWindowContext('projects', { contextMode: 'linked', linkGroup: 'B' });
  bus.setWindowContext('records', { contextMode: 'linked', linkGroup: 'B' });
  bus.selectObject({ id: 'local', sourceApp: 'projects', title: 'Local' });
  assert.equal(bus.effectiveSelectionFor('records').id, 'local');
  bus.setWindowContext('records', { contextMode: 'independent' });
  assert.equal(bus.effectiveSelectionFor('records'), null);
  bus.selectObject({ id: 'own', sourceApp: 'records' });
  assert.equal(bus.effectiveSelectionFor('records').id, 'own');
  bus.reset();
  assert.equal(bus.getWorldSelection(), null);
  assert.equal(bus.peekHandoff('projects'), null);
});
test('handoffs require a known handler and currently resolvable object', () => {
  const open = [];
  const bus = createCapabilityBus({ onOpenApp: (id) => open.push(id) });
  bus.setResolver(() => null);
  assert.equal(bus.handoff({ targetApp: 'projects', action: 'eval' }), false);
  assert.equal(
    bus.handoff({
      targetApp: 'projects',
      action: 'inspect-object',
      reference: { id: 'gone' },
    }),
    false,
  );
  assert.equal(open.length, 0);
  assert.equal(
    actionHandoff('projects.startFromObject', { id: 'x', kind: 'document' }),
    null,
  );
});
test('draft field allowlist excludes credentials, file bytes and approval checks', () => {
  assert.equal(
    draftFieldKey('Project Title', { type: 'text', name: '' }),
    'project-title',
  );
  for (const type of ['password', 'file', 'checkbox', 'radio'])
    assert.equal(draftFieldKey('Title', { type, name: 'title' }), null);
  assert.equal(
    draftFieldKey('Title', { type: 'text', name: 'credential' }),
    null,
  );
});

test('legacy first-party handoffs become revision-pinned references and are checked again at consumption', () => {
  const bus = createCapabilityBus({ getOriginApp: () => 'projects' });
  const errors = [];
  bus.subscribe((e) => {
    if (e.type === 'handoff-error') errors.push(e);
  });
  let current = { id: 'record', revision: 3 };
  bus.setResolver((ref) =>
    current &&
    ref.id === current.id &&
    (!ref.revision || ref.revision === current.revision)
      ? current
      : null,
  );
  assert.equal(
    bus.handoff({
      targetApp: 'documents',
      action: 'inspect-object',
      payload: { objectId: 'record' },
    }),
    true,
  );
  assert.deepEqual(bus.peekHandoff('documents').reference, {
    id: 'record',
    revision: 3,
  });
  assert.equal(bus.peekHandoff('documents').originApp, 'projects');
  current = { id: 'record', revision: 4 };
  assert.equal(bus.consumeHandoff('documents'), null);
  assert.equal(errors.length, 1);
});
