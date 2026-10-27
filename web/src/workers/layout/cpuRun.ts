import type { Grid, Layout } from '../../wasm/pkg/gfa_wasm';
import { RIBBON_WIDTH } from '../../engine/style/widths';
import type { CellLists, LayoutResponse, PositionGrid } from '../protocol/layout';
import { plain } from '../plain';

/** How often positions are posted while the layout settles, and while a refinement follows a drag. */
const POST_INTERVAL_MS = 100;
const REFINING_POST_INTERVAL_MS = 33;
/** Steps run in slices of about this long, so control requests are answered in between. */
const SLICE_MS = 20;

type Post = (message: LayoutResponse, transfer: Transferable[]) => void;

function cells(starts: Uint32Array, items: Uint32Array, wide: Uint32Array): CellLists {
  return { starts: plain(starts), items: plain(items), wide: plain(wide) };
}

function takeGrid(g: Grid): PositionGrid {
  try {
    const [minX = 0, minY = 0, cell = 1, columns = 1, rows = 1] = g.frame();
    return {
      minX,
      minY,
      cell,
      columns,
      rows,
      pieces: cells(g.pieceStarts(), g.pieceItems(), g.pieceWide()),
      links: cells(g.linkStarts(), g.linkItems(), g.linkWide()),
    };
  } finally {
    g.free();
  }
}

function gridBuffers(grid: PositionGrid): ArrayBuffer[] {
  return [grid.pieces, grid.links].flatMap((l) => [l.starts.buffer, l.items.buffer, l.wide.buffer]);
}

/**
 * Runs a CPU layout in slices, yielding between them so pause, drag and
 * refine requests get through, and posts positions with a grid over them.
 */
export class CpuRun {
  private paused = false;
  private wake: (() => void) | undefined;
  private lastPost = -Infinity;
  private postedDone = false;
  /** Positions changed outside a step and should be posted at once. */
  private changed = true;
  private batch = 1;
  private readonly channel = new MessageChannel();
  private resume: (() => void) | undefined;

  constructor(
    private readonly id: number,
    private readonly layout: Layout,
    private readonly post: Post,
  ) {
    this.channel.port1.onmessage = () => {
      this.resume?.();
    };
  }

  /** Runs until the worker ends. */
  async run(): Promise<never> {
    for (;;) {
      if (!this.paused && !this.finished) this.slice();
      const finished = this.finished;
      const now = performance.now();
      const interval = this.layout.refining() ? REFINING_POST_INTERVAL_MS : POST_INTERVAL_MS;
      if (this.changed || (finished ? !this.postedDone : !this.paused && now - this.lastPost >= interval)) {
        this.postPositions(now);
      }
      if (this.paused || finished) await new Promise<void>((resolve) => (this.wake = resolve));
      else await this.yieldToRequests();
    }
  }

  /** Settled, with no refinement running; `step(0)` only reports it. */
  private get finished(): boolean {
    return this.layout.step(0);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.poke();
  }

  drag(segment: number, dx: number, dy: number): void {
    if (this.layout.drag(segment, dx, dy)) this.poke();
  }

  unpinAll(): void {
    this.layout.unpinAll();
    this.poke();
  }

  refine(selected: Uint32Array | undefined): void {
    if (this.layout.refine(selected)) this.poke();
  }

  private poke(): void {
    this.changed = true;
    this.wake?.();
    this.wake = undefined;
  }

  /** Steps for about `SLICE_MS`, growing or shrinking the batch to fit. */
  private slice(): void {
    const started = performance.now();
    let done = false;
    while (!done && performance.now() - started < SLICE_MS) {
      const t = performance.now();
      done = this.layout.step(Math.round(this.batch));
      const ms = performance.now() - t;
      this.batch = Math.min(
        1024,
        Math.max(1, this.batch * Math.min(2, Math.max(0.5, SLICE_MS / 4 / Math.max(ms, 0.1)))),
      );
    }
  }

  private postPositions(now: number): void {
    const layout = this.layout;
    this.lastPost = now;
    this.changed = false;
    const positions = plain(layout.positions());
    const grid = takeGrid(layout.grid(RIBBON_WIDTH / 2));
    const done = this.finished;
    this.postedDone = done;
    const progress = {
      iteration: layout.iteration(),
      level: layout.level(),
      levels: layout.levels(),
      pinned: layout.pinned(),
      refining: layout.refining(),
      done,
    };
    this.post({ type: 'positions', id: this.id, positions, grid, progress }, [positions.buffer, ...gridBuffers(grid)]);
  }

  /** A message to ourselves queues behind any requests already waiting. */
  private yieldToRequests(): Promise<void> {
    return new Promise((resolve) => {
      this.resume = resolve;
      this.channel.port2.postMessage(null);
    });
  }
}
