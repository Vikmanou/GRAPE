flat in vec4 band_color;
flat in vec2 cut;

out vec4 fragment;

void main() {
  float along = min(local.x - cut.x, cut.y - local.x);
  float d = min(inside(), along);
  float alpha = coverage(d) * band_color.a;
  if (alpha <= 0.0) {
    discard;
  }
  // A 1 pixel edge in the link colour, which contrasts with the background, so a band reads against ribbons of its own hue.
  vec3 rgb = d < view.world_per_pixel ? view.link_color.rgb : band_color.rgb;
  fragment = vec4(rgb * alpha, alpha);
}
