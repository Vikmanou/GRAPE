import { useApp } from '../../state/store';
import { formatCount } from '../format';

export function Info() {
  const selection = useApp((s) => s.selection);
  const clear = useApp((s) => s.clearSelection);
  const invert = useApp((s) => s.invertSelection);
  const selectComponents = useApp((s) => s.selectComponents);
  const zoom = useApp((s) => s.zoomToSelection);
  if (selection.count === 0) return null;
  return (
    <aside className="info-panel floating-panel" aria-label="Selection" data-inset="right" data-testid="info-panel">
      <header>
        <h2 data-testid="info-title">
          {selection.count === 1 ? 'Segment' : `${formatCount(selection.count)} segments`}
        </h2>
        <button type="button" className="icon" aria-label="Clear the selection" onClick={clear}>
          ×
        </button>
      </header>
      <div className="row actions">
        <button type="button" data-testid="zoom-selection" onClick={zoom}>
          Zoom to
        </button>
        <button type="button" data-testid="select-components" onClick={selectComponents}>
          Whole component
        </button>
        <button type="button" data-testid="invert-selection" onClick={invert}>
          Invert
        </button>
      </div>
    </aside>
  );
}
