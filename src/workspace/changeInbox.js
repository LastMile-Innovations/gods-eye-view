/** Stable request keys for uncertain checkpoint operations; never persisted in browser storage. */
export function createChangeInboxController({
  api,
  refresh,
  makeKey = () => crypto.randomUUID().replaceAll('-', ''),
  onChange = () => {},
  pollMs = 250,
}) {
  let pending,
    active,
    recovery = { state: 'idle' },
    recoveryRead = 0,
    generation = 0;
  const timers = new Set();
  async function readRecovery(token) {
    const read = ++recoveryRead;
    try {
      const status = await api.inboxRecovery?.();
      if (
        token === generation &&
        read === recoveryRead &&
        ['idle', 'recovering', 'blocked', 'recovered'].includes(
          status?.state,
        ) &&
        recovery.state !== status.state
      ) {
        recovery = { state: status.state };
        onChange();
      }
    } catch {
      // Status is advisory. An unavailable status never resolves a native ACK.
    }
  }
  return {
    get recovery() {
      return { ...recovery };
    },
    get pending() {
      return pending && { action: pending.action };
    },
    async run(action, inbox) {
      if (active) return active;
      if (action === 'retry') {
        if (!pending) throw new Error('INVALID');
      } else {
        if (pending) throw new Error('CONFLICT');
        if (action !== 'poll' && action !== 'ack') throw new Error('INVALID');
        if (
          action === 'ack' &&
          (!inbox?.pending?.id || typeof inbox.revision !== 'string')
        )
          throw new Error('INVALID');
        pending = {
          action,
          body: Object.freeze({
            key: makeKey(),
            ...(action === 'ack'
              ? { expected: inbox.revision, delivery: inbox.pending.id }
              : {}),
          }),
        };
      }
      const request = pending,
        token = generation;
      let reading;
      const timer = api.inboxRecovery
        ? setInterval(() => {
            if (!reading)
              reading = readRecovery(token).finally(() => {
                reading = undefined;
              });
          }, pollMs)
        : undefined;
      if (timer !== undefined) timers.add(timer);
      const job = (async () => {
        if (request.action === 'ack') {
          if ((await refresh()) !== true) throw new Error('NATIVE_UNAVAILABLE');
          if (token !== generation) return;
        }
        const result = await (request.action === 'poll'
          ? api.pollChangeInbox(request.body)
          : api.ackChangeInbox(request.body));
        if (token !== generation) return;
        pending = undefined;
        await readRecovery(token);
        await refresh();
        if (token === generation) return result;
      })();
      active = job;
      try {
        return await job;
      } catch (error) {
        await readRecovery(token);
        if (
          token === generation &&
          ([
            'CONFLICT',
            'INVALID',
            'NOT_AVAILABLE',
            'PERMISSION_DENIED',
          ].includes(error.message) ||
            [400, 401, 403, 404, 409].includes(error.status))
        ) {
          // Definitive refusal cannot have committed this request. Re-read the
          // native consumer so another client's ACK does not leave a retry loop.
          pending = undefined;
          await refresh();
        }
        throw error;
      } finally {
        clearInterval(timer);
        timers.delete(timer);
        if (active === job) active = undefined;
      }
    },
    clear() {
      generation++;
      for (const timer of timers) clearInterval(timer);
      timers.clear();
      pending = active = undefined;
      recovery = { state: 'idle' };
    },
  };
}
