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
import { root, run, syntheticGraph } from './lib.mjs';
import { checkMemory, tabTargetMb } from './memory-budgets.mjs';

const bench = join(root, 'target', 'bench');
const out = join(bench, 'layout');
const cpuCache = join(bench, 'cpu');
const shots = join(root, 'bench', 'screenshots');

// A bacterial isolate from the most common assembler, a real organelle
// assembly, a tangled pangenome region, a 20k-segment hifiasm graph and the
// spec's 200k-segment and 1M-segment performance targets.
const STANDARD = [
  'samples/bacterial-spades.gfa',
  'samples/mitochondrion-acacia-spades.gfa',
  'samples/lpa-13-haplotypes.gfa',
  'samples/potato-hifiasm-unitigs-noseq.gfa',
];
const SYNTHETIC = [200_000, 1_000_000];
/** The CPU reference on the 200k graph before budgets scaled with level size (milestone 3). */
const M3_REFERENCE = { '200000.gfa': { edgeCv: 0.725, overlaps: 1059 } };

const given = process.argv.slice(2).map((path) => resolve(path));
for (const dir of [out, cpuCache]) mkdirSync(dir, { recursive: true });
const files =
  given.length > 0 ? given : [...STANDARD.map((path) => join(root, path)), ...SYNTHETIC.map(syntheticGraph)];
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

/**
 * The tolerance agreed for milestone 3: within 15%, or 0.1% of points for
 * overlaps, of the CPU reference and, where recorded, of the milestone 3
 * reference too, so both cannot get worse together.
 */
function verdict(name, { cpu, gpu, points }) {
  const references = [cpu, M3_REFERENCE[name]].filter(Boolean);
  const cv = references.every((r) => gpu.edgeCv <= r.edgeCv * 1.15);
  const overlaps = references.every((r) => gpu.overlaps <= Math.max(r.overlaps * 1.15, r.overlaps + points * 0.001));
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
    `| ${name} | ${q.segments.toLocaleString('en')} | ${q.points.toLocaleString('en')} | ${q.cpu.edgeCv.toFixed(3)} | ${q.gpu.edgeCv.toFixed(3)} | ${q.cpu.overlaps.toLocaleString('en')} | ${q.gpu.overlaps.toLocaleString('en')} | ${verdict(name, q)} |`,
  );
}
const TARGETS = {
  200_000: { label: '200k', parse: 5, usable: 15, settled: 60, zoomedIn: '60', zoomedOut: '30+', tab: '1 GB' },
  1_000_000: { label: '1M', parse: 20, usable: 60, settled: 180, zoomedIn: '30+', zoomedOut: '–', tab: '2 GB' },
};
for (const [segments, goal] of Object.entries(TARGETS)) {
  const target = rows.find((r) => r.name === `${segments}.gfa`);
  if (!target) continue;
  const t = target.timing;
  lines.push(
    '',
    `## ${goal.label}-segment synthetic graph against the spec targets`,
    '',
    `\`gfa-gen --segments ${segments}\`. Layout times count from opening the`,
    'file, parse included, with the time after parsing in brackets. First',
    'usable: refined to level 3 and packed. Frame rates are what the GPU keeps',
    "up with while panning and zooming every frame. Tab memory is the page's",
    'renderer process (the page and its workers) after the layout settled;',
    "Chromium's GPU process, shared by all tabs, is listed apart.",
    '',
    '| Measure | Target | Measured |',
    '|---|---|---|',
    `| Parse | < ${goal.parse} s | ${seconds(t.parseMs)} |`,
    `| First usable layout | < ${goal.usable} s | ${seconds(t.parseMs + t.usableMs)} (${seconds(t.usableMs)} after parsing) |`,
    `| Settled layout | < ${goal.settled} s | ${seconds(t.parseMs + t.settledMs)} (${seconds(t.settledMs)} after parsing) |`,
    `| Interaction, zoomed in | ${goal.zoomedIn} fps | ${t.fpsZoomedIn ?? '–'} fps |`,
    `| Interaction, zoomed out | ${goal.zoomedOut} fps | ${t.fpsZoomedOut ?? '–'} fps |`,
    `| Tab memory | < ${goal.tab} | ${t.tabMb ?? '–'} MB (GPU process ${t.gpuProcessMb ?? '–'} MB) |`,
    '',
    'Per level: GPU time from timestamp queries, wall time from the',
    "level's first batch to the next level's.",
    '',
    '| Level | Nodes | Iterations | GPU | Wall |',
    '|---:|---:|---:|---:|---:|',
    ...(t.levels ?? []).map(
      (l) =>
        `| ${l.level} | ${l.nodes.toLocaleString('en')} | ${l.iterations} | ${seconds(l.gpuMs)} | ${seconds(l.wallMs)} |`,
    ),
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
const over = [];
lines.push(
  '',
  '## Memory against the budgets',
  '',
  'What each part of the page holds once the layout settled, in MB, against',
  'its budget in `scripts/memory-budgets.mjs`. Workers count their WASM memory',
  'and the arrays they keep; the main thread its JS heap and its typed arrays.',
  '',
  '| Graph | Tab | Main heap | Main arrays | GPU | Graph worker | Sequence worker | Layout worker |',
  '|---|---:|---:|---:|---:|---:|---:|---:|',
);
for (const { name, timing: t, quality: q } of rows) {
  if (!t.memory) continue;
  const parts = checkMemory(t.memory, q.segments);
  const tabOk = t.tabMb === undefined || t.tabMb <= tabTargetMb(q.segments);
  if (!tabOk) over.push(`${name}: tab ${t.tabMb} MB`);
  for (const p of parts)
    if (!p.ok) over.push(`${name}: ${p.name} ${p.mb.toFixed(0)} MB over ${p.budget.toFixed(0)} MB`);
  const cell = (p) => `${p.mb.toFixed(0)} / ${p.budget.toFixed(0)}${p.ok ? '' : ' **over**'}`;
  lines.push(
    `| ${name} | ${t.tabMb ?? '–'} / ${tabTargetMb(q.segments)}${tabOk ? '' : ' **over**'} | ${parts.map(cell).join(' | ')} |`,
  );
}
lines.push('');
writeFileSync(join(root, 'bench', 'results.md'), lines.join('\n'));
console.log(`\nwrote bench/results.md and ${files.length} screenshots in bench/screenshots`);
if (over.length > 0) {
  console.error(`over the memory budget:\n  ${over.join('\n  ')}`);
  process.exit(1);
}
