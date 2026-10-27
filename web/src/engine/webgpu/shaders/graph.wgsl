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
  outline: vec4f,
  hover_outline: vec4f,
  // Added to the ribbon's half width: the highlight passes draw an outline
  // capsule this much wider, then the fill this much narrower.
  grow: f32,
  hover: u32,
  // 0 in single mode; 1 or -1 for the strand double mode draws.
  strand: f32,
}

struct Style {
  // Index into COLOR_MODES (engine/style/display.ts).
  mode: u32,
  log_scale: u32,
  // The colour range, already through the scale.
  range_lo: f32,
  range_hi: f32,
  random_start: u32,
  segments: u32,
  width_by_depth: u32,
  mean_depth: f32,
  uniform_color: u32,
  unknown_color: u32,
  no_tag_color: u32,
  // Unselected segments fade.
  dim: u32,
  // Segments shorter than this draw as a dot.
  sprite_px: f32,
  // 256 RGBA8 colours, four to an entry.
  ramp: array<vec4u, 64>,
}

@group(0) @binding(0) var<uniform> view: View;
@group(0) @binding(1) var<storage, read> positions: array<vec2f>;
// First point and segment of each ribbon piece.
@group(0) @binding(2) var<storage, read> pieces: array<vec2u>;
// Runs of one u32 per segment, in the order of FIELDS in segments.ts.
@group(0) @binding(3) var<storage, read> segment_table: array<u32>;
// End and inner point of each side of each link.
@group(0) @binding(4) var<storage, read> links: array<vec4u>;
// The links and pieces that touch the view, from cull.wgsl; draws are
// instanced over these.
@group(0) @binding(5) var<storage, read> visible_links: array<u32>;
@group(0) @binding(6) var<storage, read> visible_pieces: array<u32>;
// One bit per selected segment.
@group(0) @binding(7) var<storage, read> selected: array<u32>;
@group(0) @binding(8) var<uniform> style: Style;

const DEPTH = 0u;
const GC = 1u;
const LENGTH = 2u;
const COMPONENT = 3u;
const TAG = 4u;
const TAG2 = 5u;
const START = 6u;
const PIECES = 7u;

fn field(f: u32, segment: u32) -> u32 {
  return segment_table[f * style.segments + segment];
}

fn is_selected(segment: u32) -> bool {
  return ((selected[segment >> 5u] >> (segment & 31u)) & 1u) == 1u;
}

// Mirrors engine/style/colors.ts, the reference the tests check against.
fn hsl(h: f32, s: f32, l: f32) -> vec3f {
  let a = s * min(l, 1.0 - l);
  let k = (vec3f(0.0, 8.0, 4.0) + h * 12.0) % 12.0;
  return l - a * clamp(min(k - 3.0, 9.0 - k), vec3f(-1.0), vec3f(1.0));
}

// Bandage's random colours: saturation 127 and lightness 150 of 255, the hue
// stepped by the golden ratio as an exact u32 sequence.
fn golden_color(start: u32, i: u32) -> vec4f {
  let hue = f32(start + i * 0x9e3779b9u) / 4294967296.0;
  return vec4f(hsl(hue, 127.0 / 255.0, 150.0 / 255.0), 1.0);
}

fn ramped(value: f32) -> vec4f {
  if value != value {
    return unpack4x8unorm(style.unknown_color);
  }
  var v = value;
  if style.log_scale == 1u {
    v = log(max(v, 1e-30));
  }
  let span = style.range_hi - style.range_lo;
  var t = 0.0;
  if span > 0.0 {
    t = clamp((v - style.range_lo) / span, 0.0, 1.0);
  }
  let i = min(u32(floor(t * 256.0)), 255u);
  return unpack4x8unorm(style.ramp[i / 4u][i % 4u]);
}

// Bandage's `getCustomColourForDisplay`; 0 means no tag.
fn tag_color(segment: u32, strand: f32) -> vec4f {
  let forward = field(TAG, segment);
  let reverse = field(TAG2, segment);
  var tag = select(forward, reverse, strand < 0.0);
  if strand == 0.0 && tag == 0u {
    tag = reverse;
  }
  return unpack4x8unorm(select(tag, style.no_tag_color, tag == 0u));
}

fn segment_color(segment: u32, strand: f32) -> vec4f {
  switch style.mode {
    case 0u: {
      return unpack4x8unorm(style.uniform_color);
    }
    case 1u: {
      return golden_color(style.random_start, segment);
    }
    case 2u: {
      return ramped(bitcast<f32>(field(DEPTH, segment)));
    }
    case 3u: {
      return ramped(bitcast<f32>(field(GC, segment)));
    }
    case 4u: {
      return ramped(f32(field(LENGTH, segment)));
    }
    case 5u: {
      return golden_color(0u, field(COMPONENT, segment));
    }
    default: {
      return tag_color(segment, strand);
    }
  }
}

// Bandage's `getNodeWidth` with its default depth power and effect of 0.5,
// clamped to 0.5 to 4 times the average; mirrors `depthWidth` in widths.ts.
fn ribbon_half(segment: u32) -> f32 {
  let depth = bitcast<f32>(field(DEPTH, segment));
  if style.width_by_depth == 0u || depth != depth || !(style.mean_depth > 0.0) {
    return view.ribbon_half;
  }
  let relative = (sqrt(max(depth / style.mean_depth, 0.0)) - 1.0) * 0.5 + 1.0;
  return view.ribbon_half * clamp(relative, 0.5, 4.0);
}

// Where a segment shorter than `sprite_world` draws its dot; mirrors
// `sprite_center` in cull.wgsl, which keeps only such a segment's first piece.
fn sprite_center(segment: u32, sprite_world: f32) -> vec3f {
  let start = field(START, segment);
  let pieces = field(PIECES, segment);
  let mid = start + pieces / 2u;
  let extent = max(length(positions[mid] - positions[start]), length(positions[start + pieces] - positions[mid]));
  let center = 0.5 * (positions[mid] + positions[mid + pieces % 2u]);
  return vec3f(center, select(0.0, 1.0, extent < sprite_world));
}

// Faded unselected segments keep this much of their colour.
const DIMMED = 0.25;

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
  @location(3) @interpolate(flat) segment: u32,
}

// Each piece is a capsule cut from a quad by a signed distance, which gives
// round joins and caps.
@vertex
fn ribbon_vertex(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> Ribbon {
  let piece = pieces[visible_pieces[i]];
  var a = positions[piece.x];
  var b = positions[piece.x + 1u];
  let sprite = sprite_center(piece.y, style.sprite_px * view.world_per_pixel);
  if sprite.z > 0.0 {
    a = sprite.xy;
    b = sprite.xy;
  }
  let length_ab = length(b - a);
  let along = select(vec2f(1.0, 0.0), (b - a) / length_ab, length_ab > 1e-6);
  let across = vec2f(-along.y, along.x);
  let half = max(max(ribbon_half(piece.y), view.world_per_pixel * 0.5) + view.grow, 0.0);
  let pad = half + view.world_per_pixel;
  let corner = QUAD[v];
  let local = vec2f(mix(-pad, length_ab + pad, corner.x), corner.y * pad);
  var out: Ribbon;
  out.clip = to_clip(a + along * local.x + across * local.y);
  out.local = local;
  out.size = vec2f(length_ab, half);
  var color = segment_color(piece.y, view.strand);
  if style.dim == 1u && !is_selected(piece.y) {
    color.a *= DIMMED;
  }
  out.color = color;
  out.segment = piece.y;
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

@fragment
fn ribbon_outline_fragment(in: Ribbon) -> @location(0) vec4f {
  let nearest = vec2f(clamp(in.local.x, 0.0, in.size.x), 0.0);
  let color = select(view.outline, view.hover_outline, in.segment == view.hover);
  let alpha = coverage(in.size.y - length(in.local - nearest)) * color.a;
  if alpha <= 0.0 {
    discard;
  }
  return vec4f(color.rgb * alpha, alpha);
}

// Segment id plus one into the picking texture, 0 where nothing is drawn.
// Pixels whose centre lies inside the capsule count, with no antialiasing.
@fragment
fn ribbon_id_fragment(in: Ribbon) -> @location(0) u32 {
  let nearest = vec2f(clamp(in.local.x, 0.0, in.size.x), 0.0);
  if length(in.local - nearest) > in.size.y {
    discard;
  }
  return in.segment + 1u;
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
