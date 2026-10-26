// Times parsing of synthetic graphs natively and in Chromium (worker + WASM).
// Files are generated once into target/bench/ with gfa-gen.
//
// Usage: npm run bench:parse [-- --segments 200000,1000000]

import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { root, run } from './lib.mjs';

const out = join(root, 'target', 'bench');
const flag = process.argv.indexOf('--segments');
const sizes = (flag > 0 ? process.argv[flag + 1] : '200000').split(',').map(Number);

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
