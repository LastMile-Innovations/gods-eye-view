import { t } from '../i18n/index.js';
import { resolveCapabilitiesForObject } from './registry.js';
import { actionHandoff } from './desktopCommands.js';
export function createWorldContextSurface({ bus, onOpenApp, onFlyTo }) {
  const container = document.createElement('aside');
  container.className = 'nw-world-surface';
  container.setAttribute('aria-label', t('Selected world object'));
  container.hidden = true;
  let previousSelection;
  const button = (label, run) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', run);
    return b;
  };
  function render() {
    const s = bus.getWorldSelection();
    if (s === previousSelection) return;
    previousSelection = s;
    container.replaceChildren();
    container.hidden = !s;
    if (!s) return;
    const head = document.createElement('div');
    head.className = 'nw-world-surface-head';
    const kindBadge = document.createElement('span');
    kindBadge.className = 'nw-badge';
    kindBadge.textContent = s.kind || t('Private workspace record');
    const title = document.createElement('strong');
    title.textContent = s.title;
    const closeBtn = button('×', () => bus.selectObject(null));
    closeBtn.className = 'nw-world-surface-close';
    head.append(kindBadge, title, closeBtn);
    const meta = document.createElement('p');
    meta.className = 'nw-muted';
    meta.textContent = Array.isArray(s.coordinates)
      ? `${Math.abs(s.coordinates[1]).toFixed(4)}° ${s.coordinates[1] < 0 ? 'S' : 'N'}, ${Math.abs(s.coordinates[0]).toFixed(4)}° ${s.coordinates[0] < 0 ? 'W' : 'E'}`
      : t('Private workspace record');
    const actions = document.createElement('div');
    actions.className = 'nw-world-surface-actions';
    for (const item of resolveCapabilitiesForObject({ ...s, ...s.payload })) {
      if (item.actionId === 'world.flyTo')
        actions.append(
          button('Show on globe', () => onFlyTo?.(s.coordinates, s)),
        );
      else {
        const handoff = actionHandoff(item.actionId, s);
        if (handoff)
          actions.append(button(item.label, () => bus.handoff(handoff)));
      }
    }
    actions.append(
      button('Inspect', () =>
        bus.handoff({
          targetApp:
            s.kind === 'project'
              ? 'projects'
              : s.kind === 'market-offer'
                ? 'marketplace'
                : 'records',
          action: 'inspect-object',
          reference: { id: s.id },
          payload: { objectId: s.id },
        }),
      ),
      button('Clear selection', () => bus.selectObject(null)),
    );
    container.append(head, meta, actions);
  }
  const unsubscribe = bus.subscribe((e) => {
    if (e.type === 'selection' || e.type === 'window-context') render();
  });
  return {
    element: container,
    render,
    destroy() {
      unsubscribe();
      container.remove();
    },
  };
}
