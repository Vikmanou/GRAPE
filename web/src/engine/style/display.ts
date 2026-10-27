import type { ColorMode } from './colors';
import type { ColorRange } from './scales';
import { LINK_FULL_PX } from './widths';

/** How segments are drawn; everything here changes with one uniform write. */
export interface DisplayOptions {
  color: ColorMode;
  /** For the depth, GC and length modes. */
  range: ColorRange;
  widthByDepth: boolean;
  /** Unselected segments fade while something is selected. */
  dimUnselected: boolean;
  /** Each strand drawn on its own, as Bandage's double mode does. */
  double: boolean;
  /** Ribbons this many pixels wide or wider show their links fully. */
  linkFullPx: number;
  /** Segments shorter than this many pixels draw as a dot. */
  spritePx: number;
}

/** In the order the shaders number them. */
export const COLOR_MODES = [
  'uniform',
  'random',
  'depth',
  'gc',
  'length',
  'component',
  'tags',
] as const satisfies readonly ColorMode[];

export const DEFAULT_DISPLAY: DisplayOptions = {
  color: 'random',
  range: { scale: 'linear', min: 0, max: 1 },
  widthByDepth: false,
  dimUnselected: true,
  double: false,
  linkFullPx: LINK_FULL_PX,
  spritePx: 2,
};
