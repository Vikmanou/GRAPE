// Bandage's defaults (`averageNodeWidth` and `edgeWidth` in program/settings.cpp).
export const RIBBON_WIDTH = 5;
export const LINK_WIDTH = 1.5;

/** Links fade out as ribbons shrink from 3 to 1 pixel wide. */
export function linkFade(zoom: number): number {
  return Math.min(1, Math.max(0, (RIBBON_WIDTH * zoom - 1) / 2));
}

/**
 * Bandage outlines a selected node with a 1-unit pen (`selectionThickness`
 * in program/settings.cpp); it is kept at least 2 pixels wide so a selection
 * shows when zoomed out.
 */
export function outlineWidth(zoom: number): number {
  return Math.max(1, 2 / zoom);
}
