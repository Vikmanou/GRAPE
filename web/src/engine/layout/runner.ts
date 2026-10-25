import type { Hierarchy } from '../../workers/protocol';
import type { Bounds } from '../camera';
import { PassTiming } from './gpu';
import { GpuLayout } from './GpuLayout';
import type { Kernels } from './kernels';

/**
 * GPU time a batch aims for, smaller while the user moves the view. Above a
 * frame, so the two queued batches keep the GPU busy between frames.
 */
const BATCH_MS = 20;
const INTERACTIVE_BATCH_MS = 4;
/** Two batches queued keep the GPU busy while the next one is encoded. */
const MAX_IN_FLIGHT = 2;
/** Encoding an iteration costs the main thread about 50 µs. */
const MAX_BATCH = 128;
const MEASURE_INTERVAL_MS = 250;

export interface LayoutProgress {
  iteration: number;
  total: number;
  level: number;
  levels: number;
  energy: number;
  done: boolean;
}

export interface RunnerEvents {
  /** Unpacked boxes to pack, with the progress at the time they were measured. */
  measured(boxes: Float32Array<ArrayBuffer>, progress: LayoutProgress): void;
}

/**
 * Drives a `GpuLayout` from the frame loop: a batch of iterations per frame,
 * with at most two in flight so the queue never backs up. Each batch is sized
 * from the GPU time of the last one: timestamps where the adapter has them,
 * otherwise the time until the queue reports it done, which runs long.
 */
export class LayoutRunner {
  private layout: GpuLayout | undefined;
  private paused = false;
  private inFlight = 0;
  private measuring = false;
  /** Iterations per batch; fractional so it can grow from 1 in small steps. */
  private batch = 1;
  private lastMeasure = -Infinity;
  private batchLevel = -1;
  private batchNodes = 1;
  private reportedDone = false;
  private offsets: Float32Array | undefined;
  private boxes: Float32Array | undefined;
  /** Whether positions changed since the last `present`. */
  private moved = false;

  constructor(
    private readonly device: GPUDevice,
    private readonly kernels: Kernels,
    private readonly events: RunnerEvents,
  ) {}

  get active(): boolean {
    return this.layout !== undefined;
  }

  /** Whether the frame loop should keep going for the layout's sake. */
  get busy(): boolean {
    if (!this.layout) return false;
    return this.measuring || this.inFlight > 0 || (!this.reportedDone && !this.paused);
  }

  get bytes(): number {
    return this.layout?.bytes ?? 0;
  }

  start(hierarchy: Hierarchy, seed: number): void {
    this.stop();
    this.layout = new GpuLayout(this.device, this.kernels, hierarchy, seed);
    this.paused = false;
    this.batch = 1;
    this.batchLevel = -1;
    this.lastMeasure = -Infinity;
    this.reportedDone = false;
    this.offsets = undefined;
    this.boxes = undefined;
    this.moved = true;
  }

  stop(): void {
    this.layout?.destroy();
    this.layout = undefined;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  /** `dx, dy` per component, from packing the boxes last measured. */
  setOffsets(offsets: Float32Array): void {
    this.offsets = offsets;
    this.moved = true;
  }

  /** The packed graph's extent, once a pack has arrived. */
  bounds(): Bounds | undefined {
    const { offsets, boxes } = this;
    if (!offsets || !boxes || offsets.length * 2 !== boxes.length) return undefined;
    const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (let c = 0; c * 4 < boxes.length; c++) {
      const [dx, dy] = [offsets[c * 2] ?? 0, offsets[c * 2 + 1] ?? 0];
      b.minX = Math.min(b.minX, (boxes[c * 4] ?? 0) + dx);
      b.minY = Math.min(b.minY, (boxes[c * 4 + 1] ?? 0) + dy);
      b.maxX = Math.max(b.maxX, (boxes[c * 4 + 2] ?? 0) + dx);
      b.maxY = Math.max(b.maxY, (boxes[c * 4 + 3] ?? 0) + dy);
    }
    return b;
  }

  /** Runs this frame's batch. Returns whether positions moved since the last call. */
  tick(now: number, interactive: boolean): boolean {
    const layout = this.layout;
    if (!layout) return false;
    if (!this.paused && this.inFlight < MAX_IN_FLIGHT && !layout.done) {
      this.enterLevel(layout.currentLevel, layout.levelNodes);
      const level = layout.currentLevel;
      const timing = this.device.features.has('timestamp-query') ? new PassTiming(this.device) : undefined;
      const submitted = performance.now();
      this.moved ||= layout.run(Math.round(this.batch), timing) > 0;
      this.inFlight++;
      const measured = timing
        ? timing.ms()
        : this.device.queue.onSubmittedWorkDone().then(() => performance.now() - submitted);
      void measured.then((ms) => {
        this.inFlight--;
        if (this.layout !== layout || layout.currentLevel !== level) return;
        const factor = Math.min(2, Math.max(0.5, (interactive ? INTERACTIVE_BATCH_MS : BATCH_MS) / Math.max(ms, 0.05)));
        this.batch = Math.min(MAX_BATCH, Math.max(1, this.batch * factor));
      });
    }
    const finished = layout.done && this.inFlight === 0;
    if (!this.measuring && !this.reportedDone && (finished || now - this.lastMeasure >= MEASURE_INTERVAL_MS)) {
      this.measure(layout, now);
    }
    const moved = this.moved;
    this.moved = false;
    return moved;
  }

  present(target: GPUBuffer, origin: { x: number; y: number }): void {
    const layout = this.layout;
    if (!layout) return;
    const offsets = this.offsets;
    const shift = new Float32Array(layout.components * 2);
    for (let c = 0; c < shift.length; c += 2) {
      shift[c] = (offsets?.[c] ?? 0) - origin.x;
      shift[c + 1] = (offsets?.[c + 1] ?? 0) - origin.y;
    }
    layout.present(target, shift);
  }

  destroy(): void {
    this.stop();
  }

  /** A new level keeps the batch, scaled by how many more nodes each iteration moves. */
  private enterLevel(level: number, nodes: number): void {
    if (level === this.batchLevel) return;
    this.batch = Math.max(1, (this.batch * this.batchNodes) / Math.max(nodes, 1));
    this.batchLevel = level;
    this.batchNodes = nodes;
  }

  private measure(layout: GpuLayout, now: number): void {
    this.measuring = true;
    this.lastMeasure = now;
    const done = layout.done;
    const progress = {
      iteration: layout.iteration,
      total: layout.total,
      level: layout.currentLevel,
      levels: layout.levels,
    };
    void layout.measure().then(({ boxes, energy }) => {
      this.measuring = false;
      if (this.layout !== layout) return;
      this.boxes = boxes;
      if (done) this.reportedDone = true;
      this.events.measured(boxes.slice(), { ...progress, energy, done });
    });
  }
}
