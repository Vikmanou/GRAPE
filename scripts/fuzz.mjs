// Fuzzes the parser and the link packer with cargo-fuzz, each for the given time. Installs the nightly toolchain and
// cargo-fuzz when missing, seeds the corpus from data/fixtures/.
//
// Usage: npm run fuzz [-- --minutes N]   (default 10)

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { root, run } from './lib.mjs';

const CARGO_FUZZ = '0.13.2';
const fuzzDir = join(root, 'crates', 'gfa-core', 'fuzz');
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

for (const target of ['parse', 'pack']) {
  const corpus = join(fuzzDir, 'corpus', target);
  mkdirSync(corpus, { recursive: true });
  for (const name of readdirSync(join(root, 'data', 'fixtures'))) {
    if (!name.endsWith('.gz') && name !== 'README.md' && name !== 'manifest.json')
      copyFileSync(join(root, 'data', 'fixtures', name), join(corpus, name));
  }
  run('cargo', ['+nightly', 'fuzz', 'run', target, '--', `-max_total_time=${Math.round(minutes * 60)}`], {
    cwd: fuzzDir,
  });
}
