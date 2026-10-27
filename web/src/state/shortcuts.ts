import type { AppState } from './store';

const KEY_ZOOM = 1.25;
/** Fraction of the view an arrow key pans. */
const KEY_PAN = 0.1;

export interface Shortcut {
  /** `KeyboardEvent.key` values, letters lower case. */
  keys: string[];
  /** How the overlay shows the keys. */
  label: string;
  action: string;
  run: (app: AppState) => void;
}

/** Every keyboard shortcut; the `?` overlay lists this table. */
export const SHORTCUTS: Shortcut[] = [
  {
    keys: ['f'],
    label: 'F',
    action: 'Fit the graph',
    run: (a) => {
      a.fit();
    },
  },
  {
    keys: ['z'],
    label: 'Z',
    action: 'Zoom to the selection',
    run: (a) => {
      a.zoomToSelection();
    },
  },
  {
    keys: ['c'],
    label: 'C',
    action: 'Select the whole components of the selection',
    run: (a) => {
      a.selectComponents();
    },
  },
  {
    keys: ['i'],
    label: 'I',
    action: 'Invert the selection',
    run: (a) => {
      a.invertSelection();
    },
  },
  {
    keys: ['Escape'],
    label: 'Esc',
    action: 'Clear the selection',
    run: (a) => {
      a.clearSelection();
    },
  },
  {
    keys: ['/'],
    label: '/',
    action: 'Find by name',
    run: (a) => {
      a.focusFind();
    },
  },
  {
    keys: ['['],
    label: '[',
    action: 'Show or hide the sidebar',
    run: (a) => {
      a.toggleSidebar();
    },
  },
  {
    keys: [']'],
    label: ']',
    action: 'Show or hide the info panel',
    run: (a) => {
      a.toggleInfo();
    },
  },
  {
    keys: ['+', '='],
    label: '+',
    action: 'Zoom in',
    run: (a) => {
      a.zoomView(KEY_ZOOM);
    },
  },
  {
    keys: ['-'],
    label: '−',
    action: 'Zoom out',
    run: (a) => {
      a.zoomView(1 / KEY_ZOOM);
    },
  },
  {
    keys: ['ArrowLeft'],
    label: '←',
    action: 'Pan left',
    run: (a) => {
      a.panView(KEY_PAN, 0);
    },
  },
  {
    keys: ['ArrowRight'],
    label: '→',
    action: 'Pan right',
    run: (a) => {
      a.panView(-KEY_PAN, 0);
    },
  },
  {
    keys: ['ArrowUp'],
    label: '↑',
    action: 'Pan up',
    run: (a) => {
      a.panView(0, KEY_PAN);
    },
  },
  {
    keys: ['ArrowDown'],
    label: '↓',
    action: 'Pan down',
    run: (a) => {
      a.panView(0, -KEY_PAN);
    },
  },
  {
    keys: ['?'],
    label: '?',
    action: 'Show these shortcuts',
    run: (a) => {
      a.setShortcutsOpen(!a.shortcutsOpen);
    },
  },
];

const byKey = new Map(SHORTCUTS.flatMap((s) => s.keys.map((key) => [key, s] as const)));

function typing(target: EventTarget | null): boolean {
  return (
    typeof HTMLElement !== 'undefined' &&
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

/** Runs the shortcut for a key press; returns whether one ran. */
export function handleKey(event: KeyboardEvent, app: AppState): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  if (typing(event.target)) {
    if (event.key === 'Escape') (event.target as HTMLElement).blur();
    return false;
  }
  if (event.key === 'Escape' && app.shortcutsOpen) {
    app.setShortcutsOpen(false);
    return true;
  }
  const shortcut = byKey.get(event.key.length === 1 ? event.key.toLowerCase() : event.key);
  if (!shortcut || app.load.state !== 'loaded') return false;
  shortcut.run(app);
  return true;
}
