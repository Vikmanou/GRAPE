// Bandage's defaults (`averageNodeWidth` and `edgeWidth` in program/settings.cpp).
export const RIBBON_WIDTH = 5;
export const LINK_WIDTH = 1.5;
/** The widest a ribbon gets when scaled by depth. */
export const MAX_RIBBON_WIDTH = 4 * RIBBON_WIDTH;
const MIN_RIBBON_WIDTH = 0.5 * RIBBON_WIDTH;

/**
 * Double mode draws each strand this far to its side of the shared layout
 * (`doubleModeNodeSeparation` in program/settings.cpp).
 */
export const STRAND_SHIFT = 2;

/** Ribbons this many pixels wide or wider show their links fully. */
export const LINK_FULL_PX = 3;

/** Links fade out as ribbons shrink from `fullPx` to 1 pixel wide. */
export function linkFade(zoom: number, fullPx = LINK_FULL_PX): number {
  return Math.min(1, Math.max(0, (RIBBON_WIDTH * zoom - 1) / Math.max(fullPx - 1, 1e-6)));
}

/**
 * Bandage's `getNodeWidth` (graph/graphicsitemnode.cpp) with its default
 * `depthPower` and `depthEffectOnWidth` of 0.5, clamped as the spec asks.
 * An unknown depth draws at the average width.
 */
export function depthWidth(depth: number, meanDepth: number): number {
  if (Number.isNaN(depth) || !(meanDepth > 0)) return RIBBON_WIDTH;
  const relative = Math.max(depth / meanDepth, 0);
  const width = RIBBON_WIDTH * ((Math.sqrt(relative) - 1) * 0.5 + 1);
  return Math.min(MAX_RIBBON_WIDTH, Math.max(MIN_RIBBON_WIDTH, width));
}

/**
 * Bandage outlines a selected node with a 1-unit pen (`selectionThickness`
 * in program/settings.cpp); it is kept at least 2 pixels wide so a selection
 * shows when zoomed out.
 */
export function outlineWidth(zoom: number): number {
  return Math.max(1, 2 / zoom);
}
