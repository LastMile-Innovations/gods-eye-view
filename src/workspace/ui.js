import { draftFieldKey } from './draftFields.js';

/** Shared DOM primitives. Record text is always textContent, never executable markup. */
export function element(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (value === undefined || value === null) continue;
    if (name === 'className') el.className = value;
    else if (name === 'text') el.textContent = value;
    else if (name === 'value') el.value = value;
    else if (name.startsWith('on') && typeof value === 'function')
      el.addEventListener(name.slice(2).toLowerCase(), value);
    else if (name.startsWith('aria-')) el.setAttribute(name, String(value));
    else if (typeof value === 'boolean') el[name] = value;
    else el.setAttribute(name, value);
  }
  el.append(
    ...children.filter(
      (child) => child !== null && child !== undefined && child !== false,
    ),
  );
  return el;
}
export function button(text, onPress, props = {}) {
  return element('button', {
    type: 'button',
    text,
    onclick: onPress,
    ...props,
  });
}
let fieldSequence = 0;
/** Labels wrap their controls; descriptions/errors get explicit accessible associations. */
export function field(text, control, { description, error } = {}) {
  const draftKey = draftFieldKey(text, control);
  if (draftKey) control.dataset.draftKey = draftKey;
  const label = element(
    'label',
    { className: 'nw-field' },
    element('span', { text }),
    control,
  );
  if (description || error) {
    const id = `nw-field-description-${++fieldSequence}`;
    control.setAttribute(
      'aria-describedby',
      [control.getAttribute('aria-describedby'), id].filter(Boolean).join(' '),
    );
    if (error) control.setAttribute('aria-invalid', 'true');
    label.append(
      element('small', {
        id,
        className: error ? 'nw-field-error' : 'nw-field-description',
        text: error || description,
      }),
    );
  }
  return label;
}
export function emptyState({
  title,
  description,
  actionLabel,
  onAction,
  disabled = false,
}) {
  return element(
    'section',
    { className: 'nw-empty-state' },
    element('h2', { text: title }),
    description
      ? element('p', { className: 'nw-muted', text: description })
      : null,
    actionLabel
      ? button(actionLabel, onAction, { disabled, className: 'nw-primary' })
      : null,
  );
}
/** Compact semantic badge primitive (shadcn-like neutral/outline/subtle variants). */
export function badge(text, variant = 'default', extraClass = '') {
  const cls = [
    'nw-badge',
    variant !== 'default' ? `nw-badge-${variant}` : '',
    extraClass,
  ]
    .filter(Boolean)
    .join(' ');
  return element('span', { className: cls, text: String(text ?? '') });
}
/** Compact key-value property grid for inspectors and document headers. */
export function propertyGrid(items = []) {
  const dl = element('dl', { className: 'nw-prop-grid' });
  for (const item of items) {
    if (!item) continue;
    const term = Array.isArray(item) ? item[0] : item.key;
    const val = Array.isArray(item) ? item[1] : item.val;
    const mono = Array.isArray(item) ? item[2] : item.mono;
    if (val === undefined || val === null || val === '') continue;
    dl.append(
      element(
        'div',
        { className: 'nw-prop-cell' },
        element('dt', { text: term }),
        typeof val === 'object' && val.nodeType
          ? element('dd', {}, val)
          : element('dd', {
              className: mono ? 'nw-mono' : '',
              text: String(val),
            }),
      ),
    );
  }
  return dl;
}
/** Standard 40px desktop application command bar with title, count/summary, and actions. */
export function appToolbar({ heading, summary, tabs, actions = [] }) {
  return element(
    'div',
    { className: 'nw-service-head nw-app-toolbar' },
    element('h1', { text: heading }),
    summary !== undefined && summary !== null
      ? element('span', {
          className: 'nw-toolbar-summary',
          text: String(summary),
        })
      : null,
    tabs || null,
    element(
      'div',
      { className: 'nw-toolbar-actions' },
      ...actions.filter(Boolean),
    ),
  );
}
/** Segmented tab control with active state and aria-pressed semantics. */
export function segmentedTabs({
  items = [],
  active,
  onSelect,
  className = 'nw-tabs',
  ariaLabel,
}) {
  const nav = element('div', {
    className,
    ...(ariaLabel ? { role: 'tablist', 'aria-label': ariaLabel } : {}),
  });
  for (const item of items) {
    const id = Array.isArray(item) ? item[0] : item.id;
    const text = Array.isArray(item) ? item[1] : item.text;
    const count = Array.isArray(item) ? item[2] : item.count;
    const isCurrent = id === active;
    const labelText = count !== undefined ? `${text} (${count})` : text;
    nav.append(
      button(labelText, () => onSelect(id), {
        className: isCurrent ? 'nw-primary nw-tab-active' : 'nw-tab-btn',
        'aria-pressed': String(isCurrent),
      }),
    );
  }
  return nav;
}
/** Standard compact row for master lists in split-pane desktop applications. */
export function masterRow({
  title,
  subtitle,
  meta,
  active = false,
  onSelect,
  hidden = false,
  className = '',
  props = {},
}) {
  const row = button('', onSelect, {
    className: ['nw-master-row', active ? 'nw-selected' : '', className]
      .filter(Boolean)
      .join(' '),
    'aria-pressed': String(Boolean(active)),
    hidden,
    ...props,
  });
  const top = element(
    'div',
    { className: 'nw-master-row-top' },
    element('strong', { text: title }),
    meta
      ? element('span', { className: 'nw-master-row-meta', text: meta })
      : null,
  );
  row.append(top);
  if (subtitle) {
    row.append(
      element('span', { className: 'nw-master-row-sub', text: subtitle }),
    );
  }
  return row;
}
/** Multi-pane desktop workspace container (master list + detail document + optional inspector). */
export function splitWorkspace({ sidebar, detail, inspector, className = '' }) {
  const cls = [
    'nw-split-workspace',
    inspector ? 'nw-has-inspector' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return element('div', { className: cls }, sidebar, detail, inspector || null);
}
/** Factual bottom window status bar. */
export function statusBar(items = []) {
  return element(
    'footer',
    { className: 'nw-window-statusbar' },
    ...items
      .filter(Boolean)
      .map((text) =>
        element('span', { className: 'nw-statusbar-item', text: String(text) }),
      ),
  );
}
/** One tab stop per button group; never capture arrows intended for an input. */
export function installRovingFocus(
  container,
  { selector = 'button', orientation = 'horizontal' } = {},
) {
  let current;
  const controls = () =>
    [...container.querySelectorAll(selector)].filter(
      (el) => !el.disabled && !el.hidden,
    );
  const refresh = () => {
    const all = controls();
    if (!all.includes(current)) current = all[0];
    all.forEach((el) => {
      el.tabIndex = el === current ? 0 : -1;
    });
    return all;
  };
  const focus = (event) => {
    const all = controls(),
      found = all.find(
        (el) => el === event.target || el.contains(event.target),
      );
    if (!found) return;
    current = found;
    refresh();
  };
  const keydown = (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const all = refresh(),
      active = all.findIndex(
        (el) => el === event.target || el.contains(event.target),
      );
    if (active < 0) return;
    const previous = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft';
    const next = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight';
    if (![previous, next, 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? all.length - 1
          : (active + (event.key === previous ? -1 : 1) + all.length) %
            all.length;
    current = all[index];
    refresh();
    current.focus();
  };
  refresh();
  container.addEventListener('focusin', focus);
  container.addEventListener('keydown', keydown);
  return {
    refresh,
    destroy() {
      container.removeEventListener('focusin', focus);
      container.removeEventListener('keydown', keydown);
      controls().forEach((el) => {
        el.tabIndex = 0;
      });
    },
  };
}
