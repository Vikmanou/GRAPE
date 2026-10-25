// Bins nodes into a hash of fine cells (counting sort) and sums them into a
// hash of coarse cells. A fine bucket can hold nodes of several cells; readers
// check each node's own cell.

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> positions: array<vec2f>;
@group(0) @binding(2) var<storage, read> nodes: array<Node>;
@group(0) @binding(3) var<storage, read_write> counts: array<atomic<u32>>;
// key, count, x sum, y sum per slot; key 0 is empty.
@group(0) @binding(4) var<storage, read_write> coarse: array<atomic<i32>>;
@group(0) @binding(5) var<storage, read_write> sorted: array<u32>;
// `counts` after the prefix sum.
@group(0) @binding(6) var<storage, read> starts: array<u32>;

fn coarse_key(component: u32, cell: vec2i) -> u32 {
  return mix32(cell_hash(component, cell) ^ 0x68e31da4u) | 1u;
}

@compute @workgroup_size(WORKGROUP)
fn bin(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= params.count) {
    return;
  }
  let p = positions[i];
  let component = nodes[i].x;
  atomicAdd(&counts[cell_hash(component, cell_of(p, params.cell)) & params.fine_mask], 1u);

  let cell = cell_of(p, params.coarse_cell);
  let key = bitcast<i32>(coarse_key(component, cell));
  var slot = cell_hash(component, cell) & params.coarse_mask;
  // Linear probing; a weak exchange can fail spuriously, which retries the slot.
  for (var probes = 0u; probes <= params.coarse_mask; ) {
    let r = atomicCompareExchangeWeak(&coarse[slot * 4u], 0, key);
    if (r.exchanged || r.old_value == key) {
      break;
    }
    if (r.old_value != 0) {
      slot = (slot + 1u) & params.coarse_mask;
      probes++;
    }
  }
  let local = (p - vec2f(cell) * params.coarse_cell) / params.coarse_cell;
  atomicAdd(&coarse[slot * 4u + 1u], 1);
  atomicAdd(&coarse[slot * 4u + 2u], i32(local.x * FIXED));
  atomicAdd(&coarse[slot * 4u + 3u], i32(local.y * FIXED));
}

// `counts` is bound to a copy of `starts` here: each bucket's cursor.
@compute @workgroup_size(WORKGROUP)
fn scatter(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= params.count) {
    return;
  }
  let bucket = cell_hash(nodes[i].x, cell_of(positions[i], params.cell)) & params.fine_mask;
  sorted[atomicAdd(&counts[bucket], 1u)] = i;
}

// Scatter order depends on thread timing; sorting each bucket by node makes
// later float sums run in a fixed order.
@compute @workgroup_size(WORKGROUP)
fn sort_buckets(@builtin(global_invocation_id) id: vec3u) {
  let bucket = id.x;
  if (bucket > params.fine_mask) {
    return;
  }
  let begin = starts[bucket];
  let end = starts[bucket + 1u];
  for (var i = begin + 1u; i < end; i++) {
    let v = sorted[i];
    var j = i;
    while (j > begin && sorted[j - 1u] > v) {
      sorted[j] = sorted[j - 1u];
      j--;
    }
    sorted[j] = v;
  }
}
