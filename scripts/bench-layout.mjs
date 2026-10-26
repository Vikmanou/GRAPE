// Benchmarks the GPU layout in Chromium on the real GPU (headless through
// Vulkan, so a sleeping display cannot stall it) and compares each result
// with the CPU reference, then writes bench/results.md.
// CPU reference layouts are cached in target/bench/cpu, since the 200k graph
// takes minutes.
//
// Usage: npm run bench:layout [-- --stress]   (--stress adds a 1M-segment graph)

import { spawnSync } from 'node:child_process';
import { cpus, platform, release } from 'node:os';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bench = join(root, 'target', 'bench');
const out = join(bench, 'layout');
const cpuCache = join(bench, 'cpu');
const shots = join(root, 'bench', 'screenshots');
const stress = process.argv.includes('--stress');
for (const dir of [out, cpuCache, shots]) mkdirSync(dir, { recursive: true });

function run(cmd, args, options = {}) {
  // npx is a .cmd shim on Windows, which spawn can only start through a shell.
  const shell = process.platform === 'win32' && cmd === 'npx';
  const result = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell, ...options });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function synthetic(segments) {
  const path = join(bench, `${segments}.gfa`);
  if (!existsSync(path)) {
    run('cargo', ['run', '-q', '-p', 'gfa-gen', '--release', '--', '--segments', String(segments), '--out', path]);
  }
  return path;
}

const testdata = ['linear', 'circle', 'bubble', 'tip', 'tangle', 'two_components', 'self_loop', 'palindrome'].map(
  (name) => join(root, 'testdata', `${name}.gfa`),
);
const samples = existsSync(join(root, 'samples'))
  ? readdirSync(join(root, 'samples'))
      .filter((name) => /\.gfa(\.gz)?$/.test(name))
      .sort()
      .map((name) => join(root, 'samples', name))
  : [];
const large = [synthetic(200_000), ...(stress ? [synthetic(1_000_000)] : [])];
// The CPU reference on these would take the better part of an hour each.
const withoutReference = ['1000000.gfa', 'myxococcus-10-assemblies.gfa.gz'];
const files = [...testdata, ...samples, ...large];
const sample = (name) => join(root, 'samples', name);
const pictured = ['mitochondrion-acacia-spades.gfa', 'brca2-cactus.gfa', 'lpa-13-haplotypes.gfa']
  .map(sample)
  .filter(existsSync);

run('node', ['scripts/build-wasm.mjs']);
run('npx', ['playwright', 'install', 'chromium']);
run('npx', ['playwright', 'test', 'tests/e2e/layout-bench.spec.ts', '--workers=1', '--retries=1', '--reporter=list'], {
  cwd: join(root, 'web'),
  env: {
    ...process.env,
    GRAPE_GPU_HEADLESS: '1',
    GRAPE_LAYOUT_BENCH: JSON.stringify({
      files,
      out,
      screenshots: { dir: shots, gpu: [...pictured, large[0]], cpu: pictured },
      interaction: files.filter((path) => large.includes(path) || withoutReference.includes(basename(path))),
    }),
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
  const compared = withoutReference.includes(name)
    ? undefined
    : spawnSync(
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
  if (compared && compared.status !== 0) process.exit(compared.status ?? 1);
  rows.push({ name, timing, quality: compared ? JSON.parse(compared.stdout) : undefined });
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
  `Written by \`npm run bench:layout\` on ${new Date().toISOString().slice(0, 10)}: ${cpus()[0]?.model ?? 'unknown CPU'},`,
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
  if (!q) continue;
  lines.push(
    `| ${name} | ${q.segments.toLocaleString('en')} | ${q.points.toLocaleString('en')} | ${q.cpu.edgeCv.toFixed(3)} | ${q.gpu.edgeCv.toFixed(3)} | ${q.cpu.overlaps.toLocaleString('en')} | ${q.gpu.overlaps.toLocaleString('en')} | ${verdict(q)} |`,
  );
}
const target = rows.find((r) => r.name === '200000.gfa');
if (target) {
  const t = target.timing;
  lines.push(
    '',
    '## 200k-segment synthetic graph against the spec targets',
    '',
    '`gfa-gen --segments 200000`, 191 MB. First usable: refined to level 3 and',
    'packed. Frame rates are what the GPU keeps up with while panning and',
    "zooming every frame. Tab memory is the resident size of the page's",
    'renderer process (the page and its workers) after the layout settled;',
    "Chromium's GPU process, shared by all tabs, is listed apart.",
    '',
    '| Measure | Target | Measured |',
    '|---|---|---|',
    `| Parse | < 5 s | ${seconds(t.parseMs)} |`,
    `| First usable layout | < 15 s | ${seconds(t.usableMs)} |`,
    `| Settled layout | < 60 s | ${seconds(t.settledMs)} |`,
    `| Interaction, zoomed in | 60 fps | ${t.fpsZoomedIn ?? '–'} fps |`,
    `| Interaction, zoomed out | 30+ fps | ${t.fpsZoomedOut ?? '–'} fps |`,
    `| Tab memory | < 1 GB | ${t.tabMb ?? '–'} MB (GPU process ${t.gpuProcessMb ?? '–'} MB) |`,
  );
  if (target.quality?.cpuMs)
    lines.push('', `The CPU reference took ${seconds(target.quality.cpuMs)} natively on this graph.`);
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
console.log(`\nwrote bench/results.md and ${pictured.length * 2 + 1} screenshots in bench/screenshots`);
