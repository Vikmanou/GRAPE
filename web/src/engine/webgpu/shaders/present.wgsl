// From the running level to what the renderer draws: every level 0 point
// takes its ancestor's position plus its component's packing shift.

struct Walk {
  points: u32,
  // Levels between level 0 and the running one.
  steps: u32,
}

@group(0) @binding(0) var<uniform> walk: Walk;
// Each level's parent array, level 0 first.
@group(0) @binding(1) var<storage, read> parents: array<u32>;
@group(0) @binding(2) var<storage, read> sizes: array<u32>;
@group(0) @binding(3) var<storage, read_write> ancestors: array<u32>;
@group(0) @binding(4) var<storage, read> positions: array<vec2f>;
@group(0) @binding(5) var<storage, read> points: array<Node>;
@group(0) @binding(6) var<storage, read> shift: array<vec2f>;
@group(0) @binding(7) var<storage, read_write> drawn: array<vec2f>;
@group(0) @binding(8) var<uniform> params: Params;
@group(0) @binding(9) var<storage, read> nodes: array<Node>;
// Per component: max of inverted x and y (so minima), then max x and y, as
// order-preserving u32s.
@group(0) @binding(10) var<storage, read_write> boxes: array<atomic<u32>>;

@compute @workgroup_size(WORKGROUP)
fn find_ancestors(@builtin(global_invocation_id) id: vec3u) {
  let q = id.x;
  if (q >= walk.points) {
    return;
  }
  var node = q;
  var offset = 0u;
  for (var l = 0u; l < walk.steps; l++) {
    node = parents[offset + node];
    offset += sizes[l];
  }
  ancestors[q] = node;
}

@compute @workgroup_size(WORKGROUP)
fn present(@builtin(global_invocation_id) id: vec3u) {
  let q = id.x;
  if (q >= walk.points) {
    return;
  }
  drawn[q] = positions[ancestors[q]] + shift[points[q].x];
}

fn ordered(v: f32) -> u32 {
  let bits = bitcast<u32>(v);
  return select(bits ^ 0x80000000u, ~bits, (bits & 0x80000000u) != 0u);
}

@compute @workgroup_size(WORKGROUP)
fn bound(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= params.count) {
    return;
  }
  let p = positions[i];
  let c = nodes[i].x * 4u;
  atomicMax(&boxes[c], ~ordered(p.x));
  atomicMax(&boxes[c + 1u], ~ordered(p.y));
  atomicMax(&boxes[c + 2u], ordered(p.x));
  atomicMax(&boxes[c + 3u], ordered(p.y));
}
