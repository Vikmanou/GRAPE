import type { ColorMode } from '../../engine/style/colors';
import { packRgba, palettes } from '../../engine/style/palette';
import { cssColor, pathColor } from '../../engine/style/colors';
import { useApp } from '../../state/store';
import { Legend } from '../controls/Legend';

const MODES: [ColorMode, string][] = [
  ['random', 'Random'],
  ['uniform', 'Uniform'],
  ['depth', 'Depth'],
  ['gc', 'GC content'],
  ['length', 'Length'],
  ['component', 'Component'],
  ['tags', 'Tag colours (CL, C2)'],
  ['path', 'Path membership'],
];

export function ColorControls() {
  const options = useApp((s) => s.displayOptions);
  const theme = useApp((s) => s.theme);
  const setOptions = useApp((s) => s.setDisplayOptions);
  const setMode = useApp((s) => s.setColorMode);
  const resetRange = useApp((s) => s.resetColorRange);
  const paths = useApp((s) => s.paths);
  const highlighted = useApp((s) => s.highlightedPaths);
  const names = paths.state === 'ready' ? paths.list.names : [];
  const pathSwatches = highlighted.map((p) => ({ label: names[p] ?? '', color: cssColor(pathColor(p)) }));
  return (
    <section className="controls" aria-label="Colour">
      <h3>Colour</h3>
      <label>
        Colour by{' '}
        <select
          data-testid="color-mode"
          value={options.color}
          onChange={(event) => {
            const mode = MODES.find(([m]) => m === event.target.value)?.[0];
            if (mode) setMode(mode);
          }}
        >
          {MODES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <Legend
        mode={options.color}
        range={options.range}
        unknown={cssColor(packRgba(palettes[theme].unknown))}
        paths={pathSwatches}
        onRange={(range) => {
          setOptions({ range });
        }}
        onAuto={resetRange}
      />
      <div className="row">
        <label>
          <input
            type="checkbox"
            data-testid="width-by-depth"
            checked={options.widthByDepth}
            onChange={(event) => {
              setOptions({ widthByDepth: event.target.checked });
            }}
          />{' '}
          Width by depth
        </label>
        <label>
          <input
            type="checkbox"
            data-testid="dim-unselected"
            checked={options.dimUnselected}
            onChange={(event) => {
              setOptions({ dimUnselected: event.target.checked });
            }}
          />{' '}
          Dim unselected
        </label>
      </div>
    </section>
  );
}
