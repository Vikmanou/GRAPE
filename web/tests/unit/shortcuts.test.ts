import { describe, expect, it, vi } from 'vitest';
import { handleKey, SHORTCUTS } from '../../src/state/shortcuts';
import type { AppState } from '../../src/state/store';

function app(overrides: Partial<AppState> = {}): AppState {
  return {
    load: { state: 'loaded' },
    shortcutsOpen: false,
    fit: vi.fn(),
    zoomToSelection: vi.fn(),
    clearSelection: vi.fn(),
    panView: vi.fn(),
    zoomView: vi.fn(),
    setShortcutsOpen: vi.fn(),
    ...overrides,
  } as unknown as AppState;
}

const key = (k: string, extra: Partial<KeyboardEvent> = {}) =>
  ({ key: k, ctrlKey: false, metaKey: false, altKey: false, target: null, ...extra }) as KeyboardEvent;

describe('shortcuts', () => {
  it('give each key one action', () => {
    const keys = SHORTCUTS.flatMap((s) => s.keys);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('run the action for a key, letters in either case', () => {
    const a = app();
    expect(handleKey(key('F'), a)).toBe(true);
    expect(a.fit).toHaveBeenCalled();
    handleKey(key('ArrowLeft'), a);
    expect(a.panView).toHaveBeenCalledWith(0.1, 0);
    handleKey(key('='), a);
    expect(a.zoomView).toHaveBeenCalledWith(1.25);
  });

  it('leave keys with modifiers alone and wait for a graph', () => {
    const a = app();
    expect(handleKey(key('f', { ctrlKey: true }), a)).toBe(false);
    expect(handleKey(key('f'), app({ load: { state: 'idle' } }))).toBe(false);
    expect(a.fit).not.toHaveBeenCalled();
  });

  it('close the overlay on Escape before clearing the selection', () => {
    const a = app({ shortcutsOpen: true });
    handleKey(key('Escape'), a);
    expect(a.setShortcutsOpen).toHaveBeenCalledWith(false);
    expect(a.clearSelection).not.toHaveBeenCalled();
  });
});
