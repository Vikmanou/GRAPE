out vec2 local;
flat out vec2 size;
flat out vec4 color;
flat out uint segment;
flat out float arrow;

// Faded unselected segments keep this much of their colour.
const float DIMMED = 0.25;

// A segment drawn as a dot draws it once, from its first piece.
bool repeats_dot(uvec2 piece) {
  vec3 sprite = sprite_center(piece.y, style.sprite_px * view.world_per_pixel);
  return sprite.z > 0.0 && piece.x != field(START, piece.y);
}

// Each piece is a capsule cut from a quad by a signed distance, as
// `ribbon_piece` in graph.wgsl.
void place_piece(uvec2 piece) {
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
  float length_ab = length(b - a);
  vec2 along = length_ab > 1e-6 ? (b - a) / length_ab : vec2(1.0, 0.0);
  vec2 across = vec2(-along.y, along.x);
  float half_width = max(max(segment_half(piece.y), view.world_per_pixel * 0.5) + view.grow, 0.0);
  float pad = half_width + view.world_per_pixel;
  vec2 corner = quad(gl_VertexID);
  local = vec2(mix(-pad, length_ab + pad, corner.x), corner.y * pad);
  gl_Position = to_clip(a + along * local.x + across * local.y);
  size = vec2(length_ab, half_width);
  vec4 c = segment_color(piece.y, view.strand);
  if (style.dim == 1u && !is_selected(piece.y)) {
    c.a *= DIMMED;
  }
  color = c;
  segment = piece.y;
  arrow = tip;
}
