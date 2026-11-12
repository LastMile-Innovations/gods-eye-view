import { NEIGHBOR_APPS } from './registry.js';

const MODES = new Set(['normal', 'maximized', 'left', 'right']);
const finite = (n, fallback) => (Number.isFinite(n) ? n : fallback);
const clamp = (n, min, max) => Math.max(min, Math.min(n, max));
export const DESKTOP_STORAGE_KEY = 'neighbor.desktop.layout.v1';
export const PRESENTATIONS = Object.freeze(['desktop', 'focus']);
export function setPresentation(state, mode) {
  if (PRESENTATIONS.includes(mode)) state.presentation = mode;
}
export function setSplitRatio(state, value) {
  state.splitRatio = clamp(finite(value, 0.4), 0.25, 0.6);
}
export function desktopBounds(viewport) {
  const width = Math.max(1, finite(viewport.width, 1280));
  const height = Math.max(1, finite(viewport.height, 800));
  const x = width < 768 ? 6 : 16;
  const y = Math.min(104, height / 3);
  return {
    x,
    y,
    width: Math.max(1, width - x * 2),
    height: Math.max(1, height - y - Math.min(112, height / 3)),
  };
}
function fit(rect, viewport) {
  const b = desktopBounds(viewport);
  const width = clamp(
    finite(rect?.width, 620),
    Math.min(320, b.width),
    b.width,
  );
  const height = clamp(
    finite(rect?.height, 580),
    Math.min(240, b.height),
    b.height,
  );
  return {
    x: clamp(finite(rect?.x, b.x), b.x, b.x + b.width - width),
    y: clamp(finite(rect?.y, b.y), b.y, b.y + b.height - height),
    width,
    height,
  };
}
export function createDesktopState(viewport) {
  return {
    viewport: { ...viewport },
    focused: 'records',
    presentation: 'desktop',
    splitRatio: 0.4,
    windows: NEIGHBOR_APPS.map((app, index) => ({
      appId: app.appId,
      open: index === 0,
      minimized: false,
      mode: 'normal',
      rect: fit(
        {
          x: 40 + index * 80,
          y: 120 + index * 30,
          width: app.defaultSize[0],
          height: app.defaultSize[1],
        },
        viewport.width >= 1200 ? viewport : { width: 1440, height: 900 },
      ),
    })),
  };
}
const find = (state, id) => state.windows.find((w) => w.appId === id);
const refocus = (state) => {
  state.focused = state.windows.findLast((w) => w.open && !w.minimized)?.appId;
};
export function focusApp(state, id) {
  const w = find(state, id);
  if (!w?.open || w.minimized) return;
  state.windows = [...state.windows.filter((item) => item !== w), w];
  state.focused = id;
}
export function openApp(state, id) {
  const w = find(state, id);
  if (!w) return;
  w.open = true;
  w.minimized = false;
  focusApp(state, id);
}
export function closeApp(state, id) {
  const w = find(state, id);
  if (!w) return;
  w.open = false;
  w.minimized = false;
  refocus(state);
}
export function minimizeApp(state, id) {
  const w = find(state, id);
  if (!w?.open) return;
  w.minimized = true;
  refocus(state);
}
export function setWindowMode(state, id, mode) {
  const w = find(state, id);
  if (w && MODES.has(mode)) w.mode = mode;
}
export function windowRect(state, w) {
  const b = desktopBounds(state.viewport);
  if (
    state.viewport.width < 1200 ||
    state.presentation === 'focus' ||
    w.mode === 'maximized'
  )
    return b;
  if (w.mode === 'left' || w.mode === 'right')
    return {
      ...b,
      x: b.x + (w.mode === 'right' ? b.width / 2 : 0),
      width: b.width / 2,
    };
  return fit(w.rect, state.viewport);
}
export function moveWindow(state, id, dx, dy, start) {
  const w = find(state, id);
  if (!w) return;
  const r = start || w.rect;
  w.mode = 'normal';
  w.rect = fit(
    { ...r, x: r.x + finite(dx, 0), y: r.y + finite(dy, 0) },
    state.viewport,
  );
}
/**
 * Proportionally restores a maximized or tiled window under the pointer at (clientX, clientY)
 * so dragging a snapped titlebar smoothly detaches into a floating window.
 */
export function unsnapWindow(state, id, clientX, clientY) {
  const w = find(state, id);
  if (!w || w.mode === 'normal') return w?.rect;
  const current = windowRect(state, w);
  const floatRect = fit(w.rect, state.viewport);
  const ratioX = clamp(
    (finite(clientX, current.x + current.width / 2) - current.x) /
      Math.max(1, current.width),
    0.15,
    0.85,
  );
  const nextX = finite(clientX, current.x) - floatRect.width * ratioX;
  const nextY = Math.max(
    desktopBounds(state.viewport).y,
    finite(clientY, current.y) - 18,
  );
  w.mode = 'normal';
  w.rect = fit({ ...floatRect, x: nextX, y: nextY }, state.viewport);
  return { ...w.rect };
}
/** Tiles all currently open, unminimized windows into an even grid across the desktop bounds. */
export function tileOpenWindows(state) {
  const open = state.windows.filter((w) => w.open && !w.minimized);
  if (!open.length) return;
  const b = desktopBounds(state.viewport);
  if (open.length === 1) {
    open[0].mode = 'maximized';
    return;
  }
  if (open.length === 2) {
    open[0].mode = 'left';
    open[1].mode = 'right';
    return;
  }
  const cols = Math.ceil(Math.sqrt(open.length));
  const rows = Math.ceil(open.length / cols);
  const gap = 8;
  const cellW = Math.floor((b.width - gap * (cols - 1)) / cols);
  const cellH = Math.floor((b.height - gap * (rows - 1)) / rows);
  open.forEach((w, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    w.mode = 'normal';
    w.rect = fit(
      {
        x: b.x + col * (cellW + gap),
        y: b.y + row * (cellH + gap),
        width: cellW,
        height: cellH,
      },
      state.viewport,
    );
  });
}
/** Cascades all currently open, unminimized windows diagonally across the desktop bounds. */
export function cascadeOpenWindows(state) {
  const open = state.windows.filter((w) => w.open && !w.minimized);
  if (!open.length) return;
  const b = desktopBounds(state.viewport);
  const stepX = 32;
  const stepY = 28;
  open.forEach((w, idx) => {
    const app = NEIGHBOR_APPS.find((a) => a.appId === w.appId);
    const width = app ? app.defaultSize[0] : 760;
    const height = app ? app.defaultSize[1] : 580;
    w.mode = 'normal';
    w.rect = fit(
      {
        x: b.x + 20 + (idx % 6) * stepX,
        y: b.y + 12 + (idx % 6) * stepY,
        width,
        height,
      },
      state.viewport,
    );
  });
}
export function resizeWindow(state, id, edge, dx, dy, start) {
  const w = find(state, id);
  if (!w || !/^(n|s|e|w|ne|nw|se|sw)$/.test(edge)) return;
  const r = start || w.rect,
    b = desktopBounds(state.viewport);
  const minW = Math.min(320, b.width),
    minH = Math.min(240, b.height);
  let left = r.x,
    right = r.x + r.width,
    top = r.y,
    bottom = r.y + r.height;
  if (edge.includes('w')) left = clamp(r.x + finite(dx, 0), b.x, right - minW);
  if (edge.includes('e'))
    right = clamp(right + finite(dx, 0), left + minW, b.x + b.width);
  if (edge.includes('n')) top = clamp(r.y + finite(dy, 0), b.y, bottom - minH);
  if (edge.includes('s'))
    bottom = clamp(bottom + finite(dy, 0), top + minH, b.y + b.height);
  w.mode = 'normal';
  w.rect = fit(
    { x: left, y: top, width: right - left, height: bottom - top },
    state.viewport,
  );
}
export function fitDesktop(state, viewport) {
  state.viewport = { ...viewport };
  // Keep preferred floating geometry; fit only its displayed projection.
}
/** Presentation only. Do not spread runtime objects into this persistence boundary. */
export function serializeDesktop(state) {
  return JSON.stringify({
    version: 2,
    presentation: state.presentation,
    splitRatio: state.splitRatio,
    focused: state.focused,
    windows: state.windows.map((w) => ({
      appId: w.appId,
      open: w.open,
      minimized: w.minimized,
      mode: w.mode,
      rect: {
        x: w.rect.x,
        y: w.rect.y,
        width: w.rect.width,
        height: w.rect.height,
      },
    })),
  });
}
export function restoreDesktop(raw, viewport) {
  const state = createDesktopState(viewport);
  try {
    if (typeof raw !== 'string' || raw.length > 8192) return state;
    const saved = JSON.parse(raw);
    if (![1, 2].includes(saved?.version) || !Array.isArray(saved.windows))
      return state;
    if (saved.version === 2) {
      setPresentation(state, saved.presentation);
      setSplitRatio(state, saved.splitRatio);
    }
    const seen = new Set();
    const order = [];
    for (const entry of saved.windows) {
      const w = find(state, entry?.appId);
      if (!w || seen.has(w.appId)) continue;
      seen.add(w.appId);
      order.push(w);
      w.open = typeof entry.open === 'boolean' ? entry.open : w.open;
      w.minimized = w.open && entry.minimized === true;
      w.mode = MODES.has(entry.mode) ? entry.mode : 'normal';
      w.rect = fit(
        entry.rect,
        viewport.width >= 1200 ? viewport : { width: 1920, height: 1080 },
      );
    }
    state.windows = [
      ...state.windows.filter((w) => !seen.has(w.appId)),
      ...order,
    ];
    refocus(state);
    const focused = find(state, saved.focused);
    if (focused?.open && !focused.minimized) focusApp(state, focused.appId);
  } catch {
    /* A corrupt/blocked browser preference cannot block native records. */
  }
  return state;
}
