import { useApp } from '../../state/store';
import { formatCount } from '../format';
import { ColorControls } from './ColorControls';
import { DetailControls } from './DetailControls';
import { LabelControls } from './LabelControls';
import { LayoutControls } from './LayoutControls';

export function Display() {
  const pinned = useApp((s) => s.pinned);
  const selected = useApp((s) => s.selection.count);
  const settled = useApp(
    (s) => s.layoutStatus.state === 'done' || (s.layoutStatus.state === 'running' && s.layoutStatus.level === 0),
  );
  const unpinAll = useApp((s) => s.unpinAll);
  const relayout = useApp((s) => s.relayoutSelection);
  return (
    <>
      <ColorControls />
      <LabelControls />
      <DetailControls />
      <LayoutControls />
      <section className="controls" aria-label="Pins">
        <h3>Pins</h3>
        <p className="muted small">Drag a segment to pin it; the rest of the graph follows.</p>
        <div className="row">
          <button type="button" data-testid="unpin-all" disabled={pinned === 0} onClick={unpinAll}>
            Unpin all{pinned > 0 ? ` (${formatCount(pinned)})` : ''}
          </button>
          <button
            type="button"
            data-testid="relayout-selection"
            disabled={selected === 0 || !settled}
            title="Lay out the selected segments again, holding the rest of the graph still"
            onClick={relayout}
          >
            Re-layout selection
          </button>
        </div>
      </section>
    </>
  );
}
