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

function installedBindgenVersion() {
  const result = spawnSync('wasm-bindgen', ['--version'], { encoding: 'utf8' });
  if (result.error) return undefined;
  return /(\d+\.\d+\.\d+)/.exec(result.stdout)?.[1];
}

// The CLI must match the crate in Cargo.lock exactly, or wasm-bindgen fails
// with a schema error that does not name the fix. Installing the right one
// here means nobody has to know the version. `--locked` builds the CLI with
// its own pinned dependencies so the one-time install can't break on a newer
// transitive release.
function ensureBindgenCli() {
  const wanted = lockedBindgenVersion();
  const found = installedBindgenVersion();
  if (found === wanted) return;
  console.log(
    `wasm-bindgen CLI is ${found ?? 'not installed'}, Cargo.lock wants ${wanted}; installing (one time, about a minute)`,
  );
  run('cargo', ['install', 'wasm-bindgen-cli', '--version', wanted, '--locked']);
}

ensureBindgenCli();

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
