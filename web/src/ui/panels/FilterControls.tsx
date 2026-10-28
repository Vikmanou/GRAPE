import { shownGraph } from '../../state/load';
import { useApp } from '../../state/store';
import { NumberField } from '../controls/NumberField';
import { formatCount } from '../format';

const MAX_STEPS = 50;
const DEFAULT_STEPS = 3;

export function FilterControls() {
  const filters = useApp((s) => s.filters);
  const selected = useApp((s) => s.selection.count);
  const visible = useApp((s) => s.visibleSegments);
  const stats = useApp((s) => shownGraph(s)?.stats);
  const showNeighbourhood = useApp((s) => s.showNeighbourhood);
  const setSteps = useApp((s) => s.setNeighbourhoodSteps);
  const showSelectedComponents = useApp((s) => s.showSelectedComponents);
  const setFilters = useApp((s) => s.setFilters);
  const clearFilters = useApp((s) => s.clearFilters);
  const { neighbourhood, components, minComponentLength, depth } = filters;
  const steps = neighbourhood?.steps ?? DEFAULT_STEPS;
  const depthRange = depth ?? { min: stats?.depthMin ?? 0, max: stats?.depthMax ?? 0 };
  const hasDepth = Number.isFinite(stats?.depthMin);

  return (
    <section className="controls" aria-label="Filters">
      <h3>Filters</h3>
      <div className="row">
        <label title="Show only segments within some steps of the selection">
          <input
            type="checkbox"
            data-testid="filter-neighbourhood"
            checked={neighbourhood !== undefined}
            disabled={neighbourhood === undefined && selected === 0}
            onChange={(event) => {
              if (event.target.checked) showNeighbourhood(steps);
              else setFilters({ neighbourhood: undefined });
            }}
          />{' '}
          Within {steps} {steps === 1 ? 'step' : 'steps'} of the selection
        </label>
      </div>
      {neighbourhood && (
        <div className="row">
          <input
            type="range"
            data-testid="filter-steps"
            aria-label="Steps from the selection"
            min={0}
            max={MAX_STEPS}
            value={steps}
            onChange={(event) => {
              setSteps(Number(event.target.value));
            }}
          />
          <button
            type="button"
            disabled={selected === 0}
            title="Measure the steps from the current selection"
            onClick={() => {
              showNeighbourhood(steps);
            }}
          >
            Recentre
          </button>
        </div>
      )}
      <div className="row">
        <label title="Show only the components the selection touches">
          <input
            type="checkbox"
            data-testid="filter-components"
            checked={components !== undefined}
            disabled={components === undefined && selected === 0}
            onChange={(event) => {
              if (event.target.checked) showSelectedComponents();
              else setFilters({ components: undefined });
            }}
          />{' '}
          Only the selected components
        </label>
      </div>
      <div className="row">
        <label>
          Hide components under{' '}
          <NumberField
            label="Hide components shorter than"
            testId="filter-min-length"
            value={minComponentLength}
            valid={(v) => Number.isFinite(v) && v >= 0}
            onValue={(bases) => {
              setFilters({ minComponentLength: bases });
            }}
          />{' '}
          bp
        </label>
      </div>
      {hasDepth && (
        <div className="row">
          <label title="Segments of unknown depth stay shown">
            <input
              type="checkbox"
              data-testid="filter-depth"
              checked={depth !== undefined}
              onChange={(event) => {
                setFilters({ depth: event.target.checked ? depthRange : undefined });
              }}
            />{' '}
            Depth from
          </label>
          <NumberField
            label="Depth from"
            testId="filter-depth-min"
            value={depthRange.min}
            onValue={(min) => {
              setFilters({ depth: { ...depthRange, min } });
            }}
          />
          <span className="muted small">to</span>
          <NumberField
            label="Depth to"
            testId="filter-depth-max"
            value={depthRange.max}
            onValue={(max) => {
              setFilters({ depth: { ...depthRange, max } });
            }}
          />
          <span className="muted small">×</span>
        </div>
      )}
      <div className="row">
        <span className="muted small" data-testid="filter-visible">
          {visible === undefined ? 'Everything is shown.' : `${formatCount(visible)} segments shown.`}
        </span>
        <button type="button" data-testid="filter-clear" disabled={visible === undefined} onClick={clearFilters}>
          Clear filters
        </button>
      </div>
    </section>
  );
}
