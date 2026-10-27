import { describe, expect, it } from 'vitest';
import { DEFAULT_DISPLAY } from '../../src/engine/style/display';
import { DEFAULT_LABELS } from '../../src/state/labels';
import { readSettings, savedDisplay, type Settings, writeSettings } from '../../src/state/settings';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const items = new Map<string, string>();
  return { getItem: (key) => items.get(key) ?? null, setItem: (key, value) => items.set(key, value) };
}

const display = savedDisplay(DEFAULT_DISPLAY);
const settings: Settings = {
  theme: 'dark',
  sidebar: { open: false, tab: 'display' },
  infoOpen: false,
  display: { ...display, color: 'depth', double: true },
  labels: { ...DEFAULT_LABELS, show: true, max: 500 },
};

describe('settings', () => {
  it('round-trip', () => {
    const storage = memoryStorage();
    writeSettings(storage, settings);
    expect(readSettings(storage)).toEqual(settings);
  });

  it('fall back field by field on anything unexpected', () => {
    const storage = memoryStorage();
    storage.setItem(
      'grape.settings',
      JSON.stringify({ theme: 'neon', sidebar: { tab: 'nowhere' }, display: { color: 'plaid', double: 'yes' } }),
    );
    const read = readSettings(storage);
    expect(read.theme).toBe('system');
    expect(read.sidebar).toEqual({ open: true, tab: 'overview' });
    expect(read.display).toEqual(display);
    expect(read.labels).toEqual(DEFAULT_LABELS);
  });

  it('work without storage', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
    };
    expect(readSettings(broken)).toEqual({});
    expect(() => {
      writeSettings(broken, settings);
    }).not.toThrow();
    expect(readSettings(undefined)).toEqual({});
  });
});
