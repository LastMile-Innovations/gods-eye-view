/** Same-origin client. Session credentials remain in an HttpOnly cookie; CSRF is memory-only. */
export function createWorkspaceClient({ request = fetch } = {}) {
  let csrf;
  async function call(path, { method = 'GET', body, signal } = {}) {
    const response = await request(`/api/world/v1${path}`, {
      method,
      credentials: 'same-origin',
      redirect: 'error',
      cache: 'no-store',
      signal,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(method === 'GET' || !csrf ? {} : { 'X-Neighbor-CSRF': csrf }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response
      .json()
      .catch(() => ({ error: { code: 'NATIVE_UNAVAILABLE' } }));
    if (!response.ok) {
      const error = new Error(result.error?.code || 'NATIVE_UNAVAILABLE');
      error.status = response.status;
      throw error;
    }
    if (result.csrf) csrf = result.csrf;
    return result;
  }
  return {
    session: (signal) => call('/session', { signal }),
    connectLocal: () => call('/connect', { method: 'POST', body: {} }),
    snapshot: (signal) => call('/query', { method: 'POST', body: {}, signal }),
    sync: (cursor, signal) =>
      call('/sync', {
        method: 'POST',
        body: cursor ? { cursor } : {},
        signal,
      }),
    command: (body) => call('/commands', { method: 'POST', body }),
    evidence: (id, signal) =>
      call(`/occurrences/${encodeURIComponent(id)}`, { signal }),
    citizenHistory: (id, signal) =>
      call(`/citizen/${encodeURIComponent(id)}/history`, { signal }),
    evidenceDossier: (id, signal) =>
      call(`/disclosures/${encodeURIComponent(id)}/dossier`, { signal }),
    evidenceNetwork: (signal) => call('/evidence-network', { signal }),
    domainNetwork: (signal) => call('/domain-network', { signal }),
    worldTime: ({ asKnownAt, mode } = {}, signal) => {
      const params = new URLSearchParams();
      if (asKnownAt !== undefined && asKnownAt !== null)
        params.set('asKnownAt', String(asKnownAt));
      if (mode) params.set('mode', mode);
      const qs = params.toString();
      return call(`/world-time${qs ? `?${qs}` : ''}`, { signal });
    },
    evaluateLicenseGate: (body, signal) =>
      call('/license-gate', { method: 'POST', body, signal }),
    objectGraph: (id, signal) =>
      call(`/objects/${encodeURIComponent(id)}/graph`, { signal }),
    artifactOriginal: (id, signal) =>
      call(`/evidence/${encodeURIComponent(id)}/original`, { signal }),
    evidenceCustody: (id, signal) =>
      call(`/evidence/${encodeURIComponent(id)}/custody`, { signal }),
    drafts: (signal) => call('/drafts', { signal }),
    draft: (id, signal) =>
      call(`/drafts/${encodeURIComponent(id)}`, { signal }),
    saveDraft: (body) => call('/drafts', { method: 'PUT', body }),
    discardDraft: (id, body) =>
      call(`/drafts/${encodeURIComponent(id)}`, { method: 'DELETE', body }),
    operations: (signal) => call('/operations', { signal }),
    inboxRecovery: () =>
      call('/change-inbox/recovery', { signal: AbortSignal.timeout(2000) }),
    pollChangeInbox: (body) =>
      call('/change-inbox/poll', { method: 'POST', body }),
    ackChangeInbox: (body) =>
      call('/change-inbox/ack', { method: 'POST', body }),
    desks: (signal) => call('/desks', { signal }),
    history: (id, signal) =>
      call(`/records/${encodeURIComponent(id)}/history`, { signal }),
    resume: (key) =>
      call(`/operations/${encodeURIComponent(key)}/resume`, {
        method: 'POST',
        body: {},
      }),
    references: (signal) => call('/references/usgs', { signal }),
    qhStatus: (signal) => call('/qh/v1/status', { signal }),
    qhModels: (signal) => call('/v1/models', { signal }),
    qhCapabilities: (signal) => call('/qh/v1/capabilities', { signal }),
    qhExecute: (body, signal) =>
      call('/qh/v1/execute', { method: 'POST', body, signal }),
    qhCreateMandate: (body, signal) =>
      call('/qh/v1/mandates', { method: 'POST', body, signal }),
    qhRevokeMandate: (body, signal) =>
      call('/qh/v1/mandates/revoke', { method: 'POST', body, signal }),
    qhCreateMission: (body, signal) =>
      call('/qh/v1/missions', { method: 'POST', body, signal }),
    qhMissionAction: (body, signal) =>
      call('/qh/v1/missions/action', { method: 'POST', body, signal }),
    qhCompileFrame: (body, signal) =>
      call('/qh/v1/frames', { method: 'POST', body, signal }),
    qhSaveMemory: (body, signal) =>
      call('/qh/v1/memory', { method: 'POST', body, signal }),
    qhSaveWorkflow: (body, signal) =>
      call('/qh/v1/workflows', { method: 'POST', body, signal }),
    qhReconcileRun: (body, signal) =>
      call('/qh/v1/runs/reconcile', { method: 'POST', body, signal }),
    qhRunEval: (body, signal) =>
      call('/qh/v1/evaluations/run', { method: 'POST', body, signal }),
    openAiModels: (signal) => call('/v1/models', { signal }),
    openAiChatCompletions: (body, signal) =>
      call('/v1/chat/completions', { method: 'POST', body, signal }),
    openAiResponses: (body, signal) =>
      call('/v1/responses', { method: 'POST', body, signal }),
    openAiEmbeddings: (body, signal) =>
      call('/v1/embeddings', { method: 'POST', body, signal }),
    async logout() {
      try {
        return await call('/logout', { method: 'POST', body: {} });
      } finally {
        csrf = undefined;
      }
    },
  };
}
