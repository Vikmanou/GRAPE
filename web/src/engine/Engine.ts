import type { EngineCommand, EngineEvent } from './commands';
import { boundsOf, type Bounds, type Camera, fit, type Insets, NO_INSETS, pan, zoomAt } from './core/camera';
import { browserEnv, requestAdapter } from './core/detect';
import { FrameCounter } from './core/frames';
import { attachInput } from './core/input';
import { PassTiming } from './webgpu/layout/gpu';
import { createKernels, type Kernels } from './webgpu/layout/kernels';
import { LayoutRunner } from './webgpu/layout/runner';
import { palettes, randomColors, type Theme } from './style/palette';
import { Renderer } from './webgpu/renderer';

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
/**
 * While the layout runs, the graph is redrawn at most this often, and less
 * often when a draw is slow, so drawing takes at most a tenth of the GPU.
 * Moving the view still redraws every frame.
 */
const LAYOUT_REDRAW_MS = 100;
const LAYOUT_DRAW_SHARE = 10;
/** The view counts as moving for this long after the last pan or zoom. */
const INTERACTION_MS = 250;

/** Links fade out as ribbons shrink from 3 to 1 pixel wide. */
function linkFade(ribbonPixels: number): number {
  return Math.min(1, Math.max(0, (ribbonPixels - 1) / 2));
}

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
  private readonly runner: LayoutRunner;
  private camera: Camera = { x: 0, y: 0, zoom: 1 };
  private positions: Float32Array | undefined;
  private bounds: Bounds | undefined;
  private origin = { x: 0, y: 0 };
  /** Keeps the graph framed while the layout settles, until the user moves the view. */
  private autoFit = true;
  private insets: Insets = NO_INSETS;
  private readonly frames = new FrameCounter();
  private lastDraw = -Infinity;
  /** GPU time of recent draws, where the adapter reports it. */
  private drawMs = 0;
  private draws = 0;
  private lastInteraction = -Infinity;
  /** Something other than layout progress changed since the last draw. */
  private dirty = true;
  /** Layout positions moved since they were last presented. */
  private stale = false;

  private constructor(
    host: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
    private readonly device: GPUDevice,
    private readonly context: GPUCanvasContext,
    format: GPUTextureFormat,
    kernels: Kernels,
  ) {
    this.renderer = new Renderer(device, format, kernels);
    this.runner = new LayoutRunner(device, kernels, {
      measured: (boxes, progress) => {
        this.emit({ type: 'layout-measured', boxes, progress });
      },
    });
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
      requiredFeatures: adapter.features.has('timestamp-query') ? ['timestamp-query'] : [],
      requiredLimits: {
        maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
        maxBufferSize: adapter.limits.maxBufferSize,
      },
    });
    const kernels = await createKernels(device).catch((error: unknown) => {
      device.destroy();
      throw error;
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
    return new Engine(host, canvas, device, context, format, kernels);
  }

  send(command: EngineCommand): void {
    switch (command.type) {
      case 'set-theme':
        this.theme = command.theme;
        break;
      case 'set-graph':
        this.runner.stop();
        this.renderer.setGeometry(command.geometry, randomColors(command.geometry.segments, command.seed));
        this.positions = undefined;
        this.bounds = undefined;
        this.autoFit = true;
        break;
      case 'set-positions':
        this.runner.stop();
        this.positions = command.positions;
        this.bounds = boundsOf(command.positions);
        if (this.autoFit) this.fitView();
        this.upload();
        break;
      case 'start-layout':
        this.positions = undefined;
        this.bounds = undefined;
        this.autoFit = true;
        this.runner.start(command.hierarchy, command.seed);
        break;
      case 'set-offsets':
        this.runner.setOffsets(command.offsets);
        this.bounds = this.runner.bounds();
        if (this.autoFit) this.fitView();
        // Waits for the next layout redraw, like any other layout progress.
        this.stale = true;
        this.scheduleFrame();
        return;
      case 'pause-layout':
        this.runner.setPaused(command.paused);
        break;
      case 'read-positions':
        void this.readPositions();
        return;
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
    this.runner.destroy();
    this.renderer.destroy();
    this.context.unconfigure();
    this.device.destroy();
    this.canvas.remove();
  }

  private async readPositions(): Promise<void> {
    const positions = (await this.runner.readPositions()) ?? this.positions?.slice();
    if (positions && !this.destroyed) this.emit({ type: 'positions', positions });
  }

  private emit(event: EngineEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private viewport() {
    return { width: this.canvas.width, height: this.canvas.height };
  }

  private moveCamera(camera: Camera): void {
    this.lastInteraction = performance.now();
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

  private upload(): void {
    const ox = Math.round(this.camera.x);
    const oy = Math.round(this.camera.y);
    const target = this.renderer.positionBuffer;
    if (this.runner.active && target) {
      this.origin = { x: ox, y: oy };
      this.runner.present(target, this.origin);
      return;
    }
    const positions = this.positions;
    if (!positions) return;
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
    this.dirty = true;
    this.scheduleFrame();
  }

  private scheduleFrame(): void {
    if (this.frameRequested || this.destroyed) return;
    this.frameRequested = true;
    requestAnimationFrame((now) => {
      this.frameRequested = false;
      if (!this.destroyed) this.render(now);
    });
  }

  /**
   * Runs the layout's batch every frame, but redraws a settling layout only
   * as `LAYOUT_REDRAW_MS` and `LAYOUT_DRAW_SHARE` allow.
   */
  private render(now: number): void {
    const interactive = now - this.lastInteraction < INTERACTION_MS;
    this.stale = this.runner.tick(now, interactive) || this.stale;
    const busy = this.runner.busy;
    const redraw = Math.max(LAYOUT_REDRAW_MS, this.drawMs * LAYOUT_DRAW_SHARE);
    if (this.dirty || (this.stale && (!busy || now - this.lastDraw >= redraw))) this.draw(now);
    if (busy) this.scheduleFrame();
  }

  private draw(now: number): void {
    const started = performance.now();
    this.dirty = false;
    this.lastDraw = now;
    const c = this.camera;
    if (this.stale || Math.hypot(c.x - this.origin.x, c.y - this.origin.y) * c.zoom > REBASE_PIXELS) {
      this.stale = false;
      this.upload();
    }
    const palette = palettes[this.theme];
    const [r, g, b, a] = palette.background;
    const encoder = this.device.createCommandEncoder({ label: 'frame' });
    // Every draw is timed while the layout runs, for its redraw budget, and
    // one in eight otherwise, for the frame rate.
    const timed = this.device.features.has('timestamp-query') && (this.runner.busy || this.draws % 8 === 0);
    this.draws++;
    const timing = timed ? new PassTiming(this.device) : undefined;
    const view = {
      centerX: c.x - this.origin.x,
      centerY: c.y - this.origin.y,
      zoom: c.zoom,
      width: this.canvas.width,
      height: this.canvas.height,
      ribbonHalf: RIBBON_WIDTH / 2,
      linkHalf: LINK_WIDTH / 2,
      linkAlpha: linkFade(RIBBON_WIDTH * c.zoom),
      linkColor: palette.link,
    };
    this.renderer.cull(encoder, view);
    const pass = encoder.beginRenderPass({
      ...(timing && { timestampWrites: timing.writes }),
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r, g, b, a },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    this.renderer.draw(pass, view);
    pass.end();
    timing?.resolve(encoder);
    this.device.queue.submit([encoder.finish()]);
    void timing?.ms().then((ms) => {
      this.drawMs = this.drawMs * 0.7 + ms * 0.3;
    });
    const stats = this.frames.record(now, performance.now() - started, this.drawMs);
    if (stats) this.emit({ type: 'frame-stats', ...stats });
  }
}
