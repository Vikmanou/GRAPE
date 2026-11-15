// 0 draws the segment's colour; 1 and 2 draw the outer and the inner ring of the selection or hover outline.
uniform int ring;

out vec4 fragment;

void main() {
  vec4 selected = ring == 1 ? view.outline : view.outline_inner;
  vec4 c = ring > 0 ? (segment == view.hover ? view.hover_outline : selected) : color;
  float alpha = coverage(inside()) * c.a;
  if (alpha <= 0.0) {
    discard;
  }
  fragment = vec4(c.rgb * alpha, alpha);
}
