//! CPU reference layout, multilevel as the spec describes: coarsen by
//! heavy-edge matching, settle the coarsest level from a seeded random
//! start, then split back level by level with fewer iterations each. Forces
//! use Barnes-Hut repulsion inside each component; components are packed
//! apart at the end. It is the correctness reference for the GPU layout and
//! the layout of the WebGL2 fallback.

mod force;
mod level;
mod pack;
mod points;
mod quadtree;
mod quality;
pub mod rng;
mod topology;

pub use pack::{Rect, rows, skyline};
pub use points::{
    Chains, Springs, drawn_length, drawn_per_base, link_geometry, link_points, pieces,
};
pub use quadtree::{QuadTree, brute_force};
pub use quality::{Quality, measure};
pub use topology::{Topology, TopologyError};

use force::Forces;
use level::{Level, NONE, Split};
use pack::pack_components;
use points::NODE_SEGMENT_LENGTH;
use rng::Rng;

/// Room kept around each component for ribbon width.
const MARGIN: f32 = 5.0;
/// Coarsening stops once the largest component has this few nodes.
const COARSEST: usize = 8;
/// Final temperature, in drawn units.
const COLD: f32 = 0.4;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LayoutOptions {
    pub seed: u64,
    /// Iterations on the coarsest level.
    pub iterations: u32,
    /// Iterations on each finer level.
    pub refine_iterations: u32,
    pub max_pieces: u8,
}

impl Default for LayoutOptions {
    fn default() -> Self {
        Self {
            seed: 1,
            iterations: 500,
            refine_iterations: 50,
            max_pieces: 50,
        }
    }
}

pub struct Layout {
    pub chains: Chains,
    options: LayoutOptions,
    /// Level 0 is the full set of points; each next level is coarser.
    levels: Vec<Level>,
    /// `splits[l]` turns level `l + 1` back into level `l`.
    splits: Vec<Split>,
    /// Springs before this one run along segments, the rest are links.
    first_link: usize,
    /// Components that are one unlinked segment.
    frozen: Vec<bool>,
    level: usize,
    level_iteration: u32,
    iteration: u32,
    /// Positions on the current level.
    xs: Vec<f32>,
    ys: Vec<f32>,
    /// Starting temperature per component on the current level.
    heat: Vec<f32>,
    forces: Forces,
}

impl Layout {
    pub fn new(t: Topology, options: LayoutOptions) -> Result<Self, TopologyError> {
        t.validate()?;
        let chains = Chains::build(&t, options.max_pieces);
        let springs = Springs::build(&t, &chains);
        let points = chains.points();
        let components = t.component_count();
        let mut component = vec![0u32; points];
        for c in 0..components {
            component[chains.component_start[c] as usize..chains.component_start[c + 1] as usize]
                .fill(c as u32);
        }
        // Springs along segments come first, then links. A component with
        // no link is one straight segment and skips the force pass.
        let first_link: usize = chains.pieces.iter().map(|&p| usize::from(p)).sum();
        let mut frozen = vec![true; components];
        for &a in &springs.a[first_link..] {
            frozen[component[a as usize] as usize] = false;
        }

        let mut levels = vec![Level {
            mass: vec![1.0; points],
            span: vec![0.0; points],
            component_start: chains.component_start.clone(),
            component,
            springs,
        }];
        let mut splits = Vec::new();
        let mut rng = Rng::new(options.seed);
        while largest_active(&levels[levels.len() - 1], &frozen) > COARSEST {
            let Some((coarse, split)) = levels[levels.len() - 1].coarsen(&frozen, &mut rng) else {
                break;
            };
            levels.push(coarse);
            splits.push(split);
        }

        let mut layout = Self {
            chains,
            options,
            level: levels.len() - 1,
            levels,
            splits,
            first_link,
            frozen,
            level_iteration: 0,
            iteration: 0,
            xs: Vec::new(),
            ys: Vec::new(),
            heat: Vec::new(),
            forces: Forces::default(),
        };
        layout.scatter(&mut rng);
        layout.enter_level();
        Ok(layout)
    }

    pub fn points(&self) -> usize {
        self.chains.points()
    }

    pub fn levels(&self) -> usize {
        self.levels.len()
    }

    pub fn iteration(&self) -> u32 {
        self.iteration
    }

    pub fn total_iterations(&self) -> u32 {
        (0..self.levels.len()).map(|l| self.budget(l)).sum()
    }

    pub fn done(&self) -> bool {
        self.points() == 0 || (self.level == 0 && self.level_iteration >= self.level_budget())
    }

    fn level_budget(&self) -> u32 {
        self.budget(self.level)
    }

    /// Coarse levels decide the shape and cost little, so each level up
    /// gets twice the iterations of the one below, up to eight times.
    fn budget(&self, level: usize) -> u32 {
        if level == self.levels.len() - 1 {
            self.options.iterations
        } else {
            self.options.refine_iterations << level.min(3)
        }
    }

    /// Single segments are laid straight on level 0 and carried up as the
    /// mean of their children; everything else starts at random inside a
    /// square sized to its component.
    fn scatter(&mut self, rng: &mut Rng) {
        let c = &self.chains;
        let (mut xs, mut ys) = (vec![0.0f32; c.points()], vec![0.0f32; c.points()]);
        for s in 0..c.start.len() as u32 {
            let length = c.piece_length[s as usize];
            for (k, p) in (c.first(s)..=c.last(s)).enumerate() {
                xs[p as usize] = length * k as f32;
            }
        }
        for split in &self.splits {
            let mut cx = vec![0.0f32; split.children.len()];
            let mut cy = vec![0.0f32; split.children.len()];
            for (p, &(u, v, _)) in split.children.iter().enumerate() {
                let (u, v) = (u as usize, if v == NONE { u } else { v } as usize);
                cx[p] = (xs[u] + xs[v]) * 0.5;
                cy[p] = (ys[u] + ys[v]) * 0.5;
            }
            (xs, ys) = (cx, cy);
        }
        let top = &self.levels[self.level];
        for comp in 0..self.frozen.len() {
            if self.frozen[comp] {
                continue;
            }
            let range = top.component_start[comp] as usize..top.component_start[comp + 1] as usize;
            let mass: f32 = top.mass[range.clone()].iter().sum();
            let side = NODE_SEGMENT_LENGTH * mass.sqrt() * 2.0;
            for p in range {
                xs[p] = rng.next_f32() * side;
                ys[p] = rng.next_f32() * side;
            }
        }
        self.xs = xs;
        self.ys = ys;
    }

    fn enter_level(&mut self) {
        let level = &self.levels[self.level];
        self.forces.prepare(level);
        let coarsest = self.level == self.levels.len() - 1;
        let mean_rest = level.springs.rest.iter().sum::<f32>() / level.springs.len().max(1) as f32;
        self.heat = (0..self.frozen.len())
            .map(|c| {
                if self.frozen[c] {
                    return 0.0;
                }
                let range =
                    level.component_start[c] as usize..level.component_start[c + 1] as usize;
                let mass: f32 = level.mass[range].iter().sum();
                let hot = NODE_SEGMENT_LENGTH * mass.sqrt();
                if coarsest {
                    hot
                } else {
                    hot.min(mean_rest * 3.0)
                }
                .max(COLD)
            })
            .collect();
    }

    /// Splits each node of the current level into its two children, set
    /// either side of it in the direction their own neighbours lie, so a
    /// chain unfolds without twisting.
    fn descend(&mut self) {
        // Seeded per level, so results never depend on how steps are batched.
        let mut rng = Rng::new(self.options.seed ^ (self.level as u64) << 40);
        let split = &self.splits[self.level - 1];
        let finer = &self.levels[self.level - 1];
        let n = split.parent.len();
        let (mut pull_x, mut pull_y) = (vec![0.0f32; n], vec![0.0f32; n]);
        let s = &finer.springs;
        for e in 0..s.len() {
            let (a, b) = (s.a[e] as usize, s.b[e] as usize);
            let (pa, pb) = (split.parent[a] as usize, split.parent[b] as usize);
            if pa == pb {
                continue;
            }
            let w = s.weight[e];
            pull_x[a] += (self.xs[pb] - self.xs[pa]) * w;
            pull_y[a] += (self.ys[pb] - self.ys[pa]) * w;
            pull_x[b] += (self.xs[pa] - self.xs[pb]) * w;
            pull_y[b] += (self.ys[pa] - self.ys[pb]) * w;
        }
        let (mut xs, mut ys) = (vec![0.0f32; n], vec![0.0f32; n]);
        for (p, &(u, v, rest)) in split.children.iter().enumerate() {
            let (x, y) = (self.xs[p], self.ys[p]);
            let (u, v) = (u as usize, v as usize);
            if v == NONE as usize {
                xs[u] = x;
                ys[u] = y;
                continue;
            }
            let half = (rest + (finer.span[u] + finer.span[v]) * 0.5) * 0.5;
            let (mut dx, mut dy) = (pull_x[v] - pull_x[u], pull_y[v] - pull_y[u]);
            let d = dx.hypot(dy);
            if d > 1e-6 {
                dx /= d;
                dy /= d;
            } else {
                let angle = rng.next_f32() * std::f32::consts::TAU;
                (dx, dy) = (angle.cos(), angle.sin());
            }
            xs[u] = x - dx * half;
            ys[u] = y - dy * half;
            xs[v] = x + dx * half;
            ys[v] = y + dy * half;
        }
        self.xs = xs;
        self.ys = ys;
        self.level -= 1;
        self.level_iteration = 0;
        self.enter_level();
    }

    /// Runs up to `n` iterations; returns whether the layout has finished.
    pub fn step(&mut self, n: u32) -> bool {
        for _ in 0..n {
            if self.done() {
                break;
            }
            if self.level_iteration >= self.level_budget() {
                self.descend();
            }
            let progress = self.level_iteration as f32 / self.level_budget().max(1) as f32;
            // Geometric cooling from each component's heat down to `COLD`.
            let temperature: Vec<f32> = self
                .heat
                .iter()
                .map(|&h| {
                    if h == 0.0 {
                        0.0
                    } else {
                        h * (COLD / h).powf(progress)
                    }
                })
                .collect();
            self.forces.iterate(
                &self.levels[self.level],
                &temperature,
                &mut self.xs,
                &mut self.ys,
            );
            self.level_iteration += 1;
            self.iteration += 1;
        }
        self.done()
    }

    /// Level 0 positions, components packed apart, as `x, y` pairs. While a
    /// coarser level runs, each point takes its ancestor's position.
    pub fn write_positions(&self, out: &mut Vec<f32>) {
        let n = self.chains.points();
        let mut node: Vec<u32> = (0..n as u32).collect();
        for split in &self.splits[..self.level] {
            for v in &mut node {
                *v = split.parent[*v as usize];
            }
        }
        let starts = &self.chains.component_start;
        let components = self.frozen.len();
        let mut boxes = Vec::with_capacity(components);
        for c in 0..components {
            let (mut x0, mut y0, mut x1, mut y1) = (f32::MAX, f32::MAX, f32::MIN, f32::MIN);
            for &v in &node[starts[c] as usize..starts[c + 1] as usize] {
                let (x, y) = (self.xs[v as usize], self.ys[v as usize]);
                x0 = x0.min(x);
                y0 = y0.min(y);
                x1 = x1.max(x);
                y1 = y1.max(y);
            }
            boxes.push((x0 - MARGIN, y0 - MARGIN, x1 + MARGIN, y1 + MARGIN));
        }
        let offsets = pack_components(&boxes, &self.frozen);
        out.clear();
        out.reserve(n * 2);
        for c in 0..components {
            let (ox, oy) = offsets[c];
            let (bx, by, _, _) = boxes[c];
            for &v in &node[starts[c] as usize..starts[c + 1] as usize] {
                out.push(self.xs[v as usize] - bx + ox);
                out.push(self.ys[v as usize] - by + oy);
            }
        }
    }
}

fn largest_active(level: &Level, frozen: &[bool]) -> usize {
    let s = &level.component_start;
    (0..frozen.len())
        .filter(|&c| !frozen[c])
        .map(|c| (s[c + 1] - s[c]) as usize)
        .max()
        .unwrap_or(0)
}
