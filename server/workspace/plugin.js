import { createInferenceGateway, readInferenceConfig } from './inference.js';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { isLocalMcpRequest } from '../security/localAccess.js';
import { createNativeWorkspace } from './native.js';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const PREFIX = '/api/world/v1';
const token = () => randomBytes(32).toString('hex');
const equals = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
const CODES = new Set([
  'INVALID',
  'NOT_AVAILABLE',
  'CONFLICT',
  'UNSUPPORTED',
  'PERMISSION_DENIED',
  'RATE_LIMITED',
  'UNKNOWN_OUTCOME',
  'NATIVE_UNAVAILABLE',
  'RESOURCE_LIMIT',
  'INFERENCE_UNAVAILABLE',
  'PROVIDER_REJECTED',
  'CANCELLED',
]);
const MAX_BODY = 8 * 1024 * 1024;

/** Shared domain routes with separate trusted hosted authentication and loopback-only development sessions. */
export function createWorkspaceHandler({
  native,
  now = Date.now,
  fetchImpl = fetch,
  authorizeHosted,
  inference = createInferenceGateway(),
} = {}) {
  const developmentSessions = new Map();
  let feed;
  const send = (res, status, value, headers = {}) => {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    });
    res.end(JSON.stringify(value));
  };
  async function body(req) {
    if (!(req.headers['content-type'] || '').startsWith('application/json'))
      throw new Error('INVALID');
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) throw new Error('RESOURCE_LIMIT');
      chunks.push(chunk);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new Error('INVALID');
    }
  }
  async function usgs() {
    if (feed && now() - feed.at < 120_000) return feed;
    const response = await fetchImpl(
      'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson',
      { signal: AbortSignal.timeout(15_000), redirect: 'error' },
    );
    if (!response.ok) throw new Error('NOT_AVAILABLE');
    let original = '';
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 1024 * 1024) throw new Error('RESOURCE_LIMIT');
      original += decoder.decode(chunk, { stream: true });
    }
    original += decoder.decode();
    const data = JSON.parse(original);
    if (data.type !== 'FeatureCollection' || !Array.isArray(data.features))
      throw new Error('NOT_AVAILABLE');
    const rows = data.features
      .map((f, index) => ({
        id: f.id,
        index,
        title: f.properties?.title,
        time: f.properties?.time,
        coordinates: f.geometry?.coordinates?.slice(0, 2),
      }))
      .filter(
        (f) =>
          typeof f.id === 'string' &&
          typeof f.title === 'string' &&
          Array.isArray(f.coordinates) &&
          f.coordinates.every(Number.isFinite),
      );
    return (feed = { at: now(), original, rows });
  }
  return async function handler(req, res) {
    req.setTimeout?.(30_000, () => req.destroy());
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname.startsWith(PREFIX)
      ? url.pathname.slice(PREFIX.length)
      : url.pathname;
    let hostedAccess;
    let requestNative = native;
    try {
      if (authorizeHosted) {
        hostedAccess = await authorizeHosted(req, res, path);
        if (!hostedAccess) return;
        requestNative = hostedAccess.native;
      } else {
        if (
          !isLocalMcpRequest({
            remoteAddress: req.socket.remoteAddress,
            localPort: req.socket.localPort,
            host: req.headers.host,
            origin: req.headers.origin,
            headers: req.headers,
            env: process.env,
          })
        )
          return send(res, 403, { error: { code: 'NOT_AVAILABLE' } });
        const origin = req.headers.origin;
        if (req.method !== 'GET' && !origin)
          return send(res, 403, { error: { code: 'NOT_AVAILABLE' } });
        const cookies = (req.headers.cookie || '')
          .split(';')
          .map((v) => v.trim())
          .filter((v) => v.startsWith('neighbor_session='));
        const cookie = cookies.length === 1 ? cookies[0].slice(17) : undefined;
        let session = developmentSessions.get(cookie);
        if (session && now() >= session.expires) {
          developmentSessions.delete(cookie);
          session = undefined;
        }
        if (path === '/connect' && req.method === 'POST') {
          const input = await body(req);
          if (
            !input ||
            Array.isArray(input) ||
            typeof input !== 'object' ||
            Object.keys(input).length
          )
            return send(res, 400, { error: { code: 'INVALID' } });
          if (session)
            return send(res, 200, {
              csrf: session.csrf,
              mode: 'local-development',
            });
          for (const [id, item] of developmentSessions)
            if (now() >= item.expires) developmentSessions.delete(id);
          if (developmentSessions.size >= 64)
            return send(res, 429, { error: { code: 'RATE_LIMITED' } });
          const id = token();
          session = { csrf: token(), expires: now() + 8 * 60 * 60 * 1000 };
          developmentSessions.set(id, session);
          return send(
            res,
            200,
            { csrf: session.csrf, mode: 'local-development' },
            {
              'Set-Cookie': `neighbor_session=${id}; HttpOnly; SameSite=Strict; Path=${PREFIX}; Max-Age=28800`,
            },
          );
        }
        if (!session) {
          if (path === '/session' && req.method === 'GET')
            return send(res, 200, { paired: false, mode: 'local-development' });
          return send(res, 401, { error: { code: 'UNAUTHENTICATED' } });
        }
        const { csrf } = session;
        if (
          req.method !== 'GET' &&
          !equals(req.headers['x-neighbor-csrf'], csrf)
        )
          return send(res, 403, { error: { code: 'NOT_AVAILABLE' } });
        if (path === '/session' && req.method === 'GET')
          return send(res, 200, {
            paired: true,
            csrf,
            mode: 'local-development',
            engine: 'quanta-native',
            capabilities: [
              'workspace',
              'needs',
              'missions',
              'tasks',
              'documents',
              'places',
              'usgs-reference',
              'durable-command-journal',
              'saved-desks',
              'authored-history',
              'citizen-evidence',
              'marketplace',
              'commitments-verified-outcomes',
              'projects',
              'social',
              'agent-intent-compiler',
              'world-time-query',
              'license-gate-policy',
              'qharness-qserve-openai-v1',
              'qharness-qflow-pipelines',
              'qharness-qagent-missions',
              'qharness-qcontrol-policy-qframe-qeval',
            ],
          });
        if (path === '/logout' && req.method === 'POST') {
          developmentSessions.delete(cookie);
          feed = undefined;
          return send(
            res,
            200,
            { status: 'signed-out' },
            {
              'Set-Cookie': `neighbor_session=; HttpOnly; SameSite=Strict; Path=${PREFIX}; Max-Age=0`,
            },
          );
        }
      }
      if (path === '/references/usgs' && req.method === 'GET') {
        const value = await usgs();
        return send(res, 200, {
          rows: value.rows.slice(0, 50),
          retrievedAt: value.at,
          coverage: 'USGS reported last-day subset',
          sourceVersionsVerified: false,
        });
      }
      const fixtureOps = new Set([
        'qhOpenAiChatCompletions',
        'qhOpenAiResponses',
        'qhOpenAiEmbeddings',
        'qhOpenAiGetResponse',
        'qhOpenAiCancelResponse',
        'qhCreateMission',
        'qhMissionAction',
        'qhReconcileRun',
      ]);
      const workflowOnly = (command) =>
        command.operation === 'execute' &&
        command.execution?.strategy === 'workflow' &&
        command.execution?.interaction === 'sync' &&
        typeof command.workflowId === 'string';
      const checkExecution = (command) => {
        if (
          fixtureOps.has(command.op) ||
          (command.op === 'qhExecute' && !workflowOnly(command))
        )
          throw new Error('INFERENCE_UNAVAILABLE');
      };
      const execute = async (command) => {
        checkExecution(command);
        if (command.op === 'prepare') checkExecution(command.command);
        if (command.op === 'resume') {
          const prior = await requestNative.execute({
            op: 'operation',
            key: command.key,
          });
          if (
            !prior.error &&
            (fixtureOps.has(prior.kind) ||
              (prior.kind === 'qhExecute' &&
                prior.executionProfile !== 'native_read_workflow'))
          )
            throw new Error('INFERENCE_UNAVAILABLE');
        }
        const result = await requestNative.execute(command);
        if (result.error)
          throw new Error(
            CODES.has(result.error.code) ? result.error.code : 'INTERNAL',
          );
        return result;
      };
      if (path === '/drafts' && req.method === 'GET')
        return send(res, 200, await execute({ op: 'drafts' }));
      if (path === '/change-inbox/recovery' && req.method === 'GET') {
        const state = requestNative.recoveryStatus?.().state || 'idle';
        return send(res, 200, {
          state: ['idle', 'recovering', 'blocked', 'recovered'].includes(state)
            ? state
            : 'blocked',
        });
      }
      if (path === '/change-inbox' && req.method === 'GET')
        return send(res, 200, await execute({ op: 'changeInbox' }));
      if (
        ['/change-inbox/poll', '/change-inbox/ack'].includes(path) &&
        req.method === 'POST'
      ) {
        const input = await body(req);
        const keys = path.endsWith('/ack')
          ? ['key', 'expected', 'delivery']
          : ['key'];
        if (
          !input ||
          typeof input !== 'object' ||
          Array.isArray(input) ||
          Object.keys(input).some((k) => !keys.includes(k)) ||
          typeof input.key !== 'string' ||
          (path.endsWith('/ack') &&
            (typeof input.expected !== 'string' ||
              typeof input.delivery !== 'string'))
        )
          throw new Error('INVALID');
        return send(
          res,
          200,
          await execute({
            ...input,
            op: path.endsWith('/ack') ? 'ackChangeInbox' : 'pollChangeInbox',
          }),
        );
      }
      const draftRoute = path.match(/^\/drafts\/([^/]+)$/);
      if (draftRoute && req.method === 'GET')
        return send(
          res,
          200,
          await execute({ op: 'draft', id: decodeURIComponent(draftRoute[1]) }),
        );
      if (path === '/drafts' && req.method === 'PUT')
        return send(
          res,
          200,
          await execute({ ...(await body(req)), op: 'saveDraft' }),
        );
      if (draftRoute && req.method === 'DELETE')
        return send(
          res,
          200,
          await execute({
            ...(await body(req)),
            op: 'discardDraft',
            id: decodeURIComponent(draftRoute[1]),
          }),
        );
      // Only the configured text transport is served; native inference examples are fixtures.
      if (
        (path === '/v1/models' || path === '/qh/v1/models') &&
        req.method === 'GET'
      )
        return send(res, 200, inference.models());
      const modelDetailRoute = path.match(/^\/v1\/models\/(.+)$/);
      if (modelDetailRoute && req.method === 'GET') {
        const model = inference
          .models()
          .data.find((m) => m.id === decodeURIComponent(modelDetailRoute[1]));
        if (!model) throw new Error('NOT_AVAILABLE');
        return send(res, 200, model);
      }
      if (path === '/v1/chat/completions' && req.method === 'POST') {
        const input = await body(req);
        const cancellation = new AbortController();
        const cancel = () => {
          if (!res.writableEnded) cancellation.abort();
        };
        res.once('close', cancel);
        try {
          return send(
            res,
            200,
            await inference.complete(input, {
              account: requestNative,
              signal: cancellation.signal,
            }),
          );
        } finally {
          res.off('close', cancel);
        }
      }
      if (path.startsWith('/v1/')) throw new Error('INFERENCE_UNAVAILABLE');
      // Native QHarness routes (`/qh/v1/*`)
      if (path === '/qh/v1/status' && req.method === 'GET') {
        const status = await execute({ op: 'qhStatus' });
        const models = inference.models().data;
        return send(res, 200, {
          ...status,
          models,
          summary: { ...status.summary, modelCount: models.length },
          executionAvailability: {
            chat: models.length ? 'configured_unverified' : 'unavailable',
            workflow: 'native_read_only',
            agent: 'unavailable',
            embeddings: 'unavailable',
            responses: 'unavailable',
          },
          legacyRuntimeRecords: 'simulation_unverified',
        });
      }
      if (path === '/qh/v1/capabilities' && req.method === 'GET') {
        const effectFilter = url.searchParams.get('effect') || undefined;
        return send(
          res,
          200,
          await execute({
            op: 'qhCapabilities',
            ...(effectFilter ? { effectFilter } : {}),
          }),
        );
      }
      if (path === '/qh/v1/execute' && req.method === 'POST') {
        const input = await body(req);
        return send(res, 200, await execute({ ...input, op: 'qhExecute' }));
      }
      if (path === '/qh/v1/missions' && req.method === 'POST') {
        const input = await body(req);
        return send(
          res,
          200,
          await execute({ ...input, op: 'qhCreateMission' }),
        );
      }
      if (path === '/qh/v1/missions/action' && req.method === 'POST') {
        const input = await body(req);
        return send(
          res,
          200,
          await execute({ ...input, op: 'qhMissionAction' }),
        );
      }
      if (path === '/qh/v1/mandates' && req.method === 'POST') {
        const input = await body(req);
        return send(
          res,
          200,
          await execute({ ...input, op: 'qhCreateMandate' }),
        );
      }
      if (path === '/qh/v1/mandates/revoke' && req.method === 'POST') {
        const input = await body(req);
        return send(
          res,
          200,
          await execute({ ...input, op: 'qhRevokeMandate' }),
        );
      }
      if (path === '/qh/v1/frames' && req.method === 'POST') {
        const input = await body(req);
        return send(
          res,
          200,
          await execute({ ...input, op: 'qhCompileFrame' }),
        );
      }
      if (path === '/qh/v1/memory' && req.method === 'POST') {
        const input = await body(req);
        return send(res, 200, await execute({ ...input, op: 'qhSaveMemory' }));
      }
      if (path === '/qh/v1/workflows' && req.method === 'POST') {
        const input = await body(req);
        return send(
          res,
          200,
          await execute({ ...input, op: 'qhSaveWorkflow' }),
        );
      }
      const workflowValidation = path.match(
        /^\/qh\/v1\/workflows\/([^/]+)\/validate$/,
      );
      if (workflowValidation && req.method === 'POST') {
        const input = await body(req);
        return send(
          res,
          200,
          await execute({
            ...input,
            op: 'qhValidateWorkflow',
            workflowId: decodeURIComponent(workflowValidation[1]),
          }),
        );
      }
      if (path === '/qh/v1/runs/reconcile' && req.method === 'POST') {
        const input = await body(req);
        return send(
          res,
          200,
          await execute({ ...input, op: 'qhReconcileRun' }),
        );
      }
      if (path === '/qh/v1/evaluations/run' && req.method === 'POST') {
        const input = await body(req);
        return send(res, 200, await execute({ ...input, op: 'qhRunEval' }));
      }
      if (path === '/evidence-network' && req.method === 'GET')
        return send(res, 200, await execute({ op: 'evidenceNetwork' }));
      if (path === '/domain-network' && req.method === 'GET')
        return send(res, 200, await execute({ op: 'domainNetwork' }));
      if (path === '/world-time' && req.method === 'GET') {
        const rawSeq = url.searchParams.get('asKnownAt');
        const mode = url.searchParams.get('mode') || undefined;
        const asKnownAt =
          rawSeq !== null && rawSeq !== '' ? Number(rawSeq) : undefined;
        if (
          asKnownAt !== undefined &&
          (!Number.isInteger(asKnownAt) || asKnownAt < 0)
        )
          throw new Error('INVALID');
        return send(
          res,
          200,
          await execute({
            op: 'worldTimeQuery',
            ...(asKnownAt !== undefined ? { asKnownAt } : {}),
            ...(mode ? { mode } : {}),
          }),
        );
      }
      if (path === '/license-gate' && req.method === 'POST') {
        const input = await body(req);
        return send(
          res,
          200,
          await execute({
            op: 'evaluateLicenseGate',
            sourceId: input?.sourceId,
            operation: input?.operation,
            derivedOutput: Boolean(input?.derivedOutput),
          }),
        );
      }
      const objectGraph = path.match(/^\/objects\/([^/]+)\/graph$/);
      if (objectGraph && req.method === 'GET')
        return send(
          res,
          200,
          await execute({
            op: 'objectGraph',
            id: decodeURIComponent(objectGraph[1]),
          }),
        );
      const citizenHistory = path.match(/^\/citizen\/([^/]+)\/history$/);
      if (citizenHistory && req.method === 'GET')
        return send(
          res,
          200,
          await execute({
            op: 'citizenHistory',
            id: decodeURIComponent(citizenHistory[1]),
          }),
        );
      const dossier = path.match(/^\/disclosures\/([^/]+)\/dossier$/);
      if (dossier && req.method === 'GET')
        return send(
          res,
          200,
          await execute({
            op: 'evidenceDossier',
            id: decodeURIComponent(dossier[1]),
          }),
        );
      const artifactRoute = path.match(
        /^\/evidence\/([^/]+)\/(original|custody)$/,
      );
      if (artifactRoute && req.method === 'GET')
        return send(
          res,
          200,
          await execute({
            op:
              artifactRoute[2] === 'original'
                ? 'artifactOriginal'
                : 'evidenceCustody',
            id: decodeURIComponent(artifactRoute[1]),
          }),
        );
      if (path === '/operations' && req.method === 'GET')
        return send(res, 200, await execute({ op: 'operations' }));
      if (path === '/desks' && req.method === 'GET')
        return send(res, 200, await execute({ op: 'desks' }));
      const history = path.match(/^\/records\/([^/]+)\/history$/);
      if (history && req.method === 'GET')
        return send(
          res,
          200,
          await execute({ op: 'history', id: decodeURIComponent(history[1]) }),
        );
      const resume = path.match(/^\/operations\/([^/]+)\/resume$/);
      if (resume && req.method === 'POST') {
        const input = await body(req);
        if (
          !input ||
          typeof input !== 'object' ||
          Array.isArray(input) ||
          Object.keys(input).length
        )
          throw new Error('INVALID');
        return send(
          res,
          200,
          await execute({ op: 'resume', key: decodeURIComponent(resume[1]) }),
        );
      }
      let command;
      if (path === '/sync' && req.method === 'POST') {
        const input = await body(req);
        if (
          !input ||
          typeof input !== 'object' ||
          Array.isArray(input) ||
          Object.keys(input).some((key) => key !== 'cursor')
        )
          throw new Error('INVALID');
        return send(res, 200, await execute({ ...input, op: 'sync' }));
      }
      if (path === '/query' && req.method === 'POST') {
        await body(req);
        command = { op: 'snapshot' };
      } else if (path.startsWith('/occurrences/') && req.method === 'GET')
        command = {
          op: 'evidence',
          id: decodeURIComponent(path.slice('/occurrences/'.length)),
        };
      else if (path === '/commands' && req.method === 'POST') {
        const input = await body(req);
        const directCommands = [
          'write',
          'saveDesk',
          'deleteDesk',
          'preserveEvidence',
          'reviewEvidence',
          'saveEvidenceClaim',
          'saveCasebook',
          'deriveEvidenceText',
          'saveEvidenceDisclosure',
          'withdrawEvidenceDisclosure',
          'saveMarketOffer',
          'saveProposal',
          'saveCommitment',
          'verifyCommitmentOutcome',
          'saveProject',
          'saveSocialPost',
          'compileAgentPlan',
          'executeAgentPlan',
          'seedStarterCatalog',
          'qhCreateMandate',
          'qhRevokeMandate',
          'qhCompileFrame',
          'qhSaveMemory',
          'qhSaveWorkflow',
          'qhValidateWorkflow',
          'qhExecute',
          'qhReconcileRun',
          'qhCreateMission',
          'qhMissionAction',
          'qhRunEval',
        ];
        if (
          !input ||
          typeof input !== 'object' ||
          Array.isArray(input) ||
          !['import', 'importReference', ...directCommands].includes(input.op)
        )
          throw new Error('UNSUPPORTED');
        if (
          input.op === 'import' &&
          (input.payload?.kind !== 'document' ||
            input.permissionConfirmed !== true ||
            !/\.(txt|md)$/i.test(input.payload?.title))
        )
          throw new Error('INVALID');
        checkExecution(input);
        // Compare the exact browser request before resolving an existing operation.
        // In particular, retries must not refetch a newer USGS feed under an old key.
        const prior = await requestNative.execute({
          op: 'operation',
          key: input.key,
          request: input,
        });
        if (!prior.error)
          return send(
            res,
            200,
            await execute({ op: 'resume', key: input.key }),
          );
        if (prior.error.code !== 'NOT_AVAILABLE')
          throw new Error(
            CODES.has(prior.error.code) ? prior.error.code : 'INTERNAL',
          );
        if (input.op === 'importReference') {
          const source = await usgs();
          const record = source.rows.find((r) => r.id === input.eventId);
          if (!record) throw new Error('NOT_AVAILABLE');
          command = {
            op: 'import',
            key: input.key,
            original: source.original,
            selector: `/features/${record.index}`,
            payload: {
              kind: 'reference',
              title: record.title,
              description:
                'USGS earthquake report; source claim, not independently verified.',
              status: 'open',
              refs: [],
              coordinates: record.coordinates,
              sourceRecord: record.id,
            },
          };
        } else if (
          input.op === 'import' &&
          input.payload?.kind === 'document'
        ) {
          if (
            input.permissionConfirmed !== true ||
            !/\.(txt|md)$/i.test(input.payload.title)
          )
            throw new Error('INVALID');
          const { permissionConfirmed, draft, ...rest } = input;
          command = rest;
        } else if (directCommands.includes(input.op)) {
          const { draft, ...domainCommand } = input;
          command = domainCommand;
        } else throw new Error('UNSUPPORTED');
        await execute({ op: 'prepare', request: input, command });
        return send(res, 200, await execute({ op: 'resume', key: input.key }));
      } else return send(res, 404, { error: { code: 'NOT_AVAILABLE' } });
      const result = await requestNative.execute(command);
      if (result.error)
        throw new Error(
          CODES.has(result.error.code) ? result.error.code : 'INTERNAL',
        );
      return send(res, 200, result);
    } catch (error) {
      const code = CODES.has(error.message) ? error.message : 'INTERNAL';
      const status =
        code === 'CONFLICT'
          ? 409
          : code === 'NOT_AVAILABLE'
            ? 404
            : code === 'RESOURCE_LIMIT'
              ? 413
              : code === 'RATE_LIMITED'
                ? 429
                : [
                      'NATIVE_UNAVAILABLE',
                      'UNKNOWN_OUTCOME',
                      'INFERENCE_UNAVAILABLE',
                      'PROVIDER_REJECTED',
                    ].includes(code)
                  ? 503
                  : code === 'INTERNAL'
                    ? 500
                    : 400;
      return send(res, status, {
        error: {
          code,
          retryable: ['RATE_LIMITED', 'NATIVE_UNAVAILABLE'].includes(code),
        },
      });
    } finally {
      hostedAccess?.release?.();
    }
  };
}

export function neighborWorkspacePlugin({
  inference: configuredInference,
} = {}) {
  let native;
  const install = (server) => {
    native = createNativeWorkspace();
    const inference =
      configuredInference ||
      createInferenceGateway({ config: readInferenceConfig() });
    const handler = createWorkspaceHandler({ native, inference });
    server.middlewares.use(PREFIX, handler);
    server.httpServer?.once('close', () => native.close());
  };
  return {
    name: 'neighbor-native-workspace',
    config() {
      const directory = resolve(
        process.env.NEIGHBOR_DATA_DIR ||
          fileURLToPath(new URL('../../.neighbor-world', import.meta.url)),
      ).replaceAll('\\', '/');
      return {
        server: { fs: { deny: ['**/.neighbor-world/**', `${directory}/**`] } },
      };
    },
    configureServer: install,
    configurePreviewServer: install,
    closeBundle() {
      native?.close();
    },
  };
}
