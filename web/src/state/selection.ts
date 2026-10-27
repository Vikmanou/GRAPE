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
  /** Adds every segment of the components the selection touches. */
  selectComponents: () => void;
  /** Selects one component, by rank, and frames it. */
  showComponent: (component: number) => void;
  zoomToSelection: () => void;
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
    selectComponents() {
      ctx.bridge.send({ type: 'select-components' });
    },
    showComponent(component) {
      ctx.bridge.send({ type: 'select-component', component });
      ctx.bridge.send({ type: 'zoom-to-component', component });
    },
    zoomToSelection() {
      ctx.bridge.send({ type: 'zoom-to-selection' });
    },
  };
}
