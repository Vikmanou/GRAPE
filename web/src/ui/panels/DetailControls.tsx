import { useApp } from '../../state/store';
import { NumberField } from '../controls/NumberField';

const MAX_PX = 50;
const inPixels = (v: number) => Number.isFinite(v) && v >= 0 && v <= MAX_PX;

export function DetailControls() {
  const options = useApp((s) => s.displayOptions);
  const setOptions = useApp((s) => s.setDisplayOptions);
  return (
    <section className="controls" aria-label="Level of detail">
      <h3>Level of detail</h3>
      <div className="row">
        <label>
          Links fully shown on ribbons from{' '}
          <NumberField
            label="Links fully shown from"
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
          Dots for segments under{' '}
          <NumberField
            label="Dots for segments under"
            testId="sprite-px"
            value={options.spritePx}
            valid={inPixels}
            onValue={(spritePx) => {
              setOptions({ spritePx });
            }}
          />{' '}
          px long
        </label>
      </div>
    </section>
  );
}
