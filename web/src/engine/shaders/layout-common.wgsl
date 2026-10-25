// Shared by every layout kernel.

// Fixed for a level.
struct Params {
  count: u32,
  fine_mask: u32,
  coarse_mask: u32,
  seed: u32,
  cell: f32,
  coarse_cell: f32,
  repulsion: f32,
  iterations: u32,
}

// component, step size bits, first edge, end edge
alias Node = vec4u;

const WORKGROUP = 256u;
// Coarse cell sums are fixed point, so they add up the same in any order.
const FIXED = 1024.0;

// murmur3's finaliser (Appleby, MurmurHash3, public domain).
fn mix32(x: u32) -> u32 {
  var h = x;
  h ^= h >> 16u;
  h *= 0x85ebca6bu;
  h ^= h >> 13u;
  h *= 0xc2b2ae35u;
  h ^= h >> 16u;
  return h;
}

fn cell_hash(component: u32, cell: vec2i) -> u32 {
  return mix32((component * 0x9e3779b1u) ^ mix32((bitcast<u32>(cell.x) * 0x85ebca77u) ^ bitcast<u32>(cell.y)));
}

fn cell_of(p: vec2f, size: f32) -> vec2i {
  return vec2i(floor(p / size));
}
