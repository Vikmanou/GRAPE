import type { Backend } from '../engine/detect';
import type { CoreStatus, LoadState } from '../state/load';
import { formatCount, formatPercent } from './format';

interface Props {
  backend: Backend | 'detecting';
  core: CoreStatus;
  load: LoadState;
  onCancel: () => void;
  onToggleWarnings: () => void;
}

const rendererLabel: Record<Props['backend'], string> = {
  detecting: 'Detecting GPU…',
  webgpu: 'WebGPU',
  webgl2: 'WebGL2 detected; WebGL2 rendering arrives in milestone 8',
  none: 'No GPU backend',
};

function coreLabel(core: CoreStatus): string {
  switch (core.state) {
    case 'loading':
      return 'Loading core…';
    case 'ready':
      return `gfa-core ${core.version} · worker ${Math.round(core.roundTripMs)} ms`;
    case 'error':
      return `Core failed: ${core.message}`;
  }
}

export function StatusBar({ backend, core, load, onCancel, onToggleWarnings }: Props) {
  const warnings = load.state === 'loaded' ? load.result.warnings : undefined;
  return (
    <footer className="status-bar" data-testid="status-bar">
      {load.state === 'parsing' && (
        <span data-testid="status-task">
          Parsing {formatPercent(load.fraction)}{' '}
          <button type="button" className="link" onClick={onCancel}>
            Cancel
          </button>
        </span>
      )}
      {load.state === 'loaded' && (
        <span data-testid="status-segments">{formatCount(load.result.stats.segments)} segments</span>
      )}
      {warnings && warnings.total > 0 && (
        <button type="button" className="link warn" data-testid="status-warnings" onClick={onToggleWarnings}>
          {formatCount(warnings.total)} {warnings.total === 1 ? 'warning' : 'warnings'}
        </button>
      )}
      <span className="spacer" />
      <span data-testid="status-renderer" data-renderer={backend}>
        {rendererLabel[backend]}
      </span>
      <span data-testid="status-core" data-state={core.state}>
        {coreLabel(core)}
      </span>
    </footer>
  );
}
