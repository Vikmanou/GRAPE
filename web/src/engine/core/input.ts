/** Pointer and wheel gestures, in canvas pixels. Keys are the store's shortcuts. */
export interface InputHandler {
  pan(dx: number, dy: number): void;
  /** The pointer moved over the canvas with no button held. */
  hover(x: number, y: number): void;
  leave(): void;
  /** A press and release that moved less than `CLICK_SLOP`. */
  click(x: number, y: number, shift: boolean): void;
  /** A press at `x, y` that may grab a segment to drag; false lets the drag pan. */
  grab(x: number, y: number): boolean;
  /** A grabbed segment moved by `dx, dy` canvas pixels. */
  dragSegment(dx: number, dy: number): void;
  release(): void;
  /** A shift-drag from `x0, y0` now at `x1, y1`. */
  box(x0: number, y0: number, x1: number, y1: number, phase: 'drag' | 'end' | 'cancel'): void;
  zoom(x: number, y: number, factor: number): void;
}

const LINE_PIXELS = 16;
/** CSS pixels a press may move and still count as a click. */
const CLICK_SLOP = 4;

/** Wheel steps differ by device; this maps a typical mouse notch to about 1.2×. */
function wheelFactor(event: WheelEvent): number {
  const pixels = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * LINE_PIXELS : event.deltaY;
  // Chrome reports trackpad pinch as wheel events with ctrlKey set.
  const rate = event.ctrlKey ? 0.01 : 0.0015;
  return Math.exp(-pixels * rate);
}

/** Returns a function that removes the listeners. */
export function attachInput(canvas: HTMLCanvasElement, handler: InputHandler): () => void {
  const scale = () => canvas.width / Math.max(1, canvas.getBoundingClientRect().width);
  const local = (event: MouseEvent): [number, number] => {
    const rect = canvas.getBoundingClientRect();
    const s = scale();
    return [(event.clientX - rect.left) * s, (event.clientY - rect.top) * s];
  };
  let press:
    | {
        id: number;
        x: number;
        y: number;
        startX: number;
        startY: number;
        dragging: boolean;
        boxing: boolean;
        grabbing: boolean;
      }
    | undefined;

  const down = (event: PointerEvent) => {
    if (event.button !== 0) return;
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // Pointers that are no longer active (or synthetic ones) cannot be
      // captured; the drag still works while the pointer stays on the canvas.
    }
    const { clientX: x, clientY: y } = event;
    const boxing = event.shiftKey;
    const grabbing = !boxing && handler.grab(...local(event));
    press = { id: event.pointerId, x, y, startX: x, startY: y, dragging: false, boxing, grabbing };
  };
  const move = (event: PointerEvent) => {
    if (!press) {
      handler.hover(...local(event));
      return;
    }
    if (press.id !== event.pointerId) return;
    press.dragging ||= Math.hypot(event.clientX - press.startX, event.clientY - press.startY) > CLICK_SLOP;
    if (!press.dragging) return;
    if (press.boxing) {
      handler.box(...boxCorners(press, event), 'drag');
      return;
    }
    const s = scale();
    const [dx, dy] = [(event.clientX - press.x) * s, (event.clientY - press.y) * s];
    if (press.grabbing) handler.dragSegment(dx, dy);
    else handler.pan(dx, dy);
    press.x = event.clientX;
    press.y = event.clientY;
  };
  const up = (event: PointerEvent) => {
    if (press?.id !== event.pointerId) return;
    if (press.boxing && press.dragging) {
      handler.box(...boxCorners(press, event), event.type === 'pointerup' ? 'end' : 'cancel');
    } else if (!press.dragging && event.type === 'pointerup') handler.click(...local(event), event.shiftKey);
    press = undefined;
  };
  const boxCorners = (from: { startX: number; startY: number }, to: MouseEvent): [number, number, number, number] => {
    const rect = canvas.getBoundingClientRect();
    const s = scale();
    return [(from.startX - rect.left) * s, (from.startY - rect.top) * s, ...local(to)];
  };
  const leave = () => {
    if (!press) handler.leave();
  };
  const wheel = (event: WheelEvent) => {
    event.preventDefault();
    const [x, y] = local(event);
    handler.zoom(x, y, wheelFactor(event));
  };
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('pointerleave', leave);
  canvas.addEventListener('wheel', wheel, { passive: false });
  return () => {
    canvas.removeEventListener('pointerdown', down);
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', up);
    canvas.removeEventListener('pointercancel', up);
    canvas.removeEventListener('pointerleave', leave);
    canvas.removeEventListener('wheel', wheel);
  };
}
