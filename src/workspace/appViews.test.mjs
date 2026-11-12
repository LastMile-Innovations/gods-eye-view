import test from 'node:test';
import assert from 'node:assert/strict';
import { renderProjectsApp } from './projectsApp.js';
import { renderAgentApp } from './agentApp.js';
import { renderHarnessView, stagesForViews } from './harnessViews.js';

// Small injected view host: exercise actual event handlers without a globe or native database.
function host() {
  const node = (tag, props = {}, ...children) => ({
    tag,
    ...props,
    dataset: {},
    children: children.filter(Boolean),
    handlers: {},
    classList: { add() {} },
    append(...items) {
      this.children.push(...items.filter(Boolean));
    },
    replaceChildren(...items) {
      this.children = items;
    },
    addEventListener(name, fn) {
      this.handlers[name] = fn;
    },
  });
  const button = (text, run, props) => node('button', { text, run, ...props });
  const field = (text, control) => node('label', { text }, control);
  const content = node('div');
  const nodes = (n = content) => [
    n,
    ...n.children.flatMap((c) => (typeof c === 'object' ? nodes(c) : [])),
  ];
  return { node, button, field, content, nodes };
}
const project = (id, title) => ({
  id,
  revision: 7,
  payload: {
    title,
    stage: 'plan',
    budget: { currency: 'USD', amountMinorUnits: 1234 },
    milestones: [],
    bom: [],
    refs: [],
  },
});

test('Projects master list selects one detail, preserves target references, and filters without rebuilding', () => {
  const h = host(),
    context = {},
    writes = [];
  renderProjectsApp({
    ...h,
    context,
    domainNetwork: {
      projects: [project('one', 'Garden'), project('two', 'Workshop')],
    },
    snapshot: { items: [] },
    bus: { consumeHandoff() {} },
    commit: (c) => writes.push(c),
  });
  assert.equal(context.selected, 'one');
  assert.equal(
    h.nodes().filter((n) => n.className === 'nw-service-card nw-project-card')
      .length,
    1,
  );
  h.nodes()
    .find((n) => n['aria-pressed'] === 'false')
    .run();
  assert.equal(context.selected, 'two');
  assert.deepEqual(JSON.parse(h.content.dataset.draftRefs), [
    { id: 'two', revision: 7 },
  ]);
  const filter = h.nodes().find((n) => n.type === 'search');
  filter.value = 'Garden';
  filter.handlers.input();
  assert.equal(
    h.nodes().find((n) => n['aria-pressed'] === 'true').hidden,
    true,
  );
  const stage = h.nodes().find((n) => n['aria-label'] === 'Project stage');
  stage.value = 'source';
  stage.handlers.change();
  assert.equal(writes[0].id, 'two');
  assert.equal(writes[0].expected, 7);
  assert.deepEqual(writes[0].payload.refs, []);
});
test('Agent-created project handoff opens the exact selected project', () => {
  const h = host(),
    context = {};
  renderProjectsApp({
    ...h,
    context,
    domainNetwork: {
      projects: [project('one', 'Garden'), project('two', 'Workshop')],
    },
    snapshot: { items: [] },
    bus: {
      consumeHandoff: () => ({
        action: 'inspect-project',
        payload: { id: 'two' },
      }),
    },
  });
  assert.equal(context.selected, 'two');
});
test('Agent consent begins unchecked and prevents execution until both choices are made', async () => {
  const h = host(),
    context = {},
    writes = [],
    messages = [];
  renderAgentApp({
    ...h,
    context,
    domainNetwork: {
      agentPlans: [
        {
          id: 'plan',
          revision: 8,
          payload: { status: 'draft', whatIHeard: {}, proposedProject: {} },
        },
      ],
    },
    snapshot: { items: [] },
    commit: (c) => writes.push(c),
    show: (s) => messages.push(s),
  });
  const checks = h.nodes().filter((n) => n.type === 'checkbox');
  assert.equal(checks.length, 2);
  assert.ok(checks.every((n) => n.checked === false));
  const submit = h.nodes().find((n) => n.text === 'Create project');
  await submit.run();
  assert.equal(writes.length, 0);
  assert.equal(messages.length, 1);
  checks.forEach((n) => n.onchange({ target: { checked: true } }));
  await submit.run();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].expected, 8);
});

test('checks hide legacy pass claims and show executed and missing scenario evidence', () => {
  const h = host();
  renderHarnessView({
    ...h,
    context: {
      tab: 'checks',
      harness: {
        evaluations: [
          {
            effectiveStatus: 'unverified_legacy',
            payload: {
              title: 'Fake success',
              passedCount: 20,
              scenarios: [{ name: 'Fake result' }],
            },
          },
          {
            effectiveStatus: 'partial',
            payload: {
              title: 'Executed checks',
              passedCount: 9,
              failedCount: 0,
              notRunCount: 11,
              scenarios: [
                {
                  id: 'QH-EVAL-001',
                  name: 'Research',
                  status: 'not_run',
                  reason: 'No real provider',
                  durationMicros: null,
                },
              ],
            },
          },
        ],
      },
    },
    load() {},
  });
  assert.ok(h.nodes().some((n) => n.text === 'Unverified earlier result'));
  assert.ok(
    h.nodes().some((n) => n.text === '9 passed · 0 failed · 11 not run'),
  );
  assert.ok(h.nodes().some((n) => n.text === 'No real provider'));
  assert.ok(
    !h
      .nodes()
      .some((n) => n.text === 'Fake result' || n.text === 'Fake success'),
  );
});
test('workflow composer saves an explicit read definition without granting approval', async () => {
  const h = host();
  let command,
    loads = 0;
  const context = { tab: 'workflows', harness: { workflows: [] } };
  renderHarnessView({
    ...h,
    context,
    load: () => loads++,
    commit: async (c) => {
      command = c;
      return { status: 'committed' };
    },
    show: assert.fail,
  });
  h.nodes().find((n) => n.name === 'title').value = 'My workspace overview';
  await h
    .nodes()
    .find((n) => n.text === 'Save workflow draft')
    .run();
  assert.equal(command.op, 'qhSaveWorkflow');
  assert.deepEqual(command.payload.stages, [
    { id: 'read-1', action: 'quanta.query' },
  ]);
  assert.equal(command.payload.validatedByEval, undefined);
  assert.equal(loads, 1);
});

test('editing read views retains exact historical inputs, duplicate action stages and their order', () => {
  const existing = [
    { id: 'history-early', action: 'world.timeQuery', input: { asKnownAt: 5 } },
    { id: 'records', action: 'quanta.query' },
    { id: 'history-late', action: 'world.timeQuery', input: { asKnownAt: 10 } },
  ];
  assert.deepEqual(
    stagesForViews(existing, ['quanta.query', 'world.timeQuery']),
    existing,
  );
  const filtered = stagesForViews(existing, [
    'world.timeQuery',
    'market.searchOffers',
  ]);
  assert.deepEqual(filtered.slice(0, 2), [existing[0], existing[2]]);
  assert.equal(filtered[2].action, 'market.searchOffers');
  assert.equal(existing.length, 3);
});

test('Chat is explicit text only, transient, and unavailable until server transport is configured', async () => {
  const h = host();
  const sent = [];
  const context = { tab: 'chat' };
  renderAgentApp({
    ...h,
    context,
    sendChat: (text) => sent.push(text),
    refreshChat: () => {},
    loadHarness: () => {},
  });
  assert.equal(h.content.dataset.draftForm, undefined);
  assert.ok(h.nodes().some((n) => n.text === 'Chat is not available yet.'));
  assert.equal(
    h.nodes().some((n) => n.text === 'Send'),
    false,
  );
  context.harness = {
    executionAvailability: { chat: 'configured_unverified' },
  };
  context.chatMessages = [
    { role: 'assistant', content: '<script>untrusted</script>' },
  ];
  renderAgentApp({
    ...h,
    context,
    sendChat: (text) => sent.push(text),
    refreshChat: () => {},
    loadHarness: () => {},
  });
  assert.ok(h.nodes().some((n) => n.text === '<script>untrusted</script>'));
  const input = h.nodes().find((n) => n.name === 'agent-chat-text');
  input.value = 'Typed question';
  input.handlers.input();
  await h
    .nodes()
    .find((n) => n.text === 'Send')
    .run();
  assert.deepEqual(sent, ['Typed question']);
  assert.equal(context.chatInput, 'Typed question');
  context.chatPending = true;
  renderAgentApp({ ...h, context });
  assert.equal(
    h.nodes().find((n) => n.text === 'Waiting for a response…').disabled,
    true,
  );
});
