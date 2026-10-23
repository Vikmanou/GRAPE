import { browserEnv, requestAdapter } from './detect';
import { palettes, type Theme } from './palette';

/** Commands the UI sends to the engine. */
export type EngineCommand = { type: 'set-theme'; theme: Theme };

/** Events the engine reports to the UI. */
export type EngineEvent =
  | { type: 'resize'; width: number; height: number }
  | { type: 'device-lost'; message: string };

type Listener = (event: EngineEvent) => void;

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

  private constructor(
    private readonly host: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
    private readonly device: GPUDevice,
    private readonly context: GPUCanvasContext,
  ) {
    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) this.resize(entry);
    });
    this.resizeObserver.observe(host, { box: 'device-pixel-content-box' });

    void device.lost.then((info) => {
      if (this.destroyed) return;
      this.emit({ type: 'device-lost', message: info.message || info.reason });
    });
  }

  static async create(host: HTMLElement): Promise<Engine> {
    const adapter = await requestAdapter(browserEnv().gpu);
    if (!adapter) throw new Error('no WebGPU adapter available');
    const device = await adapter.requestDevice();
    const canvas = document.createElement('canvas');
    canvas.className = 'engine-canvas';
    canvas.dataset.testid = 'engine-canvas';
    const context = canvas.getContext('webgpu');
    if (!context) {
      device.destroy();
      throw new Error('canvas.getContext("webgpu") returned null');
    }
    context.configure({
      device,
      format: navigator.gpu.getPreferredCanvasFormat(),
      alphaMode: 'opaque',
    });
    host.appendChild(canvas);
    return new Engine(host, canvas, device, context);
  }

  send(command: EngineCommand): void {
    // `set-theme` is the only command so far; this becomes a switch on
    // `command.type` once milestone 2 adds more.
    this.theme = command.theme;
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
    this.listeners.clear();
    this.context.unconfigure();
    this.device.destroy();
    this.canvas.remove();
  }

  private emit(event: EngineEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private resize(entry: ResizeObserverEntry): void {
    const box = entry.devicePixelContentBoxSize[0];
    const dpr = window.devicePixelRatio;
    // Fall back to CSS size times DPR where device-pixel boxes are unsupported.
    const width = box ? box.inlineSize : Math.round(entry.contentRect.width * dpr);
    const height = box ? box.blockSize : Math.round(entry.contentRect.height * dpr);
    const max = this.device.limits.maxTextureDimension2D;
    this.canvas.width = Math.max(1, Math.min(width, max));
    this.canvas.height = Math.max(1, Math.min(height, max));
    this.emit({ type: 'resize', width: this.canvas.width, height: this.canvas.height });
    this.requestFrame();
  }

  /** Frames are rendered on demand, never in a free-running loop. */
  private requestFrame(): void {
    if (this.frameRequested || this.destroyed) return;
    this.frameRequested = true;
    requestAnimationFrame(() => {
      this.frameRequested = false;
      if (!this.destroyed) this.render();
    });
  }

  private render(): void {
    const [r, g, b, a] = palettes[this.theme].background;
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
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }
}
