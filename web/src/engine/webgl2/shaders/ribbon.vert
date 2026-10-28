// The ribbon piece this instance draws: from the visible list, or the
// instance itself when everything is in view.
in uint item;
uniform bool every_item;

out vec2 local;
flat out vec2 size;
flat out vec4 color;
flat out uint segment;
flat out float arrow;

// Faded unselected segments keep this much of their colour.
const float DIMMED = 0.25;

// Each piece is a capsule cut from a quad by a signed distance, as
// `ribbon_vertex` in graph.wgsl. Pieces of a segment drawn as a dot, but its
// first, collapse to nothing, as do hidden segments: the WebGPU cull drops them.
void main() {
  uint index = every_item ? uint(gl_InstanceID) : item;
  uvec2 piece = texelFetch(pieces, texel(index), 0).xy;
  if (is_hidden(piece.y)) {
    gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
    return;
  }
  vec2 a = position(piece.x);
  vec2 b = position(piece.x + 1u);
  vec3 sprite = sprite_center(piece.y, style.sprite_px * view.world_per_pixel);
  float tip = 0.0;
  if (sprite.z > 0.0) {
    if (piece.x != field(START, piece.y)) {
      gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
      return;
    }
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
