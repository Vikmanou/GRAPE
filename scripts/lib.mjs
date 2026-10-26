// Shared by the scripts in this folder.

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// npm and npx are .cmd shims on Windows, which spawn can only start through a shell.
export const needsShell = (cmd) => process.platform === 'win32' && (cmd === 'npm' || cmd === 'npx');

/** Runs a command from the repo root with inherited output, and exits if it fails. */
export function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: needsShell(cmd), ...options });
  if (result.error) {
    console.error(`failed to start ${cmd}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
