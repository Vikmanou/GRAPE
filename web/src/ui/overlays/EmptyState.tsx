import { useRef } from 'react';
import { ExampleList } from '../controls/ExampleList';
import { ACCEPTED_FILES } from '../files';

interface Props {
  dragging: boolean;
  onOpen: (file: File) => void;
}

export function EmptyState({ dragging, onOpen }: Props) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className={`empty-state${dragging ? ' dragging' : ''}`} data-testid="empty-state">
      <div className="drop-zone">
        <p className="drop-title">Open an assembly graph</p>
        <button type="button" className="primary" data-testid="empty-open" onClick={() => input.current?.click()}>
          Open a file
        </button>
        <p className="muted">or drop one anywhere on this page. GFA 1.0 or 1.1, or FASTG, plain or gzipped.</p>
        <p className="muted">Files are processed on your computer and never uploaded.</p>
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
