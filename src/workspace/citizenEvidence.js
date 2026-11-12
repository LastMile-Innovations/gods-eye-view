import { createEvidenceDisclosureTools } from './evidenceDisclosure.js';
import { emptyState } from './ui.js';
import { t } from '../i18n/index.js';
const key = () => crypto.randomUUID().replaceAll('-', '');
/** Private, manual CEN workflow. Byte integrity and reviewer assessment are separate. */
export function renderCitizenEvidence({
  context,
  content,
  network,
  node,
  button,
  field,
  busy,
  blocked,
  commit,
  prepareCommand,
  dialog,
  drafts,
  api,
  signal,
  guard,
  report,
}) {
  content.className = 'nd-app-body nw-service-view';
  const dimensions = [
    ['integrity', t('Integrity')],
    ['origin', t('Origin')],
    ['time', t('Time')],
    ['location', t('Location')],
    ['content', t('Content')],
    ['corroboration', t('Corroboration')],
  ];
  const assessments = [
    ['not_assessed', t('Not assessed')],
    ['supported', t('Supported')],
    ['uncertain', t('Uncertain')],
    ['contradicted', t('Contradicted')],
  ];
  const artifacts = network?.artifacts || [],
    claims = network?.claims || [],
    books = network?.casebooks || [];
  const form = (title, controls, submit, caption, draftScope) => {
    if (draftScope) dialog.dataset.draftForm = draftScope;
    else delete dialog.dataset.draftForm;
    dialog.replaceChildren();
    const el = node(
      'form',
      {},
      node('h2', { text: title }),
      ...controls,
      node('p', {
        className: 'nw-muted',
        text:
          caption ||
          t('Private local workspace. Nothing is submitted or published.'),
      }),
      node(
        'div',
        { className: 'nw-actions' },
        button(t('Cancel'), () => dialog.close()),
        node('button', {
          type: 'submit',
          text: t('Save to native workspace'),
          className: 'nw-primary',
        }),
      ),
    );
    el.addEventListener('submit', (event) => {
      event.preventDefault();
      submit();
    });
    dialog.append(el);
    drafts?.restore(dialog);
    dialog.showModal();
    el.querySelector('input,textarea,select')?.focus();
  };
  const choices = (label, options, value) => {
    const el = node(
      'select',
      { 'aria-label': label },
      ...options.map(([v, text]) =>
        node('option', { value: v, text, selected: v === value }),
      ),
    );
    return el;
  };
  const referenceChecks = (records, label, selected = []) => {
    const chosen = new Map();
    const box = node('fieldset', {}, node('legend', { text: label }));
    for (const row of records) {
      const check = node('input', {
        type: 'checkbox',
        checked: selected.includes(row.id),
      });
      chosen.set(row.id, check);
      box.append(
        field(row.payload.title || row.payload.text.slice(0, 100), check),
      );
    }
    return {
      box,
      ids: () => [...chosen].filter(([, el]) => el.checked).map(([id]) => id),
    };
  };
  function reviewArtifact(item) {
    const p = item.payload;
    const transitions = {
      preserved: ['needs_context', 'under_review', 'restricted', 'archived'],
      needs_context: ['under_review', 'restricted', 'archived'],
      under_review: ['needs_context', 'disputed', 'restricted', 'archived'],
      disputed: ['under_review', 'restricted', 'archived'],
      restricted: ['under_review'],
      archived: ['under_review'],
    };
    const state = choices(
      t('Next lifecycle state'),
      (transitions[p.lifecycle] || []).map((s) => [s, s]),
    );
    state.name = 'next-lifecycle-state';
    const dimensionControls = dimensions.map(([id, label]) => {
      const assessment = choices(
        label,
        assessments,
        p.verificationDimensions?.[id]?.assessment || 'not_assessed',
      );
      assessment.name = `dimension-${id}`;
      const notes = node('input', {
        name: `dimension-${id}-notes`,
        maxlength: '2000',
        value: p.verificationDimensions?.[id]?.notes || '',
        'aria-label': `${label}: ${t('Context')}`,
      });
      return {
        id,
        assessment,
        notes,
        el: node(
          'div',
          { className: 'nw-dimension' },
          field(label, assessment),
          field(t('Context'), notes),
        ),
      };
    });
    const note = node('textarea', {
      name: 'review-note',
      required: true,
      rows: '3',
      maxlength: '4000',
    });
    form(
      t('Review evidence lifecycle'),
      [
        field(t('Next lifecycle state'), state),
        field(t('Review rationale and limitations'), note),
        node('h3', { text: t('Six review dimensions') }),
        ...dimensionControls.map((c) => c.el),
      ],
      () =>
        commit(
          {
            op: 'reviewEvidence',
            key: key(),
            id: item.id,
            expected: item.revision,
            state: state.value,
            note: note.value,
            dimensions: Object.fromEntries(
              dimensionControls.map((c) => [
                c.id,
                {
                  assessment: c.assessment.value,
                  notes: c.notes.value,
                },
              ]),
            ),
          },
          context,
        ),
      undefined,
      `evidence:review:${item.id}:${item.revision}:v1`,
    );
  }
  function intake() {
    const file = node('input', {
      type: 'file',
      required: true,
      'aria-label': t('Original file'),
    });
    const title = node('input', {
      name: 'evidence-title',
      required: true,
      maxlength: '160',
    });
    const family = choices(
      t('Evidence family'),
      [
        ['01', t('Photograph')],
        ['02', t('Video')],
        ['03', t('Audio')],
        ['04', t('Document')],
        ['05', t('Eyewitness account')],
        ['06', t('Measurement')],
        ['07', t('Geospatial observation')],
        ['08', t('Historical record')],
        ['09', t('Public-records release')],
        ['10', t('First-party record')],
        ['11', t('Research finding')],
        ['12', t('Structured dataset')],
        ['13', t('Scientific evidence')],
        ['14', t('Technical diagnostic')],
        ['15', t('Community need')],
        ['16', t('Accountability record')],
      ],
      '04',
    );
    const source = choices(
      t('Source type'),
      [
        ['unknown', t('Origin not established')],
        ['firsthand', t('Firsthand acquisition')],
        ['received_copy', t('Received copy or repost')],
      ],
      'unknown',
    );
    const group = node('input', { name: 'origin-group', maxlength: '120' });
    const parent = choices(
      t('Derived from'),
      [
        ['', t('No declared parent')],
        ...artifacts.map((a) => [a.id, a.payload.title]),
      ],
      '',
    );
    const when = node('input', { name: 'asserted-time', maxlength: '160' });
    const notes = node('textarea', {
      name: 'evidence-notes',
      rows: '3',
      maxlength: '10000',
    });
    const consent = node('input', { type: 'checkbox', required: true });
    file.addEventListener('change', () => {
      if (!title.value) title.value = file.files?.[0]?.name || '';
    });
    form(
      t('Preserve citizen evidence'),
      [
        field(t('Original file'), file),
        field(t('Title'), title),
        field(t('Evidence family'), family),
        field(t('Source type'), source),
        field(t('Declared source group'), group),
        field(t('Derived from'), parent),
        field(t('Asserted capture time, if known'), when),
        field(t('What you observed and what remains uncertain'), notes),
        field(
          t('I have permission to retain these exact bytes locally.'),
          consent,
        ),
      ],
      async () => {
        const f = file.files?.[0];
        if (!f || f.size > 1024 * 1024) {
          report(new Error('RESOURCE_LIMIT'));
          return;
        }
        await prepareCommand(
          async () => ({
            op: 'preserveEvidence',
            key: key(),
            permissionConfirmed: consent.checked,
            bytes: [...new Uint8Array(await f.arrayBuffer())],
            payload: {
              title: title.value.trim(),
              fileName: f.name,
              mediaType: f.type || 'application/octet-stream',
              family: family.value,
              sourceType: source.value,
              originGroup: group.value.trim(),
              dependsOn: parent.value || null,
              notes: notes.value,
              assertedCapturedAt: when.value.trim() || null,
              coordinates: null,
            },
          }),
          context,
        );
      },
      t(
        'Up to 1 MiB. Original bytes remain private. No malware scan, C2PA validation or anonymous submission is provided.',
      ),
      'evidence:preserve:v1',
    );
  }
  function newClaim(item) {
    const p = item?.payload;
    const text = node('textarea', {
      value: p?.text || '',
      name: 'claim-text',
      required: true,
      rows: '3',
      maxlength: '10000',
    });
    const status = choices(
      t('Reviewer assessment'),
      [
        ['unverified', t('Unverified')],
        ['disputed', t('Disputed')],
        ['corroborated', t('Corroborated by reviewer')],
        ['refuted', t('Refuted by reviewer')],
      ],
      p?.status || 'unverified',
    );
    const support = referenceChecks(
        artifacts,
        t('Supporting artifacts'),
        p?.supporting,
      ),
      contradict = referenceChecks(
        artifacts,
        t('Contradicting artifacts'),
        p?.contradicting,
      );
    const rationale = node('textarea', {
      value: p?.rationale || '',
      name: 'claim-rationale',
      required: true,
      rows: '3',
      maxlength: '4000',
    });
    const independence = node('input', {
      type: 'checkbox',
      checked: p?.independenceAttested || false,
    });
    form(
      p ? t('Correct evidence claim') : t('Create evidence claim'),
      [
        field(t('Claim'), text),
        field(t('Reviewer assessment'), status),
        support.box,
        contradict.box,
        field(t('Review rationale and limitations'), rationale),
        field(
          t(
            'I reviewed source independence; different bytes alone do not prove it.',
          ),
          independence,
        ),
      ],
      () =>
        commit(
          {
            op: 'saveEvidenceClaim',
            ...(p ? { id: item.id, expected: item.revision } : {}),
            key: key(),
            payload: {
              text: text.value,
              status: status.value,
              supporting: support.ids(),
              contradicting: contradict.ids(),
              rationale: rationale.value,
              independenceAttested: independence.checked,
            },
          },
          context,
        ),
      t(
        'Integrity does not establish truth. Identical bytes, declared shared sources and repost lineage cannot count as independent corroboration.',
      ),
      `evidence:claim:${item?.id || 'new'}:${item?.revision || 0}:v1`,
    );
  }
  function newBook(item) {
    const p = item?.payload;
    const title = node('input', {
        value: p?.title || '',
        name: 'casebook-title',
        required: true,
        maxlength: '160',
      }),
      description = node('textarea', {
        name: 'casebook-description',
        value: p?.description || '',
        rows: '3',
        maxlength: '10000',
      });
    const selectedArtifacts = referenceChecks(
        artifacts,
        t('Artifacts'),
        p?.artifacts,
      ),
      selectedClaims = referenceChecks(claims, t('Claims'), p?.claims);
    form(
      p ? t('Edit casebook') : t('Create casebook'),
      [
        field(t('Title'), title),
        field(t('Context'), description),
        selectedArtifacts.box,
        selectedClaims.box,
      ],
      () =>
        commit(
          {
            op: 'saveCasebook',
            ...(p ? { id: item.id, expected: item.revision } : {}),
            key: key(),
            payload: {
              title: title.value.trim(),
              description: description.value,
              artifacts: selectedArtifacts.ids(),
              claims: selectedClaims.ids(),
            },
          },
          context,
        ),
      undefined,
      `evidence:casebook:${item?.id || 'new'}:${item?.revision || 0}:v1`,
    );
  }
  const tools = createEvidenceDisclosureTools({
    network,
    node,
    button,
    field,
    form,
    referenceChecks,
    dialog,
    api,
    signal,
    guard,
    report,
    commit,
    context,
  });
  const head = node(
    'div',
    { className: 'nw-service-head' },
    node('p', {
      className: 'nw-eyebrow',
      text: t('CITIZEN EVIDENCE / PRIVATE'),
    }),
    node('h1', { text: t('Evidence') }),
    node('p', {
      className: 'nw-muted',
      text: t(
        'Preserve originals. Keep claims separate. Review sources before drawing conclusions.',
      ),
    }),
    node(
      'div',
      { className: 'nw-actions nw-create' },
      button(t('Preserve evidence'), intake, {
        disabled: busy || blocked,
        className: 'nw-primary',
      }),
      button(t('Create claim'), () => newClaim(), {
        disabled: busy || blocked || !artifacts.length,
      }),
      button(t('Create casebook'), () => newBook(), {
        disabled: busy || blocked,
      }),
    ),
  );
  content.append(head);
  const tabs = node('nav', {
    className: 'nw-evidence-tabs',
    'aria-label': t('Evidence views'),
  });
  for (const [id, label] of [
    ['artifacts', t('Artifacts')],
    ['claims', t('Claims')],
    ['disclosures', t('Dossiers')],
    ['casebooks', t('Casebooks')],
  ])
    tabs.append(
      button(
        `${label} · ${{ artifacts, claims, casebooks: books, disclosures: network?.disclosures || [] }[id].length}`,
        () => {
          context.evidenceTab = id;
          render();
        },
        { 'aria-pressed': String((context.evidenceTab || 'artifacts') === id) },
      ),
    );
  content.append(tabs);
  const rows = node('div');
  content.append(rows);
  function render() {
    rows.replaceChildren();
    const tab = context.evidenceTab || 'artifacts';
    if (tab === 'artifacts')
      for (const item of artifacts) {
        const p = item.payload;
        const card = node(
          'article',
          {
            className: `nw-service-card ${context.selected === item.id ? 'nw-selected' : ''}`,
            'data-artifact-id': item.id,
          },
          node('p', {
            className: 'nw-eyebrow',
            text: `${p.lifecycle} / ${p.transformation ? t('Private derivative') : t('Private original')} / ${p.byteLength} B`,
          }),
          node('h2', { text: p.title }),
          node('p', { text: p.notes }),
          node('p', {
            className: 'nw-muted',
            text: `${t('Source type')}: ${p.sourceType} · ${t('Declared source group')}: ${p.originGroup || '—'}`,
          }),
          node('code', {
            className: 'nw-qid',
            text: `SHA-256 ${p.integrity.sha256}\nBLAKE3 ${p.integrity.blake3}`,
          }),
          node('p', {
            className: 'nw-muted',
            text: t('Byte integrity only. Factual truth is not verified.'),
          }),
        );
        if (p.verificationDimensions)
          card.append(
            node(
              'div',
              { className: 'nw-dimensions' },
              ...dimensions.map(([id, label]) =>
                node('p', {
                  className: 'nw-muted',
                  text: `${label}: ${assessments.find(([v]) => v === p.verificationDimensions[id]?.assessment)?.[1] || p.verificationDimensions[id]?.assessment}`,
                }),
              ),
            ),
          );
        card.append(
          button(t('Revision comparison'), () => tools.history(item)),
          ...(p.mediaType === 'text/plain'
            ? [
                button(
                  t('Create redacted text derivative'),
                  () => tools.redact(item),
                  { disabled: busy || blocked },
                ),
              ]
            : []),
          ...(p.transformation
            ? [
                node('p', {
                  className: 'nw-muted',
                  text: `${t('Derived from')}: ${p.dependsOn} · ${p.transformation.profile}`,
                }),
              ]
            : []),
          button(t('Download exact original'), async () => {
            try {
              const saved = await api.artifactOriginal(item.id, signal);
              if (!guard()) return;
              const url = URL.createObjectURL(
                new Blob([new Uint8Array(saved.bytes)], {
                  type: 'application/octet-stream',
                }),
              );
              const a = document.createElement('a');
              a.href = url;
              a.download = saved.fileName;
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            } catch (error) {
              if (guard()) report(error);
            }
          }),
          button(t('Inspect custody'), async () => {
            try {
              const log = await api.evidenceCustody(item.id, signal);
              if (!guard()) return;
              const output = node('pre', {
                className: 'nw-original',
                text: log.items
                  .map(
                    (row) =>
                      `${row.revision} · ${row.payload.action} · ${row.payload.state}\n${row.payload.note || ''}`,
                  )
                  .join('\n\n'),
              });
              card.append(output);
            } catch (error) {
              if (guard()) report(error);
            }
          }),
          button(t('Review lifecycle'), () => reviewArtifact(item), {
            disabled: busy || blocked,
          }),
        );
        rows.append(card);
      }
    else if (tab === 'claims')
      for (const item of claims) {
        const p = item.payload;
        rows.append(
          node(
            'article',
            { className: 'nw-service-card' },
            node('p', {
              className: 'nw-eyebrow',
              text: `${t('Reviewer assessment')}: ${p.status}`,
            }),
            node('h2', { text: p.text }),
            button(t('Correct evidence claim'), () => newClaim(item), {
              disabled: busy || blocked,
            }),
            button(t('Revision comparison'), () => tools.history(item)),
            node('p', { text: p.rationale }),
            node('p', {
              className: 'nw-muted',
              text: `${t('Declared independent groups')}: ${p.declaredIndependentGroups}`,
            }),
            node('p', {
              className: 'nw-muted',
              text: t(
                'This is a local reviewer assessment, not automatic factual verification.',
              ),
            }),
            ...p.supporting.map((id) =>
              node('p', {
                text: `+ ${artifacts.find((a) => a.id === id)?.payload.title || id}`,
              }),
            ),
            ...p.contradicting.map((id) =>
              node('p', {
                text: `− ${artifacts.find((a) => a.id === id)?.payload.title || id}`,
              }),
            ),
          ),
        );
      }
    else if (tab === 'disclosures')
      for (const item of network?.disclosures || []) {
        rows.append(
          node(
            'article',
            { className: 'nw-service-card' },
            node('h2', { text: item.payload.title }),
            node('p', {
              className: 'nw-eyebrow',
              text:
                {
                  ready: t('Ready to download'),
                  stale: t('Review required after changes'),
                  blocked: t('Blocked by source policy'),
                  withdrawn: t('Withdrawn'),
                }[item.readiness] || item.readiness,
            }),
            button(t('Download reviewed dossier'), () => tools.dossier(item), {
              disabled: item.readiness !== 'ready',
            }),
            button(t('Withdraw dossier approval'), () => tools.withdraw(item), {
              disabled: busy || blocked || item.payload.state !== 'approved',
            }),
            button(t('Revision comparison'), () => tools.history(item)),
          ),
        );
      }
    else
      for (const item of books) {
        const p = item.payload;
        rows.append(
          node(
            'article',
            { className: 'nw-service-card' },
            node('h2', { text: p.title }),
            button(t('Edit casebook'), () => newBook(item), {
              disabled: busy || blocked,
            }),
            button(t('Revision comparison'), () => tools.history(item)),
            button(t('Approve local dossier'), () => tools.approve(item), {
              disabled: busy || blocked,
            }),
            node('p', { text: p.description }),
            ...p.artifacts.map((id) =>
              node('p', {
                text: artifacts.find((a) => a.id === id)?.payload.title || id,
              }),
            ),
            ...p.claims.map((id) =>
              node('p', {
                text: claims.find((c) => c.id === id)?.payload.text || id,
              }),
            ),
          ),
        );
      }
    if (!rows.childElementCount)
      rows.append(
        emptyState({
          title:
            tab === 'claims'
              ? t('No claims')
              : tab === 'casebooks'
                ? t('No casebooks')
                : tab === 'disclosures'
                  ? t('No approved dossiers')
                  : t('No evidence'),
          description:
            tab === 'disclosures'
              ? t('Review a casebook before approving a local dossier.')
              : t('Preserve an original before linking claims and casebooks.'),
          actionLabel:
            tab === 'claims'
              ? t('Create claim')
              : tab === 'casebooks' || tab === 'disclosures'
                ? t('Create casebook')
                : t('Preserve evidence'),
          onAction:
            tab === 'claims'
              ? () => newClaim()
              : tab === 'casebooks' || tab === 'disclosures'
                ? () => newBook()
                : intake,
          disabled: busy || blocked,
        }),
      );
  }
  if (context.recoverForm) {
    const [, kind, id, revision] = context.recoverForm.split(':');
    delete context.recoverForm;
    if (kind === 'preserve') intake();
    else if (['review', 'redact', 'approve', 'withdraw'].includes(kind)) {
      const records =
        kind === 'approve'
          ? books
          : kind === 'withdraw'
            ? network.disclosures
            : artifacts;
      const item = records?.find((row) => row.id === id);
      if (!item || String(item.revision) !== revision)
        report(new Error('CONFLICT'));
      else if (kind === 'review') reviewArtifact(item);
      else void tools[kind](item);
    } else if (kind === 'claim' || kind === 'casebook') {
      const item = (kind === 'claim' ? claims : books).find((r) => r.id === id);
      if (id === 'new') {
        if (kind === 'claim') newClaim();
        else newBook();
      } else if (item && String(item.revision) === revision) {
        if (kind === 'claim') newClaim(item);
        else newBook(item);
      } else report(new Error('CONFLICT'));
    }
  }
  render();
}
