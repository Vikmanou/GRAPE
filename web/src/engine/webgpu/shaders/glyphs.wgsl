// Label glyphs from a multi-channel signed distance field atlas, placed in
// pixels around their segment's anchor, which follows the layout.

struct Text {
  center: vec2f,
  zoom: f32,
  // Screen pixels per unit of the atlas's distance.
  px_range: f32,
  canvas: vec2f,
  segments: u32,
  color: vec4f,
  halo: vec4f,
}

struct Glyph {
  // From the anchor to the quad's top left, and its size, in pixels.
  offset: vec2f,
  size: vec2f,
  uv: vec4f,
  segment: u32,
}

@group(0) @binding(0) var<uniform> text: Text;
@group(0) @binding(1) var<storage, read> positions: array<vec2f>;
// The segment table of graph.wgsl.
@group(0) @binding(2) var<storage, read> segment_table: array<u32>;
@group(0) @binding(3) var<storage, read> glyphs: array<Glyph>;
@group(0) @binding(4) var atlas: texture_2d<f32>;
@group(0) @binding(5) var atlas_sampler: sampler;

const START = 6u;
const PIECES = 7u;
// Pixels of background colour around each glyph, so labels read over ribbons.
const HALO_PX = 1.0;

// Mirrors `anchor` in labels.wgsl.
fn anchor(segment: u32) -> vec2f {
  let start = segment_table[START * text.segments + segment];
  let pieces = segment_table[PIECES * text.segments + segment];
  let mid = start + pieces / 2u;
  return 0.5 * (positions[mid] + positions[mid + pieces % 2u]);
}

const QUAD = array<vec2f, 6>(
  vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0),
  vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0),
);

struct Out {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn glyph_vertex(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> Out {
  let g = glyphs[i];
  let corner = QUAD[v];
  // Rounded to whole pixels so text stays sharp.
  let at = round((anchor(g.segment) - text.center) * text.zoom + text.canvas * 0.5);
  let pixel = at + g.offset + corner * g.size;
  var out: Out;
  out.clip = vec4f(pixel.x / text.canvas.x * 2.0 - 1.0, 1.0 - pixel.y / text.canvas.y * 2.0, 0.0, 1.0);
  out.uv = mix(g.uv.xy, g.uv.zw, corner);
  return out;
}

fn median(c: vec3f) -> f32 {
  return max(min(c.r, c.g), min(max(c.r, c.g), c.b));
}

@fragment
fn glyph_fragment(in: Out) -> @location(0) vec4f {
  let distance = (median(textureSample(atlas, atlas_sampler, in.uv).rgb) - 0.5) * text.px_range;
  let ink = clamp(distance + 0.5, 0.0, 1.0);
  let halo = clamp(distance + HALO_PX + 0.5, 0.0, 1.0);
  let color = mix(text.halo.rgb, text.color.rgb, ink);
  let alpha = halo * mix(text.halo.a, text.color.a, ink);
  return vec4f(color * alpha, alpha);
}
