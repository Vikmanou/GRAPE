import { useRef, useState } from 'react';
import { useApp } from '../../state/store';
import { copyText, download, fileStem } from '../files';

type Copied =
  | { state: 'idle' }
  | { state: 'copied'; link: string; selectionDropped: boolean }
  | { state: 'failed'; link: string | undefined };

/** "Share" in the top bar: a link to the view, which never carries sequences, and session files. */
export function ShareMenu() {
  const menu = useRef<HTMLDetailsElement>(null);
  const file = useApp((s) => (s.load.state === 'loaded' ? s.load.file : undefined));
  const ready = useApp((s) => s.fingerprint !== undefined);
  const merged = useApp((s) => s.merged !== undefined);
  const shareLink = useApp((s) => s.shareLink);
  const saveSession = useApp((s) => s.saveSession);
  const toast = useApp((s) => s.toast);
  const [includeUrl, setIncludeUrl] = useState(false);
  const [copied, setCopied] = useState<Copied>({ state: 'idle' });
  const [saving, setSaving] = useState(false);
  if (!file) return null;

  const copy = () => {
    const made = shareLink(includeUrl && file.url !== undefined);
    // The clipboard gets a promise, so the click's permission to write survives the wait.
    copyText(made.then((m) => m.link)).then(
      async () => {
        const { link, selectionDropped } = await made;
        setCopied({ state: 'copied', link, selectionDropped });
      },
      async () => {
        const link = await made.then((m) => m.link).catch(() => undefined);
        setCopied({ state: 'failed', link });
      },
    );
  };

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
    <details
      className="menu"
      ref={menu}
      data-testid="share-menu"
      onToggle={() => {
        setCopied({ state: 'idle' });
      }}
    >
      <summary>Share</summary>
      <div className="menu-popup menu-popup-end share">
        <h3 className="menu-heading muted small">Link</h3>
        <p className="small">
          The view as a link: layout seed, settings, camera, selection and highlighted paths. It never holds sequences;
          whoever opens it opens the same file themselves.
        </p>
        {file.url !== undefined && (
          <label className="small">
            <input
              type="checkbox"
              data-testid="share-include-url"
              checked={includeUrl}
              onChange={(event) => {
                setIncludeUrl(event.target.checked);
              }}
            />{' '}
            Include the file’s address, so the link can download it. Addresses can hold access keys: include it only if
            whoever gets the link may use it.
          </label>
        )}
        <button type="button" data-testid="share-copy-link" disabled={!ready} onClick={copy}>
          Copy link
        </button>
        {copied.state === 'copied' && (
          <p className="small" role="status" data-testid="share-copied">
            Copied.
            {copied.selectionDropped &&
              ' The selection was too large for a link and was left out; a session file keeps it.'}
          </p>
        )}
        {copied.state === 'failed' && (
          <p className="small" role="status">
            The clipboard refused the link{copied.link ? '; copy it from here:' : '.'}
            {copied.link && (
              <input
                readOnly
                className="share-link"
                value={copied.link}
                onFocus={(e) => {
                  e.target.select();
                }}
              />
            )}
          </p>
        )}
        <h3 className="menu-heading muted small">Session file</h3>
        <p className="small">
          The same view with every position, so it opens exactly as it is on any computer or browser. Open it, then the
          graph file.
        </p>
        <button type="button" data-testid="share-save-session" disabled={!ready || saving} onClick={save}>
          {saving ? 'Saving…' : 'Save session file'}
        </button>
      </div>
    </details>
  );
}
