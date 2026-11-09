import { describe, expect, it } from 'vitest';
import { exportScale, MAX_PIXELS, MAX_SIDE_PX, planTiles, tileView } from '../../src/engine/export/tiles';

describe('export tiles', () => {
  it('cover the image once, without gaps or overlaps', () => {
    const tiles = planTiles(5000, 2100, 2048);
    const covered = new Uint8Array(5000 * 2100);
    for (const t of tiles) {
      expect(t.width).toBeLessThanOrEqual(2048);
      expect(t.height).toBeLessThanOrEqual(2048);
      for (let y = t.y; y < t.y + t.height; y++) {
        for (let x = t.x; x < t.x + t.width; x++) covered[y * 5000 + x] = (covered[y * 5000 + x] ?? 0) + 1;
      }
    }
    expect(tiles).toHaveLength(6);
    expect(covered.every((c) => c === 1)).toBe(true);
  });

  it('keep the asked scale within the canvas limits', () => {
    expect(exportScale(1920, 1080, 4)).toBe(4);
    expect(exportScale(8000, 100, 4) * 8000).toBeCloseTo(MAX_SIDE_PX);
    const scale = exportScale(6000, 6000, 4);
    expect(6000 * scale * 6000 * scale).toBeCloseTo(MAX_PIXELS);
  });

  it('place each tile so a point lands on the same pixel of the whole image', () => {
    const view = { centerX: 10, centerY: -4, zoom: 0.75, width: 300, height: 200 };
    const scale = 3;
    const image = { width: 900, height: 600 };
    const point = { x: 37.3, y: 20.1 };
    const whole = tileView(view, scale, image, { x: 0, y: 0, ...image });
    const pixel = (v: typeof whole, at: typeof point) => [
      (at.x - v.centerX) * v.zoom + v.width / 2,
      (at.y - v.centerY) * v.zoom + v.height / 2,
    ];
    const [wx = 0, wy = 0] = pixel(whole, point);
    const tile = { x: 512, y: 256, width: 388, height: 344 };
    const [tx = 0, ty = 0] = pixel(tileView(view, scale, image, tile), point);
    expect(tx + tile.x).toBeCloseTo(wx, 9);
    expect(ty + tile.y).toBeCloseTo(wy, 9);
    expect(whole.pixelScale).toBe(3);
    expect(whole.centerX).toBe(view.centerX);
  });
});
