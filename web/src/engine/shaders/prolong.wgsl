// Moving from a level to the next finer one, as the CPU reference's
// `descend`: each pair of children splits along the direction its own
// neighbours pull it, so chains unfold untwisted.

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> coarse_positions: array<vec2f>;
// The finer level's nodes and edges.
@group(0) @binding(2) var<storage, read> nodes: array<Node>;
@group(0) @binding(3) var<storage, read> edges: array<u32>;
@group(0) @binding(4) var<storage, read> parent: array<u32>;
@group(0) @binding(5) var<storage, read_write> pull: array<vec2f>;
// first child, second child or NONE, half distance bits per coarse node
@group(0) @binding(6) var<storage, read> children: array<u32>;
@group(0) @binding(7) var<storage, read_write> fine_positions: array<vec2f>;

const NONE = 0xffffffffu;
const TAU = 6.283185307179586;

// Runs over the finer level: `params` is the finer level's.
@compute @workgroup_size(WORKGROUP)
fn pull_children(@builtin(global_invocation_id) id: vec3u) {
  let a = id.x;
  if (a >= params.count) {
    return;
  }
  let own = parent[a];
  let home = coarse_positions[own];
  let node = nodes[a];
  var f = vec2f(0.0);
  for (var e = node.z; e < node.w; e++) {
    let other = parent[edges[e * 3u]];
    if (other != own) {
      f += (coarse_positions[other] - home) * bitcast<f32>(edges[e * 3u + 2u]);
    }
  }
  pull[a] = f;
}

// Runs over the coarse level: `params` is the coarse level's.
@compute @workgroup_size(WORKGROUP)
fn place_children(@builtin(global_invocation_id) id: vec3u) {
  let p = id.x;
  if (p >= params.count) {
    return;
  }
  let u = children[p * 3u];
  let v = children[p * 3u + 1u];
  let centre = coarse_positions[p];
  if (v == NONE) {
    fine_positions[u] = centre;
    return;
  }
  let half = bitcast<f32>(children[p * 3u + 2u]);
  var direction = pull[v] - pull[u];
  let d = length(direction);
  if (d > 1e-6) {
    direction /= d;
  } else {
    let angle = f32(mix32(params.seed ^ mix32(p))) / 4294967296.0 * TAU;
    direction = vec2f(cos(angle), sin(angle));
  }
  fine_positions[u] = centre - direction * half;
  fine_positions[v] = centre + direction * half;
}
