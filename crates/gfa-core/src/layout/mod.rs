//! CPU reference layout, multilevel as the spec describes. It is the
//! correctness reference for the GPU layout and the WebGL2 fallback's layout.

mod force;
mod grid;
mod hierarchy;
mod level;
mod pack;
mod pins;
mod points;
mod quadtree;
mod quality;
pub mod rng;
mod topology;

pub use points::{Chains, link_geometry, link_points};
pub use quality::{Quality, measure};
pub use topology::{Topology, TopologyError};

use force::Forces;
pub use grid::{CellLists, Grid};
pub use hierarchy::{Hierarchy, HierarchyLevel};
use level::{Level, NONE, Split};
pub use pack::pack;
use pins::Refining;
use points::{NODE_SEGMENT_LENGTH, Springs};
use rng::Rng;

const COARSEST_NODES: usize = 8;
/// Per refining iteration of level 0, so presets scale it too.
const LEVEL_WORK: u64 = 400_000;
pub(crate) const COLD: f32 = 0.4;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LayoutOptions {
    pub seed: u64,
    pub coarsest_iterations: u32,
    pub refine_iterations: u32,
    pub max_pieces: u8,
}

impl Default for LayoutOptions {
    fn default() -> Self {
        Self {
            seed: 1,
            coarsest_iterations: 500,
            refine_iterations: 50,
            max_pieces: 50,
        }
    }
}

pub struct Layout {
    pub chains: Chains,
    options: LayoutOptions,
    /// Level 0 holds every point; each next level is coarser.
    levels: Vec<Level>,
    /// `splits[l]` turns level `l + 1` back into level `l`.
    splits: Vec<Split>,
    /// Springs before this one run along segments, the rest are links.
    first_link: usize,
    /// Components that are one unlinked segment, drawn straight.
    frozen: Vec<bool>,
    level: usize,
    level_iteration: u32,
    iteration: u32,
    xs: Vec<f32>,
    ys: Vec<f32>,
    heat: Vec<f32>,
    forces: Forces,
    /// `x, y` per coarsest node before the first step.
    start: Vec<f32>,
    /// One bit per pinned segment.
    pins: Vec<u32>,
    pin_count: usize,
    refining: Refining,
    /// Component offsets, fixed once the layout settled or was first
    /// refined, so dragging never repacks components.
    packed: Option<Vec<f32>>,
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
        while largest_active(&levels[levels.len() - 1], &frozen) > COARSEST_NODES {
            let Some((coarse, split)) = levels[levels.len() - 1].coarsen(&frozen) else {
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
            start: Vec::new(),
            pins: vec![0; t.lengths.len().div_ceil(32)],
            pin_count: 0,
            refining: Refining::No,
            packed: None,
        };
        layout.scatter(&mut rng);
        layout.start = layout
            .xs
            .iter()
            .zip(&layout.ys)
            .flat_map(|(&x, &y)| [x, y])
            .collect();
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
    /// gets twice the iterations of the one below, up to eight times. On
    /// large graphs the levels just above level 0 are not cheap: their work
    /// is capped near `LEVEL_WORK` node-iterations, never below twice level
    /// 0's iterations.
    fn budget(&self, level: usize) -> u32 {
        let refine = self.options.refine_iterations;
        let base = if level == self.levels.len() - 1 {
            self.options.coarsest_iterations
        } else {
            refine << level.min(3)
        };
        let nodes = self.levels[level].len().max(1) as u64;
        let capped = u64::from(refine) * LEVEL_WORK / nodes;
        base.min(capped.max(u64::from(refine) * 2) as u32)
    }

    /// Frozen components start straight; the rest at random in a square
    /// sized to the component.
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
        self.heat = level.heat(&self.frozen, self.level == self.levels.len() - 1);
    }

    /// Children go towards their own neighbours, so chains unfold untwisted.
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

    /// Returns whether the layout has finished.
    pub fn step(&mut self, n: u32) -> bool {
        for _ in 0..n {
            if self.done() {
                break;
            }
            if self.level_iteration >= self.level_budget() {
                self.descend();
            }
            let progress = self.level_iteration as f32 / self.level_budget().max(1) as f32;
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
            if self.refining == Refining::No {
                self.iteration += 1;
            }
        }
        if self.done() {
            if self.packed.is_none() {
                self.packed = Some(self.pack_shift());
            }
            if self.refining != Refining::No {
                self.end_refining();
            }
        }
        self.done()
    }

    /// Each point's node on the current level.
    fn nodes(&self) -> Vec<u32> {
        let mut node: Vec<u32> = (0..self.chains.points() as u32).collect();
        for split in &self.splits[..self.level] {
            for v in &mut node {
                *v = split.parent[*v as usize];
            }
        }
        node
    }

    /// `dx, dy` per component, packing the current boxes.
    fn pack_shift(&self) -> Vec<f32> {
        let node = self.nodes();
        let starts = &self.chains.component_start;
        let mut boxes = Vec::with_capacity(self.frozen.len() * 4);
        for c in 0..self.frozen.len() {
            let (mut x0, mut y0, mut x1, mut y1) = (f32::MAX, f32::MAX, f32::MIN, f32::MIN);
            for &v in &node[starts[c] as usize..starts[c + 1] as usize] {
                let (x, y) = (self.xs[v as usize], self.ys[v as usize]);
                x0 = x0.min(x);
                y0 = y0.min(y);
                x1 = x1.max(x);
                y1 = y1.max(y);
            }
            boxes.extend([x0, y0, x1, y1]);
        }
        pack(&boxes, &self.frozen)
    }

    /// `x, y` per point. While a coarser level runs, points take their
    /// ancestor's position.
    pub fn write_positions(&self, out: &mut Vec<f32>) {
        let node = self.nodes();
        let starts = &self.chains.component_start;
        let shift = match &self.packed {
            Some(packed) => packed.clone(),
            None => self.pack_shift(),
        };
        out.clear();
        out.reserve(node.len() * 2);
        for c in 0..self.frozen.len() {
            let (dx, dy) = (shift[c * 2], shift[c * 2 + 1]);
            for &v in &node[starts[c] as usize..starts[c + 1] as usize] {
                out.push(self.xs[v as usize] + dx);
                out.push(self.ys[v as usize] + dy);
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
