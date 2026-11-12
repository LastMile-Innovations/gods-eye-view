import { HANDOFF_ACTIONS } from './desktopCommands.js';
/**
 * NeighborOS Capability Bus, SelectionBus, Window Context Mode synchronization,
 * and ExactMoney integer minor-unit formatting/parsing helpers.
 */

export const CONTEXT_MODES = Object.freeze([
  'independent',
  'follow-world',
  'linked',
]);
export const LINK_GROUPS = Object.freeze(['A', 'B', 'C']);

/**
 * Formats an ExactMoney object `{ amountMinorUnits, currency }` or integer minor units
 * into a human-readable currency string without floating-point drift.
 */
export function formatExactMoney(money, fallbackCurrency = 'USD') {
  const minor =
    typeof money === 'number'
      ? Math.trunc(money)
      : typeof money?.amountMinorUnits === 'number'
        ? Math.trunc(money.amountMinorUnits)
        : 0;
  const currency =
    typeof money?.currency === 'string' && money.currency.length === 3
      ? money.currency.toUpperCase()
      : fallbackCurrency;
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100);
  const cents = String(abs % 100).padStart(2, '0');
  const symbol = currency === 'USD' ? '$' : `${currency} `;
  return `${sign}${symbol}${whole.toLocaleString('en-US')}.${cents}`;
}

/**
 * Parses a human-entered dollar/major-unit string (e.g. "1,450.50" or "480")
 * into an ExactMoney object `{ amountMinorUnits: i64, currency: "USD" }` using
 * exact integer string splitting (zero IEEE-754 float math).
 */
export function parseExactMoneyInput(raw, currency = 'USD') {
  const cleaned = String(raw ?? '')
    .replaceAll(',', '')
    .replaceAll('$', '')
    .trim();
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const [wholePart, fracPart = ''] = cleaned.split('.');
  const whole = Number.parseInt(wholePart, 10);
  const cents = Number.parseInt(fracPart.padEnd(2, '0').slice(0, 2), 10);
  if (!Number.isSafeInteger(whole) || !Number.isSafeInteger(cents)) return null;
  const amountMinorUnits = whole * 100 + cents;
  if (amountMinorUnits < 0 || amountMinorUnits > 100_000_000_000) return null;
  return {
    amountMinorUnits,
    currency: String(currency || 'USD')
      .toUpperCase()
      .slice(0, 3),
  };
}

export function createCapabilityBus({
  onOpenApp = () => {},
  onFlyTo = () => {},
  getOriginApp = () => undefined,
} = {}) {
  let worldSelection = null;
  const groupSelections = new Map([
    ['A', null],
    ['B', null],
    ['C', null],
  ]);
  const windowModes = new Map();
  const pendingHandoffs = new Map();
  const listeners = new Set();
  const privateSelections = new Map();
  let resolveReference;

  function getWindowContext(appId) {
    if (!windowModes.has(appId)) {
      const defaultFollow = [
        'records',
        'marketplace',
        'projects',
        'evidence',
      ].includes(appId);
      windowModes.set(appId, {
        contextMode: defaultFollow ? 'follow-world' : 'independent',
        linkGroup: 'A',
      });
    }
    return windowModes.get(appId);
  }

  function setWindowContext(appId, { contextMode, linkGroup } = {}) {
    const current = getWindowContext(appId);
    const next = {
      contextMode: CONTEXT_MODES.includes(contextMode)
        ? contextMode
        : current.contextMode,
      linkGroup: LINK_GROUPS.includes(linkGroup)
        ? linkGroup
        : current.linkGroup,
    };
    windowModes.set(appId, next);
    notify({ type: 'window-context', appId, ...next });
    return next;
  }

  function cycleWindowContext(appId) {
    const current = getWindowContext(appId);
    if (current.contextMode === 'follow-world') {
      return setWindowContext(appId, {
        contextMode: 'linked',
        linkGroup: 'A',
      });
    }
    if (current.contextMode === 'linked') {
      return setWindowContext(appId, {
        contextMode: 'independent',
        linkGroup: current.linkGroup,
      });
    }
    return setWindowContext(appId, {
      contextMode: 'follow-world',
      linkGroup: current.linkGroup,
    });
  }

  function effectiveSelectionFor(appId) {
    const { contextMode, linkGroup } = getWindowContext(appId);
    if (contextMode === 'follow-world') return worldSelection;
    if (contextMode === 'linked') return groupSelections.get(linkGroup) || null;
    return privateSelections.get(appId) || null;
  }

  function selectObject(selection, { flyTo = false } = {}) {
    if (!selection || !selection.id) {
      worldSelection = null;
      notify({ type: 'selection', selection: null });
      return;
    }
    const normalized = {
      id: String(selection.id),
      revision: selection.revision,
      kind: String(selection.kind || 'record'),
      title: String(selection.title || selection.id),
      coordinates: Array.isArray(selection.coordinates)
        ? selection.coordinates.slice(0, 2)
        : null,
      placeId: selection.placeId || null,
      sourceApp: selection.sourceApp || 'world',
      payload: selection.payload || null,
      at: Date.now(),
    };
    if (normalized.sourceApp === 'world') {
      worldSelection = normalized;
    } else {
      privateSelections.set(normalized.sourceApp, normalized);
      const mode = getWindowContext(normalized.sourceApp);
      if (mode.contextMode === 'follow-world') {
        worldSelection = normalized;
      } else if (mode.contextMode === 'linked') {
        groupSelections.set(mode.linkGroup, normalized);
      }
    }
    if (
      flyTo &&
      Array.isArray(normalized.coordinates) &&
      normalized.coordinates.length === 2 &&
      normalized.coordinates.every(Number.isFinite)
    ) {
      onFlyTo(normalized.coordinates, normalized);
    }
    notify({ type: 'selection', selection: normalized });
  }

  function handoff({ targetApp, action, payload = {}, reference, originApp }) {
    if (!HANDOFF_ACTIONS[targetApp]?.includes(action)) {
      notify({ type: 'handoff-error', message: 'This action is unavailable.' });
      return false;
    }
    const referenceId =
      reference?.id ||
      payload.objectId ||
      payload.sharedObjectId ||
      payload.offerId ||
      payload.projectId ||
      payload.placeId ||
      payload.id;
    if (!reference && referenceId) reference = { id: referenceId };
    const resolved = reference && resolveReference?.(reference);
    if (reference && resolveReference && !resolved) {
      notify({ type: 'handoff-error', message: 'This record is unavailable.' });
      return false;
    }
    if (resolved && reference.revision === undefined)
      reference = { id: resolved.id, revision: resolved.revision };
    originApp ||= getOriginApp();
    const item = {
      targetApp,
      action,
      payload: structuredClone(payload),
      reference: reference
        ? { id: reference.id, revision: reference.revision }
        : undefined,
      originApp,
      originContext: originApp ? { ...getWindowContext(originApp) } : undefined,
      at: Date.now(),
    };
    pendingHandoffs.set(targetApp, item);
    onOpenApp(targetApp);
    notify({ type: 'handoff', ...item });
    return true;
  }

  function consumeHandoff(appId) {
    const item = pendingHandoffs.get(appId) || null;
    pendingHandoffs.delete(appId);
    if (
      item?.reference &&
      resolveReference &&
      !resolveReference(item.reference)
    ) {
      notify({
        type: 'handoff-error',
        message:
          'This record changed or is unavailable. Open its current version and try again.',
      });
      return null;
    }
    return item;
  }

  function peekHandoff(appId) {
    return pendingHandoffs.get(appId) || null;
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function notify(event) {
    for (const fn of listeners) {
      try {
        fn(event);
      } catch {
        /* listener isolation */
      }
    }
  }

  return {
    setResolver: (fn) => {
      resolveReference = fn;
    },
    reset() {
      worldSelection = null;
      groupSelections.forEach((_, k) => groupSelections.set(k, null));
      privateSelections.clear();
      pendingHandoffs.clear();
      windowModes.clear();
    },
    getWorldSelection: () => worldSelection,
    getWindowContext,
    setWindowContext,
    cycleWindowContext,
    effectiveSelectionFor,
    selectObject,
    handoff,
    consumeHandoff,
    peekHandoff,
    subscribe,
  };
}
