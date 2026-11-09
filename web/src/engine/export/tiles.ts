import type { View } from '../core/backend';

/** A rectangle of an export, in its pixels from the top left. */
export interface Tile {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Tiles are read back and composed one at a time on the main thread, so each
 * stays small enough to copy within a frame.
 */
export const TILE_PX = 2048;
/** Chrome's canvas limits: 16,384 pixels a side and 2^28 pixels in all; kept well under the area for memory. */
export const MAX_SIDE_PX = 16384;
export const MAX_PIXELS = 2 ** 26;

/** The largest scale up to `wanted` whose image of `width × height` stays within the canvas limits. */
export function exportScale(width: number, height: number, wanted: number): number {
  const bySide = MAX_SIDE_PX / Math.max(width, height, 1);
  const byArea = Math.sqrt(MAX_PIXELS / Math.max(width * height, 1));
  return Math.max(Math.min(wanted, bySide, byArea), 1 / Math.max(width, height, 1));
}

/** Covers `width × height` row by row with tiles no larger than `size` a side. */
export function planTiles(width: number, height: number, size: number): Tile[] {
  const tiles: Tile[] = [];
  for (let y = 0; y < height; y += size) {
    for (let x = 0; x < width; x += size) {
      tiles.push({ x, y, width: Math.min(size, width - x), height: Math.min(size, height - y) });
    }
  }
  return tiles;
}

/**
 * What one tile of `view` drawn `scale` times larger shows. Tiles sit at
 * whole pixels of the full image, so labels round to the same pixels in
 * every tile.
 */
export function tileView(view: View, scale: number, image: { width: number; height: number }, tile: Tile): View {
  const zoom = view.zoom * scale;
  return {
    centerX: view.centerX + (tile.x + tile.width / 2 - image.width / 2) / zoom,
    centerY: view.centerY + (tile.y + tile.height / 2 - image.height / 2) / zoom,
    zoom,
    width: tile.width,
    height: tile.height,
    pixelScale: scale * (view.pixelScale ?? 1),
  };
}
