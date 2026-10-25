import { describe, expect, it } from 'vitest';
import { boundsOf, fit, MAX_ZOOM, pan, screenToWorld, worldToScreen, zoomAt } from '../../src/engine/camera';

const view = { width: 800, height: 600 };

describe('camera', () => {
  it('round trips between screen and world', () => {
    const c = { x: 1e6, y: -3.5, zoom: 0.25 };
    const [wx, wy] = screenToWorld(c, view, 123, 456);
    const [sx, sy] = worldToScreen(c, view, wx, wy);
    expect(sx).toBeCloseTo(123, 6);
    expect(sy).toBeCloseTo(456, 6);
  });

  it('keeps the point under the cursor fixed while zooming', () => {
    const c = { x: 10, y: 20, zoom: 2 };
    const before = screenToWorld(c, view, 100, 500);
    const zoomed = zoomAt(c, view, 100, 500, 3.7);
    expect(zoomed.zoom).toBeCloseTo(7.4);
    const after = screenToWorld(zoomed, view, 100, 500);
    expect(after[0]).toBeCloseTo(before[0], 9);
    expect(after[1]).toBeCloseTo(before[1], 9);
  });

  it('clamps zoom', () => {
    expect(zoomAt({ x: 0, y: 0, zoom: 1 }, view, 0, 0, 1e9).zoom).toBe(MAX_ZOOM);
  });

  it('pans with the drag', () => {
    const c = pan({ x: 0, y: 0, zoom: 2 }, 10, -4);
    expect(c).toEqual({ x: -5, y: 2, zoom: 2 });
  });

  it('fits bounds inside the margin', () => {
    const c = fit({ minX: 0, minY: 0, maxX: 1000, maxY: 100 }, view, 50);
    expect(c.x).toBe(500);
    expect(c.y).toBe(50);
    expect(c.zoom).toBeCloseTo(0.7);
    const [left] = worldToScreen(c, view, 0, 0);
    expect(left).toBeCloseTo(50);
  });

  it('fits into the area panels leave free', () => {
    const insets = { top: 40, right: 0, bottom: 20, left: 300 };
    const c = fit({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, view, 10, insets);
    const [x0, y0] = worldToScreen(c, view, 0, 0);
    const [x1, y1] = worldToScreen(c, view, 100, 100);
    // The free area is 480 by 520 pixels from (310, 50); width limits zoom.
    expect(x0).toBeCloseTo(310);
    expect(x1).toBeCloseTo(790);
    expect((y0 + y1) / 2).toBeCloseTo(50 + 260);
  });

  it('measures bounds', () => {
    expect(boundsOf(new Float32Array([1, 2, -3, 8, 5, 0]))).toEqual({ minX: -3, minY: 0, maxX: 5, maxY: 8 });
    expect(boundsOf(new Float32Array())).toBeUndefined();
  });
});
