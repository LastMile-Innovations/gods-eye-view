#!/usr/bin/env node
/** Test-only worker fault: leave the first prepared command pending before its effect. */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const directory = process.argv[2];
const child = spawn(
  fileURLToPath(
    new URL(
      '../../../Quanta/native/target/release/neighbor-workspace',
      import.meta.url,
    ),
  ),
  [directory],
  { stdio: ['pipe', 'pipe', 'inherit'] },
);
child.stdout.pipe(process.stdout);
const marker = join(directory, '.qa-journal-fault-used');
createInterface({ input: process.stdin }).on('line', (line) => {
  const command = JSON.parse(line);
  if (command.op === 'resume' && !existsSync(marker)) {
    writeFileSync(
      marker,
      'One intentional pre-effect UNKNOWN_OUTCOME fault.\n',
    );
    process.stdout.write(
      JSON.stringify({ error: { code: 'UNKNOWN_OUTCOME' } }) + '\n',
    );
  } else child.stdin.write(line + '\n');
});
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => child.kill(signal));
process.stdin.on('end', () => child.stdin.end());
child.on('exit', (code) => process.exit(code || 0));
