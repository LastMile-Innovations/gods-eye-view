import { renderChatView } from './chatView.js';
import { renderHarnessView } from './harnessViews.js';
import { t } from '../i18n/index.js';
/**
 * NeighborOS Global AI Agent & Intent-to-Plan Compiler Application (`U18`, `INV-MKT-008`).
 * Compiles natural-language goals against live Quanta Marketplace offers and Places into
 * a governed "What I Heard" plan, requiring explicit human consent gates before atomic execution.
 */
import { formatExactMoney, parseExactMoneyInput } from './capabilityBus.js';

const PRESET_PROMPTS = [
  'Build a backyard timber workshop and perimeter fence with solar subpanel in Berkeley',
  'Coordinate a community tool lending shed and pier foundation build at North Berkeley Commons',
  'Repair storm-damaged redwood fence and install 240V workshop circuit',
];

export function renderAgentApp({
  context,
  content,
  domainNetwork,
  snapshot,
  bus,
  node,
  button,
  field,
  busy,
  blocked,
  commit,
  show,
  onTab,
  loadHarness,
  runWorkflow,
  sendChat,
  refreshChat,
}) {
  content.className = 'nd-app-body nw-domain-view';
  content.dataset.draftForm = `agent:${context.tab || 'main'}:v1`;
  content.replaceChildren();
  content.append(
    node(
      'nav',
      { className: 'nw-tabs', 'aria-label': t('Agent tools') },
      ...[
        ['chat', t('Chat')],
        ['main', t('Plans')],
        ['workflows', t('Workflows')],
        ['checks', t('Checks')],
      ].map(([tab, label]) =>
        button(label, () => onTab?.(tab), {
          className: (context.tab || 'main') === tab ? 'nw-primary' : '',
          'aria-pressed': String((context.tab || 'main') === tab),
        }),
      ),
    ),
  );
  if (context.tab === 'chat') {
    renderChatView({
      context,
      content,
      node,
      button,
      field,
      send: sendChat,
      refresh: refreshChat,
      load: loadHarness,
    });
    return;
  }
  if (['checks', 'workflows'].includes(context.tab)) {
    renderHarnessView({
      context,
      content,
      node,
      button,
      field,
      busy,
      blocked,
      commit,
      load: loadHarness,
      run: runWorkflow,
      show,
      openResult: (row) => {
        const kind = row.payload?.kind || row.kind;
        bus?.handoff({
          targetApp:
            kind === 'project'
              ? 'projects'
              : kind === 'market-offer'
                ? 'marketplace'
                : 'records',
          action: 'inspect-object',
          reference: { id: row.id, revision: row.revision },
          payload: { objectId: row.id },
        });
      },
    });
    return;
  }

  const plans = domainNetwork?.agentPlans || [];
  const offers = domainNetwork?.offers || [];
  const places = (snapshot?.items || []).filter(
    (i) => i.payload?.kind === 'place',
  );

  const handoff = bus?.consumeHandoff('agent');
  if (handoff && handoff.action === 'prompt-with-context') {
    context.prompt = handoff.payload?.prompt || context.prompt || '';
    context.placeId = handoff.payload?.placeId || context.placeId || '';
  }

  const head = node(
    'div',
    { className: 'nw-service-head nw-app-toolbar' },
    node(
      'div',
      { className: 'nw-head-row' },
      node('h1', { text: 'Agent' }),
      node(
        'div',
        { className: 'nw-stat-pills' },
        node('span', {
          className: 'nw-pill',
          text: `${offers.length} offers available`,
        }),
        node('span', {
          className: 'nw-pill',
          text: `${plans.length} compiled plans`,
        }),
      ),
    ),
  );
  content.append(head);

  const workspace = node('div', { className: 'nw-agent-workspace' });
  content.append(workspace);

  // Left Pane: Prompt Composer
  const promptIn = node('textarea', {
    name: 'natural-language-intent-prompt',
    rows: 4,
    placeholder: t(
      'e.g. Build a backyard timber workshop and perimeter fence with solar subpanel in Berkeley…',
    ),
    value: context.prompt || '',
  });
  const budgetIn = node('input', {
    name: 'target-budget-envelope-usd',
    placeholder: t('Optional target budget USD (e.g. 2400.00)'),
    value: context.budgetText || '',
  });
  const placeSelect = node(
    'select',
    { name: 'anchor-place-on-globe' },
    node('option', {
      value: '',
      text: '— Auto-select or Choose Neighborhood Place —',
    }),
    ...places.map((p) =>
      node('option', {
        value: p.id,
        text: p.payload.title,
        selected: p.id === context.placeId,
      }),
    ),
  );

  const presetRow = node(
    'details',
    { className: 'nw-preset-row' },
    node('summary', { text: t('Use an example') }),
  );
  for (const preset of PRESET_PROMPTS) {
    presetRow.append(
      button(
        `"${preset.slice(0, 48)}…"`,
        () => {
          context.prompt = preset;
          promptIn.value = preset;
          promptIn.dispatchEvent(new Event('input', { bubbles: true }));
        },
        { className: 'nw-small-btn' },
      ),
    );
  }

  const compilerCard = node(
    'article',
    { className: 'nw-service-card nw-form-card nw-agent-composer' },
    node('h2', { text: 'New plan' }),
    node('p', {
      className: 'nw-muted',
      text: 'Describe your goal. Review the proposed tasks, materials, and budget before creating a project.',
    }),
    presetRow,
    field('Goal', promptIn),
    node(
      'div',
      { className: 'nw-form-grid' },
      field('Budget (USD)', budgetIn),
      field('Place', placeSelect),
    ),
    node(
      'div',
      { className: 'nw-actions' },
      button(
        'Prepare plan',
        async () => {
          const textPrompt = promptIn.value.trim();
          if (textPrompt.length < 3) {
            show('Enter a clear description of what you want to plan.', true);
            return;
          }
          context.prompt = textPrompt;
          context.budgetText = budgetIn.value;
          context.placeId = placeSelect.value;
          const parsedBudget = parseExactMoneyInput(budgetIn.value, 'USD');
          await commit({
            op: 'compileAgentPlan',
            payload: {
              prompt: textPrompt,
              placeId: placeSelect.value || null,
              budgetMinorUnits: parsedBudget
                ? parsedBudget.amountMinorUnits
                : null,
              currency: 'USD',
            },
          });
        },
        { disabled: busy || blocked, className: 'nw-primary' },
      ),
    ),
  );
  workspace.append(compilerCard);

  // Right Pane: Compiled Plans & Consent Gates
  const stack = node('div', { className: 'nw-domain-stack nw-agent-plans' });
  workspace.append(stack);

  if (!plans.length) {
    stack.append(
      node(
        'article',
        { className: 'nw-service-card nw-empty-state' },
        node('h2', { text: 'No saved plans' }),
        node('p', {
          className: 'nw-muted',
          text: 'Your prepared plans will appear here for review.',
        }),
      ),
    );
    content.append(
      node(
        'footer',
        { className: 'nw-window-statusbar' },
        node('span', {
          className: 'nw-statusbar-item',
          text: '0 compiled plans',
        }),
        node('span', {
          className: 'nw-statusbar-item',
          text: `${offers.length} market offers indexed`,
        }),
      ),
    );
    return;
  }
  for (const plan of plans) {
    const p = plan.payload;
    const heard = p.whatIHeard || {};
    const proposed = p.proposedProject || {};
    const isExecuted = p.status === 'executed';

    if (!context.gates) context.gates = {};
    if (!context.gates[plan.id]) {
      context.gates[plan.id] = {
        whatIHeardConfirmed: false,
        financialGateApproved: false,
      };
    }
    const gateState = context.gates[plan.id];

    const card = node(
      'article',
      {
        className: `nw-service-card nw-agent-plan-card ${isExecuted ? 'nw-plan-executed' : 'nw-plan-draft'}`,
      },
      node(
        'div',
        { className: 'nw-card-top' },
        node('span', {
          className: `nw-badge nw-badge-${p.status}`,
          text: isExecuted ? 'Project created' : 'Draft · review required',
        }),
        node('strong', {
          className: 'nw-price-tag',
          text: `Target: ${formatExactMoney(heard.budgetMinorUnits)} · Est BOM: ${formatExactMoney(heard.estimatedTotalMinorUnits)}`,
        }),
      ),
      node('h2', { text: proposed.title || 'Compiled Agent Plan' }),
      node('p', {
        className: 'nw-muted',
        text: `Prompt: "${p.prompt}" · Revision ${plan.revision}`,
      }),
    );

    // "What I Heard" Summary Box
    const heardBox = node(
      'div',
      { className: 'nw-what-i-heard' },
      node('h3', { text: 'Plan summary' }),
      node('p', { text: heard.summary }),
      node(
        'div',
        { className: 'nw-stat-pills' },
        node('span', {
          className: 'nw-pill',
          text: `Place: ${heard.placeTitle || 'Local Workspace'}`,
        }),
        node('span', {
          className: 'nw-pill',
          text: `${heard.milestoneCount || 0} Milestones`,
        }),
        node('span', {
          className: 'nw-pill',
          text: `${heard.matchedOfferCount || 0} Matched Market Offers`,
        }),
      ),
    );
    card.append(heardBox);

    // Proposed Milestones & BOM preview
    const previewCols = node('div', { className: 'nw-project-columns' });
    const msList = node(
      'div',
      { className: 'nw-subpanel' },
      node('h3', { text: 'Proposed Milestones (Creates Tasks)' }),
    );
    for (const m of proposed.milestones || []) {
      msList.append(node('p', { text: `• ${m.title}` }));
    }

    const bomList = node(
      'div',
      { className: 'nw-subpanel' },
      node('h3', { text: 'Materials' }),
    );
    for (const b of proposed.bom || []) {
      bomList.append(
        node('p', {
          text: `• ${b.item} (${b.category}) — ${formatExactMoney(b.estimatedMinorUnits)}`,
        }),
      );
    }
    previewCols.append(msList, bomList);
    card.append(previewCols);

    // Matched Marketplace Offers
    if (Array.isArray(p.recommendedOffers) && p.recommendedOffers.length) {
      const recBox = node(
        'div',
        { className: 'nw-subpanel' },
        node('h3', { text: 'Related offers' }),
      );
      for (const ro of p.recommendedOffers) {
        recBox.append(
          node('p', {
            className: 'nw-muted',
            text: `${ro.title} · ${ro.providerName} (${formatExactMoney(ro.price)})`,
          }),
        );
      }
      card.append(recBox);
    }

    if (isExecuted) {
      const doneActions = node(
        'div',
        { className: 'nw-actions' },
        button(
          'Open project',
          () =>
            bus?.handoff({
              targetApp: 'projects',
              action: 'inspect-project',
              payload: { id: p.createdProjectId },
            }),
          { className: 'nw-primary' },
        ),
        button('Open tasks', () =>
          bus?.handoff({
            targetApp: 'board',
            action: 'inspect-tasks',
            payload: {},
          }),
        ),
      );
      card.append(doneActions);
    } else {
      // Explicit Consent Gates
      const gate1In = node('input', {
        type: 'checkbox',
        checked: gateState.whatIHeardConfirmed,
        onchange: (e) => {
          gateState.whatIHeardConfirmed = e.target.checked;
        },
      });
      const gate2In = node('input', {
        type: 'checkbox',
        checked: gateState.financialGateApproved,
        onchange: (e) => {
          gateState.financialGateApproved = e.target.checked;
        },
      });

      const gatesBox = node(
        'div',
        { className: 'nw-consent-gates' },
        node('h3', {
          text: 'Review and create',
        }),
        node(
          'label',
          { className: 'nw-gate-check' },
          gate1In,
          node('span', {
            text: 'I reviewed the project scope, place, and tasks.',
          }),
        ),
        node(
          'label',
          { className: 'nw-gate-check' },
          gate2In,
          node('span', {
            text: `I approve the ${formatExactMoney(heard.budgetMinorUnits)} budget and material estimates.`,
          }),
        ),
        node(
          'div',
          { className: 'nw-actions' },
          button(
            'Create project',
            async () => {
              if (
                !gateState.whatIHeardConfirmed ||
                !gateState.financialGateApproved
              ) {
                show(
                  'Both the "What I Heard" and Financial consent gates must be confirmed before execution.',
                  true,
                );
                return;
              }
              await commit({
                op: 'executeAgentPlan',
                planId: plan.id,
                expected: plan.revision,
                whatIHeardConfirmed: gateState.whatIHeardConfirmed,
                financialGateApproved: gateState.financialGateApproved,
              });
            },
            { disabled: busy || blocked, className: 'nw-primary' },
          ),
        ),
      );
      card.append(gatesBox);
    }

    stack.append(card);
  }
  content.append(
    node(
      'footer',
      { className: 'nw-window-statusbar' },
      node('span', {
        className: 'nw-statusbar-item',
        text: `${plans.length} compiled plan(s)`,
      }),
      node('span', {
        className: 'nw-statusbar-item',
        text: `${offers.length} market offers indexed`,
      }),
      node('span', {
        className: 'nw-statusbar-item',
        text: 'Human consent required before execution',
      }),
    ),
  );
}
