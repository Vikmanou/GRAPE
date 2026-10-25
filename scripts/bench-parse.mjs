// Times parsing of synthetic graphs natively and in Chromium (worker + WASM).
// Files are generated once into target/bench/ with gfa-gen.
//
// Usage: npm run bench:parse [-- --segments 200000,1000000]

import { spawnSync } from 'node:child_process';
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { createGzip } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'target', 'bench');
const flag = process.argv.indexOf('--segments');
const sizes = (flag > 0 ? process.argv[flag + 1] : '200000').split(',').map(Number);

function run(cmd, args, options = {}) {
  // npx is a .cmd shim on Windows, which spawn can only start through a shell.
  const shell = process.platform === 'win32' && cmd === 'npx';
  const result = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell, ...options });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

mkdirSync(out, { recursive: true });
const files = [];
for (const segments of sizes) {
  const plain = join(out, `${segments}.gfa`);
  if (!existsSync(plain)) {
    run('cargo', ['run', '-q', '-p', 'gfa-gen', '--release', '--', '--segments', String(segments), '--out', plain]);
  }
  const gz = `${plain}.gz`;
  if (!existsSync(gz)) await pipeline(createReadStream(plain), createGzip(), createWriteStream(gz));
  console.log(
    `\n${plain}: ${(statSync(plain).size / 1e6).toFixed(1)} MB, gzipped ${(statSync(gz).size / 1e6).toFixed(1)} MB`,
  );
  run('cargo', ['run', '-q', '-p', 'gfa-core', '--release', '--example', 'parse_file', '--', plain]);
  files.push(plain, gz);
}

run('node', ['scripts/build-wasm.mjs']);
run('npx', ['playwright', 'test', 'tests/e2e/bench.spec.ts', '--reporter=list'], {
  cwd: join(root, 'web'),
  env: { ...process.env, GRAPE_BENCH_FILES: files.join(',') },
});
