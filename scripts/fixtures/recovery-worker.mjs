/** Test-only process instrumentation. No application auth, storage or replay implementation. */
import { spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { createNativeWorkspace } from '../../server/workspace/native.js';
export const normalBinary = fileURLToPath(
  new URL(
    '../../../Quanta/native/target/release/neighbor-workspace',
    import.meta.url,
  ),
);
export const faultBinary =
  process.env.NEIGHBOR_RECOVERY_IO_BIN ||
  fileURLToPath(
    new URL(
      '../../../Quanta/.quanta-dev/worker-recovery/neighbor-workspace-io',
      import.meta.url,
    ),
  );
export function instrumentedWorkspace(directory) {
  let current,
    mode,
    first,
    delayClose = 0;
  const lines = [],
    replies = [],
    phases = [];
  function fresh() {
    return createNativeWorkspace({
      binary: normalBinary,
      directory,
      timeoutMs: 3000,
      spawnProcess(binary, args, options) {
        const armed = mode && first;
        first = false;
        const env = { ...process.env };
        delete env.QUANTA_IOPOINT;
        delete env.QUANTA_FAILPOINT;
        if (armed && mode !== 'lost') env.QUANTA_IOPOINT = mode;
        const child = spawn(
          armed && mode !== 'lost' ? faultBinary : binary,
          args,
          { ...options, env },
        );
        const raw = child.stdout;
        child.stdout = new PassThrough();
        let command,
          buffered = '';
        const write = child.stdin.write.bind(child.stdin);
        child.stdin.write = (line, ...rest) => {
          command = JSON.parse(String(line));
          lines.push(String(line));
          return write(line, ...rest);
        };
        raw.on('data', (chunk) => {
          buffered += chunk.toString('utf8');
          while (buffered.includes('\n')) {
            const index = buffered.indexOf('\n'),
              line = buffered.slice(0, index + 1);
            buffered = buffered.slice(index + 1);
            const value = JSON.parse(line);
            replies.push({ op: command.op, value });
            if (
              armed &&
              mode === 'lost' &&
              command.op === 'ackChangeInbox' &&
              value.status === 'committed'
            )
              child.kill();
            else child.stdout.write(line);
          }
        });
        raw.on('end', () => child.stdout.end());
        if (armed && delayClose) {
          const emit = child.emit;
          child.emit = function (event, ...values) {
            if (event === 'close') {
              setTimeout(() => emit.call(this, event, ...values), delayClose);
              return true;
            }
            return emit.call(this, event, ...values);
          };
        }
        return child;
      },
    });
  }
  current = fresh();
  return {
    execute: (command) => current.execute(command),
    recoveryStatus() {
      const value = current.recoveryStatus();
      phases.push(value.state);
      return value;
    },
    close: () => current.close(),
    async arm(point, closeDelay = 0) {
      await current.close();
      mode = point;
      first = true;
      delayClose = closeDelay;
      current = fresh();
      lines.length = replies.length = 0;
    },
    lines,
    replies,
    phases,
  };
}
