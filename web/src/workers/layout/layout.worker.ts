import init, { Layout, pack, type Hierarchy as WasmHierarchy } from '../../wasm/pkg/gfa_wasm';
import wasmUrl from '../../wasm/pkg/gfa_wasm_bg.wasm?url';
import type { Topology } from '../protocol/graph';
import type { Hierarchy, LayoutControl, LayoutOptions, LayoutRequest, LayoutResponse } from '../protocol/layout';
import { plain } from '../plain';
import { CpuRun } from './cpuRun';
import { iterationsFor } from './quality';

const ready = init({ module_or_path: wasmUrl });

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

/** The CPU layout this worker runs, which control requests act on. */
let cpu: CpuRun | undefined;

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

function control(request: LayoutControl): void {
  switch (request.type) {
    case 'pause':
      cpu?.setPaused(request.paused);
      break;
    case 'drag':
      cpu?.drag(request.segment, request.dx, request.dy);
      break;
    case 'unpin':
      cpu?.unpinAll();
      break;
    case 'refine':
      cpu?.refine(request.selected);
      break;
  }
  post({ type: 'ok', id: request.id });
}

async function handle(request: LayoutRequest): Promise<void> {
  await ready;
  if (request.type === 'pause' || request.type === 'drag' || request.type === 'unpin' || request.type === 'refine') {
    control(request);
    return;
  }
  if (request.type === 'memory') {
    post({ type: 'memory', id: request.id, memory: { wasm: (await ready).memory.buffer.byteLength, held: 0 } });
    return;
  }
  if (request.type === 'pack') {
    const offsets = pack(request.boxes, request.frozen);
    post({ type: 'packed', id: request.id, offsets }, [offsets.buffer]);
    return;
  }
  const layout = create(request.topology, request.options);
  if (request.type === 'layout') {
    try {
      postGeometry(request.id, layout, request.topology.lengths.length);
      cpu = new CpuRun(request.id, layout, post);
      await cpu.run();
    } finally {
      cpu = undefined;
      layout.free();
    }
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
