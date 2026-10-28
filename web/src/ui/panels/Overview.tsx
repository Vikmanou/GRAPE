import { useApp } from '../../state/store';
import type { ParseResult } from '../../workers/protocol/graph';
import { formatBases, formatBytes, formatCount, formatDepth, formatPercent } from '../format';
import { ComponentTable } from './ComponentTable';
import { MergeControls } from './MergeControls';
import { SequenceFile } from './SequenceFile';

const compressionLabel = { none: '', gzip: ', gzipped', bgzf: ', bgzipped' } as const;

interface Props {
  result: ParseResult;
}

export function Overview({ result }: Props) {
  const { stats, components } = result;
  const sequenceFile = useApp((s) => s.sequenceFile.state);
  const rows: [string, string, string][] = [
    ['segments', 'Segments', formatCount(stats.segments)],
    ['links', 'Links', formatCount(stats.links)],
    ['total-length', 'Total length', formatBases(stats.totalLength)],
    ['n50', 'N50', formatBases(stats.n50)],
    ['n75', 'N75', formatBases(stats.n75)],
    ['longest', 'Longest segment', formatBases(stats.longest)],
    ['components', 'Components', formatCount(stats.components)],
    ['largest-component', 'Largest component', formatBases(stats.largestComponentLength)],
    ['dead-ends', 'Dead ends', formatCount(stats.deadEnds)],
    ['isolated', 'Isolated segments', formatCount(stats.isolated)],
    ['mean-depth', 'Mean depth (length-weighted)', formatDepth(stats.meanDepth)],
    ['gc', 'GC content', formatPercent(stats.gc)],
  ];
  if (stats.paths > 0) rows.push(['paths', 'Paths (P)', formatCount(stats.paths)]);
  if (stats.walks > 0) rows.push(['walks', 'Walks (W)', formatCount(stats.walks)]);
  if (stats.containments > 0) rows.push(['containments', 'Containments (C)', formatCount(stats.containments)]);
  if (stats.undefined > 0) rows.push(['undefined', 'Undefined segments', formatCount(stats.undefined)]);

  const format = result.format === 'fastg' ? 'FASTG' : `GFA ${result.version ?? '1'}`;

  return (
    <section aria-label="Overview">
      <p className="muted" data-testid="format" data-parse-ms={Math.round(result.parseMs)}>
        {format}
        {compressionLabel[result.compression]} · parsed in {formatCount(result.parseMs)} ms
      </p>
      {result.memory.sequencesDropped && (
        <p className="notice">Sequences exceeded the memory budget and were dropped.</p>
      )}
      {(Number.isNaN(stats.gc) || sequenceFile !== 'none') && result.format === 'gfa' && <SequenceFile />}
      <MergeControls />
      <dl className="stats">
        {rows.map(([id, label, value]) => (
          <div key={id}>
            <dt>{label}</dt>
            <dd data-testid={`stat-${id}`}>{value}</dd>
          </div>
        ))}
      </dl>
      <h3>Components</h3>
      <ComponentTable components={components} />
      <p className="muted small">
        Memory: {result.memory.bytesPerSegment.toFixed(1)} B per segment, names {formatBytes(result.memory.nameBytes)}
        {result.memory.sequenceBytes > 0 ? `, sequences ${formatBytes(result.memory.sequenceBytes)}` : ''}
      </p>
    </section>
  );
}
