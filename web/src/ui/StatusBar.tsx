import type { Backend } from '../engine/detect';
import type { LayoutStatus } from '../state/layout';
import type { CoreStatus, LoadState } from '../state/load';
import { formatCount, formatPercent, formatSeconds } from './format';

interface Props {
  backend: Backend | 'detecting';
  core: CoreStatus;
  load: LoadState;
  layout: LayoutStatus;
  paused: boolean;
  fps: number | undefined;
  onCancel: () => void;
  onToggleWarnings: () => void;
}

const rendererLabel: Record<Props['backend'], string> = {
  detecting: 'Detecting GPU…',
  webgpu: 'WebGPU',
  webgl2: 'WebGL2 detected; WebGL2 rendering arrives in milestone 8',
  none: 'No GPU backend',
};

function layoutLabel(layout: LayoutStatus, paused: boolean): string | undefined {
  switch (layout.state) {
    case 'idle':
      return undefined;
    case 'running': {
      const done = formatPercent(layout.total > 0 ? layout.iteration / layout.total : 0);
      const parts = [paused ? `Layout paused at ${done}` : `Layout ${done}`];
      // Levels count up as the layout refines towards level 0.
      if (layout.level !== undefined && layout.levels !== undefined) {
        parts.push(`level ${layout.levels - layout.level} of ${layout.levels}`);
      }
      if (layout.energy !== undefined) parts.push(`energy ${layout.energy.toFixed(2)}`);
      return parts.join(' · ');
    }
    case 'done':
      return `Laid out in ${formatSeconds(layout.ms)}`;
    case 'failed':
      return `Layout failed: ${layout.message}`;
  }
}

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

export function StatusBar({ backend, core, load, layout, paused, fps, onCancel, onToggleWarnings }: Props) {
  const warnings = load.state === 'loaded' ? load.result.warnings : undefined;
  const layoutText = layoutLabel(layout, paused);
  return (
    <footer className="status-bar" data-testid="status-bar" data-inset="bottom">
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
      {layoutText && (
        <span
          data-testid="status-layout"
          data-state={paused && layout.state === 'running' ? 'paused' : layout.state}
          data-ms={layout.state === 'done' ? Math.round(layout.ms) : undefined}
          data-usable-ms={
            layout.state === 'done' && layout.usableMs !== undefined ? Math.round(layout.usableMs) : undefined
          }
        >
          {layoutText}
        </span>
      )}
      {warnings && warnings.total > 0 && (
        <button type="button" className="link warn" data-testid="status-warnings" onClick={onToggleWarnings}>
          {formatCount(warnings.total)} {warnings.total === 1 ? 'warning' : 'warnings'}
        </button>
      )}
      <span className="spacer" />
      {fps !== undefined && <span data-testid="status-fps">{Math.round(fps)} fps</span>}
      <span data-testid="status-renderer" data-renderer={backend}>
        {rendererLabel[backend]}
      </span>
      <span data-testid="status-core" data-state={core.state}>
        {coreLabel(core)}
      </span>
    </footer>
  );
}
