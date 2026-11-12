import { t } from '../i18n/index.js';
/**
 * NeighborOS Projects, Missions & Build Tracker Application (`U16`).
 * End-to-end execution of real-world neighborhood projects (Needs -> Plan -> Source -> Execute -> Verify -> Completed)
 * with interactive Milestones, Bill of Materials (BOM), and 1-click Marketplace sourcing.
 */
import { formatExactMoney, parseExactMoneyInput } from './capabilityBus.js';

const STAGES = ['needs', 'plan', 'source', 'execute', 'verify', 'completed'];

export function renderProjectsApp({
  context,
  content,
  domainNetwork,
  snapshot,
  evidenceNetwork,
  bus,
  node,
  button,
  field,
  busy,
  blocked,
  commit,
  show,
}) {
  content.className = 'nd-app-body nw-domain-view nw-projects-app';
  content.replaceChildren();

  const projects = domainNetwork?.projects || [];
  const offers = domainNetwork?.offers || [];
  const proposals = domainNetwork?.proposals || [];
  const places = (snapshot?.items || []).filter(
    (i) => i.payload?.kind === 'place',
  );

  const handoff = bus?.consumeHandoff('projects');
  if (handoff) {
    if (handoff.action === 'new-project-at-place') {
      context.tab = 'create';
      context.preselectedPlaceId = handoff.payload?.placeId || '';
      context.preselectedPlaceTitle = handoff.payload?.placeTitle || '';
    } else if (
      handoff.action === 'inspect-project' ||
      handoff.action === 'inspect-object'
    ) {
      context.selected =
        handoff.reference?.id ||
        handoff.payload?.objectId ||
        handoff.payload?.id;
      context.tab = 'list';
    } else if (handoff.action === 'attach-offer') {
      context.pendingOfferAttachment = handoff.payload;
      context.tab = 'list';
    }
  }

  delete content.dataset.draftRefs;
  content.dataset.draftForm = `projects:${context.tab || 'main'}:v1`;
  const tab = context.tab || 'list';

  const rerender = () =>
    renderProjectsApp({
      context,
      content,
      domainNetwork,
      snapshot,
      evidenceNetwork,
      bus,
      node,
      button,
      field,
      busy,
      blocked,
      commit,
      show,
    });
  const head = node(
    'div',
    { className: 'nw-service-head nw-app-toolbar' },
    node('h1', { text: t('Projects') }),
    node('span', {
      className: 'nw-toolbar-summary',
      text: String(projects.length),
    }),
    button(
      t('All projects'),
      () => {
        context.tab = 'list';
        rerender();
      },
      { hidden: tab !== 'create' },
    ),
    button(
      t('New project'),
      () => {
        context.tab = 'create';
        rerender();
      },
      { className: 'nw-primary' },
    ),
    button(t('Plan with Agent'), () =>
      bus?.handoff({
        targetApp: 'agent',
        action: 'prompt-with-context',
        payload: { prompt: '' },
      }),
    ),
  );
  content.append(head);

  if (context.pendingOfferAttachment && projects.length > 0) {
    const att = context.pendingOfferAttachment;
    const banner = node(
      'div',
      { className: 'nw-handoff-banner' },
      node('strong', {
        text: `Ready to attach Offer "${att.offerTitle}" (${formatExactMoney(att.price)}) to a Project:`,
      }),
      button(
        'Dismiss',
        () => {
          context.pendingOfferAttachment = null;
          renderProjectsApp({
            context,
            content,
            domainNetwork,
            snapshot,
            evidenceNetwork,
            bus,
            node,
            button,
            field,
            busy,
            blocked,
            commit,
            show,
          });
        },
        { className: 'nw-small-btn' },
      ),
    );
    content.append(banner);
  }

  if (tab === 'create') {
    const titleIn = node('input', {
      placeholder: t('e.g. North Berkeley Backyard Workshop & Fence'),
      value: context.preselectedPlaceTitle
        ? `${context.preselectedPlaceTitle} Build Project`
        : '',
    });
    const budgetIn = node('input', {
      placeholder: t('Exact USD budget (e.g. 2400.00)'),
      value: '',
    });
    const stageSelect = node(
      'select',
      {},
      ...STAGES.map((s) =>
        node('option', {
          value: s,
          text: s.toUpperCase(),
          selected: s === 'plan',
        }),
      ),
    );
    const placeSelect = node(
      'select',
      {},
      node('option', { value: '', text: '— Select Neighborhood Place —' }),
      ...places.map((p) =>
        node('option', {
          value: p.id,
          text: p.payload.title,
          selected: p.id === context.preselectedPlaceId,
        }),
      ),
    );
    const descIn = node('textarea', {
      rows: 3,
      placeholder: t(
        'Project goals, site constraints, and neighborhood scope…',
      ),
    });
    const milestonesIn = node('textarea', {
      rows: 3,
      value: '',
      placeholder: t('One milestone per line'),
    });
    const bomIn = node('textarea', {
      rows: 3,
      value: '',
      placeholder: t('Item | materials | 0.00'),
    });

    const formCard = node(
      'article',
      { className: 'nw-service-card nw-form-card' },
      node('h2', { text: 'Create a project' }),
      button('Use example', () => {
        titleIn.value = 'Community workshop';
        budgetIn.value = '2400.00';
        milestonesIn.value =
          'Review site\nGather materials\nComplete and review';
        bomIn.value = 'Timber | materials | 480.00';
        titleIn.dispatchEvent(new Event('input', { bubbles: true }));
      }),
      node(
        'div',
        { className: 'nw-form-grid' },
        field('Project Title', titleIn),
        field('Total Budget (USD)', budgetIn),
        field('Initial Stage', stageSelect),
        field('Place on Globe', placeSelect),
      ),
      field('Project Description', descIn),
      field('Milestones (one per line)', milestonesIn),
      field('Bill of Materials (Format: Item | category | USD amount)', bomIn),
      node(
        'div',
        { className: 'nw-actions' },
        button(
          'Save project',
          async () => {
            const budgetMoney = parseExactMoneyInput(budgetIn.value, 'USD');
            if (!budgetMoney) {
              show('Enter a valid exact USD budget.', true);
              return;
            }
            const milestones = milestonesIn.value
              .split('\n')
              .map((l) => l.trim())
              .filter(Boolean)
              .map((title) => ({ title, status: 'open' }));
            const bom = [];
            for (const line of bomIn.value
              .split('\n')
              .map((l) => l.trim())
              .filter(Boolean)) {
              const [itemPart, catPart = 'materials', pricePart = '0'] = line
                .split('|')
                .map((s) => s.trim());
              const parsed = parseExactMoneyInput(pricePart, 'USD') || {
                amountMinorUnits: 0,
              };
              bom.push({
                item: itemPart || 'Material item',
                category: [
                  'skilled-trades',
                  'tool-rental',
                  'materials',
                  'local-services',
                  'civic-bounty',
                  'equipment',
                ].includes(catPart)
                  ? catPart
                  : 'materials',
                estimatedMinorUnits: parsed.amountMinorUnits,
                status: 'needed',
              });
            }
            const chosenPlace = places.find((p) => p.id === placeSelect.value);
            await commit({
              op: 'saveProject',
              payload: {
                title: titleIn.value.trim(),
                description: descIn.value.trim(),
                stage: stageSelect.value,
                budget: budgetMoney,
                placeId: chosenPlace ? chosenPlace.id : null,
                coordinates: chosenPlace?.payload?.coordinates || null,
                milestones,
                bom,
                linkedOfferIds: [],
                refs: chosenPlace ? [chosenPlace.id] : [],
              },
            });
            context.tab = 'list';
          },
          { disabled: busy || blocked, className: 'nw-primary' },
        ),
      ),
    );
    content.append(formCard);
    return;
  }

  if (!projects.length) {
    content.append(
      node(
        'article',
        { className: 'nw-service-card' },
        node('h2', { text: t('No projects') }),
        node('p', {
          className: 'nw-muted',
          text: t(
            'Create a project to organize its tasks, materials, and records.',
          ),
        }),
      ),
    );
    return;
  }

  const currentProject =
    projects.find((p) => p.id === context.selected) || projects[0];
  context.selected = currentProject.id;
  content.dataset.draftForm = `projects:detail:${currentProject.id}:v1`;
  content.dataset.draftRefs = JSON.stringify([
    { id: currentProject.id, revision: currentProject.revision },
  ]);
  const sidebar = node('aside', {
    className: 'nw-project-list',
    'aria-label': t('Project list'),
  });
  const filter = node('input', {
    type: 'search',
    'aria-label': t('Filter projects'),
    placeholder: t('Filter projects'),
    value: context.projectQuery || '',
  });
  sidebar.append(filter);
  const rows = projects.map((proj) => {
    const row = button(
      '',
      () => {
        context.selected = proj.id;
        rerender();
      },
      {
        className: 'nw-project-list-row',
        'aria-pressed': String(proj.id === currentProject.id),
      },
    );
    row.append(
      node('strong', { text: proj.payload.title }),
      node('span', {
        text: `${proj.payload.stage} · ${formatExactMoney(proj.payload.budget)}`,
      }),
    );
    const matches = () => {
      row.hidden = !proj.payload.title
        .toLowerCase()
        .includes((context.projectQuery || '').toLowerCase());
    };
    matches();
    sidebar.append(row);
    return matches;
  });
  filter.addEventListener('input', () => {
    context.projectQuery = filter.value;
    rows.forEach((match) => match());
  });
  const list = node('main', { className: 'nw-project-detail' });
  const workspace = node(
    'div',
    { className: 'nw-project-workspace' },
    sidebar,
    list,
  );
  for (const proj of [currentProject]) {
    const p = proj.payload;
    const linkedOffers = (p.linkedOfferIds || [])
      .map((id) => offers.find((o) => o.id === id))
      .filter(Boolean);
    const linkedProposals = proposals.filter(
      (pr) => pr.payload.projectId === proj.id,
    );
    const completedMilestones = (p.milestones || []).filter(
      (m) => m.status === 'done',
    ).length;
    const totalMilestones = (p.milestones || []).length;

    const saveUpdatedProject = (overrides) =>
      commit({
        op: 'saveProject',
        id: proj.id,
        expected: proj.revision,
        payload: {
          title: p.title,
          description: p.description,
          stage: p.stage,
          budget: p.budget,
          placeId: p.placeId,
          coordinates: p.coordinates,
          milestones: p.milestones || [],
          bom: p.bom || [],
          linkedOfferIds: p.linkedOfferIds || [],
          refs: p.refs || [],
          ...overrides,
        },
      });

    const card = node(
      'article',
      { className: 'nw-service-card nw-project-card' },
      node(
        'div',
        { className: 'nw-card-top' },
        node('span', {
          className: `nw-badge nw-badge-stage-${p.stage}`,
          text: p.stage,
        }),
        node('strong', {
          className: 'nw-price-tag',
          text: `${t('Budget')}: ${formatExactMoney(p.budget)}`,
        }),
      ),
      node('h2', { text: p.title }),
      node('p', { className: 'nw-muted', text: p.description }),
    );

    const stageSelect = node(
      'select',
      { 'aria-label': t('Project stage'), disabled: busy || blocked },
      ...STAGES.map((stage) =>
        node('option', {
          value: stage,
          text: stage,
          selected: stage === p.stage,
        }),
      ),
    );
    stageSelect.addEventListener('change', () =>
      saveUpdatedProject({ stage: stageSelect.value }),
    );
    const stageTrack = node(
      'div',
      { className: 'nw-stage-track' },
      ...STAGES.map((stage, idx) => {
        const currentIdx = STAGES.indexOf(p.stage);
        const stateCls =
          idx < currentIdx
            ? 'nw-stage-step nw-stage-done'
            : idx === currentIdx
              ? 'nw-stage-step nw-stage-active'
              : 'nw-stage-step';
        return node('span', { className: stateCls, text: stage });
      }),
    );

    card.append(
      stageTrack,
      node(
        'div',
        { className: 'nw-project-properties' },
        node('span', { text: t('Status') }),
        stageSelect,
        node('span', {
          text: `${t('Materials')}: ${formatExactMoney(p.bomTotalMinorUnits || 0)}`,
        }),
        node('span', {
          className: 'nw-muted',
          text: `Milestones: ${completedMilestones}/${totalMilestones}`,
        }),
      ),
    );

    if (context.pendingOfferAttachment) {
      const att = context.pendingOfferAttachment;
      card.append(
        node(
          'div',
          { className: 'nw-actions' },
          button(
            `+ Attach Offer "${att.offerTitle}" to this Project`,
            async () => {
              const nextOffers = Array.from(
                new Set([...(p.linkedOfferIds || []), att.offerId]),
              );
              await saveUpdatedProject({ linkedOfferIds: nextOffers });
              context.pendingOfferAttachment = null;
            },
            { disabled: busy || blocked, className: 'nw-primary' },
          ),
        ),
      );
    }

    // Two-column layout: Milestones & BOM
    const columns = node('div', { className: 'nw-project-columns' });

    // Column 1: Milestones
    const msBox = node(
      'div',
      { className: 'nw-subpanel' },
      node('h3', {
        text: `Milestones (${completedMilestones}/${totalMilestones})`,
      }),
    );
    for (const [idx, m] of (p.milestones || []).entries()) {
      const done = m.status === 'done';
      const row = node(
        'div',
        { className: 'nw-milestone-row' },
        button(
          done ? `✓ ${m.title}` : `○ ${m.title}`,
          () => {
            const nextMs = p.milestones.map((item, i) =>
              i === idx ? { ...item, status: done ? 'open' : 'done' } : item,
            );
            saveUpdatedProject({ milestones: nextMs });
          },
          {
            disabled: busy || blocked,
            className: done ? 'nw-ms-done' : 'nw-ms-open',
          },
        ),
      );
      msBox.append(row);
    }
    columns.append(msBox);

    // Column 2: Bill of Materials (BOM) with 1-click Marketplace Sourcing
    const bomBox = node(
      'div',
      { className: 'nw-subpanel' },
      node('h3', {
        text: `Bill of Materials (${(p.bom || []).length} items)`,
      }),
    );
    for (const [idx, bItem] of (p.bom || []).entries()) {
      const bomRow = node(
        'div',
        { className: 'nw-bom-row' },
        node(
          'div',
          { className: 'nw-bom-info' },
          node('strong', { text: bItem.item }),
          node('span', {
            className: 'nw-muted',
            text: ` · ${bItem.category} · ${formatExactMoney(bItem.estimatedMinorUnits)} (${bItem.status})`,
          }),
        ),
        node(
          'div',
          { className: 'nw-bom-actions' },
          button(
            t('Find in Market'),
            () =>
              bus?.handoff({
                targetApp: 'marketplace',
                action: 'source-bom',
                payload: {
                  projectId: proj.id,
                  bomItem: bItem,
                  query: bItem.category,
                },
              }),
            { className: 'nw-small-btn nw-primary' },
          ),
          button(
            bItem.status === 'sourced' ? '✓ Sourced' : 'Mark Sourced',
            () => {
              const nextBom = p.bom.map((item, i) =>
                i === idx
                  ? {
                      ...item,
                      status: item.status === 'sourced' ? 'needed' : 'sourced',
                    }
                  : item,
              );
              saveUpdatedProject({ bom: nextBom });
            },
            { disabled: busy || blocked, className: 'nw-small-btn' },
          ),
        ),
      );
      bomBox.append(bomRow);
    }
    columns.append(bomBox);
    card.append(columns);

    // Linked Marketplace Offers & Proposals
    if (linkedOffers.length || linkedProposals.length) {
      const linksBox = node(
        'div',
        { className: 'nw-subpanel' },
        node('h3', {
          text: `Sourced Marketplace Offers (${linkedOffers.length}) & Proposals (${linkedProposals.length})`,
        }),
      );
      for (const off of linkedOffers) {
        linksBox.append(
          node('p', {
            className: 'nw-muted',
            text: `Offer: ${off.payload.title} — ${off.payload.providerName} (${formatExactMoney(off.payload.price)})`,
          }),
        );
      }
      for (const pr of linkedProposals) {
        linksBox.append(
          node('p', {
            className: 'nw-muted',
            text: `Proposal [${pr.payload.status.toUpperCase()}]: ${pr.payload.title} (${formatExactMoney(pr.payload.totalPrice)})`,
          }),
        );
      }
      card.append(linksBox);
    }

    // Bottom Actions
    const footerActions = node(
      'div',
      { className: 'nw-actions' },
      button(t('Show on globe'), () =>
        bus?.selectObject(
          {
            id: proj.id,
            kind: 'project',
            title: p.title,
            coordinates: p.coordinates,
            placeId: p.placeId,
            sourceApp: 'projects',
            payload: p,
          },
          { flyTo: true },
        ),
      ),
      button(t('Share project in Social'), () =>
        bus?.handoff({
          targetApp: 'social',
          action: 'share-object',
          payload: {
            sharedObjectId: proj.id,
            sharedObjectKind: 'project',
            title: p.title,
          },
        }),
      ),
      button(t('Open evidence'), () =>
        bus?.handoff({
          targetApp: 'evidence',
          action: 'inspect-object',
          payload: { projectId: proj.id },
        }),
      ),
    );
    const links = node(
      'section',
      {
        className: 'nw-linked-records',
        'aria-label': `Linked records for ${p.title}`,
      },
      node('h3', { text: 'Documents, evidence, and tasks' }),
    );
    const place = places.find((row) => row.id === p.placeId);
    if (place)
      links.append(
        button(`Place: ${place.payload.title}`, () =>
          bus.handoff({
            targetApp: 'records',
            action: 'inspect-object',
            reference: { id: place.id, revision: place.revision },
            payload: { objectId: place.id },
          }),
        ),
      );
    const candidates = [
      ...(snapshot?.items || []).filter(
        (r) => r.payload.kind === 'document' || r.payload.kind === 'task',
      ),
      ...(evidenceNetwork?.artifacts || []),
    ];
    for (const refId of p.refs || []) {
      const ref = candidates.find((r) => r.id === refId);
      if (ref)
        links.append(
          button(ref.payload.title || 'Evidence', () =>
            bus.handoff({
              targetApp:
                ref.payload.kind === 'document'
                  ? 'documents'
                  : ref.payload.kind === 'task'
                    ? 'board'
                    : 'evidence',
              action: 'inspect-object',
              reference: { id: ref.id, revision: ref.revision },
              payload: { objectId: ref.id },
            }),
          ),
        );
    }
    const picker = node(
      'select',
      { 'aria-label': `Attach a document or evidence to ${p.title}` },
      node('option', { value: '', text: 'Choose a document or evidence…' }),
      ...candidates
        .filter((r) => !(p.refs || []).includes(r.id))
        .map((r) =>
          node('option', { value: r.id, text: r.payload.title || 'Evidence' }),
        ),
    );
    links.append(
      node(
        'div',
        { className: 'nw-inline-form' },
        picker,
        button(
          'Attach selected record',
          () => {
            if (picker.value)
              saveUpdatedProject({
                refs: [...new Set([...(p.refs || []), picker.value])],
              });
          },
          { disabled: busy || blocked },
        ),
      ),
    );
    const taskTitle = node('input', {
      'aria-label': `New task for ${p.title}`,
      'data-draft-key': 'title',
      placeholder: t('Next task'),
    });
    links.append(
      node(
        'div',
        { className: 'nw-inline-form' },
        taskTitle,
        button(
          'Add task',
          () => {
            if (taskTitle.value.trim())
              commit({
                op: 'write',
                payload: {
                  kind: 'task',
                  title: taskTitle.value.trim(),
                  description: `Task for ${p.title}`,
                  status: 'open',
                  refs: [proj.id],
                },
              });
          },
          { disabled: busy || blocked },
        ),
      ),
    );
    for (const task of (snapshot?.items || []).filter(
      (r) => r.payload.kind === 'task' && r.payload.refs?.includes(proj.id),
    ))
      links.append(
        button(task.payload.title, () =>
          bus.handoff({
            targetApp: 'board',
            action: 'inspect-object',
            reference: { id: task.id },
            payload: { objectId: task.id },
          }),
        ),
      );
    links.append(
      button('View project history', () =>
        bus.handoff({
          targetApp: 'history',
          action: 'inspect-object',
          reference: { id: proj.id, revision: proj.revision },
          payload: { objectId: proj.id },
        }),
      ),
    );
    card.dataset.objectId = proj.id;
    if (context.selected === proj.id) card.classList.add('nw-selected');
    if (!totalMilestones)
      msBox.append(
        node('p', { className: 'nw-muted', text: t('No milestones') }),
      );
    if (!(p.bom || []).length)
      bomBox.append(
        node('p', { className: 'nw-muted', text: t('No materials') }),
      );
    card.append(links, footerActions);
    list.append(card);
  }
  content.append(
    workspace,
    node(
      'footer',
      { className: 'nw-window-statusbar' },
      node('span', {
        className: 'nw-statusbar-item',
        text: `${projects.length} project(s)`,
      }),
      node('span', {
        className: 'nw-statusbar-item',
        text: `Selected: ${currentProject.payload.title} (${currentProject.payload.stage})`,
      }),
      node('span', {
        className: 'nw-statusbar-item',
        text: `Revision ${currentProject.revision}`,
      }),
    ),
  );
}
