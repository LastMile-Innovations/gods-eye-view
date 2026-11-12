import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const quanta = fileURLToPath(new URL('../../Quanta/native/', import.meta.url));
if (!existsSync(join(quanta, 'quanta-core/Cargo.toml')))
  throw new Error(
    'This build needs the sibling OS1/Quanta/native workspace. See docs/NEIGHBOROS.md.',
  );
const pinned = readFileSync(join(quanta, 'rust-toolchain.toml'), 'utf8').match(
  /^\s*channel\s*=\s*"(\d+\.\d+\.\d+)"\s*$/m,
)?.[1];
if (!pinned)
  throw new Error('Quanta requires an exact stable Rust version pin.');
const selected = spawnSync(
  'rustup',
  ['which', '--toolchain', pinned, 'cargo'],
  {
    encoding: 'utf8',
    cwd: quanta,
  },
);
const cargo =
  process.env.CARGO ||
  (selected.status === 0 ? selected.stdout.trim() : 'cargo');
const mode = process.argv[2] === 'test' ? 'test' : 'build';
const development = process.argv.includes('--dev');
const managed = !process.env.CARGO && selected.status === 0;
const result = spawnSync(
  managed ? 'rustup' : cargo,
  [
    ...(managed ? ['run', pinned, 'cargo'] : []),
    mode,
    ...(development ? [] : ['--release']),
    '--locked',
    '--manifest-path',
    join(root, 'native/workspace/Cargo.toml'),
  ],
  {
    stdio: 'inherit',
    cwd: root,
    env: {
      ...process.env,
      PATH: isAbsolute(cargo)
        ? `${dirname(cargo)}${delimiter}${process.env.PATH || ''}`
        : process.env.PATH || '',
      RUSTUP_TOOLCHAIN: pinned,
      CARGO_TARGET_DIR: process.env.CARGO_TARGET_DIR || join(quanta, 'target'),
      CARGO_BUILD_JOBS: '1',
    },
  },
);
if (result.error) {
  console.error(
    `Rust ${pinned} and cargo are required for native workspace storage.`,
  );
  process.exitCode = 1;
} else process.exitCode = result.status ?? 1;
