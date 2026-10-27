// Label glyphs placed in pixels around their segment's anchor, which follows
// the layout; a port of glyphs.wgsl.

uniform vec2 center;
uniform float zoom;
uniform vec2 canvas;
uniform uint segments;
uniform highp sampler2D positions;
uniform highp usampler2D segment_table;

// From the anchor to the quad's top left, and its size, in pixels.
in vec2 offset;
in vec2 size;
in vec4 uv_box;
in uint segment;

out vec2 uv;

const uint START = 6u;
const uint PIECES = 7u;

ivec2 texel(uint i) {
  return ivec2(int(i & 4095u), int(i >> 12u));
}

vec2 position(uint i) {
  return texelFetch(positions, texel(i), 0).xy;
}

// Mirrors `anchor` in labels.wgsl.
vec2 anchor(uint s) {
  uint start = texelFetch(segment_table, texel(START * segments + s), 0).x;
  uint count = texelFetch(segment_table, texel(PIECES * segments + s), 0).x;
  uint mid = start + count / 2u;
  return 0.5 * (position(mid) + position(mid + count % 2u));
}

void main() {
  int k = gl_VertexID % 6;
  vec2 corner = vec2((k == 1 || k == 4 || k == 5) ? 1.0 : 0.0, (k == 2 || k == 3 || k == 5) ? 1.0 : 0.0);
  // Rounded to whole pixels so text stays sharp.
  vec2 at = floor((anchor(segment) - center) * zoom + canvas * 0.5 + 0.5);
  vec2 pixel = at + offset + corner * size;
  gl_Position = vec4(pixel.x / canvas.x * 2.0 - 1.0, 1.0 - pixel.y / canvas.y * 2.0, 0.0, 1.0);
  uv = mix(uv_box.xy, uv_box.zw, corner);
}
