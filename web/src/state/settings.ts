import { COLOR_MODES, DEFAULT_DISPLAY, type DisplayOptions } from '../engine/style/display';
import type { SidebarTab } from './display';
import { DEFAULT_LABELS, type LabelSettings } from './labels';
import type { AppState, AppStore } from './store';
import type { ThemeChoice } from './theme';

const KEY = 'grape.settings';
const THEMES: ThemeChoice[] = ['system', 'light', 'dark'];
const TABS: SidebarTab[] = ['overview', 'display', 'find', 'paths'];

/** What the next visit starts with. Colour ranges belong to a graph and are left out. */
export interface Settings {
  theme: ThemeChoice;
  sidebar: { open: boolean; tab: SidebarTab };
  infoOpen: boolean;
  display: SavedDisplay;
  labels: LabelSettings;
}

type SavedDisplay = Omit<DisplayOptions, 'range'>;

export function savedDisplay({
  color,
  widthByDepth,
  dimUnselected,
  double,
  linkFullPx,
  spritePx,
}: DisplayOptions): SavedDisplay {
  return { color, widthByDepth, dimUnselected, double, linkFullPx, spritePx };
}

export function settingsOf(s: AppState): Settings {
  const display = savedDisplay(s.displayOptions);
  return { theme: s.themeChoice, sidebar: s.sidebar, infoOpen: s.infoOpen, display, labels: s.labels };
}

/** Keeps only the fields of `fallback` whose stored value has the same type. */
function sameShape<T extends object>(fallback: T, stored: unknown): T {
  if (typeof stored !== 'object' || stored === null) return fallback;
  const out: Record<string, unknown> = { ...(fallback as Record<string, unknown>) };
  for (const [key, value] of Object.entries(fallback) as [string, unknown][]) {
    const saved = (stored as Record<string, unknown>)[key];
    if (typeof value === 'object' && value !== null) out[key] = sameShape(value, saved);
    else if (typeof saved === typeof value) out[key] = saved;
  }
  return out as T;
}

/** Storage can be missing, full or blocked; the app runs the same without it. */
export function readSettings(storage: Pick<Storage, 'getItem'> | undefined): Partial<Settings> {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return {};
    const stored = JSON.parse(raw) as Partial<Record<keyof Settings, unknown>>;
    const theme = THEMES.find((t) => t === stored.theme) ?? 'system';
    const display = sameShape(savedDisplay(DEFAULT_DISPLAY), stored.display);
    display.color = COLOR_MODES.find((m) => m === display.color) ?? DEFAULT_DISPLAY.color;
    const panel = sameShape({ open: true, tab: '' }, stored.sidebar);
    const sidebar = { open: panel.open, tab: TABS.find((t) => t === panel.tab) ?? 'overview' };
    return {
      theme,
      sidebar,
      infoOpen: typeof stored.infoOpen === 'boolean' ? stored.infoOpen : true,
      display,
      labels: sameShape(DEFAULT_LABELS, stored.labels),
    };
  } catch {
    return {};
  }
}

export function writeSettings(storage: Pick<Storage, 'setItem'> | undefined, settings: Settings): void {
  try {
    storage?.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Settings are a convenience; a full or blocked storage loses them.
  }
}

function localStorageOrNone(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** Starts the store from the saved settings and saves them as they change. */
export function persistSettings(store: AppStore, storage = localStorageOrNone()): void {
  const saved = readSettings(storage);
  const app = store.getState();
  if (saved.sidebar) store.setState({ sidebar: saved.sidebar });
  if (saved.infoOpen !== undefined) store.setState({ infoOpen: saved.infoOpen });
  if (saved.display) app.setDisplayOptions(saved.display);
  if (saved.labels) app.setLabels(saved.labels);
  app.setThemeChoice(saved.theme ?? 'system');
  let last = JSON.stringify(settingsOf(store.getState()));
  store.subscribe((state) => {
    const next = JSON.stringify(settingsOf(state));
    if (next === last) return;
    last = next;
    writeSettings(storage, settingsOf(state));
  });
}
