import { useMemo, useState } from 'react';
import { useApp } from '../../state/store';
import { cssColor, pathColor } from '../../engine/style/colors';
import type { PathList } from '../../workers/protocol/graph';
import { formatBases, formatCount } from '../format';

const SHOWN = 200;

function matching(list: PathList, query: string): number[] {
  const needle = query.trim().toLowerCase();
  const out: number[] = [];
  for (const [i, name] of list.names.entries()) {
    if (needle === '' || name.toLowerCase().includes(needle)) out.push(i);
  }
  return out;
}

export function Paths() {
  const paths = useApp((s) => s.paths);
  const highlighted = useApp((s) => s.highlightedPaths);
  const clearHighlights = useApp((s) => s.clearHighlights);
  const [query, setQuery] = useState('');
  const list = paths.state === 'ready' ? paths.list : undefined;
  const found = useMemo(() => (list ? matching(list, query) : []), [list, query]);

  if (paths.state === 'loading') return <p className="muted">Reading paths…</p>;
  if (paths.state === 'failed') return <p className="notice">{paths.message}</p>;
  if (!list || list.names.length === 0) {
    return (
      <p className="muted" data-testid="paths-empty">
        This graph has no paths (P) or walks (W).
      </p>
    );
  }
  return (
    <section className="paths" aria-label="Paths">
      <input
        type="search"
        data-testid="paths-search"
        aria-label="Search paths by name"
        placeholder={`Search ${formatCount(list.names.length)} paths`}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
        }}
      />
      {highlighted.length > 0 && (
        <div className="row">
          <span className="muted small">{formatCount(highlighted.length)} highlighted</span>
          <button type="button" data-testid="paths-clear" onClick={clearHighlights}>
            Clear highlights
          </button>
        </div>
      )}
      <PathTable list={list} rows={found.slice(0, SHOWN)} highlighted={highlighted} />
      {found.length > SHOWN && <p className="muted">and {formatCount(found.length - SHOWN)} more</p>}
      {found.length === 0 && <p className="muted">No path matches.</p>}
    </section>
  );
}

function PathTable({ list, rows, highlighted }: { list: PathList; rows: number[]; highlighted: number[] }) {
  const selectPath = useApp((s) => s.selectPath);
  const toggleHighlight = useApp((s) => s.toggleHighlight);
  return (
    <table className="components path-table" data-testid="paths">
      <thead>
        <tr>
          <th scope="col">
            <span className="visually-hidden">Highlight</span>
          </th>
          <th scope="col">Name</th>
          <th scope="col">Steps</th>
          <th scope="col">Length</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((i) => (
          <tr key={i} data-testid={`path-${i}`}>
            <td>
              <label className="swatch-toggle" title="Highlight this path in its own colour">
                <input
                  type="checkbox"
                  data-testid={`path-highlight-${i}`}
                  aria-label={`Highlight ${list.names[i] ?? ''}`}
                  checked={highlighted.includes(i)}
                  onChange={() => {
                    toggleHighlight(i);
                  }}
                />
                {highlighted.includes(i) && <span className="swatch" style={{ background: cssColor(pathColor(i)) }} />}
              </label>
            </td>
            <td>
              <button
                type="button"
                className="link mono"
                title="Select and zoom to this path's segments"
                onClick={() => {
                  selectPath(i);
                }}
              >
                {list.names[i]}
              </button>
              {list.walks[i] ? <span className="muted"> W</span> : null}
            </td>
            <td>{formatCount(list.steps[i] ?? 0)}</td>
            <td>{formatBases(list.lengths[i] ?? 0)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
