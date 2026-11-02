import { useRef, useState } from 'react';
import { MAX_SEED, MIN_SEED } from '../../state/search';
import { useApp } from '../../state/store';
import { NumberField } from '../controls/NumberField';
import { formatBases, formatBytes, formatCount, formatPercent } from '../format';
import { SearchResults } from './SearchResults';

/** Finds DNA in the segments: pasted bases or a FASTA file, against an index built on first use. */
export function SequenceSearch() {
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const run = useApp((s) => s.searchRun);
  const index = useApp((s) => s.searchIndex);
  const seed = useApp((s) => s.searchSeed);
  const setSeed = useApp((s) => s.setSearchSeed);
  const runSearch = useApp((s) => s.runSearch);
  const cancel = useApp((s) => s.cancelSearch);
  const merging = useApp((s) => s.merging);
  const running = run.state === 'indexing' || run.state === 'searching';
  return (
    <section className="find sequence-search" aria-label="Sequence search" data-testid="sequence-search">
      <h3>Sequence search</h3>
      <label htmlFor="search-sequence">DNA bases or FASTA</label>
      <textarea
        id="search-sequence"
        data-testid="search-input"
        rows={3}
        spellCheck={false}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
        }}
      />
      <div className="row">
        <button
          type="button"
          data-testid="search-submit"
          disabled={running || merging || text.trim() === ''}
          onClick={() => {
            runSearch(text);
          }}
        >
          Search
        </button>
        <button
          type="button"
          data-testid="search-file"
          disabled={running || merging}
          title="Search for every record of a FASTA file, plain or gzipped"
          onClick={() => input.current?.click()}
        >
          FASTA file…
        </button>
        <input
          ref={input}
          type="file"
          hidden
          data-testid="search-file-input"
          accept=".fa,.fasta,.fna,.fas,.gz"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) runSearch(file);
            event.target.value = '';
          }}
        />
      </div>
      <div className="row">
        <span title="Exact bases a hit must hold somewhere; shorter finds more and takes longer">Seed length</span>
        <NumberField
          label="Seed length"
          testId="search-seed"
          value={seed}
          valid={(k) => Number.isInteger(k) && k >= MIN_SEED && k <= MAX_SEED}
          onValue={setSeed}
        />
      </div>
      <div data-testid="search-status" aria-live="polite">
        {run.state === 'indexing' && (
          <p className="muted">
            Indexing sequences… {formatPercent(run.fraction)}{' '}
            <button type="button" className="link" data-testid="search-cancel" onClick={cancel}>
              Cancel
            </button>
          </p>
        )}
        {run.state === 'searching' && (
          <p className="muted">
            Searching {formatCount(run.done + 1)} of {formatCount(run.total)}…{' '}
            <button type="button" className="link" data-testid="search-cancel" onClick={cancel}>
              Cancel
            </button>
          </p>
        )}
        {run.state === 'failed' && (
          <p className="notice" data-testid="search-error">
            {run.message}
          </p>
        )}
        {index && (
          <p className="muted small" data-testid="search-index">
            Indexed {formatBases(index.bases)} in {formatBytes(index.bytes)}.
            {index.guaranteedMatch > index.k &&
              ` The graph is too large to index every ${index.k}-mer: exact matches of at least ${index.guaranteedMatch} bases are always found.`}
          </p>
        )}
      </div>
      <SearchResults />
    </section>
  );
}
