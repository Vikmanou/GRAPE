// Keeps the ribbon pieces and links that can touch the view, in their own
// order: mark, prefix sum, then compact, so overlapping ribbons draw in the
// same order however the view moves. The survivors' count goes into the
// draw's indirect arguments.

struct Cull {
  center: vec2f,
  // Half the view, in world units.
  half: vec2f,
  // Ribbon half width plus a pixel, in world units.
  pad: f32,
  ribbon_half: f32,
  count: u32,
  // Where the draw's instance count sits in `indirect`.
  slot: u32,
}

@group(0) @binding(0) var<uniform> cull: Cull;
@group(0) @binding(1) var<storage, read> positions: array<vec2f>;
@group(0) @binding(2) var<storage, read> pieces: array<vec2u>;
@group(0) @binding(3) var<storage, read> links: array<vec4u>;
// 1 per item that touches the view, then their prefix sum; one extra entry
// ends up holding the total.
@group(0) @binding(4) var<storage, read_write> marks: array<u32>;
@group(0) @binding(5) var<storage, read_write> visible: array<u32>;
@group(0) @binding(6) var<storage, read_write> indirect: array<u32>;

fn touches(lo: vec2f, hi: vec2f) -> u32 {
  let inside = all(hi >= cull.center - cull.half) && all(lo <= cull.center + cull.half);
  return select(0u, 1u, inside);
}

@compute @workgroup_size(256)
fn mark_pieces(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= cull.count) {
    if (i == cull.count) {
      marks[i] = 0u;
    }
    return;
  }
  let a = positions[pieces[i].x];
  let b = positions[pieces[i].x + 1u];
  marks[i] = touches(min(a, b) - cull.pad, max(a, b) + cull.pad);
}

// A link's curve stays inside its control points, which graph.wgsl's
// `controls` puts at most 1.5 reaches from the link's ends.
@compute @workgroup_size(256)
fn mark_links(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= cull.count) {
    if (i == cull.count) {
      marks[i] = 0u;
    }
    return;
  }
  let a = positions[links[i].x];
  let b = positions[links[i].z];
  let reach = max(length(b - a) * 0.4, cull.ribbon_half * 6.0) * 1.5 + cull.pad;
  marks[i] = touches(min(a, b) - reach, max(a, b) + reach);
}

@compute @workgroup_size(256)
fn compact(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i == 0u) {
    indirect[cull.slot] = marks[cull.count];
  }
  if (i < cull.count && marks[i + 1u] > marks[i]) {
    visible[marks[i]] = i;
  }
}
