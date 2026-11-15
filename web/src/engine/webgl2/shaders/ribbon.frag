// 0 draws the segment's colour; 1 and 2 draw the outer and the inner ring of the selection or hover outline.
uniform int ring;

flat in uvec4 stripes;
flat in uint stripe_count;

out vec4 fragment;

void main() {
  vec4 selected = ring == 1 ? view.outline : view.outline_inner;
  vec4 plain = color;
  if (stripe_count > 1u) {
    // One stripe per highlighted path, side by side across the width.
    float across = clamp(local.y / size.y * 0.5 + 0.5, 0.0, 0.9999);
    plain = unpack_rgba(stripes[uint(across * float(stripe_count))]);
  }
  vec4 c = ring > 0 ? (segment == view.hover ? view.hover_outline : selected) : plain;
  float alpha = coverage(inside()) * c.a;
  if (alpha <= 0.0) {
    discard;
  }
  fragment = vec4(c.rgb * alpha, alpha);
}
