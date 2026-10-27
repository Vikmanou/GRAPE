import { useApp } from '../../state/store';
import { formatCount } from '../format';

export function Info() {
  const selection = useApp((s) => s.selection);
  const clear = useApp((s) => s.clearSelection);
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
    </aside>
  );
}
