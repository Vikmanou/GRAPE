import type { Bridge } from './bridge';
import type { AppStore } from './store';

export interface SettledLayout {
  /** Counts settled layouts, so a test can tell a new one from the last. */
  run: number;
  seed: number;
  quality: string;
  /** `x, y` per point as drawn. */
  positions: Float32Array;
}

let runs = 0;

export interface TestHooks {
  store: AppStore;
  send: Bridge['send'];
  on: Bridge['on'];
}

/** Development builds put the store and the engine bridge on `window.grapeTest` for browser tests. */
export function exposeForTests(store: AppStore, bridge: Bridge): void {
  if (!import.meta.env.DEV || typeof window === 'undefined') return;
  const hooks: TestHooks = {
    store,
    send: (command) => {
      bridge.send(command);
    },
    on: (listener) => bridge.on(listener),
  };
  (window as Window & { grapeTest?: TestHooks }).grapeTest = hooks;
}

/**
 * Development builds put the last settled layout on `window.grapeLayout`
 * for the browser tests and the layout benchmark; production builds leave
 * it out.
 */
export function exposeSettledLayout(layout: Omit<SettledLayout, 'run'>): void {
  if (!import.meta.env.DEV || typeof window === 'undefined') return;
  runs += 1;
  (window as Window & { grapeLayout?: SettledLayout }).grapeLayout = { run: runs, ...layout };
}
