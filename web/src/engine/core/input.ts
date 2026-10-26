/** Pointer and camera gestures, in canvas pixels. */
export interface InputHandler {
  pan(dx: number, dy: number): void;
  /** The pointer moved over the canvas with no button held. */
  hover(x: number, y: number): void;
  leave(): void;
  /** A press and release that moved less than `CLICK_SLOP`. */
  click(x: number, y: number, shift: boolean): void;
  zoom(x: number, y: number, factor: number): void;
  zoomCenter(factor: number): void;
  panView(fx: number, fy: number): void;
  fit(): void;
}

const KEY_ZOOM = 1.25;
/** Fraction of the view an arrow key pans. */
const KEY_PAN = 0.1;
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

function typing(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

/** Returns a function that removes the listeners. */
export function attachInput(canvas: HTMLCanvasElement, handler: InputHandler): () => void {
  const scale = () => canvas.width / Math.max(1, canvas.getBoundingClientRect().width);
  const local = (event: MouseEvent): [number, number] => {
    const rect = canvas.getBoundingClientRect();
    const s = scale();
    return [(event.clientX - rect.left) * s, (event.clientY - rect.top) * s];
  };
  let press: { id: number; x: number; y: number; startX: number; startY: number; dragging: boolean } | undefined;

  const down = (event: PointerEvent) => {
    if (event.button !== 0) return;
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // Pointers that are no longer active (or synthetic ones) cannot be
      // captured; the drag still works while the pointer stays on the canvas.
    }
    const { clientX: x, clientY: y } = event;
    press = { id: event.pointerId, x, y, startX: x, startY: y, dragging: false };
  };
  const move = (event: PointerEvent) => {
    if (!press) {
      handler.hover(...local(event));
      return;
    }
    if (press.id !== event.pointerId) return;
    press.dragging ||= Math.hypot(event.clientX - press.startX, event.clientY - press.startY) > CLICK_SLOP;
    if (!press.dragging) return;
    const s = scale();
    handler.pan((event.clientX - press.x) * s, (event.clientY - press.y) * s);
    press.x = event.clientX;
    press.y = event.clientY;
  };
  const up = (event: PointerEvent) => {
    if (press?.id !== event.pointerId) return;
    if (!press.dragging && event.type === 'pointerup') handler.click(...local(event), event.shiftKey);
    press = undefined;
  };
  const leave = () => {
    if (!press) handler.leave();
  };
  const wheel = (event: WheelEvent) => {
    event.preventDefault();
    const [x, y] = local(event);
    handler.zoom(x, y, wheelFactor(event));
  };
  const key = (event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey || typing(event.target)) return;
    const actions: Record<string, () => void> = {
      ArrowLeft: () => {
        handler.panView(KEY_PAN, 0);
      },
      ArrowRight: () => {
        handler.panView(-KEY_PAN, 0);
      },
      ArrowUp: () => {
        handler.panView(0, KEY_PAN);
      },
      ArrowDown: () => {
        handler.panView(0, -KEY_PAN);
      },
      '+': () => {
        handler.zoomCenter(KEY_ZOOM);
      },
      '=': () => {
        handler.zoomCenter(KEY_ZOOM);
      },
      '-': () => {
        handler.zoomCenter(1 / KEY_ZOOM);
      },
      f: () => {
        handler.fit();
      },
    };
    const action = actions[event.key.length === 1 ? event.key.toLowerCase() : event.key];
    if (!action) return;
    event.preventDefault();
    action();
  };

  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('pointerleave', leave);
  canvas.addEventListener('wheel', wheel, { passive: false });
  window.addEventListener('keydown', key);
  return () => {
    canvas.removeEventListener('pointerdown', down);
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', up);
    canvas.removeEventListener('pointercancel', up);
    canvas.removeEventListener('pointerleave', leave);
    canvas.removeEventListener('wheel', wheel);
    window.removeEventListener('keydown', key);
  };
}
