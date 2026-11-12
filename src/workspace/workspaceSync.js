/** Disposable in-memory sync cursor. Native state and current grants remain authoritative. */
export function createWorkspaceSynchronizer(api) {
  let generation = 0,
    cursor,
    projection,
    active;
  const invalid = () => {
    throw new Error('NATIVE_UNAVAILABLE');
  };
  const validCursor = (value) =>
    value?.version === 1 &&
    typeof value.workspace === 'string' &&
    value.workspace.length > 0 &&
    value.workspace.length <= 128 &&
    typeof value.sequence === 'string' &&
    /^(0|[1-9][0-9]{0,19})$/.test(value.sequence) &&
    BigInt(value.sequence) <= 18446744073709551615n;
  function accept(result, sent) {
    if (
      !validCursor(result?.cursor) ||
      typeof result.changed !== 'boolean' ||
      typeof result.reset !== 'boolean'
    )
      invalid();
    const next = result.cursor;
    if (
      sent &&
      (next.workspace !== sent.workspace ||
        BigInt(next.sequence) < BigInt(sent.sequence))
    )
      invalid();
    if (!result.changed) {
      if (
        !projection ||
        !sent ||
        result.reset ||
        next.sequence !== sent.sequence ||
        result.projection !== undefined
      )
        invalid();
      return;
    }
    const data = result.projection;
    if (
      !data ||
      data.snapshot?.workspace !== next.workspace ||
      !Number.isSafeInteger(data.snapshot.sequence) ||
      String(data.snapshot.sequence) !== next.sequence ||
      !Array.isArray(data.snapshot.items) ||
      !Array.isArray(data.operations?.items) ||
      !Array.isArray(data.desks?.items) ||
      !['artifacts', 'claims', 'casebooks'].every((k) =>
        Array.isArray(data.evidenceNetwork?.[k]),
      ) ||
      !['offers', 'proposals', 'commitments', 'projects'].every((k) =>
        Array.isArray(data.domainNetwork?.[k]),
      )
    )
      invalid();
    projection = data;
    cursor = { ...next };
  }
  return {
    read(signal) {
      if (active) {
        active.again = true;
        return active.promise;
      }
      const job = { generation, again: false };
      job.promise = (async () => {
        do {
          job.again = false;
          const sent = cursor && { ...cursor };
          const result = await api.sync(sent, signal);
          if (job.generation !== generation) return;
          accept(result, sent);
        } while (job.again);
        return projection;
      })().finally(() => {
        if (active === job) active = undefined;
      });
      active = job;
      return job.promise;
    },
    clear() {
      generation++;
      cursor = projection = active = undefined;
    },
  };
}
