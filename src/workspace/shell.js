import { restoreWorkspaceSession } from './hostedSession.js';
import {
  element as node,
  button,
  field,
  emptyState,
  propertyGrid,
} from './ui.js';
import { createDraftController } from './draftController.js';
import { createAppLifecycles } from './appLifecycle.js';
import {
  searchableRecords,
  createWorkspaceRecordLookup,
} from './workspaceData.js';
import {
  synchronizeWorkspaceSelection,
  prepareWorkspaceSelection,
} from './selectionSync.js';
import { t } from '../i18n/index.js';
import * as Cesium from 'cesium';
import { createWorkspaceClient } from './client.js';
import { createWorkspaceSynchronizer } from './workspaceSync.js';
import { createChangeInboxController } from './changeInbox.js';
import './workspace.css';
import { mountNeighborDesktop } from './desktop.js';
import { NEIGHBOR_APPS } from './registry.js';
import { renderLifecycleView } from './lifecycleViews.js';
import { renderCitizenEvidence } from './citizenEvidence.js';
import { createCapabilityBus } from './capabilityBus.js';
import { createWorldContextSurface } from './worldContextSurface.js';
import { renderMarketplaceApp } from './marketplaceApp.js';
import { renderProjectsApp } from './projectsApp.js';
import { renderSocialMessagesApp } from './socialMessagesApp.js';
import { renderAgentApp } from './agentApp.js';
import { CANONICAL_PRODUCTS } from './marketCatalog.js';
const kinds = ['need', 'mission', 'task', 'place'];
const key = () => crypto.randomUUID().replaceAll('-', '');
const errors = {
  DRAFT_UNSAVED: 'Save or recover the draft before submitting.',
  UNAUTHENTICATED: 'Connecting to your workspace…',
  NATIVE_UNAVAILABLE:
    'Quanta storage is unavailable. Run npm run workspace:build, then restart the local server.',
  CONFLICT:
    'This record changed. Refresh and review its current revision before trying again.',
  NOT_AVAILABLE: 'This resource is unavailable or no longer accessible.',
  INVALID: 'Check the fields and permissions before saving.',
  RESOURCE_LIMIT:
    'This exceeds the local workspace limit. Text imports must be at most 1 MiB.',
  UNKNOWN_OUTCOME:
    'The result is uncertain. Retry the same command to reconcile it; do not create another copy.',
  RATE_LIMITED: 'The workspace is busy. Try the same command again shortly.',
};

/** One shell/viewer; selection and rendered rows are projections of native state. */
export function mountNeighborWorkspace({ application, viewer, lifetime }) {
  if (lifetime?.aborted) return { refresh() {}, destroy() {} };
  const previousTitle = document.title;
  document.title = 'NeighborOS · My world'; // i18n-ignore: product title
  const api = createWorkspaceClient();
  const synchronizer = createWorkspaceSynchronizer(api);
  const changeInbox = createChangeInboxController({
    api,
    refresh,
    onChange: () => {
      if (connected && !disposed) render();
    },
  });
  let lastProjection,
    appliedProjection,
    refreshCount = 0;
  const recordLookup = createWorkspaceRecordLookup(CANONICAL_PRODUCTS);
  let operations, desks, evidenceNetwork, domainNetwork;
  const hasUnresolved = () =>
    Boolean(pending) ||
    !operations ||
    operations.items.some((op) => op.state === 'pending');
  let snapshot,
    connected = false,
    authMode,
    busy = false,
    generation = 0,
    pending;
  const contexts = new Map(
    NEIGHBOR_APPS.map((app) => [
      app.appId,
      { selected: undefined, query: '', view: app.view },
    ]),
  );
  let hosts, drafts;
  let desktop,
    pendingContext,
    disposed = false;
  const flyGlobeTo = (coordinates) => {
    if (
      !Array.isArray(coordinates) ||
      coordinates.length < 2 ||
      !coordinates.every(Number.isFinite)
    )
      return;
    viewer.camera?.flyTo?.({
      destination: Cesium.Cartesian3.fromDegrees(
        coordinates[0],
        coordinates[1],
        22000,
      ),
      duration: matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 0
        : 1.1,
    });
  };
  const bus = createCapabilityBus({
    getOriginApp: () => desktop?.activeApp(),
    onOpenApp: (appId) => {
      desktop?.open(appId);
      hosts?.invalidate(appId);
      render();
    },
    onFlyTo: (coordinates) => flyGlobeTo(coordinates),
  });
  const worldSurface = createWorldContextSurface({
    bus,
    onOpenApp: (appId) => {
      desktop?.open(appId);
      hosts?.invalidate(appId);
      render();
    },
    onFlyTo: (coordinates) => flyGlobeTo(coordinates),
  });
  const activeContext = () =>
    contexts.get(desktop?.activeApp()) || contexts.get('records');
  let readAbort = new AbortController();
  const markers = new Map();
  const root = node('section', {
    className: 'nw-shell',
    'aria-label': 'NeighborOS workspace',
  });
  const status = node('p', {
    className: 'nw-status',
    role: 'status',
    'aria-live': 'polite',
    text: 'Connecting to local storage…',
  });
  const header = node('header', { className: 'nw-header' });
  const content = node('div', { className: 'nd-windows' });
  const onboarding = node('div', { className: 'nd-onboarding' });
  const compose = node('dialog', {
    className: 'nw-dialog',
    'aria-label': 'Create workspace record',
  });
  compose.addEventListener('close', () => {
    delete compose.dataset.draftForm;
    delete compose.dataset.draftRefs;
  });
  root.append(
    header,
    status,
    worldSurface.element,
    content,
    onboarding,
    compose,
  );
  document.body.append(root);
  document.body.classList.add('neighbor-ready');
  root.addEventListener('keydown', (event) => event.stopPropagation());
  const draftStatus = node('span', {
    className: 'nw-draft-status',
    role: 'status',
  });
  const recoveries = node('aside', {
    className: 'nw-draft-recovery',
    'aria-label': 'Draft recovery',
  });
  root.append(recoveries);
  drafts = createDraftController({
    root,
    api,
    onSessionLost: (error) => report(error),
    isConnected: () => connected && !disposed,
    onStatus: (message) => {
      draftStatus.textContent = message;
      if (
        message.toLowerCase().includes('recover') ||
        message.toLowerCase().includes('conflict')
      )
        queueMicrotask(() => {
          if (!disposed) render();
        });
    },
    onRecover: (entry) => {
      const parts = entry.formId.split(':');
      const context = contexts.get(entry.appId);
      if (!context) return false;
      for (const reference of entry.references || []) {
        const current = findAuthorized(reference.id);
        if (!current || current.revision !== reference.revision) {
          report(new Error('CONFLICT'));
          return false;
        }
      }
      if (entry.references?.length) context.selected = entry.references[0].id;
      if (entry.appId === 'agent' && parts[1].startsWith('workflow-')) {
        context.tab = 'workflows';
        context.editWorkflowId =
          parts[1] === 'workflow-new' ? undefined : parts[1].slice(9);
        desktop.open('agent');
        hosts.invalidate('agent');
        render();
        return;
      }
      if (entry.appId === 'evidence' && parts[1] !== 'main') {
        context.recoverForm = entry.formId;
        desktop.open('evidence');
        hosts.invalidate('evidence');
        render();
      } else if (parts[1].startsWith('record-')) {
        desktop.open(entry.appId);
        makeRecord(parts[1].slice(7), context);
      } else {
        context.tab = parts[1] === 'main' ? undefined : parts[1];
        desktop.open(entry.appId);
        hosts.invalidate(entry.appId);
        render();
      }
      recoveries.replaceChildren();
    },
  });
  hosts = createAppLifecycles({ drafts });
  function show(message, bad = false) {
    status.title = message;
    const hosted = authMode === 'hosted';
    status.textContent = /^(Saved in Quanta|Committed revision)/.test(message)
      ? hosted
        ? t('Saved')
        : t('Saved locally')
      : message === 'Saving to Quanta…'
        ? t('Saving…')
        : message;
    status.classList.toggle('nw-error', bad);
  }
  function report(error) {
    if (error.status === 401 && connected) {
      connected = false;
      clearPrivate();
      render();
    }
    show(
      errors[error.message] ||
        'The operation could not finish. Your saved records have not been replaced.',
      true,
    );
  }
  function clearPrivate() {
    generation++;
    synchronizer.clear();
    changeInbox.clear();
    lastProjection = undefined;
    appliedProjection = undefined;
    drafts?.clear();
    desktop?.clearPrivate();
    hosts?.clear();
    bus.reset();
    recordLookup.clear();
    recoveries.replaceChildren();
    draftStatus.textContent = '';
    readAbort.abort();
    readAbort = new AbortController();
    snapshot = undefined;
    operations = undefined;
    desks = undefined;
    evidenceNetwork = undefined;
    domainNetwork = undefined;
    busy = false;
    bus.selectObject(null);
    for (const [appId, context] of contexts) {
      for (const name of Object.keys(context)) delete context[name];
      Object.assign(context, {
        selected: undefined,
        query: '',
        view: NEIGHBOR_APPS.find((a) => a.appId === appId).view,
      });
    }
    compose.close();
    compose.replaceChildren();
    pending = undefined;
    pendingContext = undefined;
    for (const entity of markers.values()) viewer.entities.remove(entity);
    markers.clear();
  }
  function project() {
    const eligible = new Set();
    const addMarker = (id, coordinates, cssColor, pixelSize = 10) => {
      if (
        !Array.isArray(coordinates) ||
        coordinates.length < 2 ||
        !coordinates.every(Number.isFinite)
      )
        return;
      eligible.add(id);
      if (!markers.has(id))
        markers.set(
          id,
          viewer.entities.add({
            id: `neighbor-${id}`,
            position: Cesium.Cartesian3.fromDegrees(
              coordinates[0],
              coordinates[1],
            ),
            point: {
              pixelSize,
              color: Cesium.Color.fromCssColorString(cssColor),
              outlineColor: Cesium.Color.BLACK,
              outlineWidth: 2,
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          }),
        );
    };
    for (const item of snapshot?.items || []) {
      addMarker(item.id, item.payload?.coordinates, '#59ddd0', 10);
    }
    for (const offer of domainNetwork?.offers || []) {
      addMarker(offer.id, offer.payload?.coordinates, '#f4b860', 11);
    }
    for (const prj of domainNetwork?.projects || []) {
      addMarker(prj.id, prj.payload?.coordinates, '#7ee081', 13);
    }
    for (const prod of CANONICAL_PRODUCTS) {
      for (const off of prod.offers || []) {
        if (off.coordinates) {
          addMarker(off.id, off.coordinates, '#ffaa40', 11);
        }
      }
    }
    for (const [id, entity] of markers)
      if (!eligible.has(id)) {
        viewer.entities.remove(entity);
        markers.delete(id);
      }
    viewer.scene.requestRender();
  }
  async function refresh() {
    const current = generation;
    refreshCount++;
    try {
      const projection = await synchronizer.read(readAbort.signal);
      if (current !== generation || !projection) return false;
      if (projection === lastProjection)
        return projection === appliedProjection;
      lastProjection = projection;
      ({ snapshot, operations, desks, evidenceNetwork, domainNetwork } =
        projection);
      const next = snapshot;
      const visible = new Set(searchableRecords(projection).map((r) => r.id));
      for (const context of contexts.values())
        if (context.selected && !visible.has(context.selected))
          context.selected = undefined;
      await drafts.load(readAbort.signal);
      if (current !== generation || projection !== lastProjection) return false;
      if (
        drafts
          .recoverable()
          .some(
            (entry) =>
              entry.appId === 'agent' &&
              entry.formId.split(':')[1]?.startsWith('workflow-'),
          ) &&
        !contexts.get('agent').harness
      ) {
        const data = await api.qhStatus(readAbort.signal);
        if (current !== generation || projection !== lastProjection)
          return false;
        contexts.get('agent').harness = data;
      }
      project();
      render();
      appliedProjection = projection;
      const unresolved = operations.items.filter(
        (op) => op.state === 'pending',
      ).length;
      show(
        unresolved
          ? t('{count} saved commands need review in Activity.', {
              count: unresolved,
            })
          : `Saved in Quanta · revision ${next.sequence} · workspace`,
        Boolean(unresolved),
      );
      return true;
    } catch (error) {
      if (current !== generation || error.name === 'AbortError') return false;
      // A failed/malformed read must not turn the next unchanged response into
      // proof that unfinished auxiliary reads or restored state were applied.
      synchronizer.clear();
      lastProjection = undefined;
      if ([401, 403, 404].includes(error.status)) {
        connected = false;
        clearPrivate();
        render();
      }
      report(error);
      return false;
    } finally {
      refreshCount--;
    }
  }
  async function runChangeInbox(action) {
    if (!connected || busy || disposed) return;
    const current = generation;
    busy = true;
    render();
    try {
      await changeInbox.run(action, operations?.changeInbox);
    } catch (error) {
      if (current !== generation) return;
      if ([401, 403, 404].includes(error.status)) {
        connected = false;
        clearPrivate();
      }
      report(error);
    } finally {
      if (current === generation) {
        busy = false;
        render();
      }
    }
  }
  async function commit(rawCommand, context = activeContext()) {
    let command = rawCommand?.key ? rawCommand : { ...rawCommand, key: key() };
    let draftReference;
    if (!pending && connected && !busy) {
      const appId = [...contexts].find(([, c]) => c === context)?.[0];
      const scope = compose.open ? compose : desktop?.body(appId);
      try {
        draftReference = await drafts.submission(scope);
      } catch {
        show('Save or recover the draft before submitting.', true);
        return;
      }
      if (draftReference)
        command = {
          ...command,
          draft: { id: draftReference.id, revision: draftReference.revision },
        };
    }
    if (busy || !connected || disposed || (pending && command !== pending))
      return;
    if (
      operations?.items.some(
        (op) => op.state === 'pending' && op.key !== command.key,
      )
    )
      return;
    busy = true;
    pending = command;
    pendingContext = context;
    render();
    show('Saving to Quanta…');
    const current = generation;
    try {
      const result = await api.command(command);
      if (current !== generation) return;
      pending = undefined;
      pendingContext = undefined;
      drafts.submitted(draftReference);
      if (draftReference) {
        const appId = draftReference.formId.split(':')[0];
        const target = contexts.get(appId);
        if (command.op === 'saveProject' && !command.id) target.tab = 'list';
        if (command.op === 'saveMarketOffer' && !command.id)
          target.tab = 'offers';
        if (command.op === 'saveSocialPost' && !command.id) target.tab = 'feed';
      }
      if (['write', 'import', 'importReference'].includes(command.op))
        context.selected = result.id;
      compose.close();
      await refresh();
      show(
        `Committed revision ${result.sequence} · receipt ${result.receipt.slice(0, 12)}`,
      );
      return result;
    } catch (error) {
      if (current === generation) {
        if (error.status === 401) {
          connected = false;
          clearPrivate();
          render();
          report(error);
          return;
        }
        if (!['UNKNOWN_OUTCOME', 'NATIVE_UNAVAILABLE'].includes(error.message))
          pending = undefined;
        await refresh();
        report(error);
      }
    } finally {
      if (current === generation) {
        busy = false;
        render();
      }
    }
  }
  async function prepareCommand(factory, context) {
    context ||= activeContext();
    if (busy || hasUnresolved()) return;
    const current = generation,
      form = compose.firstElementChild;
    const controls = [
      ...form.querySelectorAll('input,select,textarea,button[type=submit]'),
    ].map((el) => [el, el.disabled]);
    for (const [el] of controls) el.disabled = true;
    let handedOff = false;
    busy = true;
    render();
    show(t('Reading original bytes…'));
    try {
      const command = await factory();
      if (current !== generation || disposed) return;
      if (!compose.open || compose.firstElementChild !== form) {
        show(t('Read cancelled. Nothing was sent.'));
        return;
      }
      busy = false;
      handedOff = true;
      await commit(command, context);
    } catch (error) {
      if (current === generation) report(error);
    } finally {
      if (current === generation) {
        if (!handedOff) {
          busy = false;
          render();
        }
        if (!busy && !hasUnresolved())
          for (const [el, disabled] of controls) el.disabled = disabled;
      }
    }
  }
  function focus(item, context = activeContext()) {
    context.selected = item.id;
    bus.selectObject({
      id: item.id,
      kind: item.payload.kind || 'record',
      revision: item.revision,
      title: item.payload.title,
      coordinates: item.payload.coordinates,
      placeId: item.payload.kind === 'place' ? item.id : null,
      sourceApp: [...contexts].find(([, c]) => c === context)?.[0] || 'records',
      payload: item.payload,
    });
    render();
    const coord = item.payload.coordinates;
    if (coord && context.view === 'globe')
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(coord[0], coord[1], 30000),
        duration: matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 0
          : 1.2,
      });
  }
  function makeRecord(kind = 'need', context = activeContext()) {
    if (busy || hasUnresolved()) return;
    compose.replaceChildren();
    compose.dataset.draftForm = `${[...contexts].find(([, c]) => c === context)?.[0] || 'records'}:record-${kind}:v1`;
    const form = node('form', { className: 'nw-form' });
    const title = node('input', {
      name: 'title',
      required: true,
      maxlength: '160',
      placeholder:
        kind === 'need'
          ? t('What do you need to accomplish?')
          : t('Give this a useful name'),
    });
    const type = node(
      'select',
      { name: 'kind' },
      ...kinds.map((k) =>
        node('option', {
          value: k,
          text: k[0].toUpperCase() + k.slice(1),
          ...(k === kind ? { selected: true } : {}),
        }),
      ),
    );
    const description = node('textarea', {
      name: 'description',
      rows: '3',
      maxlength: '10000',
      placeholder: t('Outcome, context, timing, or constraints…'),
    });
    const link = node('input', {
      type: 'checkbox',
      checked: Boolean(context.selected),
    });
    const selection = snapshot?.items.find((i) => i.id === context.selected);
    compose.dataset.draftRefs = JSON.stringify(
      selection ? [{ id: selection.id, revision: selection.revision }] : [],
    );
    const camera = viewer.camera.positionCartographic;
    const longitude = node('input', {
      name: 'longitude',
      type: 'number',
      min: '-180',
      max: '180',
      step: 'any',
      value: String(Cesium.Math.toDegrees(camera.longitude)),
    });
    const latitude = node('input', {
      name: 'latitude',
      type: 'number',
      min: '-90',
      max: '90',
      step: 'any',
      value: String(Cesium.Math.toDegrees(camera.latitude)),
    });
    form.append(
      node('h2', { text: 'Make it part of your world' }),
      field('Record type', type),
      field('Title', title),
      field('Details', description),
    );
    if (kind === 'place')
      form.append(field('Longitude', longitude), field('Latitude', latitude));
    if (selection)
      form.append(field(`Link to ${selection.payload.title}`, link));
    form.append(
      node('p', {
        className: 'nw-muted',
        text: 'Private workspace record. Saving does not publish a listing, contact anyone, or start an agent.',
      }),
      node(
        'div',
        { className: 'nw-actions' },
        button('Cancel', () => compose.close()),
        node('button', {
          type: 'submit',
          className: 'nw-primary',
          text: 'Save to workspace',
        }),
      ),
    );
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const payload = {
        kind: type.value,
        title: title.value.trim(),
        description: description.value,
        status: 'open',
        refs: selection && link.checked ? [selection.id] : [],
      };
      if (type.value === 'place') {
        payload.coordinates = [Number(longitude.value), Number(latitude.value)];
        payload.description +=
          '\nSaved camera viewpoint; coordinates are not a surveyed ground location.';
      }
      commit({ op: 'write', key: key(), payload }, context);
    });
    compose.append(form);
    drafts.restore(compose);
    compose.showModal();
    title.focus();
  }
  function importDocument(context = activeContext()) {
    delete compose.dataset.draftForm;
    const linkedId = context.selected;
    if (busy || hasUnresolved()) return;
    compose.replaceChildren();
    const file = node('input', {
      type: 'file',
      accept: '.txt,.md,text/plain,text/markdown',
      required: true,
    });
    const consent = node('input', { type: 'checkbox', required: true });
    const form = node(
      'form',
      { className: 'nw-form' },
      node('h2', { text: 'Bring in your evidence' }),
      node('p', {
        text: 'Import a UTF-8 text or Markdown file. Original bytes stay in your local Quanta store.',
      }),
      field('Text file · up to 1 MiB', file),
      field('I have permission to retain this file locally.', consent),
      node(
        'div',
        { className: 'nw-actions' },
        button('Cancel', () => compose.close()),
        node('button', {
          type: 'submit',
          className: 'nw-primary',
          text: 'Import document',
        }),
      ),
    );
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const f = file.files?.[0];
      if (!f || f.size > 1024 * 1024)
        return report(new Error('RESOURCE_LIMIT'));
      await prepareCommand(
        async () => ({
          op: 'import',
          key: key(),
          permissionConfirmed: consent.checked,
          original: new TextDecoder('utf-8', {
            fatal: true,
            ignoreBOM: true,
          }).decode(await f.arrayBuffer()),
          payload: {
            kind: 'document',
            title: f.name,
            description: 'User-selected private text document',
            status: 'open',
            refs: linkedId ? [linkedId] : [],
          },
        }),
        context,
      );
    });
    compose.append(form);
    compose.showModal();
    file.focus();
  }
  async function importReference(context = activeContext()) {
    if (busy || hasUnresolved()) return;
    compose.replaceChildren(
      node('p', { text: 'Loading the USGS last-day feed…' }),
    );
    compose.showModal();
    const current = generation;
    try {
      const data = await api.references(readAbort.signal);
      if (current !== generation) return;
      const list = node('div', { className: 'nw-reference-list' });
      for (const row of data.rows)
        list.append(
          button(
            row.title,
            () =>
              commit(
                { op: 'importReference', key: key(), eventId: row.id },
                context,
              ),
            { className: 'nw-reference-row' },
          ),
        );
      compose.replaceChildren(
        node('h2', { text: 'A source-backed world' }),
        node('p', {
          className: 'nw-muted',
          text: `${data.coverage}. Import preserves the feed bytes and selected record path. Publisher claims are not independently verified.`,
        }),
        list,
        button('Close', () => compose.close()),
      );
      if (!data.rows.length)
        list.append(
          node('p', {
            text: 'No reported events in this response. This is not proof of no earthquakes worldwide.',
          }),
        );
    } catch (error) {
      if (current === generation)
        compose.replaceChildren(
          node('p', {
            text:
              errors[error.message] ||
              'USGS is unavailable. No records were imported.',
          }),
          button('Close', () => compose.close()),
        );
    }
  }
  function inspector(item, context) {
    const p = item.payload;
    const coordText = Array.isArray(p.coordinates)
      ? `${p.coordinates[1].toFixed(4)}°, ${p.coordinates[0].toFixed(4)}°`
      : null;
    const box = node(
      'aside',
      { className: 'nw-inspector', 'aria-label': 'Selected record' },
      node(
        'div',
        { className: 'nw-card-top' },
        node('span', {
          className: 'nw-badge',
          text: `${p.kind} · ${p.status || 'open'}`,
        }),
        node('span', {
          className: 'nw-muted',
          text: `Rev ${item.revision}`,
        }),
      ),
      node('h2', { text: p.title }),
      node('p', { text: p.description || 'No details added.' }),
      propertyGrid([
        ['Kind', p.kind],
        ['Status', p.status || 'open'],
        ['Epistemic', item.epistemic],
        ['Coordinates', coordText, true],
      ]),
      node('code', { className: 'nw-qid', text: item.id }),
      node('p', {
        className: 'nw-muted',
        text: `Native revision ${item.revision} · private local workspace`,
      }),
    );
    const refs = p.refs || [];
    if (refs.length) {
      box.append(node('h3', { text: 'Connected records' }));
      for (const id of refs) {
        const linked = snapshot.items.find((i) => i.id === id);
        box.append(
          linked
            ? button(linked.payload.title, () => focus(linked, context))
            : node('p', { text: 'Linked record unavailable' }),
        );
      }
    }
    if (item.hasEvidence) {
      box.append(
        button('Inspect original evidence', async () => {
          const current = generation;
          try {
            const evidence = await api.evidence(item.id, readAbort.signal);
            if (current !== generation || context.selected !== item.id) return;
            const original = node('pre', {
              className: 'nw-original',
              text: evidence.original,
            });
            box.append(
              node('h3', { text: 'Original source bytes' }),
              node('p', {
                className: 'nw-muted',
                text: `${evidence.epistemic} · source version ${evidence.sourceVersion}\n${evidence.selector || 'Whole document'} · version not independently verified`,
              }),
              original,
            );
          } catch (error) {
            if (current === generation) report(error);
          }
        }),
      );
    } else {
      box.append(
        button(
          p.status === 'done' ? 'Reopen record' : 'Mark complete',
          () =>
            commit(
              {
                op: 'write',
                key: key(),
                id: item.id,
                expected: item.revision,
                payload: {
                  ...p,
                  status: p.status === 'done' ? 'open' : 'done',
                },
              },
              context,
            ),
          { disabled: busy || hasUnresolved() },
        ),
      );
    }
    if (Array.isArray(p.coordinates)) {
      box.append(button('Show on globe', () => flyGlobeTo(p.coordinates)));
    }
    if (p.kind === 'place') {
      box.append(
        button('Start project at place', () =>
          bus.handoff({
            targetApp: 'projects',
            action: 'new-project-at-place',
            payload: { placeId: item.id, placeTitle: p.title },
          }),
        ),
      );
    }
    box.append(
      button('Add linked task', () => makeRecord('task', context), {
        disabled: busy || hasUnresolved(),
      }),
      button('Share in Social', () =>
        bus.handoff({
          targetApp: 'social',
          action: 'share-object',
          payload: {
            sharedObjectId: item.id,
            sharedObjectKind: p.kind || 'record',
            title: p.title,
          },
        }),
      ),
      button('Inspect Quanta Role Graph', async () => {
        const current = generation;
        try {
          const graph = await api.objectGraph(item.id, readAbort.signal);
          if (current !== generation || context.selected !== item.id) return;
          const graphBox = node(
            'div',
            { className: 'nw-subpanel' },
            node('h3', {
              text: `Quanta Role Graph (${graph.totalEdges} edges)`,
            }),
          );
          for (const out of graph.outbound || []) {
            graphBox.append(
              node('p', {
                className: 'nw-muted',
                text: `→ [${out.role}] ${out.kind}: ${out.title}`,
              }),
            );
          }
          for (const inc of graph.inbound || []) {
            graphBox.append(
              node('p', {
                className: 'nw-muted',
                text: `← [${inc.role}] ${inc.kind}: ${inc.title}`,
              }),
            );
          }
          if (!graph.totalEdges) {
            graphBox.append(
              node('p', {
                className: 'nw-muted',
                text: 'No inbound or outbound role relationships yet.',
              }),
            );
          }
          box.append(graphBox);
        } catch (error) {
          if (current === generation) report(error);
        }
      }),
    );
    if (!item.hasEvidence)
      box.append(
        button(t('View record history'), () => {
          const target = contexts.get('history');
          target.selected = item.id;
          desktop.open('history');
          loadHistory(target);
        }),
      );
    box.append(node('h3', { text: t('Open in another app') }));
    for (const app of NEIGHBOR_APPS.filter(
      (app) =>
        ['globe', 'board', 'documents'].includes(app.view) &&
        app.view !== context.view,
    ))
      box.append(
        button(app.name, () => {
          const current = snapshot?.items.find((row) => row.id === item.id);
          if (!connected || !current) return;
          const target = contexts.get(app.appId);
          target.selected = current.id;
          desktop.open(app.appId);
          render();
        }),
      );
    return box;
  }
  function render() {
    header.replaceChildren(
      node(
        'div',
        { className: 'nw-brand' },
        node('strong', { text: 'NeighborOS' }),
        node('span', { text: 'WORLD / WORK / PEOPLE' }),
      ),
      desktop.menu,
      draftStatus,
      connected
        ? (() => {
            const settings = node('details', {
              className: 'nd-workspace-menu',
            });
            settings.append(
              node('summary', { text: 'Workspace' }),
              button(
                authMode === 'hosted' ? t('Sign out') : t('Disconnect'),
                async () => {
                  clearPrivate();
                  connected = false;
                  busy = false;
                  compose.close();
                  render();
                  try {
                    await api.logout();
                    show(
                      authMode === 'hosted'
                        ? t('Signed out.')
                        : t('Development workspace disconnected.'),
                    );
                  } catch (error) {
                    report(error);
                  }
                },
              ),
            );
            return settings;
          })()
        : node('span', {
            className: 'nw-connection',
            text:
              authMode === 'hosted'
                ? t('Sign in to save your work')
                : t('Development workspace'),
          }),
    );
    content.hidden = !connected;
    onboarding.hidden = connected;
    onboarding.replaceChildren();
    if (!connected) hosts.clear();
    if (!connected) {
      const panel = node(
        'div',
        { className: 'nw-panel nw-sign-in' },
        node('p', { className: 'nw-eyebrow', text: 'YOUR WORLD, CONNECTED' }),
        node('h1', {
          text:
            authMode === 'hosted'
              ? t('Your world, ready when you are')
              : t('Opening your workspace'),
        }),
        node('p', {
          text:
            authMode === 'hosted'
              ? t(
                  'Explore the world freely. Sign in to save projects, documents, and your workspace.',
                )
              : t('Your development workspace connects automatically.'),
        }),
      );
      if (authMode === 'hosted')
        panel.append(
          node('a', {
            href: '/auth/login',
            className: 'nw-primary',
            text: t('Sign in'),
          }),
        );
      else panel.append(button(t('Reconnect'), () => connect()));
      onboarding.append(panel);
      return;
    }
    const listWatermark = (arr) =>
      arr
        ? `${arr.length}:${arr[0]?.id || ''}:${arr[0]?.revision || 0}:${arr.at(-1)?.id || ''}:${arr.at(-1)?.revision || 0}`
        : '0';
    const computeAppSignature = (appId, context) => {
      const snapKey = `${snapshot?.sequence ?? -1}:${listWatermark(snapshot?.items)}`;
      const domKey = domainNetwork
        ? `${listWatermark(domainNetwork.projects)}|${listWatermark(domainNetwork.offers)}|${listWatermark(domainNetwork.proposals)}|${listWatermark(domainNetwork.commitments)}|${listWatermark(domainNetwork.socialPosts)}|${listWatermark(domainNetwork.agentPlans)}`
        : '0';
      const evKey = evidenceNetwork
        ? `${listWatermark(evidenceNetwork.artifacts)}|${listWatermark(evidenceNetwork.claims)}|${listWatermark(evidenceNetwork.casebooks)}|${listWatermark(evidenceNetwork.disclosures)}`
        : '0';
      const opsKey = `${listWatermark(operations?.items)}|${listWatermark(desks?.items)}|${JSON.stringify(operations?.changeInbox)}|${changeInbox.pending?.action || ''}|${changeInbox.recovery.state}`;
      const ctxKey = JSON.stringify(context);
      return `${appId}|${snapKey}|${domKey}|${evKey}|${opsKey}|${busy}|${hasUnresolved()}|${ctxKey}`;
    };
    for (const [appId, body] of desktop.bodies()) {
      const context = contexts.get(appId);
      const incoming = bus.peekHandoff(appId);
      if (
        incoming &&
        [
          'inspect',
          'inspect-object',
          'inspect-object',
          'inspect-project',
          'inspect-tasks',
        ].includes(incoming.action)
      ) {
        bus.consumeHandoff(appId);
        const id =
          incoming.reference?.id ||
          incoming.payload?.objectId ||
          incoming.payload?.projectId;
        const record = id && findAuthorized(id);
        if (record) {
          prepareSelection(appId, record);
          if (appId === 'history') void loadHistory(context);
        }
      }
      const signature = computeAppSignature(appId, context);
      hosts.update(appId, signature, () => {
        body.dataset.draftForm = `${appId}:${context.tab || 'main'}:v1`;
        renderApp(context, body);
      });
    }
    recoveries.replaceChildren();
    for (const entry of drafts.recoverable()) {
      const row = node(
        'div',
        { className: 'nw-recovery-row' },
        node('span', {
          text: `${NEIGHBOR_APPS.find((a) => a.appId === entry.appId)?.name || entry.appId} · draft recovery`,
        }),
        button('Recover', () => drafts.recover(entry.formId).catch(report)),
        button('Discard', async () => {
          try {
            await drafts.discard(entry.formId);
            render();
          } catch (error) {
            report(error);
          }
        }),
      );
      recoveries.append(row);
    }
  }
  async function resumeOperation(operation) {
    if (busy || (pending && pending.key !== operation.key)) return;
    busy = true;
    render();
    const current = generation;
    try {
      const result = await api.resume(operation.key);
      if (current !== generation) return;
      pending = undefined;
      pendingContext = undefined;
      await refresh();
      show(
        `Committed revision ${result.sequence} · receipt ${result.receipt.slice(0, 12)}`,
      );
    } catch (error) {
      if (current === generation) {
        if (
          !['UNKNOWN_OUTCOME', 'NATIVE_UNAVAILABLE'].includes(error.message)
        ) {
          pending = undefined;
          pendingContext = undefined;
        }
        await refresh();
        report(error);
      }
    } finally {
      if (current === generation) {
        busy = false;
        render();
      }
    }
  }
  async function loadHistory(context) {
    if (!context.selected) return;
    const current = generation,
      id = context.selected;
    try {
      const history = await api.history(id, readAbort.signal);
      if (current === generation && context.selected === id) {
        context.history = history;
        render();
      }
    } catch (error) {
      if (current === generation) {
        context.history = undefined;
        report(error);
      }
    }
  }
  async function loadWorldTime(context, query = {}) {
    const current = generation;
    try {
      const wt = await api.worldTime(query, readAbort.signal);
      if (current === generation) {
        context.worldTime = wt;
        render();
      }
    } catch (error) {
      if (current === generation) report(error);
    }
  }
  async function checkLicenseGate(context, body = {}) {
    const current = generation;
    try {
      const verdict = await api.evaluateLicenseGate(body, readAbort.signal);
      if (current === generation) {
        context.licenseVerdict = verdict;
        render();
      }
    } catch (error) {
      if (current === generation) report(error);
    }
  }
  async function loadHarness(context) {
    const current = generation;
    context.harnessLoading = true;
    render();
    try {
      const data = await api.qhStatus(readAbort.signal);
      if (current === generation) context.harness = data;
    } catch (error) {
      if (current === generation) report(error);
    } finally {
      if (current === generation) {
        context.harnessLoading = false;
        hosts.invalidate('agent');
        render();
      }
    }
  }
  async function runReadWorkflow(context, id) {
    const current = generation;
    context.harnessLoading = true;
    render();
    try {
      const result = await api.qhExecute(
        {
          operation: 'execute',
          execution: { strategy: 'workflow', interaction: 'sync' },
          workflowId: id,
        },
        readAbort.signal,
      );
      if (current === generation) context.workflowResult = result;
    } catch (error) {
      if (current === generation) report(error);
    } finally {
      if (current === generation) {
        context.harnessLoading = false;
        hosts.invalidate('agent');
        render();
      }
    }
  }
  async function sendChat(context, text) {
    if (context.chatPending || !text.trim()) return;
    const current = generation;
    const messages = [
      ...(context.chatMessages || []),
      { role: 'user', content: text },
    ];
    if (messages.length > 31 || JSON.stringify(messages).length > 60000) {
      context.chatError = t(
        'This conversation is full. Clear it to start another.',
      );
      hosts.invalidate('agent');
      render();
      return;
    }
    context.chatPending = true;
    context.chatError = undefined;
    context.chatInput = '';
    context.chatMessages = messages;
    hosts.invalidate('agent');
    render();
    try {
      const response = await api.openAiChatCompletions(
        { model: 'qh/chat', messages },
        readAbort.signal,
      );
      if (current === generation)
        context.chatMessages = [...messages, response.choices[0].message];
    } catch (error) {
      if (current === generation) {
        if (error.status === 401) {
          report(error);
          return;
        }
        context.chatError =
          error.message === 'INFERENCE_UNAVAILABLE'
            ? t('Chat is not available yet.')
            : t('The AI request could not be confirmed. It was not retried.');
      }
    } finally {
      if (current === generation) {
        context.chatPending = false;
        hosts.invalidate('agent');
        render();
      }
    }
  }
  function renderApp(context, content) {
    const { view, query } = context;
    if (view === 'marketplace') {
      renderMarketplaceApp({
        context,
        content,
        domainNetwork,
        snapshot,
        bus,
        node,
        button,
        field,
        busy,
        blocked: hasUnresolved(),
        commit: (cmd) => commit(cmd, context),
        show,
      });
      return;
    }
    if (view === 'projects') {
      renderProjectsApp({
        evidenceNetwork,
        context,
        content,
        domainNetwork,
        snapshot,
        bus,
        node,
        button,
        field,
        busy,
        blocked: hasUnresolved(),
        commit: (cmd) => commit(cmd, context),
        show,
      });
      return;
    }
    if (view === 'social') {
      renderSocialMessagesApp({
        context,
        content,
        domainNetwork,
        snapshot,
        bus,
        node,
        button,
        field,
        busy,
        blocked: hasUnresolved(),
        commit: (cmd) => commit(cmd, context),
      });
      return;
    }
    if (view === 'agent') {
      renderAgentApp({
        context,
        content,
        domainNetwork,
        snapshot,
        bus,
        node,
        button,
        field,
        busy,
        blocked: hasUnresolved(),
        commit: (cmd) => commit(cmd, context),
        show,
        onTab: (tab) => {
          context.tab = tab;
          context.workflowResult = undefined;
          hosts.invalidate('agent');
          render();
          if (tab !== 'main') void loadHarness(context);
        },
        loadHarness: () => loadHarness(context),
        runWorkflow: (id) => runReadWorkflow(context, id),
        sendChat: (text) => sendChat(context, text),
        refreshChat: () => {
          hosts.invalidate('agent');
          render();
        },
      });
      return;
    }
    if (view === 'evidence') {
      const current = generation;
      renderCitizenEvidence({
        context,
        content,
        network: evidenceNetwork,
        node,
        button,
        field,
        busy,
        blocked: hasUnresolved(),
        commit,
        prepareCommand,
        dialog: compose,
        drafts,
        api,
        signal: readAbort.signal,
        guard: () => current === generation && connected && !disposed,
        report,
      });
      return;
    }
    if (['recovery', 'desks', 'history'].includes(view)) {
      renderLifecycleView({
        view,
        context,
        content,
        operations,
        desks,
        snapshot: {
          ...snapshot,
          items: [
            ...(snapshot?.items || []),
            ...(domainNetwork?.projects || []),
            ...(domainNetwork?.offers || []),
          ],
        },
        desktop,
        node,
        button,
        field,
        busy,
        blocked: hasUnresolved(),
        resume: resumeOperation,
        changeInboxAction: runChangeInbox,
        changeInboxPending: changeInbox.pending,
        changeInboxRecovery: changeInbox.recovery,
        commit,
        loadHistory,
        loadWorldTime,
        checkLicenseGate,
        refresh,
      });
      return;
    }
    const sidebar = node(
      'aside',
      { className: 'nw-sidebar nw-panel' },
      node(
        'div',
        { className: 'nw-head-row' },
        node('h1', {
          text:
            NEIGHBOR_APPS.find((app) => app.view === view)?.name || 'Records',
        }),
        node('span', {
          className: 'nw-toolbar-summary',
          text: `${(snapshot?.items || []).length}`,
        }),
      ),
    );
    const search = node('input', {
      type: 'search',
      placeholder: t('Search your workspace'),
      value: query,
      'aria-label': 'Search workspace',
    });
    search.addEventListener('input', () => {
      context.query = search.value;
      renderRows();
    });
    sidebar.append(search);
    if (view === 'globe') {
      const activeKind = context.kindFilter || 'all';
      const kindPills = node('div', { className: 'nw-kind-pills' });
      for (const [id, text] of [
        ['all', 'All'],
        ['need', 'Needs'],
        ['mission', 'Missions'],
        ['task', 'Tasks'],
        ['place', 'Places'],
        ['document', 'Docs'],
        ['reference', 'Refs'],
      ]) {
        kindPills.append(
          button(
            text,
            () => {
              context.kindFilter = id;
              renderRows();
            },
            {
              className:
                activeKind === id ? 'nw-small-btn nw-primary' : 'nw-small-btn',
              'aria-pressed': String(activeKind === id),
            },
          ),
        );
      }
      sidebar.append(kindPills);
    }
    sidebar.append(
      node(
        'div',
        { className: 'nw-actions nw-create' },
        button('New record', () => makeRecord('need', context), {
          className: 'nw-primary',
          disabled: busy || hasUnresolved(),
        }),
        button('Import file', () => importDocument(context), {
          disabled: busy || hasUnresolved(),
        }),
      ),
      node(
        'div',
        { className: 'nw-links' },
        button('Save this place', () => makeRecord('place', context), {
          disabled: busy || hasUnresolved(),
        }),
        button('Explore USGS reports', () => importReference(context), {
          disabled: busy || hasUnresolved(),
        }),
      ),
    );
    if (pending && !busy)
      sidebar.append(
        button(
          'Reconcile pending save',
          () => commit(pending, pendingContext),
          {
            className: 'nw-primary',
          },
        ),
      );
    sidebar.append(
      node('p', {
        className: 'nw-muted nw-hint',
        text:
          view === 'globe'
            ? 'Choose a record to inspect its evidence and connections. Show world reveals the original globe tools.'
            : 'The same native identities, in another view.',
      }),
    );
    const rows = node('div', {
      className: 'nw-records',
      'aria-label': 'Workspace records',
    });
    const stage = node('main', { className: 'nw-stage' });
    content.classList.add('nw-app-content');
    content.dataset.view = view;
    content.append(sidebar, stage);
    const item = snapshot?.items.find((i) => i.id === context.selected);
    if (item) content.append(inspector(item, context));
    function renderRows() {
      rows.replaceChildren();
      stage.replaceChildren();
      const activeKind = context.kindFilter || 'all';
      let items = (snapshot?.items || []).filter((i) => {
        if (
          view === 'globe' &&
          activeKind !== 'all' &&
          i.payload.kind !== activeKind
        ) {
          return false;
        }
        return `${i.payload.title} ${i.payload.description}`
          .toLowerCase()
          .includes(context.query.toLowerCase());
      });
      if (view === 'documents') items = items.filter((i) => i.hasEvidence);
      if (!items.length) {
        const empty = emptyState({
          title:
            context.query || (view === 'globe' && activeKind !== 'all')
              ? t('No matching records')
              : view === 'documents'
                ? t('No documents')
                : t('No records'),
          description:
            context.query || (view === 'globe' && activeKind !== 'all')
              ? t('Try a different search.')
              : view === 'documents'
                ? t('Import a document to keep its original and history here.')
                : t('Create a record or save a place to begin.'),
          actionLabel:
            context.query || (view === 'globe' && activeKind !== 'all')
              ? undefined
              : view === 'documents'
                ? t('Import file')
                : t('New record'),
          onAction: () =>
            view === 'documents'
              ? importDocument(context)
              : makeRecord('need', context),
          disabled: busy || hasUnresolved(),
        });
        (view === 'globe' ? rows : stage).append(empty);
      }
      if (view === 'board') {
        const board = node('div', { className: 'nw-board' });
        for (const kind of [
          'need',
          'mission',
          'task',
          'place',
          'document',
          'reference',
        ]) {
          const group = items.filter((i) => i.payload.kind === kind);
          if (!group.length) continue;
          const column = node(
            'section',
            { className: 'nw-column' },
            node('h2', {
              text: `${kind[0].toUpperCase() + kind.slice(1)}s · ${group.length}`,
            }),
          );
          for (const record of group) column.append(recordButton(record));
          board.append(column);
        }
        stage.append(board);
      } else {
        for (const record of items) rows.append(recordButton(record));
      }
      if (view !== 'board') (view === 'globe' ? sidebar : stage).append(rows);
      if (view === 'globe') {
        const overview = node(
          'div',
          { className: 'nw-records-overview' },
          node(
            'div',
            { className: 'nw-stat-pills' },
            node('span', {
              className: 'nw-pill',
              text: `${items.length} visible records`,
            }),
            node('span', {
              className: 'nw-pill',
              text: `${(domainNetwork?.projects || []).length} projects`,
            }),
            node('span', {
              className: 'nw-pill',
              text: `${(domainNetwork?.offers || []).length} market offers`,
            }),
            node('span', {
              className: 'nw-pill',
              text: `${(evidenceNetwork?.artifacts || []).length} evidence artifacts`,
            }),
          ),
        );
        const grid = node('div', { className: 'nw-domain-grid' });
        for (const record of items.slice(0, 12)) {
          const p = record.payload;
          const card = node(
            'article',
            {
              className: `nw-service-card ${record.id === context.selected ? 'nw-card-selected' : ''}`,
            },
            node(
              'div',
              { className: 'nw-card-top' },
              node('span', {
                className: 'nw-badge',
                text: `${p.kind} · ${p.status || 'open'}`,
              }),
              node('span', {
                className: 'nw-muted',
                text: `Rev ${record.revision}`,
              }),
            ),
            node('h2', { text: p.title }),
            node('p', {
              className: 'nw-muted',
              text: p.description?.slice(0, 140) || 'No details added.',
            }),
            node(
              'div',
              { className: 'nw-actions' },
              button('Inspect', () => focus(record, context), {
                className: 'nw-small-btn nw-primary',
              }),
              Array.isArray(p.coordinates)
                ? button('Fly to', () => flyGlobeTo(p.coordinates), {
                    className: 'nw-small-btn',
                  })
                : null,
            ),
          );
          grid.append(card);
        }
        overview.append(grid);
        stage.append(overview);
      }
    }
    function recordButton(record) {
      const b = button('', () => focus(record, context), {
        className: `nw-record${record.id === context.selected ? ' nw-selected' : ''}`,
        'aria-label': `Open ${record.payload.title}`,
      });
      b.append(
        node('span', {
          className: 'nw-eyebrow',
          text: `${record.payload.kind} / ${record.payload.status}`,
        }),
        node('strong', { text: record.payload.title }),
        node('span', {
          className: 'nw-muted',
          text:
            record.payload.description.slice(0, 100) ||
            'Open record and connections',
        }),
      );
      return b;
    }
    renderRows();
  }
  const foreground = () => {
    if (connected && document.visibilityState === 'visible' && !busy) refresh();
  };
  const syncTimer = setInterval(() => {
    if (!refreshCount && !disposed) foreground();
  }, 5000);
  document.addEventListener('visibilitychange', foreground);
  async function connect() {
    try {
      const session = await restoreWorkspaceSession(api, readAbort.signal);
      authMode = session.mode;
      if (disposed) return;
      if (!session.paired) {
        status.textContent = t(
          session.mode === 'hosted'
            ? 'Sign in to save your work'
            : 'Connecting to your workspace…',
        );
        connected = false;
        render();
        return;
      }
      if (disposed) return;
      connected = true;
      await refresh();
    } catch (error) {
      if (lifetime?.aborted) return;
      clearPrivate();
      connected = false;
      render();
      report(error);
    }
  }
  const unselect = bus.subscribe((event) => {
    if (event.type === 'handoff-error') {
      show(event.message, true);
      return;
    }
    if (!connected || !['selection', 'window-context'].includes(event.type))
      return;
    const changed = synchronizeWorkspaceSelection({
      bus,
      contexts,
      findAuthorized,
      select: prepareSelection,
      invalidate: (appId) => hosts.invalidate(appId),
    });
    if (changed) render();
  });
  const findAuthorized = (id) =>
    recordLookup.find(id, {
      snapshot,
      domainNetwork,
      evidenceNetwork,
      workflows: contexts.get('agent')?.harness?.workflows,
    });
  bus.setResolver((reference) => {
    const record = findAuthorized(reference.id);
    return record &&
      (!reference.revision || record.revision === reference.revision)
      ? record
      : null;
  });
  function prepareSelection(appId, record) {
    const c = contexts.get(appId);
    if (!c) return;
    prepareWorkspaceSelection(appId, c, record, evidenceNetwork);
  }
  function openRecord(reference) {
    const record = findAuthorized(reference.id);
    if (!record) {
      show('This record is unavailable.', true);
      return;
    }
    const kind = record.payload?.kind;
    const appId =
      kind === 'project'
        ? 'projects'
        : kind === 'market-offer' ||
            kind === 'market-product' ||
            kind === 'proposal' ||
            kind === 'commitment'
          ? 'marketplace'
          : kind === 'document'
            ? 'documents'
            : snapshot.items.some((r) => r.id === record.id)
              ? 'records'
              : 'evidence';
    prepareSelection(appId, record);
    desktop.open(appId);
    hosts.invalidate(appId);
    render();
  }
  desktop = mountNeighborDesktop({
    root,
    layer: content,
    createContent(app, body) {
      hosts.mount(app.appId, body);
    },
    bus,
    viewer,
    onCleanWorld: () =>
      application
        .getComponents()
        .controls.styleManager.applyVisualState({
          scopeEnabled: false,
          hudVisible: false,
          detectionMode: 'OFF',
          bloomEnabled: false,
        })
        .catch(report),
    getRecords: () =>
      connected
        ? searchableRecords({ snapshot, domainNetwork, evidenceNetwork })
        : [],
    onRecord: openRecord,
    onAction: (id) => {
      if (!connected) return;
      if (id === 'record.create') makeRecord('need', contexts.get('records'));
      if (id === 'place.save') makeRecord('place', contexts.get('records'));
      if (id === 'document.import') importDocument(contexts.get('documents'));
      if (id === 'project.create') {
        contexts.get('projects').tab = 'create';
        hosts.invalidate('projects');
        render();
      }
    },
    onNavigate: () => {
      void drafts.flush();
    },
  });
  const removePicked = viewer.selectedEntityChanged?.addEventListener(
    (entity) => {
      const id = entity?.id?.startsWith?.('neighbor-')
        ? entity.id.slice(9)
        : null;
      const record = id && findAuthorized(id);
      if (record)
        bus.selectObject({
          id: record.id,
          kind: record.payload.kind,
          title: record.payload.title,
          coordinates: record.payload.coordinates,
          placeId: record.payload.placeId,
          sourceApp: 'world',
        });
    },
  );
  render();
  connect();
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearInterval(syncTimer);
    clearPrivate();
    removePicked?.();
    unselect();
    hosts.destroy();
    drafts.destroy();
    worldSurface.destroy();
    desktop.destroy();
    document.removeEventListener('visibilitychange', foreground);
    root.remove();
    if (document.title === 'NeighborOS · My world')
      document.title = previousTitle; // i18n-ignore: product title
    document.body.classList.remove('neighbor-ready', 'neighbor-wide');
  };
  lifetime?.addEventListener('abort', dispose, { once: true });
  return {
    refresh,
    destroy() {
      lifetime?.removeEventListener('abort', dispose);
      dispose();
    },
  };
}
