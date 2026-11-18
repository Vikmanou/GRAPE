/**
 * While the layout runs, the graph is redrawn at most this often, and less
 * often when a draw is slow, so drawing takes at most a tenth of the GPU.
 * Moving the view still redraws every frame.
 */
const LAYOUT_REDRAW_MS = 100;
const LAYOUT_DRAW_SHARE = 10;
/** The view counts as moving for this long after the last pan or zoom. */
export const INTERACTION_MS = 250;
/** The store mirrors the camera at most ten times a second (spec, Architecture). */
export const CAMERA_EVENT_MS = 100;

/** Whether a settling layout's picture is due: the layout is idle, or enough time has passed since the last draw. */
export function layoutRedrawDue(busy: boolean, now: number, lastDraw: number, drawMs: number): boolean {
  const redraw = Math.max(LAYOUT_REDRAW_MS, drawMs * LAYOUT_DRAW_SHARE);
  return !busy || now - lastDraw >= redraw;
}
