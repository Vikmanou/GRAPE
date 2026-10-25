// Exclusive prefix sum in blocks of 512 (Blelloch, "Prefix Sums and Their
// Applications", 1990); block totals go to `sums` for the next round.

@group(0) @binding(0) var<storage, read_write> data: array<u32>;
@group(0) @binding(1) var<storage, read_write> sums: array<u32>;
// x: values to scan; y: 1 when `scan_blocks` gives the final values, 2 when
// `add_sums` does, so that pass also writes them to `mirror`.
@group(0) @binding(2) var<uniform> length: vec4u;
@group(0) @binding(3) var<storage, read_write> mirror: array<u32>;

const BLOCK = 512u;

var<workgroup> tree: array<u32, 512>;

@compute @workgroup_size(256)
fn scan_blocks(@builtin(local_invocation_index) t: u32, @builtin(workgroup_id) group: vec3u) {
  let base = group.x * BLOCK;
  let n = length.x;
  for (var k = 0u; k < 2u; k++) {
    let i = base + t * 2u + k;
    tree[t * 2u + k] = select(0u, data[min(i, n - 1u)], i < n);
  }
  var offset = 1u;
  for (var d = BLOCK / 2u; d > 0u; d >>= 1u) {
    workgroupBarrier();
    if (t < d) {
      tree[offset * (2u * t + 2u) - 1u] += tree[offset * (2u * t + 1u) - 1u];
    }
    offset <<= 1u;
  }
  workgroupBarrier();
  let total = tree[BLOCK - 1u];
  workgroupBarrier();
  if (t == 0u) {
    tree[BLOCK - 1u] = 0u;
    sums[group.x] = total;
  }
  for (var d = 1u; d < BLOCK; d <<= 1u) {
    offset >>= 1u;
    workgroupBarrier();
    if (t < d) {
      let a = offset * (2u * t + 1u) - 1u;
      let b = offset * (2u * t + 2u) - 1u;
      let left = tree[a];
      tree[a] = tree[b];
      tree[b] += left;
    }
  }
  workgroupBarrier();
  for (var k = 0u; k < 2u; k++) {
    let i = base + t * 2u + k;
    if (i < n) {
      data[i] = tree[t * 2u + k];
      if (length.y == 1u) {
        mirror[i] = tree[t * 2u + k];
      }
    }
  }
}

@compute @workgroup_size(256)
fn add_sums(@builtin(local_invocation_index) t: u32, @builtin(workgroup_id) group: vec3u) {
  let n = length.x;
  for (var k = 0u; k < 2u; k++) {
    let i = group.x * BLOCK + t * 2u + k;
    if (i < n) {
      data[i] += sums[group.x];
      if (length.y == 2u) {
        mirror[i] = data[i];
      }
    }
  }
}
