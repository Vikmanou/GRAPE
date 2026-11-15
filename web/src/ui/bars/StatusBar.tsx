import type { BackendKind } from '../../engine/core/detect';
import type { LayoutStatus } from '../../state/layout';
import type { CoreStatus } from '../../state/load';
import { shownGraph } from '../../state/load';
import { useApp } from '../../state/store';
import { formatCount, formatSeconds } from '../format';

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
    case 'running':
      return paused ? 'Layout paused' : 'Laying out…';
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
      return 'Ready';
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
  const visible = useApp((s) => s.visibleSegments);
  const selected = useApp((s) => s.selection.count);
  const segments = useApp((s) => shownGraph(s)?.stats.segments ?? 0);
  const warnings = load.state === 'loaded' ? load.result.warnings : undefined;
  const layoutText = layoutLabel(layout, paused);
  return (
    <footer className="status-bar" data-testid="status-bar" data-inset="bottom">
      {load.state === 'loaded' && (
        <span data-testid="status-segments" data-visible={visible}>
          {visible === undefined
            ? `${formatCount(segments)} segments`
            : `${formatCount(visible)} of ${formatCount(segments)} segments shown`}
        </span>
      )}
      {selected > 0 && <span data-testid="status-selection">{formatCount(selected)} selected</span>}
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
        <button
          type="button"
          className="link warn pulse"
          title="Lines the parser skipped or repaired; click to list them"
          data-testid="status-warnings"
          onClick={onToggleWarnings}
        >
          {formatCount(warnings.total)} {warnings.total === 1 ? 'warning' : 'warnings'}
        </button>
      )}
      <span className="spacer" />
      {fps !== undefined && <span data-testid="status-fps">{Math.round(fps)} fps</span>}
      <span data-testid="status-renderer" data-renderer={backend}>
        {rendererLabel[backend]}
      </span>
      <span
        data-testid="status-core"
        data-state={core.state}
        title={core.state === 'ready' ? `gfa-core ${core.version}` : undefined}
      >
        {coreLabel(core)}
      </span>
    </footer>
  );
}
