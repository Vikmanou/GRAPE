import { useRef, useState } from 'react';
import { useApp } from '../../state/store';
import { ExampleList } from '../controls/ExampleList';
import { ACCEPTED_FILES } from '../files';

interface Props {
  dragging: boolean;
  onOpen: (file: File) => void;
}

export function EmptyState({ dragging, onOpen }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const openUrl = useApp((s) => s.openUrl);
  const [url, setUrl] = useState('');
  return (
    <div className={`empty-state${dragging ? ' dragging' : ''}`} data-testid="empty-state">
      <div className="drop-zone">
        <p className="drop-title">Open an assembly graph</p>
        <button type="button" className="primary" data-testid="empty-open" onClick={() => input.current?.click()}>
          Open a file
        </button>
        <p className="muted">or drop one anywhere on this page. GFA 1.0 or 1.1, or FASTG, plain or gzipped.</p>
        <p className="muted">Files are processed on your computer and never uploaded.</p>
        <form
          className="empty-url"
          onSubmit={(event) => {
            event.preventDefault();
            if (url.trim() !== '') openUrl(url);
          }}
        >
          <input
            type="text"
            inputMode="url"
            aria-label="Open from a URL"
            placeholder="Or paste a URL: https://example.org/assembly.gfa.gz"
            data-testid="empty-url-input"
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
            }}
          />
          <button type="submit" data-testid="empty-url-submit">
            Open from URL
          </button>
        </form>
        <div className="empty-examples">
          <h3>Or try an example</h3>
          <ExampleList />
        </div>
        <input
          ref={input}
          type="file"
          accept={ACCEPTED_FILES}
          hidden
          data-testid="empty-open-input"
          onChange={(event) => {
            const chosen = event.currentTarget.files?.[0];
            if (chosen) onOpen(chosen);
            event.currentTarget.value = '';
          }}
        />
      </div>
    </div>
  );
}
