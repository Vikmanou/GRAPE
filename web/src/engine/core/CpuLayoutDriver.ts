import type { CpuProgress, LayoutControl } from '../../workers/protocol/layout';
import type { WithoutId } from '../../workers/rpc';
import { type LayoutDriver, type LevelRecord, USABLE_LEVEL } from './backend';
import type { Bounds } from './camera';

/**
 * The layout driver for a layout that runs in the layout worker, as the CPU
 * layout does. Positions reach the engine as `set-positions` commands; this
 * driver keeps where the layout stands and turns pause, drag, unpin and
 * re-layout into requests the store forwards to the worker, since only the
 * store talks to workers.
 */
export class CpuLayoutDriver implements LayoutDriver {
  readonly active = false;
  readonly busy = false;
  readonly levels: LevelRecord[] = [];
  private progress: CpuProgress | undefined;

  constructor(
    private readonly control: (request: WithoutId<LayoutControl>) => void,
    /** One bit per selected segment. */
    private readonly selection: () => Uint32Array | undefined,
    /** A refinement after a drag or of the selection started or ended. */
    private readonly refining: (active: boolean) => void,
  ) {}

  /** A new graph: nothing is known about its layout yet. */
  reset(): void {
    this.progress = undefined;
  }

  setProgress(progress: CpuProgress): void {
    const was = this.progress?.refining ?? false;
    this.progress = progress;
    if (progress.refining !== was) this.refining(progress.refining);
  }

  get usable(): boolean {
    const p = this.progress;
    return !p || p.done || p.level <= USABLE_LEVEL;
  }

  get atLevelZero(): boolean {
    return this.progress?.level === 0;
  }

  get pinned(): number {
    return this.progress?.pinned ?? 0;
  }

  drag(segment: number, dx: number, dy: number): void {
    this.control({ type: 'drag', segment, dx, dy });
  }

  start(): void {
    this.progress = undefined;
  }

  stop(): void {
    // The worker owns the run; the store stops it.
  }

  setPaused(paused: boolean): void {
    this.control({ type: 'pause', paused });
  }

  setOffsets(): void {
    // The worker packs components itself.
  }

  bounds(): Bounds | undefined {
    return undefined;
  }

  tick(): boolean {
    return false;
  }

  present(): void {
    // Positions are uploaded by the engine as they arrive.
  }

  readPositions(): Promise<undefined> {
    return Promise.resolve(undefined);
  }

  unpinAll(): void {
    this.control({ type: 'unpin' });
  }

  refine(onlySelected: boolean): void {
    this.control({ type: 'refine', selected: onlySelected ? this.selection()?.slice() : undefined });
  }
}
