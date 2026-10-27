import type { View } from './backend';

/** Segment ids are drawn at this fraction of the canvas resolution. */
const SCALE = 0.5;

/** The view the id texture shows at half resolution. */
export function idView<T extends View>(view: T): T {
  return {
    ...view,
    zoom: view.zoom * SCALE,
    width: Math.max(1, Math.ceil(view.width * SCALE)),
    height: Math.max(1, Math.ceil(view.height * SCALE)),
  };
}

/** The id texel under canvas pixel `x, y`. */
export function idTexel(x: number, y: number): [number, number] {
  return [Math.floor(x * SCALE), Math.floor(y * SCALE)];
}
