import type { EngineCommand, EngineEvent } from './commands';
import type { Backend, Style } from './core/backend';
import { boundsOf, type Bounds } from './core/camera';
import { Bands } from './core/Bands';
import { Filtering } from './core/Filtering';
import { Framing } from './core/Framing';
import { FrameCounter } from './core/frames';
import { gestures } from './core/gestures';
import { attachInput } from './core/input';
import { Pointer } from './core/Pointer';
import { Positions } from './core/Positions';
import { RubberBand } from './core/RubberBand';
import { throttle } from './core/throttle';
import { DEFAULT_DISPLAY } from './style/display';
import { RIBBON_WIDTH } from './style/widths';
import { Atlas } from './text/Atlas';
import { Labels } from './text/Labels';
import { openBackend } from './openBackend';
import { Exporter } from './export/Exporter';
import type { View } from './core/backend';

type Listener = (event: EngineEvent) => void;

/**
 * While the layout runs, the graph is redrawn at most this often, and less
 * often when a draw is slow, so drawing takes at most a tenth of the GPU.
 * Moving the view still redraws every frame.
 */
const LAYOUT_REDRAW_MS = 100;
const LAYOUT_DRAW_SHARE = 10;
/** The view counts as moving for this long after the last pan or zoom. */
const INTERACTION_MS = 250;
/** The store mirrors the camera at most ten times a second (spec, Architecture). */
const CAMERA_EVENT_MS = 100;

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
  private readonly framing: Framing;
  private readonly pointer: Pointer;
  private readonly band: RubberBand;
  private readonly positions: Positions;
  private readonly frames = new FrameCounter();
  private lastDraw = -Infinity;
  private lastInteraction = -Infinity;
  /** Something other than layout progress changed since the last draw. */
  private dirty = true;
  /** Layout positions moved since they were last presented. */
  private stale = false;
  private reported = { x: NaN, y: NaN, zoom: NaN };
  private style: Style = { theme: 'light', display: DEFAULT_DISPLAY };
  private readonly labels: Labels;
  private readonly filtering: Filtering;
  private readonly bands: Bands;
  private readonly exporter: Exporter;
  private readonly cameraReport = throttle(() => {
    const camera = this.framing.camera;
    const last = this.reported;
    if (this.destroyed || (camera.x === last.x && camera.y === last.y && camera.zoom === last.zoom)) return;
    this.reported = { ...camera };
    this.emit({ type: 'camera', ...camera });
  }, CAMERA_EVENT_MS);

  private constructor(
    host: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
    private readonly backend: Backend,
    atlas: Atlas | undefined,
  ) {
    this.framing = new Framing(canvas);
    this.positions = new Positions(backend, this.framing);
    this.labels = new Labels(
      backend,
      atlas,
      (event) => {
        this.emit(event);
      },
      () => {
        this.requestFrame();
      },
    );
    this.filtering = new Filtering(backend, this.labels, (visible, total) => {
      this.emit({ type: 'visibility', visible, total });
    });
    this.bands = new Bands(backend);
    this.exporter = new Exporter(
      backend,
      {
        view: () => this.view(),
        camera: () => this.framing.camera,
        style: () => this.style,
        selection: () => this.pointer.selection.snapshot(),
        hidden: () => this.filtering.hidden,
        labels: () => this.labels.current(),
        bands: () => this.bands.hits,
        positions: () => this.positions.read(),
      },
      (event) => {
        if (!this.destroyed) this.emit(event);
      },
      () => {
        this.requestFrame();
      },
    );
    this.band = new RubberBand(canvas);
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
    this.detachInput = attachInput(
      canvas,
      gestures({
        framing: this.framing,
        pointer: this.pointer,
        band: this.band,
        layout: () => this.backend.layout,
        selectBox: (box) => this.backend.selectBox(box).then((bits) => this.filtering.shown(bits)),
        viewMoved: () => {
          this.viewMoved();
        },
        emit: (event) => {
          this.emit(event);
        },
      }),
    );
  }

  static async create(host: HTMLElement, kind: 'webgpu' | 'webgl2'): Promise<Engine> {
    const canvas = document.createElement('canvas');
    canvas.className = 'engine-canvas';
    canvas.dataset.testid = 'engine-canvas';
    const relay: { to?: Engine } = {};
    const emit = (event: EngineEvent) => {
      if (relay.to && !relay.to.destroyed) relay.to.emit(event);
    };
    const backend = await openBackend(canvas, kind, emit);
    const atlas = await Atlas.load(import.meta.env.BASE_URL);
    if (atlas) backend.setAtlas(atlas);
    relay.to = new Engine(host, canvas, backend, atlas);
    host.appendChild(canvas);
    relay.to.band.attach(host);
    return relay.to;
  }

  send(command: EngineCommand): void {
    const layout = this.backend.layout;
    const framing = this.framing;
    switch (command.type) {
      case 'set-theme':
        this.style = { ...this.style, theme: command.theme };
        this.backend.setStyle(this.style);
        this.band.setTheme(command.theme);
        break;
      case 'set-display':
        this.style = { ...this.style, display: command.display };
        this.backend.setStyle(this.style);
        break;
      case 'set-label-sizes':
        this.labels.setSizes(command.generation, command.sizes);
        return;
      case 'set-label-text':
        this.labels.setText(command.generation, command.segments, command.texts);
        return;
      case 'set-label-options':
        this.labels.setOptions(command.options);
        return;
      case 'set-graph':
        this.backend.setGraph(command.geometry, command.segments, command.seed);
        this.pointer.reset(command.segments.components);
        this.labels.clear();
        this.filtering.setGraph(command.segments);
        this.bands.setGeometry(command.geometry);
        this.exporter.setGraph(command.geometry, command.segments, command.seed);
        this.positions.reset();
        framing.autoFit = true;
        framing.setBounds(undefined);
        break;
      case 'set-filter':
        this.filtering.setFilter(command.filter);
        break;
      case 'set-bands':
        this.bands.set(command.bands);
        break;
      case 'set-path-colors':
        this.backend.setSegmentRun('path', command.colors);
        this.exporter.setSegments({ pathColors: command.colors });
        break;
      case 'set-gc':
        this.backend.setSegmentRun('gc', command.gc);
        this.exporter.setSegments({ gc: command.gc });
        break;
      case 'set-positions':
        layout.stop();
        if (command.progress) layout.setProgress(command.progress);
        this.positions.set(command.positions, command.grid, command.progress?.done ?? false);
        break;
      case 'start-layout':
        this.positions.dropCpu();
        framing.autoFit = true;
        // Components overlap until the first pack; their start still frames the view.
        framing.setBounds(boundsOf(command.hierarchy.start));
        layout.start(command.hierarchy, command.seed);
        break;
      case 'set-offsets':
        layout.setOffsets(command.offsets);
        framing.setBounds(layout.bounds());
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
      case 'export-png':
      case 'export-svg':
        this.exporter.handle(command);
        return;
      case 'read-visible':
        this.emit({ type: 'visible', bits: this.filtering.visibleBits() });
        return;
      case 'report-layout-profile':
        this.emit({ type: 'layout-profile', levels: layout.levels });
        return;
      case 'report-memory':
        this.emit({ type: 'memory', gpu: this.backend.gpuBytes, cpu: this.positions.cpuBytes });
        return;
      case 'fit':
        if (this.filtering.active) {
          void this.zoomTo(this.filtering.visibleBits());
          return;
        }
        framing.fitGraph();
        break;
      case 'set-camera':
        framing.place({ x: command.x, y: command.y, zoom: command.zoom });
        this.viewMoved();
        return;
      case 'pan-view':
        framing.pan(command.fx * this.canvas.width, command.fy * this.canvas.height);
        this.viewMoved();
        return;
      case 'zoom-view':
        framing.zoomAt(this.canvas.width / 2, this.canvas.height / 2, command.factor, !layout.usable);
        this.viewMoved();
        return;
      case 'set-insets':
        framing.setInsets(command.insets);
        break;
      case 'select':
      case 'select-component':
      case 'select-components':
      case 'invert-selection':
      case 'clear-selection':
        this.pointer.apply(command);
        return;
      case 'zoom-to-selection':
        void this.zoomTo(this.pointer.selection.snapshot(), command.follow);
        return;
      case 'unpin-all':
        layout.unpinAll();
        this.emit({ type: 'pins', count: layout.pinned });
        break;
      case 'relayout-selection':
        if (this.pointer.selection.count > 0) layout.refine(true);
        break;
      case 'zoom-to-component':
        void this.zoomTo(this.pointer.componentBits(command.component));
        return;
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
    this.cameraReport.cancel();
    this.labels.destroy();
    this.resizeObserver.disconnect();
    this.detachInput();
    this.listeners.clear();
    this.pointer.destroy();
    this.band.remove();
    this.backend.destroy();
    this.canvas.remove();
  }

  /** Frames the drawn extent of the segments whose bit is set, or only centres it when `follow`. */
  private async zoomTo(bits: Uint32Array<ArrayBuffer>, follow = false): Promise<void> {
    const origin = this.positions.origin;
    const box = await this.backend.bounds(bits);
    if (!box || this.destroyed) return;
    const pad = RIBBON_WIDTH;
    const world: Bounds = {
      minX: box.minX + origin.x - pad,
      minY: box.minY + origin.y - pad,
      maxX: box.maxX + origin.x + pad,
      maxY: box.maxY + origin.y + pad,
    };
    if (follow) this.framing.follow(world);
    else this.framing.frame(world);
    this.viewMoved();
  }

  private async readPositions(): Promise<void> {
    const positions = await this.positions.read();
    if (positions && !this.destroyed) this.emit({ type: 'positions', positions });
  }

  private emit(event: EngineEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private viewMoved(): void {
    this.lastInteraction = performance.now();
    this.pointer.viewMoved();
    this.requestFrame();
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
    this.framing.refit();
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

  /** The camera as the backend draws it, relative to the positions' origin. */
  private view(): View {
    const c = this.framing.camera;
    return {
      centerX: c.x - this.positions.origin.x,
      centerY: c.y - this.positions.origin.y,
      zoom: c.zoom,
      width: this.canvas.width,
      height: this.canvas.height,
    };
  }

  private draw(now: number): void {
    const started = performance.now();
    this.dirty = false;
    this.lastDraw = now;
    const c = this.framing.camera;
    const moved = this.stale;
    if (this.stale || this.positions.farFrom(c)) {
      this.stale = false;
      this.positions.upload();
    }
    const view = this.view();
    this.backend.draw(view);
    this.labels.drawn(view, moved, now);
    const stats = this.frames.record(now, performance.now() - started, this.backend.drawMs);
    if (stats) this.emit({ type: 'frame-stats', ...stats });
    this.cameraReport.request();
  }
}
