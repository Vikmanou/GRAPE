import { useRef } from 'react';
import type { FileInfo } from '../../state/load';
import { useApp } from '../../state/store';
import { formatBytes } from '../format';

const ACCEPTED_FILES = '.gfa,.gfa.gz,.fastg,.fastg.gz,.gz';

interface Props {
  file: FileInfo | undefined;
  onOpen: (file: File) => void;
}

export function TopBar({ file, onOpen }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const shortcutsOpen = useApp((s) => s.shortcutsOpen);
  const setShortcutsOpen = useApp((s) => s.setShortcutsOpen);
  return (
    <header className="top-bar" data-inset="top">
      <span className="brand">GRAPE</span>
      {file && (
        <span className="file-name" data-testid="file-name" title={file.name}>
          {file.name} <span className="muted">{formatBytes(file.size)}</span>
        </span>
      )}
      <button type="button" onClick={() => input.current?.click()}>
        Open…
      </button>
      <span className="spacer" />
      <button
        type="button"
        className="icon"
        data-testid="help"
        aria-label="Keyboard shortcuts"
        title="Keyboard shortcuts (?)"
        onClick={() => {
          setShortcutsOpen(!shortcutsOpen);
        }}
      >
        ?
      </button>
      <input
        ref={input}
        type="file"
        accept={ACCEPTED_FILES}
        hidden
        data-testid="open-input"
        onChange={(event) => {
          const chosen = event.currentTarget.files?.[0];
          if (chosen) onOpen(chosen);
          event.currentTarget.value = '';
        }}
      />
    </header>
  );
}
