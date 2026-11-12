import { decodeEvidenceText, evidenceSelectionBytes } from './evidenceText.js';
import { t } from '../i18n/index.js';
const key = () => crypto.randomUUID().replaceAll('-', '');
/** Explicit private tools. Export always reads a currently revalidated native approval. */
export function createEvidenceDisclosureTools({
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
}) {
  const download = (data, name) => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2) + '\n'], {
        type: 'application/octet-stream',
      }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  async function history(item) {
    dialog.classList.add('nw-history-dialog');
    dialog.addEventListener(
      'close',
      () => dialog.classList.remove('nw-history-dialog'),
      { once: true },
    );
    dialog.replaceChildren(
      node('h2', { text: t('Revision comparison') }),
      node('p', { text: t('Loading…') }),
      button(t('Close'), () => dialog.close()),
    );
    dialog.showModal();
    try {
      const h = await api.citizenHistory(item.id, signal);
      if (!guard() || !dialog.open) return;
      const columns = node('div', { className: 'nw-revision-compare' });
      for (const [i, row] of h.items.slice(0, 2).entries()) {
        const p = row.payload;
        const assessment =
          {
            unverified: t('Unverified'),
            disputed: t('Disputed'),
            corroborated: t('Corroborated by reviewer'),
            refuted: t('Refuted by reviewer'),
          }[p.status] || (p.lifecycle || p.state || '').replaceAll('_', ' ');
        const citations = (name, label) =>
          !p[name]
            ? []
            : [
                node(
                  'div',
                  {},
                  node('h4', { text: label }),
                  ...p[name].map((id) =>
                    node('p', {
                      text:
                        network.artifacts.find((a) => a.id === id)?.payload
                          .title || id,
                    }),
                  ),
                ),
              ];
        columns.append(
          node(
            'section',
            {},
            node('h3', {
              text: `${i === 0 ? t('Current revision') : t('Previous revision')} · ${row.revision}`,
            }),
            node('h4', { text: p.text || p.title }),
            node('p', { className: 'nw-eyebrow', text: assessment }),
            node('p', {
              text: p.rationale || p.description || p.reviewNote || '',
            }),
            ...citations('supporting', t('Supporting artifacts')),
            ...citations('contradicting', t('Contradicting artifacts')),
            node(
              'details',
              {},
              node('summary', { text: t('Complete revision details') }),
              node('pre', {
                className: 'nw-evidence',
                text: JSON.stringify(p, null, 2),
              }),
            ),
          ),
        );
      }
      dialog.replaceChildren(
        node('h2', { text: t('Revision comparison') }),
        node('p', {
          className: 'nw-muted',
          text: t(
            'Actual native revisions. Earlier statements remain preserved; these are not reconstructed event times.',
          ),
        }),
        columns,
        button(t('Close'), () => dialog.close()),
      );
    } catch (e) {
      if (guard()) {
        dialog.close();
        report(e);
      }
    }
  }
  async function redact(item) {
    try {
      const original = await api.artifactOriginal(item.id, signal);
      if (!guard()) return;
      const bytes = new Uint8Array(original.bytes),
        text = decodeEvidenceText(bytes);
      const source = node('textarea', {
        rows: '7',
        readOnly: true,
        'aria-label': t('Original plain text'),
        value: text,
      });
      const ranges = node('textarea', {
        name: 'redaction-ranges',
        rows: '2',
        value: '[]',
        'aria-label': t('UTF-8 byte ranges'),
      });
      const title = node('input', {
        name: 'derivative-title',
        required: true,
        maxlength: '160',
        value: t('Reviewed excerpt'),
      });
      const reason = node('textarea', {
        name: 'redaction-reason',
        required: true,
        rows: '2',
        maxlength: '4000',
      });
      const preview = node('pre', {
        className: 'nw-evidence',
        text: t('Choose text to redact, then inspect the resulting excerpt.'),
      });
      function update() {
        try {
          const spans = JSON.parse(ranges.value);
          if (!Array.isArray(spans) || !spans.length || spans.length > 128)
            throw new Error('INVALID');
          let offset = 0,
            out = '';
          for (const r of spans) {
            if (
              !Array.isArray(r) ||
              r.length !== 2 ||
              !r.every(Number.isSafeInteger) ||
              r[0] < offset ||
              r[0] >= r[1] ||
              r[1] > bytes.length
            )
              throw new Error('INVALID');
            out += decodeEvidenceText(bytes.slice(offset, r[0])) + '[REDACTED]';
            offset = r[1];
          }
          preview.textContent = out + decodeEvidenceText(bytes.slice(offset));
        } catch {
          preview.textContent = t(
            'Invalid ranges. Use sorted, nonoverlapping UTF-8 byte boundaries.',
          );
        }
      }
      ranges.addEventListener('input', update);
      const selection = button(t('Redact selected text'), () => {
        if (source.selectionStart === source.selectionEnd) return;
        try {
          const spans = JSON.parse(ranges.value);
          spans.push(
            evidenceSelectionBytes(
              bytes,
              source.selectionStart,
              source.selectionEnd,
            ),
          );
          spans.sort((a, b) => a[0] - b[0]);
          ranges.value = JSON.stringify(spans);
          update();
        } catch {
          report(new Error('INVALID'));
        }
      });
      form(
        t('Create redacted text derivative'),
        [
          field(t('Title'), title),
          field(t('Original plain text'), source),
          selection,
          field(t('UTF-8 byte ranges'), ranges),
          field(t('Redaction reason, kept private'), reason),
          node('h3', { text: t('Derivative preview') }),
          preview,
        ],
        () => {
          let spans;
          try {
            spans = JSON.parse(ranges.value);
          } catch {
            report(new Error('INVALID'));
            return;
          }
          commit(
            {
              op: 'deriveEvidenceText',
              key: key(),
              parent: item.id,
              expected: item.revision,
              title: title.value,
              ranges: spans,
              note: reason.value,
            },
            context,
          );
        },
        t(
          'Plain UTF-8 text only. A separate child is preserved; the original stays unchanged. Review the whole excerpt before disclosure.',
        ),
        `evidence:redact:${item.id}:${item.revision}:v1`,
      );
      update();
    } catch (e) {
      if (guard()) report(e);
    }
  }
  function approve(book) {
    const b = book.payload;
    const artifacts = network.artifacts.filter(
      (a) =>
        b.artifacts.includes(a.id) &&
        a.payload.transformation?.profile === 'utf8-byte-redaction-v1' &&
        a.payload.lifecycle === 'under_review',
    );
    const claims = network.claims.filter((c) => b.claims.includes(c.id));
    const selected = referenceChecks(artifacts, t('Reviewed text derivatives')),
      selectedClaims = referenceChecks(claims, t('Claims'));
    const title = node('input', {
        name: 'disclosure-title',
        required: true,
        maxlength: '160',
      }),
      consent = node('input', {
        name: 'disclosure-consent',
        type: 'checkbox',
        required: true,
      });
    const excerpts = node('div', {});
    for (const a of artifacts)
      excerpts.append(
        node(
          'details',
          {},
          node('summary', { text: a.payload.title }),
          button(t('Inspect derived text'), async () => {
            try {
              const o = await api.artifactOriginal(a.id, signal);
              if (guard() && dialog.open)
                excerpts.append(
                  node('pre', {
                    className: 'nw-evidence',
                    text: decodeEvidenceText(new Uint8Array(o.bytes)),
                  }),
                );
            } catch (e) {
              if (guard()) report(e);
            }
          }),
        ),
      );
    const claimPreview = node(
      'div',
      {},
      ...claims.map((c) =>
        node(
          'details',
          {},
          node('summary', { text: c.payload.text }),
          node('p', { text: c.payload.rationale }),
          node('p', { text: c.payload.status }),
        ),
      ),
    );
    form(
      t('Approve local dossier'),
      [
        field(t('Dossier title'), title),
        selected.box,
        ...(artifacts.length
          ? []
          : [
              node('p', {
                className: 'nw-muted',
                text: t(
                  'Review a native text derivative and add it to this casebook before approving a dossier.',
                ),
              }),
            ]),
        excerpts,
        selectedClaims.box,
        claimPreview,
        field(
          t(
            'I reviewed the selected text, labels and claim rationale for disclosure.',
          ),
          consent,
        ),
      ],
      () => {
        const pinned = (items, ids) =>
          items
            .filter((a) => ids.includes(a.id))
            .map((a) => ({ id: a.id, revision: a.revision }));
        commit(
          {
            op: 'saveEvidenceDisclosure',
            key: key(),
            payload: {
              title: title.value,
              scope: 'local-download',
              approvalConfirmed: consent.checked,
              casebook: { id: book.id, revision: book.revision },
              artifacts: pinned(artifacts, selected.ids()),
              claims: pinned(claims, selectedClaims.ids()),
            },
          },
          context,
        );
      },
      t(
        'Only selected, reviewed native text derivatives are included. Each claim citation needs an exact selected excerpt or one unique selected descendant. Original citations remain preserved privately. Any casebook, claim, artifact or ancestor edit invalidates approval. Downloaded copies cannot be revoked.',
      ),
      `evidence:approve:${book.id}:${book.revision}:v1`,
    );
  }
  function withdraw(item) {
    const note = node('textarea', {
      name: 'withdrawal-note',
      required: true,
      rows: '3',
      maxlength: '4000',
    });
    form(
      t('Withdraw dossier approval'),
      [field(t('Reason'), note)],
      () =>
        commit(
          {
            op: 'withdrawEvidenceDisclosure',
            key: key(),
            id: item.id,
            expected: item.revision,
            note: note.value,
          },
          context,
        ),
      t(
        'Future downloads are refused. Copies already downloaded remain outside this workspace.',
      ),
      `evidence:withdraw:${item.id}:${item.revision}:v1`,
    );
  }
  async function dossier(item) {
    try {
      const data = await api.evidenceDossier(item.id, signal);
      if (guard()) download(data, 'evidence-dossier.json');
    } catch (e) {
      if (guard()) report(e);
    }
  }
  return { history, redact, approve, withdraw, dossier };
}
