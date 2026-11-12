import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MAX_COMMAND_BYTES = 8 * 1024 * 1024;

/** One private worker and bounded queue; no shell, arbitrary program or fallback store. */
export function createNativeWorkspace({
  binary = process.env.NEIGHBOR_NATIVE_BIN ||
    fileURLToPath(
      new URL(
        '../../../Quanta/native/target/release/neighbor-workspace',
        import.meta.url,
      ),
    ),
  directory = process.env.NEIGHBOR_DATA_DIR ||
    fileURLToPath(new URL('../../.neighbor-world', import.meta.url)),
  timeoutMs = 30_000,
  maxResponseBytes = 64 * 1024 * 1024,
  spawnProcess = spawn,
} = {}) {
  let worker,
    active,
    tail = Promise.resolve(),
    queued = 0,
    closed = false,
    shutdown = Promise.resolve(),
    pendingRecovery,
    recoveryState = 'idle';

  function stop(state = worker) {
    if (!state) return shutdown;
    if (worker === state) worker = undefined;
    if (active?.worker === state) active.reject(new Error('UNKNOWN_OUTCOME'));
    shutdown = state.closed;
    if (!state.stopping) {
      state.stopping = true;
      state.child.kill();
      state.killTimer = setTimeout(() => state.child.kill('SIGKILL'), 1000);
      state.killTimer.unref();
    }
    return shutdown;
  }

  async function start() {
    await shutdown;
    if (closed) throw new Error('NATIVE_UNAVAILABLE');
    if (worker) return worker;
    let child;
    try {
      child = spawnProcess(binary, [directory], {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
      });
    } catch {
      throw new Error('NATIVE_UNAVAILABLE');
    }
    let ready, unavailable, finished;
    const state = {
      child,
      closed: new Promise((resolve) => {
        finished = resolve;
      }),
      ready: new Promise((resolve, reject) => {
        ready = resolve;
        unavailable = reject;
      }),
    };
    worker = state;
    const fail = () => {
      unavailable(new Error('NATIVE_UNAVAILABLE'));
      if (worker !== state) return;
      if (active?.worker === state) active.reject(new Error('UNKNOWN_OUTCOME'));
      stop(state);
    };
    child.once('spawn', ready);
    child.on('error', fail);
    child.on('exit', fail);
    child.once('close', () => {
      fail();
      clearTimeout(state.killTimer);
      finished();
    });
    child.stdin.on('error', fail);
    child.stdout.on('error', fail);
    child.stdout.on('end', fail);
    // Decode only complete bounded frames: UTF-8 code points may straddle chunks.
    let chunks = [],
      size = 0;
    child.stdout.on('data', (chunk) => {
      if (worker !== state) return;
      let offset = 0;
      while (offset < chunk.length) {
        const newline = chunk.indexOf(10, offset);
        const end = newline === -1 ? chunk.length : newline;
        const part = chunk.subarray(offset, end);
        size += part.length;
        if (size > maxResponseBytes || !active || active.worker !== state) {
          fail();
          return;
        }
        chunks.push(part);
        if (newline === -1) return;
        const ticket = active;
        let result;
        try {
          const line = new TextDecoder('utf-8', { fatal: true }).decode(
            Buffer.concat(chunks, size),
          );
          result = JSON.parse(line);
          if (!result || typeof result !== 'object' || Array.isArray(result))
            throw new Error();
        } catch {
          fail();
          return;
        }
        chunks = [];
        size = 0;
        ticket.resolve(result);
        offset = newline + 1;
      }
    });
    // Native diagnostics can contain private paths and source bytes.
    child.stderr.resume();
    await state.ready;
    return state;
  }

  async function dispatch(line) {
    const state = await start();
    if (closed || worker !== state) throw new Error('NATIVE_UNAVAILABLE');
    return new Promise((resolve, reject) => {
      let timer;
      const ticket = {
        worker: state,
        resolve(value) {
          if (active !== ticket) return;
          clearTimeout(timer);
          active = undefined;
          resolve(value);
        },
        reject(error) {
          if (active !== ticket) return;
          clearTimeout(timer);
          active = undefined;
          reject(error);
        },
      };
      active = ticket;
      timer = setTimeout(() => {
        ticket.reject(new Error('UNKNOWN_OUTCOME'));
        stop(state);
      }, timeoutMs);
      try {
        state.child.stdin.write(`${line}\n`, (error) => {
          if (error) {
            ticket.reject(new Error('UNKNOWN_OUTCOME'));
            if (worker === state) stop(state);
          }
        });
      } catch {
        ticket.reject(new Error('UNKNOWN_OUTCOME'));
        stop(state);
      }
    });
  }

  async function reconcile() {
    const original = pendingRecovery;
    recoveryState = 'recovering';
    try {
      // Releasing the writer lock includes process AND stdio close. Never open
      // a replacement while the failed process can still hold the native store.
      await stop();
      const result = await dispatch(original);
      // Current authority denial cannot establish an earlier commit's fate.
      // Accept the typed ACK receipt, or its explicit native CAS/input refusal.
      const committed =
        result.status === 'committed' &&
        typeof result.id === 'string' &&
        typeof result.receipt === 'string' &&
        Number.isSafeInteger(result.sequence) &&
        result.sequence > 0;
      if (!committed && !['CONFLICT', 'INVALID'].includes(result.error?.code))
        throw new Error('UNKNOWN_OUTCOME');
      pendingRecovery = undefined;
      recoveryState = 'recovered';
      return result;
    } catch {
      recoveryState = 'blocked';
      stop();
      // One reopen/replay per admission. Preserve the original barrier rather
      // than looping or replacing its key when the failure persists.
      throw new Error('UNKNOWN_OUTCOME');
    }
  }

  return {
    recoveryStatus() {
      return { state: recoveryState };
    },
    async execute(command) {
      if (closed) throw new Error('NATIVE_UNAVAILABLE');
      if (queued >= 16) throw new Error('RATE_LIMITED');
      // Freeze admitted bytes before queueing; caller mutations cannot change a
      // command's fingerprint or leave an orphaned active ticket on stringify failure.
      let line;
      try {
        if (!command || typeof command !== 'object' || Array.isArray(command))
          throw new Error();
        line = JSON.stringify(command);
        if (!line?.startsWith('{')) throw new Error();
      } catch {
        throw new Error('INVALID');
      }
      if (Buffer.byteLength(line) + 1 > MAX_COMMAND_BYTES)
        throw new Error('RESOURCE_LIMIT');
      const admitted = JSON.parse(line);
      const replayable =
        admitted.op === 'ackChangeInbox' &&
        typeof admitted.key === 'string' &&
        typeof admitted.expected === 'string' &&
        typeof admitted.delivery === 'string';
      queued++;
      const job = tail
        .then(async () => {
          // An unresolved ACK is always reconciled before any later command.
          // Its immutable admitted bytes never come from the next caller.
          if (pendingRecovery) {
            const original = pendingRecovery;
            const result = await reconcile();
            if (line === original) return result;
          }
          try {
            const result = await dispatch(line);
            if (result.error?.code === 'UNKNOWN_OUTCOME') {
              if (replayable) {
                pendingRecovery = line;
                return reconcile();
              }
              stop();
            } else if (result.error?.code === 'NATIVE_UNAVAILABLE') stop();
            return result;
          } catch (error) {
            if (error.message !== 'UNKNOWN_OUTCOME' || !replayable) throw error;
            pendingRecovery = line;
            return reconcile();
          }
        })
        .finally(() => {
          queued--;
        });
      tail = job.catch(() => {});
      return job;
    },
    close() {
      closed = true;
      active?.reject(new Error('UNKNOWN_OUTCOME'));
      return stop();
    },
  };
}
