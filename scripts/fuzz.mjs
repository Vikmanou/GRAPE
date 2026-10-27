// Fuzzes the parser with cargo-fuzz. Installs the nightly toolchain and
// cargo-fuzz when missing, seeds the corpus from testdata/.
//
// Usage: npm run fuzz [-- --minutes N]   (default 10)

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { root, run } from './lib.mjs';

const CARGO_FUZZ = '0.13.2';
const fuzzDir = join(root, 'fuzz');
const minutesFlag = process.argv.indexOf('--minutes');
const minutes = minutesFlag > 0 ? Number(process.argv[minutesFlag + 1]) : 10;

function succeeds(cmd, args) {
  return spawnSync(cmd, args, { stdio: 'ignore' }).status === 0;
}

if (!succeeds('rustup', ['run', 'nightly', 'rustc', '--version'])) {
  run('rustup', ['toolchain', 'install', 'nightly', '--profile', 'minimal']);
}
const installed = spawnSync('cargo', ['fuzz', '--version'], { encoding: 'utf8' }).stdout ?? '';
if (!installed.includes(CARGO_FUZZ)) {
  run('cargo', ['install', 'cargo-fuzz', '--version', CARGO_FUZZ, '--locked']);
}

const corpus = join(fuzzDir, 'corpus', 'parse');
mkdirSync(corpus, { recursive: true });
for (const name of readdirSync(join(root, 'testdata'))) {
  if (!name.endsWith('.gz')) copyFileSync(join(root, 'testdata', name), join(corpus, name));
}

run('cargo', ['+nightly', 'fuzz', 'run', 'parse', '--', `-max_total_time=${Math.round(minutes * 60)}`], {
  cwd: fuzzDir,
});
