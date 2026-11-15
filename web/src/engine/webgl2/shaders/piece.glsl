out vec2 local;
flat out vec2 size;
flat out vec4 color;
flat out uint segment;
flat out float arrow;
// Dimmed colours of the paths that stripe this ribbon, across its width, and how many.
flat out uvec4 stripes;
flat out uint stripe_count;

// Faded unselected segments keep this much of their colour.
const float DIMMED = 0.35;

// RGBA8 with red in the low byte; ES 3.0 has no packUnorm4x8.
uint pack_rgba(vec4 c) {
  uvec4 b = uvec4(round(clamp(c, 0.0, 1.0) * 255.0));
  return b.r | (b.g << 8u) | (b.b << 16u) | (b.a << 24u);
}

// Unselected segments fade into the background when dimming is on.
vec4 faded(vec4 c, uint segment) {
  if (style.dim == 1u && !is_selected(segment)) {
    return vec4(mix(unpack_rgba(style.dim_background).rgb, c.rgb, DIMMED), c.a);
  }
  return c;
}

// A segment drawn as a dot draws it once, from its first piece.
bool repeats_dot(uvec2 piece) {
  vec3 sprite = sprite_center(piece.y, style.sprite_px * view.world_per_pixel);
  return sprite.z > 0.0 && piece.x != field(START, piece.y);
}

// Each piece is a capsule cut from a quad by a signed distance, as
// `ribbon_piece` in graph.wgsl.
// Uniform Catmull-Rom through p1 and p2, as `catmull` in graph.wgsl.
vec2 catmull(vec2 p0, vec2 p1, vec2 p2, vec2 p3, float t) {
  return 0.5 * (2.0 * p1 + (p2 - p0) * t + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t * t + (3.0 * p1 - p0 - 3.0 * p2 + p3) * t * t * t);
}

// Sub-capsule `sub` of `steps` along the curve through the piece, as `ribbon_piece` in graph.wgsl.
void place_piece(uvec2 piece, uint sub, uint steps) {
  vec2 a = position(piece.x);
  vec2 b = position(piece.x + 1u);
  vec3 sprite = sprite_center(piece.y, style.sprite_px * view.world_per_pixel);
  float tip = 0.0;
  if (sprite.z > 0.0) {
    a = sprite.xy;
    b = sprite.xy;
  } else if (view.strand != 0.0) {
    uint start = field(START, piece.y);
    uint last = start + field(PIECES, piece.y);
    a = strand_point(piece.x, start, last);
    b = strand_point(piece.x + 1u, start, last);
    if (view.strand > 0.0 && piece.x + 1u == last) {
      tip = 1.0;
    } else if (view.strand < 0.0 && piece.x == start) {
      tip = -1.0;
    }
  }
  if (steps > 1u) {
    if (sprite.z > 0.0) {
      gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
      return;
    }
    uint start = field(START, piece.y);
    uint last = start + field(PIECES, piece.y);
    vec2 p0 = a - (b - a);
    vec2 p3 = b + (b - a);
    if (view.strand != 0.0) {
      if (piece.x > start) p0 = strand_point(piece.x - 1u, start, last);
      if (piece.x + 1u < last) p3 = strand_point(piece.x + 2u, start, last);
    } else {
      if (piece.x > start) p0 = position(piece.x - 1u);
      if (piece.x + 1u < last) p3 = position(piece.x + 2u);
    }
    vec2 from = catmull(p0, a, b, p3, float(sub) / float(steps));
    vec2 to = catmull(p0, a, b, p3, float(sub + 1u) / float(steps));
    if ((tip > 0.0 && sub + 1u < steps) || (tip < 0.0 && sub > 0u)) {
      tip = 0.0;
    }
    a = from;
    b = to;
  }
  float length_ab = length(b - a);
  vec2 along = length_ab > 1e-6 ? (b - a) / length_ab : vec2(1.0, 0.0);
  vec2 across = vec2(-along.y, along.x);
  float half_width = max(max(segment_half(piece.y), view.world_per_pixel * 0.5) + view.grow, 0.0);
  float pad = half_width + view.world_per_pixel;
  vec2 corner = quad(gl_VertexID);
  local = vec2(mix(-pad, length_ab + pad, corner.x), corner.y * pad);
  gl_Position = to_clip(a + along * local.x + across * local.y);
  size = vec2(length_ab, half_width);
  color = faded(segment_color(piece.y, view.strand), piece.y);
  stripes = uvec4(0u);
  stripe_count = 0u;
  // style.mode of the path colour mode: segment_color's default branch.
  if (style.mode == 7u) {
    for (uint k = 0u; k < 4u; k++) {
      uint stripe = field(8u + k, piece.y);
      if (stripe == 0u) {
        break;
      }
      stripes[k] = pack_rgba(faded(unpack_rgba(stripe), piece.y));
      stripe_count = k + 1u;
    }
  }
  segment = piece.y;
  arrow = tip;
}
