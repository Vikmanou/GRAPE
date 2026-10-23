import type { Backend } from '../engine/detect';

interface Props {
  backend: Backend | 'detecting';
}

const rendererLabel: Record<Props['backend'], string> = {
  detecting: 'Detecting GPU…',
  webgpu: 'WebGPU',
  webgl2: 'WebGL2 detected; WebGL2 rendering arrives in milestone 8',
  none: 'No GPU backend',
};

export function StatusBar({ backend }: Props) {
  return (
    <footer className="status-bar" data-testid="status-bar">
      <span data-testid="status-renderer" data-renderer={backend}>
        {rendererLabel[backend]}
      </span>
    </footer>
  );
}
