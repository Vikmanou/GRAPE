import { useRef } from 'react';
import { useApp } from '../../state/store';
import { formatCount, formatPercent } from '../format';

/** For files whose segments are all `*`, as ABySS writes them: sequences from a FASTA file. */
export function SequenceFile() {
  const state = useApp((s) => s.sequenceFile);
  const addSequences = useApp((s) => s.addSequences);
  const input = useRef<HTMLInputElement>(null);
  return (
    <section className="controls" aria-label="Sequences" data-testid="sequence-file">
      {state.state !== 'added' && <p className="notice">This file has no sequences.</p>}
      <div className="row">
        <button
          type="button"
          data-testid="add-sequences"
          disabled={state.state === 'reading'}
          title="Read the sequences from a FASTA file whose records are named after the segments"
          onClick={() => input.current?.click()}
        >
          Add sequences from FASTA…
        </button>
        <input
          ref={input}
          type="file"
          hidden
          data-testid="add-sequences-input"
          accept=".fa,.fasta,.fna,.fas,.gz"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) addSequences(file);
            event.target.value = '';
          }}
        />
      </div>
      {state.state === 'reading' && (
        <p className="muted small">
          Reading {state.name}… {formatPercent(state.fraction)}
        </p>
      )}
      {state.state === 'failed' && <p className="notice">{state.message}</p>}
      {state.state === 'added' && (
        <p className="muted small" data-testid="sequences-added">
          {formatCount(state.attached.matched)} sequences from {state.name}
          {state.attached.unknown > 0 && `; ${formatCount(state.attached.unknown)} records named no segment`}
          {state.attached.resized > 0 && `; ${formatCount(state.attached.resized)} lengths replaced`}
          {state.attached.dropped && '; sequences exceeded the memory budget and were dropped'}.
        </p>
      )}
    </section>
  );
}
