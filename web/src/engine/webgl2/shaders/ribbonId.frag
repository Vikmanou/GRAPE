out uint id;

// Segment id plus one, 0 where nothing is drawn; pixels whose centre lies
// inside the capsule count, with no antialiasing.
void main() {
  if (inside() < 0.0) {
    discard;
  }
  id = segment + 1u;
}
