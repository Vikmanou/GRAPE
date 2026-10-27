// Label placement: every segment with a label in view claims the screen grid
// cells its label box covers with an atomic max of its priority, then keeps
// its label only if it won every one of them. Winners never overlap, and
// the result does not depend on the order threads run in.

struct Place {
  // World to pixels: (world - center) * scale + half the canvas.
  center: vec2f,
  scale: vec2f,
  canvas: vec2f,
  // Label box per character and per line, in pixels.
  advance: f32,
  line_height: f32,
  cell: f32,
  columns: u32,
  rows: u32,
  segments: u32,
  capacity: u32,
}

@group(0) @binding(0) var<uniform> place: Place;
@group(0) @binding(1) var<storage, read> positions: array<vec2f>;
// The segment table of graph.wgsl.
@group(0) @binding(2) var<storage, read> segment_table: array<u32>;
// Per segment: its rank, 0 placing first, then its label's longest line in
// characters and its line count, `chars | lines << 16`; 0 for no label.
@group(0) @binding(3) var<storage, read> label_sizes: array<u32>;
@group(0) @binding(4) var<storage, read_write> cells: array<atomic<u32>>;
// The number of winners, then their segment ids.
@group(0) @binding(5) var<storage, read_write> winners: array<atomic<u32>>;

const START = 6u;
const PIECES = 7u;

// The midpoint of a segment's chain, where its label sits; mirrors
// `sprite_center` in graph.wgsl.
fn anchor(segment: u32) -> vec2f {
  let start = segment_table[START * place.segments + segment];
  let pieces = segment_table[PIECES * place.segments + segment];
  let mid = start + pieces / 2u;
  return 0.5 * (positions[mid] + positions[mid + pieces % 2u]);
}

struct Cells {
  lo: vec2u,
  hi: vec2u,
  // 0 for no label in view.
  key: u32,
}

fn cells_of(segment: u32) -> Cells {
  var out: Cells;
  out.key = 0u;
  let size = label_sizes[place.segments + segment];
  if size == 0u {
    return out;
  }
  let at = (anchor(segment) - place.center) * place.scale + place.canvas * 0.5;
  let half = vec2f(f32(size & 0xffffu) * place.advance, f32(size >> 16u) * place.line_height) * 0.5;
  let lo = at - half;
  let hi = at + half;
  if any(hi < vec2f(0.0)) || any(lo >= place.canvas) {
    return out;
  }
  let last = vec2f(f32(place.columns - 1u), f32(place.rows - 1u));
  out.lo = vec2u(clamp(floor(lo / place.cell), vec2f(0.0), last));
  out.hi = vec2u(clamp(floor(hi / place.cell), vec2f(0.0), last));
  out.key = 0xffffffffu - label_sizes[segment];
  return out;
}

@compute @workgroup_size(256)
fn claim_cells(@builtin(global_invocation_id) id: vec3u) {
  if id.x >= place.segments {
    return;
  }
  let c = cells_of(id.x);
  if c.key == 0u {
    return;
  }
  for (var y = c.lo.y; y <= c.hi.y; y++) {
    for (var x = c.lo.x; x <= c.hi.x; x++) {
      atomicMax(&cells[y * place.columns + x], c.key);
    }
  }
}

@compute @workgroup_size(256)
fn keep_winners(@builtin(global_invocation_id) id: vec3u) {
  if id.x >= place.segments {
    return;
  }
  let c = cells_of(id.x);
  if c.key == 0u {
    return;
  }
  for (var y = c.lo.y; y <= c.hi.y; y++) {
    for (var x = c.lo.x; x <= c.hi.x; x++) {
      if atomicLoad(&cells[y * place.columns + x]) != c.key {
        return;
      }
    }
  }
  let slot = atomicAdd(&winners[0], 1u);
  if slot < place.capacity {
    atomicStore(&winners[slot + 1u], id.x);
  }
}
