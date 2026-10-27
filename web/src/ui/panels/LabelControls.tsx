import { useApp } from '../../state/store';
import type { LabelContent } from '../../workers/protocol/graph';
import { NumberField } from '../controls/NumberField';
import { formatCount } from '../format';

const LINES: [keyof LabelContent, string][] = [
  ['name', 'Name'],
  ['length', 'Length'],
  ['depth', 'Depth'],
  ['custom', 'LB tag'],
];

const MAX_LABELS = 20_000;

export function LabelControls() {
  const labels = useApp((s) => s.labels);
  const count = useApp((s) => s.labelCount);
  const setLabels = useApp((s) => s.setLabels);
  return (
    <section className="controls" aria-label="Labels">
      <h3>Labels</h3>
      <div className="row">
        <label>
          <input
            type="checkbox"
            data-testid="labels-show"
            checked={labels.show}
            onChange={(event) => {
              setLabels({ show: event.target.checked });
            }}
          />{' '}
          Show labels
        </label>
        {labels.show && (
          <span className="muted small" data-testid="labels-count">
            {formatCount(count)} shown
          </span>
        )}
      </div>
      <div className="row">
        {LINES.map(([line, title]) => (
          <label key={line}>
            <input
              type="checkbox"
              data-testid={`label-${line}`}
              checked={labels.content[line]}
              onChange={(event) => {
                setLabels({ content: { ...labels.content, [line]: event.target.checked } });
              }}
            />{' '}
            {title}
          </label>
        ))}
      </div>
      <div className="row">
        <label>
          At most{' '}
          <NumberField
            label="At most"
            testId="labels-max"
            value={labels.max}
            valid={(v) => Number.isInteger(v) && v >= 0 && v <= MAX_LABELS}
            onValue={(max) => {
              setLabels({ max });
            }}
          />
        </label>
        <label>
          from ribbons{' '}
          <NumberField
            label="Labels from ribbons this wide"
            testId="labels-min-px"
            value={labels.minRibbonPx}
            valid={(v) => Number.isFinite(v) && v >= 0 && v <= 50}
            onValue={(minRibbonPx) => {
              setLabels({ minRibbonPx });
            }}
          />{' '}
          px
        </label>
      </div>
    </section>
  );
}
