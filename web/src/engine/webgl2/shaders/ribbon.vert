// The ribbon piece this instance draws: from the visible list, or the
// instance itself when everything is in view.
in uint item;
uniform bool every_item;

// Pieces of a segment drawn as a dot, but its first, collapse to nothing, as do
// hidden segments: the WebGPU cull drops them.
void main() {
  uint index = every_item ? uint(gl_InstanceID) : item;
  uvec2 piece = texelFetch(pieces, texel(index), 0).xy;
  if (is_hidden(piece.y) || repeats_dot(piece)) {
    gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
    return;
  }
  place_piece(piece);
}
