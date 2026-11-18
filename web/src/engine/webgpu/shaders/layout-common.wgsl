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
  tail_mask: u32,
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

// Far cells are square blocks of whole coarse cells, in `TAIL_TIERS` tiers:
// a tier 1 cell holds `TAIL_PER_COARSE` coarse cells on a side, a tier 2 cell
// the same many tier 1 cells, and so on. The tiers share one table, salted by
// tier. Both constants are in level.ts too.
const TAIL_PER_COARSE = 3;
const TAIL_TIERS = 3u;
// Probes before giving up on a slot: a table full of one-node components
// loses far cells instead of walking all of it.
const TAIL_PROBES = 64u;

fn floor_div(a: i32, b: i32) -> i32 {
  let q = a / b;
  return select(q, q - 1, a % b != 0 && a < 0);
}

// Coarse cells on a side of a far cell.
fn tail_span(tier: u32) -> i32 {
  var span = 1;
  for (var k = 0u; k < tier; k++) {
    span *= TAIL_PER_COARSE;
  }
  return span;
}

// The cell one tier up that holds this one.
fn next_tier(cell: vec2i) -> vec2i {
  return vec2i(floor_div(cell.x, TAIL_PER_COARSE), floor_div(cell.y, TAIL_PER_COARSE));
}

fn tail_of(coarse: vec2i, tier: u32) -> vec2i {
  let span = tail_span(tier);
  return vec2i(floor_div(coarse.x, span), floor_div(coarse.y, span));
}

fn tail_size(tier: u32) -> f32 {
  return params.coarse_cell * f32(tail_span(tier));
}

// Where a node sits inside its far cell, in fixed point.
fn tail_offset(p: vec2f, tail: vec2i, tier: u32) -> vec2i {
  let size = tail_size(tier);
  return vec2i((p - vec2f(tail) * size) / size * FIXED);
}

fn tail_group(component: u32, tier: u32) -> u32 {
  return component ^ (tier * 0x9e3779b1u);
}

// Where a node sits inside its coarse cell, in fixed point.
fn fixed_offset(p: vec2f, coarse: vec2i) -> vec2i {
  return vec2i((p - vec2f(coarse) * params.coarse_cell) / params.coarse_cell * FIXED);
}
