export interface SettledLayout {
  /** Counts settled layouts, so a test can tell a new one from the last. */
  run: number;
  seed: number;
  quality: string;
  /** `x, y` per point as drawn. */
  positions: Float32Array;
}

let runs = 0;

/**
 * Development builds put the last settled layout on `window.grapeLayout`
 * for the browser tests and the layout benchmark; production builds leave
 * it out.
 */
export function exposeSettledLayout(layout: Omit<SettledLayout, 'run'>): void {
  if (!import.meta.env.DEV) return;
  runs += 1;
  (window as Window & { grapeLayout?: SettledLayout }).grapeLayout = { run: runs, ...layout };
}
