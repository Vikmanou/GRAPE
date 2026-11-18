// Draws the same graphs in GRAPE, Bandage and BandageNG at the same size, and
// compares the GFA each saves of the same segments byte for byte. Writes the
// pictures to docs/benchmarks/screenshots/bandage and the outcome to docs/benchmarks/bandage.json,
// which scripts/compare-table.mjs puts beside the comparison table.
//
// Usage: node scripts/bench-bandage.mjs [--graphs a.gfa,b.gfa] [--report other.json]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { root, run, syntheticGraph } from './lib.mjs';
import { bandage, bandageNg, grape, stageWsl } from './compare/tools.mjs';

/** Segments GRAPE selects for the selection export: the first ones in the file. */
const SELECTED = 20;
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const only = arg('--graphs')?.split(',') ?? [];
const graphs = [
  join(root, 'data', 'samples', 'bacterial-spades.gfa'),
  join(root, 'data', 'samples', 'mitochondrion-acacia-spades.gfa'),
  join(root, 'data', 'samples', 'lpa-13-haplotypes.gfa'),
  syntheticGraph(200_000),
].filter((path) => only.length === 0 || only.includes(basename(path)));
const pictures = join(root, 'docs', 'benchmarks', 'screenshots', 'bandage');
const gfa = join(root, 'target', 'compare', 'gfa');
for (const dir of [pictures, gfa]) mkdirSync(dir, { recursive: true });

run('node', ['scripts/build-wasm.mjs']);
stageWsl(graphs);

/** "identical", or how many lines differ, with the first difference kept for the record. */
function compare(ours, theirs, label) {
  if (!existsSync(theirs)) return 'did not open';
  const a = readFileSync(ours);
  const b = readFileSync(theirs);
  if (a.equals(b)) return 'identical';
  const ourLines = a.toString('utf8').split('\n');
  const theirLines = b.toString('utf8').split('\n');
  const first = ourLines.findIndex((line, i) => line !== theirLines[i]);
  const counts = new Map();
  for (const line of ourLines) counts.set(line, (counts.get(line) ?? 0) + 1);
  for (const line of theirLines) counts.set(line, (counts.get(line) ?? 0) - 1);
  const unmatched = [...counts.values()].reduce((sum, n) => sum + Math.abs(n), 0);
  console.log(`${label}: first difference at line ${first + 1}`);
  console.log(`  GRAPE: ${ourLines[first]?.slice(0, 160)}`);
  console.log(`  other: ${theirLines[first]?.slice(0, 160)}`);
  return unmatched === 0
    ? `same lines in another order (${ourLines.length} lines)`
    : `differs (${unmatched} of ${ourLines.length + theirLines.length} lines unmatched)`;
}

const report = { width: 0, height: 0, selected: SELECTED, graphs: [] };
for (const path of graphs) {
  const graph = basename(path);
  const name = graph.replace(/\.gfa$/, '');
  const file = (tool, what) => join(gfa, `${name}-${tool}-${what}.gfa`);
  const ours = grape({
    file: path,
    png: true,
    picture: join(pictures, `${name}-grape.png`),
    selection: { count: SELECTED, path: file('grape', 'selection') },
    whole: file('grape', 'whole'),
  });
  if (ours.status !== 'ok') throw new Error(`GRAPE could not open ${graph}: ${ours.error}`);
  Object.assign(report, { width: ours.width, height: ours.height });
  const names = readFileSync(file('grape', 'selection'), 'utf8')
    .split('\n')
    .filter((line) => line.startsWith('S\t'))
    .map((line) => line.split('\t')[1]);
  const size = ['--height', String(ours.height), '--width', String(ours.width)];
  const scope = ['--scope', 'aroundnodes', '--nodes', names.join(','), '--distance', '0'];

  const entry = { graph, pictures: { grape: `screenshots/bandage/${name}-grape.png` }, exports: {} };
  for (const [tool, runTool] of [
    ['bandage', bandage],
    ['bandageng', bandageNg],
  ]) {
    const picture = join(pictures, `${name}-${tool}.png`);
    const drawn = runTool('image', path, size, picture);
    if (drawn.status === 'ok') entry.pictures[tool] = `screenshots/bandage/${name}-${tool}.png`;
    else console.log(`${tool} ${graph} image: ${drawn.status} ${drawn.error ?? ''}`);
    runTool('reduce', path, scope, file(tool, 'selection'));
    runTool('reduce', path, [], file(tool, 'whole'));
    entry.exports[tool] = {
      selection: compare(file('grape', 'selection'), file(tool, 'selection'), `${tool} ${graph} selection`),
      whole: compare(file('grape', 'whole'), file(tool, 'whole'), `${tool} ${graph} whole`),
    };
  }
  console.log(`${graph}: ${JSON.stringify(entry.exports)}`);
  report.graphs.push(entry);
}
writeFileSync(
  arg('--report') ?? join(root, 'docs', 'benchmarks', 'bandage.json'),
  `${JSON.stringify(report, null, 1)}\n`,
);
console.log('\nwrote docs/benchmarks/bandage.json and the pictures in docs/benchmarks/screenshots/bandage');
