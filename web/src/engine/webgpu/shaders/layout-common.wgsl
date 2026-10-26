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

// Each coordinate times its own prime (as in Teschner et al., "Optimized
// Spatial Hashing for Collision Detection of Deformable Objects", 2003), but
// summed rather than xored: xored products of small coordinates collide
// often. Mixed once so the low bits a mask keeps are good.
fn cell_hash(component: u32, cell: vec2i) -> u32 {
  return mix32(bitcast<u32>(cell.x) * 73856093u + bitcast<u32>(cell.y) * 19349663u + component * 83492791u);
}

// Tells apart cells whose probes meet in the coarse table; never 0, which
// marks an empty slot.
fn cell_key(component: u32, cell: vec2i) -> u32 {
  return mix32(bitcast<u32>(cell.x) * 2654435761u + bitcast<u32>(cell.y) * 2246822519u + component * 3266489917u) | 1u;
}

fn cell_of(p: vec2f, size: f32) -> vec2i {
  return vec2i(floor(p / size));
}

// Coarse cells are square blocks of whole fine cells.
fn coarse_of(fine: vec2i) -> vec2i {
  return vec2i(floor(vec2f(fine) / round(params.coarse_cell / params.cell)));
}

// Where a node sits inside its coarse cell, in fixed point.
fn fixed_offset(p: vec2f, coarse: vec2i) -> vec2i {
  return vec2i((p - vec2f(coarse) * params.coarse_cell) / params.coarse_cell * FIXED);
}
