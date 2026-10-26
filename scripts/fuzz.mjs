// Fuzzes the parser with cargo-fuzz. Installs the nightly toolchain and
// cargo-fuzz when missing, seeds the corpus from testdata/.
//
// Usage: npm run fuzz [-- --minutes N]   (default 10)

import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
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

const env = { ...process.env };
if (process.platform === 'win32') {
  // MSVC's AddressSanitizer runtime is a DLL the fuzz binary loads at start,
  // and Visual Studio does not put it on PATH.
  const asan = msvcAsanDir();
  if (!asan) {
    console.error('AddressSanitizer runtime not found; install the MSVC C++ build tools');
    process.exit(1);
  }
  env.PATH = `${asan};${env.PATH}`;
}

run('cargo', ['+nightly', 'fuzz', 'run', 'parse', '--', `-max_total_time=${Math.round(minutes * 60)}`], {
  cwd: fuzzDir,
  env,
});

function msvcAsanDir() {
  const vswhere = join(process.env['ProgramFiles(x86)'] ?? '', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  if (!existsSync(vswhere)) return undefined;
  const vs = execFileSync(vswhere, ['-latest', '-products', '*', '-property', 'installationPath'], {
    encoding: 'utf8',
  }).trim();
  const tools = join(vs, 'VC', 'Tools', 'MSVC');
  if (!existsSync(tools)) return undefined;
  for (const version of readdirSync(tools).sort().reverse()) {
    const dir = join(tools, version, 'bin', 'Hostx64', 'x64');
    if (existsSync(join(dir, 'clang_rt.asan_dynamic-x86_64.dll'))) return dir;
  }
  return undefined;
}
