import { t, msg } from '../i18n/index.js';
import { NEIGHBOR_APPS, resolveCapabilitiesForObject } from './registry.js';
export const GLOBAL_ACTIONS = Object.freeze([
  {
    id: 'record.create',
    title: msg('Create a need or task'),
    appId: 'records',
  },
  { id: 'place.save', title: msg('Save this place'), appId: 'records' },
  { id: 'project.create', title: msg('Create a project'), appId: 'projects' },
  {
    id: 'document.import',
    title: msg('Import a document'),
    appId: 'documents',
  },
  {
    id: 'evidence.open',
    title: msg('Preserve and review evidence'),
    appId: 'evidence',
  },
  { id: 'desk.open', title: msg('Save or restore a desk'), appId: 'desks' },
  {
    id: 'recovery.open',
    title: msg('Recover drafts and pending saves'),
    appId: 'recovery',
  },
]);
export function searchDesktop(query, records = [], openAppIds = null) {
  const term = String(query || '')
    .trim()
    .toLowerCase();
  const matches = (title, extra = '') =>
    !term ||
    title.toLowerCase().includes(term) ||
    extra.toLowerCase().includes(term);
  const openSet =
    openAppIds instanceof Set ? openAppIds : new Set(openAppIds || []);
  const matchedApps = NEIGHBOR_APPS.filter((a) => matches(a.name, a.appId)).map(
    (a) => ({
      type: 'app',
      id: a.appId,
      title: a.name,
      kind: openSet.has(a.appId) ? 'running' : 'app',
      open: openSet.has(a.appId),
    }),
  );
  if (openSet.size > 0 && !term) {
    matchedApps.sort((a, b) => Number(b.open) - Number(a.open));
  }
  return [
    {
      title: t('Apps'),
      items: matchedApps,
    },
    {
      title: t('Actions'),
      items: GLOBAL_ACTIONS.filter((a) => matches(t(a.title), a.appId)).map(
        (a) => ({
          ...a,
          type: 'action',
          kind: a.appId,
        }),
      ),
    },
    {
      title: t('Records'),
      items: term
        ? records
            .filter((r) => matches(r.title, r.kind || ''))
            .slice(0, 30)
            .map((r) => ({ ...r, type: 'record' }))
        : [],
    },
  ];
}
export const HANDOFF_ACTIONS = Object.freeze({
  projects: [
    'new-project-at-place',
    'attach-offer',
    'inspect-project',
    'inspect-object',
  ],
  marketplace: [
    'source-bom',
    'filter-by-place',
    'inspect-object',
    'inspect-product',
  ],
  social: ['share-object', 'inspect-object'],
  agent: ['prompt-with-context'],
  records: ['inspect-object', 'inspect'],
  board: ['inspect-tasks', 'inspect-object'],
  documents: ['inspect-object'],
  evidence: ['inspect-object'],
  history: ['inspect-object', 'inspect'],
});
export function actionHandoff(actionId, selection) {
  const allowed = resolveCapabilitiesForObject({
    ...selection,
    ...selection.payload,
  }).some((a) => a.actionId === actionId);
  if (!allowed) return null;
  const s = selection,
    p = {
      objectId: s.id,
      productId: s.id,
      placeId: s.kind === 'place' ? s.id : s.placeId,
      title: s.title,
      placeTitle: s.title,
      coordinates: s.coordinates,
      sharedObjectId: s.id,
      sharedObjectKind: s.kind,
    };
  const map = {
    'projects.startFromObject': ['projects', 'new-project-at-place'],
    'marketplace.sourceForObject': ['marketplace', 'filter-by-place'],
    'marketplace.exploreProduct': ['marketplace', 'inspect-product'],
    'agent.planFromObject': ['agent', 'prompt-with-context'],
    'social.shareObjectCard': ['social', 'share-object'],
    'history.inspectRevisions': ['history', 'inspect-object'],
    'marketplace.commitProposal': ['marketplace', 'inspect-object'],
    'marketplace.verifyOutcome': ['marketplace', 'inspect-object'],
  };
  const binding = map[actionId];
  return binding
    ? {
        targetApp: binding[0],
        action: binding[1],
        reference: { id: s.id, revision: s.revision },
        payload: p,
      }
    : null;
}
