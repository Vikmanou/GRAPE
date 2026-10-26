// Benchmarks the GPU layout in Chromium on the real GPU (headless through
// Vulkan, so a sleeping display cannot stall it), compares each layout with
// the CPU reference, and writes bench/results.md and a screenshot per graph.
// CPU reference layouts are cached in target/bench/cpu.
//
// Usage: npm run bench:layout                  the standard set below
//        npm run bench:layout -- a.gfa b.gfa   these files instead

import { spawnSync } from 'node:child_process';
import { cpus, platform, release } from 'node:os';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { root, run } from './lib.mjs';

const bench = join(root, 'target', 'bench');
const out = join(bench, 'layout');
const cpuCache = join(bench, 'cpu');
const shots = join(root, 'bench', 'screenshots');

// A bacterial isolate from the most common assembler, a real organelle
// assembly, a tangled pangenome region, a 20k-segment hifiasm graph and the
// spec's 200k-segment performance target.
const STANDARD = [
  'samples/bacterial-spades.gfa',
  'samples/mitochondrion-acacia-spades.gfa',
  'samples/lpa-13-haplotypes.gfa',
  'samples/potato-hifiasm-unitigs-noseq.gfa',
];
const SYNTHETIC_SEGMENTS = 200_000;

function synthetic(segments) {
  const path = join(bench, `${segments}.gfa`);
  if (!existsSync(path)) {
    run('cargo', ['run', '-q', '-p', 'gfa-gen', '--release', '--', '--segments', String(segments), '--out', path]);
  }
  return path;
}

const given = process.argv.slice(2).map((path) => resolve(path));
for (const dir of [out, cpuCache]) mkdirSync(dir, { recursive: true });
const files = given.length > 0 ? given : [...STANDARD.map((path) => join(root, path)), synthetic(SYNTHETIC_SEGMENTS)];
const missing = files.filter((path) => !existsSync(path));
if (missing.length > 0) {
  console.error(`missing: ${missing.join(', ')}\nrun \`npm run samples -- --large\` for the standard set`);
  process.exit(1);
}
rmSync(shots, { recursive: true, force: true });
mkdirSync(shots, { recursive: true });

run('node', ['scripts/build-wasm.mjs']);
run('npx', ['playwright', 'install', 'chromium']);
run('npx', ['playwright', 'test', 'tests/e2e/layout-bench.spec.ts', '--workers=1', '--retries=1', '--reporter=list'], {
  cwd: join(root, 'web'),
  env: {
    ...process.env,
    GRAPE_GPU_HEADLESS: '1',
    GRAPE_LAYOUT_BENCH: JSON.stringify({ files, out, screenshots: shots }),
  },
});

/** The comparator reads plain GFA; the browser handled gzip itself. */
function plainCopy(path) {
  if (!path.endsWith('.gz')) return path;
  const copy = join(out, basename(path, '.gz'));
  if (!existsSync(copy)) writeFileSync(copy, gunzipSync(readFileSync(path)));
  return copy;
}

const rows = [];
for (const path of files) {
  const name = basename(path);
  const timing = JSON.parse(readFileSync(join(out, `${name}.json`), 'utf8'));
  const compared = spawnSync(
    'cargo',
    [
      'run',
      '-q',
      '-p',
      'gfa-core',
      '--release',
      '--example',
      'compare_layout',
      '--',
      plainCopy(path),
      join(out, `${name}.gpu.f32`),
      '--cpu-cache',
      join(cpuCache, `${name}.f32`),
    ],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  );
  if (compared.status !== 0) process.exit(compared.status ?? 1);
  rows.push({ name, timing, quality: JSON.parse(compared.stdout) });
}

/** The tolerance agreed for milestone 3: within 15%, or 0.1% of points for overlaps. */
function verdict({ cpu, gpu, points }) {
  const cv = gpu.edgeCv <= cpu.edgeCv * 1.15;
  const overlaps = gpu.overlaps <= Math.max(cpu.overlaps * 1.15, cpu.overlaps + points * 0.001);
  return cv && overlaps
    ? 'yes'
    : `**no** (${[cv ? '' : 'edge CV', overlaps ? '' : 'overlaps'].filter(Boolean).join(', ')})`;
}

const seconds = (ms) => (ms === undefined || Number.isNaN(ms) ? '–' : `${(ms / 1000).toFixed(1)} s`);
const adapter = readFileSync(join(out, 'adapter.txt'), 'utf8') || 'unknown GPU';
const lines = [
  '# Benchmarks',
  '',
  `Written by \`npm run bench:layout\` on ${new Date().toLocaleDateString('en-CA')}: ${cpus()[0]?.model ?? 'unknown CPU'},`,
  `GPU ${adapter}, ${platform()} ${release()}, Playwright's Chromium.`,
  '',
  '## GPU layout against the CPU reference',
  '',
  'Both use the same coarsening, seed (1) and iteration budget (Balanced); the',
  'GPU replaces Barnes-Hut repulsion with the spatial grid. Edge CV is the',
  'coefficient of variation of spring length over rest length, lower is',
  'better; overlaps count points of different segments closer than 2.5 units.',
  'The GPU passes when it is no more than 15% worse on both, with overlaps',
  'also allowed 0.1% of the point count.',
  '',
  '| Graph | Segments | Points | Edge CV CPU | Edge CV GPU | Overlaps CPU | Overlaps GPU | Within tolerance |',
  '|---|---:|---:|---:|---:|---:|---:|---|',
];
for (const { name, quality: q } of rows) {
  lines.push(
    `| ${name} | ${q.segments.toLocaleString('en')} | ${q.points.toLocaleString('en')} | ${q.cpu.edgeCv.toFixed(3)} | ${q.gpu.edgeCv.toFixed(3)} | ${q.cpu.overlaps.toLocaleString('en')} | ${q.gpu.overlaps.toLocaleString('en')} | ${verdict(q)} |`,
  );
}
const target = rows.find((r) => r.name === `${SYNTHETIC_SEGMENTS}.gfa`);
if (target) {
  const t = target.timing;
  lines.push(
    '',
    '## 200k-segment synthetic graph against the spec targets',
    '',
    '`gfa-gen --segments 200000`, 191 MB. Layout times count from opening the',
    'file, parse included, with the time after parsing in brackets. First',
    'usable: refined to level 3 and packed. Frame rates are what the GPU keeps',
    "up with while panning and zooming every frame. Tab memory is the page's",
    'renderer process (the page and its workers) after the layout settled;',
    "Chromium's GPU process, shared by all tabs, is listed apart.",
    '',
    '| Measure | Target | Measured |',
    '|---|---|---|',
    `| Parse | < 5 s | ${seconds(t.parseMs)} |`,
    `| First usable layout | < 15 s | ${seconds(t.parseMs + t.usableMs)} (${seconds(t.usableMs)} after parsing) |`,
    `| Settled layout | < 60 s | ${seconds(t.parseMs + t.settledMs)} (${seconds(t.settledMs)} after parsing) |`,
    `| Interaction, zoomed in | 60 fps | ${t.fpsZoomedIn ?? '–'} fps |`,
    `| Interaction, zoomed out | 30+ fps | ${t.fpsZoomedOut ?? '–'} fps |`,
    `| Tab memory | < 1 GB | ${t.tabMb ?? '–'} MB (GPU process ${t.gpuProcessMb ?? '–'} MB) |`,
  );
}
lines.push(
  '',
  '## Every graph',
  '',
  '| Graph | Parse | First usable | Settled | Tab memory | GPU process | Zoomed out | Zoomed in |',
  '|---|---:|---:|---:|---:|---:|---:|---:|',
  ...rows.map(
    ({ name, timing: t }) =>
      `| ${name} | ${seconds(t.parseMs)} | ${seconds(t.usableMs)} | ${seconds(t.settledMs)} | ${t.tabMb ?? '–'} MB | ${t.gpuProcessMb ?? '–'} MB | ${t.fpsZoomedOut ?? '–'} | ${t.fpsZoomedIn ?? '–'} |`,
  ),
  '',
);
writeFileSync(join(root, 'bench', 'results.md'), lines.join('\n'));
console.log(`\nwrote bench/results.md and ${files.length} screenshots in bench/screenshots`);
