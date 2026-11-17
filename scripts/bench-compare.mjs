// Opens the same graphs in GRAPE, Bandage and BandageNG, five times each, and
// appends every run to bench/compare.json as soon as it ends. A rerun skips the
// runs already recorded, so the run can stop and carry on, here or on another
// machine with bench/compare.json copied over. scripts/compare-table.mjs turns
// the runs into bench/compare.md.
//
// Usage: node scripts/bench-compare.mjs [--runs 5] [--tools grape,bandage,bandageng]
//        [--graphs a.gfa,b.gfa] [--ledger other.json]   a subset, into another file

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { root, run, syntheticGraph } from './lib.mjs';
import {
  BANDAGE_VERSION,
  BANDAGENG_VERSION,
  bandage,
  bandageNg,
  grape,
  grapeVersion,
  machine,
  stageWsl,
} from './compare/tools.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const RUNS = Number(arg('--runs', '5'));
const TOOLS = arg('--tools', 'grape,bandage,bandageng').split(',');
const ONLY = arg('--graphs', '')?.split(',').filter(Boolean) ?? [];

// The bundled examples, the SPAdes isolate, then the spec's sizes, cheap to expensive.
const SAMPLES = [
  'human-mito-minigraph.gfa',
  'mitochondrion-acacia-spades.gfa',
  'chloroplast-acacia-unicycler.gfa',
  'bacterial-spades.gfa',
  'lpa-13-haplotypes.gfa',
];
const SYNTHETIC = [10_000, 50_000, 200_000, 1_000_000];
/** PNG export and BandageNG's layout-only run are timed on this graph. */
const EXPORT_GRAPH = '200000.gfa';

const ledger = arg('--ledger', join(root, 'bench', 'compare.json'));
const out = join(root, 'target', 'compare', 'out');
mkdirSync(out, { recursive: true });

const samples = SAMPLES.map((name) => join(root, 'samples', name));
const missing = samples.filter((path) => !existsSync(path));
if (missing.length > 0) {
  console.error(`missing: ${missing.join(', ')}\nrun \`npm run samples\``);
  process.exit(1);
}
const graphs = [
  ...samples.map((path) => ({ path, segments: countSegments(path) })),
  ...SYNTHETIC.map((segments) => ({ path: syntheticGraph(segments), segments })),
].filter((g) => ONLY.length === 0 || ONLY.includes(basename(g.path)));

function countSegments(path) {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.startsWith('S\t')).length;
}

const read = () => (existsSync(ledger) ? JSON.parse(readFileSync(ledger, 'utf8')) : { runs: [] });
function append(record) {
  const data = read();
  data.runs.push(record);
  writeFileSync(`${ledger}.tmp`, `${JSON.stringify(data, null, 1)}\n`);
  renameSync(`${ledger}.tmp`, ledger);
}
const recorded = (tool, graph, n, measure) =>
  read().runs.some((r) => r.tool === tool && r.graph === graph && r.run === n && r.measure === measure);

const here = machine();
const versions = { grape: grapeVersion(), bandage: BANDAGE_VERSION, bandageng: BANDAGENG_VERSION };
console.log(`machine: ${here}\nGRAPE ${versions.grape}, Bandage ${BANDAGE_VERSION}, BandageNG ${BANDAGENG_VERSION}`);

if (TOOLS.includes('grape')) {
  run('node', ['scripts/build-wasm.mjs']);
  run('npx', ['playwright', 'install', 'chromium'], { cwd: join(root, 'web') });
}
if (TOOLS.includes('bandage')) stageWsl(graphs.map((g) => g.path));

/** The size GRAPE's PNG came out at, so Bandage draws the same number of pixels. */
function pictureSize(graph) {
  const done = read().runs.find((r) => r.tool === 'grape' && r.graph === graph && r.width);
  return done ? [done.width, done.height] : [1200, 800];
}

function once(tool, graph, measure) {
  const name = basename(graph.path);
  const target = join(out, `${tool}-${name}`);
  if (tool === 'grape') {
    const r = grape({ file: graph.path, png: true });
    return r.status === 'ok' ? { ...r, ms: r.openMs } : r;
  }
  const [width, height] = pictureSize(name);
  const size = ['--height', String(height), '--width', String(width)];
  if (measure === 'layout') return bandageNg('layout', graph.path, [], `${target}.layout`);
  return tool === 'bandage'
    ? bandage('image', graph.path, size, `${target}.png`)
    : bandageNg('image', graph.path, size, `${target}.png`);
}

for (const graph of graphs) {
  const name = basename(graph.path);
  for (let n = 1; n <= RUNS; n++) {
    for (const tool of TOOLS) {
      const measures = tool === 'bandageng' && name === EXPORT_GRAPH ? ['open', 'layout'] : ['open'];
      for (const measure of measures) {
        if (recorded(tool, name, n, measure)) continue;
        const started = new Date();
        const result = once(tool, graph, measure);
        append({
          tool,
          version: versions[tool],
          graph: name,
          segments: graph.segments,
          run: n,
          measure,
          machine: here,
          date: started.toISOString(),
          ...result,
        });
        const seconds = result.ms === undefined ? '' : ` ${(result.ms / 1000).toFixed(2)} s`;
        const memory = result.peakMb === undefined ? '' : ` ${result.peakMb} MB`;
        const why = result.error ? ` (${result.error})` : '';
        console.log(
          `${started.toISOString()} ${tool} ${name} ${measure} #${n}: ${result.status}${seconds}${memory}${why}`,
        );
      }
    }
  }
}
console.log('\nall runs recorded in bench/compare.json; run node scripts/compare-table.mjs');
