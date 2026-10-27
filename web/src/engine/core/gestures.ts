import type { EngineEvent } from '../commands';
import type { LayoutDriver } from './backend';
import type { Bounds } from './camera';
import type { Framing } from './Framing';
import type { InputHandler } from './input';
import type { Pointer } from './Pointer';
import type { RubberBand } from './RubberBand';

export interface GestureTargets {
  framing: Framing;
  pointer: Pointer;
  band: RubberBand;
  layout: () => LayoutDriver;
  selectBox: (box: Bounds) => Promise<Uint32Array>;
  viewMoved: () => void;
  emit: (event: EngineEvent) => void;
}

/** What each pointer and wheel gesture does to the view, the selection and the layout. */
export function gestures(t: GestureTargets): InputHandler {
  const { framing, pointer, band } = t;
  const coarse = () => !t.layout().usable;
  /** The segment being dragged, which pins it. */
  let grabbed: number | undefined;
  return {
    pan: (dx, dy) => {
      framing.pan(dx, dy);
      t.viewMoved();
    },
    zoom: (x, y, factor) => {
      framing.zoomAt(x, y, factor, coarse());
      t.viewMoved();
    },
    hover: (x, y) => {
      pointer.moved(x, y);
    },
    leave: () => {
      pointer.left();
    },
    // Before the layout reaches level 0 there is nothing to pin, so the drag pans.
    grab: () => {
      const segment = pointer.hover;
      if (segment === undefined || !t.layout().atLevelZero) return false;
      grabbed = segment;
      return true;
    },
    dragSegment: (dx, dy) => {
      if (grabbed === undefined) return;
      const layout = t.layout();
      const before = layout.pinned;
      layout.drag(grabbed, dx / framing.camera.zoom, dy / framing.camera.zoom);
      if (layout.pinned !== before) t.emit({ type: 'pins', count: layout.pinned });
      t.viewMoved();
    },
    release: () => {
      grabbed = undefined;
    },
    click: (x, y, shift) => {
      // Panels that open for the selection must not refit the view under the pointer.
      framing.autoFit = false;
      pointer.click(x, y, shift);
    },
    box: (x0, y0, x1, y1, phase) => {
      if (phase === 'drag') {
        band.show(x0, y0, x1, y1);
        return;
      }
      band.hide();
      if (phase === 'cancel') return;
      framing.autoFit = false;
      const box = { minX: Math.min(x0, x1), minY: Math.min(y0, y1), maxX: Math.max(x0, x1), maxY: Math.max(y0, y1) };
      void t.selectBox(box).then((bits) => {
        pointer.addBits(bits);
      });
    },
  };
}
