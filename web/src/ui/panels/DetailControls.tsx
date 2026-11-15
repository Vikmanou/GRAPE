import { useApp } from '../../state/store';
import { Disclosure } from '../controls/Disclosure';
import { NumberField } from '../controls/NumberField';

const MAX_PX = 50;
const MAX_LABELS = 20_000;
const inPixels = (v: number) => Number.isFinite(v) && v >= 0 && v <= MAX_PX;

export function DetailControls() {
  const options = useApp((s) => s.displayOptions);
  const setOptions = useApp((s) => s.setDisplayOptions);
  const labels = useApp((s) => s.labels);
  const setLabels = useApp((s) => s.setLabels);
  return (
    <>
      <section className="controls" aria-label="Strands">
        <h3>Strands</h3>
        <div className="row">
          <label title="Draw each segment's forward and reverse strand side by side, as Bandage's double mode does">
            <input
              type="checkbox"
              data-testid="double-mode"
              checked={options.double}
              onChange={(event) => {
                setOptions({ double: event.target.checked });
              }}
            />{' '}
            Double mode (both strands)
          </label>
        </div>
      </section>
      <Disclosure title="Detail" testId="detail">
        <div className="row">
          <label>
            Show up to{' '}
            <NumberField
              label="Most labels shown"
              testId="labels-max"
              value={labels.max}
              valid={(v) => Number.isInteger(v) && v >= 0 && v <= MAX_LABELS}
              onValue={(max) => {
                setLabels({ max });
              }}
            />{' '}
            labels
          </label>
        </div>
        <div className="row">
          <label>
            Label every segment once ribbons are{' '}
            <NumberField
              label="Label every segment from this ribbon width"
              testId="labels-min-px"
              value={labels.minRibbonPx}
              valid={(v) => Number.isFinite(v) && v >= 0 && v <= MAX_PX}
              onValue={(minRibbonPx) => {
                setLabels({ minRibbonPx });
              }}
            />{' '}
            px wide
          </label>
        </div>
        <div className="row">
          <label>
            Show every link once ribbons are{' '}
            <NumberField
              label="Show every link from this ribbon width"
              testId="link-full-px"
              value={options.linkFullPx}
              valid={(v) => inPixels(v) && v > 1}
              onValue={(linkFullPx) => {
                setOptions({ linkFullPx });
              }}
            />{' '}
            px wide
          </label>
        </div>
        <div className="row">
          <label>
            Draw segments shorter than{' '}
            <NumberField
              label="Draw segments shorter than this as dots"
              testId="sprite-px"
              value={options.spritePx}
              valid={inPixels}
              onValue={(spritePx) => {
                setOptions({ spritePx });
              }}
            />{' '}
            px as dots
          </label>
        </div>
      </Disclosure>
    </>
  );
}
