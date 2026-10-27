import type { EngineEvent } from '../commands';
import type { Backend } from './backend';
import { Selection } from './Selection';

export interface PointerHost {
  emit(event: EngineEvent): void;
  /** Something visible changed; draw a frame. */
  redraw(): void;
  /** Run a frame soon, without counting it as a change. */
  wake(): void;
}

/**
 * What the pointer is over and what is selected. Hover is picked at most once
 * a frame, with one pick in flight; a click picks and selects.
 */
export class Pointer {
  readonly selection = new Selection();
  /** Canvas pixel under the pointer, while it is over the canvas. */
  private position: [number, number] | undefined;
  /** What is under the pointer must be picked again at the next frame. */
  private stale = false;
  private picking = false;
  private hovered: number | undefined;
  private destroyed = false;

  constructor(
    private readonly backend: Backend,
    private readonly canvas: HTMLCanvasElement,
    private readonly host: PointerHost,
  ) {}

  get hover(): number | undefined {
    return this.hovered;
  }

  moved(x: number, y: number): void {
    this.position = [x, y];
    this.stale = true;
    this.host.wake();
  }

  left(): void {
    this.position = undefined;
    this.setHovered(undefined);
  }

  /** The view moved under a still pointer. */
  viewMoved(): void {
    this.stale = this.position !== undefined;
  }

  /** Called once a frame. */
  pickHover(): void {
    const position = this.position;
    if (!this.stale || this.picking || !position) return;
    this.stale = false;
    this.picking = true;
    void this.backend.pick(...position).then((segment) => {
      this.picking = false;
      if (this.destroyed) return;
      if (this.position) this.setHovered(segment);
      if (this.stale) this.host.wake();
    });
  }

  /** A click selects the segment under it; shift adds or removes it; a click on nothing clears. */
  click(x: number, y: number, shift: boolean): void {
    void this.backend.pick(x, y).then((segment) => {
      if (this.destroyed) return;
      const s = this.selection;
      if (segment === undefined) {
        if (shift || s.count === 0) return;
        s.clear();
      } else if (shift) {
        s.toggle(segment);
      } else {
        s.replace([segment]);
      }
      this.selectionChanged();
    });
  }

  /** A new graph: nothing hovered or selected. */
  reset(segments: number): void {
    this.setHovered(undefined);
    this.selection.reset(segments);
    this.selectionChanged();
  }

  selectionChanged(): void {
    const s = this.selection;
    const bits = s.snapshot();
    this.backend.setSelection(bits, s.count);
    this.host.emit({ type: 'selection', count: s.count, single: s.single, bits: bits.slice() });
    this.host.redraw();
  }

  destroy(): void {
    this.destroyed = true;
  }

  private setHovered(segment: number | undefined): void {
    if (segment === this.hovered) return;
    this.hovered = segment;
    this.canvas.style.cursor = segment === undefined ? '' : 'pointer';
    this.backend.setHover(segment);
    this.host.emit({ type: 'hover', segment });
    this.host.redraw();
  }
}
