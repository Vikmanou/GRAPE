flat in vec4 band_color;
flat in vec2 cut;

out vec4 fragment;

void main() {
  float along = min(local.x - cut.x, cut.y - local.x);
  float alpha = coverage(min(inside(), along)) * band_color.a;
  if (alpha <= 0.0) {
    discard;
  }
  fragment = vec4(band_color.rgb * alpha, alpha);
}
