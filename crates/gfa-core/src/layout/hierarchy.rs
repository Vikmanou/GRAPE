//! The coarsened levels as flat arrays, ready for GPU buffers. Floats are
//! stored as their bits so each record is one run of `u32`s.

use super::Layout;
use super::force::repulsion;
use super::level::NONE;

#[derive(Debug, Clone, PartialEq)]
pub struct HierarchyLevel {
    /// `component, step size, first edge, end edge` per node.
    pub nodes: Vec<u32>,
    /// `neighbour, rest length, weight` per spring end; each spring appears
    /// once from each of its nodes.
    pub edges: Vec<u32>,
    /// Starting temperature per component, zero for frozen ones.
    pub heat: Vec<f32>,
    /// `k^2` scaled, for `repulsion / d`.
    pub repulsion: f32,
    pub mean_rest: f32,
    pub iterations: u32,
    /// Node of the next coarser level each node merged into; empty on the
    /// coarsest level.
    pub parent: Vec<u32>,
    /// `first child, second child or u32::MAX, half the distance between
    /// them` per node, in the next finer level; empty on level 0.
    pub children: Vec<u32>,
}

impl HierarchyLevel {
    pub fn len(&self) -> usize {
        self.nodes.len() / 4
    }

    pub fn is_empty(&self) -> bool {
        self.nodes.is_empty()
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Hierarchy {
    /// Level 0 holds every point; each next level is coarser.
    pub levels: Vec<HierarchyLevel>,
    /// `x, y` per coarsest node.
    pub start: Vec<f32>,
    pub frozen: Vec<bool>,
}

impl Layout {
    /// Hands each level over as it is converted, so at most one level is
    /// held twice.
    pub fn into_hierarchy(self) -> Hierarchy {
        let top = self.levels.len() - 1;
        let budgets: Vec<u32> = (0..=top).map(|l| self.budget(l)).collect();
        let Layout {
            levels,
            splits,
            frozen,
            start,
            ..
        } = self;
        let mut splits = splits.into_iter();
        let mut merged = Vec::new();
        let mut finer_span: Vec<f32> = Vec::new();
        let mut out = Vec::with_capacity(levels.len());
        for (l, level) in levels.into_iter().enumerate() {
            let children = merged
                .iter()
                .flat_map(|&(u, v, rest): &(u32, u32, f32)| {
                    let half: f32 = if v == NONE {
                        0.0
                    } else {
                        (rest + (finer_span[u as usize] + finer_span[v as usize]) * 0.5) * 0.5
                    };
                    [u, v, half.to_bits()]
                })
                .collect();
            let (parent, next) = splits
                .next()
                .map_or_else(Default::default, |s| (s.parent, s.children));
            merged = next;
            let (offsets, ends) = level.adjacency();
            let s = &level.springs;
            let step = level.step_sizes();
            let mut nodes = Vec::with_capacity(level.len() * 4);
            for v in 0..level.len() {
                nodes.extend([
                    level.component[v],
                    step[v].to_bits(),
                    offsets[v],
                    offsets[v + 1],
                ]);
            }
            let mut edges = Vec::with_capacity(ends.len() * 3);
            for (v, w) in offsets.windows(2).enumerate() {
                for &e in &ends[w[0] as usize..w[1] as usize] {
                    let e = e as usize;
                    let other = if s.a[e] as usize == v { s.b[e] } else { s.a[e] };
                    edges.extend([other, s.rest[e].to_bits(), s.weight[e].to_bits()]);
                }
            }
            out.push(HierarchyLevel {
                nodes,
                edges,
                heat: level.heat(&frozen, l == top),
                repulsion: repulsion(&level),
                mean_rest: level.mean_rest(),
                iterations: budgets[l],
                parent,
                children,
            });
            finer_span = level.span;
        }
        Hierarchy {
            levels: out,
            start,
            frozen,
        }
    }
}
