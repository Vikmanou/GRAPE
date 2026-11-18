// One force iteration, a Jacobi step like the CPU reference
// (gfa-core layout/force.rs): repulsion first, then springs and the move.
//
// Repulsion is `k^2 / d` from every node of the component within reach,
// each counted once: exact pairs from the 3x3 fine cells around a node, and
// the centroids of the 5x5 coarse cells around it with those fine cells'
// nodes taken out. Small levels take every pair of the component instead,
// in one pass.

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> positions: array<vec2f>;
@group(0) @binding(2) var<storage, read> nodes: array<Node>;
// neighbour, rest bits, weight bits per spring end
@group(0) @binding(3) var<storage, read> edges: array<u32>;
@group(0) @binding(4) var<storage, read> coarse: array<i32>;
@group(0) @binding(6) var<storage, read> starts: array<u32>;
@group(0) @binding(7) var<storage, read_write> force: array<vec2f>;
@group(0) @binding(8) var<storage, read_write> moved: array<vec2f>;
@group(0) @binding(9) var<storage, read> heat: array<f32>;
// iteration within the level
@group(0) @binding(10) var<storage, read_write> state: array<u32>;
// total displacement in sixteenths
@group(0) @binding(11) var<storage, read_write> energy: atomic<u32>;
// x bits, y bits, component, node per node, in bucket order
@group(0) @binding(12) var<storage, read> packed: array<vec4u>;
@group(0) @binding(13) var<storage, read> tail: array<i32>;

const FAR_REACH = 2;
// Far cells read on each side of a node's own; `TAIL_REACH` in level.ts.
const TAIL_REACH = 2;
const COLD = 0.4;
const MIN_APART = 1e-2;

// Coincident nodes are pushed apart along a fixed direction picked from their
// indices, as in the CPU reference's `apart`.
fn apart(d: vec2f, i: u32, j: u32) -> vec2f {
  if (dot(d, d) >= MIN_APART * MIN_APART) {
    return d;
  }
  let s = select(MIN_APART, -MIN_APART, i < j);
  return vec2f(s, s * 0.5);
}

fn coarse_slot(component: u32, cell: vec2i) -> i32 {
  let key = bitcast<i32>(cell_key(component, cell));
  var slot = cell_hash(component, cell) & params.coarse_mask;
  for (var probes = 0u; probes <= params.coarse_mask; probes++) {
    let found = coarse[slot * 4u];
    if (found == key) {
      return i32(slot);
    }
    if (found == 0) {
      return -1;
    }
    slot = (slot + 1u) & params.coarse_mask;
  }
  return -1;
}

fn tail_slot(component: u32, cell: vec2i, tier: u32) -> i32 {
  let group = tail_group(component, tier);
  let key = bitcast<i32>(cell_key(group, cell));
  var slot = cell_hash(group, cell) & params.tail_mask;
  for (var probes = 0u; probes < min(params.tail_mask + 1u, TAIL_PROBES); probes++) {
    let found = tail[slot * 4u];
    if (found == key) {
      return i32(slot);
    }
    if (found == 0) {
      return -1;
    }
    slot = (slot + 1u) & params.tail_mask;
  }
  return -1;
}

@compute @workgroup_size(WORKGROUP)
fn repel(@builtin(global_invocation_id) id: vec3u) {
  // Threads take nodes in bucket order, so neighbouring threads read the same cells.
  if (id.x >= params.count) {
    return;
  }
  let me = packed[id.x];
  let i = me.w;
  let component = me.z;
  if (heat[component] == 0.0) {
    force[i] = vec2f(0.0);
    return;
  }
  let p = bitcast<vec2f>(me.xy);
  var f = vec2f(0.0);

  let home = cell_of(p, params.cell);
  let own = coarse_of(home);
  // What the near cells hold, by coarse cell around `own`, to take out of
  // those coarse cells' sums: near cells lie at most one coarse cell away.
  var near_count: array<i32, 9>;
  var near_sum: array<vec2i, 9>;
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let cell = home + vec2i(dx, dy);
      let coarse_cell = coarse_of(cell);
      let at = (coarse_cell.y - own.y + 1) * 3 + coarse_cell.x - own.x + 1;
      let bucket = cell_hash(component, cell) & params.fine_mask;
      for (var k = starts[bucket]; k < starts[bucket + 1u]; k++) {
        let other = packed[k];
        let q = bitcast<vec2f>(other.xy);
        if (other.z != component || any(cell_of(q, params.cell) != cell)) {
          continue;
        }
        near_count[at] += 1;
        near_sum[at] += fixed_offset(q, coarse_cell);
        if (other.w != i) {
          let d = apart(p - q, i, other.w);
          f += d / dot(d, d);
        }
      }
    }
  }

  // What each nearer ring reads holds, by cell of the next tier around the
  // node's own, relative to the node: that tier's sums take it out. A ring
  // reaches at most one cell of the next tier away. Slots 9 * tier on.
  let own_tail = next_tier(own);
  var covered_count: array<i32, 36>;
  var covered_sum: array<vec2f, 36>;
  for (var dy = -FAR_REACH; dy <= FAR_REACH; dy++) {
    for (var dx = -FAR_REACH; dx <= FAR_REACH; dx++) {
      let cell = own + vec2i(dx, dy);
      let slot = coarse_slot(component, cell);
      if (slot < 0) {
        continue;
      }
      let s = u32(slot) * 4u;
      var count = coarse[s + 1u];
      var sum = vec2i(coarse[s + 2u], coarse[s + 3u]);
      let t = next_tier(cell) - own_tail + vec2i(1);
      let covers = 9 + t.y * 3 + t.x;
      covered_count[covers] += count;
      covered_sum[covers] += (vec2f(cell) * f32(count) + vec2f(sum) / FIXED) * params.coarse_cell - f32(count) * p;
      if (abs(dx) <= 1 && abs(dy) <= 1) {
        let at = (dy + 1) * 3 + dx + 1;
        count -= near_count[at];
        sum -= near_sum[at];
      }
      if (count <= 0) {
        continue;
      }
      let centroid = (vec2f(cell) + vec2f(sum) / (f32(count) * FIXED)) * params.coarse_cell;
      let d = p - centroid;
      f += f32(count) * d / max(dot(d, d), MIN_APART * MIN_APART);
    }
  }

  for (var tier = 1u; tier <= TAIL_TIERS; tier++) {
    let own_cell = tail_of(own, tier);
    let size = tail_size(tier);
    let above = next_tier(own_cell);
    for (var dy = -TAIL_REACH; dy <= TAIL_REACH; dy++) {
      for (var dx = -TAIL_REACH; dx <= TAIL_REACH; dx++) {
        let cell = own_cell + vec2i(dx, dy);
        let slot = tail_slot(component, cell, tier);
        if (slot < 0) {
          continue;
        }
        let s = u32(slot) * 4u;
        var count = tail[s + 1u];
        var offset = (vec2f(cell) * f32(count) + vec2f(f32(tail[s + 2u]), f32(tail[s + 3u])) / FIXED) * size - f32(count) * p;
        if (tier < TAIL_TIERS) {
          let t = next_tier(cell) - above + vec2i(1);
          let covers = 9 * i32(tier + 1u) + t.y * 3 + t.x;
          covered_count[covers] += count;
          covered_sum[covers] += offset;
        }
        if (abs(dx) <= 1 && abs(dy) <= 1) {
          let at = 9 * i32(tier) + (dy + 1) * 3 + dx + 1;
          count -= covered_count[at];
          offset -= covered_sum[at];
        }
        if (count <= 0) {
          continue;
        }
        let d = -offset / f32(count);
        f += f32(count) * d / max(dot(d, d), MIN_APART * MIN_APART);
      }
    }
  }
  force[i] = f * params.repulsion;
}

var<workgroup> tile_position: array<vec2f, WORKGROUP>;
var<workgroup> tile_component: array<u32, WORKGROUP>;

// Every other node of the component, read a tile at a time into workgroup
// memory and summed in index order.
@compute @workgroup_size(WORKGROUP)
fn repel_all(@builtin(global_invocation_id) id: vec3u, @builtin(local_invocation_index) t: u32) {
  let i = id.x;
  let inside = i < params.count;
  var p = vec2f(0.0);
  var component = 0u;
  var hot = false;
  if (inside) {
    p = positions[i];
    component = nodes[i].x;
    hot = heat[component] != 0.0;
  }
  var f = vec2f(0.0);
  for (var base = 0u; base < params.count; base += WORKGROUP) {
    let j = base + t;
    if (j < params.count) {
      tile_position[t] = positions[j];
      tile_component[t] = nodes[j].x;
    }
    workgroupBarrier();
    let end = min(WORKGROUP, params.count - base);
    if (hot) {
      for (var k = 0u; k < end; k++) {
        let other = base + k;
        if (tile_component[k] == component && other != i) {
          let d = apart(p - tile_position[k], i, other);
          f += d / dot(d, d);
        }
      }
    }
    workgroupBarrier();
  }
  if (inside) {
    force[i] = f * params.repulsion;
  }
}

var<workgroup> group_energy: atomic<u32>;

// Springs pull with Hooke's law up to their rest length and with the square
// of the stretch beyond it, as in the CPU reference.
@compute @workgroup_size(WORKGROUP)
fn pull_and_move(@builtin(global_invocation_id) id: vec3u, @builtin(local_invocation_index) t: u32) {
  let i = id.x;
  if (t == 0u) {
    atomicStore(&group_energy, 0u);
  }
  workgroupBarrier();
  if (i < params.count) {
    let node = nodes[i];
    let h = heat[node.x];
    let p = positions[i];
    var next = p;
    if (h > 0.0) {
      var f = force[i];
      for (var e = node.z; e < node.w; e++) {
        let q = positions[edges[e * 3u]];
        let rest = bitcast<f32>(edges[e * 3u + 1u]);
        let weight = bitcast<f32>(edges[e * 3u + 2u]);
        let delta = q - p;
        let d = max(length(delta), 1e-6);
        f += delta * (weight * (d - rest) / d * max(d / rest, 1.0));
      }
      var step = f * bitcast<f32>(node.y);
      let progress = f32(state[0]) / f32(max(params.iterations, 1u));
      let temperature = h * pow(COLD / h, progress);
      let moved_by = length(step);
      if (moved_by > temperature) {
        step *= temperature / moved_by;
      }
      next = p + step;
      atomicAdd(&group_energy, u32(min(moved_by, temperature) * 16.0));
    }
    moved[i] = next;
  }
  workgroupBarrier();
  if (t == 0u) {
    atomicAdd(&energy, atomicLoad(&group_energy));
  }
}
