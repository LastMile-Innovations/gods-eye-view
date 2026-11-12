import { captureFields, restoreFields } from './draftFields.js';
/** Stable app hosts. Presentation changes never mount another app or globe. */
export function createAppLifecycles({ drafts }) {
  const hosts = new Map();
  return {
    mount(id, body) {
      hosts.set(id, { body, signature: null });
    },
    update(id, signature, render) {
      const host = hosts.get(id);
      if (!host || host.signature === signature) return;
      const { body } = host;
      const oldForm = body.dataset.draftForm;
      const values = captureFields(body),
        top = body.scrollTop;
      const focused = body.contains(document.activeElement)
        ? document.activeElement
        : null;
      const field = focused?.dataset.draftKey;
      const selection =
        focused && 'selectionStart' in focused
          ? [focused.selectionStart, focused.selectionEnd]
          : null;
      body.replaceChildren();
      render(body);
      host.signature = signature;
      if (oldForm === body.dataset.draftForm) restoreFields(body, values);
      drafts.restore(body);
      body.scrollTop = top;
      if (field) {
        const next = [...body.querySelectorAll('[data-draft-key]')].find(
          (el) => el.dataset.draftKey === field,
        );
        next?.focus({ preventScroll: true });
        if (
          selection &&
          next?.setSelectionRange &&
          !['number', 'email'].includes(next.type)
        ) {
          try {
            next.setSelectionRange(...selection);
          } catch {
            /* unsupported native control */
          }
        }
      }
    },
    invalidate(id) {
      if (hosts.has(id)) hosts.get(id).signature = null;
    },
    clear() {
      for (const host of hosts.values()) {
        host.signature = null;
        host.body.replaceChildren();
      }
    },
    destroy() {
      this.clear();
      hosts.clear();
    },
  };
}
