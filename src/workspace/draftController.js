import { t } from '../i18n/index.js';
import { captureFields, restoreFields } from './draftFields.js';
const key = () => crypto.randomUUID().replaceAll('-', '');
/** Autosave is private native presentation state, never submission or authority. */
export function createDraftController({
  root,
  api,
  onSessionLost = () => {},
  isConnected,
  onStatus,
  onRecover,
}) {
  const entries = new Map();
  const dialogs = new Set();
  let timer,
    disposed = false,
    generation = 0;
  const scopeOf = (el) => el?.closest('[data-draft-form]');
  function capture(scope) {
    if (!scope?.dataset.draftForm || !isConnected()) return;
    const formId = scope.dataset.draftForm,
      appId = formId.split(':')[0],
      fields = captureFields(scope);
    if (!Object.keys(fields).length) return;
    let entry = entries.get(formId);
    if (!entry) {
      entry = {
        appId,
        formId,
        fields: {},
        references: scope.dataset.draftRefs
          ? JSON.parse(scope.dataset.draftRefs)
          : [],
        dirty: false,
      };
      entries.set(formId, entry);
    }
    if (entry.recovery) {
      entry.blocked = true;
      onStatus('Recover or discard the saved draft before editing.');
      return entry;
    }
    if (JSON.stringify(entry.fields) !== JSON.stringify(fields)) {
      entry.fields = fields;
      entry.dirty = true;
      entry.writeKey = undefined;
      onStatus('Unsaved');
    }
    return entry;
  }
  async function save(entry) {
    if (
      !entry?.dirty ||
      entry.saving ||
      entry.blocked ||
      disposed ||
      !isConnected()
    )
      return;
    entry.saving = true;
    onStatus('Saving draft…');
    const token = generation;
    const fields = { ...entry.fields };
    entry.writeKey ||= key();
    const request = {
      key: entry.writeKey,
      payload: {
        appId: entry.appId,
        formId: entry.formId,
        fields,
        references: entry.references || [],
      },
      ...(entry.revision ? { expected: entry.revision } : {}),
    };
    try {
      const result = await api.saveDraft(request);
      if (token !== generation) return;
      Object.assign(entry, {
        id: result.id,
        revision: result.revision,
        dirty: JSON.stringify(entry.fields) !== JSON.stringify(fields),
        writeKey: undefined,
      });
      onStatus(entry.dirty ? 'Unsaved' : 'Draft saved locally');
    } catch (error) {
      if (token !== generation) return;
      if (error.status === 401) {
        onSessionLost(error);
        return;
      }
      // An uncertain autosave must be read back before another write or submission.
      entry.blocked = true;
      onStatus(
        error.message === 'CONFLICT'
          ? 'Draft conflict — recover in Activity'
          : 'Draft recovery required — open Activity',
      );
    } finally {
      entry.saving = false;
    }
  }
  async function flush() {
    clearTimeout(timer);
    for (const entry of entries.values()) {
      if (entry.saving) await entry.savingPromise;
      entry.savingPromise = save(entry);
      await entry.savingPromise;
    }
  }
  function changed(event) {
    if (!event.target?.dataset?.draftKey) return;
    const entry = capture(scopeOf(event.target));
    if (!entry) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      entry.savingPromise = save(entry);
    }, 750);
  }
  const blur = () => {
    void flush();
  };
  root.addEventListener('input', changed);
  root.addEventListener('change', changed);
  root.addEventListener('focusout', blur);
  const beforeUnload = (event) => {
    if ([...entries.values()].some((e) => e.dirty || e.saving)) {
      event.preventDefault();
      event.returnValue = '';
    }
  };
  window.addEventListener('beforeunload', beforeUnload);
  return {
    capture,
    restore(scope) {
      const entry = entries.get(scope.dataset.draftForm);
      if (entry && !entry.recovery) restoreFields(scope, entry.fields);
    },
    async load(signal) {
      const token = generation;
      const result = await api.drafts(signal);
      if (token !== generation) return;
      const current = new Set(result.items.map((r) => r.formId));
      for (const [id, entry] of entries)
        if (entry.blocked && entry.id && !current.has(id)) entries.delete(id);
      for (const row of result.items) {
        const existing = entries.get(row.formId);
        if (existing && !existing.blocked) continue;
        const full = await api.draft(row.id, signal);
        if (token !== generation) return;
        if (existing?.blocked) {
          existing.recovery = true;
          existing.id = row.id;
          existing.revision = full.revision;
          continue;
        }
        entries.set(row.formId, {
          ...full.payload,
          id: row.id,
          revision: full.revision,
          recovery: true,
          blocked: full.state === 'submitting',
          submissionKey: full.submissionKey,
        });
      }
    },
    recoverable() {
      return [...entries.values()].filter((e) => e.recovery || e.blocked);
    },
    async recover(formId) {
      const entry = entries.get(formId);
      if (!entry) return;
      if (!entry.id) {
        const list = await api.drafts();
        const found = list.items.find((row) => row.formId === formId);
        if (!found) {
          entry.blocked = false;
          entry.recovery = false;
          await save(entry);
          onRecover(entry);
          return;
        }
        entry.id = found.id;
      }
      const full = await api.draft(entry.id);
      if (
        entry.dirty &&
        JSON.stringify(entry.fields) !== JSON.stringify(full.payload.fields) &&
        full.state === 'active'
      ) {
        const choice = await new Promise((resolve) => {
          const dialog = document.createElement('dialog');
          dialog.className = 'nw-dialog';
          dialogs.add(dialog);
          dialog.setAttribute('aria-label', t('Review draft conflict'));
          const title = document.createElement('h2');
          title.textContent = t('Review draft conflict');
          dialog.append(title);
          for (const [label, fields] of [
            ['Your unsaved text', entry.fields],
            ['Saved native draft', full.payload.fields],
          ]) {
            const heading = document.createElement('h3');
            heading.textContent = label;
            const text = document.createElement('pre');
            text.textContent = JSON.stringify(fields, null, 2);
            dialog.append(heading, text);
          }
          for (const [label, value] of [
            ['Keep my text', 'local'],
            ['Use saved draft', 'saved'],
            ['Cancel', 'cancel'],
          ]) {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = label;
            button.addEventListener('click', () => {
              dialog.close();
              resolve(value);
            });
            dialog.append(button);
          }
          dialog.addEventListener('cancel', () => resolve('cancel'), {
            once: true,
          });
          dialog.addEventListener(
            'close',
            () => {
              dialogs.delete(dialog);
              dialog.remove();
            },
            {
              once: true,
            },
          );
          root.append(dialog);
          dialog.showModal();
        });
        if (choice === 'cancel') return;
        if (choice === 'local') {
          entry.revision = full.revision;
          entry.blocked = false;
          entry.recovery = false;
          entry.writeKey = undefined;
          await save(entry);
          if (!entry.blocked) onRecover(entry);
          return;
        }
      }
      Object.assign(entry, full.payload, {
        revision: full.revision,
        blocked: full.state === 'submitting',
        submissionKey: full.submissionKey,
        recovery: false,
      });
      if (entry.blocked) {
        onStatus('Review the pending submission in Activity before editing.');
        return;
      }
      if (onRecover(entry) === false) entry.recovery = true;
    },
    async discard(formId) {
      const entry = entries.get(formId);
      if (!entry?.id) return;
      await api.discardDraft(entry.id, {
        key: key(),
        expected: entry.revision,
      });
      entries.delete(formId);
    },
    async submission(scope) {
      const entry = capture(scope);
      await flush();
      if (!entry) return null;
      if (entry.blocked || entry.dirty) throw new Error('DRAFT_UNSAVED');
      return entry.id
        ? { id: entry.id, revision: entry.revision, formId: entry.formId }
        : null;
    },
    submitted(reference) {
      if (reference) {
        entries.delete(reference.formId);
        onStatus(t('Draft submitted'));
      }
    },
    flush,
    clear() {
      generation++;
      clearTimeout(timer);
      entries.clear();
      for (const dialog of dialogs) {
        dialog.close();
        dialog.remove();
      }
      dialogs.clear();
    },
    destroy() {
      disposed = true;
      this.clear();
      root.removeEventListener('input', changed);
      root.removeEventListener('change', changed);
      root.removeEventListener('focusout', blur);
      window.removeEventListener('beforeunload', beforeUnload);
    },
  };
}
