// Memory budgets per part of the page, checked by the layout benchmark. Each
// part may hold a fixed base plus a share per segment; the tab as a whole
// must stay under the spec's target for its graph size.

const MB = 1 << 20;

/** `[base MB, bytes per segment]` for each part of `MemoryReport` (web/src/state/testHooks.ts). */
export const BUDGETS = {
  mainHeap: [64, 100],
  mainArrays: [1, 40],
  gpu: [64, 700],
  graph: [32, 300],
  sequence: [16, 40],
  layout: [16, 0],
};

/** The spec's tab memory targets by graph size (Performance targets). */
export function tabTargetMb(segments) {
  if (segments <= 5_000) return 300;
  if (segments <= 200_000) return 1024;
  return 2048;
}

const used = (part) => (typeof part === 'number' ? part : part.wasm + part.held);

/** One row per part: what it holds, its budget and whether it fits, in MB. */
export function checkMemory(report, segments) {
  return Object.entries(BUDGETS).map(([name, [base, perSegment]]) => {
    const mb = used(report[name]) / MB;
    const budget = base + (perSegment * segments) / MB;
    return { name, mb, budget, ok: mb <= budget };
  });
}
