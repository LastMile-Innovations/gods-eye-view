import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDesktopState,
  desktopBounds,
  windowRect,
  serializeDesktop,
  restoreDesktop,
  openApp,
  focusApp,
  minimizeApp,
  closeApp,
  setWindowMode,
  moveWindow,
  resizeWindow,
  fitDesktop,
} from './desktopState.js';
import { NEIGHBOR_APPS, resolveCommand } from './registry.js';
const viewport = { width: 1440, height: 900 };

test('dock lifecycle keeps apps independent and restores minimized instances', () => {
  const s = createDesktopState(viewport);
  openApp(s, 'board');
  openApp(s, 'documents');
  assert.equal(s.focused, 'documents');
  minimizeApp(s, 'documents');
  assert.equal(s.focused, 'board');
  openApp(s, 'documents');
  assert.equal(s.focused, 'documents');
  assert.equal(s.windows.length, NEIGHBOR_APPS.length);
  closeApp(s, 'documents');
  assert.equal(s.focused, 'board');
  assert.equal(s.windows.find((w) => w.appId === 'documents').open, false);
});

test('maximize and snap preserve floating geometry and viewport resize recovers accessible windows', () => {
  const s = createDesktopState(viewport);
  const original = { ...s.windows[0].rect };
  setWindowMode(s, 'records', 'maximized');
  assert.deepEqual(windowRect(s, s.windows[0]), desktopBounds(viewport));
  setWindowMode(s, 'records', 'normal');
  assert.deepEqual(s.windows[0].rect, original);
  setWindowMode(s, 'records', 'left');
  assert.equal(
    windowRect(s, s.windows[0]).width,
    desktopBounds(viewport).width / 2,
  );
  fitDesktop(s, { width: 390, height: 844 });
  const r = windowRect(s, s.windows[0]);
  assert.ok(
    r.x >= 0 && r.y >= 0 && r.x + r.width <= 390 && r.y + r.height <= 844,
  );
});

test('all eight resize handles preserve the opposite boundary and enforce minimums', () => {
  for (const edge of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
    const s = createDesktopState(viewport);
    const initial = { ...s.windows[0].rect };
    resizeWindow(s, 'records', edge, 30, 25, initial);
    const r = s.windows[0].rect;
    if (edge.includes('w'))
      assert.equal(r.x + r.width, initial.x + initial.width);
    if (edge.includes('n'))
      assert.equal(r.y + r.height, initial.y + initial.height);
    assert.ok(r.width >= 320 && r.height >= 240);
    resizeWindow(s, 'records', edge, -100000, -100000, r);
    const bounded = s.windows[0].rect;
    assert.ok(bounded.width >= 320 && bounded.height >= 240);
    assert.ok(
      bounded.x >= desktopBounds(viewport).x &&
        bounded.y >= desktopBounds(viewport).y,
    );
  }
});

test('restore accepts only known bounded presentation state and repairs corrupt focus', () => {
  const s = createDesktopState(viewport);
  openApp(s, 'board');
  s.windows[0].rect = { x: 1e12, y: -9, width: 1e12, height: 800 };
  s.windows[0].privateTitle = 'private record';
  s.windows[0].selected = 'secret QID';
  const saved = serializeDesktop(s);
  assert.ok(!saved.includes('private record') && !saved.includes('secret QID'));
  const restored = restoreDesktop(saved, viewport);
  const r = restored.windows[0].rect;
  assert.ok(r.x + r.width <= 1440 && r.y >= 100);
  assert.deepEqual(
    restoreDesktop('{bad', viewport),
    createDesktopState(viewport),
  );
  const malicious = JSON.stringify({
    version: 1,
    focused: 'evil',
    windows: [{ appId: 'evil', open: true, rect: { x: NaN } }],
  });
  assert.equal(
    restoreDesktop(malicious, viewport).windows.length,
    NEIGHBOR_APPS.length,
  );
  focusApp(restored, 'unknown');
  assert.ok(
    restored.windows.every((w) =>
      NEIGHBOR_APPS.some((a) => a.appId === w.appId),
    ),
  );
});

test('moving a snapped window restores safely and app commands never resolve arbitrary handlers', () => {
  const s = createDesktopState(viewport);
  setWindowMode(s, 'records', 'right');
  moveWindow(s, 'records', -10000, 10000);
  const r = s.windows[0].rect;
  assert.equal(s.windows[0].mode, 'normal');
  assert.ok(r.x >= 0 && r.y + r.height <= viewport.height);
  assert.deepEqual(resolveCommand('app.board.open'), {
    type: 'open',
    appId: 'board',
  });
  assert.equal(resolveCommand('escrow.transact'), undefined);
  assert.equal(resolveCommand('__proto__'), undefined);
});

test('small screen and legacy split desks preserve floating geometry and migrate to desktop', () => {
  const s = createDesktopState(viewport),
    original = { ...s.windows[0].rect };
  fitDesktop(s, { width: 390, height: 844 });
  fitDesktop(s, viewport);
  assert.deepEqual(s.windows[0].rect, original);
  s.presentation = 'split';
  s.splitRatio = 0.4;
  const r = windowRect(s, s.windows[0]);
  assert.deepEqual(r, original);
  const persisted = JSON.parse(serializeDesktop(s));
  assert.equal(persisted.version, 2);
  assert.equal(
    restoreDesktop(JSON.stringify(persisted), viewport).presentation,
    'desktop',
  );
  const old = restoreDesktop(
    JSON.stringify({ ...persisted, version: 1 }),
    viewport,
  );
  assert.equal(old.presentation, 'desktop');
});

test('a first mobile launch retains usable floating sizes for a later desktop', () => {
  const s = createDesktopState({ width: 390, height: 844 });
  const original = { ...s.windows[0].rect };
  assert.ok(original.width > 390);
  fitDesktop(s, viewport);
  assert.deepEqual(windowRect(s, s.windows[0]), original);
});
