// Prints a markdown table of built asset sizes (raw and gzip). In GitHub
// Actions it also appends the table to the job summary.
//
// Usage: node scripts/size-report.mjs (after the site is built)

import { appendFileSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';
import { root } from './lib.mjs';

const distDir = join(root, 'web', 'dist');

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`;

let files;
try {
  files = walk(distDir);
} catch {
  console.error(`no build output at ${distDir}; run npm run build first`);
  process.exit(1);
}

const rows = files
  .map((path) => {
    const bytes = readFileSync(path);
    return { name: relative(distDir, path).replaceAll('\\', '/'), raw: bytes.length, gzip: gzipSync(bytes).length };
  })
  .sort((a, b) => b.raw - a.raw);

const total = rows.reduce((sum, row) => ({ raw: sum.raw + row.raw, gzip: sum.gzip + row.gzip }), { raw: 0, gzip: 0 });

const table = [
  '## Bundle size',
  '',
  '| File | Raw | Gzip |',
  '| --- | ---: | ---: |',
  ...rows.map((row) => `| ${row.name} | ${kb(row.raw)} | ${kb(row.gzip)} |`),
  `| **Total** | **${kb(total.raw)}** | **${kb(total.gzip)}** |`,
  '',
].join('\n');

console.log(table);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, table);
