import type { Backend, View } from '../core/backend';
import { exportScale, planTiles, TILE_PX, tileView } from './tiles';

/**
 * The view drawn `wanted` times larger, or as large as the canvas limits
 * allow, tile by tile offscreen and composed into one PNG.
 */
export async function viewToPng(backend: Backend, view: View, wanted: number, tilePx = TILE_PX): Promise<Blob> {
  const scale = exportScale(view.width, view.height, wanted);
  const image = { width: Math.round(view.width * scale), height: Math.round(view.height * scale) };
  const canvas = new OffscreenCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('this browser cannot compose an image');
  const size = Math.max(1, Math.min(tilePx, backend.maxCanvasSize));
  for (const tile of planTiles(image.width, image.height, size)) {
    const pixels = await backend.capture(tileView(view, scale, image, tile));
    context.putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer), tile.width, tile.height), tile.x, tile.y);
  }
  return canvas.convertToBlob({ type: 'image/png' });
}
