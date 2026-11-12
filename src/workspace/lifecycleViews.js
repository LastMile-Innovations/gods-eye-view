import { t } from '../i18n/index.js';
/** Views over native service results. No private data is written to browser preferences. */
export function renderLifecycleView({
  view,
  context,
  content,
  operations,
  desks,
  snapshot,
  desktop,
  node,
  button,
  field,
  busy,
  blocked,
  resume,
  commit,
  loadHistory,
  loadWorldTime,
  checkLicenseGate,
  refresh,
  changeInboxAction,
  changeInboxPending,
  changeInboxRecovery,
}) {
  content.className = 'nd-app-body nw-service-view';
  const head = node('div', { className: 'nw-service-head nw-app-toolbar' });
  const body = node('div', { className: 'nw-app-scroll-body' });
  content.append(head, body);

  if (view === 'recovery') {
    const inbox = operations?.changeInbox;
    const inboxCard = node(
      'article',
      { className: 'nw-service-card', 'data-change-inbox': 'true' },
      node('h2', { text: t('Database change inbox') }),
      node('p', {
        className: 'nw-muted',
        text: t(
          'Read native changes, then refresh the workspace before acknowledging. This does not verify an external outcome.',
        ),
      }),
      node('p', {
        text: inbox?.registered
          ? t('Checkpoint through native sequence {sequence}.', {
              sequence: inbox.acknowledged,
            })
          : t('No consumer checkpoint yet.'),
      }),
    );
    const recoveryText = {
      recovering: t(
        'Reopening native storage and reconciling the original acknowledgement…',
      ),
      blocked: t(
        'Recovery is unresolved. Retry the original inbox action; later commands are held.',
      ),
      recovered: t(
        'Native storage reopened. The original acknowledgement is resolved.',
      ),
    }[changeInboxRecovery?.state];
    if (recoveryText)
      inboxCard.append(
        node('p', {
          role: 'status',
          'data-inbox-recovery': changeInboxRecovery.state,
          text: recoveryText,
        }),
      );
    if (inbox?.pending)
      inboxCard.append(
        node('p', {
          text: t('Pending batch through native sequence {sequence}.', {
            sequence: inbox.pending.through,
          }),
        }),
      );
    if (changeInboxPending)
      inboxCard.append(
        button(t('Retry inbox action'), () => changeInboxAction?.('retry'), {
          disabled: busy,
        }),
      );
    else if (inbox?.pending)
      inboxCard.append(
        button(
          t('Refresh and acknowledge batch'),
          () => changeInboxAction?.('ack'),
          { disabled: busy },
        ),
      );
    else
      inboxCard.append(
        button(
          t('Read a bounded change batch'),
          () => changeInboxAction?.('poll'),
          { disabled: busy || inbox?.closed },
        ),
      );
    body.append(inboxCard);
    head.append(
      node('h1', { text: t('Activity and recovery') }),
      node('span', {
        className: 'nw-toolbar-summary',
        text: String(operations?.items?.length || 0),
      }),
      button(t('Refresh activity'), refresh, { disabled: busy }),
    );
    body.append(
      node('p', {
        className: 'nw-muted',
        text: t(
          'Saved commands survive reloads. Pending work resumes only when you choose it.',
        ),
      }),
    );
    if (!operations?.items.length)
      body.append(node('p', { text: t('No saved commands yet.') }));
    for (const item of operations?.items || []) {
      const card = node(
        'article',
        { className: 'nw-service-card' },
        node(
          'div',
          { className: 'nw-card-top' },
          node('span', {
            className: 'nw-badge',
            text: `${item.kind} · ${item.state}`,
          }),
          item.result
            ? node('span', {
                className: 'nw-muted',
                text: `${t('Native revision')} ${item.result.sequence}`,
              })
            : null,
        ),
        node('h2', { text: item.title }),
      );
      if (item.result)
        card.append(
          node('code', { className: 'nw-qid', text: item.result.receipt }),
        );
      if (item.error)
        card.append(node('p', { className: 'nw-muted', text: item.error }));
      if (item.state === 'pending')
        card.append(
          button(t('Resume exact save'), () => resume(item), {
            disabled: busy,
            className: 'nw-primary',
          }),
        );
      body.append(card);
    }
    content.append(
      node(
        'footer',
        { className: 'nw-window-statusbar' },
        node('span', {
          className: 'nw-statusbar-item',
          text: `${operations?.items?.length || 0} recorded operation(s)`,
        }),
      ),
    );
  } else if (view === 'desks') {
    head.append(
      node('h1', { text: t('Saved desks') }),
      node('span', {
        className: 'nw-toolbar-summary',
        text: String(desks?.items?.length || 0),
      }),
    );
    body.append(
      node('p', {
        className: 'nw-muted',
        text: t(
          'Keep named window arrangements in your private native workspace. Records and drafts stay separate.',
        ),
      }),
    );
    const name = node('input', {
      name: 'desk-name',
      required: true,
      maxlength: '80',
      'aria-label': t('Desk name'),
      value: context.deskName || '',
    });
    name.addEventListener('input', () => (context.deskName = name.value));
    const form = node(
      'form',
      { className: 'nw-inline-form' },
      field(t('Desk name'), name),
      node('button', {
        type: 'submit',
        text: t('Save current desk'),
        disabled: busy || blocked,
        className: 'nw-primary',
      }),
    );
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      commit(
        {
          op: 'saveDesk',
          key: crypto.randomUUID().replaceAll('-', ''),
          payload: { name: name.value.trim(), layout: desktop.layout() },
        },
        context,
      );
    });
    body.append(form);
    for (const item of desks?.items || []) {
      const card = node(
        'article',
        { className: 'nw-service-card' },
        node(
          'div',
          { className: 'nw-card-top' },
          node('h2', { text: item.payload.name }),
          node('span', {
            className: 'nw-badge',
            text: `${t('Native revision')} ${item.revision}`,
          }),
        ),
        node(
          'div',
          { className: 'nw-actions' },
          button(
            t('Restore desk'),
            () => desktop.restore(item.payload.layout),
            { className: 'nw-primary' },
          ),
          button(
            t('Update from current layout'),
            () =>
              commit(
                {
                  op: 'saveDesk',
                  key: crypto.randomUUID().replaceAll('-', ''),
                  id: item.id,
                  expected: item.revision,
                  payload: {
                    name: item.payload.name,
                    layout: desktop.layout(),
                  },
                },
                context,
              ),
            { disabled: busy || blocked },
          ),
          button(
            t('Delete saved arrangement'),
            () =>
              commit(
                {
                  op: 'deleteDesk',
                  key: crypto.randomUUID().replaceAll('-', ''),
                  id: item.id,
                  expected: item.revision,
                },
                context,
              ),
            { disabled: busy || blocked },
          ),
        ),
      );
      body.append(card);
    }
    content.append(
      node(
        'footer',
        { className: 'nw-window-statusbar' },
        node('span', {
          className: 'nw-statusbar-item',
          text: `${desks?.items?.length || 0} saved desk arrangement(s)`,
        }),
      ),
    );
  } else if (view === 'history') {
    const revisions = context.history?.items || [];
    head.append(
      node('h1', { text: t('History') }),
      node('span', {
        className: 'nw-toolbar-summary',
        text: `${revisions.length} rev`,
      }),
    );
    body.append(
      node('p', {
        className: 'nw-muted',
        text: t(
          'Actual authored revisions and 6-category temporal epistemic state as known to Quanta. Event-time reconstruction remains explicitly gated.',
        ),
      }),
    );

    const select = node(
      'select',
      { 'aria-label': t('Choose a record') },
      node('option', { value: '', text: t('Choose a record') }),
      ...(snapshot?.items || [])
        .filter((item) => !item.hasEvidence)
        .map((item) =>
          node('option', {
            value: item.id,
            text: item.payload.title,
            selected: item.id === context.selected,
          }),
        ),
    );
    select.addEventListener('change', () => {
      context.selected = select.value;
      context.history = undefined;
    });
    body.append(
      node(
        'div',
        { className: 'nw-inline-form' },
        field(t('Choose a record'), select),
        button(t('Load native history'), () => loadHistory(context), {
          disabled: busy,
          className: 'nw-primary',
        }),
      ),
    );

    if (revisions.length >= 2) {
      const latest = revisions[0];
      const previous = revisions[1];
      const diffBox = node(
        'section',
        {
          className: 'nw-subpanel nw-revision-compare',
          'aria-label': 'Revision comparison',
        },
        node(
          'div',
          { className: 'nw-card-top' },
          node('h3', {
            text: `Revision Diff · Rev ${previous.revision} → Rev ${latest.revision}`,
          }),
          node('span', {
            className: 'nw-badge',
            text:
              latest.payload.status !== previous.payload.status
                ? `Status: ${previous.payload.status} → ${latest.payload.status}`
                : `Status: ${latest.payload.status}`,
          }),
        ),
        node(
          'div',
          { className: 'nw-project-columns' },
          node(
            'div',
            { className: 'nw-diff-pane' },
            node('strong', { text: `Rev ${previous.revision} (Prior)` }),
            node('p', { text: previous.payload.title }),
            node('p', {
              className: 'nw-muted',
              text: previous.payload.description || '—',
            }),
          ),
          node(
            'div',
            { className: 'nw-diff-pane nw-diff-current' },
            node('strong', { text: `Rev ${latest.revision} (Head)` }),
            node('p', { text: latest.payload.title }),
            node('p', {
              className: 'nw-muted',
              text: latest.payload.description || '—',
            }),
          ),
        ),
      );
      body.append(diffBox);
    }

    for (const item of revisions)
      body.append(
        node(
          'article',
          { className: 'nw-service-card' },
          node('p', {
            className: 'nw-eyebrow',
            text: `${t('Native revision')} ${item.revision} / ${item.epistemic}`,
          }),
          node('h2', { text: item.payload.title }),
          node('p', { text: item.payload.description }),
          node('p', { className: 'nw-muted', text: item.payload.status }),
        ),
      );
    if (context.history?.truncated)
      body.append(
        node('p', {
          className: 'nw-muted',
          text: t(
            'More revisions exist. This view shows the latest bounded page.',
          ),
        }),
      );

    if (loadWorldTime) {
      const seqInput = node('input', {
        type: 'number',
        min: '0',
        placeholder: t('Head sequence (leave blank for Live)'),
        value: context.asKnownAtInput ?? '',
      });
      seqInput.addEventListener('input', () => {
        context.asKnownAtInput = seqInput.value;
      });
      const wtCard = node(
        'section',
        { className: 'nw-subpanel nw-policy-panel' },
        node('h2', { text: 'As-Known Sequence Rewind vs. Live Head' }),
        field('As-Known Sequence Cutoff (Optional)', seqInput),
        node(
          'div',
          { className: 'nw-actions' },
          button(
            'Evaluate World Time Snapshot',
            () => {
              const raw = String(context.asKnownAtInput || '').trim();
              const asKnownAt = raw !== '' ? Number(raw) : undefined;
              loadWorldTime(context, {
                asKnownAt,
                mode: asKnownAt !== undefined ? 'as_known' : 'live',
              });
            },
            { disabled: busy, className: 'nw-primary' },
          ),
        ),
      );
      if (context.worldTime) {
        const wt = context.worldTime;
        const cats = wt.temporalCategories || {};
        wtCard.append(
          node('p', {
            className: 'nw-muted',
            text: `Head Seq #${wt.headSequence} · Evaluated Cutoff #${wt.asKnownAtSequence} · Mode: ${wt.mode.toUpperCase()} · Valid-Time Interpolation: ${wt.validTimeSupported ? 'Supported' : 'Gated (False)'}`,
          }),
          node(
            'ul',
            { className: 'nw-deliverable-list' },
            node('li', {
              text: `1. Observed History (Occurrences & Artifacts): ${cats.observedHistory?.count ?? 0}`,
            }),
            node('li', {
              text: `2. Reconstructed History (Models): ${cats.reconstructedHistory?.supported ? cats.reconstructedHistory.count : 'Gated (0)'}`,
            }),
            node('li', {
              text: `3. As-Known History (Domain State at #${wt.asKnownAtSequence}): ${cats.asKnownHistory?.count ?? 0} total (${cats.asKnownHistory?.countsByType?.records ?? 0} records, ${cats.asKnownHistory?.countsByType?.offers ?? 0} offers, ${cats.asKnownHistory?.countsByType?.proposals ?? 0} proposals, ${cats.asKnownHistory?.countsByType?.commitments ?? 0} commitments, ${cats.asKnownHistory?.countsByType?.projects ?? 0} projects)`,
            }),
            node('li', {
              text: `4. Live Observed Watermark: Seq #${cats.liveObserved?.headSequence ?? wt.headSequence} (${cats.liveObserved?.isAtLiveHead ? 'At Live Head' : 'Rewound'})`,
            }),
            node('li', {
              text: `5. Forecast Model Runs: ${cats.forecastModel?.supported ? cats.forecastModel.count : 'Gated (0)'}`,
            }),
            node('li', {
              text: `6. Scenario Forks (Hypothesized Plans): ${cats.scenarioFork?.count ?? 0}`,
            }),
          ),
        );
      }
      body.append(wtCard);
    }

    if (checkLicenseGate) {
      const srcSelect = node(
        'select',
        {},
        ...[
          ['R020_USGS_PUBLIC', 'R020 · USGS Earthquake Feed (Public Domain)'],
          ['R001_NOAA_GFS', 'R001 · NOAA GFS Weather (Public Domain)'],
          ['R002_ECMWF_IFS', 'R002 · ECMWF IFS Forecast (CC BY 4.0)'],
          [
            'R004_NOAA_LIGHTNING_DERIVED',
            'R004 · NOAA/Vaisala Lightning Density',
          ],
          ['R010_OSM_ODBL', 'R010 · OpenStreetMap (ODbL 1.0)'],
          ['R011_GOOGLE_3D_TILES', 'R011 · Google Photorealistic 3D Tiles'],
          ['R012_OPENSKY_NC', 'R012 · OpenSky Network (Non-Commercial)'],
          ['R015_ADSBDB_ROUTES', 'R015 · adsbdb Route Database'],
          ['R030_GOOGLE_NEWS_NC', 'R030 · Google News RSS (Non-Commercial)'],
          ['LOCAL_FIRSTHAND_OWNER', 'LOCAL · Firsthand Workspace Owner'],
        ].map(([val, label]) =>
          node('option', {
            value: val,
            text: label,
            selected: (context.licenseSource || 'R020_USGS_PUBLIC') === val,
          }),
        ),
      );
      const opSelect = node(
        'select',
        {},
        ...[
          ['display', 'display (In-App Viewport)'],
          ['archive_local', 'archive_local (Local Quanta Retention)'],
          ['derive_feature', 'derive_feature (Analytical Feature)'],
          ['commercial_export', 'commercial_export (Commercial Deliverable)'],
          ['redistribute_raw', 'redistribute_raw (Raw Dataset Export)'],
          ['model_training', 'model_training (AI/Statistical Training)'],
        ].map(([val, label]) =>
          node('option', {
            value: val,
            text: label,
            selected: (context.licenseOp || 'commercial_export') === val,
          }),
        ),
      );
      srcSelect.addEventListener('change', () => {
        context.licenseSource = srcSelect.value;
      });
      opSelect.addEventListener('change', () => {
        context.licenseOp = opSelect.value;
      });
      const lgCard = node(
        'section',
        { className: 'nw-subpanel nw-policy-panel' },
        node('h2', { text: 'Verify Source Operation Policy' }),
        node(
          'div',
          { className: 'nw-form-grid' },
          field('Source Policy ID', srcSelect),
          field('Requested Operation', opSelect),
        ),
        node(
          'div',
          { className: 'nw-actions' },
          button(
            'Check LicenseGate',
            () =>
              checkLicenseGate(context, {
                sourceId: srcSelect.value,
                operation: opSelect.value,
                derivedOutput: true,
              }),
            { disabled: busy },
          ),
        ),
      );
      if (context.licenseVerdict) {
        const v = context.licenseVerdict;
        lgCard.append(
          node('p', {
            text: `${v.permitted ? '✓ PERMITTED' : '✕ LICENSE_RESTRICTED'} · License: ${v.license}`,
          }),
          node('p', {
            className: 'nw-muted',
            text: `${v.reason} — Attribution: ${v.requiredAttribution}`,
          }),
        );
      }
      body.append(lgCard);
    }

    content.append(
      node(
        'footer',
        { className: 'nw-window-statusbar' },
        node('span', {
          className: 'nw-statusbar-item',
          text: `${revisions.length} revision(s) loaded`,
        }),
        context.worldTime
          ? node('span', {
              className: 'nw-statusbar-item',
              text: `Head Seq #${context.worldTime.headSequence}`,
            })
          : null,
      ),
    );
  }
}
