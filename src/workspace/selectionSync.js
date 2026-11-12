/** Synchronize authorized selections without native reads or repeated per-app lookup. */
export function prepareWorkspaceSelection(
  appId,
  context,
  record,
  evidenceNetwork,
) {
  context.selected = record.id;
  if (appId === 'marketplace') {
    if (record.payload?.kind === 'market-product') {
      context.tab = 'products';
      context.selectedProductId = record.payload.productId || record.id;
    } else {
      context.tab = ['proposal', 'commitment'].includes(record.payload?.kind)
        ? 'proposals'
        : 'offers';
      context.selectedOfferId = record.id;
    }
  }
  if (appId === 'evidence') {
    context.evidenceTab = evidenceNetwork?.claims?.some(
      (r) => r.id === record.id,
    )
      ? 'claims'
      : evidenceNetwork?.casebooks?.some((r) => r.id === record.id)
        ? 'casebooks'
        : 'artifacts';
  }
}

export function synchronizeWorkspaceSelection({
  bus,
  contexts,
  findAuthorized,
  select,
  invalidate,
}) {
  const resolved = new Map();
  let changed = false;
  for (const [appId, context] of contexts) {
    const selection = bus.effectiveSelectionFor(appId);
    if (!selection || context.selected === selection.id) continue;
    if (!resolved.has(selection.id))
      resolved.set(selection.id, findAuthorized(selection.id));
    const record = resolved.get(selection.id);
    if (!record) continue;
    select(appId, record);
    invalidate(appId);
    changed = true;
  }
  return changed;
}
