//! Barnes-Hut quadtree (Barnes and Hut, Nature 324, 1986): a cell far enough
//! away acts as one mass at its centre of mass.

const NONE: u32 = u32::MAX;
/// Below this depth coincident points share a leaf instead of splitting forever.
const MAX_DEPTH: u32 = 24;

#[derive(Debug, Clone, Copy)]
struct Node {
    /// Centre of mass once built; the cell centre while building.
    x: f32,
    y: f32,
    half: f32,
    mass: f32,
    /// First of four consecutive children, or 0 for a leaf.
    child: u32,
    /// Head of the leaf's point list.
    point: u32,
}

/// Reused across iterations so building allocates nothing once warm.
#[derive(Debug, Default)]
pub struct QuadTree {
    nodes: Vec<Node>,
    /// Next point in the same leaf, by local index.
    next: Vec<u32>,
    stack: Vec<u32>,
}

impl QuadTree {
    pub fn build(&mut self, xs: &[f32], ys: &[f32]) {
        self.nodes.clear();
        self.next.clear();
        self.next.resize(xs.len(), NONE);
        let (mut x0, mut y0, mut x1, mut y1) = (f32::MAX, f32::MAX, f32::MIN, f32::MIN);
        for (&x, &y) in xs.iter().zip(ys) {
            x0 = x0.min(x);
            y0 = y0.min(y);
            x1 = x1.max(x);
            y1 = y1.max(y);
        }
        let half = ((x1 - x0).max(y1 - y0) * 0.5).max(1e-3) * 1.0001;
        self.nodes.push(Node {
            x: (x0 + x1) * 0.5,
            y: (y0 + y1) * 0.5,
            half,
            mass: 0.0,
            child: 0,
            point: NONE,
        });
        for i in 0..xs.len() as u32 {
            self.insert(i, xs, ys);
        }
        self.summarise(xs, ys);
    }

    fn insert(&mut self, i: u32, xs: &[f32], ys: &[f32]) {
        let (x, y) = (xs[i as usize], ys[i as usize]);
        let mut n = 0usize;
        let mut depth = 0;
        loop {
            let node = self.nodes[n];
            if node.child != 0 {
                n = node.child as usize + quadrant(&node, x, y);
                depth += 1;
                continue;
            }
            if node.point == NONE || depth >= MAX_DEPTH {
                self.next[i as usize] = node.point;
                self.nodes[n].point = i;
                return;
            }
            self.split(n);
            let old = node.point;
            let (ox, oy) = (xs[old as usize], ys[old as usize]);
            let child = self.nodes[n].child as usize + quadrant(&self.nodes[n], ox, oy);
            self.nodes[child].point = old;
            self.nodes[n].point = NONE;
        }
    }

    fn split(&mut self, n: usize) {
        let parent = self.nodes[n];
        let h = parent.half * 0.5;
        self.nodes[n].child = self.nodes.len() as u32;
        for q in 0..4 {
            self.nodes.push(Node {
                x: parent.x + if q & 1 == 0 { -h } else { h },
                y: parent.y + if q & 2 == 0 { -h } else { h },
                half: h,
                mass: 0.0,
                child: 0,
                point: NONE,
            });
        }
    }

    /// Children always sit after their parent, so one backward pass sums them.
    fn summarise(&mut self, xs: &[f32], ys: &[f32]) {
        for n in (0..self.nodes.len()).rev() {
            let node = self.nodes[n];
            let (mut mass, mut sx, mut sy) = (0.0f32, 0.0f32, 0.0f32);
            if node.child == 0 {
                let mut p = node.point;
                while p != NONE {
                    mass += 1.0;
                    sx += xs[p as usize];
                    sy += ys[p as usize];
                    p = self.next[p as usize];
                }
            } else {
                for c in node.child..node.child + 4 {
                    let child = &self.nodes[c as usize];
                    mass += child.mass;
                    sx += child.x * child.mass;
                    sy += child.y * child.mass;
                }
            }
            if mass > 0.0 {
                let node = &mut self.nodes[n];
                node.mass = mass;
                node.x = sx / mass;
                node.y = sy / mass;
            }
        }
    }

    /// Sum over all other points of `(p_i - p_j) / |p_i - p_j|^2`, the
    /// direction and falloff of a `1/d` repulsion.
    pub fn repulsion(&mut self, i: u32, xs: &[f32], ys: &[f32], theta: f32) -> (f32, f32) {
        let (x, y) = (xs[i as usize], ys[i as usize]);
        let theta2 = theta * theta;
        let (mut fx, mut fy) = (0.0f32, 0.0f32);
        self.stack.clear();
        self.stack.push(0);
        while let Some(n) = self.stack.pop() {
            let node = self.nodes[n as usize];
            if node.mass == 0.0 {
                continue;
            }
            if node.child == 0 {
                let mut p = node.point;
                while p != NONE {
                    if p != i {
                        let (dx, dy) = apart(x - xs[p as usize], y - ys[p as usize], i, p);
                        let d2 = dx * dx + dy * dy;
                        fx += dx / d2;
                        fy += dy / d2;
                    }
                    p = self.next[p as usize];
                }
                continue;
            }
            let (dx, dy) = (x - node.x, y - node.y);
            let d2 = dx * dx + dy * dy;
            let size = node.half * 2.0;
            if size * size < theta2 * d2 {
                fx += node.mass * dx / d2;
                fy += node.mass * dy / d2;
            } else {
                self.stack
                    .extend([node.child, node.child + 1, node.child + 2, node.child + 3]);
            }
        }
        (fx, fy)
    }
}

fn quadrant(node: &Node, x: f32, y: f32) -> usize {
    usize::from(x >= node.x) | usize::from(y >= node.y) << 1
}

/// Coincident points are pushed apart along a fixed direction picked from
/// their indices, so the result stays deterministic.
fn apart(dx: f32, dy: f32, i: u32, p: u32) -> (f32, f32) {
    const MIN: f32 = 1e-2;
    if dx * dx + dy * dy >= MIN * MIN {
        return (dx, dy);
    }
    let sign = if i < p { -MIN } else { MIN };
    (sign, sign * 0.5)
}

/// Exact `O(n^2)` sum, the reference the tree is tested against.
pub fn brute_force(i: u32, xs: &[f32], ys: &[f32]) -> (f32, f32) {
    let (x, y) = (xs[i as usize], ys[i as usize]);
    let (mut fx, mut fy) = (0.0f32, 0.0f32);
    for p in 0..xs.len() as u32 {
        if p != i {
            let (dx, dy) = apart(x - xs[p as usize], y - ys[p as usize], i, p);
            let d2 = dx * dx + dy * dy;
            fx += dx / d2;
            fy += dy / d2;
        }
    }
    (fx, fy)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layout::rng::Rng;
    use proptest::prelude::*;

    #[test]
    fn coincident_points_share_a_leaf() {
        let xs = vec![1.0; 50];
        let ys = vec![2.0; 50];
        let mut tree = QuadTree::default();
        tree.build(&xs, &ys);
        assert_eq!(tree.nodes[0].mass, 50.0);
        let (fx, fy) = tree.repulsion(0, &xs, &ys, 0.8);
        assert!(fx.is_finite() && fy.is_finite());
    }

    proptest! {
        #[test]
        fn tree_matches_brute_force(seed: u64, n in 2usize..400) {
            let mut rng = Rng::new(seed);
            let xs: Vec<f32> = (0..n).map(|_| rng.next_f32() * 1000.0).collect();
            let ys: Vec<f32> = (0..n).map(|_| rng.next_f32() * 1000.0).collect();
            let mut tree = QuadTree::default();
            tree.build(&xs, &ys);
            // With theta 0 every cell is opened, so only rounding differs.
            let (mut err, mut norm) = (0.0f32, 0.0f32);
            for i in 0..n as u32 {
                let exact = brute_force(i, &xs, &ys);
                let opened = tree.repulsion(i, &xs, &ys, 0.0);
                err += (exact.0 - opened.0).hypot(exact.1 - opened.1);
                norm += exact.0.hypot(exact.1);
            }
            prop_assert!(err <= norm * 1e-3, "error {err} of {norm}");
            // Barnes-Hut's usual theta keeps the error to a few percent.
            let (mut err, mut norm) = (0.0f32, 0.0f32);
            for i in 0..n as u32 {
                let exact = brute_force(i, &xs, &ys);
                let approx = tree.repulsion(i, &xs, &ys, 0.8);
                err += (exact.0 - approx.0).hypot(exact.1 - approx.1);
                norm += exact.0.hypot(exact.1);
            }
            prop_assert!(err <= norm * 0.1, "error {err} of {norm}");
        }
    }
}
