import { useApp } from '../../state/store';
import { copyText, download } from '../files';
import { formatBases, formatCount, formatDepth } from '../format';
import { SegmentDetails } from './SegmentDetails';

/** Bandage's default name for saved sequences (ui/mainwindow.cpp, `saveSelectedSequencesToFile`). */
const FASTA_NAME = 'selected_sequences.fasta';

export function Info() {
  const selection = useApp((s) => s.selection);
  const details = useApp((s) => s.details);
  const clear = useApp((s) => s.clearSelection);
  const invert = useApp((s) => s.invertSelection);
  const selectComponents = useApp((s) => s.selectComponents);
  const zoom = useApp((s) => s.zoomToSelection);
  const sequences = useApp((s) => s.selectedSequences);
  const fasta = useApp((s) => s.selectedFasta);
  const toast = useApp((s) => s.toast);
  const open = useApp((s) => s.infoOpen);
  if (selection.count === 0 || !open) return null;
  const plural = selection.count > 1;
  const failed = (what: string) => (error: unknown) => {
    toast(`Could not ${what}`, error instanceof Error ? error.message : String(error));
  };
  return (
    <aside className="info-panel floating-panel" aria-label="Selection" data-inset="right" data-testid="info-panel">
      <header>
        <h2 data-testid="info-title">{plural ? `${formatCount(selection.count)} segments` : 'Segment'}</h2>
        <button type="button" className="icon" aria-label="Clear the selection" onClick={clear}>
          ×
        </button>
      </header>
      <div className="row actions">
        <button type="button" data-testid="zoom-selection" onClick={zoom}>
          Zoom to
        </button>
        <button type="button" data-testid="select-components" onClick={selectComponents}>
          Whole component
        </button>
        <button type="button" data-testid="invert-selection" onClick={invert}>
          Invert
        </button>
      </div>
      <div className="row actions">
        <button
          type="button"
          data-testid="copy-sequence"
          onClick={() => {
            copyText(sequences()).then(() => {
              toast(plural ? 'Sequences copied' : 'Sequence copied');
            }, failed('copy the sequences'));
          }}
        >
          {plural ? 'Copy sequences' : 'Copy sequence'}
        </button>
        <button
          type="button"
          data-testid="download-fasta"
          onClick={() => {
            fasta().then((blob) => {
              download(blob, FASTA_NAME);
            }, failed('save the FASTA file'));
          }}
        >
          Download FASTA
        </button>
      </div>
      {details.state === 'loading' && <p className="muted">Loading…</p>}
      {details.state === 'failed' && <p className="notice">{details.message}</p>}
      {details.state === 'segment' && <SegmentDetails details={details} />}
      {details.state === 'many' && (
        <dl className="stats">
          <div>
            <dt>Total length</dt>
            <dd data-testid="info-total-length">{formatBases(details.summary.totalLength)}</dd>
          </div>
          <div>
            <dt>Mean depth (length-weighted)</dt>
            <dd data-testid="info-mean-depth">{formatDepth(details.summary.meanDepth)}</dd>
          </div>
        </dl>
      )}
    </aside>
  );
}
