// 1 draws the selection or hover outline instead of the segment's colour.
uniform bool outlined;

out vec4 fragment;

void main() {
  vec4 c = outlined ? (segment == view.hover ? view.hover_outline : view.outline) : color;
  float alpha = coverage(inside()) * c.a;
  if (alpha <= 0.0) {
    discard;
  }
  fragment = vec4(c.rgb * alpha, alpha);
}
