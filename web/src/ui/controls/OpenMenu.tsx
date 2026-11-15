import { useRef, useState } from 'react';
import { useApp } from '../../state/store';
import { ExampleList } from './ExampleList';

/**
 * "Open" in the top bar: the button opens the file picker, the arrow beside it
 * opens a menu of the other ways in. Open from URL has the browser download
 * the file itself, so the server must allow it (CORS).
 */
export function OpenMenu({ onPickFile }: { onPickFile: () => void }) {
  const menu = useRef<HTMLDetailsElement>(null);
  const openUrl = useApp((s) => s.openUrl);
  const [url, setUrl] = useState('');
  const close = () => {
    if (menu.current) menu.current.open = false;
  };
  return (
    <div className="split">
      <button type="button" className="split-main" data-testid="open-file" onClick={onPickFile}>
        Open
      </button>
      <details className="menu split-menu" ref={menu} data-testid="open-menu">
        <summary aria-label="More ways to open" title="Open from a URL or load an example">
          ▾
        </summary>
        <div className="menu-popup open-popup">
          <form
            className="open-url"
            onSubmit={(event) => {
              event.preventDefault();
              if (url.trim() === '') return;
              openUrl(url);
              close();
            }}
          >
            <label>
              Open from a URL: a GFA or FASTG file, plain or gzipped, or a GRAPE share link
              <input
                // Not type="url": Firefox's check refuses share links over 1 MiB.
                type="text"
                inputMode="url"
                required
                data-testid="open-url-input"
                placeholder="https://example.org/assembly.gfa.gz"
                value={url}
                onChange={(event) => {
                  setUrl(event.target.value);
                }}
              />
            </label>
            <p className="muted small">
              Your browser downloads it directly; nothing passes through GRAPE. The server must allow other sites to
              fetch the file (CORS).
            </p>
            <button type="submit" data-testid="open-url-submit">
              Open from URL
            </button>
          </form>
          <h3 className="menu-heading">Examples</h3>
          <ExampleList onPick={close} />
        </div>
      </details>
    </div>
  );
}
