import { useApp } from '../../state/store';

const BUTTON_ZOOM = 1.5;

/** Zoom and fit for people without a keyboard, kept clear of the panels. */
export function CanvasControls() {
  const insets = useApp((s) => s.insets);
  const zoomView = useApp((s) => s.zoomView);
  const fit = useApp((s) => s.fit);
  return (
    <div
      className="canvas-controls"
      role="group"
      aria-label="View"
      style={{ left: insets.left + 12, bottom: insets.bottom + 12 }}
      data-testid="canvas-controls"
    >
      <button
        type="button"
        aria-label="Zoom in"
        title="Zoom in (+)"
        data-testid="zoom-in"
        onClick={() => {
          zoomView(BUTTON_ZOOM);
        }}
      >
        +
      </button>
      <button
        type="button"
        aria-label="Zoom out"
        title="Zoom out (−)"
        data-testid="zoom-out"
        onClick={() => {
          zoomView(1 / BUTTON_ZOOM);
        }}
      >
        −
      </button>
      <button type="button" title="Fit the graph (F)" data-testid="fit" onClick={fit}>
        Fit
      </button>
    </div>
  );
}
