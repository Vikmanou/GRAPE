// Follows graph.wgsl in one module.

struct Band {
  @builtin(position) clip: vec4f,
  @location(0) local: vec2f,
  @location(1) @interpolate(flat) size: vec2f,
  @location(2) @interpolate(flat) color: vec4f,
  @location(3) @interpolate(flat) arrow: f32,
  // Where along the piece the band starts and ends.
  @location(4) @interpolate(flat) cut: vec2f,
}

// A search hit on one ribbon piece: the piece as drawn, cut flat where the hit
// starts or ends inside it, as Bandage draws its hits with Qt::FlatCap at the
// node's width (graph/graphicsitemnode.cpp). Double mode shows a hit on its
// own strand alone, single mode on the one ribbon, as Bandage does. Instances
// are `BAND_WORDS` words in engine/core/Bands.ts.
@vertex
fn band_vertex(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> Band {
  let at = i * 8u;
  let point = visible_pieces[at];
  let segment = visible_pieces[at + 1u];
  let from_t = bitcast<f32>(visible_pieces[at + 2u]);
  let to_t = bitcast<f32>(visible_pieces[at + 3u]);
  let reverse = visible_pieces[at + 5u] == 1u;
  var out: Band;
  let sprite = sprite_center(segment, style.sprite_px * view.world_per_pixel);
  let other_strand = (view.strand > 0.0 && reverse) || (view.strand < 0.0 && !reverse);
  // A segment drawn as a dot draws it once, from its first piece.
  let repeat_dot = sprite.z > 0.0 && point != field(START, segment);
  if is_hidden(segment) || other_strand || repeat_dot {
    out.clip = vec4f(2.0, 2.0, 0.0, 1.0);
    return out;
  }
  let piece = ribbon_piece(v, vec2u(point, segment));
  out.clip = piece.clip;
  out.local = piece.local;
  out.size = piece.size;
  out.color = unpack4x8unorm(visible_pieces[at + 4u]);
  out.arrow = piece.arrow;
  let open = 1e9;
  var from_x = select(from_t * piece.size.x, -open, from_t <= 0.0);
  var to_x = select(to_t * piece.size.x, open, to_t >= 1.0);
  // However far out the view, a hit stays at least this many pixels long.
  let shortest = view.world_per_pixel * 1.5;
  if to_x - from_x < shortest {
    let middle = 0.5 * (from_x + to_x);
    from_x = middle - shortest * 0.5;
    to_x = middle + shortest * 0.5;
  }
  out.cut = select(vec2f(from_x, to_x), vec2f(-open, open), piece.size.x <= 1e-6);
  return out;
}

@fragment
fn band_fragment(in: Band) -> @location(0) vec4f {
  let along = min(in.local.x - in.cut.x, in.cut.y - in.local.x);
  let alpha = coverage(min(inside_piece(in.local, in.size, in.arrow), along)) * in.color.a;
  if alpha <= 0.0 {
    discard;
  }
  return vec4f(in.color.rgb * alpha, alpha);
}
