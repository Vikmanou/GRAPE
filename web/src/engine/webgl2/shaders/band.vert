// Search hits, two texels per instance: `point, segment, from, to`, then
// `colour, reverse`. As `band_vertex` in graph.wgsl.
uniform highp usampler2D bands;

flat out vec4 band_color;
// Where along the piece the band starts and ends.
flat out vec2 cut;

void main() {
  uint at = uint(gl_InstanceID) * 2u;
  uvec4 first = texelFetch(bands, texel(at), 0);
  uvec4 second = texelFetch(bands, texel(at + 1u), 0);
  uvec2 piece = first.xy;
  bool reverse = second.y == 1u;
  bool other_strand = (view.strand > 0.0 && reverse) || (view.strand < 0.0 && !reverse);
  if (is_hidden(piece.y) || other_strand || repeats_dot(piece)) {
    gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
    return;
  }
  place_piece(piece);
  band_color = unpack_rgba(second.x);
  float from_t = uintBitsToFloat(first.z);
  float to_t = uintBitsToFloat(first.w);
  const float open_end = 1e9;
  float from_x = from_t <= 0.0 ? -open_end : from_t * size.x;
  float to_x = to_t >= 1.0 ? open_end : to_t * size.x;
  // However far out the view, a hit stays at least this many pixels long.
  float shortest = view.world_per_pixel * 1.5;
  if (to_x - from_x < shortest) {
    float middle = 0.5 * (from_x + to_x);
    from_x = middle - shortest * 0.5;
    to_x = middle + shortest * 0.5;
  }
  cut = size.x <= 1e-6 ? vec2(-open_end, open_end) : vec2(from_x, to_x);
}
