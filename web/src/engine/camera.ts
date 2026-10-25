// World units are layout units with y pointing down, like the screen.
// Screen coordinates are canvas pixels (CSS pixels times devicePixelRatio).

/** The world point at the centre of the view, and pixels per world unit. */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const MIN_ZOOM = 1e-6;
export const MAX_ZOOM = 1e3;

function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function screenToWorld(c: Camera, v: Viewport, sx: number, sy: number): [number, number] {
  return [c.x + (sx - v.width / 2) / c.zoom, c.y + (sy - v.height / 2) / c.zoom];
}

export function worldToScreen(c: Camera, v: Viewport, wx: number, wy: number): [number, number] {
  return [(wx - c.x) * c.zoom + v.width / 2, (wy - c.y) * c.zoom + v.height / 2];
}

/** Zooms by `factor`, keeping the world point under the screen point fixed. */
export function zoomAt(c: Camera, v: Viewport, sx: number, sy: number, factor: number): Camera {
  const zoom = clampZoom(c.zoom * factor);
  const [wx, wy] = screenToWorld(c, v, sx, sy);
  return {
    x: wx - (sx - v.width / 2) / zoom,
    y: wy - (sy - v.height / 2) / zoom,
    zoom,
  };
}

/** Moves the view so content follows a drag of `dx, dy` pixels. */
export function pan(c: Camera, dx: number, dy: number): Camera {
  return { x: c.x - dx / c.zoom, y: c.y - dy / c.zoom, zoom: c.zoom };
}

/** Pixels of the viewport covered by panels on each side. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/** Frames `b` in the part of the viewport the insets leave free, `margin` pixels from its edges. */
export function fit(b: Bounds, v: Viewport, margin: number, insets: Insets = NO_INSETS): Camera {
  const free = {
    left: insets.left + margin,
    top: insets.top + margin,
    width: Math.max(1, v.width - insets.left - insets.right - 2 * margin),
    height: Math.max(1, v.height - insets.top - insets.bottom - 2 * margin),
  };
  const w = Math.max(b.maxX - b.minX, 1e-9);
  const h = Math.max(b.maxY - b.minY, 1e-9);
  const zoom = clampZoom(Math.min(free.width / w, free.height / h));
  const sx = free.left + free.width / 2;
  const sy = free.top + free.height / 2;
  return {
    x: (b.minX + b.maxX) / 2 - (sx - v.width / 2) / zoom,
    y: (b.minY + b.maxY) / 2 - (sy - v.height / 2) / zoom,
    zoom,
  };
}

/** Bounds of `x, y` pairs, or undefined when there are none. */
export function boundsOf(positions: Float32Array): Bounds | undefined {
  if (positions.length < 2) return undefined;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < positions.length; i += 2) {
    const x = positions[i] ?? 0;
    const y = positions[i + 1] ?? 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}
