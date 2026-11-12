import {
  setRenderSurfaceHidden,
  governorRequestRender,
  getRenderGovernorDiagnostics,
} from '../renderGovernor.js';
/** Exact clipped union area; overlapping opaque windows must never count twice. */
export function coveredFraction(bounds, rects) {
  const clipped = rects
    .map((r) => ({
      x: Math.max(bounds.x, r.x),
      y: Math.max(bounds.y, r.y),
      right: Math.min(bounds.x + bounds.width, r.x + r.width),
      bottom: Math.min(bounds.y + bounds.height, r.y + r.height),
    }))
    .filter((r) => r.right > r.x && r.bottom > r.y);
  const xs = [...new Set(clipped.flatMap((r) => [r.x, r.right]))].sort(
    (a, b) => a - b,
  );
  let area = 0;
  for (let i = 1; i < xs.length; i++) {
    const spans = clipped
      .filter((r) => r.x < xs[i] && r.right > xs[i - 1])
      .map((r) => [r.y, r.bottom])
      .sort((a, b) => a[0] - b[0]);
    let start = 0,
      end = 0,
      total = 0;
    for (const [a, b] of spans) {
      if (a > end) {
        total += end - start;
        start = a;
        end = b;
      } else end = Math.max(end, b);
    }
    total += end - start;
    area += (xs[i] - xs[i - 1]) * total;
  }
  return Math.min(1, area / Math.max(1, bounds.width * bounds.height));
}
export function createWorldPresentation(viewer) {
  const container = viewer?.container,
    credits = document.getElementById('cesium-credits'),
    overlay = document.getElementById('world-overlay-root');
  const originals = [container, credits, overlay].map((node) => [
    node,
    node?.getAttribute('style'),
  ]);
  const diagnostic = new URLSearchParams(window.location.search).has(
    'desktopDiagnostics',
  );
  let renderedFrames = 0,
    resizeCount = 0,
    renderRequests = 0;
  let disposed = false,
    frame = 0,
    timer,
    covered = false,
    visibility;
  const removeFrame = diagnostic
    ? viewer?.scene?.postRender?.addEventListener(() => {
        renderedFrames++;
      })
    : undefined;
  const sample = () => {
    if (container && diagnostic)
      Object.assign(container.dataset, {
        renderFrames: String(renderedFrames),
        renderSuspended: String(getRenderGovernorDiagnostics().suspended),
        canvasResizes: String(resizeCount),
        canvasRenderRequests: String(renderRequests),
      });
  };
  const sampleTimer = diagnostic ? setInterval(sample, 500) : undefined;
  const requestFrame = () => {
    renderRequests++;
    governorRequestRender('desktop-canvas');
  };
  // Only changes to the canvas itself resize Cesium. Window motion is DOM-only.
  const scheduleResize = () => {
    if (disposed || frame) return;
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      if (disposed) return;
      viewer?.resize?.();
      resizeCount++;
      requestFrame();
    });
  };
  const observer =
    typeof ResizeObserver === 'function' && container
      ? new ResizeObserver(scheduleResize)
      : undefined;
  observer?.observe(container);
  const documentVisibility = () => {
    setRenderSurfaceHidden('document', document.visibilityState === 'hidden');
  };
  document.addEventListener('visibilitychange', documentVisibility);
  documentVisibility();
  sample();
  return {
    update({ mode, windows }) {
      if (disposed || !container) return;
      const hidden = mode === 'focus' && windows.length > 0;
      const nextVisibility = hidden ? 'hidden' : 'visible';
      if (visibility !== nextVisibility) {
        const initial = visibility === undefined;
        visibility = nextVisibility;
        Object.assign(container.style, {
          left: '0',
          top: '0',
          width: '100%',
          height: '100%',
          right: 'auto',
          bottom: 'auto',
          visibility,
        });
        if (overlay)
          Object.assign(overlay.style, {
            left: '0',
            top: '0',
            width: '100%',
            height: '100%',
            right: 'auto',
            bottom: 'auto',
            visibility,
          });
        if (credits)
          Object.assign(credits.style, {
            left: '12px',
            bottom: '4px',
            maxWidth: 'calc(100% - 24px)',
            zIndex: '12001',
          });
        if (initial) scheduleResize();
        else if (!hidden) requestFrame();
      }
      // A visible strip is still a visible world. Never suspend at 90% coverage.
      const next =
        hidden ||
        coveredFraction(
          { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight },
          windows,
        ) === 1;
      if (next !== covered) {
        covered = next;
        clearTimeout(timer);
        if (covered)
          timer = setTimeout(() => {
            if (!disposed && covered) setRenderSurfaceHidden('desktop', true);
          }, 3000);
        else setRenderSurfaceHidden('desktop', false);
      }
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      clearTimeout(timer);
      clearInterval(sampleTimer);
      if (frame) window.cancelAnimationFrame(frame);
      observer?.disconnect();
      removeFrame?.();
      if (container)
        for (const key of [
          'renderFrames',
          'renderSuspended',
          'canvasResizes',
          'canvasRenderRequests',
        ])
          delete container.dataset[key];
      setRenderSurfaceHidden('desktop', false);
      setRenderSurfaceHidden('document', false);
      document.removeEventListener('visibilitychange', documentVisibility);
      for (const [node, original] of originals)
        if (node) {
          if (original === null) node.removeAttribute('style');
          else node.setAttribute('style', original);
        }
      viewer?.resize?.();
    },
  };
}
