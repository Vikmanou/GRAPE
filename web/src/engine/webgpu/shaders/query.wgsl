// Questions about where ribbons are, answered on the GPU because positions
// live there.

struct Query {
  // A box in the same frame as `positions`: min x, min y, max x, max y.
  box: vec4f,
  // Ribbon half width in world units.
  half: f32,
  count: u32,
}

@group(0) @binding(0) var<uniform> query: Query;
@group(0) @binding(1) var<storage, read> positions: array<vec2f>;
// First point and segment of each ribbon piece.
@group(0) @binding(2) var<storage, read> pieces: array<vec2u>;
// One bit per segment.
@group(0) @binding(3) var<storage, read_write> hits: array<atomic<u32>>;

fn point_to_box(p: vec2f) -> f32 {
  let outside = max(max(query.box.xy - p, p - query.box.zw), vec2f(0.0));
  return length(outside);
}

fn point_to_segment(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let ab = b - a;
  let length2 = dot(ab, ab);
  let t = select(0.0, clamp(dot(p - a, ab) / length2, 0.0, 1.0), length2 > 1e-12);
  return length(p - (a + t * ab));
}

// Liang and Barsky's clip: whether any of segment `a, b` lies in the box.
fn crosses_box(a: vec2f, b: vec2f) -> bool {
  let d = b - a;
  var t0 = 0.0;
  var t1 = 1.0;
  let p = array<f32, 4>(-d.x, d.x, -d.y, d.y);
  let q = array<f32, 4>(a.x - query.box.x, query.box.z - a.x, a.y - query.box.y, query.box.w - a.y);
  for (var k = 0; k < 4; k++) {
    if (p[k] == 0.0) {
      if (q[k] < 0.0) {
        return false;
      }
    } else {
      let r = q[k] / p[k];
      if (p[k] < 0.0) {
        t0 = max(t0, r);
      } else {
        t1 = min(t1, r);
      }
    }
  }
  return t0 <= t1;
}

// The distance between a segment and a box that it does not cross is reached
// at one of the segment's ends or one of the box's corners.
fn segment_to_box(a: vec2f, b: vec2f) -> f32 {
  if (crosses_box(a, b)) {
    return 0.0;
  }
  let box = query.box;
  var d = min(point_to_box(a), point_to_box(b));
  d = min(d, point_to_segment(box.xy, a, b));
  d = min(d, point_to_segment(box.zw, a, b));
  d = min(d, point_to_segment(box.xw, a, b));
  d = min(d, point_to_segment(box.zy, a, b));
  return d;
}

// A segment is in the box when any of its ribbon touches it.
@compute @workgroup_size(256)
fn select_box(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= query.count) {
    return;
  }
  let piece = pieces[i];
  if (segment_to_box(positions[piece.x], positions[piece.x + 1u]) <= query.half) {
    atomicOr(&hits[piece.y >> 5u], 1u << (piece.y & 31u));
  }
}

// One bit per segment whose extent `bound_pieces` measures.
@group(0) @binding(4) var<storage, read> wanted: array<u32>;
// max of inverted x and y (so minima), then max x and y, as order-preserving
// u32s, like `bound` in present.wgsl.
@group(0) @binding(5) var<storage, read_write> extent: array<atomic<u32>, 4>;

fn ordered(v: f32) -> u32 {
  let bits = bitcast<u32>(v);
  return select(bits ^ 0x80000000u, ~bits, (bits & 0x80000000u) != 0u);
}

@compute @workgroup_size(256)
fn bound_pieces(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= query.count) {
    return;
  }
  let piece = pieces[i];
  if (((wanted[piece.y >> 5u] >> (piece.y & 31u)) & 1u) == 0u) {
    return;
  }
  for (var k = 0u; k < 2u; k++) {
    let p = positions[piece.x + k];
    atomicMax(&extent[0], ~ordered(p.x));
    atomicMax(&extent[1], ~ordered(p.y));
    atomicMax(&extent[2], ordered(p.x));
    atomicMax(&extent[3], ordered(p.y));
  }
}
