// Builds crates/gfa-wasm to wasm32 and runs wasm-bindgen into src/wasm/pkg.
// Written in Node rather than shell so it runs the same on Windows and CI.
// Usage: node scripts/build-wasm.mjs [--dev]

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

/** The wasm-bindgen crate version Cargo resolved; the CLI must match it exactly. */
function lockedBindgenVersion() {
  const lock = readFileSync(join(repoRoot, 'Cargo.lock'), 'utf8');
  const match = /name = "wasm-bindgen"\r?\nversion = "([^"]+)"/.exec(lock);
  if (!match?.[1]) throw new Error('wasm-bindgen not found in Cargo.lock');
  return match[1];
}

// A CLI/crate mismatch otherwise fails deep inside wasm-bindgen with a schema
// error that does not name the fix.
function checkBindgenCli() {
  const wanted = lockedBindgenVersion();
  const installHint = `install it with: cargo install wasm-bindgen-cli --version ${wanted} --locked`;
  const result = spawnSync('wasm-bindgen', ['--version'], { encoding: 'utf8' });
  if (result.error) {
    console.error(`wasm-bindgen CLI not found; ${installHint}`);
    process.exit(1);
  }
  const found = /(\d+\.\d+\.\d+)/.exec(result.stdout)?.[1];
  if (found !== wanted) {
    console.error(`wasm-bindgen CLI is ${found ?? 'unknown'}, Cargo.lock wants ${wanted}; ${installHint}`);
    process.exit(1);
  }
}

checkBindgenCli();

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
