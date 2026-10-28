import { useMemo, useState } from 'react';
import { useApp } from '../../state/store';
import type { ComponentTable as Components } from '../../workers/protocol/graph';
import { formatBases, formatCount, formatDepth } from '../format';

const SHOWN = 100;

type Column = 'rank' | 'segments' | 'length' | 'depth' | 'circular';

const COLUMNS: { key: Column; label: string }[] = [
  { key: 'rank', label: '#' },
  { key: 'segments', label: 'Segments' },
  { key: 'length', label: 'Length' },
  { key: 'depth', label: 'Mean depth' },
  { key: 'circular', label: 'Circular' },
];

function value(components: Components, column: Column, rank: number): number {
  switch (column) {
    case 'rank':
      return rank;
    case 'segments':
      return components.segments[rank] ?? 0;
    case 'length':
      return components.lengths[rank] ?? 0;
    case 'depth':
      return components.meanDepths[rank] ?? NaN;
    case 'circular':
      return components.circular[rank] ?? 0;
  }
}

/** Ranks ordered by a column; unknown depths always last. */
function sortedRanks(components: Components, column: Column, descending: boolean): Uint32Array {
  const ranks = Uint32Array.from({ length: components.segments.length }, (_, i) => i);
  const sign = descending ? -1 : 1;
  return ranks.sort((a, b) => {
    const x = value(components, column, a);
    const y = value(components, column, b);
    if (Number.isNaN(x) || Number.isNaN(y)) return Number(Number.isNaN(x)) - Number(Number.isNaN(y)) || a - b;
    return (x - y) * sign || a - b;
  });
}

export function ComponentTable({ components }: { components: Components }) {
  const showComponent = useApp((s) => s.showComponent);
  const [sort, setSort] = useState<{ column: Column; descending: boolean }>({ column: 'rank', descending: false });
  const ranks = useMemo(() => sortedRanks(components, sort.column, sort.descending), [components, sort]);
  const shown = ranks.subarray(0, SHOWN);

  return (
    <>
      <table className="components" data-testid="components">
        <thead>
          <tr>
            {COLUMNS.map(({ key, label }) => (
              <th
                key={key}
                scope="col"
                aria-sort={sort.column === key ? (sort.descending ? 'descending' : 'ascending') : undefined}
              >
                <button
                  type="button"
                  className="link"
                  data-testid={`sort-${key}`}
                  onClick={() => {
                    setSort((s) => ({ column: key, descending: s.column === key ? !s.descending : key !== 'rank' }));
                  }}
                >
                  {label}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from(shown, (rank) => (
            <tr key={rank}>
              <td>
                <button
                  type="button"
                  className="link"
                  data-testid={`component-${rank + 1}`}
                  title="Select and zoom to this component"
                  onClick={() => {
                    showComponent(rank);
                  }}
                >
                  {rank + 1}
                </button>
              </td>
              <td>{formatCount(components.segments[rank] ?? 0)}</td>
              <td>{formatBases(components.lengths[rank] ?? 0)}</td>
              <td>{formatDepth(components.meanDepths[rank] ?? NaN)}</td>
              <td>{components.circular[rank] ? 'yes' : 'no'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {ranks.length > shown.length && <p className="muted">and {formatCount(ranks.length - shown.length)} more</p>}
    </>
  );
}
