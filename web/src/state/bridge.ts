import type { EngineCommand, EngineEvent } from '../engine/commands';
import type { Context } from './store';

export interface EngineLike {
  send(command: EngineCommand): void;
  on(listener: (event: EngineEvent) => void): () => void;
  destroy(): void;
}

type Listener = (event: EngineEvent) => void;

/**
 * The only holder of the engine: store actions send commands through it, and
 * engine events come back through it into the store.
 */
export class Bridge {
  private engine: EngineLike | undefined;
  /** Bumped on every attach and detach, so a late engine from an old attach is dropped. */
  private generation = 0;
  private readonly listeners = new Set<Listener>();

  constructor(
    private readonly ctx: Context,
    private readonly createEngine: (host: HTMLElement) => Promise<EngineLike>,
  ) {}

  get attached(): boolean {
    return this.engine !== undefined;
  }

  async attach(host: HTMLElement): Promise<boolean> {
    const generation = ++this.generation;
    const engine = await this.createEngine(host);
    if (generation !== this.generation) {
      engine.destroy();
      return false;
    }
    this.engine = engine;
    engine.on((event) => {
      this.receive(event);
    });
    const { theme, insets, displayOptions, labels } = this.ctx.get();
    engine.send({ type: 'set-theme', theme });
    engine.send({ type: 'set-display', display: displayOptions });
    const { max, minRibbonPx, fontPx } = labels;
    engine.send({ type: 'set-label-options', options: { max, minRibbonPx, fontPx } });
    engine.send({ type: 'set-insets', insets });
    return true;
  }

  detach(): void {
    this.generation++;
    this.engine?.destroy();
    this.engine = undefined;
  }

  send(command: EngineCommand): void {
    this.engine?.send(command);
  }

  /** Engine events for a store action that waits on them, such as a layout run. */
  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private receive(event: EngineEvent): void {
    const { set, get } = this.ctx;
    switch (event.type) {
      case 'frame-stats':
        set({ fps: event.fps });
        break;
      case 'error':
        console.error(`GPU error: ${event.message}`);
        get().toast('The GPU reported an error', event.message);
        break;
      case 'camera':
        set({ camera: { x: event.x, y: event.y, zoom: event.zoom } });
        break;
      case 'refining':
        set({ refining: event.active });
        break;
      case 'pins':
        set({ pinned: event.count });
        break;
      case 'layout-control':
        this.ctx.layout?.send(event.request);
        break;
      case 'hover':
        set({ hovered: event.segment });
        break;
      case 'labels-needed':
        get().fetchLabelText(event.generation, event.segments);
        break;
      case 'labels':
        set({ labelCount: event.segments.length });
        break;
      case 'selection':
        set({ selection: { count: event.count, single: event.single, bits: event.bits } });
        get().refreshDetails();
        break;
      case 'device-lost':
        get().engineFailed(`GPU device lost: ${event.message}`);
        break;
      default:
        break;
    }
    for (const listener of this.listeners) listener(event);
  }
}
