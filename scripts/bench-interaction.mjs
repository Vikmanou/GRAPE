// Times interaction on large graphs in Chromium on the real GPU (headless
// through Vulkan): frame rates zoomed out and in, hover, click and box select
// answered by the engine, and a regex find, and writes bench/interaction.md.
//
// Usage: npm run bench:interaction                  the 200k and 1M synthetic graphs
//        npm run bench:interaction -- a.gfa b.gfa   these files instead

import { cpus, platform, release } from 'node:os';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { root, run, syntheticGraph } from './lib.mjs';

const out = join(root, 'target', 'bench', 'interaction');
mkdirSync(out, { recursive: true });
const given = process.argv.slice(2).map((path) => resolve(path));
const files = given.length > 0 ? given : [syntheticGraph(200_000), syntheticGraph(1_000_000)];

run('node', ['scripts/build-wasm.mjs']);
run('npx', ['playwright', 'install', 'chromium']);
run('npx', ['playwright', 'test', 'tests/e2e/interaction-bench.spec.ts', '--workers=1', '--reporter=list'], {
  cwd: join(root, 'web'),
  env: { ...process.env, GRAPE_GPU_HEADLESS: '1', GRAPE_INTERACTION_BENCH: JSON.stringify({ files, out }) },
});

const ms = (t) => (t && t.n > 0 ? `${t.median} ms (max ${t.max}, ${t.n})` : '–');
const lines = [
  '# Interaction benchmarks',
  '',
  `Written by \`npm run bench:interaction\` on ${new Date().toLocaleDateString('en-CA')}: ${cpus()[0]?.model ?? 'unknown CPU'},`,
  `${platform()} ${release()}, Playwright's Chromium on the real GPU. Times run from the input event to the`,
  "engine's answer, measured in the page: median, maximum and count. Zoomed in is 30 wheel steps from the",
  "fitted view. The find is a regex over every name. Tab memory is the page's renderer process after the",
  'graph settled, then after the measurements.',
  '',
  '| Graph | Segments | Zoomed out | Zoomed in | Hover | Click to selection | Box select | Regex find | Tab memory |',
  '|---|---:|---:|---:|---|---|---|---:|---|',
];
for (const path of files) {
  const r = JSON.parse(readFileSync(join(out, `${basename(path)}.json`), 'utf8'));
  lines.push(
    `| ${basename(path)} | ${r.segments.toLocaleString('en')} | ${r.fpsZoomedOut} fps | ${r.fpsZoomedIn} fps | ${ms(r.hoverMs)} | ${ms(r.clickMs)} | ${ms(r.boxSelectMs)} | ${r.findRegexMs} ms | ${r.tabMb} → ${r.tabMbAfter} MB |`,
  );
}
lines.push('');
writeFileSync(join(root, 'bench', 'interaction.md'), lines.join('\n'));
console.log('\nwrote bench/interaction.md');
