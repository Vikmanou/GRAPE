import type { Context } from './store';

export interface SelectionState {
  count: number;
  /** The selected segment when exactly one is. */
  single: number | undefined;
  /** One bit per segment. */
  bits: Uint32Array<ArrayBuffer>;
}

export interface SelectionSlice {
  /** The segment under the pointer. */
  hovered: number | undefined;
  selection: SelectionState;
  select: (segments: Uint32Array, mode: 'replace' | 'add') => void;
  clearSelection: () => void;
  invertSelection: () => void;
}

export function createSelectionSlice(ctx: Context): SelectionSlice {
  return {
    hovered: undefined,
    selection: { count: 0, single: undefined, bits: new Uint32Array(0) },
    select(segments, mode) {
      ctx.bridge.send({ type: 'select', segments, mode });
    },
    clearSelection() {
      ctx.bridge.send({ type: 'clear-selection' });
    },
    invertSelection() {
      ctx.bridge.send({ type: 'invert-selection' });
    },
  };
}
