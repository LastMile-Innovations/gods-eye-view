import { t } from '../i18n/index.js';
import { createWorkspaceSynchronizer } from './workspaceSync.js';
/** Rebuildable lookup of the current authorized projections; no independent store.
 * Callers replace projection arrays on refresh. Old identities disappear on the
 * next lookup; unchanged projections do not allocate/scan once per app selection.
 */
export function createWorkspaceRecordLookup(catalog = []) {
  const publicRecords = new Map();
  for (const product of catalog) {
    publicRecords.set(product.id, {
      id: product.id,
      payload: {
        kind: 'market-product',
        productId: product.id,
        title: product.title,
        brand: product.brand,
        category: product.category,
      },
    });
    for (const offer of product.offers || [])
      publicRecords.set(offer.id, {
        id: offer.id,
        payload: {
          kind: 'market-product',
          productId: product.id,
          title: `${product.title} (${offer.sellerName})`,
          coordinates: offer.coordinates,
          brand: product.brand,
          category: product.category,
        },
      });
  }
  let previous = [],
    records = new Map();
  return {
    find(id, { snapshot, domainNetwork, evidenceNetwork, workflows } = {}) {
      const lists = [
        snapshot?.items,
        domainNetwork?.projects,
        domainNetwork?.offers,
        domainNetwork?.proposals,
        domainNetwork?.commitments,
        evidenceNetwork?.artifacts,
        evidenceNetwork?.claims,
        evidenceNetwork?.casebooks,
        workflows,
      ];
      if (
        lists.length !== previous.length ||
        lists.some((list, i) => list !== previous[i])
      ) {
        records = new Map();
        for (const list of lists)
          for (const record of list || []) {
            if (record?.id && !records.has(record.id))
              records.set(record.id, record);
          }
        previous = lists;
      }
      return records.get(id) || publicRecords.get(id);
    },
    clear() {
      records.clear();
      previous = [];
    },
  };
}
/** Authorized projections only. No browser persistence or independent canonical writes. */
export async function readWorkspaceProjection(api, signal) {
  return createWorkspaceSynchronizer(api).read(signal);
}
export function searchableRecords({
  snapshot,
  domainNetwork,
  evidenceNetwork,
} = {}) {
  const rows = [
    ...(snapshot?.items || []),
    ...(domainNetwork?.projects || []),
    ...(domainNetwork?.offers || []),
    ...(domainNetwork?.proposals || []),
    ...(domainNetwork?.commitments || []),
    ...(evidenceNetwork?.artifacts || []),
    ...(evidenceNetwork?.claims || []),
    ...(evidenceNetwork?.casebooks || []),
  ];
  const seen = new Set();
  return rows
    .filter((r) => r?.id && !seen.has(r.id) && seen.add(r.id))
    .map((r) => ({
      id: r.id,
      title: r.payload?.title || r.payload?.text || t('Untitled record'),
      kind: r.payload?.kind || 'evidence',
      revision: r.revision,
    }));
}
