use super::level::Level;
use super::quadtree::QuadTree;

const THETA: f32 = 0.8;
/// Scales `k^2 / d` repulsion, `k` being the level's mean rest length. It
/// ignores node mass: mass-weighted repulsion crossed coarse edges that
/// finer levels could not uncross.
const REPULSION: f32 = 0.25;

pub(crate) fn repulsion(level: &Level) -> f32 {
    let k = level.mean_rest();
    k * k * REPULSION
}

#[derive(Debug, Default)]
pub(crate) struct Forces {
    fx: Vec<f32>,
    fy: Vec<f32>,
    step: Vec<f32>,
    k2: f32,
    tree: QuadTree,
}

impl Forces {
    pub fn prepare(&mut self, level: &Level) {
        let n = level.len();
        self.fx.resize(n, 0.0);
        self.fy.resize(n, 0.0);
        self.step = level.step_sizes();
        self.k2 = repulsion(level);
    }

    /// A component whose temperature is zero is skipped.
    pub fn iterate(&mut self, level: &Level, temperature: &[f32], xs: &mut [f32], ys: &mut [f32]) {
        let starts = &level.component_start;
        for (c, &t) in temperature.iter().enumerate() {
            if t == 0.0 {
                continue;
            }
            let range = starts[c] as usize..starts[c + 1] as usize;
            let (cx, cy) = (&xs[range.clone()], &ys[range.clone()]);
            self.tree.build(cx, cy);
            for i in 0..range.len() {
                let (rx, ry) = self.tree.repulsion(i as u32, cx, cy, THETA);
                self.fx[range.start + i] = rx * self.k2;
                self.fy[range.start + i] = ry * self.k2;
            }
        }

        let s = &level.springs;
        for e in 0..s.len() {
            let (a, b) = (s.a[e] as usize, s.b[e] as usize);
            let (dx, dy) = (xs[b] - xs[a], ys[b] - ys[a]);
            let d = dx.hypot(dy).max(1e-6);
            // Quadratic beyond the rest length, like Fruchterman-Reingold's
            // d^2 / k, so repulsion summed over long chains cannot overstretch links.
            let pull = s.weight[e] * (d - s.rest[e]) / d * (d / s.rest[e]).max(1.0);
            self.fx[a] += dx * pull;
            self.fy[a] += dy * pull;
            self.fx[b] -= dx * pull;
            self.fy[b] -= dy * pull;
        }

        for (c, &t) in temperature.iter().enumerate() {
            if t == 0.0 {
                continue;
            }
            for p in starts[c] as usize..starts[c + 1] as usize {
                let (mut dx, mut dy) = (self.fx[p] * self.step[p], self.fy[p] * self.step[p]);
                let d = dx.hypot(dy);
                if d > t {
                    dx *= t / d;
                    dy *= t / d;
                }
                xs[p] += dx;
                ys[p] += dy;
            }
        }
    }
}
