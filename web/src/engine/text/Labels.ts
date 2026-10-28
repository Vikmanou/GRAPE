import type { EngineEvent } from '../commands';
import type { Backend, View } from '../core/backend';
import { RIBBON_WIDTH } from '../style/widths';
import { shownLabelSizes } from '../core/Visibility';
import type { Atlas } from './Atlas';
import { labelMetrics, layoutLabels } from './layoutLabels';

export interface LabelOptions {
  /** At most this many labels show. */
  max: number;
  /** Labels show once ribbons are this many pixels wide. */
  minRibbonPx: number;
  /** In CSS pixels. */
  fontPx: number;
}

export const DEFAULT_LABEL_OPTIONS: LabelOptions = { max: 2000, minRibbonPx: 3, fontPx: 12 };

/** Placement waits for the view to rest this long, but runs at least this often while it moves. */
const REST_MS = 150;
const MOVING_MS = 600;
/** Screen grid cells, in CSS pixels. */
const CELL_PX = 6;
/** Texts kept for labels that may show again. */
const CACHE = 20_000;

/**
 * Decides when labels are placed, keeps the best `max` of the placement,
 * asks for the text it lacks and hands the backend glyphs to draw. While the
 * view moves the last set stays, following the layout.
 */
export class Labels {
  private generation = -1;
  private sizes: Uint32Array<ArrayBuffer> | undefined;
  /** Segments a filter hides get no label. */
  private hidden: Uint32Array | undefined;
  private options = DEFAULT_LABEL_OPTIONS;
  private readonly texts = new Map<number, string>();
  private shown = new Uint32Array(0);
  private timer: ReturnType<typeof setTimeout> | undefined;
  private placing = false;
  private pending = false;
  private lastPlaced = -Infinity;
  private view: View | undefined;

  constructor(
    private readonly backend: Backend,
    private readonly atlas: Atlas | undefined,
    private readonly emit: (event: Extract<EngineEvent, { type: 'labels-needed' | 'labels' }>) => void,
    private readonly redraw: () => void,
  ) {}

  setSizes(generation: number, sizes: Uint32Array<ArrayBuffer> | undefined): void {
    this.generation = generation;
    this.sizes = sizes;
    this.texts.clear();
    this.upload();
  }

  setHidden(hidden: Uint32Array | undefined): void {
    this.hidden = hidden;
    this.upload();
  }

  private upload(): void {
    const { sizes, hidden } = this;
    this.backend.setLabelSizes(sizes && hidden ? shownLabelSizes(sizes, hidden) : sizes);
    this.show(new Uint32Array(0));
    this.changed(performance.now());
  }

  private get sized(): boolean {
    return this.sizes !== undefined;
  }

  setText(generation: number, segments: Uint32Array, texts: string[]): void {
    if (generation !== this.generation) return;
    if (this.texts.size > CACHE) this.texts.clear();
    segments.forEach((segment, i) => this.texts.set(segment, texts[i] ?? ''));
    this.show(this.shown);
  }

  setOptions(options: LabelOptions): void {
    this.options = options;
    this.changed(performance.now());
  }

  /** After each draw: placement follows the view and the positions, not redraws of the labels themselves. */
  drawn(view: View, moved: boolean, now: number): void {
    const last = this.view;
    const same =
      last?.centerX === view.centerX &&
      last.centerY === view.centerY &&
      last.zoom === view.zoom &&
      last.width === view.width &&
      last.height === view.height;
    this.view = view;
    if (moved || !same) this.changed(now);
  }

  private changed(now: number): void {
    if (!this.sized || !this.atlas) return;
    clearTimeout(this.timer);
    if (now - this.lastPlaced >= MOVING_MS) void this.place();
    else this.timer = setTimeout(() => void this.place(), REST_MS);
  }

  /** A new graph: its labels come with its sizes, and anything placed or asked for before is dropped. */
  clear(): void {
    this.setSizes(-1, undefined);
  }

  destroy(): void {
    clearTimeout(this.timer);
    this.sizes = undefined;
  }

  private async place(): Promise<void> {
    const atlas = this.atlas;
    if (!atlas || !this.sized) return;
    if (this.placing) {
      this.pending = true;
      return;
    }
    this.placing = true;
    this.lastPlaced = performance.now();
    const { max, minRibbonPx } = this.options;
    try {
      if (RIBBON_WIDTH * (this.view?.zoom ?? 0) < minRibbonPx * devicePixelRatio) {
        this.show(new Uint32Array(0));
        return;
      }
      const generation = this.generation;
      const placed = await this.backend.placeLabels({
        ...labelMetrics(atlas, this.fontPx),
        cell: Math.max(2, Math.round(CELL_PX * devicePixelRatio)),
      });
      if (generation !== this.generation) return;
      const best = placed.segments.slice(0, max);
      const missing = best.filter((s) => !this.texts.has(s));
      if (missing.length > 0) this.emit({ type: 'labels-needed', generation, segments: missing });
      this.show(best);
    } finally {
      this.placing = false;
      if (this.pending) {
        this.pending = false;
        this.changed(performance.now());
      }
    }
  }

  private get fontPx(): number {
    return this.options.fontPx * devicePixelRatio;
  }

  /** Draws the labels of `segments` that have their text. */
  private show(segments: Uint32Array<ArrayBuffer>): void {
    this.shown = segments;
    const atlas = this.atlas;
    const labels = Array.from(segments, (segment) => ({ segment, text: this.texts.get(segment) })).filter(
      (l): l is { segment: number; text: string } => l.text !== undefined && l.text !== '',
    );
    this.backend.setLabels(atlas ? layoutLabels(labels, atlas, this.fontPx) : new Float32Array(0), this.fontPx);
    this.emit({ type: 'labels', segments: Uint32Array.from(labels, (l) => l.segment) });
    this.redraw();
  }
}
