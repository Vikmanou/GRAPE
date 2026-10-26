// Positions arrive relative to an origin near the camera, so f32 maths stays
// precise however large the layout is.

struct View {
  center: vec2f,
  // World to clip space: zoom * 2 / viewport, with y flipped.
  scale: vec2f,
  world_per_pixel: f32,
  ribbon_half: f32,
  link_half: f32,
  link_alpha: f32,
  link_color: vec4f,
}

@group(0) @binding(0) var<uniform> view: View;
@group(0) @binding(1) var<storage, read> positions: array<vec2f>;
// First point and segment of each ribbon piece.
@group(0) @binding(2) var<storage, read> pieces: array<vec2u>;
// RGBA8 per segment.
@group(0) @binding(3) var<storage, read> colors: array<u32>;
// End and inner point of each side of each link.
@group(0) @binding(4) var<storage, read> links: array<vec4u>;
// The links and pieces that touch the view, from cull.wgsl; draws are
// instanced over these.
@group(0) @binding(5) var<storage, read> visible_links: array<u32>;
@group(0) @binding(6) var<storage, read> visible_pieces: array<u32>;

// x along, y across.
const QUAD = array<vec2f, 6>(
  vec2f(0.0, -1.0), vec2f(1.0, -1.0), vec2f(0.0, 1.0),
  vec2f(0.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
);

fn to_clip(world: vec2f) -> vec4f {
  return vec4f((world - view.center) * view.scale, 0.0, 1.0);
}

fn coverage(inside: f32) -> f32 {
  return clamp(inside / view.world_per_pixel + 0.5, 0.0, 1.0);
}

struct Ribbon {
  @builtin(position) clip: vec4f,
  // x along the piece from its start, y across.
  @location(0) local: vec2f,
  // Piece length, half width.
  @location(1) @interpolate(flat) size: vec2f,
  @location(2) @interpolate(flat) color: vec4f,
}

// Each piece is a capsule cut from a quad by a signed distance, which gives
// round joins and caps.
@vertex
fn ribbon_vertex(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> Ribbon {
  let piece = pieces[visible_pieces[i]];
  let a = positions[piece.x];
  let b = positions[piece.x + 1u];
  let length_ab = length(b - a);
  let along = select(vec2f(1.0, 0.0), (b - a) / length_ab, length_ab > 1e-6);
  let across = vec2f(-along.y, along.x);
  let half = max(view.ribbon_half, view.world_per_pixel * 0.5);
  let pad = half + view.world_per_pixel;
  let corner = QUAD[v];
  let local = vec2f(mix(-pad, length_ab + pad, corner.x), corner.y * pad);
  var out: Ribbon;
  out.clip = to_clip(a + along * local.x + across * local.y);
  out.local = local;
  out.size = vec2f(length_ab, half);
  out.color = unpack4x8unorm(colors[piece.y]);
  return out;
}

@fragment
fn ribbon_fragment(in: Ribbon) -> @location(0) vec4f {
  let nearest = vec2f(clamp(in.local.x, 0.0, in.size.x), 0.0);
  let alpha = coverage(in.size.y - length(in.local - nearest)) * in.color.a;
  if alpha <= 0.0 {
    discard;
  }
  return vec4f(in.color.rgb * alpha, alpha);
}

const LINK_STEPS = 16u;

struct Link {
  @builtin(position) clip: vec4f,
  @location(0) across: f32,
  @location(1) @interpolate(flat) half: f32,
}

// Ends that (nearly) meet, as in `a+ a-`, would give a curve with no length,
// so they open sideways into a loop.
fn controls(link: vec4u) -> array<vec2f, 4> {
  let p0 = positions[link.x];
  let p3 = positions[link.z];
  let out_a = normalize_or(p0 - positions[link.y], vec2f(1.0, 0.0));
  let out_b = normalize_or(p3 - positions[link.w], vec2f(-1.0, 0.0));
  let gap = length(p3 - p0);
  let reach = max(gap * 0.4, view.ribbon_half * 6.0);
  if gap < view.ribbon_half * 4.0 {
    let side = vec2f(-out_a.y, out_a.x);
    return array<vec2f, 4>(p0, p0 + (out_a + side) * reach, p3 + (out_b - side) * reach, p3);
  }
  return array<vec2f, 4>(p0, p0 + out_a * reach, p3 + out_b * reach, p3);
}

fn normalize_or(v: vec2f, fallback: vec2f) -> vec2f {
  let l = length(v);
  return select(fallback, v / l, l > 1e-6);
}

fn bezier(c: array<vec2f, 4>, t: f32) -> vec2f {
  let u = 1.0 - t;
  return u * u * u * c[0] + 3.0 * u * u * t * c[1] + 3.0 * u * t * t * c[2] + t * t * t * c[3];
}

fn bezier_tangent(c: array<vec2f, 4>, t: f32) -> vec2f {
  let u = 1.0 - t;
  return 3.0 * u * u * (c[1] - c[0]) + 6.0 * u * t * (c[2] - c[1]) + 3.0 * t * t * (c[3] - c[2]);
}

// Neighbouring quads compute their shared edge from the same t: no gaps.
@vertex
fn link_vertex(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> Link {
  let c = controls(links[visible_links[i]]);
  let corner = QUAD[v % 6u];
  let t = (f32(v / 6u) + corner.x) / f32(LINK_STEPS);
  let tangent = normalize_or(bezier_tangent(c, t), c[3] - c[0]);
  let half = max(view.link_half, view.world_per_pixel * 0.5);
  let across = corner.y * (half + view.world_per_pixel);
  var out: Link;
  out.clip = to_clip(bezier(c, t) + vec2f(-tangent.y, tangent.x) * across);
  out.across = across;
  out.half = half;
  return out;
}

@fragment
fn link_fragment(in: Link) -> @location(0) vec4f {
  let alpha = coverage(in.half - abs(in.across)) * view.link_alpha * view.link_color.a;
  if alpha <= 0.0 {
    discard;
  }
  return vec4f(view.link_color.rgb * alpha, alpha);
}
