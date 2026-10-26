import init, { Layout, pack, type Hierarchy as WasmHierarchy } from '../../wasm/pkg/gfa_wasm';
import wasmUrl from '../../wasm/pkg/gfa_wasm_bg.wasm?url';
import type { Topology } from '../protocol/graph';
import type { Hierarchy, LayoutOptions, LayoutRequest, LayoutResponse } from '../protocol/layout';
import { iterationsFor } from './quality';

/** How often positions are posted while the CPU layout runs. */
const POST_INTERVAL_MS = 100;

const ready = init({ module_or_path: wasmUrl });
let frozen = new Uint8Array();

function post(message: LayoutResponse, transfer: Transferable[] = []): void {
  self.postMessage(message, { transfer });
}

function create(t: Topology, { seed, quality }: LayoutOptions): Layout {
  const { coarsest, refine } = iterationsFor(quality);
  return new Layout(t.lengths, t.components, t.linkFrom, t.linkTo, t.linkBits, seed, coarsest, refine);
}

function postGeometry(id: number, layout: Layout, segments: number): void {
  const pieces = plain(layout.pieces());
  const links = plain(layout.links());
  const geometry = { segments, points: layout.points(), pieces, links };
  post({ type: 'geometry', id, geometry, totalIterations: layout.totalIterations() }, [pieces.buffer, links.buffer]);
}

function runCpu(id: number, layout: Layout): void {
  let positions = layout.positions();
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
}

// wasm-bindgen copies results out of WASM memory onto plain ArrayBuffers.
function plain<T extends ArrayBufferLike>(array: Uint32Array<T>): Uint32Array<ArrayBuffer>;
function plain<T extends ArrayBufferLike>(array: Float32Array<T>): Float32Array<ArrayBuffer>;
function plain<T extends ArrayBufferLike>(array: Uint8Array<T>): Uint8Array<ArrayBuffer>;
function plain(array: Uint32Array | Float32Array | Uint8Array): ArrayBufferView<ArrayBuffer> {
  if (!(array.buffer instanceof ArrayBuffer)) throw new Error('expected a plain ArrayBuffer');
  return array as ArrayBufferView<ArrayBuffer>;
}

function copyHierarchy(h: WasmHierarchy): Hierarchy {
  const levels = Array.from({ length: h.levels() }, (_, l) => ({
    nodes: plain(h.nodes(l)),
    edges: plain(h.edges(l)),
    heat: plain(h.heat(l)),
    repulsion: h.repulsion(l),
    meanRest: h.meanRest(l),
    iterations: h.iterations(l),
    parent: plain(h.parent(l)),
    children: plain(h.children(l)),
  }));
  return { levels, start: plain(h.start()), frozen: plain(h.frozen()) };
}

function transfers(h: Hierarchy): Transferable[] {
  const arrays = h.levels.flatMap((l) => [l.nodes, l.edges, l.heat, l.parent, l.children]);
  return [...arrays, h.start].map((a) => a.buffer);
}

async function handle(request: LayoutRequest): Promise<void> {
  await ready;
  if (request.type === 'pack') {
    const offsets = pack(request.boxes, frozen);
    post({ type: 'packed', id: request.id, offsets }, [offsets.buffer]);
    return;
  }
  const layout = create(request.topology, request.options);
  try {
    postGeometry(request.id, layout, request.topology.lengths.length);
    if (request.type === 'layout') {
      runCpu(request.id, layout);
      return;
    }
    const wasm = layout.hierarchy();
    const hierarchy = copyHierarchy(wasm);
    wasm.free();
    frozen = hierarchy.frozen.slice();
    post({ type: 'hierarchy', id: request.id, hierarchy }, transfers(hierarchy));
  } finally {
    layout.free();
  }
}

self.addEventListener('message', (event: MessageEvent<LayoutRequest>) => {
  const request = event.data;
  handle(request).catch((error: unknown) => {
    post({ type: 'error', id: request.id, message: error instanceof Error ? error.message : String(error) });
  });
});
