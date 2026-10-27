import { type Bounds, type Camera, fit, type Insets, NO_INSETS, pan, zoomAt } from './camera';

/** Free space around what is fitted, in CSS pixels. */
const FIT_MARGIN = 24;
/**
 * Before the layout is usable, many points share a few coarse positions, and
 * zooming far into them stacks thousands of screen-sized ribbons: enough
 * overdraw for the driver to reset the GPU (measured on the 200k graph).
 */
const COARSE_MAX_ZOOM = 8;

/** The camera, and keeping the graph framed in the part of the canvas no panel covers. */
export class Framing {
  camera: Camera = { x: 0, y: 0, zoom: 1 };
  /** The graph's extent, once known. */
  bounds: Bounds | undefined;
  /** Keeps the graph framed while the layout settles, until the user takes the view. */
  autoFit = true;
  private insets: Insets = NO_INSETS;

  constructor(private readonly canvas: HTMLCanvasElement) {}

  get viewport() {
    return { width: this.canvas.width, height: this.canvas.height };
  }

  /** CSS pixels of the canvas covered by panels. */
  setInsets(insets: Insets): void {
    this.insets = insets;
    this.refit();
  }

  setBounds(bounds: Bounds | undefined): void {
    this.bounds = bounds;
    this.refit();
  }

  /** Fits the graph again if the user has not taken the view. */
  refit(): void {
    if (this.autoFit && this.bounds) this.camera = this.fitted(this.bounds);
  }

  /** Fits the whole graph and keeps it fitted. */
  fitGraph(): void {
    this.autoFit = true;
    this.refit();
  }

  /** Frames a part of the graph, such as the selection. */
  frame(bounds: Bounds): void {
    this.autoFit = false;
    this.camera = this.fitted(bounds);
  }

  pan(dx: number, dy: number): void {
    this.take(pan(this.camera, dx, dy));
  }

  /** `coarse`: the layout is not usable yet, so zoom stops short. */
  zoomAt(x: number, y: number, factor: number, coarse: boolean): void {
    let allowed = factor;
    if (coarse && factor > 1 && this.bounds) {
      const limit = this.fitted(this.bounds, false).zoom * COARSE_MAX_ZOOM;
      allowed = Math.max(1, Math.min(factor, limit / this.camera.zoom));
    }
    this.take(zoomAt(this.camera, this.viewport, x, y, allowed));
  }

  private take(camera: Camera): void {
    this.autoFit = false;
    this.camera = camera;
  }

  private fitted(bounds: Bounds, insets = true): Camera {
    const dpr = window.devicePixelRatio;
    const { top, right, bottom, left } = insets ? this.insets : NO_INSETS;
    return fit(bounds, this.viewport, FIT_MARGIN * dpr, {
      top: top * dpr,
      right: right * dpr,
      bottom: bottom * dpr,
      left: left * dpr,
    });
  }
}
