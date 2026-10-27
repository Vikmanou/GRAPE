// Pinning works on level 0 of the GPU layout: a point with step size 0 never
// moves, so pins and "re-layout selection" only rewrite step sizes.

struct Shift {
  first: u32,
  count: u32,
  delta: vec2f,
}

struct Mobility {
  pieces: u32,
  // 0: everything not pinned moves; 1: only selected segments move.
  only_selected: u32,
}

@group(0) @binding(0) var<uniform> shift: Shift;
@group(0) @binding(1) var<storage, read_write> positions: array<vec2f>;

// Moves one segment's chain of points by the drag.
@compute @workgroup_size(256)
fn translate(@builtin(global_invocation_id) id: vec3u) {
  if (id.x < shift.count) {
    positions[shift.first + id.x] += shift.delta;
  }
}

@group(0) @binding(2) var<uniform> mobility: Mobility;
// First point and segment of each ribbon piece.
@group(0) @binding(3) var<storage, read> pieces: array<vec2u>;
// Level 0 nodes as the hierarchy gave them: `component, step size, first edge, end edge`.
@group(0) @binding(4) var<storage, read> original: array<vec4u>;
@group(0) @binding(5) var<storage, read_write> nodes: array<vec4u>;
// One bit per segment.
@group(0) @binding(6) var<storage, read> pinned: array<u32>;
@group(0) @binding(7) var<storage, read> selected: array<u32>;

// Both points of a piece get their segment's step size; neighbouring pieces
// share a point and write the same value to it.
@compute @workgroup_size(256)
fn set_mobility(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= mobility.pieces) {
    return;
  }
  let piece = pieces[id.x];
  let word = piece.y >> 5u;
  let bit = 1u << (piece.y & 31u);
  let movable = (pinned[word] & bit) == 0u && (mobility.only_selected == 0u || (selected[word] & bit) != 0u);
  for (var k = 0u; k < 2u; k++) {
    let p = piece.x + k;
    nodes[p].y = select(0u, original[p].y, movable);
  }
}
