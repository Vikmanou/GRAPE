import { cssColor, type ColorMode, NO_TAG_COLOR, UNIFORM_COLOR } from '../../engine/style/colors';
import { ramp, RAMP_SIZE } from '../../engine/style/ramps';
import type { ColorRange } from '../../engine/style/scales';
import { NumberField } from './NumberField';

const STOPS = 16;
const gradient = `linear-gradient(to right, ${Array.from({ length: STOPS }, (_, i) =>
  cssColor(ramp[Math.round((i / (STOPS - 1)) * (RAMP_SIZE - 1))] ?? 0),
).join(', ')})`;

/** GC is stored as a fraction and shown as a percentage. */
const SHOWN: Partial<Record<ColorMode, { unit: string; factor: number }>> = {
  depth: { unit: '×', factor: 1 },
  gc: { unit: '%', factor: 100 },
  length: { unit: 'bp', factor: 1 },
};

interface Props {
  mode: ColorMode;
  range: ColorRange;
  /** CSS colour of segments whose value is unknown. */
  unknown: string;
  onRange: (range: ColorRange) => void;
  onAuto: () => void;
  /** The highlighted paths, for the path mode. */
  paths: { label: string; color: string }[];
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="swatch-row">
      <span className="swatch" style={{ background: color }} />
      {label}
    </span>
  );
}

export function Legend({ mode, range, unknown, onRange, onAuto, paths }: Props) {
  const shown = SHOWN[mode];
  if (!shown) {
    return (
      <div className="legend" data-testid="legend" data-mode={mode}>
        {mode === 'uniform' && <Swatch color={cssColor(UNIFORM_COLOR)} label="Every segment" />}
        {mode === 'random' && <span className="muted small">A random colour per segment, from the layout seed.</span>}
        {mode === 'component' && <span className="muted small">A colour per connected component.</span>}
        {mode === 'tags' && (
          <>
            <span className="muted small">Colours from the CL and C2 tags.</span>
            <Swatch color={cssColor(NO_TAG_COLOR)} label="No tag" />
          </>
        )}
        {mode === 'path' && (
          <>
            {paths.length === 0 && <span className="muted small">Highlight paths in the Paths tab.</span>}
            {paths.map(({ label, color }) => (
              <Swatch key={label} color={color} label={label} />
            ))}
            <Swatch color={cssColor(NO_TAG_COLOR)} label="On no highlighted path" />
          </>
        )}
      </div>
    );
  }
  const { unit, factor } = shown;
  const positive = (v: number) => Number.isFinite(v) && (range.scale === 'linear' || v > 0);
  return (
    <div className="legend" data-testid="legend" data-mode={mode}>
      <div className="ramp" style={{ background: gradient }} data-testid="legend-ramp" />
      <div className="row range">
        <NumberField
          label="Range from"
          testId="range-min"
          value={range.min * factor}
          valid={positive}
          onValue={(v) => {
            onRange({ ...range, min: v / factor });
          }}
        />
        <span className="muted small">{unit}</span>
        <span className="muted small">to</span>
        <NumberField
          label="Range to"
          testId="range-max"
          value={range.max * factor}
          valid={positive}
          onValue={(v) => {
            onRange({ ...range, max: v / factor });
          }}
        />
        <span className="muted small">{unit}</span>
      </div>
      <div className="row">
        <label>
          <input
            type="checkbox"
            data-testid="range-log"
            checked={range.scale === 'log'}
            onChange={(event) => {
              const scale = event.target.checked ? 'log' : 'linear';
              onRange({ ...range, scale, min: scale === 'log' ? Math.max(range.min, 1e-6) : range.min });
            }}
          />{' '}
          Log scale
        </label>
        <button type="button" data-testid="range-auto" onClick={onAuto}>
          Auto range
        </button>
      </div>
      {mode !== 'length' && <Swatch color={unknown} label="Unknown" />}
    </div>
  );
}
