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
// x bits, y bits, component, node per node, in bucket order
@group(0) @binding(7) var<storage, read_write> packed: array<vec4u>;
// iteration within the level, then total displacement
@group(0) @binding(8) var<storage, read_write> state: array<u32>;
@group(0) @binding(9) var<storage, read_write> energy: array<u32>;
// The same sums per far cell, which `TAIL_PER_COARSE` coarse cells make up.
@group(0) @binding(13) var<storage, read_write> tail: array<atomic<i32>>;

// Starts an iteration: empties both hashes, clears the energy and advances
// the iteration, which a new level sets to u32::MAX so its first is 0. A
// grid-stride loop covers tables larger than one dispatch can reach.
@compute @workgroup_size(WORKGROUP)
fn begin(@builtin(global_invocation_id) id: vec3u, @builtin(num_workgroups) groups: vec3u) {
  if (id.x == 0u) {
    state[0] += 1u;
    energy[0] = 0u;
  }
  let buckets = params.fine_mask + 2u;
  let words = (params.coarse_mask + 1u) * 4u;
  let tail_words = (params.tail_mask + 1u) * 4u;
  for (var i = id.x; i < max(max(buckets, words), tail_words); i += groups.x * WORKGROUP) {
    if (i < buckets) {
      atomicStore(&counts[i], 0u);
    }
    if (i < words) {
      atomicStore(&coarse[i], 0);
    }
    if (i < tail_words) {
      atomicStore(&tail[i], 0);
    }
  }
}

@compute @workgroup_size(WORKGROUP)
fn bin(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= params.count) {
    return;
  }
  let p = positions[i];
  let component = nodes[i].x;
  let fine = cell_of(p, params.cell);
  atomicAdd(&counts[cell_hash(component, fine) & params.fine_mask], 1u);

  let cell = coarse_of(fine);
  let key = bitcast<i32>(cell_key(component, cell));
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
  let offset = fixed_offset(p, cell);
  atomicAdd(&coarse[slot * 4u + 1u], 1);
  atomicAdd(&coarse[slot * 4u + 2u], offset.x);
  atomicAdd(&coarse[slot * 4u + 3u], offset.y);

  for (var tier = 1u; tier <= TAIL_TIERS; tier++) {
    let far = tail_of(cell, tier);
    let group = tail_group(component, tier);
    let far_key = bitcast<i32>(cell_key(group, far));
    var far_slot = cell_hash(group, far) & params.tail_mask;
    for (var probes = 0u; probes < min(params.tail_mask + 1u, TAIL_PROBES); ) {
      let r = atomicCompareExchangeWeak(&tail[far_slot * 4u], 0, far_key);
      if (r.exchanged || r.old_value == far_key) {
        break;
      }
      if (r.old_value != 0) {
        far_slot = (far_slot + 1u) & params.tail_mask;
        probes++;
      }
    }
    let far_offset = tail_offset(p, far, tier);
    atomicAdd(&tail[far_slot * 4u + 1u], 1);
    atomicAdd(&tail[far_slot * 4u + 2u], far_offset.x);
    atomicAdd(&tail[far_slot * 4u + 3u], far_offset.y);
  }
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
// later float sums run in a fixed order. Each bucket then copies what
// repulsion reads about its nodes next to each other.
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
  for (var k = begin; k < end; k++) {
    let i = sorted[k];
    packed[k] = vec4u(bitcast<vec2u>(positions[i]), nodes[i].x, i);
  }
}
