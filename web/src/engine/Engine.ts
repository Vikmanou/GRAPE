import type { EngineCommand, EngineEvent } from './commands';
import type { Backend } from './core/backend';
import { boundsOf, type Bounds, type Camera, fit, type Insets, NO_INSETS, pan, zoomAt } from './core/camera';
import { FrameCounter } from './core/frames';
import { Pointer } from './core/Pointer';
import { attachInput } from './core/input';
import { randomColors } from './style/palette';
import { WebGpuBackend } from './webgpu/WebGpuBackend';

type Listener = (event: EngineEvent) => void;

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
/**
 * Before the layout is usable, many points share a few coarse positions, and
 * zooming far into them stacks thousands of screen-sized ribbons: enough
 * overdraw for the driver to reset the GPU (measured on the 200k graph).
 */
const COARSE_MAX_ZOOM = 8;

/**
 * Owns the canvas, the camera and the frame loop, and draws through a
 * backend. The store talks to it through `send` and `on`.
 */
export class Engine {
  private frameRequested = false;
  private destroyed = false;
  private readonly listeners = new Set<Listener>();
  private readonly resizeObserver: ResizeObserver;
  private readonly detachInput: () => void;
  private camera: Camera = { x: 0, y: 0, zoom: 1 };
  private positions: Float32Array | undefined;
  private bounds: Bounds | undefined;
  private origin = { x: 0, y: 0 };
  /** Keeps the graph framed while the layout settles, until the user moves the view. */
  private autoFit = true;
  private insets: Insets = NO_INSETS;
  private readonly frames = new FrameCounter();
  private lastDraw = -Infinity;
  private lastInteraction = -Infinity;
  /** Something other than layout progress changed since the last draw. */
  private dirty = true;
  /** Layout positions moved since they were last presented. */
  private stale = false;
  private readonly pointer: Pointer;

  private constructor(
    host: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
    private readonly backend: Backend,
  ) {
    this.pointer = new Pointer(backend, canvas, {
      emit: (event) => {
        this.emit(event);
      },
      redraw: () => {
        this.requestFrame();
      },
      wake: () => {
        this.scheduleFrame();
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
        this.moveCamera(zoomAt(this.camera, this.viewport(), x, y, this.allowedZoom(factor)));
      },
      zoomCenter: (factor) => {
        const [x, y] = [canvas.width / 2, canvas.height / 2];
        this.moveCamera(zoomAt(this.camera, this.viewport(), x, y, this.allowedZoom(factor)));
      },
      panView: (fx, fy) => {
        this.moveCamera(pan(this.camera, fx * canvas.width, fy * canvas.height));
      },
      fit: () => {
        this.send({ type: 'fit' });
      },
      hover: (x, y) => {
        this.pointer.moved(x, y);
      },
      leave: () => {
        this.pointer.left();
      },
      click: (x, y, shift) => {
        // Panels that open for the selection must not refit the view under the pointer.
        this.autoFit = false;
        this.pointer.click(x, y, shift);
      },
    });
  }

  static async create(host: HTMLElement): Promise<Engine> {
    const canvas = document.createElement('canvas');
    canvas.className = 'engine-canvas';
    canvas.dataset.testid = 'engine-canvas';
    const relay: { to?: Engine } = {};
    const emit = (event: EngineEvent) => {
      if (relay.to && !relay.to.destroyed) relay.to.emit(event);
    };
    const backend = await WebGpuBackend.create(canvas, {
      error: (message) => {
        emit({ type: 'error', message });
      },
      lost: (message) => {
        emit({ type: 'device-lost', message });
      },
      measured: (boxes, progress) => {
        emit({ type: 'layout-measured', boxes, progress });
      },
    });
    relay.to = new Engine(host, canvas, backend);
    host.appendChild(canvas);
    return relay.to;
  }

  send(command: EngineCommand): void {
    const layout = this.backend.layout;
    switch (command.type) {
      case 'set-theme':
        this.backend.setStyle({ theme: command.theme });
        break;
      case 'set-graph':
        this.backend.setGraph(command.geometry, randomColors(command.geometry.segments, command.seed));
        this.pointer.reset(command.geometry.segments);
        this.positions = undefined;
        this.bounds = undefined;
        this.autoFit = true;
        break;
      case 'set-positions':
        layout.stop();
        this.positions = command.positions;
        this.bounds = boundsOf(command.positions);
        if (this.autoFit) this.fitView();
        this.upload();
        break;
      case 'start-layout':
        this.positions = undefined;
        // Components overlap until the first pack; their start still frames the view.
        this.bounds = boundsOf(command.hierarchy.start);
        this.autoFit = true;
        this.fitView();
        layout.start(command.hierarchy, command.seed);
        break;
      case 'set-offsets':
        layout.setOffsets(command.offsets);
        this.bounds = layout.bounds();
        if (this.autoFit) this.fitView();
        // Waits for the next layout redraw, like any other layout progress.
        this.stale = true;
        this.scheduleFrame();
        return;
      case 'pause-layout':
        layout.setPaused(command.paused);
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
      case 'select': {
        const selection = this.pointer.selection;
        if (command.mode === 'replace') selection.replace(command.segments);
        else selection.add(command.segments);
        this.pointer.selectionChanged();
        break;
      }
      case 'clear-selection':
        this.pointer.selection.clear();
        this.pointer.selectionChanged();
        break;
      case 'invert-selection':
        this.pointer.selection.invert();
        this.pointer.selectionChanged();
        break;
      case 'pick': {
        const { x, y } = command;
        void this.backend.pick(x, y).then((segment) => {
          this.emit({ type: 'picked', x, y, segment });
        });
        return;
      }
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
    this.pointer.destroy();
    this.backend.destroy();
    this.canvas.remove();
  }

  private async readPositions(): Promise<void> {
    const positions = (await this.backend.layout.readPositions()) ?? this.positions?.slice();
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
    this.pointer.viewMoved();
    this.requestFrame();
  }

  private allowedZoom(factor: number): number {
    if (factor <= 1 || this.backend.layout.usable || !this.bounds) return factor;
    const fitted = fit(this.bounds, this.viewport(), FIT_MARGIN * window.devicePixelRatio).zoom;
    return Math.max(1, Math.min(factor, (fitted * COARSE_MAX_ZOOM) / this.camera.zoom));
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
    this.origin = { x: Math.round(this.camera.x), y: Math.round(this.camera.y) };
    const layout = this.backend.layout;
    if (layout.active) {
      layout.present(this.origin);
      return;
    }
    const positions = this.positions;
    if (!positions) return;
    const relative = new Float32Array(positions.length);
    for (let i = 0; i < positions.length; i += 2) {
      relative[i] = (positions[i] ?? 0) - this.origin.x;
      relative[i + 1] = (positions[i + 1] ?? 0) - this.origin.y;
    }
    this.backend.setPositions(relative);
  }

  private resize(entry: ResizeObserverEntry): void {
    // `devicePixelContentBoxSize` is undefined, not empty, in Safari.
    const box = (entry.devicePixelContentBoxSize as ResizeObserverSize[] | undefined)?.[0];
    const dpr = window.devicePixelRatio;
    const width = box ? box.inlineSize : Math.round(entry.contentRect.width * dpr);
    const height = box ? box.blockSize : Math.round(entry.contentRect.height * dpr);
    const max = this.backend.maxCanvasSize;
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
    const layout = this.backend.layout;
    const interactive = now - this.lastInteraction < INTERACTION_MS;
    this.stale = layout.tick(now, interactive) || this.stale;
    const busy = layout.busy;
    const redraw = Math.max(LAYOUT_REDRAW_MS, this.backend.drawMs * LAYOUT_DRAW_SHARE);
    if (this.dirty || (this.stale && (!busy || now - this.lastDraw >= redraw))) this.draw(now);
    this.pointer.pickHover();
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
    this.backend.draw({
      centerX: c.x - this.origin.x,
      centerY: c.y - this.origin.y,
      zoom: c.zoom,
      width: this.canvas.width,
      height: this.canvas.height,
    });
    const stats = this.frames.record(now, performance.now() - started, this.backend.drawMs);
    if (stats) this.emit({ type: 'frame-stats', ...stats });
  }
}
