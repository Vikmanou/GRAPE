import { useMemo, useState } from 'react';
import { cssColor, pathColor } from '../../engine/style/colors';
import { listedHits, readHit, type SearchHit, type SearchPart } from '../../state/search';
import { useApp } from '../../state/store';
import { HIT_WORDS } from '../../workers/protocol/sequence';
import { formatCount, formatPercent } from '../format';

function strand(part: SearchPart): string {
  return part.reverse ? '−' : '+';
}

function Row({ hit, query, names }: { hit: SearchHit; query: string; names: Map<number, string> }) {
  const zoomToHit = useApp((s) => s.zoomToHit);
  const first = hit.parts[0];
  const last = hit.parts.at(-1);
  if (!first || !last) return null;
  const label = (part: SearchPart) => `${names.get(part.segment) ?? part.segment}${strand(part)}`;
  const all = hit.parts.map((p) => `${label(p)} ${formatCount(p.start + 1)}–${formatCount(p.end)}`).join('\n');
  return (
    <tr data-testid={`search-hit-${hit.index}`}>
      <td>
        <span className="swatch" style={{ background: cssColor(pathColor(hit.query)) }} title={query} />
      </td>
      <td>
        <button
          type="button"
          className="link mono"
          title={`Zoom to this hit\n${all}`}
          onClick={() => {
            zoomToHit(hit.index);
          }}
        >
          {label(first)}
          {hit.parts.length > 1 && ` … ${label(last)}`}
        </button>
        {hit.parts.length > 1 && <span className="muted"> {formatCount(hit.parts.length)} segments</span>}
      </td>
      <td>
        {formatCount(first.start + 1)}–{formatCount(first.end)}
      </td>
      <td>{formatPercent(hit.identity)}</td>
      <td>{formatPercent(hit.coverage)}</td>
      <td>{formatCount(hit.score)}</td>
    </tr>
  );
}

/** Every query's hits, best first; a row's button zooms to its hit. */
export function SearchResults() {
  const results = useApp((s) => s.searchResults);
  const starts = useApp((s) => s.searchPartStarts);
  const names = useApp((s) => s.searchNames);
  const [picked, setPicked] = useState<number | undefined>();
  const query = results && picked !== undefined && picked < results.names.length ? picked : undefined;
  const rows = useMemo(() => (results ? listedHits(results, query) : []), [results, query]);
  if (!results || !starts) return null;
  const found = query === undefined ? results.totals.reduce((a, b) => a + b, 0) : (results.totals[query] ?? 0);
  const kept = results.hits.length / HIT_WORDS;
  return (
    <div data-testid="search-results">
      <p data-testid="search-found">
        {found === 0
          ? 'No hits.'
          : `${formatCount(found)} ${found === 1 ? 'hit' : 'hits'}${results.names.length > 1 ? ` for ${formatCount(results.names.length)} queries` : ''}.`}
      </p>
      {results.names.length > 1 && (
        <label className="row">
          Query
          <select
            data-testid="search-query"
            value={query ?? ''}
            onChange={(event) => {
              setPicked(event.target.value === '' ? undefined : Number(event.target.value));
            }}
          >
            <option value="">All</option>
            {results.names.map((name, i) => (
              <option key={`${i}${name}`} value={i}>
                {name}
              </option>
            ))}
          </select>
        </label>
      )}
      {rows.length > 0 && (
        <table className="components path-table" data-testid="search-hits">
          <thead>
            <tr>
              <th scope="col">
                <span className="visually-hidden">Query</span>
              </th>
              <th scope="col">Segment</th>
              <th scope="col">Position</th>
              <th scope="col">Identity</th>
              <th scope="col">Coverage</th>
              <th scope="col">Score</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((h) => {
              const hit = readHit(results, starts, h);
              return <Row key={h} hit={hit} query={results.names[hit.query] ?? ''} names={names} />;
            })}
          </tbody>
        </table>
      )}
      {rows.length < found && (
        <p className="muted small">
          Listing the best {formatCount(rows.length)}
          {found > kept ? `, keeping ${formatCount(kept)}` : ''}.
        </p>
      )}
      {results.tooShort.length > 0 && (
        <p className="notice" data-testid="search-too-short">
          Too short to search: {results.tooShort.join(', ')}.
        </p>
      )}
      {results.repeats > 0 && (
        <p className="muted small" data-testid="search-repeats">
          {formatCount(results.repeats)} query k-mers are too common in the graph to seed a hit.
        </p>
      )}
      {results.seedsCut && (
        <p className="notice">A query had more seeds than a search follows, so hits may be missing.</p>
      )}
    </div>
  );
}
