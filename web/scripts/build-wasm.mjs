// Builds crates/gfa-wasm to wasm32 and runs wasm-bindgen into src/wasm/pkg.
// Written in Node rather than shell so it runs the same on Windows and CI.
// Usage: node scripts/build-wasm.mjs [--dev]

import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(webDir, '..');
const dev = process.argv.includes('--dev');
const profile = dev ? 'debug' : 'release';

function run(cmd, args) {
  console.log(`> ${cmd} ${args.join(' ')}`);
  const result = spawnSync(cmd, args, { cwd: repoRoot, stdio: 'inherit' });
  if (result.error) {
    console.error(`failed to start ${cmd}: ${result.error.message}`);
    if (cmd === 'wasm-bindgen') {
      console.error('install it with: cargo install wasm-bindgen-cli --version 0.2.129 --locked');
    }
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run('cargo', [
  'build',
  '--package', 'gfa-wasm',
  '--target', 'wasm32-unknown-unknown',
  ...(dev ? [] : ['--release']),
]);

run('wasm-bindgen', [
  join(repoRoot, 'target', 'wasm32-unknown-unknown', profile, 'gfa_wasm.wasm'),
  '--target', 'web',
  '--out-dir', join(webDir, 'src', 'wasm', 'pkg'),
  ...(dev ? ['--debug', '--keep-debug'] : []),
]);
