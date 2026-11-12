import { button as uiButton } from './ui.js';
import { t } from '../i18n/index.js';
import { appIcon } from './icons.js';
import { searchDesktop } from './desktopCommands.js';
import { createWorldToolbar } from './worldToolbar.js';
import { createWorldPresentation } from './worldPresentation.js';
import { NEIGHBOR_APPS } from './registry.js';
import {
  DESKTOP_STORAGE_KEY,
  restoreDesktop,
  serializeDesktop,
  windowRect,
  openApp,
  focusApp,
  closeApp,
  minimizeApp,
  setWindowMode,
  moveWindow,
  unsnapWindow,
  tileOpenWindows,
  cascadeOpenWindows,
  resizeWindow,
  fitDesktop,
  desktopBounds,
  setPresentation,
} from './desktopState.js';
import './desktop.css';
import './tokens.css';
import './apps.css';

const element = (tag, className, text) => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
};
const action = (label, run, text = label) =>
  uiButton(text, run, { 'aria-label': label, title: label });
const PRODUCT_NAME = 'NeighborOS';
const viewport = () => ({
  width: window.innerWidth,
  height: window.innerHeight,
});

/** One viewer; geometry mutations never remount application content. */
export function mountNeighborDesktop({
  root,
  layer,
  createContent,
  bus,
  viewer,
  getRecords = () => [],
  onRecord = () => {},
  onAction = () => {},
  onNavigate = () => {},
  onCleanWorld,
}) {
  let raw;
  try {
    raw = localStorage.getItem(DESKTOP_STORAGE_KEY);
  } catch {
    /* optional preference */
  }
  let state = restoreDesktop(raw, viewport());
  const nodes = new Map();
  const worldPresentation = createWorldPresentation(viewer);
  document.body.classList.add('neighbor-desktop');
  const worldToolbar = createWorldToolbar({
    viewer,
    onClean: onCleanWorld,
    onTools: (active) => {
      if (active) setWorld(true);
    },
  });
  root.append(worldToolbar.element);
  let launcherInvoker;
  let world = false,
    disposed = false,
    frame = 0,
    drag,
    saveTimer,
    resizeFrame = 0;
  const dock = element('nav', 'nd-dock');
  const pinned = new Set([
    'records',
    'marketplace',
    'projects',
    'social',
    'agent',
    'board',
    'documents',
    'evidence',
  ]);
  dock.setAttribute('aria-label', t('Applications'));
  const menu = element('div', 'nd-menu');
  const activeName = element('strong', 'nd-active-name');
  const launcher = element('dialog', 'nw-dialog nd-launcher');
  launcher.setAttribute('aria-label', t('Search NeighborOS'));
  launcher.addEventListener('close', () => {
    if (launcherInvoker?.isConnected) launcherInvoker.focus();
  });
  launcher.addEventListener('click', (event) => {
    if (event.target === launcher) launcher.close();
  });
  const search = element('input');
  search.type = 'search';
  search.placeholder = t('Search apps, actions, and records');
  search.setAttribute('aria-label', t('Search NeighborOS'));
  const results = element('div', 'nd-commands');
  const closeLauncher = action(t('Close launcher'), () => launcher.close());
  const launcherHead = element(
    'div',
    'nd-launcher-head',
    element('h2', '', t('Open an application')),
  );
  launcherHead.append(closeLauncher);
  launcher.append(launcherHead, search, results);
  root.append(dock, launcher);
  const command = action(
    t('Search applications'),
    () => {
      launcherInvoker = document.activeElement;
      search.value = '';
      renderCommands();
      launcher.showModal();
      search.focus();
    },
    'Search ⌘K',
  );
  command.className = 'nd-search-trigger';
  command.prepend(appIcon('search'));
  const agentButton = action('Open AI Agent', () => open('agent'), 'Agent');
  agentButton.className = 'nd-agent-trigger';
  agentButton.prepend(appIcon('agent'));
  const worldButton = action(t('Show world'), () => setWorld(!world));
  worldButton.className = 'nd-world-trigger';
  const layouts = element('select', 'nd-layout');
  layouts.setAttribute('aria-label', t('Workspace layout'));
  for (const mode of ['desktop', 'focus']) {
    const option = element('option', '', mode[0].toUpperCase() + mode.slice(1));
    option.value = mode;
    layouts.append(option);
  }
  layouts.addEventListener('change', () => {
    onNavigate();
    setPresentation(state, layouts.value);
    world = false;
    update();
  });
  const cascadeBtn = action(
    'Cascade open windows',
    () => {
      cascadeOpenWindows(state);
      world = false;
      update();
    },
    'Cascade',
  );
  cascadeBtn.className = 'nd-arrange-btn';
  const tileBtn = action(
    'Tile open windows',
    () => {
      tileOpenWindows(state);
      world = false;
      update();
    },
    'Tile',
  );
  tileBtn.className = 'nd-arrange-btn';
  const overview = action('Window overview', () => showPicker(true), 'Windows');
  const apps = action('All applications', () => showPicker(false), 'Apps');
  apps.className = 'nd-dock-apps';
  apps.prepend(appIcon('apps'));
  const mobileWorld = action('World', () => setWorld(true), 'World');
  mobileWorld.className = 'nd-mobile';
  const mobileWork = action(
    'Work',
    () => {
      setWorld(false);
      open(state.focused || 'records');
    },
    'Work',
  );
  mobileWork.className = 'nd-mobile';
  const mobileSearch = action('Search', () => command.click(), 'Search');
  mobileSearch.className = 'nd-mobile';
  dock.append(mobileWorld, mobileWork, mobileSearch, apps);
  const snapPreview = element('div', 'nd-snap-preview');
  snapPreview.hidden = true;
  root.append(snapPreview);
  menu.append(
    activeName,
    layouts,
    cascadeBtn,
    tileBtn,
    overview,
    agentButton,
    command,
    worldButton,
  );
  const geometryHint = t(
    'Arrow keys move this window. Shift and arrow keys resize it.',
  );
  for (const app of NEIGHBOR_APPS) {
    const win = element('section', 'nd-window');
    win.dataset.appId = app.appId;
    win.setAttribute('role', 'region');
    win.setAttribute('aria-labelledby', `nd-title-${app.appId}`);
    const bar = element('header', 'nd-titlebar');
    const controls = element('div', 'nd-traffic');
    const close = action(
      t('Close window'),
      () => {
        closeApp(state, app.appId);
        update();
        focusFallback();
      },
      '×',
    );
    const minimize = action(
      t('Minimize window'),
      () => {
        minimizeApp(state, app.appId);
        update();
        focusFallback();
      },
      '−',
    );
    const maximize = action(
      t('Maximize or restore window'),
      () => toggleMax(app.appId),
      '+',
    );
    close.className = 'nd-close';
    minimize.className = 'nd-minimize';
    maximize.className = 'nd-maximize';
    controls.append(close, minimize, maximize);
    const title = element('button', 'nd-window-title', app.name);
    title.type = 'button';
    title.id = `nd-title-${app.appId}`;
    title.title = geometryHint;
    title.setAttribute('aria-label', `${app.name}. ${geometryHint}`);
    title.prepend(appIcon(app.appId));
    title.addEventListener('dblclick', () => toggleMax(app.appId));
    title.addEventListener('keydown', (event) => {
      const delta = {
        ArrowLeft: [-20, 0],
        ArrowRight: [20, 0],
        ArrowUp: [0, -20],
        ArrowDown: [0, 20],
      }[event.key];
      if (!delta) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) resizeWindow(state, app.appId, 'se', ...delta);
      else moveWindow(state, app.appId, ...delta);
      update();
    });
    const contextBadge = element('select', 'nd-context-badge');
    contextBadge.setAttribute('aria-label', `${app.name} context`);
    for (const [value, label] of [
      ['follow-world', 'Follow World'],
      ['linked:A', 'Group A'],
      ['linked:B', 'Group B'],
      ['linked:C', 'Group C'],
      ['independent', 'Independent'],
    ]) {
      const o = element('option', '', label);
      o.value = value;
      contextBadge.append(o);
    }
    contextBadge.addEventListener('change', () => {
      const [contextMode, linkGroup] = contextBadge.value.split(':');
      bus?.setWindowContext(app.appId, { contextMode, linkGroup });
    });
    const split = action(
      t('Tile window'),
      () => {
        const w = state.windows.find((w) => w.appId === app.appId);
        setWindowMode(
          state,
          app.appId,
          w.mode === 'left' ? 'right' : w.mode === 'right' ? 'normal' : 'left',
        );
        update();
      },
      '◧',
    );
    split.className = 'nd-tile-btn';
    bar.append(controls, title, contextBadge, split);
    const body = element('div', 'nd-app-body');
    win.append(bar, body);
    const dockButton = action(app.name, () => open(app.appId), app.name);
    dockButton.dataset.appId = app.appId;
    dockButton.prepend(appIcon(app.appId));
    dock.append(dockButton);
    win.addEventListener('pointerdown', () => {
      if (state.focused !== app.appId) {
        focusApp(state, app.appId);
        update();
      }
    });
    win.addEventListener('focusin', () => {
      if (state.focused !== app.appId) {
        focusApp(state, app.appId);
        update();
      }
    });
    bar.addEventListener('pointerdown', (event) => {
      if (event.target.closest('button,select') && event.target !== title)
        return;
      startPointer(event, app.appId);
    });
    for (const edge of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
      const handle = element('div', `nd-resize nd-resize-${edge}`);
      handle.setAttribute('aria-hidden', 'true');
      handle.addEventListener('pointerdown', (event) =>
        startPointer(event, app.appId, edge),
      );
      win.append(handle);
    }
    nodes.set(app.appId, {
      win,
      bar,
      body,
      title,
      dockButton,
      maximize,
      contextBadge,
    });
    layer.append(win);
    createContent(app, body);
  }
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (disposed) return;
      try {
        localStorage.setItem(DESKTOP_STORAGE_KEY, serializeDesktop(state));
      } catch {
        /* Native records do not depend on browser preferences. */
      }
    }, 150);
  }
  function update(persist = true) {
    if (disposed) return;
    const small = state.viewport.width < 1200;
    const presentation = small ? 'focus' : state.presentation;
    root.dataset.presentation = world ? 'world' : presentation;
    worldToolbar.element.hidden = !world && presentation === 'focus';
    layouts.value = state.presentation;
    layouts.disabled = small;
    const bounds = desktopBounds(state.viewport);
    const opaque = [];
    let openCount = 0;
    for (const [index, w] of state.windows.entries()) {
      if (w.open && !w.minimized) openCount++;
      const n = nodes.get(w.appId),
        r = windowRect(state, w);
      n.win.hidden =
        world ||
        !w.open ||
        w.minimized ||
        ((small || presentation !== 'desktop') && state.focused !== w.appId);
      if (!n.win.hidden) opaque.push(r);
      n.dockButton.hidden = !pinned.has(w.appId) && !w.open;
      n.win.dataset.mode = w.mode;
      n.win.classList.toggle('nd-focused', state.focused === w.appId);
      if (n.contextBadge) {
        const context = bus?.getWindowContext(w.appId);
        n.contextBadge.value =
          context?.contextMode === 'linked'
            ? `linked:${context.linkGroup}`
            : context?.contextMode || 'independent';
      }
      Object.assign(n.win.style, {
        left: `${r.x}px`,
        top: `${r.y}px`,
        width: `${r.width}px`,
        height: `${r.height}px`,
        zIndex: String(index + 1),
      });
      n.dockButton.dataset.running = String(w.open);
      n.dockButton.dataset.minimized = String(w.minimized);
      n.dockButton.setAttribute(
        'aria-pressed',
        String(!world && state.focused === w.appId),
      );
      n.maximize.setAttribute('aria-pressed', String(w.mode === 'maximized'));
    }
    overview.dataset.count = openCount ? String(openCount) : '';
    // i18n-ignore: product title and registered application names
    activeName.textContent =
      NEIGHBOR_APPS.find((a) => a.appId === state.focused)?.name ||
      PRODUCT_NAME;
    worldButton.textContent = world ? t('Return to apps') : t('Show world');
    worldButton.setAttribute('aria-pressed', String(world));
    root.classList.toggle('nd-world', world);
    document.body.classList.toggle('neighbor-desktop-apps', !world);
    worldPresentation.update({
      mode: world ? 'world' : presentation,
      bounds,
      windows: opaque,
    });
    if (persist) save();
  }
  function focusFallback() {
    if (state.focused) nodes.get(state.focused).title.focus();
    else nodes.values().next().value.dockButton.focus();
  }
  function open(appId) {
    onNavigate();
    if (!nodes.has(appId) || disposed) return;
    world = false;
    openApp(state, appId);
    update();
    nodes.get(appId).title.focus();
  }
  function toggleMax(id) {
    const w = state.windows.find((w) => w.appId === id);
    setWindowMode(state, id, w.mode === 'maximized' ? 'normal' : 'maximized');
    update();
  }
  function setWorld(value) {
    onNavigate();
    world = value;
    update(false);
  }
  function showPicker(running) {
    launcherInvoker = document.activeElement;
    search.value = '';
    renderCommands(running ? 'running' : 'apps');
    launcher.showModal();
    search.focus();
  }
  function renderCommands(scope) {
    results.replaceChildren();
    let total = 0;
    const openSet = new Set(
      state.windows.filter((w) => w.open).map((w) => w.appId),
    );
    for (const group of searchDesktop(search.value, getRecords(), openSet)) {
      const items = group.items
        .filter((item) => scope !== 'apps' || item.type === 'app')
        .filter(
          (item) =>
            scope !== 'running' ||
            (item.type === 'app' && openSet.has(item.id)),
        );
      if (!items.length) continue;
      results.append(element('h3', 'nd-command-group', group.title));
      for (const item of items) {
        total++;
        const b = action(
          item.title,
          () => {
            launcherInvoker = undefined;
            launcher.close();
            if (item.type === 'app') open(item.id);
            else if (item.type === 'record') onRecord(item);
            else {
              open(item.appId);
              onAction(item.id);
            }
          },
          item.title,
        );
        b.dataset.result = 'true';
        b.dataset.kind = item.kind || item.type;
        b.prepend(
          appIcon(item.type === 'app' ? item.id : item.appId || 'records'),
        );
        results.append(b);
      }
    }
    const count = element(
      'p',
      'nw-muted nd-command-count',
      total ? `${total} results` : 'No matching apps, actions, or records.',
    );
    count.setAttribute('role', 'status');
    results.append(count);
  }
  search.addEventListener('input', () => renderCommands());
  launcher.addEventListener('keydown', (event) => {
    const buttons = [...results.querySelectorAll('button')];
    const index = buttons.indexOf(document.activeElement);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      if (!buttons.length) return;
      event.preventDefault();
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? buttons.length - 1
            : event.key === 'ArrowDown'
              ? (index + 1) % buttons.length
              : index < 0
                ? buttons.length - 1
                : (index - 1 + buttons.length) % buttons.length;
      buttons[next].focus();
    } else if (event.key === 'Enter' && document.activeElement === search) {
      event.preventDefault();
      buttons[0]?.click();
    }
  });
  function applyPointer() {
    frame = 0;
    if (!drag) return;
    const { id, edge } = drag;
    if (drag.wasSnapped) {
      if (Math.hypot(drag.lastX - drag.x, drag.lastY - drag.y) < 5) return;
      const restored = unsnapWindow(state, id, drag.lastX, drag.lastY);
      drag.start = { ...restored };
      drag.x = drag.lastX;
      drag.y = drag.lastY;
      drag.wasSnapped = false;
      nodes.get(id).win.dataset.mode = 'normal';
    }
    const { start, x, y, lastX, lastY } = drag;
    if (edge) resizeWindow(state, id, edge, lastX - x, lastY - y, start);
    else moveWindow(state, id, lastX - x, lastY - y, start);
    if (!edge && drag.altKey) {
      const b = desktopBounds(state.viewport);
      const mode =
        lastX < b.x + 16
          ? 'left'
          : lastX > b.x + b.width - 16
            ? 'right'
            : lastY < b.y + 12
              ? 'maximized'
              : null;
      snapPreview.hidden = !mode;
      if (mode) {
        const r =
          mode === 'maximized'
            ? b
            : {
                ...b,
                x: b.x + (mode === 'right' ? b.width / 2 : 0),
                width: b.width / 2,
              };
        Object.assign(snapPreview.style, {
          left: `${r.x}px`,
          top: `${r.y}px`,
          width: `${r.width}px`,
          height: `${r.height}px`,
        });
      }
    } else if (!snapPreview.hidden) {
      snapPreview.hidden = true;
    }
    const w = state.windows.find((w) => w.appId === id);
    const r = windowRect(state, w);
    Object.assign(nodes.get(id).win.style, {
      left: `${r.x}px`,
      top: `${r.y}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    });
  }
  function startPointer(event, id, edge) {
    if (
      event.button !== 0 ||
      state.viewport.width < 1200 ||
      state.presentation !== 'desktop'
    )
      return;
    const w = state.windows.find((w) => w.appId === id);
    if (edge && w.mode !== 'normal') return;
    event.preventDefault();
    event.stopPropagation();
    focusApp(state, id);
    drag = {
      id,
      edge,
      wasSnapped: !edge && w.mode !== 'normal',
      altKey: Boolean(event.altKey),
      pointerId: event.pointerId,
      target: event.currentTarget,
      x: event.clientX,
      y: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      start: { ...w.rect },
    };
    drag.target.setPointerCapture(event.pointerId);
    root.classList.add('nd-dragging');
    update(false);
  }
  const pointerMove = (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    drag.altKey = Boolean(event.altKey);
    if (!frame) frame = requestAnimationFrame(applyPointer);
  };
  const pointerEnd = (event) => {
    if (
      !drag ||
      (event?.pointerId !== undefined && event.pointerId !== drag.pointerId)
    )
      return;
    if (frame) cancelAnimationFrame(frame);
    applyPointer();
    if (!drag.edge && drag.altKey && event?.type === 'pointerup') {
      const b = desktopBounds(state.viewport);
      if (drag.lastX < b.x + 16) setWindowMode(state, drag.id, 'left');
      else if (drag.lastX > b.x + b.width - 16)
        setWindowMode(state, drag.id, 'right');
      else if (drag.lastY < b.y + 12)
        setWindowMode(state, drag.id, 'maximized');
    }
    const previous = drag;
    drag = undefined;
    if (previous.target.hasPointerCapture(previous.pointerId))
      previous.target.releasePointerCapture(previous.pointerId);
    root.classList.remove('nd-dragging');
    snapPreview.hidden = true;
    update();
  };
  const resize = () => {
    pointerEnd();
    if (resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      fitDesktop(state, viewport());
      update();
    });
  };
  const keydown = (event) => {
    if (
      (event.metaKey || event.ctrlKey) &&
      !event.altKey &&
      event.key.toLowerCase() === 'k' &&
      !root.querySelector('dialog[open]')
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      command.click();
      return;
    }
    if (root.querySelector('dialog[open]')) return;
    if (event.key === 'Escape' && world) {
      event.preventDefault();
      setWorld(false);
      focusFallback();
    }
    if (event.target.closest?.('input,textarea,select,[contenteditable=true]'))
      return;
    if (!event.ctrlKey || !event.altKey) return;
    if (event.code === 'Space') {
      event.preventDefault();
      setWorld(!world);
    } else if (event.key.toLowerCase() === 'm' && state.focused) {
      event.preventDefault();
      minimizeApp(state, state.focused);
      update();
      focusFallback();
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      const opened = NEIGHBOR_APPS.map((app) =>
        state.windows.find((w) => w.appId === app.appId),
      ).filter((w) => w.open && !w.minimized);
      if (!opened.length) return;
      const index = opened.findIndex((w) => w.appId === state.focused);
      const next =
        (index + (event.key === 'ArrowRight' ? 1 : -1) + opened.length) %
        opened.length;
      event.preventDefault();
      open(opened[next].appId);
    }
  };
  window.addEventListener('pointermove', pointerMove);
  window.addEventListener('pointerup', pointerEnd);
  window.addEventListener('pointercancel', pointerEnd);
  window.addEventListener('blur', pointerEnd);
  window.addEventListener('resize', resize);
  document.addEventListener('keydown', keydown, true);
  update(false);
  return {
    clearPrivate() {
      launcher.close();
      search.value = '';
      results.replaceChildren();
    },
    menu,
    dock,
    open,
    setWorld,
    activeApp: () => state.focused,
    layout: () => JSON.parse(serializeDesktop(state)),
    restore(layout) {
      if (disposed) return;
      state = restoreDesktop(JSON.stringify(layout), viewport());
      world = false;
      update();
      focusFallback();
    },
    body: (id) => nodes.get(id)?.body,
    bodies: () => [...nodes.entries()].map(([appId, n]) => [appId, n.body]),
    destroy() {
      if (disposed) return;
      pointerEnd();
      try {
        localStorage.setItem(DESKTOP_STORAGE_KEY, serializeDesktop(state));
      } catch {
        /* optional preference */
      }
      disposed = true;
      clearTimeout(saveTimer);
      cancelAnimationFrame(frame);
      cancelAnimationFrame(resizeFrame);
      window.removeEventListener('pointermove', pointerMove);
      window.removeEventListener('pointerup', pointerEnd);
      window.removeEventListener('pointercancel', pointerEnd);
      window.removeEventListener('blur', pointerEnd);
      window.removeEventListener('resize', resize);
      document.removeEventListener('keydown', keydown, true);
      worldPresentation.destroy();
      worldToolbar.destroy();
      snapPreview.remove();
      dock.remove();
      launcher.remove();
      menu.remove();
      layer.replaceChildren();
      document.body.classList.remove(
        'neighbor-desktop-apps',
        'neighbor-desktop',
      );
    },
  };
}
