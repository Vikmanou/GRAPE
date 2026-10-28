import type { ColorMode } from '../engine/style/colors';
import { DEFAULT_DISPLAY, type DisplayOptions } from '../engine/style/display';
import type { ColorRange } from '../engine/style/scales';
import type { GraphStats } from '../workers/protocol/graph';
import { shownGraph } from './load';
import type { Context } from './store';

export type RangedMode = 'depth' | 'gc' | 'length';

export function isRanged(mode: ColorMode): mode is RangedMode {
  return mode === 'depth' || mode === 'gc' || mode === 'length';
}

/** Depth starts at Bandage's automatic range, its first to third quartile (`getDepthColour`). */
export function autoRange(mode: RangedMode, stats: GraphStats): ColorRange {
  const range = (scale: ColorRange['scale'], min: number, max: number): ColorRange =>
    Number.isFinite(min) && Number.isFinite(max) ? { scale, min, max } : { scale, min: 0, max: 1 };
  switch (mode) {
    case 'depth':
      return range('linear', stats.depthQ1, stats.depthQ3);
    case 'gc':
      return range('linear', stats.gcMin, stats.gcMax);
    case 'length':
      return range('log', Math.max(stats.shortest, 1), Math.max(stats.longest, 1));
  }
}

export interface DisplayOptionsSlice {
  displayOptions: DisplayOptions;
  setDisplayOptions: (patch: Partial<DisplayOptions>) => void;
  /** Switches the colour mode and starts its range at the automatic one. */
  setColorMode: (mode: ColorMode) => void;
  resetColorRange: () => void;
}

export function createDisplayOptionsSlice(ctx: Context): DisplayOptionsSlice {
  const { set, get } = ctx;

  function apply(displayOptions: DisplayOptions): void {
    set({ displayOptions });
    ctx.bridge.send({ type: 'set-display', display: displayOptions });
  }

  return {
    displayOptions: DEFAULT_DISPLAY,

    setDisplayOptions(patch) {
      apply({ ...get().displayOptions, ...patch });
    },

    setColorMode(color) {
      const { displayOptions } = get();
      const stats = shownGraph(get())?.stats;
      const range = isRanged(color) && stats ? autoRange(color, stats) : undefined;
      apply({ ...displayOptions, color, range: range ?? displayOptions.range });
    },

    resetColorRange() {
      get().setColorMode(get().displayOptions.color);
    },
  };
}
