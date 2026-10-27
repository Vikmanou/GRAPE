import { useRef } from 'react';
import type { FileInfo } from '../../state/load';
import { useApp } from '../../state/store';
import type { ThemeChoice } from '../../state/theme';
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
      <ThemeButton />
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

const NEXT_THEME: Record<ThemeChoice, ThemeChoice> = { system: 'light', light: 'dark', dark: 'system' };
const THEME_NAMES: Record<ThemeChoice, string> = { system: 'System theme', light: 'Light theme', dark: 'Dark theme' };
const THEME_ICONS: Record<ThemeChoice, string> = { system: '◐', light: '☀', dark: '☾' };

function ThemeButton() {
  const choice = useApp((s) => s.themeChoice);
  const setChoice = useApp((s) => s.setThemeChoice);
  const next = NEXT_THEME[choice];
  return (
    <button
      type="button"
      className="icon"
      data-testid="theme"
      data-theme-choice={choice}
      aria-label={`${THEME_NAMES[choice]}; switch to ${THEME_NAMES[next].toLowerCase()}`}
      title={`${THEME_NAMES[choice]} (click for ${THEME_NAMES[next].toLowerCase()})`}
      onClick={() => {
        setChoice(next);
      }}
    >
      {THEME_ICONS[choice]}
    </button>
  );
}
