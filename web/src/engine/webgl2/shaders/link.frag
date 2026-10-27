in float across_link;
flat in float half_width;

out vec4 fragment;

void main() {
  float alpha = coverage(half_width - abs(across_link)) * view.link_alpha * view.link_color.a;
  if (alpha <= 0.0) {
    discard;
  }
  fragment = vec4(view.link_color.rgb * alpha, alpha);
}
