import { installRovingFocus } from './ui.js';
import { t } from '../i18n/index.js';
import { appIcon } from './icons.js';
import { governorRequestRender } from '../renderGovernor.js';

/** Small world controls, separate from the optional advanced globe panels. */
export function createWorldToolbar({ viewer, onClean, onTools }) {
  const element = document.createElement('nav');
  element.className = 'nd-world-toolbar';
  element.setAttribute('role', 'toolbar');
  element.setAttribute('aria-label', t('World controls'));
  const buttons = [];
  const add = (label, icon, run, text) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.title = label;
    b.setAttribute('aria-label', label);
    b.append(appIcon(icon));
    if (text) b.append(document.createTextNode(text));
    b.addEventListener('click', run);
    buttons.push(b);
    element.append(b);
    return b;
  };
  const zoom = (direction) => {
    const amount = Math.max(1, viewer.camera.positionCartographic.height * 0.3);
    if (direction > 0) viewer.camera.zoomIn(amount);
    else viewer.camera.zoomOut(amount);
    governorRequestRender('world-zoom');
  };
  add(t('Zoom in'), 'zoomIn', () => zoom(1));
  add(t('Zoom out'), 'zoomOut', () => zoom(-1));
  // Delegate to existing camera controls to retain their flight/cancellation policy.
  add(t('North up'), 'north', () =>
    document.getElementById('north-up-view')?.click(),
  );
  add(t('Whole globe'), 'world', () =>
    document.getElementById('reset-globe-view')?.click(),
  );
  add(
    t('Clean view'),
    'view',
    () => {
      void onClean?.();
    },
    t('Clean view'),
  );
  const tools = add(
    t('World tools'),
    'settings',
    () => {
      const active = document.body.classList.toggle('neighbor-world-tools');
      tools.setAttribute('aria-pressed', String(active));
      onTools?.(active);
    },
    t('Tools'),
  );
  tools.setAttribute('aria-pressed', 'false');
  const keyboard = installRovingFocus(element);
  return {
    element,
    destroy() {
      keyboard.destroy();
      element.remove();
      document.body.classList.remove('neighbor-world-tools');
    },
  };
}
