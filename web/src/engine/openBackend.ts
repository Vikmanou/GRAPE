import type { EngineEvent } from './commands';
import type { Backend, BackendEvents } from './core/backend';
import { WebGl2Backend } from './webgl2/WebGl2Backend';
import { WebGpuBackend } from './webgpu/WebGpuBackend';

/** Creates the backend for `canvas`, turning what it reports into engine events. */
export async function openBackend(
  canvas: HTMLCanvasElement,
  kind: 'webgpu' | 'webgl2',
  emit: (event: EngineEvent) => void,
): Promise<Backend> {
  const events: BackendEvents = {
    error: (message) => {
      emit({ type: 'error', message });
    },
    lost: (message) => {
      emit({ type: 'device-lost', message });
    },
    measured: (boxes, progress) => {
      emit({ type: 'layout-measured', boxes, progress });
    },
    refining: (active) => {
      emit({ type: 'refining', active });
    },
    control: (request) => {
      emit({ type: 'layout-control', request });
    },
  };
  return kind === 'webgpu' ? WebGpuBackend.create(canvas, events) : WebGl2Backend.create(canvas, events);
}
