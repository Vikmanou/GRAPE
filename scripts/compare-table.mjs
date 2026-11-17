// Turns bench/compare.json (scripts/bench-compare.mjs) and bench/bandage.json
// (scripts/bench-bandage.mjs) into bench/compare.md, docs/benchmarks.md and the
// comparison section of the README.
//
// Usage: node scripts/compare-table.mjs

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './lib.mjs';

const RUNS = 5;
/** Two values within 5% of each other tie, and every tied value is bold. */
const TIE = 1.05;
const TOOLS = [
  ['grape', 'GRAPE'],
  ['bandage', 'Bandage'],
  ['bandageng', 'BandageNG'],
];
const LADDER = ['10000.gfa', '50000.gfa', '200000.gfa', '1000000.gfa'];

const { runs } = JSON.parse(readFileSync(join(root, 'bench', 'compare.json'), 'utf8'));
const pairs = existsSync(join(root, 'bench', 'bandage.json'))
  ? JSON.parse(readFileSync(join(root, 'bench', 'bandage.json'), 'utf8'))
  : undefined;

const median = (values) => {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const of = (tool, graph, measure = 'open') =>
  runs.filter((r) => r.tool === tool && r.graph === graph && r.measure === measure);
const seconds = (ms) => (ms < 10_000 ? (ms / 1000).toFixed(2) : (ms / 1000).toFixed(1));

/**
 * One measured value of a tool: the median of the runs that finished, with
 * their range, or why there is none. A value counts only when most runs finished.
 */
function measured(list, pick, unit, format) {
  if (list.length < RUNS) return { pending: true };
  const ok = list.filter((r) => r.status === 'ok').map(pick);
  if (ok.length * 2 <= list.length) {
    const opened = list.some((r) => r.status === 'failed' && /malformed|could not load|unable/i.test(r.error ?? ''));
    return { text: opened ? 'did not open' : 'did not finish', machines: list.map((r) => r.machine) };
  }
  const value = median(ok);
  const range = ok.length > 1 ? ` (${format(Math.min(...ok))}–${format(Math.max(...ok))})` : '';
  return { value, text: `${format(value)} ${unit}${range}`, machines: list.map((r) => r.machine) };
}

const openRow = (graph, label) => ({
  label,
  cells: TOOLS.map(([tool]) => measured(of(tool, graph), (r) => r.ms, 's', seconds)),
});

function exportRow() {
  const graph = '200000.gfa';
  return {
    label: 'Export a PNG at 200k segments (s)',
    cells: TOOLS.map(([tool]) => {
      if (tool === 'grape') return measured(of(tool, graph), (r) => r.exportMs, 's', seconds);
      if (tool === 'bandage') return { text: 'no layout-only command', machines: [] };
      const image = measured(of(tool, graph), (r) => r.ms, 's', seconds);
      const layout = measured(of(tool, graph, 'layout'), (r) => r.ms, 's', seconds);
      if (image.pending || layout.pending) return { pending: true };
      if (image.value === undefined || layout.value === undefined)
        return { text: image.text, machines: image.machines };
      const value = Math.max(0, image.value - layout.value);
      return { value, text: `${seconds(value)} s`, machines: [...image.machines, ...layout.machines] };
    }),
  };
}

/** The largest graph of the ladder whose runs mostly finished; higher is better. */
function largestRow() {
  return {
    label: 'Largest graph laid out within 30 min (segments)',
    higher: true,
    cells: TOOLS.map(([tool]) => {
      const sizes = LADDER.map((graph) => ({ graph, list: of(tool, graph) }));
      if (sizes.some(({ list }) => list.length < RUNS)) return { pending: true };
      const done = sizes.filter(({ list }) => list.filter((r) => r.status === 'ok').length * 2 > list.length);
      const machines = sizes.flatMap(({ list }) => list.map((r) => r.machine));
      if (done.length === 0) return { text: 'none of the sizes', machines };
      const value = Number(done.at(-1).graph.replace('.gfa', ''));
      return { value, text: value.toLocaleString('en'), machines };
    }),
  };
}

const rows = [
  openRow('10000.gfa', 'Open to a laid-out picture, 10k segments (s)'),
  openRow('50000.gfa', 'Open to a laid-out picture, 50k segments (s)'),
  openRow('200000.gfa', 'Open to a laid-out picture, 200k segments (s)'),
  {
    label: 'Peak memory at 200k segments (MB)',
    cells: TOOLS.map(([tool]) =>
      measured(
        of(tool, '200000.gfa'),
        (r) => r.peakMb,
        'MB',
        (v) => Math.round(v).toLocaleString('en'),
      ),
    ),
  },
  largestRow(),
  exportRow(),
];

/** A row's cells with the best value and its ties in bold, or the whole row marked pending. */
function render(row) {
  const machines = new Set(row.cells.flatMap((c) => c.machines ?? []));
  if (row.cells.some((c) => c.pending) || machines.size > 1)
    return `| ${row.label} | ${row.cells.map((c) => (c.pending ? 'pending' : c.text)).join(' | ')} |`;
  const values = row.cells.map((c) => c.value).filter((v) => v !== undefined);
  const best = row.higher ? Math.max(...values) : Math.min(...values);
  const ties = (v) => (row.higher ? v * TIE >= best : v <= best * TIE);
  const cell = (c) => (c.value !== undefined && values.length > 1 && ties(c.value) ? `**${c.text}**` : c.text);
  return `| ${row.label} | ${row.cells.map(cell).join(' | ')} |`;
}

const pendingRows = rows.filter((r) => render(r).includes('pending') || !render(r).includes('**'));
const all = runs.filter((r) => r.measure === 'open');
const dates = all.map((r) => r.date.slice(0, 10)).sort();
const machineList = [...new Set(all.map((r) => r.machine))];
const grapeVersions = [...new Set(all.filter((r) => r.tool === 'grape').map((r) => r.version))].join(', ');

const table = ['| Measure | GRAPE | Bandage | BandageNG |', '| --- | ---: | ---: | ---: |', ...rows.map(render)];
const examples = [
  '| Example (segments) | GRAPE | Bandage | BandageNG |',
  '| --- | ---: | ---: | ---: |',
  ...[...new Set(all.filter((r) => !LADDER.includes(r.graph)).map((r) => r.graph))].map((graph) =>
    render(
      openRow(
        graph,
        `${graph.replace(/\.gfa$/, '')} (${all.find((r) => r.graph === graph).segments.toLocaleString('en')})`,
      ),
    ),
  ),
];
const footer = [
  `Each value is the median of ${RUNS} runs, with the fastest and slowest in brackets;`,
  'the lowest value wins each row (the highest for the largest graph) and is in bold, and a',
  'value within 5% of it ties and is bold too. A row marked pending is still missing runs or',
  'mixes machines. "Did not finish" means most runs hit the 30 min cap or failed.',
  '',
  `Versions: GRAPE ${grapeVersions || '–'} (WebGPU layout, Balanced quality, seed 1, in Playwright's`,
  'Chromium headless on the real GPU), Bandage 0.9.0 (Linux AppImage under WSL 2, `--iter 2`, the',
  'default) and BandageNG 2026.11.1 (Windows build, default layout, `--iter 2`). Machine:',
  `${machineList.join('; ') || '–'}. Runs from ${dates[0] ?? '–'} to ${dates.at(-1) ?? '–'}.`,
  '',
  'Open to a laid-out picture: GRAPE from choosing the file to the layout reported done,',
  'timed in the page, with the page already loaded; Bandage and BandageNG the wall time of `image`',
  "at the same size as GRAPE's PNG (1200 by 800), which starts the program, loads, lays out",
  "and draws. Peak memory: GRAPE's renderer plus GPU process, each at its own peak working",
  "set; BandageNG's peak working set; Bandage's maximum resident set from `/usr/bin/time -v`.",
  "PNG export: GRAPE's `exportPng` of the settled view; BandageNG's `image` minus its `layout`;",
  'Bandage 0.9.0 has no layout-only command, so its export cannot be timed apart.',
  '',
  'Search by segment name is not compared: neither Bandage tool has it on the command line.',
  'Pan and zoom have no counterpart there either; GRAPE keeps them smooth on the 1M graph',
  '(frame rates in [bench/interaction.md](interaction.md)). The layouts differ (Bandage and',
  'BandageNG lay out on the CPU with OGDF, GRAPE on the GPU), so judge the pictures below.',
];

/** Draw times of the graphs in the picture pairs, from the same runs as the table. */
function drawRow(graph) {
  const grape = of('grape', graph);
  const usable = measured(grape, (r) => r.parseMs + r.usableMs, 's', seconds);
  const settled = measured(grape, (r) => r.ms, 's', seconds);
  const draw = (tool) => measured(of(tool, graph), (r) => r.ms, 's', seconds);
  const cell = (c) => (c.pending ? 'pending' : c.text);
  return `| ${graph} | ${[usable, settled, draw('bandage'), draw('bandageng')].map(cell).join(' | ')} |`;
}

const pictureTable = pairs
  ? [
      '',
      '## Against Bandage',
      '',
      "Draw time is the median open time of the table's runs: GRAPE to its first usable layout",
      '(refined to level 3 and packed) and to the settled layout; Bandage and BandageNG to the',
      'written image, the only picture they show.',
      '',
      '| Graph | GRAPE first usable | GRAPE settled | Bandage | BandageNG |',
      '| --- | ---: | ---: | ---: | ---: |',
      ...pairs.graphs.map((g) => drawRow(g.graph)),
      '',
      `The same graph as each tool exports it, at ${pairs.width} by ${pairs.height} pixels.`,
      '',
      '| Graph | GRAPE | Bandage | BandageNG |',
      '| --- | --- | --- | --- |',
      ...pairs.graphs.map(
        (g) =>
          `| ${g.graph} | ${TOOLS.map(([t]) => (g.pictures[t] ? `![${g.graph} in ${t}](${g.pictures[t]})` : 'did not open')).join(' | ')} |`,
      ),
      '',
      `The GFA of the same segments, compared byte for byte with GRAPE's: the first ${pairs.selected}`,
      "segments selected in GRAPE against each tool's `reduce --scope aroundnodes --distance 0`",
      'over their names, and the whole graph against `reduce` with no scope.',
      '',
      '| Graph | Selection, Bandage | Selection, BandageNG | Whole graph, Bandage | Whole graph, BandageNG |',
      '| --- | --- | --- | --- | --- |',
      ...pairs.graphs.map(
        (g) =>
          `| ${g.graph} | ${g.exports.bandage.selection} | ${g.exports.bandageng.selection} | ${g.exports.bandage.whole} | ${g.exports.bandageng.whole} |`,
      ),
    ]
  : [];

const body = [...table, '', ...examples, '', ...footer, ...pictureTable];
writeFileSync(
  join(root, 'bench', 'compare.md'),
  [
    '# GRAPE against Bandage and BandageNG',
    '',
    'Written by `node scripts/compare-table.mjs` from `bench/compare.json`.',
    '',
    ...body,
    '',
  ].join('\n'),
);
const docsBody = body.map((line) =>
  line
    .replace('](interaction.md)', '](../bench/interaction.md)')
    .replace(/!\[(\w+)\]\(screenshots\//g, '![$1](../bench/screenshots/'),
);
writeFileSync(
  join(root, 'docs', 'benchmarks.md'),
  [
    '# Benchmarks against Bandage and BandageNG',
    '',
    'From [bench/compare.md](../bench/compare.md); the layout and interaction',
    'benchmarks of GRAPE alone are in [bench/results.md](../bench/results.md) and',
    '[bench/interaction.md](../bench/interaction.md).',
    '',
    ...docsBody,
    '',
  ].join('\n'),
);

const readme = join(root, 'README.md');
const [start, end] = ['<!-- compare:start -->', '<!-- compare:end -->'];
const text = readFileSync(readme, 'utf8');
if (text.includes(start)) {
  const inReadme = [
    ...table,
    '',
    ...footer.map((l) => l.replace('](interaction.md)', '](bench/interaction.md)')),
    '',
    'The pictures and the GFA comparison are in [docs/benchmarks.md](docs/benchmarks.md).',
  ];
  writeFileSync(
    readme,
    text.replace(new RegExp(`${start}[\\s\\S]*${end}`), `${start}\n\n${inReadme.join('\n')}\n\n${end}`),
  );
}
console.log(`wrote bench/compare.md and docs/benchmarks.md${text.includes(start) ? ' and the README section' : ''}`);
if (pendingRows.length > 0)
  console.log(`rows pending or without a winner: ${pendingRows.map((r) => r.label).join('; ')}`);
