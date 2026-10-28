// Shared by the graph shaders, a port of graph.wgsl. WebGL2 has no storage
// buffers, so per-point and per-segment arrays are textures 4096 texels wide,
// read with texelFetch. Positions arrive relative to an origin near the
// camera, so float maths stays precise however large the layout is.

layout(std140) uniform ViewBlock {
  vec2 center;
  // World to clip space: zoom * 2 / viewport, with y flipped.
  vec2 scale;
  float world_per_pixel;
  float ribbon_half;
  float link_half;
  float link_alpha;
  vec4 link_color;
  vec4 outline;
  vec4 hover_outline;
  // Added to the ribbon's half width by the highlight passes.
  float grow;
  uint hover;
  // 0 in single mode; 1 or -1 for the strand double mode draws.
  float strand;
} view;

layout(std140) uniform StyleBlock {
  // Index into COLOR_MODES (engine/style/display.ts).
  uint mode;
  uint log_scale;
  float range_lo;
  float range_hi;
  uint random_start;
  uint segments;
  uint width_by_depth;
  float mean_depth;
  uint uniform_color;
  uint unknown_color;
  uint no_tag_color;
  uint dim;
  float sprite_px;
  float strand_shift;
  uint uniform_reverse_color;
  // 256 RGBA8 colours, four to an entry.
  uvec4 ramp[64];
} style;

uniform highp sampler2D positions;
// First point and segment of each ribbon piece.
uniform highp usampler2D pieces;
// Runs of one u32 per segment, in the order of FIELDS in engine/style/uniforms.ts.
uniform highp usampler2D segment_table;
// End and inner point of each side of each link.
uniform highp usampler2D links;
// One bit per selected segment, then per hidden segment, then per hidden link.
uniform highp usampler2D selected;

const uint DEPTH = 0u;
const uint GC = 1u;
const uint LENGTH = 2u;
const uint COMPONENT = 3u;
const uint TAG = 4u;
const uint TAG2 = 5u;
const uint START = 6u;
const uint PIECES = 7u;
const uint PATH = 8u;

ivec2 texel(uint i) {
  return ivec2(int(i & 4095u), int(i >> 12u));
}

vec2 position(uint i) {
  return texelFetch(positions, texel(i), 0).xy;
}

uint field(uint f, uint segment) {
  return texelFetch(segment_table, texel(f * style.segments + segment), 0).x;
}

bool flag_bit(uint word, uint i) {
  return ((texelFetch(selected, texel(word + (i >> 5u)), 0).x >> (i & 31u)) & 1u) == 1u;
}

bool is_selected(uint segment) {
  return flag_bit(0u, segment);
}

// The selection's words are followed by one bit per hidden segment, then
// one per hidden link, as `flags` in cull.wgsl.
uint segment_words() {
  return (style.segments + 31u) / 32u;
}

bool is_hidden(uint segment) {
  return flag_bit(segment_words(), segment);
}

bool link_hidden(uint link) {
  return flag_bit(2u * segment_words(), link);
}

vec4 unpack_rgba(uint c) {
  return vec4(float(c & 255u), float((c >> 8u) & 255u), float((c >> 16u) & 255u), float(c >> 24u)) / 255.0;
}

// The bit pattern of a float NaN; `x != x` may be optimised away.
bool is_nan(uint bits) {
  return (bits & 0x7f800000u) == 0x7f800000u && (bits & 0x7fffffu) != 0u;
}

// Mirrors engine/style/colors.ts, the reference the tests check against.
vec3 hsl(float h, float s, float l) {
  float a = s * min(l, 1.0 - l);
  vec3 k = mod(vec3(0.0, 8.0, 4.0) + h * 12.0, 12.0);
  return l - a * clamp(min(k - 3.0, 9.0 - k), vec3(-1.0), vec3(1.0));
}

// Bandage's random colours, as `golden_color` in graph.wgsl.
vec4 golden_color(uint start, uint i, float strand) {
  float hue = float(start + i * 0x9e3779b9u) / 4294967296.0;
  float lightness = (strand < 0.0 ? 90.0 : 150.0) / 255.0;
  return vec4(hsl(hue, 127.0 / 255.0, lightness), 1.0);
}

vec4 ramped(uint bits, bool is_float) {
  if (is_float && is_nan(bits)) {
    return unpack_rgba(style.unknown_color);
  }
  float v = is_float ? uintBitsToFloat(bits) : float(bits);
  if (style.log_scale == 1u) {
    v = log(max(v, 1e-30));
  }
  float span = style.range_hi - style.range_lo;
  float t = span > 0.0 ? clamp((v - style.range_lo) / span, 0.0, 1.0) : 0.0;
  uint i = min(uint(floor(t * 256.0)), 255u);
  return unpack_rgba(style.ramp[i / 4u][i % 4u]);
}

// Bandage's `getCustomColourForDisplay`; 0 means no tag.
vec4 tag_color(uint segment, float strand) {
  uint forward = field(TAG, segment);
  uint reverse = field(TAG2, segment);
  uint tag = strand < 0.0 ? reverse : forward;
  if (strand == 0.0 && tag == 0u) {
    tag = reverse;
  }
  return unpack_rgba(tag == 0u ? style.no_tag_color : tag);
}

vec4 segment_color(uint segment, float strand) {
  switch (style.mode) {
    case 0u:
      return unpack_rgba(strand < 0.0 ? style.uniform_reverse_color : style.uniform_color);
    case 1u:
      return golden_color(style.random_start, segment, strand);
    case 2u:
      return ramped(field(DEPTH, segment), true);
    case 3u:
      return ramped(field(GC, segment), true);
    case 4u:
      return ramped(field(LENGTH, segment), false);
    case 5u:
      return golden_color(0u, field(COMPONENT, segment), strand);
    case 6u:
      return tag_color(segment, strand);
    default: {
      uint path = field(PATH, segment);
      return unpack_rgba(path == 0u ? style.no_tag_color : path);
    }
  }
}

// Bandage's `getNodeWidth`, as `ribbon_half` in graph.wgsl.
float segment_half(uint segment) {
  uint bits = field(DEPTH, segment);
  float depth = uintBitsToFloat(bits);
  if (style.width_by_depth == 0u || is_nan(bits) || !(style.mean_depth > 0.0)) {
    return view.ribbon_half;
  }
  float relative = (sqrt(max(depth / style.mean_depth, 0.0)) - 1.0) * 0.5 + 1.0;
  return view.ribbon_half * clamp(relative, 0.5, 4.0);
}

// Where a segment shorter than `sprite_world` draws its dot; z is 1 when it does.
vec3 sprite_center(uint segment, float sprite_world) {
  uint start = field(START, segment);
  uint count = field(PIECES, segment);
  uint mid = start + count / 2u;
  vec2 m = position(mid);
  float extent = max(length(m - position(start)), length(position(start + count) - m));
  vec2 center = 0.5 * (m + position(mid + count % 2u));
  return vec3(center, extent < sprite_world ? 1.0 : 0.0);
}

// Bandage's left normal of a direction, (dy, -dx) in its y-down coordinates.
vec2 left_of(vec2 direction) {
  float l = length(direction);
  return l > 1e-6 ? vec2(direction.y, -direction.x) / l : vec2(0.0);
}

// As `strand_point` in graph.wgsl.
vec2 strand_point(uint i, uint start, uint last) {
  vec2 before = position(i == start ? i : i - 1u);
  vec2 after = position(i == last ? i : i + 1u);
  return position(i) + left_of(after - before) * view.strand * style.strand_shift;
}

vec4 to_clip(vec2 world) {
  return vec4((world - view.center) * view.scale, 0.0, 1.0);
}

float coverage(float inside) {
  return clamp(inside / view.world_per_pixel + 0.5, 0.0, 1.0);
}

// x along, y across; two triangles.
vec2 quad(int v) {
  int k = v % 6;
  float x = (k == 1 || k == 4 || k == 5) ? 1.0 : 0.0;
  float y = (k == 2 || k == 3 || k == 5) ? 1.0 : -1.0;
  return vec2(x, y);
}
