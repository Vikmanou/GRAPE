import init, { Layout, pack, type Hierarchy as WasmHierarchy } from '../../wasm/pkg/gfa_wasm';
import wasmUrl from '../../wasm/pkg/gfa_wasm_bg.wasm?url';
import type { Topology } from '../protocol/graph';
import type { Hierarchy, LayoutOptions, LayoutRequest, LayoutResponse } from '../protocol/layout';
import { plain } from '../plain';
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
  const links = plain(layout.takeLinks());
  const segmentStarts = plain(layout.segmentStarts());
  const segmentPieces = plain(layout.segmentPieces());
  const geometry = { segments, points: layout.points(), pieces, links, segmentStarts, segmentPieces };
  post({ type: 'geometry', id, geometry, totalIterations: layout.totalIterations() }, [
    pieces.buffer,
    links.buffer,
    segmentStarts.buffer,
    segmentPieces.buffer,
  ]);
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

/** Takes each array out of WASM, so none is held there and here at once for long. */
function takeHierarchy(h: WasmHierarchy): Hierarchy {
  const levels = Array.from({ length: h.levels() }, (_, l) => ({
    nodes: plain(h.takeNodes(l)),
    edges: plain(h.takeEdges(l)),
    heat: plain(h.heat(l)),
    repulsion: h.repulsion(l),
    meanRest: h.meanRest(l),
    iterations: h.iterations(l),
    parent: plain(h.takeParent(l)),
    children: plain(h.takeChildren(l)),
  }));
  return { levels, start: plain(h.start()), frozen: plain(h.frozen()) };
}

function transfers(h: Hierarchy): Transferable[] {
  const arrays = h.levels.flatMap((l) => [l.nodes, l.edges, l.heat, l.parent, l.children]);
  return [...arrays, h.start].map((a) => a.buffer);
}

async function handle(request: LayoutRequest): Promise<void> {
  await ready;
  if (request.type === 'memory') {
    post({ type: 'memory', id: request.id, memory: { wasm: (await ready).memory.buffer.byteLength, held: 0 } });
    return;
  }
  if (request.type === 'pack') {
    const offsets = pack(request.boxes, frozen);
    post({ type: 'packed', id: request.id, offsets }, [offsets.buffer]);
    return;
  }
  const layout = create(request.topology, request.options);
  if (request.type === 'layout') {
    try {
      postGeometry(request.id, layout, request.topology.lengths.length);
      runCpu(request.id, layout);
    } finally {
      layout.free();
    }
    return;
  }
  try {
    postGeometry(request.id, layout, request.topology.lengths.length);
  } catch (error) {
    layout.free();
    throw error;
  }
  const wasm = layout.intoHierarchy();
  try {
    const hierarchy = takeHierarchy(wasm);
    frozen = hierarchy.frozen.slice();
    post({ type: 'hierarchy', id: request.id, hierarchy }, transfers(hierarchy));
  } finally {
    wasm.free();
  }
}

self.addEventListener('message', (event: MessageEvent<LayoutRequest>) => {
  const request = event.data;
  handle(request).catch((error: unknown) => {
    post({ type: 'error', id: request.id, message: error instanceof Error ? error.message : String(error) });
  });
});
