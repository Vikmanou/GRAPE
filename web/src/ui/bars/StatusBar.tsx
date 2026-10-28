import type { BackendKind } from '../../engine/core/detect';
import type { LayoutStatus } from '../../state/layout';
import type { CoreStatus } from '../../state/load';
import { shownGraph } from '../../state/load';
import { useApp } from '../../state/store';
import { formatCount, formatPercent, formatSeconds } from '../format';

interface Props {
  onToggleWarnings: () => void;
}

const rendererLabel: Record<BackendKind | 'detecting', string> = {
  detecting: 'Detecting GPU…',
  webgpu: 'WebGPU',
  webgl2: 'WebGL2',
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

export function StatusBar({ onToggleWarnings }: Props) {
  const backend = useApp((s) => s.renderer);
  const core = useApp((s) => s.core);
  const load = useApp((s) => s.load);
  const layout = useApp((s) => s.layoutStatus);
  const paused = useApp((s) => s.layoutPaused);
  const fps = useApp((s) => s.fps);
  const refining = useApp((s) => s.refining);
  const visible = useApp((s) => s.visibleSegments);
  const segments = useApp((s) => shownGraph(s)?.stats.segments ?? 0);
  const onCancel = useApp((s) => s.cancelLoad);
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
        <span data-testid="status-segments" data-visible={visible}>
          {visible === undefined
            ? `${formatCount(segments)} segments`
            : `${formatCount(visible)} of ${formatCount(segments)} segments shown`}
        </span>
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
      {refining && <span data-testid="status-refining">Refining layout…</span>}
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
