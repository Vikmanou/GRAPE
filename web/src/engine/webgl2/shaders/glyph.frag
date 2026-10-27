uniform highp sampler2D atlas;
// Screen pixels per unit of the atlas's distance.
uniform float px_range;
uniform vec4 color;
uniform vec4 halo;

in vec2 uv;
out vec4 fragment;

// Pixels of background colour around each glyph, so labels read over ribbons.
const float HALO_PX = 1.0;

float median(vec3 c) {
  return max(min(c.r, c.g), min(max(c.r, c.g), c.b));
}

void main() {
  float distance = (median(texture(atlas, uv).rgb) - 0.5) * px_range;
  float ink = clamp(distance + 0.5, 0.0, 1.0);
  float edge = clamp(distance + HALO_PX + 0.5, 0.0, 1.0);
  vec3 rgb = mix(halo.rgb, color.rgb, ink);
  float alpha = edge * mix(halo.a, color.a, ink);
  fragment = vec4(rgb * alpha, alpha);
}
