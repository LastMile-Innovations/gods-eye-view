import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorldPresentation } from './worldPresentation.js';
import {
  installRenderGovernor,
  getRenderGovernorDiagnostics,
  _resetRenderGovernorForTest,
} from '../renderGovernor.js';

function fixture(t, hidden = false) {
  const saved = {
    document: globalThis.document,
    window: globalThis.window,
    ResizeObserver: globalThis.ResizeObserver,
  };
  const node = () => ({
    style: {},
    dataset: {},
    getAttribute: () => null,
    removeAttribute() {},
    setAttribute() {},
  });
  const container = node(),
    credits = node(),
    overlay = node();
  let resized = 0,
    rendered = 0,
    scheduled,
    disconnected = false;
  const listeners = new Map();
  globalThis.document = {
    visibilityState: hidden ? 'hidden' : 'visible',
    getElementById: (id) => (id === 'cesium-credits' ? credits : overlay),
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name) => listeners.delete(name),
  };
  globalThis.window = {
    location: { search: '' },
    innerWidth: 1440,
    innerHeight: 900,
    requestAnimationFrame: (fn) => {
      scheduled = fn;
      return 1;
    },
    cancelAnimationFrame: () => {
      scheduled = undefined;
    },
  };
  globalThis.ResizeObserver = class {
    constructor(fn) {
      this.notify = fn;
      fixture.observer = this;
    }
    observe() {}
    disconnect() {
      disconnected = true;
    }
  };
  const viewer = {
    container,
    useDefaultRenderLoop: true,
    resize: () => resized++,
    scene: { requestRender: () => rendered++ },
  };
  installRenderGovernor(viewer);
  const presentation = createWorldPresentation(viewer);
  t.after(() => {
    presentation.destroy();
    _resetRenderGovernorForTest();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  });
  return {
    presentation,
    viewer,
    container,
    listeners,
    counts: () => ({ resized, rendered }),
    flush: () => {
      const fn = scheduled;
      scheduled = undefined;
      fn?.();
    },
    disconnected: () => disconnected,
  };
}
const desktop = {
  mode: 'desktop',
  bounds: { x: 16, y: 104, width: 1408, height: 708 },
  windows: [],
};

test('floating UI changes do not resize or repaint the unchanged full canvas', (t) => {
  const f = fixture(t);
  f.presentation.update(desktop);
  f.flush();
  const initial = f.counts();
  for (let x = 0; x < 100; x++)
    f.presentation.update({
      ...desktop,
      windows: [{ x, y: 120, width: 600, height: 500 }],
    });
  f.flush();
  assert.deepEqual(f.counts(), initial);
  assert.equal(f.container.style.width, '100%');
});
test('actual canvas resizes coalesce into one resize and render request', (t) => {
  const f = fixture(t);
  f.presentation.update(desktop);
  f.flush();
  const initial = f.counts();
  for (let i = 0; i < 20; i++) fixture.observer.notify();
  f.flush();
  assert.deepEqual(f.counts(), {
    resized: initial.resized + 1,
    rendered: initial.rendered + 1,
  });
  f.presentation.destroy();
  assert.equal(f.disconnected(), true);
});
test('mounting in an already hidden page suspends immediately and visibility resumes', (t) => {
  const f = fixture(t, true);
  assert.equal(f.viewer.useDefaultRenderLoop, false);
  assert.equal(getRenderGovernorDiagnostics().suspended, true);
  document.visibilityState = 'visible';
  f.listeners.get('visibilitychange')();
  assert.equal(f.viewer.useDefaultRenderLoop, true);
});
test('no active app leaves the world visible even when Focus is preferred', (t) => {
  const f = fixture(t);
  f.presentation.update({ ...desktop, mode: 'focus' });
  assert.equal(f.container.style.visibility, 'visible');
});

test('visible canvas margins keep rendering; Focus suspends after grace and reveal resumes', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t);
  f.presentation.update({ ...desktop, windows: [desktop.bounds] });
  t.mock.timers.tick(3100);
  assert.equal(f.viewer.useDefaultRenderLoop, true);
  f.presentation.update({
    ...desktop,
    mode: 'focus',
    windows: [desktop.bounds],
  });
  t.mock.timers.tick(2999);
  assert.equal(f.viewer.useDefaultRenderLoop, true);
  t.mock.timers.tick(1);
  assert.equal(f.viewer.useDefaultRenderLoop, false);
  f.presentation.update(desktop);
  assert.equal(f.viewer.useDefaultRenderLoop, true);
});
