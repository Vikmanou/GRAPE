import type { Geometry } from '../workers/protocol';
import { boundsOf, type Bounds, type Camera, fit, type Insets, NO_INSETS, pan, zoomAt } from './camera';
import { browserEnv, requestAdapter } from './detect';
import { attachInput } from './input';
import { palettes, randomColors, type Theme } from './palette';
import { Renderer } from './renderer';

/** Commands the UI sends to the engine. */
export type EngineCommand =
  | { type: 'set-theme'; theme: Theme }
  | { type: 'set-graph'; geometry: Geometry; seed: number }
  /** `x, y` per point, in layout units. */
  | { type: 'set-positions'; positions: Float32Array }
  | { type: 'fit' }
  /** CSS pixels of the canvas covered by panels, kept clear when fitting. */
  | { type: 'set-insets'; insets: Insets };

/** Events the engine reports to the UI. */
export type EngineEvent =
  | { type: 'resize'; width: number; height: number }
  | { type: 'device-lost'; message: string }
  | { type: 'error'; message: string }
  /** Sent after each second of continuous drawing, such as a pan or zoom. */
  | { type: 'frame-stats'; fps: number; cpuMs: number };

type Listener = (event: EngineEvent) => void;

// Bandage's defaults (`averageNodeWidth` and `edgeWidth` in program/settings.cpp).
const RIBBON_WIDTH = 5;
const LINK_WIDTH = 1.5;
/** Free space around the graph when fitting, in CSS pixels. */
const FIT_MARGIN = 24;
/**
 * Positions are re-uploaded relative to the camera once it is this many
 * pixels from the upload origin, keeping shader maths within f32 precision.
 */
const REBASE_PIXELS = 1e5;
const STATS_INTERVAL_MS = 1000;
/** Frames further apart than this are not part of continuous drawing. */
const CONTINUOUS_GAP_MS = 50;

/**
 * Owns the canvas, the GPU device and the frame loop. The UI never touches
 * GPU objects; it talks to the engine only through `send` and `on`.
 */
export class Engine {
  private theme: Theme = 'light';
  private frameRequested = false;
  private destroyed = false;
  private readonly listeners = new Set<Listener>();
  private readonly resizeObserver: ResizeObserver;
  private readonly detachInput: () => void;
  private readonly renderer: Renderer;
  private camera: Camera = { x: 0, y: 0, zoom: 1 };
  private positions: Float32Array | undefined;
  private bounds: Bounds | undefined;
  private origin = { x: 0, y: 0 };
  /** Keeps the graph framed while the layout settles, until the user moves the view. */
  private autoFit = true;
  private insets: Insets = NO_INSETS;
  private stats = { last: 0, time: 0, frames: 0, cpuMs: 0 };

  private constructor(
    private readonly host: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
    private readonly device: GPUDevice,
    private readonly context: GPUCanvasContext,
    format: GPUTextureFormat,
  ) {
    this.renderer = new Renderer(device, format);
    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) this.resize(entry);
    });
    try {
      this.resizeObserver.observe(host, { box: 'device-pixel-content-box' });
    } catch {
      // Safari rejects this box type; resize() falls back to CSS size × DPR.
      this.resizeObserver.observe(host);
    }
    this.detachInput = attachInput(canvas, {
      pan: (dx, dy) => {
        this.moveCamera(pan(this.camera, dx, dy));
      },
      zoom: (x, y, factor) => {
        this.moveCamera(zoomAt(this.camera, this.viewport(), x, y, factor));
      },
      zoomCenter: (factor) => {
        this.moveCamera(zoomAt(this.camera, this.viewport(), canvas.width / 2, canvas.height / 2, factor));
      },
      panView: (fx, fy) => {
        this.moveCamera(pan(this.camera, fx * canvas.width, fy * canvas.height));
      },
      fit: () => {
        this.send({ type: 'fit' });
      },
    });

    device.addEventListener('uncapturederror', (event) => {
      this.emit({ type: 'error', message: event.error.message });
    });
    void device.lost.then((info) => {
      if (this.destroyed) return;
      this.emit({ type: 'device-lost', message: info.message || info.reason });
    });
  }

  static async create(host: HTMLElement): Promise<Engine> {
    const adapter = await requestAdapter(browserEnv().gpu);
    if (!adapter) throw new Error('no WebGPU adapter available');
    // The defaults (128 MB bindings) are below what large graphs need and
    // below what most adapters offer.
    const device = await adapter.requestDevice({
      requiredLimits: {
        maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
        maxBufferSize: adapter.limits.maxBufferSize,
      },
    });
    const canvas = document.createElement('canvas');
    canvas.className = 'engine-canvas';
    canvas.dataset.testid = 'engine-canvas';
    const context = canvas.getContext('webgpu');
    if (!context) {
      device.destroy();
      throw new Error('canvas.getContext("webgpu") returned null');
    }
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'opaque' });
    host.appendChild(canvas);
    return new Engine(host, canvas, device, context, format);
  }

  send(command: EngineCommand): void {
    switch (command.type) {
      case 'set-theme':
        this.theme = command.theme;
        break;
      case 'set-graph':
        this.renderer.setGeometry(command.geometry, randomColors(command.geometry.segments, command.seed));
        this.positions = undefined;
        this.bounds = undefined;
        this.autoFit = true;
        break;
      case 'set-positions':
        this.positions = command.positions;
        this.bounds = boundsOf(command.positions);
        if (this.autoFit) this.fitView();
        this.upload();
        break;
      case 'fit':
        this.autoFit = true;
        this.fitView();
        break;
      case 'set-insets':
        this.insets = command.insets;
        if (this.autoFit) this.fitView();
        break;
    }
    this.requestFrame();
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.resizeObserver.disconnect();
    this.detachInput();
    this.listeners.clear();
    this.renderer.destroy();
    this.context.unconfigure();
    this.device.destroy();
    this.canvas.remove();
  }

  private emit(event: EngineEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private viewport() {
    return { width: this.canvas.width, height: this.canvas.height };
  }

  private moveCamera(camera: Camera): void {
    this.autoFit = false;
    this.camera = camera;
    this.requestFrame();
  }

  private fitView(): void {
    if (!this.bounds) return;
    const dpr = window.devicePixelRatio;
    const { top, right, bottom, left } = this.insets;
    this.camera = fit(this.bounds, this.viewport(), FIT_MARGIN * dpr, {
      top: top * dpr,
      right: right * dpr,
      bottom: bottom * dpr,
      left: left * dpr,
    });
  }

  /** Sends positions relative to an origin at the camera, computed in f64. */
  private upload(): void {
    const positions = this.positions;
    if (!positions) return;
    const ox = Math.round(this.camera.x);
    const oy = Math.round(this.camera.y);
    const relative = new Float32Array(positions.length);
    for (let i = 0; i < positions.length; i += 2) {
      relative[i] = (positions[i] ?? 0) - ox;
      relative[i + 1] = (positions[i + 1] ?? 0) - oy;
    }
    this.origin = { x: ox, y: oy };
    this.renderer.setPositions(relative);
  }

  private resize(entry: ResizeObserverEntry): void {
    // `devicePixelContentBoxSize` is undefined, not empty, in Safari.
    const box = (entry.devicePixelContentBoxSize as ResizeObserverSize[] | undefined)?.[0];
    const dpr = window.devicePixelRatio;
    const width = box ? box.inlineSize : Math.round(entry.contentRect.width * dpr);
    const height = box ? box.blockSize : Math.round(entry.contentRect.height * dpr);
    const max = this.device.limits.maxTextureDimension2D;
    this.canvas.width = Math.max(1, Math.min(width, max));
    this.canvas.height = Math.max(1, Math.min(height, max));
    if (this.autoFit) this.fitView();
    this.emit({ type: 'resize', width: this.canvas.width, height: this.canvas.height });
    this.requestFrame();
  }

  /** Frames are rendered on demand, never in a free-running loop. */
  private requestFrame(): void {
    if (this.frameRequested || this.destroyed) return;
    this.frameRequested = true;
    requestAnimationFrame((now) => {
      this.frameRequested = false;
      if (!this.destroyed) this.render(now);
    });
  }

  private render(now: number): void {
    const started = performance.now();
    const c = this.camera;
    if (Math.hypot(c.x - this.origin.x, c.y - this.origin.y) * c.zoom > REBASE_PIXELS) this.upload();
    const palette = palettes[this.theme];
    const [r, g, b, a] = palette.background;
    const encoder = this.device.createCommandEncoder({ label: 'frame' });
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r, g, b, a },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    this.renderer.draw(pass, {
      centerX: c.x - this.origin.x,
      centerY: c.y - this.origin.y,
      zoom: c.zoom,
      width: this.canvas.width,
      height: this.canvas.height,
      ribbonHalf: RIBBON_WIDTH / 2,
      linkHalf: LINK_WIDTH / 2,
      // Links fade out as ribbons shrink from 3 to 1 pixel wide.
      linkAlpha: Math.min(1, Math.max(0, (RIBBON_WIDTH * c.zoom - 1) / 2)),
      linkColor: palette.link,
    });
    pass.end();
    this.device.queue.submit([encoder.finish()]);
    this.recordFrame(now, performance.now() - started);
  }

  private recordFrame(now: number, cpuMs: number): void {
    const s = this.stats;
    const gap = now - s.last;
    s.last = now;
    // Only back-to-back frames measure the frame rate; a frame drawn for an
    // occasional layout update does not.
    if (gap > CONTINUOUS_GAP_MS) return;
    s.time += gap;
    s.frames++;
    s.cpuMs += cpuMs;
    if (s.time >= STATS_INTERVAL_MS) {
      this.emit({ type: 'frame-stats', fps: (s.frames * 1000) / s.time, cpuMs: s.cpuMs / s.frames });
      s.time = 0;
      s.frames = 0;
      s.cpuMs = 0;
    }
  }
}
