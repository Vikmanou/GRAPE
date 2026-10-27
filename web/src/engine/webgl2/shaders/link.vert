in uint item;
uniform bool every_item;

out float across_link;
flat out float half_width;

const uint LINK_STEPS = 16u;

vec2 normalize_or(vec2 v, vec2 fallback) {
  float l = length(v);
  return l > 1e-6 ? v / l : fallback;
}

// As `controls` in graph.wgsl.
void controls(uvec4 link, out vec2 c0, out vec2 c1, out vec2 c2, out vec2 c3) {
  vec2 out_a = normalize_or(position(link.x) - position(link.y), vec2(1.0, 0.0));
  vec2 out_b = normalize_or(position(link.z) - position(link.w), vec2(-1.0, 0.0));
  float shift = view.strand * style.strand_shift;
  vec2 p0 = position(link.x) + left_of(out_a) * shift;
  vec2 p3 = position(link.z) - left_of(out_b) * shift;
  float gap = length(p3 - p0);
  float reach = max(gap * 0.4, view.ribbon_half * 6.0);
  c0 = p0;
  c3 = p3;
  if (gap < view.ribbon_half * 4.0) {
    vec2 side = vec2(-out_a.y, out_a.x);
    c1 = p0 + (out_a + side) * reach;
    c2 = p3 + (out_b - side) * reach;
  } else {
    c1 = p0 + out_a * reach;
    c2 = p3 + out_b * reach;
  }
}

void main() {
  uint index = every_item ? uint(gl_InstanceID) : item;
  vec2 c0, c1, c2, c3;
  controls(texelFetch(links, texel(index), 0), c0, c1, c2, c3);
  vec2 corner = quad(gl_VertexID);
  float t = (float(gl_VertexID / 6) + corner.x) / float(LINK_STEPS);
  float u = 1.0 - t;
  vec2 point = u * u * u * c0 + 3.0 * u * u * t * c1 + 3.0 * u * t * t * c2 + t * t * t * c3;
  vec2 tangent = normalize_or(3.0 * u * u * (c1 - c0) + 6.0 * u * t * (c2 - c1) + 3.0 * t * t * (c3 - c2), c3 - c0);
  half_width = max(view.link_half, view.world_per_pixel * 0.5);
  across_link = corner.y * (half_width + view.world_per_pixel);
  gl_Position = to_clip(point + vec2(-tangent.y, tangent.x) * across_link);
}
