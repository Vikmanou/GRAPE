import init, { Layout } from '../wasm/pkg/gfa_wasm';
import wasmUrl from '../wasm/pkg/gfa_wasm_bg.wasm?url';
import type { LayoutRequest, LayoutResponse } from './protocol';

/** How often positions are posted while the layout runs. */
const POST_INTERVAL_MS = 100;

const ready = init({ module_or_path: wasmUrl });

function post(message: LayoutResponse, transfer: Transferable[] = []): void {
  self.postMessage(message, { transfer });
}

async function run({ id, topology: t, seed }: LayoutRequest): Promise<void> {
  await ready;
  const layout = new Layout(t.lengths, t.components, t.linkFrom, t.linkTo, t.linkBits, seed);
  try {
    const pieces = layout.pieces();
    const links = layout.links();
    let positions = layout.positions();
    const geometry = { segments: t.lengths.length, points: positions.length / 2, pieces, links };
    post({ type: 'geometry', id, geometry, totalIterations: layout.totalIterations() }, [pieces.buffer, links.buffer]);
    post({ type: 'positions', id, positions, iteration: 0, done: false }, [positions.buffer]);
    let last = performance.now();
    let done = false;
    while (!done) {
      done = layout.step(1);
      const now = performance.now();
      if (done || now - last >= POST_INTERVAL_MS) {
        last = now;
        positions = layout.positions();
        post({ type: 'positions', id, positions, iteration: layout.iteration(), done }, [positions.buffer]);
      }
    }
  } finally {
    layout.free();
  }
}

self.addEventListener('message', (event: MessageEvent<LayoutRequest>) => {
  const request = event.data;
  run(request).catch((error: unknown) => {
    post({ type: 'error', id: request.id, message: error instanceof Error ? error.message : String(error) });
  });
});
