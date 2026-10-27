// Builds crates/gfa-wasm to wasm32 and runs wasm-bindgen into
// web/src/wasm/pkg.
//
// Usage: node scripts/build-wasm.mjs [--dev]

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { root, run } from './lib.mjs';

const dev = process.argv.includes('--dev');
const profile = dev ? 'debug' : 'release';

/** The wasm-bindgen crate version Cargo resolved; the CLI must match it exactly. */
function lockedBindgenVersion() {
  const lock = readFileSync(join(root, 'Cargo.lock'), 'utf8');
  const match = /name = "wasm-bindgen"\r?\nversion = "([^"]+)"/.exec(lock);
  if (!match?.[1]) throw new Error('wasm-bindgen not found in Cargo.lock');
  return match[1];
}

// `cargo install` puts binaries here, which is not on PATH when Rust came from
// a distro package rather than the rustup installer.
// https://doc.rust-lang.org/cargo/commands/cargo-install.html#description
const cargoBindgen = join(
  process.env.CARGO_INSTALL_ROOT ?? process.env.CARGO_HOME ?? join(homedir(), '.cargo'),
  'bin',
  process.platform === 'win32' ? 'wasm-bindgen.exe' : 'wasm-bindgen',
);
const bindgen = () => (existsSync(cargoBindgen) ? cargoBindgen : 'wasm-bindgen');

function installedBindgenVersion() {
  const result = spawnSync(bindgen(), ['--version'], { encoding: 'utf8' });
  if (result.error) return undefined;
  return /(\d+\.\d+\.\d+)/.exec(result.stdout)?.[1];
}

// The CLI must match the crate in Cargo.lock exactly, or wasm-bindgen fails
// with a schema error that does not name the fix. `--locked` keeps the
// one-time install from breaking on a newer transitive release.
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

run('cargo', ['build', '--package', 'gfa-wasm', '--target', 'wasm32-unknown-unknown', ...(dev ? [] : ['--release'])]);

run(bindgen(), [
  join(process.env.CARGO_TARGET_DIR ?? join(root, 'target'), 'wasm32-unknown-unknown', profile, 'gfa_wasm.wasm'),
  '--target',
  'web',
  '--out-dir',
  join(root, 'web', 'src', 'wasm', 'pkg'),
  ...(dev ? ['--debug', '--keep-debug'] : []),
]);
