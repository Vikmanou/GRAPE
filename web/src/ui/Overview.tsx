import type { ReactNode } from 'react';
import type { ParseResult } from '../workers/protocol/graph';
import { formatBases, formatBytes, formatCount, formatDepth, formatPercent } from './format';

const TOP_COMPONENTS = 10;

const compressionLabel = { none: '', gzip: ', gzipped', bgzf: ', bgzipped' } as const;

interface Props {
  result: ParseResult;
  /** Shown under the file format, above the stats. */
  children?: ReactNode;
}

export function Overview({ result, children }: Props) {
  const { stats, components } = result;
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
  const shown = Math.min(components.segments.length, TOP_COMPONENTS);

  return (
    <aside className="sidebar" aria-label="Overview" data-inset="left">
      <h2>Overview</h2>
      <p className="muted" data-testid="format" data-parse-ms={Math.round(result.parseMs)}>
        {format}
        {compressionLabel[result.compression]} · parsed in {formatCount(result.parseMs)} ms
      </p>
      {result.memory.sequencesDropped && (
        <p className="notice">Sequences exceeded the memory budget and were dropped.</p>
      )}
      {children}
      <dl className="stats">
        {rows.map(([id, label, value]) => (
          <div key={id}>
            <dt>{label}</dt>
            <dd data-testid={`stat-${id}`}>{value}</dd>
          </div>
        ))}
      </dl>
      <h3>Largest components</h3>
      <table className="components" data-testid="components">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Segments</th>
            <th scope="col">Length</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: shown }, (_, rank) => (
            <tr key={rank}>
              <td>{rank + 1}</td>
              <td>{formatCount(components.segments[rank] ?? 0)}</td>
              <td>{formatBases(components.lengths[rank] ?? 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {components.segments.length > shown && (
        <p className="muted">and {formatCount(components.segments.length - shown)} more</p>
      )}
      <p className="muted small">
        Memory: {result.memory.bytesPerSegment.toFixed(1)} B per segment, names {formatBytes(result.memory.nameBytes)}
        {result.memory.sequenceBytes > 0 ? `, sequences ${formatBytes(result.memory.sequenceBytes)}` : ''}
      </p>
    </aside>
  );
}
