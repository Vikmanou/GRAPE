import type { Labels } from '../text/Labels';
import type { Backend } from './backend';
import { type Filter, type FilterData, filtering, type Hidden, hiddenBy, NO_FILTER, withoutHidden } from './Visibility';

/** Keeps the backend and the labels hiding what the current filter hides, for each graph. */
export class Filtering {
  private filter: Filter = NO_FILTER;
  private data: FilterData | undefined;
  private hiddenNow: Hidden | undefined;

  constructor(
    private readonly backend: Backend,
    private readonly labels: Labels,
    private readonly report: (visible: number, total: number) => void,
  ) {}

  get active(): boolean {
    return filtering(this.filter);
  }

  setGraph(data: FilterData): void {
    this.data = data;
    this.apply();
  }

  setFilter(filter: Filter): void {
    this.filter = filter;
    this.apply();
  }

  /** What the filter hides, while one is on. */
  get hidden(): Hidden | undefined {
    return this.active ? this.hiddenNow : undefined;
  }

  /** `bits` without what the filter hides. */
  shown(bits: Uint32Array<ArrayBuffer>): Uint32Array<ArrayBuffer> {
    return this.hiddenNow && this.active ? withoutHidden(bits, this.hiddenNow.segments) : bits;
  }

  /** One bit per segment the filter shows. */
  visibleBits(): Uint32Array<ArrayBuffer> {
    const n = this.data?.components.length ?? 0;
    const all = new Uint32Array(Math.ceil(n / 32)).fill(0xffffffff);
    if (n % 32 !== 0) all[all.length - 1] = (1 << n % 32) - 1;
    return this.shown(all);
  }

  private apply(): void {
    const data = this.data;
    if (!data) return;
    const hidden = hiddenBy(this.filter, data);
    this.hiddenNow = hidden;
    this.backend.setVisibility(hidden);
    this.labels.setHidden(this.active ? hidden.segments : undefined);
    this.report(hidden.visible, data.components.length);
  }
}
