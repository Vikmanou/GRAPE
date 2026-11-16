import { useApp } from '../../state/store';
import { copyText, download } from '../files';
import { formatBases, formatCount, formatDepth, formatPercent } from '../format';
import { Disclosure } from '../controls/Disclosure';
import { SHEET_QUERY, useMedia } from '../useMedia';
import { sheetKeys, sidebarControl } from '../useSheetFocus';
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
  const names = useApp((s) => s.selectedNames);
  const fasta = useApp((s) => s.selectedFasta);
  const toast = useApp((s) => s.toast);
  const open = useApp((s) => s.infoOpen);
  const sheet = useMedia(SHEET_QUERY);
  if (selection.count === 0 || !open) return null;
  const plural = selection.count > 1;
  const failed = (what: string) => (error: unknown) => {
    toast(`Could not ${what}`, error instanceof Error ? error.message : String(error));
  };
  return (
    <aside
      className="info-panel floating-panel"
      aria-label="Selection"
      data-inset={sheet ? 'bottom' : 'right'}
      data-testid="info-panel"
      onKeyDown={sheet ? sheetKeys(clear, sidebarControl) : undefined}
    >
      <header>
        <h2 data-testid="info-title">
          {plural ? (
            `${formatCount(selection.count)} segments`
          ) : (
            <>
              Segment{' '}
              {details.state === 'segment' && (
                <span className="mono" data-testid="info-name">
                  {details.info.name}
                </span>
              )}
            </>
          )}
        </h2>
        <button type="button" className="icon" aria-label="Clear the selection" onClick={clear}>
          ×
        </button>
      </header>
      <div className="row actions">
        <button type="button" className="primary" data-testid="zoom-selection" onClick={zoom}>
          Zoom to
        </button>
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
        <button type="button" data-testid="select-components" onClick={selectComponents}>
          Whole component
        </button>
      </div>
      <Disclosure title="More actions" testId="info-more">
        <div className="row actions">
          <button type="button" data-testid="invert-selection" onClick={invert}>
            Invert
          </button>
          {plural && (
            <button
              type="button"
              data-testid="copy-names"
              onClick={() => {
                copyText(names()).then(() => {
                  toast('Names copied');
                }, failed('copy the names'));
              }}
            >
              Copy names
            </button>
          )}
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
      </Disclosure>
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
            <dt>Mean length</dt>
            <dd data-testid="info-mean-length">{formatBases(details.summary.totalLength / details.summary.count)}</dd>
          </div>
          <div>
            <dt>Mean depth (length-weighted)</dt>
            <dd data-testid="info-mean-depth">{formatDepth(details.summary.meanDepth)}</dd>
          </div>
          <div>
            <dt>N50</dt>
            <dd data-testid="info-n50">{formatBases(details.summary.n50)}</dd>
          </div>
          <div>
            <dt>GC content (length-weighted)</dt>
            <dd data-testid="info-gc">{formatPercent(details.summary.gc)}</dd>
          </div>
        </dl>
      )}
      {details.state === 'many' && (
        <Disclosure title="Names" testId="info-names">
          <p className="mono small" data-testid="info-name-list">
            {details.names.join(', ')}
            {selection.count > details.names.length &&
              ` … and ${formatCount(selection.count - details.names.length)} more`}
          </p>
        </Disclosure>
      )}
    </aside>
  );
}
