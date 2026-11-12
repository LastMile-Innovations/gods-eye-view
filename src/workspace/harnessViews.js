import { t } from '../i18n/index.js';

const readActions = ['quanta.query', 'market.searchOffers', 'world.timeQuery'];
const names = () => [t('Records'), t('Market offers'), t('World history')];

/** Preserve saved history cutoffs, stage IDs and ordering when a workflow is renamed. */
export function stagesForViews(existing = [], actions = []) {
  const stages = existing.filter((stage) => actions.includes(stage.action));
  const ids = new Set(stages.map((stage) => stage.id));
  let next = 1;
  for (const action of actions) {
    if (stages.some((stage) => stage.action === action)) continue;
    while (ids.has(`read-${next}`)) next++;
    const id = `read-${next++}`;
    ids.add(id);
    stages.push({ id, action });
  }
  return stages;
}

/** Evidence status is taken from the server classification, never legacy pass counters. */
export function renderHarnessView({
  context,
  content,
  node,
  button,
  field,
  busy,
  blocked,
  commit,
  load,
  run,
  show,
  openResult,
}) {
  const data = context.harness;
  const disabled = busy || blocked || context.harnessLoading;
  content.append(
    node(
      'div',
      { className: 'nw-actions' },
      button(t('Refresh'), load, { disabled }),
    ),
  );
  if (context.tab === 'checks') {
    content.append(
      node(
        'article',
        { className: 'nw-service-card' },
        node('h1', { text: t('System checks') }),
        node('p', {
          className: 'nw-muted',
          text: t(
            'Runs isolated native checks. Missing scenarios stay visible; these results do not certify a production release.',
          ),
        }),
        button(
          t('Run core checks'),
          async () => {
            await commit({ op: 'qhRunEval', suite: 'qharness-core-20' });
            await load();
          },
          { className: 'nw-primary', disabled },
        ),
      ),
    );
    for (const row of data?.evaluations || []) {
      const p = row.payload;
      const legacy = row.effectiveStatus === 'unverified_legacy';
      const card = node(
        'article',
        { className: 'nw-service-card' },
        node('h2', { text: legacy ? t('Unverified earlier result') : p.title }),
        node('p', {
          text: legacy
            ? t('This earlier record contains no executed-check evidence.')
            : t('{passed} passed · {failed} failed · {pending} not run', {
                passed: p.passedCount,
                failed: p.failedCount,
                pending: p.notRunCount,
              }),
        }),
      );
      if (!legacy)
        for (const scenario of p.scenarios || []) {
          const details = node(
            'details',
            {},
            node('summary', {
              text: `${scenario.id} · ${scenario.name} · ${scenario.status}`,
            }),
          );
          if (scenario.reason)
            details.append(node('p', { text: scenario.reason }));
          if (scenario.error)
            details.append(node('p', { text: scenario.error }));
          if (scenario.durationMicros !== null)
            details.append(
              node('p', {
                className: 'nw-muted',
                text: t('Measured duration: {value} ms', {
                  value: (scenario.durationMicros / 1000).toFixed(2),
                }),
              }),
            );
          for (const observation of scenario.observations || [])
            details.append(
              node('pre', { text: JSON.stringify(observation, null, 2) }),
            );
          card.append(details);
        }
      content.append(card);
    }
    if (data && !data.evaluations.length)
      content.append(node('p', { text: t('No checks have been run.') }));
    return;
  }
  const workflows = data?.workflows || [];
  const editing = workflows.find((w) => w.id === context.editWorkflowId);
  content.dataset.draftForm = `agent:workflow-${editing?.id || 'new'}:v1`;
  const title = node('input', {
    name: 'title',
    disabled,
    value: editing?.payload.title || '',
    placeholder: t('Workflow name'),
  });
  const labels = names();
  const selections = readActions.map((action, index) => {
    const input = node('input', {
      type: 'checkbox',
      disabled,
      checked: editing
        ? editing.payload.stages?.some((s) => s.action === action)
        : index === 0,
    });
    return { action, input, label: labels[index] };
  });
  content.dataset.draftRefs = JSON.stringify(
    editing ? [{ id: editing.id, revision: editing.revision }] : [],
  );
  const save = async () => {
    const selected = selections.filter((s) => s.input.checked);
    if (title.value.trim().length < 3 || !selected.length) {
      show(t('Enter a name and select at least one data view.'), true);
      return;
    }
    const saved = await commit({
      op: 'qhSaveWorkflow',
      ...(editing ? { id: editing.id, expected: editing.revision } : {}),
      payload: {
        workflowId: editing?.payload.workflowId || 'workspace.read-overview.v1',
        title: title.value.trim(),
        origin: editing?.payload.origin || 'authored',
        stages: stagesForViews(
          editing?.payload.stages,
          selected.map((s) => s.action),
        ),
      },
    });
    if (!saved) return;
    context.editWorkflowId = saved.id;
    context.workflowResult = undefined;
    await load();
  };
  content.append(
    node(
      'article',
      { className: 'nw-service-card' },
      node('h1', { text: t('Read workflows') }),
      node('p', {
        className: 'nw-muted',
        text: t(
          'Combine current authorized views. Validation executes the reads; editing requires fresh validation. No model or external action is used.',
        ),
      }),
      field(t('Workflow name'), title),
      node(
        'div',
        { className: 'nw-workflow-choices' },
        ...selections.map((s) => field(s.label, s.input)),
      ),
      node(
        'div',
        { className: 'nw-actions' },
        button(editing ? t('Save changes') : t('Save workflow draft'), save, {
          className: 'nw-primary',
          disabled,
        }),
        editing
          ? button(t('Cancel edit'), () => {
              context.editWorkflowId = undefined;
              load();
            })
          : null,
      ),
    ),
  );
  for (const row of workflows) {
    const validated = row.payload.status === 'validated_read_only';
    content.append(
      node(
        'article',
        { className: 'nw-service-card' },
        node('h2', { text: row.payload.title }),
        node('p', {
          text: validated
            ? t('Validated read-only definition')
            : t('Validation required'),
        }),
        node('p', {
          className: 'nw-muted',
          text: (row.payload.stages || [])
            .map((s) => labels[readActions.indexOf(s.action)] || s.action)
            .join(' → '),
        }),
        node(
          'div',
          { className: 'nw-actions' },
          button(
            t('Edit workflow'),
            () => {
              context.editWorkflowId = row.id;
              context.workflowResult = undefined;
              load();
            },
            { disabled },
          ),
          button(
            t('Validate reads'),
            async () => {
              await commit({
                op: 'qhValidateWorkflow',
                workflowId: row.id,
                expected: row.revision,
              });
              await load();
            },
            { disabled },
          ),
          button(t('Run workflow'), () => run(row.id), {
            disabled: disabled || !validated,
          }),
        ),
      ),
    );
  }
  if (context.workflowResult) {
    const results = node(
      'article',
      { className: 'nw-service-card', 'aria-label': t('Workflow results') },
      node('h2', { text: t('Workflow results') }),
    );
    for (const stage of context.workflowResult.stages || []) {
      const section = node(
        'section',
        {},
        node('h3', {
          text: labels[readActions.indexOf(stage.action)] || stage.action,
        }),
      );
      const history = stage.output.temporalCategories?.asKnownHistory;
      const rows =
        stage.output.items ||
        (history
          ? [
              ...(history.records || []),
              ...(history.projects || []),
              ...(history.commitments || []),
            ]
          : []);
      if (!rows.length)
        section.append(
          node('p', {
            className: 'nw-muted',
            text: t('No results in this view.'),
          }),
        );
      for (const row of rows) {
        const payload = row.payload || row;
        section.append(
          node(
            'div',
            { className: 'nw-workflow-result-row' },
            node('strong', { text: payload.title || t('Untitled record') }),
            payload.description
              ? node('p', {
                  className: 'nw-muted',
                  text: payload.description.slice(0, 240),
                })
              : null,
            openResult ? button(t('Open'), () => openResult(row)) : null,
          ),
        );
      }
      section.append(
        node(
          'details',
          {},
          node('summary', { text: t('Technical details') }),
          node('pre', { text: JSON.stringify(stage.output, null, 2) }),
        ),
      );
      results.append(section);
    }
    content.append(results);
  }
}
