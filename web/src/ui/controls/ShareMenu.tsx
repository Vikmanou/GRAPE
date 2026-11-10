import { useState } from 'react';
import { useApp } from '../../state/store';
import { download, fileStem } from '../files';
import { PackedLink } from './PackedLink';

/** "Share" in the top bar: a link that carries the whole graph, and session files. */
export function ShareMenu() {
  const file = useApp((s) => (s.load.state === 'loaded' ? s.load.file : undefined));
  const ready = useApp((s) => s.fingerprint !== undefined);
  const merged = useApp((s) => s.merged !== undefined);
  const saveSession = useApp((s) => s.saveSession);
  const toast = useApp((s) => s.toast);
  const [saving, setSaving] = useState(false);
  if (!file) return null;

  const save = () => {
    setSaving(true);
    saveSession()
      .then((blob) => {
        download(blob, `${fileStem(file.name)}${merged ? '.merged' : ''}.grape.json.gz`);
      })
      .catch((error: unknown) => {
        toast('The session could not be saved', error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        setSaving(false);
      });
  };

  return (
    <details className="menu" data-testid="share-menu">
      <summary>Share</summary>
      <div className="menu-popup menu-popup-end share">
        <PackedLink ready={ready} />
        <h3 className="menu-heading muted small">Session file</h3>
        <p className="small">
          The view with every position, so it opens exactly as it is on any computer or browser. Open the graph first,
          then the session file.
        </p>
        <button type="button" data-testid="share-save-session" disabled={!ready || saving} onClick={save}>
          {saving ? 'Saving…' : 'Save session file'}
        </button>
      </div>
    </details>
  );
}
