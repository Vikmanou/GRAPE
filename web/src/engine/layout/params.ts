/** Matches `Params` in layout-common.wgsl. */
export interface LevelParams {
  count: number;
  fineMask: number;
  coarseMask: number;
  seed: number;
  cell: number;
  coarseCell: number;
  repulsion: number;
  iterations: number;
}

export function encodeParams(p: LevelParams): ArrayBuffer {
  const data = new ArrayBuffer(32);
  const u = new Uint32Array(data);
  const f = new Float32Array(data);
  u[0] = p.count;
  u[1] = p.fineMask;
  u[2] = p.coarseMask;
  u[3] = p.seed;
  f[4] = p.cell;
  f[5] = p.coarseCell;
  f[6] = p.repulsion;
  u[7] = p.iterations;
  return data;
}
