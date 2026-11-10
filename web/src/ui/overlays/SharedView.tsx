import { useApp } from '../../state/store';
import { formatBytes, formatCount } from '../format';

/** A view from a link or session file, waiting for the user to open the file it was made from. */
export function SharedView() {
  const shared = useApp((s) => (s.pendingPacked ? undefined : s.pendingShare));
  const openUrl = useApp((s) => s.openUrl);
  const dismiss = useApp((s) => s.dismissShare);
  if (!shared) return null;
  const { size, segments } = shared.file;
  return (
    <section className="shared-view" role="status" aria-label="Shared view" data-testid="shared-view">
      <p>
        <strong>A shared view is waiting for its graph.</strong> Open the file it was made from: {formatBytes(size)},{' '}
        {formatCount(segments)} {segments === 1 ? 'segment' : 'segments'}.
      </p>
      <div className="shared-view-actions">
        {shared.url !== undefined && (
          <button
            type="button"
            data-testid="shared-view-download"
            title={shared.url}
            onClick={() => {
              openUrl(shared.url ?? '');
            }}
          >
            Download it from {new URL(shared.url).hostname}
          </button>
        )}
        <button type="button" className="link" onClick={dismiss}>
          Dismiss
        </button>
      </div>
    </section>
  );
}
