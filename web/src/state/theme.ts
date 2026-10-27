import type { Theme } from '../engine/style/palette';

const query = '(prefers-color-scheme: dark)';

/** The theme the user picked; `system` follows the OS. */
export type ThemeChoice = 'system' | Theme;

export function systemTheme(): Theme {
  return window.matchMedia(query).matches ? 'dark' : 'light';
}

/** Calls `listener` whenever the OS theme changes. Returns an unsubscribe. */
export function onSystemThemeChange(listener: (theme: Theme) => void): () => void {
  const media = window.matchMedia(query);
  const handler = (event: MediaQueryListEvent) => {
    listener(event.matches ? 'dark' : 'light');
  };
  media.addEventListener('change', handler);
  return () => {
    media.removeEventListener('change', handler);
  };
}

export function resolveTheme(choice: ThemeChoice): Theme {
  return choice === 'system' ? systemTheme() : choice;
}
