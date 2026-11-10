import { useRef, useState } from 'react';
import { useApp } from '../../state/store';

/** "Open URL" in the top bar: the browser downloads the file itself, so the server must allow it (CORS). */
export function OpenUrlMenu() {
  const menu = useRef<HTMLDetailsElement>(null);
  const openUrl = useApp((s) => s.openUrl);
  const [url, setUrl] = useState('');
  return (
    <details className="menu" ref={menu} data-testid="open-url-menu">
      <summary>Open URL…</summary>
      <form
        className="menu-popup open-url"
        onSubmit={(event) => {
          event.preventDefault();
          if (url.trim() === '') return;
          openUrl(url);
          if (menu.current) menu.current.open = false;
        }}
      >
        <label>
          Address of a GFA or FASTG file, plain or gzipped, or a GRAPE share link
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
          Your browser downloads it directly; nothing passes through GRAPE. The server must allow other sites to fetch
          the file (CORS).
        </p>
        <button type="submit" data-testid="open-url-submit">
          Open
        </button>
      </form>
    </details>
  );
}
