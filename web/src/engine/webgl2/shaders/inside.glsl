in vec2 local;
flat in vec2 size;
flat in vec4 color;
flat in uint segment;
flat in float arrow;

// Signed distance inside the ribbon piece, as `inside` in graph.wgsl.
float inside() {
  vec2 nearest = vec2(clamp(local.x, 0.0, size.x), 0.0);
  float capsule = size.y - length(local - nearest);
  if (arrow == 0.0) {
    return capsule;
  }
  float to_tip = arrow > 0.0 ? size.x - local.x : local.x;
  return min(capsule, (to_tip - abs(local.y)) * 0.70710678);
}
