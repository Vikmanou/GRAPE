import type { Backend } from '../engine/detect';

export type CoreStatus =
  | { state: 'loading' }
  | { state: 'ready'; version: string; roundTripMs: number }
  | { state: 'error'; message: string };

interface Props {
  backend: Backend | 'detecting';
  core: CoreStatus;
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

export function StatusBar({ backend, core }: Props) {
  return (
    <footer className="status-bar" data-testid="status-bar">
      <span data-testid="status-renderer" data-renderer={backend}>
        {rendererLabel[backend]}
      </span>
      <span data-testid="status-core" data-state={core.state}>
        {coreLabel(core)}
      </span>
    </footer>
  );
}
